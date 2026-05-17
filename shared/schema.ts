import { pgTable, text, serial, integer, boolean, timestamp, decimal, index, uniqueIndex, varchar, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";
import { users, sessions } from "./models/auth";

// Re-export users and sessions for use with db schema
export { users, sessions };

// Re-export client data architecture tables
export {
  clients,
  clientEmails,
  clientPhones,
  clientAddresses,
  clientTags,
  clientTagRelationships,
  clientNotes,
  clientMarketingPreferences,
  clientCustomFields,
  clientCustomFieldValues,
  clientAuditLogs,
  clientExportJobs,
  clientImportJobs,
  insertClientSchema,
  insertClientEmailSchema,
  insertClientPhoneSchema,
  insertClientAddressSchema,
  insertClientTagSchema,
  insertClientNoteSchema,
} from "./schema/clients";
export type {
  Client,
  InsertClient,
  ClientEmail,
  ClientPhone,
  ClientAddress,
  ClientTag,
  ClientTagRelationship,
  ClientNote,
  ClientMarketingPreferences,
  ClientCustomField,
  ClientCustomFieldValue,
  ClientAuditLog,
  ClientExportJob,
  ClientImportJob,
  ClientWithDetails,
} from "./schema/clients";

// Re-export api-keys table so drizzle-kit includes it in db:push
export { apiKeys } from "./schema/api-keys";
export type { ApiKey, InsertApiKey } from "./schema/api-keys";

// Re-export campaigns table so drizzle-kit includes it in db:push
export { campaigns } from "./schema/campaigns";
export type { Campaign, InsertCampaign } from "./schema/campaigns";

// Re-export billing schema tables so callers can import from @shared/schema
export {
  billingPlans,
  stripeCustomers,
  stripeSubscriptions,
  subscriptions,
  stripeOrders,
  scheduledPlanChanges,
  customerBillingProfiles,
  invoiceRecords,
  paymentTransactions,
  stripeWebhookEvents,
  billingActivityLogs,
  refunds,
  subscriptionPlanChanges,
} from "./schema/billing";
export type {
  BillingPlan,
  InsertBillingPlan,
  StripeCustomer,
  InsertStripeCustomer,
  StripeSubscription,
  InsertStripeSubscription,
  Subscription,
  InsertSubscription,
  StripeOrder,
  InsertStripeOrder,
  CustomerBillingProfile,
  InsertCustomerBillingProfile,
  InvoiceRecord,
  InsertInvoiceRecord,
  PaymentTransaction,
  InsertPaymentTransaction,
  StripeWebhookEvent,
  InsertStripeWebhookEvent,
  BillingActivityLog,
  InsertBillingActivityLog,
  Refund,
  InsertRefund,
  SubscriptionPlanChange,
  InsertSubscriptionPlanChange,
} from "./schema/billing";

// === TABLE DEFINITIONS ===

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  category: text("category"),
  city: text("city"),
  state: text("state"),
  postcode: text("postcode"),
  bookingSlug: text("booking_slug").unique(),
  bookingTheme: text("booking_theme").default("simple"),
  commissionPayoutFrequency: text("commission_payout_frequency").default("monthly"),
  smsTokens: integer("sms_tokens").notNull().default(0),
  smsAllowance: integer("sms_allowance").notNull().default(0),
  smsCredits: integer("sms_credits").notNull().default(0),
  smsCreditsTotalPurchased: integer("sms_credits_total_purchased").notNull().default(0),
  userId: text("user_id").references(() => users.id),
  accountStatus: text("account_status").default("Active"),
  storeLatitude: text("store_latitude"),
  storeLongitude: text("store_longitude"),
  yelpAlias: text("yelp_alias"),
  facebookPageId: text("facebook_page_id"),
  lateGracePeriodMinutes: integer("late_grace_period_minutes").notNull().default(10),
  cancellationHoursCutoff: integer("cancellation_hours_cutoff").notNull().default(24),
  posEnabled: boolean("pos_enabled").notNull().default(true),
  // Phase 9.1 — sandbox stores are practice clones. All side-effects
  // (SMS, email, Stripe, webhooks) short-circuit when storeId points here.
  isTrainingSandbox: boolean("is_training_sandbox").notNull().default(false),
  sandboxParentStoreId: integer("sandbox_parent_store_id"),
  weeklyDigestOptOut: boolean("weekly_digest_opt_out").notNull().default(false),
});

export const businessHours = pgTable("business_hours", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  openTime: text("open_time").notNull().default("09:00"),
  closeTime: text("close_time").notNull().default("17:00"),
  isClosed: boolean("is_closed").notNull().default(false),
});

export const serviceCategories = pgTable("service_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  storeId: integer("store_id").references(() => locations.id),
  sortOrder: integer("sort_order").default(0),
});

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  duration: integer("duration").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  category: text("category").notNull(),
  categoryId: integer("category_id").references(() => serviceCategories.id),
  imageUrl: text("image_url"),
  storeId: integer("store_id").references(() => locations.id),
  depositRequired: boolean("deposit_required").default(false),
  depositAmount: decimal("deposit_amount", { precision: 10, scale: 2 }),
});

export const addons = pgTable("addons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  duration: integer("duration").notNull(),
  imageUrl: text("image_url"),
  storeId: integer("store_id").references(() => locations.id),
});

export const serviceAddons = pgTable("service_addons", {
  id: serial("id").primaryKey(),
  serviceId: integer("service_id").references(() => services.id).notNull(),
  addonId: integer("addon_id").references(() => addons.id).notNull(),
});

export const appointmentAddons = pgTable("appointment_addons", {
  id: serial("id").primaryKey(),
  appointmentId: integer("appointment_id").references(() => appointments.id).notNull(),
  addonId: integer("addon_id").references(() => addons.id).notNull(),
});

export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: text("role").default("stylist"),
  bio: text("bio"),
  color: text("color").default("#3b82f6"),
  avatarUrl: text("avatar_url"),
  commissionEnabled: boolean("commission_enabled").default(false),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).default("0"),
  storeId: integer("store_id").references(() => locations.id),
  password: text("password"),
  permissions: jsonb("permissions").$type<Record<string, boolean>>(),
  // Team management additions
  status: text("status").default("active"),           // active | invited | deactivated | removed
  employmentType: text("employment_type").default("stylist"), // stylist | booth_renter | receptionist | assistant | manager | marketer | accountant | owner | custom
  inviteToken: text("invite_token"),
  inviteExpiresAt: timestamp("invite_expires_at"),
  invitedAt: timestamp("invited_at"),
  joinedAt: timestamp("joined_at"),
  removedAt: timestamp("removed_at"),
  invitedByUserId: text("invited_by_user_id"),
});

export const staffServices = pgTable("staff_services", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").references(() => staff.id).notNull(),
  serviceId: integer("service_id").references(() => services.id).notNull(),
});

