# Deploy bot-ai (free tier: Render + Vercel)

Split deployment: **API on [Render](https://render.com)** (free Web Service, may sleep after ~15 min idle) and **static UI on [Vercel](https://vercel.com)** (free for personal projects).

## Prerequisites

1. GitHub (or GitLab/Bitbucket) repo pushed with this code.
2. **[MongoDB Atlas](https://www.mongodb.com/cloud/atlas)** free cluster (optional but needed for NSE sync, signals DB, paper persistence). Copy **connection string** as `MONGODB_URI`.

## 1. Backend on Render

1. [Render Dashboard](https://dashboard.render.com) → **New +** → **Web Service**.
2. Connect the repository.
3. Configure:
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance type**: Free
4. **Environment** (minimum):
   - `CORS_ORIGIN` — your Vercel URL, e.g. `https://your-app.vercel.app` (no trailing slash). After first Vercel deploy, edit Render and redeploy if needed.
   - `MONGODB_URI` — Atlas connection string (if you use DB features).
   - Optional: `KITE_API_KEY`, `KITE_API_SECRET`, `KITE_REDIRECT_URI` (must be `https://<your-render-service>.onrender.com/api/kite/callback`), `FRONTEND_URL` (Vercel URL), Kotak vars from `backend/.env.example`.
5. Render sets **`PORT`** automatically; the app reads it in `backend/config.js`.
6. After deploy, note the service URL, e.g. `https://bot-ai-backend.onrender.com`.

**Health check:** `GET /health` → `{ "ok": true }`.

**Blueprint:** You can use the repo file `render.yaml` via **New → Blueprint** instead of manual Web Service setup.

## 2. Frontend on Vercel

1. [Vercel Dashboard](https://vercel.com) → **Add New…** → **Project** → import the same repo.
2. **Root Directory**: `frontend`
3. **Framework Preset**: Vite (auto-detected with `frontend/vercel.json`).
4. **Build Command**: `npm run build` (default).
5. **Output Directory**: `dist` (default for Vite).
6. **Environment Variables**:
   - `VITE_API_BASE_URL` = your Render API origin only, e.g. `https://bot-ai-backend.onrender.com`  
     (no `/api/...` path; the app appends `/api/kotak`, `/api/signals`, etc.)
   - Optional: `VITE_KITE_API_BASE_URL` — same origin if you use Kite flows from the UI.

Deploy. Then set **`CORS_ORIGIN`** on Render to your exact Vercel production URL and trigger a **Manual Deploy** on Render so CORS matches.

## 3. Cookies / Kite OAuth

Kite callback runs on the **backend** URL. Set `KITE_REDIRECT_URI` and Zerodha app redirect URL to:

`https://<render-host>/api/kite/callback`

The browser may need `credentials: 'include'` (already used on API calls) and the frontend origin must match **`CORS_ORIGIN`** on the server.

## 4. Limitations (free tier)

- **Render free**: Service spins down when idle; first request after sleep can take ~30–60s.
- **Cold starts**: Not ideal for low-latency trading; upgrade or use a keep-alive ping only if Render ToS allows it for your plan.
- **Secrets**: Never commit `.env`; set everything in Render / Vercel dashboards.

## Local vs production

| Variable | Local | Production |
|----------|--------|------------|
| `VITE_API_BASE_URL` | `http://localhost:4000` | `https://<render>.onrender.com` |
| `CORS_ORIGIN` (Render) | `http://localhost:5173` | `https://<project>.vercel.app` |

## Troubleshooting

### `404` on `https://<render>/login/totp`

That path is **wrong**. The backend exposes Kotak under **`/api/kotak`**:

- Correct: **`POST https://<render-host>/api/kotak/login/totp`**

This usually means the **Vercel build is outdated**: it used `VITE_API_BASE_URL` as the full API base. Pull latest `frontend` (which uses `getBackendOrigin()` + `/api/kotak`), set **`VITE_API_BASE_URL`** to the Render **origin only** (no `/api`), **redeploy Vercel**, hard-refresh the app.

### `502` on `POST .../api/kotak/login/totp` (local or Render)

The **Node server reached your request** but the **upstream Kotak** step failed (or the error was mapped to 502). Check the JSON **`error`** body and **Render logs** / terminal. Typical causes: wrong consumer key or TOTP, Kotak MIS rejecting the call, network/TLS from the host to `mis.kotaksecurities.com`, or rate limits. The proxy does not return 502 for missing `Authorization` (that is **400**).
