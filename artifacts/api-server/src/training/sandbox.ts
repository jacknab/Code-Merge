/**
 * Phase 9.1 — Practice Mode sandbox stores.
 *
 * For every real store, we keep a single "practice" clone (locations row with
 * is_training_sandbox=true). Trainees enter the sandbox to drill the real UI
 * without touching live data; nightly we wipe & reseed it.
 *
 * Side-effect short-circuits (Phase 9.2) inspect locations.isTrainingSandbox
 * before sending SMS / email / Stripe / webhooks.
 */
import { db } from "../db";
import {
  locations,
  staff,
  serviceCategories,
  services,
  customers,
  appointments,
  businessHours,
  staffServices,
  staffAvailability,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { and, eq, inArray } from "drizzle-orm";

const STAFF_NAMES = ["Avery Pham", "Jordan Lee", "Riley Tran", "Casey Nguyen"];
const STAFF_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899"];

const FIRST_NAMES = [
  "Olivia", "Liam", "Emma", "Noah", "Ava", "Ethan", "Sophia", "Mason",
  "Isabella", "Lucas", "Mia", "Logan", "Charlotte", "Aiden", "Amelia",
  "Elijah", "Harper", "James", "Evelyn", "Benjamin", "Abigail", "Henry",
  "Emily", "Sebastian", "Ella", "Jackson", "Scarlett", "Daniel", "Grace",
  "Owen",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
  "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
  "Ramirez", "Lewis", "Robinson",
];

const CATEGORY_DEFS: Array<{ name: string; services: Array<{ name: string; duration: number; price: string }> }> = [
  {
    name: "Manicures",
    services: [
      { name: "Classic Manicure", duration: 30, price: "25.00" },
      { name: "Gel Manicure", duration: 45, price: "40.00" },
      { name: "French Manicure", duration: 45, price: "35.00" },
      { name: "Dip Powder Manicure", duration: 60, price: "50.00" },
      { name: "Acrylic Full Set", duration: 75, price: "65.00" },
      { name: "Acrylic Fill", duration: 60, price: "45.00" },
    ],
  },
  {
    name: "Pedicures",
    services: [
      { name: "Classic Pedicure", duration: 45, price: "35.00" },
      { name: "Spa Pedicure", duration: 60, price: "50.00" },
      { name: "Gel Pedicure", duration: 60, price: "55.00" },
      { name: "Deluxe Pedicure", duration: 75, price: "70.00" },
      { name: "Kid's Pedicure", duration: 30, price: "20.00" },
    ],
  },
  {
    name: "Hair",
    services: [
      { name: "Women's Haircut", duration: 45, price: "55.00" },
      { name: "Men's Haircut", duration: 30, price: "35.00" },
      { name: "Blow Dry & Style", duration: 45, price: "45.00" },
      { name: "Color — Single Process", duration: 90, price: "95.00" },
      { name: "Highlights — Partial", duration: 120, price: "130.00" },
    ],
  },
  {
    name: "Waxing & Brows",
    services: [
      { name: "Brow Wax", duration: 15, price: "18.00" },
      { name: "Lip Wax", duration: 15, price: "12.00" },
      { name: "Brow Tint", duration: 20, price: "25.00" },
      { name: "Lash Lift", duration: 60, price: "85.00" },
    ],
  },
];

const SANDBOX_OWNER_NAME = "Practice Owner";

/**
 * Phase 9.2 — fast in-memory cache of which storeIds are sandboxes.
 * Loaded lazily on first lookup, refreshed every 60s. Writes to the
 * locations table from this module manually invalidate via {@link
 * invalidateSandboxCache}.
 */
let sandboxIdCache: { ids: Set<number>; loadedAt: number } | null = null;
const SANDBOX_CACHE_TTL_MS = 60 * 1000;

export function invalidateSandboxCache(): void {
  sandboxIdCache = null;
}

async function loadSandboxIds(): Promise<Set<number>> {
  const rows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.isTrainingSandbox, true));
  return new Set(rows.map((r) => r.id));
}

/**
 * Returns true if the given storeId is a training sandbox. Cached for 60s.
 * Use this to short-circuit any external side-effect (SMS, email, Stripe,
 * webhooks). On cache miss / DB error returns false (fail-open is the
 * safer default — sandbox stores have userId=null so they're rare).
 */
