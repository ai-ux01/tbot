import { useState } from 'react';
import { totpLogin, mpinValidate, SESSION_EXPIRED_CODE } from '../api/kotak';
import { useSession } from '../context/SessionContext';

export function LoginFlow() {
  const { accessToken, setAccessToken, setSessionData, logout } = useSession();
  const [step, setStep] = useState(!accessToken ? 'token' : 'totp');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [tokenInput, setTokenInput] = useState(accessToken || '');
  const [mobileNumber, setMobileNumber] = useState('+917079216930');
  const [ucc, setUcc] = useState('XWYPM');
  const [totp, setTotp] = useState('');
  const [viewCreds, setViewCreds] = useState(null);
  const [mpin, setMpin] = useState('');

  const handleSetToken = (e) => {
    e.preventDefault();
    setError('');
    if (!tokenInput.trim()) {
      setError('Enter access token');
      return;
    }
    setAccessToken(tokenInput.trim());
    setStep('totp');
  };

  const handleTotp = async (e) => {
    e.preventDefault();
    setError('');
    if (!accessToken?.trim()) {
      setError('Set your access token first (step 1)');
      return;
    }
    setLoading(true);
    try {
      const data = await totpLogin(accessToken, {
        mobileNumber: mobileNumber.trim(),
        ucc: ucc.trim(),
        totp: totp.trim(),
      });
      const viewToken = data?.data?.token ?? data?.viewToken ?? data?.token;
      const viewSid = data?.data?.sid ?? data?.viewSid ?? data?.sid;
      setViewCreds({ viewToken, viewSid });
      setStep('mpin');
    } catch (err) {
      if (err.code === SESSION_EXPIRED_CODE) logout();
      setError(err.message || 'TOTP login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMpin = async (e) => {
    e.preventDefault();
    setError('');
    if (!viewCreds?.viewToken || !viewCreds?.viewSid) {
      setError('Missing session from TOTP. Submit TOTP again.');
      return;
    }
    if (!mpin.trim()) {
      setError('Enter MPIN');
      return;
    }
    setLoading(true);
    try {
      const data = await mpinValidate(
        accessToken,
        viewCreds.viewSid,
        viewCreds.viewToken,
        mpin.trim()
      );
      setSessionData({
        sessionId: data.sessionId,
        baseUrl: data.baseUrl,
      });
      setStep('done');
    } catch (err) {
      if (err.code === SESSION_EXPIRED_CODE) logout();
      setError(err.message || 'MPIN validate failed');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'token') {
    return (
      <form onSubmit={handleSetToken} className="login-form">
        <h3>1. Set access token</h3>
        <p className="hint">Use your Kotak OAuth / API access token (Bearer).</p>
        <input
          type="password"
          placeholder="Access token"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          autoComplete="off"
        />
        {error && <p className="error">{error}</p>}
        <button type="submit">Continue to TOTP</button>
      </form>
    );
  }

  if (step === 'totp') {
    return (
      <form onSubmit={handleTotp} className="login-form">
        <h3>2. TOTP login</h3>
        <input
          type="text"
          placeholder="Mobile (+91XXXXXXXXXX)"
          value={mobileNumber}
          onChange={(e) => setMobileNumber(e.target.value)}
        />
        <input
          type="text"
          placeholder="UCC / Client code"
          value={ucc}
          onChange={(e) => setUcc(e.target.value)}
        />
        <input
          type="text"
          placeholder="6-digit TOTP"
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          maxLength={6}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in…' : 'Submit TOTP'}
        </button>
      </form>
    );
  }

  if (step === 'mpin') {
    return (
      <form onSubmit={handleMpin} className="login-form">
        <h3>3. MPIN validate</h3>
        <input
          type="password"
          placeholder="MPIN"
          value={mpin}
          onChange={(e) => setMpin(e.target.value)}
          autoComplete="off"
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Validating…' : 'Validate MPIN'}
        </button>
      </form>
    );
  }

  return (
    <p className="success">Logged in. Session is active. Use Orders / Reports below.</p>
  );
}
