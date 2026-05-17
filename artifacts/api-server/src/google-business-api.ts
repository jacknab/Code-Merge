import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { db } from "./db";
import { recordQuota429, isQuotaCoolingDown } from "./google-quota-guard";
import {
  googleBusinessProfiles,
  googleBusinessAccounts,
  googleBusinessLocations,
  googleBusinessSyncLogs,
  googleReviews,
  googleReviewResponses,
} from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Returns the correct Google Business OAuth redirect URI for the current environment.
 *
 * Priority:
 *  1. GOOGLE_BUSINESS_CALLBACK_URL — explicitly configured (all environments)
 *  2. REPLIT_DEV_DOMAIN             — auto-derived from Replit's dev proxy domain
 *  3. Production certxa.com fallback
 */
export function getGoogleBusinessCallbackUrl(): string {
  if (process.env.GOOGLE_BUSINESS_CALLBACK_URL) {
    return process.env.GOOGLE_BUSINESS_CALLBACK_URL;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/google-business/callback`;
  }
  return "https://certxa.com/api/google-business/callback";
}

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleReviewData {
  name: string;
  reviewer: {
    displayName: string;
    profilePhotoUrl?: string;
  };
  starRating?: string; // "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE"
  rating?: number;
  comment?: string;
  reviewText?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
  publisherResponse?: {
    comment: string;
    updateTime: string;
  };
}

/** Convert "FIVE" / 5 to numeric 5 */
function normalizeStarRating(rating: string | number | undefined): number {
  if (typeof rating === "number") return Math.min(5, Math.max(1, rating));
  const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[rating ?? ""] ?? 0;
}

export class GoogleBusinessAPIManager {
  private oauth2Client: OAuth2Client;

  constructor(config: GoogleAuthConfig) {
    this.oauth2Client = new OAuth2Client(
      config.clientId,
      config.clientSecret,
      config.redirectUri,
    );
  }

  /**
   * Generate the Google OAuth consent URL.
   * Scope: business.manage ONLY — never mixes login scopes.
   * include_granted_scopes is intentionally false to prevent scope bleed
   * from any other OAuth session the user may have.
   */
  getAuthUrl(
    scopes: string[] = ["https://www.googleapis.com/auth/business.manage"],
    state?: string,
  ): string {
    console.log("[Google Business OAuth] getAuthUrl — scopes:", scopes.join(", "));
    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",             // always show consent to get a fresh refresh_token
      include_granted_scopes: false, // do NOT merge with previously granted scopes
      state,
    });
  }

  /** Exchange an authorization code for access + refresh tokens. */
  async getTokensFromCode(code: string) {
    console.log("[Google Business OAuth] getTokensFromCode — exchanging authorization code…");
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    console.log("[Google Business OAuth] getTokensFromCode — access_token:", tokens.access_token ? "(obtained)" : "(MISSING)");
    console.log("[Google Business OAuth] getTokensFromCode — refresh_token:", tokens.refresh_token ? "(obtained)" : "(none — may need prompt=consent)");
    console.log("[Google Business OAuth] getTokensFromCode — scope:", tokens.scope ?? "(none)");
    console.log("[Google Business OAuth] getTokensFromCode — expiry:", tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : "(none)");
    return tokens;
  }

  /** Set stored credentials — used when rehydrating from the database. */
  setCredentials(tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  }) {
    this.oauth2Client.setCredentials(tokens);
  }

  /**
   * Register a callback that fires whenever the OAuth2Client auto-refreshes
   * the access token. Use this to persist the new token back to the database.
   */
  onTokenRefresh(
    callback: (tokens: { access_token?: string | null; expiry_date?: number | null }) => Promise<void>,
  ): void {
    this.oauth2Client.on("tokens", (tokens) => {
      console.log("[Google Business OAuth] Token auto-refreshed by OAuth2Client");
      console.log("[Google Business OAuth]   new access_token:", tokens.access_token ? "(present)" : "(missing)");
      console.log("[Google Business OAuth]   new expiry:", tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : "(none)");
      callback(tokens).catch((err) =>
        console.error("[Google Business OAuth] Failed to persist refreshed token to DB:", err),
      );
    });
  }

  /**
   * Attempt to fetch the Google account email from the userinfo endpoint.
   * This requires openid/email scope. With business.manage-only tokens it will
   * fail — that is expected and handled gracefully (returns null).
   */
  async getGoogleUserInfo(): Promise<{ email: string; name: string } | null> {
    try {
      const oauth2 = google.oauth2({ version: "v2", auth: this.oauth2Client });
      const { data } = await oauth2.userinfo.get();
      console.log("[Google Business OAuth] getGoogleUserInfo — email:", data.email ?? "(none)");
      return { email: data.email ?? "", name: data.name ?? "" };
    } catch (error: any) {
      const status = error?.code ?? error?.response?.status ?? error?.status;
      // 403 is expected when the token only has business.manage scope (no openid/email scope)
      console.warn(
        `[Google Business OAuth] getGoogleUserInfo — skipped (status ${status ?? "unknown"}). ` +
        "This is expected with business.manage-only tokens. googleAccountEmail will be stored as null.",
      );
      return null;
    }
  }

  /**
   * List Google Business accounts for the authenticated user.
   * API: mybusinessaccountmanagement v1 — accounts.list
   *
   * Retries on 429 with exponential backoff: 5 s → 10 s → 20 s (3 attempts total).
   */
  async getBusinessAccounts(maxAttempts = 3): Promise<any> {
    // Respect global quota cooldown — don't even attempt if we're cooling down
    const cooldown = isQuotaCoolingDown();
    if (cooldown.coolingDown) {
      const secs = Math.ceil(cooldown.retryAfterMs / 1000);
      console.warn(`[Google Business OAuth] getBusinessAccounts — skipped: quota cooldown active, ${secs}s remaining`);
      const err: any = new Error(`Google API quota cooldown active. Please wait ${secs} seconds before retrying.`);
      err.code = 429;
      err.quotaCooldown = true;
      err.retryAfterMs = cooldown.retryAfterMs;
      throw err;
    }

    console.log("[Google Business OAuth] getBusinessAccounts — calling mybusinessaccountmanagement v1 accounts.list");
    const service = google.mybusinessaccountmanagement({ version: "v1", auth: this.oauth2Client });

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await service.accounts.list({});
        const data = response.data;
        const accounts: any[] = data.accounts ?? [];
        console.log(`[Google Business OAuth] getBusinessAccounts — accounts found: ${accounts.length}`);
        accounts.forEach((a: any, i: number) => {
          console.log(
            `[Google Business OAuth]   [${i}] name="${a.name}"` +
            `  accountName="${a.accountName ?? "(none)"}` +
            `  type="${a.type ?? "(none)"}"`,
          );
        });
        if (accounts.length === 0) {
          console.warn(
            "[Google Business OAuth] getBusinessAccounts — ZERO accounts returned. " +
            "The user needs to create a Business Profile at business.google.com.",
          );
        }
        return data;
      } catch (error: any) {
        // Re-throw cooldown errors immediately without retrying
        if (error?.quotaCooldown) throw error;

        const status = error?.code ?? error?.response?.status ?? error?.status;
        const msg = error?.message ?? String(error);
        const body = error?.response?.data ? JSON.stringify(error.response.data).slice(0, 400) : "(no body)";
        console.error(`[Google Business OAuth] getBusinessAccounts FAILED — attempt ${attempt + 1}/${maxAttempts} — status: ${status}  message: ${msg}`);
        console.error(`[Google Business OAuth] getBusinessAccounts FAILED — response body: ${body}`);

        if (status === 429) {
          // Record in the quota guard — classifies & persists cooldown to disk
          recordQuota429(error);
          if (attempt < maxAttempts - 1) {
            // One short wait then let the guard block further attempts
            console.warn(`[Google Business OAuth] getBusinessAccounts — 429 quota exceeded, waiting 3s before attempt ${attempt + 2}/${maxAttempts}`);
            await new Promise<void>((r) => setTimeout(r, 3_000));
            continue;
          }
        }
        if (status === 403) {
          console.error(
            "[Google Business OAuth] 403: Ensure 'My Business Account Management API' is enabled " +
            "in Google Cloud Console and the business.manage scope is on the OAuth consent screen.",
          );
        }
        throw error;
      }
    }
    return { accounts: [] };
  }

  /**
   * List locations for a given business account.
   * API: mybusinessbusinessinformation v1 — accounts.locations.list
   *
   * Retries on 429 with exponential backoff: 5 s → 10 s → 20 s (3 attempts total).
   */
  async getLocations(accountName: string, maxAttempts = 3): Promise<any> {
    console.log(`[Google Business OAuth] getLocations — account: ${accountName}`);
    const service = google.mybusinessbusinessinformation({ version: "v1", auth: this.oauth2Client });
    const rateLimitDelays = [5_000, 10_000, 20_000];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await service.accounts.locations.list({
          parent: accountName,
          readMask: "name,title,storeCode,storefrontAddress,phoneNumbers,websiteUri",
        } as any);
        const data = response.data;
        const locs: any[] = data.locations ?? [];
        console.log(`[Google Business OAuth] getLocations — raw response (first 500 chars): ${JSON.stringify(data).slice(0, 500)}`);
        console.log(`[Google Business OAuth] getLocations — locations found: ${locs.length}`);
        locs.forEach((l: any, i: number) => {
          console.log(
            `[Google Business OAuth]   [${i}] name="${l.name}"` +
            `  title="${l.title ?? "(none)"}"` +
            `  storeCode="${l.storeCode ?? "(none)"}"`,
          );
          if (l.storefrontAddress) {
            console.log(`[Google Business OAuth]       address: ${JSON.stringify(l.storefrontAddress)}`);
          }
        });
        if (locs.length === 0) {
          console.warn(
            `[Google Business OAuth] getLocations — ZERO locations returned for account ${accountName}. ` +
            "The account may have no verified locations in Google Business Profile.",
          );
        }
        return data;
      } catch (error: any) {
        const status = error?.code ?? error?.response?.status ?? error?.status;
        const msg = error?.message ?? String(error);
        console.error(`[Google Business OAuth] getLocations FAILED — attempt ${attempt + 1}/${maxAttempts} — status: ${status}  message: ${msg}`);

        if (status === 429 && attempt < maxAttempts - 1) {
          const delay = rateLimitDelays[attempt] ?? 20_000;
          console.warn(`[Google Business OAuth] getLocations — 429 quota exceeded, waiting ${delay}ms before retry ${attempt + 2}/${maxAttempts}`);
          await new Promise<void>((r) => setTimeout(r, delay));
          continue;
        }
        if (status === 403) {
          console.error("[Google Business OAuth] 403: Ensure 'Business Profile API' is enabled in Google Cloud Console and the business.manage scope is approved.");
        }
        if (status === 404) {
          console.error(`[Google Business OAuth] 404: Account "${accountName}" not found or this token does not have access to it.`);
        }
        throw error;
      }
    }
    return { locations: [] };
  }

  /**
   * Get reviews for a specific location.
   * Uses direct HTTP to mybusinessreviews.googleapis.com v1 (not bundled in googleapis npm).
   */
  async getReviews(locationName: string): Promise<GoogleReviewData[]> {
    const url = `https://mybusinessreviews.googleapis.com/v1/${locationName}/reviews`;
    console.log(`[Google Business OAuth] getReviews — location: ${locationName}`);
    console.log(`[Google Business OAuth] getReviews — URL: ${url}`);
    try {
      const response = await this.oauth2Client.request<{
        reviews?: GoogleReviewData[];
        totalReviewCount?: number;
        averageRating?: number;
        nextPageToken?: string;
      }>({
        url,
        method: "GET",
        params: { pageSize: 50 },
      });
      const reviews = response.data.reviews ?? [];
      console.log(`[Google Business OAuth] getReviews — totalReviewCount: ${response.data.totalReviewCount ?? "(not returned)"}`);
      console.log(`[Google Business OAuth] getReviews — averageRating: ${response.data.averageRating ?? "(not returned)"}`);
      console.log(`[Google Business OAuth] getReviews — reviews in this page: ${reviews.length}`);
      if (reviews.length === 0) {
        console.warn(
          `[Google Business OAuth] getReviews — ZERO reviews for location "${locationName}". ` +
          "The location may have no reviews, or the API scope does not include review access.",
        );
        console.warn(`[Google Business OAuth] getReviews — full response: ${JSON.stringify(response.data).slice(0, 300)}`);
      } else {
        reviews.slice(0, 3).forEach((r: any, i: number) => {
          console.log(
            `[Google Business OAuth]   [${i}] reviewId="${r.name}"` +
            `  rating="${r.starRating ?? r.rating}"` +
            `  reviewer="${r.reviewer?.displayName ?? "(none)"}"`,
          );
        });
      }
      return reviews;
    } catch (error: any) {
      const status = error?.code ?? error?.response?.status ?? error?.status;
      const msg = error?.message ?? String(error);
      const body = error?.response?.data ? JSON.stringify(error.response.data).slice(0, 400) : "(no body)";
      console.error(`[Google Business OAuth] getReviews FAILED — location: ${locationName}`);
      console.error(`[Google Business OAuth] getReviews FAILED — status: ${status}  message: ${msg}`);
      console.error(`[Google Business OAuth] getReviews FAILED — response body: ${body}`);
      if (status === 403) {
        console.error("[Google Business OAuth] 403: The location may not belong to this account, or business.manage scope is insufficient for reviews.");
      }
      if (status === 404) {
        console.error(
          `[Google Business OAuth] 404: Location resource "${locationName}" not found. ` +
          "Verify it matches exactly what getLocations returned (e.g. accounts/123/locations/456).",
        );
      }
      throw error;
    }
  }

  /**
   * Post or update a reply to a review.
   * PUT https://mybusinessreviews.googleapis.com/v1/{reviewName}/reply
   */
  async replyToReview(reviewName: string, comment: string): Promise<any> {
    console.log(`[Google Business OAuth] replyToReview — reviewName: ${reviewName}`);
    try {
      const response = await this.oauth2Client.request({
        url: `https://mybusinessreviews.googleapis.com/v1/${reviewName}/reply`,
        method: "PUT",
        data: { comment },
      });
      console.log(`[Google Business OAuth] replyToReview — success`);
      return response.data;
    } catch (error) {
      console.error("[Google Business OAuth] replyToReview FAILED:", error);
      throw error;
    }
  }

  /**
   * Delete an existing reply from a review.
   * DELETE https://mybusinessreviews.googleapis.com/v1/{reviewName}/reply
   */
  async deleteReviewReply(reviewName: string): Promise<any> {
    console.log(`[Google Business OAuth] deleteReviewReply — reviewName: ${reviewName}`);
    try {
      const response = await this.oauth2Client.request({
        url: `https://mybusinessreviews.googleapis.com/v1/${reviewName}/reply`,
        method: "DELETE",
      });
      return response.data;
    } catch (error) {
      console.error("[Google Business OAuth] deleteReviewReply FAILED:", error);
      throw error;
    }
  }

  /**
   * Revoke the stored OAuth access token at Google.
   * Called on disconnect — errors are swallowed so local cleanup still proceeds.
   */
  async revokeTokens(): Promise<void> {
    try {
      const accessToken = this.oauth2Client.credentials.access_token;
      if (accessToken) {
        await this.oauth2Client.revokeToken(accessToken);
        console.log("[Google Business OAuth] Token revoked at Google");
      }
    } catch (error) {
      console.warn("[Google Business OAuth] Could not revoke token (may already be expired):", error);
    }
  }
}

