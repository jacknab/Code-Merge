import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { locations } from "@shared/schema";
import {
  stripeWebhookEvents,
  stripeSubscriptions,
  subscriptions,
  invoiceRecords,
  paymentTransactions,
  refunds,
  customerBillingProfiles,
  stripeOrders,
} from "@shared/schema/billing";
import { logBillingActivity, suspendAccount, restoreAccount } from "../services/billing-service";
import { reactivateExpiredAccount } from "../services/trial-expiration";

const router = Router();

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;
  if (!key) throw new Error("Stripe not configured");
  return new Stripe(key, { apiVersion: "2025-02-24.acacia" });
}

const webhookSecret =
  process.env.STRIPE_WEBHOOK_SECRET ||
  process.env.STRIPE_TEST_WEBHOOK_SECRET ||
  "";

// POST /api/billing/webhook — Stripe sends events here
router.post(
  "/webhook",
  async (req: Request, res: Response): Promise<void> => {
    if (!webhookSecret) {
      res.status(500).json({ error: "Webhook secret not configured" });
      return;
    }

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(
        (req as any).rawBody as Buffer,
        sig,
        webhookSecret
      );
    } catch (err: any) {
      console.error("[Webhook] Signature verification failed:", err.message);
      res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
      return;
    }

    // Idempotency: check if we already processed this event
    const [existing] = await db
      .select({ id: stripeWebhookEvents.id, processed: stripeWebhookEvents.processed })
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.stripeEventId, event.id))
      .limit(1);

    if (existing?.processed) {
      res.json({ received: true, duplicate: true });
      return;
    }

    // Record the event (upsert)
    let eventRowId: number;
    if (existing) {
      await db
        .update(stripeWebhookEvents)
        .set({ processingAttempts: (existing as any).processingAttempts + 1 })
        .where(eq(stripeWebhookEvents.stripeEventId, event.id));
      eventRowId = existing.id;
    } else {
      const [row] = await db
        .insert(stripeWebhookEvents)
        .values({
          stripeEventId: event.id,
          eventType: event.type,
          apiVersion: event.api_version ?? null,
          processed: false,
          processingAttempts: 1,
          payloadJson: event as any,
          receivedAt: new Date(),
        })
        .returning({ id: stripeWebhookEvents.id });
      eventRowId = row.id;
    }

    // Acknowledge Stripe immediately — process asynchronously
    res.json({ received: true });

    // Process in background (don't await — already responded)
    processWebhookEvent(event, eventRowId).catch((err) => {
      console.error(`[Webhook] Failed to process event ${event.id} (${event.type}):`, err);
    });
  }
);

// ─── Event Processor ──────────────────────────────────────────────────────────

