import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema(
  {
    signalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Signal', required: true },
    instrument: { type: String, required: true, trim: true },
    timeframe: { type: String, required: true, trim: true },
    signal_type: { type: String, required: true, enum: ['BUY', 'SELL'] },
    confidence: { type: Number, required: true },
    delivered: { type: Boolean, default: false },
    webhookSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

alertSchema.index({ instrument: 1, timeframe: 1, signal_type: 1, createdAt: -1 });

export const Alert = mongoose.model('Alert', alertSchema);
