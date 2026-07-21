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
}

export function LoadingState({ className, inline = false }: LoadingStateProps = {}) {
  if (inline) {
    return <Spinner className={className} />;
  }

  return (
    <div className="flex items-center justify-center py-8">
      <Spinner className={className} />
    </div>
  );
}
