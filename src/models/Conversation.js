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
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  conversation_id: {
    type: String,
    required: true,
    unique: true,
  },
  messages: {
    type: [messageSchema],
    default: [],
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

// Index for efficient queries (unique: true already creates an index on conversation_id)
conversationSchema.index({ created_at: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);

export default Conversation;

