/* === Analies — Frontend Logic ===
   Handles: Tab switching, file upload, drag-drop,
   PDF text extraction (PDF.js), OCR (Tesseract.js),
   URL fetch via backend, API call, result rendering.
*/

// ─── Guard: prevent unhandled promise / script errors surfacing as toast ──────
window.addEventListener('unhandledrejection', (e) => { e.preventDefault(); });

// ─── PDF.js worker ───────────────────────────────────
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ─── State ───────────────────────────────────────────
const state = {
  activeTab: 'upload',
  file: null,
};

const API_BASE = window.location.origin; // same origin as backend

// ─── DOM Refs ─────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const analyzeBtn    = $('analyzeBtn');
const actionHint    = $('actionHint');
const inputPanel    = $('inputPanel');
const processingEl  = $('processing');
const resultsEl     = $('results');
const errorToast    = $('errorToast');
const errorMsg      = $('errorMsg');

// ─── Tab Switching ────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    $(`content-${target}`).classList.add('active');

    state.activeTab = target;
    state.file = null;
    updateReadiness();
  });
});

// ─── File Upload ──────────────────────────────────────
const dropzone   = $('dropzone');
const fileInput  = $('fileInput');
const filePreview = $('filePreview');
const fileNameEl  = $('fileName');
const removeFile  = $('removeFile');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) selectFile(fileInput.files[0]);
});

dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f) selectFile(f);
});

removeFile.addEventListener('click', () => {
  state.file = null;
  fileInput.value = '';
  filePreview.hidden = true;
  dropzone.hidden = false;
  updateReadiness();
});

function selectFile(f) {
  const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
  if (!allowed.includes(f.type)) {
    showError('Unsupported file type. Please upload a PDF or image (PNG, JPG, WEBP).');
    return;
  }
  if (f.size > 10 * 1024 * 1024) {
    showError('File is too large. Maximum size is 10 MB.');
    return;
  }
  state.file = f;
  fileNameEl.textContent = f.name;
  filePreview.hidden = false;
  dropzone.hidden = true;
  updateReadiness();
}

// ─── Paste Tab ────────────────────────────────────────
const pasteText = $('pasteText');
const charCount = $('charCount');

pasteText.addEventListener('input', () => {
  charCount.textContent = pasteText.value.length.toLocaleString();
  updateReadiness();
});

// ─── URL Tab ──────────────────────────────────────────
const urlInput = $('urlInput');
urlInput.addEventListener('input', updateReadiness);

// ─── Readiness ────────────────────────────────────────
function updateReadiness() {
  let ready = false;
  let hint = 'Select a file, paste text, or enter a URL to begin';

  if (state.activeTab === 'upload') {
    ready = !!state.file;
    hint = ready ? `Ready to analyze "${state.file.name}"` : 'Upload a PDF or image to continue';
  } else if (state.activeTab === 'paste') {
    ready = pasteText.value.trim().length >= 100;
    hint = ready
      ? `${pasteText.value.trim().length} characters ready`
      : `Need at least 100 characters (${pasteText.value.trim().length} so far)`;
  } else if (state.activeTab === 'url') {
    const v = urlInput.value.trim();
    ready = v.startsWith('http://') || v.startsWith('https://');
    hint = ready ? `Will fetch: ${v}` : 'Enter a valid URL starting with https://';
  }

  analyzeBtn.disabled = !ready;
  actionHint.textContent = hint;
}

// ─── Main Analyze Flow ────────────────────────────────
analyzeBtn.addEventListener('click', handleAnalyze);

async function handleAnalyze() {
  hideError();
  showProcessing();

  try {
    let policyText = '';
    let sourceUrl  = '';

    if (state.activeTab === 'upload') {
      setStep(1, 'active');
      policyText = await extractTextFromFile(state.file);
      setStep(1, 'done');
    } else if (state.activeTab === 'paste') {
      setStep(1, 'done');
      policyText = pasteText.value.trim();
    } else if (state.activeTab === 'url') {
      setStep(1, 'active');
      sourceUrl  = urlInput.value.trim();
      policyText = await fetchFromUrl(sourceUrl);
      setStep(1, 'done');
    }

    setStep(2, 'active');
    policyText = cleanText(policyText);
    setStep(2, 'done');

    if (policyText.length < 100) {
      throw new Error('Extracted text is too short (less than 100 characters). Please use a longer policy document.');
    }

    setStep(3, 'active');
    const analysis = await analyzePolicy(policyText, sourceUrl);
    setStep(3, 'done');

    await sleep(300);
    showResults(analysis);
  } catch (err) {
    hideProcessing();
    showError(err.message || 'An unexpected error occurred.');
  }
}

// ─── Text Extraction ──────────────────────────────────
async function extractTextFromFile(file) {
  if (file.type === 'application/pdf') {
    return extractFromPDF(file);
  } else {
    return extractFromImage(file);
  }
}

async function extractFromPDF(file) {
  if (!window.pdfjsLib) throw new Error('PDF library not loaded. Please refresh and try again.');
  updateProcessingTitle('Reading PDF…', 'Extracting text from all pages');

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ');
    fullText += pageText + '\n';
    updateProcessingTitle(`Reading PDF… (page ${i}/${pdf.numPages})`, 'Extracting text from all pages');
  }

  return fullText;
}

async function extractFromImage(file) {
  if (!window.Tesseract) throw new Error('OCR library not loaded. Please refresh and try again.');
  updateProcessingTitle('Running OCR…', 'Reading text from image — this may take 15–30s');

  const { data: { text } } = await Tesseract.recognize(file, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        updateProcessingTitle(
          `OCR: ${Math.round(m.progress * 100)}%`,
          'Recognizing text from image'
        );
      }
    },
  });
  return text;
}

