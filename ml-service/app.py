"""
FastAPI ML service: /predict accepts OHLCV candles, returns pattern, probability, trend_prediction.
"""

import os
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
