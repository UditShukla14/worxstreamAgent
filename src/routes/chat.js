import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import xlsx from 'xlsx';
import { config } from '../config/index.js';
import { getAnthropicTools, executeMcpTool } from '../mcp/server.js';
import { SYSTEM_PROMPT } from '../agent/systemPrompt.js';
import { extractKeywords, getToolsForKeywords } from '../mcp/tools/keywordMapping.js';
import Conversation from '../models/Conversation.js';
import { manageContextWindow, getContextStats } from '../utils/contextWindow.js';
import { removeOrphanedToolResults } from '../utils/validateMessages.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({ 
  dest: uploadsDir,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

/**
 * Convert Excel file to CSV string
 */
function excelToCsv(filePath) {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return xlsx.utils.sheet_to_csv(sheet);
  } catch (error) {
    console.error('Error converting Excel to CSV:', error);
    throw new Error('Failed to convert Excel file to CSV');
  }
}

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

/**
 * Generate conversation ID
 */
function generateConversationId() {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Normalize messages loaded from database to ensure they're in the correct format for Claude API
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((msg) => msg && msg.role && msg.content !== undefined && msg.content !== null)
    .map((msg) => {
      let content = msg.content;

      // Handle content that might be stored as string (JSON)
      if (typeof content === 'string') {
        try {
          const parsed = JSON.parse(content);
          // Only use parsed if it's an array or object, otherwise keep original string
          if (Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null)) {
            content = parsed;
          }
        } catch {
          // If it's not JSON, keep it as string (for simple text messages)
        }
      }

      // If content is an array (Anthropic format), validate and fix each block
      if (Array.isArray(content)) {
        const normalizedBlocks = content
          .filter((block) => block && typeof block === 'object' && block.type)
          .map((block) => {
            // Validate and fix tool_use blocks
            if (block.type === 'tool_use') {
              // Skip if missing required fields (id and name are required, input can be empty object)
              if (!block.id || !block.name) {
                console.warn('⚠️ Skipping invalid tool_use block (missing id or name):', block);
                return null;
              }
              // Input can be undefined/null/empty - convert to empty object
              const input = block.input === undefined || block.input === null 
                ? {} 
                : (typeof block.input === 'object' ? block.input : {});
              
              return {
                type: 'tool_use',
                id: String(block.id),
                name: String(block.name),
                input: input,
              };
            }

            // Validate and fix tool_result blocks
            if (block.type === 'tool_result') {
              // Skip if missing required fields
              if (!block.tool_use_id || block.content === undefined || block.content === null) {
                console.warn('⚠️ Skipping invalid tool_result block:', block);
                return null;
              }
              return {
                type: 'tool_result',
                tool_use_id: String(block.tool_use_id),
                content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              };
            }

            // Validate and fix text blocks
            if (block.type === 'text') {
              return {
                type: 'text',
                text: String(block.text || ''),
              };
            }

            // Unknown block type - skip it
            console.warn('⚠️ Skipping unknown block type:', block.type);
            return null;
          })
          .filter((block) => block !== null);

        // Only return message if it has valid blocks
        if (normalizedBlocks.length === 0) {
          return null;
        }

        return {
          role: msg.role,
          content: normalizedBlocks,
        };
      }

      // If content is a string (for simple user/assistant messages), that's fine
      if (typeof content === 'string' && content.trim().length > 0) {
        return {
          role: msg.role,
          content: content.trim(),
        };
      }

      // Invalid content format - skip this message
      console.warn('⚠️ Skipping message with invalid content format:', msg);
      return null;
    })
    .filter((msg) => msg !== null);
}

/**
 * Get or create conversation from MongoDB
 */
async function getConversation(conversationId) {
  if (conversationId) {
    try {
      const conversation = await Conversation.findOne({ conversation_id: conversationId });
      if (conversation) {
        const normalizedHistory = normalizeMessages(conversation.messages);
        return { id: conversation.conversation_id, history: normalizedHistory };
      }
    } catch (error) {
      console.error('❌ Error fetching conversation:', error);
    }
  }
  
  const newId = generateConversationId();
  return { id: newId, history: [] };
}

/**
 * Save conversation to MongoDB
 */
