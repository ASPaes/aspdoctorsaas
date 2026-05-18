import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <h2 className="mb-2 text-lg font-semibold text-card-foreground">
                {this.props.fallbackTitle || "Algo deu errado"}
              </h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Ocorreu um erro inesperado. Tente novamente ou recarregue a página.
              </p>
              {this.state.error && (
                <div className="mb-4 w-full rounded-lg bg-muted p-3 text-left">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Detalhes técnicos
                  </p>
                  <p className="break-all text-xs text-foreground">
                    {this.state.error.message}
                  </p>
                </div>
              )}
              <div className="flex w-full gap-2">
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={this.handleRetry}
                >
                  <RefreshCw className="h-4 w-4" />
                  Tentar novamente
                </Button>
                <Button
                  className="flex-1"
                  onClick={this.handleReload}
                >
                  Recarregar página
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
