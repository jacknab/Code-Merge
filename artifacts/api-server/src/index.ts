import "dotenv/config";

// ─── Startup environment validation ────────────────────────────────────────
// Runs before anything else. Hard-exits if required vars are missing so
// a misconfigured deployment fails immediately with a clear message instead
// of silently serving a broken app.
(function validateEnv() {
  // In Replit dev, APP_URL can be derived from REPLIT_DEV_DOMAIN automatically
  if (!process.env.APP_URL && process.env.REPLIT_DEV_DOMAIN) {
    process.env.APP_URL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }

  const REQUIRED: Record<string, string> = {
    DATABASE_URL:   "PostgreSQL connection string (postgresql://user:pass@host/db)",
    SESSION_SECRET: "Session cookie signing secret — generate with: openssl rand -hex 64",
    APP_URL:        "Public base URL e.g. https://certxa.com",
  };
  const missing = Object.entries(REQUIRED).filter(([k]) => !process.env[k]);
  if (missing.length) {
    console.error("\n[certxa] STARTUP FAILURE — missing required environment variables:");
    missing.forEach(([k, desc]) => console.error(`  MISSING: ${k}\n          ${desc}`));
    console.error("\nFix: add the missing vars to your .env file or PM2 ecosystem config, then restart.\n");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production") {
    const RECOMMENDED: Record<string, string> = {
      CORS_ORIGINS:             "Comma-separated allowed origins e.g. https://certxa.com",
      GOOGLE_CLIENT_ID:         "Google OAuth client ID (needed for Google login)",
      GOOGLE_AUTH_CALLBACK_URL: "Google OAuth callback e.g. https://certxa.com/api/auth/google/callback",
    };
    const missingRec = Object.entries(RECOMMENDED).filter(([k]) => !process.env[k]);
    if (missingRec.length) {
      console.warn("\n[certxa] WARNING — missing optional environment variables (some features may be disabled):");
      missingRec.forEach(([k, desc]) => console.warn(`  MISSING: ${k}\n          ${desc}`));
      console.warn("");
    }
  }
  // Port validation removed — Replit requires port 5000 for web preview
})();

