/**
 * Billing Dunning Scheduler
 * -------------------------
 * Runs once per hour. Finds accounts that have been suspended for 30+ days
 * and locks them: cancels the Stripe subscription and marks accountStatus = 'locked'.
 *
 * Called from server/routes.ts → startBillingDunningScheduler().
 */

import { db } from "./db";
import { customerBillingProfiles } from "@shared/schema/billing";
import { eq, lt, and } from "drizzle-orm";
import { lockAccount } from "./services/billing-service";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function runDunningCheck(): Promise<void> {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  // Find all accounts that have been suspended for 30+ days
  const overdueAccounts = await db
    .select({
      salonId:     customerBillingProfiles.salonId,
      suspendedAt: customerBillingProfiles.suspendedAt,
    })
    .from(customerBillingProfiles)
    .where(
      and(
        eq(customerBillingProfiles.accountStatus, "suspended"),
        lt(customerBillingProfiles.suspendedAt, cutoff)
      )
    );

  if (overdueAccounts.length === 0) return;

  console.log(`[Dunning] Found ${overdueAccounts.length} account(s) past the 30-day suspension threshold — locking.`);

  for (const account of overdueAccounts) {
    if (!account.salonId) continue;
    try {
      await lockAccount(account.salonId, "30 days past due — subscription auto-canceled");
      console.log(`[Dunning] Locked account for salon ${account.salonId}`);
    } catch (err: any) {
      console.error(`[Dunning] Failed to lock salon ${account.salonId}:`, err.message);
    }
  }
}

export function startBillingDunningScheduler(): void {
  // Run once immediately on startup, then every hour
  runDunningCheck().catch((err) =>
    console.error("[Dunning] Initial check failed:", err)
  );

  setInterval(() => {
    runDunningCheck().catch((err) =>
      console.error("[Dunning] Scheduled check failed:", err)
    );
  }, CHECK_INTERVAL_MS);

  console.log("[Dunning] Billing dunning scheduler started (checks every hour, locks after 30 days)");
}
