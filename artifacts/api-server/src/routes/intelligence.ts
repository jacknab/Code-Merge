import { Router } from "express";
import { db } from "../db";
import { customers, appointments, staff, smsSettings } from "@shared/schema";
import { clientEmails } from "@shared/schema/clients";
import {
  clientIntelligence,
  staffIntelligence,
  growthScoreSnapshots,
  intelligenceInterventions,
} from "@shared/schema/intelligence";
import { eq, and, desc, gte, sql, inArray, lte, isNotNull } from "drizzle-orm";
import { runIntelligenceForStore } from "../intelligence/orchestrator";
import { computeDeadSeats } from "../intelligence/dead-seats";
import { computeNoShowRisks, getNoShowStats } from "../intelligence/no-show";
import { computeRebookingRates } from "../intelligence/rebooking-rates";
import { computeGrowthScore } from "../intelligence/growth-score";
import { computeRevenueLeakage } from "../intelligence/revenue-leakage";
import { runDriftRecovery, sendManualWinback } from "../intelligence/drift-recovery";
import {
  getCancellationRecoveryCandidates,
  sendCancellationRecoverySms,
} from "../intelligence/cancellation-recovery";

const router = Router();

function requireStoreId(req: any, res: any): number | null {
  const storeId = parseInt(req.query.storeId as string);
  if (!storeId || isNaN(storeId)) {
    res.status(400).json({ error: "storeId is required" });
    return null;
  }
  return storeId;
}

// GET /api/intelligence/dashboard
// Returns the full intelligence dashboard data for a store
router.get("/dashboard", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    // Get the latest growth score
    const [latestScore] = await db
      .select()
      .from(growthScoreSnapshots)
      .where(eq(growthScoreSnapshots.storeId, storeId))
      .orderBy(desc(growthScoreSnapshots.snapshotDate))
      .limit(1);

    // Get at-risk clients (high churn score, sorted by LTV desc)
    const atRiskClients = await db
      .select({
        id: clientIntelligence.id,
        customerId: clientIntelligence.customerId,
        customerName: customers.name,
        customerPhone: customers.phone,
        churnRiskScore: clientIntelligence.churnRiskScore,
        churnRiskLabel: clientIntelligence.churnRiskLabel,
        ltv12Month: clientIntelligence.ltv12Month,
        ltvScore: clientIntelligence.ltvScore,
        daysSinceLast: clientIntelligence.daysSinceLastVisit,
        avgCadenceDays: clientIntelligence.avgVisitCadenceDays,
        lastWinbackSentAt: clientIntelligence.lastWinbackSentAt,
        isDrifting: clientIntelligence.isDrifting,
        isAtRisk: clientIntelligence.isAtRisk,
      })
      .from(clientIntelligence)
      .leftJoin(customers, eq(clientIntelligence.customerId, customers.id))
      .where(
        and(
          eq(clientIntelligence.storeId, storeId),
          sql`churn_risk_score >= 25`
        )
      )
      .orderBy(desc(clientIntelligence.ltv12Month), desc(clientIntelligence.churnRiskScore))
      .limit(20);

    // Get score history (last 30 days)
    const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const scoreHistory = await db
      .select({
        score: growthScoreSnapshots.overallScore,
        date: growthScoreSnapshots.snapshotDate,
      })
      .from(growthScoreSnapshots)
      .where(
        and(
          eq(growthScoreSnapshots.storeId, storeId),
          gte(growthScoreSnapshots.snapshotDate, last30)
        )
      )
      .orderBy(growthScoreSnapshots.snapshotDate);

    // Recent interventions
    const recentInterventions = await db
      .select({
        id: intelligenceInterventions.id,
        type: intelligenceInterventions.interventionType,
        channel: intelligenceInterventions.channel,
        status: intelligenceInterventions.status,
        triggeredBy: intelligenceInterventions.triggeredBy,
        sentAt: intelligenceInterventions.sentAt,
        customerName: customers.name,
      })
      .from(intelligenceInterventions)
      .leftJoin(customers, eq(intelligenceInterventions.customerId, customers.id))
      .where(eq(intelligenceInterventions.storeId, storeId))
      .orderBy(desc(intelligenceInterventions.sentAt))
      .limit(10);

    // Summary stats
    const [clientStats] = await db
      .select({
        total: sql<number>`COUNT(*)`,
        drifting: sql<number>`SUM(CASE WHEN is_drifting THEN 1 ELSE 0 END)`,
        atRisk: sql<number>`SUM(CASE WHEN is_at_risk THEN 1 ELSE 0 END)`,
        avgLtv12: sql<string>`COALESCE(AVG(CAST(ltv_12_month AS DECIMAL(10,2))), 0)`,
      })
      .from(clientIntelligence)
      .where(eq(clientIntelligence.storeId, storeId));

    res.json({
      latestScore: latestScore || null,
      atRiskClients,
      scoreHistory,
      recentInterventions,
      summary: {
        totalClients: Number(clientStats?.total || 0),
        driftingClients: Number(clientStats?.drifting || 0),
        atRiskClients: Number(clientStats?.atRisk || 0),
        avgLtv12Month: parseFloat(clientStats?.avgLtv12 || "0"),
        lastComputedAt: latestScore?.snapshotDate || null,
      },
    });
  } catch (err: any) {
    console.error("[intelligence] dashboard error:", err);
    res.status(500).json({ error: "Failed to fetch intelligence dashboard" });
  }
});

// GET /api/intelligence/growth-score
// Returns full growth score breakdown + history
router.get("/growth-score", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const [latestSnapshot] = await db
      .select()
      .from(growthScoreSnapshots)
      .where(eq(growthScoreSnapshots.storeId, storeId))
      .orderBy(desc(growthScoreSnapshots.snapshotDate))
      .limit(1);

    const history = await db
      .select()
      .from(growthScoreSnapshots)
      .where(eq(growthScoreSnapshots.storeId, storeId))
      .orderBy(desc(growthScoreSnapshots.snapshotDate))
      .limit(30);

    // Also compute live
    const [clientStats] = await db
      .select({
        total: sql<number>`COUNT(*)`,
        drifting: sql<number>`SUM(CASE WHEN is_drifting THEN 1 ELSE 0 END)`,
        atRisk: sql<number>`SUM(CASE WHEN is_at_risk THEN 1 ELSE 0 END)`,
        avgRebooking: sql<string>`COALESCE(AVG(CAST(rebooking_rate AS DECIMAL(10,2))), 0)`,
      })
      .from(clientIntelligence)
      .where(eq(clientIntelligence.storeId, storeId));

    const deadSeats = await computeDeadSeats(storeId);

    const liveScore = await computeGrowthScore(
      storeId,
      {
        activeClients: Number(clientStats?.total || 0),
        driftingClients: Number(clientStats?.drifting || 0),
        atRiskClients: Number(clientStats?.atRisk || 0),
        avgRebookingRate: parseFloat(clientStats?.avgRebooking || "0"),
      },
      deadSeats.overallUtilization
    );

    res.json({ snapshot: latestSnapshot, history: history.reverse(), live: liveScore });
  } catch (err: any) {
    console.error("[intelligence] growth-score error:", err);
    res.status(500).json({ error: "Failed to fetch growth score" });
  }
});

