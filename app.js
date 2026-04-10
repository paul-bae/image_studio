/**
 * AI 이미지 스튜디오 — app.js
 * Frontend logic for image generation & correction
 *
 * NOTE: Supabase anon key is a public key (safe for client-side use).
 *       OpenRouter / Groq API keys are handled by backend API routes only.
 */

'use strict';

const SUPABASE_URL      = 'https://mcshhvttsvfurrkpcbdf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jc2hodnR0c3ZmdXJya3BjYmRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5ODI5MDgsImV4cCI6MjA4OTU1ODkwOH0.FRlSXHknfnYoZ4i4-_up8QvppoKHGo50koK9yDkXPUQ';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Generation panel ──
const generateForm        = document.getElementById('generate-form');
const courseNameEl        = document.getElementById('course-name');
const targetAudienceEl    = document.getElementById('target-audience');
const learningObjectivesEl= document.getElementById('learning-objectives');
const detailedContentEl   = document.getElementById('detailed-content');
const genRatioEl          = document.getElementById('gen-ratio');
const genSizeEl           = document.getElementById('gen-size');
const genModelInfoEl      = document.getElementById('gen-model-info');
const btnGenerate         = document.getElementById('btn-generate');
const btnGenDownload      = document.getElementById('btn-gen-download');
const genLoadingEl        = document.getElementById('gen-loading');
const genCurrentModelEl   = document.getElementById('gen-current-model');
const genErrorEl          = document.getElementById('gen-error');
const genImageContainer   = document.getElementById('gen-image-container');
const genImageEl          = document.getElementById('gen-image');
const genPromptDisplay    = document.getElementById('gen-prompt-display');
const genPromptText       = document.getElementById('gen-prompt-text');

// ── Correction panel ──
const correctForm         = document.getElementById('correct-form');
const fileInput           = document.getElementById('correct-file-input');
const dropZone            = document.getElementById('drop-zone');
const previewContainer    = document.getElementById('preview-container');
const previewImage        = document.getElementById('preview-image');
const btnClearFile        = document.getElementById('btn-clear-file');
const corRatioEl          = document.getElementById('cor-ratio');
const corSizeEl           = document.getElementById('cor-size');
const corModelInfoEl      = document.getElementById('cor-model-info');
const btnCorrect          = document.getElementById('btn-correct');
const btnCorDownload      = document.getElementById('btn-cor-download');
const corLoadingEl        = document.getElementById('cor-loading');
const corCurrentModelEl   = document.getElementById('cor-current-model');
const corErrorEl          = document.getElementById('cor-error');
const corImageContainer   = document.getElementById('cor-image-container');
const corImageEl          = document.getElementById('cor-image');
const corNotesContainer   = document.getElementById('cor-notes-container');
const corNotesText        = document.getElementById('cor-notes-text');

/* ============================================================
   CHAR COUNTER SETUP
   ============================================================ */

function setupCharCounter(textarea, counterId, max) {
  const counter    = document.getElementById(counterId);
  const currentEl  = counter.querySelector('.char-current');

  function update() {
    const len = textarea.value.length;
    currentEl.textContent = len.toLocaleString('ko-KR');
    const ratio = len / max;
    counter.classList.toggle('near-limit', ratio >= 0.85 && ratio < 1);
    counter.classList.toggle('at-limit',   ratio >= 1);
  }

  textarea.addEventListener('input', update);
  update();
}

setupCharCounter(courseNameEl,         'course-name-counter',          200);
setupCharCounter(targetAudienceEl,     'target-audience-counter',     2000);
setupCharCounter(learningObjectivesEl, 'learning-objectives-counter', 2000);
setupCharCounter(detailedContentEl,    'detailed-content-counter',    2000);

/* ============================================================
   DROP-ZONE & FILE PREVIEW
   ============================================================ */

let selectedFile = null;

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
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
  resetCorResult();
}

function clearSelectedFile() {
  selectedFile = null;
  URL.revokeObjectURL(previewImage.src);
  previewImage.src = '';
  previewContainer.hidden = true;
  dropZone.hidden = false;
  fileInput.value = '';
  resetCorResult();
}

/* ============================================================
   UI STATE HELPERS
   ============================================================ */

function showEl(el)  { el.hidden = false; }
function hideEl(el)  { el.hidden = true;  }

function setGenLoading(modelName) {
  genCurrentModelEl.textContent = modelName || '—';
  showEl(genLoadingEl);
  hideEl(genErrorEl);
  hideEl(genImageContainer);
}