async function processWebhookEvent(
  event: Stripe.Event,
  eventRowId: number
): Promise<void> {
  try {
    switch (event.type) {
      case "customer.created":
      case "customer.updated":
        await handleCustomerUpdated(event.data.object as Stripe.Customer);
        break;

      case "customer.subscription.created":
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "invoice.created":
      case "invoice.finalized":
      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case "charge.refunded":
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;

      case "charge.dispute.created":
        await handleDisputeCreated(event.data.object as Stripe.Dispute);
        break;

      case "charge.dispute.closed":
        await handleDisputeClosed(event.data.object as Stripe.Dispute);
        break;

      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "refund.created":
      case "refund.updated":
        await handleRefundUpdated(event.data.object as Stripe.Refund);
        break;

      default:
        // Silently accept unknown events — they're still stored
        break;
    }

    // Mark processed
    await db
      .update(stripeWebhookEvents)
      .set({ processed: true, processedAt: new Date() })
      .where(eq(stripeWebhookEvents.id, eventRowId));
  } catch (err: any) {
    console.error(`[Webhook] Error processing ${event.type}:`, err);
    await db
      .update(stripeWebhookEvents)
      .set({ processingError: err.message ?? String(err) })
      .where(eq(stripeWebhookEvents.id, eventRowId));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function salonIdFromCustomer(customerId: string): Promise<number | null> {
  const rows = await db
    .select({ storeNumber: (await import("@shared/schema/billing")).stripeCustomers.storeNumber })
    .from((await import("@shared/schema/billing")).stripeCustomers)
    .where(eq((await import("@shared/schema/billing")).stripeCustomers.customerId, customerId))
    .limit(1);
  return rows[0]?.storeNumber ?? null;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleCustomerUpdated(customer: Stripe.Customer): Promise<void> {
  const salonId = await salonIdFromCustomer(customer.id);
  if (!salonId) return;

  await db
    .update(customerBillingProfiles)
    .set({
      customerEmail: typeof customer.email === "string" ? customer.email : null,
      customerName: typeof customer.name === "string" ? customer.name : null,
      updatedAt: new Date(),
    })
    .where(eq(customerBillingProfiles.salonId, salonId));
}

async function handleSubscriptionCreated(sub: Stripe.Subscription): Promise<void> {
  const customerId = sub.customer as string;
  const salonId = await salonIdFromCustomer(customerId);

  // Upsert stripe_subscriptions
  const [existing] = await db
    .select({ id: stripeSubscriptions.id })
    .from(stripeSubscriptions)
    .where(eq(stripeSubscriptions.subscriptionId, sub.id))
    .limit(1);

  const subData = {
    subscriptionId: sub.id,
    priceId: sub.items.data[0]?.price.id ?? null,
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    status: sub.status,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(stripeSubscriptions).set(subData).where(eq(stripeSubscriptions.subscriptionId, sub.id));
  } else {
    await db.insert(stripeSubscriptions).values({ ...subData, customerId });
  }

  if (salonId) {
    await db
      .update(customerBillingProfiles)
      .set({
        currentSubscriptionStatus: sub.status,
        subscriptionStartedAt: new Date(sub.start_date * 1000),
        currentPeriodStart: new Date(sub.current_period_start * 1000),
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
        trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        updatedAt: new Date(),
      })
      .where(eq(customerBillingProfiles.salonId, salonId));

    await logBillingActivity({
      salonId,
      eventType: "subscription.created",
      severity: "success",
      message: `Subscription created (${sub.status})`,
      metadata: { subscriptionId: sub.id, status: sub.status },
      source: "webhook",
    });
  }
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  const customerId = sub.customer as string;
  const salonId = await salonIdFromCustomer(customerId);

  await db
    .update(stripeSubscriptions)
    .set({
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodStart: sub.current_period_start,
      currentPeriodEnd: sub.current_period_end,
      updatedAt: new Date(),
    })
    .where(eq(stripeSubscriptions.subscriptionId, sub.id));

  await db
    .update(subscriptions)
    .set({
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0,
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeSubscriptionId, sub.id));

  if (salonId) {
    await db
      .update(customerBillingProfiles)
      .set({
        currentSubscriptionStatus: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodStart: new Date(sub.current_period_start * 1000),
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
        updatedAt: new Date(),
      })
      .where(eq(customerBillingProfiles.salonId, salonId));

    await logBillingActivity({
      salonId,
      eventType: "subscription.updated",
      message: `Subscription updated → status: ${sub.status}`,
      metadata: { subscriptionId: sub.id, status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end },
      source: "webhook",
    });
  }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId = sub.customer as string;
  const salonId = await salonIdFromCustomer(customerId);

  await db
    .update(stripeSubscriptions)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(stripeSubscriptions.subscriptionId, sub.id));

  await db
    .update(subscriptions)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, sub.id));

  if (salonId) {
    await db
      .update(customerBillingProfiles)
      .set({
        currentSubscriptionStatus: "canceled",
        canceledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(customerBillingProfiles.salonId, salonId));

    await logBillingActivity({
      salonId,
      eventType: "subscription.deleted",
      severity: "warn",
      message: `Subscription ${sub.id} ended`,
      metadata: { subscriptionId: sub.id },
      source: "webhook",
    });
  }
}

async function handleInvoicePaymentSucceeded(inv: Stripe.Invoice): Promise<void> {
  const customerId = inv.customer as string;
  const salonId = await salonIdFromCustomer(customerId);

  // Upsert invoice record
  await db
    .insert(invoiceRecords)
    .values({
      stripeInvoiceId: inv.id!,
      stripeCustomerId: customerId,
      stripeSubscriptionId: (inv.subscription as string) ?? null,
      salonId: salonId ?? null,
      invoiceNumber: inv.number ?? null,
      status: inv.status ?? null,
      paid: inv.paid,
      attempted: inv.attempted,
      currency: inv.currency,
      subtotalCents: BigInt(inv.subtotal) as any,
      taxCents: BigInt(inv.tax ?? 0) as any,
      totalCents: BigInt(inv.total) as any,
      amountPaidCents: BigInt(inv.amount_paid) as any,
      amountRemainingCents: BigInt(inv.amount_remaining) as any,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdfUrl: inv.invoice_pdf ?? null,
      billingReason: inv.billing_reason ?? null,
      periodStart: inv.period_start ? new Date(inv.period_start * 1000) : null,
      periodEnd: inv.period_end ? new Date(inv.period_end * 1000) : null,
      paidAt: inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : null,
    })
    .onConflictDoUpdate({
      target: invoiceRecords.stripeInvoiceId,
      set: {
        status: inv.status ?? null,
        paid: inv.paid,
        amountPaidCents: BigInt(inv.amount_paid) as any,
        amountRemainingCents: BigInt(inv.amount_remaining) as any,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
        invoicePdfUrl: inv.invoice_pdf ?? null,
        paidAt: inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : null,
        updatedAt: new Date(),
      },
    });

  if (salonId) {
    // Update subscription status to active
    if (inv.subscription) {
      await db
        .update(stripeSubscriptions)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(stripeSubscriptions.subscriptionId, inv.subscription as string));
    }

    // Update billing profile stats
    await db
      .update(customerBillingProfiles)
      .set({
        currentSubscriptionStatus: "active",
        lastPaymentDate: new Date(),
        lastPaymentAmountCents: BigInt(inv.amount_paid) as any,
        lastFailedPaymentDate: null,
        lastFailedPaymentReason: null,
        delinquent: false,
        lifetimeValueCents: sql`COALESCE(lifetime_value_cents, 0) + ${inv.amount_paid}`,
        totalSuccessfulPayments: sql`COALESCE(total_successful_payments, 0) + 1`,
        updatedAt: new Date(),
      })
      .where(eq(customerBillingProfiles.salonId, salonId));

    await logBillingActivity({
      salonId,
      eventType: "payment.succeeded",
      severity: "success",
      message: `Payment of ${(inv.amount_paid / 100).toFixed(2)} ${inv.currency.toUpperCase()} succeeded`,
      metadata: { invoiceId: inv.id, amount: inv.amount_paid },
      source: "webhook",
    });

    // Restore billing suspension and reactivate any expired trial accounts
    await restoreAccount(salonId);
    await reactivateExpiredAccount(salonId);

    // Reset monthly SMS allowance when subscription renews
    if (
      inv.billing_reason === "subscription_cycle" ||
      inv.billing_reason === "subscription_create"
    ) {
      await resetSmsAllowanceForStore(salonId);
    }
  }
}

