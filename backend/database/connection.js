/**
 * MongoDB connection using mongoose.
 * Use connectDb() on server startup; disconnectDb() on shutdown.
 * URI from environment variable MONGODB_URI.
 */

import mongoose from 'mongoose';
import { logger } from '../logger.js';

let isConnected = false;

/**
 * Connect to MongoDB. Call on server startup.
 * If MONGODB_URI is not set, skips connection and returns null (no throw).
 * @param {string} [uri] - Override env MONGODB_URI
 * @returns {Promise<mongoose.Mongoose | null>}
 */
export async function connectDb(uri) {
  const mongoUri = (uri ?? process.env.MONGODB_URI)?.trim();
  if (!mongoUri) {
    logger.warn('Database connection', { msg: 'MONGODB_URI not set; skipping' });
    return null;
  }

  if (isConnected && mongoose.connection.readyState === 1) {
    logger.info('Database connection', { msg: 'already connected' });
    return mongoose;
  }

  try {
    mongoose.connection.on('error', (err) => {
      logger.error('Database connection error', { error: err?.message });
    });
    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      logger.warn('Database connection', { msg: 'disconnected' });
    });

    await mongoose.connect(mongoUri.trim(), {
      serverSelectionTimeoutMS: 10000,
    });
    isConnected = true;
    logger.info('Database connection', { msg: 'connected', host: mongoose.connection.host });
    return mongoose;
  } catch (err) {
    isConnected = false;
    const message = err?.message ?? String(err);
    logger.error('Database connection failed', { error: message });
    throw err;
  }
}

/**
 * Disconnect from MongoDB. Call on server shutdown.
 * @returns {Promise<void>}
 */
export async function disconnectDb() {
  if (!isConnected && mongoose.connection.readyState === 0) {
    return;
  }
  try {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('Database connection', { msg: 'disconnected' });
  } catch (err) {
    logger.error('Database disconnect error', { error: err?.message });
    throw err;
  }
}

/** @returns {boolean} */
export function isDbConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}
