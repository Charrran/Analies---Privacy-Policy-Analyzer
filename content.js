/**
 * content.js - Digital Consent Verifier
 * FIXED: No more layout shift, per-domain analysis, real heuristic analysis
 */

// === CONFIGURATION ===
const BACKEND_URL = 'http://127.0.0.1:3000';
const DEMO_MODE = false; // Disabled: was causing same fake data on every site
const POLICY_KEYWORDS = ['privacy', 'terms', 'policy', 'cookie', 'gdpr', 'consent'];
const CONSENT_BUTTONS = ['accept', 'agree', 'continue', 'sign up', 'create account', 'i agree', 'ok', 'yes'];
const RISK_COLORS = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444' };

// === STATE ===
let policyAnalysis = null;
const CURRENT_DOMAIN = window.location.hostname;

// === SAFETY CHECK - Ensure DOM is Ready ===
(function() {
  if (!document.body) {
    window.addEventListener('load', initializeExtension);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
  } else {
    initializeExtension();
  }
})();

// === INITIALIZATION ===
async function initializeExtension() {
  console.log('🛡️ DCV: Initialized on', CURRENT_DOMAIN);

  // Check if we already have a fresh analysis for this exact domain
  const cached = await getCachedAnalysis();
  if (cached) {
    console.log('⚡ DCV: Using cached analysis for', CURRENT_DOMAIN);
    policyAnalysis = cached;
    updateUIWithAnalysis(cached);
    return;
  }

  await detectAndAnalyzePolicies();
  setupConsentInterception();
}

// === PER-DOMAIN CACHE ===
async function getCachedAnalysis() {
  try {
    const result = await chrome.storage.local.get(['lastAnalysis']);
    const analysis = result.lastAnalysis;
    // Only use cache if it's for the same domain AND less than 15 min old
    if (
      analysis &&
      analysis.domain === CURRENT_DOMAIN &&
      Date.now() - analysis.timestamp < 15 * 60 * 1000
    ) {
      return analysis;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// === POLICY DETECTION ===
async function detectAndAnalyzePolicies() {
  try {
    const policyLinks = findPolicyLinks();

    if (policyLinks.length === 0) {
      console.log('ℹ️ DCV: No policy links detected on', CURRENT_DOMAIN);
      // Still run heuristic on page text so we catch inline policies
      const pageText = extractTextFromPage();
      if (pageText.length > 200) {
        const analysis = heuristicAnalysis(pageText);
        await saveAndDisplayAnalysis(analysis);
      }
      return;
    }

    console.log(`🔍 DCV: Found ${policyLinks.length} policy link(s)`);

    for (const link of policyLinks) {
      try {
        const policyText = await extractPolicyText(link.href);
        if (policyText && policyText.length > 100) {
          await analyzePolicy(policyText, link);
          return; // Only analyze first valid policy link
        }
      } catch (error) {
        console.error('❌ DCV: Error analyzing policy:', error);
      }
    }
  } catch (error) {
    console.error('❌ DCV: Policy detection failed:', error);
  }
}

function findPolicyLinks() {
  try {
    const links = Array.from(document.querySelectorAll('a[href]'));
    return links.filter(link => {
      try {
        const text = (link.textContent + ' ' + (link.title || '')).toLowerCase();
        const href = link.href.toLowerCase();
        return POLICY_KEYWORDS.some(keyword =>
          text.includes(keyword) || href.includes(keyword)
        );
      } catch (e) {
        return false;
      }
    }).slice(0, 3);
  } catch (error) {
    return [];
  }
}

async function extractPolicyText(url) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/fetch-policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) throw new Error('Fetch failed');

    const data = await response.json();
    return data.text;
  } catch (error) {
    console.warn('⚠️ DCV: Could not fetch externally, using page content');
    return extractTextFromPage();
  }
}

function extractTextFromPage() {
  try {
    if (!document.body) return '';
    const text = (document.body.innerText || document.body.textContent || '');
    return text.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim().slice(0, 50000);
  } catch (error) {
    try {
      return (document.documentElement.innerText || '').slice(0, 50000);
    } catch (e) {
      return '';
    }
  }
}

