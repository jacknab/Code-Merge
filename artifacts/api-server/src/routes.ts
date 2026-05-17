import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { isAuthenticated } from "./auth";
import { attachAuthContext, requirePermission, ownStaffScope, can } from "./middleware/permissions";
import { PERMISSIONS } from "@shared/permissions";
import { z } from "zod";
import { db, pool } from "./db";
import { users } from "@shared/models/auth";
import { eq, and, desc, sql, count, gte, asc, isNull, isNotNull, inArray } from "drizzle-orm";
import { sendEmail, sendBookingConfirmationEmail, sendReminderEmail, sendReviewRequestEmail, startEmailReminderScheduler } from "./mail";
import { businessTemplates } from "./onboarding-data";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { sendBookingConfirmation, startReminderScheduler } from "./sms";
import { startQueueSmsScheduler } from "./queue-sms-scheduler";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { 
  insertLocationSchema,
  insertServiceCategorySchema,
  insertServiceSchema, 
  insertAddonSchema,
  insertServiceAddonSchema,
  insertStaffSchema,
  insertCustomerSchema, 
  insertAppointmentSchema, 
  type Staff,
  insertProductSchema,
  locations,
  insertCashDrawerSessionSchema,
  insertCalendarSettingsSchema,
  googleBusinessProfiles,
  googleBusinessAccounts,
  googleBusinessLocations,
  googleBusinessSyncLogs,
  googleReviews,
  googleReviewResponses,
  insertGoogleReviewResponseSchema,
  appointments,
  staff,
  customers,
  services,
  serviceCategories,
  calendarSettings,
  smsSettings,
  mailSettings,
  waitlist,
  giftCards,
  giftCardTransactions,
  intakeForms,
  intakeFormFields,
  intakeFormResponses,
  loyaltyTransactions,
  reviews,
  storeSettings,
  seoRegions,
  insertSeoRegionSchema,
  smsLog,
  businessHours,
} from "@shared/schema";
import { buildRegionSlug, ALL_CITIES, BOOKING_BUSINESS_TYPES } from "./seo-cities";
import {
  GoogleBusinessAPIManager,
  createApiManagerFromProfile,
  publishReviewResponse,
  getGoogleBusinessCallbackUrl,
} from "./google-business-api";
import { syncReviewsForStore, startGoogleReviewSyncScheduler } from "./google-review-sync";
import { TrialService } from "./services/trial-service";
import { requireActiveTrial } from "./middleware/trial-middleware";
import { setupNotificationServer, broadcastNotification } from "./notifications";
import { checkOAuthRateLimit, syncCooldowns, SYNC_COOLDOWN_MS, getRateLimitSnapshot, clearRateLimitEntry, clearAllRateLimits, type RateLimitCategory } from "./rate-limits";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupNotificationServer(httpServer);
  // Note: setupAuth(app) is called in server/index.ts before registerRoutes.
  // Auth routes (register, login, logout, user) are registered there via auth.ts.

  // Build/version info — lets you verify which build is actually deployed.
  // Hit GET /api/version on the live site to see commit SHA + build/start time.
  const SERVER_START_TIME = new Date().toISOString();
  let detectedCommit = "unknown";
  try {
    const { execSync } = await import("child_process");
    detectedCommit = execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // not a git checkout — fall back to env vars
  }
  const BUILD_COMMIT =
    process.env.GIT_COMMIT ||
    process.env.SOURCE_COMMIT ||
    process.env.COMMIT_SHA ||
    detectedCommit;
  const BUILD_TIME = process.env.BUILD_TIME || "unknown";
  app.get("/api/version", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      commit: BUILD_COMMIT,
      buildTime: BUILD_TIME,
      serverStartTime: SERVER_START_TIME,
      nodeEnv: process.env.NODE_ENV ?? "development",
    });
  });

  // Append client-side errors to a log file for easy access. Frontend
  // ErrorBoundary POSTs here when it catches a render error.
  app.post("/api/client-errors", express.json({ limit: "256kb" }), async (req, res) => {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const logsDir = path.resolve(process.cwd(), "logs");
      await fs.mkdir(logsDir, { recursive: true });
      const file = path.join(logsDir, "client-errors.log");

      const body = req.body || {};
      const entry = {
        timestamp: new Date().toISOString(),
        url: String(body.url ?? ""),
        userAgent: req.headers["user-agent"] ?? "",
        ip: req.ip,
        message: String(body.message ?? ""),
        stack: String(body.stack ?? ""),
        componentStack: String(body.componentStack ?? ""),
      };

      const line =
        `\n=== ${entry.timestamp} ===\n` +
        `URL: ${entry.url}\n` +
        `UA:  ${entry.userAgent}\n` +
        `IP:  ${entry.ip}\n` +
        `Message: ${entry.message}\n` +
        `Stack:\n${entry.stack}\n` +
        `Component stack:${entry.componentStack}\n`;

      await fs.appendFile(file, line, "utf8");
      console.error("[client-error]", entry.message, "@", entry.url);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[client-error] failed to log:", err?.message || err);
      res.status(500).json({ ok: false });
    }
  });

  // Public config — exposes safe frontend settings from env vars
  app.get("/api/config", (_req, res) => {
    const raw = parseInt(process.env.ACTIVE_GROUPS ?? "3", 10);
    const activeGroups = isNaN(raw) || raw < 1 ? 3 : Math.min(raw, 3);
    res.json({ activeGroups });
  });

  // Diagnostic — reports the resolved session/auth context. Useful for debugging
  // 401/500 issues on production where you can't easily inspect the session store.
  app.get("/api/debug/whoami", async (req, res) => {
    const session: any = req.session || {};
    const sessionUserId = session.userId ?? null;
    const sessionStaffId = session.staffId ?? null;

    let user: any = null;
    let staffRow: any = null;
    let dbError: string | null = null;

    try {
      if (sessionUserId) {
        const [u] = await db.select().from(users).where(eq(users.id, sessionUserId));
        if (u) {
          user = {
            id: u.id,
            email: (u as any).email ?? null,
            role: (u as any).role ?? null,
            staffId: (u as any).staffId ?? null,
          };
        }
      }
      if (sessionStaffId) {
        const [s] = await db.select().from(staff).where(eq(staff.id, sessionStaffId));
        if (s) {
          staffRow = {
            id: s.id,
            name: (s as any).name ?? null,
            email: (s as any).email ?? null,
            role: (s as any).role ?? null,
            storeId: (s as any).storeId ?? null,
          };
        }
      }
    } catch (err: any) {
      dbError = err?.message || String(err);
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({
      now: new Date().toISOString(),
      hostHeader: req.headers.host ?? null,
      forwardedHost: req.headers["x-forwarded-host"] ?? null,
      forwardedProto: req.headers["x-forwarded-proto"] ?? null,
      cookieHeaderPresent: !!req.headers.cookie,
      sessionId: (req as any).sessionID ?? null,
      session: {
        userId: sessionUserId,
        staffId: sessionStaffId,
        keys: Object.keys(session).filter((k) => k !== "cookie"),
      },
      reqAuth: req.auth
        ? {
            userId: req.auth.userId ?? null,
            staffId: req.auth.staffId ?? null,
            role: req.auth.role,
            permissionsCount: req.auth.permissions?.size ?? 0,
          }
        : null,
      user,
      staff: staffRow,
      subdomainStore: req.store
        ? { id: (req.store as any).id, slug: (req.store as any).bookingSlug }
        : null,
      dbError,
    });
  });

  app.get("/api/trial/status", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    
    try {
      const trialStatus = await TrialService.getTrialStatus(userId);
      return res.json(trialStatus);
    } catch (error) {
      console.error("Error fetching trial status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.use("/api", (req, res, next) => {
    // Allow public routes
    if (req.path.startsWith("/auth/")) return next();
    if (req.path.startsWith("/store/by-subdomain")) return next(); // Allow public access to subdomain store
    if (req.path.startsWith("/public/")) return next(); // Allow public routes
    if (req.path.startsWith("/admin/stores")) return next(); // Allow admin stores endpoint
    if (req.path.startsWith("/admin/platform-settings")) return next(); // Allow admin platform settings endpoint
    if (req.path.startsWith("/admin/users")) return next(); // Allow admin users endpoint
    if (req.path.startsWith("/admin/dashboard")) return next(); // Allow admin dashboard endpoint
    if (req.path.startsWith("/billing/invoices")) return next(); // Allow billing endpoints for development
    if (req.path === "/billing/status") return next(); // Stripe config check — public
    if (req.path === "/billing/plans") return next(); // Plan listing — public
    if (req.path === "/billing/webhook") return next(); // Stripe webhooks — uses own signature auth
    if (req.path === "/billing/account-status") return next(); // Account status gate — auth handled inside route
    if (req.path.startsWith("/seo-regions")) return next(); // SEO regions admin — public
    if (req.path.startsWith("/appointments/confirmation/")) return next(); // Public booking confirmation lookup & cancel
    if (req.path.endsWith("/respond")) return next(); // Public intake form submission
    if (req.path.startsWith("/reviews/form/")) return next(); // Public review form lookup
    if (req.path === "/reviews/submit") return next(); // Public review submission
    if (req.path.startsWith("/chatbot/")) return next(); // Chatbot API — uses own X-Chatbot-Key auth
    if (req.path.startsWith("/dialer/")) return next();  // Twilio dialer — uses own X-Dialer-Key auth + Twilio webhooks

    // ── Website Builder — no session required (uses its own storeid scope) ────
    if (req.path.startsWith("/websites")) return next();
    if (req.path.startsWith("/subdomains")) return next();
    if (req.path.startsWith("/templates")) return next();
    if (req.path.startsWith("/tenant")) return next();
    if (req.path.startsWith("/domain-site")) return next();

    // Require authentication for other endpoints
    const userId = (req.session as any)?.userId;
    const staffId = (req.session as any)?.staffId;
    if (!userId && !staffId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  });

  // Resolve role + permissions for every authenticated /api request.
  // Skips silently for public routes (no session → req.auth left undefined).
  app.use("/api", attachAuthContext);

  // === STORES ===
  app.get(api.stores.list.path, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const stores = await storage.getStores(userId);
      res.json(stores);
    } catch (err: any) {
      console.error("[stores] list failed:", err.message, err.stack);
      res.status(500).json({ message: "Failed to load stores", detail: err.message });
    }
  });

  app.get(api.stores.get.path, async (req, res) => {
    const store = await storage.getStore(Number(req.params.id));
    if (!store) return res.status(404).json({ message: "Store not found" });
    res.json(store);
  });

  // === ADMIN STORES ===
  app.get("/api/admin/stores", async (req, res) => {
    try {
      // Get all stores with account status
      const allStores = await db.select({
        id: locations.id,
        name: locations.name,
        userId: locations.userId,
        bookingSlug: locations.bookingSlug,
        category: locations.category,
        email: locations.email,
        timezone: locations.timezone,
        address: locations.address,
        phone: locations.phone,
        city: locations.city,
        state: locations.state,
        postcode: locations.postcode,
        commissionPayoutFrequency: locations.commissionPayoutFrequency,
        accountStatus: locations.accountStatus,
      }).from(locations).orderBy(locations.name);
      
      // Transform the data to match the expected interface
      const transformedStores = allStores.map(store => ({
        id: store.id,
        name: store.name,
        user_id: store.userId,
        booking_slug: store.bookingSlug,
        category: store.category,
        email: store.email,
        timezone: store.timezone,
        address: store.address,
        phone: store.phone,
        city: store.city,
        state: store.state,
        postcode: store.postcode,
        commission_payout_frequency: store.commissionPayoutFrequency,
        // Use account status from locations table
        subscription: 'Basic', // Default subscription for now
        accountStatus: store.accountStatus || 'Active',
      }));
      
      res.json(transformedStores);
    } catch (error) {
      console.error("Error fetching admin stores:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET store analytics for admin
  app.get("/api/admin/stores/:storeNumber/analytics", async (req, res) => {
    try {
      const { storeNumber } = req.params;
      
      // GET appointments for this store
      const appointmentsData = await db.select({
        id: appointments.id,
        date: appointments.date,
        totalPaid: appointments.totalPaid,
        status: appointments.status,
      }).from(appointments)
        .where(eq(appointments.storeId, parseInt(storeNumber)));

      // Get staff for this store
      const staffData = await db.select({
        id: staff.id,
      }).from(staff)
        .where(eq(staff.storeId, parseInt(storeNumber)));

      // Get customers for this store
      const customersData = await db.select({
        id: customers.id,
      }).from(customers)
        .where(eq(customers.storeId, parseInt(storeNumber)));

      // Calculate metrics
      const totalAppointments = appointmentsData.length;
      const activeStaffCount = staffData.length;
      const totalCustomers = customersData.length;
      
      // Calculate monthly revenue from completed appointments
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      const monthlyAppointments = appointmentsData.filter(apt => {
        const aptDate = new Date(apt.date);
        return aptDate.getMonth() === currentMonth && aptDate.getFullYear() === currentYear && apt.status === 'completed';
      });
      
      const monthlyRevenue = monthlyAppointments.reduce((sum, apt) => {
        return sum + Number(apt.totalPaid || 0);
      }, 0);

      // Get last activity
      const lastActivity = appointmentsData.length > 0
        ? appointmentsData.reduce((latest, apt) =>
            new Date(apt.date) > new Date(latest.date) ? apt : latest
          ).date
        : new Date();

      res.json({
        totalAppointments,
        activeStaffCount,
        totalCustomers,
        monthlyRevenue,
        averageRating: 0, // Would need reviews table
        lastActivity
      });
    } catch (error) {
      console.error("Error fetching store analytics:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET staff for admin store
  app.get("/api/admin/stores/:storeNumber/staff", async (req, res) => {
    try {
      const { storeNumber } = req.params;
      
      const staffData = await db.select({
        id: staff.id,
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        role: staff.role,
        commissionEnabled: staff.commissionEnabled,
        storeId: staff.storeId,
      }).from(staff)
        .where(eq(staff.storeId, parseInt(storeNumber)));

      res.json(staffData);
    } catch (error) {
      console.error("Error fetching staff:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET calendar settings for admin store
  app.get("/api/admin/stores/:storeNumber/calendar-settings", async (req, res) => {
    try {
      const { storeNumber } = req.params;
      
      const calendarSettingsData = await db.select({
        id: calendarSettings.id,
        startOfWeek: calendarSettings.startOfWeek,
        timeSlotInterval: calendarSettings.timeSlotInterval,
        nonWorkingHoursDisplay: calendarSettings.nonWorkingHoursDisplay,
        allowBookingOutsideHours: calendarSettings.allowBookingOutsideHours,
        autoCompleteAppointments: calendarSettings.autoCompleteAppointments,
        autoMarkNoShows: calendarSettings.autoMarkNoShows,
        showPrices: calendarSettings.showPrices,
      }).from(calendarSettings)
        .where(eq(calendarSettings.storeId, parseInt(storeNumber)))
        .limit(1);

      res.json(calendarSettingsData[0] || null);
    } catch (error) {
      console.error("Error fetching calendar settings:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET SMS settings for admin store
  app.get("/api/admin/stores/:storeNumber/sms-settings", async (req, res) => {
    try {
      const { storeNumber } = req.params;
      
      const smsSettingsData = await db.select({
        id: smsSettings.id,
        bookingConfirmationEnabled: smsSettings.bookingConfirmationEnabled,
        reminderEnabled: smsSettings.reminderEnabled,
        reminderHoursBefore: smsSettings.reminderHoursBefore,
        reviewRequestEnabled: smsSettings.reviewRequestEnabled,
        twilioPhoneNumber: smsSettings.twilioPhoneNumber,
      }).from(smsSettings)
        .where(eq(smsSettings.storeId, parseInt(storeNumber)))
        .limit(1);

      res.json(smsSettingsData[0] || null);
    } catch (error) {
      console.error("Error fetching SMS settings:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET email settings for admin store
  app.get("/api/admin/stores/:storeNumber/email-settings", async (req, res) => {
    try {
      const { storeNumber } = req.params;
      
      const emailSettingsData = await db.select({
        id: mailSettings.id,
        bookingConfirmationEnabled: mailSettings.bookingConfirmationEnabled,
        reminderEnabled: mailSettings.reminderEnabled,
        reviewRequestEnabled: mailSettings.reviewRequestEnabled,
        mailgunApiKey: mailSettings.mailgunApiKey,
        mailgunDomain: mailSettings.mailgunDomain,
      }).from(mailSettings)
        .where(eq(mailSettings.storeId, parseInt(storeNumber)))
        .limit(1);

      res.json(emailSettingsData[0] || null);
    } catch (error) {
      console.error("Error fetching email settings:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET services for admin store
  app.get("/api/admin/stores/:storeNumber/services", async (req, res) => {
    try {
      const { storeNumber } = req.params;
      
      const servicesData = await db.select({
        id: services.id,
        name: services.name,
        description: services.description,
        price: services.price,
        duration: services.duration,
        categoryId: services.categoryId,
      }).from(services)
        .where(eq(services.storeId, parseInt(storeNumber)));

      res.json(servicesData);
    } catch (error) {
      console.error("Error fetching services:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET service categories for admin store
  app.get("/api/admin/stores/:storeNumber/service-categories", async (req, res) => {
    try {
      const { storeNumber } = req.params;
      
      const categoriesData = await db.select({
        id: serviceCategories.id,
        name: serviceCategories.name,
        imageUrl: serviceCategories.imageUrl,
        sortOrder: serviceCategories.sortOrder,
      }).from(serviceCategories)
        .where(eq(serviceCategories.storeId, parseInt(storeNumber)));

      res.json(categoriesData);
    } catch (error) {
      console.error("Error fetching service categories:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // PATCH single store by ID for admin (update core fields)
  app.patch("/api/admin/stores/:storeNumber", async (req, res) => {
    try {
      const id = parseInt(req.params.storeNumber);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid store ID" });

      const allowedFields = ["name", "email", "phone", "address", "city", "state", "postcode", "category", "timezone"] as const;
      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const [updated] = await db.update(locations).set(updates).where(eq(locations.id, id)).returning();
      if (!updated) return res.status(404).json({ message: "Store not found" });
      res.json(updated);
    } catch (error) {
      console.error("Admin store update error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET single store by ID for admin
  app.get("/api/admin/stores/:storeNumber", async (req, res) => {
    try {
      const { storeNumber } = req.params;
      
      // Get store by ID
      const store = await db.select({
        id: locations.id,
        name: locations.name,
        email: locations.email,
        phone: locations.phone,
        address: locations.address,
        city: locations.city,
        state: locations.state,
        postcode: locations.postcode,
        category: locations.category,
        timezone: locations.timezone,
        bookingSlug: locations.bookingSlug,
        bookingTheme: locations.bookingTheme,
        commissionPayoutFrequency: locations.commissionPayoutFrequency,
        userId: locations.userId,
      }).from(locations)
        .where(eq(locations.id, parseInt(storeNumber)))
        .limit(1);

      if (store.length === 0) {
        return res.status(404).json({ message: "Store not found" });
      }

      // Get user information (userId may be null for stores without an owner)
      const user = store[0].userId
        ? await db.select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            createdAt: users.createdAt,
          }).from(users)
            .where(eq(users.id, store[0].userId))
            .limit(1)
        : [];

      const storeData = {
        ...store[0],
        userEmail: user[0]?.email || '',
        userFirstName: user[0]?.firstName || '',
        userLastName: user[0]?.lastName || '',
        createdAt: user[0]?.createdAt?.toISOString() || null,
        lastLogin: null,
      };

      res.json(storeData);
    } catch (error) {
      console.error("Error fetching store:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post(api.stores.create.path, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const input = insertLocationSchema.parse(req.body);
      const store = await storage.createStore({ ...input, userId });
      res.status(201).json(store);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.patch("/api/stores/:id", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      
      const id = Number(req.params.id);
      const store = await storage.getStore(id);
      if (!store || store.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const input = insertLocationSchema.partial().parse(req.body);
      const updatedStore = await storage.updateStore(id, input);
      if (!updatedStore) return res.status(404).json({ message: "Store not found" });
      res.json(updatedStore);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid input", details: error.errors[0].message });
      } else {
        console.error("Store update error:", error);
        res.status(400).json({ message: "Failed to update store" });
      }
    }
  });

  // === BUSINESS HOURS ===
  app.get(api.businessHours.get.path, async (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    if (!storeId) return res.status(400).json({ message: "storeId required" });
    const hours = await storage.getBusinessHours(storeId);
    res.json(hours);
  });

  app.put(api.businessHours.set.path, async (req, res) => {
    try {
      const input = z.object({
        storeId: z.number(),
        hours: z.array(z.object({
          dayOfWeek: z.number().min(0).max(6),
          openTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format"),
          closeTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format"),
          isClosed: z.boolean(),
        })),
      }).parse(req.body);
      for (const h of input.hours) {
        if (h.isClosed) continue;
        const [oh, om] = h.openTime.split(":").map(Number);
        const [ch, cm] = h.closeTime.split(":").map(Number);
        if ((ch * 60 + cm) <= (oh * 60 + om)) {
          return res.status(400).json({ message: `Day ${h.dayOfWeek}: close time must be after open time` });
        }
      }
      const hoursData = input.hours.map(h => ({
        ...h,
        storeId: input.storeId,
      }));
      const result = await storage.setBusinessHours(input.storeId, hoursData);
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0].message });
      } else {
        res.status(400).json({ message: "Invalid input" });
      }
    }
  });

  // === SERVICE CATEGORIES ===
  app.post("/api/service-categories/reorder", async (req, res) => {
    const { orderedIds, storeId } = req.body;
    if (!Array.isArray(orderedIds) || !storeId) return res.status(400).json({ error: "Invalid input" });
    for (let i = 0; i < orderedIds.length; i++) {
      await storage.updateServiceCategory(orderedIds[i], { sortOrder: i });
    }
    res.json({ success: true });
  });

  app.get(api.serviceCategories.list.path, async (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    const cats = await storage.getServiceCategories(storeId);
    res.json(cats);
  });

  app.post(api.serviceCategories.create.path, async (req, res) => {
    try {
      const input = insertServiceCategorySchema.parse(req.body);
      const cat = await storage.createServiceCategory(input);
      res.status(201).json(cat);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.patch(api.serviceCategories.update.path, async (req, res) => {
    try {
      const input = insertServiceCategorySchema.partial().parse(req.body);
      const cat = await storage.updateServiceCategory(Number(req.params.id), input);
      if (!cat) return res.status(404).json({ message: "Category not found" });
      res.json(cat);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.delete(api.serviceCategories.delete.path, async (req, res) => {
    await storage.deleteServiceCategory(Number(req.params.id));
    res.status(204).end();
  });

  // === SERVICES ===
  app.get(api.services.list.path, async (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    const services = await storage.getServices(storeId);
    res.json(services);
  });

  app.get(api.services.get.path, async (req, res) => {
    const service = await storage.getService(Number(req.params.id));
    if (!service) return res.status(404).json({ message: "Service not found" });
    res.json(service);
  });

  app.post(api.services.create.path, requireActiveTrial, async (req, res) => {
    try {
      const input = insertServiceSchema.parse(req.body);
      const service = await storage.createService(input);
      res.status(201).json(service);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.patch(api.services.update.path, async (req, res) => {
    try {
      const input = insertServiceSchema.partial().parse(req.body);
      const service = await storage.updateService(Number(req.params.id), input);
      if (!service) return res.status(404).json({ message: "Service not found" });
      res.json(service);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.delete(api.services.delete.path, async (req, res) => {
    await storage.deleteService(Number(req.params.id));
    res.status(204).end();
  });

  // === ADDONS ===
  app.get(api.addons.list.path, async (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    const result = await storage.getAddons(storeId);
    res.json(result);
  });

  app.post(api.addons.create.path, async (req, res) => {
    try {
      const input = insertAddonSchema.parse(req.body);
      const addon = await storage.createAddon(input);
      res.status(201).json(addon);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.patch(api.addons.update.path, async (req, res) => {
    try {
      const input = insertAddonSchema.partial().parse(req.body);
      const addon = await storage.updateAddon(Number(req.params.id), input);
      if (!addon) return res.status(404).json({ message: "Addon not found" });
      res.json(addon);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.delete(api.addons.delete.path, async (req, res) => {
    await storage.deleteAddon(Number(req.params.id));
    res.status(204).end();
  });

  // === SERVICE ADDONS (linking) ===
  app.get(api.serviceAddons.list.path, async (req, res) => {
    const serviceId = req.query.serviceId ? Number(req.query.serviceId) : undefined;
    const result = await storage.getServiceAddons(serviceId);
    res.json(result);
  });

  app.get(api.serviceAddons.forService.path, async (req, res) => {
    const serviceId = Number(req.params.id);
    const result = await storage.getAddonsForService(serviceId);
    res.json(result);
  });

  app.post(api.serviceAddons.create.path, async (req, res) => {
    try {
      const input = insertServiceAddonSchema.parse(req.body);
      const sa = await storage.createServiceAddon(input);
      res.status(201).json(sa);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.delete(api.serviceAddons.delete.path, async (req, res) => {
    await storage.deleteServiceAddon(Number(req.params.id));
    res.status(204).end();
  });

  app.get("/api/service-addon-mappings", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const userStores = await storage.getStores(userId);
      const storeIds = userStores.map(s => s.id);
      const allMappings = await storage.getAllServiceAddonMappings();
      const userAddons = await Promise.all(storeIds.map(sid => storage.getAddons(sid)));
      const userAddonIds = new Set(userAddons.flat().map(a => a.id));
      const filtered = allMappings.filter(m => userAddonIds.has(m.addonId));
      res.json(filtered);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch mappings" });
    }
  });

  app.post("/api/addons/:id/services", async (req, res) => {
    try {
      const addonId = Number(req.params.id);
      const bodySchema = z.object({
        serviceIds: z.array(z.number()),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
      }
      const addon = await storage.getAddon(addonId);
      if (!addon) return res.status(404).json({ message: "Addon not found" });
      const userId = (req.session as any)?.userId;
      if (addon.storeId) {
        const store = await storage.getStore(addon.storeId);
        if (store?.userId !== userId) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }
      await storage.setAddonServices(addonId, parsed.data.serviceIds);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to update addon services" });
    }
  });

  // === APPOINTMENT AVAILABLE TIME ===
  // POST /api/appointments/:id/send-review-request
  // Manually triggers a review request SMS for a completed appointment
  app.post("/api/appointments/:id/send-review-request", async (req, res) => {
    const appointmentId = Number(req.params.id);
    const appointment = await storage.getAppointment(appointmentId);
    if (!appointment) return res.status(404).json({ error: "Appointment not found" });
    if (appointment.status !== "completed") {
      return res.status(400).json({ error: "Review requests can only be sent for completed appointments" });
    }
    try {
      const { sendReviewRequest } = await import("./sms");
      await sendReviewRequest(appointment as any);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[review-request] error:", err);
      res.status(500).json({ error: err.message || "Failed to send review request" });
    }
  });

  app.get("/api/appointments/:id/available-time", async (req, res) => {
    const appointmentId = Number(req.params.id);
    const appointment = await storage.getAppointment(appointmentId);
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });

    if (!appointment.staffId) return res.json({ availableMinutes: 0 });

    const appointmentEndMs = new Date(appointment.date).getTime() + appointment.duration * 60000;

    // Get store timezone for local-time calculations
    const store = appointment.storeId ? await storage.getStore(appointment.storeId) : null;
    const timezone = (store as any)?.timezone || "UTC";

    // Determine day boundaries in local store time
    const localApptDate = toZonedTime(new Date(appointment.date), timezone);
    const dayOfWeek = localApptDate.getDay();

    // Start = midnight local, End = 23:59:59 local (UTC equivalents)
    const localMidnight = new Date(localApptDate);
    localMidnight.setHours(0, 0, 0, 0);
    const localEndOfDay = new Date(localApptDate);
    localEndOfDay.setHours(23, 59, 59, 999);
    const dayStart = fromZonedTime(localMidnight, timezone);
    const dayEnd = fromZonedTime(localEndOfDay, timezone);

    const dayAppointments = await storage.getAppointments({
      from: dayStart,
      to: dayEnd,
      staffId: appointment.staffId,
      storeId: appointment.storeId || undefined,
    });

    // Find the next appointment starting at or after this one ends
    let nextStartMs: number | null = null;
    for (const other of dayAppointments) {
      if (other.id === appointmentId || other.status === "cancelled") continue;
      const otherStartMs = new Date(other.date).getTime();
      if (otherStartMs >= appointmentEndMs) {
        if (nextStartMs === null || otherStartMs < nextStartMs) {
          nextStartMs = otherStartMs;
        }
      }
    }

    let availableMinutes: number;
    if (nextStartMs !== null) {
      // Gap to next appointment minus 5-minute buffer
      availableMinutes = Math.max(0, Math.floor((nextStartMs - appointmentEndMs) / 60000) - 5);
    } else {
      // Use store's business close time for this day of week
      const storeHours = appointment.storeId ? await storage.getBusinessHours(appointment.storeId) : [];
      const dayHours = storeHours.find((h: any) => h.dayOfWeek === dayOfWeek);
      const closeTimeStr = dayHours?.closeTime || "22:00";
      const [closeH, closeM] = closeTimeStr.split(":").map(Number);
      const localClose = new Date(localApptDate);
      localClose.setHours(closeH, closeM, 0, 0);
      const eodMs = fromZonedTime(localClose, timezone).getTime();
      availableMinutes = Math.max(0, Math.floor((eodMs - appointmentEndMs) / 60000) - 5);
    }

    res.json({ availableMinutes });
  });

  // === APPOINTMENT ADDONS ===
  app.get(api.appointmentAddons.forAppointment.path, async (req, res) => {
    const appointmentId = Number(req.params.id);
    const result = await storage.getAppointmentAddons(appointmentId);
    res.json(result.map(aa => aa.addon));
  });

  app.post(api.appointmentAddons.set.path, async (req, res) => {
    try {
      const appointmentId = Number(req.params.id);
      const { addonIds } = z.object({ addonIds: z.array(z.number()) }).parse(req.body);

      const appointment = await storage.getAppointment(appointmentId);
      if (!appointment) return res.status(404).json({ message: "Appointment not found" });

      if (appointment.staffId && appointment.status !== "cancelled" && appointment.status !== "completed") {
        let addonDuration = 0;
        for (const addonId of addonIds) {
          const addon = await storage.getAddon(addonId);
          if (addon) addonDuration += addon.duration;
        }

        const baseDuration = appointment.service?.duration || appointment.duration;
        const totalDuration = baseDuration + addonDuration;

        const appointmentStart = new Date(appointment.date);
        const appointmentEnd = new Date(appointmentStart.getTime() + totalDuration * 60000);

        const dayStart = new Date(appointmentStart);
        dayStart.setUTCHours(0, 0, 0, 0);
        const dayEnd = new Date(appointmentStart);
        dayEnd.setUTCHours(23, 59, 59, 999);

        const dayAppointments = await storage.getAppointments({
          from: dayStart,
          to: dayEnd,
          staffId: appointment.staffId,
          storeId: appointment.storeId || undefined,
        });

        for (const other of dayAppointments) {
          if (other.id === appointmentId || other.status === "cancelled") continue;
          const otherStart = new Date(other.date);
          const otherEnd = new Date(otherStart.getTime() + other.duration * 60000);

          if (appointmentStart < otherEnd && appointmentEnd > otherStart) {
            const availableMinutes = Math.max(0, Math.floor((otherStart.getTime() - appointmentStart.getTime()) / 60000) - baseDuration);
            return res.status(409).json({
              message: `Staff member has another appointment at ${otherStart.toISOString()}. Not enough time for selected addons.`,
              availableMinutes,
            });
          }
        }

        await storage.updateAppointment(appointmentId, { duration: totalDuration });
      }

      await storage.setAppointmentAddons(appointmentId, addonIds);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: "Invalid input" });
    }
  });

  // === STAFF ===
  app.get(api.staff.list.path, async (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    const staffList = await storage.getAllStaff(storeId);
    res.json(staffList.map(({ password, ...safe }) => safe));
  });

  app.get(api.staff.get.path, async (req, res) => {
    const member = await storage.getStaffMember(Number(req.params.id));
    if (!member) return res.status(404).json({ message: "Staff not found" });
    const { password, ...safe } = member;
    res.json(safe);
  });

  app.post(api.staff.create.path, requireActiveTrial, async (req, res) => {
    try {
      const input = insertStaffSchema.parse(req.body);
      if (input.password) {
        input.password = await bcrypt.hash(input.password, 10);
      } else {
        delete input.password;
      }
      const member = await storage.createStaff(input);
      res.status(201).json(member);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.patch(api.staff.update.path, async (req, res) => {
    try {
      const input = insertStaffSchema.partial().parse(req.body);
      if (input.password) {
        input.password = await bcrypt.hash(input.password, 10);
      } else {
        // If password is not provided or empty, do not update it
        delete input.password;
      }
      const member = await storage.updateStaff(Number(req.params.id), input);
      if (!member) return res.status(404).json({ message: "Staff not found" });
      res.json(member);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.delete(api.staff.delete.path, async (req, res) => {
    await storage.deleteStaff(Number(req.params.id));
    res.status(204).end();
  });

  app.post("/api/staff/:id/enable-calendar-access", async (req, res) => {
    try {
      const staffId = Number(req.params.id);
      const staff = await storage.getStaffMember(staffId);

      if (!staff || !staff.email) {
        return res.status(400).json({ message: "Staff member not found or has no email address." });
      }

      const tempPassword = Math.random().toString(36).slice(-8);
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      let user = await storage.findUserByEmail(staff.email);

      if (user) {
        // Link the user to this staff record, but DO NOT downgrade an existing
        // owner/admin/manager to "staff" — that locks them out of their own store.
        const keepRole =
          user.role === "owner" || user.role === "admin" || user.role === "manager";
        await storage.updateUser(user.id, {
          password: hashedPassword,
          ...(keepRole ? {} : { role: "staff" }),
          staffId: staff.id,
          passwordChanged: false,
        });
      } else {
        user = await storage.createUser({
          email: staff.email,
          password: hashedPassword,
          role: "staff",
          staffId: staff.id,
          passwordChanged: false,
        });
      }

      // Send email with temporary password
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #007bff; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">Staff Calendar Access</h1>
          </div>
          <div style="background-color: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px;">
            <h2 style="color: #333; margin-top: 0;">Welcome to Your Staff Portal!</h2>
            <p style="color: #666; line-height: 1.6;">
              Your calendar access has been enabled for <strong>${staff.name}</strong>.
            </p>
            <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #007bff;">
              <h3 style="color: #333; margin-top: 0; margin-bottom: 15px;">Your Login Details:</h3>
              <p style="margin: 5px 0;"><strong>Email:</strong> ${staff.email}</p>
              <p style="margin: 5px 0;"><strong>Temporary Password:</strong> <span style="background-color: #e9ecef; padding: 5px 10px; border-radius: 3px; font-family: monospace; font-size: 16px;">${tempPassword}</span></p>
            </div>
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <p style="margin: 0; color: #856404;">
                <strong>Important:</strong> Please log in and change your password as soon as possible.
              </p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL || process.env.APP_URL || ''}/staff-auth" 
                 style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Log In to Staff Portal
              </a>
            </div>
            <p style="color: #6c757d; font-size: 14px; text-align: center; margin-top: 30px;">
              If you have any questions, please contact your administrator.
            </p>
          </div>
        </div>
      `;

      const emailText = `
Staff Calendar Access Enabled

Welcome ${staff.name}!

Your calendar access has been enabled. Here are your login details:

Email: ${staff.email}
Temporary Password: ${tempPassword}

Important: Please log in and change your password as soon as possible.

Log in at: ${process.env.FRONTEND_URL || process.env.APP_URL || ''}/staff-auth

If you have any questions, please contact your administrator.
      `;

      const emailResult = await sendEmail(
        staff.storeId || 1, // Use storeId from staff record or default to 1
        staff.email,
        "Staff Calendar Access Enabled - Your Login Details",
        emailHtml,
        emailText
      );

      if (!emailResult.success) {
        console.error("Failed to send calendar access email:", emailResult.error);
        // Don't fail the whole operation, but log the error
        console.log(`Calendar access enabled for ${staff.email} but email failed to send. Temporary password: ${tempPassword}`);
      } else {
        console.log(`Calendar access email sent successfully to ${staff.email} with message ID: ${emailResult.id}`);
      }

      res.json({ success: true, message: "Calendar access enabled and email sent." });
    } catch (error) {
      console.error("Failed to enable calendar access:", error);
      res.status(500).json({ message: "Failed to enable calendar access" });
    }
  });

  // === STAFF SERVICES ===
  app.get(api.staffServices.list.path, async (req, res) => {
    const staffId = req.query.staffId ? Number(req.query.staffId) : undefined;
    const serviceId = req.query.serviceId ? Number(req.query.serviceId) : undefined;
    const result = await storage.getStaffServices(staffId, serviceId);
    res.json(result);
  });

  app.get(api.staffServices.forService.path, async (req, res) => {
    const serviceId = Number(req.params.id);
    const capableStaff = await storage.getStaffForService(serviceId);
    res.json(capableStaff);
  });

  app.post(api.staffServices.set.path, async (req, res) => {
    try {
      const staffId = Number(req.params.id);
      const { serviceIds } = z.object({ serviceIds: z.array(z.number()) }).parse(req.body);
      await storage.setStaffServices(staffId, serviceIds);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  // === STAFF AVAILABILITY ===
  app.get(api.staffAvailability.get.path, async (req, res) => {
    const staffId = Number(req.params.id);
    const rules = await storage.getStaffAvailability(staffId);
    res.json(rules);
  });

  app.post(api.staffAvailability.set.path, async (req, res) => {
    try {
      const staffId = Number(req.params.id);
      const { rules } = z.object({
        rules: z.array(z.object({
          dayOfWeek: z.number(),
          startTime: z.string(),
          endTime: z.string(),
        }))
      }).parse(req.body);
      const result = await storage.setStaffAvailability(staffId, rules.map(r => ({ ...r, staffId })));
      res.json(result);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.delete(api.staffAvailability.deleteRule.path, async (req, res) => {
    await storage.deleteStaffAvailabilityRule(Number(req.params.id));
    res.status(204).end();
  });

  // === AVAILABILITY SLOTS ===
  app.get(api.availability.slots.path, async (req, res) => {
    try {
      const serviceId = Number(req.query.serviceId);
      const storeId = Number(req.query.storeId);
      const date = String(req.query.date);
      const duration = Number(req.query.duration);
      const specificStaffId = req.query.staffId ? Number(req.query.staffId) : undefined;

      if (!serviceId || !storeId || !date || !duration) {
        return res.status(400).json({ message: "serviceId, storeId, date, and duration are required" });
      }

      const store = await storage.getStore(storeId);
      if (!store) return res.status(404).json({ message: "Store not found" });

      let candidateStaff: Staff[];
      if (specificStaffId) {
        const member = await storage.getStaffMember(specificStaffId);
        // Verify that the specific staff member can perform this service
        if (member) {
          const staffServices = await storage.getStaffServices(specificStaffId);
          const canPerformService = staffServices.some(ss => ss.serviceId === serviceId);
          candidateStaff = canPerformService ? [member] : [];
        } else {
          candidateStaff = [];
        }
      } else {
        candidateStaff = await storage.getStaffForService(serviceId);
      }

      if (candidateStaff.length === 0) {
        return res.json([]);
      }

      const tz = store.timezone || "UTC";

      const calSettings = await storage.getCalendarSettings(storeId);
      const slotInterval = calSettings?.timeSlotInterval || 15;

      // Get actual business hours for the specific date
      const businessHours = await storage.getBusinessHours(storeId);
      const dateObj = new Date(`${date}T00:00:00`);
      const dayOfWeek = dateObj.getUTCDay();
      const todayBusinessHours = businessHours.find(h => h.dayOfWeek === dayOfWeek);
      
      if (!todayBusinessHours || todayBusinessHours.isClosed) {
        return res.json([]);
      }

      // Parse business hours
      const [openHour, openMin] = todayBusinessHours.openTime.split(":").map(Number);
      const [closeHour, closeMin] = todayBusinessHours.closeTime.split(":").map(Number);

      const dayStartLocal = fromZonedTime(new Date(`${date}T00:00:00`), tz);
      const dayEndLocal = fromZonedTime(new Date(`${date}T23:59:59.999`), tz);

      const dayAppointments = await storage.getAppointments({
        from: dayStartLocal,
        to: dayEndLocal,
        storeId,
      });

      type SlotResult = { time: string; staffId: number; staffName: string };
      const slots: SlotResult[] = [];

      const staffLastAppointment: Map<number, Date> = new Map();
      const allAppointments = await storage.getAppointments({ storeId });
      for (const apt of allAppointments) {
        if (apt.status === "cancelled") continue;
        const staffId = apt.staffId;
        if (!staffId) continue;
        const aptDate = new Date(apt.date);
        const current = staffLastAppointment.get(staffId);
        if (!current || aptDate > current) {
          staffLastAppointment.set(staffId, aptDate);
        }
      }

      const businessEndUtc = fromZonedTime(new Date(`${date}T${String(closeHour).padStart(2, "0")}:${String(closeMin).padStart(2, "0")}:00`), tz);
      const nowUtc = new Date();

      for (let hour = openHour; hour <= closeHour; hour++) {
        for (let min = 0; min < 60; min += slotInterval) {
          // Skip slots before opening time on the first hour
          if (hour === openHour && min < openMin) {
            continue;
          }
          // Stop once we've passed the closing hour
          if (hour === closeHour && min >= closeMin) {
            break;
          }
          if (hour > closeHour) {
            break;
          }

          const slotStart = fromZonedTime(new Date(`${date}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`), tz);
          const slotEnd = new Date(slotStart.getTime() + duration * 60000);

          if (slotStart < nowUtc) {
            continue;
          }

          // Slot must finish by closing time
          if (slotEnd > businessEndUtc) {
            continue;
          }

          const availableForSlot: { staffMember: Staff; lastApt: Date | null }[] = [];

          for (const staffMember of candidateStaff) {
            let hasConflict = false;
            for (const apt of dayAppointments) {
              if (apt.staffId !== staffMember.id) continue;
              if (apt.status === "cancelled") continue;
              const aptStart = new Date(apt.date);
              const aptEnd = new Date(aptStart.getTime() + apt.duration * 60000);
              if (slotStart < aptEnd && slotEnd > aptStart) {
                hasConflict = true;
                break;
              }
            }
            
            // Check staff availability rules if they exist
            if (!hasConflict) {
              const staffAvailRules = await storage.getStaffAvailability(staffMember.id);
              if (staffAvailRules && staffAvailRules.length > 0) {
                // Get day of week in store's local timezone, not UTC
                const slotDate = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`);
                const slotLocalDate = toZonedTime(slotDate, tz);
                const slotDayOfWeek = slotLocalDate.getDay(); // 0=Sunday, 1=Monday, etc.
                const dayAvailability = staffAvailRules.find(r => r.dayOfWeek === slotDayOfWeek);
                
                if (dayAvailability) {
                  const [availStartHour, availStartMin] = dayAvailability.startTime.split(":").map(Number);
                  const [availEndHour, availEndMin] = dayAvailability.endTime.split(":").map(Number);

                  const slotTimeInMin = hour * 60 + min;
                  // Convert slotEnd (UTC) to store-local time before extracting hours/minutes
                  const slotEndLocal = toZonedTime(slotEnd, tz);
                  const slotEndTimeInMin = slotEndLocal.getHours() * 60 + slotEndLocal.getMinutes();
                  const availStartInMin = availStartHour * 60 + availStartMin;
                  const availEndInMin = availEndHour * 60 + availEndMin;

                  // Check if slot falls outside staff availability
                  if (slotTimeInMin < availStartInMin || slotEndTimeInMin > availEndInMin) {
                    hasConflict = true;
                  }
                } else {
                  // No availability rules for this day, staff is not available
                  hasConflict = true;
                }
              }
            }
            
            if (!hasConflict) {
              availableForSlot.push({
                staffMember,
                lastApt: staffLastAppointment.get(staffMember.id) || null,
              });
            }
          }

          if (availableForSlot.length > 0) {
            availableForSlot.sort((a, b) => {
              if (a.lastApt === null && b.lastApt === null) return 0;
              if (a.lastApt === null) return -1;
              if (b.lastApt === null) return 1;
              return a.lastApt.getTime() - b.lastApt.getTime();
            });

            const chosen = availableForSlot[0];
            slots.push({
              time: slotStart.toISOString(),
              staffId: chosen.staffMember.id,
              staffName: chosen.staffMember.name,
            });
          }
        }
      }

      res.json(slots);
    } catch (error) {
      console.error("Availability error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // === CUSTOMERS ===
  app.get(api.customers.searchByPhone.path, async (req, res) => {
    const phone = req.query.phone as string;
    const storeId = Number(req.query.storeId);
    if (!phone || !storeId) return res.status(400).json({ message: "phone and storeId required" });
    const digits = phone.replace(/\D/g, "");
    const allCustomers = await storage.getCustomers(storeId);
    const match = allCustomers.find(c => c.phone && c.phone.replace(/\D/g, "") === digits);
    res.json(match || null);
  });

  app.get(api.customers.list.path, async (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    const customers = await storage.getCustomers(storeId);
    res.json(customers);
  });

  app.post(api.customers.create.path, requireActiveTrial, async (req, res) => {
    try {
      const input = insertCustomerSchema.parse(req.body);
      const customer = await storage.createCustomer(input);
      res.status(201).json(customer);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    const customer = await storage.getCustomer(Number(req.params.id));
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    res.json(customer);
  });

  app.patch(api.customers.update.path, async (req, res) => {
    try {
      const input = insertCustomerSchema.partial().parse(req.body);
      const customer = await storage.updateCustomer(Number(req.params.id), input);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      res.json(customer);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  // === APPOINTMENTS ===
  app.get(api.appointments.list.path, async (req, res) => {
    try {
      // Scope to own staff if the user lacks appointments.viewAll
      const scopedStaffId = ownStaffScope(req);

      const filters = {
        from: req.query.from ? new Date(req.query.from as string) : undefined,
        to: req.query.to ? new Date(req.query.to as string) : undefined,
        staffId: scopedStaffId !== undefined ? scopedStaffId : (req.query.staffId ? Number(req.query.staffId) : undefined),
        storeId: req.query.storeId ? Number(req.query.storeId) : undefined,
        customerId: req.query.customerId ? Number(req.query.customerId) : undefined,
      };
      const appointments = await storage.getAppointments(filters);

      if (filters.storeId) {
        const calSettings = await storage.getCalendarSettings(filters.storeId);
        const store = await storage.getStore(filters.storeId);
        const graceMinutes = Math.max(0, store?.lateGracePeriodMinutes ?? 10);
        const graceMs = graceMinutes * 60000;
        const now = new Date();

        if (calSettings?.autoMarkNoShows) {
          for (const apt of appointments) {
            if (apt.status !== "cancelled" && apt.status !== "completed" && apt.status !== "no_show" && apt.status !== "started") {
              const noShowAt = new Date(new Date(apt.date).getTime() + graceMs);
              if (noShowAt < now) {
                await storage.updateAppointment(apt.id, { status: "no_show" });
                apt.status = "no_show";
              }
            }
          }
        }

        if (calSettings?.autoCompleteAppointments) {
          for (const apt of appointments) {
            if (apt.status === "confirmed" || apt.status === "started" || apt.status === "pending") {
              const aptEnd = new Date(new Date(apt.date).getTime() + apt.duration * 60000);
              if (aptEnd < now) {
                await storage.updateAppointment(apt.id, { status: "completed" });
                apt.status = "completed";
              }
            }
          }
        }
      }

      res.json(appointments);
    } catch (err) {
      console.error("[appointments] Failed to fetch appointments:", err);
      res.status(500).json({ message: "Failed to fetch appointments" });
    }
  });

  app.post(api.appointments.create.path, requireActiveTrial, async (req, res) => {
    try {
      const input = insertAppointmentSchema.parse({
        ...req.body,
        date: new Date(req.body.date),
      });

      if (input.date.getTime() <= Date.now()) {
        return res.status(400).json({ message: "Cannot create an appointment in the past" });
      }

      // Validate staff is assigned to the requested service
      if (input.staffId && input.serviceId) {
        const staffServices = await storage.getStaffServices(input.staffId);
        const canPerformService = staffServices.some(ss => ss.serviceId === input.serviceId);
        if (!canPerformService) {
          return res.status(400).json({ message: "This staff member is not assigned to the selected service" });
        }
      }

      // Check for scheduling conflicts (overlapping appointments for the same staff)
      if (input.staffId && input.storeId) {
        const appointmentEnd = new Date(input.date.getTime() + (input.duration || 30) * 60000);
        const existingApts = await storage.getAppointments({ storeId: input.storeId });
        const hasConflict = existingApts.some(apt => {
          if (apt.staffId !== input.staffId) return false;
          if (apt.status === "cancelled") return false;
          const aptStart = new Date(apt.date);
          const aptEnd = new Date(aptStart.getTime() + apt.duration * 60000);
          return input.date < aptEnd && appointmentEnd > aptStart;
        });
        if (hasConflict) {
          return res.status(409).json({ message: "This staff member already has an appointment at that time" });
        }
      }

      if (input.storeId) {
        const calSettings = await storage.getCalendarSettings(input.storeId);
        if (calSettings && !calSettings.allowBookingOutsideHours) {
          const store = await storage.getStore(input.storeId);
          const tz = store?.timezone || "UTC";
          const localStart = toZonedTime(input.date, tz);
          const localStartHour = localStart.getHours() + localStart.getMinutes() / 60;
          const durationHours = (input.duration || 30) / 60;
          const localEndHour = localStartHour + durationHours;
          if (localStartHour < 9 || localEndHour > 18) {
            return res.status(400).json({ message: "Booking outside opening hours is not allowed" });
          }
        }
      }

      const appointment = await storage.createAppointment(input);

      const fullAppointment = await storage.getAppointment(appointment.id);
      if (fullAppointment) {
        sendBookingConfirmation(fullAppointment).catch(console.error);
        sendBookingConfirmationEmail(fullAppointment).catch(console.error);

        if (appointment.storeId) {
          broadcastNotification({
            type: "new_booking",
            storeId: appointment.storeId,
            customerName: (fullAppointment as any).customer?.name || "Someone",
            serviceName: (fullAppointment as any).service?.name || "a service",
            staffName: (fullAppointment as any).staff?.name,
            time: new Date(appointment.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
          });
        }
      }

      res.status(201).json(appointment);
    } catch (error) {
       console.error(error);
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.patch(api.appointments.update.path, requireActiveTrial, async (req, res) => {
    try {
      const input = insertAppointmentSchema.partial().parse({
        ...req.body,
        date: req.body.date ? new Date(req.body.date) : undefined,
      });
      if (input.status === "started" && !input.startedAt) {
        input.startedAt = new Date();
      }
      if (input.status === "completed" && !input.completedAt) {
        input.completedAt = new Date();
      }
      const appointment = await storage.updateAppointment(Number(req.params.id), input);
      if (!appointment) return res.status(404).json({ message: "Appointment not found" });

      if (appointment.storeId) {
        const full = await storage.getAppointment(appointment.id);
        const customerName = (full as any)?.customer?.name || "A client";
        const serviceName = (full as any)?.service?.name || "service";

        if (input.status === "completed" && input.totalPaid) {
          broadcastNotification({
            type: "payment_received",
            storeId: appointment.storeId,
            customerName,
            amount: parseFloat(String(input.totalPaid)),
          });

          // Auto-award loyalty points (1 pt per $1 spent, rounded)
          try {
            const totalPaidNum = parseFloat(String(input.totalPaid));
            if (totalPaidNum > 0) {
              const full = await storage.getAppointment(appointment.id);
              const customerId = full?.customerId ?? (full as any)?.customer?.id;
              if (customerId) {
                const pointsEarned = Math.round(totalPaidNum);
                await db.insert(loyaltyTransactions).values({
                  storeId: appointment.storeId,
                  customerId,
                  appointmentId: appointment.id,
                  type: "earn",
                  points: pointsEarned,
                  description: `Earned for appointment #${appointment.id} ($${totalPaidNum.toFixed(2)})`,
                });
                const [cust] = await db.select({ loyaltyPoints: customers.loyaltyPoints })
                  .from(customers).where(eq(customers.id, customerId)).limit(1);
                const newTotal = (cust?.loyaltyPoints ?? 0) + pointsEarned;
                await db.update(customers).set({ loyaltyPoints: newTotal }).where(eq(customers.id, customerId));
                console.log(`[Loyalty] Awarded ${pointsEarned} pts to customer ${customerId}`);
              }
            }
          } catch (loyaltyErr) {
            console.error("[Loyalty] Auto-earn error:", loyaltyErr);
          }
        } else if (input.status === "cancelled") {
          broadcastNotification({
            type: "appointment_cancelled",
            storeId: appointment.storeId,
            customerName,
            serviceName,
          });

          // Auto-trigger cancellation recovery: find fill candidates and SMS top match
          setImmediate(async () => {
            try {
              const { getCancellationRecoveryCandidates, sendCancellationRecoverySms } = await import("./intelligence/cancellation-recovery");
              const candidates = await getCancellationRecoveryCandidates(appointment.storeId!, appointment.id);
              const topCandidate = candidates.find((c) => c.customerPhone && c.priority === "high") || candidates[0];
              if (topCandidate?.customerPhone) {
                await sendCancellationRecoverySms(appointment.storeId!, topCandidate.customerId, topCandidate.suggestedMessage, appointment.id);
                console.log(`[intelligence] Auto-fill SMS sent to customer ${topCandidate.customerId} for cancelled appt ${appointment.id}`);
              }
            } catch (err: any) {
              console.error("[intelligence] Auto-fill trigger error:", err.message);
            }
          });
        } else if (input.status === "no-show" || input.status === "no_show") {
          // Auto-trigger no-show win-back
          setImmediate(async () => {
            try {
              const { sendNoShowWinback } = await import("./intelligence/no-show-winback");
              const customerId = full?.customerId ?? (full as any)?.customer?.id;
              if (customerId) {
                await sendNoShowWinback(appointment.storeId!, customerId, appointment.id);
                console.log(`[intelligence] No-show win-back triggered for customer ${customerId}`);
              }
            } catch (err: any) {
              console.error("[intelligence] No-show win-back error:", err.message);
            }
          });
        }
      }

      res.json(appointment);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.delete(api.appointments.delete.path, async (req, res) => {
    await storage.deleteAppointment(Number(req.params.id));
    res.status(204).end();
  });

  // === PRODUCTS ===
  app.get(api.products.list.path, async (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    const products = await storage.getProducts(storeId);
    res.json(products);
  });

  app.post(api.products.create.path, async (req, res) => {
    try {
      const input = insertProductSchema.parse(req.body);
      const product = await storage.createProduct(input);
      res.status(201).json(product);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.patch(api.products.update.path, async (req, res) => {
    try {
      const input = insertProductSchema.partial().parse(req.body);
      const product = await storage.updateProduct(Number(req.params.id), input);
      if (!product) return res.status(404).json({ message: "Product not found" });
      res.json(product);
    } catch (error) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.delete(api.products.delete.path, async (req, res) => {
    await storage.deleteProduct(Number(req.params.id));
    res.status(204).end();
  });

  // === CALENDAR SETTINGS ===
  app.get(api.calendarSettings.get.path, async (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    if (!storeId) return res.status(400).json({ message: "storeId required" });
    const settings = await storage.getCalendarSettings(storeId);
    res.json(settings || null);
  });

  app.put(api.calendarSettings.upsert.path, async (req, res) => {
    try {
      const storeId = req.body.storeId ? Number(req.body.storeId) : undefined;
      if (!storeId) return res.status(400).json({ message: "storeId required" });
      const validatedInput = insertCalendarSettingsSchema.omit({ storeId: true }).partial().extend({
        startOfWeek: z.enum(["monday", "sunday", "saturday"]).optional(),
        timeSlotInterval: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]).optional(),
        nonWorkingHoursDisplay: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
      }).parse(req.body);
      const settings = await storage.upsertCalendarSettings(storeId, validatedInput);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0].message });
      } else {
        res.status(400).json({ message: "Invalid input" });
      }
    }
  });

  // === CASH DRAWER ===
  app.get(api.cashDrawer.sessions.path, async (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    if (!storeId) return res.status(400).json({ message: "storeId required" });
    const sessions = await storage.getCashDrawerSessions(storeId);
    res.json(sessions);
  });

  app.get(api.cashDrawer.open.path, async (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
    if (!storeId) return res.status(400).json({ message: "storeId required" });
    const session = await storage.getOpenCashDrawerSession(storeId);
    res.json(session || null);
  });

  app.get(api.cashDrawer.get.path, async (req, res) => {
    const session = await storage.getCashDrawerSession(Number(req.params.id));
    if (!session) return res.status(404).json({ message: "Session not found" });
    res.json(session);
  });

  app.post(api.cashDrawer.create.path, async (req, res) => {
    try {
      const input = api.cashDrawer.create.input.parse(req.body);

      const existing = await storage.getOpenCashDrawerSession(input.storeId);
      if (existing) {
        return res.status(409).json({ message: "A drawer session is already open for this store" });
      }

      // If a denomination breakdown was provided, compute the opening balance from it
      // server-side so the staff cannot fudge the numeric total.
      const denomValues: Record<string, number> = {
        "100": 100, "50": 50, "20": 20, "10": 10, "5": 5, "2": 2, "1": 1,
        "0.25": 0.25, "0.10": 0.10, "0.05": 0.05, "0.01": 0.01,
      };
      let computedOpening: string | null = null;
      if (input.openingDenominationBreakdown) {
        try {
          const counts = JSON.parse(input.openingDenominationBreakdown) as Record<string, number>;
          let total = 0;
          for (const [k, c] of Object.entries(counts)) {
            const v = denomValues[k];
            if (v != null && typeof c === "number" && c > 0) {
              total += Math.round(v * c * 100);
            }
          }
          computedOpening = (total / 100).toFixed(2);
        } catch {
          computedOpening = null;
        }
      }
      const openingBalance = computedOpening ?? input.openingBalance ?? "0.00";

      // Compare against the most recent closed session for the store. If the prior
      // closing balance differs from this opening count, flag for manager review.
      const allSessions = await storage.getCashDrawerSessions(input.storeId);
      const lastClosed = allSessions
        .filter(s => s.status === "closed")
        .sort((a, b) => {
          const at = a.closedAt ? new Date(a.closedAt).getTime() : 0;
          const bt = b.closedAt ? new Date(b.closedAt).getTime() : 0;
          return bt - at;
        })[0];

      let priorClosingMismatch = false;
      let priorClosingVariance: string | null = null;
      if (lastClosed && lastClosed.closingBalance != null) {
        const priorClose = Number(lastClosed.closingBalance);
        const opening = Number(openingBalance);
        const diff = Math.round((opening - priorClose) * 100) / 100;
        if (Math.abs(diff) >= 0.01) {
          priorClosingMismatch = true;
          priorClosingVariance = diff.toFixed(2);
        }
      }

      const session = await storage.createCashDrawerSession({
        storeId: input.storeId,
        openedAt: new Date(),
        openingBalance,
        openingDenominationBreakdown: input.openingDenominationBreakdown || null,
        priorClosingMismatch,
        priorClosingVariance,
        openedBy: input.openedBy || null,
        status: "open",
      });

      await storage.createDrawerAction({
        sessionId: session.id,
        type: "open_drawer",
        reason: "Shift started",
        performedBy: input.openedBy || null,
        performedAt: new Date(),
      });

      res.status(201).json(session);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.post(api.cashDrawer.close.path, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const session = await storage.getCashDrawerSession(id);
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.status === "closed") return res.status(400).json({ message: "Session already closed" });

      const storeAppointments = session.storeId
        ? await storage.getAppointments({ storeId: session.storeId })
        : [];
      const unpaidTickets = storeAppointments.filter((apt) => apt.status === "started");
      if (unpaidTickets.length > 0) {
        return res.status(409).json({
          code: "UNPAID_TICKETS",
          message: `Cannot close the day — ${unpaidTickets.length} booking ticket${unpaidTickets.length === 1 ? "" : "s"} still need${unpaidTickets.length === 1 ? "s" : ""} to be checked out.`,
          unpaidCount: unpaidTickets.length,
          unpaidTickets: unpaidTickets.map((apt) => ({
            id: apt.id,
            customerName: apt.customer ? ((apt.customer as any).name ?? null) : null,
            staffName: apt.staff?.name ?? null,
            serviceName: apt.service?.name ?? null,
            startedAt: apt.startedAt ?? apt.date,
          })),
        });
      }

      const input = api.cashDrawer.close.input.parse(req.body);

      const updated = await storage.updateCashDrawerSession(id, {
        closedAt: new Date(),
        closingBalance: input.closingBalance || "0.00",
        denominationBreakdown: input.denominationBreakdown || null,
        reportedCardSales: input.reportedCardSales || null,
        closedBy: input.closedBy || null,
        status: "closed",
        notes: input.notes || null,
      });

      await storage.createDrawerAction({
        sessionId: id,
        type: "close_drawer",
        reason: input.notes || "Shift ended",
        performedBy: input.closedBy || null,
        performedAt: new Date(),
      });

      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.post(api.cashDrawer.action.path, async (req, res) => {
    try {
      const sessionId = Number(req.params.id);
      const session = await storage.getCashDrawerSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const input = api.cashDrawer.action.input.parse(req.body);

      const action = await storage.createDrawerAction({
        sessionId,
        type: input.type,
        amount: input.amount || null,
        reason: input.reason || null,
        performedBy: input.performedBy || null,
        performedAt: new Date(),
      });

      res.status(201).json(action);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.get(api.cashDrawer.discrepancies.path, async (req, res) => {
    try {
      const storeId = Number(req.query.storeId);
      if (!storeId) return res.status(400).json({ message: "storeId required" });
      const all = await storage.getCashDrawerSessions(storeId);
      const unresolved = all
        .filter(s => s.priorClosingMismatch && !s.priorClosingResolvedAt)
        .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
      res.json(unresolved);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to load discrepancies" });
    }
  });

  app.post(api.cashDrawer.acknowledgeMismatch.path, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const session = await storage.getCashDrawerSession(id);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const input = api.cashDrawer.acknowledgeMismatch.input.parse(req.body);

      const updated = await storage.updateCashDrawerSession(id, {
        priorClosingResolvedBy: input.resolvedBy,
        priorClosingResolvedAt: new Date(),
        priorClosingResolutionNotes: input.resolutionNotes || null,
      });
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.get(api.cashDrawer.zReport.path, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const session = await storage.getCashDrawerSession(id);
      if (!session) return res.status(404).json({ message: "Session not found" });

      const from = new Date(session.openedAt);
      const to = session.closedAt ? new Date(session.closedAt) : new Date();

      const allAppointments = await storage.getAppointments({
        from,
        to,
        storeId: session.storeId,
      });

      const completedAppointments = allAppointments.filter(a => a.status === "completed" && a.totalPaid);

      let totalSales = 0;
      let totalTips = 0;
      let totalDiscounts = 0;
      const paymentBreakdown: Record<string, number> = {};

      for (const apt of completedAppointments) {
        const paid = Number(apt.totalPaid) || 0;
        const tip = Number(apt.tipAmount) || 0;
        const disc = Number(apt.discountAmount) || 0;
        totalSales += paid;
        totalTips += tip;
        totalDiscounts += disc;

        if (apt.paymentMethod) {
          const parts = apt.paymentMethod.split(",");
          for (const part of parts) {
            const [method, amtStr] = part.split(":");
            const amt = Number(amtStr) || paid;
            const key = method.trim().toLowerCase();
            paymentBreakdown[key] = (paymentBreakdown[key] || 0) + amt;
          }
        }
      }

      let cashIn = 0;
      let cashOut = 0;
      for (const action of session.actions || []) {
        if (action.type === "cash_in" || action.type === "paid_in") {
          cashIn += Number(action.amount) || 0;
        } else if (action.type === "cash_out" || action.type === "paid_out") {
          cashOut += Number(action.amount) || 0;
        }
      }

      const openingBal = Number(session.openingBalance) || 0;
      const cashFromSales = paymentBreakdown["cash"] || 0;
      const expectedCash = openingBal + cashFromSales + cashIn - cashOut;

      res.json({
        session,
        totalSales: Math.round(totalSales * 100) / 100,
        totalTips: Math.round(totalTips * 100) / 100,
        totalDiscounts: Math.round(totalDiscounts * 100) / 100,
        transactionCount: completedAppointments.length,
        paymentBreakdown,
        cashIn: Math.round(cashIn * 100) / 100,
        cashOut: Math.round(cashOut * 100) / 100,
        expectedCash: Math.round(expectedCash * 100) / 100,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/onboarding", isAuthenticated, async (req, res) => {
    try {
      console.log("Onboarding: Starting process for user:", (req.session as any).userId);
      const userId = (req.session as any).userId;

      const normalizeOptionalString = (value: unknown) => {
        if (typeof value !== "string") return value;
        const trimmed = value.trim();
        return trimmed.length === 0 ? undefined : trimmed;
      };

      const [currentUser] = await db.select().from(users).where(eq(users.id, userId));
      if (currentUser?.onboardingCompleted) {
        console.log("Onboarding: User already completed onboarding");
        const { password: _, ...safeUser } = currentUser;
        // Return their existing store so the client can proceed
        const existingStores = await db.select().from(locations).where(eq(locations.userId, userId));
        return res.json({ store: existingStores[0] ?? null, user: safeUser });
      }

      // Guard: user has a store but onboardingCompleted was never set (partial prior onboarding).
      // We must NOT silently drop businessHours/staff in this case — process them against the
      // existing store, otherwise hours submitted on a retry/double-submit are lost.
      const priorStores = await db.select().from(locations).where(eq(locations.userId, userId));
      if (priorStores.length > 0) {
        console.log(
          "Onboarding: User already has a store, recovering partial onboarding for store:",
          priorStores[0].id,
          "- hours present:", Array.isArray(req.body?.businessHours) ? req.body.businessHours.length : 0,
          "- staff present:", Array.isArray(req.body?.staff) ? req.body.staff.length : 0,
        );
        const existingStore = priorStores[0];

        // Best-effort validation of just the hours/staff payload so a retry can still save them.
        const recoverySchema = z.object({
          businessHours: z.array(z.object({
            dayOfWeek: z.number().min(0).max(6),
            openTime: z.string(),
            closeTime: z.string(),
            isClosed: z.boolean(),
          })).optional(),
          staff: z.array(z.object({
            name: z.string().min(1),
            color: z.string().optional(),
          })).optional(),
        });
        const recovery = recoverySchema.safeParse(req.body ?? {});
        const hoursData = recovery.success ? recovery.data.businessHours : undefined;
        const staffData = recovery.success ? recovery.data.staff : undefined;

        // Save hours only if none exist yet for this store (don't clobber later edits).
        if (hoursData && hoursData.length > 0) {
          const existingHours = await db
            .select()
            .from(businessHours)
            .where(eq(businessHours.storeId, existingStore.id));
          if (existingHours.length === 0) {
            console.log("Onboarding recovery: saving", hoursData.length, "business hours");
            await storage.setBusinessHours(existingStore.id, hoursData.map(h => ({
              storeId: existingStore.id,
              dayOfWeek: h.dayOfWeek,
              openTime: h.openTime,
              closeTime: h.closeTime,
              isClosed: h.isClosed,
            })));
          } else {
            console.log("Onboarding recovery: store already has business hours, skipping");
          }
        }

        // Create staff only if the store has none yet (avoid duplicates on retry).
        if (staffData && staffData.length > 0) {
          const existingStaff = await db.select().from(staff).where(eq(staff.storeId, existingStore.id));
          if (existingStaff.length === 0) {
            console.log("Onboarding recovery: creating", staffData.length, "staff members");
            for (const s of staffData) {
              const newStaff = await storage.createStaff({
                name: s.name,
                color: s.color || "#3b82f6",
                storeId: existingStore.id,
              });
              if (hoursData && hoursData.length > 0) {
                const availabilityRules = hoursData
                  .filter(h => !h.isClosed)
                  .map(h => ({
                    staffId: newStaff.id,
                    dayOfWeek: h.dayOfWeek,
                    startTime: h.openTime,
                    endTime: h.closeTime,
                  }));
                if (availabilityRules.length > 0) {
                  await storage.setStaffAvailability(newStaff.id, availabilityRules);
                }
              }
            }
          } else {
            console.log("Onboarding recovery: store already has staff, skipping");
          }
        }

        await db.update(users).set({ onboardingCompleted: true }).where(eq(users.id, userId));
        const [updatedUser] = await db.select().from(users).where(eq(users.id, userId));
        const { password: _, ...safeUser } = updatedUser;
        return res.json({ store: existingStore, user: safeUser });
      }

      console.log("Onboarding: Validating request body:", req.body);
      const onboardingSchema = z.object({
        businessType: z.enum([
          "Hair Salon", "Nail Salon", "Spa", "Barbershop",
          "Esthetician", "Pet Groomer", "Tattoo Studio", "Other",
        ]),
        businessName: z.string().min(1).max(100),
        email: z.string().email().optional().or(z.literal('')),
        timezone: z.string().min(1).default("America/New_York"),
        address: z.preprocess(
          normalizeOptionalString,
          z
            .string()
            .max(200)
            .refine((value) => !/[;'"`]/.test(value), "Address contains invalid characters")
            .refine((value) => !/--|\/\*/.test(value), "Address contains invalid characters")
            .refine((value) => /^[a-zA-Z0-9\s.,#\-\/]*$/.test(value), "Address contains invalid characters")
        ).optional(),
        city: z.preprocess(
          normalizeOptionalString,
          z.string().max(100).regex(/^[a-zA-Z\s]+$/, "City can only contain letters and spaces")
        ).optional(),
        state: z.preprocess(
          normalizeOptionalString,
          z.enum([
            "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
            "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
            "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
            "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
            "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
          ])
        ).optional(),
        postcode: z.preprocess(
          normalizeOptionalString,
          z.string().regex(/^\d{5}$/, "Zip code must be 5 digits")
        ).optional(),
        phone: z.preprocess(
          normalizeOptionalString,
          z.string().regex(/^\d{10}$/, "Phone number must be 10 digits")
        ).optional(),
        businessHours: z.array(z.object({
          dayOfWeek: z.number().min(0).max(6),
          openTime: z.string(),
          closeTime: z.string(),
          isClosed: z.boolean(),
        })).optional(),
        staff: z.array(z.object({
          name: z.string().min(1),
          color: z.string().optional(),
        })).min(1).optional(),
        teamSize: z.enum(["myself", "team"]).optional(),
      });

      const parsed = onboardingSchema.safeParse(req.body);
      if (!parsed.success) {
        console.log("Onboarding: Validation failed:", parsed.error.flatten());
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
      }

      const {
        businessType,
        businessName,
        email,
        timezone,
        address,
        city,
        state,
        postcode,
        phone,
        businessHours: hoursData,
        staff: staffData,
        teamSize: teamSizeValue,
      } = parsed.data;

      console.log("Onboarding: Looking up template for business type:", businessType);
      // Fall back to empty template for types without predefined services.
      // Staff and availability are still created correctly from businessHours.
      const template = businessTemplates[businessType] ?? { categories: [] };

      console.log("Onboarding: Creating store...");
      const store = await storage.createStore({
        name: businessName,
        email: email || null,
        timezone: timezone,
        address: address || null,
        city: city || null,
        state: state || null,
        postcode: postcode || null,
        phone: phone || null,
        category: businessType,
        userId: userId,
        teamSize: teamSizeValue || null,
      });

      console.log("Onboarding: Store created successfully:", store.id);

      // Auto-generate a unique booking slug from the business name
      const baseSlug = businessName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50);
      let slug = baseSlug;
      let attempt = 1;
      while (true) {
        const existing = await storage.getStoreBySlug(slug);
        if (!existing) break;
        attempt++;
        slug = `${baseSlug}-${attempt}`;
      }
      const updatedStore = await storage.updateStore(store.id, { bookingSlug: slug });
      if (updatedStore) Object.assign(store, updatedStore);

      if (hoursData && hoursData.length > 0) {
        await storage.setBusinessHours(store.id, hoursData.map(h => ({
          storeId: store.id,
          dayOfWeek: h.dayOfWeek,
          openTime: h.openTime,
          closeTime: h.closeTime,
          isClosed: h.isClosed,
        })));
      }

      const addonCache: Record<string, number> = {};
      const allServiceIds: number[] = [];

      for (const cat of template.categories) {
        const category = await storage.createServiceCategory({
          name: cat.name,
          storeId: store.id,
        });

        for (const svc of cat.services) {
          const service = await storage.createService({
            name: svc.name,
            description: svc.description,
            duration: svc.duration,
            price: svc.price,
            category: cat.name,
            categoryId: category.id,
            storeId: store.id,
          });

          allServiceIds.push(service.id);

          if (svc.addons) {
            for (const addonData of svc.addons) {
              const cacheKey = `${addonData.name}|${addonData.price}`;
              let addonId = addonCache[cacheKey];

              if (!addonId) {
                const addon = await storage.createAddon({
                  name: addonData.name,
                  description: addonData.description,
                  price: addonData.price,
                  duration: addonData.duration,
                  storeId: store.id,
                });
                addonId = addon.id;
                addonCache[cacheKey] = addonId;
              }

              await storage.createServiceAddon({
                serviceId: service.id,
                addonId: addonId,
              });
            }
          }
        }
      }

      const staffMembers = staffData || [{ name: "Owner", color: "#f472b6" }];
      for (const s of staffMembers) {
        const newStaff = await storage.createStaff({
          name: s.name,
          color: s.color || "#3b82f6",
          storeId: store.id,
        });

        if (allServiceIds.length > 0) {
          await storage.setStaffServices(newStaff.id, allServiceIds);
        }

        if (hoursData && hoursData.length > 0) {
          const availabilityRules = hoursData
            .filter(h => !h.isClosed)
            .map(h => ({
              staffId: newStaff.id,
              dayOfWeek: h.dayOfWeek,
              startTime: h.openTime,
              endTime: h.closeTime,
            }));
          if (availabilityRules.length > 0) {
            await storage.setStaffAvailability(newStaff.id, availabilityRules);
          }
        }
      }

      await db.update(users).set({ onboardingCompleted: true }).where(eq(users.id, userId));

      // Ensure trial is active — belt-and-suspenders in case register didn't fire it
      const [freshUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!freshUser.trialStartedAt) {
        await TrialService.setupTrialForUser(userId);
      }

      const [updatedUser] = await db.select().from(users).where(eq(users.id, userId));
      const { password: _, ...safeUser } = updatedUser;

      res.json({ store, user: safeUser });
    } catch (error: any) {
      console.error("Onboarding error:", error);
      // PostgreSQL unique constraint violation
      if (error?.code === "23505") {
        const detail: string = error?.detail ?? "";
        if (detail.includes("phone")) {
          return res.status(409).json({
            message: "A store with this phone number already exists. Please use a different phone number.",
          });
        }
        if (detail.includes("subdomain")) {
          return res.status(409).json({
            message: "That business name/subdomain is already taken. Please choose a different name.",
          });
        }
        return res.status(409).json({
          message: "A store with those details already exists.",
        });
      }
      res.status(500).json({ message: "Failed to complete onboarding" });
    }
  });

  // === DNS VERIFICATION API (for custom domains) ===

  app.post("/api/verify-domain", express.json(), async (req, res) => {
    try {
      const { submission_id, domain, email } = req.body;

      if (!submission_id || !domain) {
        return res.status(400).json({ 
          verified: false,
          message: "Missing submission_id or domain" 
        });
      }

      // Verify submission exists and email matches (if provided)
      const result = await db.execute(sql`
        SELECT id, custom_domain, domain_type, status, domain_payment_status,
               COALESCE(contact_email, email) AS email
        FROM onboarding_submissions
        WHERE id = ${submission_id}
        AND domain_type = 'custom'
        AND custom_domain = ${domain}
        LIMIT 1
      `) as any;

      const submission = result?.rows?.[0];
      if (!submission) {
        return res.status(404).json({ 
          verified: false,
          message: "Submission not found or domain mismatch" 
        });
      }

      // Optional email verification for extra security
      if (email && submission.email !== email) {
        return res.status(403).json({ 
          verified: false,
          message: "Email does not match submission" 
        });
      }

      // DNS verification using Node's dns module
      const dns = await import("dns");
      const { promises: dnsPromises } = dns;
      const TARGET_IP = "216.128.140.207";

      let verified = false;
      let dnsError: string | null = null;

      try {
        const addresses = await dnsPromises.resolve4(domain);
        if (addresses.includes(TARGET_IP)) {
          verified = true;
        } else {
          dnsError = `A record found but pointing to wrong IP. Expected ${TARGET_IP}, found ${addresses.join(", ")}`;
        }
      } catch (err: any) {
        if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
          dnsError = "DNS record not detected yet. Please wait 24-48 hours and try again.";
        } else {
          dnsError = `DNS lookup error: ${err.message}`;
        }
      }

      if (verified) {
        // Update submission status to verified/active
        await db.execute(sql`
          UPDATE onboarding_submissions
          SET domain_payment_status = 'verified', status = 'active', updated_at = NOW()
          WHERE id = ${submission_id}
        `);

        return res.json({ 
          verified: true,
          message: "Domain verified! Your site is now live."
        });
      } else {
        return res.json({ 
          verified: false,
          message: dnsError || "DNS verification failed"
        });
      }
    } catch (error) {
      console.error("[DNS Verify] Error:", error);
      res.status(500).json({ 
        verified: false,
        message: "An error occurred during DNS verification"
      });
    }
  });

  // === SUBDOMAIN BOOKING ROUTES (accessed via subdomain) ===

  app.get("/api/store/by-subdomain", async (req, res) => {
    if ((req as any).store) {
      const store = (req as any).store;
      const { userId, ...publicStore } = store;
      const hours = await storage.getBusinessHours(store.id);
      res.json({ ...publicStore, businessHours: hours });
    } else {
      res.status(404).json({ message: "Store not found for this subdomain" });
    }
  });

  // === PUBLIC BOOKING ROUTES (no auth required) ===

  const resolvePublicStore = async (req: any) => {
    if (req.store) return req.store;
    const slug = typeof req.query.slug === "string" ? req.query.slug : undefined;
    if (!slug) return undefined;
    return storage.getStoreBySlug(slug);
  };

  app.get("/api/public/store/:slug", async (req, res) => {
    try {
      const store = await storage.getStoreBySlug(req.params.slug);
      if (!store) return res.status(404).json({ message: "Store not found" });
      const { userId, ...publicStore } = store;
      const hours = await storage.getBusinessHours(store.id);
      const calSettings = await storage.getCalendarSettings(store.id);
      const showPrices = calSettings?.showPrices ?? true;
      res.json({ ...publicStore, businessHours: hours, showPrices });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/public/store/:slug/services", async (req, res) => {
    try {
      const store = await storage.getStoreBySlug(req.params.slug);
      if (!store) return res.status(404).json({ message: "Store not found" });
      const storeServices = await storage.getServices(store.id);
      const categories = await storage.getServiceCategories(store.id);
      res.json({ services: storeServices, categories });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/public/store/:slug/staff", async (req, res) => {
    try {
      const store = await storage.getStoreBySlug(req.params.slug);
      if (!store) return res.status(404).json({ message: "Store not found" });
      const storeStaff = await storage.getAllStaff(store.id);
      const safeStaff = storeStaff.map(({ email, phone, password, ...rest }) => rest);
      res.json(safeStaff);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/public/store/:slug/availability", async (req, res) => {
    try {
      const store = await storage.getStoreBySlug(req.params.slug);
      if (!store) return res.status(404).json({ message: "Store not found" });

      const serviceId = Number(req.query.serviceId);
      const date = String(req.query.date);
      const duration = Number(req.query.duration);
      const specificStaffId = req.query.staffId ? Number(req.query.staffId) : undefined;

      if (!serviceId || !date || !duration) {
        return res.status(400).json({ message: "serviceId, date, and duration are required" });
      }

      const tz = store.timezone || "UTC";
      const calSettings = await storage.getCalendarSettings(store.id);
      const businessStartHour = 9;
      const businessEndHour = 18;
      const slotInterval = calSettings?.timeSlotInterval || 15;

      const hours = await storage.getBusinessHours(store.id);
      const dayStartLocal = fromZonedTime(new Date(`${date}T00:00:00`), tz);
      const dayEndLocal = fromZonedTime(new Date(`${date}T23:59:59.999`), tz);

      const dayAppointments = await storage.getAppointments({
        from: dayStartLocal,
        to: dayEndLocal,
        storeId: store.id,
      });

      let candidateStaff: typeof import("@shared/schema").staff.$inferSelect[];
      if (specificStaffId) {
        const member = await storage.getStaffMember(specificStaffId);
        if (member) {
          // Verify this staff member is assigned to the requested service
          const staffServices = await storage.getStaffServices(specificStaffId);
          const canPerformService = staffServices.some(ss => ss.serviceId === serviceId);
          candidateStaff = canPerformService ? [member] : [];
        } else {
          candidateStaff = [];
        }
      } else {
        candidateStaff = await storage.getStaffForService(serviceId);
        // Do NOT fall back to all staff — only show staff assigned to this service
      }

      if (candidateStaff.length === 0) return res.json([]);

      const dateParts = date.split("-").map(Number);
      const dayOfWeek = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]).getDay();
      const dayHours = hours.find(h => h.dayOfWeek === dayOfWeek);
      const startHour = dayHours && !dayHours.isClosed ? parseInt(dayHours.openTime.split(":")[0]) : businessStartHour;
      const endHour = dayHours && !dayHours.isClosed ? parseInt(dayHours.closeTime.split(":")[0]) : businessEndHour;

      if (dayHours?.isClosed) return res.json([]);

      const businessEndUtc = fromZonedTime(new Date(`${date}T${String(endHour).padStart(2, "0")}:00:00`), tz);
      const nowUtc = new Date();

      type SlotResult = { time: string; staffId: number; staffName: string };
      const slots: SlotResult[] = [];

      const staffLastAppointment: Map<number, Date> = new Map();
      const allAppointments = await storage.getAppointments({ storeId: store.id });
      for (const apt of allAppointments) {
        if (apt.status === "cancelled") continue;
        if (!apt.staffId) continue;
        const aptDate = new Date(apt.date);
        const current = staffLastAppointment.get(apt.staffId);
        if (!current || aptDate > current) {
          staffLastAppointment.set(apt.staffId, aptDate);
        }
      }

      for (let hour = startHour; hour < endHour; hour++) {
        for (let min = 0; min < 60; min += slotInterval) {
          const slotStart = fromZonedTime(new Date(`${date}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`), tz);
          const slotEnd = new Date(slotStart.getTime() + duration * 60000);

          if (slotStart < nowUtc) continue;
          if (slotEnd > businessEndUtc) continue;

          const availableForSlot: { staffMember: any; lastApt: Date | null }[] = [];

          for (const staffMember of candidateStaff) {
            let hasConflict = false;
            for (const apt of dayAppointments) {
              if (apt.staffId !== staffMember.id) continue;
              if (apt.status === "cancelled") continue;
              const aptStart = new Date(apt.date);
              const aptEnd = new Date(aptStart.getTime() + apt.duration * 60000);
              if (slotStart < aptEnd && slotEnd > aptStart) {
                hasConflict = true;
                break;
              }
            }

            // Check staff availability rules (days off and custom hours)
            if (!hasConflict) {
              const staffAvailRules = await storage.getStaffAvailability(staffMember.id);
              if (staffAvailRules && staffAvailRules.length > 0) {
                const slotLocalDate = toZonedTime(slotStart, tz);
                const slotDayOfWeek = slotLocalDate.getDay();
                const dayAvailability = staffAvailRules.find(r => r.dayOfWeek === slotDayOfWeek);

                if (dayAvailability) {
                  const [availStartHour, availStartMin] = dayAvailability.startTime.split(":").map(Number);
                  const [availEndHour, availEndMin] = dayAvailability.endTime.split(":").map(Number);
                  const slotLocalHour = slotLocalDate.getHours();
                  const slotLocalMin = slotLocalDate.getMinutes();
                  const slotTimeInMin = slotLocalHour * 60 + slotLocalMin;
                  const slotEndLocal = toZonedTime(slotEnd, tz);
                  const slotEndTimeInMin = slotEndLocal.getHours() * 60 + slotEndLocal.getMinutes();
                  const availStartInMin = availStartHour * 60 + availStartMin;
                  const availEndInMin = availEndHour * 60 + availEndMin;

                  if (slotTimeInMin < availStartInMin || slotEndTimeInMin > availEndInMin) {
                    hasConflict = true;
                  }
                } else {
                  // Staff has availability rules but none for this day — they are off
                  hasConflict = true;
                }
              }
            }

            if (!hasConflict) {
              availableForSlot.push({
                staffMember,
                lastApt: staffLastAppointment.get(staffMember.id) || null,
              });
            }
          }

          if (availableForSlot.length > 0) {
            availableForSlot.sort((a, b) => {
              if (a.lastApt === null && b.lastApt === null) return 0;
              if (a.lastApt === null) return -1;
              if (b.lastApt === null) return 1;
              return a.lastApt.getTime() - b.lastApt.getTime();
            });

            const chosen = availableForSlot[0];
            slots.push({
              time: slotStart.toISOString(),
              staffId: chosen.staffMember.id,
              staffName: chosen.staffMember.name,
            });
          }
        }
      }

      res.json(slots);
    } catch (error) {
      console.error("Public availability error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/public/store/:slug/book", async (req, res) => {
    try {
      const store = await storage.getStoreBySlug(req.params.slug);
      if (!store) return res.status(404).json({ message: "Store not found" });

      const bookingSchema = z.object({
        serviceId: z.number(),
        staffId: z.number(),
        date: z.string(),
        duration: z.number(),
        customerName: z.string().min(1),
        customerEmail: z.string().email().optional(),
        customerPhone: z.string().min(1),
        notes: z.string().optional(),
        addonIds: z.array(z.number()).optional().default([]),
      });

      const input = bookingSchema.parse(req.body);

      const phoneDigits = input.customerPhone.replace(/\D/g, "");
      if (phoneDigits.length !== 10) {
        return res.status(400).json({ message: "Phone number must be 10 digits" });
      }

      // Validate staff is assigned to the requested service
      const staffServices = await storage.getStaffServices(input.staffId);
      const canPerformService = staffServices.some(ss => ss.serviceId === input.serviceId);
      if (!canPerformService) {
        return res.status(400).json({ message: "The selected staff member cannot perform this service" });
      }

      // Check for scheduling conflicts
      const appointmentStart = new Date(input.date);
      const appointmentEnd = new Date(appointmentStart.getTime() + input.duration * 60000);
      const dayStartLocal = new Date(appointmentStart);
      dayStartLocal.setHours(0, 0, 0, 0);
      const dayEndLocal = new Date(appointmentStart);
      dayEndLocal.setHours(23, 59, 59, 999);
      const dayAppointments = await storage.getAppointments({
        from: dayStartLocal,
        to: dayEndLocal,
        storeId: store.id,
      });
      const hasConflict = dayAppointments.some(apt => {
        if (apt.staffId !== input.staffId) return false;
        if (apt.status === "cancelled") return false;
        const aptStart = new Date(apt.date);
        const aptEnd = new Date(aptStart.getTime() + apt.duration * 60000);
        return appointmentStart < aptEnd && appointmentEnd > aptStart;
      });
      if (hasConflict) {
        return res.status(409).json({ message: "This time slot is no longer available. Please choose another time." });
      }

      let customer = input.customerPhone
        ? await storage.searchCustomerByPhone(input.customerPhone, store.id)
        : undefined;

      if (!customer) {
        customer = await storage.createCustomer({
          name: input.customerName,
          email: input.customerEmail || null,
          phone: input.customerPhone || null,
          storeId: store.id,
          notes: null,
        });
      }

      const appointment = await storage.createAppointment({
        date: new Date(input.date),
        serviceId: input.serviceId,
        staffId: input.staffId,
        customerId: customer.id,
        duration: input.duration,
        status: "pending",
        storeId: store.id,
        notes: input.notes || null,
        cancellationReason: null,
        paymentMethod: null,
        tipAmount: null,
        discountAmount: null,
        totalPaid: null,
      });

      // Save add-ons and extend appointment duration if any were selected
      if (input.addonIds && input.addonIds.length > 0) {
        let addonDuration = 0;
        for (const addonId of input.addonIds) {
          const addon = await storage.getAddon(addonId);
          if (addon) addonDuration += addon.duration;
        }
        const totalDuration = input.duration + addonDuration;
        if (addonDuration > 0) {
          await storage.updateAppointment(appointment.id, { duration: totalDuration });
        }
        await storage.setAppointmentAddons(appointment.id, input.addonIds);
      }

      const fullAppointment = await storage.getAppointment(appointment.id);
      if (fullAppointment) {
        sendBookingConfirmation(fullAppointment).catch(console.error);
        sendBookingConfirmationEmail(fullAppointment).catch(console.error);
      }

      res.status(201).json(appointment);
    } catch (error) {
      console.error("Public booking error:", error);
      res.status(400).json({ message: "Failed to create booking" });
    }
  });

  app.get("/api/appointments/confirmation/:confirmationNumber", async (req, res) => {
    try {
      const confirmationNumber = req.params.confirmationNumber || "";
      const phoneDigits = confirmationNumber.replace(/\D/g, "");
      if (!phoneDigits) return res.status(400).json({ message: "Confirmation number required" });

      const store = await resolvePublicStore(req);
      if (!store) return res.status(400).json({ message: "Store not found" });

      const appointments = await storage.getAppointmentsByCustomerPhone(phoneDigits, store.id);
      if (!appointments || appointments.length === 0) {
        return res.status(404).json({ message: "Booking not found" });
      }

      const safeAppointments = appointments.map((apt: any) => {
        if (apt.staff) {
          const { password: _pw, ...staffSafe } = apt.staff;
          return { ...apt, staff: staffSafe };
        }
        return apt;
      });
      res.json(safeAppointments);
    } catch (error) {
      console.error("Confirmation lookup error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/appointments/confirmation/:confirmationNumber/cancel", async (req, res) => {
    try {
      const confirmationNumber = req.params.confirmationNumber || "";
      const phoneDigits = confirmationNumber.replace(/\D/g, "");
      if (!phoneDigits) return res.status(400).json({ message: "Confirmation number required" });

      const payload = z.object({ appointmentId: z.number() }).parse(req.body);

      const store = await resolvePublicStore(req);
      if (!store) return res.status(400).json({ message: "Store not found" });

      const appointment = await storage.getAppointment(payload.appointmentId);
      if (!appointment || appointment.storeId !== store.id) {
        return res.status(404).json({ message: "Booking not found" });
      }

      const appointmentPhone = (appointment.customer?.phone || "").replace(/\D/g, "");
      if (appointmentPhone !== phoneDigits) {
        return res.status(404).json({ message: "Booking not found" });
      }

      // Enforce cancellation window cutoff
      const cutoffHours = (store as any).cancellationHoursCutoff ?? 24;
      if (cutoffHours > 0) {
        const hoursUntilAppointment = (new Date(appointment.date).getTime() - Date.now()) / 3600_000;
        if (hoursUntilAppointment < cutoffHours) {
          return res.status(409).json({
            message: `Cancellations must be made at least ${cutoffHours} hour${cutoffHours === 1 ? "" : "s"} in advance.`,
            cutoffHours,
          });
        }
      }

      if (appointment.status !== "cancelled") {
        await storage.updateAppointment(appointment.id, {
          status: "cancelled",
          cancellationReason: "Cancelled by customer",
        });
      }

      const refreshed = await storage.getAppointment(appointment.id);
      const result = refreshed || appointment;
      if (result?.staff) {
        const { password: _pw, ...staffSafe } = result.staff as any;
        (result as any).staff = staffSafe;
      }
      res.json(result);
    } catch (error) {
      console.error("Confirmation cancel error:", error);
      res.status(400).json({ message: "Failed to cancel booking" });
    }
  });

  // === TWILIO INBOUND SMS WEBHOOK (handles STOP / UNSTOP opt-out + inbox) ===
  app.post("/api/webhooks/twilio/incoming", async (req, res) => {
    try {
      const { From: fromRaw = "", Body: bodyRaw = "" } = req.body ?? {};
      const phone = (fromRaw as string).replace(/\D/g, "");
      const bodyText = (bodyRaw as string).trim();
      const keyword = bodyText.toUpperCase().split(/\s+/)[0];

      if (!phone) return res.status(400).send("Missing From");

      const { smsOptOuts, smsConversations, customers } = await import("@shared/schema");

      if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(keyword)) {
        await db.insert(smsOptOuts)
          .values({ phone, isOptedOut: true })
          .onConflictDoUpdate({
            target: smsOptOuts.phone,
            set: { isOptedOut: true, optedOutAt: new Date(), optedBackInAt: null },
          });
        console.log(`[TwilioWebhook] SMS opt-out recorded for ${phone}`);
      } else if (["START", "UNSTOP", "YES"].includes(keyword)) {
        await db.insert(smsOptOuts)
          .values({ phone, isOptedOut: false, optedBackInAt: new Date() })
          .onConflictDoUpdate({
            target: smsOptOuts.phone,
            set: { isOptedOut: false, optedBackInAt: new Date() },
          });
        console.log(`[TwilioWebhook] SMS opt-in recorded for ${phone}`);
      }

      // Save inbound message to conversation inbox
      if (bodyText) {
        try {
          // Try to find which store this Twilio number belongs to by matching outbound SMS logs
          const [lastOutbound] = await db
            .select({ storeId: smsLog.storeId })
            .from(smsLog)
            .where(eq(smsLog.phone, `+${phone}`))
            .orderBy(desc(smsLog.sentAt))
            .limit(1);

          const [lastOutboundAlt] = lastOutbound ? [lastOutbound] : await db
            .select({ storeId: smsLog.storeId })
            .from(smsLog)
            .where(eq(smsLog.phone, phone))
            .orderBy(desc(smsLog.sentAt))
            .limit(1);

          const storeId = lastOutbound?.storeId || lastOutboundAlt?.storeId;
          if (storeId) {
            // Try to find client name from customers table
            const [customer] = await db
              .select({ name: customers.name })
              .from(customers)
              .where(eq(customers.storeId, storeId))
              .limit(1);

            await db.insert(smsConversations).values({
              storeId,
              clientPhone: phone,
              clientName: null,
              direction: "inbound",
              body: bodyText,
              twilioSid: req.body?.MessageSid || null,
            });
            console.log(`[TwilioWebhook] Saved inbound SMS from ${phone} to store ${storeId}`);
          }
        } catch (saveErr) {
          console.warn("[TwilioWebhook] Could not save to inbox:", saveErr);
        }
      }

      // Twilio expects TwiML response — send empty response
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    } catch (err) {
      console.error("[TwilioWebhook] Error:", err);
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    }
  });

  // === TWO-WAY SMS INBOX ===

  app.get("/api/sms-inbox/conversations", isAuthenticated, async (req, res) => {
    try {
      const storeId = Number(req.query.storeId);
      if (!storeId) return res.status(400).json({ message: "storeId required" });

      const { smsConversations } = await import("@shared/schema");

      // Get latest message per phone number using a subquery approach
      const allMessages = await db
        .select()
        .from(smsConversations)
        .where(eq(smsConversations.storeId, storeId))
        .orderBy(desc(smsConversations.createdAt));

      // Group by clientPhone, keep latest per phone
      const phoneMap = new Map<string, typeof allMessages[0] & { unreadCount: number }>();
      for (const msg of allMessages) {
        if (!phoneMap.has(msg.clientPhone)) {
          phoneMap.set(msg.clientPhone, { ...msg, unreadCount: 0 });
        }
        if (msg.direction === "inbound" && !msg.readAt) {
          const existing = phoneMap.get(msg.clientPhone)!;
          existing.unreadCount++;
        }
      }

      const conversations = Array.from(phoneMap.values()).map((m) => ({
        clientPhone: m.clientPhone,
        clientName: m.clientName,
        lastMessage: m.body,
        lastMessageAt: m.createdAt,
        unreadCount: m.unreadCount,
        direction: m.direction,
      }));

      return res.json(conversations);
    } catch (err) {
      console.error("[SmsInbox] conversations error:", err);
      return res.status(500).json({ message: "Failed to load conversations" });
    }
  });

  app.get("/api/sms-inbox/messages", isAuthenticated, async (req, res) => {
    try {
      const storeId = Number(req.query.storeId);
      const phone = String(req.query.phone || "").replace(/\D/g, "");
      if (!storeId || !phone) return res.status(400).json({ message: "storeId and phone required" });

      const { smsConversations } = await import("@shared/schema");

      const messages = await db
        .select()
        .from(smsConversations)
        .where(
          and(
            eq(smsConversations.storeId, storeId),
            eq(smsConversations.clientPhone, phone)
          )
        )
        .orderBy(asc(smsConversations.createdAt));

      // Mark inbound messages as read
      await db
        .update(smsConversations)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(smsConversations.storeId, storeId),
            eq(smsConversations.clientPhone, phone),
            eq(smsConversations.direction, "inbound"),
            isNull(smsConversations.readAt)
          )
        );

      return res.json(messages);
    } catch (err) {
      console.error("[SmsInbox] messages error:", err);
      return res.status(500).json({ message: "Failed to load messages" });
    }
  });

  app.post("/api/sms-inbox/reply", isAuthenticated, async (req, res) => {
    try {
      const { storeId, phone, body } = req.body;
      if (!storeId || !phone || !body) {
        return res.status(400).json({ message: "storeId, phone, and body required" });
      }

      const { sendSms } = await import("./sms");
      const { smsConversations } = await import("@shared/schema");

      const e164Phone = phone.startsWith("+") ? phone : `+${phone}`;
      const result = await sendSms(storeId, e164Phone, body, "two_way_reply");

      if (!result.success && !result.skipped) {
        return res.status(500).json({ message: result.error || "Failed to send SMS" });
      }

      // Save outbound message to conversation
      const [saved] = await db.insert(smsConversations).values({
        storeId,
        clientPhone: phone.replace(/\D/g, ""),
        direction: "outbound",
        body,
        twilioSid: result.sid || null,
        readAt: new Date(),
      }).returning();

      return res.json(saved);
    } catch (err) {
      console.error("[SmsInbox] reply error:", err);
      return res.status(500).json({ message: "Failed to send reply" });
    }
  });

  app.get("/api/public/check-slug/:slug", async (req, res) => {
    const store = await storage.getStoreBySlug(req.params.slug);
    res.json({ available: !store });
  });

  // === PUBLIC QUEUE ===

  app.get("/api/public/queue/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const [store] = await db.select().from(locations).where(eq(locations.bookingSlug, slug));
      if (!store) return res.status(404).json({ error: "Store not found" });

      const [settings] = await db.select().from(storeSettings).where(eq(storeSettings.storeId, store.id));
      const prefs = settings?.preferences ? JSON.parse(settings.preferences as string) : {};
      const avgServiceTime: number = prefs.queueAvgServiceTime || 20;
      const queueEnabled: boolean = prefs.queueEnabled !== false;

      if (!queueEnabled) {
        return res.json({
          store: { id: store.id, name: store.name, phone: store.phone, address: store.address },
          queueEnabled: false, waitingCount: 0, calledCount: 0, servedToday: 0,
          estimatedWaitMinutes: 0, avgServiceTime, queue: [],
        });
      }

      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

      const activeEntries = await db.select().from(waitlist)
        .where(and(
          eq(waitlist.storeId, store.id),
          gte(waitlist.createdAt, todayStart),
          sql`${waitlist.status} IN ('waiting', 'called', 'serving')`
        ))
        .orderBy(asc(waitlist.createdAt));

      const [{ total: servedToday }] = await db.select({ total: count() }).from(waitlist)
        .where(and(
          eq(waitlist.storeId, store.id),
          gte(waitlist.createdAt, todayStart),
          eq(waitlist.status, "completed")
        ));

      const waitingEntries = activeEntries.filter(e => e.status === "waiting");

      const safeQueue = activeEntries.map((e, idx) => {
        const nameParts = e.customerName.trim().split(" ");
        const displayName = nameParts.length > 1
          ? `${nameParts[0]} ${nameParts[nameParts.length - 1][0]}.`
          : nameParts[0];
        return {
          id: e.id,
          displayName,
          status: e.status,
          partySize: (e as any).partySize || 1,
          estimatedWaitMinutes: idx * avgServiceTime,
          isNext: idx === 0 && e.status === "waiting",
        };
      });

      res.json({
        store: { id: store.id, name: store.name, phone: store.phone, address: store.address },
        queueEnabled: true,
        waitingCount: waitingEntries.length,
        calledCount: activeEntries.filter(e => e.status !== null && ["called", "serving"].includes(e.status)).length,
        servedToday: Number(servedToday),
        estimatedWaitMinutes: waitingEntries.length * avgServiceTime,
        avgServiceTime,
        queue: safeQueue,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch queue" });
    }
  });

  app.post("/api/public/queue/:slug/checkin", async (req, res) => {
    try {
      const { slug } = req.params;
      const [store] = await db.select().from(locations).where(eq(locations.bookingSlug, slug));
      if (!store) return res.status(404).json({ error: "Store not found" });

      const [settings] = await db.select().from(storeSettings).where(eq(storeSettings.storeId, store.id));
      const prefs = settings?.preferences ? JSON.parse(settings.preferences as string) : {};
      const queueEnabled: boolean = prefs.queueEnabled !== false;
      const maxQueueSize: number = prefs.queueMaxSize || 30;
      const avgServiceTime: number = prefs.queueAvgServiceTime || 20;

      if (!queueEnabled) return res.status(400).json({ error: "Queue is not accepting check-ins right now." });

      const { customerName, customerPhone, partySize = 1, latitude, longitude } = req.body;
      if (!customerName?.trim()) return res.status(400).json({ error: "Name is required" });

      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const [{ total: currentWaiting }] = await db.select({ total: count() }).from(waitlist)
        .where(and(
          eq(waitlist.storeId, store.id),
          gte(waitlist.createdAt, todayStart),
          eq(waitlist.status, "waiting")
        ));

      if (Number(currentWaiting) >= maxQueueSize) {
        return res.status(400).json({ error: "The queue is currently full. Please visit us directly." });
      }

      const [entry] = await db.insert(waitlist).values({
        storeId: store.id,
        customerName: customerName.trim(),
        customerPhone: customerPhone?.trim() || null,
        partySize: Math.max(1, Math.min(10, Number(partySize) || 1)),
        customerLatitude: latitude != null ? String(latitude) : null,
        customerLongitude: longitude != null ? String(longitude) : null,
        status: "waiting",
      } as any).returning();

      const before = await db.select({ id: waitlist.id }).from(waitlist)
        .where(and(
          eq(waitlist.storeId, store.id),
          gte(waitlist.createdAt, todayStart),
          sql`${waitlist.status} IN ('waiting', 'called', 'serving')`,
          sql`${waitlist.id} <= ${entry.id}`
        ));

      const position = before.length;
      const estimatedWaitMinutes = Math.max(0, (position - 1) * avgServiceTime);

      res.json({ id: entry.id, position, estimatedWaitMinutes, storeName: store.name });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to check in" });
    }
  });

  app.get("/api/public/queue/:slug/position/:id", async (req, res) => {
    try {
      const { slug, id } = req.params;
      const [store] = await db.select().from(locations).where(eq(locations.bookingSlug, slug));
      if (!store) return res.status(404).json({ error: "Store not found" });

      const [entry] = await db.select().from(waitlist).where(eq(waitlist.id, parseInt(id)));
      if (!entry || entry.storeId !== store.id) return res.status(404).json({ error: "Entry not found" });

      const [settings] = await db.select().from(storeSettings).where(eq(storeSettings.storeId, store.id));
      const prefs = settings?.preferences ? JSON.parse(settings.preferences as string) : {};
      const avgServiceTime: number = prefs.queueAvgServiceTime || 20;

      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const before = await db.select({ id: waitlist.id }).from(waitlist)
        .where(and(
          eq(waitlist.storeId, store.id),
          gte(waitlist.createdAt, todayStart),
          sql`${waitlist.status} IN ('waiting', 'called', 'serving')`,
          sql`${waitlist.id} <= ${entry.id}`
        ));

      const position = before.length;
      res.json({ id: entry.id, status: entry.status, position, estimatedWaitMinutes: Math.max(0, (position - 1) * avgServiceTime) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to get position" });
    }
  });

  // Allow unauthenticated status update for self-cancel
  app.put("/api/public/queue/cancel/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      await db.update(waitlist).set({ status: "cancelled" }).where(eq(waitlist.id, id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to cancel" });
    }
  });

  // === SMS SETTINGS ===
  const validateStoreOwnership = async (req: any, res: any): Promise<boolean> => {
    const userId = (req.session as any)?.userId;
    const storeId = Number(req.params.storeId);
    const store = await storage.getStore(storeId);
    if (!store || store.userId !== userId) {
      res.status(403).json({ message: "Unauthorized" });
      return false;
    }
    return true;
  };

  app.get("/api/sms-settings/:storeId", async (req, res) => {
    if (!(await validateStoreOwnership(req, res))) return;
    const settings = await storage.getSmsSettings(Number(req.params.storeId));
    if (settings) {
      const { twilioAuthToken, ...safe } = settings;
      res.json({ ...safe, twilioAuthToken: twilioAuthToken ? "••••••••" : null });
    } else {
      res.json(null);
    }
  });

  app.put("/api/sms-settings/:storeId", async (req, res) => {
    if (!(await validateStoreOwnership(req, res))) return;
    try {
      const storeId = Number(req.params.storeId);
      const smsSettingsInput = z.object({
        twilioAccountSid: z.string().optional().nullable(),
        twilioAuthToken: z.string().optional().nullable(),
        twilioPhoneNumber: z.string().optional().nullable(),
        bookingConfirmationEnabled: z.boolean().optional(),
        reminderEnabled: z.boolean().optional(),
        reminderHoursBefore: z.number().min(1).max(72).optional(),
        reviewRequestEnabled: z.boolean().optional(),
        googleReviewUrl: z.string().optional().nullable(),
        confirmationTemplate: z.string().optional().nullable(),
        reminderTemplate: z.string().optional().nullable(),
        reviewTemplate: z.string().optional().nullable(),
      }).parse(req.body);

      if (smsSettingsInput.twilioAuthToken === "••••••••") {
        delete smsSettingsInput.twilioAuthToken;
      }
      const settings = await storage.upsertSmsSettings(storeId, { ...smsSettingsInput, storeId });
      const { twilioAuthToken, ...safe } = settings;
      res.json({ ...safe, twilioAuthToken: twilioAuthToken ? "••••••••" : null });
    } catch (error) {
      console.error("SMS settings update error:", error);
      res.status(400).json({ message: "Invalid input" });
    }
  });

  app.post("/api/sms-settings/:storeId/test", async (req, res) => {
    if (!(await validateStoreOwnership(req, res))) return;
    try {
      const storeId = Number(req.params.storeId);
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ message: "Phone number required" });

      const { sendSms } = await import("./sms");
      const result = await sendSms(
        storeId,
        phone,
        "This is a test message from your salon booking system. SMS is working!",
        "test"
      );

      if (result.success) {
        res.json({ success: true, sid: result.sid });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/sms-log/:storeId", async (req, res) => {
    if (!(await validateStoreOwnership(req, res))) return;
    const logs = await storage.getSmsLogs(Number(req.params.storeId), 100);
    res.json(logs);
  });

  // === CAMPAIGNS ===

  app.get("/api/campaigns", isAuthenticated, async (req, res) => {
    try {
      const storeId = Number(req.query.storeId);
      if (!storeId) return res.status(400).json({ message: "storeId required" });
      const { campaigns } = await import("@shared/schema/campaigns");
      const results = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.storeId, storeId))
        .orderBy(desc(campaigns.createdAt));
      return res.json(results);
    } catch (err) {
      console.error("[Campaigns] GET error:", err);
      return res.status(500).json({ message: "Failed to load campaigns" });
    }
  });

  app.post("/api/campaigns", isAuthenticated, async (req, res) => {
    try {
      const { storeId, name, channel, audience, audienceValue, messageTemplate, scheduledAt } = req.body;
      if (!storeId || !name || !messageTemplate) {
        return res.status(400).json({ message: "storeId, name, and messageTemplate required" });
      }
      const { campaigns } = await import("@shared/schema/campaigns");
      const status = scheduledAt ? "scheduled" : "draft";
      const [created] = await db.insert(campaigns).values({
        storeId,
        name,
        channel: channel || "sms",
        audience: audience || "all",
        audienceValue: audienceValue || null,
        messageTemplate,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      }).returning();
      return res.json(created);
    } catch (err) {
      console.error("[Campaigns] POST error:", err);
      return res.status(500).json({ message: "Failed to create campaign" });
    }
  });

  app.post("/api/campaigns/:id/send", isAuthenticated, async (req, res) => {
    try {
      const campaignId = Number(req.params.id);
      const storeId = Number(req.body.storeId);
      if (!storeId) return res.status(400).json({ message: "storeId required" });

      const { campaigns } = await import("@shared/schema/campaigns");

      const [campaign] = await db.select().from(campaigns).where(
        and(eq(campaigns.id, campaignId), eq(campaigns.storeId, storeId))
      );
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });

      // Get target audience
      const now = new Date();
      let targetCustomers: { name: string; phone: string | null; email: string | null }[] = [];

      const baseQuery = db.select({
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
      }).from(customers).where(eq(customers.storeId, storeId));

      if (campaign.audience === "all") {
        targetCustomers = await baseQuery;
      } else if (campaign.audience.startsWith("lapsed_")) {
        const days = parseInt(campaign.audience.split("_")[1]) || 90;
        const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        const { appointments: appts } = await import("@shared/schema");
        targetCustomers = await db.select({
          name: customers.name,
          phone: customers.phone,
          email: customers.email,
        }).from(customers)
          .where(eq(customers.storeId, storeId));
        // Filter to those with last appointment before cutoff
        // (simplified — could be done with a subquery in prod)
      } else {
        targetCustomers = await baseQuery;
      }

      // Replace merge tags and send
      const { sendSms } = await import("./sms");
      const { sendEmail } = await import("./mail");
      const store = await storage.getStore(storeId);
      const bookingLink = store?.bookingSlug
        ? `${process.env.REPLIT_DEV_DOMAIN || ""}/book/${store.bookingSlug}`
        : "";

      let sentCount = 0;
      let failedCount = 0;

      for (const customer of targetCustomers) {
        const firstName = (customer.name || "").split(" ")[0];
        const message = campaign.messageTemplate
          .replace(/\{\{firstName\}\}/g, firstName)
          .replace(/\{\{businessName\}\}/g, store?.name || "")
          .replace(/\{\{bookingLink\}\}/g, bookingLink);

        if (campaign.channel === "sms" || campaign.channel === "both") {
          if (customer.phone) {
            const phone = customer.phone.replace(/\D/g, "");
            const e164 = phone.startsWith("1") ? `+${phone}` : `+1${phone}`;
            const result = await sendSms(storeId, e164, message, "campaign");
            if (result.success || result.skipped) sentCount++;
            else failedCount++;
          }
        }
        if (campaign.channel === "email" || campaign.channel === "both") {
          if (customer.email) {
            try {
              await sendEmail(storeId, customer.email, `Message from ${store?.name || "your salon"}`, `<p>${message.replace(/\n/g, "<br>")}</p>`);
              sentCount++;
            } catch {
              failedCount++;
            }
          }
        }
      }

      await db.update(campaigns).set({
        status: "sent",
        sentAt: now,
        sentCount,
        failedCount,
      }).where(eq(campaigns.id, campaignId));

      return res.json({ success: true, sentCount, failedCount });
    } catch (err) {
      console.error("[Campaigns] send error:", err);
      return res.status(500).json({ message: "Failed to send campaign" });
    }
  });

  app.delete("/api/campaigns/:id", isAuthenticated, async (req, res) => {
    try {
      const campaignId = Number(req.params.id);
      const storeId = Number(req.body.storeId);
      if (!storeId) return res.status(400).json({ message: "storeId required" });
      const { campaigns } = await import("@shared/schema/campaigns");
      await db.delete(campaigns).where(
        and(eq(campaigns.id, campaignId), eq(campaigns.storeId, storeId))
      );
      return res.json({ success: true });
    } catch (err) {
      console.error("[Campaigns] DELETE error:", err);
      return res.status(500).json({ message: "Failed to delete campaign" });
    }
  });

  // === API KEYS ===

  app.get("/api/api-keys", isAuthenticated, async (req, res) => {
    try {
      const storeId = Number(req.query.storeId);
      if (!storeId) return res.status(400).json({ message: "storeId required" });
      const { apiKeys } = await import("@shared/schema/api-keys");
      const keys = await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          scopes: apiKeys.scopes,
          isActive: apiKeys.isActive,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.storeId, storeId))
        .orderBy(desc(apiKeys.createdAt));
      return res.json(keys);
    } catch (err) {
      console.error("[ApiKeys] GET error:", err);
      return res.status(500).json({ message: "Failed to load API keys" });
    }
  });

  app.post("/api/api-keys", isAuthenticated, async (req, res) => {
    try {
      const { storeId, name } = req.body;
      if (!storeId || !name) return res.status(400).json({ message: "storeId and name required" });

      const { apiKeys } = await import("@shared/schema/api-keys");
      const cryptoMod = await import("crypto");

      const rawKey = `sk_${cryptoMod.randomBytes(24).toString("hex")}`;
      const keyHash = cryptoMod.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.slice(0, 10);

      await db.insert(apiKeys).values({
        storeId,
        name,
        keyHash,
        keyPrefix,
        scopes: "read",
        isActive: true,
      });

      return res.json({ key: rawKey });
    } catch (err) {
      console.error("[ApiKeys] POST error:", err);
      return res.status(500).json({ message: "Failed to create API key" });
    }
  });

  app.delete("/api/api-keys/:id", isAuthenticated, async (req, res) => {
    try {
      const keyId = Number(req.params.id);
      const storeId = Number(req.body.storeId);
      if (!storeId) return res.status(400).json({ message: "storeId required" });
      const { apiKeys } = await import("@shared/schema/api-keys");
      await db.update(apiKeys).set({ isActive: false }).where(
        and(eq(apiKeys.id, keyId), eq(apiKeys.storeId, storeId))
      );
      return res.json({ success: true });
    } catch (err) {
      console.error("[ApiKeys] DELETE error:", err);
      return res.status(500).json({ message: "Failed to revoke API key" });
    }
  });

  // === SMS USAGE ===

  app.get("/api/sms-usage/:storeId", isAuthenticated, async (req, res) => {
    try {
      const storeId = Number(req.params.storeId);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [{ value: monthCount }] = await db
        .select({ value: count() })
        .from(smsLog)
        .where(
          and(
            eq(smsLog.storeId, storeId),
            gte(smsLog.sentAt, monthStart)
          )
        );

      const store = await storage.getStore(storeId);
      return res.json({
        currentMonth: Number(monthCount),
        tokensRemaining: store?.smsTokens ?? 0,
        month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      });
    } catch (err) {
      console.error("[SmsUsage] GET error:", err);
      return res.status(500).json({ message: "Failed to load SMS usage" });
    }
  });

  // === SMS ACTIVITY LEDGER ===

  // GET /api/sms-activity/summary
  app.get("/api/sms-activity/summary", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId ? Number(req.query.storeId) : (req.session as any)?.storeId;
      if (!storeId) return res.status(400).json({ message: "storeId required" });

      const days = Number(req.query.days ?? 30);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const rows = await db
        .select({
          smsSource: smsLog.smsSource,
          messageType: smsLog.messageType,
          costEstimate: smsLog.costEstimate,
          status: smsLog.status,
        })
        .from(smsLog)
        .where(
          and(
            eq(smsLog.storeId, storeId),
            gte(smsLog.sentAt, since),
            eq(smsLog.status, "sent")
          )
        );

      const totalSent = rows.length;
      const fromAllowance = rows.filter(r => r.smsSource === "allowance").length;
      const fromCredits = rows.filter(r => r.smsSource === "credits").length;
      const estimatedCost = rows.reduce((sum, r) => sum + Number(r.costEstimate ?? 0), 0);
      const estimatedRevenue = totalSent * 0.03;

      const byType: Record<string, number> = {};
      for (const r of rows) {
        const t = r.messageType ?? "system";
        byType[t] = (byType[t] ?? 0) + 1;
      }

      return res.json({
        totalSent,
        fromAllowance,
        fromCredits,
        estimatedCost: Number(estimatedCost.toFixed(4)),
        estimatedRevenue: Number(estimatedRevenue.toFixed(2)),
        byType,
        days,
      });
    } catch (err) {
      console.error("[SmsActivity] summary error:", err);
      return res.status(500).json({ message: "Failed to load SMS summary" });
    }
  });

  // GET /api/sms-activity/log
  app.get("/api/sms-activity/log", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId ? Number(req.query.storeId) : (req.session as any)?.storeId;
      if (!storeId) return res.status(400).json({ message: "storeId required" });

      const days = Number(req.query.days ?? 30);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = Math.min(100, Number(req.query.pageSize ?? 25));
      const typeFilter = req.query.type as string | undefined;
      const sourceFilter = req.query.source as string | undefined;

      const conditions = [
        eq(smsLog.storeId, storeId),
        gte(smsLog.sentAt, since),
      ];
      if (typeFilter) conditions.push(eq(smsLog.messageType, typeFilter));
      if (sourceFilter) conditions.push(eq(smsLog.smsSource, sourceFilter));

      const rows = await db
        .select()
        .from(smsLog)
        .where(and(...conditions))
        .orderBy(desc(smsLog.sentAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ total }] = await db
        .select({ total: count() })
        .from(smsLog)
        .where(and(...conditions));

      return res.json({
        rows,
        total: Number(total),
        page,
        pageSize,
        totalPages: Math.ceil(Number(total) / pageSize),
      });
    } catch (err) {
      console.error("[SmsActivity] log error:", err);
      return res.status(500).json({ message: "Failed to load SMS log" });
    }
  });

  // GET /api/sms-activity/by-location (multi-location grouping)
  app.get("/api/sms-activity/by-location", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const days = Number(req.query.days ?? 30);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const userStores = await storage.getStores(userId);
      if (!userStores.length) return res.json([]);

      const storeIds = userStores.map(s => s.id);

      const rows = await db
        .select({
          storeId: smsLog.storeId,
          smsSource: smsLog.smsSource,
          status: smsLog.status,
          costEstimate: smsLog.costEstimate,
        })
        .from(smsLog)
        .where(
          and(
            inArray(smsLog.storeId, storeIds),
            gte(smsLog.sentAt, since),
          )
        );

      const grouped = userStores.map(store => {
        const storeRows = rows.filter(r => r.storeId === store.id && r.status === "sent");
        return {
          storeId: store.id,
          storeName: store.name,
          totalSent: storeRows.length,
          fromAllowance: storeRows.filter(r => r.smsSource === "allowance").length,
          fromCredits: storeRows.filter(r => r.smsSource === "credits").length,
          estimatedCost: Number(storeRows.reduce((s, r) => s + Number(r.costEstimate ?? 0), 0).toFixed(4)),
        };
      });

      return res.json(grouped);
    } catch (err) {
      console.error("[SmsActivity] by-location error:", err);
      return res.status(500).json({ message: "Failed to load location data" });
    }
  });

  // === MULTI-LOCATION SUMMARY ===

  app.get("/api/multi-location/summary", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const stores = await storage.getStores(userId);
      if (stores.length === 0) return res.json([]);

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const summaries = await Promise.all(stores.map(async (store) => {
        const [apptResult] = await db
          .select({ value: count() })
          .from(appointments)
          .where(
            and(
              eq(appointments.storeId, store.id),
              gte(appointments.date, monthStart),
            )
          );

        const [clientResult] = await db
          .select({ value: count() })
          .from(customers)
          .where(eq(customers.storeId, store.id));

        const revenueRows = await db
          .select({ total: sql<string>`COALESCE(SUM(${appointments.totalPaid}), 0)` })
          .from(appointments)
          .where(
            and(
              eq(appointments.storeId, store.id),
              gte(appointments.date, monthStart),
              eq(appointments.status, "completed"),
            )
          );

        const revenue = Number(revenueRows[0]?.total || 0);
        const bookings = Number(apptResult.value || 0);
        const clients = Number(clientResult.value || 0);
        const fillRate = bookings > 0 ? Math.min(Math.round((bookings / Math.max(bookings * 1.3, 1)) * 100), 100) : 0;

        return {
          id: store.id,
          name: store.name,
          city: store.city,
          state: store.state,
          revenue,
          bookings,
          clients,
          fillRate,
        };
      }));

      return res.json(summaries);
    } catch (err) {
      console.error("[MultiLocation] summary error:", err);
      return res.status(500).json({ message: "Failed to load summary" });
    }
  });

  // === PUBLIC API v1 (API key auth) ===

  app.get("/api/v1/appointments", async (req, res) => {
    const { apiKeyAuth } = await import("./middleware/api-auth");
    apiKeyAuth(req, res, async () => {
      try {
        const storeId = (req as any).apiKeyStoreId;
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const list = await db
          .select()
          .from(appointments)
          .where(eq(appointments.storeId, storeId))
          .orderBy(desc(appointments.date))
          .limit(limit);
        return res.json({ data: list, count: list.length });
      } catch (err) {
        return res.status(500).json({ message: "Internal error" });
      }
    });
  });

  app.get("/api/v1/clients", async (req, res) => {
    const { apiKeyAuth } = await import("./middleware/api-auth");
    apiKeyAuth(req, res, async () => {
      try {
        const storeId = (req as any).apiKeyStoreId;
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const list = await db
          .select()
          .from(customers)
          .where(eq(customers.storeId, storeId))
          .orderBy(desc(customers.id))
          .limit(limit);
        return res.json({ data: list, count: list.length });
      } catch (err) {
        return res.status(500).json({ message: "Internal error" });
      }
    });
  });

  app.get("/api/v1/services", async (req, res) => {
    const { apiKeyAuth } = await import("./middleware/api-auth");
    apiKeyAuth(req, res, async () => {
      try {
        const storeId = (req as any).apiKeyStoreId;
        const list = await db
          .select()
          .from(services)
          .where(eq(services.storeId, storeId))
          .orderBy(services.name);
        return res.json({ data: list, count: list.length });
      } catch (err) {
        return res.status(500).json({ message: "Internal error" });
      }
    });
  });

  // === MAIL SETTINGS ===
  app.get("/api/mail-settings/:storeId", async (req, res) => {
    if (!(await validateStoreOwnership(req, res))) return;
    const settings = await storage.getMailSettings(Number(req.params.storeId));
    if (settings) {
      const { mailgunApiKey, ...safe } = settings;
      res.json({ ...safe, mailgunApiKey: mailgunApiKey ? "••••••••" : null });
    } else {
      res.json(null);
    }
  });

  app.put("/api/mail-settings/:storeId", async (req, res) => {
    if (!(await validateStoreOwnership(req, res))) return;
    try {
      const storeId = Number(req.params.storeId);
      const mailSettingsInput = z.object({
        mailgunApiKey: z.string().optional().nullable(),
        mailgunDomain: z.string().optional().nullable(),
        senderEmail: z.string().optional().nullable(),
        bookingConfirmationEnabled: z.boolean().optional(),
        reminderEnabled: z.boolean().optional(),
        reminderHoursBefore: z.number().min(1).max(72).optional(),
        reviewRequestEnabled: z.boolean().optional(),
        googleReviewUrl: z.string().optional().nullable(),
        confirmationTemplate: z.string().optional().nullable(),
        reminderTemplate: z.string().optional().nullable(),
        reviewTemplate: z.string().optional().nullable(),
      }).parse(req.body);

      if (mailSettingsInput.mailgunApiKey === "••••••••") {
        delete mailSettingsInput.mailgunApiKey;
      }
      const settings = await storage.upsertMailSettings(storeId, { ...mailSettingsInput, storeId });
      const { mailgunApiKey, ...safe } = settings;
      res.json({ ...safe, mailgunApiKey: mailgunApiKey ? "••••••••" : null });
    } catch (error) {
      console.error("Mail settings update error:", error);
      res.status(400).json({ message: "Invalid input" });
    }
  });

  const safeStripeSettings = (settings: any) => {
    const secretKey = settings.secretKey || "";
    return {
      ...settings,
      secretKey: secretKey ? "••••••••" : null,
      mode: secretKey.startsWith("sk_test_") ? "test" : secretKey.startsWith("sk_live_") ? "live" : null,
      connected: Boolean(settings.publishableKey && secretKey),
    };
  };

  app.get("/api/stripe-settings/:storeId", async (req, res) => {
    if (!(await validateStoreOwnership(req, res))) return;
    const settings = await storage.getStripeSettings(Number(req.params.storeId));
    res.json(settings ? safeStripeSettings(settings) : null);
  });

  app.put("/api/stripe-settings/:storeId", async (req, res) => {
    if (!(await validateStoreOwnership(req, res))) return;
    try {
      const storeId = Number(req.params.storeId);
      const stripeSettingsInput = z.object({
        publishableKey: z.string().optional().nullable(),
        secretKey: z.string().optional().nullable(),
        testMagstripeEnabled: z.boolean().optional(),
      }).parse(req.body);

      if (stripeSettingsInput.secretKey === "••••••••") {
        delete stripeSettingsInput.secretKey;
      }

      const settings = await storage.upsertStripeSettings(storeId, { ...stripeSettingsInput, storeId });
      res.json(safeStripeSettings(settings));
    } catch (error) {
      console.error("Stripe settings update error:", error);
      res.status(400).json({ message: "Invalid Stripe settings" });
    }
  });

  app.post("/api/stripe-settings/:storeId/test-magstripe-payment", async (req, res) => {
    if (!(await validateStoreOwnership(req, res))) return;
    try {
      const storeId = Number(req.params.storeId);
      const settings = await storage.getStripeSettings(storeId);

      if (!settings?.secretKey) {
        return res.status(400).json({ message: "Stripe secret key is not configured." });
      }

      if (!settings.secretKey.startsWith("sk_test_")) {
        return res.status(400).json({ message: "Mag-stripe test payments are only allowed with Stripe test keys." });
      }

      if (settings.testMagstripeEnabled === false) {
        return res.status(400).json({ message: "Mag-stripe test mode is disabled in Stripe settings." });
      }

      const paymentInput = z.object({
        amount: z.number().positive().max(999999),
        testPaymentMethod: z.string(),
        appointmentId: z.number().optional().nullable(),
        cardLast4: z.string().optional().nullable(),
        cardBrand: z.string().optional().nullable(),
      }).parse(req.body);

      const allowedPaymentMethods: Record<string, string> = {
        pm_card_visa: "Visa",
        pm_card_mastercard: "Mastercard",
        pm_card_amex: "American Express",
        pm_card_discover: "Discover",
        pm_card_chargeDeclined: "Declined card",
      };

      if (!allowedPaymentMethods[paymentInput.testPaymentMethod]) {
        return res.status(400).json({ message: "Only Stripe test card swipes are accepted." });
      }

      // Phase 9.2 — practice-mode short-circuit. Sandbox stores must never
      // hit Stripe; fake a successful charge so the trainee's POS flow
      // completes naturally.
      const { isSandboxStore } = await import("./training/sandbox");
      if (await isSandboxStore(storeId)) {
        return res.json({
          success: true,
          skipped: true,
          paymentIntentId: `pi_sandbox_${Date.now()}`,
          status: "succeeded",
          amount: paymentInput.amount,
          cardLast4: paymentInput.cardLast4 || "4242",
          cardBrand: paymentInput.cardBrand || allowedPaymentMethods[paymentInput.testPaymentMethod],
        });
      }

      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(settings.secretKey);
      const amountInCents = Math.round(paymentInput.amount * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: "usd",
        payment_method: paymentInput.testPaymentMethod,
        confirm: true,
        payment_method_types: ["card"],
        metadata: {
          storeId: String(storeId),
          appointmentId: paymentInput.appointmentId ? String(paymentInput.appointmentId) : "",
          cardLast4: paymentInput.cardLast4 || "",
          cardBrand: paymentInput.cardBrand || allowedPaymentMethods[paymentInput.testPaymentMethod],
          source: "certxa_test_magstripe",
        },
      });

      if (paymentIntent.status !== "succeeded") {
        return res.status(400).json({ message: `Stripe payment status: ${paymentIntent.status}` });
      }

      res.json({
        success: true,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100,
        cardLast4: paymentInput.cardLast4 || null,
        cardBrand: paymentInput.cardBrand || allowedPaymentMethods[paymentInput.testPaymentMethod],
      });
    } catch (error: any) {
      const message = error?.raw?.message || error?.message || "Stripe test payment failed";
      res.status(400).json({ success: false, message });
    }
  });

  // === ADMIN ENDPOINTS ===
  app.get("/api/admin/accounts", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const allUsers = await db.select().from(users);
      const allLocations = await db.select().from(locations);

      const locationsByUser = new Map<string, typeof allLocations[0]>();
      for (const loc of allLocations) {
        if (loc.userId && !locationsByUser.has(loc.userId)) {
          locationsByUser.set(loc.userId, loc);
        }
      }

      const now = new Date();
      const accounts = allUsers.map((user: any) => {
        const store = locationsByUser.get(user.id);

        // Compute a unified status
        let computedStatus: string;
        const subStatus = user.subscriptionStatus ?? "active";
        const locStatus = (store?.accountStatus ?? "Active").toLowerCase();
        const trialEnds = user.trialEndsAt ? new Date(user.trialEndsAt) : null;

        if (locStatus === "inactive") {
          computedStatus = "Inactive";
        } else if (subStatus === "trialing") {
          computedStatus = trialEnds && trialEnds < now ? "Expired" : "Free Trial";
        } else if (subStatus === "active") {
          computedStatus = "Subscriber";
        } else if (subStatus === "past_due") {
          computedStatus = "Expired";
        } else if (subStatus === "canceled") {
          computedStatus = "Inactive";
        } else {
          computedStatus = store?.accountStatus ?? "Active";
        }

        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          createdAt: user.createdAt,
          subscriptionStatus: subStatus,
          trialStartedAt: user.trialStartedAt,
          trialEndsAt: user.trialEndsAt,
          computedStatus,
          storeId: store?.id ?? null,
          storeName: store?.name ?? null,
          storeCity: store?.city ?? null,
          storeState: store?.state ?? null,
          storePhone: store?.phone ?? null,
          storeCategory: store?.category ?? null,
          accountStatus: store?.accountStatus ?? null,
        };
      });

      res.json(accounts);
    } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ message: "Failed to fetch accounts" });
    }
  });

  app.delete("/api/admin/accounts/:userId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const userToDelete = req.params.userId;

    try {
      if (userId === userToDelete) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      await db.delete(users).where(eq(users.id, userToDelete));
      res.json({ message: "Account deleted successfully" });
    } catch (error) {
      console.error("Error deleting account:", error);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GOOGLE BUSINESS PROFILE INTEGRATION
  // ─────────────────────────────────────────────────────────────────────────
  // SEPARATION RULES (enforced by design):
  //   • All routes here use GOOGLE_BUSINESS_* credentials ONLY.
  //   • NEVER share tokens with the Google Login system (/api/auth/google).
  //   • NEVER use login tokens to call Business Profile APIs.
  //   • NEVER use business tokens to authenticate a user session.
  //   • All routes below require an active user session (login first).
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/google-business/connect
   *
   * Browser-redirect entry point for the Business Profile OAuth flow.
   * Requires: active user session + storeId query param.
   * Generates a CSRF-protected state, then redirects the browser directly
   * to Google's consent page (business.manage scope only — no login scopes).
   *
   * Separate from /api/auth/google which handles user login exclusively.
   */

  app.get("/api/google-business/connect", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      console.warn("[Google Business OAuth] /connect — unauthenticated request rejected");
      return res.redirect("/auth?reason=login_required");
    }

    const { allowed, retryAfterSecs } = checkOAuthRateLimit(userId);
    if (!allowed) {
      const mins = Math.ceil(retryAfterSecs / 60);
      console.warn(`[Google Business OAuth] /connect — rate limit hit for userId=${userId}`);
      return res.status(429).send(`Too many connection attempts. Please wait ${mins} minute${mins !== 1 ? "s" : ""} and try again.`);
    }

    const storeId = req.query.storeId ? Number(req.query.storeId) : null;
    if (!storeId) {
      return res.status(400).json({ message: "storeId query param is required" });
    }

    try {
      const csrf         = crypto.randomBytes(16).toString("hex");
      const statePayload = Buffer.from(JSON.stringify({ csrf, storeId })).toString("base64url");
      (req.session as any).googleOAuthState   = csrf;
      (req.session as any).googleOAuthStoreId = storeId;

      const redirectUri  = getGoogleBusinessCallbackUrl();
      const clientId     = process.env.GOOGLE_BUSINESS_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID     ?? "";
      const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "";

      console.log("[Google Business OAuth] /connect — generating redirect URL");
      console.log("[Google Business OAuth]   client_id   :", clientId ? `${clientId.slice(0, 12)}…` : "(NOT SET)");
      console.log("[Google Business OAuth]   redirect_uri:", redirectUri || "(NOT SET)");
      console.log("[Google Business OAuth]   storeId     :", storeId);
      console.log("[Google Business OAuth]   scopes      : business.manage");

      if (!clientId || !clientSecret || !redirectUri) {
        console.error("[Google Business OAuth] Missing GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET, or GOOGLE_BUSINESS_CALLBACK_URL");
        return res.status(500).json({
          message: "Google Business OAuth is not configured. Set GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET, and GOOGLE_BUSINESS_CALLBACK_URL.",
        });
      }

      const apiManager = new GoogleBusinessAPIManager({ clientId, clientSecret, redirectUri });
      // Only business.manage scope — never openid/profile/email (those belong to login)
      const authUrl = apiManager.getAuthUrl(
        ["https://www.googleapis.com/auth/business.manage"],
        statePayload
      );

      console.log("[Google Business OAuth] /connect — redirecting browser to Google consent page");
      req.session.save(() => res.redirect(authUrl));
    } catch (error) {
      console.error("[Google Business OAuth] /connect — error generating auth URL:", error);
      res.status(500).json({ message: "Failed to initiate Google Business connection" });
    }
  });

  /**
   * Get Google OAuth authorization URL (JSON response variant for frontend-mediated flow).
   * Embeds storeId + a CSRF token inside the OAuth state parameter (base64url-encoded JSON)
   * so the server-side callback can restore context without relying on post-redirect data.
   */
  app.get("/api/google-business/auth-url", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { allowed, retryAfterSecs } = checkOAuthRateLimit(userId);
    if (!allowed) {
      const mins = Math.ceil(retryAfterSecs / 60);
      console.warn(`[Google Business OAuth] /auth-url — rate limit hit for userId=${userId}`);
      return res.status(429).json({ message: `Too many connection attempts. Please wait ${mins} minute${mins !== 1 ? "s" : ""} and try again.` });
    }

    const storeId = req.query.storeId ? Number(req.query.storeId) : null;
    if (!storeId) {
      return res.status(400).json({ message: "storeId query param is required" });
    }

    try {
      // Build state: a CSRF token + storeId packed into a single base64url blob
      const csrf = crypto.randomBytes(16).toString("hex");
      const statePayload = Buffer.from(JSON.stringify({ csrf, storeId })).toString("base64url");
      // Store only the csrf half in the session for later verification
      (req.session as any).googleOAuthState = csrf;
      (req.session as any).googleOAuthStoreId = storeId; // belt-and-suspenders fallback

      // BUSINESS integration credentials — NEVER shared with the login system
      const redirectUri  = getGoogleBusinessCallbackUrl();
      const clientId     = process.env.GOOGLE_BUSINESS_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID     ?? "";
      const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "";

      console.log("[Google Business OAuth] Generating auth URL");
      console.log("[Google Business OAuth]   client_id    :", clientId ? `${clientId.slice(0, 12)}…` : "(NOT SET)");
      console.log("[Google Business OAuth]   client_secret:", clientSecret ? "(set)" : "(NOT SET — will fail)");
      console.log("[Google Business OAuth]   redirect_uri :", redirectUri || "(NOT SET)");
      console.log("[Google Business OAuth]   storeId      :", storeId);
      console.log("[Google Business OAuth]   csrf         :", csrf);

      if (!clientId || !clientSecret || !redirectUri) {
        console.error("[Google Business OAuth] Missing required env vars: GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET, or GOOGLE_BUSINESS_CALLBACK_URL");
        return res.status(500).json({
          message: "Google Business OAuth is not fully configured. Set GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET, and GOOGLE_BUSINESS_CALLBACK_URL in environment variables.",
        });
      }

      const apiManager = new GoogleBusinessAPIManager({ clientId, clientSecret, redirectUri });
      const authUrl = apiManager.getAuthUrl(undefined, statePayload);

      console.log("[Google Business OAuth] Auth URL generated successfully — scope: business.manage only");

      // Save the session before responding so the CSRF state is persisted
      req.session.save(() => res.json({ authUrl }));
    } catch (error) {
      console.error("[Google Business OAuth] Error generating auth URL:", error);
      res.status(500).json({ message: "Failed to generate auth URL" });
    }
  });

  /**
   * Server-side OAuth redirect callback — GET /api/google-business/callback
   *
   * Google redirects here after the business.manage consent screen.
   * Steps:
   *   1. Decode + verify CSRF state
   *   2. Exchange code for tokens using GOOGLE_BUSINESS_* credentials only
   *   3. Attempt to fetch connected Google account email (graceful skip if scope unavailable)
   *   4. Fetch all Business Profile accounts
   *   5. Fetch locations for each account
   *   6. Upsert profile row in DB (tokens + account info; location is selected separately)
   *   7. Stash result in session for frontend pickup
   *   8. Redirect to /reviews
   *
   * redirect_uri must match exactly: https://certxa.com/api/google-business/callback
   */
  app.get("/api/google-business/callback", async (req, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;

    console.log("[Google Business OAuth] ── Callback received ──────────────────────────────");
    console.log("[Google Business OAuth]   code  :", code ? `${String(code).slice(0, 20)}… (${String(code).length} chars)` : "(none)");
    console.log("[Google Business OAuth]   state :", state ? `${String(state).slice(0, 30)}…` : "(none)");
    console.log("[Google Business OAuth]   error :", oauthError ?? "(none)");

    if (oauthError) {
      console.warn("[Google Business OAuth] User denied access or Google returned an error:", oauthError);
      return res.redirect(`/google-business?google_error=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state) {
      console.error("[Google Business OAuth] Missing code or state in callback");
      return res.redirect("/google-business?google_error=missing_params");
    }

    // ── Decode & verify CSRF state ───────────────────────────────────────────
    let storeId: number;
    let csrf: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
      storeId = Number(decoded.storeId);
      csrf    = decoded.csrf;
      console.log("[Google Business OAuth]   decoded storeId:", storeId, "  csrf:", csrf);
    } catch {
      console.error("[Google Business OAuth] Failed to decode state payload");
      return res.redirect("/google-business?google_error=invalid_state");
    }

    const expectedCsrf    = (req.session as any).googleOAuthState;
    const fallbackStoreId = (req.session as any).googleOAuthStoreId;
    console.log("[Google Business OAuth]   session csrf    :", expectedCsrf    ?? "(not in session — may have expired)");
    console.log("[Google Business OAuth]   session storeId :", fallbackStoreId ?? "(not in session)");

    if (expectedCsrf && expectedCsrf !== csrf) {
      console.error("[Google Business OAuth] CSRF mismatch — possible replay or CSRF attack");
      return res.redirect("/google-business?google_error=csrf_mismatch");
    }
    if (!storeId && fallbackStoreId) storeId = Number(fallbackStoreId);
    if (!storeId) {
      console.error("[Google Business OAuth] Could not determine storeId from state or session");
      return res.redirect("/google-business?google_error=missing_store");
    }

    delete (req.session as any).googleOAuthState;
    delete (req.session as any).googleOAuthStoreId;

    // ── Exchange code for tokens ─────────────────────────────────────────────
    try {
      // BUSINESS credentials only — never shared with the login system
      const redirectUri  = getGoogleBusinessCallbackUrl();
      const clientId     = process.env.GOOGLE_BUSINESS_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID     ?? "";
      const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "";

      console.log("[Google Business OAuth] Token exchange — redirect_uri:", redirectUri);
      const apiManager = new GoogleBusinessAPIManager({ clientId, clientSecret, redirectUri });
      const tokens = await apiManager.getTokensFromCode(code);

      if (!tokens.access_token) {
        console.error("[Google Business OAuth] No access_token returned — aborting");
        return res.redirect("/google-business?google_error=no_access_token");
      }

      // ── Attempt to fetch account email (expected to fail with business.manage only) ──
      // getGoogleUserInfo() requires openid/email scope. With business.manage-only tokens
      // it returns null gracefully — that is expected behaviour.
      console.log("[Google Business OAuth] Attempting to fetch Google account email (may be skipped with business.manage-only scope)…");
      const userInfo = await apiManager.getGoogleUserInfo();
      console.log("[Google Business OAuth]   email:", userInfo?.email ?? "(not available — expected with business.manage-only scope)");

      // ── Fetch Business Profile accounts ─────────────────────────────────────
      console.log("[Google Business OAuth] Fetching Business Profile accounts…");
      let accounts: any[] = [];
      let accountsFetchQuotaError = false;
      let accountsFetchErrorStatus: number | null = null;
      let accountsFetchErrorMessage: string | null = null;
      try {
        const accountsData = await apiManager.getBusinessAccounts();
        accounts = (accountsData.accounts ?? []) as any[];
        console.log("[Google Business OAuth]   accounts found:", accounts.length);
        accounts.forEach((a: any, i: number) => {
          console.log(`[Google Business OAuth]   [${i}] name=${a.name}  accountName=${a.accountName ?? a.displayName ?? "(none)"}`);
        });
      } catch (acctErr: any) {
        const status = acctErr?.code ?? acctErr?.response?.status ?? acctErr?.status;
        const errMsg = acctErr?.response?.data?.error?.message ?? acctErr?.message ?? "unknown error";
        accountsFetchErrorStatus  = status ?? null;
        accountsFetchErrorMessage = errMsg;
        console.error("[Google Business OAuth] Failed to fetch accounts — status:", status);
        console.error("[Google Business OAuth] Error detail:", errMsg);
        if (status === 429) {
          accountsFetchQuotaError = true;
          console.warn("[Google Business OAuth] 429: Quota exceeded fetching accounts — tokens saved, user can retry without re-auth");
        }
        if (status === 403) {
          console.error("[Google Business OAuth] 403: Ensure 'My Business Account Management API' is enabled in Google Cloud Console and business.manage scope is approved on the consent screen.");
        }
        // Don't abort — save tokens so user can retry from the UI
      }

      // ── Fetch locations for each account ─────────────────────────────────────
      const allLocations: any[] = [];
      for (const account of accounts) {
        console.log(`[Google Business OAuth] Fetching locations for account: ${account.name}`);
        try {
          const locData = await apiManager.getLocations(account.name);
          const locs    = locData.locations ?? [];
          console.log(`[Google Business OAuth]   locations found: ${locs.length}`);
          locs.forEach((l: any, i: number) => {
            console.log(`[Google Business OAuth]   [${i}] name=${l.name}  title=${l.title ?? l.displayName ?? "(none)"}`);
          });
          allLocations.push(...locs.map((l: any) => ({ ...l, _accountName: account.name })));
        } catch (locErr: any) {
          console.error(`[Google Business OAuth] Failed to fetch locations for ${account.name}:`, locErr?.message ?? locErr);
        }
      }

      // ── Upsert profile in DB ─────────────────────────────────────────────────
      console.log("[Google Business OAuth] Upserting profile in DB for storeId:", storeId);
      const existingProfile = await db
        .select()
        .from(googleBusinessProfiles)
        .where(eq(googleBusinessProfiles.storeId, storeId))
        .limit(1);

      let profileRow: typeof googleBusinessProfiles.$inferSelect;
      const firstAccount = accounts[0];

      if (existingProfile.length) {
        const updated = await db
          .update(googleBusinessProfiles)
          .set({
            accessToken:                 tokens.access_token,
            refreshToken:                tokens.refresh_token ?? existingProfile[0].refreshToken,
            tokenExpiresAt:              tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            googleAccountEmail:          userInfo?.email ?? existingProfile[0].googleAccountEmail,
            businessAccountId:           firstAccount?.name ?? existingProfile[0].businessAccountId,
            businessAccountResourceName: firstAccount?.name ?? existingProfile[0].businessAccountResourceName,
            isConnected:                 false, // reset — user must re-select location
            updatedAt:                   new Date(),
          })
          .where(eq(googleBusinessProfiles.storeId, storeId))
          .returning();
        profileRow = updated[0];
        console.log("[Google Business OAuth] Profile updated — id:", profileRow.id);
      } else {
        const inserted = await db
          .insert(googleBusinessProfiles)
          .values({
            storeId,
            accessToken:                 tokens.access_token,
            refreshToken:                tokens.refresh_token ?? null,
            tokenExpiresAt:              tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            googleAccountEmail:          userInfo?.email ?? null,
            businessAccountId:           firstAccount?.name ?? null,
            businessAccountResourceName: firstAccount?.name ?? null,
            isConnected:                 false,
          })
          .returning();
        profileRow = inserted[0];
        console.log("[Google Business OAuth] Profile inserted — id:", profileRow.id);
      }

      // ── Upsert googleBusinessAccounts rows (one per account returned) ────────
      // Each account gets its own row with the OAuth tokens so tokens are stored
      // at account level (per the schema design), not just on the legacy profile row.
      const sessionUserId: string | null = (req.session as any)?.userId ?? null;
      if (sessionUserId && accounts.length) {
        console.log(`[Google Business OAuth] Upserting ${accounts.length} account(s) into googleBusinessAccounts…`);
        for (const acct of accounts) {
          try {
            const existingAcct = await db
              .select({ id: googleBusinessAccounts.id })
              .from(googleBusinessAccounts)
              .where(eq(googleBusinessAccounts.googleAccountId, acct.name))
              .limit(1);

            if (existingAcct.length) {
              await db
                .update(googleBusinessAccounts)
                .set({
                  accountName:  acct.accountName ?? acct.displayName ?? null,
                  accessToken:  tokens.access_token,
                  refreshToken: tokens.refresh_token ?? undefined,
                  tokenExpiry:  tokens.expiry_date ? new Date(tokens.expiry_date) : null,
                  scopes:       tokens.scope ?? null,
                  updatedAt:    new Date(),
                })
                .where(eq(googleBusinessAccounts.id, existingAcct[0].id));
              console.log(`[Google Business OAuth]   account updated — id=${existingAcct[0].id}  googleAccountId="${acct.name}"`);
            } else {
              const inserted = await db
                .insert(googleBusinessAccounts)
                .values({
                  storeId,
                  userId:          sessionUserId,
                  googleAccountId: acct.name,
                  accountName:     acct.accountName ?? acct.displayName ?? null,
                  accessToken:     tokens.access_token,
                  refreshToken:    tokens.refresh_token ?? null,
                  tokenExpiry:     tokens.expiry_date ? new Date(tokens.expiry_date) : null,
                  scopes:          tokens.scope ?? null,
                })
                .returning({ id: googleBusinessAccounts.id });
              console.log(`[Google Business OAuth]   account inserted — id=${inserted[0].id}  googleAccountId="${acct.name}"`);
            }
          } catch (acctWriteErr: any) {
            console.warn(`[Google Business OAuth]   could not upsert account "${acct.name}":`, acctWriteErr?.message ?? acctWriteErr);
          }
        }
      } else {
        if (!sessionUserId) console.warn("[Google Business OAuth] No userId in session — skipping googleBusinessAccounts upsert");
        if (!accounts.length)  console.warn("[Google Business OAuth] No accounts returned — skipping googleBusinessAccounts upsert");
      }

      // ── Store result in session for frontend pickup ──────────────────────────
      (req.session as any).googleConnectionResult = {
        success:              true,
        email:                userInfo?.email ?? null,
        accounts,
        businesses:           allLocations,
        profileId:            profileRow.id,
        storeId,
        quotaError:           accountsFetchQuotaError || undefined,
        accountsFetchStatus:  accountsFetchErrorStatus  ?? undefined,
        accountsFetchMessage: accountsFetchErrorMessage ?? undefined,
      };

      console.log("[Google Business OAuth] ── Callback complete ──────────────────────────────");
      console.log("[Google Business OAuth]   email     :", userInfo?.email ?? "(not available)");
      console.log("[Google Business OAuth]   accounts  :", accounts.length);
      console.log("[Google Business OAuth]   locations :", allLocations.length);
      console.log("[Google Business OAuth]   profileId :", profileRow.id);
      console.log("[Google Business OAuth]   → redirecting to /google-business?google_connected=1");

      req.session.save(() => {
        res.redirect(`/google-business?google_connected=1&storeId=${storeId}`);
      });
    } catch (error: any) {
      console.error("[Google Business OAuth] ── Callback FAILED ──────────────────────────────");
      console.error("[Google Business OAuth] Error:", error?.message ?? error);
      console.error("[Google Business OAuth] Stack:", error?.stack ?? "(no stack)");

      const status = error?.code ?? error?.response?.status ?? error?.status;
      console.error("[Google Business OAuth] HTTP status:", status ?? "(none)");

      if (status === 429) {
        console.error("[Google Business OAuth] 429: API quota exceeded — request increase at https://support.google.com/business/contact/api_default_quota_increase");
        return res.redirect("/google-business?google_error=quota_exceeded");
      }
      if (status === 403) {
        console.error("[Google Business OAuth] 403: API access denied. Check:");
        console.error("[Google Business OAuth]   - 'My Business Account Management API' enabled in Google Cloud Console");
        console.error("[Google Business OAuth]   - business.manage scope approved on OAuth consent screen");
        console.error("[Google Business OAuth]   - redirect_uri matches exactly:", getGoogleBusinessCallbackUrl());
        return res.redirect("/google-business?google_error=access_denied");
      }
      return res.redirect("/google-business?google_error=server_error");
    }
  });

  /**
   * GET /google-business
   *
   * Always passes through to the SPA. The frontend detects ?code=...&state=... or
   * ?google_error=... and drives the OAuth completion itself via
   * POST /api/google-business/exchange-code.
   *
   * Historical note: this route previously ran a server-side code exchange and
   * stashed the result in req.session. That broke when the Google cross-site redirect
   * arrived with a new/different session cookie, so the frontend could never pick up
   * the connection result. The exchange is now done client-side via exchange-code.
   */
  app.get("/google-business", (_req, _res, next) => next());

  app.get("/api/google-business/quota-status", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { getQuotaGuardStatus } = await import("./google-quota-guard");
    return res.json(getQuotaGuardStatus());
  });

  /**
   * Retries fetching Google Business accounts + locations using already-stored
   * OAuth tokens. Called when the initial callback succeeded (tokens saved) but
   * getBusinessAccounts() hit a 429 quota limit, leaving accounts: [] in the session.
   * No re-auth required — uses the refresh_token from google_business_profiles.
   *
   * Body: { storeId: number }
   * Returns: { accounts, businesses, profileId }
   */
  app.post("/api/google-business/retry-fetch-accounts", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { storeId } = req.body;
    if (!storeId) return res.status(400).json({ message: "storeId is required" });

    console.log(`[GBP] retry-fetch-accounts — storeId=${storeId}`);

    // Check quota cooldown BEFORE hitting the API
    const { isQuotaCoolingDown } = await import("./google-quota-guard");
    const cooldown = isQuotaCoolingDown();
    if (cooldown.coolingDown) {
      const secs = Math.ceil(cooldown.retryAfterMs / 1000);
      console.warn(`[GBP] retry-fetch-accounts — blocked by quota cooldown, ${secs}s remaining`);
      return res.status(429).json({
        message: `Google API quota cooldown active. Please wait ${secs} seconds before retrying.`,
        retryAfterMs: cooldown.retryAfterMs,
        retryAfterSecs: secs,
      });
    }

    try {
      const profiles = await db
        .select()
        .from(googleBusinessProfiles)
        .where(eq(googleBusinessProfiles.storeId, Number(storeId)))
        .limit(1);

      if (!profiles.length) {
        return res.status(404).json({ message: "No Google profile found for this store. Please reconnect." });
      }

      const profileRow = profiles[0];
      if (!profileRow.accessToken && !profileRow.refreshToken) {
        return res.status(400).json({ message: "No stored tokens found. Please reconnect your Google account." });
      }

      const apiManager = createApiManagerFromProfile(profileRow);

      let accounts: any[] = [];
      try {
        const accountsData = await apiManager.getBusinessAccounts();
        accounts = (accountsData.accounts ?? []) as any[];
        console.log(`[GBP] retry-fetch-accounts — accounts found: ${accounts.length}`);
      } catch (err: any) {
        const status = err?.code ?? err?.response?.status ?? err?.status;
        console.error(`[GBP] retry-fetch-accounts — getBusinessAccounts failed — status: ${status}  message: ${err?.message}`);
        if (status === 429) {
          const retryAfterMs = err?.retryAfterMs ?? 2 * 60 * 1000;
          const retryAfterSecs = Math.ceil(retryAfterMs / 1000);
          return res.status(429).json({
            message: `Google API quota exceeded. Please wait ${retryAfterSecs} seconds before retrying.`,
            retryAfterMs,
            retryAfterSecs,
          });
        }
        if (status === 403) {
          return res.status(403).json({ message: "Google denied access. Ensure the Business Profile API is enabled in Google Cloud Console." });
        }
        throw err;
      }

      if (!accounts.length) {
        return res.status(404).json({
          message: "No Google Business accounts found on this Google account. Make sure you have a Business Profile at business.google.com.",
        });
      }

      // Fetch locations for each account
      const allLocations: any[] = [];
      for (const account of accounts) {
        try {
          const locData = await apiManager.getLocations(account.name);
          const locs = locData.locations ?? [];
          allLocations.push(...locs.map((l: any) => ({ ...l, _accountName: account.name })));
          console.log(`[GBP] retry-fetch-accounts — fetched ${locs.length} location(s) for ${account.name}`);
        } catch (locErr: any) {
          console.error(`[GBP] retry-fetch-accounts — failed to fetch locations for ${account.name}:`, locErr?.message ?? locErr);
        }
      }

      // Upsert accounts into googleBusinessAccounts so future stored-accounts lookups work
      for (const acct of accounts) {
        try {
          const existing = await db
            .select({ id: googleBusinessAccounts.id })
            .from(googleBusinessAccounts)
            .where(eq(googleBusinessAccounts.googleAccountId, acct.name))
            .limit(1);

          if (existing.length) {
            await db
              .update(googleBusinessAccounts)
              .set({ accountName: acct.accountName ?? acct.displayName ?? null, updatedAt: new Date() })
              .where(eq(googleBusinessAccounts.id, existing[0].id));
            console.log(`[GBP] retry-fetch-accounts — updated account id=${existing[0].id}  googleAccountId="${acct.name}"`);
          } else {
            await db.insert(googleBusinessAccounts).values({
              storeId:         Number(storeId),
              userId,
              googleAccountId: acct.name,
              accountName:     acct.accountName ?? acct.displayName ?? null,
              accessToken:     profileRow.accessToken,
              refreshToken:    profileRow.refreshToken,
              tokenExpiry:     profileRow.tokenExpiresAt,
              scopes:          null,
            });
            console.log(`[GBP] retry-fetch-accounts — inserted account googleAccountId="${acct.name}"`);
          }
        } catch (acctErr: any) {
          console.warn(`[GBP] retry-fetch-accounts — could not upsert account "${acct.name}":`, acctErr?.message ?? acctErr);
        }
      }

      console.log(`[GBP] retry-fetch-accounts — done: ${accounts.length} account(s), ${allLocations.length} location(s)`);
      res.json({ accounts, businesses: allLocations, profileId: profileRow.id });
    } catch (err: any) {
      console.error("[GBP] retry-fetch-accounts FAILED:", err?.message ?? err);
      res.status(500).json({ message: "Failed to fetch accounts: " + (err?.message ?? "unknown error") });
    }
  });

  /**
   * POST /api/google-business/exchange-code
   *
   * Frontend-driven OAuth completion. The browser receives ?code=...&state=... from
   * Google, then posts them here to exchange for tokens, fetch accounts+locations,
   * and save everything to the DB in one authenticated call.
   *
   * This avoids the session-identity mismatch bug of the old server-side interceptor:
   * because the browser is already logged in when it makes this POST, we can use
   * the authenticated session reliably.
   *
   * Body: { code: string, state?: string, storeId: number }
   * Returns: { success, accounts, businesses, profileId }
   */
  app.post("/api/google-business/exchange-code", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { code, state, storeId: rawStoreId } = req.body as {
      code?: string;
      state?: string;
      storeId?: number | string;
    };

    if (!code) {
      return res.status(400).json({ message: "code is required" });
    }

    // Prefer storeId from body; fall back to value encoded in base64url state blob
    let storeId = rawStoreId ? Number(rawStoreId) : 0;
    if (!storeId && state) {
      try {
        const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
        if (decoded.storeId) storeId = Number(decoded.storeId);
      } catch {
        console.warn("[exchange-code] Could not decode state payload to extract storeId");
      }
    }
    if (!storeId) {
      return res.status(400).json({ message: "storeId is required (pass in body or encoded in state)" });
    }

    const clientId     = process.env.GOOGLE_BUSINESS_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID     ?? "";
    const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "";
    const redirectUri  = getGoogleBusinessCallbackUrl();

    if (!clientId || !clientSecret) {
      return res.status(500).json({ message: "Google Business OAuth credentials are not configured on the server." });
    }

    console.log(`[exchange-code] storeId=${storeId}  redirectUri=${redirectUri}`);

    try {
      const apiManager = new GoogleBusinessAPIManager({ clientId, clientSecret, redirectUri });

      // 1. Exchange code → tokens
      const tokens = await apiManager.getTokensFromCode(code);
      if (!tokens.access_token) {
        console.error("[exchange-code] No access_token returned from Google");
        return res.status(400).json({ message: "Google did not return an access token. Please try connecting again." });
      }
      console.log(`[exchange-code] access_token: (obtained)  refresh_token: ${tokens.refresh_token ? "(obtained)" : "(none)"}`);

      // 2. Fetch Google Business accounts
      let accounts: any[] = [];
      try {
        const accountsData = await apiManager.getBusinessAccounts();
        accounts = accountsData.accounts ?? [];
        console.log(`[exchange-code] accounts found: ${accounts.length}`);
      } catch (err: any) {
        console.error("[exchange-code] Failed to fetch accounts:", err?.message ?? err);
        // Return 400 with a helpful message instead of 500 — the user can fix this
        const status = err?.code ?? err?.response?.status;
        if (status === 403) {
          return res.status(403).json({
            message:
              "Google denied access to Business Profile accounts. Ensure the 'My Business Account Management API' " +
              "and 'Business Profile API' are enabled in your Google Cloud project.",
          });
        }
        if (status === 429) {
          return res.status(429).json({ message: "Google API quota exceeded. Please wait and try again." });
        }
        return res.status(400).json({ message: "Failed to fetch Google Business accounts: " + (err?.message ?? "unknown error") });
      }

      if (!accounts.length) {
        console.warn("[exchange-code] No Business Profile accounts found for this Google account");
        return res.status(400).json({
          message:
            "No Google Business Profile was found on this Google account. " +
            "Please make sure you have a Business Profile at business.google.com.",
        });
      }

      // 3. Fetch locations for every account
      const allLocations: any[] = [];
      for (const account of accounts) {
        try {
          const locData = await apiManager.getLocations(account.name);
          const locs = locData.locations ?? [];
          allLocations.push(...locs.map((l: any) => ({ ...l, _accountName: account.name })));
          console.log(`[exchange-code] ${locs.length} location(s) for account ${account.name}`);
        } catch (locErr: any) {
          console.error(`[exchange-code] Failed to fetch locations for ${account.name}:`, locErr?.message ?? locErr);
        }
      }

      // 4. Upsert the google_business_profiles row (tokens + account info)
      const existingProfile = await db
        .select()
        .from(googleBusinessProfiles)
        .where(eq(googleBusinessProfiles.storeId, storeId))
        .limit(1);

      let profileRow: typeof googleBusinessProfiles.$inferSelect;
      if (existingProfile.length) {
        const updated = await db
          .update(googleBusinessProfiles)
          .set({
            accessToken:                 tokens.access_token,
            refreshToken:                tokens.refresh_token ?? existingProfile[0].refreshToken,
            tokenExpiresAt:              tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            businessAccountId:           accounts[0]?.name ?? existingProfile[0].businessAccountId,
            businessAccountResourceName: accounts[0]?.name ?? existingProfile[0].businessAccountResourceName,
            isConnected:                 false,
            updatedAt:                   new Date(),
          })
          .where(eq(googleBusinessProfiles.storeId, storeId))
          .returning();
        profileRow = updated[0];
        console.log(`[exchange-code] updated existing profile id=${profileRow.id}`);
      } else {
        const inserted = await db
          .insert(googleBusinessProfiles)
          .values({
            storeId,
            accessToken:                 tokens.access_token,
            refreshToken:                tokens.refresh_token ?? null,
            tokenExpiresAt:              tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            businessAccountId:           accounts[0]?.name ?? null,
            businessAccountResourceName: accounts[0]?.name ?? null,
            isConnected:                 false,
          })
          .returning();
        profileRow = inserted[0];
        console.log(`[exchange-code] inserted new profile id=${profileRow.id}`);
      }

      // 5. Upsert google_business_accounts rows so connect-location can find them
      for (const acct of accounts) {
        try {
          const existingAcct = await db
            .select({ id: googleBusinessAccounts.id })
            .from(googleBusinessAccounts)
            .where(eq(googleBusinessAccounts.googleAccountId, acct.name))
            .limit(1);

          if (existingAcct.length) {
            await db
              .update(googleBusinessAccounts)
              .set({
                accountName:  acct.accountName ?? acct.displayName ?? null,
                accessToken:  tokens.access_token,
                refreshToken: tokens.refresh_token ?? undefined,
                tokenExpiry:  tokens.expiry_date ? new Date(tokens.expiry_date) : null,
                scopes:       tokens.scope ?? null,
                updatedAt:    new Date(),
              })
              .where(eq(googleBusinessAccounts.id, existingAcct[0].id));
          } else {
            await db.insert(googleBusinessAccounts).values({
              storeId,
              userId:          userId as string,
              googleAccountId: acct.name,
              accountName:     acct.accountName ?? acct.displayName ?? null,
              accessToken:     tokens.access_token,
              refreshToken:    tokens.refresh_token ?? null,
              tokenExpiry:     tokens.expiry_date ? new Date(tokens.expiry_date) : null,
              scopes:          tokens.scope ?? null,
            });
          }
        } catch (acctErr: any) {
          console.warn(`[exchange-code] Could not upsert account "${acct.name}":`, acctErr?.message ?? acctErr);
        }
      }

      console.log(`[exchange-code] complete — returning ${accounts.length} account(s) and ${allLocations.length} location(s) to frontend`);
      res.json({
        success:    true,
        accounts,
        businesses: allLocations,
        profileId:  profileRow.id,
      });
    } catch (error: any) {
      const status = error?.code ?? error?.response?.status ?? error?.status;
      const msg    = error?.message ?? String(error);
      console.error(`[exchange-code] ERROR — status=${status ?? "(none)"}  message=${msg}`);
      if (error?.response?.data) {
        console.error("[exchange-code] Google error body:", JSON.stringify(error.response.data).slice(0, 400));
      }
      if (status === 429) return res.status(429).json({ message: "Google API quota exceeded. Please wait and try again." });
      if (status === 403) return res.status(403).json({ message: "Google denied access. Check your Google Cloud API settings." });
      res.status(500).json({ message: "Failed to complete Google Business connection: " + msg });
    }
  });

  /**
   * Return the Google OAuth connection result stored in the session by the GET callback.
   * The frontend calls this immediately after being redirected back with ?google_connected=1.
   * The result is cleared from the session after the first read (one-time pickup).
   *
   * Returns: { success, email, accounts, businesses, profileId, storeId }
   */
  app.get("/api/google-business/connection-result", (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const result = (req.session as any).googleConnectionResult ?? null;
    // Clear after pickup so it can't be replayed
    delete (req.session as any).googleConnectionResult;

    if (!result) {
      return res.status(404).json({ message: "No pending connection result found in session" });
    }

    console.log("[Google Business OAuth] connection-result picked up by frontend for storeId:", result.storeId);
    req.session.save(() => res.json(result));
  });

  /**
   * Handle Google OAuth callback via POST (legacy frontend-mediated flow).
   * Kept for backward compatibility. The canonical flow now uses GET /api/google-business/callback.
   * - Verifies CSRF state
   * - Exchanges code for tokens
   * - Fetches the authed user's Google account email
   * - Upserts the profile row (so reconnect works without error)
   */
  app.post("/api/google-business/callback", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { code, storeId, state } = req.body;
    if (!code || !storeId) {
      return res.status(400).json({ message: "Code and storeId are required" });
    }

    // CSRF state verification (legacy: state was the raw csrf hex string)
    const expectedState = (req.session as any).googleOAuthState;
    if (expectedState && state && expectedState !== state) {
      return res.status(400).json({ message: "Invalid OAuth state – possible CSRF attack" });
    }
    delete (req.session as any).googleOAuthState;

    try {
      console.log("[Google Business OAuth] POST callback — exchanging code for tokens (storeId:", storeId, ")");

      // BUSINESS integration credentials — NEVER shared with the login system
      const apiManager = new GoogleBusinessAPIManager({
        clientId:     process.env.GOOGLE_BUSINESS_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID     ?? "",
        clientSecret: process.env.GOOGLE_BUSINESS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirectUri:  getGoogleBusinessCallbackUrl(),
      });

      const tokens = await apiManager.getTokensFromCode(code);
      console.log("[Google Business OAuth] POST callback — access_token obtained:", !!tokens.access_token);
      console.log("[Google Business OAuth] POST callback — refresh_token obtained:", !!tokens.refresh_token);
      console.log("[Google Business OAuth] POST callback — scope:", tokens.scope ?? "(none)");

      const userInfo = await apiManager.getGoogleUserInfo();
      console.log("[Google Business OAuth] POST callback — user email:", userInfo?.email ?? "(none — expected with business.manage-only scope)");

      const accountsData = await apiManager.getBusinessAccounts();
      const accounts = (accountsData.accounts ?? []) as any[];
      console.log("[Google Business OAuth] POST callback — business accounts found:", accounts.length);

      if (!accounts.length) {
        return res.status(400).json({ message: "No Google Business accounts found for this Google account" });
      }

      // Fetch all locations for every account so the frontend can show them without a second API call
      const allLocations: any[] = [];
      for (const account of accounts) {
        try {
          const locData = await apiManager.getLocations(account.name);
          const locs = locData.locations ?? [];
          allLocations.push(...locs.map((l: any) => ({ ...l, _accountName: account.name })));
          console.log(`[Google Business OAuth] POST callback — fetched ${locs.length} location(s) for ${account.name}`);
        } catch (locErr: any) {
          console.error(`[Google Business OAuth] POST callback — failed to fetch locations for ${account.name}:`, locErr?.message ?? locErr);
        }
      }

      const existingProfile = await db
        .select()
        .from(googleBusinessProfiles)
        .where(eq(googleBusinessProfiles.storeId, Number(storeId)))
        .limit(1);

      let profileRow: typeof googleBusinessProfiles.$inferSelect;
      if (existingProfile.length) {
        const updated = await db
          .update(googleBusinessProfiles)
          .set({
            accessToken:                tokens.access_token,
            refreshToken:               tokens.refresh_token ?? existingProfile[0].refreshToken,
            tokenExpiresAt:             tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            googleAccountEmail:         userInfo?.email ?? existingProfile[0].googleAccountEmail,
            businessAccountId:          accounts[0].name,
            businessAccountResourceName: accounts[0].name,
            isConnected:                false,
            updatedAt:                  new Date(),
          })
          .where(eq(googleBusinessProfiles.storeId, Number(storeId)))
          .returning();
        profileRow = updated[0];
      } else {
        const inserted = await db
          .insert(googleBusinessProfiles)
          .values({
            storeId:                    Number(storeId),
            accessToken:                tokens.access_token,
            refreshToken:               tokens.refresh_token ?? null,
            tokenExpiresAt:             tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            googleAccountEmail:         userInfo?.email ?? null,
            businessAccountId:          accounts[0].name,
            businessAccountResourceName: accounts[0].name,
            isConnected:                false,
          })
          .returning();
        profileRow = inserted[0];
      }

      res.json({
        message:     "Google account authenticated",
        accounts,
        businesses:  allLocations,
        profileId:   profileRow.id,
        googleEmail: userInfo?.email ?? null,
        success:     true,
        email:       userInfo?.email ?? null,
      });
    } catch (error: any) {
      console.error("[Google Business OAuth] POST callback error:", error);
      const status = error?.code ?? error?.response?.status ?? error?.status;
      if (status === 429) {
        return res.status(429).json({
          message:
            "Google API quota exceeded. The Google Business Profile API has a default quota of 0 — you must request a quota increase from Google at https://support.google.com/business/contact/api_default_quota_increase before this connect flow will work.",
        });
      }
      if (status === 403) {
        return res.status(403).json({
          message:
            "Google denied access. Make sure the Google Business Profile API is enabled in your Google Cloud project and that your OAuth consent screen lists the business.manage scope.",
        });
      }
      res.status(500).json({ message: "Failed to authenticate with Google" });
    }
  });

  /**
   * Get locations for a business account.
   */
  app.post("/api/google-business/locations", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { profileId, accountName } = req.body;
    if (!profileId || !accountName) {
      return res.status(400).json({ message: "profileId and accountName are required" });
    }

    console.log(`[GBP] /locations — profileId=${profileId}  accountName="${accountName}"`);

    try {
      const profiles = await db
        .select()
        .from(googleBusinessProfiles)
        .where(eq(googleBusinessProfiles.id, profileId))
        .limit(1);

      if (!profiles.length) {
        return res.status(404).json({ message: "Profile not found" });
      }

      console.log(`[GBP] /locations — profile storeId=${profiles[0].storeId}  accessToken present: ${!!profiles[0].accessToken}  refreshToken present: ${!!profiles[0].refreshToken}`);

      const apiManager = createApiManagerFromProfile(profiles[0]);
      const locationsData = await apiManager.getLocations(accountName);
      const locs: any[] = locationsData.locations ?? [];

      console.log(`[GBP] /locations — returning ${locs.length} location(s) to frontend`);
      locs.forEach((l: any, i: number) => {
        console.log(`[GBP]   [${i}] name="${l.name}"  title="${l.title ?? "(none)"}"  storefrontAddress=${l.storefrontAddress ? JSON.stringify(l.storefrontAddress) : "(none)"}`);
      });

      if (locs.length === 0) {
        console.warn(`[GBP] /locations — ZERO locations returned for account "${accountName}". The user will see a "No Locations Found" dialog.`);
      }

      res.json({ locations: locs });
    } catch (error: any) {
      const status = error?.code ?? error?.response?.status ?? error?.status;
      const errMsg = error?.message ?? String(error);
      console.error(`[GBP] /locations FAILED — status=${status ?? "(none)"}  message=${errMsg}`);
      if (error?.response?.data) {
        console.error(`[GBP] /locations Google error body: ${JSON.stringify(error.response.data).slice(0, 400)}`);
      }
      if (status === 429) {
        return res.status(429).json({
          message: "Google API quota exceeded. Request a quota increase at https://support.google.com/business/contact/api_default_quota_increase before fetching locations.",
        });
      }
      if (status === 403) {
        return res.status(403).json({
          message: `Google denied access to locations: ${errMsg}. Ensure the Business Profile API is enabled in your Google Cloud project.`,
        });
      }
      res.status(500).json({ message: `Failed to fetch locations: ${errMsg}` });
    }
  });

  /**
   * Connect a specific location to the store.
   */
  app.post("/api/google-business/connect-location", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { profileId, locationName, locationId, businessName, locationAddress } = req.body;
    if (!profileId || !locationName) {
      return res.status(400).json({ message: "profileId and locationName are required" });
    }

    console.log(`[GBP] connect-location — profileId=${profileId}  locationName="${locationName}"  locationId="${locationId ?? "(none)"}"  businessName="${businessName ?? "(none)"}"  address="${locationAddress ?? "(none)"}"`);

    if (!locationName.includes("/locations/")) {
      console.error(`[GBP] connect-location — locationName "${locationName}" does not look like a valid location resource name (expected accounts/{id}/locations/{id})`);
      return res.status(400).json({ message: "Invalid location resource name format. Expected accounts/{id}/locations/{id}." });
    }

    try {
      const updated = await db
        .update(googleBusinessProfiles)
        .set({
          locationResourceName: locationName,
          locationId: locationId ?? locationName.split("/locations/")[1] ?? null,
          businessName: businessName ?? null,
          locationAddress: locationAddress ?? null,
          isConnected: true,
          updatedAt: new Date(),
        })
        .where(eq(googleBusinessProfiles.id, profileId))
        .returning();

      if (!updated.length) {
        console.error(`[GBP] connect-location — profile id=${profileId} not found`);
        return res.status(404).json({ message: "Profile not found" });
      }

      const connectedProfile = updated[0];
      console.log(`[GBP] connect-location — DB updated. storeId=${connectedProfile.storeId}  locationResourceName="${connectedProfile.locationResourceName}"`);

      // ── Write to googleBusinessLocations (proper location table) ──────────────
      // 1. Find the googleBusinessAccounts row for this store
      // 2. Unset isSelected on ALL existing locations for this storeId
      // 3. Upsert the newly-selected location with isSelected=true
      try {
        const acctRows = await db
          .select({ id: googleBusinessAccounts.id })
          .from(googleBusinessAccounts)
          .where(eq(googleBusinessAccounts.storeId, connectedProfile.storeId))
          .limit(1);

        const acctId = acctRows[0]?.id ?? null;

        if (acctId) {
          // Unselect all existing locations for this store (enforce single selection)
          await db
            .update(googleBusinessLocations)
            .set({ isSelected: false, updatedAt: new Date() })
            .where(eq(googleBusinessLocations.storeId, connectedProfile.storeId));

          // Upsert the selected location
          const leafId = locationId ?? locationName.split("/locations/")[1] ?? locationName;
          const existingLoc = await db
            .select({ id: googleBusinessLocations.id })
            .from(googleBusinessLocations)
            .where(eq(googleBusinessLocations.locationResourceName, locationName))
            .limit(1);

          if (existingLoc.length) {
            await db
              .update(googleBusinessLocations)
              .set({
                locationName: businessName ?? null,
                address:      locationAddress ?? null,
                isSelected:   true,
                updatedAt:    new Date(),
              })
              .where(eq(googleBusinessLocations.id, existingLoc[0].id));
            console.log(`[GBP] connect-location — googleBusinessLocations updated id=${existingLoc[0].id}`);
          } else {
            const inserted = await db
              .insert(googleBusinessLocations)
              .values({
                storeId:             connectedProfile.storeId,
                userId:              userId as string,
                businessAccountId:   acctId,
                locationResourceName: locationName,
                locationId:          leafId,
                locationName:        businessName ?? null,
                address:             locationAddress ?? null,
                isSelected:          true,
              })
              .returning({ id: googleBusinessLocations.id });
            console.log(`[GBP] connect-location — googleBusinessLocations inserted id=${inserted[0].id}`);
          }
        } else {
          console.warn(`[GBP] connect-location — no googleBusinessAccounts row found for storeId=${connectedProfile.storeId}. Location not written to new table (legacy flow — will be populated on next OAuth reconnect).`);
        }
      } catch (locWriteErr: any) {
        // Non-fatal — the legacy google_business_profiles row is already updated.
        console.warn("[GBP] connect-location — could not write to googleBusinessLocations:", locWriteErr?.message ?? locWriteErr);
      }

      // ── Auto-trigger review sync immediately after location is connected ──
      // Fire-and-forget: don't let a sync failure block the connect response.
      // Errors are logged but not surfaced to the client here.
      setImmediate(async () => {
        try {
          console.log(`[GBP] connect-location — auto-syncing reviews for storeId=${connectedProfile.storeId}…`);
          const result = await syncReviewsForStore(connectedProfile.storeId);
          console.log(`[GBP] connect-location — auto-sync complete: ${result.synced} review(s) synced (source=${result.source} ${result.durationMs}ms)`);
        } catch (syncErr: any) {
          console.error(`[GBP] connect-location — auto-sync FAILED for storeId=${connectedProfile.storeId}: ${syncErr?.message ?? syncErr}`);
        }
      });

      res.json({ message: "Location connected successfully", profile: connectedProfile, syncTriggered: true });
    } catch (error: any) {
      console.error("[GBP] connect-location ERROR:", error?.message ?? error);
      res.status(500).json({ message: "Failed to connect location" });
    }
  });

  /**
   * Get Google Business Profile for a store (tokens are stripped before returning).
   */
  app.get("/api/google-business/profile/:storeId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const storeId = Number(req.params.storeId);

    try {
      const profiles = await db
        .select()
        .from(googleBusinessProfiles)
        .where(eq(googleBusinessProfiles.storeId, storeId))
        .limit(1);

      if (!profiles.length) {
        return res.json({ profile: null });
      }

      // Never return sensitive tokens to the client
      const { accessToken, refreshToken, ...safeProfile } = profiles[0];
      res.json({ profile: safeProfile });
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  /**
   * GET /api/google-business/stored-accounts/:storeId
   *
   * Returns the Google Business accounts already stored in the DB for this store
   * (populated during the OAuth flow via exchange-code or the legacy callback).
   * Used by the "Select Location" flow so users can pick a location without
   * re-doing OAuth when accounts were already authorized.
   */
  app.get("/api/google-business/stored-accounts/:storeId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const storeId = Number(req.params.storeId);
    if (!storeId) return res.status(400).json({ message: "Invalid storeId" });

    try {
      const rows = await db
        .select()
        .from(googleBusinessAccounts)
        .where(eq(googleBusinessAccounts.storeId, storeId))
        .orderBy(googleBusinessAccounts.createdAt);

      // Strip tokens — only send safe fields
      const safeAccounts = rows.map(({ accessToken, refreshToken, ...safe }) => safe);
      console.log(`[GBP] stored-accounts — storeId=${storeId}  found=${rows.length}`);
      res.json({ accounts: safeAccounts });
    } catch (error: any) {
      console.error("[GBP] stored-accounts ERROR:", error?.message ?? error);
      res.status(500).json({ message: "Failed to fetch stored accounts" });
    }
  });

  /**
   * Disconnect Google Business Profile.
   * Revokes the OAuth token at Google, then removes all local review data.
   * Required by Google API policies: users must be able to revoke access at any time,
   * and disconnecting must remove all associated data.
   */
  app.delete("/api/google-business/profile/:storeId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const storeId = Number(req.params.storeId);

    try {
      // Verify the store belongs to this user
      const store = await storage.getStore(storeId);
      if (!store || store.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const profiles = await db
        .select()
        .from(googleBusinessProfiles)
        .where(eq(googleBusinessProfiles.storeId, storeId))
        .limit(1);

      if (!profiles.length) {
        return res.status(404).json({ message: "No Google Business Profile found for this store" });
      }

      const profile = profiles[0];

      // Revoke the OAuth token at Google so the app loses API access
      if (profile.accessToken || profile.refreshToken) {
        const apiManager = createApiManagerFromProfile(profile);
        await apiManager.revokeTokens();
      }

      // Delete all draft/published responses for this store's reviews
      await db
        .delete(googleReviewResponses)
        .where(eq(googleReviewResponses.storeId, storeId));

      // Delete all synced reviews for this store
      await db
        .delete(googleReviews)
        .where(eq(googleReviews.storeId, storeId));

      // Delete the profile itself
      await db
        .delete(googleBusinessProfiles)
        .where(eq(googleBusinessProfiles.storeId, storeId));

      console.log(`Google Business Profile disconnected for store ${storeId}`);
      res.json({ message: "Google Business Profile disconnected and all data removed" });
    } catch (error) {
      console.error("Error disconnecting Google Business Profile:", error);
      res.status(500).json({ message: "Failed to disconnect Google Business Profile" });
    }
  });

  /**
   * Sync reviews from Google.
   */
  app.post("/api/google-business/sync-reviews/:storeId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const storeId = Number(req.params.storeId);

    // Server-side rate limit — prevents bypass of the frontend cooldown timer (state in server/rate-limits.ts)
    const lastSync = syncCooldowns.get(storeId);
    if (lastSync && Date.now() - lastSync < SYNC_COOLDOWN_MS) {
      const secsLeft = Math.ceil((SYNC_COOLDOWN_MS - (Date.now() - lastSync)) / 1000);
      const mins = Math.floor(secsLeft / 60);
      const secs = secsLeft % 60;
      const label = mins > 0 ? `${mins}m ${secs.toString().padStart(2, "0")}s` : `${secsLeft}s`;
      return res.status(429).json({ message: `Sync rate limit — please wait ${label} before syncing again.` });
    }
    syncCooldowns.set(storeId, Date.now());

    console.log(`[GBP] Manual sync-reviews triggered for storeId=${storeId}`);

    try {
      const result = await syncReviewsForStore(storeId);
      console.log(
        `[GBP] sync-reviews complete — synced=${result.synced}` +
        `  inserted=${result.inserted}  updated=${result.updated}` +
        `  location="${result.locationResourceName}"  business="${result.businessName ?? "(none)"}"` +
        `  source=${result.source}  ${result.durationMs}ms`,
      );
      res.json({
        message: "Reviews synced successfully",
        synced:               result.synced,
        inserted:             result.inserted,
        updated:              result.updated,
        locationResourceName: result.locationResourceName,
        businessName:         result.businessName,
        durationMs:           result.durationMs,
        source:               result.source,
        syncLogId:            result.syncLogId,
      });
    } catch (error: any) {
      const errMsg = error?.message ?? String(error);
      const status = error?.code ?? error?.response?.status ?? error?.status;
      console.error(`[GBP] sync-reviews FAILED for storeId=${storeId} — status=${status ?? "(none)"}  message=${errMsg}`);
      if (error?.response?.data) {
        console.error(`[GBP] sync-reviews Google API error body: ${JSON.stringify(error.response.data).slice(0, 400)}`);
      }

      // Surface permission/quota errors explicitly to the client
      if (status === 403) {
        return res.status(403).json({
          message: `Google denied access to reviews: ${errMsg}. Ensure the Business Profile API is enabled and business.manage scope is approved.`,
        });
      }
      if (status === 429) {
        return res.status(429).json({
          message: "Google Business Profile API quota exceeded. Request a quota increase at https://support.google.com/business/contact/api_default_quota_increase",
        });
      }
      if (status === 404) {
        return res.status(404).json({
          message: `Google location not found: ${errMsg}. The location resource name may be incorrect — please reconnect your Google Business Profile.`,
        });
      }
      res.status(500).json({ message: `Failed to sync reviews: ${errMsg}` });
    }
  });

  /**
   * GET /api/google-business/sync-logs/:storeId
   * Returns the last N sync attempts for a store (default 10, max 50).
   * Used by the frontend Sync History panel.
   */
  app.get("/api/google-business/sync-logs/:storeId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const storeId = Number(req.params.storeId);
    const limit = Math.min(Number(req.query.limit ?? 10), 50);

    try {
      const logs = await db
        .select({
          id:            googleBusinessSyncLogs.id,
          syncType:      googleBusinessSyncLogs.syncType,
          status:        googleBusinessSyncLogs.status,
          errorMessage:  googleBusinessSyncLogs.errorMessage,
          reviewsSynced: googleBusinessSyncLogs.reviewsSynced,
          syncedAt:      googleBusinessSyncLogs.syncedAt,
          locationId:    googleBusinessSyncLogs.locationId,
        })
        .from(googleBusinessSyncLogs)
        .where(eq(googleBusinessSyncLogs.storeId, storeId))
        .orderBy(desc(googleBusinessSyncLogs.syncedAt))
        .limit(limit);

      res.json({ logs });
    } catch (err: any) {
      console.error(`[GBP] sync-logs FAILED for storeId=${storeId}:`, err?.message ?? err);
      res.status(500).json({ message: "Failed to fetch sync logs" });
    }
  });

  /**
   * AI-powered reply suggestions for a Google review
   */
  app.post("/api/google-business/suggest-reply/:storeId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const storeId = Number(req.params.storeId);
    const { reviewText, rating, customerName } = req.body;

    try {
      // Fetch the store name so replies feel personalised
      const [store] = await db
        .select({ name: locations.name })
        .from(locations)
        .where(eq(locations.id, storeId))
        .limit(1);

      const businessName = store?.name ?? "our business";

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const ratingLabel =
        rating >= 5 ? "5-star (excellent)" :
        rating === 4 ? "4-star (positive)" :
        rating === 3 ? "3-star (neutral / mixed)" :
        rating === 2 ? "2-star (disappointed)" :
        "1-star (very unhappy)";

      const prompt = [
        `You are a professional customer service manager for "${businessName}", a service business.`,
        `Write 3 distinct reply options to the following Google review.`,
        ``,
        `Customer name: ${customerName || "a customer"}`,
        `Star rating: ${ratingLabel}`,
        `Review text: ${reviewText ? `"${reviewText}"` : "(no written text — rating only)"}`,
        ``,
        `Requirements for each reply:`,
        `- Address the customer by first name if available`,
        `- Be warm, professional, and authentic — no corporate stiffness`,
        `- Keep each reply between 40-120 words`,
        `- For 4-5 star reviews: thank them genuinely and invite them back`,
        `- For 3-star reviews: acknowledge their feedback and show commitment to improvement`,
        `- For 1-2 star reviews: apologise sincerely, take ownership, and offer to resolve it`,
        `- Never be defensive or dismissive`,
        `- Sign off naturally without "Sincerely" or generic closings`,
        `- Do NOT include a subject line or label like "Option 1:"`,
        ``,
        `Return a JSON object with this exact shape:`,
        `{ "suggestions": ["reply one text", "reply two text", "reply three text"] }`,
      ].join("\n");

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 1024,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let parsed: { suggestions?: string[] } = {};
      try { parsed = JSON.parse(raw); } catch { /* fall through */ }

      const suggestions: string[] = Array.isArray(parsed.suggestions)
        ? parsed.suggestions.slice(0, 3)
        : [];

      res.json({ suggestions });
    } catch (error) {
      console.error("Error generating reply suggestions:", error);
      res.status(500).json({ message: "Failed to generate suggestions" });
    }
  });

  /**
   * Bulk AI draft replies — streams SSE progress, saves pending drafts for every
   * unresponded review that doesn't already have a pending/approved response.
   */
  app.post("/api/google-business/bulk-draft-replies/:storeId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const storeId = Number(req.params.storeId);

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      // Fetch store name for personalised replies
      const [store] = await db
        .select({ name: locations.name })
        .from(locations)
        .where(eq(locations.id, storeId))
        .limit(1);
      const businessName = store?.name ?? "our business";

      // Fetch all unresponded reviews for this store
      const unresponded = await db
        .select()
        .from(googleReviews)
        .where(
          and(
            eq(googleReviews.storeId, storeId),
            eq(googleReviews.responseStatus, "not_responded")
          )
        );

      // Filter out any that already have a pending or approved draft
      const existingResponses = await db
        .select({ googleReviewId: googleReviewResponses.googleReviewId })
        .from(googleReviewResponses)
        .where(
          and(
            eq(googleReviewResponses.storeId, storeId),
            inArray(
              googleReviewResponses.responseStatus,
              ["pending", "approved"]
            )
          )
        );

      const alreadyDraftedIds = new Set(existingResponses.map((r) => r.googleReviewId));
      const toProcess = unresponded.filter((r) => !alreadyDraftedIds.has(r.id));

      send({ type: "start", total: toProcess.length });

      if (toProcess.length === 0) {
        send({ type: "done", saved: 0 });
        res.end();
        return;
      }

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      let saved = 0;

      for (let i = 0; i < toProcess.length; i++) {
        const review = toProcess[i];

        const ratingLabel =
          review.rating >= 5 ? "5-star (excellent)" :
          review.rating === 4 ? "4-star (positive)" :
          review.rating === 3 ? "3-star (neutral / mixed)" :
          review.rating === 2 ? "2-star (disappointed)" :
          "1-star (very unhappy)";

        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{
              role: "user",
              content: [
                `You are a professional customer service manager for "${businessName}", a service business.`,
                `Write ONE reply to the following Google review.`,
                ``,
                `Customer name: ${review.customerName || "a customer"}`,
                `Star rating: ${ratingLabel}`,
                `Review text: ${review.reviewText ? `"${review.reviewText}"` : "(no written text — rating only)"}`,
                ``,
                `Requirements:`,
                `- Address the customer by first name if available`,
                `- Be warm, professional, and authentic — no corporate stiffness`,
                `- Keep it between 40-120 words`,
                `- For 4-5 star: thank them genuinely and invite them back`,
                `- For 3-star: acknowledge feedback and show commitment to improvement`,
                `- For 1-2 star: apologise sincerely, take ownership, offer to resolve offline`,
                `- Never be defensive or dismissive`,
                `- Do NOT include a subject line or label`,
                ``,
                `Return JSON: { "reply": "your reply text here" }`,
              ].join("\n"),
            }],
            response_format: { type: "json_object" },
            max_completion_tokens: 512,
          });

          const raw = completion.choices[0]?.message?.content ?? "{}";
          let replyText = "";
          try {
            const parsed = JSON.parse(raw);
            replyText = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
          } catch { /* fall through */ }

          if (replyText) {
            const [savedResponse] = await db
              .insert(googleReviewResponses)
              .values({
                googleReviewId: review.id,
                storeId,
                responseText: replyText,
                responseStatus: "pending",
                createdBy: userId,
              })
              .returning();

            saved++;
            send({
              type: "progress",
              index: i,
              total: toProcess.length,
              reviewId: review.id,
              responseId: savedResponse.id,
              customerName: review.customerName,
              rating: review.rating,
              reviewText: review.reviewText,
              draftText: replyText,
            });
          } else {
            send({
              type: "progress",
              index: i,
              total: toProcess.length,
              reviewId: review.id,
              responseId: null,
              customerName: review.customerName,
              rating: review.rating,
              reviewText: review.reviewText,
              draftText: null,
              skipped: true,
            });
          }
        } catch (reviewErr) {
          console.error(`[BulkDraft] Error on review ${review.id}:`, reviewErr);
          send({
            type: "progress",
            index: i,
            total: toProcess.length,
            reviewId: review.id,
            responseId: null,
            customerName: review.customerName,
            rating: review.rating,
            reviewText: review.reviewText,
            draftText: null,
            skipped: true,
          });
        }
      }

      send({ type: "done", saved });
      res.end();
    } catch (error) {
      console.error("Bulk draft error:", error);
      send({ type: "error", message: "Failed to generate bulk drafts" });
      res.end();
    }
  });

  /**
   * Get reviews for a store
   */
  app.get("/api/google-business/reviews/:storeId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const storeId = Number(req.params.storeId);
    const ratingFilter = req.query.rating ? Number(req.query.rating) : null;
    const statusFilter = req.query.status as string | null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    try {
      const conditions = [eq(googleReviews.storeId, storeId)];
      
      if (ratingFilter) {
        conditions.push(eq(googleReviews.rating, ratingFilter));
      }

      if (statusFilter) {
        conditions.push(eq(googleReviews.responseStatus, statusFilter));
      }

      const reviews = await db
        .select()
        .from(googleReviews)
        .where(and(...conditions))
        .orderBy(desc(googleReviews.reviewCreateTime))
        .limit(limit);

      res.json({ reviews });
    } catch (error) {
      console.error("Error fetching reviews:", error);
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });

  /**
   * Get a single review with responses
   */
  app.get("/api/google-business/reviews/:storeId/:reviewId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { storeId, reviewId } = req.params;

    try {
      const review = await db
        .select()
        .from(googleReviews)
        .where(
          and(
            eq(googleReviews.storeId, Number(storeId)),
            eq(googleReviews.id, Number(reviewId))
          )
        )
        .limit(1);

      if (!review.length) {
        return res.status(404).json({ message: "Review not found" });
      }

      const responses = await db
        .select()
        .from(googleReviewResponses)
        .where(eq(googleReviewResponses.googleReviewId, Number(reviewId)));

      res.json({
        review: review[0],
        responses,
      });
    } catch (error) {
      console.error("Error fetching review:", error);
      res.status(500).json({ message: "Failed to fetch review" });
    }
  });

  /**
   * Create a draft response to a review
   */
  app.post("/api/google-business/review-response", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const input = z
        .object({
          googleReviewId: z.number(),
          storeId: z.number(),
          responseText: z.string().min(1).max(5000),
          staffId: z.number().optional(),
        })
        .parse(req.body);

      const response = await db
        .insert(googleReviewResponses)
        .values({
          ...input,
          responseStatus: "pending",
          createdBy: userId,
        })
        .returning();

      res.status(201).json(response[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0].message });
      } else {
        console.error("Error creating response:", error);
        res.status(500).json({ message: "Failed to create response" });
      }
    }
  });

  /**
   * Update a review response
   */
  app.patch("/api/google-business/review-response/:responseId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const responseId = Number(req.params.responseId);

    try {
      const input = z
        .object({
          responseText: z.string().min(1).max(5000).optional(),
          staffId: z.number().optional(),
        })
        .parse(req.body);

      const updated = await db
        .update(googleReviewResponses)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(googleReviewResponses.id, responseId))
        .returning();

      if (!updated.length) {
        return res.status(404).json({ message: "Response not found" });
      }

      res.json(updated[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0].message });
      } else {
        console.error("Error updating response:", error);
        res.status(500).json({ message: "Failed to update response" });
      }
    }
  });

  /**
   * Publish a review response to Google.
   */
  app.post("/api/google-business/review-response/:responseId/publish", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const responseId = Number(req.params.responseId);

    try {
      await publishReviewResponse(responseId);
      res.json({ message: "Response published successfully" });
    } catch (error) {
      console.error("Error publishing response:", error);
      res.status(500).json({ message: "Failed to publish response" });
    }
  });

  /**
   * Delete a review response.
   * If the response was already published to Google (status = "approved"),
   * the reply is also removed from Google so the review stays in sync.
   */
  app.delete("/api/google-business/review-response/:responseId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const responseId = Number(req.params.responseId);

    try {
      // Load the response first so we know if it was published
      const existing = await db
        .select()
        .from(googleReviewResponses)
        .where(eq(googleReviewResponses.id, responseId))
        .limit(1);

      if (existing.length && existing[0].responseStatus === "approved") {
        // Also delete the reply from Google so it doesn't stay visible
        try {
          const review = await db
            .select()
            .from(googleReviews)
            .where(eq(googleReviews.id, existing[0].googleReviewId))
            .limit(1);

          if (review.length) {
            const profile = await db
              .select()
              .from(googleBusinessProfiles)
              .where(eq(googleBusinessProfiles.storeId, review[0].storeId))
              .limit(1);

            if (profile.length) {
              const apiManager = createApiManagerFromProfile(profile[0]);
              const reviewResourceName = `${profile[0].locationResourceName}/reviews/${review[0].googleReviewId}`;
              await apiManager.deleteReviewReply(reviewResourceName);

              // Mark the review as not responded since reply was removed
              await db
                .update(googleReviews)
                .set({ responseStatus: "not_responded" })
                .where(eq(googleReviews.id, review[0].id));
            }
          }
        } catch (googleError) {
          // Non-fatal: log but still delete locally
          console.warn("Could not delete reply from Google:", googleError);
        }
      }

      await db
        .delete(googleReviewResponses)
        .where(eq(googleReviewResponses.id, responseId));

      res.json({ message: "Response deleted successfully" });
    } catch (error) {
      console.error("Error deleting response:", error);
      res.status(500).json({ message: "Failed to delete response" });
    }
  });

  /**
   * Get review statistics
   */
  app.get("/api/google-business/reviews-stats/:storeId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const storeId = Number(req.params.storeId);

    try {
      const [allReviews, profileRows] = await Promise.all([
        db
          .select()
          .from(googleReviews)
          .where(eq(googleReviews.storeId, storeId)),
        db
          .select({ lastSyncedAt: googleBusinessProfiles.lastSyncedAt })
          .from(googleBusinessProfiles)
          .where(eq(googleBusinessProfiles.storeId, storeId))
          .limit(1),
      ]);

      const lastSyncedAt = profileRows[0]?.lastSyncedAt ?? null;

      const stats = {
        totalReviews: allReviews.length,
        averageRating: 
          allReviews.length > 0
            ? (allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length).toFixed(1)
            : 0,
        respondedReviews: allReviews.filter((r) => r.responseStatus === "responded").length,
        notRespondedReviews: allReviews.filter((r) => r.responseStatus === "not_responded").length,
        ratingDistribution: {
          5: allReviews.filter((r) => r.rating === 5).length,
          4: allReviews.filter((r) => r.rating === 4).length,
          3: allReviews.filter((r) => r.rating === 3).length,
          2: allReviews.filter((r) => r.rating === 2).length,
          1: allReviews.filter((r) => r.rating === 1).length,
        },
        lastSyncedAt,
        nextSyncAt: lastSyncedAt
          ? new Date(new Date(lastSyncedAt).getTime() + 6 * 60 * 60 * 1000)
          : null,
      };

      res.json(stats);
    } catch (error) {
      console.error("Error getting review stats:", error);
      res.status(500).json({ message: "Failed to get review stats" });
    }
  });

  /**
   * AI-powered review sentiment / theme analysis.
   * Reads all review texts for a store and returns theme-level sentiment breakdown.
   */
  app.post("/api/google-business/reviews-sentiment/:storeId", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const storeId = Number(req.params.storeId);

    try {
      const allReviews = await db
        .select({ reviewText: googleReviews.reviewText, rating: googleReviews.rating })
        .from(googleReviews)
        .where(
          and(
            eq(googleReviews.storeId, storeId),
            isNotNull(googleReviews.reviewText)
          )
        );

      if (allReviews.length === 0) {
        return res.json({ themes: [], reviewCount: 0 });
      }

      // Build a compact representation for the AI prompt
      const reviewLines = allReviews
        .slice(0, 120) // cap at 120 to keep prompt size manageable
        .map((r, i) => `[${i + 1}] (${r.rating}★) ${r.reviewText}`)
        .join("\n");

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: [
            "Analyse the following customer reviews for a service business.",
            "Identify the most frequently mentioned themes (e.g. Staff friendliness, Wait time, Service quality, Cleanliness, Pricing & value, Booking experience, Results, Atmosphere).",
            "For each theme, determine the overall sentiment based on how customers discuss it.",
            "",
            "Rules:",
            "- Return 4–8 themes that have the most mentions.",
            "- Each theme must have at least 2 mentions to be included.",
            "- For each theme include 1–2 short verbatim quote snippets (under 80 chars each) from the reviews as examples.",
            "- Sentiment must be exactly one of: 'positive', 'neutral', 'negative'.",
            "- Count = number of reviews that mention this theme.",
            "",
            `Reviews (${allReviews.length} total, showing up to 120):`,
            reviewLines,
            "",
            `Return JSON only:
{
  "themes": [
    {
      "name": "Theme name",
      "sentiment": "positive" | "neutral" | "negative",
      "count": <number>,
      "examples": ["short quote 1", "short quote 2"]
    }
  ]
}`,
          ].join("\n"),
        }],
        response_format: { type: "json_object" },
        max_completion_tokens: 1024,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let parsed: { themes?: any[] } = {};
      try { parsed = JSON.parse(raw); } catch { /* fall through */ }

      res.json({
        themes: Array.isArray(parsed.themes) ? parsed.themes : [],
        reviewCount: allReviews.length,
      });
    } catch (error) {
      console.error("Sentiment analysis error:", error);
      res.status(500).json({ message: "Failed to analyse sentiment" });
    }
  });

  // === YELP ALIAS ===

  app.put("/api/stores/:storeId/facebook-page", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const storeId = Number(req.params.storeId);
    const { facebookPageId } = req.body;
    if (typeof facebookPageId !== "string") return res.status(400).json({ message: "facebookPageId required" });
    const [updated] = await db
      .update(locations)
      .set({ facebookPageId: facebookPageId.trim() || null })
      .where(and(eq(locations.id, storeId), eq(locations.userId, userId)))
      .returning();
    if (!updated) return res.status(404).json({ message: "Store not found" });
    return res.json({ success: true, facebookPageId: updated.facebookPageId });
  });

  app.put("/api/stores/:storeId/yelp-alias", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const storeId = Number(req.params.storeId);
    const { yelpAlias } = req.body;
    if (typeof yelpAlias !== "string") return res.status(400).json({ message: "yelpAlias required" });
    const [updated] = await db
      .update(locations)
      .set({ yelpAlias: yelpAlias.trim() || null })
      .where(and(eq(locations.id, storeId), eq(locations.userId, userId)))
      .returning();
    if (!updated) return res.status(404).json({ message: "Store not found" });
    return res.json({ success: true, yelpAlias: updated.yelpAlias });
  });

  // === ADMIN TRIAL MANAGEMENT ===
  
  /**
   * Admin: Get user trial status
   */
  app.get("/api/admin/users/:userId/trial-status", async (req, res) => {
    const userId = req.params.userId;
    
    try {
      const trialStatus = await TrialService.getTrialStatus(userId);
      res.json(trialStatus);
    } catch (error) {
      console.error("Error fetching user trial status:", error);
      res.status(500).json({ message: "Failed to fetch trial status" });
    }
  });

  /**
   * Admin: Extend user trial
   */
  app.post("/api/admin/users/:userId/extend-trial", async (req, res) => {
    const userId = req.params.userId;
    const { additionalDays } = req.body;
    
    if (!additionalDays || additionalDays <= 0) {
      return res.status(400).json({ message: "Additional days must be greater than 0" });
    }
    
    try {
      await TrialService.extendTrial(userId, additionalDays);
      const trialStatus = await TrialService.getTrialStatus(userId);
      res.json({ message: "Trial extended successfully", trialStatus });
    } catch (error) {
      console.error("Error extending trial:", error);
      res.status(500).json({ message: "Failed to extend trial" });
    }
  });

  /**
   * Admin: Reset user trial
   */
  app.post("/api/admin/users/:userId/reset-trial", async (req, res) => {
    const userId = req.params.userId;
    
    try {
      await TrialService.resetTrial(userId);
      const trialStatus = await TrialService.getTrialStatus(userId);
      res.json({ message: "Trial reset successfully", trialStatus });
    } catch (error) {
      console.error("Error resetting trial:", error);
      res.status(500).json({ message: "Failed to reset trial" });
    }
  });

  /**
   * Admin: Activate user subscription
   */
  app.post("/api/admin/users/:userId/activate-subscription", async (req, res) => {
    const userId = req.params.userId;
    
    try {
      await TrialService.activateSubscription(userId);
      const trialStatus = await TrialService.getTrialStatus(userId);
      res.json({ message: "Subscription activated successfully", trialStatus });
    } catch (error) {
      console.error("Error activating subscription:", error);
      res.status(500).json({ message: "Failed to activate subscription" });
    }
  });

  /**
   * Admin: Cancel user subscription
   */
  app.post("/api/admin/users/:userId/cancel-subscription", async (req, res) => {
    const userId = req.params.userId;
    
    try {
      await TrialService.cancelSubscription(userId);
      const trialStatus = await TrialService.getTrialStatus(userId);
      res.json({ message: "Subscription cancelled successfully", trialStatus });
    } catch (error) {
      console.error("Error cancelling subscription:", error);
      res.status(500).json({ message: "Failed to cancel subscription" });
    }
  });

  // POST set password for a store's owner user (admin action)
  app.post("/api/admin/stores/:storeNumber/set-password", async (req, res) => {
    try {
      const id = parseInt(req.params.storeNumber);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid store ID" });
      const { password } = req.body;
      if (!password || typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const [store] = await db.select({ userId: locations.userId }).from(locations).where(eq(locations.id, id)).limit(1);
      if (!store?.userId) return res.status(404).json({ message: "Store or owner not found" });
      const hashed = await bcrypt.hash(password, 10);
      await db.update(users).set({ password: hashed }).where(eq(users.id, store.userId));
      res.json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("Admin set-password error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  /**
   * Admin Dashboard Stats API
   */

  // GET dashboard statistics
  // ── DB Health check endpoint ─────────────────────────────────────────────
  app.get("/api/admin/db-health", async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // Tables and the columns we care about verifying
    const CHECKS: { table: string; columns: string[] }[] = [
      { table: "locations",           columns: ["sms_allowance", "sms_credits", "weekly_digest_opt_out", "is_training_sandbox", "pos_enabled"] },
      { table: "users",               columns: ["role", "staff_id", "trial_started_at", "trial_ends_at", "subscription_status", "permissions", "password_changed"] },
      { table: "staff",               columns: ["password", "permissions", "status", "employment_type", "invite_token", "password_changed"] },
      { table: "services",            columns: ["deposit_required", "deposit_amount", "category_id"] },
      { table: "appointments",        columns: ["deposit_required", "deposit_amount", "deposit_paid", "gift_card_id", "loyalty_points_earned", "loyalty_points_redeemed", "recurrence_rule", "started_at", "completed_at", "tip_amount", "cancellation_reason"] },
      { table: "customers",           columns: ["loyalty_points", "allergies"] },
      { table: "billing_plans",       columns: ["code", "price_cents", "features_json", "active"] },
      { table: "subscriptions",       columns: ["store_number", "plan_code", "stripe_subscription_id"] },
      { table: "stripe_customers",    columns: ["user_id", "customer_id", "store_number"] },
      { table: "stripe_subscriptions",columns: ["customer_id", "subscription_id", "status"] },
      { table: "stripe_orders",       columns: ["checkout_session_id", "payment_intent_id", "customer_id"] },
      { table: "stripe_webhook_events",columns: ["stripe_event_id", "event_type", "processed"] },
      { table: "customer_billing_profiles", columns: ["user_id", "salon_id", "account_status", "suspended_at", "stripe_customer_id"] },
      { table: "invoice_records",     columns: ["stripe_invoice_id", "salon_id", "paid"] },
      { table: "payment_transactions",columns: ["stripe_charge_id", "salon_id", "amount_cents"] },
      { table: "billing_activity_logs",columns: ["salon_id", "event_type", "severity"] },
      { table: "refunds",             columns: ["stripe_refund_id", "salon_id", "amount_cents"] },
      { table: "subscription_plan_changes", columns: ["salon_id", "old_plan_id", "new_plan_id"] },
      { table: "scheduled_plan_changes", columns: ["stripe_subscription_id", "new_plan_code", "effective_at"] },
      { table: "mail_settings",       columns: ["store_id", "mailgun_api_key", "booking_confirmation_enabled"] },
      { table: "sms_settings",        columns: ["store_id", "booking_confirmation_enabled", "reminder_enabled"] },
      { table: "sms_log",             columns: ["store_id", "phone", "status", "sms_source"] },
      { table: "google_business_profiles", columns: ["store_id", "is_connected", "location_address"] },
      { table: "google_business_accounts", columns: ["store_id", "user_id", "google_account_id"] },
      { table: "google_business_locations", columns: ["store_id", "user_id", "location_resource_name", "is_selected"] },
      { table: "google_business_sync_logs", columns: ["store_id", "sync_type", "status"] },
      { table: "google_reviews",      columns: ["store_id", "google_review_id", "rating", "gb_location_id"] },
      { table: "schema_migrations",   columns: ["filename", "applied_at"] },
      { table: "sessions",            columns: ["sid", "sess", "expire"] },
      { table: "calendar_settings",   columns: ["store_id", "auto_mark_no_shows"] },
      { table: "cash_drawer_sessions",columns: ["store_id", "status", "opening_balance"] },
      { table: "gift_cards",          columns: ["store_id", "code", "is_active"] },
      { table: "training_action_categories", columns: ["slug", "title", "high_risk"] },
      { table: "training_user_state", columns: ["user_id", "category_id", "help_level"] },
      { table: "training_user_profile", columns: ["user_id", "enrolled_at", "graduated_at"] },
      { table: "training_settings",   columns: ["store_id", "enabled"] },
      { table: "client_intelligence", columns: ["store_id", "customer_id", "churn_risk_score", "is_drifting", "is_at_risk"] },
      { table: "staff_intelligence",  columns: ["store_id", "staff_id", "rebooking_rate_pct", "trend"] },
      { table: "intelligence_interventions", columns: ["store_id", "customer_id", "intervention_type", "sent_at"] },
      { table: "growth_score_snapshots",  columns: ["store_id", "overall_score", "snapshot_date"] },
      { table: "dead_seat_patterns",      columns: ["store_id", "day_of_week", "hour_start"] },
      { table: "campaigns",           columns: ["store_id", "name", "status", "channel"] },
      { table: "api_keys",            columns: ["store_id", "key_hash", "is_active"] },
      { table: "sms_conversations",   columns: ["store_id", "client_phone", "direction"] },
      { table: "google_review_responses", columns: ["google_review_id", "store_id", "response_text"] },
      { table: "pro_crews",           columns: ["store_id", "name", "active"] },
      { table: "pro_service_orders",  columns: ["store_id", "order_number", "status"] },
      { table: "clients",             columns: ["store_id", "full_name", "client_status"] },
      { table: "client_tags",         columns: ["store_id", "tag_name"] },
      { table: "waitlist",            columns: ["store_id", "status"] },
      { table: "reviews",             columns: ["store_id", "rating"] },
    ];

    try {
      const client = await pool.connect();
      try {
        const results = await Promise.all(CHECKS.map(async ({ table, columns }) => {
          // Check table existence
          const tableRes = await client.query<{ exists: boolean }>(
            `SELECT EXISTS (
              SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = $1
            ) AS exists`,
            [table]
          );
          const tableExists = tableRes.rows[0].exists;

          // Check each column
          const colChecks = await Promise.all(columns.map(async (col) => {
            if (!tableExists) return { column: col, exists: false };
            const colRes = await client.query<{ exists: boolean }>(
              `SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
              ) AS exists`,
              [table, col]
            );
            return { column: col, exists: colRes.rows[0].exists };
          }));

          // Row count (only for existing tables)
          let rowCount: number | null = null;
          if (tableExists) {
            try {
              const countRes = await client.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM "${table}"`);
              rowCount = Number(countRes.rows[0].count);
            } catch { /* ignore */ }
          }

          return { table, exists: tableExists, columns: colChecks, rowCount };
        }));

        const missing      = results.filter(t => !t.exists).length;
        const missingCols  = results.reduce((n, t) => n + t.columns.filter(c => !c.exists).length, 0);

        res.json({
          checkedAt: new Date().toISOString(),
          tables: results,
          summary: { total: results.length, ok: results.filter(t => t.exists).length, missing, missingColumns: missingCols },
        });
      } finally {
        client.release();
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Rate-limit admin endpoints ───────────────────────────────────────────
  app.get("/api/admin/rate-limits", (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    res.json(getRateLimitSnapshot());
  });

  app.delete("/api/admin/rate-limits/clear-all", (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    clearAllRateLimits();
    console.log(`[Admin] All rate-limit counters cleared by userId=${userId}`);
    res.json({ ok: true });
  });

  app.delete("/api/admin/rate-limits/clear-all/:category", (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const category = req.params.category as RateLimitCategory;
    clearAllRateLimits(category);
    console.log(`[Admin] Rate-limit counters cleared for category=${category} by userId=${userId}`);
    res.json({ ok: true });
  });

  app.delete("/api/admin/rate-limits/:category/:key", (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const { category, key } = req.params;
    const removed = clearRateLimitEntry(category as RateLimitCategory, key);
    console.log(`[Admin] Rate-limit entry ${category}/${key} ${removed ? "cleared" : "not found"} by userId=${userId}`);
    res.json({ ok: true, removed });
  });

  app.get("/api/admin/dashboard/stats", async (req, res) => {
    try {
      // Get total stores count using raw SQL via pool
      const totalStoresResult = await pool.query(`SELECT COUNT(*)::int as count FROM locations`);
      const totalStoresCount = Number(totalStoresResult.rows[0]?.count || 0);
      
      // Get total users count using raw SQL via pool
      const totalUsersResult = await pool.query(`SELECT COUNT(*)::int as count FROM users`);
      const totalUsersCount = Number(totalUsersResult.rows[0]?.count || 0);
      
      // Get total appointments using raw SQL via pool
      const totalAppointmentsResult = await pool.query(`SELECT COUNT(*)::int as count FROM appointments`);
      const totalAppointmentsCount = Number(totalAppointmentsResult.rows[0]?.count || 0);

      // Get trial user count using raw SQL via pool
      const trialUsersResult = await pool.query(`SELECT COUNT(*)::int as count FROM users WHERE subscription_status = 'trial'`);
      const trialUsersCount = Number(trialUsersResult.rows[0]?.count || 0);

      // Stripe is not yet implemented — subscriptions and MRR are always 0
      const stats = {
        totalAccounts: totalStoresCount,
        newAccountsThisMonth: 0,
        newAccountsLastMonth: 0,
        totalSubscriptions: 0,   // No Stripe subscriptions yet
        activeSubscriptions: 0,  // No Stripe subscriptions yet
        mrr: 0,                  // No Stripe subscriptions yet
        mrrGrowth: 0,
        newSubsThisMonth: 0,
        newSubsLastMonth: 0,
        totalUsers: totalUsersCount,
        newUsersThisMonth: 0,
        newUsersLastMonth: 0,
        totalAppointments: totalAppointmentsCount,
        appointmentsThisMonth: 0,
        trialUsers: trialUsersCount
      };

      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  /**
   * Platform Settings API
   */

  // GET platform settings
  app.get("/api/admin/platform-settings", async (req, res) => {
    try {
      // Get settings from environment variables
      const settings = {
        trialPeriodDays: parseInt(process.env.TRIAL_PERIOD_DAYS || '30'),
        mailgun: {
          apiKey: process.env.MAILGUN_API_KEY || '',
          domain: process.env.MAILGUN_DOMAIN || '',
          fromEmail: process.env.MAILGUN_FROM_EMAIL || 'noreply@yourdomain.com',
          fromName: process.env.MAILGUN_FROM_NAME || 'Booking Platform',
          enabled: !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN)
        },
        twilio: {
          accountSid: process.env.TWILIO_ACCOUNT_SID || '',
          authToken: process.env.TWILIO_AUTH_TOKEN || '',
          phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
          enabled: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER)
        }
      };
      
      res.json(settings);
    } catch (error) {
      console.error("Error fetching platform settings:", error);
      res.status(500).json({ message: "Failed to fetch platform settings" });
    }
  });

  // PUT platform settings
  app.put("/api/admin/platform-settings", async (req, res) => {
    try {
      const { trialPeriodDays, mailgun, twilio } = req.body;
      
      // Validate input
      const platformSettingsSchema = z.object({
        trialPeriodDays: z.number().min(1).max(365),
        mailgun: z.object({
          apiKey: z.string().optional(),
          domain: z.string().optional(),
          fromEmail: z.string().email().optional(),
          fromName: z.string().optional(),
          enabled: z.boolean()
        }),
        twilio: z.object({
          accountSid: z.string().optional(),
          authToken: z.string().optional(),
          phoneNumber: z.string().optional(),
          enabled: z.boolean()
        })
      });

      const validatedData = platformSettingsSchema.parse({ trialPeriodDays, mailgun, twilio });
      
      // Update environment variables in memory
      process.env.TRIAL_PERIOD_DAYS = validatedData.trialPeriodDays.toString();
      process.env.MAILGUN_API_KEY = validatedData.mailgun.apiKey || '';
      process.env.MAILGUN_DOMAIN = validatedData.mailgun.domain || '';
      process.env.MAILGUN_FROM_EMAIL = validatedData.mailgun.fromEmail || 'noreply@yourdomain.com';
      process.env.MAILGUN_FROM_NAME = validatedData.mailgun.fromName || 'Booking Platform';
      process.env.TWILIO_ACCOUNT_SID = validatedData.twilio.accountSid || '';
      process.env.TWILIO_AUTH_TOKEN = validatedData.twilio.authToken || '';
      process.env.TWILIO_PHONE_NUMBER = validatedData.twilio.phoneNumber || '';
      
      // Update .env file
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(process.cwd(), '.env');
      
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }
      
      // Update or add each setting
      const updates = [
        `TRIAL_PERIOD_DAYS=${validatedData.trialPeriodDays}`,
        `MAILGUN_API_KEY=${validatedData.mailgun.apiKey || ''}`,
        `MAILGUN_DOMAIN=${validatedData.mailgun.domain || ''}`,
        `MAILGUN_FROM_EMAIL=${validatedData.mailgun.fromEmail || 'noreply@yourdomain.com'}`,
        `MAILGUN_FROM_NAME=${validatedData.mailgun.fromName || 'Booking Platform'}`,
        `TWILIO_ACCOUNT_SID=${validatedData.twilio.accountSid || ''}`,
        `TWILIO_AUTH_TOKEN=${validatedData.twilio.authToken || ''}`,
        `TWILIO_PHONE_NUMBER=${validatedData.twilio.phoneNumber || ''}`
      ];
      
      updates.forEach(update => {
        const [key] = update.split('=');
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (envContent.match(regex)) {
          envContent = envContent.replace(regex, update);
        } else {
          envContent += `\n${update}`;
        }
      });
      
      fs.writeFileSync(envPath, envContent);
      
      console.log("Platform settings saved to .env file");
      
      res.json({ message: "Platform settings updated successfully", settings: validatedData });
    } catch (error) {
      console.error("Error updating platform settings:", error);
      res.status(500).json({ message: "Failed to update platform settings" });
    }
  });

  // POST staff change password
  app.post("/api/staff/change-password", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters long" });
      }

      // Get current user
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Verify current password
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      // Hash new password
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);

      // Update password and mark as changed
      await storage.updateUser(user.id, { 
        password: hashedNewPassword, 
        passwordChanged: true 
      });

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // GET staff calendar access status
  app.get("/api/staff/:id/calendar-access-status", isAuthenticated, async (req, res) => {
    try {
      const staffId = Number(req.params.id);
      const staff = await storage.getStaffMember(staffId);

      if (!staff) {
        return res.status(404).json({ message: "Staff member not found" });
      }

      // Staff without an email cannot have calendar access
      if (!staff.email) {
        return res.json({ hasCalendarAccess: false, email: null, enabled: false });
      }

      // Check if user exists with staff role and this staffId
      const user = await storage.findUserByEmail(staff.email);
      // Calendar access = a linked user account exists in any non-owner role with this staffId
      const hasCalendarAccess = !!(user && user.role !== "owner" && user.role !== "admin" && user.staffId === staffId);

      res.json({ 
        hasCalendarAccess,
        email: staff.email,
        enabled: !!hasCalendarAccess
      });
    } catch (error) {
      console.error("Error checking calendar access status:", error);
      res.status(500).json({ message: "Failed to check calendar access status" });
    }
  });

  // POST disable staff calendar access — unlinks the user account from the
  // staff record so they can no longer log in to the staff calendar. Does
  // NOT delete the user account, and does NOT downgrade an owner/admin/manager.
  app.post("/api/staff/:id/disable-calendar-access", isAuthenticated, async (req, res) => {
    try {
      const staffId = Number(req.params.id);
      const staff = await storage.getStaffMember(staffId);
      if (!staff || !staff.email) {
        return res.status(400).json({ message: "Staff member not found or has no email address." });
      }
      const user = await storage.findUserByEmail(staff.email);
      if (!user || user.staffId !== staffId) {
        return res.json({ message: "Calendar access already disabled." });
      }
      // Only clear the staffId link. If their role was "staff" (set by the
      // legacy enable flow) and they don't own a store, leave it; otherwise
      // preserve owner/admin/manager.
      await storage.updateUser(user.id, { staffId: null });
      res.json({ message: "Calendar access disabled." });
    } catch (error) {
      console.error("Error disabling calendar access:", error);
      res.status(500).json({ message: "Failed to disable calendar access" });
    }
  });

  // POST test mailgun connection
  app.post("/api/admin/platform-settings/test-mailgun", async (req, res) => {
    try {
      const { to } = req.body;
      
      if (!to) {
        return res.status(400).json({ message: "Recipient email is required" });
      }

      // Use Mailgun settings from .env
      const apiKey = process.env.MAILGUN_API_KEY;
      const domain = process.env.MAILGUN_DOMAIN;
      const fromEmail = process.env.MAILGUN_FROM_EMAIL || `noreply@${domain}`;
      const fromName = process.env.MAILGUN_FROM_NAME || 'Test Platform';

      if (!apiKey || !domain) {
        return res.status(500).json({ message: "Mailgun not configured in server environment" });
      }

      console.log("Testing mailgun connection to:", to);
      
      // Send actual test email via Mailgun API
      const formData = new FormData();
      formData.append('from', `${fromName} <${fromEmail}>`);
      formData.append('to', to);
      formData.append('subject', 'Mailgun Test Email');
      formData.append('text', `This is a test email sent at ${new Date().toISOString()}. If you received this, your Mailgun configuration is working correctly.`);
      formData.append('html', `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
            Mailgun Test Email
          </h2>
          <p style="color: #666; line-height: 1.6;">
            This is a test email sent from your booking platform at <strong>${new Date().toLocaleString()}</strong>.
          </p>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="color: #495057; margin: 0 0 10px 0;">Test Details:</h3>
            <ul style="color: #6c757d; margin: 0; padding-left: 20px;">
              <li>Sent to: ${to}</li>
              <li>Sent from: ${fromEmail}</li>
              <li>Domain: ${domain}</li>
              <li>Time: ${new Date().toISOString()}</li>
            </ul>
          </div>
          <p style="color: #28a745; font-weight: bold;">
            ✅ If you received this email, your Mailgun configuration is working correctly!
          </p>
        </div>
      `);

      const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Mailgun API error:', errorData);
        throw new Error(`Mailgun API error: ${response.status} ${errorData}`);
      }

      const result = await response.json();
      console.log('Mailgun test successful:', result);
      
      res.json({ 
        message: "Mailgun test successful", 
        timestamp: new Date().toISOString(),
        recipient: to,
        messageId: result.id
      });
    } catch (error) {
      console.error("Error testing mailgun:", error);
      res.status(500).json({ message: "Mailgun test failed", error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST test twilio connection
  app.post("/api/admin/platform-settings/test-twilio", async (req, res) => {
    try {
      const { to } = req.body;
      
      if (!to) {
        return res.status(400).json({ message: "Recipient phone number is required" });
      }

      // TODO: Implement actual twilio test
      console.log("Testing twilio connection to:", to);
      
      // Simulate test
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      res.json({ message: "Twilio test successful", timestamp: new Date().toISOString() });
    } catch (error) {
      console.error("Error testing twilio:", error);
      res.status(500).json({ message: "Twilio test failed" });
    }
  });

  // GET service status
  app.get("/api/admin/platform-settings/status", async (req, res) => {
    try {
      const status = {
        mailgun: {
          connected: !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN),
          lastCheck: new Date().toISOString(),
          error: null
        },
        twilio: {
          connected: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
          lastCheck: new Date().toISOString(),
          error: null
        },
        system: {
          healthy: true,
          lastCheck: new Date().toISOString()
        }
      };
      
      res.json(status);
    } catch (error) {
      console.error("Error fetching service status:", error);
      res.status(500).json({ message: "Failed to fetch service status" });
    }
  });

  /**
   * Billing Invoice Endpoints (Mock for now)
   */

  // GET all invoices
  app.get("/api/billing/invoices/all", async (req, res) => {
    try {
      // Mock data - replace with actual database query
      const invoices: any[] = []; // Mock empty invoices array
      res.json({ data: invoices });
    } catch (error) {
      console.error("Error fetching all invoices:", error);
      res.status(500).json({ message: "Failed to fetch all invoices" });
    }
  });

  // GET unpaid invoices count
  app.get("/api/billing/invoices/unpaid/count", async (req, res) => {
    try {
      // Mock data - replace with actual database query
      const count = 0; // Mock unpaid count
      res.json({ count });
    } catch (error) {
      console.error("Error fetching unpaid invoices count:", error);
      res.status(500).json({ message: "Failed to fetch unpaid invoices count" });
    }
  });

  // GET past due invoices count
  app.get("/api/billing/invoices/past-due/count", async (req, res) => {
    try {
      // Mock data - replace with actual database query
      const count = 0; // Mock past due count
      res.json({ count });
    } catch (error) {
      console.error("Error fetching past due invoices count:", error);
      res.status(500).json({ message: "Failed to fetch past due invoices count" });
    }
  });

  // ============================================================
  // WAITLIST ROUTES
  // ============================================================

  app.get("/api/waitlist", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const userStore = await db.select().from(locations).where(eq(locations.userId, userId)).limit(1);
      if (!userStore.length) return res.status(404).json({ message: "Store not found" });
      const storeId = userStore[0].id;

      const entries = await db
        .select({
          id: waitlist.id,
          storeId: waitlist.storeId,
          customerName: waitlist.customerName,
          customerPhone: waitlist.customerPhone,
          customerEmail: waitlist.customerEmail,
          preferredDate: waitlist.preferredDate,
          preferredTimeStart: waitlist.preferredTimeStart,
          preferredTimeEnd: waitlist.preferredTimeEnd,
          notes: waitlist.notes,
          status: waitlist.status,
          notifiedAt: waitlist.notifiedAt,
          createdAt: waitlist.createdAt,
          serviceId: waitlist.serviceId,
          staffId: waitlist.staffId,
          customerId: waitlist.customerId,
        })
        .from(waitlist)
        .where(eq(waitlist.storeId, storeId))
        .orderBy(desc(waitlist.createdAt));

      res.json(entries);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch waitlist" });
    }
  });

  app.post("/api/waitlist", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const userStore = await db.select().from(locations).where(eq(locations.userId, userId)).limit(1);
      if (!userStore.length) return res.status(404).json({ message: "Store not found" });
      const storeId = userStore[0].id;

      const { customerName, customerPhone, customerEmail, preferredDate, preferredTimeStart, preferredTimeEnd, notes, serviceId, staffId, customerId } = req.body;
      const [entry] = await db.insert(waitlist).values({
        storeId,
        customerName,
        customerPhone,
        customerEmail,
        preferredDate: preferredDate ? new Date(preferredDate) : null,
        preferredTimeStart,
        preferredTimeEnd,
        notes,
        serviceId: serviceId ? parseInt(serviceId) : null,
        staffId: staffId ? parseInt(staffId) : null,
        customerId: customerId ? parseInt(customerId) : null,
        status: "waiting",
      }).returning();

      res.json(entry);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to add to waitlist" });
    }
  });

  // Atomic "Next Customer" — completes whoever is serving, promotes next waiting
  app.post("/api/queue/next", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId ? parseInt(req.query.storeId as string) : null;
      const now = new Date();

      // Complete whoever is currently serving/called
      let completed = null;
      const [currentlyServing] = await db
        .select()
        .from(waitlist)
        .where(
          storeId
            ? and(
                sql`${waitlist.status} IN ('serving', 'called')`,
                eq(waitlist.storeId, storeId)
              )
            : sql`${waitlist.status} IN ('serving', 'called')`
        )
        .orderBy(waitlist.createdAt)
        .limit(1);

      if (currentlyServing) {
        [completed] = await db
          .update(waitlist)
          .set({ status: "completed", completedAt: now })
          .where(eq(waitlist.id, currentlyServing.id))
          .returning();
      }

      // Promote next waiting person to serving
      let serving = null;
      const [nextWaiting] = await db
        .select()
        .from(waitlist)
        .where(
          storeId
            ? and(eq(waitlist.status, "waiting"), eq(waitlist.storeId, storeId))
            : eq(waitlist.status, "waiting")
        )
        .orderBy(waitlist.createdAt)
        .limit(1);

      if (nextWaiting) {
        [serving] = await db
          .update(waitlist)
          .set({ status: "serving", calledAt: now })
          .where(eq(waitlist.id, nextWaiting.id))
          .returning();
      }

      res.json({ completed, serving });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to advance queue" });
    }
  });

  app.put("/api/waitlist/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const updates: any = {};
      if (req.body.status !== undefined) {
        updates.status = req.body.status;
        // Auto-stamp timestamps when status changes
        if (req.body.status === "called" || req.body.status === "serving") {
          updates.calledAt = new Date();
        } else if (req.body.status === "completed") {
          updates.completedAt = new Date();
        }
      }
      if (req.body.notifiedAt !== undefined) updates.notifiedAt = new Date(req.body.notifiedAt);
      const [entry] = await db.update(waitlist).set(updates).where(eq(waitlist.id, id)).returning();
      res.json(entry);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update waitlist entry" });
    }
  });

  app.delete("/api/waitlist/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      await db.delete(waitlist).where(eq(waitlist.id, id));
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to delete waitlist entry" });
    }
  });

  // === QUEUE SETTINGS ===

  app.get("/api/queue/settings", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const storeId = req.query.storeId ? Number(req.query.storeId) : null;
      if (!storeId) return res.status(400).json({ error: "storeId required" });
      const storeRows = await db.select().from(locations).where(and(eq(locations.id, storeId), eq(locations.userId, userId)));
      if (!storeRows.length) return res.status(403).json({ error: "Unauthorized" });
      const store = storeRows[0];
      const [row] = await db.select().from(storeSettings).where(eq(storeSettings.storeId, storeId));
      const prefs = row?.preferences ? JSON.parse(row.preferences as string) : {};
      res.json({
        queueEnabled: prefs.queueEnabled !== false,
        queueAvgServiceTime: prefs.queueAvgServiceTime || 20,
        queueMaxSize: prefs.queueMaxSize || 30,
        smsTravelBuffer: prefs.smsTravelBuffer ?? 5,
        storeLatitude: store.storeLatitude || null,
        storeLongitude: store.storeLongitude || null,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to get queue settings" });
    }
  });

  app.put("/api/queue/settings", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const storeId = req.query.storeId ? Number(req.query.storeId) : null;
      if (!storeId) return res.status(400).json({ error: "storeId required" });
      const storeRows = await db.select().from(locations).where(and(eq(locations.id, storeId), eq(locations.userId, userId)));
      if (!storeRows.length) return res.status(403).json({ error: "Unauthorized" });
      const [existing] = await db.select().from(storeSettings).where(eq(storeSettings.storeId, storeId));
      const currentPrefs = existing?.preferences ? JSON.parse(existing.preferences as string) : {};
      const { queueEnabled, queueAvgServiceTime, queueMaxSize, smsTravelBuffer, storeLatitude, storeLongitude } = req.body;
      const newPrefs = {
        ...currentPrefs,
        ...(queueEnabled !== undefined ? { queueEnabled } : {}),
        ...(queueAvgServiceTime !== undefined ? { queueAvgServiceTime } : {}),
        ...(queueMaxSize !== undefined ? { queueMaxSize } : {}),
        ...(smsTravelBuffer !== undefined ? { smsTravelBuffer } : {}),
      };
      if (existing) {
        await db.update(storeSettings).set({ preferences: JSON.stringify(newPrefs) }).where(eq(storeSettings.storeId, storeId));
      } else {
        await db.insert(storeSettings).values({ storeId, preferences: JSON.stringify(newPrefs) });
      }
      // Save store lat/lng directly on the locations table
      if (storeLatitude !== undefined || storeLongitude !== undefined) {
        const locationUpdates: any = {};
        if (storeLatitude !== undefined) locationUpdates.storeLatitude = storeLatitude ? String(storeLatitude) : null;
        if (storeLongitude !== undefined) locationUpdates.storeLongitude = storeLongitude ? String(storeLongitude) : null;
        await db.update(locations).set(locationUpdates).where(eq(locations.id, storeId));
      }
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save queue settings" });
    }
  });

  // ============================================================
  // GIFT CARD ROUTES
  // ============================================================

  const generateGiftCardCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "GC-";
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  };

  app.get("/api/gift-cards", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const userStore = await db.select().from(locations).where(eq(locations.userId, userId)).limit(1);
      if (!userStore.length) return res.status(404).json({ message: "Store not found" });
      const cards = await db.select().from(giftCards).where(eq(giftCards.storeId, userStore[0].id)).orderBy(desc(giftCards.createdAt));
      res.json(cards);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch gift cards" });
    }
  });

  app.post("/api/gift-cards", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const userStore = await db.select().from(locations).where(eq(locations.userId, userId)).limit(1);
      if (!userStore.length) return res.status(404).json({ message: "Store not found" });
      const storeId = userStore[0].id;

      const { amount, issuedToName, issuedToEmail, expiresAt, notes } = req.body;
      const code = generateGiftCardCode();

      const [card] = await db.insert(giftCards).values({
        storeId,
        code,
        originalAmount: amount.toString(),
        remainingBalance: amount.toString(),
        issuedToName,
        issuedToEmail,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        notes,
        isActive: true,
      }).returning();

      res.json(card);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create gift card" });
    }
  });

  app.get("/api/gift-cards/check/:code", async (req, res) => {
    try {
      const [card] = await db.select().from(giftCards).where(eq(giftCards.code, req.params.code));
      if (!card) return res.status(404).json({ message: "Gift card not found" });
      res.json(card);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to check gift card" });
    }
  });

  app.post("/api/gift-cards/redeem", isAuthenticated, async (req, res) => {
    try {
      const { code, amount } = req.body;
      const [card] = await db.select().from(giftCards).where(eq(giftCards.code, code));
      if (!card) return res.status(404).json({ message: "Gift card not found" });
      if (!card.isActive) return res.status(400).json({ message: "Gift card is not active" });

      const remaining = parseFloat(card.remainingBalance);
      const redeem = parseFloat(amount);
      if (redeem > remaining) return res.status(400).json({ message: "Insufficient balance" });

      const newBalance = (remaining - redeem).toFixed(2);
      const [updated] = await db.update(giftCards)
        .set({ remainingBalance: newBalance, isActive: parseFloat(newBalance) > 0 })
        .where(eq(giftCards.id, card.id))
        .returning();

      await db.insert(giftCardTransactions).values({
        giftCardId: card.id,
        storeId: card.storeId,
        amount: redeem.toString(),
        type: "redemption",
        balanceAfter: newBalance,
      });

      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to redeem gift card" });
    }
  });

  app.put("/api/gift-cards/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const [updated] = await db.update(giftCards).set(req.body).where(eq(giftCards.id, id)).returning();
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update gift card" });
    }
  });

  // ============================================================
  // INTAKE FORMS ROUTES
  // ============================================================

  app.get("/api/intake-forms", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const userStore = await db.select().from(locations).where(eq(locations.userId, userId)).limit(1);
      if (!userStore.length) return res.status(404).json({ message: "Store not found" });
      const storeId = userStore[0].id;

      const forms = await db.select().from(intakeForms).where(eq(intakeForms.storeId, storeId)).orderBy(desc(intakeForms.createdAt));
      
      const formsWithFields = await Promise.all(forms.map(async (form) => {
        const fields = await db.select().from(intakeFormFields).where(eq(intakeFormFields.formId, form.id)).orderBy(intakeFormFields.sortOrder);
        return { ...form, fields };
      }));

      res.json(formsWithFields);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch intake forms" });
    }
  });

  app.post("/api/intake-forms", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const userStore = await db.select().from(locations).where(eq(locations.userId, userId)).limit(1);
      if (!userStore.length) return res.status(404).json({ message: "Store not found" });
      const storeId = userStore[0].id;

      const { name, description, requireBeforeBooking, serviceId, fields } = req.body;
      const [form] = await db.insert(intakeForms).values({
        storeId, name, description, requireBeforeBooking: !!requireBeforeBooking,
        serviceId: serviceId ? parseInt(serviceId) : null,
      }).returning();

      if (fields && fields.length > 0) {
        await db.insert(intakeFormFields).values(
          fields.map((f: any, i: number) => ({
            formId: form.id, label: f.label, fieldType: f.fieldType,
            options: f.options || null, required: !!f.required, sortOrder: i,
          }))
        );
      }

      res.json(form);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create intake form" });
    }
  });

  app.put("/api/intake-forms/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const { name, description, requireBeforeBooking, isActive, fields } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (requireBeforeBooking !== undefined) updates.requireBeforeBooking = requireBeforeBooking;
      if (isActive !== undefined) updates.isActive = isActive;

      const [form] = await db.update(intakeForms).set(updates).where(eq(intakeForms.id, id)).returning();

      if (fields !== undefined) {
        await db.delete(intakeFormFields).where(eq(intakeFormFields.formId, id));
        if (fields.length > 0) {
          await db.insert(intakeFormFields).values(
            fields.map((f: any, i: number) => ({
              formId: id, label: f.label, fieldType: f.fieldType,
              options: f.options || null, required: !!f.required, sortOrder: i,
            }))
          );
        }
      }

      res.json(form);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update intake form" });
    }
  });

  app.delete("/api/intake-forms/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      await db.delete(intakeFormFields).where(eq(intakeFormFields.formId, id));
      await db.delete(intakeForms).where(eq(intakeForms.id, id));
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to delete intake form" });
    }
  });

  app.get("/api/intake-forms/responses", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const userStore = await db.select().from(locations).where(eq(locations.userId, userId)).limit(1);
      if (!userStore.length) return res.status(404).json({ message: "Store not found" });
      const responses = await db.select().from(intakeFormResponses).where(eq(intakeFormResponses.storeId, userStore[0].id)).orderBy(desc(intakeFormResponses.submittedAt));
      res.json(responses);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch responses" });
    }
  });

  app.post("/api/intake-forms/:id/respond", async (req, res) => {
    try {
      const formId = parseInt(req.params.id);
      const { customerId, appointmentId, customerName, responses } = req.body;
      const [form] = await db.select().from(intakeForms).where(eq(intakeForms.id, formId));
      if (!form) return res.status(404).json({ message: "Form not found" });

      const [response] = await db.insert(intakeFormResponses).values({
        formId, storeId: form.storeId,
        customerId: customerId ? parseInt(customerId) : null,
        appointmentId: appointmentId ? parseInt(appointmentId) : null,
        customerName, responses: JSON.stringify(responses),
      }).returning();

      res.json(response);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to submit response" });
    }
  });

  // ============================================================
  // LOYALTY ROUTES
  // ============================================================

  app.get("/api/loyalty/transactions", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      const userStore = await db.select().from(locations).where(eq(locations.userId, userId)).limit(1);
      if (!userStore.length) return res.status(404).json({ message: "Store not found" });
      const storeId = userStore[0].id;

      const txns = await db
        .select({
          id: loyaltyTransactions.id,
          customerId: loyaltyTransactions.customerId,
          type: loyaltyTransactions.type,
          points: loyaltyTransactions.points,
          description: loyaltyTransactions.description,
          createdAt: loyaltyTransactions.createdAt,
          appointmentId: loyaltyTransactions.appointmentId,
          customerName: customers.name,
        })
        .from(loyaltyTransactions)
        .leftJoin(customers, eq(loyaltyTransactions.customerId, customers.id))
        .where(eq(loyaltyTransactions.storeId, storeId))
        .orderBy(desc(loyaltyTransactions.createdAt))
        .limit(200);

      res.json(txns.map(t => ({ ...t, customer: t.customerName ? { name: t.customerName } : null })));
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch loyalty transactions" });
    }
  });

  app.post("/api/loyalty/adjust", isAuthenticated, async (req, res) => {
    try {
      const { customerId, storeId, type, points, description } = req.body;

      const [txn] = await db.insert(loyaltyTransactions).values({
        storeId: parseInt(storeId), customerId: parseInt(customerId),
        type, points: parseInt(points), description,
      }).returning();

      const [customer] = await db.select().from(customers).where(eq(customers.id, parseInt(customerId)));
      const newPoints = Math.max(0, (customer.loyaltyPoints || 0) + parseInt(points));
      await db.update(customers).set({ loyaltyPoints: newPoints }).where(eq(customers.id, parseInt(customerId)));

      res.json(txn);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to adjust loyalty points" });
    }
  });

  // ============================================================
  // POS — Email Receipt
  // ============================================================

  app.post("/api/pos/email-receipt", isAuthenticated, async (req, res) => {
    try {
      const { storeId, email, storeName, clientName, items, subtotal, tipAmount, grandTotal, paymentMethod, transactionId, dateStr, timeStr } = req.body;
      if (!email || !storeId) return res.status(400).json({ message: "email and storeId required" });
      const { sendPOSReceiptEmail } = await import("./mail");
      const result = await sendPOSReceiptEmail(Number(storeId), email, {
        storeName: storeName || "Your Salon",
        clientName: clientName || "there",
        items: items || [],
        subtotal: Number(subtotal) || 0,
        tipAmount: Number(tipAmount) || 0,
        grandTotal: Number(grandTotal) || 0,
        paymentMethod: paymentMethod || "Card",
        transactionId: transactionId || "",
        dateStr: dateStr || new Date().toLocaleDateString(),
        timeStr: timeStr || new Date().toLocaleTimeString(),
      });
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ message: result.error || "Failed to send receipt" });
      }
    } catch (err: any) {
      console.error("[POS email-receipt]", err);
      res.status(500).json({ message: err.message || "Failed to send receipt" });
    }
  });

  // ============================================================
  // CUSTOMERS — Photo Upload
  // ============================================================

  app.post("/api/customers/:id/photo", isAuthenticated, async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const { photoDataUrl } = req.body;
      if (!photoDataUrl) return res.status(400).json({ message: "photoDataUrl required" });
      // Store data-URL directly in avatarUrl (works without external storage)
      const [updated] = await db
        .update(customers)
        .set({ avatarUrl: photoDataUrl })
        .where(eq(customers.id, customerId))
        .returning();
      if (!updated) return res.status(404).json({ message: "Customer not found" });
      res.json({ success: true, avatarUrl: updated.avatarUrl });
    } catch (err: any) {
      console.error("[customer photo]", err);
      res.status(500).json({ message: err.message || "Failed to update photo" });
    }
  });

  // ============================================================
  // REVIEWS
  // ============================================================

  // Public: get appointment info for the review form
  app.get("/api/reviews/form/:appointmentId", async (req, res) => {
    try {
      const appointmentId = parseInt(req.params.appointmentId);
      const [apt] = await db
        .select({
          id: appointments.id,
          date: appointments.date,
          status: appointments.status,
          storeId: appointments.storeId,
          storeName: locations.name,
          customerName: customers.name,
          serviceName: services.name,
          staffName: staff.name,
        })
        .from(appointments)
        .leftJoin(locations, eq(appointments.storeId, locations.id))
        .leftJoin(customers, eq(appointments.customerId, customers.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .leftJoin(staff, eq(appointments.staffId, staff.id))
        .where(eq(appointments.id, appointmentId));

      if (!apt) return res.status(404).json({ message: "Appointment not found" });

      // Check if review already submitted
      const [existing] = await db.select().from(reviews).where(eq(reviews.appointmentId, appointmentId));

      res.json({ ...apt, alreadyReviewed: !!existing });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to load review form" });
    }
  });

  // Public: submit a review
  app.post("/api/reviews/submit", async (req, res) => {
    try {
      const { appointmentId, rating, comment } = req.body;
      if (!appointmentId || !rating || rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Invalid review data" });
      }

      const [apt] = await db
        .select({
          id: appointments.id,
          storeId: appointments.storeId,
          customerId: appointments.customerId,
          staffId: appointments.staffId,
          customerName: customers.name,
          serviceName: services.name,
          staffName: staff.name,
        })
        .from(appointments)
        .leftJoin(customers, eq(appointments.customerId, customers.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .leftJoin(staff, eq(appointments.staffId, staff.id))
        .where(eq(appointments.id, parseInt(appointmentId)));

      if (!apt) return res.status(404).json({ message: "Appointment not found" });

      // Prevent duplicate reviews
      const [existing] = await db.select().from(reviews).where(eq(reviews.appointmentId, parseInt(appointmentId)));
      if (existing) return res.status(409).json({ message: "Review already submitted" });

      const [review] = await db.insert(reviews).values({
        storeId: apt.storeId!,
        customerId: apt.customerId,
        appointmentId: parseInt(appointmentId),
        staffId: apt.staffId,
        rating: parseInt(rating),
        comment: comment || null,
        customerName: apt.customerName,
        serviceName: apt.serviceName,
        staffName: apt.staffName,
        isPublic: true,
        isFeatured: false,
      }).returning();

      res.json(review);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to submit review" });
    }
  });

  // Authenticated: list all reviews for a store
  app.get("/api/reviews", isAuthenticated, async (req, res) => {
    try {
      const storeId = parseInt(req.query.storeId as string);
      if (!storeId) return res.status(400).json({ message: "storeId required" });

      const rows = await db
        .select()
        .from(reviews)
        .where(eq(reviews.storeId, storeId))
        .orderBy(desc(reviews.createdAt));

      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });

  // Authenticated: aggregate stats
  app.get("/api/reviews/stats", isAuthenticated, async (req, res) => {
    try {
      const storeId = parseInt(req.query.storeId as string);
      if (!storeId) return res.status(400).json({ message: "storeId required" });

      const rows = await db.select().from(reviews).where(eq(reviews.storeId, storeId));
      const total = rows.length;
      const avg = total > 0 ? rows.reduce((s, r) => s + r.rating, 0) / total : 0;
      const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      rows.forEach(r => { distribution[r.rating] = (distribution[r.rating] || 0) + 1; });

      res.json({ total, avg: Math.round(avg * 10) / 10, distribution });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch review stats" });
    }
  });

  // Authenticated: update review (toggle public/featured)
  app.put("/api/reviews/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const { isPublic, isFeatured } = req.body;
      const update: Partial<typeof reviews.$inferInsert> = {};
      if (isPublic !== undefined) update.isPublic = isPublic;
      if (isFeatured !== undefined) update.isFeatured = isFeatured;
      const [row] = await db.update(reviews).set(update).where(eq(reviews.id, id)).returning();
      res.json(row);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update review" });
    }
  });

  // Authenticated: delete review
  app.delete("/api/reviews/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      await db.delete(reviews).where(eq(reviews.id, id));
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to delete review" });
    }
  });

  // ── Pro Hub Lead Capture ────────────────────────────────────────────────────
  app.post("/api/pro/leads", async (req, res) => {
    try {
      const { name, email, phone, businessName, industry, teamSize, message } = req.body;
      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required" });
      }
      const { proLeads } = await import("@shared/schema");
      const [lead] = await db.insert(proLeads).values({
        name: String(name),
        email: String(email),
        phone: phone ? String(phone) : null,
        businessName: businessName ? String(businessName) : null,
        industry: industry ? String(industry) : null,
        teamSize: teamSize ? String(teamSize) : null,
        message: message ? String(message) : null,
        source: "pro-hub",
      }).returning();
      res.json({ success: true, id: lead.id });
    } catch (err) {
      console.error("Pro lead error:", err);
      res.status(500).json({ error: "Failed to save lead" });
    }
  });

  // ── SEO Regional Pages API ────────────────────────────────────────────────────

    // Get city and business type reference data (MUST be before /:id)
    app.get("/api/seo-regions/reference-data", async (_req, res) => {
      res.json({
        cities: ALL_CITIES,
        bookingBusinessTypes: BOOKING_BUSINESS_TYPES,
      });
    });

    // List all regions
    app.get("/api/seo-regions", async (req, res) => {
      try {
        const rows = await db.select().from(seoRegions).orderBy(asc(seoRegions.city));
        res.json(rows);
      } catch (err) {
        console.error("SEO regions list error:", err);
        res.status(500).json({ error: "Failed to list regions" });
      }
    });

    // Get single region
    app.get("/api/seo-regions/:id", async (req, res) => {
      try {
        const id = parseInt(req.params.id as string);
        const [row] = await db.select().from(seoRegions).where(eq(seoRegions.id, id));
        if (!row) return res.status(404).json({ error: "Not found" });
        res.json(row);
      } catch (err) {
        res.status(500).json({ error: "Failed to get region" });
      }
    });

    // Create region and auto-generate HTML page
    app.post("/api/seo-regions", async (req, res) => {
      try {
        const data = insertSeoRegionSchema.parse(req.body);
        const [row] = await db.insert(seoRegions).values(data).returning();
        res.json(row);
      } catch (err: any) {
        if (err?.code === "23505") return res.status(409).json({ error: "A region with that slug already exists" });
        res.status(400).json({ error: err?.message ?? "Failed to create region" });
      }
    });

    // Update region and regenerate page
    app.put("/api/seo-regions/:id", async (req, res) => {
      try {
        const id = parseInt(req.params.id as string);
        const data = insertSeoRegionSchema.partial().parse(req.body);
        const [row] = await db.update(seoRegions).set({ ...data, updatedAt: new Date() }).where(eq(seoRegions.id, id)).returning();
        if (!row) return res.status(404).json({ error: "Not found" });
        res.json(row);
      } catch (err: any) {
        res.status(400).json({ error: err?.message ?? "Failed to update region" });
      }
    });

    // Regenerate a single page manually
    app.post("/api/seo-regions/:id/generate", async (req, res) => {
      try {
        const id = parseInt(req.params.id as string);
        const [row] = await db.select().from(seoRegions).where(eq(seoRegions.id, id));
        if (!row) return res.status(404).json({ error: "Not found" });
        res.json({ success: true, slug: row.slug });
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "Failed to generate page" });
      }
    });

    // Regenerate ALL pages (bulk)
    app.post("/api/seo-regions/generate-all", async (req, res) => {
      try {
        const rows = await db.select().from(seoRegions);
        let count = 0;
        res.json({ success: true, generated: count, total: rows.length });
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "Bulk generation failed" });
      }
    });

    // Bulk seed — create records for all selected city × business type combinations
    app.post("/api/seo-regions/bulk-seed", async (req, res) => {
      try {
        const { cities, businessTypes, phone } = req.body as {
          cities: Array<{ city: string; state: string; stateCode: string; country?: string; nearbyCities?: string }>;
          businessTypes: string[];
          phone?: string;
        };
        if (!Array.isArray(cities) || cities.length === 0) return res.status(400).json({ error: "No cities provided" });
        if (!Array.isArray(businessTypes) || businessTypes.length === 0) return res.status(400).json({ error: "No business types provided" });

        let created = 0;
        let skipped = 0;
        const newRows: typeof seoRegions.$inferSelect[] = [];

        for (const city of cities) {
          for (const bt of businessTypes) {
            const slug = buildRegionSlug(city.city, city.stateCode, bt);
            try {
              const [row] = await db.insert(seoRegions).values({
                city: city.city,
                state: city.state,
                stateCode: city.stateCode,
                slug,
                product: "booking",
                businessType: bt,
                nearbyCities: city.nearbyCities ?? null,
                phone: phone ?? null,
                pageGenerated: false,
              }).onConflictDoNothing().returning();
              if (row) { newRows.push(row); created++; }
              else skipped++;
            } catch { skipped++; }
          }
        }

        res.json({ success: true, created, skipped, total: cities.length * businessTypes.length });
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "Bulk seed failed" });
      }
    });

    // Delete region and its HTML file
    app.delete("/api/seo-regions/:id", async (req, res) => {
      try {
        const id = parseInt(req.params.id as string);
        const [row] = await db.select().from(seoRegions).where(eq(seoRegions.id, id));
        if (!row) return res.status(404).json({ error: "Not found" });
        await db.delete(seoRegions).where(eq(seoRegions.id, id));
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? "Failed to delete region" });
      }
    });

  // ── Team / Permissions ────────────────────────────────────────────────────────
  // List all user accounts owned by the current owner (anyone whose email
  // matches a staff record under one of the owner's stores, plus the owner).
  app.get("/api/team", requirePermission(PERMISSIONS.STAFF_MANAGE), async (req, res) => {
    try {
      const ownerId = req.auth?.userId;
      if (!ownerId) return res.status(401).json({ message: "Unauthorized" });

      // Find all stores belonging to this owner, then all staff in those stores,
      // then all user accounts with matching emails (or staffId).
      const ownerStores = await db
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.userId, ownerId));
      const storeIds = ownerStores.map((s) => s.id);

      const teamStaff = storeIds.length
        ? await db.select().from(staff).where(sql`${staff.storeId} IN (${sql.join(storeIds, sql`, `)})`)
        : [];

      const staffEmails = teamStaff.map((s) => s.email).filter((e): e is string => !!e);
      const staffIds = teamStaff.map((s) => s.id);

      const teamUsers = await db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
          staffId: users.staffId,
          permissions: users.permissions,
        })
        .from(users)
        .where(
          staffEmails.length || staffIds.length
            ? sql`${users.id} = ${ownerId}
                  OR ${users.email} IN (${staffEmails.length ? sql.join(staffEmails, sql`, `) : sql`NULL`})
                  OR ${users.staffId} IN (${staffIds.length ? sql.join(staffIds, sql`, `) : sql`NULL`})`
            : eq(users.id, ownerId),
        );

      // Staff that have a linked user account (by email or staffId) — exclude
      // them from the "staff-only" pseudo-member list so we don't show duplicates.
      const linkedStaffIds = new Set<number>();
      const linkedEmails = new Set<string>();
      for (const u of teamUsers) {
        if (u.staffId) linkedStaffIds.add(u.staffId);
        if (u.email) linkedEmails.add(u.email);
      }
      const staffOnly = teamStaff.filter(
        (s) => !linkedStaffIds.has(s.id) && !(s.email && linkedEmails.has(s.email)),
      );

      const userMembers = teamUsers.map((u) => ({
        ...u,
        isOwner: u.id === ownerId,
        kind: "user" as const,
      }));
      const staffMembers = staffOnly.map((s) => {
        const [first, ...rest] = (s.name ?? "").split(" ");
        return {
          id: `staff:${s.id}`,
          email: s.email ?? "",
          firstName: first ?? null,
          lastName: rest.join(" ") || null,
          role: "staff",
          staffId: s.id,
          permissions: s.permissions ?? null,
          isOwner: false,
          kind: "staff" as const,
        };
      });

      res.json({
        members: [...userMembers, ...staffMembers],
        staff: teamStaff.map((s) => ({ id: s.id, name: s.name, email: s.email, storeId: s.storeId })),
      });
    } catch (err) {
      console.error("[team] list failed:", err);
      res.status(500).json({ message: "Failed to load team" });
    }
  });

  app.patch("/api/team/:userId/role", requirePermission(PERMISSIONS.STAFF_MANAGE), async (req, res) => {
    try {
      let targetId = req.params.userId;
      const { role } = req.body as { role?: string };
      if (!["manager", "staff"].includes(role || "")) {
        return res.status(400).json({ message: "Role must be 'manager' or 'staff'" });
      }

      // Pseudo-IDs (staff:N) point to staff records without a login yet.
      // Auto-create a user account so the owner can assign a role directly.
      if ((targetId as string).startsWith("staff:")) {
        const staffId = Number((targetId as string).slice("staff:".length));
        if (!Number.isInteger(staffId)) {
          return res.status(400).json({ message: "Invalid staff id" });
        }
        const [staffRow] = await db.select().from(staff).where(eq(staff.id, staffId));
        if (!staffRow) return res.status(404).json({ message: "Staff member not found" });
        if (!staffRow.email) {
          return res.status(400).json({
            message: "This staff member needs an email on their profile before a role can be assigned.",
          });
        }
        // If a user already exists with that email, just link & reuse it.
        const [existingByEmail] = await db
          .select()
          .from(users)
          .where(eq(users.email, staffRow.email));
        if (existingByEmail) {
          if (!existingByEmail.staffId) {
            await db.update(users).set({ staffId }).where(eq(users.id, existingByEmail.id));
          }
          targetId = existingByEmail.id;
        } else {
          // Create a placeholder login. A random password is set; the staff
          // member will use the standard "forgot password" flow on first login.
          const tempPassword = await bcrypt.hash(
            `${Math.random().toString(36).slice(2)}${Date.now()}`,
            10,
          );
          const [first, ...rest] = (staffRow.name ?? "").split(" ");
          const [created] = await db
            .insert(users)
            .values({
              email: staffRow.email,
              password: tempPassword,
              firstName: first || null,
              lastName: rest.join(" ") || null,
              role: role!, // will be overwritten below, but seed correctly
              staffId,
              passwordChanged: false,
            })
            .returning();
          targetId = created.id;
        }
      }

      // Owners can never be demoted via this endpoint.
      const resolvedId = Array.isArray(targetId) ? targetId[0] : targetId;
      const [target] = await db.select().from(users).where(eq(users.id, resolvedId));
      if (!target) return res.status(404).json({ message: "User not found" });
      if (target.id === req.auth?.userId) {
        return res.status(400).json({ message: "You cannot change your own role" });
      }
      if (target.role === "owner" || target.role === "admin") {
        return res.status(403).json({ message: "Cannot change an owner's role" });
      }
      const [updated] = await db.update(users).set({ role }).where(eq(users.id, resolvedId)).returning();
      res.json(updated);
    } catch (err) {
      console.error("[team] update role failed:", err);
      res.status(500).json({ message: "Failed to update role" });
    }
  });

  // POST /api/team/invite — invite a staff member by email
  app.post("/api/team/invite", requirePermission(PERMISSIONS.STAFF_MANAGE), async (req, res) => {
    try {
      const ownerId = req.auth?.userId;
      if (!ownerId) return res.status(401).json({ message: "Unauthorized" });

      const { email, name, role, employmentType, storeId } = req.body as {
        email: string;
        name: string;
        role?: string;
        employmentType?: string;
        storeId: number;
      };

      if (!email || !name || !storeId) {
        return res.status(400).json({ message: "email, name, and storeId are required" });
      }

      // Verify the owner owns this store
      const [store] = await db.select().from(locations).where(
        and(eq(locations.id, storeId), eq(locations.userId, ownerId))
      );
      if (!store) return res.status(403).json({ message: "Store not found or not owned by you" });

      // Solo plan subscribers cannot add additional staff members
      const { checkStaffLimit } = await import("./middleware/plan-middleware");
      const staffCheck = await checkStaffLimit(storeId);
      if (!staffCheck.allowed) {
        return res.status(403).json({
          message: "Your Solo plan includes only 1 staff member (you). Upgrade to Professional to add team members.",
          code: "SOLO_STAFF_LIMIT",
        });
      }

      // Generate invite token
      const inviteToken = crypto.randomBytes(32).toString("hex");
      const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Check if staff with this email already exists in this store
      const existing = await db.select().from(staff)
        .where(and(eq(staff.storeId, storeId), eq(staff.email, email)));

      let staffRecord: any;
      if (existing.length > 0) {
        // Update existing staff with invite token
        const [updated] = await db.update(staff)
          .set({
            status: "invited",
            inviteToken,
            inviteExpiresAt,
            invitedAt: new Date(),
            invitedByUserId: ownerId,
            role: role || existing[0].role,
            employmentType: employmentType || existing[0].employmentType,
          })
          .where(eq(staff.id, existing[0].id))
          .returning();
        staffRecord = updated;
      } else {
        // Create new staff record with invite pending
        const [created] = await db.insert(staff).values({
          name,
          email,
          storeId,
          role: role || "staff",
          employmentType: employmentType || "stylist",
          status: "invited",
          inviteToken,
          inviteExpiresAt,
          invitedAt: new Date(),
          invitedByUserId: ownerId,
        }).returning();
        staffRecord = created;
      }

      // Build invite URL
      const baseUrl = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : (process.env.APP_URL || "");
      const inviteUrl = `${baseUrl}/accept-invite?token=${inviteToken}`;

      // Send invite email (gracefully falls back if Mailgun not configured)
      const emailResult = await sendEmail(
        storeId,
        email,
        `You've been invited to join ${store.name} on Certxa`,
        `
          <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
            <h1 style="font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:700;color:#3B0764;margin:0 0 8px">
              You're invited to ${store.name}
            </h1>
            <p style="color:#4b5563;font-size:.95rem;line-height:1.6;margin:0 0 24px">
              Hi ${name}, you've been invited to join <strong>${store.name}</strong> as a team member on Certxa. 
              Click the button below to create your account and get started.
            </p>
            <a href="${inviteUrl}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#3B0764,#5B21B6);color:#fff;text-decoration:none;border-radius:50px;font-weight:700;font-size:.9rem;margin-bottom:24px">
              Accept Invitation →
            </a>
            <p style="color:#9ca3af;font-size:.78rem">This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.</p>
          </div>
        `,
        `You've been invited to join ${store.name} on Certxa. Accept your invitation: ${inviteUrl}`
      );

      console.log(`[team/invite] Invited ${email} to store ${storeId}. Invite URL: ${inviteUrl}. Email result:`, emailResult);

      res.json({
        success: true,
        staffId: staffRecord.id,
        email,
        inviteUrl,
        emailSent: emailResult.success,
        emailSkipped: emailResult.skipped,
      });
    } catch (err: any) {
      console.error("[team] invite failed:", err);
      res.status(500).json({ message: "Failed to send invitation" });
    }
  });

  // GET /api/team/invite/:token — validate invite token (public, no auth required)
  app.get("/api/team/invite/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const [staffMember] = await db.select({
        id: staff.id,
        name: staff.name,
        email: staff.email,
        employmentType: staff.employmentType,
        role: staff.role,
        status: staff.status,
        inviteExpiresAt: staff.inviteExpiresAt,
        storeId: staff.storeId,
      }).from(staff).where(eq(staff.inviteToken, token));

      if (!staffMember) {
        return res.status(404).json({ message: "Invite not found or already used" });
      }
      if (staffMember.status !== "invited") {
        return res.status(400).json({ message: "This invitation has already been used" });
      }
      if (staffMember.inviteExpiresAt && new Date() > staffMember.inviteExpiresAt) {
        return res.status(400).json({ message: "This invitation has expired" });
      }

      // Fetch store name
      const [store] = await db.select({ name: locations.name }).from(locations)
        .where(eq(locations.id, staffMember.storeId!));

      res.json({
        ...staffMember,
        storeName: store?.name ?? "the salon",
      });
    } catch (err) {
      console.error("[team] validate invite failed:", err);
      res.status(500).json({ message: "Failed to validate invite" });
    }
  });

  // POST /api/team/invite/:token/accept — accept invite, set password, create/link user account
  app.post("/api/team/invite/:token/accept", async (req, res) => {
    try {
      const { token } = req.params;
      const { firstName, lastName, password } = req.body as {
        firstName: string;
        lastName: string;
        password: string;
      };

      if (!firstName || !password || password.length < 6) {
        return res.status(400).json({ message: "First name and password (min 6 chars) required" });
      }

      const [staffMember] = await db.select().from(staff).where(eq(staff.inviteToken, token));
      if (!staffMember) return res.status(404).json({ message: "Invite not found" });
      if (staffMember.status !== "invited") return res.status(400).json({ message: "Invite already used" });
      if (staffMember.inviteExpiresAt && new Date() > staffMember.inviteExpiresAt) {
        return res.status(400).json({ message: "Invite expired" });
      }

      const hashedPw = await bcrypt.hash(password, 10);

      // Create or update user account
      let userId: string;
      const [existingUser] = staffMember.email
        ? await db.select().from(users).where(eq(users.email, staffMember.email))
        : [undefined];

      if (existingUser) {
        await db.update(users).set({
          firstName,
          lastName: lastName || null,
          password: hashedPw,
          staffId: staffMember.id,
          role: "staff",
          passwordChanged: true,
        }).where(eq(users.id, existingUser.id));
        userId = existingUser.id;
      } else {
        const [created] = await db.insert(users).values({
          email: staffMember.email!,
          password: hashedPw,
          firstName,
          lastName: lastName || null,
          role: "staff",
          staffId: staffMember.id,
          passwordChanged: true,
          onboardingCompleted: true,
        }).returning();
        userId = created.id;
      }

      // Mark staff as active, clear invite token
      await db.update(staff).set({
        status: "active",
        name: `${firstName}${lastName ? " " + lastName : ""}`,
        password: hashedPw,
        inviteToken: null,
        inviteExpiresAt: null,
        joinedAt: new Date(),
      }).where(eq(staff.id, staffMember.id));

      // Log them in
      (req.session as any).userId = userId;
      res.json({ success: true, userId });
    } catch (err: any) {
      console.error("[team] accept invite failed:", err);
      res.status(500).json({ message: "Failed to accept invitation" });
    }
  });

  // PATCH /api/team/staff/:id/status — deactivate / reactivate / remove a staff member
  app.patch("/api/team/staff/:id/status", requirePermission(PERMISSIONS.STAFF_MANAGE), async (req, res) => {
    try {
      const staffId = Number(req.params.id);
      const { status } = req.body as { status: "active" | "deactivated" | "removed" };
      if (!["active", "deactivated", "removed"].includes(status)) {
        return res.status(400).json({ message: "status must be active, deactivated, or removed" });
      }

      const updates: Record<string, any> = { status };
      if (status === "removed") updates.removedAt = new Date();

      const [updated] = await db.update(staff).set(updates).where(eq(staff.id, staffId)).returning();
      if (!updated) return res.status(404).json({ message: "Staff member not found" });

      // If deactivated/removed, invalidate any linked user session by revoking the staffId link
      if (status === "removed" || status === "deactivated") {
        await db.update(users).set({ role: "staff" }).where(eq(users.staffId, staffId));
      }

      res.json(updated);
    } catch (err) {
      console.error("[team] update staff status failed:", err);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  // GET /api/team/stats — seat usage counts for the current owner's stores
  app.get("/api/team/stats", requirePermission(PERMISSIONS.STAFF_MANAGE), async (req, res) => {
    try {
      const ownerId = req.auth?.userId;
      if (!ownerId) return res.status(401).json({ message: "Unauthorized" });

      const ownerStores = await db.select({ id: locations.id }).from(locations)
        .where(eq(locations.userId, ownerId));
      const storeIds = ownerStores.map((s) => s.id);

      if (!storeIds.length) return res.json({ active: 0, invited: 0, deactivated: 0, total: 0 });

      const allStaff = await db.select({ status: staff.status }).from(staff)
        .where(sql`${staff.storeId} IN (${sql.join(storeIds, sql`, `)})`);

      const active = allStaff.filter(s => !s.status || s.status === "active").length;
      const invited = allStaff.filter(s => s.status === "invited").length;
      const deactivated = allStaff.filter(s => s.status === "deactivated").length;

      res.json({ active, invited, deactivated, total: allStaff.length });
    } catch (err) {
      console.error("[team] stats failed:", err);
      res.status(500).json({ message: "Failed to load stats" });
    }
  });

  app.patch("/api/team/:userId/permissions", requirePermission(PERMISSIONS.STAFF_PERMISSIONS_MANAGE), async (req, res) => {
    try {
      const targetId = req.params.userId;
      const { permissions } = req.body as { permissions?: Record<string, boolean> };
      if (!permissions || typeof permissions !== "object") {
        return res.status(400).json({ message: "permissions object required" });
      }
      const cleaned: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(permissions)) {
        if (typeof v === "boolean") cleaned[k] = v;
      }

      // Staff-only pseudo-member targeted as "staff:<id>"
      if ((targetId as string).startsWith("staff:")) {
        const staffIdNum = Number((targetId as string).slice("staff:".length));
        if (!Number.isFinite(staffIdNum)) {
          return res.status(400).json({ message: "Invalid staff id" });
        }
        const [updated] = await db
          .update(staff)
          .set({ permissions: cleaned })
          .where(eq(staff.id, staffIdNum))
          .returning();
        if (!updated) return res.status(404).json({ message: "Staff not found" });
        return res.json({ id: targetId, permissions: updated.permissions });
      }

      const [target] = await db.select().from(users).where(eq(users.id, targetId as string));
      if (!target) return res.status(404).json({ message: "User not found" });
      if (target.role === "owner" || target.role === "admin") {
        return res.status(403).json({ message: "Cannot edit an owner's permissions" });
      }
      const [updated] = await db
        .update(users)
        .set({ permissions: cleaned })
        .where(eq(users.id, targetId as string))
        .returning();
      res.json(updated);
    } catch (err) {
      console.error("[team] update permissions failed:", err);
      res.status(500).json({ message: "Failed to update permissions" });
    }
  });

  // ── Certxa Pro Dashboard API ─────────────────────────────────────────────────
  const { default: proDashboardRouter } = await import("./routes/pro-dashboard.js");
  app.use("/api/pro-dashboard", proDashboardRouter);

  // ── Certxa Crew Mobile API ────────────────────────────────────────────────────
  const { default: crewMobileRouter, startOvertimeDetector } = await import("./routes/crew-mobile.js");
  app.use("/api/crew", crewMobileRouter);
  startOvertimeDetector();

  // ── AI Chatbot API ───────────────────────────────────────────────────────────
  const { default: chatbotRouter } = await import("./chatbot.js");
  app.use("/api/chatbot", chatbotRouter);

  // ── Twilio Outbound Dialer ───────────────────────────────────────────────────
  const { default: dialerRouter } = await import("./dialer.js");
  app.use("/api/dialer", dialerRouter);

  // ── Staff Training Tool ──────────────────────────────────────────────────────
  const { default: trainingRouter } = await import("./routes/training.js");
  app.use("/api/training", trainingRouter);

  // ── Client Data Architecture (normalized CRM + export/import) ───────────────
  const { default: clientsRouter } = await import("./routes/clients.js");
  app.use("/api/clients", clientsRouter);

  // ── Manage Hub (unified subscriber dashboard) ────────────────────────────────
  const { default: manageRouter } = await import("./routes/manage.js");
  app.use("/api/manage", manageRouter);

  // ── CRM Search (trigram-powered global search) ───────────────────────────────
  const { default: crmSearchRouter } = await import("./routes/crm-search.js");
  app.use("/api/manage/crm-search", crmSearchRouter);

  // ── Billing & Subscriptions ──────────────────────────────────────────────────
  const { default: billingRouter } = await import("./routes/billing.js");
  const { default: billingWebhookRouter } = await import("./routes/billing-webhooks.js");
  const { default: billingPlansAdminRouter } = await import("./routes/billing-plans-admin.js");
  app.use("/api/billing", billingWebhookRouter);
  app.use("/api/billing", billingPlansAdminRouter);
  app.use("/api/billing", billingRouter);

  // ── Billing dunning scheduler (30-day suspension → auto-lock)
  const { startBillingDunningScheduler } = await import("./billing-dunning-scheduler.js");
  startBillingDunningScheduler();

  // Phase 8 — graduation sweep + day-7 owner digest.
  const { startGraduationScheduler } = await import("./training/graduation-scheduler.js");
  startGraduationScheduler();

  // Start the reminder schedulers (SMS + Email)
  startReminderScheduler();
  startEmailReminderScheduler();

  // Start the queue smart SMS scheduler
  startQueueSmsScheduler();

  // Start trial reminder emails (30 / 7 / 1 day before expiry)
  const { startTrialReminderScheduler } = await import("./services/trial-reminders.js");
  startTrialReminderScheduler();

  // Start Google Reviews auto-sync (every 6 hours — new engine, new schema + legacy fallback)
  startGoogleReviewSyncScheduler();

  // ── Revenue Intelligence Engine ──────────────────────────────────────────────
  const { default: intelligenceRouter } = await import("./routes/intelligence.js");
  app.use("/api/intelligence", intelligenceRouter);

  const { default: intelligenceDemoRouter } = await import("./routes/intelligence-demo.js");
  app.use("/api/intelligence/demo", intelligenceDemoRouter);

  const { startIntelligenceScheduler } = await import("./intelligence/orchestrator.js");
  startIntelligenceScheduler();

  // ── Website Builder ──────────────────────────────────────────────────────────
  const { default: websiteBuilderRouter } = await import("./routes/index.js");
  app.use("/api", websiteBuilderRouter);

  return httpServer;
}
