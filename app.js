/**
 * AI 이미지 스튜디오 — app.js
 * 탭 구조 (이미지 생성 / 이미지 보정) + 저장·수정·이미지 생성 플로우
 */

'use strict';

/* ============================================================
   1. SUPABASE INIT
   ============================================================ */
const SUPABASE_URL      = 'https://mcshhvttsvfurrkpcbdf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jc2hodnR0c3ZmdXJya3BjYmRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5ODI5MDgsImV4cCI6MjA4OTU1ODkwOH0.FRlSXHknfnYoZ4i4-_up8QvppoKHGo50koK9yDkXPUQ';

let supabaseClient = null;
try {
  supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) ?? null;
} catch (e) {
  console.warn('[Supabase] 수정 실패 — DB 저장 비활성화:', e.message);
}

/* ============================================================
   2. DOM REFERENCES
   ============================================================ */
const tabBtnGenerate = document.getElementById('tab-btn-generate');
const tabBtnCorrect  = document.getElementById('tab-btn-correct');
const tabGenerate    = document.getElementById('tab-generate');
const tabCorrect     = document.getElementById('tab-correct');

const generateForm         = document.getElementById('generate-form');
const courseNameEl         = document.getElementById('course-name');
const targetAudienceEl     = document.getElementById('target-audience');
const learningObjectivesEl = document.getElementById('learning-objectives');
const detailedContentEl    = document.getElementById('detailed-content');
const genRatioEl           = document.getElementById('gen-ratio');
const genSizeEl            = document.getElementById('gen-size');
const genSaveStatusEl      = document.getElementById('gen-save-status');
const btnGenSave           = document.getElementById('btn-gen-save');
const btnGenEdit           = document.getElementById('btn-gen-edit');
const btnGenerate          = document.getElementById('btn-generate');

const correctForm       = document.getElementById('correct-form');
const fileInput         = document.getElementById('correct-file-input');
const dropZone          = document.getElementById('drop-zone');
const previewContainer  = document.getElementById('preview-container');
const previewImage      = document.getElementById('preview-image');
const btnClearFile      = document.getElementById('btn-clear-file');
const corRatioEl        = document.getElementById('cor-ratio');
const corSizeEl         = document.getElementById('cor-size');
const corSaveStatusEl   = document.getElementById('cor-save-status');
const btnCorSave        = document.getElementById('btn-cor-save');
const btnCorEdit        = document.getElementById('btn-cor-edit');
const btnCorrect        = document.getElementById('btn-correct');

const rightPlaceholder   = document.getElementById('right-placeholder');
const rightLoading       = document.getElementById('right-loading');
const rightCurrentModel  = document.getElementById('right-current-model');
const rightError         = document.getElementById('right-error');
const rightImageArea     = document.getElementById('right-image-area');
const rightImage         = document.getElementById('right-image');
const rightModelUsed     = document.getElementById('right-model-used');
const rightPromptDisplay = document.getElementById('right-prompt-display');
const rightPromptText    = document.getElementById('right-prompt-text');
const rightNotesDisplay  = document.getElementById('right-notes-display');
const rightNotesText     = document.getElementById('right-notes-text');
const rightImageInfo     = document.getElementById('right-image-info');
const rightImageDims     = document.getElementById('right-image-dims');
const btnDownload        = document.getElementById('btn-download');

/* ============================================================
   3. CHAR COUNTER
   ============================================================ */
function setupCharCounter(el, counterId, max) {
  const counter   = document.getElementById(counterId);
  const currentEl = counter.querySelector('.char-current');
  function update() {
    const len = el.value.length;
    currentEl.textContent = len.toLocaleString('ko-KR');
    const ratio = len / max;
    counter.classList.toggle('near-limit', ratio >= 0.85 && ratio < 1);
    counter.classList.toggle('at-limit',   ratio >= 1);
  }
  el.addEventListener('input', update);
  update();
}

setupCharCounter(courseNameEl,         'course-name-counter',          200);
setupCharCounter(targetAudienceEl,     'target-audience-counter',     2000);
setupCharCounter(learningObjectivesEl, 'learning-objectives-counter', 2000);
setupCharCounter(detailedContentEl,    'detailed-content-counter',    2000);

/* ============================================================
   4. TAB SWITCHING
   ============================================================ */
function restoreRightState(state) {
  if (state) {
    showRightImage(state.src, state.modelUsed, {
      prompt: state.prompt || '',
      notes:  state.notes  || '',
    });
    btnDownload.onclick = () => downloadImage(state.src, `image_${Date.now()}.png`);
  } else {
    hideEl(rightLoading);
    hideEl(rightError);
    hideEl(rightImageArea);
    showEl(rightPlaceholder);
  }
}

