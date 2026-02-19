"""
Simple LSTM-based trend + pattern-style output for demo.
Returns: pattern name, probability, trend_prediction (BULLISH/BEARISH/NEUTRAL).
Without TensorFlow/PyTorch we return a rule-based mock; with TF/PyTorch load real weights.
"""

import numpy as np
import os

# Try optional TensorFlow
try:
    import tensorflow as tf
    HAS_TF = True
except ImportError:
    HAS_TF = False

SEQ_LEN = 60
NUM_FEATURES = 5
PATTERNS = ["Head and Shoulders", "Double Bottom", "Bullish Flag", "Bearish Flag", "Consolidation"]
TRENDS = ["BULLISH", "BEARISH", "NEUTRAL"]


def _mock_predict(X):
    """Rule-based mock: use last close trend and volatility for demo."""
    if X is None or X.size == 0:
        return "Consolidation", 0.5, "NEUTRAL"
    x = np.asarray(X)
    if x.ndim == 3:
        x = x[0]
    # last 20 closes
    closes = x[-20:, 3] if x.shape[0] >= 20 else x[:, 3]
    if len(closes) < 2:
        return "Consolidation", 0.5, "NEUTRAL"
    ret = (closes[-1] - closes[0]) / (closes[0] + 1e-8)
    vol = np.std(closes) / (np.mean(closes) + 1e-8)
    if ret > 0.02:
        trend = "BULLISH"
        pattern = "Bullish Flag"
        prob = min(0.95, 0.6 + abs(ret) * 5)
    elif ret < -0.02:
        trend = "BEARISH"
        pattern = "Bearish Flag"
        prob = min(0.95, 0.6 + abs(ret) * 5)
    else:
        trend = "NEUTRAL"
        pattern = "Consolidation"
        prob = 0.5
    return pattern, float(prob), trend


def build_model(seq_len=SEQ_LEN, num_features=NUM_FEATURES):
    """Build LSTM model (when TensorFlow available)."""
    if not HAS_TF:
        return None
    model = tf.keras.Sequential([
        tf.keras.layers.LSTM(64, input_shape=(seq_len, num_features), return_sequences=True),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.LSTM(32),
        tf.keras.layers.Dense(16, activation="relu"),
        tf.keras.layers.Dense(3, activation="softmax"),  # 3 trend classes
    ])
    model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    return model


def load_or_mock():
    """Load saved model if exists; else return mock predictor."""
    model_path = os.environ.get("ML_MODEL_PATH", "saved_model.keras")
    if HAS_TF and os.path.isfile(model_path):
        try:
            return tf.keras.models.load_model(model_path)
        except Exception:
            pass
    return None


def predict(X, model=None):
    """
    X: shape (1, seq_len, num_features).
    Returns: (pattern: str, probability: float, trend_prediction: str).
    """
    if model is not None and HAS_TF:
        try:
            pred = model.predict(X, verbose=0)
            idx = int(np.argmax(pred[0]))
            trend = TRENDS[idx]
            prob = float(np.max(pred[0]))
            pattern = PATTERNS[min(idx, len(PATTERNS) - 1)]
            return pattern, prob, trend
        except Exception:
            pass
    return _mock_predict(X)
