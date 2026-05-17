import { db } from "../db";
import { users } from "@shared/models/auth";
import { locations } from "@shared/schema";
import { eq, and, lte, isNotNull, sql } from "drizzle-orm";
import { logBillingActivity } from "./billing-service";
import { cache } from "../cache";

const FREE_TRIAL_DAYS = 60;

export async function runTrialExpirationCheck(): Promise<{ expired: number; skipped: number }> {
  const now = new Date();
  let expired = 0;
  let skipped = 0;

  const expiredUsers = await db
    .select({ id: users.id, email: users.email, trialEndsAt: users.trialEndsAt })
    .from(users)
    .where(
      and(
        eq(users.subscriptionStatus, "trial"),
        isNotNull(users.trialEndsAt),
        lte(users.trialEndsAt, now)
      )
    );

  for (const user of expiredUsers) {
    try {
      const hasActiveSub = await userHasActivePaidSubscription(user.id);
      if (hasActiveSub) {
        skipped++;
        continue;
      }

      await db
        .update(users)
        .set({ subscriptionStatus: "expired" })
        .where(eq(users.id, user.id));

      const [store] = await db
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.userId, user.id))
        .limit(1);

      if (store) {
        await db
          .update(locations)
          .set({ accountStatus: "Inactive" })
          .where(eq(locations.id, store.id));

        await deactivateLaunchSite(store.id);

        cache.billing.invalidate(store.id);

        try {
          await logBillingActivity({
            salonId: store.id,
            eventType: "trial.expired",
            severity: "warn",
            message: `60-day free trial expired for ${user.email}. Account deactivated.`,
            metadata: { userId: user.id, trialEndsAt: user.trialEndsAt?.toISOString() },
            source: "system",
          });
        } catch {}
      }

      expired++;
      console.log(`[TrialExpiration] Expired account for user ${user.email} (${user.id})`);
    } catch (err) {
      console.error(`[TrialExpiration] Failed to expire user ${user.id}:`, err);
    }
  }

  if (expired > 0) {
    console.log(`[TrialExpiration] Expired ${expired} accounts, skipped ${skipped} (paid)`);
  }

  return { expired, skipped };
}

export async function reactivateExpiredAccount(salonId: number): Promise<void> {
  const [store] = await db
    .select({ id: locations.id, userId: locations.userId, accountStatus: locations.accountStatus })
    .from(locations)
    .where(eq(locations.id, salonId))
    .limit(1);

  if (!store) return;

  await db
    .update(locations)
    .set({ accountStatus: "Active" })
    .where(eq(locations.id, salonId));

  if (store.userId) {
    await db
      .update(users)
      .set({ subscriptionStatus: "active", trialEndsAt: null })
      .where(eq(users.id, store.userId));
  }

  await reactivateLaunchSite(salonId);

  cache.billing.invalidate(salonId);

  console.log(`[TrialExpiration] Reactivated account for store ${salonId}`);
}

async function userHasActivePaidSubscription(userId: string): Promise<boolean> {
  try {
    const { subscriptions } = await import("@shared/schema/billing");
    const [store] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.userId, userId))
      .limit(1);

    if (!store) return false;

    const [sub] = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.storeNumber, store.id))
      .limit(1);

    return sub?.status === "active" || sub?.status === "trialing";
  } catch {
    return false;
  }
}

async function deactivateLaunchSite(storeId: number): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE onboarding_submissions
      SET status = 'inactive'
      WHERE id IN (
        SELECT submission_id FROM subdomains
        WHERE submission_id IN (
          SELECT id FROM onboarding_submissions
          WHERE status = 'completed'
        )
      )
      AND id IN (
        SELECT os.id FROM onboarding_submissions os
        JOIN subdomains s ON s.submission_id = os.id
        WHERE os.store_id = ${storeId}
      )
    `);
  } catch {
    try {
      await db.execute(sql`
        UPDATE onboarding_submissions
        SET status = 'inactive'
        WHERE store_id = ${storeId}
        AND status = 'completed'
      `);
    } catch {}
  }
}

async function reactivateLaunchSite(storeId: number): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE onboarding_submissions
      SET status = 'completed'
      WHERE store_id = ${storeId}
      AND status = 'inactive'
    `);
  } catch {}
}

export function startTrialExpirationScheduler(): void {
  const INTERVAL_MS = 60 * 60 * 1000;

  const run = () => {
    runTrialExpirationCheck().catch((err) =>
      console.error("[TrialExpiration] Scheduler error:", err)
    );
  };

  run();
  setInterval(run, INTERVAL_MS);
  console.log("[TrialExpiration] Scheduler started — runs every hour");
}