function setCorLoading(modelName) {
  corCurrentModelEl.textContent = modelName || '—';
  showEl(corLoadingEl);
  hideEl(corErrorEl);
  hideEl(corImageContainer);
}

function showGenError(message) {
  genErrorEl.textContent = `이미지 생성 실패: ${message}`;
  showEl(genErrorEl);
  hideEl(genLoadingEl);
  hideEl(genImageContainer);
}

function showCorError(message) {
  corErrorEl.textContent = `이미지 보정 실패: ${message}`;
  showEl(corErrorEl);
  hideEl(corLoadingEl);
  hideEl(corImageContainer);
}

function resetCorResult() {
  hideEl(corLoadingEl);
  hideEl(corErrorEl);
  hideEl(corImageContainer);
  hideEl(corNotesContainer);
  corImageEl.src = '';
  corNotesText.textContent = '';
  setDownloadEnabled(btnCorDownload, false);
}

function setDownloadEnabled(btn, enabled) {
  btn.disabled = !enabled;
  btn.setAttribute('aria-disabled', String(!enabled));
}

function setBusy(btn, busy) {
  btn.disabled = busy;
  btn.setAttribute('aria-disabled', String(busy));
}

/* ============================================================
   API HELPERS
   ============================================================ */

async function fetchFreeModels() {
  try {
    const res = await fetch('/api/free-models');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.models || [];
  } catch (err) {
    console.warn('[fetchFreeModels] failed:', err.message);
    return [];
  }
}

async function callGenerate(payload) {
  const res = await fetch('/api/generate', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}

async function callCorrect(payload) {
  const res = await fetch('/api/correct', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}

/* ============================================================
   SUPABASE HELPERS
   ============================================================ */

async function insertGenRecord({ course_name, target_audience, learning_objectives, detailed_content, image_ratio, image_size }) {
  const { data, error } = await supabase
    .from('image_generations')
    .insert([{ course_name, target_audience, learning_objectives, detailed_content, image_ratio, image_size }])
    .select()
    .single();

  if (error) throw new Error(`Supabase insert error: ${error.message}`);
  return data;
}

async function updateGenRecord(id, { image_url, ai_prompt }) {
  const { error } = await supabase
    .from('image_generations')
    .update({ image_url, ai_prompt })
    .eq('id', id);

  if (error) console.warn('[updateGenRecord] error:', error.message);
}

async function insertCorRecord({ original_image_name, image_ratio, image_size }) {
  const { data, error } = await supabase
    .from('image_corrections')
    .insert([{ original_image_name, image_ratio, image_size }])
    .select()
    .single();

  if (error) throw new Error(`Supabase insert error: ${error.message}`);
  return data;
}

async function updateCorRecord(id, { corrected_image_url, correction_notes }) {
  const { error } = await supabase
    .from('image_corrections')
    .update({ corrected_image_url, correction_notes })
    .eq('id', id);

  if (error) console.warn('[updateCorRecord] error:', error.message);
}

/* ============================================================
   CANVAS RESIZE HELPER
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

      const scaleX = targetW / img.naturalWidth;
      const scaleY = targetH / img.naturalHeight;
      const scale  = Math.max(scaleX, scaleY);

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
  const [w, h] = sizeStr.split('x').map(Number);
  return { w: w || 1280, h: h || 720 };
}

/* ============================================================
   FILE → BASE64 HELPER
   ============================================================ */

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

/* ============================================================
   DOWNLOAD HELPER
   ============================================================ */

async function downloadImage(src, filename = 'image.png') {
  try {
    let href;

    if (src.startsWith('data:')) {
      href = src;
    } else {
      const res  = await fetch(src);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const blob = await res.blob();
      href = URL.createObjectURL(blob);
    }

    const a      = document.createElement('a');
    a.href       = href;
    a.download   = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (!src.startsWith('data:')) {
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    }
  } catch (err) {
    alert(`다운로드 실패: ${err.message}`);
  }
}

/* ============================================================
   IMAGE GENERATION FLOW
   ============================================================ */

generateForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const courseName = courseNameEl.value.trim();
  if (!courseName) {
    courseNameEl.focus();
    showGenError('과정명은 필수 입력 항목입니다.');
    return;
  }

  const targetAudience     = targetAudienceEl.value.trim();
  const learningObjectives = learningObjectivesEl.value.trim();
  const detailedContent    = detailedContentEl.value.trim();
  const imageRatio         = genRatioEl.value;
  const imageSize          = genSizeEl.value;

  setBusy(btnGenerate, true);
  hideEl(genErrorEl);
  hideEl(genImageContainer);
  setDownloadEnabled(btnGenDownload, false);

  let recordId = null;

  try {
    const record = await insertGenRecord({
      course_name:         courseName,
      target_audience:     targetAudience,
      learning_objectives: learningObjectives,
      detailed_content:    detailedContent,
      image_ratio:         imageRatio,
      image_size:          imageSize,
    });
    recordId = record.id;

    const models = await fetchFreeModels();
    genModelInfoEl.textContent = `이용 가능한 무료 모델: ${models.length}개`;
    showEl(genModelInfoEl);

    const firstModel = models[0]?.id || '자동 선택';
    setGenLoading(firstModel);

    const result = await callGenerate({
      courseName,
      targetAudience,
      objectives: learningObjectives,
      content:    detailedContent,
      ratio:      imageRatio,
      size:       imageSize,
      recordId,
    });

    const { imageUrl, prompt, modelUsed } = result;

    if (modelUsed) genCurrentModelEl.textContent = modelUsed;

    hideEl(genLoadingEl);
    genImageEl.src = imageUrl;
    genImageEl.alt = `AI가 생성한 “${courseName}” 교육 이미지`;
    showEl(genImageContainer);

    if (prompt) {
      genPromptText.textContent = prompt;
      showEl(genPromptDisplay);
    }

    await updateGenRecord(recordId, { image_url: imageUrl, ai_prompt: prompt || '' });

    setDownloadEnabled(btnGenDownload, true);
    btnGenDownload.onclick = () =>
      downloadImage(imageUrl, `generated_${Date.now()}.png`);

  } catch (err) {
    console.error('[generate]', err);
    showGenError(err.message || '알 수 없는 오류가 발생했습니다.');
  } finally {
    setBusy(btnGenerate, false);
  }
});

