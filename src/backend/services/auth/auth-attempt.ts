/**
 * Query parameter carrying the id of the authorization attempt a callback belongs to.
 *
 * The desktop builds its own `redirectUri`, and the backend echoes it back verbatim when deep-linking
 * a failure, so an id added here survives the round trip with no backend change.
 */
export const AUTH_ATTEMPT_PARAM = "attemptId";

/**
 * Whether a callback belongs to the attempt currently being waited on. Without this, a tab left open
 * from an earlier attempt can report a failure that cancels the retry the user just started.
 *
 * Callbacks with no id are accepted — a flow that does not carry one must still fail fast rather
 * than hang until it times out. Only a callback naming a *different* attempt is discarded.
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
