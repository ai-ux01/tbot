/**
 * Server-side store for Zerodha Kite access tokens.
 * Key: sessionId. Value: { accessToken, apiKey, loginTime, redirectParams }.
 * api_secret and access_token never sent to client.
 * In production use Redis or DB with encryption at rest.
 */

const kiteSessions = new Map();

export function setKiteSession(sessionId, data) {
  kiteSessions.set(sessionId, {
    accessToken: data.accessToken,
    apiKey: data.apiKey ?? null,
    loginTime: data.loginTime ?? Date.now(),
    redirectParams: data.redirectParams ?? null,
  });
}

export function getKiteSession(sessionId) {
  return kiteSessions.get(sessionId) ?? null;
}

export function removeKiteSession(sessionId) {
  kiteSessions.delete(sessionId);
}
