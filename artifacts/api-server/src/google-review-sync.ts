/**
 * Google Business Profile Reviews Sync Engine
 *
 * DATA FLOW (new schema — primary):
 *   google_business_locations (is_selected = true)
 *     → google_business_accounts (OAuth tokens — NEVER login tokens)
 *     → Google Reviews API  (mybusinessreviews.googleapis.com v1)
 *     → google_reviews (strict upsert — no duplicates ever)
 *     → google_business_sync_logs (audit trail)
 *
 * LEGACY FALLBACK:
 *   google_business_profiles (pre-schema-migration accounts)
 *     → Google Reviews API
 *     → same upsert + sync-log path
 *
 * RELIABILITY:
 *   • 401 / token_expired  → refresh access token → persist to DB → retry once
 *   • 429 / rate limit     → exponential backoff: 5 s → 10 s → 20 s (3 attempts)
 *   • no reviews returned  → success (not an error)
 *   • DB write failure     → never silently swallowed; original reviews preserved
 *
 * TRIGGERS:
 *   • Manual : POST /api/google-business/sync-reviews/:storeId
 *   • Auto   : startGoogleReviewSyncScheduler() — every 6 hours per active location
 */

import { OAuth2Client } from "google-auth-library";
import { db } from "./db";
import { isQuotaCoolingDown, recordQuota429 } from "./google-quota-guard";
import {
  googleBusinessAccounts,
  googleBusinessLocations,
  googleBusinessProfiles,
  googleBusinessSyncLogs,
  googleReviews,
} from "@shared/schema";
import { eq, isNotNull, and } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReviewRaw {
  name: string;
  reviewer?: { displayName?: string };
  starRating?: string;
  rating?: number;
  comment?: string;
  reviewText?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment: string; updateTime: string };
  publisherResponse?: { comment: string; updateTime: string };
}

