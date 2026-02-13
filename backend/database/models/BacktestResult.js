import mongoose from 'mongoose';

const backtestResultSchema = new mongoose.Schema(
  {
    strategyName: { type: String, required: true, trim: true },
    symbol: { type: String, required: true, trim: true },
    timeframe: { type: String, required: true, trim: true },
    totalTrades: { type: Number, required: true, min: 0 },
    winRate: { type: Number, required: true },
    totalPnL: { type: Number, required: true },
    maxDrawdown: { type: Number, required: true },
    sharpeRatio: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const BacktestResult = mongoose.model('BacktestResult', backtestResultSchema);
