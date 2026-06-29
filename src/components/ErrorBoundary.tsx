import { Component, type ErrorInfo, type ReactNode } from "react";

// Garde-fou global : capture les erreurs de rendu React pour éviter l'écran blanc,
// affiche un fallback lisible + un bouton de rechargement. (Les erreurs async/invoke
// ne passent pas par ici — elles restent gérées localement par les pages.)
type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Trace en console (récupérable via les logs) sans crasher l'app.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-[#05060a] p-8 text-center">
          <h1 className="text-xl font-bold text-white">Une erreur est survenue</h1>
          <p className="max-w-md text-sm text-white/50">
            L&apos;interface a rencontré un problème inattendu. Tu peux recharger l&apos;application.
          </p>
          <pre className="max-w-xl overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-left text-[11px] text-red-300">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Recharger
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
