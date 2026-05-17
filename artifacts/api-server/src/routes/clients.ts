import { Router } from "express";
import multer from "multer";
import { db } from "../db";
import { isAuthenticated } from "../auth";
import {
  clients,
  clientEmails,
  clientPhones,
  clientAddresses,
  clientTags,
  clientTagRelationships,
  clientNotes,
  clientMarketingPreferences,
  clientCustomFields,
  clientCustomFieldValues,
  clientAuditLogs,
  clientExportJobs,
  clientImportJobs,
  customers,
} from "@shared/schema";
import {
  eq,
  and,
  ilike,
  or,
  desc,
  asc,
  inArray,
  sql,
  isNull,
  notInArray,
} from "drizzle-orm";
import * as XLSX from "xlsx";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): { e164: string; display: string } {
  const digits = raw.replace(/\D/g, "");
  const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+${digits}`;
  const display = raw.trim();
  return { e164, display };
}

function normalizeEmail(raw: string): string {
  return raw.toLowerCase().trim();
}

async function auditLog(
  storeId: number,
  actionType: string,
  options: { clientId?: number; actorUserId?: string; metadata?: object; ipAddress?: string }
) {
  await db.insert(clientAuditLogs).values({
    storeId,
    clientId: options.clientId ?? null,
    actionType,
    actorUserId: options.actorUserId ?? null,
    metadataJson: options.metadata ?? null,
    ipAddress: options.ipAddress ?? null,
  });
}

function getUserId(req: any): string | undefined {
  return (req.session as any)?.userId;
}

// ─── CLIENT LIST ──────────────────────────────────────────────────────────────

router.get("/", isAuthenticated, async (req, res) => {
  try {
    const storeId = Number(req.query.storeId);
    if (!storeId) return res.status(400).json({ message: "storeId required" });

    const { search, tag, status, page = "1", limit = "50", sort = "fullName", order = "asc" } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // ── Auto-migration: if no clients exist but customers do, sync automatically ──
    // This handles demo accounts and any store that was onboarded before the
    // clients table architecture existed. Runs once — subsequent calls are instant
    // because the clients table will already be populated.
    if (!search && !tag && !status) {
      const [clientCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(clients)
        .where(and(eq(clients.storeId, storeId), isNull(clients.archivedAt)));

      if (Number(clientCount.count) === 0) {
        const [custCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(customers)
          .where(eq(customers.storeId, storeId));

        if (Number(custCount.count) > 0) {
          console.log(`[clients] Auto-migrating ${custCount.count} customers → clients for store ${storeId}`);
          try {
            const { migrateCustomersToClients } = await import("../../scripts/lib/migrate-customers-to-clients");
            const result = await migrateCustomersToClients(storeId);
            console.log(`[clients] Auto-migration done: ${result.migrated} migrated, ${result.skipped} skipped`);
          } catch (migrErr) {
            console.error("[clients] Auto-migration failed:", migrErr);
          }
        }
      }
    }

    let query = db
      .select({
        client: clients,
        primaryEmail: sql<string>`(SELECT email_address FROM client_emails WHERE client_id = ${clients.id} AND is_primary = true LIMIT 1)`,
        primaryPhone: sql<string>`(SELECT phone_number_e164 FROM client_phones WHERE client_id = ${clients.id} AND is_primary = true LIMIT 1)`,
        displayPhone: sql<string>`(SELECT display_phone FROM client_phones WHERE client_id = ${clients.id} AND is_primary = true LIMIT 1)`,
        tags: sql<string>`(SELECT json_agg(json_build_object('id', t.id, 'tagName', t.tag_name, 'tagColor', t.tag_color)) FROM client_tags t JOIN client_tag_relationships r ON r.tag_id = t.id WHERE r.client_id = ${clients.id})`,
      })
      .from(clients)
      .$dynamic();

    const conditions = [eq(clients.storeId, storeId), isNull(clients.archivedAt)];

    if (status && status !== "all") {
      conditions.push(eq(clients.clientStatus, status));
    }

    if (search) {
      conditions.push(
        or(
          ilike(clients.fullName, `%${search}%`),
          ilike(clients.firstName, `%${search}%`),
          ilike(clients.lastName, `%${search}%`),
          sql`EXISTS (SELECT 1 FROM client_emails WHERE client_id = ${clients.id} AND email_address ILIKE ${`%${search}%`})`,
          sql`EXISTS (SELECT 1 FROM client_phones WHERE client_id = ${clients.id} AND (phone_number_e164 LIKE ${`%${search.replace(/\D/g, "")}%`} OR display_phone ILIKE ${`%${search}%`}))`,
        )!
      );
    }

    if (tag) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM client_tag_relationships r JOIN client_tags t ON r.tag_id = t.id WHERE r.client_id = ${clients.id} AND t.tag_name = ${tag})`
      );
    }

    const orderCol = sort === "lastVisitAt" ? clients.lastVisitAt
      : sort === "totalSpent" ? clients.totalSpentCents
      : sort === "totalVisits" ? clients.totalVisits
      : sort === "createdAt" ? clients.createdAt
      : clients.fullName;

    const rows = await query
      .where(and(...conditions))
      .orderBy(order === "desc" ? desc(orderCol) : asc(orderCol))
      .limit(limitNum)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(and(...conditions));

    return res.json({
      clients: rows.map((r) => ({
        ...r.client,
        primaryEmail: r.primaryEmail,
        primaryPhone: r.displayPhone || r.primaryPhone,
        tags: r.tags ? JSON.parse(JSON.stringify(r.tags)) : [],
      })),
      total: Number(count),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    console.error("[clients] list error:", err);
    return res.status(500).json({ message: "Failed to fetch clients" });
  }
});

