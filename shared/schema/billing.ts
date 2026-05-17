import {
  pgTable, serial, text, integer, boolean, timestamp, decimal,
  bigint, index, uniqueIndex, varchar, jsonb
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { locations } from "../schema";
import { users } from "../models/auth";

// ─── Billing Plans ──────────────────────────────────────────────────────────

export const billingPlans = pgTable("billing_plans", {
  id:               serial("id").primaryKey(),
  code:             text("code").unique().notNull(),
  name:             text("name").notNull(),
  description:      text("description"),
  priceCents:       decimal("price_cents", { precision: 12, scale: 0 }).notNull(),
  contactsMin:      decimal("contacts_min", { precision: 12, scale: 0 }),
  contactsMax:      decimal("contacts_max", { precision: 12, scale: 0 }),
  stripePriceId:    text("stripe_price_id"),
  stripeProductId:  text("stripe_product_id"),
  interval:         text("interval").default("month"),
  smsCredits:       decimal("sms_credits", { precision: 12, scale: 0 }),
  currency:         text("currency").default("usd"),
  active:           boolean("active").default(true),
  featuresJson:     jsonb("features_json"),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
});

export type BillingPlan = typeof billingPlans.$inferSelect;
export type InsertBillingPlan = typeof billingPlans.$inferInsert;

// ─── Stripe Customers ────────────────────────────────────────────────────────

export const stripeCustomers = pgTable("stripe_customers", {
  id:          serial("id").primaryKey(),
  userId:      text("user_id").notNull().references(() => users.id),
  customerId:  text("customer_id").notNull().unique(),
  storeNumber: integer("store_number").references(() => locations.id).unique(),
  createdAt:   timestamp("created_at").defaultNow(),
  updatedAt:   timestamp("updated_at").defaultNow(),
  deletedAt:   timestamp("deleted_at"),
}, (t) => [
  index("idx_stripe_customers_user_id").on(t.userId),
  index("idx_stripe_customers_customer_id").on(t.customerId),
  index("idx_stripe_customers_store_number").on(t.storeNumber),
]);

export type StripeCustomer = typeof stripeCustomers.$inferSelect;
export type InsertStripeCustomer = typeof stripeCustomers.$inferInsert;

// ─── Stripe Subscriptions (low-level Stripe mirror) ──────────────────────────

export const stripeSubscriptions = pgTable("stripe_subscriptions", {
  id:                  serial("id").primaryKey(),
  customerId:          text("customer_id").notNull().unique(),
  subscriptionId:      text("subscription_id"),
  priceId:             text("price_id"),
  currentPeriodStart:  bigint("current_period_start", { mode: "number" }),
  currentPeriodEnd:    bigint("current_period_end", { mode: "number" }),
  cancelAtPeriodEnd:   boolean("cancel_at_period_end").default(false),
  paymentMethodBrand:  text("payment_method_brand"),
  paymentMethodLast4:  text("payment_method_last4"),
  status:              text("status").notNull().default("not_started"),
  createdAt:           timestamp("created_at").defaultNow(),
  updatedAt:           timestamp("updated_at").defaultNow(),
  deletedAt:           timestamp("deleted_at"),
}, (t) => [
  index("idx_stripe_subs_customer_id").on(t.customerId),
  index("idx_stripe_subs_subscription_id").on(t.subscriptionId),
]);

export type StripeSubscription = typeof stripeSubscriptions.$inferSelect;
export type InsertStripeSubscription = typeof stripeSubscriptions.$inferInsert;

// ─── Subscriptions (high-level store <-> plan link) ──────────────────────────

export const subscriptions = pgTable("subscriptions", {
  id:                   serial("id").primaryKey(),
  storeNumber:          integer("store_number").notNull().references(() => locations.id),
  planCode:             text("plan_code").notNull().references(() => billingPlans.code),
  stripeCustomerId:     text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  status:               text("status"),
  currentPeriodEnd:     text("current_period_end"),
  currentPeriodStart:   text("current_period_start"),
  interval:             text("interval").default("month"),
  priceId:              text("price_id"),
  cancelAtPeriodEnd:    integer("cancel_at_period_end").default(0),
  paymentMethodBrand:   text("payment_method_brand"),
  paymentMethodLast4:   text("payment_method_last4"),
  seatQuantity:         integer("seat_quantity").default(1),
  createdAt:            timestamp("created_at").defaultNow(),
  updatedAt:            timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_subscriptions_store_number").on(t.storeNumber),
  index("idx_subscriptions_stripe_sub_id").on(t.stripeSubscriptionId),
]);

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// ─── Stripe Orders (checkout sessions) ──────────────────────────────────────

export const stripeOrders = pgTable("stripe_orders", {
  id:               serial("id").primaryKey(),
  checkoutSessionId: text("checkout_session_id").notNull(),
  paymentIntentId:  text("payment_intent_id").notNull(),
  customerId:       text("customer_id").notNull(),
  amountSubtotal:   bigint("amount_subtotal", { mode: "number" }).notNull(),
  amountTotal:      bigint("amount_total", { mode: "number" }).notNull(),
  currency:         text("currency").notNull(),
  paymentStatus:    text("payment_status").notNull(),
  status:           text("status").notNull().default("pending"),
  createdAt:        timestamp("created_at").defaultNow(),
  updatedAt:        timestamp("updated_at").defaultNow(),
  deletedAt:        timestamp("deleted_at"),
}, (t) => [
  index("idx_stripe_orders_customer_id").on(t.customerId),
  index("idx_stripe_orders_checkout_session").on(t.checkoutSessionId),
]);

export type StripeOrder = typeof stripeOrders.$inferSelect;
export type InsertStripeOrder = typeof stripeOrders.$inferInsert;

// ─── Scheduled Plan Changes ──────────────────────────────────────────────────

export const scheduledPlanChanges = pgTable("scheduled_plan_changes", {
  id:                   serial("id").primaryKey(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  newPlanCode:          text("new_plan_code").notNull().references(() => billingPlans.code),
  interval:             text("interval"),
  effectiveAt:          bigint("effective_at", { mode: "number" }).notNull(),
  status:               text("status").notNull().default("pending"),
  createdAt:            timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_scheduled_plan_changes_sub_id").on(t.stripeSubscriptionId),
]);

export type ScheduledPlanChange = typeof scheduledPlanChanges.$inferSelect;
export type InsertScheduledPlanChange = typeof scheduledPlanChanges.$inferInsert;

// ─── Customer Billing Profiles ───────────────────────────────────────────────

export const customerBillingProfiles = pgTable("customer_billing_profiles", {
  id:                       serial("id").primaryKey(),
  userId:                   text("user_id").notNull().references(() => users.id).unique(),
  salonId:                  integer("salon_id").references(() => locations.id),
  stripeCustomerId:         text("stripe_customer_id").unique(),
  defaultPaymentMethodId:   text("default_payment_method_id"),
  customerEmail:            text("customer_email"),
  customerName:             text("customer_name"),
  billingPhone:             text("billing_phone"),
  billingAddressLine1:      text("billing_address_line1"),
  billingAddressLine2:      text("billing_address_line2"),
  billingCity:              text("billing_city"),
  billingState:             text("billing_state"),
  billingZip:               text("billing_zip"),
  billingCountry:           text("billing_country").default("US"),
  taxExemptStatus:          text("tax_exempt_status").default("none"),
  preferredCurrency:        text("preferred_currency").default("usd"),
  currentPlanId:            integer("current_plan_id").references(() => billingPlans.id),
  currentSubscriptionStatus: text("current_subscription_status").default("none"),
  trialEndsAt:              timestamp("trial_ends_at"),
  currentPeriodStart:       timestamp("current_period_start"),
  currentPeriodEnd:         timestamp("current_period_end"),
  cancelAtPeriodEnd:        boolean("cancel_at_period_end").default(false),
  canceledAt:               timestamp("canceled_at"),
  subscriptionStartedAt:    timestamp("subscription_started_at"),
  lifetimeValueCents:       bigint("lifetime_value_cents", { mode: "number" }).default(0),
  totalSuccessfulPayments:  integer("total_successful_payments").default(0),
  totalFailedPayments:      integer("total_failed_payments").default(0),
  lastPaymentDate:          timestamp("last_payment_date"),
  lastPaymentAmountCents:   bigint("last_payment_amount_cents", { mode: "number" }),
  lastFailedPaymentDate:    timestamp("last_failed_payment_date"),
  lastFailedPaymentReason:  text("last_failed_payment_reason"),
  delinquent:               boolean("delinquent").default(false),
  accountHold:              boolean("account_hold").default(false),
  internalBillingNotes:     text("internal_billing_notes"),
  // ── Account Status ──────────────────────────────────────────────────────────
  // active     → full access
  // suspended  → Stripe subscription kept alive; user sees suspension page
  // locked     → Stripe subscription canceled; user must create new subscription
  accountStatus:            text("account_status").default("active"),
  suspendedAt:              timestamp("suspended_at"),
  lockedAt:                 timestamp("locked_at"),
  suspendedReason:          text("suspended_reason"),
  createdAt:                timestamp("created_at").defaultNow(),
  updatedAt:                timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_cbp_user_id").on(t.userId),
  index("idx_cbp_salon_id").on(t.salonId),
  index("idx_cbp_stripe_customer_id").on(t.stripeCustomerId),
]);

export type CustomerBillingProfile = typeof customerBillingProfiles.$inferSelect;
export type InsertCustomerBillingProfile = typeof customerBillingProfiles.$inferInsert;

// ─── Invoice Records (full local copy) ──────────────────────────────────────

export const invoiceRecords = pgTable("invoice_records", {
  id:                    serial("id").primaryKey(),
  stripeInvoiceId:       text("stripe_invoice_id").notNull().unique(),
  stripeCustomerId:      text("stripe_customer_id"),
  stripeSubscriptionId:  text("stripe_subscription_id"),
  salonId:               integer("salon_id").references(() => locations.id),
  invoiceNumber:         text("invoice_number"),
  status:                text("status"),
  paid:                  boolean("paid").default(false),
  attempted:             boolean("attempted").default(false),
  forgiven:              boolean("forgiven").default(false),
  collectionMethod:      text("collection_method"),
  currency:              text("currency").default("usd"),
  subtotalCents:         bigint("subtotal_cents", { mode: "number" }).default(0),
  taxCents:              bigint("tax_cents", { mode: "number" }).default(0),
  totalCents:            bigint("total_cents", { mode: "number" }).default(0),
  amountPaidCents:       bigint("amount_paid_cents", { mode: "number" }).default(0),
  amountRemainingCents:  bigint("amount_remaining_cents", { mode: "number" }).default(0),
  hostedInvoiceUrl:      text("hosted_invoice_url"),
  invoicePdfUrl:         text("invoice_pdf_url"),
  billingReason:         text("billing_reason"),
  periodStart:           timestamp("period_start"),
  periodEnd:             timestamp("period_end"),
  dueDate:               timestamp("due_date"),
  paidAt:                timestamp("paid_at"),
  attemptedAt:           timestamp("attempted_at"),
  nextPaymentAttempt:    timestamp("next_payment_attempt"),
  createdAt:             timestamp("created_at").defaultNow(),
  updatedAt:             timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_invoice_records_stripe_invoice_id").on(t.stripeInvoiceId),
  index("idx_invoice_records_salon_id").on(t.salonId),
  index("idx_invoice_records_stripe_customer_id").on(t.stripeCustomerId),
]);

export type InvoiceRecord = typeof invoiceRecords.$inferSelect;
export type InsertInvoiceRecord = typeof invoiceRecords.$inferInsert;

// ─── Payment Transactions ────────────────────────────────────────────────────

export const paymentTransactions = pgTable("payment_transactions", {
  id:                       serial("id").primaryKey(),
  stripePaymentIntentId:    text("stripe_payment_intent_id"),
  stripeChargeId:           text("stripe_charge_id").unique(),
  stripeInvoiceId:          text("stripe_invoice_id"),
  salonId:                  integer("salon_id").references(() => locations.id),
  userId:                   text("user_id").references(() => users.id),
  status:                   text("status"),
  paymentMethodBrand:       text("payment_method_brand"),
  paymentMethodLast4:       text("payment_method_last4"),
  paymentMethodFingerprint: text("payment_method_fingerprint"),
  cardExpMonth:             integer("card_exp_month"),
  cardExpYear:              integer("card_exp_year"),
  amountCents:              bigint("amount_cents", { mode: "number" }).default(0),
  currency:                 text("currency").default("usd"),
  failureCode:              text("failure_code"),
  failureMessage:           text("failure_message"),
  receiptUrl:               text("receipt_url"),
  refunded:                 boolean("refunded").default(false),
  refundAmountCents:        bigint("refund_amount_cents", { mode: "number" }).default(0),
  disputeStatus:            text("dispute_status"),
  createdAt:                timestamp("created_at").defaultNow(),
  updatedAt:                timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_payment_txn_salon_id").on(t.salonId),
  index("idx_payment_txn_stripe_charge_id").on(t.stripeChargeId),
  index("idx_payment_txn_stripe_pi_id").on(t.stripePaymentIntentId),
]);

export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = typeof paymentTransactions.$inferInsert;

// ─── Stripe Webhook Events ───────────────────────────────────────────────────

export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id:                  serial("id").primaryKey(),
  stripeEventId:       text("stripe_event_id").notNull().unique(),
  eventType:           text("event_type").notNull(),
  apiVersion:          text("api_version"),
  processed:           boolean("processed").default(false),
  processingAttempts:  integer("processing_attempts").default(0),
  processingError:     text("processing_error"),
  payloadJson:         jsonb("payload_json"),
  receivedAt:          timestamp("received_at").defaultNow(),
  processedAt:         timestamp("processed_at"),
}, (t) => [
  index("idx_stripe_webhook_events_event_id").on(t.stripeEventId),
  index("idx_stripe_webhook_events_type").on(t.eventType),
  index("idx_stripe_webhook_events_processed").on(t.processed),
]);