/**
 * Build an authenticated GoogleBusinessAPIManager from a stored profile row.
 *
 * Credentials: GOOGLE_BUSINESS_* env vars ONLY (falls back to legacy GOOGLE_CLIENT_* if not set).
 * Token refresh: hooks up an event listener that persists refreshed tokens to the DB automatically,
 * so the stored token stays valid across server restarts without re-authenticating.
 */
export function createApiManagerFromProfile(profile: {
  id: number;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}): GoogleBusinessAPIManager {
  const manager = new GoogleBusinessAPIManager({
    clientId:     process.env.GOOGLE_BUSINESS_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID     ?? "",
    clientSecret: process.env.GOOGLE_BUSINESS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:  process.env.GOOGLE_BUSINESS_CALLBACK_URL ?? "https://certxa.com/api/google-business/callback",
  });

  manager.setCredentials({
    access_token:  profile.accessToken,
    refresh_token: profile.refreshToken,
    expiry_date:   profile.tokenExpiresAt?.getTime() ?? null,
  });

  // Persist auto-refreshed tokens back to the DB so they survive server restarts
  manager.onTokenRefresh(async (newTokens) => {
    console.log(`[Google Business OAuth] Persisting refreshed token for profile id=${profile.id}`);
    await db
      .update(googleBusinessProfiles)
      .set({
        accessToken:    newTokens.access_token ?? undefined,
        tokenExpiresAt: newTokens.expiry_date ? new Date(newTokens.expiry_date) : undefined,
        updatedAt:      new Date(),
      })
      .where(eq(googleBusinessProfiles.id, profile.id));
  });

  return manager;
}