// GET /api/intelligence/revenue-leakage
router.get("/revenue-leakage", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const deadSeats = await computeDeadSeats(storeId);
    const report = await computeRevenueLeakage(storeId, deadSeats.totalLostRevenuePotential / 3);
    res.json(report);
  } catch (err: any) {
    console.error("[intelligence] revenue-leakage error:", err);
    res.status(500).json({ error: "Failed to compute revenue leakage" });
  }
});

// GET /api/intelligence/dead-seats
router.get("/dead-seats", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const report = await computeDeadSeats(storeId);
    res.json(report);
  } catch (err: any) {
    console.error("[intelligence] dead-seats error:", err);
    res.status(500).json({ error: "Failed to compute dead seats" });
  }
});

// GET /api/intelligence/no-show-risks
router.get("/no-show-risks", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    // Default: tomorrow
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const risks = await computeNoShowRisks(storeId, tomorrow);
    const stats = await getNoShowStats(storeId);
    res.json({ risks, stats });
  } catch (err: any) {
    console.error("[intelligence] no-show-risks error:", err);
    res.status(500).json({ error: "Failed to compute no-show risks" });
  }
});

// GET /api/intelligence/rebooking-rates
router.get("/rebooking-rates", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const stats = await computeRebookingRates(storeId);

    // Also get from DB
    const dbStats = await db
      .select()
      .from(staffIntelligence)
      .where(eq(staffIntelligence.storeId, storeId))
      .orderBy(desc(staffIntelligence.rebookingRatePct));

    res.json({ live: stats, cached: dbStats });
  } catch (err: any) {
    console.error("[intelligence] rebooking-rates error:", err);
    res.status(500).json({ error: "Failed to compute rebooking rates" });
  }
});

// GET /api/intelligence/at-risk-clients
router.get("/at-risk-clients", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const atRiskClients = await db
      .select({
        customerId: clientIntelligence.customerId,
        customerName: customers.name,
        customerPhone: customers.phone,
        customerEmail: customers.email,
        churnRiskScore: clientIntelligence.churnRiskScore,
        churnRiskLabel: clientIntelligence.churnRiskLabel,
        ltv12Month: clientIntelligence.ltv12Month,
        ltvAllTime: clientIntelligence.ltvAllTime,
        ltvScore: clientIntelligence.ltvScore,
        daysSinceLast: clientIntelligence.daysSinceLastVisit,
        avgCadenceDays: clientIntelligence.avgVisitCadenceDays,
        daysOverduePct: clientIntelligence.daysOverduePct,
        totalVisits: clientIntelligence.totalVisits,
        noShowRate: clientIntelligence.noShowRate,
        lastWinbackSentAt: clientIntelligence.lastWinbackSentAt,
        isDrifting: clientIntelligence.isDrifting,
        isAtRisk: clientIntelligence.isAtRisk,
        marketingOptIn: customers.marketingOptIn,
      })
      .from(clientIntelligence)
      .leftJoin(customers, eq(clientIntelligence.customerId, customers.id))
      .where(
        and(
          eq(clientIntelligence.storeId, storeId),
          sql`churn_risk_score >= 25`,
          sql`COALESCE(total_visits, 0) > 1`
        )
      )
      .orderBy(desc(clientIntelligence.ltv12Month), desc(clientIntelligence.churnRiskScore))
      .limit(50);

    res.json(atRiskClients);
  } catch (err: any) {
    console.error("[intelligence] at-risk-clients error:", err);
    res.status(500).json({ error: "Failed to fetch at-risk clients" });
  }
});

// GET /api/intelligence/cancellation-recovery/:appointmentId
router.get("/cancellation-recovery/:appointmentId", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  const appointmentId = parseInt(req.params.appointmentId);
  if (!appointmentId) return res.status(400).json({ error: "Invalid appointment ID" });

  try {
    const candidates = await getCancellationRecoveryCandidates(storeId, appointmentId);
    res.json(candidates);
  } catch (err: any) {
    console.error("[intelligence] cancellation-recovery error:", err);
    res.status(500).json({ error: "Failed to find recovery candidates" });
  }
});

// POST /api/intelligence/winback
router.post("/winback", async (req, res) => {
  const { storeId, customerId, manual } = req.body;
  if (!storeId || !customerId) {
    return res.status(400).json({ error: "storeId and customerId required" });
  }

  try {
    const result = await sendManualWinback(storeId, customerId);
    res.json(result);
  } catch (err: any) {
    console.error("[intelligence] winback error:", err);
    res.status(500).json({ error: "Failed to send winback message" });
  }
});

// POST /api/intelligence/winback-campaign
// Runs the automated drift recovery for a store
router.post("/winback-campaign", async (req, res) => {
  const { storeId, dryRun } = req.body;
  if (!storeId) return res.status(400).json({ error: "storeId required" });

  try {
    const result = await runDriftRecovery(storeId, dryRun === true);
    res.json(result);
  } catch (err: any) {
    console.error("[intelligence] winback-campaign error:", err);
    res.status(500).json({ error: "Failed to run winback campaign" });
  }
});

// POST /api/intelligence/fill-slot
router.post("/fill-slot", async (req, res) => {
  const { storeId, customerId, message, cancelledAppointmentId } = req.body;
  if (!storeId || !customerId || !message) {
    return res.status(400).json({ error: "storeId, customerId, and message required" });
  }

  try {
    const result = await sendCancellationRecoverySms(storeId, customerId, message, cancelledAppointmentId);
    res.json(result);
  } catch (err: any) {
    console.error("[intelligence] fill-slot error:", err);
    res.status(500).json({ error: "Failed to send fill-slot SMS" });
  }
});

// GET /api/intelligence/forecast
router.get("/forecast", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const [clientStats] = await db
      .select({
        drifting: sql<number>`COALESCE(SUM(CASE WHEN is_drifting THEN 1 ELSE 0 END), 0)`,
        avgLtv: sql<string>`COALESCE(AVG(CAST(ltv_12_month AS DECIMAL(10,2))), 0)`,
      })
      .from(clientIntelligence)
      .where(eq(clientIntelligence.storeId, storeId));

    const { computeRevenueForecast } = await import("../intelligence/revenue-forecast");
    const forecast = await computeRevenueForecast(
      storeId,
      Number(clientStats?.drifting || 0),
      parseFloat(clientStats?.avgLtv || "0")
    );

    res.json(forecast);
  } catch (err: any) {
    console.error("[intelligence] forecast error:", err);
    res.status(500).json({ error: "Failed to compute revenue forecast" });
  }
});

