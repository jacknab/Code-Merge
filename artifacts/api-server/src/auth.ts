import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, pool } from "./db";
import { users } from "@shared/models/auth";
import { locations, staff, passwordResetTokens } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import { sendEmail } from "./mail";
import passport from "./passport";
import { computePermissions, normalizeRole } from "@shared/permissions";
import { TrialService } from "./services/trial-service";
import { checkGoogleLoginRateLimit } from "./rate-limits";
import { clientIntelligence } from "@shared/schema/intelligence";
import { runIntelligenceForStore } from "./intelligence/orchestrator";

/**
 * Boot the intelligence engine for a store on first login if it has never
 * been computed before. Runs entirely in the background — the login response
 * is NOT delayed by this work.
 */
async function maybeBootstrapIntelligence(userId: string): Promise<void> {
  try {
    const [store] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.userId, userId))
      .limit(1);

    if (!store) return;

    const [existing] = await db
      .select({ id: clientIntelligence.id })
      .from(clientIntelligence)
      .where(eq(clientIntelligence.storeId, store.id))
      .limit(1);

    if (!existing) {
      console.log(`[intelligence] First login for store ${store.id} — bootstrapping intelligence in background`);
      runIntelligenceForStore(store.id).catch(err =>
        console.error("[intelligence] Bootstrap error:", err)
      );
    }
  } catch (err) {
    // Non-fatal — never block login
    console.error("[intelligence] maybeBootstrapIntelligence error:", err);
  }
}