function switchTab(tabName) {
  if (tabName === 'generate') {
    tabBtnGenerate.classList.add('tab-active');
    tabBtnCorrect.classList.remove('tab-active');
    tabBtnGenerate.setAttribute('aria-selected', 'true');
    tabBtnCorrect.setAttribute('aria-selected', 'false');
    tabGenerate.hidden = false;
    tabCorrect.hidden  = true;
    restoreRightState(genRightState);
  } else {
    tabBtnCorrect.classList.add('tab-active');
    tabBtnGenerate.classList.remove('tab-active');
    tabBtnCorrect.setAttribute('aria-selected', 'true');
    tabBtnGenerate.setAttribute('aria-selected', 'false');
    tabCorrect.hidden  = false;
    tabGenerate.hidden = true;
    restoreRightState(corRightState);
  }
}

tabBtnGenerate.addEventListener('click', () => switchTab('generate'));
tabBtnCorrect.addEventListener('click',  () => switchTab('correct'));

generateForm.addEventListener('submit', (e) => e.preventDefault());
correctForm.addEventListener('submit',  (e) => e.preventDefault());

courseNameEl.addEventListener('input', () => {
  if (!genSaved) setEnabled(btnGenerate, !!courseNameEl.value.trim());
});

/* ============================================================
   5. DROP-ZONE & FILE PREVIEW
   ============================================================ */
let selectedFile = null;

dropZone.addEventListener('click',   () => { if (!dropZone.classList.contains('locked')) fileInput.click(); });
dropZone.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && !dropZone.classList.contains('locked')) {
    e.preventDefault();
    fileInput.click();
  }
});
dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); if (!dropZone.classList.contains('locked')) dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); if (!dropZone.classList.contains('locked')) dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (dropZone.classList.contains('locked')) return;
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleFileSelected(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFileSelected(fileInput.files[0]);
});
btnClearFile.addEventListener('click', clearSelectedFile);

function handleFileSelected(file) {
  selectedFile = file;
  const url = URL.createObjectURL(file);
  previewImage.src = url;
  previewContainer.hidden = false;
  dropZone.hidden = true;
  if (corSaved && corPayload?.file === null) {
    corPayload = { ...corPayload, file };
    setEnabled(btnCorrect, true);
  } else if (corSaved) {
    resetCorSaveState();
    setEnabled(btnCorrect, true);
  } else {
    setEnabled(btnCorrect, true);
  }
}

function clearSelectedFile() {
  selectedFile = null;
  URL.revokeObjectURL(previewImage.src);
  previewImage.src = '';
  previewContainer.hidden = true;
  dropZone.hidden = false;
  fileInput.value = '';
  if (corSaved) resetCorSaveState();
  setEnabled(btnCorrect, false);
}

/* ============================================================
   6. UI STATE HELPERS
   ============================================================ */
function showEl(el) { el.hidden = false; }
function hideEl(el) { el.hidden = true; }

function setEnabled(btn, enabled) {
  btn.disabled = !enabled;
  btn.setAttribute('aria-disabled', String(!enabled));
}

function setBusy(btn, busy) {
  btn.disabled = busy;
  btn.setAttribute('aria-disabled', String(busy));
}

function showRightLoading(modelName) {
  hideEl(rightPlaceholder);
  showEl(rightLoading);
  hideEl(rightError);
  hideEl(rightImageArea);
  rightCurrentModel.textContent = modelName || '이미지 생성 중...';
}

function showRightError(message) {
  hideEl(rightPlaceholder);
  hideEl(rightLoading);
  showEl(rightError);
  hideEl(rightImageArea);
  rightError.textContent = message;
}

