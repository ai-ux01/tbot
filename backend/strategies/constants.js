/** Shared strategy enums – same contract for all strategies. */

export const StrategyState = Object.freeze({
  FLAT: 'FLAT',
  LONG: 'LONG',
});

export const StrategySignals = Object.freeze({
  BUY: 'BUY',
  SELL: 'SELL',
  HOLD: 'HOLD',
});

export const StrategyEvents = Object.freeze({
  SIGNAL: 'signal',
});
