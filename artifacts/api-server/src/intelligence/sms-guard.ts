import { db } from "../db";
import { smsLog, businessHours, locations } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

export interface LastSmsInfo {
  messageType: string;
  messageBody: string;
  sentAt: Date;
  daysSinceSent: number;
}

export async function getLastSmsToCustomer(
  storeId: number,
  customerId: number
): Promise<LastSmsInfo | null> {
  const [row] = await db
    .select({
      messageType: smsLog.messageType,
      messageBody: smsLog.messageBody,
      sentAt: smsLog.sentAt,
    })
    .from(smsLog)
    .where(
      and(
        eq(smsLog.storeId, storeId),
        eq(smsLog.customerId, customerId)
      )
    )
    .orderBy(desc(smsLog.sentAt))
    .limit(1);

  if (!row) return null;

  const daysSinceSent = Math.floor(
    (Date.now() - new Date(row.sentAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    messageType: row.messageType,
    messageBody: row.messageBody,
    sentAt: new Date(row.sentAt),
    daysSinceSent,
  };
}

const REENGAGEMENT_TYPES = new Set([
  "lapsed_reengagement",
  "winback",
  "drift_recovery",
  "campaign",
]);

export async function shouldSendReengagementSms(
  storeId: number,
  customerId: number,
  newMessageType: string,
  minDaysBetween = 30
): Promise<{ allowed: boolean; reason?: string }> {
  const last = await getLastSmsToCustomer(storeId, customerId);

  if (!last) return { allowed: true };

  if (last.daysSinceSent < minDaysBetween) {
    return {
      allowed: false,
      reason: `SMS sent ${last.daysSinceSent} day(s) ago (type: ${last.messageType}). Minimum gap is ${minDaysBetween} days.`,
    };
  }

  if (
    REENGAGEMENT_TYPES.has(last.messageType) &&
    REENGAGEMENT_TYPES.has(newMessageType) &&
    last.daysSinceSent < 14
  ) {
    return {
      allowed: false,
      reason: `Similar re-engagement SMS (${last.messageType}) sent only ${last.daysSinceSent} day(s) ago.`,
    };
  }

  return { allowed: true };
}

export async function isWithinStoreBusinessHours(storeId: number): Promise<boolean> {
  try {
    const [location] = await db
      .select({ timezone: locations.timezone })
      .from(locations)
      .where(eq(locations.id, storeId))
      .limit(1);

    const timezone = location?.timezone || "UTC";

    const nowInZone = new Date(
      new Date().toLocaleString("en-US", { timeZone: timezone })
    );
    const dayOfWeek = nowInZone.getDay();
    const currentHHMM =
      nowInZone.getHours() * 60 + nowInZone.getMinutes();

    const [hours] = await db
      .select({
        openTime: businessHours.openTime,
        closeTime: businessHours.closeTime,
        isClosed: businessHours.isClosed,
      })
      .from(businessHours)
      .where(
        and(
          eq(businessHours.storeId, storeId),
          eq(businessHours.dayOfWeek, dayOfWeek)
        )
      )
      .limit(1);

    if (!hours) {
      const hour = nowInZone.getHours();
      return hour >= 9 && hour < 18;
    }

    if (hours.isClosed) return false;

    const [openH, openM] = hours.openTime.split(":").map(Number);
    const [closeH, closeM] = hours.closeTime.split(":").map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    return currentHHMM >= openMinutes && currentHHMM < closeMinutes;
  } catch (err) {
    console.warn(`[SmsGuard] Could not check business hours for store ${storeId}:`, err);
    const hour = new Date().getHours();
    return hour >= 9 && hour < 18;
  }
}