/**
 * Sync reviews from Google for a store and upsert into the local database.
 * Only syncs reviews for the selected location (locationResourceName).
 */
export async function syncGoogleReviews(
  storeId: number,
): Promise<{ synced: number; locationResourceName: string; businessName: string | null }> {
  console.log(`[Google Business OAuth] ── syncGoogleReviews START — storeId=${storeId} ──`);

  const profiles = await db
    .select()
    .from(googleBusinessProfiles)
    .where(eq(googleBusinessProfiles.storeId, storeId))
    .limit(1);

  if (!profiles.length) {
    console.error(`[Google Business OAuth] syncGoogleReviews — no profile row for storeId=${storeId}`);
    throw new Error("Google Business Profile not connected for this store");
  }

  const googleProfile = profiles[0];
  console.log(
    `[Google Business OAuth] syncGoogleReviews — profile id=${googleProfile.id}` +
    `  isConnected=${googleProfile.isConnected}` +
    `  businessName="${googleProfile.businessName ?? "(none)"}"` +
    `  locationResourceName="${googleProfile.locationResourceName ?? "(none)"}"`,
  );
  console.log(
    `[Google Business OAuth] syncGoogleReviews —` +
    `  accessToken: ${googleProfile.accessToken ? "present" : "MISSING"}` +
    `  refreshToken: ${googleProfile.refreshToken ? "present" : "MISSING"}` +
    `  tokenExpiresAt: ${googleProfile.tokenExpiresAt?.toISOString() ?? "(none)"}`,
  );

  if (!googleProfile.locationResourceName) {
    console.error(`[Google Business OAuth] syncGoogleReviews — locationResourceName is NULL for storeId=${storeId}. User must select a location first.`);
    throw new Error("No location connected. Please reconnect your Google Business Profile and select a location.");
  }

  if (!googleProfile.accessToken && !googleProfile.refreshToken) {
    console.error(`[Google Business OAuth] syncGoogleReviews — no tokens for storeId=${storeId}. Re-authentication required.`);
    throw new Error("Google access token missing. Please reconnect your Google Business Profile.");
  }

  const apiManager = createApiManagerFromProfile(googleProfile);

  // ── Resolve the proper googleBusinessLocations row (for FK tagging + sync log) ──────────
  // This row exists if the user connected via the new flow. Null is safe for legacy profiles.
  let gbLocationRow: { id: number; locationId: string } | null = null;
  try {
    const locRows = await db
      .select({ id: googleBusinessLocations.id, locationId: googleBusinessLocations.locationId })
      .from(googleBusinessLocations)
      .where(eq(googleBusinessLocations.locationResourceName, googleProfile.locationResourceName!))
      .limit(1);
    if (locRows.length) {
      gbLocationRow = locRows[0];
      console.log(`[Google Business OAuth] syncGoogleReviews — matched googleBusinessLocations id=${gbLocationRow.id}`);
    } else {
      console.log(`[Google Business OAuth] syncGoogleReviews — no googleBusinessLocations row yet for "${googleProfile.locationResourceName}" (legacy profile — will sync without FK tag)`);
    }
  } catch (e) {
    console.warn("[Google Business OAuth] syncGoogleReviews — could not resolve googleBusinessLocations:", e);
  }

  console.log(`[Google Business OAuth] syncGoogleReviews — calling getReviews for: ${googleProfile.locationResourceName}`);
  let reviews: Awaited<ReturnType<typeof apiManager.getReviews>> = [];
  let syncError: string | null = null;

  try {
    reviews = await apiManager.getReviews(googleProfile.locationResourceName!);
    console.log(`[Google Business OAuth] syncGoogleReviews — getReviews returned ${reviews.length} review(s)`);
  } catch (err: any) {
    syncError = err?.message ?? String(err);
    // Write failure sync log before re-throwing
    await db.insert(googleBusinessSyncLogs).values({
      storeId,
      locationId: gbLocationRow?.id ?? null,
      syncType:   "reviews",
      status:     "failed",
      errorMessage: syncError,
    }).catch(() => {});
    throw err;
  }

  let insertedCount = 0;
  let updatedCount = 0;

  for (const review of reviews) {
    const googleReviewId = review.name.split("/").pop() ?? review.name;
    const rating = normalizeStarRating((review as any).starRating ?? (review as any).rating);
    const reviewText = review.comment ?? (review as any).reviewText;
    const hasReply = !!(review.reviewReply ?? review.publisherResponse);

    console.log(
      `[Google Business OAuth] syncGoogleReviews —` +
      `  review="${googleReviewId}"  rating=${rating}` +
      `  reviewer="${review.reviewer?.displayName ?? "Anonymous"}"` +
      `  hasReply=${hasReply}`,
    );

    const existing = await db
      .select()
      .from(googleReviews)
      .where(eq(googleReviews.googleReviewId, googleReviewId))
      .limit(1);

    if (!existing.length) {
      await db.insert(googleReviews).values({
        storeId,
        googleReviewId,
        googleLocationId:     googleProfile.locationId,
        gbLocationId:         gbLocationRow?.id ?? null,  // proper FK to googleBusinessLocations
        customerName:         review.reviewer?.displayName ?? "Anonymous",
        rating,
        reviewText,
        reviewImageUrls:      JSON.stringify([]),
        reviewCreateTime:     review.createTime ? new Date(review.createTime) : null,
        reviewUpdateTime:     review.updateTime ? new Date(review.updateTime) : null,
        reviewerLanguageCode: "en",
        responseStatus:       hasReply ? "responded" : "not_responded",
      });
      insertedCount++;
    } else {
      // Update existing review — also set gbLocationId if it wasn't set before
      await db
        .update(googleReviews)
        .set({
          reviewText,
          responseStatus:   hasReply ? "responded" : "not_responded",
          reviewUpdateTime: review.updateTime ? new Date(review.updateTime) : null,
          gbLocationId:     existing[0].gbLocationId ?? gbLocationRow?.id ?? null,
          updatedAt:        new Date(),
        })
        .where(eq(googleReviews.googleReviewId, googleReviewId));
      updatedCount++;
    }
  }

  // ── Mark last synced in profile ──────────────────────────────────────────────
  await db
    .update(googleBusinessProfiles)
    .set({ lastSyncedAt: new Date() })
    .where(eq(googleBusinessProfiles.id, googleProfile.id));

  // ── Write success sync log ───────────────────────────────────────────────────
  await db.insert(googleBusinessSyncLogs).values({
    storeId,
    locationId:    gbLocationRow?.id ?? null,
    syncType:      "reviews",
    status:        "success",
    reviewsSynced: reviews.length,
  }).catch((e) => console.warn("[Google Business OAuth] syncGoogleReviews — could not write sync log:", e));

  console.log(
    `[Google Business OAuth] ── syncGoogleReviews DONE — storeId=${storeId}:` +
    ` ${reviews.length} total (${insertedCount} new, ${updatedCount} updated) ──`,
  );

  return {
    synced:               reviews.length,
    locationResourceName: googleProfile.locationResourceName!,
    businessName:         googleProfile.businessName,
  };
}

