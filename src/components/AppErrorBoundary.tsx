import { Component, ErrorInfo, ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  boundaryName?: string;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (!import.meta.env.DEV) return;

    const boundaryName = this.props.boundaryName ?? "unknown";
    console.error(`[error-boundary:${boundaryName}]`, {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-foreground">
            Noe gikk galt i denne visningen. Last siden pa nytt.
          </div>
        )
      );
    }

    return this.props.children;
  }
}
