import { Toaster } from "sonner";

/**
 * App-wide toast container.
 *
 * Per the SSW toast-notification rule (https://www.ssw.com.au/rules/toast-notifications)
 * and issue #784, toasts render in the bottom-center of the window — the least
 * obstructive location — rather than sonner's default bottom-right.
 */
export const APP_TOAST_POSITION = "bottom-center" as const;

export function AppToaster() {
  return <Toaster position={APP_TOAST_POSITION} />;
}
