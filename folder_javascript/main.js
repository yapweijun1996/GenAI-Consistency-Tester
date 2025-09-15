import { elements, renderRow, updateProgress, resetUIState, renderPreviews, showModal, hideModal, loadTemplates } from './ui.js';
import { dbSet, loadApiKey } from './db.js';
import { processFiles, filesToInlineParts } from './file-handler.js';
import { callGemini } from './api.js';
import { normalizeText, jaccard, majority } from './utils.js';

let cancelFlag = false;
let lastResults = [];
let uploadedFiles = [];
let templates = [];

function computeMetrics(texts) {
  const norm = texts.map(normalizeText);
  const { value: mode, count } = majority(norm);
  const exactRate = texts.length ? (count / texts.length) : 0;
  const sims = norm.map(s => jaccard(mode, s));
  const avgJ = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;
  return { exactRate, avgJaccard: avgJ, majorityNormalized: mode };
}

async function runTest() {
  cancelFlag = false;
  lastResults = [];
  resetUIState();

  const apiKey = elements.apiKeyEl.value.trim();
  if (!apiKey) {
    alert('Please enter your Gemini API key.');
    return;
  }
  const prompt = elements.promptEl.value.trim();
  if (!prompt) {
    alert('Please enter a prompt.');
    return;
  }

  elements.runBtn.disabled = true;
  elements.cancelBtn.disabled = false;
  elements.exportBtn.disabled = true;
  elements.statusText.textContent = 'Preparing images…';

  let imageParts = [];
  try {
    imageParts = await filesToInlineParts(uploadedFiles);
  } catch (e) {
    console.error(e);
    alert('Failed to read images: ' + e.message);
    elements.runBtn.disabled = false;
    elements.cancelBtn.disabled = true;
    return;
  }

  elements.statusText.textContent = 'Running…';
  const N = parseInt(elements.runsEl.value, 10) || 5;

  for (let i = 1; i <= N; i++) {
    if (cancelFlag) {
      renderRow(i, '<span class="badge warn">cancelled</span>', null, '—');
      break;
    }
    try {
      const params = {
        apiKey,
        model: elements.modelEl.value,
        prompt,
        imageParts,
        temperature: parseFloat(elements.temperatureEl.value),
        topP: parseFloat(elements.topPEl.value),
        timeoutMs: parseInt(elements.timeoutMsEl.value, 10) || 15000,
        statusEl: elements.statusText
      };
      const { text, latency } = await callGemini(params);
      lastResults.push({ index: i, ok: true, latency, text });
      renderRow(i, '<span class="badge ok">ok</span>', latency, text);
    } catch (err) {
      lastResults.push({ index: i, ok: false, latency: null, error: String(err) });
      renderRow(i, '<span class="badge err">error</span>', '–', String(err));
    }
    updateProgress(i, N);
    const delayMs = Math.max(0, parseInt(elements.delayMsEl.value, 10) || 0);
    if (i < N && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  const texts = lastResults.filter(r => r.ok).map(r => r.text);
  const { exactRate, avgJaccard, majorityNormalized } = computeMetrics(texts);

  elements.rateExact.textContent = texts.length ? (exactRate * 100).toFixed(1) + '%' : '–';
  elements.rateJaccard.textContent = texts.length ? (avgJaccard * 100).toFixed(1) + '%' : '–';
  elements.majorityText.textContent = texts.length ? majorityNormalized : '–';

  elements.statusText.textContent = `Done. Success ${texts.length}/${lastResults.length}.`;
  elements.runBtn.disabled = false;
  elements.cancelBtn.disabled = true;
  elements.exportBtn.disabled = lastResults.length > 0;
}

function setupEventListeners() {
  elements.apiKeyEl.addEventListener('input', () => dbSet('gemini_api_key', elements.apiKeyEl.value).catch(console.error));
  elements.temperatureEl.addEventListener('input', () => elements.temperatureVal.textContent = parseFloat(elements.temperatureEl.value).toFixed(2));
  elements.topPEl.addEventListener('input', () => elements.topPVal.textContent = parseFloat(elements.topPEl.value).toFixed(2));
  elements.templateSelectorEl.addEventListener('change', () => {
    const idx = parseInt(elements.templateSelectorEl.value, 10);
    if (!isNaN(idx) && templates[idx]) {
      elements.promptEl.value = templates[idx].prompt;
    }
  });
  elements.imagesEl.addEventListener('change', async (e) => {
    await processFiles(Array.from(e.target.files), uploadedFiles, elements.statusText);
    renderPreviews(uploadedFiles);
    e.target.value = '';
  });
  elements.imagePreviewContainer.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('delete-btn')) {
      const index = parseInt(target.dataset.index, 10);
      uploadedFiles.splice(index, 1);
      renderPreviews(uploadedFiles);
    } else if (target.classList.contains('preview-image-clickable')) {
      const index = parseInt(target.dataset.index, 10);
      const file = uploadedFiles[index];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => showModal(event.target.result, 'image');
        reader.readAsDataURL(file);
      }
    }
  });
  elements.resultsTableBody.addEventListener('click', (e) => {
    if (e.target.classList.contains('output-link')) {
      const fullText = decodeURIComponent(e.target.dataset.fullText);
      showModal(fullText, 'text');
    }
  });
  elements.modalCloseBtn.addEventListener('click', hideModal);
  elements.outputModalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.outputModalOverlay) hideModal();
  });
  elements.runBtn.addEventListener('click', runTest);
  elements.cancelBtn.addEventListener('click', () => {
    cancelFlag = true;
    elements.cancelBtn.disabled = true;
    elements.statusText.textContent = 'Cancelling…';
  });
  elements.exportBtn.addEventListener('click', () => {
    const out = {
      meta: {
        model: elements.modelEl.value,
        runs: parseInt(elements.runsEl.value, 10) || 0,
        timestamp: new Date().toISOString()
      },
      prompt: elements.promptEl.value,
      results: lastResults
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gemini-consistency-results.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  });
}

async function main() {
  const apiKey = await loadApiKey();
  if (apiKey) {
    elements.apiKeyEl.value = apiKey;
  }
  await loadTemplates(templates);
  setupEventListeners();
}

main();