// ─── CLIENT CREATE ────────────────────────────────────────────────────────────

router.post("/", isAuthenticated, async (req, res) => {
  try {
    const {
      storeId,
      firstName = "",
      lastName = "",
      preferredName,
      dateOfBirth,
      allergies,
      gender,
      email,
      phone,
      notes,
      source = "manual",
      tagIds,
      smsOptIn = true,
      emailMarketingOptIn = true,
    } = req.body;

    if (!storeId) return res.status(400).json({ message: "storeId required" });
    if (!firstName && !lastName && !email && !phone) {
      return res.status(400).json({ message: "At least one of name, email, or phone is required" });
    }

    const fullName = `${firstName} ${lastName}`.trim() || email || phone || "";

    const [client] = await db
      .insert(clients)
      .values({ storeId, firstName, lastName, fullName, preferredName, dateOfBirth, allergies: allergies || null, gender, source })
      .returning();

    if (email) {
      await db.insert(clientEmails).values({
        clientId: client.id,
        emailAddress: normalizeEmail(email),
        isPrimary: true,
        marketingOptIn: emailMarketingOptIn,
      });
    }

    if (phone) {
      const { e164, display } = normalizePhone(phone);
      await db.insert(clientPhones).values({
        clientId: client.id,
        phoneNumberE164: e164,
        displayPhone: display,
        phoneType: "mobile",
        smsOptIn,
        isPrimary: true,
      });
    }

    // Default marketing preferences
    await db.insert(clientMarketingPreferences).values({
      clientId: client.id,
      smsMarketingOptIn: smsOptIn,
      emailMarketingOptIn,
    });

    if (tagIds && Array.isArray(tagIds) && tagIds.length > 0) {
      await db.insert(clientTagRelationships).values(
        tagIds.map((tagId: number) => ({ clientId: client.id, tagId }))
      );
    }

    if (notes) {
      await db.insert(clientNotes).values({
        clientId: client.id,
        storeId,
        createdByUserId: getUserId(req) ?? null,
        noteType: "general",
        noteContent: notes,
      });
    }

    await auditLog(storeId, "created", { clientId: client.id, actorUserId: getUserId(req), ipAddress: req.ip });

    return res.status(201).json(client);
  } catch (err) {
    console.error("[clients] create error:", err);
    return res.status(500).json({ message: "Failed to create client" });
  }
});

// ─── CLIENT GET ───────────────────────────────────────────────────────────────

