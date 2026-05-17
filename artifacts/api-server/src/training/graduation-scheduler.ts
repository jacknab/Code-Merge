// Phase 8 — graduation scheduler.
//
// Runs two recurring sweeps:
//
//   1. graduationSweep() — for every enrolled, not-yet-graduated user, checks
//      whether they meet the graduation rule from §8.1 of the plan:
//        • enrolled at least `graduationMinDays` days, AND
//        • every category they have ever touched is at helpLevel 0.
//      Marks the profile as graduated and resets graduationNotifiedOwner so the
//      owner toast (Phase 6) re-fires.
//
//   2. day7DigestSweep() — for every trainee enrolled ≥ `graduationMinDays`
//      days who has NOT graduated and has not yet received a digest, emails
//      the owner of their store a "still needs help with X, Y" breakdown and
//      stamps day7DigestSentAt so we never re-send.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  trainingActionCategories,
  trainingUserProfile,
  trainingUserState,
  trainingSettings,
  staff,
  locations,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { sendEmail } from "../mail";

const HOUR_MS = 60 * 60 * 1000;
const GRADUATION_TICK_MS = 1 * HOUR_MS;
const DIGEST_TICK_MS = 6 * HOUR_MS;
const SANDBOX_RESET_TICK_MS = 24 * HOUR_MS;

let graduationIntervalId: ReturnType<typeof setInterval> | null = null;
let digestIntervalId: ReturnType<typeof setInterval> | null = null;
let sandboxResetIntervalId: ReturnType<typeof setInterval> | null = null;

const SETTINGS_DEFAULTS = {
  enabled: true,
  autoEnrollNewStaff: true,
  graduationMinDays: 7,
  showHelpBubbleAfterGraduation: true,
};

async function getStoreSettings(storeId: number | null) {
  if (!storeId) return { storeId: null as number | null, ...SETTINGS_DEFAULTS };
  const [row] = await db
    .select()
    .from(trainingSettings)
    .where(eq(trainingSettings.storeId, storeId));
  if (!row) return { storeId, ...SETTINGS_DEFAULTS };
  return { ...row, storeId };
}

/**
 * Returns the storeId for a user (via their staff record) or null.
 */
async function userStoreId(userId: string): Promise<number | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.staffId) return null;
  const [s] = await db.select().from(staff).where(eq(staff.id, u.staffId));
  return s?.storeId ?? null;
}

export async function graduationSweep(now: Date = new Date()): Promise<{ graduated: string[] }> {
  const profiles = await db.select().from(trainingUserProfile);
  const candidates = profiles.filter((p) => !p.graduatedAt);
  if (candidates.length === 0) return { graduated: [] };

  const userIds = candidates.map((p) => p.userId);
  const states = await db
    .select()
    .from(trainingUserState)
    .where(inArray(trainingUserState.userId, userIds));
  const statesByUser = new Map<string, typeof states>();
  for (const s of states) {
    if (!statesByUser.has(s.userId)) statesByUser.set(s.userId, [] as any);
    statesByUser.get(s.userId)!.push(s);
  }

  const graduated: string[] = [];
  for (const profile of candidates) {
    const touched = statesByUser.get(profile.userId) ?? [];
    if (touched.length === 0) continue; // never used the app — don't auto-grad

    // Resolve gating from the user's store settings (falls back to defaults).
    const storeId = await userStoreId(profile.userId);
    const settings = await getStoreSettings(storeId);
    if (!settings.enabled) continue;

    const enrolledMs = profile.enrolledAt
      ? new Date(profile.enrolledAt).getTime()
      : now.getTime();
    const ageDays = (now.getTime() - enrolledMs) / 86_400_000;
    if (ageDays < (settings.graduationMinDays ?? 0)) continue;

    // Every touched category must be at L0.
    const allAtZero = touched.every((s) => s.helpLevel === 0);
    if (!allAtZero) continue;

    await db
      .update(trainingUserProfile)
      .set({
        graduatedAt: now,
        graduationNotifiedOwner: false,
        graduationStaffNotified: false,
      })
      .where(eq(trainingUserProfile.userId, profile.userId));
    graduated.push(profile.userId);
  }
  return { graduated };
}

