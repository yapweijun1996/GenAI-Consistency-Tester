import { formatBytes, truncate } from './utils.js';

const el = id => document.getElementById(id);

export const elements = {
  apiKeyEl: el('apiKey'),
  modelEl: el('model'),
  runsEl: el('runs'),
  promptEl: el('prompt'),
  imagesEl: el('images'),
  runBtn: el('runBtn'),
  cancelBtn: el('cancelBtn'),
  exportBtn: el('exportBtn'),
  statusText: el('statusText'),
  progressBar: el('progressBar'),
  rateExact: el('rateExact'),
  rateJaccard: el('rateJaccard'),
  majorityText: el('majorityText'),
  resultsTableBody: document.querySelector('#resultsTable tbody'),
  delayMsEl: el('delayMs'),
  temperatureEl: el('temperature'),
  topPEl: el('topP'),
  templateSelectorEl: el('templateSelector'),
  timeoutMsEl: el('timeoutMs'),
  temperatureVal: el('temperatureVal'),
  topPVal: el('topPVal'),
  outputModalOverlay: el('outputModalOverlay'),
  modalContent: el('modalContent'),
  modalTitle: el('modalTitle'),
  modalCloseBtn: el('modalCloseBtn'),
  imagePreviewContainer: el('imagePreviewContainer'),
};

export function renderRow(idx, status, latency, text) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="mono">${idx}</td>
    <td>${status}</td>
    <td class="mono">${latency ?? '–'}</td>
    <td class="mono"><span class="output-link" data-full-text="${encodeURIComponent(text || '')}">${truncate(text || '')}</span></td>
  `;
  elements.resultsTableBody.appendChild(tr);
  tr.scrollIntoView({ block: 'nearest' });
}

export function updateProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  elements.progressBar.style.width = pct + '%';
  elements.statusText.textContent = `Progress: ${done}/${total} (${pct}%)`;
}

export function resetUIState() {
  elements.progressBar.style.width = '0%';
  elements.rateExact.textContent = '–';
  elements.rateJaccard.textContent = '–';
  elements.majorityText.textContent = '–';
  elements.resultsTableBody.innerHTML = '';
}

export function renderPreviews(uploadedFiles) {
  elements.imagePreviewContainer.innerHTML = '';
  uploadedFiles.forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const div = document.createElement('div');
      div.className = 'img-preview';
      div.innerHTML = `
        <img src="${e.target.result}" alt="${file.name}" data-index="${index}" class="preview-image-clickable" />
        <div class="info">${formatBytes(file.size)} ${file.compressed ? '✓' : ''}</div>
        <button class="delete-btn" data-index="${index}">&times;</button>
      `;
      elements.imagePreviewContainer.appendChild(div);
    };
    reader.readAsDataURL(file);
  });
}

export function showModal(content, type = 'text') {
  const pre = elements.modalContent.querySelector('pre');
  const img = elements.modalContent.querySelector('img');

  if (type === 'text') {
    elements.modalTitle.textContent = 'Full Output';
    pre.textContent = content;
    pre.style.display = 'block';
    img.style.display = 'none';
  } else if (type === 'image') {
    elements.modalTitle.textContent = 'Image Preview';
    img.src = content;
    img.style.display = 'block';
    pre.style.display = 'none';
  }
  elements.outputModalOverlay.style.display = 'flex';
}

export function hideModal() {
  elements.outputModalOverlay.style.display = 'none';
}

export async function loadTemplates(templates) {
  try {
    const res = await fetch('templates.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const loadedTemplates = await res.json();
    templates.push(...loadedTemplates);
    
    elements.templateSelectorEl.innerHTML = '<option value="">Select a template...</option>';
    templates.forEach((t, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = t.name;
      elements.templateSelectorEl.appendChild(opt);
    });
  } catch (e) {
    console.error('Failed to load templates:', e);
    elements.templateSelectorEl.innerHTML = '<option value="">Error loading templates</option>';
    elements.templateSelectorEl.disabled = true;
  }
}