// GET /api/intelligence/client/:customerId
// Returns intelligence data for a single client
router.get("/client/:customerId", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  const customerId = parseInt(req.params.customerId);
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: "Invalid customerId" });
  }

  try {
    const [intel] = await db
      .select({
        avgVisitCadenceDays: clientIntelligence.avgVisitCadenceDays,
        lastVisitDate: clientIntelligence.lastVisitDate,
        nextExpectedVisitDate: clientIntelligence.nextExpectedVisitDate,
        daysSinceLastVisit: clientIntelligence.daysSinceLastVisit,
        daysOverduePct: clientIntelligence.daysOverduePct,
        totalVisits: clientIntelligence.totalVisits,
        totalRevenue: clientIntelligence.totalRevenue,
        avgTicketValue: clientIntelligence.avgTicketValue,
        ltv12Month: clientIntelligence.ltv12Month,
        ltvAllTime: clientIntelligence.ltvAllTime,
        ltvScore: clientIntelligence.ltvScore,
        churnRiskScore: clientIntelligence.churnRiskScore,
        churnRiskLabel: clientIntelligence.churnRiskLabel,
        noShowRate: clientIntelligence.noShowRate,
        rebookingRate: clientIntelligence.rebookingRate,
        isDrifting: clientIntelligence.isDrifting,
        isAtRisk: clientIntelligence.isAtRisk,
        lastWinbackSentAt: clientIntelligence.lastWinbackSentAt,
        winbackSentCount: clientIntelligence.winbackSentCount,
        computedAt: clientIntelligence.computedAt,
      })
      .from(clientIntelligence)
      .where(
        and(
          eq(clientIntelligence.storeId, storeId),
          eq(clientIntelligence.customerId, customerId)
        )
      )
      .limit(1);

    // Get recent interventions for this client
    const recentInterventions = await db
      .select({
        id: intelligenceInterventions.id,
        type: intelligenceInterventions.interventionType,
        channel: intelligenceInterventions.channel,
        status: intelligenceInterventions.status,
        triggeredBy: intelligenceInterventions.triggeredBy,
        sentAt: intelligenceInterventions.sentAt,
      })
      .from(intelligenceInterventions)
      .where(
        and(
          eq(intelligenceInterventions.storeId, storeId),
          eq(intelligenceInterventions.customerId, customerId)
        )
      )
      .orderBy(desc(intelligenceInterventions.sentAt))
      .limit(5);

    res.json({ intel: intel || null, interventions: recentInterventions });
  } catch (err: any) {
    console.error("[intelligence] client error:", err);
    res.status(500).json({ error: "Failed to fetch client intelligence" });
  }
});

// GET /api/intelligence/staff-performance
// Returns enriched staff performance combining rebooking rates + appointment stats
router.get("/staff-performance", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const rows = await db.execute(
      sql`SELECT
            s.id AS staff_id,
            s.name AS staff_name,
            s.role AS staff_role,
            COUNT(a.id) FILTER (WHERE a.status IN ('completed','started')) AS completed_count,
            COUNT(a.id) FILTER (WHERE a.status = 'no_show') AS no_show_count,
            COUNT(a.id) FILTER (WHERE a.status = 'cancelled') AS cancelled_count,
            COUNT(DISTINCT a.customer_id) FILTER (WHERE a.status IN ('completed','started')) AS unique_clients,
            COALESCE(SUM(CAST(a.total_paid AS DECIMAL(10,2))) FILTER (WHERE a.status = 'completed'), 0)::float AS total_revenue,
            COALESCE(AVG(CAST(a.total_paid AS DECIMAL(10,2))) FILTER (WHERE a.status = 'completed'), 0)::float AS avg_ticket
          FROM staff s
          LEFT JOIN appointments a ON a.staff_id = s.id
            AND a.store_id = ${storeId}
            AND a.date >= ${ninetyDaysAgo.toISOString()}
          WHERE s.store_id = ${storeId}
            AND s.active = true
          GROUP BY s.id, s.name, s.role
          ORDER BY total_revenue DESC`
    );

    const staffList = (rows.rows as any[]).map((r) => ({
      staffId: r.staff_id,
      staffName: r.staff_name,
      staffRole: r.staff_role,
      completedCount: parseInt(r.completed_count || "0"),
      noShowCount: parseInt(r.no_show_count || "0"),
      cancelledCount: parseInt(r.cancelled_count || "0"),
      uniqueClients: parseInt(r.unique_clients || "0"),
      totalRevenue: parseFloat(r.total_revenue || "0"),
      avgTicket: parseFloat(r.avg_ticket || "0"),
    }));

    // Merge rebooking rates from staffIntelligence table
    const rebookingRows = await db
      .select({
        staffId: staffIntelligence.staffId,
        rebookingRatePct: staffIntelligence.rebookingRatePct,
        trend: staffIntelligence.trend,
      })
      .from(staffIntelligence)
      .where(eq(staffIntelligence.storeId, storeId));

    const rebookingMap = new Map(rebookingRows.map((r) => [r.staffId, r]));

    const enriched = staffList.map((s) => {
      const rb = rebookingMap.get(s.staffId);
      const noShowRate = s.completedCount > 0 ? Math.round((s.noShowCount / (s.completedCount + s.noShowCount)) * 100) : 0;
      return {
        ...s,
        rebookingRatePct: rb?.rebookingRatePct ?? 0,
        trend: rb?.trend ?? "flat",
        noShowRate,
        revenueRank: 0,
      };
    });

    // Assign revenue rank
    enriched.forEach((s, i) => { s.revenueRank = i + 1; });

    res.json(enriched);
  } catch (err: any) {
    console.error("[intelligence] staff-performance error:", err);
    res.status(500).json({ error: "Failed to fetch staff performance" });
  }
});

// GET /api/intelligence/service-suggestion/:customerId
// Returns the most-booked service for a returning client
router.get("/service-suggestion/:customerId", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  const customerId = parseInt(req.params.customerId);
  if (!customerId) return res.status(400).json({ error: "Invalid customerId" });

  try {
    const rows = await db.execute(
      sql`SELECT
            a.service_id,
            s.name AS service_name,
            s.price AS service_price,
            s.duration AS service_duration,
            COUNT(*) AS visit_count,
            MAX(a.date) AS last_booked_at
          FROM appointments a
          JOIN services s ON s.id = a.service_id
          WHERE a.store_id = ${storeId}
            AND a.customer_id = ${customerId}
            AND a.status IN ('completed', 'started', 'confirmed')
          GROUP BY a.service_id, s.name, s.price, s.duration
          ORDER BY visit_count DESC
          LIMIT 3`
    );

    const suggestions = (rows.rows as any[]).map((r) => ({
      serviceId: r.service_id,
      serviceName: r.service_name,
      servicePrice: parseFloat(r.service_price || "0"),
      serviceDuration: parseInt(r.service_duration || "0"),
      visitCount: parseInt(r.visit_count || "0"),
      lastBookedAt: r.last_booked_at,
    }));

    res.json(suggestions);
  } catch (err: any) {
    console.error("[intelligence] service-suggestion error:", err);
    res.status(500).json({ error: "Failed to fetch service suggestion" });
  }
});

