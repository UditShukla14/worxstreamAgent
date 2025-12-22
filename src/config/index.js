/**
 * Application Configuration
 */

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  },
  worxstream: {
    baseUrl: process.env.WORXSTREAM_BASE_URL || 'https://api.worxstream.io',
    apiToken: process.env.WORXSTREAM_API_TOKEN,
    defaultCompanyId: process.env.DEFAULT_COMPANY_ID || '1',
    defaultUserId: process.env.DEFAULT_USER_ID || '1',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
  database: {
    url: process.env.MONGODB_URL || 'mongodb+srv://doadmin:94f0Pq2rX1768uKe@db-mongodb-nyc1-38465-c4ba6c32.mongo.ondigitalocean.com/?authSource=admin',
  },
  contextWindow: {
    maxMessages: parseInt(process.env.MAX_CONTEXT_MESSAGES || '50', 10),
    maxTokens: parseInt(process.env.MAX_CONTEXT_TOKENS || '150000', 10),
    reserveTokens: parseInt(process.env.RESERVE_TOKENS || '10000', 10),
  },
};

// Validation
export function validateConfig() {
  const errors = [];

  if (!config.anthropic.apiKey) {
    errors.push('ANTHROPIC_API_KEY is required');
  }

  if (!config.worxstream.apiToken) {
    console.warn('⚠️  WORXSTREAM_API_TOKEN not set - API calls will fail');
  }

  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach(err => console.error(`   - ${err}`));
    process.exit(1);
  }
}
