import * as z from "zod";

// ── Templates ─────────────────────────────────────────────────────────────────

export const ListTemplatesQueryParams = z.object({
  category: z.string().optional(),
});

export const ImportTemplateBody = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  zipBase64: z.string().min(1),
});

export const GetTemplateParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const DeleteTemplateParams = z.object({
  id: z.coerce.number().int().positive(),
});

// ── Websites ──────────────────────────────────────────────────────────────────

export const CheckSlugQueryParams = z.object({
  slug: z.string().min(1),
});

export const CreateWebsiteBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  storeid: z.string().optional(),
  templateId: z.number().int().positive().optional(),
  content: z.record(z.unknown()).optional(),
});

export const GetWebsiteParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const UpdateWebsiteParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const UpdateWebsiteBody = z.object({
  name: z.string().min(1).optional(),
  content: z.record(z.unknown()).optional(),
  templateId: z.number().int().positive().nullable().optional(),
  storeid: z.string().nullable().optional(),
});

export const DeleteWebsiteParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const PublishWebsiteParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const UnpublishWebsiteParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const ResolveTenantParams = z.object({
  slug: z.string().min(1),
});