async function saveConversation(conversationId, history) {
  try {
    await Conversation.findOneAndUpdate(
      { conversation_id: conversationId },
      {
        conversation_id: conversationId,
        messages: history,
        updated_at: new Date(),
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );
  } catch (error) {
    console.error('❌ Error saving conversation:', error);
    // Don't throw - allow the request to complete even if save fails
  }
}

/**
 * Check if response contains incomplete milestones/tasks
 * Returns true if there are pending milestones that need completion
 * BUT NOT if the agent is asking for user input
 */
function hasIncompleteMilestones(response) {
  if (!response || !response.content) {
    return false;
  }

  const textBlocks = response.content.filter((block) => block.type === 'text');
  const text = textBlocks.map((block) => block.text).join('\n');

  // Check if agent is asking for user input - if so, don't continue automatically
  const isAskingForInput = /(need the following|please provide|I need|what should|which|when does|who will)/i.test(text);
  if (isAskingForInput) {
    console.log('ℹ️  Agent is asking for user input - waiting for response');
    return false; // Don't auto-continue when asking for input
  }

  // Check for <milestones> tag with pending/in_progress status
  const milestonesMatch = text.match(/<milestones>[\s\S]*?<\/milestones>/i);
  if (milestonesMatch) {
    const milestonesText = milestonesMatch[0];
    // Check if any milestone has status="pending" or status="in_progress"
    const hasPending = /status=["'](pending|in_progress)["']/i.test(milestonesText);
    
    // But check if all milestones are pending and agent hasn't started yet
    const allPending = !/status=["'](in_progress|completed)["']/i.test(milestonesText);
    if (allPending && isAskingForInput) {
      // Agent just created milestones and is asking for info - don't continue
      return false;
    }
    
    if (hasPending && !allPending) {
      // Some milestones are in progress or completed, but some are still pending
      console.log('⚠️  Detected incomplete milestones - task not finished');
      return true;
    }
  }

  // Also check for common incomplete task indicators (but not if asking for input)
  const incompleteIndicators = [
    /need to/i,
    /still need/i,
    /next step/i,
    /will now/i,
    /going to/i,
    /let me/i,
  ];

  // Only check if response seems to be mid-task (not a final completion or asking for input)
  const isMidTask = incompleteIndicators.some(pattern => pattern.test(text));
  const hasToolUse = response.stop_reason === 'tool_use';
  
  // If it's mid-task but stopped without tool_use, might be incomplete
  if (isMidTask && !hasToolUse && response.stop_reason === 'end_turn' && !isAskingForInput) {
    console.log('⚠️  Response seems incomplete - checking if continuation needed');
    // Check if the last message suggests more work is needed
    const needsMoreWork = /(need|will|going|let me|next)/i.test(text.slice(-200));
    return needsMoreWork;
  }

  return false;
}

/**
 * POST /api/chat - Regular chat endpoint
 */
router.post('/', async (req, res) => {
  try {
    const { message, conversation_id } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
      });
    }

    const conversation = await getConversation(conversation_id);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`💬 Chat request - Conversation: ${conversation.id}`);
    console.log(`📝 Message: ${message}`);
    console.log(`📚 Loaded conversation history: ${conversation.history.length} messages`);
    if (conversation.history.length > 0) {
      console.log(`   Last ${Math.min(3, conversation.history.length)} message(s):`);
      conversation.history.slice(-3).forEach((msg, idx) => {
        const preview = typeof msg.content === 'string' 
          ? msg.content.substring(0, 100) 
          : JSON.stringify(msg.content).substring(0, 100);
        console.log(`   ${idx + 1}. [${msg.role}]: ${preview}...`);
      });
    }
    console.log('='.repeat(60));

    // Extract keywords and filter tools
    const keywords = extractKeywords(message);
    const filteredToolNames = getToolsForKeywords(keywords);
    const allTools = getAnthropicTools(); // Get total count
    const tools = getAnthropicTools(filteredToolNames);
    
    // Log keyword filtering for debugging
    if (keywords.length > 0) {
      console.log(`🔑 Keywords detected: ${keywords.join(', ')}`);
      console.log(`🔧 Filtered tools: ${filteredToolNames.length} tools available (out of ${allTools.length} total)`);
    } else {
      console.log(`🔧 Using all ${tools.length} tools (no keywords detected)`);
    }

    // Build initial messages array with new user message
    let messages = [
      ...conversation.history,
      { role: 'user', content: message },
    ];

    // Get initial context stats
    const initialStats = getContextStats(messages, SYSTEM_PROMPT, tools);
    console.log(`\n📊 Context Stats (before optimization):`);
    console.log(`   Messages: ${initialStats.messageCount}`);
    console.log(`   Message tokens: ${initialStats.messageTokens}`);
    console.log(`   System tokens: ${initialStats.systemTokens}`);
    console.log(`   Tools tokens: ${initialStats.toolsTokens}`);
    console.log(`   Total tokens: ${initialStats.totalTokens} / ${initialStats.maxTokens}`);

    // Apply context window management
    const originalMessageCount = messages.length;
    messages = manageContextWindow(messages, SYSTEM_PROMPT, tools);
    
    // Remove orphaned tool_result blocks that don't have corresponding tool_use blocks
    const beforeValidation = messages.length;
    messages = removeOrphanedToolResults(messages);
    if (messages.length < beforeValidation) {
      console.log(`\n⚠️  Removed ${beforeValidation - messages.length} orphaned tool_result block(s)`);
    }
    
    const optimizedStats = getContextStats(messages, SYSTEM_PROMPT, tools);

    // Log if truncation occurred
    if (messages.length < originalMessageCount) {
      const truncatedCount = originalMessageCount - messages.length;
      console.log(`\n⚠️  Context window truncated: Removed ${truncatedCount} oldest message(s)`);
      console.log(`   Kept ${messages.length} most recent messages`);
    }

    console.log(`\n📊 Context Stats (after optimization):`);
    console.log(`   Messages: ${optimizedStats.messageCount}`);
    console.log(`   Total tokens: ${optimizedStats.totalTokens} / ${optimizedStats.maxTokens}`);

    // Log what we're sending to Claude for debugging
    if (messages.length > 0) {
      console.log(`\n📤 Sending ${messages.length} messages to Claude:`);
      messages.forEach((msg, idx) => {
        const preview = typeof msg.content === 'string' 
          ? msg.content.substring(0, 150) 
          : Array.isArray(msg.content)
          ? `[${msg.content.length} blocks]`
          : JSON.stringify(msg.content).substring(0, 150);
        console.log(`   ${idx + 1}. [${msg.role}]: ${preview}${preview.length >= 150 ? '...' : ''}`);
      });
    }

    const toolsUsed = [];
    let response;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let iterationCount = 0;
    const MAX_ITERATIONS = 20; // Safety limit to prevent infinite loops

    while (iterationCount < MAX_ITERATIONS) {
      iterationCount++;
      console.log(`\n🔄 Iteration ${iterationCount}/${MAX_ITERATIONS}`);
      console.log('\n📤 Calling Claude...');
      
      response = await anthropic.messages.create({
        model: config.anthropic.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      // Track token usage from Anthropic API response
      if (response.usage) {
        totalInputTokens += response.usage.input_tokens || 0;
        totalOutputTokens += response.usage.output_tokens || 0;
        console.log(`📊 Token usage: ${response.usage.input_tokens} input + ${response.usage.output_tokens} output = ${(response.usage.input_tokens || 0) + (response.usage.output_tokens || 0)} total`);
      }

      console.log(`📥 Claude response - Stop reason: ${response.stop_reason}`);

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block) => block.type === 'tool_use'
        );

        messages.push({ role: 'assistant', content: response.content });

        const toolResults = [];
        
        for (const toolUse of toolUseBlocks) {
          console.log(`\n🔧 Claude wants to use: ${toolUse.name}`);
          
          const result = await executeMcpTool(toolUse.name, toolUse.input);
          
          toolsUsed.push({
            name: toolUse.name,
            input: toolUse.input,
            result: result,
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result, null, 2),
          });
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Check if there are incomplete milestones/tasks
      const hasIncomplete = hasIncompleteMilestones(response);
      if (hasIncomplete && response.stop_reason === 'end_turn') {
        console.log('🔄 Task incomplete - prompting agent to continue...');
        // Add a prompt to continue the task
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ 
          role: 'user', 
          content: 'Please continue and complete all remaining milestones. Do not stop until the task is fully finished.' 
        });
        continue;
      }

      break;
    }

    if (iterationCount >= MAX_ITERATIONS) {
      console.warn('⚠️  Reached maximum iteration limit - stopping to prevent infinite loop');
    }

    const textBlocks = response.content.filter((block) => block.type === 'text');
    const finalResponse = textBlocks.map((block) => block.text).join('\n');
    messages.push({ role: 'assistant', content: response.content });

    // Save conversation
    await saveConversation(conversation.id, messages);

    console.log('\n✅ Final response generated');
    console.log(`📊 Tools used: ${toolsUsed.length}`);
    console.log(`📊 Total tokens: ${totalInputTokens} input + ${totalOutputTokens} output = ${totalInputTokens + totalOutputTokens} total`);

    res.json({
      success: true,
      response: finalResponse,
      tools_used: toolsUsed.map((t) => ({
        name: t.name,
        input: t.input,
        success: t.result.success,
      })),
      conversation_id: conversation.id,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
      },
    });
  } catch (error) {
    console.error('❌ Chat error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/chat/stream - Streaming chat endpoint with SSE
 * Supports file uploads for price comparison
 */
router.post('/stream', upload.fields([
  { name: 'oldFile', maxCount: 1 },
  { name: 'newFile', maxCount: 1 }
]), async (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  let oldFilePath = null;
  let newFilePath = null;

  try {
    const { message, conversation_id } = req.body;

    // Handle file uploads for price comparison
    let fileContentBlocks = [];
    let enhancedMessage = message || '';

    if (req.files?.oldFile && req.files?.newFile) {
      oldFilePath = req.files.oldFile[0].path;
      newFilePath = req.files.newFile[0].path;

      try {
        // Convert Excel files to CSV
        const oldCsv = excelToCsv(oldFilePath);
        const newCsv = excelToCsv(newFilePath);

        // Create file content for Claude
        const fileComparisonPrompt = `Please compare these two stock/price files and provide a detailed analysis.

**OLD FILE (${req.files.oldFile[0].originalname}):**
\`\`\`csv
${oldCsv}
\`\`\`

**NEW FILE (${req.files.newFile[0].originalname}):**
\`\`\`csv
${newCsv}
\`\`\`

Please analyze and identify:
1. Products added (in new file but not in old file)
2. Products removed (in old file but not in new file)
3. Cost price changes (old vs new cost)
4. Sales price changes (old vs new sales price)
5. Margin changes (old vs new margin percentage)
6. Calculate percentage changes for all price modifications
7. Provide business insights on pricing strategy and profitability impacts

Format your response with clear sections, tables where appropriate, and actionable insights.`;

        enhancedMessage = message 
          ? `${message}\n\n${fileComparisonPrompt}`
          : fileComparisonPrompt;

        console.log(`📁 Processing files: ${req.files.oldFile[0].originalname} and ${req.files.newFile[0].originalname}`);
      } catch (fileError) {
        console.error('File processing error:', fileError);
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to process files: ' + fileError.message })}\n\n`);
        res.end();
        return;
      } finally {
        // Cleanup uploaded files
        if (oldFilePath) {
          try { fs.unlinkSync(oldFilePath); } catch {}
        }
        if (newFilePath) {
          try { fs.unlinkSync(newFilePath); } catch {}
        }
      }
    }

    if (!enhancedMessage && !req.files) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Message or files are required' })}\n\n`);
      res.end();
      return;
    }

    const conversation = await getConversation(conversation_id);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`💬 Streaming chat request - Conversation: ${conversation.id}`);
    console.log(`📝 Message: ${message || '(file comparison)'}`);
    if (req.files?.oldFile && req.files?.newFile) {
      console.log(`📁 Files: ${req.files.oldFile[0].originalname} vs ${req.files.newFile[0].originalname}`);
    }
    console.log(`📚 Loaded conversation history: ${conversation.history.length} messages`);
    if (conversation.history.length > 0) {
      console.log(`   Last ${Math.min(3, conversation.history.length)} message(s):`);
      conversation.history.slice(-3).forEach((msg, idx) => {
        const preview = typeof msg.content === 'string' 
          ? msg.content.substring(0, 100) 
          : JSON.stringify(msg.content).substring(0, 100);
        console.log(`   ${idx + 1}. [${msg.role}]: ${preview}...`);
      });
    }
    console.log('='.repeat(60));

    // Send conversation ID immediately
    res.write(`data: ${JSON.stringify({ type: 'conversation_id', conversation_id: conversation.id })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'start', message: 'Processing your request...' })}\n\n`);

    // Extract keywords and filter tools (use enhanced message for keyword extraction)
    const keywords = extractKeywords(enhancedMessage);
    const filteredToolNames = getToolsForKeywords(keywords);
    const allTools = getAnthropicTools(); // Get total count
    const tools = getAnthropicTools(filteredToolNames);
    
    // Log keyword filtering for debugging
    if (keywords.length > 0) {
      console.log(`🔑 Keywords detected: ${keywords.join(', ')}`);
      console.log(`🔧 Filtered tools: ${filteredToolNames.length} tools available (out of ${allTools.length} total)`);
    } else {
      console.log(`🔧 Using all ${tools.length} tools (no keywords detected)`);
    }

    // Build initial messages array with enhanced user message
    let messages = [
      ...conversation.history,
      { role: 'user', content: enhancedMessage },
    ];

    // Get initial context stats
    const initialStats = getContextStats(messages, SYSTEM_PROMPT, tools);
    console.log(`\n📊 Context Stats (before optimization):`);
    console.log(`   Messages: ${initialStats.messageCount}`);
    console.log(`   Message tokens: ${initialStats.messageTokens}`);
    console.log(`   System tokens: ${initialStats.systemTokens}`);
    console.log(`   Tools tokens: ${initialStats.toolsTokens}`);
    console.log(`   Total tokens: ${initialStats.totalTokens} / ${initialStats.maxTokens}`);

    // Apply context window management
    const originalMessageCount = messages.length;
    messages = manageContextWindow(messages, SYSTEM_PROMPT, tools);
    
    // Remove orphaned tool_result blocks that don't have corresponding tool_use blocks
    const beforeValidation = messages.length;
    messages = removeOrphanedToolResults(messages);
    if (messages.length < beforeValidation) {
      console.log(`\n⚠️  Removed ${beforeValidation - messages.length} orphaned tool_result block(s)`);
    }
    
    const optimizedStats = getContextStats(messages, SYSTEM_PROMPT, tools);

    // Log if truncation occurred
    if (messages.length < originalMessageCount) {
      const truncatedCount = originalMessageCount - messages.length;
      console.log(`\n⚠️  Context window truncated: Removed ${truncatedCount} oldest message(s)`);
      console.log(`   Kept ${messages.length} most recent messages`);
    }

    console.log(`\n📊 Context Stats (after optimization):`);
    console.log(`   Messages: ${optimizedStats.messageCount}`);
    console.log(`   Total tokens: ${optimizedStats.totalTokens} / ${optimizedStats.maxTokens}`);

    // Log what we're sending to Claude for debugging
    if (messages.length > 0) {
      console.log(`\n📤 Sending ${messages.length} messages to Claude:`);
      messages.forEach((msg, idx) => {
        const preview = typeof msg.content === 'string' 
          ? msg.content.substring(0, 150) 
          : Array.isArray(msg.content)
          ? `[${msg.content.length} blocks]`
          : JSON.stringify(msg.content).substring(0, 150);
        console.log(`   ${idx + 1}. [${msg.role}]: ${preview}${preview.length >= 150 ? '...' : ''}`);
      });
    }

    const toolsUsed = [];
    let iterationCount = 0;
    const MAX_ITERATIONS = 20; // Safety limit to prevent infinite loops

    while (iterationCount < MAX_ITERATIONS) {
      iterationCount++;
      console.log(`\n🔄 Iteration ${iterationCount}/${MAX_ITERATIONS}`);
      console.log('\n📤 Calling Claude...');
      
      const response = await anthropic.messages.create({
        model: config.anthropic.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      console.log(`📥 Claude response - Stop reason: ${response.stop_reason}`);

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block) => block.type === 'tool_use'
        );

        messages.push({ role: 'assistant', content: response.content });

        const toolResults = [];
        
        for (const toolUse of toolUseBlocks) {
          console.log(`\n🔧 Claude wants to use: ${toolUse.name}`);
          
          // Send tool use event
          res.write(`data: ${JSON.stringify({ 
            type: 'tool_use', 
            tool: toolUse.name,
            input: toolUse.input
          })}\n\n`);
          
          const result = await executeMcpTool(toolUse.name, toolUse.input);
          
          toolsUsed.push({
            name: toolUse.name,
            input: toolUse.input,
            result: result,
          });

          // Send tool result event
          res.write(`data: ${JSON.stringify({ 
            type: 'tool_result', 
            tool: toolUse.name,
            success: result.success
          })}\n\n`);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result, null, 2),
          });
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Check if there are incomplete milestones/tasks
      const hasIncomplete = hasIncompleteMilestones(response);
      if (hasIncomplete && response.stop_reason === 'end_turn') {
        console.log('🔄 Task incomplete - prompting agent to continue...');
        // Add a prompt to continue the task
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ 
          role: 'user', 
          content: 'Please continue and complete all remaining milestones. Do not stop until the task is fully finished.' 
        });
        continue;
      }

      // Final response - stream it
      console.log('\n📤 Streaming final response...');
      
      const stream = await anthropic.messages.stream({
        model: config.anthropic.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          res.write(`data: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`);
        }
      }

      // Get the final message for conversation history
      const finalMessage = await stream.finalMessage();
      messages.push({ role: 'assistant', content: finalMessage.content });

      // Save conversation
      await saveConversation(conversation.id, messages);

      console.log('\n✅ Streaming complete');
      console.log(`📊 Tools used: ${toolsUsed.length}`);

      // Send completion event
      res.write(`data: ${JSON.stringify({ 
        type: 'done', 
        toolsUsed: toolsUsed.map(t => ({
          name: t.name,
          input: t.input,
          success: t.result.success
        }))
      })}\n\n`);

      break;
    }

    if (iterationCount >= MAX_ITERATIONS) {
      console.warn('⚠️  Reached maximum iteration limit - stopping to prevent infinite loop');
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Maximum iteration limit reached' })}\n\n`);
    }

    res.end();
  } catch (error) {
    console.error('❌ Streaming chat error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * DELETE /api/chat/:conversation_id - Delete conversation
 */
router.delete('/:conversation_id', async (req, res) => {
  try {
    const { conversation_id } = req.params;
    
    const result = await Conversation.deleteOne({ conversation_id });
    
    if (result.deletedCount > 0) {
      res.json({ success: true, message: 'Conversation deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Conversation not found' });
    }
  } catch (error) {
    console.error('❌ Error deleting conversation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/chat - Get all conversations list
 */
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const conversations = await Conversation.find()
      .sort({ updated_at: -1 })
      .limit(limit)
      .select('conversation_id created_at updated_at messages')
      .lean();
    
    const conversationsList = conversations.map((conv) => {
      // Get the first user message as preview
      const messages = conv.messages || [];
      const firstUserMessage = messages.find((msg) => msg.role === 'user');
      let preview = 'New conversation';
      
      if (firstUserMessage) {
        if (typeof firstUserMessage.content === 'string') {
          preview = firstUserMessage.content.substring(0, 100);
        } else {
          preview = JSON.stringify(firstUserMessage.content).substring(0, 100);
        }
      }
      
      return {
        conversation_id: conv.conversation_id,
        preview,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        message_count: messages.length,
      };
    });
    
    res.json({
      success: true,
      conversations: conversationsList,
    });
  } catch (error) {
    console.error('❌ Error fetching conversations list:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/chat/:conversation_id - Get conversation history
 */
router.get('/:conversation_id', async (req, res) => {
  try {
    const { conversation_id } = req.params;
    
    const conversation = await Conversation.findOne({ conversation_id });
    
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }
    
    res.json({
      success: true,
      conversation_id: conversation.conversation_id,
      messages: conversation.messages,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
    });
  } catch (error) {
    console.error('❌ Error fetching conversation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
