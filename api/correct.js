/**
 * POST /api/correct — Vercel serverless function
 * Analyses an image with vision model, regenerates improved version via HF FLUX.1-schnell.
 * Auth: OPENROUTER_API_KEY, GROQ_API_KEY, HF_TOKEN from process.env
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT_URL   = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_CHAT_URL         = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_BASE64_CHARS      = 4 * 1024 * 1024;

async function fetchFreeVisionModels() {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.data ?? []).filter(m =>
    m.pricing?.prompt === '0' && m.pricing?.completion === '0' &&
    typeof m.modality === 'string' && m.modality.includes('image')
  );
}

async function callOpenRouterVision(modelId, imageBase64, textPrompt) {
  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://prototype-05.vercel.app', 'X-Title': 'Prototype-05 Image Corrector' },
    body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: [{ type: 'text', text: textPrompt }, { type: 'image_url', image_url: { url: imageBase64 } }] }], max_tokens: 800 })
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function tryVisionModels(models, imageBase64, prompt) {
  for (const model of models) {
    try {
      const result = await callOpenRouterVision(model.id, imageBase64, prompt);
      if (result) return { text: result, modelUsed: model.id };
    } catch (e) { console.warn(`[correct] Vision model ${model.id} failed: ${e.message}`); }
  }
  return null;
}

async function callGroqVision(imageBase64, prompt) {
  const MODELS = [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'llama-3.2-90b-vision-preview',
    'llama-3.2-11b-vision-preview',
  ];
  for (const model of MODELS) {
    try {
      const res = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageBase64 } }] }], max_tokens: 800 })
      });
      if (!res.ok) { console.warn(`[correct] Groq ${model} -> ${res.status}`); continue; }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) return { text, modelUsed: `groq/${model}` };
    } catch (e) { console.warn(`[correct] Groq ${model} exception:`, e.message); }
  }
  throw new Error('All Groq vision models failed');
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
      body: JSON.stringify({ inputs: `${prompt}, professional, high quality, clean educational banner, no text, no letters, no words`, parameters: { width: w, height: h, num_inference_steps: 4 } }),
      signal: AbortSignal.timeout(55_000),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403) throw new Error('HF token permission error');
    throw new Error(`HF API ${res.status}: ${errText.substring(0, 120)}`);
  }
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const base64 = Buffer.from(buffer).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

const VISION_PROMPT =
  'Analyze this educational image and provide the following in Korean:\n' +
  '1. "description": \uc774\ubbf8\uc9c0 \ub0b4\uc6a9\uc5d0 \ub300\ud55c \uac04\ub7b5\ud55c \ud55c\uad6d\uc5b4 \uc124\uba85\n' +
  '2. "suggestions": \uad50\uc721 \uc790\ub8cc\ub85c \uac1c\uc120\ud560 \uc218 \uc788\ub294 \ud55c\uad6d\uc5b4 \uc81c\uc548\uc0ac\ud56d\n' +
  '3. "improvedPrompt": improved image generation prompt in English only\n\n' +
  'Return ONLY raw JSON (no markdown): { "description": "Korean...", "suggestions": "Korean...", "improvedPrompt": "English..." }';

function parseVisionJson(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageBase64, ratio, size } = req.body ?? {};
    const { width, height } = parseSize(size ?? '1280x720');

    const hasValidImage = imageBase64 && typeof imageBase64 === 'string' && imageBase64.length <= MAX_BASE64_CHARS;

    let improvedPrompt = null, correctionNotes = '', modelUsed = 'none';

    if (hasValidImage) {
      let visionModels = [];
      try { visionModels = await fetchFreeVisionModels(); } catch (e) { console.warn('[correct] vision models fetch failed:', e.message); }

      let visionResult = visionModels.length > 0 ? await tryVisionModels(visionModels, imageBase64, VISION_PROMPT) : null;
      if (visionResult) {
        modelUsed = `openrouter/${visionResult.modelUsed}`;
      } else {
        try {
          visionResult = await callGroqVision(imageBase64, VISION_PROMPT);
          modelUsed = visionResult.modelUsed;
        } catch (e) { console.error('[correct] all vision models failed:', e.message); }
      }

      if (visionResult?.text) {
        const parsed = parseVisionJson(visionResult.text);
        if (parsed) {
          improvedPrompt  = parsed.improvedPrompt ?? null;
          correctionNotes = [parsed.description, parsed.suggestions].filter(Boolean).join(' | ');
        } else {
          correctionNotes = visionResult.text;
        }
      }
    }

    const finalPrompt = improvedPrompt?.trim() || `Professional educational image, ${ratio ?? '16:9'} aspect ratio, modern design, clean and bright`;
    const correctedImageData = await generateImageWithHF(finalPrompt, width, height);

    return res.status(200).json({
      correctedImageData,
      correctionNotes: correctionNotes || '\uc774\ubbf8\uc9c0 \ubd84\uc11d \uc5c6\uc774 \uae30\ubcf8 \ud504\ub86c\ud504\ud2b8\ub85c \uc7ac\uc0dd\uc131\ub418\uc5c8\uc2b5\ub2c8\ub2e4.',
      modelUsed
    });
  } catch (error) {
    console.error('[correct] error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