export function setupAuth(app: Express) {
  // Trust exactly 1 proxy hop — required for Replit (proxied HTTPS) and
  // VPS setups where Nginx sits in front of Node.
  // Using `1` instead of `true` satisfies express-rate-limit's trust proxy
  // validation (ERR_ERL_PERMISSIVE_TRUST_PROXY) while still allowing correct
  // IP detection through a single reverse proxy layer.
  app.set("trust proxy", 1);

  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    pool: pool as any,
    createTableIfMissing: true,
    tableName: "sessions",
    errorLog: console.error,
  });

  // REPLIT_DEV_DOMAIN is only injected in the Replit dev workspace.
  // REPL_ID is present in both dev and deployed Replit environments.
  const isReplitDev = !!process.env.REPLIT_DEV_DOMAIN;
  const isReplit    = !!(process.env.REPLIT_DEV_DOMAIN || process.env.REPL_ID);

  // Use secure cookies whenever:
  //   • We are in production mode (VPS with TLS termination), OR
  //   • We are inside Replit (proxied HTTPS regardless of NODE_ENV).
  const secureCookies = process.env.NODE_ENV === "production" || isReplit;

  // Restrict the cookie domain only when COOKIE_DOMAIN is explicitly set (e.g. ".certxa.com").
  // Skip it in Replit dev — the proxied *.replit.dev origin doesn't need a shared domain.
  // In Replit production (custom domain) and on the VPS, honour the value so cookies are
  // shared across subdomains correctly.
  const cookieDomain =
    !isReplitDev && process.env.COOKIE_DOMAIN ? process.env.COOKIE_DOMAIN : undefined;

  // SameSite strategy:
  //   "none"  — required for Replit's proxied iframe (cookie crosses origins)
  //   "lax"   — correct for VPS / direct HTTPS; doesn't require Secure flag,
  //             works for all same-origin API calls and top-level navigations.
  const sameSitePolicy: "none" | "lax" = isReplit ? "none" : "lax";

  // Secure strategy:
  //   true    — Replit always serves HTTPS, and production VPS always terminates
  //             TLS at nginx. Set Secure flag unconditionally whenever we know
  //             the client connection is HTTPS. Avoids relying on req.secure
  //             detection which can be flaky across proxy configurations.
  //             Required when sameSite is "none" — browsers reject cookies that
  //             have sameSite=none without Secure.
  //   false   — development (plain HTTP, no proxy).
  const securePolicy: boolean = secureCookies;

  app.use(
    session({
      name: "certxa.sid",
      secret: process.env.SESSION_SECRET!,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true, // Refresh cookie expiration on every request — keeps active devices signed in
      cookie: {
        httpOnly: true,
        secure: securePolicy,
        sameSite: sameSitePolicy,
        maxAge: 1000 * 60 * 60 * 24 * 7, // Default: 7 days (overridden to 10 years for kiosk-mode logins)
        domain: cookieDomain,
      },
    })
  );

  // 10 years — practically "never expires", used for front-desk / kiosk devices
  const KIOSK_MAX_AGE = 1000 * 60 * 60 * 24 * 365 * 10;

  // --- Google OAuth Routes ---
  // Registered immediately after session middleware so the session is
  // guaranteed to be populated before the OAuth callback handler runs.

  // Derive the correct Google OAuth callback URL for the current environment.
  // Replit dev domain always wins so the callback lands back on the right host.
  // Priority: Replit dev domain → explicit env var → production fallback.
  function resolveGoogleCallbackURL(): string {
    if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}/api/auth/google/callback`;
    if (process.env.GOOGLE_LOGIN_CALLBACK_URL) return process.env.GOOGLE_LOGIN_CALLBACK_URL;
    if (process.env.GOOGLE_AUTH_CALLBACK_URL)  return process.env.GOOGLE_AUTH_CALLBACK_URL;
    return "https://certxa.com/api/auth/google/callback";
  }

  app.get("/api/auth/google", (req: Request, res: Response, next: NextFunction) => {
    // Uses GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET (login-only OAuth).
    // Falls back to legacy GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET if new vars are not set.
    const loginClientId     = process.env.GOOGLE_LOGIN_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID;
    const loginClientSecret = process.env.GOOGLE_LOGIN_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
    if (!loginClientId || !loginClientSecret) {
      return res.redirect("/auth?error=google_not_configured");
    }

    // Per-IP rate limit: 5 attempts per 10 minutes (state lives in server/rate-limits.ts)
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ?? req.socket.remoteAddress ?? "unknown";
    const { allowed, retryAfterSecs } = checkGoogleLoginRateLimit(ip);
    if (!allowed) {
      const retryMins = Math.ceil(retryAfterSecs / 60);
      console.warn(`[Google Login OAuth] Rate limit hit for IP ${ip}`);
      return res.redirect(`/auth?error=rate_limited&retry=${retryMins}`);
    }
    const loginCallbackURL = resolveGoogleCallbackURL();

    console.log("[Google Login OAuth] OAuth URL generated — initiating authentication flow");
    console.log("[Google Login OAuth]   callback_url (sent to Google):", loginCallbackURL);
    // Stash kiosk-mode flag (from query string) into the session so the callback can apply it
    if (req.query.keepSignedIn === "1") {
      (req.session as any).pendingKiosk = true;
    } else {
      delete (req.session as any).pendingKiosk;
    }
    console.log("Google OAuth: Initiating authentication...");
    req.session.save(() => {
      passport.authenticate("google", {
        scope: ["profile", "email"],
        callbackURL: loginCallbackURL,
      })(req, res, next);
    });
  });

  app.get(
    "/api/auth/google/callback",
    (req, res, next) => {
      passport.authenticate("google", {
        session:         false,
        failureRedirect: "/auth?error=google_failed",
        callbackURL:     resolveGoogleCallbackURL(),
      })(req, res, next);
    },
    async (req: Request, res: Response) => {
      console.log("Google OAuth: Callback received, user:", (req.user as any)?.email);
      if (!req.user) {
        console.error("Google OAuth: No user in request after passport — redirecting to /auth");
        return res.redirect("/auth?error=google_no_user");
      }

      const user = req.user as any;
      (req.session as any).userId = user.id;

      if ((req.session as any).pendingKiosk) {
        req.session.cookie.maxAge = KIOSK_MAX_AGE;
        delete (req.session as any).pendingKiosk;
        console.log("Google OAuth: Kiosk mode enabled (10-year session)");
      }

      // Ensure trial is set up for new Google sign-in users
      const needsTrial = !user.trialStartedAt && !user.subscriptionStatus;
      if (needsTrial || user.subscriptionStatus === null) {
        try {
          await TrialService.setupTrialForUser(user.id);
          console.log("Google OAuth: Trial set up for new user", user.email);
        } catch (err) {
          console.warn("Google OAuth: Trial setup failed (may already exist):", err);
        }
      }

      // Determine redirect target
      const redirectTarget = user.onboardingCompleted ? "/manage" : "/onboarding";
      console.log(`Google OAuth: Redirecting new/returning user to ${redirectTarget}`);

      req.session.save((err) => {
        if (err) {
          console.error("Google OAuth: Session save failed —", err);
          // Session save failed but user IS authenticated — set a short-lived cookie as fallback
          res.cookie("auth_pending_uid", user.id, {
            httpOnly: true,
            secure:   true,
            sameSite: "none",
            maxAge:   60_000, // 1 minute — just long enough to land on the next page
          });
          return res.redirect(redirectTarget);
        }
        res.redirect(redirectTarget);
      });
    }
  );

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { password, firstName, lastName, keepSignedIn } = req.body;
      const email = typeof req.body.email === "string" ? req.body.email.toLowerCase().trim() : req.body.email;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const [existing] = await db.select().from(users).where(eq(users.email, email));
      if (existing) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const [user] = await db
        .insert(users)
        .values({
          email,
          password: hashedPassword,
          firstName: firstName || null,
          lastName: lastName || null,
        })
        .returning();

      // Start the 60-day free trial immediately on registration
      await TrialService.setupTrialForUser(user.id);

      (req.session as any).userId = user.id;
      if (keepSignedIn) {
        req.session.cookie.maxAge = KIOSK_MAX_AGE;
      }
      const { password: _, ...safeUser } = user;
      const role = normalizeRole(user.role);
      const permissions = Array.from(computePermissions(role, user.permissions ?? null));
      req.session.save((err) => {
        if (err) {
          console.error("Session save error after registration:", err);
          return res.status(500).json({ message: "Session could not be saved" });
        }
        res.status(201).json({ ...safeUser, role, permissions });
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password, keepSignedIn } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const normalizedEmail = email.toLowerCase().trim();

      // --- Check users table first ---
      const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail));

      if (user) {
        // Google OAuth users have an empty password — they must use Google Sign-In
        if (user.googleId && (!user.password || user.password === "")) {
          return res.status(400).json({
            message: "This account was created with Google. Please use the 'Sign in with Google' button to log in.",
          });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (valid) {
          (req.session as any).userId = user.id;
          if (keepSignedIn) {
            req.session.cookie.maxAge = KIOSK_MAX_AGE;
          }
          const { password: _, ...safeUser } = user;
          return req.session.save((err) => {
            if (err) {
              console.error("[login] Session save ERROR:", err);
              return res.status(500).json({ message: "Session could not be saved" });
            }
            console.error("[login] Session saved OK — ID:", req.sessionID, "userId:", (req.session as any).userId);
            maybeBootstrapIntelligence(user.id);
            return res.json(safeUser);
          });
        }

        // User exists but password is wrong — don't fall through to staff table
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // --- Fallback: check staff table directly ---
      // Staff members created with a password in the staff profile can log in here
      const [staffMember] = await db.select().from(staff).where(eq(staff.email, normalizedEmail));

      if (staffMember && staffMember.password) {
        const validStaffPw = await bcrypt.compare(password, staffMember.password);
        if (validStaffPw) {
          (req.session as any).staffId = staffMember.id;
          if (keepSignedIn) {
            req.session.cookie.maxAge = KIOSK_MAX_AGE;
          }
          const { password: _pw, ...safeStaff } = staffMember;
          const staffResponse = {
            id: `staff-${staffMember.id}`,
            email: staffMember.email ?? "",
            role: "staff",
            staffId: staffMember.id,
            firstName: staffMember.name?.split(" ")[0] ?? null,
            lastName: staffMember.name?.split(" ").slice(1).join(" ") || null,
            onboardingCompleted: true,
            passwordChanged: true,
            googleId: null,
            profileImageUrl: staffMember.avatarUrl ?? null,
            subscriptionStatus: "active",
            trialStartedAt: null,
            trialEndsAt: null,
            createdAt: null,
            updatedAt: null,
          };
          return req.session.save((err) => {
            if (err) {
              console.error("Session save error after staff login:", err);
              return res.status(500).json({ message: "Session could not be saved" });
            }
            return res.json(staffResponse);
          });
        }
      }

      return res.status(401).json({ message: "Invalid email or password" });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/user", async (req, res) => {
    const userId = (req.session as any)?.userId;
    const staffId = (req.session as any)?.staffId;

    if (!userId && !staffId) {
      return res.status(200).json(null);
    }

    try {
      // --- Normal user session ---
      if (userId) {
        let [user] = await db.select().from(users).where(eq(users.id, userId));
        if (!user) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        if (!user.onboardingCompleted) {
          const userStores = await db.select().from(locations).where(eq(locations.userId, userId));
          if (userStores.length > 0) {
            await db.update(users).set({ onboardingCompleted: true }).where(eq(users.id, userId));
            [user] = await db.select().from(users).where(eq(users.id, userId));
          }
        }

        const { password: _, ...safeUser } = user;
        const role = normalizeRole(user.role);
        const permissions = Array.from(computePermissions(role, user.permissions ?? null));
        return res.json({ ...safeUser, role, permissions });
      }

      // --- Staff-only session (logged in via staff table credentials) ---
      if (staffId) {
        const [staffMember] = await db.select().from(staff).where(eq(staff.id, staffId));
        if (!staffMember) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        const { password: _pw, ...safeStaff } = staffMember;
        const permissions = Array.from(computePermissions("staff", null));
        return res.json({
          id: `staff-${staffMember.id}`,
          email: staffMember.email ?? "",
          role: "staff",
          permissions,
          staffId: staffMember.id,
          firstName: staffMember.name?.split(" ")[0] ?? null,
          lastName: staffMember.name?.split(" ").slice(1).join(" ") || null,
          onboardingCompleted: true,
          passwordChanged: true,
          googleId: null,
          profileImageUrl: staffMember.avatarUrl ?? null,
          subscriptionStatus: "active",
          trialStartedAt: null,
          trialEndsAt: null,
          createdAt: null,
          updatedAt: null,
        });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email is required" });

      const normalizedEmail = email.toLowerCase().trim();
      const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail));

      // Always return 200 to prevent email enumeration attacks
      if (!user) return res.json({ message: "If that email is registered, a reset link has been sent." });

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        token,
        expiresAt,
      });

      const appUrl = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "localhost:5000"}`;
      const resetUrl = `${appUrl}/reset-password?token=${token}`;

      const html = `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Reset your Certxa password</h2>
          <p>Hi ${user.firstName || "there"},</p>
          <p>We received a request to reset your password. Click the link below to set a new one:</p>
          <p><a href="${resetUrl}" style="background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Reset Password</a></p>
          <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        </div>`;

      await sendEmail(0, normalizedEmail, "Reset your Certxa password", html);

      res.json({ message: "If that email is registered, a reset link has been sent." });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) return res.status(400).json({ message: "Token and password are required" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

      const now = new Date();
      const [resetRecord] = await db
        .select()
        .from(passwordResetTokens)
        .where(and(eq(passwordResetTokens.token, token), gt(passwordResetTokens.expiresAt, now)));

      if (!resetRecord) return res.status(400).json({ message: "Invalid or expired reset link. Please request a new one." });
      if (resetRecord.usedAt) return res.status(400).json({ message: "This reset link has already been used." });

      const hashed = await bcrypt.hash(password, 10);
      await db.update(users).set({ password: hashed }).where(eq(users.id, resetRecord.userId));
      await db.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, resetRecord.id));

      res.json({ message: "Password updated successfully. You can now log in." });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    console.error("[auth] 401", {
      path: req.path,
      method: req.method,
      sessionID: req.sessionID ?? "(none)",
      hasCookie: !!req.headers.cookie,
      sessionKeys: Object.keys((req.session as any) ?? {}),
    });
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};

export const isAdminAuthenticated: RequestHandler = async (req, res, next) => {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Admin access required" });
  }

  try {
    const { users } = await import("@shared/models/auth");
    const { db } = await import("./db");
    const { eq } = await import("drizzle-orm");
    const [user] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.isAdmin) {
      return res.status(403).json({ message: "Forbidden — platform admin access required" });
    }
    return next();
  } catch {
    return res.status(500).json({ message: "Auth check failed" });
  }
};