/* ============================================================
   IMAGE CORRECTION FLOW
   ============================================================ */

correctForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!selectedFile) {
    showCorError('보정할 이미지 파일을 선택해 주세요.');
    return;
  }

  const imageRatio = corRatioEl.value;
  const imageSize  = corSizeEl.value;

  setBusy(btnCorrect, true);
  hideEl(corErrorEl);
  hideEl(corImageContainer);
  hideEl(corNotesContainer);
  setDownloadEnabled(btnCorDownload, false);

  let recordId  = null;
  let finalSrc  = null;

  try {
    const record = await insertCorRecord({
      original_image_name: selectedFile.name,
      image_ratio:         imageRatio,
      image_size:          imageSize,
    });
    recordId = record.id;

    const models = await fetchFreeModels();
    corModelInfoEl.textContent = `이용 가능한 무료 모델: ${models.length}개`;
    showEl(corModelInfoEl);

    const imageBase64 = await fileToBase64(selectedFile);

    const firstModel = models[0]?.id || '자동 선택';
    setCorLoading(firstModel);

    const result = await callCorrect({
      imageBase64,
      imageName: selectedFile.name,
      ratio:     imageRatio,
      size:      imageSize,
      recordId,
    });

    const { correctedImageUrl, correctionNotes, modelUsed } = result;

    if (modelUsed) corCurrentModelEl.textContent = modelUsed;

    const { w: targetW, h: targetH } = parseSize(imageSize);

    if (correctedImageUrl) {
      try {
        finalSrc = await resizeImageWithCanvas(correctedImageUrl, targetW, targetH);
      } catch {
        finalSrc = correctedImageUrl;
      }
    } else {
      finalSrc = await resizeImageWithCanvas(imageBase64, targetW, targetH);
    }

    hideEl(corLoadingEl);
    corImageEl.src = finalSrc;
    corImageEl.alt = `AI가 보정한 “${selectedFile.name}” 이미지`;
    showEl(corImageContainer);

    if (correctionNotes) {
      corNotesText.textContent = correctionNotes;
      showEl(corNotesContainer);
    }

    await updateCorRecord(recordId, {
      corrected_image_url: correctedImageUrl || '',
      correction_notes:    correctionNotes   || '',
    });

    setDownloadEnabled(btnCorDownload, true);
    btnCorDownload.onclick = () =>
      downloadImage(finalSrc, `corrected_${Date.now()}.png`);

  } catch (err) {
    console.error('[correct]', err);
    showCorError(err.message || '알 수 없는 오류가 발생했습니다.');
  } finally {
    setBusy(btnCorrect, false);
  }
});