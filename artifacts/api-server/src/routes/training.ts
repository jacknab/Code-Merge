import { Router } from "express";
import { db } from "../db";
import {
  trainingActionCategories,
  trainingUserState,
  trainingUserProfile,
  trainingEvents,
  trainingSettings,
  staff,
  locations,
  type InsertTrainingEvent,
  type TrainingActionCategory,
  type TrainingUserState,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { isAuthenticated } from "../auth";
import { eq, and, inArray, desc } from "drizzle-orm";
import { reduce, type CategoryState, type TrainingEventType } from "../training/reducer";
import {
  ensureSandboxForUser,
  resetSandboxData,
  sandboxStoreIdForUser,
  applySandboxScenario,
  recordScenarioRun,
  clearScenarioRun,
  evaluateScenarioRun,
  SANDBOX_SCENARIOS,
  type SandboxScenarioKey,
} from "../training/sandbox";

const router = Router();

const uid = (req: any): string | null => {
  const id =
    req.auth?.userId ??
    (req.session as any)?.userId ??
    req.user?.id ??
    req.user?.claims?.sub ??
    null;
  return id ? String(id) : null;
};

const VALID_EVENT_TYPES = new Set([
  "view",
  "success",
  "hesitation",
  "wrong-click",
  "help-requested",
  "abandoned",
]);

// Auto-enroll any signed-in user who doesn't yet have a training profile.
// Owners may opt out via training_settings.auto_enroll_new_staff (Phase 7).
async function ensureProfile(userId: string) {
  const [existing] = await db
    .select()
    .from(trainingUserProfile)
    .where(eq(trainingUserProfile.userId, userId));
  if (existing) return existing;
  const [created] = await db
    .insert(trainingUserProfile)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (created) {
    // Phase 9.1 — first enrollment for this user; make sure their store has a
    // practice sandbox ready. Best-effort: do not block enrollment on failure.
    ensureSandboxForUser(userId).catch((err) =>
      console.error("[training] ensureSandboxForUser failed:", err),
    );
    return created;
  }
  // Lost the race — re-read.
  const [reread] = await db
    .select()
    .from(trainingUserProfile)
    .where(eq(trainingUserProfile.userId, userId));
  return reread;
}

router.get("/state", isAuthenticated, async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const settings = await getSettingsForUser(userId);

    // Phase 7 — respect store-level "auto-enroll new staff" toggle.
    // If disabled, only enroll users whose owner manually opted them in
    // (i.e. a profile already exists).
    let profile = await db
      .select()
      .from(trainingUserProfile)
      .where(eq(trainingUserProfile.userId, userId))
      .then((r) => r[0]);
    if (!profile && settings.autoEnrollNewStaff) {
      profile = await ensureProfile(userId);
    }

    const categories = await db.select().from(trainingActionCategories);
    const state = profile
      ? await db
          .select()
          .from(trainingUserState)
          .where(eq(trainingUserState.userId, userId))
      : [];

    res.json({
      enrolled: !!profile && settings.enabled,
      profile,
      categories,
      state,
      settings: {
        enabled: settings.enabled,
        autoEnrollNewStaff: settings.autoEnrollNewStaff,
        graduationMinDays: settings.graduationMinDays,
        showHelpBubbleAfterGraduation: settings.showHelpBubbleAfterGraduation,
        storeId: settings.storeId,
      },
    });
  } catch (err) {
    console.error("[training] /state error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/event", isAuthenticated, async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const { categorySlug, type, helpLevelAtTime, metadata } = req.body ?? {};
    if (!categorySlug || typeof categorySlug !== "string") {
      return res.status(400).json({ error: "categorySlug required" });
    }
    if (!VALID_EVENT_TYPES.has(type)) {
      return res.status(400).json({ error: "invalid event type" });
    }
    const helpLevel = Number.isInteger(helpLevelAtTime) ? helpLevelAtTime : 3;
    if (helpLevel < 0 || helpLevel > 3) {
      return res.status(400).json({ error: "helpLevelAtTime must be 0..3" });
    }

    const [category] = await db
      .select()
      .from(trainingActionCategories)
      .where(eq(trainingActionCategories.slug, categorySlug));
    if (!category) return res.status(404).json({ error: "unknown category" });

    await ensureProfile(userId);

    // Persist the raw event first — the reducer below is best-effort.
    const eventRow: InsertTrainingEvent = {
      userId,
      categoryId: category.id,
      type,
      helpLevelAtTime: helpLevel,
      metadata: metadata ?? null,
    };
    await db.insert(trainingEvents).values(eventRow);

    // Load (or initialize) per-category state, run the reducer, write back.
    const [existing] = await db
      .select()
      .from(trainingUserState)
      .where(
        and(
          eq(trainingUserState.userId, userId),
          eq(trainingUserState.categoryId, category.id),
        ),
      );

    const now = new Date();
    const current: CategoryState = existing
      ? {
          helpLevel: existing.helpLevel,
          successStreak: existing.successStreak,
          failures: existing.failures,
          totalAttempts: existing.totalAttempts,
          lastSeenAt: existing.lastSeenAt,
          graduatedAt: existing.graduatedAt,
          pinnedLevel: existing.pinnedLevel,
          enrolledAt: existing.lastSeenAt ?? now,
        }
      : {
          helpLevel: category.defaultHelpLevel,
          successStreak: 0,
          failures: 0,
          totalAttempts: 0,
          lastSeenAt: null,
          graduatedAt: null,
          pinnedLevel: null,
          enrolledAt: now,
        };

    const nextState = reduce({
      state: current,
      event: { type: type as TrainingEventType, at: now },
      highRisk: category.highRisk,
    });

    if (existing) {
      await db
        .update(trainingUserState)
        .set({
          helpLevel: nextState.helpLevel,
          successStreak: nextState.successStreak,
          failures: nextState.failures,
          totalAttempts: nextState.totalAttempts,
          lastSeenAt: nextState.lastSeenAt,
          graduatedAt: nextState.graduatedAt,
        })
        .where(eq(trainingUserState.id, existing.id));
    } else {
      await db.insert(trainingUserState).values({
        userId,
        categoryId: category.id,
        helpLevel: nextState.helpLevel,
        successStreak: nextState.successStreak,
        failures: nextState.failures,
        totalAttempts: nextState.totalAttempts,
        lastSeenAt: nextState.lastSeenAt,
        graduatedAt: nextState.graduatedAt,
      });
    }

    // Phase 6 — overall graduation detection.
    // If this category just graduated AND every category is now graduated,
    // stamp the user's profile.graduatedAt so the owner gets a notification.
    if (nextState.graduatedAt) {
      const [profile] = await db
        .select()
        .from(trainingUserProfile)
        .where(eq(trainingUserProfile.userId, userId));
      if (profile && !profile.graduatedAt) {
        // Phase 7 — honor minimum-days gate. Owners can require staff to be
        // enrolled for at least N days before being allowed to graduate.
        const settings = await getSettingsForUser(userId);
        const enrolledMs = profile.enrolledAt ? new Date(profile.enrolledAt).getTime() : Date.now();
        const ageDays = (Date.now() - enrolledMs) / 86_400_000;
        if (ageDays < (settings.graduationMinDays ?? 0)) {
          // Skip overall graduation; per-category state still updated above.
        } else {
        const allCategories = await db.select({ id: trainingActionCategories.id }).from(trainingActionCategories);
        const userStates = await db
          .select({ categoryId: trainingUserState.categoryId, graduatedAt: trainingUserState.graduatedAt })
          .from(trainingUserState)
          .where(eq(trainingUserState.userId, userId));
        const gradSet = new Set(userStates.filter((s) => s.graduatedAt).map((s) => s.categoryId));
        const allDone = allCategories.length > 0 && allCategories.every((c) => gradSet.has(c.id));
        if (allDone) {
          await db
            .update(trainingUserProfile)
            .set({ graduatedAt: new Date(), graduationNotifiedOwner: false })
            .where(eq(trainingUserProfile.userId, userId));
        }
        }
      }
    }

    res.json({
      ok: true,
      state: {
        categorySlug: category.slug,
        helpLevel: nextState.helpLevel,
        successStreak: nextState.successStreak,
        failures: nextState.failures,
        totalAttempts: nextState.totalAttempts,
        graduatedAt: nextState.graduatedAt,
      },
    });
  } catch (err) {
    console.error("[training] /event error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// === Owner / manager dashboard endpoints ===

function isManagerRole(role: unknown): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

/**
 * Verify the requester is a manager who can administer staff at `storeId`.
 * Owners are gated by `locations.userId`; managers/admins are trusted globally
 * (they're already authenticated and the UI scopes them per-store).
 */
/**
 * Phase 7 — settings helper. Returns the merged training settings row for a
 * store (creates the default row on first read so the UI always has something
 * to bind to).
 */
const SETTINGS_DEFAULTS = {
  enabled: true,
  autoEnrollNewStaff: true,
  graduationMinDays: 7,
  showHelpBubbleAfterGraduation: true,
};

async function getSettingsForStore(storeId: number) {
  const [row] = await db
    .select()
    .from(trainingSettings)
    .where(eq(trainingSettings.storeId, storeId));
  if (row) return row;
  const [created] = await db
    .insert(trainingSettings)
    .values({ storeId, ...SETTINGS_DEFAULTS })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [reread] = await db
    .select()
    .from(trainingSettings)
    .where(eq(trainingSettings.storeId, storeId));
  return reread;
}

/** Resolve the effective settings for a signed-in user (looks up their store). */
async function getSettingsForUser(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.staffId) return { storeId: null, ...SETTINGS_DEFAULTS };
  const [s] = await db.select().from(staff).where(eq(staff.id, u.staffId));
  if (!s?.storeId) return { storeId: null, ...SETTINGS_DEFAULTS };
  const settings = await getSettingsForStore(s.storeId);
  return { ...settings, storeId: s.storeId };
}

async function assertManagesStore(req: any, storeId: number): Promise<boolean> {
  const role = req.auth?.role ?? req.user?.role ?? req.user?.claims?.role;
  const userId = uid(req);
  // Anyone whose user account owns this store can manage it, regardless of
  // the `users.role` label (some legacy accounts are saved as "staff" even
  // though they registered the store).
  if (userId) {
    const [loc] = await db
      .select({ userId: locations.userId })
      .from(locations)
      .where(eq(locations.id, storeId));
    if (loc?.userId && loc.userId === userId) return true;
  }
  if (!isManagerRole(role)) return false;
  if (role === "owner") {
    const [loc] = await db
      .select({ userId: locations.userId })
      .from(locations)
      .where(eq(locations.id, storeId));
    if (!loc) return false;
    if (loc.userId && loc.userId !== userId) return false;
  }
  return true;
}

router.get("/admin/staff", isAuthenticated, async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const storeId = Number(req.query.storeId);
    if (!Number.isInteger(storeId)) {
      return res.status(400).json({ error: "storeId required" });
    }
    if (!(await assertManagesStore(req, storeId))) {
      return res.status(403).json({ error: "forbidden" });
    }

    // Staff records for the store, plus any user accounts linked to them.
    const storeStaff = await db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(eq(staff.storeId, storeId));
    const staffIds = storeStaff.map((s) => s.id);
    const staffNameById = new Map(storeStaff.map((s) => [s.id, s.name]));

    const linkedUsers = staffIds.length
      ? await db
          .select()
          .from(users)
          .where(inArray(users.staffId, staffIds))
      : [];

    const categories = await db.select().from(trainingActionCategories);
    const userIds = linkedUsers.map((u) => u.id);
    const states = userIds.length
      ? await db
          .select()
          .from(trainingUserState)
          .where(inArray(trainingUserState.userId, userIds))
      : [];
    const profiles = userIds.length
      ? await db
          .select()
          .from(trainingUserProfile)
          .where(inArray(trainingUserProfile.userId, userIds))
      : [];
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
    const statesByUser = new Map<string, typeof states>();
    for (const s of states) {
      if (!statesByUser.has(s.userId)) statesByUser.set(s.userId, [] as any);
      statesByUser.get(s.userId)!.push(s);
    }

    const rows = linkedUsers.map((u) => {
      const userStates = statesByUser.get(u.id) ?? [];
      const totalCats = categories.length || 1;
      const graduated = userStates.filter((s) => s.graduatedAt).length;
      const lastSeen = userStates.reduce<Date | null>((acc, s) => {
        const d = s.lastSeenAt ? new Date(s.lastSeenAt) : null;
        if (!d) return acc;
        if (!acc || d.getTime() > acc.getTime()) return d;
        return acc;
      }, null);
      const avgLevel = userStates.length
        ? userStates.reduce((a, s) => a + s.helpLevel, 0) / userStates.length
        : 3;
      return {
        userId: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        staffId: u.staffId,
        staffName: u.staffId ? staffNameById.get(u.staffId) ?? null : null,
        profile: profileByUser.get(u.id) ?? null,
        graduatedCategories: graduated,
        totalCategories: totalCats,
        avgHelpLevel: Number(avgLevel.toFixed(2)),
        lastActivityAt: lastSeen ? lastSeen.toISOString() : null,
      };
    });

    res.json({ categories, staff: rows });
  } catch (err) {
    console.error("[training] /admin/staff error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

router.get("/admin/staff/:userId", isAuthenticated, async (req, res) => {
  try {
    const requester = uid(req);
    if (!requester) return res.status(401).json({ error: "unauthorized" });
    const storeId = Number(req.query.storeId);
    if (!Number.isInteger(storeId)) {
      return res.status(400).json({ error: "storeId required" });
    }
    if (!(await assertManagesStore(req, storeId))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const targetUserId = String(req.params.userId);

    const [target] = await db.select().from(users).where(eq(users.id, targetUserId));
    if (!target) return res.status(404).json({ error: "user not found" });

    const categories = await db.select().from(trainingActionCategories);
    const states = await db
      .select()
      .from(trainingUserState)
      .where(eq(trainingUserState.userId, targetUserId));
    const [profile] = await db
      .select()
      .from(trainingUserProfile)
      .where(eq(trainingUserProfile.userId, targetUserId));

    const recentEvents = await db
      .select()
      .from(trainingEvents)
      .where(eq(trainingEvents.userId, targetUserId))
      .orderBy(desc(trainingEvents.occurredAt))
      .limit(50);

    res.json({
      user: {
        id: target.id,
        email: target.email,
        firstName: target.firstName,
        lastName: target.lastName,
        role: target.role,
      },
      profile,
      categories,
      state: states,
      recentEvents,
    });
  } catch (err) {
    console.error("[training] /admin/staff/:userId error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * Phase 6 — Pending graduation notifications for the owner.
 * Returns staff (in stores the requester manages) whose profile has
 * graduatedAt set but graduationNotifiedOwner is still false.
 */
router.get("/notifications", isAuthenticated, async (req, res) => {
  try {
    const requester = uid(req);
    if (!requester) return res.status(401).json({ error: "unauthorized" });
    const role = (req as any).user?.role ?? (req as any).user?.claims?.role;
    if (!isManagerRole(role)) return res.json({ notifications: [] });

    // Find every store this user manages (owners) — managers/admins see all.
    let storeFilter: number[] | null = null;
    if (role === "owner") {
      const owned = await db
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.userId, requester));
      storeFilter = owned.map((s) => s.id);
      if (storeFilter.length === 0) return res.json({ notifications: [] });
    }

    // Pull graduated, un-notified profiles.
    const pendingProfiles = await db
      .select()
      .from(trainingUserProfile);
    const candidates = pendingProfiles.filter(
      (p) => p.graduatedAt && !p.graduationNotifiedOwner,
    );
    if (candidates.length === 0) return res.json({ notifications: [] });

    const candidateUserIds = candidates.map((p) => p.userId);
    const candidateUsers = await db
      .select()
      .from(users)
      .where(inArray(users.id, candidateUserIds));

    // Filter by manager scope: their staffId must belong to a store in scope.
    const staffIds = candidateUsers.map((u) => u.staffId).filter((x): x is number => !!x);
    const staffRows = staffIds.length
      ? await db.select().from(staff).where(inArray(staff.id, staffIds))
      : [];
    const staffById = new Map(staffRows.map((s) => [s.id, s]));

    const notifications = candidateUsers
      .map((u) => {
        if (!u.staffId) return null;
        const sRow = staffById.get(u.staffId);
        if (!sRow) return null;
        if (storeFilter && (!sRow.storeId || !storeFilter.includes(sRow.storeId))) return null;
        const profile = candidates.find((p) => p.userId === u.id)!;
        return {
          userId: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          staffName: sRow.name,
          storeId: sRow.storeId,
          graduatedAt: profile.graduatedAt,
        };
      })
      .filter(Boolean);

    res.json({ notifications });
  } catch (err) {
    console.error("[training] /notifications error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/notifications/dismiss", isAuthenticated, async (req, res) => {
  try {
    const requester = uid(req);
    if (!requester) return res.status(401).json({ error: "unauthorized" });
    const role = (req as any).user?.role ?? (req as any).user?.claims?.role;
    if (!isManagerRole(role)) return res.status(403).json({ error: "forbidden" });
    const { userId } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: "userId required" });

    await db
      .update(trainingUserProfile)
      .set({ graduationNotifiedOwner: true })
      .where(eq(trainingUserProfile.userId, String(userId)));

    res.json({ ok: true });
  } catch (err) {
    console.error("[training] /notifications/dismiss error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/admin/pin", isAuthenticated, async (req, res) => {
  try {
    const requester = uid(req);
    if (!requester) return res.status(401).json({ error: "unauthorized" });
    const { userId, categoryId, pinnedLevel, storeId } = req.body ?? {};
    if (!userId || !Number.isInteger(categoryId) || !Number.isInteger(storeId)) {
      return res.status(400).json({ error: "userId, categoryId, storeId required" });
    }
    const pin: number | null =
      pinnedLevel === null || pinnedLevel === undefined ? null : Number(pinnedLevel);
    if (pin !== null && (!Number.isInteger(pin) || pin < 0 || pin > 3)) {
      return res.status(400).json({ error: "pinnedLevel must be 0..3 or null" });
    }
    if (!(await assertManagesStore(req, storeId))) {
      return res.status(403).json({ error: "forbidden" });
    }

    const [existing] = await db
      .select()
      .from(trainingUserState)
      .where(
        and(
          eq(trainingUserState.userId, String(userId)),
          eq(trainingUserState.categoryId, categoryId),
        ),
      );

    if (existing) {
      await db
        .update(trainingUserState)
        .set({
          pinnedLevel: pin,
          // When pinning, snap visible level to the pin so behavior is immediate.
          helpLevel: pin !== null ? pin : existing.helpLevel,
        })
        .where(eq(trainingUserState.id, existing.id));
    } else {
      const [cat] = await db
        .select()
        .from(trainingActionCategories)
        .where(eq(trainingActionCategories.id, categoryId));
      if (!cat) return res.status(404).json({ error: "category not found" });
      await db.insert(trainingUserState).values({
        userId: String(userId),
        categoryId,
        helpLevel: pin ?? cat.defaultHelpLevel,
        pinnedLevel: pin,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[training] /admin/pin error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * Phase 7 — store-level training settings.
 */
router.get("/admin/settings", isAuthenticated, async (req, res) => {
  try {
    const storeId = Number(req.query.storeId);
    if (!Number.isInteger(storeId)) return res.status(400).json({ error: "storeId required" });
    if (!(await assertManagesStore(req, storeId))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const settings = await getSettingsForStore(storeId);
    res.json({ settings });
  } catch (err) {
    console.error("[training] /admin/settings GET error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

router.put("/admin/settings", isAuthenticated, async (req, res) => {
  try {
    const { storeId, enabled, autoEnrollNewStaff, graduationMinDays, showHelpBubbleAfterGraduation } =
      req.body ?? {};
    if (!Number.isInteger(storeId)) return res.status(400).json({ error: "storeId required" });
    if (!(await assertManagesStore(req, storeId))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const minDays = Number(graduationMinDays);
    if (!Number.isInteger(minDays) || minDays < 0 || minDays > 365) {
      return res.status(400).json({ error: "graduationMinDays must be 0..365" });
    }
    await getSettingsForStore(storeId); // ensure row exists
    const [updated] = await db
      .update(trainingSettings)
      .set({
        enabled: !!enabled,
        autoEnrollNewStaff: !!autoEnrollNewStaff,
        graduationMinDays: minDays,
        showHelpBubbleAfterGraduation: !!showHelpBubbleAfterGraduation,
      })
      .where(eq(trainingSettings.storeId, storeId))
      .returning();
    res.json({ settings: updated });
  } catch (err) {
    console.error("[training] /admin/settings PUT error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * Phase 8.2 — staff dismisses the one-time "You've graduated 🎓" card.
 */
router.post("/acknowledge-graduation", isAuthenticated, async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    await db
      .update(trainingUserProfile)
      .set({ graduationStaffNotified: true })
      .where(eq(trainingUserProfile.userId, userId));
    res.json({ ok: true });
  } catch (err) {
    console.error("[training] /acknowledge-graduation error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/reset/:userId", isAuthenticated, async (req, res) => {
  try {
    const actor = uid(req);
    if (!actor) return res.status(401).json({ error: "unauthorized" });
    const role = (req as any).user?.role ?? (req as any).user?.claims?.role;
    if (role !== "owner" && role !== "admin" && role !== "manager") {
      return res.status(403).json({ error: "forbidden" });
    }

    const targetUserId = String(req.params.userId);

    await db.delete(trainingEvents).where(eq(trainingEvents.userId, targetUserId));
    await db.delete(trainingUserState).where(eq(trainingUserState.userId, targetUserId));
    await db
      .update(trainingUserProfile)
      .set({
        graduatedAt: null,
        graduationNotifiedOwner: false,
        graduationStaffNotified: false,
        day7DigestSentAt: null,
        enrolledAt: new Date(),
      })
      .where(eq(trainingUserProfile.userId, targetUserId));

    res.json({ ok: true });
  } catch (err) {
    console.error("[training] /reset error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * Phase 9.4 — return (and lazily create) the practice sandbox store for the
 * authenticated caller. Called by the client when entering Practice Mode.
 */
router.get("/sandbox", isAuthenticated, async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    // Resolve user → staff → store → sandbox.
    let sandboxId = await sandboxStoreIdForUser(userId);
    if (!sandboxId) {
      sandboxId = await ensureSandboxForUser(userId);
    }
    if (!sandboxId) {
      return res.status(404).json({ error: "no_store_for_user" });
    }

    const [store] = await db.select().from(locations).where(eq(locations.id, sandboxId));
    if (!store) return res.status(404).json({ error: "sandbox_not_found" });

    res.json({ store });
  } catch (err) {
    console.error("[training] /sandbox error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * Phase 9.1 — wipe & reseed the practice sandbox for the caller's store.
 * Owners/managers/admins only.
 */
router.post("/sandbox/reset", isAuthenticated, async (req, res) => {
  try {
    const actor = uid(req);
    if (!actor) return res.status(401).json({ error: "unauthorized" });
    const role = (req as any).user?.role ?? (req as any).user?.claims?.role;
    if (role !== "owner" && role !== "admin" && role !== "manager") {
      return res.status(403).json({ error: "forbidden" });
    }

    const storeId = Number(req.body?.storeId);
    if (!Number.isFinite(storeId) || storeId <= 0) {
      return res.status(400).json({ error: "storeId required" });
    }

    // Resolve target sandbox: caller passes the parent store id; we look up
    // its sandbox (creating one if it doesn't exist yet).
    const [parent] = await db.select().from(locations).where(eq(locations.id, storeId));
    if (!parent) return res.status(404).json({ error: "store not found" });

    let sandboxId: number;
    if (parent.isTrainingSandbox) {
      sandboxId = parent.id;
    } else {
      const { ensureSandboxForStore } = await import("../training/sandbox");
      sandboxId = await ensureSandboxForStore(parent.id);
    }

    await resetSandboxData(sandboxId);
    res.json({ ok: true, sandboxId });
  } catch (err) {
    console.error("[training] /sandbox/reset error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * List the available Quick Scenarios for the practice sandbox picker.
 */
router.get("/sandbox/scenarios", isAuthenticated, async (_req, res) => {
  res.json({ scenarios: SANDBOX_SCENARIOS });
});

/**
 * Apply a Quick Scenario to the caller's sandbox. Any signed-in trainee
 * can run this on their own practice store — it never touches live data.
 */
router.post("/sandbox/scenario", isAuthenticated, async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const scenario = String(req.body?.scenario ?? "");
    if (!SANDBOX_SCENARIOS.some((s) => s.key === scenario)) {
      return res.status(400).json({ error: "unknown_scenario" });
    }

    let sandboxId = await sandboxStoreIdForUser(userId);
    if (!sandboxId) sandboxId = await ensureSandboxForUser(userId);
    if (!sandboxId) return res.status(404).json({ error: "no_store_for_user" });

    const result = await applySandboxScenario(sandboxId, scenario as SandboxScenarioKey);
    recordScenarioRun(userId, {
      sandboxId,
      key: scenario as SandboxScenarioKey,
      initial: result.initial,
      scenarioCustomerIds: result.scenarioCustomerIds,
    });
    res.json({ ok: true, sandboxId, appointmentsCreated: result.appointmentsCreated });
  } catch (err) {
    console.error("[training] /sandbox/scenario error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * Score the trainee's currently active scenario. Returns null if there
 * isn't one running. The scoreboard surfaces this when they finish.
 */
router.get("/sandbox/scenario/results", isAuthenticated, async (req, res) => {
  try {
    const userId = uid(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const results = await evaluateScenarioRun(userId);
    res.json({ results });
  } catch (err) {
    console.error("[training] /sandbox/scenario/results error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

/**
 * Clear the active scenario without running another one (e.g. trainee
 * dismisses the scoreboard).
 */
router.post("/sandbox/scenario/dismiss", isAuthenticated, async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  clearScenarioRun(userId);
  res.json({ ok: true });
});

export default router;
