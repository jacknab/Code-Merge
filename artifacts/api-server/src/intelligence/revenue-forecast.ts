import { db } from "../db";
import { appointments } from "@shared/schema";
import { eq, and, gte, sql, inArray } from "drizzle-orm";

export interface RevenueForecast {
  baselineForecast30: number;
  baselineForecast90: number;
  optimisticForecast30: number;
  optimisticForecast90: number;
  weeklyAvgRevenue: number;
  trend: "growing" | "stable" | "declining";
  trendPct: number;
  weeklyData: Array<{ weekLabel: string; revenue: number; weekStart: Date }>;
  insights: string[];
  recoveryAddon: number;
  projectedAnnual: number;
}

export async function computeRevenueForecast(
  storeId: number,
  driftingClients: number = 0,
  avgClientLtv: number = 0
): Promise<RevenueForecast> {
  // Get last 12 weeks of revenue
  const twelveWeeksAgo = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000);

  const rawRevenue = await db
    .select({
      date: appointments.date,
      paid: appointments.totalPaid,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.storeId, storeId),
        eq(appointments.status, "completed"),
        gte(appointments.date, twelveWeeksAgo),
        sql`total_paid IS NOT NULL AND CAST(total_paid AS DECIMAL) > 0`
      )
    )
    .orderBy(appointments.date);

  // Group by week
  const weeklyMap = new Map<string, { revenue: number; weekStart: Date }>();
  for (const row of rawRevenue) {
    const d = new Date(row.date);
    // Get Monday of the week
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);
    const existing = weeklyMap.get(key) || { revenue: 0, weekStart: monday };
    existing.revenue += parseFloat(row.paid || "0");
    weeklyMap.set(key, existing);
  }

  const weeklyData = Array.from(weeklyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => ({
      weekLabel: new Date(key).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      revenue: Math.round(val.revenue),
      weekStart: val.weekStart,
    }));

  // Fill in missing weeks with 0
  const filledWeeks: typeof weeklyData = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1 - i * 7);
    weekStart.setHours(0, 0, 0, 0);
    const key = weekStart.toISOString().slice(0, 10);
    const found = weeklyData.find(
      (w) => w.weekStart.toISOString().slice(0, 10) === key
    );
    filledWeeks.push(
      found || {
        weekLabel: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        revenue: 0,
        weekStart,
      }
    );
  }

  // Compute trend — compare last 4 weeks vs prior 4 weeks
  const last4 = filledWeeks.slice(-4).reduce((s, w) => s + w.revenue, 0);
  const prior4 = filledWeeks.slice(-8, -4).reduce((s, w) => s + w.revenue, 0);
  const weeklyAvgRevenue = last4 > 0 ? Math.round(last4 / 4) : 0;

  let trendPct = 0;
  let trend: "growing" | "stable" | "declining" = "stable";
  if (prior4 > 0) {
    trendPct = Math.round(((last4 - prior4) / prior4) * 100);
    if (trendPct >= 5) trend = "growing";
    else if (trendPct <= -5) trend = "declining";
  } else if (weeklyAvgRevenue > 0) {
    trend = "stable";
  }

  // Apply weighted trend to forecast
  // Use exponential smoothing: recent weeks matter more
  const weights = [0.4, 0.25, 0.2, 0.15];
  const last4Revenues = filledWeeks.slice(-4).map((w) => w.revenue);
  let weightedWeekly = 0;
  for (let i = 0; i < 4; i++) {
    weightedWeekly += last4Revenues[3 - i] * weights[i];
  }
  weightedWeekly = Math.round(weightedWeekly);

  // Apply trend multiplier per week
  const trendMultiplierPerWeek =
    trend === "growing" ? 1 + Math.min(Math.abs(trendPct), 20) / 100 / 4
    : trend === "declining" ? 1 - Math.min(Math.abs(trendPct), 20) / 100 / 4
    : 1;

  // Baseline forecast
  let baseline30 = 0;
  let w = weightedWeekly;
  for (let i = 0; i < 4; i++) {
    baseline30 += w;
    w *= trendMultiplierPerWeek;
  }
  baseline30 = Math.round(baseline30);

  let baseline90 = 0;
  w = weightedWeekly;
  for (let i = 0; i < 13; i++) {
    baseline90 += w;
    w *= trendMultiplierPerWeek;
  }
  baseline90 = Math.round(baseline90);

  // Optimistic forecast adds expected recovery from drifting clients
  // If we win back 40% of drifting clients, each averages (avgClientLtv / 12) per month
  const recoveryAddon = Math.round(driftingClients * 0.4 * (avgClientLtv / 12));
  const optimistic30 = baseline30 + recoveryAddon;
  const optimistic90 = baseline90 + recoveryAddon * 3;

  const projectedAnnual = Math.round(
    weeklyAvgRevenue > 0 ? weeklyAvgRevenue * 52 : baseline90 * (52 / 13)
  );

  const insights: string[] = [];
  if (trend === "growing") {
    insights.push(`Revenue is growing at ${Math.abs(trendPct)}% per 4 weeks — strong momentum`);
  } else if (trend === "declining") {
    insights.push(`Revenue has declined ${Math.abs(trendPct)}% over the last 4 weeks — action needed`);
  }
  if (recoveryAddon > 0) {
    insights.push(
      `Winning back ${Math.round(driftingClients * 0.4)} drifting clients could add $${recoveryAddon.toLocaleString()}/month`
    );
  }
  if (weeklyAvgRevenue === 0) {
    insights.push("No completed appointment revenue in the last 4 weeks — run appointments to see forecast");
  }

  return {
    baselineForecast30: baseline30,
    baselineForecast90: baseline90,
    optimisticForecast30: optimistic30,
    optimisticForecast90: optimistic90,
    weeklyAvgRevenue,
    trend,
    trendPct,
    weeklyData: filledWeeks,
    insights,
    recoveryAddon,
    projectedAnnual,
  };
}
