/**
 * GET /api/free-models
 *
 * Fetches the full model catalog from OpenRouter and returns only the free
 * models (prompt price === '0' AND completion price === '0').
 *
 * Authentication: OPENROUTER_API_KEY environment variable (never hardcoded).
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * Fetch and filter free models from OpenRouter.
 * @returns {Promise<Object[]>} Array of free model objects.
 */
async function fetchFreeModels() {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`OpenRouter models fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const allModels = data.data ?? [];

  // Filter to models where both prompt and completion are free (priced at '0').
  const freeModels = allModels.filter(
    (model) =>
      model.pricing?.prompt === '0' &&
      model.pricing?.completion === '0'
  );

  return freeModels;
}

/**
 * Vercel serverless handler.
 */
export default async function handler(req, res) {
  // Handle CORS preflight.
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const models = await fetchFreeModels();

    // Return a clean, predictable shape for consumers.
    return res.status(200).json({
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        context_length: m.context_length,
        modality: m.modality,
        pricing: m.pricing
      }))
    });
  } catch (error) {
    console.error('[free-models] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
