import mongoose from 'mongoose';

const syncCheckpointSchema = new mongoose.Schema(
  {
    scope: { type: String, required: true, trim: true },
    symbol: { type: String, required: true, trim: true },
    timeframe: { type: String, required: true, trim: true },
    lastSyncedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

syncCheckpointSchema.index({ scope: 1, symbol: 1, timeframe: 1 }, { unique: true });

export const SyncCheckpoint = mongoose.model('SyncCheckpoint', syncCheckpointSchema);
