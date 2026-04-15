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
 *   size format: "1280 x 720" (width space x space height)
 *
 * Authentication:
 *   OPENROUTER_API_KEY — loaded from process.env (never hardcoded)
 *   GROQ_API_KEY       — loaded from process.env (never hardcoded)
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ---------------------------------------------------------------------------
// OpenRouter helpers
// ---------------------------------------------------------------------------

/**
 * Fetch free, text-capable models from OpenRouter.
 * A model is considered text-capable when its modality includes "text" OR
 * it has a positive context_length (fallback for models that omit modality).
 * @returns {Promise<Object[]>}
 */
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

/**
 * Call a single OpenRouter chat-completion model.
 * Throws on non-2xx so the batch loop can catch and continue.
 * @param {string} modelId
 * @param {string} userPrompt
 * @returns {Promise<string>} The assistant message content.
 */
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

/**
 * Try models in sequential batches of 10.
 * Returns the first successful result or null if every model fails.
 * @param {Object[]} models
 * @param {string} prompt
 * @returns {Promise<{text: string, modelUsed: string}|null>}
 */
async function tryModelsInBatches(models, prompt) {
  for (let i = 0; i < models.length; i += 10) {
    const batch = models.slice(i, i + 10);
    for (const model of batch) {
      try {
        const result = await callOpenRouter(model.id, prompt);
        if (result) return { text: result, modelUsed: model.id };
      } catch (e) {
        // Rate-limit (429) or any other error → try next model.
        console.warn(`[generate] Model ${model.id} failed: ${e.message}`);
        continue;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Groq fallback
// ---------------------------------------------------------------------------

/**
 * Try Groq models in sequence as a final fallback.
 * @param {string} prompt
 * @returns {Promise<{text: string, modelUsed: string}>}
 */
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

// ---------------------------------------------------------------------------
// Image generation via Pollinations.ai
// ---------------------------------------------------------------------------

/**
 * Parse a size string like "1280 x 720" into { width, height }.
 * Handles formats: "1280x720", "1280 x 720", "1280X720".
 * @param {string} sizeStr
 * @returns {{ width: number, height: number }}
 */
function parseSize(sizeStr) {
  const parts = String(sizeStr)
    .replace(/\s+/g, '')
    .split(/x/i)
    .map(Number);

  const width  = parts[0] > 0 ? parts[0] : 1280;
  const height = parts[1] > 0 ? parts[1] : 720;
  return { width, height };
}

// ---------------------------------------------------------------------------
// Image generation via Hugging Face Inference API (FLUX.1-schnell)
// Pollinations.ai no longer allows programmatic access (Turnstile required).
// ---------------------------------------------------------------------------

/**
 * Round a pixel dimension to the nearest multiple of 8, clamped to [256, 1280].
 * FLUX.1-schnell requires multiples of 8.
 */
function snapDim(n) {
  return Math.min(1280, Math.max(256, Math.round(n / 8) * 8));
}

/**
 * Generate an image via HF Inference API and return it as a base64 data URL.
 * @param {string} prompt  English image prompt
 * @param {number} width
 * @param {number} height
 * @returns {Promise<string>} data URL
 */
async function generateImageWithHF(prompt, width, height) {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error('HF_TOKEN이 .env에 설정되지 않았습니다');

  const w = snapDim(width);
  const h = snapDim(height);

  console.log(`[generate] HF FLUX.1-schnell — ${w}x${h}`);

  const res = await fetch(
    'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-use-cache': 'false',
      },
      body: JSON.stringify({
        inputs: `${prompt}, professional, high quality, clean educational banner`,
        parameters: { width: w, height: h, num_inference_steps: 4 },
      }),
      signal: AbortSignal.timeout(55_000),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403) {
      throw new Error('HF 토큰 권한 부족 — huggingface.co/settings/tokens/new 에서 Fine-grained 토큰 (Make calls to Inference Providers 권한) 을 새로 발급하세요');
    }
    throw new Error(`HF API ${res.status}: ${errText.substring(0, 120)}`);
  }

  const buffer      = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const base64      = Buffer.from(buffer).toString('base64');
  console.log(`[generate] HF image generated: ${Math.round(buffer.byteLength / 1024)} KB`);
  return `data:${contentType};base64,${base64}`;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the LLM prompt that asks for an English image generation prompt.
 * The system instruction is embedded as the first message to maximise
 * compatibility across models that may not support a separate system role.
 * @param {Object} params
 * @returns {string} Combined prompt string sent as the user message.
 */
function buildImagePromptRequest({ courseName, targetAudience, objectives, content, ratio }) {
  const systemInstruction =
    'You are an expert at creating image generation prompts for educational content.\n' +
    'Return a JSON object with exactly two fields:\n' +
    '  "prompt": A detailed English image generation prompt for a professional educational course banner.\n' +
    '  "description": A concise Korean description (2-3 sentences) of what the generated image will look like.\n' +
    'The prompt should produce a visually appealing, modern, professional educational banner.\n' +
    'Return ONLY the raw JSON object — no markdown fences, no extra text.';

  const userDetails =
    `Course: ${courseName}\n` +
    `Target Audience: ${targetAudience}\n` +
    `Objectives: ${objectives}\n` +
    `Content: ${content}\n` +
    `Aspect Ratio: ${ratio}`;

  return `${systemInstruction}\n\n${userDetails}`;
}

// ---------------------------------------------------------------------------
// Vercel handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  // Handle CORS preflight.
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { courseName, targetAudience, objectives, content, ratio, size } = req.body ?? {};

    // ------------------------------------------------------------------
    // Step 1: Fetch free text-capable models from OpenRouter.
    // ------------------------------------------------------------------
    let freeModels = [];
    try {
      freeModels = await fetchFreeTextModels();
      console.log(`[generate] Found ${freeModels.length} free text models`);
    } catch (e) {
      console.warn('[generate] Could not fetch free models:', e.message);
    }

    // ------------------------------------------------------------------
    // Step 2: Build the prompt requesting an English image prompt.
    // ------------------------------------------------------------------
    const llmPrompt = buildImagePromptRequest({
      courseName: courseName ?? '',
      targetAudience: targetAudience ?? '',
      objectives: objectives ?? '',
      content: content ?? '',
      ratio: ratio ?? '16:9'
    });

    // ------------------------------------------------------------------
    // Step 3: Try OpenRouter models in batches, fall back to Groq.
    // ------------------------------------------------------------------
    let rawText;
    let modelUsed;

    const openRouterResult = freeModels.length > 0
      ? await tryModelsInBatches(freeModels, llmPrompt)
      : null;

    if (openRouterResult) {
      rawText    = openRouterResult.text.trim();
      modelUsed  = `openrouter/${openRouterResult.modelUsed}`;
      console.log(`[generate] Used OpenRouter model: ${openRouterResult.modelUsed}`);
    } else {
      console.log('[generate] OpenRouter exhausted — falling back to Groq');
      const groqResult = await callGroq(llmPrompt);
      rawText   = groqResult.text.trim();
      modelUsed = groqResult.modelUsed;
      console.log(`[generate] Used Groq model: ${groqResult.modelUsed}`);
    }

    // ------------------------------------------------------------------
    // Parse JSON response: { prompt (English), description (Korean) }
    // Fall back to using the raw text as the English prompt if invalid.
    // ------------------------------------------------------------------
    let imagePrompt      = rawText;
    let koreanDescription = null;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.prompt) {
          imagePrompt       = parsed.prompt.trim();
          koreanDescription = parsed.description?.trim() || null;
        }
      }
    } catch {
      console.warn('[generate] LLM did not return valid JSON — using raw text as prompt');
    }

    // ------------------------------------------------------------------
    // Step 4: Generate image via Hugging Face (FLUX.1-schnell).
    // ------------------------------------------------------------------
    const { width, height } = parseSize(size ?? '1280x720');
    const imageData = await generateImageWithHF(imagePrompt, width, height);

    return res.status(200).json({
      imageData,
      prompt: imagePrompt,
      koreanDescription,
      modelUsed,
    });

  } catch (error) {
    console.error('[generate] Unhandled error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
