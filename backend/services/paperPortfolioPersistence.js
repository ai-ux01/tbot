/**
 * Persist open paper portfolio (cash + positions) to MongoDB for process restarts.
 */

import { PaperPortfolioState } from '../database/models/PaperPortfolioState.js';
import { isDbConnected } from '../database/connection.js';
import { logger } from '../logger.js';

/**
 * @param {import('./PaperTradingStore.js').PaperTradingStore} store
 * @param {string} [portfolioId]
 */
export async function savePaperPortfolioState(store, portfolioId = 'default') {
  if (!isDbConnected() || !store) return;
  try {
    const state = store.getState();
    await PaperPortfolioState.findOneAndUpdate(
      { portfolioId },
      {
        $set: {
          initialCapital: state.initialCapital,
          cash: state.cash,
          positions: state.positions,
        },
      },
      { upsert: true },
    );
  } catch (err) {
    logger.warn('paperPortfolioPersistence: save failed', { error: err?.message });
  }
}

/**
 * @param {import('./PaperTradingStore.js').PaperTradingStore} store
 * @param {string} [portfolioId]
 * @returns {Promise<boolean>} true if a document was loaded
 */
export async function loadPaperPortfolioStateIntoStore(store, portfolioId = 'default') {
  if (!isDbConnected() || !store) return false;
  try {
    const doc = await PaperPortfolioState.findOne({ portfolioId }).lean();
    if (!doc) return false;
    store.hydrateFromPersistence({
      initialCapital: doc.initialCapital,
      cash: doc.cash,
      positions: doc.positions,
    });
    return true;
  } catch (err) {
    logger.warn('paperPortfolioPersistence: load failed', { error: err?.message });
    return false;
  }
}
