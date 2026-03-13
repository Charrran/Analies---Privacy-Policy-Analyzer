require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const analyzeRouter = require('./routes/analyze');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', analyzeRouter);

app.post('/api/fetch-policy', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Analies)'
      },
      timeout: 10000
    });
    
    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, header, iframe').remove();
    
    let content = $('main, article, [role="main"], .content').text();
    
    if (!content || content.length < 100) {
      content = $('body').text();
    }
    
    const cleanedText = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .trim()
      .slice(0, 50000);
    
    res.json({ 
      success: true, 
      text: cleanedText,
      url,
      length: cleanedText.length
    });
    
  } catch (error) {
    console.error('Fetch policy error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch policy',
      details: error.message 
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🛡️ Backend running on port ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api/health`);
});