import cors from "cors";
import express, { type Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { setupAuth } from "./auth";
import { subdomainMiddleware } from "./middleware/subdomain";
import { createServer } from "http";
import compression from "compression";
import passport from "./passport";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import { startPhpServer, phpMiddleware, isPhpReady, isPhpRoute } from "./php-proxy";
import { pool } from "./db";
import { createRequire } from "module";
// esbuild injects __filename as a real global in CJS output (same as __dirname).
// Using it as the base for createRequire avoids the import.meta.url warning
// that appears when targeting CJS format, and works reliably in both dev (tsx)
// and the minified production bundle.
const _require: NodeRequire = createRequire(
  (globalThis as any).__filename ?? process.argv[1]
);

// Landing page routes that get server-side rendered for SEO
// Note: /hair-salons, /barbershops, /nail-salons are now served by the PHP site
const SSR_ROUTES = new Set([
  "/industries",
  "/handyman",
  "/house-cleaning",
  "/lawn-care",
  "/snow-removal",
  "/dog-walking",
  "/tutoring",
  "/hvac",
  "/plumbing",
  "/electrical",
  "/carpet-cleaning",
  "/pressure-washing",
  "/window-cleaning",
  "/barbers",
  "/nails",
  "/tattoo",
  "/haircuts",
  "/groomers",
  "/estheticians",
  "/ride-service",
]);
// In the esbuild CJS production bundle, __dirname is a real global that points
// to the dist/ directory. Capture it here before any async code runs.
// (globalThis cast avoids TypeScript errors in ESM source mode.)
const _cjsDirname: string | undefined = (globalThis as any).__dirname;

// Replace with your actual DB functions
import { storage } from "./storage";
import { seoPageMiddleware } from "./seo-pages";

const app = express();
const httpServer = createServer(app);

// --- CORS Setup ---
const rawCorsOrigins =
  process.env.CORS_ORIGINS ||
  process.env.ALLOWED_ORIGINS ||
  process.env.CORS_ORIGIN ||
  "";
const allowAllCorsOrigins = process.env.CORS_ALLOW_ALL === "true";

// Derive the public-facing domain from APP_URL so no domain name is hardcoded.
const _appUrl = process.env.APP_URL || "";
const _appDomain = (() => { try { return _appUrl ? new URL(_appUrl).hostname : ""; } catch { return ""; } })();

const defaultCorsOrigins: string[] = [
  ...(_appUrl ? [_appUrl] : []),
  ...(_appDomain ? [`https://www.${_appDomain}`, `https://manage.${_appDomain}`] : []),
];
if (process.env.NODE_ENV !== "production") {
  // Allow additional local-dev ports via DEV_CORS_PORTS env var (comma-separated).
  // The main app is on port 5000 (same-origin), so extra ports are only needed
  // when running a standalone Vite dev server separately.
  const devPorts = (process.env.DEV_CORS_PORTS || "").split(",").map(p => p.trim()).filter(Boolean);
  devPorts.forEach(p => defaultCorsOrigins.push(`http://localhost:${p}`));
}
const allowedCorsOrigins = (rawCorsOrigins ? rawCorsOrigins.split(",") : defaultCorsOrigins)
  .map((origin) => origin.trim())
  .filter(Boolean);

// --- CORS Origin Validation ---
// Runs once at startup to catch misconfigured origins early.
(function validateCorsOrigins() {
  if (allowAllCorsOrigins) return; // CORS_ALLOW_ALL bypasses the list entirely

  for (const origin of allowedCorsOrigins) {
    const tag = `[CORS] Warning: origin "${origin}"`;

    // Must start with https:// (or http:// for localhost/local dev)
    const hasProtocol = origin.startsWith("https://") || origin.startsWith("http://");
    if (!hasProtocol) {
      console.warn(`${tag} is missing a protocol (expected https:// or http://). It will never match a browser Origin header.`);
      continue; // remaining checks need a valid protocol, skip them
    }

    // No trailing slash — browsers send origins without one
    if (origin.endsWith("/")) {
      console.warn(`${tag} has a trailing slash. Remove it; browsers omit the trailing slash in the Origin header.`);
    }

    // No path component — origin is scheme + host (+ optional port) only
    try {
      const url = new URL(origin);
      if (url.pathname !== "/") {
        console.warn(`${tag} contains a path ("${url.pathname}"). Origins must be scheme + host only (no path).`);
      }
      if (url.search) {
        console.warn(`${tag} contains a query string. Origins must be scheme + host only.`);
      }
      if (url.hash) {
        console.warn(`${tag} contains a hash fragment. Origins must be scheme + host only.`);
      }
    } catch {
      console.warn(`${tag} is not a valid URL and will never match.`);
    }

    // Warn on plain http:// for non-localhost origins in production
    if (
      process.env.NODE_ENV === "production" &&
      origin.startsWith("http://") &&
      !origin.includes("localhost") &&
      !origin.includes("127.0.0.1")
    ) {
      console.warn(`${tag} uses http:// in production. Use https:// for all non-local origins.`);
    }
  }
})();

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowAllCorsOrigins) return callback(null, true);
    if (allowedCorsOrigins.includes(origin)) return callback(null, true);
    // Allow any subdomain of the configured app domain (manage., booking slugs, user sites, etc.)
    if (_appDomain && (origin.endsWith(`.${_appDomain}`) || origin === _appUrl)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

// app.use(cors) with preflightContinue:false (the default) automatically responds
// to all OPTIONS preflight requests with 204 + correct headers before any other
// middleware runs — no explicit app.options() needed.
app.use(cors(corsOptions));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
    user?: any; // passport user typing
  }
}

// --- Security Headers ---
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  const cspConnectSrc = process.env.NODE_ENV !== "production"
    ? "connect-src 'self' https: ws: wss:;"
    : "connect-src 'self' https:;";
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com${_appUrl ? ` ${_appUrl}` : ""}; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com${_appUrl ? ` ${_appUrl}` : ""}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' https:; ${cspConnectSrc} frame-src 'self'${_appUrl ? ` ${_appUrl}` : ""};`
  );
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  next();
});

// --- Middleware ---
// Skip compression for PHP-proxied routes — the PHP built-in server streams
// chunked HTML (e.g. admin-install.php progress steps) and gzip buffering
// prevents that output from reaching the browser until the full response
// is complete, making streaming pages appear frozen.
// Also skip compression for SSE (text/event-stream) routes — gzip buffering
// holds events in the compressor until the buffer fills, which breaks streaming.
const SSE_PATHS = ["/api/intelligence/demo/launch"];
app.use(compression({
  filter: (req: Request, res: Response) => {
    if (isPhpRoute(req.path)) return false;
    if (SSE_PATHS.some((p) => req.path.startsWith(p))) return false;
    return compression.filter(req, res);
  },
}));
app.use(cookieParser());
app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
// --- Rate Limiting ---
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
  skip: (req) => process.env.NODE_ENV !== "production",
});
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
  skip: (req) => process.env.NODE_ENV !== "production",
});
app.use("/api/auth", authLimiter);
app.use("/api/public", publicLimiter);
app.use("/api/book", publicLimiter);