function guessRatio(w, h) {
  const r = w / h;
  if (Math.abs(r - 21 / 9)  < 0.05) return '21:9';
  if (Math.abs(r - 16 / 9)  < 0.05) return '16:9';
  if (Math.abs(r - 5  / 4)  < 0.02) return '5:4';
  if (Math.abs(r - 4  / 3)  < 0.02) return '4:3';
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

function showRightImage(src, modelUsed, { prompt = '', notes = '' } = {}) {
  hideEl(rightPlaceholder);
  hideEl(rightLoading);
  hideEl(rightError);
  hideEl(rightImageInfo);

  rightImage.onerror = () => {
    hideEl(rightImageArea);
    hideEl(rightImageInfo);
    showRightError('이전 이미지를 불러올 수 없습니다. 이미지 생성 버튼을 눌러 새로 생성해 주세요.');
    rightImage.onerror = null;
    rightImage.onload  = null;
  };
  rightImage.onload = () => {
    const w = rightImage.naturalWidth;
    const h = rightImage.naturalHeight;
    if (w && h) {
      rightImageDims.textContent = `참고 규격: ${w} × ${h} px (${guessRatio(w, h)})`;
      showEl(rightImageInfo);
    }
    rightImage.onload = null;
  };
  rightImage.src = src;
  rightModelUsed.textContent = modelUsed || '—';

  if (prompt) {
    rightPromptText.textContent = prompt;
    showEl(rightPromptDisplay);
  } else {
    hideEl(rightPromptDisplay);
  }

  if (notes) {
    rightNotesText.textContent = notes;
    showEl(rightNotesDisplay);
  } else {
    hideEl(rightNotesDisplay);
  }

  showEl(rightImageArea);
}

function showSaveStatus(el, type, message) {
  el.textContent = message;
  el.className = `save-status save-status-${type}`;
  el.hidden = false;
}

function hideSaveStatus(el) {
  el.hidden = true;
  el.className = 'save-status';
}

function setGenFormLocked(locked) {
  [courseNameEl, targetAudienceEl, learningObjectivesEl, detailedContentEl, genRatioEl, genSizeEl]
    .forEach(el => { el.disabled = locked; });
  setEnabled(btnGenSave, !locked);
}

function setCorFormLocked(locked) {
  [corRatioEl, corSizeEl].forEach(el => { el.disabled = locked; });
  if (locked) {
    dropZone.classList.add('locked');
    dropZone.style.opacity = '0.6';
    dropZone.style.cursor  = 'default';
    btnClearFile.disabled  = true;
  } else {
    dropZone.classList.remove('locked');
    dropZone.style.opacity = '';
    dropZone.style.cursor  = '';
    btnClearFile.disabled  = false;
  }
  setEnabled(btnCorSave, !locked);
}

/* ============================================================
   7. CLIENT-SIDE API — LLM + IMAGE GENERATION
   ============================================================ */

function getConfig() {
  const cfg = window.APP_CONFIG ?? {};
  return {
    openrouterKey: cfg.OPENROUTER_API_KEY ?? '',
    groqKey:       cfg.GROQ_API_KEY       ?? '',
    hfToken:       cfg.HF_TOKEN           ?? '',
  };
}

async function fetchFreeTextModels(apiKey) {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.data ?? []).filter(m => {
    const isFree = m.pricing?.prompt === '0' && m.pricing?.completion === '0';
    const isText = (typeof m.modality === 'string' && m.modality.includes('text')) ||
                   (m.context_length != null && m.context_length > 0);
    return isFree && isText;
  });
}

async function callOpenRouterText(modelId, prompt, apiKey) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://prototype-05.vercel.app',
      'X-Title': 'Prototype-05 Image Generator'
    },
    body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: prompt }], max_tokens: 500 })
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function tryTextModels(models, prompt, apiKey) {
  for (let i = 0; i < models.length; i += 10) {
    for (const model of models.slice(i, i + 10)) {
      try {
        const text = await callOpenRouterText(model.id, prompt, apiKey);
        if (text) return { text, modelUsed: model.id };
      } catch (e) {
        console.warn(`[generate] model ${model.id} failed:`, e.message);
      }
    }
  }
  return null;
}

async function callGroqText(prompt, apiKey) {
  for (const model of ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama3-70b-8192']) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 500 })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) return { text, modelUsed: `groq/${model}` };
    } catch { continue; }
  }
  throw new Error('LLM 모델 모두 실패');
}

function snapDim(n) {
  return Math.min(1280, Math.max(256, Math.round(n / 8) * 8));
}

async function generateImageWithHF(prompt, width, height, hfToken) {
  if (!hfToken) throw new Error('HF_TOKEN이 config.js에 설정되지 않았습니다');
  const w = snapDim(width), h = snapDim(height);
  console.log(`[HF] FLUX.1-schnell — ${w}x${h}`);

  const res = await fetch(
    'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json', 'x-use-cache': 'false' },
      body: JSON.stringify({
        inputs: `${prompt}, professional, high quality, clean educational banner, no text, no letters, no words, no typography, no captions`,
        parameters: { width: w, height: h, num_inference_steps: 4 },
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403) throw new Error('HF 토큰 권한 부족 — Fine-grained 토큰 (Inference Providers 권한) 이 필요합니다');
    throw new Error(`HF API ${res.status}: ${errText.substring(0, 120)}`);
  }

  const buffer = await res.arrayBuffer();
  const bytes  = new Uint8Array(buffer);
  let binary   = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  console.log(`[HF] generated: ${Math.round(buffer.byteLength / 1024)} KB`);
  return `data:${contentType};base64,${btoa(binary)}`;
}

