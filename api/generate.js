/**
 * POST /api/generate — Vercel serverless function
 * Generates an educational banner image via HF FLUX.1-schnell.
 * Auth: OPENROUTER_API_KEY, GROQ_API_KEY, HF_TOKEN from process.env
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT_URL   = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_CHAT_URL         = 'https://api.groq.com/openai/v1/chat/completions';

async function fetchFreeTextModels() {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.data ?? []).filter(m => {
    const isFree = m.pricing?.prompt === '0' && m.pricing?.completion === '0';
    const isText = (typeof m.modality === 'string' && m.modality.includes('text')) || (m.context_length != null && m.context_length > 0);
    return isFree && isText;
  });
}

async function callOpenRouter(modelId, userPrompt) {
  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://prototype-05.vercel.app', 'X-Title': 'Prototype-05 Image Generator' },
    body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: userPrompt }], max_tokens: 500 })
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function tryModelsInBatches(models, prompt) {
  for (let i = 0; i < models.length; i += 10) {
    for (const model of models.slice(i, i + 10)) {
      try {
        const result = await callOpenRouter(model.id, prompt);
        if (result) return { text: result, modelUsed: model.id };
      } catch (e) {
        console.warn(`[generate] Model ${model.id} failed: ${e.message}`);
      }
    }
  }
  return null;
}

async function callGroq(prompt) {
  for (const model of ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama3-70b-8192']) {
    try {
      const res = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 500 })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) return { text, modelUsed: `groq/${model}` };
    } catch { continue; }
  }
  throw new Error('All models failed');
}

function snapDim(n) { return Math.min(1280, Math.max(256, Math.round(n / 8) * 8)); }

function parseSize(sizeStr) {
  const parts = String(sizeStr).replace(/\s+/g, '').split(/x/i).map(Number);
  return { width: parts[0] > 0 ? parts[0] : 1280, height: parts[1] > 0 ? parts[1] : 720 };
}

async function generateImageWithHF(prompt, width, height) {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error('HF_TOKEN not set');
  const w = snapDim(width), h = snapDim(height);
  const res = await fetch(
    'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'x-use-cache': 'false' },
      body: JSON.stringify({
        inputs: `${prompt}, professional, high quality, clean educational banner, no text, no letters, no words, no typography, no captions`,
        parameters: { width: w, height: h, num_inference_steps: 4 },
      }),
      signal: AbortSignal.timeout(55_000),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403) throw new Error('HF token permission error — need Fine-grained token with Inference Providers permission');
    throw new Error(`HF API ${res.status}: ${errText.substring(0, 120)}`);
  }
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const base64 = Buffer.from(buffer).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

function buildPrompt({ courseName, targetAudience, objectives, content, ratio }) {
  return 'You are an expert at creating image generation prompts for educational content.\n' +
    'Return a JSON object with exactly two fields:\n' +
    '  "prompt": A detailed English image generation prompt for a professional educational course banner.\n' +
    '  "description": A concise Korean description (2-3 sentences) of what the generated image will look like.\n' +
    'The prompt should produce a visually appealing, modern, professional educational banner.\n' +
    'IMPORTANT: NO text, no letters, no words, no numbers, no captions in the image.\n' +
    'Return ONLY the raw JSON object.\n\n' +
    `Course: ${courseName}\nTarget Audience: ${targetAudience}\nObjectives: ${objectives}\nContent: ${content}\nAspect Ratio: ${ratio}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { courseName, targetAudience, objectives, content, ratio, size } = req.body ?? {};

    let freeModels = [];
    try { freeModels = await fetchFreeTextModels(); } catch (e) { console.warn('[generate] models fetch failed:', e.message); }

    const llmPrompt = buildPrompt({ courseName: courseName ?? '', targetAudience: targetAudience ?? '', objectives: objectives ?? '', content: content ?? '', ratio: ratio ?? '16:9' });

    let rawText, modelUsed;
    const orResult = freeModels.length > 0 ? await tryModelsInBatches(freeModels, llmPrompt) : null;

    if (orResult) {
      rawText   = orResult.text.trim();
      modelUsed = `openrouter/${orResult.modelUsed}`;
    } else {
      const groqResult = await callGroq(llmPrompt);
      rawText   = groqResult.text.trim();
      modelUsed = groqResult.modelUsed;
    }

    let imagePrompt = rawText, koreanDescription = null;
    try {
      const m = rawText.match(/\{[\s\S]*\}/);
      if (m) { const p = JSON.parse(m[0]); if (p.prompt) { imagePrompt = p.prompt.trim(); koreanDescription = p.description?.trim() || null; } }
    } catch {}

    const { width, height } = parseSize(size ?? '1280x720');
    const imageData = await generateImageWithHF(imagePrompt, width, height);

    return res.status(200).json({ imageData, prompt: imagePrompt, koreanDescription, modelUsed });
  } catch (error) {
    console.error('[generate] error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
