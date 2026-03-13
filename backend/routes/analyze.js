const express = require('express');
const router = express.Router();
const { analyzeWithOpenAI } = require('../utils/nlpAnalyzer');

const rateLimit = new Map();
const RATE_LIMIT_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 20;

function checkRateLimit(ip) {
  const now = Date.now();
  const userRequests = rateLimit.get(ip) || [];
  const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_MS);
  
  if (recentRequests.length >= MAX_REQUESTS) {
    return false;
  }
  
  recentRequests.push(now);
  rateLimit.set(ip, recentRequests);
  return true;
}

router.post('/analyze-policy', async (req, res) => {
  const { policy_text, url } = req.body;
  const clientIP = req.ip || req.connection.remoteAddress;
  
  if (!policy_text || policy_text.length < 100) {
    return res.status(400).json({ 
      error: 'Policy text is required (min 100 chars)' 
    });
  }
  
  if (!checkRateLimit(clientIP)) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded. Try again later.' 
    });
  }
  
  console.log(`🔍 Analyzing policy (${policy_text.length} chars)`);
  
  try {
    const analysis = await analyzeWithOpenAI(policy_text);
    
    analysis.analyzed_at = new Date().toISOString();
    analysis.source_url = url;
    
    console.log(`✅ Analysis complete: ${analysis.risk_level} (${analysis.risk_score}/10)`);
    
    res.json(analysis);
    
  } catch (error) {
    console.error('❌ Analysis error:', error.message);
    
    // Fallback
    const fallback = heuristicAnalysis(policy_text);
    fallback.fallback_mode = true;
    res.json(fallback);
  }
});

function heuristicAnalysis(text) {
  const lowerText = text.toLowerCase();
  const risks = [];
  const explanations = [];
  
  const patterns = [
    {
      keywords: ['third-party', 'share', 'partner'],
      risk: 'Third-party data sharing',
      meaning: 'Your data may be shared with other companies.',
      misuse: ['Targeted advertising', 'Data profiling'],
      example: 'An ad company could track you across sites.'
    },
    {
      keywords: ['track', 'cookie', 'analytics'],
      risk: 'Behavioral tracking',
      meaning: 'Your online activity is monitored.',
      misuse: ['Building user profiles', 'Predicting behavior'],
      example: 'Your shopping habits could be used for pricing.'
    },
    {
      keywords: ['sell', 'monetize'],
      risk: 'Data selling',
      meaning: 'Your information may be sold for profit.',
      misuse: ['Spam', 'Identity theft risk'],
      example: 'Your email could end up in spam lists.'
    },
    {
      keywords: ['auto', 'renew', 'subscription'],
      risk: 'Auto-renewal',
      meaning: 'Subscriptions renew automatically.',
      misuse: ['Charging for unwanted services'],
      example: 'You might be charged before trial ends.'
    }
  ];
  
  patterns.forEach(pattern => {
    if (pattern.keywords.some(kw => lowerText.includes(kw))) {
      risks.push(pattern.risk);
      explanations.push({
        highlighted_sentence: `Policy mentions: ${pattern.keywords[0]}`,
        meaning: pattern.meaning,
        possible_misuse: pattern.misuse,
        real_world_example: pattern.example,
        confidence: 0.7
      });
    }
  });
  
  const score = Math.min(10, risks.length * 2);
  
  return {
    risk_score: score,
    risk_level: score >= 7 ? 'HIGH' : score >= 4 ? 'MEDIUM' : 'LOW',
    detected_risks: risks,
    clause_explanations: explanations,
    summary: `Found ${risks.length} potential privacy concern(s).`
  };
}

module.exports = router;