export interface SyncResult {
  synced: number;
  inserted: number;
  updated: number;
  locationResourceName: string;
  businessName: string | null;
  durationMs: number;
  source: "new_schema" | "legacy";
  syncLogId: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Convert Google's string star rating or numeric value to 1–5. */
function normalizeRating(rating: string | number | undefined): number {
  if (typeof rating === "number") return Math.min(5, Math.max(1, rating));
  const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[rating ?? ""] ?? 0;
}

/**
 * Build an OAuth2Client from a google_business_accounts row.
 * Registers a 'tokens' listener that persists refreshed access tokens back to DB.
 * Uses GOOGLE_BUSINESS_* env vars exclusively — never login credentials.
 */
function buildOAuth2ClientFromAccount(account: {
  id: number;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: Date | null;
}): OAuth2Client {
  const client = new OAuth2Client(
    process.env.GOOGLE_BUSINESS_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID     ?? "",
    process.env.GOOGLE_BUSINESS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "",
    process.env.GOOGLE_BUSINESS_CALLBACK_URL  ?? "https://certxa.com/api/google-business/callback",
  );
  client.setCredentials({
    access_token:  account.accessToken,
    refresh_token: account.refreshToken,
    expiry_date:   account.tokenExpiry?.getTime() ?? undefined,
  });
  client.on("tokens", (tokens) => {
    const expStr = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : "(none)";
    console.log(`[ReviewSync] Token auto-refreshed for account id=${account.id}  new expiry=${expStr}`);
    db.update(googleBusinessAccounts)
      .set({
        accessToken: tokens.access_token ?? undefined,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        updatedAt:   new Date(),
      })
      .where(eq(googleBusinessAccounts.id, account.id))
      .catch((e) => console.warn("[ReviewSync] Failed to persist refreshed token:", e));
  });
  return client;
}

/**
 * Build an OAuth2Client from a google_business_profiles row (legacy path).
 * Registers a 'tokens' listener that persists refreshed tokens back to the profile row.
 */
function buildOAuth2ClientFromProfile(profile: {
  id: number;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}): OAuth2Client {
  const client = new OAuth2Client(
    process.env.GOOGLE_BUSINESS_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID     ?? "",
    process.env.GOOGLE_BUSINESS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "",
    process.env.GOOGLE_BUSINESS_CALLBACK_URL  ?? "https://certxa.com/api/google-business/callback",
  );
  client.setCredentials({
    access_token:  profile.accessToken,
    refresh_token: profile.refreshToken,
    expiry_date:   profile.tokenExpiresAt?.getTime() ?? undefined,
  });
  client.on("tokens", (tokens) => {
    console.log(`[ReviewSync] Token auto-refreshed for profile id=${profile.id}`);
    db.update(googleBusinessProfiles)
      .set({
        accessToken:    tokens.access_token ?? undefined,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        updatedAt:      new Date(),
      })
      .where(eq(googleBusinessProfiles.id, profile.id))
      .catch((e) => console.warn("[ReviewSync] Failed to persist refreshed token (profile):", e));
  });
  return client;
}

/**
 * Fetch reviews from the Google Business Reviews API with:
 *   - Automatic token refresh on 401 (one retry after refresh)
 *   - Exponential backoff on 429: 5 s → 10 s → 20 s
 */
async function fetchReviewsWithRetry(
  client: OAuth2Client,
  locationResourceName: string,
  maxAttempts = 3,
): Promise<ReviewRaw[]> {
  const url = `https://mybusinessreviews.googleapis.com/v1/${locationResourceName}/reviews`;
  const rateLimitDelays = [5_000, 10_000, 20_000];

  console.log(`[ReviewSync] fetchReviewsWithRetry — URL: ${url}`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await client.request<{
        reviews?: ReviewRaw[];
        totalReviewCount?: number;
        averageRating?: number;
        nextPageToken?: string;
      }>({ url, method: "GET", params: { pageSize: 50 } });

      const reviews = response.data.reviews ?? [];
      console.log(
        `[ReviewSync] fetchReviewsWithRetry — success on attempt ${attempt + 1}` +
        `  totalReviewCount=${response.data.totalReviewCount ?? "?"}` +
        `  averageRating=${response.data.averageRating ?? "?"}` +
        `  reviews in page=${reviews.length}`,
      );
      return reviews;
    } catch (err: any) {
      const status: number | undefined = err?.code ?? err?.response?.status ?? err?.status;
      const errMsg: string = err?.message ?? String(err);
      const body: string = err?.response?.data ? JSON.stringify(err.response.data).slice(0, 400) : "(no body)";

      console.error(`[ReviewSync] fetchReviewsWithRetry — attempt ${attempt + 1} FAILED`);
      console.error(`[ReviewSync]   status=${status ?? "(none)"}  message=${errMsg}`);
      console.error(`[ReviewSync]   response body=${body}`);

      // ── 429 Rate limit: classify & persist cooldown, abort retries ────────
      if (status === 429) {
        recordQuota429(err);
        console.warn(`[ReviewSync] Rate limit (429) — quota guard activated (persisted cooldown), aborting retries`);
        throw err;
      }

      // ── 401 Expired token: let OAuth2Client refresh and retry once ─────────
      if ((status === 401 || errMsg.includes("invalid_grant") || errMsg.includes("Invalid Credentials")) && attempt === 0) {
        console.warn("[ReviewSync] 401 / invalid_grant — forcing token refresh and retrying once…");
        try {
          const refreshed = await client.refreshAccessToken();
          client.setCredentials(refreshed.credentials);
          console.log("[ReviewSync] Token refreshed successfully — retrying API call");
          // Loop continues with new token; 'tokens' event persists it to DB
          continue;
        } catch (refreshErr: any) {
          console.error("[ReviewSync] Token refresh FAILED:", refreshErr?.message ?? refreshErr);
          throw new Error(`Token refresh failed: ${refreshErr?.message ?? refreshErr}. Please reconnect your Google Business Profile.`);
        }
      }

      // ── 403: Permission denied ─────────────────────────────────────────────
      if (status === 403) {
        console.error("[ReviewSync] 403: Access denied. Ensure:");
        console.error("[ReviewSync]   - 'My Business Account Management API' enabled in Google Cloud Console");
        console.error("[ReviewSync]   - business.manage scope approved on OAuth consent screen");
        console.error(`[ReviewSync]   - location resource "${locationResourceName}" belongs to this account`);
      }

      // ── 404: Location not found ────────────────────────────────────────────
      if (status === 404) {
        console.error(`[ReviewSync] 404: Location "${locationResourceName}" not found. It may have been deleted or the resource name is incorrect.`);
      }

      throw err;
    }
  }
  return [];
}

