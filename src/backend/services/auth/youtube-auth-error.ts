/**
 * Structured classification for YouTube OAuth/login failures (issue #596).
 *
 * The login flow can stall for several distinct reasons, and historically all
 * of them surfaced (if at all) as the same opaque "Authentication failed" with
 * no user feedback. We attach a structured `reason` at each throw site so the
 * UI can show honest, actionable copy and so logs/telemetry are diagnosable —
 * rather than parsing error message strings after the fact.
 */
export type YouTubeAuthErrorReason =
  | "backend_unreachable"
  | "auth_start_failed"
  | "timeout"
  | "unknown";

interface YouTubeAuthErrorOptions {
  /** HTTP status from the backend, when the failure was an HTTP response. */
  status?: number;
  /** How long we waited before giving up, for timeout diagnostics. */
  elapsedMs?: number;
  /** Underlying error, preserved for logging (never surfaced raw to the user). */
  cause?: unknown;
}

/**
 * Error thrown by the YouTube OAuth flow carrying a structured `reason`.
 * Prefer reading `.reason` over matching on `.message`.
 */
export class YouTubeAuthError extends Error {
  readonly reason: YouTubeAuthErrorReason;
  readonly status?: number;
  readonly elapsedMs?: number;

  constructor(reason: YouTubeAuthErrorReason, message: string, options?: YouTubeAuthErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "YouTubeAuthError";
    this.reason = reason;
    this.status = options?.status;
    this.elapsedMs = options?.elapsedMs;
  }
}

/**
 * Maps any thrown value to a structured reason. A `YouTubeAuthError` reports its
 * own reason; everything else is "unknown" (we never guess from message text).
 */
export function classifyYouTubeAuthError(error: unknown): YouTubeAuthErrorReason {
  return error instanceof YouTubeAuthError ? error.reason : "unknown";
}

/**
 * User-facing, honest copy for a given failure reason. Does NOT claim success,
 * and points the user at the most likely next step. Note the core #596 symptom
 * (Google's 2-step prompt never arriving) presents as `timeout` here — we can't
 * fix Google's delivery, but we can stop leaving the user staring at a spinner.
 */
export function describeYouTubeAuthError(reason: YouTubeAuthErrorReason): string {
  switch (reason) {
    case "backend_unreachable":
      return "Couldn't reach the YakShaver service to start YouTube sign-in. Check your connection and try again.";
    case "auth_start_failed":
      return "YouTube sign-in couldn't be started. Please try again in a moment.";
    case "timeout":
      return "Didn't hear back from YouTube. If no verification prompt appeared, check your Google or authenticator app, then click Connect to try again.";
    default:
      return "YouTube sign-in didn't complete. Please click Connect to try again.";
  }
}