export async function isSandboxStore(
  storeId: number | null | undefined,
): Promise<boolean> {
  if (!storeId) return false;
  const now = Date.now();
  if (!sandboxIdCache || now - sandboxIdCache.loadedAt > SANDBOX_CACHE_TTL_MS) {
    try {
      sandboxIdCache = { ids: await loadSandboxIds(), loadedAt: now };
    } catch (err) {
      console.error("[sandbox] isSandboxStore cache reload failed:", err);
      return false;
    }
  }
  return sandboxIdCache.ids.has(storeId);
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function randomPhone(seed: number): string {
  const last4 = String(1000 + (seed * 7919) % 9000).padStart(4, "0");
  return `(555) 555-${last4}`;
}

/**
 * Returns true if the sandbox has no customers and no services.
 * Used to auto-seed an empty sandbox on first open so trainees never
 * land in a blank store.
 */
async function isSandboxEmpty(sandboxStoreId: number): Promise<boolean> {
  const [c] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.storeId, sandboxStoreId))
    .limit(1);
  if (c) return false;
  const [s] = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.storeId, sandboxStoreId))
    .limit(1);
  return !s;
}

/**
 * Find or create the sandbox location for a real (parent) store.
 * Idempotent. Seeds on creation, and also auto-seeds an existing sandbox
 * if it's empty (e.g. after a manual wipe) so trainees aren't dropped
 * into a blank store.
 */
export async function ensureSandboxForStore(parentStoreId: number): Promise<number> {
  const [parent] = await db.select().from(locations).where(eq(locations.id, parentStoreId));
  if (!parent) throw new Error(`parent store ${parentStoreId} not found`);
  if (parent.isTrainingSandbox) {
    // Caller passed a sandbox by mistake — just return it.
    return parent.id;
  }

  const [existing] = await db
    .select()
    .from(locations)
    .where(
      and(
        eq(locations.sandboxParentStoreId, parentStoreId),
        eq(locations.isTrainingSandbox, true),
      ),
    );
  if (existing) {
    if (await isSandboxEmpty(existing.id)) {
      await seedSandboxData(existing.id);
    }
    return existing.id;
  }

  const baseSlug = parent.bookingSlug ?? `store-${parent.id}`;
  const [created] = await db
    .insert(locations)
    .values({
      name: `${parent.name} (Practice)`,
      timezone: parent.timezone,
      address: parent.address,
      phone: parent.phone,
      email: parent.email,
      category: parent.category,
      city: parent.city,
      state: parent.state,
      postcode: parent.postcode,
      // unique constraint — keep practice slugs out of the public booking namespace
      bookingSlug: `${baseSlug}-practice-${parent.id}`,
      bookingTheme: parent.bookingTheme,
      // No owner: keeps the sandbox out of the user's normal store picker.
      userId: null,
      accountStatus: "Active",
      smsTokens: 0,
      isTrainingSandbox: true,
      sandboxParentStoreId: parent.id,
    })
    .returning();

  invalidateSandboxCache();
  await seedSandboxData(created.id);
  return created.id;
}

/**
 * Wipe all child rows for a sandbox store and reseed fresh demo data.
 * Safe to call repeatedly — only touches rows whose storeId is the sandbox.
 */
export async function resetSandboxData(sandboxStoreId: number): Promise<void> {
  const [s] = await db.select().from(locations).where(eq(locations.id, sandboxStoreId));
  if (!s || !s.isTrainingSandbox) {
    throw new Error(`store ${sandboxStoreId} is not a training sandbox`);
  }

  // Delete in dependency order. staff_services + staff_availability + appointments
  // reference staff/services; appointments references customers.
  const staffRows = await db.select({ id: staff.id }).from(staff).where(eq(staff.storeId, sandboxStoreId));
  const staffIds = staffRows.map((r) => r.id);
  const serviceRows = await db.select({ id: services.id }).from(services).where(eq(services.storeId, sandboxStoreId));
  const serviceIds = serviceRows.map((r) => r.id);

  await db.delete(appointments).where(eq(appointments.storeId, sandboxStoreId));
  if (staffIds.length) {
    await db.delete(staffServices).where(inArray(staffServices.staffId, staffIds));
    await db.delete(staffAvailability).where(inArray(staffAvailability.staffId, staffIds));
  }
  await db.delete(staff).where(eq(staff.storeId, sandboxStoreId));
  await db.delete(services).where(eq(services.storeId, sandboxStoreId));
  await db.delete(serviceCategories).where(eq(serviceCategories.storeId, sandboxStoreId));
  await db.delete(customers).where(eq(customers.storeId, sandboxStoreId));
  await db.delete(businessHours).where(eq(businessHours.storeId, sandboxStoreId));

  await seedSandboxData(sandboxStoreId);
}

