import { Router, type IRouter } from "express";
import { eq, and, sql, count, isNull, ne } from "drizzle-orm";
import { db, websitesTable, templatesTable } from "@workspace/db";
import {
  CheckSlugQueryParams,
  CreateWebsiteBody,
  GetWebsiteParams,
  UpdateWebsiteParams,
  UpdateWebsiteBody,
  DeleteWebsiteParams,
  PublishWebsiteParams,
  UnpublishWebsiteParams,
  ResolveTenantParams,
} from "@workspace/api-zod";
import { handleWebsitePreview, handleTenantSiteBySlug, handleTenantSiteByDomain } from "../lib/template-serve";
import { extractTextFields } from "../lib/content-extractor";
import { logger } from "../lib/logger";
import { findProjectDir, findDistDir } from "../lib/template-serve";
import { getUncachableStripeClient } from "../lib/stripeClient";
import fs from "fs";

const router: IRouter = Router();

const RESERVED_SLUGS = [
  "www", "api", "admin", "app", "mail", "smtp", "ftp", "ns1", "ns2",
  "dev", "staging", "production", "support", "help", "blog", "status",
  "static", "assets", "cdn", "media", "img", "images",
];

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$|^[a-z0-9]{2,63}$/;

function validateSlug(slug: string): { valid: boolean; reason?: string } {
  if (!slug) return { valid: false, reason: "Slug is required" };
  if (!SLUG_PATTERN.test(slug)) {
    return {
      valid: false,
      reason: "Slug must be 2-63 characters, lowercase letters, numbers, and hyphens only (no leading/trailing hyphens)",
    };
  }
  if (RESERVED_SLUGS.includes(slug)) {
    return { valid: false, reason: "This slug is reserved and cannot be used" };
  }
  return { valid: true };
}

router.get("/websites/check-slug", async (req, res): Promise<void> => {
  const parsed = CheckSlugQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { slug } = parsed.data;

  const validation = validateSlug(slug);
  if (!validation.valid) {
    res.json({ available: false, slug, reason: validation.reason ?? null });
    return;
  }

  const storeidForCheck = (req.query as Record<string, string>).storeid ?? null;

  const [existing] = await db
    .select({ id: websitesTable.id, storeid: websitesTable.storeid })
    .from(websitesTable)
    .where(eq(websitesTable.slug, slug));

  if (existing) {
    // If the slug belongs to the requesting store, it's reusable (same slug across multiple designs)
    if (storeidForCheck && existing.storeid === storeidForCheck) {
      res.json({ available: true, slug, reason: null });
      return;
    }
    res.json({ available: false, slug, reason: "This slug is already taken" });
    return;
  }

  res.json({ available: true, slug, reason: null });
});

router.get("/websites", async (req, res): Promise<void> => {
  const storeid = (req.query as Record<string, string>).storeid;
  const websites = storeid
    ? await db.select().from(websitesTable).where(eq(websitesTable.storeid, storeid)).orderBy(websitesTable.createdAt)
    : await db.select().from(websitesTable).orderBy(websitesTable.createdAt);
  res.json(websites);
});

router.post("/websites", async (req, res): Promise<void> => {
  const parsed = CreateWebsiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, slug, storeid, templateId, content } = parsed.data;

  const validation = validateSlug(slug);
  if (!validation.valid) {
    res.status(400).json({ error: validation.reason });
    return;
  }

  const [existing] = await db
    .select({ id: websitesTable.id, storeid: websitesTable.storeid })
    .from(websitesTable)
    .where(eq(websitesTable.slug, slug));

  if (existing) {
    // Allow the same store to reuse their slug across multiple template designs.
    // Only one will ever be published/live at a time, so there's no serving conflict.
    const slugBelongsToThisStore = storeid != null && existing.storeid === storeid;
    if (!slugBelongsToThisStore) {
      res.status(409).json({ error: "A website with this slug already exists" });
      return;
    }
  }

  // Enforce 5-website limit per storeid (or per null-storeid bucket)
  const storeScope = parsed.data.storeid ?? null;
  const [countRow] = await db
    .select({ total: count() })
    .from(websitesTable)
    .where(storeScope ? eq(websitesTable.storeid, storeScope) : isNull(websitesTable.storeid));

  if ((countRow?.total ?? 0) >= 5) {
    res.status(409).json({ error: "Website limit reached. You can create a maximum of 5 websites." });
    return;
  }

  const [website] = await db
    .insert(websitesTable)
    .values({
      name,
      slug,
      storeid: storeid ?? null,
      templateId: templateId ?? null,
      content: content ?? {},
      published: false,
    })
    .returning();

  res.status(201).json(website);
});