router.get("/:id", isAuthenticated, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
    if (!client) return res.status(404).json({ message: "Client not found" });

    const [emails, phones, addresses, tagRels, notes, mktPrefs, customFieldValues] = await Promise.all([
      db.select().from(clientEmails).where(eq(clientEmails.clientId, clientId)).orderBy(desc(clientEmails.isPrimary)),
      db.select().from(clientPhones).where(eq(clientPhones.clientId, clientId)).orderBy(desc(clientPhones.isPrimary)),
      db.select().from(clientAddresses).where(eq(clientAddresses.clientId, clientId)),
      db
        .select({ rel: clientTagRelationships, tag: clientTags })
        .from(clientTagRelationships)
        .innerJoin(clientTags, eq(clientTagRelationships.tagId, clientTags.id))
        .where(eq(clientTagRelationships.clientId, clientId)),
      db.select().from(clientNotes).where(eq(clientNotes.clientId, clientId)).orderBy(desc(clientNotes.pinned), desc(clientNotes.createdAt)),
      db.select().from(clientMarketingPreferences).where(eq(clientMarketingPreferences.clientId, clientId)),
      db.select({ val: clientCustomFieldValues, field: clientCustomFields })
        .from(clientCustomFieldValues)
        .innerJoin(clientCustomFields, eq(clientCustomFieldValues.customFieldId, clientCustomFields.id))
        .where(eq(clientCustomFieldValues.clientId, clientId)),
    ]);

    // Bridge to the old customers table via email so intelligence data can be fetched
    let matchedCustomerId: number | null = null;
    const primaryEmail = emails.find(e => e.isPrimary)?.emailAddress ?? emails[0]?.emailAddress;
    if (primaryEmail && client.storeId) {
      const match = await db.execute(sql`
        SELECT id FROM customers WHERE LOWER(email) = ${primaryEmail} AND store_id = ${client.storeId} LIMIT 1
      `);
      if ((match.rows as any[]).length > 0) {
        matchedCustomerId = Number((match.rows as any[])[0].id);
      }
    }

    return res.json({
      ...client,
      emails,
      phones,
      addresses,
      tags: tagRels.map((r) => ({ ...r.rel, tag: r.tag })),
      notes,
      marketingPreferences: mktPrefs[0] ?? null,
      customFields: customFieldValues.map((r) => ({ ...r.val, field: r.field })),
      primaryEmail: primaryEmail ?? null,
      primaryPhone: phones.find(p => p.isPrimary)?.displayPhone ?? phones[0]?.displayPhone ?? null,
      matchedCustomerId,
    });
  } catch (err) {
    console.error("[clients] get error:", err);
    return res.status(500).json({ message: "Failed to fetch client" });
  }
});

// ─── CLIENT UPDATE ────────────────────────────────────────────────────────────

router.patch("/:id", isAuthenticated, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const { firstName, lastName, preferredName, dateOfBirth, allergies, gender, clientStatus, preferredStaffId, source, referralSource, avatarUrl } = req.body;

    const newFirst = firstName ?? undefined;
    const newLast = lastName ?? undefined;
    const updates: Partial<typeof clients.$inferInsert> = {};
    if (newFirst !== undefined) updates.firstName = newFirst;
    if (newLast !== undefined) updates.lastName = newLast;
    if (newFirst !== undefined || newLast !== undefined) {
      const [cur] = await db.select().from(clients).where(eq(clients.id, clientId));
      updates.fullName = `${newFirst ?? cur?.firstName ?? ""} ${newLast ?? cur?.lastName ?? ""}`.trim();
    }
    if (preferredName !== undefined) updates.preferredName = preferredName;
    if (dateOfBirth !== undefined) updates.dateOfBirth = dateOfBirth;
    if (allergies !== undefined) updates.allergies = allergies || null;
    if (gender !== undefined) updates.gender = gender;
    if (clientStatus !== undefined) updates.clientStatus = clientStatus;
    if (preferredStaffId !== undefined) updates.preferredStaffId = preferredStaffId;
    if (source !== undefined) updates.source = source;
    if (referralSource !== undefined) updates.referralSource = referralSource;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
    updates.updatedAt = new Date();

    const [updated] = await db.update(clients).set(updates).where(eq(clients.id, clientId)).returning();
    if (!updated) return res.status(404).json({ message: "Client not found" });

    const storeId = updated.storeId;
    await auditLog(storeId, "updated", { clientId, actorUserId: getUserId(req), metadata: { fields: Object.keys(updates) } });

    return res.json(updated);
  } catch (err) {
    console.error("[clients] update error:", err);
    return res.status(500).json({ message: "Failed to update client" });
  }
});

// ─── CLIENT ARCHIVE / DELETE ──────────────────────────────────────────────────

router.delete("/:id", isAuthenticated, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
    if (!client) return res.status(404).json({ message: "Client not found" });

    await db.update(clients).set({ archivedAt: new Date() }).where(eq(clients.id, clientId));
    await auditLog(client.storeId, "archived", { clientId, actorUserId: getUserId(req) });

    return res.json({ message: "Client archived" });
  } catch (err) {
    console.error("[clients] delete error:", err);
    return res.status(500).json({ message: "Failed to archive client" });
  }
});

// ─── TAGS ─────────────────────────────────────────────────────────────────────

router.get("/tags/list", isAuthenticated, async (req, res) => {
  try {
    const storeId = Number(req.query.storeId);
    if (!storeId) return res.status(400).json({ message: "storeId required" });

    const tags = await db
      .select({
        tag: clientTags,
        count: sql<number>`(SELECT COUNT(*) FROM client_tag_relationships WHERE tag_id = ${clientTags.id})`,
      })
      .from(clientTags)
      .where(eq(clientTags.storeId, storeId))
      .orderBy(asc(clientTags.tagName));

    return res.json(tags.map((r) => ({ ...r.tag, count: Number(r.count) })));
  } catch (err) {
    console.error("[clients] tags list error:", err);
    return res.status(500).json({ message: "Failed to fetch tags" });
  }
});