export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type InsertStripeWebhookEvent = typeof stripeWebhookEvents.$inferInsert;

// ─── Billing Activity Logs ───────────────────────────────────────────────────

export const billingActivityLogs = pgTable("billing_activity_logs", {
  id:           serial("id").primaryKey(),
  salonId:      integer("salon_id").references(() => locations.id),
  userId:       text("user_id").references(() => users.id),
  eventType:    text("event_type").notNull(),
  severity:     text("severity").notNull().default("info"),
  message:      text("message").notNull(),
  metadataJson: jsonb("metadata_json"),
  source:       text("source").default("system"),
  ipAddress:    text("ip_address"),
  createdAt:    timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_billing_activity_salon_id").on(t.salonId),
  index("idx_billing_activity_user_id").on(t.userId),
  index("idx_billing_activity_event_type").on(t.eventType),
  index("idx_billing_activity_created_at").on(t.createdAt),
]);

export type BillingActivityLog = typeof billingActivityLogs.$inferSelect;
export type InsertBillingActivityLog = typeof billingActivityLogs.$inferInsert;

// ─── Refunds ─────────────────────────────────────────────────────────────────

export const refunds = pgTable("refunds", {
  id:                    serial("id").primaryKey(),
  stripeRefundId:        text("stripe_refund_id").unique(),
  stripeChargeId:        text("stripe_charge_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeInvoiceId:       text("stripe_invoice_id"),
  salonId:               integer("salon_id").references(() => locations.id),
  userId:                text("user_id").references(() => users.id),
  initiatedByUserId:     text("initiated_by_user_id").references(() => users.id),
  amountCents:           bigint("amount_cents", { mode: "number" }).notNull(),
  currency:              text("currency").default("usd"),
  reason:                text("reason"),
  internalReasonNotes:   text("internal_reason_notes"),
  refundType:            text("refund_type").default("manual"),
  status:                text("status").notNull().default("pending"),
  receiptUrl:            text("receipt_url"),
  metadataJson:          jsonb("metadata_json"),
  createdAt:             timestamp("created_at").defaultNow(),
  updatedAt:             timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_refunds_salon_id").on(t.salonId),
  index("idx_refunds_stripe_refund_id").on(t.stripeRefundId),
  index("idx_refunds_stripe_charge_id").on(t.stripeChargeId),
]);

export type Refund = typeof refunds.$inferSelect;
export type InsertRefund = typeof refunds.$inferInsert;

// ─── Subscription Plan Changes ───────────────────────────────────────────────

export const subscriptionPlanChanges = pgTable("subscription_plan_changes", {
  id:                   serial("id").primaryKey(),
  salonId:              integer("salon_id").references(() => locations.id),
  userId:               text("user_id").references(() => users.id),
  stripeSubscriptionId: text("stripe_subscription_id"),
  oldPlanId:            integer("old_plan_id").references(() => billingPlans.id),
  newPlanId:            integer("new_plan_id").references(() => billingPlans.id),
  oldPriceCents:        bigint("old_price_cents", { mode: "number" }),
  newPriceCents:        bigint("new_price_cents", { mode: "number" }),
  changeType:           text("change_type"),
  proractionUsed:       boolean("proration_used").default(false),
  proratedAmountCents:  bigint("prorated_amount_cents", { mode: "number" }),
  effectiveDate:        timestamp("effective_date"),
  initiatedBy:          text("initiated_by"),
  reason:               text("reason"),
  metadataJson:         jsonb("metadata_json"),
  createdAt:            timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_sub_plan_changes_salon_id").on(t.salonId),
  index("idx_sub_plan_changes_stripe_sub_id").on(t.stripeSubscriptionId),
]);

export type SubscriptionPlanChange = typeof subscriptionPlanChanges.$inferSelect;
export type InsertSubscriptionPlanChange = typeof subscriptionPlanChanges.$inferInsert;
