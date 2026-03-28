import mongoose from 'mongoose';

/**
 * Persisted closed paper trades (virtual portfolio). Bucketed by exit month (UTC + Asia/Kolkata).
 */
const paperTradeSchema = new mongoose.Schema(
  {
    portfolioId: { type: String, default: 'default', trim: true, index: true },
    paperPositionId: { type: String, trim: true, index: true },
    setupId: { type: String, required: true, trim: true, index: true },
    symbol: { type: String, required: true, trim: true },
    tradingsymbol: { type: String, trim: true },
    qty: { type: Number, required: true },
    entryPrice: { type: Number, required: true },
    exitPrice: { type: Number, required: true },
    investedAmount: { type: Number, required: true },
    proceedsAmount: { type: Number, required: true },
    openedAt: { type: Date, required: true },
    closedAt: { type: Date, required: true, index: true },
    /** Calendar month of exit in UTC, `YYYY-MM` */
    exitMonthUtc: { type: String, required: true, index: true },
    /** Calendar month of exit in Asia/Kolkata, `YYYY-MM` */
    exitMonthIst: { type: String, required: true, index: true },
    realizedPnl: { type: Number, required: true },
    returnPct: { type: Number, default: null },
    exitReason: { type: String, trim: true },
    orderValueInr: { type: Number, default: null },
    initialCapitalSnapshot: { type: Number, default: null },
    entrySnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    exitSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

paperTradeSchema.index({ portfolioId: 1, exitMonthIst: -1, closedAt: -1 });
paperTradeSchema.index({ portfolioId: 1, exitMonthUtc: -1, closedAt: -1 });

export const PaperTrade = mongoose.model('PaperTrade', paperTradeSchema);
