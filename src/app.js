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

// Middleware
app.use(cors());
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
    
    app.listen(config.server.port, () => {
      console.log('\n' + '='.repeat(60));
      console.log('🚀 Worxstream AI Agent Server');
      console.log('='.repeat(60));
      console.log(`📍 Server running on http://localhost:${config.server.port}`);
      console.log(`🤖 Using model: ${config.anthropic.model}`);
      console.log(`🔧 Available MCP tools: ${getAvailableTools().length}`);
      console.log(`📦 MongoDB connected`);
      console.log('='.repeat(60));
      console.log('\nEndpoints:');
      console.log(`  POST /api/chat        - Send a message to the AI agent`);
      console.log(`  POST /api/chat/stream - Send a message with streaming response (SSE)`);
      console.log(`  GET  /api/chat/:id    - Get conversation history`);
      console.log(`  DELETE /api/chat/:id  - Delete conversation`);
      console.log(`  GET  /api/tools       - List available tools`);
      console.log(`  GET  /health          - Health check`);
      console.log('='.repeat(60) + '\n');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

export { app, startServer };
