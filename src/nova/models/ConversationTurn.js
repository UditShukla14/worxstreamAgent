/**
 * ConversationTurn — one user request + agent response (Claude/ChatGPT-style).
 *
 * Separates:
 * - user / ui     → chat display
 * - transcript    → Anthropic tool loop for next-turn agent memory
 * - log           → tools, plan, usage, status (observability)
 *
 * Conversation.messages stays the UI timeline; turns are the source of truth
 * for agent history when present.
 */

import mongoose from 'mongoose';

const conversationTurnSchema = new mongoose.Schema({
  company_id: { type: String, required: true },
  user_id: { type: String, required: true },
  conversation_id: { type: String, required: true },
  /** 0-based order within the conversation */
  turn_index: { type: Number, required: true },
  turn_id: { type: String, required: true },
  request_id: { type: String, default: null },

  user: {
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    at: { type: Date, default: Date.now },
  },

  /** Formatted assistant content for the chat UI (tables/cards/XML). */
  ui: {
    content: { type: mongoose.Schema.Types.Mixed, default: '' },
  },

  /**
   * Anthropic-style messages for this turn only (tool_use / tool_result / text).
   * Does not include the user text (stored in `user`) or UI formatter output.
   */
  transcript: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },

  log: {
    status: {
      type: String,
      enum: ['completed', 'clarify', 'plan_clarify', 'pending_confirmation', 'waiting_continue', 'error'],
      default: 'completed',
    },
    mode: { type: String, default: 'orchestrator' },
    agent_key: { type: String, default: 'nova' },
    agents: { type: [String], default: undefined },
    plan: { type: mongoose.Schema.Types.Mixed, default: undefined },
    tools: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    usage: { type: mongoose.Schema.Types.Mixed, default: undefined },
    error: { type: String, default: undefined },
  },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

conversationTurnSchema.index(
  { company_id: 1, user_id: 1, conversation_id: 1, turn_index: 1 },
  { unique: true },
);
conversationTurnSchema.index(
  { company_id: 1, user_id: 1, conversation_id: 1, created_at: 1 },
);

const ConversationTurn = mongoose.model('ConversationTurn', conversationTurnSchema);

export default ConversationTurn;
