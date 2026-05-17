import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, imageLibraryTable } from "@workspace/db";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import crypto from "crypto";
import { logger } from "../lib/logger";
import multer from "multer";

const router: IRouter = Router();

const IMAGE_LIBRARY_DIR = path.resolve(process.cwd(), "image-library-storage");
const TEMPLATES_DIR = path.resolve(process.cwd(), "templates-storage");

const VALID_CATEGORIES = ["nail_salon", "barbershop", "hair_salon", "other"];

function categoryDir(category: string): string {
  const safe = VALID_CATEGORIES.includes(category) ? category : "other";
  const dir = path.join(IMAGE_LIBRARY_DIR, safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Static serve ─────────────────────────────────────────────────────────────

router.get("/image-library/images/:category/:filename", (req, res): void => {
  const category = Array.isArray(req.params.category)
    ? req.params.category[0]
    : req.params.category;
  const filename = Array.isArray(req.params.filename)
    ? req.params.filename[0]
    : req.params.filename;
  const filePath = path.join(IMAGE_LIBRARY_DIR, category, filename);
  if (!filePath.startsWith(IMAGE_LIBRARY_DIR) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendFile(filePath);
});

// ── List images ───────────────────────────────────────────────────────────────

router.get("/image-library", async (req, res): Promise<void> => {
  try {
    const { category } = req.query as { category?: string };
    const items = category && VALID_CATEGORIES.includes(category)
      ? await db.select().from(imageLibraryTable).where(eq(imageLibraryTable.category, category)).orderBy(imageLibraryTable.createdAt)
      : await db.select().from(imageLibraryTable).orderBy(imageLibraryTable.createdAt);
    res.json(items);
  } catch (err) {
    logger.error({ err }, "Failed to list image library");
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Upload (drag & drop) ──────────────────────────────────────────────────────

const upload = multer({
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const category = (req.query as { category?: string }).category ?? "other";
      cb(null, categoryDir(VALID_CATEGORIES.includes(category) ? category : "other"));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
});

router.post(
  "/image-library/upload",
  upload.single("image"),
  async (req, res): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      const category = (req.query as { category?: string }).category ?? "other";
      const safe = VALID_CATEGORIES.includes(category) ? category : "other";
      const [inserted] = await db
        .insert(imageLibraryTable)
        .values({
          filename: req.file.filename,
          category: safe,
          originalUrl: null,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
        })
        .returning();
      logger.info({ id: inserted.id, filename: req.file.filename }, "Image uploaded");
      res.status(201).json(inserted);
    } catch (err) {
      logger.error({ err }, "Upload failed");
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

// ── Delete ────────────────────────────────────────────────────────────────────

router.delete("/image-library/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
      10
    );
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [item] = await db
      .select()
      .from(imageLibraryTable)
      .where(eq(imageLibraryTable.id, id));
    if (!item) { res.status(404).json({ error: "Not found" }); return; }
    // Remove file from disk
    const filePath = path.join(IMAGE_LIBRARY_DIR, item.category, item.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await db.delete(imageLibraryTable).where(eq(imageLibraryTable.id, id));
    res.json({ deleted: true });
  } catch (err) {
    logger.error({ err }, "Delete failed");
    res.status(500).json({ error: "Delete failed" });
  }
});

// ── Harvest: scan template HTML/CSS for external image URLs ──────────────────

function downloadFile(url: string, dest: string): Promise<{ size: number; mime: string }> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const req = proto.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow one redirect
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (!res.statusCode || res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode ?? "?"} for ${url}`));
        return;
      }
      const mime = res.headers["content-type"]?.split(";")[0] ?? "image/jpeg";
      const out = fs.createWriteStream(dest);
      let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; });
      res.pipe(out);
      out.on("finish", () => resolve({ size, mime }));
      out.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function extractImageUrls(html: string): string[] {
  const urls = new Set<string>();
  // <img src="..."> and <img src='...'>
  const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html))) urls.add(m[1]);
  // CSS url("...") and url('...')
  const cssRe = /url\(["']?(https?:\/\/[^"')]+)["']?\)/gi;
  while ((m = cssRe.exec(html))) urls.add(m[1]);
  // srcset
  const srcsetRe = /srcset=["']([^"']+)["']/gi;
  while ((m = srcsetRe.exec(html))) {
    m[1].split(",").forEach((part) => {
      const u = part.trim().split(/\s+/)[0];
      if (u?.startsWith("http")) urls.add(u);
    });
  }
  return Array.from(urls).filter(
    (u) => /\.(jpe?g|png|webp|gif|svg|avif)(\?.*)?$/i.test(u) && u.startsWith("http")
  );
}

router.post("/image-library/harvest", async (req, res): Promise<void> => {
  // Respond immediately — harvest runs in background
  res.json({ message: "Harvest started" });

  (async () => {
    logger.info("Starting image harvest from templates");
    if (!fs.existsSync(TEMPLATES_DIR)) return;

    // Gather existing originalUrls to skip duplicates
    const existing = await db.select({ originalUrl: imageLibraryTable.originalUrl }).from(imageLibraryTable);
    const seen = new Set(existing.map((r) => r.originalUrl).filter(Boolean));

    // Get all templates from DB to know category
    const templates = await db.query.templatesTable.findMany();
    let downloaded = 0;
    let skipped = 0;

    for (const tmpl of templates) {
      const distDir = path.join(TEMPLATES_DIR, tmpl.filesPath, "dist");
      if (!fs.existsSync(distDir)) continue;
      const category = tmpl.category;

      // Read all .html and .css files in dist
      const files: string[] = [];
      function walk(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(html|css|js)$/.test(entry.name)) files.push(full);
        }
      }
      try { walk(distDir); } catch { continue; }

      const allUrls = new Set<string>();
      for (const f of files) {
        try {
          const content = fs.readFileSync(f, "utf8");
          extractImageUrls(content).forEach((u) => allUrls.add(u));
        } catch { /* skip */ }
      }

      for (const url of allUrls) {
        if (seen.has(url)) { skipped++; continue; }
        seen.add(url);
        const ext = (url.match(/\.(jpe?g|png|webp|gif|svg|avif)/i)?.[0] ?? ".jpg").toLowerCase();
        const filename = `${crypto.randomUUID()}${ext}`;
        const dest = path.join(categoryDir(category), filename);
        try {
          const { size, mime } = await downloadFile(url, dest);
          await db.insert(imageLibraryTable).values({
            filename,
            category,
            originalUrl: url,
            fileSize: size,
            mimeType: mime,
          });
          downloaded++;
          logger.info({ url, category, filename }, "Harvested image");
        } catch (err) {
          logger.warn({ url, err }, "Failed to download image during harvest");
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
        }
      }
    }
    logger.info({ downloaded, skipped }, "Harvest complete");
  })().catch((err) => logger.error({ err }, "Harvest failed"));
});

export default router;