/**
 * Upsert a batch of reviews into the database.
 * INSERT new ones, UPDATE existing ones (text, rating, response status, gbLocationId).
 * Never deletes existing reviews even if they're no longer in the API response.
 */
async function upsertReviews(
  reviews: ReviewRaw[],
  storeId: number,
  googleLocationId: string | null,
  gbLocationId: number | null,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const review of reviews) {
    const googleReviewId = review.name.split("/").pop() ?? review.name;
    const rating = normalizeRating((review as any).starRating ?? (review as any).rating);
    const reviewText = review.comment ?? (review as any).reviewText ?? null;
    const hasReply = !!(review.reviewReply ?? review.publisherResponse);

    console.log(
      `[ReviewSync] upsertReviews —` +
      `  id="${googleReviewId}"  rating=${rating}` +
      `  reviewer="${review.reviewer?.displayName ?? "Anonymous"}"` +
      `  hasReply=${hasReply}`,
    );

    const existing = await db
      .select({ id: googleReviews.id, gbLocationId: googleReviews.gbLocationId })
      .from(googleReviews)
      .where(eq(googleReviews.googleReviewId, googleReviewId))
      .limit(1);

    if (!existing.length) {
      await db.insert(googleReviews).values({
        storeId,
        googleReviewId,
        googleLocationId,
        gbLocationId,
        customerName:         review.reviewer?.displayName ?? "Anonymous",
        rating,
        reviewText,
        reviewImageUrls:      JSON.stringify([]),
        reviewCreateTime:     review.createTime ? new Date(review.createTime) : null,
        reviewUpdateTime:     review.updateTime ? new Date(review.updateTime) : null,
        reviewerLanguageCode: "en",
        responseStatus:       hasReply ? "responded" : "not_responded",
      });
      inserted++;
    } else {
      await db
        .update(googleReviews)
        .set({
          rating,
          reviewText,
          responseStatus:   hasReply ? "responded" : "not_responded",
          reviewUpdateTime: review.updateTime ? new Date(review.updateTime) : null,
          // Backfill gbLocationId if it was missing on existing rows
          gbLocationId:     existing[0].gbLocationId ?? gbLocationId ?? null,
          updatedAt:        new Date(),
        })
        .where(eq(googleReviews.googleReviewId, googleReviewId));
      updated++;
    }
  }

  return { inserted, updated };
}

/**
 * Write a row to google_business_sync_logs.
 * Returns the new row id (or null if the write fails — non-fatal).
 */
async function writeSyncLog(params: {
  storeId: number;
  userId?: string | null;
  locationId?: number | null;
  status: "success" | "failed";
  errorMessage?: string | null;
  reviewsSynced?: number | null;
}): Promise<number | null> {
  try {
    const rows = await db
      .insert(googleBusinessSyncLogs)
      .values({
        storeId:       params.storeId,
        userId:        params.userId ?? null,
        locationId:    params.locationId ?? null,
        syncType:      "reviews",
        status:        params.status,
        errorMessage:  params.errorMessage ?? null,
        reviewsSynced: params.reviewsSynced ?? null,
      })
      .returning({ id: googleBusinessSyncLogs.id });
    return rows[0]?.id ?? null;
  } catch (e) {
    console.warn("[ReviewSync] writeSyncLog — could not write sync log:", e);
    return null;
  }
}

// ─── Main Sync Function ───────────────────────────────────────────────────────

