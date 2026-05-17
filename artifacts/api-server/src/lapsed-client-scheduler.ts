import { db } from "./db";
import { sendSms } from "./sms";
import { sendEmail } from "./mail";
import { customers, smsLog, locations } from "@shared/schema";
import { clients } from "@shared/schema/clients";
import { eq, and, sql, lt, isNotNull, isNull } from "drizzle-orm";
import {
  isWithinStoreBusinessHours,
  shouldSendReengagementSms,
} from "./intelligence/sms-guard";

let lapsedIntervalId: ReturnType<typeof setInterval> | null = null;

const DEFAULT_LAPSE_DAYS = 90;

async function processLapsedCustomersForStore(store: {
  id: number;
  name: string;
  bookingSlug: string | null;
}): Promise<void> {
  const withinHours = await isWithinStoreBusinessHours(store.id);
  if (!withinHours) {
    console.log(`[LapsedClient] Store ${store.id}: outside business hours — skipping SMS send`);
    return;
  }

  const lapseCutoff = new Date(Date.now() - DEFAULT_LAPSE_DAYS * 24 * 60 * 60 * 1000);

  const lapsedCustomers = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.storeId, store.id),
        eq(customers.marketingOptIn, true),
        isNotNull(customers.phone)
      )
    );

  const bookingUrl = store.bookingSlug
    ? `${process.env.APP_URL || "https://certxa.com"}/book/${store.bookingSlug}`
    : process.env.APP_URL || "https://certxa.com";

  let sent = 0;

  for (const customer of lapsedCustomers) {
    if (!customer.id || !customer.phone) continue;

    const guard = await shouldSendReengagementSms(store.id, customer.id, "lapsed_reengagement");
    if (!guard.allowed) {
      console.log(`[LapsedClient] Store ${store.id}, customer ${customer.id}: skipped — ${guard.reason}`);
      continue;
    }

    const firstName = customer.name?.split(" ")[0] || "there";
    const body = `Hi ${firstName}, we miss you at ${store.name}! It's been a while — book your next visit: ${bookingUrl} Reply STOP to opt out.`;

    await sendSms(
      store.id,
      customer.phone,
      body,
      "lapsed_reengagement",
      undefined,
      customer.id
    );

    if (customer.email) {
      const html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #5b21b6;">We miss you, ${firstName}!</h2>
          <p>It's been a while since your last visit at <strong>${store.name}</strong>, and we'd love to see you again.</p>
          <p>Your next appointment is just a click away — book now and treat yourself.</p>
          <p style="margin-top: 24px;">
            <a href="${bookingUrl}" style="background:#5b21b6;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Book Now</a>
          </p>
          <p style="color:#888;font-size:0.8rem;margin-top:24px;">
            You're receiving this because you opted into marketing messages at ${store.name}.
            <a href="#">Unsubscribe</a>
          </p>
        </div>`;
      await sendEmail(
        store.id,
        customer.email,
        `We miss you — come back to ${store.name}!`,
        html
      );
    }

    sent++;
  }

  if (sent > 0) {
    console.log(`[LapsedClient] Store ${store.id}: sent ${sent} re-engagement message(s)`);
  }
}

async function processLapsedClientsTable(store: {
  id: number;
  name: string;
  bookingSlug: string | null;
}): Promise<void> {
  const withinHours = await isWithinStoreBusinessHours(store.id);
  if (!withinHours) return;

  const lapseCutoff = new Date(Date.now() - DEFAULT_LAPSE_DAYS * 24 * 60 * 60 * 1000);

  const lapsedClients = await db
    .select({
      id: clients.id,
      firstName: clients.firstName,
      lastVisitAt: clients.lastVisitAt,
      totalVisits: sql<number>`(SELECT COUNT(*) FROM appointments WHERE customer_id = ${clients.id} AND store_id = ${store.id} AND status IN ('completed','started'))`,
      primaryPhone: sql<string>`(SELECT phone_number_e164 FROM client_phones WHERE client_id = ${clients.id} AND is_primary = true AND sms_opt_in = true LIMIT 1)`,
      primaryEmail: sql<string>`(SELECT email_address FROM client_emails WHERE client_id = ${clients.id} AND is_primary = true LIMIT 1)`,
      smsOptIn: sql<boolean>`(SELECT sms_marketing_opt_in FROM client_marketing_preferences WHERE client_id = ${clients.id} LIMIT 1)`,
    })
    .from(clients)
    .where(
      and(
        eq(clients.storeId, store.id),
        eq(clients.clientStatus, "active"),
        lt(clients.lastVisitAt, lapseCutoff),
        isNull(clients.archivedAt)
      )
    );

  const bookingUrl = store.bookingSlug
    ? `${process.env.APP_URL || "https://certxa.com"}/book/${store.bookingSlug}`
    : process.env.APP_URL || "https://certxa.com";

  for (const client of lapsedClients) {
    if (!client.smsOptIn || !client.primaryPhone) continue;

    if (Number(client.totalVisits) <= 1) continue;

    const firstName = client.firstName || "there";
    const body = `Hi ${firstName}, we miss you at ${store.name}! It's been a while — book your next visit: ${bookingUrl} Reply STOP to opt out.`;

    await sendSms(
      store.id,
      client.primaryPhone,
      body,
      "lapsed_reengagement",
      undefined,
      undefined
    );

    if (client.primaryEmail) {
      const html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #5b21b6;">We miss you, ${firstName}!</h2>
          <p>It's been a while since your last visit at <strong>${store.name}</strong>, and we'd love to see you again.</p>
          <p>
            <a href="${bookingUrl}" style="background:#5b21b6;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Book Now</a>
          </p>
        </div>`;
      await sendEmail(
        store.id,
        client.primaryEmail,
        `We miss you — come back to ${store.name}!`,
        html
      );
    }
  }
}

async function processAllLapsedClients(): Promise<void> {
  const allStores = await db
    .select({ id: locations.id, name: locations.name, bookingSlug: locations.bookingSlug })
    .from(locations);

  for (const store of allStores) {
    try {
      await processLapsedCustomersForStore(store);
      await processLapsedClientsTable(store);
    } catch (err) {
      console.error(`[LapsedClient] Error processing store ${store.id}:`, err);
    }
  }
}

export function startLapsedClientScheduler(): void {
  if (lapsedIntervalId) return;

  console.log("[LapsedClient] Scheduler started (runs daily at 10am, checks every hour)");

  lapsedIntervalId = setInterval(async () => {
    const hour = new Date().getHours();
    if (hour === 10) {
      try {
        await processAllLapsedClients();
      } catch (err) {
        console.error("[LapsedClient] Scheduler error:", err);
      }
    }
  }, 60 * 60 * 1000);
}

export function stopLapsedClientScheduler(): void {
  if (lapsedIntervalId) {
    clearInterval(lapsedIntervalId);
    lapsedIntervalId = null;
  }
}