router.post("/tags", isAuthenticated, async (req, res) => {
  try {
    const { storeId, tagName, tagColor = "#6366f1" } = req.body;
    if (!storeId || !tagName) return res.status(400).json({ message: "storeId and tagName required" });

    const [tag] = await db
      .insert(clientTags)
      .values({ storeId, tagName: tagName.trim(), tagColor })
      .onConflictDoUpdate({ target: [clientTags.storeId, clientTags.tagName], set: { tagColor } })
      .returning();

    return res.status(201).json(tag);
  } catch (err) {
    console.error("[clients] tags create error:", err);
    return res.status(500).json({ message: "Failed to create tag" });
  }
});

router.post("/:id/tags", isAuthenticated, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const { tagId } = req.body;
    await db.insert(clientTagRelationships).values({ clientId, tagId }).onConflictDoNothing();
    return res.json({ message: "Tag added" });
  } catch (err) {
    return res.status(500).json({ message: "Failed to add tag" });
  }
});

router.delete("/:id/tags/:tagId", isAuthenticated, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const tagId = Number(req.params.tagId);
    await db.delete(clientTagRelationships).where(and(eq(clientTagRelationships.clientId, clientId), eq(clientTagRelationships.tagId, tagId)));
    return res.json({ message: "Tag removed" });
  } catch (err) {
    return res.status(500).json({ message: "Failed to remove tag" });
  }
});

// ─── NOTES ────────────────────────────────────────────────────────────────────

router.get("/:id/notes", isAuthenticated, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const notes = await db.select().from(clientNotes).where(eq(clientNotes.clientId, clientId)).orderBy(desc(clientNotes.pinned), desc(clientNotes.createdAt));
    return res.json(notes);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch notes" });
  }
});

router.post("/:id/notes", isAuthenticated, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const { storeId, noteType = "general", visibility = "internal", noteContent, pinned = false } = req.body;
    if (!storeId || !noteContent) return res.status(400).json({ message: "storeId and noteContent required" });

    const [note] = await db
      .insert(clientNotes)
      .values({ clientId, storeId, createdByUserId: getUserId(req) ?? null, noteType, visibility, noteContent, pinned })
      .returning();

    return res.status(201).json(note);
  } catch (err) {
    return res.status(500).json({ message: "Failed to create note" });
  }
});

router.patch("/:id/notes/:noteId", isAuthenticated, async (req, res) => {
  try {
    const noteId = Number(req.params.noteId);
    const { noteContent, pinned, visibility } = req.body;
    const updates: any = { updatedAt: new Date() };
    if (noteContent !== undefined) updates.noteContent = noteContent;
    if (pinned !== undefined) updates.pinned = pinned;
    if (visibility !== undefined) updates.visibility = visibility;

    const [note] = await db.update(clientNotes).set(updates).where(eq(clientNotes.id, noteId)).returning();
    return res.json(note);
  } catch (err) {
    return res.status(500).json({ message: "Failed to update note" });
  }
});

router.delete("/:id/notes/:noteId", isAuthenticated, async (req, res) => {
  try {
    const noteId = Number(req.params.noteId);
    await db.delete(clientNotes).where(eq(clientNotes.id, noteId));
    return res.json({ message: "Note deleted" });
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete note" });
  }
});

// ─── PHONES ───────────────────────────────────────────────────────────────────

router.post("/:id/phones", isAuthenticated, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const { phoneNumber, phoneType = "mobile", smsOptIn = true, isPrimary = false } = req.body;
    if (!phoneNumber) return res.status(400).json({ message: "phoneNumber required" });

    const { e164, display } = normalizePhone(phoneNumber);
    if (isPrimary) {
      await db.update(clientPhones).set({ isPrimary: false }).where(eq(clientPhones.clientId, clientId));
    }
    const [phone] = await db.insert(clientPhones).values({ clientId, phoneNumberE164: e164, displayPhone: display, phoneType, smsOptIn, isPrimary }).returning();
    return res.status(201).json(phone);
  } catch (err) {
    return res.status(500).json({ message: "Failed to add phone" });
  }
});

// ─── EMAILS ───────────────────────────────────────────────────────────────────

router.post("/:id/emails", isAuthenticated, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const { emailAddress, isPrimary = false, marketingOptIn = true } = req.body;
    if (!emailAddress) return res.status(400).json({ message: "emailAddress required" });

    if (isPrimary) {
      await db.update(clientEmails).set({ isPrimary: false }).where(eq(clientEmails.clientId, clientId));
    }
    const [email] = await db.insert(clientEmails).values({ clientId, emailAddress: normalizeEmail(emailAddress), isPrimary, marketingOptIn }).returning();
    return res.status(201).json(email);
  } catch (err) {
    return res.status(500).json({ message: "Failed to add email" });
  }
});

