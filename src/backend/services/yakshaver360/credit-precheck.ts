import { config } from "../../config/env";

/**
 * Pre-flight credit check for the YakShaver Anywhere (cloud 360) path, reading the same
 * GET /api/credits/balance as assertCanShave in SSW.YakShaver.
 *
 * Fail-OPEN, unlike the server gate: this is a courtesy with no security role, and blocking a
 * paying user because the balance endpoint was unreachable is worse than letting
 * /api/360/recordings/[id]/process reject them a moment later.
 */

interface CreditBalanceDto {
  remaining: number;
  error?: string;
}

/**
 * Mirrors ShaveBlockReason in SSW.YakShaver, minus "unavailable" — this check fails open, so an
 * unreachable backend never blocks.
 */
export type ShaveBlockReason = "out-of-credits" | "no-subscription";

export interface CreditPrecheckResult {
  canShave: boolean;
  /** Set only when canShave is false. */
  reason?: ShaveBlockReason;
  /** User-facing message, set only when canShave is false. */
  message?: string;
}

const BILLING_HINT = "Visit https://portal.yakshaver.ai/plan to update your subscription.";

export async function checkCloud360Credits(token: string): Promise<CreditPrecheckResult> {
  let balance: CreditBalanceDto;
  try {
    const response = await fetch(`${config.portalApiUrl()}/credits/balance`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return { canShave: true };
    balance = (await response.json()) as CreditBalanceDto;
  } catch {
    // Unreachable, non-ok or unparseable — fail open and let the process route report the truth.
    return { canShave: true };
  }

  if ((balance?.remaining ?? 0) >= 1) return { canShave: true };

  const hasNoPlan = balance?.error === "NoStripeCustomer" || balance?.error === "NoActiveSubscription";
  return hasNoPlan
    ? {
        canShave: false,
        reason: "no-subscription",
        message: `No active YakShaver subscription, so this recording can't be processed. ${BILLING_HINT}`,
      }
    : {
        canShave: false,
        reason: "out-of-credits",
        message: `Out of YakShaver credits, so this recording can't be processed. ${BILLING_HINT}`,
      };
}
