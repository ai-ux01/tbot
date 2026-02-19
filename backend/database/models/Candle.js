import mongoose from 'mongoose';

/**
 * Candle schema. All timestamps are stored in UTC.
 * Convert to IST (or any timezone) only for display.
 */
const candleSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, trim: true },
    tradingsymbol: { type: String, trim: true },
    timeframe: { type: String, required: true, trim: true },
    open: { type: Number, required: true },
    high: { type: Number, required: true },
    low: { type: Number, required: true },
    close: { type: Number, required: true },
    volume: { type: Number, default: 0 },
    time: { type: Date, required: true }, // UTC
  },
  { timestamps: true }
);

candleSchema.index({ symbol: 1, timeframe: 1, time: 1 }, { unique: true });

export const Candle = mongoose.model('Candle', candleSchema);
