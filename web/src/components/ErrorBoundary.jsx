import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[#06111f] text-slate-100">
          <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-atlas-panel p-8 shadow-glow backdrop-blur-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-atlas-teal/90">
              Atlas
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              An unexpected error occurred. You can try again or return to the workspace.
            </p>

            {import.meta.env.DEV && this.state.error && (
              <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3">
                <p className="text-xs font-mono text-rose-200 break-words">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="w-full rounded-full bg-atlas-teal px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-atlas-teal/90"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="w-full rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/5"
              >
                Refresh Page
              </button>
              <button
                onClick={() => window.location.href = '/app'}
                className="w-full rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/5"
              >
                Return to Workspace
              </button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
