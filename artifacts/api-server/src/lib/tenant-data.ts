/**
 * tenant-data.ts
 *
 * Shared library for generating tenant data JSON files.
 * Used by both the export script and the API server for serving
 * pre-generated website data.
 *
 * The data contract matches the useSiteData hook in template_master.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// ── Types (matching useSiteData.ts data contract) ─────────────────────────────

export interface BusinessData {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  booking_slug: string | null;
  category: string | null;
}

export interface HoursEntry {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

export interface ServiceEntry {
  id: number;
  name: string;
  price: string | number;
  duration: number;
  category_id: number | null;
}

export interface CategoryEntry {
  id: number;
  name: string;
}

export interface StaffEntry {
  id: number;
  name: string;
  role: string | null;
  avatar_url: string | null;
  bio: string | null;
}

export interface ReviewEntry {
  customer_name: string | null;
  rating: number;
  comment: string | null;
  created_at: string | null;
}

export interface WebsiteMeta {
  id: number;
  name: string;
  slug: string;
}

export interface TenantData {
  website: WebsiteMeta;
  business: BusinessData | null;
  hours: HoursEntry[];
  services: ServiceEntry[];
  serviceCategories: CategoryEntry[];
  staff: StaffEntry[];
  reviews: ReviewEntry[];
}

export interface TenantDataWithMeta extends TenantData {
  meta: {
    location_id: number;
    exported_at: string;
    slug: string;
    cache_version: number;
  };
}

// ── Cache version (bump to invalidate all cached data) ────────────────────────

export const CACHE_VERSION = 1;

// ── Safe query helper ─────────────────────────────────────────────────────────

async function safeQuery<T>(statement: any): Promise<T[]> {
  try {
    const result = await db.execute(statement);
    return result.rows as T[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [warn] Query failed (table may not exist): ${msg}`);
    return [];
  }
}

// ── Build tenant data for a given storeid ─────────────────────────────────────

export async function buildTenantData(
  storeid: number | string,
  website: { id: number; name: string; slug: string }
): Promise<TenantData> {
  const storeIdNum = typeof storeid === 'string' ? parseInt(storeid, 10) : storeid;
  if (isNaN(storeIdNum)) {
    throw new Error(`Invalid storeid: ${storeid}`);
  }

  // Business data
  const businessRows = await safeQuery<BusinessData>(
    sql`SELECT id, name, address, phone, email, city, state, postcode, booking_slug, category
        FROM locations WHERE id = ${storeIdNum} LIMIT 1`
  );
  const business = businessRows.length > 0 ? businessRows[0] : null;

  // Business hours
  const hours = await safeQuery<HoursEntry>(
    sql`SELECT day_of_week, open_time, close_time, is_closed
        FROM business_hours WHERE store_id = ${storeIdNum} ORDER BY day_of_week`
  );

  // Service categories
  const serviceCategories = await safeQuery<CategoryEntry>(
    sql`SELECT id, name
        FROM service_categories
        WHERE store_id = ${storeIdNum}
        ORDER BY sort_order NULLS LAST, id`
  );

  // Services
  const services = await safeQuery<ServiceEntry>(
    sql`SELECT id, name, price, duration, category_id
        FROM services
        WHERE store_id = ${storeIdNum}
        ORDER BY category_id NULLS LAST, id`
  );

  // Staff (active only)
  const staff = await safeQuery<StaffEntry>(
    sql`SELECT id, name, role, avatar_url, bio
        FROM staff
        WHERE store_id = ${storeIdNum}
          AND (status IS NULL OR status = 'active')
        ORDER BY id
        LIMIT 20`
  );

  // Reviews: try Google reviews first; fall back to internal reviews
  let reviews = await safeQuery<ReviewEntry>(
    sql`SELECT customer_name,
               rating,
               review_text AS comment,
               review_create_time AS created_at
        FROM google_reviews
        WHERE store_id = ${storeIdNum}
          AND rating >= 4
        ORDER BY review_create_time DESC
        LIMIT 20`
  );

  if (reviews.length === 0) {
    reviews = await safeQuery<ReviewEntry>(
      sql`SELECT customer_name, rating, comment, created_at
          FROM reviews
          WHERE store_id = ${storeIdNum}
            AND is_public = true
          ORDER BY created_at DESC
          LIMIT 20`
    );
  }

  return {
    website,
    business,
    hours,
    services,
    serviceCategories,
    staff,
    reviews,
  };
}

// ── Get all published websites with their storeid ─────────────────────────────

export async function getPublishedWebsites(): Promise<
  Array<{ id: number; name: string; slug: string; storeid: number }>
> {
  const result = await db.execute(sql`
    SELECT id, name, slug, storeid
    FROM wb_websites
    WHERE published = true
      AND storeid IS NOT NULL
    ORDER BY id
  `);
  return result.rows as Array<{ id: number; name: string; slug: string; storeid: number }>;
}

// ── Get website by slug ───────────────────────────────────────────────────────

export async function getWebsiteBySlug(
  slug: string
): Promise<{ id: number; name: string; slug: string; storeid: number } | null> {
  const result = await db.execute(sql`
    SELECT id, name, slug, storeid
    FROM wb_websites
    WHERE slug = ${slug}
      AND published = true
      AND storeid IS NOT NULL
    LIMIT 1
  `);
  if (result.rows.length === 0) return null;
  return result.rows[0] as { id: number; name: string; slug: string; storeid: number };
}

// ── Generate complete tenant data file with metadata ──────────────────────────

export async function generateTenantDataFile(
  slug: string
): Promise<TenantDataWithMeta | null> {
  const website = await getWebsiteBySlug(slug);
  if (!website) return null;

  const data = await buildTenantData(website.storeid, website);

  return {
    ...data,
    meta: {
      location_id: website.storeid,
      exported_at: new Date().toISOString(),
      slug: website.slug,
      cache_version: CACHE_VERSION,
    },
  };
}

// ── Generate tenant data for all published websites ───────────────────────────

export async function generateAllTenantData(): Promise<{
  success: number;
  errors: number;
  results: Array<{ slug: string; success: boolean; error?: string }>;
}> {
  const websites = await getPublishedWebsites();
  const results: Array<{ slug: string; success: boolean; error?: string }> = [];
  let success = 0;
  let errors = 0;

  for (const site of websites) {
    try {
      const data = await buildTenantData(site.storeid, site);
      // Verify data is valid by checking it serializes
      JSON.stringify(data);
      success++;
      results.push({ slug: site.slug, success: true });
    } catch (err) {
      errors++;
      results.push({
        slug: site.slug,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { success, errors, results };
}
