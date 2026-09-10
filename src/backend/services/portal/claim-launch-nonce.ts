import { config } from "../../config/env";
import { delay } from "../../utils/async-utils";
import { IdentityServerAuthService } from "../auth/identity-server-auth";

/**
 * Tells the portal that this app really did receive a launch deep link.
 *
 * The browser cannot find out on its own whether a custom URL scheme has a handler, and inferring it
 * from window focus cannot separate a launched app from a dismissed launch prompt, because the
 * prompt steals focus before the user has chosen. So the portal mints a one-time nonce, hangs it off
 * the deep link, and waits for this call. Claiming it is the proof.
 */

// Short enough that a hung backend does not leave the deep link half-handled, long enough to survive
// an ordinary slow response. Matches checkCloud360Credits.
const TIMEOUT_MS = 5000;

// The app is frequently launched while the machine is still bringing its network up, so a single
// attempt would leave the user watching the app open while the web page insists it never did.
const RETRY_DELAYS_MS = [500, 1500, 3000];

// Matches the "D" format the backend mints with Guid.NewGuid().ToString().
const NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const isNonceShaped = (value: string): boolean => NONCE_PATTERN.test(value);

export type ClaimLaunchNonceOptions = {
  /** Injectable so tests need no real waits. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Returns whether the claim landed. A false is never worth surfacing to the user: the app has
 * already opened, which is what they asked for, and the web page falls back on its own deadline.
 */
export const claimLaunchNonce = async (
  nonce: string,
  options: ClaimLaunchNonceOptions = {},
): Promise<boolean> => {
  const sleep = options.sleep ?? delay;
  const url = `${config.portalApiUrl()}/desktopapp/launch-handshake/${encodeURIComponent(nonce)}/claim`;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }

    try {
      // Sent when we have one, omitted when we do not, and never required. The endpoint is anonymous
      // precisely because this app is regularly signed out at the moment the OS hands it the deep
      // link: the commonest route into this feature is installing from the Tools page and launching
      // for the first time. Refusing to claim without a token would report "not installed" for an app
      // that had just opened, which is the exact failure the handshake exists to prevent.
      //
      // Read inside the loop and inside the try, so a refresh that fails on a network still coming up
      // costs one attempt rather than the whole call.
      const token = await IdentityServerAuthService.getInstance()
        .getAccessToken()
        .catch(() => null);

      const response = await fetch(url, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.ok) {
        return true;
      }

      // Terminal: the nonce is unknown, expired, or already claimed. No amount of retrying changes
      // any of those, and the browser has stopped waiting.
      if (response.status === 404) {
        console.info("[LaunchHandshake] Nonce was unknown, expired or already claimed");
        return false;
      }

      // Anything else might be transient, so fall through to the next attempt.
    } catch {
      // Unreachable, timed out, or aborted. Same treatment: retry while attempts remain.
    }
  }

  console.warn("[LaunchHandshake] Gave up claiming the launch nonce");
  return false;
};