/**
 * Seed a fresh sandbox: 4 staff, ~20 services across 4 categories,
 * 30 customers, ~40 appointments spread across the past week and next week.
 * Assumes the store rows have already been cleared (or are empty).
 */
export async function seedSandboxData(sandboxStoreId: number): Promise<void> {
  // Business hours: Mon–Sat 9–18, closed Sunday.
  for (let day = 0; day < 7; day++) {
    await db.insert(businessHours).values({
      storeId: sandboxStoreId,
      dayOfWeek: day,
      openTime: "09:00",
      closeTime: "18:00",
      isClosed: day === 0,
    });
  }

  // Staff
  const staffIds: number[] = [];
  for (let i = 0; i < STAFF_NAMES.length; i++) {
    const [s] = await db
      .insert(staff)
      .values({
        name: STAFF_NAMES[i],
        storeId: sandboxStoreId,
        role: i === 0 ? "manager" : "stylist",
        color: STAFF_COLORS[i],
        commissionEnabled: true,
        commissionRate: "40",
      })
      .returning();
    staffIds.push(s.id);

    // Each staff works Mon–Sat
    for (let day = 1; day < 7; day++) {
      await db.insert(staffAvailability).values({
        staffId: s.id,
        dayOfWeek: day,
        startTime: "09:00",
        endTime: "18:00",
      });
    }
  }

  // Categories + services
  const serviceIds: number[] = [];
  const serviceDurations = new Map<number, number>();
  for (const catDef of CATEGORY_DEFS) {
    const [cat] = await db
      .insert(serviceCategories)
      .values({ name: catDef.name, storeId: sandboxStoreId })
      .returning();
    for (const svcDef of catDef.services) {
      const [svc] = await db
        .insert(services)
        .values({
          name: svcDef.name,
          duration: svcDef.duration,
          price: svcDef.price,
          category: catDef.name,
          categoryId: cat.id,
          storeId: sandboxStoreId,
        })
        .returning();
      serviceIds.push(svc.id);
      serviceDurations.set(svc.id, svcDef.duration);
    }
  }

  // Every staff can do every service (keeps practice flexible).
  for (const staffId of staffIds) {
    for (const serviceId of serviceIds) {
      await db.insert(staffServices).values({ staffId, serviceId });
    }
  }

  // Customers
  const customerIds: number[] = [];
  for (let i = 0; i < 30; i++) {
    const first = pick(FIRST_NAMES, i);
    const last = pick(LAST_NAMES, i + 7);
    const [c] = await db
      .insert(customers)
      .values({
        name: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@practice.test`,
        phone: randomPhone(i + 1),
        storeId: sandboxStoreId,
        marketingOptIn: false,
      })
      .returning();
    customerIds.push(c.id);
  }

  // Appointments — 40 distributed from 7 days ago to 7 days ahead.
  // Skips Sundays (closed). Statuses vary: past=completed, today=mix, future=pending.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let placed = 0;
  let dayOffset = -7;
  let slotInDay = 0;
  while (placed < 40 && dayOffset <= 7) {
    const date = new Date(today);
    date.setDate(date.getDate() + dayOffset);
    if (date.getDay() === 0) {
      dayOffset++;
      slotInDay = 0;
      continue;
    }

    // 3 appointments per business day, starting at 10:00, 13:00, 15:30
    const slotTimes: Array<[number, number]> = [
      [10, 0],
      [13, 0],
      [15, 30],
    ];
    if (slotInDay >= slotTimes.length) {
      dayOffset++;
      slotInDay = 0;
      continue;
    }

    const [hh, mm] = slotTimes[slotInDay];
    date.setHours(hh, mm, 0, 0);

    const serviceId = pick(serviceIds, placed);
    const staffId = pick(staffIds, placed + slotInDay);
    const customerId = pick(customerIds, placed * 3);
    const duration = serviceDurations.get(serviceId) ?? 45;

    let status: string;
    if (dayOffset < 0) status = "completed";
    else if (dayOffset === 0 && hh < new Date().getHours()) status = "completed";
    else status = "pending";

    await db.insert(appointments).values({
      date,
      duration,
      status,
      serviceId,
      staffId,
      customerId,
      storeId: sandboxStoreId,
    });
    placed++;
    slotInDay++;
  }
}

/**
 * Quick Scenarios — themed appointment sets a trainee can load on top of
 * the base sandbox seed (staff/services/customers stay; appointments are
 * replaced). If the sandbox has no staff/services/customers yet, the base
 * seed runs first.
 */
export const SANDBOX_SCENARIOS = [
  {
    key: "busy-saturday",
    label: "Busy Saturday",
    description: "Back-to-back bookings all day across every stylist.",
  },
  {
    key: "walk-in-rush",
    label: "Walk-in Rush",
    description: "Eight unconfirmed walk-ins arriving in the next 90 minutes.",
  },
  {
    key: "no-show-recovery",
    label: "No-show Recovery",
    description: "Recent no-shows and cancellations to follow up with.",
  },
] as const;

export type SandboxScenarioKey = (typeof SANDBOX_SCENARIOS)[number]["key"];

function isValidScenario(key: string): key is SandboxScenarioKey {
  return SANDBOX_SCENARIOS.some((s) => s.key === key);
}

async function ensureBaseSandboxData(sandboxStoreId: number): Promise<void> {
  if (await isSandboxEmpty(sandboxStoreId)) {
    await seedSandboxData(sandboxStoreId);
  }
}

/**
 * In-memory record of the trainee's currently active Quick Scenario, keyed
 * by userId. Lets us diff baseline vs current state to score how well they
 * worked through the scenario. Cleared when a new scenario starts or when
 * results are dismissed. We deliberately keep this in memory — scenarios
 * are short, ephemeral practice sessions.
 */
type ScenarioRun = {
  sandboxId: number;
  key: SandboxScenarioKey;
  startedAt: Date;
  initial: Array<{ id: number; status: string; customerId: number | null }>;
  scenarioCustomerIds: number[];
};
const scenarioRuns = new Map<string, ScenarioRun>();

export function recordScenarioRun(
  userId: string,
  run: Omit<ScenarioRun, "startedAt"> & { startedAt?: Date },
): void {
  scenarioRuns.set(userId, { startedAt: new Date(), ...run });
}

export function clearScenarioRun(userId: string): void {
  scenarioRuns.delete(userId);
}

export type ScenarioResults = {
  scenario: { key: SandboxScenarioKey; label: string };
  startedAt: string;
  metrics: Array<{ label: string; value: number; outOf?: number }>;
  headline: string;
  score: number; // 0-100
};

export async function evaluateScenarioRun(userId: string): Promise<ScenarioResults | null> {
  const run = scenarioRuns.get(userId);
  if (!run) return null;
  const def = SANDBOX_SCENARIOS.find((s) => s.key === run.key)!;

  const initialIds = run.initial.map((a) => a.id);
  const initialNow = initialIds.length
    ? await db
        .select({ id: appointments.id, status: appointments.status, customerId: appointments.customerId })
        .from(appointments)
        .where(inArray(appointments.id, initialIds))
    : [];
  const initialNowMap = new Map(initialNow.map((a) => [a.id, a]));

  // Anything in the sandbox that isn't part of the initial set was created
  // by the trainee during the scenario.
  const allInStore = await db
    .select({ id: appointments.id, status: appointments.status, customerId: appointments.customerId })
    .from(appointments)
    .where(eq(appointments.storeId, run.sandboxId));
  const initialIdSet = new Set(initialIds);
  const newAppointments = allInStore.filter((a) => !initialIdSet.has(a.id));
  const scenarioCustomerSet = new Set(run.scenarioCustomerIds);

  const countInitialBy = (status: string) =>
    initialNow.filter((a) => a.status === status).length;

  let metrics: ScenarioResults["metrics"] = [];
  let score = 0;
  let headline = "";

  if (run.key === "busy-saturday") {
    const total = run.initial.length;
    const completed = countInitialBy("completed");
    const noShow = countInitialBy("no-show");
    const cancelled = countInitialBy("cancelled");
    metrics = [
      { label: "Bookings completed", value: completed, outOf: total },
      { label: "No-shows", value: noShow },
      { label: "Cancellations", value: cancelled },
    ];
    score = total ? Math.round((completed / total) * 100) : 0;
    headline = `You worked ${completed} of ${total} Saturday bookings.`;
  } else if (run.key === "walk-in-rush") {
    const total = run.initial.length;
    let handled = 0;
    let waiting = 0;
    for (const a of initialNow) {
      if (a.status === "confirmed" || a.status === "completed") handled++;
      else if (a.status === "pending") waiting++;
    }
    const newBookings = newAppointments.filter(
      (a) => a.customerId != null && scenarioCustomerSet.has(a.customerId),
    ).length;
    metrics = [
      { label: "Walk-ins booked in", value: handled, outOf: total },
      { label: "Walk-ins still waiting", value: waiting },
      { label: "Follow-up appointments created", value: newBookings },
    ];
    score = total ? Math.round((handled / total) * 100) : 0;
    headline = `You handled ${handled} of ${total} walk-ins.`;
  } else if (run.key === "no-show-recovery") {
    const noShowCustomerIds = new Set(
      run.initial
        .filter((a) => a.status === "no-show" || a.status === "cancelled")
        .map((a) => a.customerId)
        .filter((id): id is number => id != null),
    );
    const rebooks = newAppointments.filter(
      (a) => a.customerId != null && noShowCustomerIds.has(a.customerId),
    ).length;
    const todayPending = run.initial.filter((a) => a.status === "pending");
    const todayPendingNow = todayPending.filter((a) => {
      const cur = initialNowMap.get(a.id);
      return cur?.status === "confirmed" || cur?.status === "completed";
    }).length;
    const totalToRebook = noShowCustomerIds.size;
    metrics = [
      { label: "Customers rebooked", value: rebooks, outOf: totalToRebook },
      { label: "Today's pending confirmed", value: todayPendingNow, outOf: todayPending.length },
    ];
    const denom = totalToRebook + todayPending.length;
    score = denom ? Math.round(((rebooks + todayPendingNow) / denom) * 100) : 0;
    headline = `You recovered ${rebooks} of ${totalToRebook} no-shows.`;
  }

  return {
    scenario: { key: run.key, label: def.label },
    startedAt: run.startedAt.toISOString(),
    metrics,
    headline,
    score: Math.min(100, Math.max(0, score)),
  };
}

/**
 * Apply a Quick Scenario to a sandbox: keep staff/services/customers,
 * wipe all appointments, then create a themed batch. Returns the freshly
 * created appointments + customer ids the scenario "owns" so the caller
 * can snapshot a baseline for scoring.
 */
export async function applySandboxScenario(
  sandboxStoreId: number,
  scenarioKey: SandboxScenarioKey,
): Promise<{
  appointmentsCreated: number;
  initial: Array<{ id: number; status: string; customerId: number | null }>;
  scenarioCustomerIds: number[];
}> {
  const [s] = await db.select().from(locations).where(eq(locations.id, sandboxStoreId));
  if (!s || !s.isTrainingSandbox) {
    throw new Error(`store ${sandboxStoreId} is not a training sandbox`);
  }

  await ensureBaseSandboxData(sandboxStoreId);

  const staffRows = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.storeId, sandboxStoreId));
  const serviceRows = await db
    .select({ id: services.id, duration: services.duration })
    .from(services)
    .where(eq(services.storeId, sandboxStoreId));
  const customerRows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.storeId, sandboxStoreId));

  if (!staffRows.length || !serviceRows.length || !customerRows.length) {
    throw new Error("sandbox missing base data after seed");
  }

  // Wipe existing appointments only — keeps staff/services/customers stable
  // so the trainee can re-run scenarios without losing their other context.
  await db.delete(appointments).where(eq(appointments.storeId, sandboxStoreId));

  const staffIds = staffRows.map((r) => r.id);
  const serviceIds = serviceRows.map((r) => r.id);
  const serviceDurations = new Map(serviceRows.map((r) => [r.id, r.duration ?? 45]));
  const customerIds = customerRows.map((r) => r.id);

  let result: { initial: ScenarioRun["initial"]; scenarioCustomerIds: number[] } = {
    initial: [],
    scenarioCustomerIds: [],
  };
  if (scenarioKey === "busy-saturday") {
    result = await seedBusySaturday(sandboxStoreId, staffIds, serviceIds, serviceDurations, customerIds);
  } else if (scenarioKey === "walk-in-rush") {
    result = await seedWalkInRush(sandboxStoreId, staffIds, serviceIds, serviceDurations);
  } else if (scenarioKey === "no-show-recovery") {
    result = await seedNoShowRecovery(sandboxStoreId, staffIds, serviceIds, serviceDurations, customerIds);
  }

  return {
    appointmentsCreated: result.initial.length,
    initial: result.initial,
    scenarioCustomerIds: result.scenarioCustomerIds,
  };
}

function nextSaturday(from: Date): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const delta = (6 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

async function seedBusySaturday(
  storeId: number,
  staffIds: number[],
  serviceIds: number[],
  durations: Map<number, number>,
  customerIds: number[],
): Promise<{ initial: ScenarioRun["initial"]; scenarioCustomerIds: number[] }> {
  const saturday = nextSaturday(new Date());
  const initial: ScenarioRun["initial"] = [];
  const usedCustomers = new Set<number>();
  for (let s = 0; s < staffIds.length; s++) {
    let minutes = 9 * 60;
    const endMinutes = 18 * 60;
    let i = 0;
    while (minutes < endMinutes) {
      const serviceId = serviceIds[(s * 7 + i) % serviceIds.length];
      const duration = durations.get(serviceId) ?? 45;
      if (minutes + duration > endMinutes) break;
      const date = new Date(saturday);
      date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      const customerId = customerIds[(s * 11 + i * 3) % customerIds.length];
      const [row] = await db
        .insert(appointments)
        .values({
          date,
          duration,
          status: "confirmed",
          serviceId,
          staffId: staffIds[s],
          customerId,
          storeId,
        })
        .returning({ id: appointments.id });
      initial.push({ id: row.id, status: "confirmed", customerId });
      usedCustomers.add(customerId);
      minutes += duration;
      i++;
    }
  }
  return { initial, scenarioCustomerIds: Array.from(usedCustomers) };
}

async function seedWalkInRush(
  storeId: number,
  staffIds: number[],
  serviceIds: number[],
  durations: Map<number, number>,
): Promise<{ initial: ScenarioRun["initial"]; scenarioCustomerIds: number[] }> {
  const now = new Date();
  const walkInIds: number[] = [];
  for (let i = 0; i < 8; i++) {
    const [c] = await db
      .insert(customers)
      .values({
        name: `Walk-in #${i + 1}`,
        email: `walkin${i + 1}@practice.test`,
        phone: `(555) 555-${String(2000 + i).padStart(4, "0")}`,
        storeId,
        marketingOptIn: false,
      })
      .returning();
    walkInIds.push(c.id);
  }

  const initial: ScenarioRun["initial"] = [];
  for (let i = 0; i < 8; i++) {
    const serviceId = serviceIds[i % serviceIds.length];
    const duration = durations.get(serviceId) ?? 30;
    const date = new Date(now);
    date.setMinutes(date.getMinutes() + i * 10);
    const [row] = await db
      .insert(appointments)
      .values({
        date,
        duration,
        status: "pending",
        serviceId,
        staffId: staffIds[i % staffIds.length],
        customerId: walkInIds[i],
        storeId,
      })
      .returning({ id: appointments.id });
    initial.push({ id: row.id, status: "pending", customerId: walkInIds[i] });
  }
  return { initial, scenarioCustomerIds: walkInIds };
}

