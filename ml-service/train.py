"""
Training script for LSTM trend classifier.
Uses synthetic or CSV data if provided; otherwise trains on random data for structure demo.
Save model to saved_model.keras (set ML_MODEL_PATH to override).
"""

import os
import numpy as np
from preprocess import ohlcv_to_features

try:
    import tensorflow as tf
except ImportError:
    print("TensorFlow not installed. Run: pip install tensorflow")
    exit(1)

from model import build_model, SEQ_LEN, NUM_FEATURES, TRENDS

def generate_synthetic(n_samples=1000, seq_len=SEQ_LEN):
    """Generate synthetic OHLCV for training demo."""
    X_list = []
    y_list = []
    for _ in range(n_samples):
        # Random walk close
        close = 100 + np.cumsum(np.random.randn(seq_len + 20) * 0.5)
        open_ = np.roll(close, 1)
        open_[0] = 100
        high = np.maximum(open_, close) + np.abs(np.random.randn(seq_len + 20)) * 0.2
        low = np.minimum(open_, close) - np.abs(np.random.randn(seq_len + 20)) * 0.2
        vol = np.random.exponential(1000, seq_len + 20)
        candles = [{"open": o, "high": h, "low": l, "close": c, "volume": v}
                   for o, h, l, c, v in zip(open_, high, low, close, vol)]
        result = ohlcv_to_features(candles, seq_len=seq_len)
        if result is None:
            continue
        x, _ = result
        X_list.append(x[0])
        ret = (close[-1] - close[0]) / (close[0] + 1e-8)
        if ret > 0.01:
            y_list.append(0)  # BULLISH
        elif ret < -0.01:
            y_list.append(1)  # BEARISH
        else:
            y_list.append(2)  # NEUTRAL
    return np.array(X_list), np.array(y_list, dtype=np.int32)


def main():
    print("Generating synthetic data...")
    X, y = generate_synthetic(n_samples=800)
    print(f"X shape: {X.shape}, y shape: {y.shape}")

    model = build_model(SEQ_LEN, NUM_FEATURES)
    model.fit(X, y, epochs=10, batch_size=32, validation_split=0.1, verbose=1)

    out_path = os.environ.get("ML_MODEL_PATH", "saved_model.keras")
    model.save(out_path)
    print(f"Model saved to {out_path}")


if __name__ == "__main__":
    main()
