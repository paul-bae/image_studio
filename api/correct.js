/**
 * POST /api/correct
 *
 * Analyses an existing educational image with a vision model and regenerates
 * an improved version via Pollinations.ai.
 *
 * Flow:
 *   1. Try free vision-capable models from OpenRouter.
 *   2. Fall back to Groq llama-3.2-11b-vision-preview.
 *   3. Parse the JSON analysis to extract an improvedPrompt.
 *   4. Generate the corrected image via Pollinations.ai.
 *
 * Body: { imageBase64, imageName, ratio, size, recordId }
 *   imageBase64 — data URI string, e.g. "data:image/png;base64,..."
 *   size format  — "1280 x 720"
 *
 * If imageBase64 is missing or exceeds 4 MB the endpoint falls back to a
 * generic prompt so a new image can still be produced.
 *
 * Authentication:
 *   OPENROUTER_API_KEY — loaded from process.env (never hardcoded)
 *   GROQ_API_KEY       — loaded from process.env (never hardcoded)
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Maximum accepted base64 payload size (4 MB expressed as character count).
// base64 encoding inflates size ~33 %, so 4 MB binary ≈ 5.5 M characters.
const MAX_BASE64_CHARS = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// OpenRouter helpers
// ---------------------------------------------------------------------------

/**
 * Fetch free vision-capable models from OpenRouter.
 * A model is considered vision-capable when its modality string contains "image".
 * @returns {Promise<Object[]>}
 */
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

/**
 * Call an OpenRouter vision model with an image and a text prompt.
 * Throws on non-2xx so the caller can try the next model.
 * @param {string} modelId
 * @param {string} imageBase64 — data URI string
 * @param {string} textPrompt
 * @returns {Promise<string>} Assistant message content.
 */
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

/**
 * Try free OpenRouter vision models one by one.
 * Returns the first successful result or null.
 * @param {Object[]} models
 * @param {string} imageBase64
 * @param {string} prompt
 * @returns {Promise<{text: string, modelUsed: string}|null>}
 */
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

// ---------------------------------------------------------------------------
// Groq vision fallback
// ---------------------------------------------------------------------------

/**
 * Call Groq's vision model as a fallback.
 * @param {string} imageBase64 — data URI string
 * @param {string} prompt
 * @returns {Promise<{text: string, modelUsed: string}>}
 */
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

// ---------------------------------------------------------------------------
// Image generation via Pollinations.ai
// ---------------------------------------------------------------------------

/**
 * Parse a size string like "1280 x 720" into { width, height }.
 * @param {string} sizeStr
 * @returns {{ width: number, height: number }}
 */
function parseSize(sizeStr) {
  const parts = String(sizeStr)
    .replace(/\s+/g, '')
    .split(/x/i)
    .map(Number);

  const width = parts[0] > 0 ? parts[0] : 1280;
  const height = parts[1] > 0 ? parts[1] : 720;
  return { width, height };
}

/**
 * Build a Pollinations.ai image URL.
 * @param {string} imagePrompt
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
function buildPollinationsUrl(imagePrompt, width, height) {
  const enrichedPrompt = `${imagePrompt}, professional, high quality, educational`;
  const seed = Math.floor(Math.random() * 10000);
  return (
    `https://image.pollinations.ai/prompt/${encodeURIComponent(enrichedPrompt)}` +
    `?width=${width}&height=${height}&nologo=true&enhance=true&seed=${seed}`
  );
}

// ---------------------------------------------------------------------------
// Vision analysis prompt
// ---------------------------------------------------------------------------

const VISION_ANALYSIS_PROMPT =
  'Analyze this educational image and provide:\n' +
  '1. A brief description of the image content\n' +
  '2. Suggestions for making it better as educational material\n' +
  '3. A detailed image generation prompt (in English) for creating an improved version\n\n' +
  'Return as JSON: { "description": "...", "suggestions": "...", "improvedPrompt": "..." }';

/**
 * Safely parse a JSON block that may be embedded inside markdown fences.
 * @param {string} raw
 * @returns {Object|null}
 */
function parseVisionJson(raw) {
  if (!raw) return null;

  // Strip optional markdown code fences.
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract a {...} substring as a last resort.
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
    const { imageBase64, imageName, ratio, size, recordId } = req.body ?? {};

    const { width, height } = parseSize(size ?? '1280 x 720');

    // ------------------------------------------------------------------
    // Guard: validate imageBase64 presence and size.
    // ------------------------------------------------------------------
    const hasValidImage =
      imageBase64 &&
      typeof imageBase64 === 'string' &&
      imageBase64.length <= MAX_BASE64_CHARS;

    if (!hasValidImage) {
      if (imageBase64 && imageBase64.length > MAX_BASE64_CHARS) {
        console.warn('[correct] imageBase64 exceeds 4 MB — using fallback prompt');
      } else {
        console.warn('[correct] imageBase64 missing — using fallback prompt');
      }
    }

    // ------------------------------------------------------------------
    // Step 1 & 2: Attempt vision analysis if we have a valid image.
    // ------------------------------------------------------------------
    let improvedPrompt = null;
    let correctionNotes = '';
    let modelUsed = 'none';

    if (hasValidImage) {
      // Try free OpenRouter vision models first.
      let visionModels = [];
      try {
        visionModels = await fetchFreeVisionModels();
        console.log(`[correct] Found ${visionModels.length} free vision models`);
      } catch (e) {
        console.warn('[correct] Could not fetch vision models:', e.message);
      }

      let visionResult = null;

      if (visionModels.length > 0) {
        visionResult = await tryVisionModels(
          visionModels,
          imageBase64,
          VISION_ANALYSIS_PROMPT
        );
        if (visionResult) {
          console.log(`[correct] Used OpenRouter vision model: ${visionResult.modelUsed}`);
          modelUsed = `openrouter/${visionResult.modelUsed}`;
        }
      }

      // Fall back to Groq vision if OpenRouter produced nothing.
      if (!visionResult) {
        console.log('[correct] OpenRouter vision exhausted — falling back to Groq vision');
        try {
          visionResult = await callGroqVision(imageBase64, VISION_ANALYSIS_PROMPT);
          console.log(`[correct] Used Groq vision: ${visionResult.modelUsed}`);
          modelUsed = visionResult.modelUsed;
        } catch (e) {
          console.error('[correct] Groq vision also failed:', e.message);
        }
      }

      // ------------------------------------------------------------------
      // Step 3: Parse vision analysis JSON.
      // ------------------------------------------------------------------
      if (visionResult?.text) {
        const parsed = parseVisionJson(visionResult.text);
        if (parsed) {
          improvedPrompt = parsed.improvedPrompt ?? null;
          correctionNotes =
            [parsed.description, parsed.suggestions]
              .filter(Boolean)
              .join(' | ');
        } else {
          // The model returned something but not valid JSON — use raw text as notes.
          correctionNotes = visionResult.text;
        }
      }
    }

    // ------------------------------------------------------------------
    // Step 4: Resolve the final image prompt.
    // ------------------------------------------------------------------
    const finalPrompt =
      improvedPrompt?.trim() ||
      `Professional educational image, ${ratio ?? '16:9'} aspect ratio, modern design, clean and bright`;

    // ------------------------------------------------------------------
    // Step 5: Generate corrected image via Pollinations.ai.
    // ------------------------------------------------------------------
    const correctedImageUrl = buildPollinationsUrl(finalPrompt, width, height);

    console.log(`[correct] Corrected image URL built (${width}x${height})`);

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
