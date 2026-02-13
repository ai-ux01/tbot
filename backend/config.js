import dotenv from 'dotenv';

dotenv.config();

export const KOTAK_LOGIN_BASE = 'https://mis.kotaksecurities.com/login/1.0';
export const NEO_FIN_KEY = 'neotradeapi';

export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};
