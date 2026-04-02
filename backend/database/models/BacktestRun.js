import mongoose from 'mongoose';

/**
 * Full backtest API responses (signals hub, bot engine, swing). Params exclude huge candle arrays.
 */
const backtestRunSchema = new mongoose.Schema(
  {
    route: { type: String, required: true, trim: true, index: true },
    method: { type: String, required: true, trim: true, default: 'GET' },
    /** Sanitized query + body (candles replaced with length metadata). */
    params: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Response JSON as returned to the client (may be truncated for size). */
    response: { type: mongoose.Schema.Types.Mixed, required: true },
    truncated: { type: Boolean, default: false },
    truncationNote: { type: String, trim: true, default: null },
  },
  { timestamps: true },
);

backtestRunSchema.index({ createdAt: -1 });

export const BacktestRun = mongoose.model('BacktestRun', backtestRunSchema);