// ─── Health checks ──────────────────────────────────────────────────────────
// No auth required. /api/health returns full diagnostics; /api/healthz is a
// lightweight alias used by deploy scripts and uptime monitors.
// Both must be registered here — BEFORE setupAuth — so they are always public.
app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));

// No auth required. Returns 200 when healthy, 503 when degraded.
// Useful for monitoring tools and AI agents diagnosing VPS deployments.
// See VPS_DEPLOYMENT_GUIDE.md §17b for full documentation.
app.get("/api/health", async (_req, res) => {
  const uptimeSeconds = Math.floor(process.uptime());
  const startedAt = new Date(Date.now() - uptimeSeconds * 1000).toISOString();

  // 1. Database — quick SELECT 1 with 2 s timeout
  let dbStatus: "ok" | "error" = "error";
  let dbError: string | undefined;
  try {
    const client = await Promise.race<any>([
      pool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("connection timeout after 2s")), 2000)
      ),
    ]);
    await client.query("SELECT 1");
    client.release();
    dbStatus = "ok";
  } catch (err: any) {
    dbError = err?.message ?? "unknown error";
  }

  // 2. PHP server
  const phpStatus = isPhpReady() ? "ok" : "starting";

  // 3. Required env vars (presence only — never expose values)
  const envVars = {
    DATABASE_URL:            !!process.env.DATABASE_URL,
    SESSION_SECRET:          !!process.env.SESSION_SECRET,
    APP_URL:                 !!process.env.APP_URL,
    CORS_ORIGINS:            !!process.env.CORS_ORIGINS,
    GOOGLE_CLIENT_ID:        !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_AUTH_CALLBACK_URL:!!process.env.GOOGLE_AUTH_CALLBACK_URL,
    TWILIO_ACCOUNT_SID:      !!process.env.TWILIO_ACCOUNT_SID,
    MAILGUN_API_KEY:         !!process.env.MAILGUN_API_KEY,
  };

  const requiredPresent = envVars.DATABASE_URL && envVars.SESSION_SECRET && envVars.APP_URL;
  const healthy = dbStatus === "ok" && requiredPresent;

  res.status(healthy ? 200 : 503).json({
    status:          healthy ? "ok" : "degraded",
    timestamp:       new Date().toISOString(),
    uptime_seconds:  uptimeSeconds,
    started_at:      startedAt,
    node_env:        process.env.NODE_ENV ?? "unknown",
    port:            process.env.PORT ?? "5000",
    app_url:         process.env.APP_URL ?? "(not set)",
    checks: {
      database: { status: dbStatus, ...(dbError ? { error: dbError } : {}) },
      php:      { status: phpStatus, port: parseInt(process.env.PHP_PORT || "8104", 10) },
      env_vars: envVars,
    },
  });
});

app.use(subdomainMiddleware);

// --- PHP Site Proxy (certxa.com root pages, template catalog, assets) ---
// Must run before auth setup so PHP pages (/, /hair-salons, etc.) are
// served directly without needing a session.
app.use(phpMiddleware);

// --- Friendly redirects for common booking-app paths ---
app.get("/login", (_req, res) => res.redirect(301, "/auth"));
app.get("/signup", (_req, res) => res.redirect(301, "/auth"));

// --- Logging Helper ---
export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

// --- Passport Google OAuth Setup ---
// Moved to server/passport.ts

