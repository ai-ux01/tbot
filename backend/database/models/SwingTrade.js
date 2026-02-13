/**
 * Trade journal: swing_trades collection.
 * NEW IMPROVEMENTS: Log on entry and exit; schema for analytics (rMultiple, durationDays).
 */

import mongoose from 'mongoose';

const swingTradeSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, trim: true },
    instrumentToken: { type: String, required: true, trim: true },
    entryDate: { type: Date, required: true },
    exitDate: { type: Date, default: null },
    entryPrice: { type: Number, required: true, min: 0 },
    exitPrice: { type: Number, default: null },
    quantity: { type: Number, required: true, min: 0 },
    pnl: { type: Number, default: null },
    rMultiple: { type: Number, default: null },
    durationDays: { type: Number, default: null },
    status: { type: String, required: true, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
  },
  { timestamps: true }
);

swingTradeSchema.index({ instrumentToken: 1, status: 1 });
swingTradeSchema.index({ entryDate: -1 });
swingTradeSchema.index({ status: 1, exitDate: -1 });

export const SwingTrade = mongoose.model('SwingTrade', swingTradeSchema, 'swing_trades');