export const staffAvailability = pgTable("staff_availability", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").references(() => staff.id).notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
});

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  birthday: text("birthday"),
  allergies: text("allergies"),
  marketingOptIn: boolean("marketing_opt_in").default(true),
  loyaltyPoints: integer("loyalty_points").default(0),
  storeId: integer("store_id").references(() => locations.id),
});

export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  date: timestamp("date").notNull(),
  duration: integer("duration").notNull(),
  status: text("status").default("pending"),
  notes: text("notes"),
  cancellationReason: text("cancellation_reason"),
  paymentMethod: text("payment_method"),
  tipAmount: decimal("tip_amount", { precision: 10, scale: 2 }),
  discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }),
  totalPaid: decimal("total_paid", { precision: 10, scale: 2 }),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  serviceId: integer("service_id").references(() => services.id),
  staffId: integer("staff_id").references(() => staff.id),
  customerId: integer("customer_id").references(() => customers.id),
  storeId: integer("store_id").references(() => locations.id),
  recurrenceRule: text("recurrence_rule"),
  recurrenceParentId: integer("recurrence_parent_id"),
  depositRequired: boolean("deposit_required").default(false),
  depositAmount: decimal("deposit_amount", { precision: 10, scale: 2 }),
  depositPaid: boolean("deposit_paid").default(false),
  giftCardId: integer("gift_card_id"),
  giftCardAmount: decimal("gift_card_amount", { precision: 10, scale: 2 }),
  loyaltyPointsEarned: integer("loyalty_points_earned").default(0),
  loyaltyPointsRedeemed: integer("loyalty_points_redeemed").default(0),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  brand: text("brand"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  stock: integer("stock").default(0),
  lowStockThreshold: integer("low_stock_threshold").default(5),
  category: text("category"),
  storeId: integer("store_id").references(() => locations.id),
});

export const cashDrawerSessions = pgTable("cash_drawer_sessions", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  openedAt: timestamp("opened_at").notNull(),
  closedAt: timestamp("closed_at"),
  openingBalance: decimal("opening_balance", { precision: 10, scale: 2 }).notNull().default("0.00"),
  closingBalance: decimal("closing_balance", { precision: 10, scale: 2 }),
  denominationBreakdown: text("denomination_breakdown"),
  openingDenominationBreakdown: text("opening_denomination_breakdown"),
  reportedCardSales: decimal("reported_card_sales", { precision: 10, scale: 2 }),
  priorClosingMismatch: boolean("prior_closing_mismatch").notNull().default(false),
  priorClosingVariance: decimal("prior_closing_variance", { precision: 10, scale: 2 }),
  priorClosingResolvedBy: text("prior_closing_resolved_by"),
  priorClosingResolvedAt: timestamp("prior_closing_resolved_at"),
  priorClosingResolutionNotes: text("prior_closing_resolution_notes"),
  status: text("status").notNull().default("open"),
  openedBy: text("opened_by"),
  closedBy: text("closed_by"),
  notes: text("notes"),
});

export const calendarSettings = pgTable("calendar_settings", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  startOfWeek: text("start_of_week").notNull().default("monday"),
  timeSlotInterval: integer("time_slot_interval").notNull().default(15),
  nonWorkingHoursDisplay: integer("non_working_hours_display").notNull().default(1),
  allowBookingOutsideHours: boolean("allow_booking_outside_hours").notNull().default(true),
  autoCompleteAppointments: boolean("auto_complete_appointments").notNull().default(true),
  autoMarkNoShows: boolean("auto_mark_no_shows").notNull().default(false),
  showPrices: boolean("show_prices").notNull().default(true),
  walkInsEnabled: boolean("walk_ins_enabled").notNull().default(true),
});

export const drawerActions = pgTable("drawer_actions", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => cashDrawerSessions.id).notNull(),
  type: text("type").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }),
  reason: text("reason"),
  performedBy: text("performed_by"),
  performedAt: timestamp("performed_at").notNull(),
});

export const smsSettings = pgTable("sms_settings", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  twilioAccountSid: text("twilio_account_sid"),
  twilioAuthToken: text("twilio_auth_token"),
  twilioPhoneNumber: text("twilio_phone_number"),
  bookingConfirmationEnabled: boolean("booking_confirmation_enabled").notNull().default(false),
  reminderEnabled: boolean("reminder_enabled").notNull().default(false),
  reminderHoursBefore: integer("reminder_hours_before").notNull().default(24),
  reviewRequestEnabled: boolean("review_request_enabled").notNull().default(false),
  googleReviewUrl: text("google_review_url"),
  confirmationTemplate: text("confirmation_template").default("Hi {customerName}, your appointment at {storeName} is confirmed for {appointmentDate} at {appointmentTime}. See you then!"),
  reminderTemplate: text("reminder_template").default("Hi {customerName}, this is a reminder of your appointment at {storeName} tomorrow at {appointmentTime}. Reply STOP to opt out."),
  reviewTemplate: text("review_template").default("Hi {customerName}, thank you for visiting {storeName}! We'd love your feedback. Leave us a review: {reviewUrl}"),
  autoEngageEnabled: boolean("auto_engage_enabled").notNull().default(true),
});

export const smsLog = pgTable("sms_log", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  customerId: integer("customer_id").references(() => customers.id),
  phone: text("phone").notNull(),
  messageType: text("message_type").notNull(),
  messageBody: text("message_body").notNull(),
  status: text("status").notNull().default("pending"),
  twilioSid: text("twilio_sid"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at").notNull(),
  smsSource: text("sms_source"),
  costEstimate: decimal("cost_estimate", { precision: 10, scale: 4 }).default("0.0100"),
});

export const mailSettings = pgTable("mail_settings", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  mailgunApiKey: text("mailgun_api_key"),
  mailgunDomain: text("mailgun_domain"),
  senderEmail: text("sender_email"),
  bookingConfirmationEnabled: boolean("booking_confirmation_enabled").notNull().default(false),
  reminderEnabled: boolean("reminder_enabled").notNull().default(false),
  reminderHoursBefore: integer("reminder_hours_before").notNull().default(24),
  reviewRequestEnabled: boolean("review_request_enabled").notNull().default(false),
  googleReviewUrl: text("google_review_url"),
  confirmationTemplate: text("confirmation_template").default(`<p>Hi {customerName},</p>
<p>Your appointment at {storeName} is confirmed for {appointmentDate} at {appointmentTime}.</p>
<p>See you then!</p>`),
  reminderTemplate: text("reminder_template").default(`<p>Hi {customerName},</p>
<p>This is a reminder of your appointment at {storeName} on {appointmentDate} at {appointmentTime}.</p>
<p>Reply to this email to confirm or cancel.</p>`),
  reviewTemplate: text("review_template").default(`<p>Hi {customerName},</p>
<p>Thank you for visiting {storeName}! We'd love your feedback.</p>
<p><a href="{reviewUrl}">Leave us a review</a></p>`),
});

export const stripeSettings = pgTable("stripe_settings", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  publishableKey: text("publishable_key"),
  secretKey: text("secret_key"),
  testMagstripeEnabled: boolean("test_magstripe_enabled").notNull().default(true),
}, (table) => ({
  storeIdIdx: uniqueIndex("stripe_settings_store_id_uidx").on(table.storeId),
}));