// ─── MARKETING PREFERENCES ────────────────────────────────────────────────────

router.get("/:id/marketing-preferences", isAuthenticated, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const [prefs] = await db.select().from(clientMarketingPreferences).where(eq(clientMarketingPreferences.clientId, clientId));
    return res.json(prefs ?? null);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch preferences" });
  }
});

router.put("/:id/marketing-preferences", isAuthenticated, async (req, res) => {
  try {
    const clientId = Number(req.params.id);
    const { smsMarketingOptIn, emailMarketingOptIn, promotionalNotifications, appointmentReminders, reviewRequests } = req.body;

    const [prefs] = await db
      .insert(clientMarketingPreferences)
      .values({ clientId, smsMarketingOptIn, emailMarketingOptIn, promotionalNotifications, appointmentReminders, reviewRequests })
      .onConflictDoUpdate({
        target: clientMarketingPreferences.clientId,
        set: { smsMarketingOptIn, emailMarketingOptIn, promotionalNotifications, appointmentReminders, reviewRequests, updatedAt: new Date() },
      })
      .returning();

    return res.json(prefs);
  } catch (err) {
    return res.status(500).json({ message: "Failed to update preferences" });
  }
});

// ─── DUPLICATE DETECTION ──────────────────────────────────────────────────────

router.post("/detect-duplicates", isAuthenticated, async (req, res) => {
  try {
    const { storeId, email, phone, firstName, lastName } = req.body;
    if (!storeId) return res.status(400).json({ message: "storeId required" });

    const dupes: any[] = [];

    if (email) {
      const rows = await db
        .select({ clientId: clientEmails.clientId })
        .from(clientEmails)
        .innerJoin(clients, eq(clientEmails.clientId, clients.id))
        .where(and(eq(clientEmails.emailAddress, normalizeEmail(email)), eq(clients.storeId, storeId), isNull(clients.archivedAt)));
      if (rows.length > 0) dupes.push(...rows.map((r) => ({ type: "email", clientId: r.clientId })));
    }

    if (phone) {
      const { e164 } = normalizePhone(phone);
      const rows = await db
        .select({ clientId: clientPhones.clientId })
        .from(clientPhones)
        .innerJoin(clients, eq(clientPhones.clientId, clients.id))
        .where(and(eq(clientPhones.phoneNumberE164, e164), eq(clients.storeId, storeId), isNull(clients.archivedAt)));
      if (rows.length > 0) dupes.push(...rows.map((r) => ({ type: "phone", clientId: r.clientId })));
    }

    // Name match (both first and last must match)
    if (firstName && lastName) {
      const nameMatches = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.storeId, storeId), ilike(clients.firstName, firstName), ilike(clients.lastName, lastName), isNull(clients.archivedAt)));
      if (nameMatches.length > 0) dupes.push(...nameMatches.map((r) => ({ type: "name", clientId: r.id })));
    }

    const uniqueClientIds = Array.from(new Set(dupes.map((d) => d.clientId)));
    if (uniqueClientIds.length === 0) return res.json({ duplicates: [] });

    const dupClients = await db
      .select({
        id: clients.id,
        fullName: clients.fullName,
        primaryEmail: sql<string>`(SELECT email_address FROM client_emails WHERE client_id = ${clients.id} AND is_primary = true LIMIT 1)`,
        primaryPhone: sql<string>`(SELECT display_phone FROM client_phones WHERE client_id = ${clients.id} AND is_primary = true LIMIT 1)`,
      })
      .from(clients)
      .where(inArray(clients.id, uniqueClientIds));

    return res.json({
      duplicates: dupClients.map((c) => ({
        ...c,
        matchTypes: dupes.filter((d) => d.clientId === c.id).map((d) => d.type),
      })),
    });
  } catch (err) {
    console.error("[clients] duplicate detection error:", err);
    return res.status(500).json({ message: "Failed to detect duplicates" });
  }
});

// ─── EXPORT ───────────────────────────────────────────────────────────────────

