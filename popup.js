const elements = {
  currentSite: document.getElementById('current-site'),
  loadingState: document.getElementById('loading-state'),
  noPolicyState: document.getElementById('no-policy-state'),
  resultsState: document.getElementById('results-state'),
  riskCard: document.getElementById('risk-card'),
  riskScoreCircle: document.getElementById('risk-score-circle'),
  riskScoreValue: document.getElementById('risk-score-value'),
  riskLevel: document.getElementById('risk-level'),
  riskSummary: document.getElementById('risk-summary'),
  riskCount: document.getElementById('risk-count'),
  risksList: document.getElementById('risks-list'),
  explanationsSection: document.getElementById('explanations-section'),
  explanationsList: document.getElementById('explanations-list'),
  historyList: document.getElementById('history-list'),
  refreshBtn: document.getElementById('refresh-btn')
};

const RISK_COLORS = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444' };
const RISK_SUMMARIES = {
  LOW: '✅ This policy appears privacy-friendly',
  MEDIUM: '⚠️ Some concerning clauses detected',
  HIGH: '🔴 Multiple high-risk clauses found'
};

let currentHostname = '';

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    try {
      const url = new URL(tab.url);
      currentHostname = url.hostname;
      elements.currentSite.textContent = currentHostname;
    } catch {
      elements.currentSite.textContent = 'Current site';
    }
  }

  await loadAnalysis();

  elements.refreshBtn?.addEventListener('click', async () => {
    elements.refreshBtn.disabled = true;
    elements.refreshBtn.textContent = 'Analyzing...';

    // Clear stored analysis so content.js re-runs on next load
    await chrome.storage.local.remove(['lastAnalysis']);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'reanalyze' }).catch(() => {});
    }

    setTimeout(async () => {
      elements.refreshBtn.disabled = false;
      elements.refreshBtn.textContent = '🔄 Refresh';
      await loadAnalysis();
    }, 3000);
  });
});

async function loadAnalysis() {
  showState('loading');

  try {
    const result = await chrome.storage.local.get(['lastAnalysis']);
    const analysis = result.lastAnalysis;

    // Only show results if they are for the current domain and not stale
    if (
      analysis &&
      analysis.domain === currentHostname &&
      Date.now() - analysis.timestamp < 15 * 60 * 1000
    ) {
      displayAnalysis(analysis);
      loadHistory();
    } else {
      showState('no-policy');
    }
  } catch (error) {
    console.error('Error loading analysis:', error);
    showState('no-policy');
  }
}

function showState(state) {
  elements.loadingState.classList.add('hidden');
  elements.noPolicyState.classList.add('hidden');
  elements.resultsState.classList.add('hidden');

  if (state === 'loading') elements.loadingState.classList.remove('hidden');
  else if (state === 'no-policy') elements.noPolicyState.classList.remove('hidden');
  else if (state === 'results') elements.resultsState.classList.remove('hidden');
}

function displayAnalysis(analysis) {
  showState('results');

  const score = analysis.risk_score || 0;
  const level = analysis.risk_level || 'LOW';

  elements.riskScoreValue.textContent = score;
  elements.riskScoreCircle.style.borderColor = RISK_COLORS[level];
  elements.riskCard.style.borderLeftColor = RISK_COLORS[level];
  elements.riskLevel.textContent = `${level} Risk`;
  elements.riskLevel.style.color = RISK_COLORS[level];
  elements.riskSummary.textContent = RISK_SUMMARIES[level];

  displayDetectedRisks(analysis.detected_risks || []);
  displayClauseExplanations(analysis.clause_explanations || []);

  const total = (analysis.detected_risks?.length || 0) + (analysis.clause_explanations?.length || 0);
  elements.riskCount.textContent = total;
}

function displayDetectedRisks(risks) {
  if (risks.length === 0) {
    elements.risksList.innerHTML = '<li style="background:#f0fdf4;border-color:#bbf7d0;color:#166534">✅ No major risks detected</li>';
    return;
  }
  elements.risksList.innerHTML = risks.slice(0, 5).map(risk =>
    `<li>⚠️ ${escapeHtml(risk)}</li>`
  ).join('');
}

function displayClauseExplanations(clauses) {
  if (clauses.length === 0) {
    elements.explanationsSection.classList.add('hidden');
    return;
  }

  elements.explanationsSection.classList.remove('hidden');

  elements.explanationsList.innerHTML = clauses.map(clause => `
    <div class="explanation-card">
      <strong>⚠️ Risky Clause</strong>
      <div style="background:#f9fafb;padding:8px;border-radius:4px;margin:8px 0;font-style:italic;font-size:12px">
        "${escapeHtml(clause.highlighted_sentence || 'N/A')}"
      </div>
      <strong>📖 Meaning:</strong>
      <div style="margin:4px 0">${escapeHtml(clause.meaning)}</div>
      <strong>⚠️ Misuse:</strong>
      <ul style="padding-left:18px;margin:4px 0">
        ${(clause.possible_misuse || []).map(m => `<li>${escapeHtml(m)}</li>`).join('')}
      </ul>
      <div style="background:#eff6ff;padding:8px;border-radius:4px;margin-top:8px;font-size:12px">
        <strong>🌍 Example:</strong> ${escapeHtml(clause.real_world_example)}
      </div>
    </div>
  `).join('');
}

function loadHistory() {
  chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
    if (!response?.interactions?.length) return;
    elements.historyList.innerHTML = response.interactions.slice(0, 10).map(item => {
      const date = new Date(item.timestamp).toLocaleTimeString();
      const color = RISK_COLORS[item.riskLevel] || '#6b7280';
      return `<div style="font-size:12px;color:#374151;padding:4px 0;border-bottom:1px solid #f3f4f6">
        <span style="color:${color};font-weight:600">${item.riskLevel || '?'}</span>
        · ${escapeHtml(item.domain)} · ${date}
      </div>`;
    }).join('');
  });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}