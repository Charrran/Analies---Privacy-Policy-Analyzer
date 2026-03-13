# Backend Configuration
PORT=3000
NODE_ENV=development

# OpenAI API (Get from https://platform.openai.com/api-keys)
OPENAI_API_KEY=sk-your-key-here

# Optional: Hugging Face alternative
# HUGGINGFACE_API_KEY=hf_xxx
# HUGGINGFACE_MODEL=facebook/bart-large-cnn

# CORS Settings (for development)
ALLOWED_ORIGINS=http://localhost:3000,chrome-extension://*

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100