async function buildClientRows(storeId: number, filter: any = {}) {
  const conditions = [eq(clients.storeId, storeId), isNull(clients.archivedAt)];

  if (filter.status) conditions.push(eq(clients.clientStatus, filter.status));
  if (filter.smsOptIn === true) conditions.push(
    sql`EXISTS (SELECT 1 FROM client_marketing_preferences WHERE client_id = ${clients.id} AND sms_marketing_opt_in = true)`
  );
  if (filter.emailOptIn === true) conditions.push(
    sql`EXISTS (SELECT 1 FROM client_marketing_preferences WHERE client_id = ${clients.id} AND email_marketing_opt_in = true)`
  );
  if (filter.tag) conditions.push(
    sql`EXISTS (SELECT 1 FROM client_tag_relationships r JOIN client_tags t ON r.tag_id = t.id WHERE r.client_id = ${clients.id} AND t.tag_name = ${filter.tag})`
  );

  const rows = await db
    .select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      fullName: clients.fullName,
      dateOfBirth: clients.dateOfBirth,
      clientStatus: clients.clientStatus,
      source: clients.source,
      totalVisits: clients.totalVisits,
      totalSpentCents: clients.totalSpentCents,
      lastVisitAt: clients.lastVisitAt,
      createdAt: clients.createdAt,
      updatedAt: clients.updatedAt,
      primaryEmail: sql<string>`(SELECT email_address FROM client_emails WHERE client_id = ${clients.id} AND is_primary = true LIMIT 1)`,
      primaryPhone: sql<string>`(SELECT display_phone FROM client_phones WHERE client_id = ${clients.id} AND is_primary = true LIMIT 1)`,
      altPhone: sql<string>`(SELECT display_phone FROM client_phones WHERE client_id = ${clients.id} AND is_primary = false LIMIT 1)`,
      addressLine1: sql<string>`(SELECT address_line1 FROM client_addresses WHERE client_id = ${clients.id} LIMIT 1)`,
      city: sql<string>`(SELECT city FROM client_addresses WHERE client_id = ${clients.id} LIMIT 1)`,
      state: sql<string>`(SELECT state FROM client_addresses WHERE client_id = ${clients.id} LIMIT 1)`,
      postalCode: sql<string>`(SELECT postal_code FROM client_addresses WHERE client_id = ${clients.id} LIMIT 1)`,
      country: sql<string>`(SELECT country FROM client_addresses WHERE client_id = ${clients.id} LIMIT 1)`,
      tags: sql<string>`(SELECT string_agg(t.tag_name, ', ') FROM client_tags t JOIN client_tag_relationships r ON r.tag_id = t.id WHERE r.client_id = ${clients.id})`,
      notes: sql<string>`(SELECT string_agg(note_content, ' | ') FROM client_notes WHERE client_id = ${clients.id} AND visibility = 'internal' LIMIT 5)`,
      smsOptIn: sql<boolean>`(SELECT sms_marketing_opt_in FROM client_marketing_preferences WHERE client_id = ${clients.id} LIMIT 1)`,
      emailOptIn: sql<boolean>`(SELECT email_marketing_opt_in FROM client_marketing_preferences WHERE client_id = ${clients.id} LIMIT 1)`,
    })
    .from(clients)
    .where(and(...conditions))
    .orderBy(asc(clients.fullName));

  return rows.map((r) => ({
    "First Name": r.firstName,
    "Last Name": r.lastName,
    "Full Name": r.fullName,
    "Email": r.primaryEmail ?? "",
    "Mobile Phone": r.primaryPhone ?? "",
    "Alternate Phone": r.altPhone ?? "",
    "Tags": r.tags ?? "",
    "Notes": r.notes ?? "",
    "Last Visit Date": r.lastVisitAt ? new Date(r.lastVisitAt).toISOString().split("T")[0] : "",
    "Total Visits": r.totalVisits ?? 0,
    "Lifetime Spend": r.totalSpentCents ? `$${(r.totalSpentCents / 100).toFixed(2)}` : "$0.00",
    "Marketing Opt-In SMS": r.smsOptIn ? "Yes" : "No",
    "Marketing Opt-In Email": r.emailOptIn ? "Yes" : "No",
    "Address": r.addressLine1 ?? "",
    "City": r.city ?? "",
    "State": r.state ?? "",
    "Postal Code": r.postalCode ?? "",
    "Country": r.country ?? "",
    "Status": r.clientStatus,
    "Source": r.source ?? "",
    "Created Date": r.createdAt ? new Date(r.createdAt).toISOString().split("T")[0] : "",
    "Last Updated": r.updatedAt ? new Date(r.updatedAt).toISOString().split("T")[0] : "",
  }));
}