// === PERMISSIONS (from osx) ===

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  description: text("description"),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  storeIdIdx: index("permissions_store_id_idx").on(table.storeId),
}));

// === ROLES (from osx) ===

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  storeIdIdx: index("roles_store_id_idx").on(table.storeId),
  nameStoreIdx: index("roles_name_store_idx").on(table.name, table.storeId),
}));

// === APPS (from osx) ===

export const apps = pgTable("app", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  appName: text("app_name").notNull(),
  active: boolean("active").default(false),
  activeDate: timestamp("active_date"),
  userPin: text("user_pin"),
  permissions: integer("permissions"),
}, (table) => ({
  storeIdIdx: index("app_store_id_idx").on(table.storeId),
  storeAppUnique: index("app_store_app_unique_idx").on(table.storeId, table.appName),
}));

// === STAFF SETTINGS (from osx) ===

export const staffSettings = pgTable("staff_settings", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").references(() => staff.id).notNull(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  preferences: text("preferences").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  staffIdIdx: uniqueIndex("staff_settings_staff_id_uidx").on(table.staffId),
  storeIdIdx: index("staff_settings_store_id_idx").on(table.storeId),
}));

// === STORE SETTINGS (from osx) ===

export const storeSettings = pgTable("store_settings", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  preferences: text("preferences").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  storeIdIdx: uniqueIndex("store_settings_store_id_uidx").on(table.storeId),
}));

// === GOOGLE BUSINESS PROFILE INTEGRATION ===