async function seedNoShowRecovery(
  storeId: number,
  staffIds: number[],
  serviceIds: number[],
  durations: Map<number, number>,
  customerIds: number[],
): Promise<{ initial: ScenarioRun["initial"]; scenarioCustomerIds: number[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const initial: ScenarioRun["initial"] = [];
  const tracked = new Set<number>();

  const pastConfigs: Array<{ daysAgo: number; hour: number; status: string }> = [
    { daysAgo: 1, hour: 10, status: "no-show" },
    { daysAgo: 1, hour: 14, status: "no-show" },
    { daysAgo: 2, hour: 11, status: "cancelled" },
    { daysAgo: 2, hour: 15, status: "no-show" },
    { daysAgo: 3, hour: 10, status: "cancelled" },
    { daysAgo: 3, hour: 16, status: "no-show" },
  ];
  for (let i = 0; i < pastConfigs.length; i++) {
    const cfg = pastConfigs[i];
    const date = new Date(today);
    date.setDate(date.getDate() - cfg.daysAgo);
    date.setHours(cfg.hour, 0, 0, 0);
    const serviceId = serviceIds[i % serviceIds.length];
    const customerId = customerIds[(i * 5) % customerIds.length];
    const [row] = await db
      .insert(appointments)
      .values({
        date,
        duration: durations.get(serviceId) ?? 45,
        status: cfg.status,
        serviceId,
        staffId: staffIds[i % staffIds.length],
        customerId,
        storeId,
      })
      .returning({ id: appointments.id });
    initial.push({ id: row.id, status: cfg.status, customerId });
    tracked.add(customerId);
  }

  for (let i = 0; i < 4; i++) {
    const date = new Date(today);
    date.setHours(13 + i, 0, 0, 0);
    const serviceId = serviceIds[(i + 2) % serviceIds.length];
    const customerId = customerIds[(i * 9 + 3) % customerIds.length];
    const [row] = await db
      .insert(appointments)
      .values({
        date,
        duration: durations.get(serviceId) ?? 45,
        status: "pending",
        serviceId,
        staffId: staffIds[i % staffIds.length],
        customerId,
        storeId,
      })
      .returning({ id: appointments.id });
    initial.push({ id: row.id, status: "pending", customerId });
    tracked.add(customerId);
  }

  return { initial, scenarioCustomerIds: Array.from(tracked) };
}

/**
 * Reset every sandbox in the system. Called by the nightly scheduler.
 */
export async function resetAllSandboxes(): Promise<{ resetCount: number }> {
  const sandboxes = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.isTrainingSandbox, true));
  for (const s of sandboxes) {
    try {
      await resetSandboxData(s.id);
    } catch (err) {
      console.error(`[sandbox] reset failed for store ${s.id}:`, err);
    }
  }
  return { resetCount: sandboxes.length };
}