function buildGeneratePrompt({ courseName, targetAudience, objectives, content, ratio }) {
  return (
    'You are an expert at creating image generation prompts for educational content.\n' +
    'Return a JSON object with exactly two fields:\n' +
    '  "prompt": A detailed English image generation prompt for a professional educational course banner.\n' +
    '  "description": A concise Korean description (2-3 sentences) of what the generated image will look like.\n' +
    'The prompt should produce a visually appealing, modern, professional educational banner.\n' +
    'IMPORTANT: The image must contain NO text, no letters, no words, no numbers, no captions — purely visual elements only.\n' +
    'Return ONLY the raw JSON object — no markdown fences, no extra text.\n\n' +
    `Course: ${courseName}\nTarget Audience: ${targetAudience}\nObjectives: ${objectives}\nContent: ${content}\nAspect Ratio: ${ratio}`
  );
}

function parseSizeStr(sizeStr) {
  const parts = String(sizeStr).replace(/\s+/g, '').split(/x/i).map(Number);
  return { width: parts[0] > 0 ? parts[0] : 1280, height: parts[1] > 0 ? parts[1] : 720 };
}

async function callGenerate({ courseName, targetAudience, objectives, content, ratio, size }) {
  const { openrouterKey, groqKey, hfToken } = getConfig();

  const llmPrompt = buildGeneratePrompt({
    courseName: courseName ?? '', targetAudience: targetAudience ?? '',
    objectives: objectives ?? '', content: content ?? '', ratio: ratio ?? '16:9',
  });

  let rawText, modelUsed;
  let orResult = null;
  if (openrouterKey) {
    try {
      const models = await fetchFreeTextModels(openrouterKey);
      console.log(`[generate] Free text models: ${models.length}`);
      orResult = await tryTextModels(models, llmPrompt, openrouterKey);
    } catch (e) { console.warn('[generate] OpenRouter error:', e.message); }
  }

  if (orResult) {
    rawText = orResult.text.trim();
    modelUsed = `openrouter/${orResult.modelUsed}`;
  } else {
    console.log('[generate] OpenRouter 소진 → Groq 폴백');
    const groqResult = await callGroqText(llmPrompt, groqKey);
    rawText = groqResult.text.trim();
    modelUsed = groqResult.modelUsed;
  }

  let imagePrompt = rawText, koreanDescription = null;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.prompt) { imagePrompt = parsed.prompt.trim(); koreanDescription = parsed.description?.trim() || null; }
    }
  } catch { /* raw text 그대로 사용 */ }

  const { width, height } = parseSizeStr(size ?? '1280x720');
  const imageData = await generateImageWithHF(imagePrompt, width, height, hfToken);
  return { imageData, prompt: imagePrompt, koreanDescription, modelUsed };
}

async function fetchFreeVisionModels(apiKey) {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.data ?? []).filter(m => {
    const isFree = m.pricing?.prompt === '0' && m.pricing?.completion === '0';
    const isVision = typeof m.modality === 'string' && m.modality.includes('image');
    return isFree && isVision;
  });
}

async function callOpenRouterVision(modelId, imageBase64, textPrompt, apiKey) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://prototype-05.vercel.app',
      'X-Title': 'Prototype-05 Image Corrector'
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: [
        { type: 'text', text: textPrompt },
        { type: 'image_url', image_url: { url: imageBase64 } }
      ]}],
      max_tokens: 800
    })
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function tryVisionModels(models, imageBase64, prompt, apiKey) {
  for (const model of models) {
    try {
      const text = await callOpenRouterVision(model.id, imageBase64, prompt, apiKey);
      if (text) return { text, modelUsed: model.id };
    } catch (e) { console.warn(`[correct] vision model ${model.id} failed:`, e.message); }
  }
  return null;
}