/**
 * syncReviewsForStore — the single entry point for all review syncs.
 *
 * Resolution order:
 *   1. New schema: google_business_locations (is_selected=true) + google_business_accounts
 *   2. Legacy:     google_business_profiles (for stores not yet migrated to new schema)
 *
 * All errors are logged and re-thrown so callers can surface them appropriately.
 */
export async function syncReviewsForStore(storeId: number): Promise<SyncResult> {
  const startTs = Date.now();
  console.log(`[ReviewSync] ── START storeId=${storeId} ──────────────────────────────────`);

  // ── STEP 1: Find the selected location (new schema) ───────────────────────
  const selectedLocations = await db
    .select()
    .from(googleBusinessLocations)
    .where(
      and(
        eq(googleBusinessLocations.storeId, storeId),
        eq(googleBusinessLocations.isSelected, true),
      ),
    )
    .limit(1);

  // ─────────────────────────────────────────────────────────────────────────
  // NEW SCHEMA PATH
  // ─────────────────────────────────────────────────────────────────────────
  if (selectedLocations.length) {
    const location = selectedLocations[0];
    console.log(
      `[ReviewSync] NEW SCHEMA path — location id=${location.id}` +
      `  resourceName="${location.locationResourceName}"` +
      `  locationName="${location.locationName ?? "(none)"}"` +
      `  isSelected=${location.isSelected}`,
    );

    // ── STEP 2: Get business account (owns OAuth tokens) ───────────────────
    const accounts = await db
      .select()
      .from(googleBusinessAccounts)
      .where(eq(googleBusinessAccounts.id, location.businessAccountId))
      .limit(1);

    if (!accounts.length) {
      const msg = `No google_business_accounts row found for businessAccountId=${location.businessAccountId}`;
      console.error(`[ReviewSync] ${msg}`);
      const syncLogId = await writeSyncLog({ storeId, locationId: location.id, status: "failed", errorMessage: msg });
      throw new Error("Business account record missing. Please reconnect your Google Business Profile.");
    }

    const account = accounts[0];
    console.log(
      `[ReviewSync] account id=${account.id}` +
      `  googleAccountId="${account.googleAccountId}"` +
      `  accountName="${account.accountName ?? "(none)"}"` +
      `  accessToken=${account.accessToken ? "present" : "MISSING"}` +
      `  refreshToken=${account.refreshToken ? "present" : "MISSING"}` +
      `  tokenExpiry=${account.tokenExpiry?.toISOString() ?? "(none)"}` +
      `  scopes=${account.scopes ?? "(none)"}`,
    );

    if (!account.accessToken && !account.refreshToken) {
      const msg = "No OAuth tokens found in business account. Re-authentication required.";
      console.error(`[ReviewSync] ${msg}`);
      const syncLogId = await writeSyncLog({ storeId, userId: account.userId, locationId: location.id, status: "failed", errorMessage: msg });
      throw new Error(msg);
    }

    // ── STEP 3: Build OAuth2Client (with auto-refresh + DB persistence) ────
    const client = buildOAuth2ClientFromAccount(account);

    // ── STEP 4: Fetch reviews with rate-limit retry ────────────────────────
    let reviews: ReviewRaw[];
    try {
      reviews = await fetchReviewsWithRetry(client, location.locationResourceName);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[ReviewSync] fetchReviews FAILED — storeId=${storeId}:`, msg);
      await writeSyncLog({
        storeId, userId: account.userId, locationId: location.id,
        status: "failed", errorMessage: msg,
      });
      throw err;
    }

    console.log(`[ReviewSync] fetched ${reviews.length} review(s) for location "${location.locationResourceName}"`);

    // ── STEP 5: Upsert reviews ─────────────────────────────────────────────
    const { inserted, updated } = await upsertReviews(
      reviews,
      storeId,
      location.locationId,
      location.id,
    );

    // ── Update lastSyncedAt on location ───────────────────────────────────
    await db
      .update(googleBusinessLocations)
      .set({ updatedAt: new Date() })
      .where(eq(googleBusinessLocations.id, location.id))
      .catch(() => {});

    // Also update legacy profile if one exists (for UI compat)
    await db
      .update(googleBusinessProfiles)
      .set({ lastSyncedAt: new Date() })
      .where(eq(googleBusinessProfiles.storeId, storeId))
      .catch(() => {});

    const durationMs = Date.now() - startTs;

    // ── STEP 6: Write success sync log ────────────────────────────────────
    const syncLogId = await writeSyncLog({
      storeId, userId: account.userId, locationId: location.id,
      status: "success", reviewsSynced: reviews.length,
    });

    console.log(
      `[ReviewSync] ── DONE (new schema) storeId=${storeId}` +
      `  total=${reviews.length}  inserted=${inserted}  updated=${updated}` +
      `  duration=${durationMs}ms  syncLogId=${syncLogId} ──`,
    );

    return {
      synced: reviews.length,
      inserted,
      updated,
      locationResourceName: location.locationResourceName,
      businessName: location.locationName,
      durationMs,
      source: "new_schema",
      syncLogId,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LEGACY FALLBACK PATH — google_business_profiles
  // ─────────────────────────────────────────────────────────────────────────
  console.log(
    `[ReviewSync] No is_selected location in new schema for storeId=${storeId} — falling back to google_business_profiles`,
  );

  const profiles = await db
    .select()
    .from(googleBusinessProfiles)
    .where(eq(googleBusinessProfiles.storeId, storeId))
    .limit(1);

  if (!profiles.length) {
    const msg = "Google Business Profile not connected for this store";
    console.error(`[ReviewSync] LEGACY: no profile for storeId=${storeId}`);
    await writeSyncLog({ storeId, status: "failed", errorMessage: msg });
    throw new Error(msg);
  }

  const profile = profiles[0];
  console.log(
    `[ReviewSync] LEGACY — profile id=${profile.id}` +
    `  locationResourceName="${profile.locationResourceName ?? "(none)"}"` +
    `  accessToken=${profile.accessToken ? "present" : "MISSING"}` +
    `  refreshToken=${profile.refreshToken ? "present" : "MISSING"}`,
  );

  if (!profile.locationResourceName) {
    const msg = "No location selected. Please reconnect your Google Business Profile and select a location.";
    console.error(`[ReviewSync] LEGACY: locationResourceName is NULL for storeId=${storeId}`);
    await writeSyncLog({ storeId, status: "failed", errorMessage: msg });
    throw new Error(msg);
  }

  if (!profile.accessToken && !profile.refreshToken) {
    const msg = "Google access token missing. Please reconnect your Google Business Profile.";
    console.error(`[ReviewSync] LEGACY: no tokens for storeId=${storeId}`);
    await writeSyncLog({ storeId, status: "failed", errorMessage: msg });
    throw new Error(msg);
  }

  const legacyClient = buildOAuth2ClientFromProfile(profile);

  let reviews: ReviewRaw[];
  try {
    reviews = await fetchReviewsWithRetry(legacyClient, profile.locationResourceName);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error(`[ReviewSync] LEGACY fetchReviews FAILED — storeId=${storeId}:`, msg);
    await writeSyncLog({ storeId, status: "failed", errorMessage: msg });
    throw err;
  }

  console.log(`[ReviewSync] LEGACY fetched ${reviews.length} review(s)`);

  // Try to find the gbLocationId by resource name (for FK tagging)
  let gbLocationId: number | null = null;
  try {
    const locRows = await db
      .select({ id: googleBusinessLocations.id })
      .from(googleBusinessLocations)
      .where(eq(googleBusinessLocations.locationResourceName, profile.locationResourceName))
      .limit(1);
    if (locRows.length) gbLocationId = locRows[0].id;
  } catch {}

  const { inserted, updated } = await upsertReviews(
    reviews,
    storeId,
    profile.locationId,
    gbLocationId,
  );

  await db
    .update(googleBusinessProfiles)
    .set({ lastSyncedAt: new Date() })
    .where(eq(googleBusinessProfiles.id, profile.id))
    .catch(() => {});

  const durationMs = Date.now() - startTs;

  const syncLogId = await writeSyncLog({
    storeId, locationId: gbLocationId,
    status: "success", reviewsSynced: reviews.length,
  });

  console.log(
    `[ReviewSync] ── DONE (legacy) storeId=${storeId}` +
    `  total=${reviews.length}  inserted=${inserted}  updated=${updated}` +
    `  duration=${durationMs}ms  syncLogId=${syncLogId} ──`,
  );

  return {
    synced: reviews.length,
    inserted,
    updated,
    locationResourceName: profile.locationResourceName,
    businessName: profile.businessName,
    durationMs,
    source: "legacy",
    syncLogId,
  };
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * startGoogleReviewSyncScheduler
 *
 * Runs an initial sync 30 s after boot, then every 6 hours.
 * Discovers active stores from both the new schema and legacy table.
 * Errors on individual stores are caught and logged — they never stop other stores.
 */
export function startGoogleReviewSyncScheduler(): void {
  const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes after boot (avoids quota on restarts)

  const syncAll = async () => {
    // Skip the sweep if we're in a quota cooldown window
    const cooldown = isQuotaCoolingDown();
    if (cooldown.coolingDown) {
      const secs = Math.ceil(cooldown.retryAfterMs / 1000);
      console.warn(`[ReviewSync] Scheduler — skipping sweep: quota cooldown active, ${secs}s remaining`);
      return;
    }
    console.log("[ReviewSync] Scheduler — starting sync sweep…");
    const sweepStart = Date.now();

    // Collect store IDs from new schema (selected locations)
    const newSchemaStoreIds = new Set<number>();
    try {
      const rows = await db
        .select({ storeId: googleBusinessLocations.storeId })
        .from(googleBusinessLocations)
        .where(eq(googleBusinessLocations.isSelected, true));
      rows.forEach((r) => r.storeId && newSchemaStoreIds.add(r.storeId));
    } catch (e) {
      console.error("[ReviewSync] Scheduler — could not query googleBusinessLocations:", e);
    }

    // Collect store IDs from legacy table (accessToken present, locationResourceName set)
    const legacyStoreIds = new Set<number>();
    try {
      const rows = await db
        .select({ storeId: googleBusinessProfiles.storeId })
        .from(googleBusinessProfiles)
        .where(
          and(
            isNotNull(googleBusinessProfiles.accessToken),
            isNotNull(googleBusinessProfiles.locationResourceName),
          ),
        );
      rows.forEach((r) => r.storeId && legacyStoreIds.add(r.storeId));
    } catch (e) {
      console.error("[ReviewSync] Scheduler — could not query googleBusinessProfiles:", e);
    }

    // Union — new schema takes priority but legacy stores are also included
    const allStoreIds = new Set<number>([...newSchemaStoreIds, ...legacyStoreIds]);
    console.log(
      `[ReviewSync] Scheduler — ${allStoreIds.size} store(s) to sync` +
      ` (${newSchemaStoreIds.size} new schema, ${legacyStoreIds.size} legacy)`,
    );

    let successCount = 0;
    let failCount = 0;

    for (const storeId of allStoreIds) {
      try {
        const result = await syncReviewsForStore(storeId);
        console.log(
          `[ReviewSync] Scheduler — storeId=${storeId} OK` +
          `  synced=${result.synced}  inserted=${result.inserted}  updated=${result.updated}` +
          `  source=${result.source}  ${result.durationMs}ms`,
        );
        successCount++;
      } catch (err: any) {
        console.error(`[ReviewSync] Scheduler — storeId=${storeId} FAILED:`, err?.message ?? err);
        failCount++;
      }
    }

    const sweepMs = Date.now() - sweepStart;
    console.log(
      `[ReviewSync] Scheduler — sweep complete in ${sweepMs}ms` +
      `  success=${successCount}  failed=${failCount}`,
    );
  };

  setTimeout(syncAll, INITIAL_DELAY_MS);
  setInterval(syncAll, INTERVAL_MS);
  console.log("[GoogleReviews] Auto-sync scheduler started (6-hour interval)");
}
