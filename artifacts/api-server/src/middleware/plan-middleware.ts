import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { subscriptions, billingPlans } from "@shared/schema/billing";
import { locations } from "@shared/schema";
import { eq } from "drizzle-orm";

export type PlanTier = "free" | "solo" | "professional" | "elite";

const PLAN_TIER_ORDER: Record<PlanTier, number> = {
  free: 0,
  solo: 1,
  professional: 2,
  elite: 3,
};

async function getStorePlanTier(storeId: number): Promise<PlanTier> {
  try {
    const [sub] = await db
      .select({ planCode: subscriptions.planCode })
      .from(subscriptions)
      .where(eq(subscriptions.storeNumber, storeId))
      .limit(1);

    if (!sub) return "free";

    const code = sub.planCode.toLowerCase();
    if (code.includes("elite")) return "elite";
    if (code.includes("professional") || code.includes("pro")) return "professional";
    if (code.includes("solo")) return "solo";
    return "free";
  } catch {
    return "free";
  }
}

export function requirePlan(minimumTier: PlanTier) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const storeId = Number(req.query.storeId || req.body?.storeId || (req.params as any)?.storeId);
      if (!storeId) return next();

      const tier = await getStorePlanTier(storeId);
      const tierLevel = PLAN_TIER_ORDER[tier] ?? 0;
      const requiredLevel = PLAN_TIER_ORDER[minimumTier] ?? 0;

      if (tierLevel < requiredLevel) {
        return res.status(403).json({
          message: `This feature requires a ${minimumTier} plan or higher.`,
          code: "PLAN_UPGRADE_REQUIRED",
          requiredPlan: minimumTier,
          currentPlan: tier,
        });
      }
      next();
    } catch (err) {
      console.error("[PlanMiddleware] Error checking plan:", err);
      next();
    }
  };
}

export async function checkStaffLimit(storeId: number): Promise<{ allowed: boolean; limit: number; current: number }> {
  const tier = await getStorePlanTier(storeId);
  const { staff } = await import("@shared/schema");
  const { count, eq } = await import("drizzle-orm");
  const [{ value }] = await db.select({ value: count() }).from(staff).where(eq(staff.storeId, storeId));
  const current = Number(value);
  const limit = tier === "solo" ? 1 : tier === "free" ? 3 : 999;
  return { allowed: current < limit, limit, current };
}

export async function checkClientLimit(storeId: number): Promise<{ allowed: boolean; limit: number; current: number }> {
  const tier = await getStorePlanTier(storeId);
  const { customers } = await import("@shared/schema");
  const { count, eq } = await import("drizzle-orm");
  const [{ value }] = await db.select({ value: count() }).from(customers).where(eq(customers.storeId, storeId));
  const current = Number(value);
  const limit = tier === "free" ? 100 : tier === "solo" ? 500 : 999999;
  return { allowed: current < limit, limit, current };
}