async function callGroqVision(imageBase64, prompt, apiKey) {
  const GROQ_VISION_MODELS = [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'llama-3.2-90b-vision-preview',
    'llama-3.2-11b-vision-preview',
  ];
  for (const model of GROQ_VISION_MODELS) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageBase64 } }
          ]}],
          max_tokens: 800
        })
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[correct] Groq vision ${model} → ${res.status}:`, errText.substring(0, 120));
        continue;
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) return { text, modelUsed: `groq/${model}` };
    } catch (e) {
      console.warn(`[correct] Groq vision ${model} exception:`, e.message);
    }
  }
  throw new Error('All Groq vision models failed');
}

function resizeForVision(dataUrl, maxDim = 1024) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      if (scale >= 1) { resolve(dataUrl); return; }
      const w = Math.round(img.naturalWidth  * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function parseVisionJson(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

async function callCorrect({ imageBase64, imageName, ratio, size }) {
  const { openrouterKey, groqKey, hfToken } = getConfig();
  const { width, height } = parseSizeStr(size ?? '1280x720');

  const MAX_BASE64_CHARS = 4 * 1024 * 1024;
  const hasValidImage = imageBase64 && typeof imageBase64 === 'string' && imageBase64.length <= MAX_BASE64_CHARS;

  const VISION_PROMPT =
    'Analyze this educational image and provide the following in Korean:\n' +
    '1. "description": 이미지 내용에 대한 간략한 한국어 설명\n' +
    '2. "suggestions": 교육 자료로 개선할 수 있는 한국어 제안사항\n' +
    '3. "improvedPrompt": 개선된 이미지를 생성하기 위한 상세한 영어 프롬프트 (English only)\n\n' +
    'Return ONLY a raw JSON object (no markdown fences): { "description": "한국어...", "suggestions": "한국어...", "improvedPrompt": "English..." }';

  let improvedPrompt = null, correctionNotes = '', modelUsed = 'none';

  if (hasValidImage) {
    const visionImage = await resizeForVision(imageBase64);
    console.log(`[correct] vision image size: ${Math.round(visionImage.length / 1024)} KB (after resize)`);

    let visionResult = null;
    if (openrouterKey) {
      try {
        const visionModels = await fetchFreeVisionModels(openrouterKey);
        console.log(`[correct] Free vision models: ${visionModels.length}`);
        visionResult = await tryVisionModels(visionModels, visionImage, VISION_PROMPT, openrouterKey);
        if (visionResult) modelUsed = `openrouter/${visionResult.modelUsed}`;
      } catch (e) { console.warn('[correct] OpenRouter vision error:', e.message); }
    }
    if (!visionResult) {
      console.log('[correct] Groq vision 폴백');
      try {
        visionResult = await callGroqVision(visionImage, VISION_PROMPT, groqKey);
        if (visionResult) modelUsed = visionResult.modelUsed;
      } catch (e) { console.error('[correct] Groq vision 전체 실패:', e.message); }
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

  const finalPrompt = improvedPrompt?.trim() ||
    `Professional educational image, ${ratio ?? '16:9'} aspect ratio, modern design, clean and bright`;

  const correctedImageData = await generateImageWithHF(finalPrompt, width, height, hfToken);
  return { correctedImageData, correctionNotes: correctionNotes || '이미지 분석 없이 기본 프롬프트로 재생성되었습니다.', modelUsed };
}

/* ============================================================
   8. SUPABASE HELPERS  (null-safe)
   ============================================================ */
async function insertGenRecord(data) {
  if (!supabaseClient) return null;
  const { data: record, error } = await supabaseClient
    .from('image_generations')
    .insert([data])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return record;
}

async function updateGenRecord(id, updates) {
  if (!supabaseClient || !id) return;
  const { error } = await supabaseClient.from('image_generations').update(updates).eq('id', id);
  if (error) console.warn('[updateGenRecord]', error.message);
}

async function insertCorRecord(data) {
  if (!supabaseClient) return null;
  const { data: record, error } = await supabaseClient
    .from('image_corrections')
    .insert([data])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return record;
}

async function uploadDataUrlToStorage(dataUrl, bucket, path) {
  const res  = await fetch(dataUrl);
  const blob = await res.blob();
  const { error } = await supabaseClient.storage
    .from(bucket)
    .upload(path, blob, { upsert: true, contentType: blob.type });
  if (error) throw new Error(error.message);
  const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function uploadOriginalImage(file, recordId) {
  const ext  = file.name.split('.').pop() || 'jpg';
  const path = `${recordId}.${ext}`;
  const { error } = await supabaseClient.storage
    .from('correction-images')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new Error(error.message);
  const { data } = supabaseClient.storage.from('correction-images').getPublicUrl(path);
  return data.publicUrl;
}

async function updateCorRecord(id, updates) {
  if (!supabaseClient || !id) return;
  const { error } = await supabaseClient.from('image_corrections').update(updates).eq('id', id);
  if (error) console.warn('[updateCorRecord]', error.message);
}

/* ============================================================
   9. CANVAS HELPERS — RESIZE & COMPRESS
   ============================================================ */
function resizeImageWithCanvas(srcUrl, targetW, targetH) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas  = document.createElement('canvas');
      canvas.width  = targetW;
      canvas.height = targetH;
      const ctx     = canvas.getContext('2d');
      const scaleX  = targetW / img.naturalWidth;
      const scaleY  = targetH / img.naturalHeight;
      const scale   = Math.max(scaleX, scaleY);
      const scaledW = img.naturalWidth  * scale;
      const scaledH = img.naturalHeight * scale;
      const offsetX = (targetW - scaledW) / 2;
      const offsetY = (targetH - scaledH) / 2;
      ctx.drawImage(img, offsetX, offsetY, scaledW, scaledH);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('이미지 로딩 실패'));
    img.src = srcUrl;
  });
}

function parseSize(sizeStr) {
  const [w, h] = String(sizeStr).split('x').map(Number);
  return { w: w || 1280, h: h || 720 };
}

/* ============================================================
   10. BASE64 & DOWNLOAD
   ============================================================ */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

async function downloadImage(src, filename = 'image.png') {
  try {
    let blob;
    if (src.startsWith('data:')) {
      blob = await (await fetch(src)).blob();
    } else {
      const res = await fetch(src).catch(() => null);
      if (res && res.ok) {
        blob = await res.blob();
      } else {
        window.open(src, '_blank', 'noopener');
        return;
      }
    }

    if (window.showSaveFilePicker) {
      const ext  = filename.split('.').pop().toLowerCase();
      const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext]
                   || blob.type || 'image/png';
      const handle   = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: `${ext.toUpperCase()} 이미지`, accept: { [mime]: [`.${ext}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }

    const href = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = href;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch (err) {
    if (err.name === 'AbortError') return;
    alert(`다운로드 실패: ${err.message}`);
  }
}