router.get("/websites/:id", async (req, res): Promise<void> => {
  const params = GetWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [website] = await db
    .select()
    .from(websitesTable)
    .where(eq(websitesTable.id, params.data.id));

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  res.json(website);
});

router.put("/websites/:id", async (req, res): Promise<void> => {
  const params = UpdateWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateWebsiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.content !== undefined) updateData.content = parsed.data.content;
  if (parsed.data.templateId !== undefined) updateData.templateId = parsed.data.templateId;
  if (parsed.data.storeid !== undefined) updateData.storeid = parsed.data.storeid;

  const [website] = await db
    .update(websitesTable)
    .set(updateData)
    .where(eq(websitesTable.id, params.data.id))
    .returning();

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  res.json(website);
});

router.delete("/websites/:id", async (req, res): Promise<void> => {
  const params = DeleteWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [website] = await db
    .delete(websitesTable)
    .where(eq(websitesTable.id, params.data.id))
    .returning();

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/websites/:id/publish", async (req, res): Promise<void> => {
  const params = PublishWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Fetch the target website first so we know its storeid
  const [target] = await db
    .select()
    .from(websitesTable)
    .where(eq(websitesTable.id, params.data.id));

  if (!target) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  // Auto-unpublish every other published site that shares the same storeid bucket
  // so only 1 live site exists per store at any time.
  if (target.storeid) {
    await db
      .update(websitesTable)
      .set({ published: false })
      .where(and(
        eq(websitesTable.storeid, target.storeid),
        eq(websitesTable.published, true),
        ne(websitesTable.id, params.data.id)
      ));
  } else {
    // No storeid — still enforce single-live among all null-storeid websites
    await db
      .update(websitesTable)
      .set({ published: false })
      .where(and(
        isNull(websitesTable.storeid),
        eq(websitesTable.published, true),
        ne(websitesTable.id, params.data.id)
      ));
  }

  // Now publish the requested site
  const [website] = await db
    .update(websitesTable)
    .set({ published: true, publishedAt: new Date() })
    .where(eq(websitesTable.id, params.data.id))
    .returning();

  logger.info({ websiteId: website.id, slug: website.slug, storeid: website.storeid }, "Website set as live");
  res.json(website);
});

router.post("/websites/:id/unpublish", async (req, res): Promise<void> => {
  const params = UnpublishWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [website] = await db
    .update(websitesTable)
    .set({ published: false })
    .where(eq(websitesTable.id, params.data.id))
    .returning();

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  res.json(website);
});

// ── Website preview: serve template with text replacements injected ────────────
router.get("/websites/:id/preview", handleWebsitePreview);
router.get("/websites/:id/preview/*splat", handleWebsitePreview);

// ── Extract content fields from template via Puppeteer ────────────────────────
router.post("/websites/:id/extract-content", async (req, res): Promise<void> => {
  const params = GetWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [website] = await db
    .select()
    .from(websitesTable)
    .where(eq(websitesTable.id, params.data.id));

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  if (!website.templateId) {
    res.status(422).json({ error: "No template assigned to this website" });
    return;
  }

  const [template] = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.id, website.templateId));

  if (!template || !template.filesPath || !fs.existsSync(template.filesPath)) {
    res.status(422).json({ error: "Template files not found on disk" });
    return;
  }

  const projectDir = findProjectDir(template.filesPath);
  const distDir = findDistDir(projectDir);

  if (!distDir) {
    res.status(422).json({ error: "Template not yet built — please wait for processing to complete" });
    return;
  }

  try {
    const fields = await extractTextFields(distDir, template.id);
    const content = { ...(website.content as object), fields };

    const [updated] = await db
      .update(websitesTable)
      .set({ content })
      .where(eq(websitesTable.id, params.data.id))
      .returning();

    logger.info({ websiteId: params.data.id, fieldCount: fields.length }, "Content fields extracted");
    res.json(updated);
  } catch (err) {
    logger.error({ err, websiteId: params.data.id }, "Content extraction failed");
    res.status(500).json({ error: "Failed to extract content from template" });
  }
});