// GET /api/intelligence/daily-digest
// Returns today's most important actions in priority order
router.get("/daily-digest", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const actions: Array<{ type: string; priority: number; label: string; detail: string; count?: number; revenueAtStake?: number; tab: string; ctaLabel: string }> = [];

    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Run all count + revenue queries in parallel
    const [
      [noShowRiskToday], [noShowRevenueRow],
      [criticalChurnRow], [criticalChurnRevenueRow],
      [cancellationRow], [cancellationRevenueRow],
      [driftingHighLtv], [driftingRevenueRow],
      [nudgeRow], [nudgeRevenueRow],
      [todayRevenueRow],
    ] = await Promise.all([
      // 1a. No-show risk count
      db.execute(
        sql`SELECT COUNT(*)::int AS cnt
            FROM appointments a
            JOIN client_intelligence ci ON ci.customer_id = a.customer_id AND ci.store_id = a.store_id
            WHERE a.store_id = ${storeId}
              AND a.date >= ${todayStart.toISOString()}
              AND a.date <= ${todayEnd.toISOString()}
              AND a.status IN ('pending', 'confirmed')
              AND CAST(ci.no_show_rate AS DECIMAL) >= 40`
      ),
      // 1b. No-show revenue at stake
      db.execute(
        sql`SELECT COALESCE(SUM(CAST(s.price AS DECIMAL)), 0)::float AS rev
            FROM appointments a
            JOIN client_intelligence ci ON ci.customer_id = a.customer_id AND ci.store_id = a.store_id
            LEFT JOIN services s ON s.id = a.service_id
            WHERE a.store_id = ${storeId}
              AND a.date >= ${todayStart.toISOString()}
              AND a.date <= ${todayEnd.toISOString()}
              AND a.status IN ('pending', 'confirmed')
              AND CAST(ci.no_show_rate AS DECIMAL) >= 40`
      ),
      // 2a. Critical churn count
      db.execute(
        sql`SELECT COUNT(*)::int AS cnt
            FROM client_intelligence ci
            WHERE ci.store_id = ${storeId}
              AND ci.churn_risk_label = 'critical'
              AND (ci.last_winback_sent_at IS NULL OR ci.last_winback_sent_at < ${sevenDaysAgo.toISOString()})`
      ),
      // 2b. Critical churn LTV at stake (annual value)
      db.execute(
        sql`SELECT COALESCE(SUM(ci.ltv_12_month::numeric), 0)::float AS rev
            FROM client_intelligence ci
            WHERE ci.store_id = ${storeId}
              AND ci.churn_risk_label = 'critical'
              AND (ci.last_winback_sent_at IS NULL OR ci.last_winback_sent_at < ${sevenDaysAgo.toISOString()})`
      ),
      // 3a. Cancellations today count
      db.execute(
        sql`SELECT COUNT(*)::int AS cnt
            FROM appointments a
            WHERE a.store_id = ${storeId}
              AND a.date >= ${todayStart.toISOString()}
              AND a.date <= ${todayEnd.toISOString()}
              AND a.status = 'cancelled'`
      ),
      // 3b. Cancellation revenue at stake
      db.execute(
        sql`SELECT COALESCE(SUM(CAST(s.price AS DECIMAL)), 0)::float AS rev
            FROM appointments a
            LEFT JOIN services s ON s.id = a.service_id
            WHERE a.store_id = ${storeId}
              AND a.date >= ${todayStart.toISOString()}
              AND a.date <= ${todayEnd.toISOString()}
              AND a.status = 'cancelled'`
      ),
      // 4a. Drifting high-LTV count
      db.execute(
        sql`SELECT COUNT(*)::int AS cnt
            FROM client_intelligence ci
            WHERE ci.store_id = ${storeId}
              AND ci.is_drifting = true
              AND ci.ltv_12_month::numeric >= 200
              AND (ci.last_winback_sent_at IS NULL OR ci.last_winback_sent_at < ${sevenDaysAgo.toISOString()})`
      ),
      // 4b. Drifting LTV at stake (annual)
      db.execute(
        sql`SELECT COALESCE(SUM(ci.ltv_12_month::numeric), 0)::float AS rev
            FROM client_intelligence ci
            WHERE ci.store_id = ${storeId}
              AND ci.is_drifting = true
              AND ci.ltv_12_month::numeric >= 200
              AND (ci.last_winback_sent_at IS NULL OR ci.last_winback_sent_at < ${sevenDaysAgo.toISOString()})`
      ),
      // 5a. Rebooking nudge count
      db.execute(
        sql`SELECT COUNT(*)::int AS cnt
            FROM client_intelligence ci
            WHERE ci.store_id = ${storeId}
              AND ci.next_expected_visit_date IS NOT NULL
              AND ci.next_expected_visit_date >= ${now.toISOString()}
              AND ci.next_expected_visit_date <= ${in3Days.toISOString()}
              AND NOT EXISTS (
                SELECT 1 FROM appointments a
                WHERE a.store_id = ${storeId}
                  AND a.customer_id = ci.customer_id
                  AND a.status IN ('pending','confirmed')
                  AND a.date >= ${now.toISOString()}
              )`
      ),
      // 5b. Rebooking nudge revenue potential (avg ticket × count)
      db.execute(
        sql`SELECT COALESCE(AVG(ci.avg_ticket_value::numeric), 0)::float AS avg_ticket
            FROM client_intelligence ci
            WHERE ci.store_id = ${storeId}
              AND ci.next_expected_visit_date IS NOT NULL
              AND ci.next_expected_visit_date >= ${now.toISOString()}
              AND ci.next_expected_visit_date <= ${in3Days.toISOString()}
              AND NOT EXISTS (
                SELECT 1 FROM appointments a
                WHERE a.store_id = ${storeId}
                  AND a.customer_id = ci.customer_id
                  AND a.status IN ('pending','confirmed')
                  AND a.date >= ${now.toISOString()}
              )`
      ),
      // Revenue today (completed + started)
      db.execute(
        sql`SELECT COALESCE(SUM(CAST(total_paid AS DECIMAL(10,2))), 0)::float AS rev
            FROM appointments
            WHERE store_id = ${storeId}
              AND date >= ${todayStart.toISOString()}
              AND date <= ${todayEnd.toISOString()}
              AND status IN ('completed', 'started')`
      ),
    ]);

    const noShowRisk = parseInt((noShowRiskToday as any)?.cnt || "0");
    if (noShowRisk > 0) {
      const rev = parseFloat((noShowRevenueRow as any)?.rev || "0");
      actions.push({
        type: "no_show_risk",
        priority: 1,
        label: `${noShowRisk} high-risk appointment${noShowRisk > 1 ? "s" : ""} today`,
        detail: "Clients with a history of no-shows — confirm attendance before they slip away",
        count: noShowRisk,
        revenueAtStake: rev,
        tab: "noshow",
        ctaLabel: "Review no-show risks",
      });
    }

    const criticalChurn = parseInt((criticalChurnRow as any)?.cnt || "0");
    if (criticalChurn > 0) {
      const rev = parseFloat((criticalChurnRevenueRow as any)?.rev || "0");
      actions.push({
        type: "critical_churn",
        priority: 2,
        label: `${criticalChurn} critical-risk client${criticalChurn > 1 ? "s" : ""} need outreach`,
        detail: "High-LTV clients who haven't visited in a long time — act now before they're gone",
        count: criticalChurn,
        revenueAtStake: rev,
        tab: "clients",
        ctaLabel: "View at-risk clients",
      });
    }

    const cancelledToday = parseInt((cancellationRow as any)?.cnt || "0");
    if (cancelledToday > 0) {
      const rev = parseFloat((cancellationRevenueRow as any)?.rev || "0");
      actions.push({
        type: "cancellation_recovery",
        priority: 3,
        label: `${cancelledToday} cancellation${cancelledToday > 1 ? "s" : ""} — open slots today`,
        detail: "Fill these slots by messaging waitlisted or lapsed clients",
        count: cancelledToday,
        revenueAtStake: rev,
        tab: "seats",
        ctaLabel: "Find replacements",
      });
    }

    const driftingHighLtvCount = parseInt((driftingHighLtv as any)?.cnt || "0");
    if (driftingHighLtvCount > 0) {
      const rev = parseFloat((driftingRevenueRow as any)?.rev || "0");
      actions.push({
        type: "high_ltv_drifting",
        priority: 4,
        label: `${driftingHighLtvCount} high-value client${driftingHighLtvCount > 1 ? "s" : ""} drifting`,
        detail: "Top spenders whose visit frequency is slipping — ideal for a win-back campaign",
        count: driftingHighLtvCount,
        revenueAtStake: rev,
        tab: "clients",
        ctaLabel: "Start win-back campaign",
      });
    }

    const nudgeCount = parseInt((nudgeRow as any)?.cnt || "0");
    if (nudgeCount > 0) {
      const avgTicket = parseFloat((nudgeRevenueRow as any)?.avg_ticket || "0");
      actions.push({
        type: "rebooking_nudge",
        priority: 5,
        label: `${nudgeCount} client${nudgeCount > 1 ? "s" : ""} due for a visit soon`,
        detail: "Their next expected visit is in 1-3 days but nothing is booked yet",
        count: nudgeCount,
        revenueAtStake: nudgeCount * avgTicket,
        tab: "overview",
        ctaLabel: "Send booking nudges",
      });
    }

    const todayRevenue = parseFloat((todayRevenueRow as any)?.rev || "0");

    actions.sort((a, b) => a.priority - b.priority);

    res.json({
      actions: actions.slice(0, 5),
      todayRevenue,
      totalActions: actions.length,
    });
  } catch (err: any) {
    console.error("[intelligence] daily-digest error:", err);
    res.status(500).json({ error: "Failed to fetch daily digest" });
  }
});

