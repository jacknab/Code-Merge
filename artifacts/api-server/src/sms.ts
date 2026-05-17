import Twilio from "twilio";
import { storage } from "./storage";
import type { SmsSettings, AppointmentWithDetails } from "@shared/schema";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "./db";
import { locations } from "@shared/schema";
import { eq, and, gt, sql } from "drizzle-orm";

// Global Twilio client using company credentials
function getGlobalTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  
  if (!accountSid || !authToken || !fromNumber) {
    return null;
  }
  return {
    client: Twilio(accountSid, authToken),
    fromNumber,
  };
}

function getTwilioClient(settings: SmsSettings) {
  if (!settings.twilioAccountSid || !settings.twilioAuthToken) {
    return null;
  }
  return Twilio(settings.twilioAccountSid, settings.twilioAuthToken);
}

function interpolateTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

// ── Two-bucket atomic credit deduction ────────────────────────────────────────
// Priority: smsAllowance (subscription) → smsCredits (purchased) → block
// Each deduction uses a conditional UPDATE WHERE field > 0 to be
// race-condition safe. No credit ever goes negative.

type DeductResult =
  | { source: "allowance" | "credits" }
  | { error: "no_credits" | "store_not_found" };

async function deductOneSmsCredit(storeId: number): Promise<DeductResult> {
  // Step 1: Try smsAllowance (subscription bucket, resets monthly)
  const allowanceRows = await db
    .update(locations)
    .set({ smsAllowance: sql`sms_allowance - 1` })
    .where(and(eq(locations.id, storeId), gt(locations.smsAllowance, 0)))
    .returning({ id: locations.id });

  if (allowanceRows.length > 0) {
    return { source: "allowance" };
  }

  // Step 2: Fallback to smsCredits (purchased bucket, never resets)
  const creditRows = await db
    .update(locations)
    .set({ smsCredits: sql`sms_credits - 1` })
    .where(and(eq(locations.id, storeId), gt(locations.smsCredits, 0)))
    .returning({ id: locations.id });

  if (creditRows.length > 0) {
    return { source: "credits" };
  }

  // Step 3: Both buckets empty — block send
  const [store] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.id, storeId))
    .limit(1);

  if (!store) return { error: "store_not_found" };
  return { error: "no_credits" };
}

