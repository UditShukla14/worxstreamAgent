/**
 * Conversation Model
 */

import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    required: true,
    enum: ['user', 'assistant', 'system'],
  },
  content: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  // Compact per-turn tool transcript: [{ tool, input, ok, error? }].
  // Replayed into agent history so later turns know what was already
  // called, what worked, and what failed (Cursor/Claude-style memory).
  tool_activity: {
    type: [mongoose.Schema.Types.Mixed],
    default: undefined,
  },
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  // Worxstream tenant + user scoping so conversations are isolated
  company_id: {
    type: String,
    required: true,
  },
  user_id: {
    type: String,
    required: true,
  },
  conversation_id: {
    type: String,
    required: true,
  },
  messages: {
    type: [messageSchema],
    default: [],
  },
  conversation_summary: {
    type: String,
    default: '',
  },
  summary_through_turn: {
    type: Number,
    default: 0,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

// Update updated_at before saving
conversationSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Compound index so a conversation_id is unique per (company_id, user_id)
conversationSchema.index({ company_id: 1, user_id: 1, conversation_id: 1 }, { unique: true });
// Index for efficient per-user/company listing by recency
conversationSchema.index({ company_id: 1, user_id: 1, updated_at: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);

export default Conversation;