// GET /api/intelligence/service-performance
// Analyzes services by revenue, no-show rate, avg ticket
router.get("/service-performance", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const rows = await db.execute(
      sql`SELECT
        s.id AS service_id,
        s.name AS service_name,
        s.price AS service_price,
        s.duration AS service_duration,
        COUNT(a.id) AS total_bookings,
        SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) AS no_show_count,
        SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
        COALESCE(SUM(CASE WHEN a.status = 'completed' THEN CAST(a.total_paid AS DECIMAL(10,2)) ELSE 0 END), 0) AS total_revenue,
        COALESCE(AVG(CASE WHEN a.status = 'completed' THEN CAST(a.total_paid AS DECIMAL(10,2)) END), 0) AS avg_ticket
      FROM services s
      LEFT JOIN appointments a ON a.service_id = s.id
        AND a.store_id = ${storeId}
        AND a.date >= ${ninetyDaysAgo}
      WHERE s.store_id = ${storeId} AND s.active = true
      GROUP BY s.id, s.name, s.price, s.duration
      ORDER BY total_revenue DESC
      LIMIT 30`
    );

    const services = rows.rows.map((r: any) => {
      const totalBookings = Number(r.total_bookings);
      const noShowCount = Number(r.no_show_count);
      const completedCount = Number(r.completed_count);
      const noShowRate = totalBookings > 0 ? Math.round((noShowCount / totalBookings) * 100) : 0;
      const completionRate = totalBookings > 0 ? Math.round((completedCount / totalBookings) * 100) : 0;
      const duration = Number(r.service_duration) || 60;
      const avgTicket = parseFloat(r.avg_ticket) || 0;
      const revenuePerMin = duration > 0 ? (avgTicket / duration) : 0;

      return {
        serviceId: r.service_id,
        serviceName: r.service_name,
        servicePrice: parseFloat(r.service_price) || 0,
        duration,
        totalBookings,
        completedCount,
        noShowCount,
        cancelledCount: Number(r.cancelled_count),
        totalRevenue: parseFloat(r.total_revenue) || 0,
        avgTicket,
        noShowRate,
        completionRate,
        revenuePerMin: Math.round(revenuePerMin * 100) / 100,
      };
    });

    // Generate insights
    const insights: string[] = [];
    const highNoShow = services.filter(s => s.noShowRate > 20 && s.totalBookings >= 5);
    if (highNoShow.length > 0) {
      insights.push(`"${highNoShow[0].serviceName}" has a ${highNoShow[0].noShowRate}% no-show rate — consider requiring a deposit for this service.`);
    }
    const topRevMin = services.filter(s => s.revenuePerMin > 0).sort((a, b) => b.revenuePerMin - a.revenuePerMin)[0];
    if (topRevMin) {
      insights.push(`"${topRevMin.serviceName}" generates $${topRevMin.revenuePerMin.toFixed(2)}/min — your most efficient service.`);
    }

    res.json({ services, insights });
  } catch (err: any) {
    console.error("[intelligence] service-performance error:", err);
    res.status(500).json({ error: "Failed to fetch service performance" });
  }
});

