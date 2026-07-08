import { Component, type ReactNode } from "react";
import { STATUS_DASHBOARD_REFRESH_EVENT } from "./status-dashboard";

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
 *
 * Address review #949 follow-up — `hasError` used to be a one-way trip: once tripped, the
 * dashboard rendered `null` for the rest of the app session, since this boundary mounts once
 * (wrapped high in the router) and nothing ever cleared the flag. A single transient render
 * error (e.g. one bad IPC payload tick) would then permanently blank the always-on dashboard.
 * This now self-heals on the same triggers `useStatusDashboard` already re-checks on — window
 * focus and `STATUS_DASHBOARD_REFRESH_EVENT` (dispatched on Settings-close / auth changes) — by
 * clearing `hasError` and letting the child remount and try again.
 */
export class StatusDashboardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown) {
    console.error("StatusDashboard crashed; hiding it to protect the rest of the sidebar:", error);
  }

  override componentDidMount() {
    window.addEventListener("focus", this.retry);
    window.addEventListener(STATUS_DASHBOARD_REFRESH_EVENT, this.retry);
  }

  override componentWillUnmount() {
    window.removeEventListener("focus", this.retry);
    window.removeEventListener(STATUS_DASHBOARD_REFRESH_EVENT, this.retry);
  }

  private retry = () => {
    if (this.state.hasError) this.setState({ hasError: false });
  };

  override render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