async function resetSmsAllowanceForStore(salonId: number): Promise<void> {
  try {
    // Look up the store's current plan's SMS allowance from billing_plans
    const { subscriptions: subTable } = await import("@shared/schema/billing");
    const { billingPlans } = await import("@shared/schema/billing");
    const [subRow] = await db
      .select({ planCode: subTable.planCode })
      .from(subTable)
      .where(eq(subTable.storeNumber, salonId))
      .limit(1);

    if (!subRow) return;

    const [planRow] = await db
      .select({ smsCredits: billingPlans.smsCredits })
      .from(billingPlans)
      .where(eq(billingPlans.code, subRow.planCode))
      .limit(1);

    const allowance = planRow?.smsCredits ? Number(planRow.smsCredits) : 0;
    if (allowance <= 0) return;

    await db
      .update(locations)
      .set({ smsAllowance: allowance, updatedAt: new Date() } as any)
      .where(eq(locations.id, salonId));

    console.log(`[billing] Reset SMS allowance for store ${salonId} to ${allowance} (plan: ${subRow.planCode})`);
  } catch (err: any) {
    console.error(`[billing] Failed to reset SMS allowance for store ${salonId}:`, err.message);
  }
}

async function handleInvoicePaymentFailed(inv: Stripe.Invoice): Promise<void> {
  const customerId = inv.customer as string;
  const salonId = await salonIdFromCustomer(customerId);

  // Upsert invoice record
  await db
    .insert(invoiceRecords)
    .values({
      stripeInvoiceId: inv.id!,
      stripeCustomerId: customerId,
      stripeSubscriptionId: (inv.subscription as string) ?? null,
      salonId: salonId ?? null,
      status: inv.status ?? "open",
      paid: false,
      attempted: true,
      totalCents: BigInt(inv.total) as any,
      amountPaidCents: BigInt(0) as any,
      amountRemainingCents: BigInt(inv.amount_remaining) as any,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      nextPaymentAttempt: inv.next_payment_attempt
        ? new Date(inv.next_payment_attempt * 1000)
        : null,
    })
    .onConflictDoUpdate({
      target: invoiceRecords.stripeInvoiceId,
      set: {
        status: inv.status ?? "open",
        paid: false,
        attempted: true,
        nextPaymentAttempt: inv.next_payment_attempt
          ? new Date(inv.next_payment_attempt * 1000)
          : null,
        updatedAt: new Date(),
      },
    });

  if (salonId) {
    if (inv.subscription) {
      await db
        .update(stripeSubscriptions)
        .set({ status: "past_due", updatedAt: new Date() })
        .where(eq(stripeSubscriptions.subscriptionId, inv.subscription as string));

      await db
        .update(subscriptions)
        .set({ status: "past_due", updatedAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, inv.subscription as string));
    }

    const failureMessage =
      (inv as any).last_finalization_error?.message ??
      "Payment declined";

    await db
      .update(customerBillingProfiles)
      .set({
        lastFailedPaymentDate: new Date(),
        lastFailedPaymentReason: failureMessage,
        delinquent: true,
        totalFailedPayments: sql`COALESCE(total_failed_payments, 0) + 1`,
        updatedAt: new Date(),
      })
      .where(eq(customerBillingProfiles.salonId, salonId));

    await logBillingActivity({
      salonId,
      eventType: "payment.failed",
      severity: "error",
      message: `Payment failed: ${failureMessage}`,
      metadata: {
        invoiceId: inv.id,
        amount: inv.amount_due,
        nextAttempt: inv.next_payment_attempt,
        reason: failureMessage,
      },
      source: "webhook",
    });

    // Suspend the account — Stripe subscription stays alive for retries
    await suspendAccount(salonId, failureMessage);
  }
}

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent): Promise<void> {
  const salonId = pi.metadata?.salon_id ? Number(pi.metadata.salon_id) : null;

  const pm = pi.payment_method as Stripe.PaymentMethod | null;
  const card = typeof pm === "object" && pm?.card ? pm.card : null;

  const charge = (pi as any).latest_charge as Stripe.Charge | null;

  await db
    .insert(paymentTransactions)
    .values({
      stripePaymentIntentId: pi.id,
      stripeChargeId: charge?.id ?? null,
      salonId: salonId ?? null,
      status: pi.status,
      paymentMethodBrand: card?.brand ?? null,
      paymentMethodLast4: card?.last4 ?? null,
      cardExpMonth: card?.exp_month ?? null,
      cardExpYear: card?.exp_year ?? null,
      amountCents: BigInt(pi.amount) as any,
      currency: pi.currency,
      receiptUrl: charge?.receipt_url ?? null,
    })
    .onConflictDoUpdate({
      target: paymentTransactions.stripeChargeId,
      set: { status: pi.status, updatedAt: new Date() },
    });
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent): Promise<void> {
  const salonId = pi.metadata?.salon_id ? Number(pi.metadata.salon_id) : null;

  const charge = (pi as any).latest_charge as Stripe.Charge | null;
  const failureCode = pi.last_payment_error?.code ?? null;
  const failureMessage = pi.last_payment_error?.message ?? null;

  await db
    .insert(paymentTransactions)
    .values({
      stripePaymentIntentId: pi.id,
      stripeChargeId: charge?.id ?? null,
      salonId: salonId ?? null,
      status: "failed",
      amountCents: BigInt(pi.amount) as any,
      currency: pi.currency,
      failureCode,
      failureMessage,
    })
    .onConflictDoUpdate({
      target: paymentTransactions.stripeChargeId,
      set: { status: "failed", failureCode, failureMessage, updatedAt: new Date() },
    });
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const salonId = charge.metadata?.salon_id ? Number(charge.metadata.salon_id) : null;

  await db
    .update(paymentTransactions)
    .set({
      refunded: true,
      refundAmountCents: BigInt(charge.amount_refunded) as any,
      updatedAt: new Date(),
    })
    .where(eq(paymentTransactions.stripeChargeId, charge.id));

  if (salonId) {
    await logBillingActivity({
      salonId,
      eventType: "charge.refunded",
      severity: "warn",
      message: `Charge ${charge.id} refunded: ${(charge.amount_refunded / 100).toFixed(2)} ${charge.currency.toUpperCase()}`,
      metadata: { chargeId: charge.id, amountRefunded: charge.amount_refunded },
      source: "webhook",
    });
  }
}