// GET /api/intelligence/campaigns/segments
// Returns segment counts for campaign targeting
router.get("/campaigns/segments", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const [atRisk] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(clientIntelligence)
      .leftJoin(customers, eq(clientIntelligence.customerId, customers.id))
      .where(
        and(
          eq(clientIntelligence.storeId, storeId),
          sql`churn_risk_label IN ('high','critical')`,
          isNotNull(customers.phone),
          sql`(customers.marketing_opt_in IS NULL OR customers.marketing_opt_in = true)`
        )
      );

    const [drifting] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(clientIntelligence)
      .leftJoin(customers, eq(clientIntelligence.customerId, customers.id))
      .where(
        and(
          eq(clientIntelligence.storeId, storeId),
          eq(clientIntelligence.isDrifting, true),
          isNotNull(customers.phone),
          sql`(customers.marketing_opt_in IS NULL OR customers.marketing_opt_in = true)`
        )
      );

    const [highLtv] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(clientIntelligence)
      .leftJoin(customers, eq(clientIntelligence.customerId, customers.id))
      .where(
        and(
          eq(clientIntelligence.storeId, storeId),
          sql`CAST(ltv_12_month AS DECIMAL) > 200`,
          isNotNull(customers.phone),
          sql`(customers.marketing_opt_in IS NULL OR customers.marketing_opt_in = true)`
        )
      );

    res.json({
      segments: [
        { id: "at_risk", label: "At-Risk Clients", description: "High or critical churn risk", count: Number(atRisk?.count || 0), color: "red" },
        { id: "drifting", label: "Drifting Clients", description: "Visit frequency declining", count: Number(drifting?.count || 0), color: "amber" },
        { id: "high_ltv", label: "High-Value Clients", description: "LTV > $200 in last 12 months", count: Number(highLtv?.count || 0), color: "violet" },
      ],
    });
  } catch (err: any) {
    console.error("[intelligence] campaigns/segments error:", err);
    res.status(500).json({ error: "Failed to fetch segments" });
  }
});

