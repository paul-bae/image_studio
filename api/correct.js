/**
 * POST /api/correct
 *
 * Analyses an existing educational image with a vision model and regenerates
 * an improved version via Pollinations.ai.
 *
 * Body: { imageBase64, imageName, ratio, size, recordId }
 *
 * Authentication:
 *   OPENROUTER_API_KEY — loaded from process.env (never hardcoded)
 *   GROQ_API_KEY       — loaded from process.env (never hardcoded)
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

const MAX_BASE64_CHARS = 4 * 1024 * 1024;

async function fetchFreeVisionModels() {
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
    const isVisionCapable =
      typeof m.modality === 'string' && m.modality.includes('image');
    return isFree && isVisionCapable;
  });
}

async function callOpenRouterVision(modelId, imageBase64, textPrompt) {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://prototype-05.vercel.app',
      'X-Title': 'Prototype-05 Image Corrector'
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: textPrompt },
          { type: 'image_url', image_url: { url: imageBase64 } }
        ]
      }],
      max_tokens: 800
    })
  });

  if (!response.ok) throw new Error(`${response.status}`);

  const data = await response.json();
  return data.choices?.[0]?.message?.content;
}

async function tryVisionModels(models, imageBase64, prompt) {
  for (const model of models) {
    try {
      const result = await callOpenRouterVision(model.id, imageBase64, prompt);
      if (result) return { text: result, modelUsed: model.id };
    } catch (e) {
      console.warn(`[correct] Vision model ${model.id} failed: ${e.message}`);
      continue;
    }
  }
  return null;
}

async function callGroqVision(imageBase64, prompt) {
  const response = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.2-11b-vision-preview',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageBase64 } }
        ]
      }],
      max_tokens: 800
    })
  });

  if (!response.ok) {
    throw new Error(`Groq vision failed: ${response.status}`);
  }

  const data = await response.json();
  return {
    text: data.choices?.[0]?.message?.content,
    modelUsed: 'groq/llama-3.2-11b-vision-preview'
  };
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

const VISION_ANALYSIS_PROMPT =
  'Analyze this educational image and provide:\n' +
  '1. A brief description of the image content\n' +
  '2. Suggestions for making it better as educational material\n' +
  '3. A detailed image generation prompt (in English) for creating an improved version\n\n' +
  'Return as JSON: { "description": "...", "suggestions": "...", "improvedPrompt": "..." }';

function parseVisionJson(raw) {
  if (!raw) return null;

  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageBase64, imageName, ratio, size } = req.body ?? {};

    const { width, height } = parseSize(size ?? '1280 x 720');

    const hasValidImage =
      imageBase64 &&
      typeof imageBase64 === 'string' &&
      imageBase64.length <= MAX_BASE64_CHARS;

    if (!hasValidImage && imageBase64) {
      console.warn('[correct] imageBase64 exceeds 4 MB — using fallback prompt');
    }

    let improvedPrompt = null;
    let correctionNotes = '';
    let modelUsed = 'none';

    if (hasValidImage) {
      let visionModels = [];
      try {
        visionModels = await fetchFreeVisionModels();
      } catch (e) {
        console.warn('[correct] Could not fetch vision models:', e.message);
      }

      let visionResult = null;

      if (visionModels.length > 0) {
        visionResult = await tryVisionModels(visionModels, imageBase64, VISION_ANALYSIS_PROMPT);
        if (visionResult) {
          modelUsed = `openrouter/${visionResult.modelUsed}`;
        }
      }

      if (!visionResult) {
        try {
          visionResult = await callGroqVision(imageBase64, VISION_ANALYSIS_PROMPT);
          modelUsed = visionResult.modelUsed;
        } catch (e) {
          console.error('[correct] Groq vision also failed:', e.message);
        }
      }

      if (visionResult?.text) {
        const parsed = parseVisionJson(visionResult.text);
        if (parsed) {
          improvedPrompt = parsed.improvedPrompt ?? null;
          correctionNotes =
            [parsed.description, parsed.suggestions]
              .filter(Boolean)
              .join(' | ');
        } else {
          correctionNotes = visionResult.text;
        }
      }
    }

    const finalPrompt =
      improvedPrompt?.trim() ||
      `Professional educational image, ${ratio ?? '16:9'} aspect ratio, modern design, clean and bright`;

    const correctedImageUrl = buildPollinationsUrl(finalPrompt, width, height);

    return res.status(200).json({
      correctedImageUrl,
      correctionNotes: correctionNotes || 'Image regenerated with improved prompt.',
      modelUsed
    });

  } catch (error) {
    console.error('[correct] Unhandled error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}