// ── Custom Domain: save intent + generate verification token ──────────────────
router.post("/websites/:id/custom-domain/init", async (req, res): Promise<void> => {
  const params = GetWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { domain } = req.body as { domain?: string };
  if (!domain || domain.trim().length < 3) {
    res.status(400).json({ error: "A valid domain name is required" });
    return;
  }

  // Strip protocol + www so only bare hostname is stored
  const cleanDomain = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0];

  const [website] = await db.select().from(websitesTable).where(eq(websitesTable.id, params.data.id));
  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  // Reuse existing token if the same domain is already stored; generate a new one otherwise
  const existingToken =
    website.customDomain === cleanDomain && website.customDomainToken
      ? website.customDomainToken
      : crypto.randomUUID().replace(/-/g, "");

  await db
    .update(websitesTable)
    .set({
      customDomain: cleanDomain,
      customDomainStatus: "pending_dns",
      customDomainToken: existingToken,
    })
    .where(eq(websitesTable.id, params.data.id));

  logger.info({ websiteId: params.data.id, customDomain: cleanDomain }, "Custom domain intent saved");
  res.json({ domain: cleanDomain, token: existingToken });
});

// ── Custom Domain: verify DNS + HTTP ownership ────────────────────────────────
router.get("/websites/:id/custom-domain/verify", async (req, res): Promise<void> => {
  const params = GetWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [website] = await db.select().from(websitesTable).where(eq(websitesTable.id, params.data.id));
  if (!website || !website.customDomain || !website.customDomainToken) {
    res.status(404).json({ error: "No custom domain configured" });
    return;
  }

  const domain = website.customDomain;
  const token = website.customDomainToken;
  const VPS_IP = "216.128.140.207";

  // DNS check — resolve A record and confirm it points to our VPS
  let dnsOk = false;
  try {
    const { promises: dns } = await import("dns");
    const addresses = await dns.resolve4(domain);
    dnsOk = addresses.includes(VPS_IP);
  } catch {
    dnsOk = false;
  }

  // HTTP check — fetch the domain root and look for the verification token in the page
  let httpOk = false;
  if (dnsOk) {
    try {
      const resp = await fetch(`http://${domain}/`, {
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "CertXA-Verify/1.0" },
      });
      const body = await resp.text();
      httpOk = body.includes(token);
    } catch {
      httpOk = false;
    }
  }

  res.json({ dnsOk, httpOk, domain });
});

// ── Custom Domain: create Stripe Checkout session ─────────────────────────────
router.post("/websites/:id/custom-domain/checkout", async (req, res): Promise<void> => {
  const params = GetWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { domain } = req.body as { domain?: string };
  if (!domain || domain.trim().length < 3) {
    res.status(400).json({ error: "A valid domain name is required" });
    return;
  }
  const cleanDomain = domain.trim().toLowerCase();

  const [website] = await db
    .select()
    .from(websitesTable)
    .where(eq(websitesTable.id, params.data.id));

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  // If domain is already active, just confirm
  if (website.customDomainStatus === "active" && website.customDomain === cleanDomain) {
    res.status(200).json({ checkoutUrl: null, domain: cleanDomain, alreadyActive: true });
    return;
  }

  let stripe;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    req.log.warn({ err }, "Stripe not connected — BYOD checkout unavailable");
    res.status(422).json({ error: "Payment processing is not configured. Please connect Stripe via the Integrations tab." });
    return;
  }

  // Find the BYOD price — first try env var, then search Stripe
  let priceId = process.env.BYOD_PRICE_ID ?? "";
  if (!priceId) {
    const products = await stripe.products.search({ query: "name:'Custom Domain' AND active:'true'" });
    if (products.data.length > 0) {
      const prices = await stripe.prices.list({ product: products.data[0].id, active: true, limit: 1 });
      priceId = prices.data[0]?.id ?? "";
    }
  }

  if (!priceId) {
    res.status(422).json({ error: "Custom domain product not set up. Run: pnpm --filter @workspace/scripts run seed-byod-product" });
    return;
  }

  // Determine the success/cancel URLs
  const host = req.get("host") ?? "";
  const protocol = req.headers["x-forwarded-proto"] ?? req.protocol;
  const baseUrl = `${protocol}://${host}`;
  const successUrl = `${baseUrl}/api/websites/${params.data.id}/custom-domain/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${baseUrl}/websites/${params.data.id}/edit`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      websiteId: String(params.data.id),
      customDomain: cleanDomain,
    },
    subscription_data: {
      metadata: {
        websiteId: String(params.data.id),
        customDomain: cleanDomain,
      },
    },
  });

  // Persist the domain + session ID so the webhook/success route can activate it
  await db
    .update(websitesTable)
    .set({
      customDomain: cleanDomain,
      customDomainStatus: "pending_payment",
      stripeCheckoutSessionId: session.id,
    })
    .where(eq(websitesTable.id, params.data.id));

  logger.info({ websiteId: params.data.id, customDomain: cleanDomain, sessionId: session.id }, "Custom domain checkout session created");
  res.json({ checkoutUrl: session.url, domain: cleanDomain });
});