router.post("/export", isAuthenticated, async (req, res) => {
  try {
    const { storeId, format = "csv", filter = {} } = req.body;
    if (!storeId) return res.status(400).json({ message: "storeId required" });
    if (!["csv", "xlsx", "json"].includes(format)) return res.status(400).json({ message: "format must be csv, xlsx, or json" });

    const userId = getUserId(req);

    // Log the export
    await auditLog(storeId, "exported", { actorUserId: userId, metadata: { format, filter } });

    const rows = await buildClientRows(storeId, filter);

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="clients-${storeId}-${Date.now()}.json"`);
      return res.json(rows);
    }

    if (format === "csv") {
      const headers = Object.keys(rows[0] ?? {});
      const csvLines = [
        headers.join(","),
        ...rows.map((r) =>
          headers.map((h) => {
            const val = String((r as any)[h] ?? "").replace(/"/g, '""');
            return `"${val}"`;
          }).join(",")
        ),
      ];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="clients-${storeId}-${Date.now()}.csv"`);
      return res.send(csvLines.join("\n"));
    }

    if (format === "xlsx") {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Clients");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="clients-${storeId}-${Date.now()}.xlsx"`);
      return res.send(buf);
    }
  } catch (err) {
    console.error("[clients] export error:", err);
    return res.status(500).json({ message: "Export failed" });
  }
});

// ─── IMPORT ───────────────────────────────────────────────────────────────────

router.post("/import/preview", isAuthenticated, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const { storeId } = req.body;
    if (!storeId) return res.status(400).json({ message: "storeId required" });

    let rows: any[] = [];

    if (req.file.originalname.endsWith(".xlsx") || req.file.originalname.endsWith(".xls")) {
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws);
    } else {
      // CSV
      const text = req.file.buffer.toString("utf-8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return res.status(400).json({ message: "File is empty or has no data rows" });

      const headers = lines[0].split(",").map((h: string) => h.replace(/^"|"$/g, "").trim());
      rows = lines.slice(1).map((line: string) => {
        const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) ?? line.split(",");
        const obj: any = {};
        headers.forEach((h: string, i: number) => {
          obj[h] = vals[i] ? String(vals[i]).replace(/^"|"$/g, "").trim() : "";
        });
        return obj;
      });
    }

    const preview = rows.slice(0, 5);
    const detectedFields = Object.keys(rows[0] ?? {});

    // Auto-detect field mapping
    const fieldMap: Record<string, string> = {};
    const MAPPINGS: Record<string, string[]> = {
      firstName: ["first name", "firstname", "first_name", "given name"],
      lastName: ["last name", "lastname", "last_name", "surname", "family name"],
      fullName: ["full name", "fullname", "name", "client name", "customer name"],
      email: ["email", "email address", "e-mail"],
      phone: ["phone", "mobile", "mobile phone", "cell", "phone number", "telephone"],
      altPhone: ["alternate phone", "alt phone", "home phone", "work phone"],
      tags: ["tags", "labels", "categories"],
      notes: ["notes", "comments", "remarks"],
      city: ["city", "town"],
      state: ["state", "province", "region"],
      postalCode: ["postal code", "zip", "zip code", "postcode"],
      country: ["country"],
    };

    detectedFields.forEach((f) => {
      const lower = f.toLowerCase();
      for (const [target, patterns] of Object.entries(MAPPINGS)) {
        if (patterns.some((p) => lower === p || lower.includes(p))) {
          fieldMap[f] = target;
          break;
        }
      }
    });

    return res.json({
      totalRows: rows.length,
      preview,
      detectedFields,
      suggestedMapping: fieldMap,
    });
  } catch (err) {
    console.error("[clients] import preview error:", err);
    return res.status(500).json({ message: "Failed to preview file" });
  }
});

