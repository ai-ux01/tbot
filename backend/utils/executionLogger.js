/**
 * NEW IMPROVEMENTS: Structured execution logging with IDs, duration, and error classification.
 * Use for swing/portfolio flows; does not replace existing logger for intraday.
 */

import { randomUUID } from 'crypto';
import { logger } from '../logger.js';

/** Error classification for metrics and alerting. */
export const ErrorCategory = Object.freeze({
  DATA: 'DATA',
  STRATEGY: 'STRATEGY',
  EXECUTION: 'EXECUTION',
  RISK: 'RISK',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Create an execution context for a single evaluation/run.
 * @param {string} [prefix] - e.g. 'swing', 'backtest'
 * @returns {{ executionId: string, startTime: number, log: (msg: string, meta?: object) => void, end: (meta?: object) => void, error: (category: string, msg: string, meta?: object) => void }}
 */
export function createExecutionContext(prefix = 'exec') {
  const executionId = `${prefix}_${randomUUID().slice(0, 8)}`;
  const startTime = Date.now();

  return {
    executionId,
    startTime,
    log(msg, meta = undefined) {
      logger.info(msg, { executionId, ...meta });
    },
    end(meta = undefined) {
      const durationMs = Date.now() - startTime;
      logger.info('Execution completed', { executionId, durationMs, ...meta });
    },
    error(category, msg, meta = undefined) {
      const durationMs = Date.now() - startTime;
      logger.error(msg, {
        executionId,
        durationMs,
        errorCategory: category in ErrorCategory ? category : ErrorCategory.UNKNOWN,
        ...meta,
      });
    },
  };
}

export default createExecutionContext;
