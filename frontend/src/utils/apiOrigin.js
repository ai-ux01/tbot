/**
 * Backend origin for API + Socket.IO. Set VITE_API_BASE_URL to your deployed API
 * (e.g. https://your-app.onrender.com) — with or without a path; only the origin is used.
 */
export function getBackendOrigin() {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
  try {
    return new URL(base).origin;
  } catch {
    return 'http://localhost:4000';
  }
}
