import { Spinner } from "../ui/spinner";

interface LoadingStateProps {
  /**
   * Extra classes applied to the spinner icon itself (e.g. "mr-2 h-4 w-4") so callers that
   * previously rendered a bare `Loader2` icon inline can preserve their sizing/margin.
   */
  className?: string;
  /**
   * When set, skips the default centered block wrapper (`flex items-center justify-center
   * py-8`) so the spinner sits inline next to a label instead of taking over a full block.
   * Callers migrating a small inline `Loader2` (inside a button, next to text, etc.) should
   * pass `true`; full-page/section loaders should leave this unset to keep prior behaviour.
   */
  inline?: boolean;
  /**
   * Accessible status text for loaders that do not already have a visible label. Inline loaders
   * without this prop are treated as decorative because their surrounding UI describes the state.
   */
  label?: string;
}

export function LoadingState({ className, inline = false, label }: LoadingStateProps = {}) {
  const accessibilityProps = label
    ? { "aria-label": label }
    : inline
      ? { role: undefined, "aria-label": undefined, "aria-hidden": true }
      : {};
  const spinner = <Spinner className={className} {...accessibilityProps} />;

  if (inline) {
    return spinner;
  }

  return <div className="flex items-center justify-center py-8">{spinner}</div>;
}