async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const chargeId = dispute.charge as string;

  await db
    .update(paymentTransactions)
    .set({ disputeStatus: "under_review", updatedAt: new Date() })
    .where(eq(paymentTransactions.stripeChargeId, chargeId));

  const [txn] = await db
    .select({ salonId: paymentTransactions.salonId })
    .from(paymentTransactions)
    .where(eq(paymentTransactions.stripeChargeId, chargeId))
    .limit(1);

  if (txn?.salonId) {
    await logBillingActivity({
      salonId: txn.salonId,
      eventType: "dispute.created",
      severity: "error",
      message: `Dispute opened on charge ${chargeId} for ${(dispute.amount / 100).toFixed(2)} — reason: ${dispute.reason}`,
      metadata: { disputeId: dispute.id, chargeId, reason: dispute.reason, amount: dispute.amount },
      source: "webhook",
    });
  }
}

async function handleDisputeClosed(dispute: Stripe.Dispute): Promise<void> {
  const chargeId = dispute.charge as string;

  await db
    .update(paymentTransactions)
    .set({ disputeStatus: dispute.status, updatedAt: new Date() })
    .where(eq(paymentTransactions.stripeChargeId, chargeId));

  const [txn] = await db
    .select({ salonId: paymentTransactions.salonId })
    .from(paymentTransactions)
    .where(eq(paymentTransactions.stripeChargeId, chargeId))
    .limit(1);

  if (txn?.salonId) {
    await logBillingActivity({
      salonId: txn.salonId,
      eventType: "dispute.closed",
      severity: "warn",
      message: `Dispute on charge ${chargeId} closed — outcome: ${dispute.status}`,
      metadata: { disputeId: dispute.id, status: dispute.status },
      source: "webhook",
    });
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const salonId = session.metadata?.salon_id ? Number(session.metadata.salon_id) : null;
  const planCode = session.metadata?.plan_code ?? null;
  const purchaseType = session.metadata?.purchase_type ?? null;

  if (session.payment_intent && session.payment_status === "paid") {
    const piId = session.payment_intent as string;
    await db
      .insert(stripeOrders)
      .values({
        checkoutSessionId: session.id,
        paymentIntentId: piId,
        customerId: session.customer as string,
        amountSubtotal: BigInt(session.amount_subtotal ?? 0) as any,
        amountTotal: BigInt(session.amount_total ?? 0) as any,
        currency: session.currency ?? "usd",
        paymentStatus: session.payment_status ?? "paid",
        status: "completed",
      })
      .onConflictDoNothing();
  }

  // Handle SMS bucket one-time purchase
  if (purchaseType === "sms_bucket" && salonId && session.payment_status === "paid") {
    const creditsToAdd = session.metadata?.sms_credits ? Number(session.metadata.sms_credits) : 0;
    if (creditsToAdd > 0) {
      await db
        .update(locations)
        .set({
          smsCredits: sql`sms_credits + ${creditsToAdd}`,
          smsCreditsTotalPurchased: sql`sms_credits_total_purchased + ${creditsToAdd}`,
          updatedAt: new Date(),
        } as any)
        .where(eq(locations.id, salonId));

      console.log(`[billing] Added ${creditsToAdd} SMS credits to store ${salonId}`);

      await logBillingActivity({
        salonId,
        eventType: "sms_credits.purchased",
        severity: "success",
        message: `Purchased ${creditsToAdd} SMS credits ($${((session.amount_total ?? 0) / 100).toFixed(2)})`,
        metadata: { sessionId: session.id, creditsAdded: creditsToAdd },
        source: "webhook",
      });
      return;
    }
  }

  if (salonId) {
    await logBillingActivity({
      salonId,
      eventType: "checkout.completed",
      severity: "success",
      message: `Checkout completed — plan: ${planCode ?? "unknown"}`,
      metadata: { sessionId: session.id, planCode },
      source: "webhook",
    });
  }
}

async function handleRefundUpdated(refund: Stripe.Refund): Promise<void> {
  await db
    .update(refunds)
    .set({ status: refund.status ?? "succeeded", updatedAt: new Date() })
    .where(eq(refunds.stripeRefundId, refund.id));
}

export default router;
