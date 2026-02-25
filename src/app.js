/**
 * Worxstream AI Agent - Express Application
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config, validateConfig } from './config/index.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { getAvailableTools } from './mcp/server.js';
import { connectDB } from './db/connection.js';
import { initializeAgents, getAgentKeys } from './agents/index.js';

// Import tools to trigger registration (must happen before agent init)
import './mcp/tools/index.js';

// Validate configuration
validateConfig();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create Express app
const app = express();

// CORS: use CORS_ORIGINS from env (comma-separated). In development, if unset, allow all.
const allowedOrigins = config.server.corsOrigins
  ? config.server.corsOrigins.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) return callback(null, true);
    if (config.server.env === 'development' && allowedOrigins.length === 0) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  exposedHeaders: ['Content-Length', 'X-Request-ID'],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Serve static files from public directory
app.use(express.static(join(__dirname, '../public')));

// Mount routes
app.use(routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
async function startServer() {
  try {
    // Connect to MongoDB
    await connectDB();

    // Initialize multi-agent system (after MCP tools are registered)
    initializeAgents();

    app.listen(config.server.port, '0.0.0.0', () => {
      const agentKeys = getAgentKeys();
      const url = config.server.publicUrl;

      console.log('\n' + '='.repeat(60));
      console.log('🚀 Worxstream AI Agent Server');
      console.log('='.repeat(60));
      console.log(`📍 Server running on http://0.0.0.0:${config.server.port}`);
      if (url) {
        console.log(`🌐 Public URL: ${url}`);
      }
      console.log(`🤖 Using model: ${config.anthropic.model}`);
      console.log(`🔧 Available MCP tools: ${getAvailableTools().length}`);
      console.log(`🤖 Specialist agents: ${agentKeys.length} (${agentKeys.join(', ')})`);
      console.log(`📦 MongoDB connected`);
      console.log('='.repeat(60));
      console.log('\nEndpoints:');
      console.log(`  POST   ${url}/api/chat             - Single-agent chat (legacy)`);
      console.log(`  POST   ${url}/api/chat/stream       - Single-agent streaming (legacy)`);
      console.log(`  GET    ${url}/api/agents             - List all agents`);
      console.log(`  POST   ${url}/api/agents/stream      - Auto-route + SSE streaming`);
      console.log(`  POST   ${url}/api/agents/route       - Auto-route to agent(s)`);
      console.log(`  POST   ${url}/api/agents/:key        - Call a specific agent`);
      console.log(`  POST   ${url}/api/agents/multi       - Call multiple agents`);
      console.log(`  GET    ${url}/api/tools              - List available tools`);
      console.log(`  GET    ${url}/api/rex/dashboard      - Rex: agent stats (JSON)`);
      console.log(`  GET    ${url}/api/rex/stream         - Rex: real-time SSE feed`);
      console.log(`  GET    ${url}/health                 - Health check`);
      console.log('='.repeat(60));
      console.log('🦖 Rex admin dashboard: open /rex in the frontend');
      console.log('='.repeat(60) + '\n');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

export { app, startServer };
