import mongoose from 'mongoose';

/**
 * Single-document snapshot of the in-memory paper portfolio (open positions + cash).
 * Closed trades are stored separately in PaperTrade.
 */
const paperPortfolioStateSchema = new mongoose.Schema(
  {
    portfolioId: { type: String, required: true, unique: true, default: 'default', trim: true },
    initialCapital: { type: Number, required: true },
    cash: { type: Number, required: true },
    /** Open positions (same shape as PaperTradingStore positions) */
    positions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

export const PaperPortfolioState = mongoose.model('PaperPortfolioState', paperPortfolioStateSchema);
