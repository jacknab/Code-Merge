import { Router, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import { billingPlans } from "@shared/schema/billing";
import { logBillingActivity } from "../services/billing-service";

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  const role = req.session?.role;
  if (!req.session?.userId) return res.status(401).json({ error: "Unauthorized" });
  if (role !== "platform_admin" && role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
}

// GET /api/billing/admin/plans — all plans including inactive
router.get("/admin/plans", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const plans = await db
      .select()
      .from(billingPlans)
      .orderBy(billingPlans.priceCents, billingPlans.interval);
    res.json({ plans });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/admin/plans — create a new plan
router.post("/admin/plans", requireAdmin, async (req: any, res: Response): Promise<void> => {
  try {
    const {
      code, name, description, priceCents, contactsMin, contactsMax,
      stripePriceId, stripeProductId, interval, smsCredits, currency,
      active, featuresJson
    } = req.body;

    if (!code || !name || priceCents == null) {
      res.status(400).json({ error: "code, name, and priceCents are required" });
      return;
    }

    const [plan] = await db
      .insert(billingPlans)
      .values({
        code,
        name,
        description: description ?? null,
        priceCents: String(priceCents),
        contactsMin: contactsMin != null ? String(contactsMin) : null,
        contactsMax: contactsMax != null ? String(contactsMax) : null,
        stripePriceId: stripePriceId ?? null,
        stripeProductId: stripeProductId ?? null,
        interval: interval ?? "month",
        smsCredits: smsCredits != null ? String(smsCredits) : null,
        currency: currency ?? "usd",
        active: active !== false,
        featuresJson: featuresJson ?? null,
      })
      .returning();

    await logBillingActivity({
      userId: req.session.userId,
      eventType: "plan.created",
      severity: "info",
      message: `Plan "${name}" (${code}) created`,
      metadata: { planId: plan.id, code },
      source: "admin",
    });

    res.status(201).json({ plan });
  } catch (err: any) {
    if (err.message?.includes("unique")) {
      res.status(409).json({ error: `Plan code "${req.body.code}" already exists` });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// PUT /api/billing/admin/plans/:id — update a plan
router.put("/admin/plans/:id", requireAdmin, async (req: any, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const {
      name, description, priceCents, contactsMin, contactsMax,
      stripePriceId, stripeProductId, interval, smsCredits, currency,
      active, featuresJson
    } = req.body;

    const patch: Partial<typeof billingPlans.$inferInsert> = { updatedAt: new Date() };
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (priceCents !== undefined) patch.priceCents = String(priceCents);
    if (contactsMin !== undefined) patch.contactsMin = contactsMin != null ? String(contactsMin) : null;
    if (contactsMax !== undefined) patch.contactsMax = contactsMax != null ? String(contactsMax) : null;
    if (stripePriceId !== undefined) patch.stripePriceId = stripePriceId;
    if (stripeProductId !== undefined) patch.stripeProductId = stripeProductId;
    if (interval !== undefined) patch.interval = interval;
    if (smsCredits !== undefined) patch.smsCredits = smsCredits != null ? String(smsCredits) : null;
    if (currency !== undefined) patch.currency = currency;
    if (active !== undefined) patch.active = active;
    if (featuresJson !== undefined) patch.featuresJson = featuresJson;

    const [updated] = await db
      .update(billingPlans)
      .set(patch)
      .where(eq(billingPlans.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    await logBillingActivity({
      userId: req.session.userId,
      eventType: "plan.updated",
      severity: "info",
      message: `Plan "${updated.name}" (${updated.code}) updated`,
      metadata: { planId: id, changes: Object.keys(patch) },
      source: "admin",
    });

    res.json({ plan: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/billing/admin/plans/:id/toggle — toggle active/inactive
router.patch("/admin/plans/:id/toggle", requireAdmin, async (req: any, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db
      .select({ active: billingPlans.active, name: billingPlans.name, code: billingPlans.code })
      .from(billingPlans)
      .where(eq(billingPlans.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    const [updated] = await db
      .update(billingPlans)
      .set({ active: !existing.active, updatedAt: new Date() })
      .where(eq(billingPlans.id, id))
      .returning();

    await logBillingActivity({
      userId: req.session.userId,
      eventType: updated.active ? "plan.activated" : "plan.deactivated",
      severity: "info",
      message: `Plan "${existing.name}" (${existing.code}) ${updated.active ? "activated" : "deactivated"}`,
      metadata: { planId: id },
      source: "admin",
    });

    res.json({ plan: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/billing/admin/plans/:id — soft delete (deactivate)
router.delete("/admin/plans/:id", requireAdmin, async (req: any, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const [updated] = await db
      .update(billingPlans)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(billingPlans.id, id))
      .returning({ name: billingPlans.name, code: billingPlans.code });

    if (!updated) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    await logBillingActivity({
      userId: req.session.userId,
      eventType: "plan.deleted",
      severity: "warn",
      message: `Plan "${updated.name}" (${updated.code}) deactivated`,
      metadata: { planId: id },
      source: "admin",
    });

    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
