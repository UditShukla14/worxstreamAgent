/**
 * Per-user coworker preferences (cross-session).
 */

import mongoose from 'mongoose';

const userPreferencesSchema = new mongoose.Schema({
  company_id: { type: String, required: true },
  user_id: { type: String, required: true },
  preferences: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  updated_at: { type: Date, default: Date.now },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

userPreferencesSchema.index({ company_id: 1, user_id: 1 }, { unique: true });

const UserPreferences = mongoose.model('UserPreferences', userPreferencesSchema);
export default UserPreferences;
