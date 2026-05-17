import { pgTable, text, serial, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const websitesTable = pgTable("wb_websites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  storeid: text("storeid"),
  templateId: integer("template_id"),
  content: jsonb("content").notNull().default({}),
  published: boolean("published").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  customDomain: text("custom_domain"),
  customDomainStatus: text("custom_domain_status"), // null | 'pending_payment' | 'active'
  customDomainToken: text("custom_domain_token"), // random hex token used to verify domain ownership
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  assignedSubdomain: text("assigned_subdomain"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWebsiteSchema = createInsertSchema(websitesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWebsite = z.infer<typeof insertWebsiteSchema>;
export type Website = typeof websitesTable.$inferSelect;