export const googleBusinessProfiles = pgTable("google_business_profiles", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  googleAccountEmail: text("google_account_email"),
  businessName: text("business_name"),
  businessAccountId: text("business_account_id"),
  businessAccountResourceName: text("business_account_resource_name"),
  locationId: text("location_id"),
  locationResourceName: text("location_resource_name"),
  locationAddress: text("location_address"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  isConnected: boolean("is_connected").default(false),
  syncEnabled: boolean("sync_enabled").default(true),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  storeIdIdx: index("google_business_profiles_store_id_idx").on(table.storeId),
  storeIdUnique: uniqueIndex("google_business_profiles_store_id_uidx").on(table.storeId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE BUSINESS ACCOUNTS
// One row per connected Google Business account per store.
// Owns all OAuth tokens. NEVER mixed with the Google Login system.
// ─────────────────────────────────────────────────────────────────────────────
export const googleBusinessAccounts = pgTable("google_business_accounts", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  googleAccountId: text("google_account_id").notNull(), // resource name e.g. "accounts/123456789"
  accountName: text("account_name"),                    // human-readable name from Google API
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiry: timestamp("token_expiry"),
  scopes: text("scopes"),                               // space-separated granted scopes
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  gbaStoreIdIdx:          index("gba_store_id_idx").on(table.storeId),
  gbaUserIdIdx:           index("gba_user_id_idx").on(table.userId),
  gbaGoogleAccountIdIdx:  index("gba_google_account_id_idx").on(table.googleAccountId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE BUSINESS LOCATIONS
// Individual physical locations per Google Business account.
// Reviews MUST always be tied to a location, never to an account.
// ─────────────────────────────────────────────────────────────────────────────
export const googleBusinessLocations = pgTable("google_business_locations", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  businessAccountId: integer("business_account_id").references(() => googleBusinessAccounts.id).notNull(),
  locationResourceName: text("location_resource_name").notNull(), // full resource e.g. "accounts/123/locations/456"
  locationId: text("location_id").notNull(),                       // extracted leaf ID "456"
  locationName: text("location_name"),                             // human-readable business name
  address: text("address"),
  phone: text("phone"),
  isSelected: boolean("is_selected").default(false),               // only ONE active per storeId
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  gblStoreIdIdx:              index("gbl_store_id_idx").on(table.storeId),
  gblUserIdIdx:               index("gbl_user_id_idx").on(table.userId),
  gblBusinessAccountIdIdx:    index("gbl_business_account_id_idx").on(table.businessAccountId),
  gblLocationResourceNameUdx: uniqueIndex("gbl_location_resource_name_uidx").on(table.locationResourceName),
}));

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE BUSINESS SYNC LOGS
// Tracks every review-sync + location-fetch operation for debugging.
// status: "success" | "failed"   syncType: "reviews" | "locations"
// ─────────────────────────────────────────────────────────────────────────────
export const googleBusinessSyncLogs = pgTable("google_business_sync_logs", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id),
  userId: varchar("user_id").references(() => users.id),
  locationId: integer("location_id").references(() => googleBusinessLocations.id),
  syncType: text("sync_type").notNull(),   // "reviews" | "locations"
  status: text("status").notNull(),         // "success" | "failed"
  errorMessage: text("error_message"),
  reviewsSynced: integer("reviews_synced"),
  syncedAt: timestamp("synced_at").defaultNow(),
}, (table) => ({
  gbslStoreIdIdx:   index("gbsl_store_id_idx").on(table.storeId),
  gbslLocationIdx:  index("gbsl_location_id_idx").on(table.locationId),
  gbslSyncedAtIdx:  index("gbsl_synced_at_idx").on(table.syncedAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE REVIEWS  (now with proper FK to googleBusinessLocations)
// ─────────────────────────────────────────────────────────────────────────────
export const googleReviews = pgTable("google_reviews", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  googleReviewId: text("google_review_id").unique().notNull(),
  googleLocationId: text("google_location_id"),       // legacy plain-text location ID (kept for compat)
  gbLocationId: integer("gb_location_id").references(() => googleBusinessLocations.id), // proper FK
  customerName: text("customer_name"),
  customerPhoneNumber: text("customer_phone_number"),
  rating: integer("rating").notNull(),
  reviewText: text("review_text"),
  reviewImageUrls: text("review_image_urls"), // JSON array stored as text
  reviewCreateTime: timestamp("review_create_time"),
  reviewUpdateTime: timestamp("review_update_time"),
  reviewerLanguageCode: text("reviewer_language_code"),
  reviewPublishingStatus: text("review_publishing_status").default("published"),
  responseStatus: text("response_status").default("not_responded"),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  customerId: integer("customer_id").references(() => customers.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  storeIdIdx: index("google_reviews_store_id_idx").on(table.storeId),
  googleReviewIdIdx: index("google_reviews_google_review_id_idx").on(table.googleReviewId),
  ratingIdx: index("google_reviews_rating_idx").on(table.rating),
  responseStatusIdx: index("google_reviews_response_status_idx").on(table.responseStatus),
}));

export const googleReviewResponses = pgTable("google_review_responses", {
  id: serial("id").primaryKey(),
  googleReviewId: integer("google_review_id").references(() => googleReviews.id).notNull(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  responseText: text("response_text").notNull(),
  responseStatus: text("response_status").notNull(), // "pending", "approved", "rejected"
  staffId: integer("staff_id").references(() => staff.id),
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  googleReviewIdIdx: index("google_review_responses_google_review_id_idx").on(table.googleReviewId),
  storeIdIdx: index("google_review_responses_store_id_idx").on(table.storeId),
  responseStatusIdx: index("google_review_responses_response_status_idx").on(table.responseStatus),
}));

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === WAITLIST ===

export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  serviceId: integer("service_id").references(() => services.id),
  staffId: integer("staff_id").references(() => staff.id),
  customerId: integer("customer_id").references(() => customers.id),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  preferredDate: timestamp("preferred_date"),
  preferredTimeStart: text("preferred_time_start"),
  preferredTimeEnd: text("preferred_time_end"),
  notes: text("notes"),
  partySize: integer("party_size").default(1),
  status: text("status").default("waiting"),
  notifiedAt: timestamp("notified_at"),
  calledAt: timestamp("called_at"),
  completedAt: timestamp("completed_at"),
  customerLatitude: text("customer_latitude"),
  customerLongitude: text("customer_longitude"),
  smsSentAt: timestamp("sms_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === GIFT CARDS ===

export const giftCards = pgTable("gift_cards", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  code: text("code").notNull().unique(),
  originalAmount: decimal("original_amount", { precision: 10, scale: 2 }).notNull(),
  remainingBalance: decimal("remaining_balance", { precision: 10, scale: 2 }).notNull(),
  issuedToName: text("issued_to_name"),
  issuedToEmail: text("issued_to_email"),
  purchasedByCustomerId: integer("purchased_by_customer_id").references(() => customers.id),
  recipientCustomerId: integer("recipient_customer_id").references(() => customers.id),
  isActive: boolean("is_active").default(true),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  notes: text("notes"),
});

export const giftCardTransactions = pgTable("gift_card_transactions", {
  id: serial("id").primaryKey(),
  giftCardId: integer("gift_card_id").references(() => giftCards.id).notNull(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  type: text("type").notNull(),
  balanceAfter: decimal("balance_after", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === INTAKE FORMS ===

export const intakeForms = pgTable("intake_forms", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  requireBeforeBooking: boolean("require_before_booking").default(false),
  serviceId: integer("service_id").references(() => services.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const intakeFormFields = pgTable("intake_form_fields", {
  id: serial("id").primaryKey(),
  formId: integer("form_id").references(() => intakeForms.id).notNull(),
  label: text("label").notNull(),
  fieldType: text("field_type").notNull(),
  options: text("options"),
  required: boolean("required").default(false),
  sortOrder: integer("sort_order").default(0),
});

export const intakeFormResponses = pgTable("intake_form_responses", {
  id: serial("id").primaryKey(),
  formId: integer("form_id").references(() => intakeForms.id).notNull(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  customerId: integer("customer_id").references(() => customers.id),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  customerName: text("customer_name"),
  responses: text("responses").notNull(),
  submittedAt: timestamp("submitted_at").defaultNow(),
});

// === LOYALTY ===

export const loyaltyTransactions = pgTable("loyalty_transactions", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  customerId: integer("customer_id").references(() => customers.id).notNull(),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  type: text("type").notNull(),
  points: integer("points").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// === SMS OPT-OUTS ===

export const smsOptOuts = pgTable("sms_opt_outs", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  optedOutAt: timestamp("opted_out_at").defaultNow(),
  optedBackInAt: timestamp("opted_back_in_at"),
  isOptedOut: boolean("is_opted_out").notNull().default(true),
});

// === PRO HUB TABLES ===

export const proLeads = pgTable("pro_leads", {
  id:           serial("id").primaryKey(),
  name:         varchar("name",          { length: 255 }).notNull(),
  email:        varchar("email",         { length: 255 }).notNull(),
  phone:        varchar("phone",         { length: 50 }),
  businessName: varchar("business_name", { length: 255 }),
  industry:     varchar("industry",      { length: 100 }),
  teamSize:     varchar("team_size",     { length: 50 }),
  message:      text("message"),
  source:       varchar("source",        { length: 100 }).default("pro-hub"),
  createdAt:    timestamp("created_at").defaultNow(),
});

export const insertProLeadSchema = createInsertSchema(proLeads);

// === SEO REGIONAL PAGES ===

export const seoRegions = pgTable("seo_regions", {
  id:            serial("id").primaryKey(),
  city:          varchar("city",           { length: 100 }).notNull(),
  state:         varchar("state",          { length: 100 }).notNull(),
  stateCode:     varchar("state_code",     { length: 10 }).notNull(),
  slug:          varchar("slug",           { length: 200 }).notNull().unique(),
  phone:         varchar("phone",          { length: 30 }),
  zip:           varchar("zip",            { length: 20 }),
  product:       varchar("product",        { length: 20 }).notNull().default("booking"),
  businessType:  varchar("business_type",  { length: 100 }),
  businessTypes: text("business_types"),
  nearbyCities:  text("nearby_cities"),
  metaTitle:     text("meta_title"),
  metaDesc:      text("meta_desc"),
  h1Override:    text("h1_override"),
  pageGenerated: boolean("page_generated").default(false),
  createdAt:     timestamp("created_at").defaultNow(),
  updatedAt:     timestamp("updated_at").defaultNow(),
});

export const insertSeoRegionSchema = createInsertSchema(seoRegions).omit({ id: true, createdAt: true, updatedAt: true, pageGenerated: true });
export type SeoRegion = typeof seoRegions.$inferSelect;
export type InsertSeoRegion = typeof seoRegions.$inferInsert;

// === RELATIONS ===

export const locationsRelations = relations(locations, ({ many }) => ({
  services: many(services),
  staff: many(staff),
  customers: many(customers),
  appointments: many(appointments),
  products: many(products),
  serviceCategories: many(serviceCategories),
  addons: many(addons),
  cashDrawerSessions: many(cashDrawerSessions),
  calendarSettings: many(calendarSettings),
  businessHours: many(businessHours),
  smsSettings: many(smsSettings),
  smsLogs: many(smsLog),
  mailSettings: many(mailSettings),
  permissions: many(permissions),
  roles: many(roles),
  apps: many(apps),
  staffSettings: many(staffSettings),
  storeSettings: many(storeSettings),
  googleBusinessProfiles: many(googleBusinessProfiles),
  googleReviews: many(googleReviews),
  googleReviewResponses: many(googleReviewResponses),
  waitlist: many(waitlist),
  giftCards: many(giftCards),
  intakeForms: many(intakeForms),
  loyaltyTransactions: many(loyaltyTransactions),
}));

export const smsSettingsRelations = relations(smsSettings, ({ one }) => ({
  store: one(locations, { fields: [smsSettings.storeId], references: [locations.id] }),
}));

export const mailSettingsRelations = relations(mailSettings, ({ one }) => ({
  store: one(locations, { fields: [mailSettings.storeId], references: [locations.id] }),
}));

export const smsLogRelations = relations(smsLog, ({ one }) => ({
  store: one(locations, { fields: [smsLog.storeId], references: [locations.id] }),
  appointment: one(appointments, { fields: [smsLog.appointmentId], references: [appointments.id] }),
  customer: one(customers, { fields: [smsLog.customerId], references: [customers.id] }),
}));

export const businessHoursRelations = relations(businessHours, ({ one }) => ({
  store: one(locations, { fields: [businessHours.storeId], references: [locations.id] }),
}));

export const calendarSettingsRelations = relations(calendarSettings, ({ one }) => ({
  store: one(locations, { fields: [calendarSettings.storeId], references: [locations.id] }),
}));

export const cashDrawerSessionsRelations = relations(cashDrawerSessions, ({ one, many }) => ({
  store: one(locations, { fields: [cashDrawerSessions.storeId], references: [locations.id] }),
  actions: many(drawerActions),
}));

export const drawerActionsRelations = relations(drawerActions, ({ one }) => ({
  session: one(cashDrawerSessions, { fields: [drawerActions.sessionId], references: [cashDrawerSessions.id] }),
}));

export const serviceCategoriesRelations = relations(serviceCategories, ({ one, many }) => ({
  store: one(locations, { fields: [serviceCategories.storeId], references: [locations.id] }),
  services: many(services),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  store: one(locations, { fields: [services.storeId], references: [locations.id] }),
  serviceCategory: one(serviceCategories, { fields: [services.categoryId], references: [serviceCategories.id] }),
  serviceAddons: many(serviceAddons),
  staffServices: many(staffServices),
}));

export const addonsRelations = relations(addons, ({ one, many }) => ({
  store: one(locations, { fields: [addons.storeId], references: [locations.id] }),
  serviceAddons: many(serviceAddons),
  appointmentAddons: many(appointmentAddons),
}));

export const serviceAddonsRelations = relations(serviceAddons, ({ one }) => ({
  service: one(services, { fields: [serviceAddons.serviceId], references: [services.id] }),
  addon: one(addons, { fields: [serviceAddons.addonId], references: [addons.id] }),
}));

export const appointmentAddonsRelations = relations(appointmentAddons, ({ one }) => ({
  appointment: one(appointments, { fields: [appointmentAddons.appointmentId], references: [appointments.id] }),
  addon: one(addons, { fields: [appointmentAddons.addonId], references: [addons.id] }),
}));

export const staffRelations = relations(staff, ({ one, many }) => ({
  store: one(locations, { fields: [staff.storeId], references: [locations.id] }),
  staffServices: many(staffServices),
  availability: many(staffAvailability),
  staffSettings: one(staffSettings),
}));

export const staffAvailabilityRelations = relations(staffAvailability, ({ one }) => ({
  staff: one(staff, { fields: [staffAvailability.staffId], references: [staff.id] }),
}));

export const staffServicesRelations = relations(staffServices, ({ one }) => ({
  staff: one(staff, { fields: [staffServices.staffId], references: [staff.id] }),
  service: one(services, { fields: [staffServices.serviceId], references: [services.id] }),
}));

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  service: one(services, {
    fields: [appointments.serviceId],
    references: [services.id],
  }),
  staff: one(staff, {
    fields: [appointments.staffId],
    references: [staff.id],
  }),
  customer: one(customers, {
    fields: [appointments.customerId],
    references: [customers.id],
  }),
  store: one(locations, {
    fields: [appointments.storeId],
    references: [locations.id],
  }),
  appointmentAddons: many(appointmentAddons),
}));

export const permissionsRelations = relations(permissions, ({ one }) => ({
  store: one(locations, { fields: [permissions.storeId], references: [locations.id] }),
}));

export const rolesRelations = relations(roles, ({ one }) => ({
  store: one(locations, { fields: [roles.storeId], references: [locations.id] }),
}));

export const appsRelations = relations(apps, ({ one }) => ({
  store: one(locations, { fields: [apps.storeId], references: [locations.id] }),
}));

export const staffSettingsRelations = relations(staffSettings, ({ one }) => ({
  staff: one(staff, { fields: [staffSettings.staffId], references: [staff.id] }),
  store: one(locations, { fields: [staffSettings.storeId], references: [locations.id] }),
}));

export const storeSettingsRelations = relations(storeSettings, ({ one }) => ({
  store: one(locations, { fields: [storeSettings.storeId], references: [locations.id] }),
}));

export const googleBusinessProfilesRelations = relations(googleBusinessProfiles, ({ one, many }) => ({
  store: one(locations, { fields: [googleBusinessProfiles.storeId], references: [locations.id] }),
  reviews: many(googleReviews),
}));

export const googleBusinessAccountsRelations = relations(googleBusinessAccounts, ({ one, many }) => ({
  store: one(locations, { fields: [googleBusinessAccounts.storeId], references: [locations.id] }),
  locations: many(googleBusinessLocations),
  syncLogs: many(googleBusinessSyncLogs),
}));

export const googleBusinessLocationsRelations = relations(googleBusinessLocations, ({ one, many }) => ({
  store: one(locations, { fields: [googleBusinessLocations.storeId], references: [locations.id] }),
  businessAccount: one(googleBusinessAccounts, {
    fields: [googleBusinessLocations.businessAccountId],
    references: [googleBusinessAccounts.id],
  }),
  reviews: many(googleReviews),
  syncLogs: many(googleBusinessSyncLogs),
}));

export const googleBusinessSyncLogsRelations = relations(googleBusinessSyncLogs, ({ one }) => ({
  store: one(locations, { fields: [googleBusinessSyncLogs.storeId], references: [locations.id] }),
  location: one(googleBusinessLocations, {
    fields: [googleBusinessSyncLogs.locationId],
    references: [googleBusinessLocations.id],
  }),
}));

export const googleReviewsRelations = relations(googleReviews, ({ one, many }) => ({
  store: one(locations, { fields: [googleReviews.storeId], references: [locations.id] }),
  gbLocation: one(googleBusinessLocations, {
    fields: [googleReviews.gbLocationId],
    references: [googleBusinessLocations.id],
  }),
  appointment: one(appointments, {
    fields: [googleReviews.appointmentId],
    references: [appointments.id],
  }),
  customer: one(customers, { fields: [googleReviews.customerId], references: [customers.id] }),
  responses: many(googleReviewResponses),
}));

export const googleReviewResponsesRelations = relations(googleReviewResponses, ({ one }) => ({
  review: one(googleReviews, {
    fields: [googleReviewResponses.googleReviewId],
    references: [googleReviews.id],
  }),
  store: one(locations, { fields: [googleReviewResponses.storeId], references: [locations.id] }),
  staff: one(staff, { fields: [googleReviewResponses.staffId], references: [staff.id] }),
}));

// === SCHEMAS ===

export const insertLocationSchema = createInsertSchema(locations).omit({ id: true });
export const insertServiceCategorySchema = createInsertSchema(serviceCategories).omit({ id: true });
export const insertServiceSchema = createInsertSchema(services).omit({ id: true });
export const insertAddonSchema = createInsertSchema(addons).omit({ id: true });
export const insertServiceAddonSchema = createInsertSchema(serviceAddons).omit({ id: true });
export const insertAppointmentAddonSchema = createInsertSchema(appointmentAddons).omit({ id: true });
export const insertStaffSchema = createInsertSchema(staff).omit({ id: true });
export const insertStaffServiceSchema = createInsertSchema(staffServices).omit({ id: true });
export const insertStaffAvailabilitySchema = createInsertSchema(staffAvailability).omit({ id: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true });
export const insertAppointmentSchema = createInsertSchema(appointments).omit({ id: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertBusinessHoursSchema = createInsertSchema(businessHours).omit({ id: true });
export const insertCalendarSettingsSchema = createInsertSchema(calendarSettings).omit({ id: true });
export const insertCashDrawerSessionSchema = createInsertSchema(cashDrawerSessions).omit({ id: true });
export const insertDrawerActionSchema = createInsertSchema(drawerActions).omit({ id: true });
export const insertSmsSettingsSchema = createInsertSchema(smsSettings).omit({ id: true });
export const insertSmsLogSchema = createInsertSchema(smsLog).omit({ id: true });
export const insertMailSettingsSchema = createInsertSchema(mailSettings).omit({ id: true });
export const insertStripeSettingsSchema = createInsertSchema(stripeSettings).omit({ id: true });

export const insertPermissionsSchema = createInsertSchema(permissions).omit({ id: true });
export const insertRolesSchema = createInsertSchema(roles).omit({ id: true });
export const insertAppsSchema = createInsertSchema(apps).omit({ id: true });
export const insertStaffSettingsSchema = createInsertSchema(staffSettings).omit({ id: true });
export const insertStoreSettingsSchema = createInsertSchema(storeSettings).omit({ id: true });

export const insertGoogleBusinessProfileSchema = createInsertSchema(googleBusinessProfiles).omit({ id: true });
export const insertGoogleBusinessAccountSchema = createInsertSchema(googleBusinessAccounts).omit({ id: true });
export const insertGoogleBusinessLocationSchema = createInsertSchema(googleBusinessLocations).omit({ id: true });
export const insertGoogleBusinessSyncLogSchema = createInsertSchema(googleBusinessSyncLogs).omit({ id: true });
export const insertGoogleReviewSchema = createInsertSchema(googleReviews).omit({ id: true });
export const insertGoogleReviewResponseSchema = createInsertSchema(googleReviewResponses).omit({ id: true });

// === EXPLICIT API TYPES ===

export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;

// Backwards compatibility aliases
export type Store = Location;
export type InsertStore = InsertLocation;

export type ServiceCategory = typeof serviceCategories.$inferSelect;
export type InsertServiceCategory = z.infer<typeof insertServiceCategorySchema>;

export type Service = typeof services.$inferSelect;
export type InsertService = z.infer<typeof insertServiceSchema>;

export type Addon = typeof addons.$inferSelect;
export type InsertAddon = z.infer<typeof insertAddonSchema>;

export type ServiceAddon = typeof serviceAddons.$inferSelect;
export type InsertServiceAddon = z.infer<typeof insertServiceAddonSchema>;

export type AppointmentAddon = typeof appointmentAddons.$inferSelect;
export type InsertAppointmentAddon = z.infer<typeof insertAppointmentAddonSchema>;

export type Staff = typeof staff.$inferSelect;
export type InsertStaff = z.infer<typeof insertStaffSchema>;

export type StaffService = typeof staffServices.$inferSelect;
export type InsertStaffService = z.infer<typeof insertStaffServiceSchema>;

export type StaffAvailability = typeof staffAvailability.$inferSelect;
export type InsertStaffAvailability = z.infer<typeof insertStaffAvailabilitySchema>;

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;

export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;

export type AppointmentWithDetails = Appointment & {
  service: Service | null;
  staff: Staff | null;
  customer: Customer | null;
  store: Store | null;
  appointmentAddons?: Array<AppointmentAddon & { addon: Addon | null }>;
};

export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;

export type BusinessHours = typeof businessHours.$inferSelect;
export type InsertBusinessHours = z.infer<typeof insertBusinessHoursSchema>;

export type CalendarSettings = typeof calendarSettings.$inferSelect;
export type InsertCalendarSettings = z.infer<typeof insertCalendarSettingsSchema>;

export type CashDrawerSession = typeof cashDrawerSessions.$inferSelect;
export type InsertCashDrawerSession = z.infer<typeof insertCashDrawerSessionSchema>;

export type DrawerAction = typeof drawerActions.$inferSelect;
export type InsertDrawerAction = z.infer<typeof insertDrawerActionSchema>;

export type SmsSettings = typeof smsSettings.$inferSelect;
export type InsertSmsSettings = z.infer<typeof insertSmsSettingsSchema>;

export type SmsLogEntry = typeof smsLog.$inferSelect;
export type InsertSmsLog = z.infer<typeof insertSmsLogSchema>;

export type MailSettings = typeof mailSettings.$inferSelect;
export type InsertMailSettings = z.infer<typeof insertMailSettingsSchema>;

export type StripeSettings = typeof stripeSettings.$inferSelect;
export type InsertStripeSettings = z.infer<typeof insertStripeSettingsSchema>;

export type Permissions = typeof permissions.$inferSelect;
export type InsertPermissions = z.infer<typeof insertPermissionsSchema>;

export type Roles = typeof roles.$inferSelect;
export type InsertRoles = z.infer<typeof insertRolesSchema>;

export type Apps = typeof apps.$inferSelect;
export type InsertApps = z.infer<typeof insertAppsSchema>;

export type StaffSettings = typeof staffSettings.$inferSelect;
export type InsertStaffSettings = z.infer<typeof insertStaffSettingsSchema>;

export type StoreSettings = typeof storeSettings.$inferSelect;
export type InsertStoreSettings = z.infer<typeof insertStoreSettingsSchema>;

export type GoogleBusinessProfile = typeof googleBusinessProfiles.$inferSelect;
export type InsertGoogleBusinessProfile = z.infer<typeof insertGoogleBusinessProfileSchema>;

export type GoogleBusinessAccount = typeof googleBusinessAccounts.$inferSelect;
export type InsertGoogleBusinessAccount = z.infer<typeof insertGoogleBusinessAccountSchema>;

export type GoogleBusinessLocation = typeof googleBusinessLocations.$inferSelect;
export type InsertGoogleBusinessLocation = z.infer<typeof insertGoogleBusinessLocationSchema>;

export type GoogleBusinessSyncLog = typeof googleBusinessSyncLogs.$inferSelect;
export type InsertGoogleBusinessSyncLog = z.infer<typeof insertGoogleBusinessSyncLogSchema>;

export type GoogleReview = typeof googleReviews.$inferSelect;
export type InsertGoogleReview = z.infer<typeof insertGoogleReviewSchema>;

export type GoogleReviewResponse = typeof googleReviewResponses.$inferSelect;
export type InsertGoogleReviewResponse = z.infer<typeof insertGoogleReviewResponseSchema>;

export type CashDrawerSessionWithActions = CashDrawerSession & {
  actions: DrawerAction[];
};

// === REVIEWS TABLE ===

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  customerId: integer("customer_id").references(() => customers.id),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  staffId: integer("staff_id").references(() => staff.id),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  customerName: text("customer_name"),
  serviceName: text("service_name"),
  staffName: text("staff_name"),
  isPublic: boolean("is_public").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// === CERTXA PRO — FIELD SERVICE TABLES ===

export const crews = pgTable("pro_crews", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#00D4AA"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  phone: text("phone"),
  pinHash: text("pin_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const crewLocations = pgTable("pro_crew_locations", {
  id: serial("id").primaryKey(),
  crewId: integer("crew_id").references(() => crews.id).notNull(),
  lat: decimal("lat", { precision: 10, scale: 7 }).notNull(),
  lng: decimal("lng", { precision: 10, scale: 7 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const serviceOrders = pgTable("pro_service_orders", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  orderNumber: text("order_number").notNull(),
  status: text("status").notNull().default("new"),
  priority: text("priority").notNull().default("normal"),
  serviceType: text("service_type").notNull(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  address: text("address").notNull(),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  lat: decimal("lat", { precision: 10, scale: 7 }),
  lng: decimal("lng", { precision: 10, scale: 7 }),
  description: text("description"),
  crewId: integer("crew_id").references(() => crews.id),
  scheduledAt: timestamp("scheduled_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  estimatedHours: decimal("estimated_hours", { precision: 4, scale: 1 }),
  overtimeFlagged: boolean("overtime_flagged").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const orderNotes = pgTable("pro_order_notes", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => serviceOrders.id).notNull(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  note: text("note").notNull(),
  authorName: text("author_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const proCustomers = pgTable("pro_customers", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  propertyType: text("property_type").default("residential"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const proEstimates = pgTable("pro_estimates", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  estimateNumber: text("estimate_number").notNull(),
  status: text("status").notNull().default("draft"),
  customerId: integer("customer_id").references(() => proCustomers.id),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  serviceType: text("service_type"),
  description: text("description"),
  lineItems: text("line_items"),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).default("0"),
  convertedToOrderId: integer("converted_to_order_id"),
  validUntil: timestamp("valid_until"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const proInvoices = pgTable("pro_invoices", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  orderId: integer("order_id").references(() => serviceOrders.id),
  invoiceNumber: text("invoice_number").notNull(),
  status: text("status").notNull().default("draft"),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  address: text("address"),
  lineItems: text("line_items"),
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).default("0"),
  paidAt: timestamp("paid_at"),
  dueAt: timestamp("due_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCrewSchema = createInsertSchema(crews).omit({ id: true, createdAt: true });
export const insertServiceOrderSchema = createInsertSchema(serviceOrders).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOrderNoteSchema = createInsertSchema(orderNotes).omit({ id: true, createdAt: true });

export const insertProCustomerSchema = createInsertSchema(proCustomers).omit({ id: true, createdAt: true });
export const insertProEstimateSchema = createInsertSchema(proEstimates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProInvoiceSchema = createInsertSchema(proInvoices).omit({ id: true, createdAt: true, updatedAt: true });

export type Crew = typeof crews.$inferSelect;
export type InsertCrew = z.infer<typeof insertCrewSchema>;
export type ServiceOrder = typeof serviceOrders.$inferSelect;
export type InsertServiceOrder = z.infer<typeof insertServiceOrderSchema>;
export type OrderNote = typeof orderNotes.$inferSelect;
export type InsertOrderNote = z.infer<typeof insertOrderNoteSchema>;
export type CrewLocation = typeof crewLocations.$inferSelect;
export type ProCustomer = typeof proCustomers.$inferSelect;
export type InsertProCustomer = z.infer<typeof insertProCustomerSchema>;
export type ProEstimate = typeof proEstimates.$inferSelect;
export type InsertProEstimate = z.infer<typeof insertProEstimateSchema>;
export type ProInvoice = typeof proInvoices.$inferSelect;
export type InsertProInvoice = z.infer<typeof insertProInvoiceSchema>;

// === NEW FEATURE SCHEMAS ===

export const insertWaitlistSchema = createInsertSchema(waitlist).omit({ id: true });
export const insertGiftCardSchema = createInsertSchema(giftCards).omit({ id: true });
export const insertGiftCardTransactionSchema = createInsertSchema(giftCardTransactions).omit({ id: true });
export const insertIntakeFormSchema = createInsertSchema(intakeForms).omit({ id: true });
export const insertIntakeFormFieldSchema = createInsertSchema(intakeFormFields).omit({ id: true });
export const insertIntakeFormResponseSchema = createInsertSchema(intakeFormResponses).omit({ id: true });
export const insertLoyaltyTransactionSchema = createInsertSchema(loyaltyTransactions).omit({ id: true });

export type WaitlistEntry = typeof waitlist.$inferSelect;
export type InsertWaitlistEntry = z.infer<typeof insertWaitlistSchema>;

export type GiftCard = typeof giftCards.$inferSelect;
export type InsertGiftCard = z.infer<typeof insertGiftCardSchema>;

export type GiftCardTransaction = typeof giftCardTransactions.$inferSelect;
export type InsertGiftCardTransaction = z.infer<typeof insertGiftCardTransactionSchema>;

export type IntakeForm = typeof intakeForms.$inferSelect;
export type InsertIntakeForm = z.infer<typeof insertIntakeFormSchema>;

export type IntakeFormField = typeof intakeFormFields.$inferSelect;
export type InsertIntakeFormField = z.infer<typeof insertIntakeFormFieldSchema>;

export type IntakeFormResponse = typeof intakeFormResponses.$inferSelect;
export type InsertIntakeFormResponse = z.infer<typeof insertIntakeFormResponseSchema>;

export type LoyaltyTransaction = typeof loyaltyTransactions.$inferSelect;
export type InsertLoyaltyTransaction = z.infer<typeof insertLoyaltyTransactionSchema>;

export const insertReviewSchema = createInsertSchema(reviews).omit({ id: true, createdAt: true });
export type Review = typeof reviews.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;

// === TRAINING SYSTEM (Staff Training Tool) ===
// See docs/STAFF_TRAINING_TOOL_PLAN.md and docs/STAFF_TRAINING_DEVELOPMENT_PLAN.md

export const trainingActionCategories = pgTable("training_action_categories", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  defaultHelpLevel: integer("default_help_level").notNull().default(3),
  highRisk: boolean("high_risk").notNull().default(false),
});

export const trainingActionSteps = pgTable("training_action_steps", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").references(() => trainingActionCategories.id, { onDelete: "cascade" }).notNull(),
  order: integer("order").notNull().default(0),
  stepJson: jsonb("step_json").notNull(),
}, (t) => [index("idx_training_steps_category").on(t.categoryId)]);

export const trainingUserState = pgTable("training_user_state", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  categoryId: integer("category_id").references(() => trainingActionCategories.id, { onDelete: "cascade" }).notNull(),
  helpLevel: integer("help_level").notNull().default(3),
  successStreak: integer("success_streak").notNull().default(0),
  failures: integer("failures").notNull().default(0),
  totalAttempts: integer("total_attempts").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at"),
  graduatedAt: timestamp("graduated_at"),
  pinnedLevel: integer("pinned_level"),
}, (t) => [
  uniqueIndex("uniq_training_user_category").on(t.userId, t.categoryId),
  index("idx_training_state_user").on(t.userId),
]);

export const trainingEvents = pgTable("training_events", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  categoryId: integer("category_id").references(() => trainingActionCategories.id, { onDelete: "cascade" }).notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  helpLevelAtTime: integer("help_level_at_time").notNull(),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  metadata: jsonb("metadata"),
}, (t) => [
  index("idx_training_events_user_cat").on(t.userId, t.categoryId),
  index("idx_training_events_occurred").on(t.occurredAt),
]);

export const trainingUserProfile = pgTable("training_user_profile", {
  userId: varchar("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  enrolledAt: timestamp("enrolled_at").notNull().defaultNow(),
  graduatedAt: timestamp("graduated_at"),
  graduationNotifiedOwner: boolean("graduation_notified_owner").notNull().default(false),
  graduationStaffNotified: boolean("graduation_staff_notified").notNull().default(false),
  day7DigestSentAt: timestamp("day7_digest_sent_at"),
});

export const trainingSettings = pgTable("training_settings", {
  storeId: integer("store_id").primaryKey().references(() => locations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  autoEnrollNewStaff: boolean("auto_enroll_new_staff").notNull().default(true),
  graduationMinDays: integer("graduation_min_days").notNull().default(7),
  showHelpBubbleAfterGraduation: boolean("show_help_bubble_after_graduation").notNull().default(true),
});

export type TrainingActionCategory = typeof trainingActionCategories.$inferSelect;
export type InsertTrainingActionCategory = typeof trainingActionCategories.$inferInsert;
export type TrainingActionStep = typeof trainingActionSteps.$inferSelect;
export type InsertTrainingActionStep = typeof trainingActionSteps.$inferInsert;
export type TrainingUserState = typeof trainingUserState.$inferSelect;
export type InsertTrainingUserState = typeof trainingUserState.$inferInsert;
export type TrainingEvent = typeof trainingEvents.$inferSelect;
export type InsertTrainingEvent = typeof trainingEvents.$inferInsert;
export type TrainingUserProfile = typeof trainingUserProfile.$inferSelect;
export type InsertTrainingUserProfile = typeof trainingUserProfile.$inferInsert;
export type TrainingSettings = typeof trainingSettings.$inferSelect;
export type InsertTrainingSettings = typeof trainingSettings.$inferInsert;

export const names = pgTable("names", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  origin: varchar("origin", { length: 32 }).notNull(),
  gender: varchar("gender", { length: 16 }).notNull().default("female"),
}, (t) => [
  index("idx_names_origin").on(t.origin),
  uniqueIndex("idx_names_name_origin_unique").on(t.name, t.origin),
]);

export type Name = typeof names.$inferSelect;
export type InsertName = typeof names.$inferInsert;

// === LAUNCHSITE TABLES (PHP/marketing site) ===

export const onboardingSubmissions = pgTable("onboarding_submissions", {
  id: serial("id").primaryKey(),
  // Legacy column — kept for backward compat; new rows use contact_email
  email: text("email"),
  contactEmail: text("contact_email"),
  businessName: text("business_name"),
  templateId: text("template_id"),
  phone: text("phone"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  countyState: text("county_state"),
  postcode: text("postcode"),
  country: text("country").default("GB"),
  hours: jsonb("hours"),
  bookingEnabled: boolean("booking_enabled").default(false),
  domainType: text("domain_type").default("subdomain"), // 'subdomain' | 'custom'
  subdomain: text("subdomain"),
  customDomain: text("custom_domain"),
  domainPaymentStatus: text("domain_payment_status").default("n/a"),
  heroImage: text("hero_image"),
  plan: text("plan").default("free"),
  poweredByCertxa: boolean("powered_by_certxa").default(true),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const subdomains = pgTable("subdomains", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id").references(() => onboardingSubmissions.id),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type OnboardingSubmission = typeof onboardingSubmissions.$inferSelect;
export type InsertOnboardingSubmission = typeof onboardingSubmissions.$inferInsert;
export type Subdomain = typeof subdomains.$inferSelect;
export type InsertSubdomain = typeof subdomains.$inferInsert;

// ─── Two-Way SMS Inbox ────────────────────────────────────────────────────────

export const smsConversations = pgTable("sms_conversations", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").references(() => locations.id).notNull(),
  clientPhone: text("client_phone").notNull(),
  clientName: text("client_name"),
  direction: text("direction").notNull(), // "inbound" | "outbound"
  body: text("body").notNull(),
  twilioSid: text("twilio_sid"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("sms_conv_store_phone_idx").on(t.storeId, t.clientPhone),
  index("sms_conv_store_created_idx").on(t.storeId, t.createdAt),
]);

export type SmsConversation = typeof smsConversations.$inferSelect;
export type InsertSmsConversation = typeof smsConversations.$inferInsert;

// ── Revenue Intelligence Engine ──────────────────────────────────────────────
export {
  clientIntelligence,
  staffIntelligence,
  intelligenceInterventions,
  growthScoreSnapshots,
  deadSeatPatterns,
} from "./schema/intelligence";
export type {
  ClientIntelligence,
  StaffIntelligence,
  IntelligenceIntervention,
  GrowthScoreSnapshot,
  DeadSeatPattern,
} from "./schema/intelligence";

// ── LaunchSite Template Catalog ───────────────────────────────────────────────
export const launchsiteTemplates = pgTable("launchsite_templates", {
  id:           text("id").primaryKey(),
  name:         text("name").notNull(),
  category:     text("category").notNull(),
  style:        text("style").notNull().default("Modern"),
  desc:         text("desc").notNull().default(""),
  badge:        text("badge").notNull().default(""),
  features:     jsonb("features").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  accent:       text("accent").notNull().default("#a855f7"),
  dark:         text("dark").notNull().default("#0a0b15"),
  light:        text("light").notNull().default("#1c1d27"),
  urlSlug:      text("url_slug").notNull(),
  heroTagline:  text("hero_tagline").notNull().default(""),
  heroSub:      text("hero_sub").notNull().default(""),
  businessName: text("business_name").notNull().default(""),
  type:         text("type").notNull().default("php"),
  reactPath:    text("react_path"),
  scrapedPath:  text("scraped_path"),
  sourceUrl:    text("source_url"),
  sortOrder:    integer("sort_order").notNull().default(0),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
});

export type LaunchsiteTemplate = typeof launchsiteTemplates.$inferSelect;
export type InsertLaunchsiteTemplate = typeof launchsiteTemplates.$inferInsert;
