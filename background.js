// Background service worker for Digital Consent Verifier

chrome.runtime.onInstalled.addListener((details) => {
  console.log('✅ Analies installed');
  
  // Initialize storage
  chrome.storage.local.set({
    settings: {
      enableFloatingBanner: true,
      enableConsentInterception: true,
      enableHighlights: true,
      backendUrl: 'http://127.0.0.1:3000'
    },
    interactionHistory: [],
    siteAnalyses: {}
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Background received:', request.action);
  
  switch (request.action) {
    case 'updateBadge':
      updateBadge(request.riskLevel, request.riskCount);
      sendResponse({ success: true });
      break;
      
    case 'openPopup':
      chrome.action.openPopup();
      sendResponse({ success: true });
      break;
      
    case 'logInteraction':
      logInteraction(request);
      sendResponse({ success: true });
      break;
      
    case 'getHistory':
      getRiskHistory(sendResponse);
      return true;
      
    default:
      sendResponse({ error: 'Unknown action' });
  }
});

function updateBadge(riskLevel, riskCount) {
  const colors = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444' };
  
  chrome.action.setBadgeText({ 
    text: riskCount > 0 ? riskCount.toString() : '' 
  });
  chrome.action.setBadgeBackgroundColor({ 
    color: colors[riskLevel] || '#6b7280' 
  });
}

async function logInteraction({ type, domain, riskLevel }) {
  try {
    const result = await chrome.storage.local.get(['interactionHistory']);
    const history = result.interactionHistory || [];
    
    history.unshift({
      timestamp: Date.now(),
      domain,
      type,
      riskLevel
    });
    
    if (history.length > 50) history.pop();
    
    await chrome.storage.local.set({ interactionHistory: history });
  } catch (error) {
    console.error('Failed to log interaction:', error);
  }
}

function getRiskHistory(sendResponse) {
  chrome.storage.local.get(['interactionHistory', 'siteAnalyses'], (result) => {
    sendResponse({
      interactions: result.interactionHistory || [],
      analyses: result.siteAnalyses || {}
    });
  });
}