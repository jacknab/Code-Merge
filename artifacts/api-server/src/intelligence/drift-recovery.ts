import { db } from "../db";
import { customers, appointments, smsSettings } from "@shared/schema";
import { clientIntelligence, intelligenceInterventions } from "@shared/schema/intelligence";
import { sendSms } from "../sms";
import { eq, and, gte, isNotNull, sql, lte } from "drizzle-orm";
import { isWithinStoreBusinessHours, shouldSendReengagementSms } from "./sms-guard";

const APP_URL = process.env.APP_URL || "https://certxa.com";

function buildWinbackMessage(
  customerName: string,
  storeName: string,
  avgCadenceDays: number | null,
  bookingSlug: string | null
): string {
  const firstName = customerName.split(" ")[0];
  const bookingLink = bookingSlug
    ? `${APP_URL}/book/${bookingSlug}`
    : APP_URL;

  if (avgCadenceDays && avgCadenceDays <= 35) {
    return `Hi ${firstName}! It's been a while since your last visit at ${storeName}. We'd love to see you again — book your next appointment: ${bookingLink}\n\nReply STOP to opt out.`;
  }

  return `Hi ${firstName}, we miss you at ${storeName}! Ready for your next visit? Book here: ${bookingLink}\n\nReply STOP to opt out.`;
}

export interface WinbackResult {
  sent: number;
  skipped: number;
  errors: number;
  details: Array<{
    customerId: number;
    customerName: string;
    status: "sent" | "skipped" | "error";
    reason?: string;
  }>;
}

export async function runDriftRecovery(
  storeId: number,
  dryRun = false
): Promise<WinbackResult> {
  const result: WinbackResult = { sent: 0, skipped: 0, errors: 0, details: [] };

  if (!dryRun) {
    const withinHours = await isWithinStoreBusinessHours(storeId);
    if (!withinHours) {
      console.log(`[DriftRecovery] Store ${storeId}: outside business hours — skipping automated SMS`);
      return result;
    }
  }

  // Get store SMS settings
  const [smsSetting] = await db
    .select()
    .from(smsSettings)
    .where(eq(smsSettings.storeId, storeId));

  // Get store slug
  const [storeRow] = await db.execute(
    sql`SELECT slug FROM locations WHERE id = ${storeId} LIMIT 1`
  );
  const bookingSlug = (storeRow as any)?.slug || null;

  // Get store name
  const [locationRow] = await db.execute(
    sql`SELECT name FROM locations WHERE id = ${storeId} LIMIT 1`
  );
  const storeName = (locationRow as any)?.name || "our salon";

  // Find drifting clients who haven't been contacted in the last 30 days
  // Exclude one-time customers (total_visits <= 1) — a single visit doesn't establish a pattern
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const driftingClients = await db
    .select({
      customerId: clientIntelligence.customerId,
      avgCadenceDays: clientIntelligence.avgVisitCadenceDays,
      churnRiskScore: clientIntelligence.churnRiskScore,
      lastWinbackSentAt: clientIntelligence.lastWinbackSentAt,
      totalVisits: clientIntelligence.totalVisits,
    })
    .from(clientIntelligence)
    .where(
      and(
        eq(clientIntelligence.storeId, storeId),
        eq(clientIntelligence.isDrifting, true),
        sql`(last_winback_sent_at IS NULL OR last_winback_sent_at < ${thirtyDaysAgo.toISOString()})`,
        sql`COALESCE(total_visits, 0) > 1`
      )
    )
    .limit(50);

  for (const client of driftingClients) {
    const [customer] = await db
      .select({ name: customers.name, phone: customers.phone, marketingOptIn: customers.marketingOptIn })
      .from(customers)
      .where(eq(customers.id, client.customerId));

    if (!customer) {
      result.skipped++;
      result.details.push({ customerId: client.customerId, customerName: "Unknown", status: "skipped", reason: "Customer not found" });
      continue;
    }

    if (!customer.marketingOptIn) {
      result.skipped++;
      result.details.push({ customerId: client.customerId, customerName: customer.name, status: "skipped", reason: "Marketing opt-out" });
      continue;
    }

    if (!customer.phone) {
      result.skipped++;
      result.details.push({ customerId: client.customerId, customerName: customer.name, status: "skipped", reason: "No phone number" });
      continue;
    }

    // Intelligent SMS guard — review last message sent to this client before sending
    if (!dryRun) {
      const guard = await shouldSendReengagementSms(storeId, client.customerId, "winback");
      if (!guard.allowed) {
        result.skipped++;
        result.details.push({ customerId: client.customerId, customerName: customer.name, status: "skipped", reason: guard.reason });
        continue;
      }
    }

    const message = buildWinbackMessage(
      customer.name,
      storeName,
      client.avgCadenceDays ? parseFloat(client.avgCadenceDays) : null,
      bookingSlug
    );

    if (dryRun) {
      result.sent++;
      result.details.push({ customerId: client.customerId, customerName: customer.name, status: "sent" });
      continue;
    }

    try {
      await sendSms(storeId, customer.phone, message, "winback", undefined, client.customerId);

      // Log the intervention
      await db.insert(intelligenceInterventions).values({
        storeId,
        customerId: client.customerId,
        interventionType: "winback",
        channel: "sms",
        messageBody: message,
        status: "sent",
        triggeredBy: "auto",
      });

      // Update last winback sent
      await db
        .update(clientIntelligence)
        .set({
          lastWinbackSentAt: new Date(),
          winbackSentCount: sql`winback_sent_count + 1`,
        })
        .where(
          and(
            eq(clientIntelligence.storeId, storeId),
            eq(clientIntelligence.customerId, client.customerId)
          )
        );

      result.sent++;
      result.details.push({ customerId: client.customerId, customerName: customer.name, status: "sent" });
    } catch (err: any) {
      result.errors++;
      result.details.push({ customerId: client.customerId, customerName: customer.name, status: "error", reason: err.message });
    }
  }

  return result;
}

export async function sendManualWinback(
  storeId: number,
  customerId: number
): Promise<{ success: boolean; message?: string; error?: string }> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.storeId, storeId)));

  if (!customer) return { success: false, error: "Customer not found" };
  if (!customer.phone) return { success: false, error: "No phone number on file" };
  if (!customer.marketingOptIn) return { success: false, error: "Customer has opted out of marketing" };

  const [locationRow] = await db.execute(
    sql`SELECT name, slug FROM locations WHERE id = ${storeId} LIMIT 1`
  );
  const storeName = (locationRow as any)?.name || "our salon";
  const bookingSlug = (locationRow as any)?.slug || null;

  const [intel] = await db
    .select({ avgCadenceDays: clientIntelligence.avgVisitCadenceDays })
    .from(clientIntelligence)
    .where(and(eq(clientIntelligence.storeId, storeId), eq(clientIntelligence.customerId, customerId)));

  const message = buildWinbackMessage(
    customer.name,
    storeName,
    intel?.avgCadenceDays ? parseFloat(intel.avgCadenceDays) : null,
    bookingSlug
  );

  try {
    await sendSms(storeId, customer.phone, message, "winback", undefined, customerId);

    await db.insert(intelligenceInterventions).values({
      storeId,
      customerId,
      interventionType: "winback",
      channel: "sms",
      messageBody: message,
      status: "sent",
      triggeredBy: "manual",
    });

    if (intel) {
      await db
        .update(clientIntelligence)
        .set({ lastWinbackSentAt: new Date(), winbackSentCount: sql`winback_sent_count + 1` })
        .where(and(eq(clientIntelligence.storeId, storeId), eq(clientIntelligence.customerId, customerId)));
    }

    return { success: true, message };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