async function fetchFromUrl(url) {
  updateProcessingTitle('Fetching URL…', 'Downloading and parsing the policy page');
  const res = await fetch(`${API_BASE}/api/fetch-policy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to fetch URL (${res.status})`);
  }
  const data = await res.json();
  return data.text;
}

// ─── Text Cleaning ────────────────────────────────────
function cleanText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── API Call ─────────────────────────────────────────
async function analyzePolicy(text, url) {
  updateProcessingTitle('AI Analysis…', 'Detecting privacy risks with LLaMA 3.3');

  const res = await fetch(`${API_BASE}/api/analyze-policy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ policy_text: text, url }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Analysis failed (${res.status})`);
  }

  return res.json();
}

// ─── Results Rendering ────────────────────────────────
function showResults(data) {
  hideProcessing();
  hideSections();
  resultsEl.hidden = false;

  // Score ring animation
  const score      = Math.max(0, Math.min(10, Number(data.risk_score) || 0));
  const level      = (data.risk_level || 'LOW').toUpperCase();
  const ringFill   = $('ringFill');
  const circumference = 326.7;
  const offset     = circumference - (score / 10) * circumference;

  $('scoreNumber').textContent = score;
  ringFill.classList.remove('high', 'medium', 'low');
  ringFill.classList.add(level.toLowerCase());
  setTimeout(() => { ringFill.style.strokeDashoffset = offset; }, 50);

  // Risk badge
  const badge = $('riskBadge');
  badge.textContent = level;
  badge.className = `risk-badge ${level}`;

  // Summary
  $('scoreSummary').textContent = data.summary || 'Analysis complete.';

  // Risk tags
  const risksList = $('risksList');
  risksList.innerHTML = '';
  (data.detected_risks || []).forEach((r) => {
    const tag = document.createElement('span');
    tag.className = 'risk-tag';
    tag.textContent = r;
    risksList.appendChild(tag);
  });

  // Clause explanations
  const clausesList = $('clausesList');
  clausesList.innerHTML = '';
  const clauses = data.clause_explanations || [];

  if (clauses.length === 0) {
    clausesList.innerHTML = '<div class="no-clauses">No high-risk clauses were explicitly detected.</div>';
  } else {
    clauses.forEach((clause, idx) => {
      const conf    = typeof clause.confidence === 'number' ? clause.confidence : 0.5;
      const confPct = Math.round(conf * 100);

      // Determine severity color from parent risk_level
      const severity = level === 'HIGH' && idx === 0 ? 'high'
                     : level === 'HIGH' || level === 'MEDIUM' ? 'medium'
                     : 'low';

      const card = document.createElement('div');
      card.className = `clause-card ${severity}`;
      card.innerHTML = `
        <div class="clause-header">
          <p class="clause-quote">${escHtml(truncate(clause.highlighted_sentence, 200))}</p>
          <svg class="clause-toggle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="clause-body">
          <div class="clause-field">
            <div class="clause-field-label">What it means</div>
            <div class="clause-field-value">${escHtml(clause.meaning || '—')}</div>
          </div>
          ${clause.possible_misuse?.length ? `
          <div class="clause-field">
            <div class="clause-field-label">Possible misuse</div>
            <ul class="clause-misuse-list">
              ${clause.possible_misuse.map((m) => `<li>${escHtml(m)}</li>`).join('')}
            </ul>
          </div>` : ''}
          ${clause.real_world_example ? `
          <div class="clause-field">
            <div class="clause-field-label">Real-world example</div>
            <div class="clause-field-value">${escHtml(clause.real_world_example)}</div>
          </div>` : ''}
          <div class="clause-field">
            <div class="clause-field-label">Confidence</div>
            <div class="confidence-bar-wrap">
              <div class="confidence-bar">
                <div class="confidence-fill" style="width:${confPct}%"></div>
              </div>
              <span class="confidence-pct">${confPct}%</span>
            </div>
          </div>
        </div>`;

      card.querySelector('.clause-header').addEventListener('click', () => {
        card.classList.toggle('open');
      });

      clausesList.appendChild(card);
    });

    // Open first card by default
    if (clausesList.firstChild) {
      clausesList.firstChild.classList.add('open');
    }
  }

  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Reset ────────────────────────────────────────────
$('resetBtn').addEventListener('click', () => {
  resultsEl.hidden = true;
  inputPanel.hidden = false;
  state.file = null;
  fileInput.value = '';
  filePreview.hidden = true;
  dropzone.hidden = false;
  pasteText.value = '';
  charCount.textContent = '0';
  urlInput.value = '';
  updateReadiness();
  inputPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ─── UI Helpers ───────────────────────────────────────
function showProcessing() {
  hideSections();
  processingEl.hidden = false;
  inputPanel.hidden = true;
  resetSteps();
  processingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function hideProcessing() { processingEl.hidden = true; }

function hideSections() {
  processingEl.hidden = true;
  resultsEl.hidden    = true;
  inputPanel.hidden   = false;
}

function setStep(n, status) {
  const el = $(`step${n}`);
  el.classList.remove('active', 'done');
  if (status) el.classList.add(status);
}
function resetSteps() {
  [1, 2, 3].forEach((n) => setStep(n, ''));
}

function updateProcessingTitle(title, sub) {
  $('processingTitle').textContent = title;
  $('processingSub').textContent   = sub;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorToast.hidden = false;
}
function hideError() { errorToast.hidden = true; }
$('closeError').addEventListener('click', hideError);

// ─── Utilities ────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function truncate(str, max) {
  return str && str.length > max ? str.slice(0, max) + '…' : str;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Init ─────────────────────────────────────────────
hideError(); // ensure toast never shows on cold load
updateReadiness();