// ── Custom Domain: Stripe success redirect ────────────────────────────────────
router.get("/websites/:id/custom-domain/success", async (req, res): Promise<void> => {
  const params = GetWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.redirect(`/websites`);
    return;
  }

  const sessionId = (req.query as Record<string, string>).session_id;
  if (!sessionId) {
    res.redirect(`/websites/${params.data.id}/edit`);
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      const customDomain = session.metadata?.customDomain;
      await db
        .update(websitesTable)
        .set({ customDomainStatus: "active", stripeCheckoutSessionId: sessionId, ...(customDomain ? { customDomain } : {}) })
        .where(eq(websitesTable.id, params.data.id));

      logger.info({ websiteId: params.data.id, customDomain }, "Custom domain activated via success redirect");
    }
  } catch (err) {
    logger.warn({ err }, "Could not verify Stripe session on success redirect");
  }

  // Always redirect back to the editor — the UI will reflect the new status
  res.redirect(`/websites/${params.data.id}/edit?domain_activated=true`);
});

// ── Custom Domain: activate (no payment required — included in subscription) ──
router.post("/websites/:id/custom-domain/activate", async (req, res): Promise<void> => {
  const params = GetWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [website] = await db.select().from(websitesTable).where(eq(websitesTable.id, params.data.id));
  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  if (!website.customDomain) {
    res.status(400).json({ error: "No custom domain configured" });
    return;
  }

  await db
    .update(websitesTable)
    .set({ customDomainStatus: "active" })
    .where(eq(websitesTable.id, params.data.id));

  logger.info({ websiteId: params.data.id, customDomain: website.customDomain }, "Custom domain activated (no payment)");
  res.json({ success: true, domain: website.customDomain });
});

// ── Remove custom domain ──────────────────────────────────────────────────────
router.delete("/websites/:id/custom-domain", async (req, res): Promise<void> => {
  const params = GetWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [website] = await db
    .select({ id: websitesTable.id, customDomain: websitesTable.customDomain })
    .from(websitesTable)
    .where(eq(websitesTable.id, params.data.id));

  if (!website) {
    res.status(404).json({ error: "Website not found" });
    return;
  }

  await db
    .update(websitesTable)
    .set({ customDomain: null, customDomainStatus: null, customDomainToken: null })
    .where(eq(websitesTable.id, params.data.id));

  logger.info({ websiteId: params.data.id, removedDomain: website.customDomain }, "Custom domain removed");
  res.json({ success: true });
});

