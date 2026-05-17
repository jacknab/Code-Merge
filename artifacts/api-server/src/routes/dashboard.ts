import { Router, type IRouter } from "express";
import { eq, count, sql } from "drizzle-orm";
import { db, websitesTable, templatesTable, pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const [totalWebsitesResult] = await db
    .select({ count: count() })
    .from(websitesTable);

  const [publishedWebsitesResult] = await db
    .select({ count: count() })
    .from(websitesTable)
    .where(eq(websitesTable.published, true));

  const [totalTemplatesResult] = await db
    .select({ count: count() })
    .from(templatesTable);

  const categoryResults = await db
    .select({
      category: templatesTable.category,
      count: count(),
    })
    .from(templatesTable)
    .groupBy(templatesTable.category);

  const templatesByCategory = {
    nail_salon: 0,
    barbershop: 0,
    hair_salon: 0,
  };

  for (const row of categoryResults) {
    if (row.category in templatesByCategory) {
      templatesByCategory[row.category as keyof typeof templatesByCategory] = Number(row.count);
    }
  }

  res.json({
    totalWebsites: Number(totalWebsitesResult?.count ?? 0),
    publishedWebsites: Number(publishedWebsitesResult?.count ?? 0),
    totalTemplates: Number(totalTemplatesResult?.count ?? 0),
    templatesByCategory,
  });
});

// ── Store info (business category for template filtering) ─────────────────────
router.get("/store-info", async (req, res): Promise<void> => {
  const storeid = req.query.storeid;
  if (!storeid || typeof storeid !== "string") {
    res.status(400).json({ error: "storeid is required" });
    return;
  }
  const id = parseInt(storeid, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "storeid must be a number" });
    return;
  }
  const result = await pool.query<{ category: string | null }>(
    "SELECT category FROM locations WHERE id = $1 LIMIT 1",
    [id],
  );
  if (!result.rows.length) {
    res.status(404).json({ error: "Store not found" });
    return;
  }
  res.json({ category: result.rows[0].category });
});

export default router;
