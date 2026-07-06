import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * #948 review follow-up — `StatusDashboard` is now mounted unconditionally on every route via
 * the sidebar (previously the equivalent banner only lived on Home). A render error there
 * (e.g. an IPC read returning a shape that doesn't match its `Pick<...>` contract) would
 * otherwise propagate past this always-mounted component and crash the whole sidebar — nav,
 * settings, sign-out included. This boundary contains that blast radius to the dashboard card
 * itself; there's no app-wide error boundary elsewhere in `src/ui/src` to fall back on.
 */
export class StatusDashboardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown) {
    console.error("StatusDashboard crashed; hiding it to protect the rest of the sidebar:", error);
  }

  override render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