router.post("/import/execute", isAuthenticated, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const { storeId, fieldMapping: fieldMappingRaw, duplicateStrategy = "skip" } = req.body;
    if (!storeId) return res.status(400).json({ message: "storeId required" });

    const fieldMapping = typeof fieldMappingRaw === "string" ? JSON.parse(fieldMappingRaw) : fieldMappingRaw;
    const storeIdNum = Number(storeId);

    let rows: any[] = [];
    if (req.file.originalname.endsWith(".xlsx") || req.file.originalname.endsWith(".xls")) {
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    } else {
      const text = req.file.buffer.toString("utf-8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      const headers = lines[0].split(",").map((h: string) => h.replace(/^"|"$/g, "").trim());
      rows = lines.slice(1).map((line: string) => {
        const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) ?? line.split(",");
        const obj: any = {};
        headers.forEach((h: string, i: number) => {
          obj[h] = vals[i] ? String(vals[i]).replace(/^"|"$/g, "").trim() : "";
        });
        return obj;
      });
    }

    let imported = 0, skipped = 0, errors = 0, duplicates = 0;
    const errorList: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // Map fields
        const mapped: Record<string, string> = {};
        for (const [srcField, targetField] of Object.entries(fieldMapping)) {
          mapped[targetField as string] = row[srcField] ?? "";
        }

        let firstName = mapped.firstName ?? "";
        let lastName = mapped.lastName ?? "";
        const fullNameRaw = mapped.fullName ?? "";
        if (!firstName && !lastName && fullNameRaw) {
          const parts = fullNameRaw.trim().split(" ");
          firstName = parts[0] ?? "";
          lastName = parts.slice(1).join(" ") ?? "";
        }
        const email = mapped.email ? normalizeEmail(mapped.email) : null;
        const phone = mapped.phone ? mapped.phone : null;

        // Skip completely empty rows
        if (!firstName && !lastName && !email && !phone) { skipped++; continue; }

        // Duplicate detection
        let existingClientId: number | null = null;
        if (email) {
          const hit = await db
            .select({ clientId: clientEmails.clientId })
            .from(clientEmails)
            .innerJoin(clients, eq(clientEmails.clientId, clients.id))
            .where(and(eq(clientEmails.emailAddress, email), eq(clients.storeId, storeIdNum)))
            .limit(1);
          if (hit[0]) existingClientId = hit[0].clientId;
        }
        if (!existingClientId && phone) {
          const { e164 } = normalizePhone(phone);
          const hit = await db
            .select({ clientId: clientPhones.clientId })
            .from(clientPhones)
            .innerJoin(clients, eq(clientPhones.clientId, clients.id))
            .where(and(eq(clientPhones.phoneNumberE164, e164), eq(clients.storeId, storeIdNum)))
            .limit(1);
          if (hit[0]) existingClientId = hit[0].clientId;
        }

        if (existingClientId) {
          duplicates++;
          if (duplicateStrategy === "skip") { skipped++; continue; }
          if (duplicateStrategy === "update") {
            // Update existing
            await db.update(clients).set({ firstName, lastName, fullName: `${firstName} ${lastName}`.trim(), updatedAt: new Date() }).where(eq(clients.id, existingClientId));
            imported++;
            continue;
          }
        }

        // Create new client
        const fullName = `${firstName} ${lastName}`.trim() || email || phone || "";
        const [client] = await db.insert(clients).values({ storeId: storeIdNum, firstName, lastName, fullName, dateOfBirth: mapped.dateOfBirth || null, source: "import" }).returning();

        if (email) {
          await db.insert(clientEmails).values({ clientId: client.id, emailAddress: email, isPrimary: true }).onConflictDoNothing();
        }
        if (phone) {
          const { e164, display } = normalizePhone(phone);
          await db.insert(clientPhones).values({ clientId: client.id, phoneNumberE164: e164, displayPhone: display, isPrimary: true }).onConflictDoNothing();
        }
        if (mapped.notes) {
          await db.insert(clientNotes).values({ clientId: client.id, storeId: storeIdNum, noteType: "import", noteContent: mapped.notes });
        }
        await db.insert(clientMarketingPreferences).values({ clientId: client.id }).onConflictDoNothing();

        imported++;
      } catch (rowErr) {
        errors++;
        errorList.push({ row: i + 2, error: String(rowErr) });
      }
    }

    await auditLog(storeIdNum, "imported", { actorUserId: getUserId(req), metadata: { imported, skipped, errors, duplicates } });

    return res.json({ totalRows: rows.length, imported, skipped, errors, duplicates, errorList: errorList.slice(0, 50) });
  } catch (err) {
    console.error("[clients] import execute error:", err);
    return res.status(500).json({ message: "Import failed" });
  }
});

// ─── MIGRATE FROM customers TABLE ────────────────────────────────────────────
// One-time sync: pull existing customers into the clients table

router.post("/migrate-from-customers", isAuthenticated, async (req, res) => {
  try {
    const { storeId } = req.body;
    if (!storeId) return res.status(400).json({ message: "storeId required" });

    const { migrateCustomersToClients } = await import("../../scripts/lib/migrate-customers-to-clients");
    const result = await migrateCustomersToClients(Number(storeId));
    return res.json(result);
  } catch (err) {
    console.error("[clients] migration error:", err);
    return res.status(500).json({ message: "Migration failed" });
  }
});

// ─── AUDIT LOGS ───────────────────────────────────────────────────────────────

router.get("/audit-logs", isAuthenticated, async (req, res) => {
  try {
    const storeId = Number(req.query.storeId);
    if (!storeId) return res.status(400).json({ message: "storeId required" });

    const logs = await db
      .select()
      .from(clientAuditLogs)
      .where(eq(clientAuditLogs.storeId, storeId))
      .orderBy(desc(clientAuditLogs.createdAt))
      .limit(200);

    return res.json(logs);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch audit logs" });
  }
});

export default router;
