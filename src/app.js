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

// Import tools to trigger registration
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
    
    app.listen(config.server.port, '0.0.0.0', () => {
      console.log('\n' + '='.repeat(60));
      console.log('🚀 Worxstream AI Agent Server');
      console.log('='.repeat(60));
      console.log(`📍 Server running on http://0.0.0.0:${config.server.port}`);
      if (config.server.publicUrl) {
        console.log(`🌐 Public URL: ${config.server.publicUrl}`);
      }
      console.log(`🤖 Using model: ${config.anthropic.model}`);
      console.log(`🔧 Available MCP tools: ${getAvailableTools().length}`);
      console.log(`📦 MongoDB connected`);
      console.log('='.repeat(60));
      console.log('\nEndpoints:');
      console.log(`  POST ${config.server.publicUrl}/api/chat        - Send a message to the AI agent`);
      console.log(`  POST ${config.server.publicUrl}/api/chat/stream - Send a message with streaming response (SSE)`);
      console.log(`  GET  ${config.server.publicUrl}/api/chat/:id    - Get conversation history`);
      console.log(`  DELETE ${config.server.publicUrl}/api/chat/:id  - Delete conversation`);
      console.log(`  GET  ${config.server.publicUrl}/api/tools       - List available tools`);
      console.log(`  GET  ${config.server.publicUrl}/health          - Health check`);
      console.log('='.repeat(60) + '\n');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

export { app, startServer };