// --- Main Async Boot ---
(async () => {
  // Run any pending SQL migrations before anything else starts.
  // This keeps the VPS database in sync on every server restart/deploy.
  try {
    const { runMigrations } = await import("./startup/runMigrations");
    await runMigrations();
  } catch (err: any) {
    console.error("[migrations] FATAL: migration failed on startup:", err.message);
    process.exit(1);
  }

  // Start the PHP server for the certxa.com marketing/catalog pages
  startPhpServer();

  setupAuth(app);

  app.use(passport.initialize());
  app.use(passport.session());

  // In production, serve static assets BEFORE registering API routes so that
  // /assets/* requests are always handled by express.static and never reach
  // any route handler (which would return JSON and trigger MIME-type errors).
  if (process.env.NODE_ENV === "production") {
    // Resolve relative to the compiled file's directory (_cjsDirname = dist/).
    // This is immune to PM2 setting a different working directory than the project root.
    // Falls back to process.cwd()/dist/public for non-bundle environments.
    const distPath = _cjsDirname
      ? path.resolve(_cjsDirname, "public")
      : path.resolve(process.cwd(), "dist/public");
    if (!fs.existsSync(distPath)) {
      console.error(`Build directory not found: ${distPath}. Run 'npm run build' first.`);
    } else {
      // Serve pre-compressed .gz files transparently when the client supports it.
      app.use((req: Request, res: Response, next: NextFunction) => {
        const acceptEncoding = req.headers["accept-encoding"] || "";
        if (
          acceptEncoding.includes("gzip") &&
          req.path.match(/\.(js|css|html|json|svg|ico|woff2?)$/)
        ) {
          const gzPath = path.resolve(distPath, req.path.slice(1) + ".gz");
          if (fs.existsSync(gzPath)) {
            res.setHeader("Content-Encoding", "gzip");
            // Set correct Content-Type based on original extension
            if (req.path.endsWith(".js")) res.setHeader("Content-Type", "application/javascript");
            else if (req.path.endsWith(".css")) res.setHeader("Content-Type", "text/css");
            req.url = req.url + ".gz";
          }
        }
        next();
      });

      app.use(express.static(distPath, {
        setHeaders(res, filePath) {
          // Ensure correct MIME types for assets
          if (filePath.endsWith(".js") || filePath.endsWith(".js.gz")) {
            res.setHeader("Content-Type", "application/javascript");
          } else if (filePath.endsWith(".css") || filePath.endsWith(".css.gz")) {
            res.setHeader("Content-Type", "text/css");
          }
          // Cache hashed assets for 1 year, everything else no-cache
          if (filePath.includes("/assets/")) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }));
    }
  }

  // Register all API routes AFTER static assets so /assets/* never hits a route.
  await registerRoutes(httpServer, app);

  // One-time startup repair: fix any users who own a store but were left with
  // the "staff" role by legacy code paths.
  const { repairOwnerRoles } = await import("./startup/repairOwnerRoles");
  await repairOwnerRoles();

  // One-time migration: seed sms_allowance from legacy sms_tokens for existing stores
  const { migrateSmsAllowance } = await import("./startup/migrateSmsAllowance");
  await migrateSmsAllowance();

  // Start the 60-day free trial expiration scheduler (runs every hour)
  const { startTrialExpirationScheduler } = await import("./services/trial-expiration");
  startTrialExpirationScheduler();

  // Start weekly revenue digest email scheduler (runs every Monday at 9am)
  const { startWeeklyDigestScheduler } = await import("./intelligence/weekly-digest-email");
  startWeeklyDigestScheduler();

  // Start lapsed client re-engagement scheduler (checks hourly, sends at 10am)
  const { startLapsedClientScheduler } = await import("./lapsed-client-scheduler");
  startLapsedClientScheduler();

  // SEO static HTML pages — must run BEFORE Vite/SSR so HTML files win over React rendering.
  app.use(seoPageMiddleware);

  // Development: use Vite middleware. Production: SSR for landing pages + SPA catch-all.
  if (process.env.NODE_ENV === "production") {
    const distPath = _cjsDirname
      ? path.resolve(_cjsDirname, "public")
      : path.resolve(process.cwd(), "dist/public");

    if (fs.existsSync(distPath)) {
      const ssrBundlePath = _cjsDirname
        ? path.resolve(_cjsDirname, "server/entry-server.cjs")
        : path.resolve(process.cwd(), "dist/server/entry-server.cjs");

      const indexHtmlPath = path.resolve(distPath, "index.html");

      // Load SSR render function and template once at startup (not per-request)
      let ssrRender: ((url: string) => { html: string }) | null = null;
      let indexTemplate: string | null = null;

      if (fs.existsSync(ssrBundlePath) && fs.existsSync(indexHtmlPath)) {
        try {
          ssrRender = _require(ssrBundlePath).render;
          indexTemplate = fs.readFileSync(indexHtmlPath, "utf-8");
          log("SSR bundle loaded — landing pages will be server-rendered");
        } catch (err) {
          console.warn("[SSR] Failed to load SSR bundle, falling back to SPA-only:", err);
        }
      } else {
        log("SSR bundle not found — run npm run build to enable SSR in production");
      }

      // SSR handler — runs before the SPA catch-all
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith("/api/")) return next();
        if (!SSR_ROUTES.has(req.path)) return next();
        if (!ssrRender || !indexTemplate) return next();

        try {
          const { html: appHtml } = ssrRender(req.originalUrl);
          const rendered = indexTemplate.replace("<!--ssr-outlet-->", appHtml);
          res
            .status(200)
            .set({ "Content-Type": "text/html", "Cache-Control": "no-cache" })
            .end(rendered);
        } catch (err) {
          console.warn(`[SSR] Render failed for ${req.path}, falling back to SPA:`, err);
          next();
        }
      });

      // SPA catch-all — handles all non-SSR, non-API routes
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith("/api/")) return next();
        // Never cache index.html so users always pick up the latest hashed
        // asset filenames after a redeploy.
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.sendFile(indexHtmlPath);
      });
    }
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();