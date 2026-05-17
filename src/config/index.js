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
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
};

config.jwtSecret = process.env.JWT_SECRET || 'chessinvest_dev_secret_change_in_production';
config.sslKeyPath = process.env.SSL_KEY_PATH || '';
config.sslCertPath = process.env.SSL_CERT_PATH || '';

module.exports = config;
