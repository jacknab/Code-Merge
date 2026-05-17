import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, websitesTable, purchasedSubdomainsTable } from "@workspace/db";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const RESERVED_SLUGS = [
  "www", "api", "admin", "app", "mail", "smtp", "ftp", "ns1", "ns2",
  "dev", "staging", "production", "support", "help", "blog", "status",
  "static", "assets", "cdn", "media", "img", "images",
];
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$|^[a-z0-9]{2,63}$/;

// ── List purchased subdomains for a storeid ───────────────────────────────────
router.get("/subdomains", async (req, res): Promise<void> => {
  const storeid = req.query.storeid as string | undefined;
  if (!storeid) {
    res.status(400).json({ error: "storeid is required" });
    return;
  }

  const rows = await db
    .select()
    .from(purchasedSubdomainsTable)
    .where(eq(purchasedSubdomainsTable.storeid, storeid));

  res.json(rows);
});

// ── Check if a subdomain is available ────────────────────────────────────────
router.get("/subdomains/check", async (req, res): Promise<void> => {
  const subdomain = (req.query.subdomain as string | undefined)?.toLowerCase().trim();
  if (!subdomain) { res.status(400).json({ error: "subdomain is required" }); return; }

  if (!SLUG_PATTERN.test(subdomain) || RESERVED_SLUGS.includes(subdomain)) {
    res.json({ available: false, subdomain, reason: "Invalid or reserved subdomain" });
    return;
  }

  const [existing] = await db
    .select({ id: purchasedSubdomainsTable.id })
    .from(purchasedSubdomainsTable)
    .where(eq(purchasedSubdomainsTable.subdomain, subdomain));

  const [existingWebsite] = await db
    .select({ id: websitesTable.id })
    .from(websitesTable)
    .where(eq(websitesTable.slug, subdomain));

  if (existing || existingWebsite) {
    res.json({ available: false, subdomain, reason: "Subdomain is already taken" });
    return;
  }

  res.json({ available: true, subdomain, reason: null });
});

// ── Purchase subdomain via Stripe Checkout ────────────────────────────────────
router.post("/subdomains/purchase", async (req, res): Promise<void> => {
  const { subdomain: rawSubdomain, storeid } = req.body as { subdomain?: string; storeid?: string };

  if (!rawSubdomain || !storeid) {
    res.status(400).json({ error: "subdomain and storeid are required" });
    return;
  }

  const subdomain = rawSubdomain.toLowerCase().trim();

  if (!SLUG_PATTERN.test(subdomain) || RESERVED_SLUGS.includes(subdomain)) {
    res.status(400).json({ error: "Invalid subdomain format" });
    return;
  }

  // Check availability
  const [existing] = await db
    .select({ id: purchasedSubdomainsTable.id })
    .from(purchasedSubdomainsTable)
    .where(eq(purchasedSubdomainsTable.subdomain, subdomain));

  const [existingWebsite] = await db
    .select({ id: websitesTable.id })
    .from(websitesTable)
    .where(eq(websitesTable.slug, subdomain));

  if (existing || existingWebsite) {
    res.status(400).json({ error: "Subdomain is already taken" });
    return;
  }

  let stripe;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    req.log.warn({ err }, "Stripe not connected — subdomain purchase unavailable");
    res.status(422).json({ error: "Payment system not configured. Contact support." });
    return;
  }

  // Find or create a "Additional Subdomain" product in Stripe
  let priceId: string;
  try {
    const products = await stripe.products.search({ query: "name:'Additional Subdomain' AND active:'true'" });
    let productId: string;

    if (products.data.length > 0) {
      productId = products.data[0].id;
      const prices = await stripe.prices.list({ product: productId, active: true, limit: 1 });
      if (prices.data.length > 0) {
        priceId = prices.data[0].id;
      } else {
        const price = await stripe.prices.create({
          product: productId,
          unit_amount: 1000,
          currency: "usd",
          recurring: { interval: "year" },
        });
        priceId = price.id;
      }
    } else {
      const product = await stripe.products.create({ name: "Additional Subdomain" });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 1000,
        currency: "usd",
        recurring: { interval: "year" },
      });
      priceId = price.id;
    }
  } catch (err) {
    req.log.error({ err }, "Failed to set up Stripe product/price for subdomain");
    res.status(500).json({ error: "Failed to configure payment" });
    return;
  }

  const domains = process.env.REPLIT_DOMAINS?.split(",") ?? [];
  const baseUrl = domains[0] ? `https://${domains[0]}` : "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { subdomain, storeid },
    success_url: `${baseUrl}/websites?subdomain_session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/websites`,
  });

  // Insert as pending
  await db.insert(purchasedSubdomainsTable).values({
    storeid,
    subdomain,
    stripeCheckoutSessionId: session.id,
    status: "pending_payment",
    expiresAt: null,
  });

  logger.info({ subdomain, storeid, sessionId: session.id }, "Subdomain checkout session created");
  res.json({ checkoutUrl: session.url, subdomain });
});

