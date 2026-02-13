import mongoose from 'mongoose';

const tradeSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, trim: true },
    strategyName: { type: String, required: true, trim: true },
    side: { type: String, required: true, enum: ['BUY', 'SELL'] },
    quantity: { type: Number, required: true, min: 0 },
    entryPrice: { type: Number, required: true, min: 0 },
    exitPrice: { type: Number, default: null },
    stopLoss: { type: Number, default: null },
    target: { type: Number, default: null },
    pnl: { type: Number, default: null },
    status: { type: String, required: true, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Trade = mongoose.model('Trade', tradeSchema);