export async function sendSms(
  storeId: number,
  phone: string,
  body: string,
  messageType: string,
  appointmentId?: number,
  customerId?: number
): Promise<{ success: boolean; sid?: string; error?: string; skipped?: boolean }> {
  // Normalize phone number and check SMS opt-out list
  const normalizedPhone = phone.replace(/\D/g, "");
  if (normalizedPhone.length >= 10) {
    try {
      const { smsOptOuts } = await import("@shared/schema");
      const { eq: deq, and: dand } = await import("drizzle-orm");
      const [optOut] = await db
        .select({ isOptedOut: smsOptOuts.isOptedOut })
        .from(smsOptOuts)
        .where(dand(eq(smsOptOuts.phone, normalizedPhone), eq(smsOptOuts.isOptedOut, true)))
        .limit(1);
      if (optOut?.isOptedOut) {
        console.log(`[SMS] Skipping opted-out number ${normalizedPhone}`);
        return { success: true, skipped: true };
      }
    } catch (err) {
      console.warn("[SMS] Opt-out check failed:", err);
    }
  }

  // Phase 9.2 — practice-mode short-circuit. Sandbox stores must never send
  // real SMS to real phones. We log to the SMS log so trainees can still see
  // their action "happened" in-app.
  const { isSandboxStore } = await import("./training/sandbox");
  if (await isSandboxStore(storeId)) {
    await storage.createSmsLog({
      storeId,
      appointmentId: appointmentId ?? null,
      customerId: customerId ?? null,
      phone,
      messageType,
      messageBody: body,
      status: "sandbox-skipped",
      twilioSid: null,
      errorMessage: null,
      sentAt: new Date(),
    }).catch(() => null);
    return { success: true, skipped: true };
  }

  // ── Two-bucket credit check (atomic, race-condition safe) ──────────────────
  const deductResult = await deductOneSmsCredit(storeId);

  if ("error" in deductResult) {
    if (deductResult.error === "store_not_found") {
      return { success: false, error: "Store not found" };
    }
    // Both buckets empty — do NOT insert into sms_log, just return error
    console.warn(`[SMS] Store ${storeId} has no SMS credits available`);
    return { success: false, error: "No SMS credits available" };
  }

  // Credit was successfully deducted — get Twilio config and send
  const twilioConfig = getGlobalTwilioClient();
  if (!twilioConfig) {
    // Credit already deducted but Twilio not configured — refund the credit
    if (deductResult.source === "allowance") {
      await db.update(locations)
        .set({ smsAllowance: sql`sms_allowance + 1` })
        .where(eq(locations.id, storeId));
    } else {
      await db.update(locations)
        .set({ smsCredits: sql`sms_credits + 1` })
        .where(eq(locations.id, storeId));
    }
    return { success: false, error: "SMS service not configured" };
  }

  try {
    const message = await twilioConfig.client.messages.create({
      body,
      from: twilioConfig.fromNumber,
      to: phone,
    });

    // Credit was already atomically deducted before the send — just log success
    await storage.createSmsLog({
      storeId,
      appointmentId: appointmentId ?? null,
      customerId: customerId ?? null,
      phone,
      messageType,
      messageBody: body,
      status: "sent",
      twilioSid: message.sid,
      errorMessage: null,
      sentAt: new Date(),
      smsSource: deductResult.source,
      costEstimate: "0.0100",
    });

    return { success: true, sid: message.sid };
  } catch (err: any) {
    const errorMessage = err.message || "Unknown error";

    // Twilio failed after deduction — refund the credit so we don't waste it
    if (deductResult.source === "allowance") {
      await db.update(locations)
        .set({ smsAllowance: sql`sms_allowance + 1` })
        .where(eq(locations.id, storeId));
    } else {
      await db.update(locations)
        .set({ smsCredits: sql`sms_credits + 1` })
        .where(eq(locations.id, storeId));
    }

    await storage.createSmsLog({
      storeId,
      appointmentId: appointmentId ?? null,
      customerId: customerId ?? null,
      phone,
      messageType,
      messageBody: body,
      status: "failed",
      twilioSid: null,
      errorMessage,
      sentAt: new Date(),
      smsSource: deductResult.source,
      costEstimate: "0.0000",
    });

    console.error(`SMS send failed for store ${storeId}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

export async function sendBookingConfirmation(
  appointment: AppointmentWithDetails
): Promise<void> {
  if (!appointment.customer?.phone || !appointment.storeId) return;

  const settings = await storage.getSmsSettings(appointment.storeId);
  if (!settings?.bookingConfirmationEnabled) return;

  const timezone = appointment.store?.timezone || "UTC";
  const template =
    settings.confirmationTemplate ||
    "Hi {customerName}, your appointment at {storeName} is confirmed for {appointmentDate} at {appointmentTime}. See you then!";

  const body = interpolateTemplate(template, {
    customerName: appointment.customer?.name || "there",
    storeName: appointment.store?.name || "our salon",
    appointmentDate: formatInTimeZone(
      appointment.date,
      timezone,
      "EEEE, MMMM d"
    ),
    appointmentTime: formatInTimeZone(
      appointment.date,
      timezone,
      "h:mm a"
    ),
    serviceName: appointment.service?.name || "your service",
  });

  await sendSms(
    appointment.storeId,
    appointment.customer.phone,
    body,
    "booking_confirmation",
    appointment.id,
    appointment.customer.id
  );
}

export async function sendAppointmentReminder(
  appointment: AppointmentWithDetails
): Promise<void> {
  if (!appointment.customer?.phone || !appointment.storeId) return;

  const settings = await storage.getSmsSettings(appointment.storeId);
  if (!settings?.reminderEnabled) return;

  const existing = await storage.getSmsLogByAppointmentAndType(
    appointment.id,
    "reminder"
  );
  if (existing) return;

  const timezone = appointment.store?.timezone || "UTC";
  const template =
    settings.reminderTemplate ||
    "Hi {customerName}, this is a reminder of your appointment at {storeName} tomorrow at {appointmentTime}. Reply STOP to opt out.";

  const body = interpolateTemplate(template, {
    customerName: appointment.customer?.name || "there",
    storeName: appointment.store?.name || "our salon",
    appointmentDate: formatInTimeZone(
      appointment.date,
      timezone,
      "EEEE, MMMM d"
    ),
    appointmentTime: formatInTimeZone(
      appointment.date,
      timezone,
      "h:mm a"
    ),
    serviceName: appointment.service?.name || "your service",
  });

  await sendSms(
    appointment.storeId,
    appointment.customer.phone,
    body,
    "reminder",
    appointment.id,
    appointment.customer.id
  );
}

export async function sendReviewRequest(
  appointment: AppointmentWithDetails
): Promise<void> {
  if (!appointment.customer?.phone || !appointment.storeId) return;

  const settings = await storage.getSmsSettings(appointment.storeId);
  if (!settings?.reviewRequestEnabled || !settings.googleReviewUrl) return;

  const existing = await storage.getSmsLogByAppointmentAndType(
    appointment.id,
    "review_request"
  );
  if (existing) return;

  const template =
    settings.reviewTemplate ||
    "Hi {customerName}, thank you for visiting {storeName}! We'd love your feedback. Leave us a review: {reviewUrl}";

  const body = interpolateTemplate(template, {
    customerName: appointment.customer?.name || "there",
    storeName: appointment.store?.name || "our salon",
    reviewUrl: settings.googleReviewUrl,
  });

  await sendSms(
    appointment.storeId,
    appointment.customer.phone,
    body,
    "review_request",
    appointment.id,
    appointment.customer.id
  );
}

let reminderIntervalId: ReturnType<typeof setInterval> | null = null;

export function startReminderScheduler(): void {
  if (reminderIntervalId) return;

  console.log("[SMS] Reminder scheduler started (checks every 5 minutes)");

  reminderIntervalId = setInterval(async () => {
    try {
      await processReminders();
      await processReviewRequests();
    } catch (err) {
      console.error("[SMS] Scheduler error:", err);
    }
  }, 5 * 60 * 1000);

  setTimeout(() => {
    processReminders().catch(console.error);
    processReviewRequests().catch(console.error);
  }, 10_000);
}

async function processReminders(): Promise<void> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const upcomingAppointments = await storage.getAppointmentsNeedingReminders(
    in24h,
    in25h
  );

  for (const appt of upcomingAppointments) {
    await sendAppointmentReminder(appt);
  }

  if (upcomingAppointments.length > 0) {
    console.log(
      `[SMS] Processed ${upcomingAppointments.length} reminder(s)`
    );
  }
}

async function processReviewRequests(): Promise<void> {
  const now = new Date();
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const ninetyMinAgo = new Date(now.getTime() - 90 * 60 * 1000);

  const completedAppointments = await storage.getRecentlyCompletedAppointments(
    ninetyMinAgo,
    thirtyMinAgo
  );

  let sent = 0;
  for (const appt of completedAppointments) {
    try {
      await sendReviewRequest(appt);
      sent++;
    } catch (err) {
      console.error(`[SMS] Review request error for appointment ${appt.id}:`, err);
    }
  }

  if (sent > 0) {
    console.log(`[SMS] Sent ${sent} review request(s)`);
  }
}

export function stopReminderScheduler(): void {
  if (reminderIntervalId) {
    clearInterval(reminderIntervalId);
    reminderIntervalId = null;
  }
}
