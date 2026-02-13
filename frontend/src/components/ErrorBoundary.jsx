import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (typeof this.props.onError === 'function') {
      this.props.onError(error, info);
    }
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error);
      }
      return (
        <div className="error-boundary" role="alert">
          <h3>Something went wrong</h3>
          <p className="error-boundary-msg">{this.state.error?.message ?? String(this.state.error)}</p>
          {this.props.showReset && (
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="bot-live-btn"
            >
              Try again
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
