import { db } from "../db";
import { appointments, customers, services, staff } from "@shared/schema";
import { intelligenceInterventions } from "@shared/schema/intelligence";
import { sendSms } from "../sms";
import { eq, and, gte, lte, inArray, sql, desc } from "drizzle-orm";

const APP_URL = process.env.APP_URL || "https://certxa.com";

export interface CancellationRecoveryCandidate {
  customerId: number;
  customerName: string;
  customerPhone: string | null;
  lastVisitDate: Date | null;
  daysSinceLast: number | null;
  preferredService: string | null;
  preferredStaff: string | null;
  suggestedMessage: string;
  priority: "high" | "medium" | "low";
}

export async function getCancellationRecoveryCandidates(
  storeId: number,
  cancelledAppointmentId: number
): Promise<CancellationRecoveryCandidate[]> {
  const [cancelledAppt] = await db
    .select({
      date: appointments.date,
      serviceId: appointments.serviceId,
      staffId: appointments.staffId,
      duration: appointments.duration,
    })
    .from(appointments)
    .where(and(eq(appointments.id, cancelledAppointmentId), eq(appointments.storeId, storeId)));

  if (!cancelledAppt) return [];

  const [cancelledService] = cancelledAppt.serviceId
    ? await db.select().from(services).where(eq(services.id, cancelledAppt.serviceId))
    : [null];

  const [cancelledStaff] = cancelledAppt.staffId
    ? await db.select().from(staff).where(eq(staff.id, cancelledAppt.staffId))
    : [null];

  // Find clients who:
  // 1. Have previously booked the same service, OR
  // 2. Are overdue for a visit, OR
  // 3. Have been on the waitlist
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

  // Clients who booked this service before and haven't visited in a while
  const serviceCandidates = cancelledAppt.serviceId
    ? await db
        .select({
          customerId: appointments.customerId,
          lastVisit: sql<Date>`MAX(date)`,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.storeId, storeId),
            eq(appointments.serviceId, cancelledAppt.serviceId),
            eq(appointments.status, "completed"),
            sql`customer_id IS NOT NULL`
          )
        )
        .groupBy(appointments.customerId)
        .having(sql`MAX(date) < ${twoWeeksAgo.toISOString()}`)
        .orderBy(sql`MAX(date) DESC`)
        .limit(10)
    : [];

  const candidates: CancellationRecoveryCandidate[] = [];
  const seen = new Set<number>();

  const locationRow = await db.execute(
    sql`SELECT name, slug FROM locations WHERE id = ${storeId} LIMIT 1`
  );
  const storeName = (locationRow.rows?.[0] as any)?.name || "our salon";
  const bookingSlug = (locationRow.rows?.[0] as any)?.slug || null;
  const bookingLink = bookingSlug ? `${APP_URL}/book/${bookingSlug}` : APP_URL;

  const cancelledTime = cancelledAppt.date;
  const timeStr = cancelledTime.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const dateStr = cancelledTime.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  for (const candidate of serviceCandidates) {
    if (!candidate.customerId || seen.has(candidate.customerId)) continue;
    seen.add(candidate.customerId);

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, candidate.customerId));

    if (!customer || !customer.phone || !customer.marketingOptIn) continue;

    const daysSinceLast = candidate.lastVisit
      ? Math.floor((Date.now() - new Date(candidate.lastVisit).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const firstName = customer.name.split(" ")[0];
    const serviceName = cancelledService?.name || "your usual service";
    const staffName = cancelledStaff?.name;

    const suggestedMessage = staffName
      ? `Hi ${firstName}! A spot just opened with ${staffName} at ${storeName} on ${dateStr} at ${timeStr}${cancelledService ? ` for ${serviceName}` : ""}. Want it? Book here: ${bookingLink}\n\nReply STOP to opt out.`
      : `Hi ${firstName}! A last-minute opening just came up at ${storeName} on ${dateStr} at ${timeStr}${cancelledService ? ` for ${serviceName}` : ""}. Grab it here: ${bookingLink}\n\nReply STOP to opt out.`;

    const priority: "high" | "medium" | "low" =
      daysSinceLast !== null && daysSinceLast > 60
        ? "high"
        : daysSinceLast !== null && daysSinceLast > 30
        ? "medium"
        : "low";

    candidates.push({
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      lastVisitDate: candidate.lastVisit ? new Date(candidate.lastVisit) : null,
      daysSinceLast,
      preferredService: cancelledService?.name || null,
      preferredStaff: cancelledStaff?.name || null,
      suggestedMessage,
      priority,
    });
  }

  return candidates.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

export async function sendCancellationRecoverySms(
  storeId: number,
  customerId: number,
  message: string,
  cancelledAppointmentId?: number
): Promise<{ success: boolean; error?: string }> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.storeId, storeId)));

  if (!customer?.phone) return { success: false, error: "No phone number" };
  if (!customer.marketingOptIn) return { success: false, error: "Customer opted out" };

  try {
    await sendSms(storeId, customer.phone, message, "cancellation_recovery", cancelledAppointmentId, customerId);

    await db.insert(intelligenceInterventions).values({
      storeId,
      customerId,
      interventionType: "cancellation_recovery",
      channel: "sms",
      messageBody: message,
      status: "sent",
      triggeredBy: "manual",
      appointmentId: cancelledAppointmentId,
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
