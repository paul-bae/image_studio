/**
 * POST /api/autofill
 *
 * Generates Korean educational image metadata from a keyword.
 * Uses process.env for API keys (Vercel environment variables).
 *
 * Body:     { keyword: string }
 * Response: { imageName, targetAudience, imageConcept, detailedContent, imageRatio, imageSize }
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT_URL   = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_CHAT_URL         = 'https://api.groq.com/openai/v1/chat/completions';

// BUG-7 fix: 개별 OpenRouter 호출 타임아웃 (8초)
const MODEL_TIMEOUT_MS = 8_000;

async function fetchFreeTextModels() {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`OpenRouter models fetch ${res.status}`);
  const { data = [] } = await res.json();
  return data.filter(m => {
    const isFree = m.pricing?.prompt === '0' && m.pricing?.completion === '0';
    const isText = (typeof m.modality === 'string' && m.modality.includes('text')) ||
                   (m.context_length != null && m.context_length > 0);
    return isFree && isText;
  });
}

async function callOpenRouter(modelId, prompt) {
  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    // BUG-7 fix: 타임아웃 추가
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://prototype-05.vercel.app',
      'X-Title': 'Prototype-05 AutoFill',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
    }),
  });
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? null;
  if (!text) throw new Error('empty response');
  return text;
}

// BUG-5 fix: 배치 내 병렬 호출 (Promise.any)
async function tryModelsInBatches(models, prompt) {
  for (let i = 0; i < models.length; i += 10) {
    const batch = models.slice(i, i + 10);
    try {
      const text = await Promise.any(
        batch.map(m => callOpenRouter(m.id, prompt))
      );
      if (text) return text;
    } catch { /* 배치 전체 실패 → 다음 배치 */ }
  }
  return null;
}

async function callGroq(prompt) {
  const models = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama3-70b-8192'];
  for (const model of models) {
    try {
      const res = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 600,
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) return text;
    } catch { continue; }
  }
  throw new Error('All Groq models failed');
}

function buildPrompt(keyword) {
  return (
    'You are an expert at creating Korean educational image metadata.\n' +
    'Given the keyword below, generate content and return a JSON object with exactly these fields:\n' +
    '  "imageName": Korean title for the educational image (50 Korean characters or less)\n' +
    '  "targetAudience": Korean description of the application field (100–200 Korean characters)\n' +
    '  "imageConcept": Korean description of the visual concept/theme (100–200 Korean characters)\n' +
    '  "detailedContent": Korean description of the detailed scene/content (100–200 Korean characters)\n' +
    '  "imageRatio": choose the most appropriate from "4:3", "5:4", "16:9", "21:9"\n' +
    '  "imageSize": choose the most appropriate from "520x292", "1280x720"\n' +
    'Return ONLY the raw JSON object — no markdown fences, no extra text.\n\n' +
    `Keyword: ${keyword}`
  );
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { keyword } = req.body ?? {};
  if (!keyword?.trim()) return res.status(400).json({ error: 'keyword is required' });

  // BUG-4 fix: 환경변수 미설정 조기 감지
  if (!process.env.OPENROUTER_API_KEY && !process.env.GROQ_API_KEY) {
    return res.status(503).json({
      error: 'API 키가 서버에 설정되지 않았습니다. Vercel 환경변수(OPENROUTER_API_KEY, GROQ_API_KEY)를 확인하세요.',
    });
  }

  try {
    const prompt = buildPrompt(keyword.trim());
    let rawText = null;

    if (process.env.OPENROUTER_API_KEY) {
      try {
        const models = await fetchFreeTextModels();
        console.log(`[autofill] Free text models: ${models.length}`);
        rawText = await tryModelsInBatches(models, prompt);
      } catch (e) {
        console.warn('[autofill] OpenRouter error:', e.message);
      }
    }

    if (!rawText && process.env.GROQ_API_KEY) {
      console.log('[autofill] OpenRouter 소진 → Groq 폴백');
      rawText = await callGroq(prompt);
    }

    if (!rawText) throw new Error('사용 가능한 LLM 모델이 없습니다');

    const match = rawText.trim().match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM이 유효한 JSON을 반환하지 않았습니다');
    const data = JSON.parse(match[0]);

    return res.status(200).json(data);
  } catch (err) {
    console.error('[autofill]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