// === ANALYSIS ===
async function analyzePolicy(policyText, linkElement) {
  showAnalysisStatus('Analyzing policy...', 'yellow');

  // Try live backend first
  try {
    const response = await fetch(`${BACKEND_URL}/api/analyze-policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        policy_text: policyText,
        url: linkElement ? linkElement.href : window.location.href
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) throw new Error('Analysis failed');

    policyAnalysis = await response.json();
    await saveAndDisplayAnalysis(policyAnalysis);
    return;

  } catch (error) {
    console.warn('⚠️ DCV: Backend unavailable, using heuristic analysis');
  }

  // Fallback: heuristic analysis on actual page text
  policyAnalysis = heuristicAnalysis(policyText);
  await saveAndDisplayAnalysis(policyAnalysis);
}

async function saveAndDisplayAnalysis(analysis) {
  await chrome.storage.local.set({
    lastAnalysis: {
      ...analysis,
      timestamp: Date.now(),
      domain: CURRENT_DOMAIN   // ← key fix: tag with current domain
    }
  });

  chrome.runtime.sendMessage({
    action: 'updateBadge',
    riskLevel: analysis.risk_level,
    riskCount: analysis.detected_risks?.length || 0
  }).catch(() => {});

  updateUIWithAnalysis(analysis);
}

// === HEURISTIC ANALYSIS (runs on ACTUAL page text) ===
function heuristicAnalysis(text) {
  const lowerText = text.toLowerCase();
  const risks = [];
  const explanations = [];

  const patterns = [
    {
      keywords: ['third-party', 'third party', 'share your data', 'share information with'],
      risk: 'Third-party data sharing',
      sentence: 'Policy mentions sharing data with third parties',
      meaning: 'Your data may be shared with other companies without explicit consent.',
      misuse: ['Targeted advertising', 'Data profiling across platforms'],
      example: 'An ad network could track you across shopping, social, and news apps.'
    },
    {
      keywords: ['track', 'cookie', 'analytics', 'beacon', 'pixel'],
      risk: 'Behavioral tracking',
      sentence: 'Policy mentions tracking technologies',
      meaning: 'Your online activity is being recorded and analyzed.',
      misuse: ['Building detailed user profiles', 'Discriminatory pricing'],
      example: 'You might see higher prices for flights because you searched repeatedly.'
    },
    {
      keywords: ['sell your', 'sell data', 'monetize', 'data broker'],
      risk: 'Data selling',
      sentence: 'Policy mentions selling or monetizing user data',
      meaning: 'Your information may be sold to other companies for profit.',
      misuse: ['Spam campaigns', 'Identity theft risk'],
      example: 'Your email address could end up in cold-call or spam lists.'
    },
    {
      keywords: ['auto-renew', 'auto renew', 'automatically renew', 'automatically charged'],
      risk: 'Auto-renewal subscription',
      sentence: 'Policy mentions automatic subscription renewal',
      meaning: 'Subscriptions renew and charge you automatically.',
      misuse: ['Charging for unwanted services', 'Hidden fees'],
      example: 'You might be charged for a full year before realizing the trial ended.'
    },
    {
      keywords: ['biometric', 'facial recognition', 'fingerprint', 'voice data'],
      risk: 'Biometric data collection',
      sentence: 'Policy mentions biometric data collection',
      meaning: 'Your physical/biological data may be collected.',
      misuse: ['Permanent identification', 'Surveillance'],
      example: 'Your face could be used to identify you in public spaces.'
    },
    {
      keywords: ['location', 'gps', 'geolocation', 'precise location'],
      risk: 'Location tracking',
      sentence: 'Policy mentions location data collection',
      meaning: 'Your physical location may be tracked continuously.',
      misuse: ['Tracking your movements', 'Profiling based on locations visited'],
      example: 'Advertisers could infer your income from the neighborhoods you visit.'
    },
    {
      keywords: ['retain', 'indefinitely', 'store permanently', 'keep your data'],
      risk: 'Indefinite data retention',
      sentence: 'Policy mentions long-term or indefinite data storage',
      meaning: 'Your data may be stored forever with no deletion option.',
      misuse: ['Exposure in future data breaches', 'Profiling over years'],
      example: 'A breach 10 years from now could expose your current data.'
    }
  ];

  patterns.forEach(pattern => {
    if (pattern.keywords.some(kw => lowerText.includes(kw))) {
      risks.push(pattern.risk);
      explanations.push({
        highlighted_sentence: pattern.sentence,
        meaning: pattern.meaning,
        possible_misuse: pattern.misuse,
        real_world_example: pattern.example,
        confidence: 0.75
      });
    }
  });

  const score = Math.min(10, risks.length * 2);

  return {
    risk_score: score,
    risk_level: score >= 7 ? 'HIGH' : score >= 4 ? 'MEDIUM' : 'LOW',
    detected_risks: risks,
    clause_explanations: explanations,
    summary: risks.length > 0
      ? `Found ${risks.length} potential privacy concern(s) on ${CURRENT_DOMAIN}.`
      : `No major privacy risks detected on ${CURRENT_DOMAIN}.`
  };
}

// === UI UPDATES ===
function updateUIWithAnalysis(analysis) {
  const status = analysis.risk_level === 'HIGH' ? 'red' :
                 analysis.risk_level === 'MEDIUM' ? 'yellow' : 'green';
  showAnalysisStatus(`Risk: ${analysis.risk_level} (${analysis.risk_score}/10)`, status);

  if (analysis.risk_level === 'MEDIUM' || analysis.risk_level === 'HIGH') {
    showFloatingBanner(analysis);
  }
}

function showAnalysisStatus(message, color) {
  const existing = document.getElementById('dcv-status');
  if (existing && existing.parentNode) existing.remove();

  const status = document.createElement('div');
  status.id = 'dcv-status';

  const colorMap = { red: '#ef4444', yellow: '#f59e0b', green: '#22c55e' };
  const colorHex = colorMap[color] || '#f59e0b';

  status.style.cssText = `
    position: fixed !important;
    bottom: 20px !important;
    right: 20px !important;
    padding: 12px 20px !important;
    background: white !important;
    border: 2px solid ${colorHex} !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
    font-family: system-ui, -apple-system, sans-serif !important;
    font-size: 14px !important;
    font-weight: 500 !important;
    color: #111827 !important;
    z-index: 2147483640 !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    max-width: 350px !important;
    word-wrap: break-word !important;
    pointer-events: none !important;
  `;

  status.innerHTML = `
    <span style="display:inline-block;width:10px;height:10px;background:${colorHex};border-radius:50%;flex-shrink:0"></span>
    <span>${message}</span>
  `;

  try {
    document.body.appendChild(status);
  } catch (e) {
    return;
  }

  setTimeout(() => {
    if (status && status.parentNode) {
      status.style.transition = 'opacity 0.3s';
      status.style.opacity = '0';
      setTimeout(() => { if (status && status.parentNode) status.remove(); }, 300);
    }
  }, 4000);
}

// === FIXED BANNER: uses transform instead of margin to avoid layout shift ===
function showFloatingBanner(analysis) {
  const existing = document.getElementById('dcv-banner');
  if (existing && existing.parentNode) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'dcv-banner';

  const bgColor = analysis.risk_level === 'HIGH' ? '#fef2f2' : '#fffbeb';
  const borderColor = RISK_COLORS[analysis.risk_level] || '#f59e0b';
  const risksText = (analysis.detected_risks || []).slice(0, 2).join(', ');

  // KEY FIX: Do NOT push page content down. Use position:fixed with no body margin.
  // Use a shadow DOM host so our styles don't bleed into the page and page styles
  // don't bleed into the banner.
  const host = document.createElement('div');
  host.id = 'dcv-banner-host';
  host.style.cssText = `
    all: initial !important;
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    z-index: 2147483640 !important;
    pointer-events: auto !important;
  `;

  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      #banner {
        width: 100%;
        background: ${bgColor};
        border-bottom: 2px solid ${borderColor};
        padding: 10px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        box-sizing: border-box;
      }
      .text-group {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        overflow: hidden;
        min-width: 0;
      }
      .label {
        color: #ef4444;
        font-weight: 600;
        flex-shrink: 0;
      }
      .dot { color: #6b7280; flex-shrink: 0; }
      .risks {
        color: #4b5563;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button {
        background: ${borderColor};
        color: white;
        border: none;
        padding: 7px 14px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 500;
        font-size: 13px;
        margin-left: 12px;
        flex-shrink: 0;
        font-family: system-ui, -apple-system, sans-serif;
      }
      button:hover { opacity: 0.85; }
      .close {
        background: transparent;
        color: #6b7280;
        font-size: 18px;
        padding: 4px 8px;
        margin-left: 4px;
      }
      .close:hover { color: #111; }
    </style>
    <div id="banner">
      <div class="text-group">
        <span class="label">⚠️ Privacy risks detected</span>
        <span class="dot">•</span>
        <span class="risks">${risksText}</span>
      </div>
      <button id="details-btn">View Details</button>
      <button class="close" id="close-btn" title="Dismiss">✕</button>
    </div>
  `;

  shadow.getElementById('details-btn').onclick = () => {
    chrome.runtime.sendMessage({ action: 'openPopup' }).catch(() => {});
  };

  shadow.getElementById('close-btn').onclick = () => {
    host.remove();
  };

  try {
    document.documentElement.appendChild(host); // append to <html>, not <body>
  } catch (e) {
    console.error('❌ DCV: Could not append banner:', e);
    return;
  }

  // Auto-hide after 10 seconds
  setTimeout(() => {
    if (host && host.parentNode) {
      host.style.transition = 'opacity 0.3s';
      host.style.opacity = '0';
      setTimeout(() => { if (host && host.parentNode) host.remove(); }, 300);
    }
  }, 10000);
}

// === CONSENT INTERCEPTION ===
function setupConsentInterception() {
  document.addEventListener('click', (e) => {
    try {
      const target = e.target;
      const button = target.closest('button, [role="button"]');
      if (!button) return;

      const text = (button.textContent + ' ' + (button.title || '')).toLowerCase();
      const isConsentButton = CONSENT_BUTTONS.some(keyword => text.includes(keyword));

      if (isConsentButton && policyAnalysis && policyAnalysis.risk_level === 'HIGH') {
        e.preventDefault();
        e.stopPropagation();
        showConsentModal(policyAnalysis, () => {
          const evt = new MouseEvent('click', { view: window, bubbles: true, cancelable: true });
          button.dispatchEvent(evt);
        });
      }
    } catch (error) {
      console.error('❌ DCV: Consent interception error:', error);
    }
  }, true);
}

function showConsentModal(analysis, onProceed) {
  const existing = document.getElementById('dcv-modal');
  if (existing && existing.parentNode) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'dcv-modal';
  overlay.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    background: rgba(0,0,0,0.5) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    z-index: 2147483647 !important;
    font-family: system-ui, -apple-system, sans-serif !important;
    backdrop-filter: blur(2px) !important;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white !important;
    border-radius: 16px !important;
    padding: 24px !important;
    max-width: 480px !important;
    width: 90% !important;
    max-height: 80vh !important;
    overflow-y: auto !important;
    border-top: 4px solid #ef4444 !important;
    box-shadow: 0 20px 50px rgba(0,0,0,0.3) !important;
  `;

  const risksList = (analysis.detected_risks || []).slice(0, 4)
    .map(r => `<li style="margin:6px 0;color:#4b5563;font-size:14px">${r}</li>`)
    .join('');

  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <div style="width:48px;height:48px;background:#fef2f2;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">⚠️</div>
      <div>
        <h3 style="margin:0;color:#111827;font-size:20px">Privacy Risk Detected</h3>
        <p style="margin:4px 0 0;color:#6b7280;font-size:14px">Risk Score: <strong style="color:#ef4444">${analysis.risk_score}/10 (${analysis.risk_level})</strong></p>
      </div>
    </div>
    <div style="background:#f9fafb;padding:16px;border-radius:8px;margin-bottom:20px">
      <p style="margin:0 0 10px;color:#111827;font-weight:600;font-size:14px">This site may:</p>
      <ul style="margin:0;padding-left:20px">${risksList}</ul>
    </div>
    <div style="display:flex;gap:12px;justify-content:flex-end">
      <button id="dcv-cancel" style="flex:1;padding:12px 20px;background:#f3f4f6;border:none;border-radius:8px;font-weight:600;color:#374151;cursor:pointer;font-size:14px;">Cancel</button>
      <button id="dcv-proceed" style="flex:1;padding:12px 20px;background:#ef4444;border:none;border-radius:8px;font-weight:600;color:white;cursor:pointer;font-size:14px;">Proceed Anyway</button>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#6b7280;text-align:center">💡 Click extension icon for detailed analysis</p>
  `;

  try {
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  } catch (e) {
    return;
  }

  document.getElementById('dcv-cancel').onclick = () => {
    overlay.remove();
    chrome.runtime.sendMessage({ action: 'logInteraction', type: 'consent_cancelled', domain: CURRENT_DOMAIN, riskLevel: 'HIGH' }).catch(() => {});
  };

  document.getElementById('dcv-proceed').onclick = () => {
    overlay.remove();
    onProceed();
    chrome.runtime.sendMessage({ action: 'logInteraction', type: 'consent_proceeded', domain: CURRENT_DOMAIN, riskLevel: 'HIGH' }).catch(() => {});
  };

  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const escHandler = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
}

// === REANALYZE MESSAGE ===
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'reanalyze') {
    // Clear domain cache and rerun
    chrome.storage.local.remove(['lastAnalysis'], () => {
      policyAnalysis = null;
      detectAndAnalyzePolicies();
    });
    sendResponse({ success: true });
  }
  return true;
});

console.log('✅ DCV: Content script loaded on', CURRENT_DOMAIN);