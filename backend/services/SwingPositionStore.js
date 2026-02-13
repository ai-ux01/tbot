/**
 * NEW SWING BOT CODE
 * Persist swing positions and registry. Survives server restart. JSON file storage.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SWING_DATA_DIR ?? path.join(__dirname, '..', 'data');
const POSITIONS_FILE = path.join(DATA_DIR, 'swing-positions.json');
const REGISTRY_FILE = path.join(DATA_DIR, 'swing-registry.json');

const DEFAULT_POSITIONS = { positions: [] };
const DEFAULT_REGISTRY = { instruments: [] };

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(filePath, defaultValue) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    return data ?? defaultValue;
  } catch (e) {
    if (e?.code === 'ENOENT') return defaultValue;
    logger.warn('SwingPositionStore', { msg: 'read failed', path: filePath, error: e?.message });
    return defaultValue;
  }
}

async function writeJson(filePath, data) {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Position record for one instrument.
 * @typedef {{ instrumentToken: string, entryPrice: number, quantity: number, entryDate: string, status: 'OPEN'|'CLOSED' }} SwingPosition
 */

/**
 * Registry entry for scheduled evaluation.
 * @typedef {{ sessionId: string, instrumentToken: string, instrument: { exchangeSegment: string, tradingSymbol: string } }} SwingRegistryEntry
 */
export class SwingPositionStore {
  /**
   * Get open position for instrument, or null.
   * @param {string} instrumentToken
   * @returns {Promise<SwingPosition|null>}
   */
  static async getOpenPosition(instrumentToken) {
    const key = String(instrumentToken).trim();
    const { positions } = await readJson(POSITIONS_FILE, DEFAULT_POSITIONS);
    const open = (positions ?? []).find((p) => p.instrumentToken === key && p.status === 'OPEN');
    return open ? { ...open } : null;
  }

  /**
   * Get all open positions.
   * @returns {Promise<SwingPosition[]>}
   */
  static async getAllOpenPositions() {
    const { positions } = await readJson(POSITIONS_FILE, DEFAULT_POSITIONS);
    return (positions ?? []).filter((p) => p.status === 'OPEN');
  }

  /**
   * Save a new open position (or replace existing open for same instrument).
   * @param {Omit<SwingPosition, 'status'> & { status?: 'OPEN' }} data
   */
  static async setPosition(data) {
    const { positions } = await readJson(POSITIONS_FILE, DEFAULT_POSITIONS);
    const list = positions ?? [];
    const key = String(data.instrumentToken).trim();
    const without = list.filter((p) => !(p.instrumentToken === key && p.status === 'OPEN'));
    without.push({
      instrumentToken: key,
      entryPrice: Number(data.entryPrice),
      quantity: Number(data.quantity),
      entryDate: data.entryDate ?? new Date().toISOString().slice(0, 10),
      status: 'OPEN',
    });
    await writeJson(POSITIONS_FILE, { positions: without });
  }

  /**
   * Mark position as CLOSED for instrument.
   * @param {string} instrumentToken
   */
  static async closePosition(instrumentToken) {
    const key = String(instrumentToken).trim();
    const { positions } = await readJson(POSITIONS_FILE, DEFAULT_POSITIONS);
    const list = (positions ?? []).map((p) =>
      p.instrumentToken === key && p.status === 'OPEN' ? { ...p, status: 'CLOSED' } : p
    );
    await writeJson(POSITIONS_FILE, { positions: list });
  }

  /**
   * Get registered instruments for scheduler.
   * @returns {Promise<SwingRegistryEntry[]>}
   */
  static async getRegistry() {
    const { instruments } = await readJson(REGISTRY_FILE, DEFAULT_REGISTRY);
    return Array.isArray(instruments) ? instruments : [];
  }

  /**
   * Register instrument for daily swing evaluation.
   * @param {SwingRegistryEntry} entry
   */
  static async register(entry) {
    const list = await this.getRegistry();
    const key = String(entry.instrumentToken).trim();
    const without = list.filter((e) => String(e.instrumentToken).trim() !== key);
    without.push({
      sessionId: String(entry.sessionId),
      instrumentToken: key,
      instrument: {
        exchangeSegment: entry.instrument?.exchangeSegment ?? 'nse_cm',
        tradingSymbol: entry.instrument?.tradingSymbol ?? '',
      },
    });
    await writeJson(REGISTRY_FILE, { instruments: without });
  }

  /**
   * Unregister instrument.
   * @param {string} instrumentToken
   */
  static async unregister(instrumentToken) {
    const list = await this.getRegistry();
    const key = String(instrumentToken).trim();
    const filtered = list.filter((e) => String(e.instrumentToken).trim() !== key);
    await writeJson(REGISTRY_FILE, { instruments: filtered });
  }
}
