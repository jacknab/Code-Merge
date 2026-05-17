import { db } from "../db";
import { customers, smsSettings } from "@shared/schema";
import { clientIntelligence, intelligenceInterventions } from "@shared/schema/intelligence";
import { sendSms } from "../sms";
import { eq, and, sql } from "drizzle-orm";

const APP_URL = process.env.APP_URL || "https://certxa.com";

export async function sendNoShowWinback(
  storeId: number,
  customerId: number,
  appointmentId?: number
): Promise<{ success: boolean; message?: string; error?: string }> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.storeId, storeId)));

  if (!customer) return { success: false, error: "Customer not found" };
  if (!customer.phone) return { success: false, error: "No phone number on file" };
  if (!customer.marketingOptIn) return { success: false, error: "Customer opted out of marketing" };

  // Check if we already sent a no-show winback in the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentWinback = await db
    .select({ id: intelligenceInterventions.id })
    .from(intelligenceInterventions)
    .where(
      and(
        eq(intelligenceInterventions.storeId, storeId),
        eq(intelligenceInterventions.customerId, customerId),
        eq(intelligenceInterventions.interventionType, "no_show_winback"),
        sql`sent_at >= ${sevenDaysAgo.toISOString()}`
      )
    )
    .limit(1);

  if (recentWinback.length > 0) {
    return { success: false, error: "Win-back already sent in last 7 days" };
  }

  const [locationRow] = await db.execute(
    sql`SELECT name, slug FROM locations WHERE id = ${storeId} LIMIT 1`
  );
  const storeName = (locationRow as any)?.name || "our salon";
  const bookingSlug = (locationRow as any)?.slug || null;
  const bookingLink = bookingSlug ? `${APP_URL}/book/${bookingSlug}` : APP_URL;

  const firstName = customer.name.split(" ")[0];

  const message = `Hi ${firstName}, we noticed you missed your appointment at ${storeName}. No worries — life happens! Ready to rebook? We'd love to see you: ${bookingLink}\n\nReply STOP to opt out.`;

  try {
    await sendSms(storeId, customer.phone, message, "no_show_winback", appointmentId, customerId);

    await db.insert(intelligenceInterventions).values({
      storeId,
      customerId,
      interventionType: "no_show_winback",
      channel: "sms",
      messageBody: message,
      status: "sent",
      triggeredBy: "auto",
      appointmentId,
    });

    // Update intelligence record if exists
    await db
      .update(clientIntelligence)
      .set({ lastWinbackSentAt: new Date(), winbackSentCount: sql`winback_sent_count + 1` })
      .where(
        and(eq(clientIntelligence.storeId, storeId), eq(clientIntelligence.customerId, customerId))
      );

    return { success: true, message };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