/* ============================================================
   11. 이미지 생성 — 저장 / 수정 / 이미지 생성
   ============================================================ */
let genRightState = null;
let corRightState = null;

let genSaved    = false;
let genPayload  = null;
let genRecordId = null;

function resetGenSaveState() {
  genSaved    = false;
  genPayload  = null;
  genRecordId = null;
  setGenFormLocked(false);
  setEnabled(btnGenEdit, false);
  setEnabled(btnGenerate, !!courseNameEl.value.trim());
  hideSaveStatus(genSaveStatusEl);
}

btnGenSave.addEventListener('click', () => {
  const courseName = courseNameEl.value.trim();
  if (!courseName) {
    showSaveStatus(genSaveStatusEl, 'error', '⚠ 이미지 명칭은 필수 입력 항목입니다.');
    courseNameEl.focus();
    return;
  }

  genPayload = {
    courseName,
    targetAudience:     targetAudienceEl.value.trim(),
    learningObjectives: learningObjectivesEl.value.trim(),
    detailedContent:    detailedContentEl.value.trim(),
    imageRatio:         genRatioEl.value,
    imageSize:          genSizeEl.value,
  };

  setGenFormLocked(true);
  genSaved = true;
  showSaveStatus(genSaveStatusEl, 'saved', `✓ 저장 완료 — ${courseName}`);
  setEnabled(btnGenEdit, true);
  setEnabled(btnGenerate, true);

  insertGenRecord({
    course_name:         genPayload.courseName,
    target_audience:     genPayload.targetAudience,
    learning_objectives: genPayload.learningObjectives,
    detailed_content:    genPayload.detailedContent,
    image_ratio:         genPayload.imageRatio,
    image_size:          genPayload.imageSize,
  }).then(record => {
    if (record?.id) genRecordId = record.id;
  }).catch(err => console.warn('[Supabase] gen 저장 실패:', err.message));
});

btnGenEdit.addEventListener('click', () => {
  resetGenSaveState();
});

