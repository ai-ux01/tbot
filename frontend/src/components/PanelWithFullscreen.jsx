import { useState, useEffect } from 'react';

/**
 * Single dashboard card with Fullscreen: fixed viewport overlay, body scroll lock, Esc to exit.
 */
export function PanelWithFullscreen({ panelClassName, title, children }) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreen]);

  const rootClass = `${panelClassName}${fullscreen ? ' panel-is-fullscreen' : ''}`;

  return (
    <div className={rootClass}>
      <div className="dashboard-card">
        <div className="dashboard-panel-expand-row">
          <h2 className="dashboard-card-title">{title}</h2>
          <button
            type="button"
            className="btn-secondary dashboard-panel-expand-btn"
            onClick={() => setFullscreen((v) => !v)}
            aria-expanded={fullscreen}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
