"""
Preprocessing pipeline for OHLCV candles: normalize and prepare for model input.
Input: list of dicts with open, high, low, close, volume.
Output: numpy array of shape (seq_len, features) for LSTM/CNN.
"""

import numpy as np
from sklearn.preprocessing import MinMaxScaler


def ohlcv_to_features(candles, seq_len=60, num_features=5):
    """
    Convert OHLCV list to normalized sequences.
    Features: open, high, low, close, volume (or returns-based).
    """
    if not candles or len(candles) < seq_len:
        return None
    arr = []
    for c in candles:
        o = float(c.get("open", 0) or 0)
        h = float(c.get("high", 0) or 0)
        l_ = float(c.get("low", 0) or 0)
        cl = float(c.get("close", 0) or 0)
        v = float(c.get("volume", 0) or 0)
        arr.append([o, h, l_, cl, v])
    data = np.array(arr, dtype=np.float64)
    if data.shape[0] < seq_len:
        return None
    # Normalize per feature (column)
    scaler = MinMaxScaler(feature_range=(0, 1))
    data = scaler.fit_transform(data)
    # Last seq_len rows as one sample
    X = data[-seq_len:]
    return X.reshape(1, seq_len, num_features), scaler


def prepare_predict_input(candles, seq_len=60, max_candles=500):
    """Prepare single sample for /predict. Returns (X, None) for inference."""
    use = candles[-max_candles:] if len(candles) > max_candles else candles
    result = ohlcv_to_features(use, seq_len=seq_len)
    if result is None:
        return None
    X, _ = result
    return X