btnGenerate.addEventListener('click', async () => {
  const courseName = genPayload?.courseName ?? courseNameEl.value.trim();
  if (!courseName) return;

  const payload = genPayload ?? {
    courseName,
    targetAudience:     targetAudienceEl.value.trim(),
    learningObjectives: learningObjectivesEl.value.trim(),
    detailedContent:    detailedContentEl.value.trim(),
    imageRatio:         genRatioEl.value,
    imageSize:          genSizeEl.value,
  };

  showRightLoading('이미지 생성 중...');
  setBusy(btnGenerate, true);
  setBusy(btnGenEdit,  true);

  try {
    const result = await callGenerate({
      courseName:     payload.courseName,
      targetAudience: payload.targetAudience,
      objectives:     payload.learningObjectives,
      content:        payload.detailedContent,
      ratio:          payload.imageRatio,
      size:           payload.imageSize,
    });

    const { imageData, prompt, koreanDescription, modelUsed } = result;
    const finalSrc      = imageData;
    const displayPrompt = koreanDescription || prompt;

    genRightState = { src: finalSrc, modelUsed, prompt: displayPrompt };
    showRightImage(finalSrc, modelUsed, { prompt: displayPrompt });
    btnDownload.onclick = () => downloadImage(finalSrc, `generated_${Date.now()}.jpg`);

    if (genRecordId && supabaseClient) {
      const snapId     = genRecordId;
      const snapSrc    = finalSrc;
      const snapPrompt = prompt || '';
      (async () => {
        try {
          const ext = snapSrc.split(';')[0].split('/')[1] || 'jpg';
          const url = await uploadDataUrlToStorage(snapSrc, 'generated-images', `${snapId}.${ext}`);
          await updateGenRecord(snapId, { image_url: url, ai_prompt: snapPrompt });
        } catch (e) {
          console.warn('[Storage] 생성 이미지 업로드 실패:', e.message);
          updateGenRecord(snapId, { ai_prompt: snapPrompt });
        }
      })();
    }

  } catch (err) {
    console.error('[generate]', err);
    showRightError(`이미지 생성 실패: ${err.message}`);
  } finally {
    setBusy(btnGenerate, false);
    setBusy(btnGenEdit,  false);
  }
});

/* ============================================================
   12. 이미지 보정 — 저장 / 수정 / 이미지 생성
   ============================================================ */
let corSaved    = false;
let corPayload  = null;
let corRecordId = null;

function resetCorSaveState() {
  corSaved    = false;
  corPayload  = null;
  corRecordId = null;
  setCorFormLocked(false);
  setEnabled(btnCorEdit, false);
  setEnabled(btnCorrect, selectedFile !== null);
  hideSaveStatus(corSaveStatusEl);
}

btnCorSave.addEventListener('click', () => {
  if (!selectedFile) {
    showSaveStatus(corSaveStatusEl, 'error', '⚠ 보정할 이미지를 선택해 주세요.');
    return;
  }

  corPayload = {
    file:       selectedFile,
    imageRatio: corRatioEl.value,
    imageSize:  corSizeEl.value,
  };

  setCorFormLocked(true);
  corSaved = true;
  showSaveStatus(corSaveStatusEl, 'saved', `✓ 저장 완료 — ${selectedFile.name}`);
  setEnabled(btnCorEdit, true);
  setEnabled(btnCorrect, true);

  const fileSnapshot = selectedFile;
  insertCorRecord({
    original_image_name: fileSnapshot.name,
    image_ratio:         corPayload.imageRatio,
    image_size:          corPayload.imageSize,
  }).then(async record => {
    if (!record?.id) return;
    corRecordId = record.id;
    if (supabaseClient) {
      try {
        const url = await uploadOriginalImage(fileSnapshot, record.id);
        await updateCorRecord(record.id, { original_image_url: url });
      } catch (e) {
        console.warn('[Storage] 원본 이미지 업로드 실패:', e.message);
      }
    }
  }).catch(err => console.warn('[Supabase] cor 저장 실패:', err.message));
});

btnCorEdit.addEventListener('click', () => {
  resetCorSaveState();
});

btnCorrect.addEventListener('click', async () => {
  const file       = corPayload?.file       ?? selectedFile;
  const imageRatio = corPayload?.imageRatio ?? corRatioEl.value;
  const imageSize  = corPayload?.imageSize  ?? corSizeEl.value;
  if (!file) return;

  showRightLoading('이미지 분석 중...');
  setBusy(btnCorrect, true);
  setBusy(btnCorEdit, true);

  try {
    const imageBase64 = await fileToBase64(file);

    const result = await callCorrect({
      imageBase64,
      imageName: file.name,
      ratio:     imageRatio,
      size:      imageSize,
    });

    const { correctedImageData, correctionNotes, modelUsed } = result;
    const finalSrc = correctedImageData;
    corRightState = { src: finalSrc, modelUsed, notes: correctionNotes };
    showRightImage(finalSrc, modelUsed, { notes: correctionNotes });
    btnDownload.onclick = () => downloadImage(finalSrc, `corrected_${Date.now()}.png`);

    if (corRecordId && supabaseClient) {
      const snapId    = corRecordId;
      const snapSrc   = finalSrc;
      const snapNotes = correctionNotes || '';
      (async () => {
        try {
          const ext = snapSrc.split(';')[0].split('/')[1] || 'png';
          const url = await uploadDataUrlToStorage(snapSrc, 'correction-images', `corrected_${snapId}.${ext}`);
          await updateCorRecord(snapId, { corrected_image_url: url, correction_notes: snapNotes });
        } catch (e) {
          console.warn('[Storage] 보정 이미지 업로드 실패:', e.message);
          updateCorRecord(snapId, { correction_notes: snapNotes });
        }
      })();
    }

  } catch (err) {
    console.error('[correct]', err);
    showRightError(`이미지 보정 실패: ${err.message}`);
  } finally {
    setBusy(btnCorrect, false);
    setBusy(btnCorEdit, false);
  }
});