// ── Tenant data API (for data-aware templates) ────────────────────────────────
// Returns live business data from the platform DB for a given website slug.
// Queries platform tables (locations, services, staff, etc.) with per-query
// try/catch — returns empty arrays gracefully if tables don't exist yet.
router.get("/tenant/:slug/data", async (req, res): Promise<void> => {
  const slug = (req.params as Record<string, string>).slug;
  if (!slug) { res.status(400).json({ error: "Missing slug" }); return; }

  const [website] = await db
    .select()
    .from(websitesTable)
    .where(eq(websitesTable.slug, slug));

  if (!website) { res.status(404).json({ error: "Website not found" }); return; }

  const storeid = website.storeid;
  let business: Record<string, unknown> | null = null;
  let hours: Record<string, unknown>[] = [];
  let services: Record<string, unknown>[] = [];
  let serviceCategories: Record<string, unknown>[] = [];
  let staff: Record<string, unknown>[] = [];
  let reviews: Record<string, unknown>[] = [];

  if (storeid) {
    try {
      const r = await db.execute(sql`
        SELECT id, name, address, phone, email, city, state, postcode, booking_slug, category
        FROM locations WHERE id = ${storeid} LIMIT 1`);
      if (r.rows.length > 0) business = r.rows[0] as Record<string, unknown>;
    } catch { /* platform table may not exist in this environment */ }

    try {
      const r = await db.execute(sql`
        SELECT day_of_week, open_time, close_time, is_closed
        FROM business_hours WHERE store_id = ${storeid} ORDER BY day_of_week`);
      hours = r.rows as Record<string, unknown>[];
    } catch { /* platform table may not exist */ }

    try {
      const r = await db.execute(sql`
        SELECT id, name FROM service_categories
        WHERE store_id = ${storeid} ORDER BY sort_order NULLS LAST, id`);
      serviceCategories = r.rows as Record<string, unknown>[];
    } catch { /* platform table may not exist */ }

    try {
      const r = await db.execute(sql`
        SELECT id, name, price, duration, category_id FROM services
        WHERE store_id = ${storeid} ORDER BY category_id NULLS LAST, id`);
      services = r.rows as Record<string, unknown>[];
    } catch { /* platform table may not exist */ }

    try {
      const r = await db.execute(sql`
        SELECT id, name, role, avatar_url, bio FROM staff
        WHERE store_id = ${storeid} AND status = 'active' ORDER BY id LIMIT 12`);
      staff = r.rows as Record<string, unknown>[];
    } catch { /* platform table may not exist */ }

    try {
      const r = await db.execute(sql`
        SELECT customer_name, rating, review_text AS comment, review_create_time AS created_at
        FROM google_reviews
        WHERE store_id = ${storeid} AND rating >= 4
        ORDER BY review_create_time DESC LIMIT 10`);
      reviews = r.rows as Record<string, unknown>[];
    } catch {
      try {
        const r = await db.execute(sql`
          SELECT customer_name, rating, comment, created_at FROM reviews
          WHERE store_id = ${storeid} AND is_public = true
          ORDER BY created_at DESC LIMIT 10`);
        reviews = r.rows as Record<string, unknown>[];
      } catch { /* platform table may not exist */ }
    }
  }

  logger.info({ slug, storeid, hasData: !!business }, "Tenant data fetched");
  res.json({ website: { id: website.id, name: website.name, slug: website.slug }, business, hours, services, serviceCategories, staff, reviews });
});

// ── Tenant site serving by slug (for Nginx subdomain routing) ────────────────
// Nginx rewrites *.mysalon.me/* → /api/tenant/:slug/site/*
// These routes serve the full compiled template with content injection.
router.get("/tenant/:slug/site", handleTenantSiteBySlug);
router.get("/tenant/:slug/site/*splat", handleTenantSiteBySlug);

// ── Tenant site serving by custom domain (for BYOD routing) ──────────────────
// Nginx catch-all for custom domains proxies here with the original Host header.
// The handler looks up the website by custom_domain + status='active'.
router.get("/domain-site", handleTenantSiteByDomain);
router.get("/domain-site/*splat", handleTenantSiteByDomain);

// ── Tenant JSON resolver (SPA data fetching) ──────────────────────────────────
router.get("/tenant/:slug", async (req, res): Promise<void> => {
  const params = ResolveTenantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [website] = await db
    .select()
    .from(websitesTable)
    .where(and(eq(websitesTable.slug, params.data.slug), eq(websitesTable.published, true)));

  if (!website) {
    res.status(404).json({ error: "Tenant not found or not published" });
    return;
  }

  let template = null;
  if (website.templateId) {
    const [tmpl] = await db
      .select()
      .from(templatesTable)
      .where(eq(templatesTable.id, website.templateId));
    template = tmpl ?? null;
  }

  res.json({ website, template });
});

export default router;
