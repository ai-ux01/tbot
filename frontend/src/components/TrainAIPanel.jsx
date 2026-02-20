import { useState } from 'react';
import { trainModel } from '../api/signals';

export function TrainAIPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleTrain = async () => {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const data = await trainModel();
      setResult(data);
    } catch (e) {
      setError(e?.message ?? 'Training failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="train-ai-panel">
      <div className="dashboard-card">
        <h2 className="dashboard-card-title">Train AI model</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Run the ML training script to retrain the trend classifier. This uses synthetic data by default and saves the model for use in AI Signals. The ML service must be running and <code>ML_SERVICE_URL</code> set on the backend.
        </p>
        <div className="dashboard-toolbar">
          <button
            type="button"
            className="bot-live-button"
            onClick={handleTrain}
            disabled={loading}
          >
            {loading ? 'Training…' : 'Start training'}
          </button>
        </div>
        {result && (
          <div className="dashboard-card-inner" style={{ marginTop: 16 }}>
            <p className="muted" style={{ marginBottom: 8 }}>
              <strong style={{ color: 'var(--success)' }}>{result.message ?? result.status}</strong>
            </p>
            {result.stdout && (
              <pre className="train-ai-stdout">{result.stdout}</pre>
            )}
          </div>
        )}
        {error && (
          <p className="bot-live-error" style={{ marginTop: 16 }}>{error}</p>
        )}
      </div>
    </div>
  );
}
