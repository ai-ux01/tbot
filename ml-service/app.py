"""
FastAPI ML service: /predict accepts OHLCV candles, returns pattern, probability, trend_prediction.
/train runs model training and saves the model.
"""

import os
import subprocess
import sys
from pathlib import Path
from typing import List
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from preprocess import prepare_predict_input
from model import load_or_mock, predict, SEQ_LEN

app = FastAPI(title="Pattern Detection ML Service", version="1.0.0")

# Candle item for request body
class CandleItem(BaseModel):
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

class PredictRequest(BaseModel):
    candles: List[CandleItem]

class PredictResponse(BaseModel):
    pattern: str
    probability: float
    trend_prediction: str

_model = None

def get_model():
    global _model
    if _model is None:
        _model = load_or_mock()
    return _model

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/predict", response_model=PredictResponse)
def predict_endpoint(req: PredictRequest):
    if not req.candles or len(req.candles) < 50:
        raise HTTPException(status_code=400, detail="At least 50 candles required")
    candles = [c.model_dump() for c in req.candles]
    X = prepare_predict_input(candles, seq_len=SEQ_LEN)
    if X is None:
        raise HTTPException(status_code=400, detail="Insufficient data after preprocessing")
    model = get_model()
    pattern, probability, trend_prediction = predict(X, model=model)
    return PredictResponse(
        pattern=pattern,
        probability=round(probability, 4),
        trend_prediction=trend_prediction,
    )


@app.post("/train")
def train_endpoint():
    """Run model training (train.py). Saves model to ML_MODEL_PATH or saved_model.keras."""
    base = Path(__file__).resolve().parent
    train_script = base / "train.py"
    if not train_script.exists():
        raise HTTPException(status_code=500, detail="train.py not found")
    try:
        result = subprocess.run(
            [sys.executable, str(train_script)],
            cwd=str(base),
            capture_output=True,
            text=True,
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Training timed out (max 600s)")
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=result.stderr.strip() or result.stdout.strip() or "Training failed",
        )
    # Force reload of model on next /predict
    global _model
    _model = None
    return {"status": "ok", "message": "Model saved", "stdout": result.stdout.strip()}
