/**
 * Execution Layer: Broker reconciliation. Fetch broker positions, compare with DB/file store, log discrepancies.
 * NEW IMPROVEMENTS: Daily sync; auto-correct or log mismatches for manual review.
 */

import * as kotakApi from './kotakApi.js';
import { SwingPositionStore } from './SwingPositionStore.js';
import { getOpenSwingTrade } from './SwingTradeJournal.js';
import { isDbConnected } from '../database/connection.js';
import { logger } from '../logger.js';

/**
 * BrokerSyncService – Compares broker positions with internal state (SwingPositionStore + optional swing_trades).
 * Does not auto-correct by default; logs discrepancies. Caller can implement auto-correct if desired.
 */
export class BrokerSyncService {
  /**
   * Fetch broker positions (CNC/holdings or positions) and compare with our open swing positions.
   * @param {{ baseUrl: string, auth: string, sid: string }} session
   * @returns {Promise<{ brokerPositions: object[], ourPositions: object[], discrepancies: object[], error?: string }>}
   */
  static async reconcile(session) {
    const result = {
      brokerPositions: [],
      ourPositions: [],
      discrepancies: [],
    };

    let brokerPositions = [];
    try {
      const holdings = await kotakApi.getHoldings(session.baseUrl, session.auth, session.sid);
      const positions = await kotakApi.getPositions(session.baseUrl, session.auth, session.sid);
      const holdingList = holdings?.data ?? holdings?.positionDetails ?? Array.isArray(holdings) ? holdings : [];
      const positionList = positions?.data ?? positions ?? Array.isArray(positions) ? positions : [];
      brokerPositions = [...(Array.isArray(holdingList) ? holdingList : []), ...(Array.isArray(positionList) ? positionList : [])];
    } catch (err) {
      logger.error('BrokerSyncService: failed to fetch broker positions', {
        error: err?.message,
        errorCategory: 'EXECUTION',
      });
      result.error = err?.message;
      return result;
    }

    const ourPositions = await SwingPositionStore.getAllOpenPositions();
    result.brokerPositions = brokerPositions;
    result.ourPositions = ourPositions;

    for (const ours of ourPositions) {
      const token = ours.instrumentToken;
      const brokerMatch = brokerPositions.find(
        (p) =>
          String(p?.instrumentToken ?? p?.tradingSymbol ?? '').trim() === token ||
          String(p?.symbol ?? '').trim() === token
      );
      const qtyOurs = Number(ours.quantity ?? 0);
      const qtyBroker = brokerMatch
        ? Number(brokerMatch.quantity ?? brokerMatch.t1Quantity ?? brokerMatch.netQuantity ?? 0)
        : 0;
      if (qtyBroker === 0 && qtyOurs > 0) {
        result.discrepancies.push({
          type: 'MISSING_ON_BROKER',
          instrumentToken: token,
          ourQuantity: qtyOurs,
          brokerQuantity: 0,
          message: 'We have open position but broker shows zero',
        });
      } else if (qtyBroker > 0 && qtyOurs === 0) {
        result.discrepancies.push({
          type: 'EXTRA_ON_BROKER',
          instrumentToken: token,
          ourQuantity: 0,
          brokerQuantity: qtyBroker,
          message: 'Broker has position not in our store',
        });
      } else if (qtyBroker !== qtyOurs) {
        result.discrepancies.push({
          type: 'QUANTITY_MISMATCH',
          instrumentToken: token,
          ourQuantity: qtyOurs,
          brokerQuantity: qtyBroker,
          message: `Quantity mismatch: us=${qtyOurs} broker=${qtyBroker}`,
        });
      }
    }

    for (const d of result.discrepancies) {
      logger.warn('BrokerSyncService discrepancy', {
        type: d.type,
        instrumentToken: d.instrumentToken,
        ourQuantity: d.ourQuantity,
        brokerQuantity: d.brokerQuantity,
        message: d.message,
      });
    }

    if (isDbConnected()) {
      for (const ours of ourPositions) {
        const dbOpen = await getOpenSwingTrade(ours.instrumentToken);
        if (!dbOpen && ours.quantity > 0) {
          result.discrepancies.push({
            type: 'DB_JOURNAL_MISSING_OPEN',
            instrumentToken: ours.instrumentToken,
            message: 'SwingPositionStore has open position but swing_trades has no OPEN for this instrument',
          });
        }
      }
    }

    return result;
  }
}

export default BrokerSyncService;
