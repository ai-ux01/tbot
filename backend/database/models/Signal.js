import mongoose from 'mongoose';

const signalSchema = new mongoose.Schema(
  {
    instrument: { type: String, required: true, trim: true },
    tradingsymbol: { type: String, trim: true },
    timeframe: { type: String, required: true, trim: true },
    signal_type: { type: String, required: true, enum: ['BUY', 'SELL', 'HOLD'] },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    explanation: { type: String, default: '' },
    pattern: {
      name: { type: String, default: '' },
      probability: { type: Number, default: 0 },
    },
    trend_prediction: { type: String, trim: true },
    indicators: {
      ema20: Number,
      ema50: Number,
      ema200: Number,
      rsi: Number,
      ruleSignal: String,
      indicatorStrength: Number,
    },
    candleTime: { type: Date },
  },
  { timestamps: true }
);

signalSchema.index({ instrument: 1, timeframe: 1, createdAt: -1 });
signalSchema.index({ signal_type: 1, createdAt: -1 });

export const Signal = mongoose.model('Signal', signalSchema);