// GET /api/intelligence/campaigns/export
// Export a client segment as CSV
router.get("/campaigns/export", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;
  const segment = req.query.segment as string;
  if (!segment) return res.status(400).json({ error: "segment required" });

  try {
    let rows: { name: string; phone: string | null; email: string | null }[] = [];

    if (segment === "at_risk" || segment === "drifting" || segment === "high_ltv") {
      const condition = segment === "at_risk"
        ? sql`churn_risk_label IN ('high','critical')`
        : segment === "drifting"
        ? eq(clientIntelligence.isDrifting, true)
        : sql`CAST(ltv_12_month AS DECIMAL) > 200`;

      const data = await db
        .select({ name: customers.name, phone: customers.phone, email: customers.email })
        .from(clientIntelligence)
        .leftJoin(customers, eq(clientIntelligence.customerId, customers.id))
        .where(and(eq(clientIntelligence.storeId, storeId), condition));
      rows = data.map(r => ({ name: r.name!, phone: r.phone, email: r.email }));
    }

    const csv = ["Name,Phone,Email", ...rows.map(r =>
      `"${(r.name || "").replace(/"/g, '""')}","${r.phone || ""}","${r.email || ""}"`
    )].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="segment-${segment}.csv"`);
    res.send(csv);
  } catch (err: any) {
    console.error("[intelligence] campaigns/export error:", err);
    res.status(500).json({ error: "Export failed" });
  }
});

// POST /api/intelligence/campaigns/send
// Sends a bulk SMS campaign to a segment
router.post("/campaigns/send", async (req, res) => {
  const { storeId, segment, message, dryRun } = req.body;
  if (!storeId || !segment || !message) {
    return res.status(400).json({ error: "storeId, segment, and message required" });
  }

  try {
    let customerRows: { id: number; phone: string | null; name: string }[] = [];

    if (segment === "at_risk") {
      const rows = await db
        .select({ id: customers.id, phone: customers.phone, name: customers.name })
        .from(clientIntelligence)
        .leftJoin(customers, eq(clientIntelligence.customerId, customers.id))
        .where(
          and(
            eq(clientIntelligence.storeId, storeId),
            sql`churn_risk_label IN ('high','critical')`,
            isNotNull(customers.phone),
            sql`(customers.marketing_opt_in IS NULL OR customers.marketing_opt_in = true)`
          )
        );
      customerRows = rows.map(r => ({ id: r.id!, phone: r.phone, name: r.name! }));
    } else if (segment === "drifting") {
      const rows = await db
        .select({ id: customers.id, phone: customers.phone, name: customers.name })
        .from(clientIntelligence)
        .leftJoin(customers, eq(clientIntelligence.customerId, customers.id))
        .where(
          and(
            eq(clientIntelligence.storeId, storeId),
            eq(clientIntelligence.isDrifting, true),
            isNotNull(customers.phone),
            sql`(customers.marketing_opt_in IS NULL OR customers.marketing_opt_in = true)`
          )
        );
      customerRows = rows.map(r => ({ id: r.id!, phone: r.phone, name: r.name! }));
    } else if (segment === "high_ltv") {
      const rows = await db
        .select({ id: customers.id, phone: customers.phone, name: customers.name })
        .from(clientIntelligence)
        .leftJoin(customers, eq(clientIntelligence.customerId, customers.id))
        .where(
          and(
            eq(clientIntelligence.storeId, storeId),
            sql`CAST(ltv_12_month AS DECIMAL) > 200`,
            isNotNull(customers.phone),
            sql`(customers.marketing_opt_in IS NULL OR customers.marketing_opt_in = true)`
          )
        );
      customerRows = rows.map(r => ({ id: r.id!, phone: r.phone, name: r.name! }));
    } else {
      return res.status(400).json({ error: "Unknown segment" });
    }

    const eligible = customerRows.filter(c => c.phone);

    if (dryRun) {
      return res.json({ dryRun: true, wouldSend: eligible.length, segment });
    }

    let sent = 0;
    let failed = 0;
    for (const c of eligible) {
      if (!c.phone) continue;
      // Personalise with first name
      const firstName = c.name.split(" ")[0];
      const personalised = message.replace(/\{name\}/gi, firstName);
      try {
        await sendSms(storeId, c.phone, personalised, "campaign", undefined, c.id);
        sent++;
      } catch {
        failed++;
      }
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 100));
    }

    res.json({ sent, failed, total: eligible.length, segment });
  } catch (err: any) {
    console.error("[intelligence] campaigns/send error:", err);
    res.status(500).json({ error: "Failed to send campaign" });
  }
});

// GET /api/intelligence/unsubscribe
// One-click unsubscribe from weekly digest — called directly from email link
router.get("/unsubscribe", async (req, res) => {
  const storeId = parseInt(String(req.query.storeId || ""));
  const token = String(req.query.token || "");

  if (!storeId || !token) {
    return res.status(400).send(unsubscribePage("Invalid link", "This unsubscribe link is missing required information.", false));
  }

  const { verifyUnsubscribeToken } = await import("../intelligence/weekly-digest-email");
  if (!verifyUnsubscribeToken(storeId, token)) {
    return res.status(403).send(unsubscribePage("Invalid link", "This unsubscribe link is invalid or has been tampered with.", false));
  }

  try {
    const { locations } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(locations).set({ weeklyDigestOptOut: true }).where(eq(locations.id, storeId));
    return res.send(unsubscribePage("You're unsubscribed", "You'll no longer receive weekly revenue digest emails. You can re-enable them anytime from your Revenue Intelligence dashboard.", true));
  } catch (err) {
    console.error("[intelligence] unsubscribe error:", err);
    return res.status(500).send(unsubscribePage("Something went wrong", "We couldn't process your request. Please try again or contact support.", false));
  }
});

function unsubscribePage(heading: string, body: string, success: boolean): string {
  const appUrl = process.env.APP_URL || "https://app.certxa.com";
  const color = success ? "#10b981" : "#ef4444";
  const icon = success ? "✓" : "✕";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading} — Certxa</title></head>
<body style="margin:0;padding:40px 16px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;box-sizing:border-box;">
  <div style="background:#fff;border-radius:16px;padding:40px 32px;max-width:480px;width:100%;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08);">
    <div style="width:56px;height:56px;border-radius:50%;background:${color}20;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;">
      <span style="font-size:24px;color:${color};">${icon}</span>
    </div>
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#111827;">${heading}</h1>
    <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">${body}</p>
    <a href="${appUrl}/intelligence" style="display:inline-block;background:#18103a;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;text-decoration:none;">
      Back to Revenue Intelligence
    </a>
    <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Certxa · Revenue Intelligence</p>
  </div>
</body>
</html>`;
}

// GET /api/intelligence/digest-preferences
// Returns the current opt-out status for the weekly digest
router.get("/digest-preferences", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const { locations } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [store] = await db
      .select({ optOut: locations.weeklyDigestOptOut })
      .from(locations)
      .where(eq(locations.id, storeId))
      .limit(1);

    res.json({ optOut: store?.optOut ?? false });
  } catch (err) {
    console.error("[intelligence] digest-preferences error:", err);
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

// POST /api/intelligence/digest-preferences
// Toggle weekly digest opt-out for a store
router.post("/digest-preferences", async (req, res) => {
  const { storeId, optOut } = req.body;
  if (!storeId || typeof optOut !== "boolean") {
    return res.status(400).json({ error: "storeId and optOut (boolean) required" });
  }

  try {
    const { locations } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(locations).set({ weeklyDigestOptOut: optOut }).where(eq(locations.id, storeId));
    res.json({ success: true, optOut });
  } catch (err) {
    console.error("[intelligence] digest-preferences update error:", err);
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

// POST /api/intelligence/send-weekly-digest
// Manually triggers the weekly revenue digest email for a store (owner only)
router.post("/send-weekly-digest", async (req, res) => {
  const { storeId } = req.body;
  if (!storeId) return res.status(400).json({ error: "storeId required" });

  try {
    const { sendWeeklyDigest } = await import("../intelligence/weekly-digest-email");
    const result = await sendWeeklyDigest(storeId);
    if (result.sent) {
      return res.json({ success: true, message: "Weekly digest email sent" });
    }
    return res.json({ success: false, skipped: result.skipped });
  } catch (err: any) {
    console.error("[intelligence] send-weekly-digest error:", err);
    res.status(500).json({ error: "Failed to send weekly digest" });
  }
});

// POST /api/intelligence/send-noshow-reminder
// Sends a one-tap SMS reminder to a client for an upcoming high-risk appointment
router.post("/send-noshow-reminder", async (req, res) => {
  const { storeId, appointmentId, customerId } = req.body;
  if (!storeId || !appointmentId || !customerId) {
    return res.status(400).json({ error: "storeId, appointmentId, and customerId required" });
  }

  try {
    const { sendSms } = await import("../sms.js");

    // Load appointment, customer, and store info
    const [apptRow] = await db.execute(
      sql`SELECT a.date, s.name AS service_name, st.name AS staff_name
          FROM appointments a
          LEFT JOIN services s ON s.id = a.service_id
          LEFT JOIN staff st ON st.id = a.staff_id
          WHERE a.id = ${appointmentId} AND a.store_id = ${storeId}
          LIMIT 1`
    );
    const [customerRow] = await db.execute(
      sql`SELECT name, phone, marketing_opt_in FROM customers WHERE id = ${customerId} AND store_id = ${storeId} LIMIT 1`
    );
    const [locationRow] = await db.execute(
      sql`SELECT name, slug FROM locations WHERE id = ${storeId} LIMIT 1`
    );

    if (!customerRow || !(customerRow as any).phone) {
      return res.json({ success: false, error: "No phone number on file" });
    }

    const appt = apptRow as any;
    const customer = customerRow as any;
    const location = locationRow as any;

    const firstName = customer.name.split(" ")[0];
    const storeName = location?.name || "us";
    const apptDate = appt?.date ? new Date(appt.date) : null;
    const timeStr = apptDate
      ? apptDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "your appointment";
    const serviceStr = appt?.service_name ? ` for ${appt.service_name}` : "";
    const staffStr = appt?.staff_name ? ` with ${appt.staff_name}` : "";

    const APP_URL = process.env.APP_URL || "https://certxa.com";
    const bookingSlug = location?.slug;
    const bookingLink = bookingSlug ? `${APP_URL}/book/${bookingSlug}` : APP_URL;

    const message = `Hi ${firstName}! Just a reminder — you have an appointment${serviceStr}${staffStr} at ${storeName} tomorrow at ${timeStr}. We look forward to seeing you! Need to reschedule? ${bookingLink}\n\nReply STOP to opt out.`;

    await sendSms(storeId, customer.phone, message, "no_show_reminder", appointmentId, customerId);

    // Log the intervention
    await db.insert(intelligenceInterventions).values({
      storeId,
      customerId,
      interventionType: "no_show_reminder",
      channel: "sms",
      messageBody: message,
      status: "sent",
      triggeredBy: "manual",
      appointmentId,
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error("[intelligence] send-noshow-reminder error:", err);
    res.status(500).json({ error: "Failed to send reminder", detail: err.message });
  }
});

router.post("/refresh", async (req, res) => {
  const { storeId } = req.body;
  if (!storeId) return res.status(400).json({ error: "storeId required" });

  try {
    res.json({ message: "Intelligence refresh started", storeId });
    // Run in background
    setImmediate(() => runIntelligenceForStore(storeId));
  } catch (err: any) {
    console.error("[intelligence] refresh error:", err);
    res.status(500).json({ error: "Failed to start refresh" });
  }
});

// GET /api/intelligence/price-optimization
// Suggests price adjustments based on demand and margin
router.get("/price-optimization", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await db.execute(
      sql`SELECT
        s.id AS service_id,
        s.name AS service_name,
        CAST(s.price AS DECIMAL(10,2)) AS service_price,
        s.duration AS service_duration,
        COUNT(a.id) AS total_bookings,
        SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) AS no_show_count,
        COALESCE(AVG(CASE WHEN a.status = 'completed' THEN CAST(a.total_paid AS DECIMAL(10,2)) END), 0) AS avg_ticket
      FROM services s
      LEFT JOIN appointments a ON a.service_id = s.id
        AND a.store_id = ${storeId}
        AND a.date >= ${ninetyDaysAgo}
      WHERE s.store_id = ${storeId} AND s.active = true
      GROUP BY s.id, s.name, s.price, s.duration
      HAVING COUNT(a.id) >= 3
      ORDER BY total_bookings DESC`
    );

    const suggestions: any[] = [];
    for (const r of rows.rows) {
      const totalBookings = Number(r.total_bookings);
      const completedCount = Number(r.completed_count);
      const noShowCount = Number(r.no_show_count);
      const listPrice = parseFloat(r.service_price) || 0;
      const avgTicket = parseFloat(r.avg_ticket) || 0;
      const noShowRate = totalBookings > 0 ? noShowCount / totalBookings : 0;
      const completionRate = totalBookings > 0 ? completedCount / totalBookings : 1;

      let recommendation: string | null = null;
      let recommendedPrice: number | null = null;
      let reasoning: string | null = null;
      let priority: "high" | "medium" | "low" = "low";

      // High demand (10+ bookings, >80% completion) — room to raise price
      if (totalBookings >= 10 && completionRate >= 0.8 && listPrice > 0) {
        const suggestedIncrease = Math.round(listPrice * 0.1 / 5) * 5; // Round to nearest $5
        recommendedPrice = listPrice + suggestedIncrease;
        recommendation = "Consider a price increase";
        reasoning = `Strong demand with ${completionRate * 100}% completion rate — clients are price-insensitive.`;
        priority = "medium";
      }

      // High no-show rate (>25%) — suggest deposit requirement
      if (noShowRate >= 0.25 && totalBookings >= 5) {
        recommendation = "Require deposit";
        recommendedPrice = Math.round(listPrice * 0.25 / 5) * 5; // 25% deposit
        reasoning = `${Math.round(noShowRate * 100)}% no-show rate costs you ~$${(noShowCount * avgTicket).toFixed(0)} over 90 days.`;
        priority = "high";
      }

      // Low demand (< 5 bookings) — consider a promotional price
      if (totalBookings < 5 && listPrice > 0 && completedCount > 0) {
        const suggestedDiscount = Math.round(listPrice * 0.15 / 5) * 5;
        recommendedPrice = Math.max(listPrice - suggestedDiscount, 1);
        recommendation = "Promotional pricing";
        reasoning = `Only ${totalBookings} bookings in 90 days. A limited-time discount could drive awareness.`;
        priority = "low";
      }

      if (recommendation) {
        suggestions.push({
          serviceId: r.service_id,
          serviceName: r.service_name,
          currentPrice: listPrice,
          recommendedPrice,
          recommendation,
          reasoning,
          priority,
          totalBookings,
          noShowRate: Math.round(noShowRate * 100),
        });
      }
    }

    // Sort by priority
    const order = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => order[a.priority as keyof typeof order] - order[b.priority as keyof typeof order]);

    res.json({ suggestions });
  } catch (err: any) {
    console.error("[intelligence] price-optimization error:", err);
    res.status(500).json({ error: "Failed to compute price optimization" });
  }
});

// GET /api/intelligence/booking-heatmap
// Returns a day-of-week x hour-of-day heatmap of appointment volume
router.get("/booking-heatmap", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;

  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await db.execute(
      sql`SELECT
        EXTRACT(DOW FROM date)::int AS dow,
        EXTRACT(HOUR FROM date)::int AS hour,
        COUNT(*) AS booking_count,
        SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS no_show_count
      FROM appointments
      WHERE store_id = ${storeId}
        AND date >= ${ninetyDaysAgo}
        AND status NOT IN ('cancelled')
      GROUP BY dow, hour
      ORDER BY dow, hour`
    );

    // Build matrix: [dow 0-6][hour 0-23]
    const matrix: { dow: number; hour: number; count: number; noShowCount: number }[] = [];
    let maxCount = 0;

    for (const r of rows.rows) {
      const count = Number(r.booking_count);
      if (count > maxCount) maxCount = count;
      matrix.push({
        dow: Number(r.dow),
        hour: Number(r.hour),
        count,
        noShowCount: Number(r.no_show_count),
      });
    }

    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    // Find peak and dead slots
    const peakSlot = matrix.reduce((best, cur) => cur.count > best.count ? cur : best, { dow: 0, hour: 0, count: 0, noShowCount: 0 });
    const deadSlots = matrix.filter(m => m.count === 0 || m.count < maxCount * 0.2);

    res.json({
      matrix,
      maxCount,
      dayLabels,
      peakSlot: peakSlot.count > 0 ? {
        day: dayLabels[peakSlot.dow],
        hour: peakSlot.hour,
        count: peakSlot.count,
      } : null,
      deadSlotCount: deadSlots.length,
    });
  } catch (err: any) {
    console.error("[intelligence] booking-heatmap error:", err);
    res.status(500).json({ error: "Failed to compute booking heatmap" });
  }
});

// ─── GET /api/intelligence/auto-engage ────────────────────────────────────────
// Returns whether autonomous SMS engagement is enabled for this store.
router.get("/auto-engage", async (req, res) => {
  const storeId = requireStoreId(req, res);
  if (!storeId) return;
  try {
    const [row] = await db
      .select({ autoEngageEnabled: smsSettings.autoEngageEnabled })
      .from(smsSettings)
      .where(eq(smsSettings.storeId, storeId))
      .limit(1);
    return res.json({ enabled: row?.autoEngageEnabled ?? true });
  } catch (err: any) {
    console.error("[intelligence] auto-engage get error:", err);
    return res.status(500).json({ error: "Failed to get auto-engage setting" });
  }
});

// ─── PATCH /api/intelligence/auto-engage ──────────────────────────────────────
// Toggles autonomous SMS engagement on or off for this store.
router.patch("/auto-engage", async (req, res) => {
  const { storeId, enabled } = req.body as { storeId: number; enabled: boolean };
  if (!storeId || typeof enabled !== "boolean") {
    return res.status(400).json({ error: "storeId and enabled (boolean) required" });
  }
  try {
    // Upsert: create an sms_settings row if one doesn't exist yet
    await db.execute(sql`
      INSERT INTO sms_settings (store_id, auto_engage_enabled)
      VALUES (${storeId}, ${enabled})
      ON CONFLICT (store_id) DO UPDATE SET auto_engage_enabled = ${enabled}
    `);
    console.log(`[intelligence] Auto-engage ${enabled ? "enabled" : "disabled"} for store ${storeId}`);
    return res.json({ enabled });
  } catch (err: any) {
    console.error("[intelligence] auto-engage patch error:", err);
    return res.status(500).json({ error: "Failed to update auto-engage setting" });
  }
});

export default router;
