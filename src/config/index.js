const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'openrouter/free',
    referer: process.env.OPENROUTER_REFERER || 'http://localhost:3000',
    appName: process.env.OPENROUTER_APP_NAME || 'CHESSINVEST',
    reasoningEffort: process.env.OPENROUTER_REASONING_EFFORT || 'none',
    embedModel: process.env.OPENROUTER_EMBED_MODEL || 'openai/text-embedding-3-small',
    models: {
      free: process.env.MODEL_FREE || '',
      basic: process.env.MODEL_BASIC || '',
      pro: process.env.MODEL_PRO || '',
      premium: process.env.MODEL_PREMIUM || '',
    },
    fallbackModel: process.env.MODEL_FALLBACK || 'openrouter/free',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    channelId: process.env.TELEGRAM_CHANNEL_ID || '',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  },
  supabase: {
    url: process.env.SUPABASE_PROJECT_URL || '',
    anonKey: process.env.SUPABASE_ANON_PUBLIC || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE || '',
    databaseUrl: process.env.DATABASE_URL || '',
  },
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
};

config.jwtSecret = process.env.JWT_SECRET || 'chessinvest_dev_secret_change_in_production';
config.sslKeyPath = process.env.SSL_KEY_PATH || '';
config.sslCertPath = process.env.SSL_CERT_PATH || '';
config.appUrl = process.env.APP_URL || 'http://localhost:3000';

module.exports = config;
