/**
 * Query parameter carrying the id of the authorization attempt a callback belongs to.
 *
 * The desktop builds its own `redirectUri` for both OAuth flows, and the backend echoes that URI
 * back verbatim when it deep-links a failure (`BuildFailureNotifyUrl` appends `error=` while
 * preserving the existing query), so an id added here survives the whole round trip without any
 * backend change.
 */
export const AUTH_ATTEMPT_PARAM = "attemptId";

/**
 * Whether a callback belongs to the attempt currently being waited on.
 *
 * Failure callbacks are otherwise correlated only by which server they name, so a tab left open
 * from an earlier attempt could report a failure that cancelled whichever authorization happened
 * to be waiting — the user retries, then closes the old tab, and the retry dies with it.
 *
 * Callbacks with no id are accepted: an attempt started before this shipped, or a flow that does
 * not carry one, must still be able to fail fast rather than hang until it times out. This only
 * ever discards a callback that positively identifies a *different* attempt.
 */
export function isCurrentAuthAttempt(
  callbackAttemptId: string | null | undefined,
  waitingAttemptId: string | null | undefined,
): boolean {
  if (!callbackAttemptId || !waitingAttemptId) {
    return true;
  }
  return callbackAttemptId === waitingAttemptId;
}