export async function day7DigestSweep(
  now: Date = new Date(),
): Promise<{ sent: Array<{ ownerEmail: string; staffCount: number }> }> {
  const profiles = await db.select().from(trainingUserProfile);
  // Eligible: not graduated, no digest sent yet, enrolled long enough.
  const eligible = profiles.filter((p) => !p.graduatedAt && !p.day7DigestSentAt);
  if (eligible.length === 0) return { sent: [] };

  const userIds = eligible.map((p) => p.userId);
  const userRows = userIds.length
    ? await db.select().from(users).where(inArray(users.id, userIds))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const staffIds = userRows.map((u) => u.staffId).filter((x): x is number => !!x);
  const staffRows = staffIds.length
    ? await db.select().from(staff).where(inArray(staff.id, staffIds))
    : [];
  const staffById = new Map(staffRows.map((s) => [s.id, s]));

  const states = await db
    .select()
    .from(trainingUserState)
    .where(inArray(trainingUserState.userId, userIds));
  const statesByUser = new Map<string, typeof states>();
  for (const s of states) {
    if (!statesByUser.has(s.userId)) statesByUser.set(s.userId, [] as any);
    statesByUser.get(s.userId)!.push(s);
  }

  const categories = await db.select().from(trainingActionCategories);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  // Group eligible trainees by store owner so each owner gets one email.
  type Entry = { profileId: string; staffName: string; sticking: string[] };
  const byOwner = new Map<
    string,
    { ownerEmail: string; storeName: string | null; entries: Entry[] }
  >();

  for (const profile of eligible) {
    const enrolledMs = profile.enrolledAt
      ? new Date(profile.enrolledAt).getTime()
      : now.getTime();
    const ageDays = (now.getTime() - enrolledMs) / 86_400_000;

    const u = userById.get(profile.userId);
    if (!u?.staffId) continue;
    const sRow = staffById.get(u.staffId);
    if (!sRow?.storeId) continue;

    const settings = await getStoreSettings(sRow.storeId);
    if (!settings.enabled) continue;
    if (ageDays < (settings.graduationMinDays ?? 0)) continue;

    const [loc] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, sRow.storeId));
    if (!loc?.userId) continue;

    const [owner] = await db.select().from(users).where(eq(users.id, loc.userId));
    if (!owner?.email) continue;

    // Build sticking-points list: categories not yet at L0.
    const userStates = statesByUser.get(profile.userId) ?? [];
    const sticking = userStates
      .filter((s) => s.helpLevel > 0)
      .map((s) => categoryById.get(s.categoryId)?.title ?? `category #${s.categoryId}`)
      .sort();
    if (sticking.length === 0) continue; // they actually finished; let the sweep grad them

    const staffName =
      [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
      sRow.name ||
      u.email ||
      "A teammate";

    if (!byOwner.has(owner.id)) {
      byOwner.set(owner.id, {
        ownerEmail: owner.email,
        storeName: loc.name ?? null,
        entries: [],
      });
    }
    byOwner.get(owner.id)!.entries.push({
      profileId: profile.userId,
      staffName,
      sticking,
    });
  }

  const sent: Array<{ ownerEmail: string; staffCount: number }> = [];
  for (const [, group] of Array.from(byOwner)) {
    const rows = group.entries
      .map(
        (e: Entry) =>
          `<li><strong>${escapeHtml(e.staffName)}</strong> still needs help with: ${e.sticking
            .map((t: string) => `<em>${escapeHtml(t)}</em>`)
            .join(", ")}</li>`,
      )
      .join("");
    const html = `
      <p>Hi,</p>
      <p>It's been a week and ${group.entries.length} of your team
      ${group.entries.length === 1 ? "member hasn't" : "members haven't"}
      finished the in-app training yet${
        group.storeName ? ` at <strong>${escapeHtml(group.storeName)}</strong>` : ""
      }.</p>
      <ul>${rows}</ul>
      <p>The coach will keep helping them every time they open those screens — no action needed.
      You can always pin or reset progress in <em>Settings → Training</em>.</p>
      <p>— Toby</p>`;
    const text = group.entries
      .map((e: Entry) => `${e.staffName}: still needs help with ${e.sticking.join(", ")}`)
      .join("\n");

    const storeIdForEmail = await userStoreId(group.entries[0].profileId);
    const result = await sendEmail(
      storeIdForEmail ?? 0,
      group.ownerEmail,
      `Training update: ${group.entries.length} ${
        group.entries.length === 1 ? "teammate" : "teammates"
      } still learning`,
      html,
      text,
    );

    if (result.success) {
      // Mark digest sent for every profile in this group.
      const ids = group.entries.map((e: Entry) => e.profileId);
      await db
        .update(trainingUserProfile)
        .set({ day7DigestSentAt: now })
        .where(inArray(trainingUserProfile.userId, ids));
      sent.push({ ownerEmail: group.ownerEmail, staffCount: group.entries.length });
    } else {
      console.warn(
        "[training] day-7 digest skipped:",
        result.error ?? "unknown mailgun error",
      );
    }
  }
  return { sent };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function startGraduationScheduler() {
  if (graduationIntervalId || digestIntervalId || sandboxResetIntervalId) return;
  console.log(
    "[Training] Graduation scheduler started (hourly grad sweep, 6h digest, daily sandbox reset)",
  );

  // Kick off immediately, then on interval.
  graduationSweep().catch((err) =>
    console.error("[Training] graduationSweep error:", err),
  );
  graduationIntervalId = setInterval(() => {
    graduationSweep().catch((err) =>
      console.error("[Training] graduationSweep error:", err),
    );
  }, GRADUATION_TICK_MS);

  digestIntervalId = setInterval(() => {
    day7DigestSweep().catch((err) =>
      console.error("[Training] day7DigestSweep error:", err),
    );
  }, DIGEST_TICK_MS);

  // Phase 9.1 — nightly wipe & reseed of every practice sandbox.
  // Lazy import keeps the scheduler module decoupled from the sandbox helpers.
  sandboxResetIntervalId = setInterval(async () => {
    try {
      const { resetAllSandboxes } = await import("./sandbox");
      const r = await resetAllSandboxes();
      if (r.resetCount > 0) {
        console.log(`[Training] reset ${r.resetCount} practice sandbox(es)`);
      }
    } catch (err) {
      console.error("[Training] resetAllSandboxes error:", err);
    }
  }, SANDBOX_RESET_TICK_MS);
}