/**
 * Publish an approved review response from the database to Google.
 */
export async function publishReviewResponse(responseId: number): Promise<void> {
  const responses = await db
    .select()
    .from(googleReviewResponses)
    .where(eq(googleReviewResponses.id, responseId))
    .limit(1);

  if (!responses.length) throw new Error("Review response not found");
  const reviewResponse = responses[0];

  const reviewRecords = await db
    .select()
    .from(googleReviews)
    .where(eq(googleReviews.id, reviewResponse.googleReviewId))
    .limit(1);

  if (!reviewRecords.length) throw new Error("Review not found");
  const review = reviewRecords[0];

  const profileData = await db
    .select()
    .from(googleBusinessProfiles)
    .where(eq(googleBusinessProfiles.storeId, review.storeId))
    .limit(1);

  if (!profileData.length) throw new Error("Google Business Profile not found");
  const googleProfile = profileData[0];

  const apiManager = createApiManagerFromProfile(googleProfile);

  const reviewResourceName = `${googleProfile.locationResourceName}/reviews/${review.googleReviewId}`;
  console.log(`[Google Business OAuth] publishReviewResponse — posting reply to: ${reviewResourceName}`);
  await apiManager.replyToReview(reviewResourceName, reviewResponse.responseText);

  await db
    .update(googleReviewResponses)
    .set({ responseStatus: "approved", updatedAt: new Date() })
    .where(eq(googleReviewResponses.id, responseId));

  await db
    .update(googleReviews)
    .set({ responseStatus: "responded" })
    .where(eq(googleReviews.id, review.id));

  console.log(`[Google Business OAuth] publishReviewResponse — published for review ${review.googleReviewId}`);
}