/* ============================================================
   13. 초기 데이터 로드 (페이지 새로고침 후 DB 복원)
   ============================================================ */

async function loadLatestGenRecord() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('image_generations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return;
    const rec = data[0];
    if (!rec.course_name) return;

    genRecordId = rec.id;
    genSaved    = true;
    genPayload  = {
      courseName:         rec.course_name         ?? '',
      targetAudience:     rec.target_audience     ?? '',
      learningObjectives: rec.learning_objectives ?? '',
      detailedContent:    rec.detailed_content    ?? '',
      imageRatio:         rec.image_ratio         ?? '16:9',
      imageSize:          rec.image_size          ?? '1280x720',
    };

    courseNameEl.value         = genPayload.courseName;
    targetAudienceEl.value     = genPayload.targetAudience;
    learningObjectivesEl.value = genPayload.learningObjectives;
    detailedContentEl.value    = genPayload.detailedContent;
    genRatioEl.value           = genPayload.imageRatio;
    genSizeEl.value            = genPayload.imageSize;

    [courseNameEl, targetAudienceEl, learningObjectivesEl, detailedContentEl]
      .forEach(el => el.dispatchEvent(new Event('input')));

    setGenFormLocked(true);
    setEnabled(btnGenEdit,  true);
    setEnabled(btnGenerate, true);
    showSaveStatus(genSaveStatusEl, 'saved', `✓ 불러온 데이터 — ${genPayload.courseName}`);

    if (rec.image_url) {
      genRightState = { src: rec.image_url, modelUsed: '이전 생성 결과', prompt: rec.ai_prompt || '' };
      restoreRightState(genRightState);
    }
  } catch (err) {
    console.warn('[loadLatestGenRecord]', err.message);
  }
}

async function loadLatestCorRecord() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('image_corrections')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return;
    const rec = data[0];
    if (!rec.original_image_name && !rec.image_ratio && !rec.image_size) return;

    corRecordId = rec.id;
    corSaved    = true;
    corPayload  = {
      file:       null,
      imageRatio: rec.image_ratio ?? '16:9',
      imageSize:  rec.image_size  ?? '1280x720',
    };

    corRatioEl.value = corPayload.imageRatio;
    corSizeEl.value  = corPayload.imageSize;

    const label = rec.original_image_name || '이전 이미지';

    if (rec.original_image_url) {
      try {
        const res = await fetch(rec.original_image_url);
        if (res.ok) {
          const blob = await res.blob();
          const ext  = (rec.original_image_name || 'image.jpg').split('.').pop();
          const file = new File([blob], rec.original_image_name || `image.${ext}`, { type: blob.type });
          selectedFile     = file;
          corPayload.file  = file;
          previewImage.src        = URL.createObjectURL(blob);
          previewContainer.hidden = false;
          dropZone.hidden         = true;
        }
      } catch (e) {
        console.warn('[loadLatestCorRecord] 원본 이미지 복원 실패:', e.message);
      }
    }

    corRatioEl.disabled = true;
    corSizeEl.disabled  = true;
    setEnabled(btnCorSave, false);
    setEnabled(btnCorEdit, true);
    setEnabled(btnCorrect, !!corPayload.file);

    showSaveStatus(corSaveStatusEl, 'saved',
      `✓ 불러온 데이터 — ${label} · ${corPayload.imageRatio} · ${corPayload.imageSize}`);

    if (rec.corrected_image_url) {
      corRightState = {
        src:       rec.corrected_image_url,
        modelUsed: '이전 보정 결과',
        notes:     rec.correction_notes || '',
      };
      restoreRightState(corRightState);
    }
  } catch (err) {
    console.warn('[loadLatestCorRecord]', err.message);
  }
}

loadLatestGenRecord();
loadLatestCorRecord();
