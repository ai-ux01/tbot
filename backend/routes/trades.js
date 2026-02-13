import { Router } from 'express';
import { Trade } from '../database/models/Trade.js';
import { isDbConnected } from '../database/connection.js';
import { logger } from '../logger.js';

const router = Router();
const LIMIT = 50;

/**
 * GET /api/trades
 * Last 50 trades, sorted by timestamp descending.
 */
router.get('/', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const trades = await Trade.find()
      .sort({ timestamp: -1 })
      .limit(LIMIT)
      .lean()
      .exec();
    res.json(trades);
  } catch (err) {
    logger.error('GET /api/trades', { error: err?.message });
    res.status(502).json({ error: err?.message ?? 'Failed to fetch trades' });
  }
});

export default router;
