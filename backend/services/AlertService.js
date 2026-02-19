/**
 * Alert Engine: event-driven. Listens for high-confidence signals, saves alert, optional webhook.
 * Prevents duplicate alerts within a timeframe.
 */

import { EventEmitter } from 'events';
import { Alert } from '../database/models/Alert.js';
import { logger } from '../logger.js';

const DEDUP_MINUTES = 15;
const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';

let singleton = null;

export function getAlertService() {
  if (!singleton) {
    singleton = new AlertService();
  }
  return singleton;
}

class AlertService extends EventEmitter {
  constructor() {
    super();
    this._onSignal = this._onSignal.bind(this);
    this.on('signal', this._onSignal);
  }

  async _onSignal(signalDoc) {
    if (!signalDoc || signalDoc.signal_type === 'HOLD') return;
    const { _id, instrument, timeframe, signal_type, confidence } = signalDoc;
    try {
      const recent = await Alert.findOne({
        instrument,
        timeframe,
        signal_type,
        createdAt: { $gte: new Date(Date.now() - DEDUP_MINUTES * 60 * 1000) },
      }).lean();
      if (recent) {
        logger.info('AlertService: duplicate suppressed', { instrument, timeframe, signal_type });
        return;
      }
      const alert = await Alert.create({
        signalId: _id,
        instrument,
        timeframe,
        signal_type,
        confidence,
      });
      logger.info('AlertService: alert saved', {
        alertId: alert._id,
        instrument,
        timeframe,
        signal_type,
        confidence,
      });
      if (WEBHOOK_URL) {
        try {
          const axios = (await import('axios')).default;
          await axios.post(
            WEBHOOK_URL,
            {
              event: 'trading_signal',
              instrument,
              timeframe,
              signal_type,
              confidence,
              explanation: signalDoc.explanation,
              pattern: signalDoc.pattern,
            },
            { timeout: 5000 }
          );
          await Alert.updateOne({ _id: alert._id }, { webhookSent: true });
        } catch (err) {
          logger.warn('AlertService: webhook failed', { error: err?.message });
        }
      }
      await Alert.updateOne({ _id: alert._id }, { delivered: true });
    } catch (err) {
      logger.error('AlertService: error', { error: err?.message });
    }
  }
}

export default { getAlertService };
