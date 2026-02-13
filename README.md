# Kotak Securities API – React + Node

React frontend and Node (Express) backend that implement the Kotak Securities trade API using the fixed endpoints and flows from your cURL examples.

## What’s included

- **Backend** (`/backend`): Express server that proxies Kotak APIs.
  - Login: TOTP → viewToken/viewSid; MPIN validate → Auth, Sid, baseUrl.
  - Orders: place, modify, cancel, exit cover, exit bracket (all `application/x-www-form-urlencoded` with `jData`).
  - Reports: order book (GET), order history (POST), trade book, positions, holdings (GET).
  - Quotes and Scripmaster: GET with **only** `Authorization` (no `neo-fin-key`, Auth, Sid).

- **Frontend** (`/frontend`): React app with login flow and examples for orders, reports, and quotes.
  - Session (Auth, Sid, baseUrl) stored in context + sessionStorage after MPIN.
  - Access token is set first (used for TOTP/MPIN and for Quotes/Scripmaster).

## Run

**Backend**

```bash
cd backend
npm install
cp .env.example .env   # optional: set PORT, CORS_ORIGIN
npm run dev
```

Runs at `http://localhost:4000`.

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173` and proxies `/api` to the backend.

## Env / secrets

- **Access token**: Set in the UI (Login step 1). Do not hardcode; use your OAuth/API token.
- **Backend**: Optional `.env`: `PORT`, `CORS_ORIGIN` (default `http://localhost:5173`).

## cURL → Node/React mapping

| Flow | cURL | Backend | Frontend |
|------|------|---------|----------|
| TOTP login | `POST mis.kotaksecurities.com/.../tradeApiLogin` + JSON body | `POST /api/kotak/login/totp` (body: mobileNumber, ucc, totp; header: `Authorization: Bearer <access_token>`) | `api/kotak.js` → `totpLogin()` |
| MPIN validate | `POST .../tradeApiValidate` + headers sid, Auth (viewToken) + JSON mpin | `POST /api/kotak/login/mpin` (headers: sid, auth; body: mpin) | `mpinValidate()` |
| Place order | `POST <baseUrl>/quick/order/rule/ms/place` + form `jData=...` | `POST /api/kotak/orders/place` (headers: Auth, Sid; body: baseUrl, jData) | `placeOrder(session, jData)` |
| Modify/Cancel/Exit | Same pattern with respective paths | `/api/kotak/orders/modify`, `cancel`, `exit-cover`, `exit-bracket` | `modifyOrder`, `cancelOrder`, `exitCover`, `exitBracket` |
| Order book | `GET <baseUrl>/quick/user/orders` + Auth, Sid | `GET /api/kotak/reports/orders?baseUrl=...` + Auth, Sid | `getOrderBook(session)` |
| Trades/Positions/Holdings | GET same style | `GET /api/kotak/reports/trades|positions|holdings?baseUrl=...` | `getTradeBook`, `getPositions`, `getHoldings` |
| Quotes | `GET <baseUrl>/script-details/1.0/quotes/neosymbol/...` + **only** Authorization | `GET /api/kotak/quotes?baseUrl=&exchangeSegment=&symbol=` + Authorization | `getQuotes(accessToken, baseUrl, segment, symbol)` |
| Scripmaster | `GET <baseUrl>/script-details/1.0/masterscrip/file-paths` + Authorization | `GET /api/kotak/scripmaster/file-paths?baseUrl=` + Authorization | `getScripmasterPaths(accessToken, baseUrl)` |

**Headers (backend → Kotak):**

- Post-login (orders/reports): `Auth`, `Sid`, `neo-fin-key: neotradeapi`.
- Quotes / Scripmaster: only `Authorization` (no neo-fin-key, Auth, Sid).
- Bodies for order APIs: `application/x-www-form-urlencoded` with `jData` as JSON string (handled in `backend/services/kotakApi.js`).

## Files changed/added

- **Backend**: `config.js`, `server.js`, `services/kotakApi.js`, `routes/kotak.js`, `package.json`, `.env.example`.
- **Frontend**: Vite + React app with `src/api/kotak.js`, `src/context/SessionContext.jsx`, `src/components/LoginFlow.jsx`, `OrdersExample.jsx`, `ReportsExample.jsx`, `QuotesExample.jsx`, `App.jsx`, `App.css`, `main.jsx`, `index.html`, `vite.config.js`, `package.json`.
# tbot
