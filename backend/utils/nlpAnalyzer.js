const Groq = require('groq-sdk');

const groq = process.env.OPENAI_API_KEY ? new Groq({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

async function analyzeWithOpenAI(policyText) {
  if (!groq) {
    throw new Error('Groq API key not configured');
  }
  
  const truncatedText = policyText.slice(0, 25000);
  
  const systemPrompt = `You are a privacy policy expert. Analyze this policy and detect risky clauses.

Return ONLY valid JSON in this format:
{
  "risk_score": 0-10,
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "detected_risks": ["risk 1", "risk 2"],
  "clause_explanations": [
    {
      "highlighted_sentence": "exact clause text",
      "meaning": "simple explanation",
      "possible_misuse": ["misuse 1", "misuse 2"],
      "real_world_example": "concrete example",
      "confidence": 0.0-1.0
    }
  ],
  "summary": "one sentence summary"
}

Focus on: third-party sharing, tracking, data selling, auto-renewals, biometric data, location tracking.`;

  const userPrompt = `Analyze this privacy policy:\n\n${truncatedText}`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });
    
    const result = completion.choices[0].message.content;
    const analysis = JSON.parse(result);
    
    return validateAnalysis(analysis);
    
  } catch (error) {
    console.error('Groq analysis failed:', error.message);
    throw error;
  }
}

function validateAnalysis(analysis) {
  if (!analysis.risk_score && analysis.risk_score !== 0) {
    analysis.risk_score = 5;
  }
  
  analysis.risk_score = Math.max(0, Math.min(10, Number(analysis.risk_score)));
  
  if (!analysis.risk_level) {
    analysis.risk_level = analysis.risk_score >= 7 ? 'HIGH' : 
                         analysis.risk_score >= 4 ? 'MEDIUM' : 'LOW';
  }
  
  analysis.detected_risks = Array.isArray(analysis.detected_risks) 
    ? analysis.detected_risks 
    : [];
    
  analysis.clause_explanations = Array.isArray(analysis.clause_explanations)
    ? analysis.clause_explanations.map(exp => ({
        highlighted_sentence: exp.highlighted_sentence || 'Clause text unavailable',
        meaning: exp.meaning || 'Explanation not available',
        possible_misuse: Array.isArray(exp.possible_misuse) ? exp.possible_misuse : ['Potential misuse not specified'],
        real_world_example: exp.real_world_example || 'Example not provided',
        confidence: typeof exp.confidence === 'number' ? Math.max(0, Math.min(1, exp.confidence)) : 0.5
      }))
    : [];
  
  if (!analysis.summary) {
    const riskCount = analysis.clause_explanations.length;
    analysis.summary = riskCount > 0
      ? `Detected ${riskCount} clause(s) that may pose privacy risks.`
      : 'No high-risk clauses detected.';
  }
  
  return analysis;
}

module.exports = {
  analyzeWithOpenAI,
  validateAnalysis
};