/**
 * POST /api/generate
 *
 * Generates an educational course banner image via Pollinations.ai.
 *
 * Flow:
 *   1. Fetch free text-capable models from OpenRouter.
 *   2. Try up to 10 models per batch; use Groq as final fallback.
 *   3. The LLM converts Korean course metadata into an English image prompt.
 *   4. Pollinations.ai renders the image.
 *
 * Body: { courseName, targetAudience, objectives, content, ratio, size, recordId }
 *
 * Authentication:
 *   OPENROUTER_API_KEY — loaded from process.env (never hardcoded)
 *   GROQ_API_KEY       — loaded from process.env (never hardcoded)
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function fetchFreeTextModels() {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`OpenRouter models fetch failed: ${response.status}`);
  }

  const data = await response.json();
  const allModels = data.data ?? [];

  return allModels.filter((m) => {
    const isFree =
      m.pricing?.prompt === '0' && m.pricing?.completion === '0';
    const isTextCapable =
      (typeof m.modality === 'string' && m.modality.includes('text')) ||
      (m.context_length != null && m.context_length > 0);
    return isFree && isTextCapable;
  });
}

async function callOpenRouter(modelId, userPrompt) {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://prototype-05.vercel.app',
      'X-Title': 'Prototype-05 Image Generator'
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 500
    })
  });

  if (!response.ok) throw new Error(`${response.status}`);

  const data = await response.json();
  return data.choices?.[0]?.message?.content;
}

async function tryModelsInBatches(models, prompt) {
  for (let i = 0; i < models.length; i += 10) {
    const batch = models.slice(i, i + 10);
    for (const model of batch) {
      try {
        const result = await callOpenRouter(model.id, prompt);
        if (result) return { text: result, modelUsed: model.id };
      } catch (e) {
        console.warn(`[generate] Model ${model.id} failed: ${e.message}`);
        continue;
      }
    }
  }
  return null;
}

async function callGroq(prompt) {
  const models = [
    'llama-3.3-70b-versatile',
    'llama-3.1-70b-versatile',
    'llama3-70b-8192'
  ];

  for (const model of models) {
    try {
      const response = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500
        })
      });

      if (!response.ok) continue;

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) return { text, modelUsed: `groq/${model}` };
    } catch {
      continue;
    }
  }

  throw new Error('All models failed');
}

function parseSize(sizeStr) {
  const parts = String(sizeStr)
    .replace(/\s+/g, '')
    .split(/x/i)
    .map(Number);

  const width = parts[0] > 0 ? parts[0] : 1280;
  const height = parts[1] > 0 ? parts[1] : 720;
  return { width, height };
}

function buildPollinationsUrl(imagePrompt, width, height) {
  const enrichedPrompt = `${imagePrompt}, professional, high quality, educational`;
  const seed = Math.floor(Math.random() * 10000);
  return (
    `https://image.pollinations.ai/prompt/${encodeURIComponent(enrichedPrompt)}` +
    `?width=${width}&height=${height}&nologo=true&enhance=true&seed=${seed}`
  );
}

function buildImagePromptRequest({ courseName, targetAudience, objectives, content, ratio }) {
  const systemInstruction =
    'You are an expert at creating image generation prompts for educational content.\n' +
    'Create a detailed, professional image generation prompt in English for an educational course banner.\n' +
    'The prompt should create a visually appealing, modern, professional educational banner.\n' +
    'Return ONLY the image generation prompt, nothing else.';

  const userDetails =
    `Course: ${courseName}\n` +
    `Target Audience: ${targetAudience}\n` +
    `Objectives: ${objectives}\n` +
    `Content: ${content}\n` +
    `Aspect Ratio: ${ratio}`;

  return `${systemInstruction}\n\n${userDetails}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { courseName, targetAudience, objectives, content, ratio, size } = req.body ?? {};

    let freeModels = [];
    try {
      freeModels = await fetchFreeTextModels();
      console.log(`[generate] Found ${freeModels.length} free text models`);
    } catch (e) {
      console.warn('[generate] Could not fetch free models:', e.message);
    }

    const llmPrompt = buildImagePromptRequest({
      courseName: courseName ?? '',
      targetAudience: targetAudience ?? '',
      objectives: objectives ?? '',
      content: content ?? '',
      ratio: ratio ?? '16:9'
    });

    let imagePrompt;
    let modelUsed;

    const openRouterResult = freeModels.length > 0
      ? await tryModelsInBatches(freeModels, llmPrompt)
      : null;

    if (openRouterResult) {
      imagePrompt = openRouterResult.text.trim();
      modelUsed = `openrouter/${openRouterResult.modelUsed}`;
    } else {
      console.log('[generate] OpenRouter exhausted — falling back to Groq');
      const groqResult = await callGroq(llmPrompt);
      imagePrompt = groqResult.text.trim();
      modelUsed = groqResult.modelUsed;
    }

    const { width, height } = parseSize(size ?? '1280 x 720');
    const imageUrl = buildPollinationsUrl(imagePrompt, width, height);

    return res.status(200).json({
      imageUrl,
      prompt: imagePrompt,
      modelUsed
    });

  } catch (error) {
    console.error('[generate] Unhandled error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}