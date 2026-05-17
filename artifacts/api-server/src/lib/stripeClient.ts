import Stripe from "stripe";

async function getCredentials(): Promise<{ publishableKey: string; secretKey: string; webhookSecret?: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  // ── Replit connector path (Replit-hosted environments) ───────────────────────
  if (hostname && xReplitToken) {
    const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
    const targetEnvironment = isProduction ? "production" : "development";

    const url = new URL(`https://${hostname}/api/v2/connection`);
    url.searchParams.set("include_secrets", "true");
    url.searchParams.set("connector_names", "stripe");
    url.searchParams.set("environment", targetEnvironment);

    const resp = await fetch(url.toString(), {
      headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json() as { items?: Array<{ settings?: { publishable?: string; secret?: string; webhook_secret?: string } }> };
    const settings = data.items?.[0]?.settings;

    if (!settings?.secret || !settings?.publishable) {
      throw new Error(
        `Stripe ${targetEnvironment} connection not found or missing keys — connect Stripe via the Integrations tab.`,
      );
    }

    return {
      publishableKey: settings.publishable,
      secretKey: settings.secret,
      webhookSecret: settings.webhook_secret,
    };
  }

  // ── Standard env var path (VPS / self-hosted environments) ──────────────────
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !publishableKey) {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY environment variables.",
    );
  }

  return { secretKey, publishableKey, webhookSecret };
}

// WARNING: Never cache this client. Always call to get a fresh client per request.
export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" });
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSync(): Promise<unknown> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL environment variable is required");

  // stripe-replit-sync is only available in Replit-hosted environments.
  // On VPS, this function is not supported — use standard Stripe webhooks instead.
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (!hostname) {
    throw new Error(
      "getStripeSync() requires a Replit environment. On VPS, handle Stripe events via webhooks directly.",
    );
  }

  const { secretKey, webhookSecret } = await getCredentials();
  const { StripeSync } = await import("stripe-replit-sync");
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
  });
}