// ── Verify purchase and activate ──────────────────────────────────────────────
router.post("/subdomains/purchase/verify", async (req, res): Promise<void> => {
  const { sessionId, storeid } = req.body as { sessionId?: string; storeid?: string };

  if (!sessionId || !storeid) {
    res.status(400).json({ error: "sessionId and storeid are required" });
    return;
  }

  let stripe;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err) {
    res.status(422).json({ error: "Payment system not configured" });
    return;
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.payment_status !== "paid" && session.status !== "complete") {
    res.status(400).json({ error: "Payment not completed" });
    return;
  }

  const subdomain = session.metadata?.subdomain;
  if (!subdomain) {
    res.status(400).json({ error: "Invalid session — missing subdomain metadata" });
    return;
  }

  // Calculate expiry: 1 year from now
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const [updated] = await db
    .update(purchasedSubdomainsTable)
    .set({ status: "active", expiresAt })
    .where(
      and(
        eq(purchasedSubdomainsTable.stripeCheckoutSessionId, sessionId),
        eq(purchasedSubdomainsTable.storeid, storeid),
      )
    )
    .returning();

  if (!updated) {
    res.status(400).json({ error: "Subdomain record not found for this session" });
    return;
  }

  logger.info({ subdomain, storeid, sessionId }, "Subdomain activated after payment");
  res.json(updated);
});

// ── Assign a domain to a website ──────────────────────────────────────────────
router.post("/websites/:id/assign-domain", async (req, res): Promise<void> => {
  const id = parseInt((req.params as Record<string, string>).id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid website ID" }); return; }

  const { assignedSubdomain, storeid } = req.body as { assignedSubdomain?: string | null; storeid?: string };
  if (!storeid) { res.status(400).json({ error: "storeid is required" }); return; }

  const [website] = await db
    .select()
    .from(websitesTable)
    .where(eq(websitesTable.id, id));

  if (!website) { res.status(404).json({ error: "Website not found" }); return; }

  // null means "reset to own slug" — always allowed
  if (assignedSubdomain != null && assignedSubdomain !== "") {
    // Verify the storeid owns this purchased subdomain
    const [owned] = await db
      .select({ id: purchasedSubdomainsTable.id, status: purchasedSubdomainsTable.status })
      .from(purchasedSubdomainsTable)
      .where(
        and(
          eq(purchasedSubdomainsTable.subdomain, assignedSubdomain),
          eq(purchasedSubdomainsTable.storeid, storeid),
        )
      );

    if (!owned) {
      res.status(400).json({ error: "Subdomain not owned by this store" });
      return;
    }
    if (owned.status !== "active") {
      res.status(400).json({ error: "Subdomain is not active — payment may be pending" });
      return;
    }
  }

  const newAssigned = (assignedSubdomain == null || assignedSubdomain === "") ? null : assignedSubdomain;

  const [updated] = await db
    .update(websitesTable)
    .set({ assignedSubdomain: newAssigned })
    .where(eq(websitesTable.id, id))
    .returning();

  logger.info({ websiteId: id, assignedSubdomain: newAssigned }, "Domain assigned to website");
  res.json(updated);
});

export default router;
