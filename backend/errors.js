/** Error code for session/token expiry. Frontend can use this to trigger re-login. */
export const SESSION_EXPIRED = 'SESSION_EXPIRED';

export class SessionExpiredError extends Error {
  constructor(message = 'Session expired or invalid') {
    super(message);
    this.name = 'SessionExpiredError';
    this.code = SESSION_EXPIRED;
  }
}
