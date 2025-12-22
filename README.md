# Worxstream AI Agent

An AI-powered assistant that uses Claude with MCP (Model Context Protocol) to interact with your Worxstream APIs.

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  React Frontend │────▶│  Express + MCP  │────▶│   Claude API    │
│   (Streaming)   │     │     Server      │     │   (Anthropic)   │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                │
                                │ MCP Tool Execution
                                ▼
                       ┌─────────────────┐
                       │   Worxstream    │
                       │  Backend APIs   │
                       └─────────────────┘
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Backend dependencies
npm install

# Frontend dependencies
cd client && npm install
```

### 2. Configure Environment

Create a `.env` file in the root directory:

```env
# Anthropic API Key (get from https://console.anthropic.com/)
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Worxstream API Configuration
WORXSTREAM_BASE_URL=https://api.worxstream.io
WORXSTREAM_API_TOKEN=your_access_token_here

# Default company/user IDs
DEFAULT_COMPANY_ID=1
DEFAULT_USER_ID=1

# Server Port
PORT=3000
```

### 3. Start the Server

```bash
# Start backend
npm start

# In a new terminal, start frontend
cd client && npm run dev
```

### 4. Open the App

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000`

## 📁 Project Structure

```
worxstreamAgent/
├── src/                          # Backend source
│   ├── index.js                  # Entry point
│   ├── app.js                    # Express application
│   ├── config/
│   │   └── index.js              # Configuration
│   ├── agent/
│   │   └── systemPrompt.js       # Claude system prompt
│   ├── mcp/
│   │   ├── server.js             # MCP server instance
│   │   └── tools/                # MCP tool definitions
│   │       ├── index.js          # Tools registry
│   │       ├── subscriptions.js  # Subscription tools
│   │       ├── company.js        # Company/branch tools
│   │       ├── hr.js             # HR tools
│   │       ├── products.js       # Product tools
│   │       ├── customers.js      # Customer tools
│   │       ├── vendors.js        # Vendor tools
│   │       ├── finance.js        # Finance tools
│   │       └── config.js         # Config/framework tools
│   ├── routes/
│   │   ├── index.js              # Route configuration
│   │   ├── chat.js               # Chat endpoints (+ streaming)
│   │   ├── tools.js              # Tools endpoint
│   │   └── health.js             # Health check
│   ├── middleware/
│   │   └── errorHandler.js       # Error handling
│   └── services/
│       └── httpClient.js         # Worxstream API client
├── client/                       # React frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/           # React components
│   │   ├── hooks/                # Custom hooks (streaming)
│   │   ├── styles/               # CSS
│   │   └── utils/                # Utilities (XML parser)
│   ├── package.json
│   └── vite.config.ts
├── public/
│   └── index.html                # Legacy HTML UI
├── package.json
└── README.md
```

## 📚 API Endpoints

### Chat with the Agent

```
POST /api/chat
```

Request:
```json
{
  "message": "Show me all customers",
  "conversation_id": "optional-id-to-continue-conversation"
}
```

Response:
```json
{
  "success": true,
  "response": "Here are your customers...",
  "tools_used": [
    {
      "name": "list_customers",
      "input": {},
      "success": true
    }
  ],
  "conversation_id": "conv_1234567890_abc123"
}
```

### Streaming Chat (SSE)

```
POST /api/chat/stream
```

Same request format, returns Server-Sent Events:
- `conversation_id` - Initial conversation ID
- `start` - Processing started
- `tool_use` - Tool being executed
- `tool_result` - Tool execution result
- `text` - Streaming text content
- `done` - Response complete
- `error` - Error occurred

### List Available Tools

```
GET /api/tools
```

### Health Check

```
GET /health
```

## 🔧 MCP Tools

The agent uses Model Context Protocol (MCP) SDK for tool management:

### Subscriptions
- `list_subscriptions` - Get all subscription plans
- `get_active_subscriptions` - Get active plans

### Products & Services
- `list_product_categories` - Get categories
- `create_product_category` - Create category
- `list_products` - List products/services
- `create_product` - Create product
- `get_product_details` - Get details

### Customers & Contacts
- `list_customers` - List customers
- `list_contacts` - List contacts
- `create_contact` - Create contact
- `get_customer_details` - Get details

### Vendors
- `list_vendors` - List vendors
- `get_vendor_details` - Get details

### Organization
- `get_company_details` - Company info
- `list_branches` - List branches
- `create_branch` - Create branch

### HR
- `list_departments` - Departments
- `list_teams` - Teams
- `list_team_members` - Team members
- `get_hr_statistics` - HR stats

### Finance
- `list_taxes` - Tax configurations
- `list_chart_of_accounts` - Chart of accounts
- `list_payment_instructions` - Payment instructions

## 🆕 Adding New Tools

With the MCP SDK, adding tools is simple:

```javascript
// src/mcp/tools/myTools.js
import { z } from 'zod';
import { callWorxstreamAPI } from '../../services/httpClient.js';

export function registerMyTools(server) {
  server.registerTool(
    'my_tool_name',
    {
      title: 'My Tool',
      description: 'What this tool does',
      inputSchema: {
        param1: z.string().describe('Parameter description'),
        param2: z.number().optional().describe('Optional param'),
      },
    },
    async ({ param1, param2 }) => {
      const result = await callWorxstreamAPI({
        method: 'POST',
        endpoint: '/api/endpoint',
        data: { param1, param2 },
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
  );
}
```

Then register in `src/mcp/tools/index.js`:

```javascript
import { registerMyTools } from './myTools.js';

export function registerAllTools(server) {
  // ... existing registrations
  registerMyTools(server);
}
```

## 🔐 Security Notes

- Never expose your `ANTHROPIC_API_KEY` to the frontend
- Add authentication to the `/api/chat` endpoint in production
- Validate and sanitize all user inputs
- Consider rate limiting for the chat endpoint

## 🚀 Production Deployment

1. Use a proper database for conversation history (Redis, PostgreSQL)
2. Add authentication middleware
3. Set up rate limiting
4. Use environment-specific configurations
5. Add logging and monitoring
6. Build the React frontend: `cd client && npm run build`

## 🆘 Troubleshooting

**"ANTHROPIC_API_KEY is required"**
- Make sure you have a `.env` file with your API key

**"API calls failing"**
- Check your `WORXSTREAM_API_TOKEN` is valid
- Verify `WORXSTREAM_BASE_URL` is correct

**"Connection error in UI"**
- Make sure the backend is running on port 3000
- Check for CORS issues if using a different frontend origin

## 📜 License

MIT
