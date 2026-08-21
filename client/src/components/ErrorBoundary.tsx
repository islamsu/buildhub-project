import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  /**
   * Previously absent, which meant every caught error was rendered to the user
   * and then discarded - nothing was recorded anywhere. Logging to the console
   * is the honest floor given BuildHub has no error-tracking service wired yet;
   * when one is added, this is the single place it hooks into.
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8 text-center">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-2">An unexpected error occurred.</h2>

            {/*
              The stack trace used to be rendered here in a <pre> block. That put
              file paths, function names and internal structure in front of every
              end user in production. The stack now goes to componentDidCatch
              only; the user gets something they can act on instead.
            */}
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              Something went wrong while displaying this page. Reloading usually
              fixes it. If it keeps happening, please contact support.
            </p>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