/**
 * Resolve the parent storeId a user belongs to. Owners are linked directly
 * via locations.userId; staff members are linked via users.staffId →
 * staff.storeId. Returns null if neither path resolves.
 */
async function parentStoreIdForUser(userId: string): Promise<number | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) return null;

  // Owner path: the user owns one or more stores directly.
  const ownedStores = await db
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.userId, userId),
        eq(locations.isTrainingSandbox, false),
      ),
    );
  if (ownedStores[0]) return ownedStores[0].id;

  // Staff path: the user is linked to a staff record on a store.
  if (u.staffId) {
    const [s] = await db.select().from(staff).where(eq(staff.id, u.staffId));
    if (s?.storeId) return s.storeId;
  }
  return null;
}

/**
 * Resolve the sandbox storeId for a given user. Returns null if the user
 * isn't linked to a store or their store has no sandbox yet.
 */
export async function sandboxStoreIdForUser(userId: string): Promise<number | null> {
  const parentId = await parentStoreIdForUser(userId);
  if (!parentId) return null;
  const [sandbox] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.sandboxParentStoreId, parentId),
        eq(locations.isTrainingSandbox, true),
      ),
    );
  return sandbox?.id ?? null;
}

/**
 * Convenience: find the parent store for a user, then ensure a sandbox
 * exists for it. Returns null if the user isn't linked to a store.
 */
export async function ensureSandboxForUser(userId: string): Promise<number | null> {
  const parentId = await parentStoreIdForUser(userId);
  if (!parentId) return null;
  return ensureSandboxForStore(parentId);
}
