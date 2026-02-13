import mongoose from 'mongoose';

const candleSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, trim: true },
    timeframe: { type: String, required: true, trim: true },
    open: { type: Number, required: true },
    high: { type: Number, required: true },
    low: { type: Number, required: true },
    close: { type: Number, required: true },
    volume: { type: Number, default: 0 },
    time: { type: Date, required: true },
  },
  { timestamps: true }
);

candleSchema.index({ symbol: 1, timeframe: 1, time: 1 }, { unique: true });

export const Candle = mongoose.model('Candle', candleSchema);
