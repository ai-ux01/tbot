/**
 * Derive display fields for open paper positions (aligned with backend exit rules).
 */

function normalizeProfitTargetPct(raw) {
  if (raw == null) return 0.1;
  let v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return 0.1;
  if (v > 1) v /= 100;
  return Math.min(5, Math.max(0.005, v));
}

function round2(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

/**
 * @param {object} p - position from GET /api/paper-trading/state
 */
export function computeOpenPositionDisplay(p) {
  const avg = Number(p?.entryPrice);
  const qty = Math.floor(Number(p?.qty));
  const rules = p?.paperRules && typeof p.paperRules === 'object' ? p.paperRules : {};
  const setupId = String(p?.setupId || '');

  let stopLossPrice = null;
  let partialTpPrice = null;
  let rsiRemainderExit = null;
  let maxHoldingDays = null;
  let maxHoldingBars = null;
  let notes = [];
  /** @type {number | null} */
  let partialExitQtyPercent = null;

  const kind = rules.kind || (setupId === 'rsi-ma-setup-copy' ? 'rsi-ma-setup-copy' : setupId === 'eighty-percent' ? 'eighty-percent' : rules.kind);

  if (setupId === 'rsi-ma-setup-copy' || kind === 'rsi-ma-setup-copy') {
    const pt = normalizeProfitTargetPct(rules.profitTargetPct);
    const slPct = 0.03;
    stopLossPrice = round2(avg * (1 - slPct));
    partialTpPrice = round2(avg * (1 + pt));
    let partialQtyFrac = 0.8;
    const rawFrac = rules.partialTpFraction;
    if (rawFrac != null && rawFrac !== '') {
      const n = Number(rawFrac);
      if (Number.isFinite(n) && n > 0) {
        partialQtyFrac = n > 1 ? n / 100 : n;
        partialQtyFrac = Math.min(1, Math.max(0.01, partialQtyFrac));
      }
    }
    rsiRemainderExit =
      rules.rsiRemainderExit != null && Number.isFinite(Number(rules.rsiRemainderExit))
        ? Math.min(95, Math.max(5, Math.round(Number(rules.rsiRemainderExit))))
        : 70;
    maxHoldingDays =
      rules.maxHoldingDays != null && Number.isFinite(Number(rules.maxHoldingDays))
        ? Math.floor(Number(rules.maxHoldingDays))
        : 7;
    partialExitQtyPercent = Math.round(partialQtyFrac * 100);
    if (partialQtyFrac >= 1) {
      notes.push('First take-profit exits 100% of position (no separate remainder RSI leg).');
    }
    if (rules.partialTpDone) notes.push('Partial TP already taken — remainder exits on SL, RSI target, or max hold');
  } else if (setupId === 'eighty-percent' || kind === 'eighty-percent') {
    stopLossPrice = round2(avg * 0.95);
    partialTpPrice = round2(avg * 1.1);
    maxHoldingDays =
      rules.maxHoldingDays != null && Number.isFinite(Number(rules.maxHoldingDays))
        ? Math.floor(Number(rules.maxHoldingDays))
        : 7;
  } else if (kind === 'simple' || setupId === 'rsi-setup' || setupId === 'ema-crossover') {
    const sp = Number(rules.stopPct) > 0 ? Number(rules.stopPct) : 0.05;
    const tp = Number(rules.targetPct) > 0 ? Number(rules.targetPct) : 0.1;
    stopLossPrice = round2(avg * (1 - sp));
    partialTpPrice = round2(avg * (1 + tp));
    maxHoldingDays =
      rules.maxHoldingDays != null && Number.isFinite(Number(rules.maxHoldingDays))
        ? Math.floor(Number(rules.maxHoldingDays))
        : 7;
    if (rules.maxHoldingBars != null && Number.isFinite(Number(rules.maxHoldingBars))) {
      maxHoldingBars = Math.floor(Number(rules.maxHoldingBars));
      notes.push(`Max hold: ${maxHoldingBars} bars (${rules.timeframe || 'series'})`);
    }
  }

  const invested = Number.isFinite(avg) && Number.isFinite(qty) ? round2(qty * avg) : null;
  const snap = p?.snapshot && typeof p.snapshot === 'object' ? p.snapshot : null;

  const tokenOrId = String(p?.symbol || '').trim();
  const ts = String(p?.tradingsymbol || '').trim();
  const fromApiName =
    p?.instrumentName != null && String(p.instrumentName).trim() ? String(p.instrumentName).trim() : null;
  const tsReadable = ts && !/^\d+$/.test(ts) ? ts : null;
  /** Human-readable name (from API DB lookup or non-numeric tradingsymbol). */
  const instrumentName = fromApiName || tsReadable || null;
  const subId =
    tokenOrId && instrumentName && tokenOrId.toUpperCase() !== instrumentName.toUpperCase()
      ? tokenOrId
      : ts && /^\d+$/.test(ts) && instrumentName
        ? ts
        : null;

  const instrumentLabel = (() => {
    if (instrumentName && subId) return `${instrumentName} (${subId})`;
    if (instrumentName) return instrumentName;
    if (ts && tokenOrId && ts.toUpperCase() !== tokenOrId.toUpperCase()) return `${ts} · ${tokenOrId}`;
    return tokenOrId || ts || '—';
  })();

  return {
    instrumentName,
    instrumentSubId: subId,
    instrumentLabel,
    stopLossPrice,
    partialTpPrice,
    partialExitQtyPercent,
    rsiRemainderExit,
    maxHoldingDays,
    maxHoldingBars,
    series: rules.series ?? null,
    timeframe: rules.timeframe ?? null,
    partialTpDone: Boolean(rules.partialTpDone),
    invested,
    orderValueInr: p?.orderValueInr != null ? Number(p.orderValueInr) : null,
    notes,
    snapshot: snap
      ? {
          signal_type: snap.signal_type,
          barUnit: snap.barUnit,
          currentPrice: snap.currentPrice,
          explanation: snap.explanation,
        }
      : null,
  };
}
