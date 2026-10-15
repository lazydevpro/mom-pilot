import { Component, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

/** Shows a way back instead of a blank page if rendering fails. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('MomPilot crashed:', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="center-screen crash">
        <h1>Something went wrong</h1>
        <p>Reload MomPilot to continue.</p>
        <button className="primary" onClick={() => location.reload()}>Reload</button>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
