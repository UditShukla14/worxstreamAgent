/**
 * Small key/value settings for Nova billing, edited by Worxstream staff in the admin dashboard.
 * Today one document: key "pricing" (volume-discount tiers, custom-amount limits, the typical cost of a request).
 */

import mongoose from 'mongoose';

const novaSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'nova_settings', timestamps: false },
);

const NovaSetting = mongoose.models.NovaSetting || mongoose.model('NovaSetting', novaSettingSchema);
export default NovaSetting;
