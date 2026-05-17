import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAppointments } from "@/hooks/use-appointments";
import { useAuth } from "@/hooks/use-auth";
import { useSelectedStore } from "@/hooks/use-store";
import { useStaffList } from "@/hooks/use-staff";
import { formatInTz, toStoreLocal, getNowInTimezone } from "@/lib/timezone";
import {
  isSameDay,
  subDays,
  startOfMonth,
  endOfMonth,
  isWithinInterval,
  format,
  addMinutes,
} from "date-fns";
import { NotificationBell } from "@/components/NotificationBell";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Brain, TrendingUp, TrendingDown, Users, Zap, AlertCircle, Clock, UserX, CalendarX, Target, Edit2, CheckCircle2, ChevronRight, DollarSign, BellOff, X, Calendar, Scissors, User, CreditCard, FileText, Receipt } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

function GradeColorClass(grade: string) {
  if (grade === "A") return "text-emerald-600";
  if (grade === "B") return "text-blue-600";
  if (grade === "C") return "text-amber-600";
  if (grade === "D") return "text-orange-600";
  return "text-red-600";
}

function GrowthScoreWidget({ storeId }: { storeId: number }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/intelligence/growth-score", storeId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/growth-score?storeId=${storeId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!storeId,
    staleTime: 10 * 60 * 1000,
  });

  const { data: dashData } = useQuery<any>({
    queryKey: ["/api/intelligence/dashboard", storeId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/dashboard?storeId=${storeId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!storeId,
    staleTime: 10 * 60 * 1000,
  });

  const score = data?.live;
  const summary = dashData?.summary;

  const size = 88;
  const r = 34;
  const circ = 2 * Math.PI * r;
  const dash = score ? (score.overallScore / 100) * circ : 0;

  const strokeColor =
    !score ? "#6366f1" :
    score.overallScore >= 85 ? "#10b981" :
    score.overallScore >= 70 ? "#3b82f6" :
    score.overallScore >= 55 ? "#f59e0b" :
    score.overallScore >= 40 ? "#f97316" :
    "#ef4444";

  if (isLoading) {
    return (
      <div className="rounded-2xl p-6 bg-card border border-border shadow-sm flex items-center justify-center h-36">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const hasData = score?.hasData !== false;

  return (
    <Link to="/intelligence" className="block group">
      <div className="rounded-2xl p-5 bg-card border border-border/60 shadow-sm hover:shadow-md hover:border-primary/25 transition-all duration-200 group-hover:scale-[1.01]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-violet-500" />
            <p className="text-sm text-muted-foreground font-medium">Business Health</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </div>

        {/* No-data empty state */}
        {(!score || !hasData) && !isLoading && (
          <div className="flex flex-col items-center justify-center py-3 gap-1.5 text-center">
            <span className="text-2xl">📊</span>
            <p className="text-xs font-medium text-foreground">No data yet</p>
            <p className="text-[11px] text-muted-foreground">Start booking clients to see your health score</p>
          </div>
        )}

        {/* Score display */}
        {score && hasData && (
          <div className="flex items-center gap-4">
            {/* Score ring */}
            <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
              <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={7} />
                <circle
                  cx={size / 2} cy={size / 2} r={r}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={7}
                  strokeDasharray={`${dash} ${circ - dash}`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-2xl font-bold leading-none ${GradeColorClass(score.grade)}`}>{score.grade}</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">{score.overallScore}/100</span>
              </div>
            </div>

            {/* Breakdown bars */}
            <div className="flex-1 min-w-0 space-y-1.5">
              {Object.entries(score.components).map(([key, comp]: [string, any]) => {
                const labelMap: Record<string, string> = {
                  retention: "Retention", rebooking: "Rebooking",
                  utilization: "Utilization", revenue: "Revenue", newClients: "New clients",
                };
                return (
                  <div key={key} className="flex items-center gap-2.5">
                    <div className="w-14 flex-shrink-0">
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${comp.score}%`,
                            backgroundColor: comp.score >= 75 ? "#10b981" : comp.score >= 50 ? "#f59e0b" : "#ef4444"
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{labelMap[key] ?? key}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Alert / insight strip */}
        {score && hasData && summary && (summary.driftingClients > 0 || summary.atRiskClients > 0) && (
          <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              {summary.driftingClients > 0 && (
                <span className="text-amber-600 font-medium">{summary.driftingClients} drifting</span>
              )}
              {summary.driftingClients > 0 && summary.atRiskClients > 0 && " · "}
              {summary.atRiskClients > 0 && (
                <span className="text-orange-600 font-medium">{summary.atRiskClients} at risk</span>
              )}
              <span> — tap to act</span>
            </p>
          </div>
        )}

        {score && hasData && (!summary || (summary.driftingClients === 0 && summary.atRiskClients === 0)) && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-xs text-muted-foreground">
              {score.insights?.[0] || "All client metrics look healthy"}
            </p>
          </div>
        )}
      </div>
    </Link>
  );
}

const digestIcons: Record<string, React.ReactNode> = {
  no_show_risk: <UserX className="h-4 w-4 text-red-500" />,
  critical_churn: <AlertCircle className="h-4 w-4 text-orange-500" />,
  cancellation_recovery: <CalendarX className="h-4 w-4 text-amber-500" />,
  high_ltv_drifting: <Users className="h-4 w-4 text-violet-500" />,
  rebooking_nudge: <Clock className="h-4 w-4 text-blue-500" />,
};

const copilotGradient: Record<string, { bg: string; accent: string; icon: React.ReactNode }> = {
  no_show_risk: {
    bg: "from-red-950 to-red-900",
    accent: "text-red-300",
    icon: <UserX className="h-5 w-5 text-red-300" />,
  },
  critical_churn: {
    bg: "from-orange-950 to-orange-900",
    accent: "text-orange-300",
    icon: <AlertCircle className="h-5 w-5 text-orange-300" />,
  },
  cancellation_recovery: {
    bg: "from-amber-950 to-amber-900",
    accent: "text-amber-300",
    icon: <CalendarX className="h-5 w-5 text-amber-300" />,
  },
  high_ltv_drifting: {
    bg: "from-violet-950 to-violet-900",
    accent: "text-violet-300",
    icon: <Users className="h-5 w-5 text-violet-300" />,
  },
  rebooking_nudge: {
    bg: "from-blue-950 to-blue-900",
    accent: "text-blue-300",
    icon: <Clock className="h-5 w-5 text-blue-300" />,
  },
};

const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000;

function snoozeKey(storeId: number, type: string) {
  return `copilot_snooze_${storeId}_${type}`;
}

function getSnoozedTypes(storeId: number): Set<string> {
  const now = Date.now();
  const snoozed = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(`copilot_snooze_${storeId}_`)) continue;
    const expiry = parseInt(localStorage.getItem(key) || "0");
    if (now < expiry) {
      snoozed.add(key.replace(`copilot_snooze_${storeId}_`, ""));
    } else {
      localStorage.removeItem(key);
    }
  }
  return snoozed;
}

function RevenueCopilotWidget({ storeId, hasAnyData }: { storeId: number; hasAnyData: boolean }) {
  const [snoozed, setSnoozed] = useState<Set<string>>(() => getSnoozedTypes(storeId));
  const [snoozeAnim, setSnoozeAnim] = useState(false);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/intelligence/daily-digest", storeId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/daily-digest?storeId=${storeId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!storeId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return null;

  const allActions: any[] = data?.actions || [];
  const visibleActions = allActions.filter((a) => !snoozed.has(a.type));
  const topAction = visibleActions[0] ?? null;
  const snoozedCount = allActions.length - visibleActions.length;
  const remainingCount = visibleActions.length - 1;

  const handleSnooze = (type: string) => {
    const expiry = Date.now() + SNOOZE_DURATION_MS;
    localStorage.setItem(snoozeKey(storeId, type), String(expiry));
    setSnoozeAnim(true);
    setTimeout(() => {
      setSnoozed(getSnoozedTypes(storeId));
      setSnoozeAnim(false);
    }, 350);
  };

  if (!topAction) {
    // New account with no data yet — show an onboarding prompt instead of a false "all clear"
    if (!hasAnyData) {
      return (
        <div className="rounded-2xl bg-gradient-to-br from-violet-950 to-indigo-950 border border-violet-700/40 p-5 mb-6 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-violet-800/50 flex items-center justify-center flex-shrink-0">
            <Zap className="h-5 w-5 text-violet-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-violet-200">Ready to grow your business?</p>
            <p className="text-xs text-violet-400 mt-0.5">
              Add your first client and booking — your Revenue Co-pilot will start surfacing insights as your data builds up.
            </p>
          </div>
          <Link
            to="/clients/new"
            className="flex items-center gap-1.5 bg-violet-700/60 hover:bg-violet-600/70 transition-colors text-violet-100 text-xs font-semibold px-3 py-2 rounded-xl flex-shrink-0"
          >
            Add client
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      );
    }

    // Established account, genuinely no urgent actions
    return (
      <div className="rounded-2xl bg-emerald-950 border border-emerald-800/40 p-5 mb-6 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-emerald-800/50 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-emerald-300">You're ahead of it</p>
          <p className="text-xs text-emerald-500 mt-0.5">
            No urgent actions right now — all revenue signals look healthy.
            {snoozedCount > 0 && (
              <button
                onClick={() => {
                  allActions.forEach((a) => localStorage.removeItem(snoozeKey(storeId, a.type)));
                  setSnoozed(new Set());
                }}
                className="ml-2 underline hover:text-emerald-400 transition-colors"
              >
                ({snoozedCount} snoozed — tap to restore)
              </button>
            )}
          </p>
        </div>
      </div>
    );
  }

  const style = copilotGradient[topAction.type] || copilotGradient.critical_churn;
  const hasRevenue = (topAction.revenueAtStake || 0) > 0;

  return (
    <div
      className={`rounded-2xl bg-gradient-to-br ${style.bg} border border-white/10 p-5 mb-6 transition-opacity duration-300 ${snoozeAnim ? "opacity-0" : "opacity-100"}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          {style.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-bold tracking-widest uppercase text-white/40">Revenue Co-pilot</p>
              {remainingCount > 0 && (
                <span className="text-[10px] bg-white/10 text-white/50 px-1.5 py-0.5 rounded-full font-medium">
                  +{remainingCount} more
                </span>
              )}
            </div>
            <button
              onClick={() => handleSnooze(topAction.type)}
              title="Snooze for 24 hours"
              className="flex items-center gap-1 text-white/30 hover:text-white/60 transition-colors text-[11px] ml-2 flex-shrink-0"
            >
              <BellOff className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Snooze 24h</span>
            </button>
          </div>
          <p className="text-base font-bold text-white leading-snug">{topAction.label}</p>
          <p className="text-sm text-white/50 mt-1 leading-snug">{topAction.detail}</p>

          <div className="flex items-center justify-between mt-4 gap-3">
            {hasRevenue ? (
              <div className="flex items-center gap-1.5">
                <DollarSign className={`h-3.5 w-3.5 ${style.accent}`} />
                <span className={`text-sm font-bold ${style.accent}`}>
                  ${Math.round(topAction.revenueAtStake).toLocaleString()}
                </span>
                <span className="text-xs text-white/40">at stake</span>
              </div>
            ) : (
              <div />
            )}
            <Link
              to={`/intelligence?tab=${topAction.tab}`}
              className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 transition-colors text-white text-sm font-semibold px-4 py-2 rounded-xl"
            >
              {topAction.ctaLabel}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const digestColors: Record<string, string> = {
  no_show_risk: "border-l-red-400",
  critical_churn: "border-l-orange-400",
  cancellation_recovery: "border-l-amber-400",
  high_ltv_drifting: "border-l-violet-400",
  rebooking_nudge: "border-l-blue-400",
};

function RevenueGoalTracker({ currentRevenue, storageKey }: { currentRevenue: number; storageKey: string }) {
  const [goal, setGoal] = useState<number>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? parseInt(saved) : 0;
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const progress = goal > 0 ? Math.min(100, Math.round((currentRevenue / goal) * 100)) : 0;
  const remaining = goal > 0 ? Math.max(0, goal - currentRevenue) : 0;
  const isHit = goal > 0 && currentRevenue >= goal;

  const handleSave = () => {
    const val = parseInt(draft.replace(/[^0-9]/g, ""));
    if (!isNaN(val) && val > 0) {
      setGoal(val);
      localStorage.setItem(storageKey, String(val));
    }
    setEditing(false);
  };

  if (goal === 0 && !editing) {
    return (
      <button
        onClick={() => { setDraft(""); setEditing(true); }}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Target className="h-3.5 w-3.5" />
        Set a monthly goal
      </button>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Target className={`h-3.5 w-3.5 flex-shrink-0 ${isHit ? "text-emerald-600" : "text-amber-500"}`} />
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                type="number"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
                placeholder="e.g. 5000"
                className="w-24 text-xs border border-border rounded px-2 py-0.5 bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <button onClick={handleSave} className="text-emerald-600 hover:text-emerald-700 text-xs font-medium">Save</button>
              <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground text-xs">×</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-muted-foreground truncate">
                Goal: <span className="text-foreground font-semibold">${goal.toLocaleString()}</span>
              </span>
              <button onClick={() => { setDraft(String(goal)); setEditing(true); }} className="text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0">
                <Edit2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
        {!editing && (
          <span className={`text-xs font-bold flex-shrink-0 ${isHit ? "text-emerald-600" : "text-amber-500"}`}>
            {isHit ? "🎯" : `${progress}%`}
          </span>
        )}
      </div>
      {!editing && goal > 0 && (
        <>
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-1.5 rounded-full transition-all duration-700 ${isHit ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {!isHit && remaining > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              ${remaining.toLocaleString()} to go
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SmartDigestWidget({ storeId }: { storeId: number }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/intelligence/daily-digest", storeId],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/daily-digest?storeId=${storeId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!storeId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return null;
  if (!data || data.actions?.length === 0) return null;

  return (
    <Link to="/intelligence" className="block group">
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-bold text-foreground">Today's Smart Actions</span>
            <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
              {data.actions.length}
            </span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
        </div>
        <div className="space-y-2">
          {data.actions.map((action: any, i: number) => (
            <div
              key={i}
              className={`flex items-start gap-3 pl-3 border-l-2 ${digestColors[action.type] || "border-l-muted"}`}
            >
              <div className="flex-shrink-0 mt-0.5">{digestIcons[action.type]}</div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">{action.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{action.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { selectedStore } = useSelectedStore();
  const timezone = selectedStore?.timezone || "UTC";
  const storeNow = getNowInTimezone(timezone);
  const navigate = useNavigate();

  const [selectedApt, setSelectedApt] = useState<any | null>(null);

  const { data: appointments } = useAppointments();
  const { data: staffList } = useStaffList();

  const getHour = () => {
    const h = storeNow.getHours();
    if (h < 12) return "morning";
    if (h < 17) return "afternoon";
    return "evening";
  };

  const todayAppointments = appointments?.filter((apt: any) => {
    const localDate = toStoreLocal(apt.date, timezone);
    return isSameDay(localDate, storeNow);
  }) || [];

  const yesterdayAppointments = appointments?.filter((apt: any) => {
    const localDate = toStoreLocal(apt.date, timezone);
    return isSameDay(localDate, subDays(storeNow, 1));
  }) || [];

  const monthStart = startOfMonth(storeNow);
  const monthEnd = endOfMonth(storeNow);
  const lastMonthStart = startOfMonth(subDays(monthStart, 1));
  const lastMonthEnd = endOfMonth(subDays(monthStart, 1));

  const thisMonthAppointments = appointments?.filter((apt: any) => {
    const localDate = toStoreLocal(apt.date, timezone);
    return isWithinInterval(localDate, { start: monthStart, end: monthEnd });
  }) || [];

  const lastMonthAppointments = appointments?.filter((apt: any) => {
    const localDate = toStoreLocal(apt.date, timezone);
    return isWithinInterval(localDate, { start: lastMonthStart, end: lastMonthEnd });
  }) || [];

  const getRevenue = (appts: any[]) =>
    appts.reduce((sum: number, apt: any) => {
      const paid = parseFloat(apt.totalPaid || "0");
      return sum + (isNaN(paid) ? 0 : paid);
    }, 0);

  const thisMonthRevenue = getRevenue(thisMonthAppointments);
  const lastMonthRevenue = getRevenue(lastMonthAppointments);
  const monthRevenueChange =
    lastMonthRevenue > 0
      ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : 0;

  const todayCount = todayAppointments.filter(
    (a: any) => a.status !== "cancelled"
  ).length;
  const yesterdayCount = yesterdayAppointments.filter(
    (a: any) => a.status !== "cancelled"
  ).length;
  const bookingDiff = todayCount - yesterdayCount;

  const staffCount = staffList?.length || 1;
  const dailyCapacity = staffCount * 8;
  const fillRate = Math.min(
    100,
    Math.round((todayCount / dailyCapacity) * 100)
  );

  const last7Days = Array.from({ length: 7 }, (_, i) => subDays(storeNow, 6 - i));
  const chartData = last7Days.map((day) => {
    const dayAppts = appointments?.filter((apt: any) => {
      const localDate = toStoreLocal(apt.date, timezone);
      return isSameDay(localDate, day);
    }) || [];
    return {
      day: format(day, "EEE"),
      revenue: getRevenue(dayAppts),
      isToday: isSameDay(day, storeNow),
    };
  });

  const sortedToday = [...todayAppointments]
    .filter((a: any) => a.status !== "cancelled")
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const avatarColors = [
    "from-violet-500 to-purple-600",
    "from-pink-500 to-rose-500",
    "from-teal-400 to-emerald-500",
    "from-amber-400 to-orange-500",
    "from-sky-400 to-blue-500",
    "from-fuchsia-500 to-pink-500",
  ];

  const getAvatarColor = (name: string) => {
    const idx = (name?.charCodeAt(0) || 0) % avatarColors.length;
    return avatarColors[idx];
  };

  const getInitials = (name: string) => {
    if (!name) return "?";
    const parts = name.trim().split(" ");
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  };

  const statusStyle: Record<string, string> = {
    confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    "no-show": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    cancelled: "bg-gray-100 text-gray-500",
  };

  return (
    <AppLayout>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-muted-foreground text-sm mb-0.5">
            {formatInTz(storeNow, timezone, "EEEE, d MMMM")}
          </p>
          <h1 className="text-2xl font-display font-bold text-foreground">
            Good {getHour()}, {user?.firstName || "there"} 👋
          </h1>
        </div>
        <NotificationBell />
      </div>

      {/* Revenue Co-pilot — single most urgent action */}
      {selectedStore?.id && (
        <RevenueCopilotWidget
          storeId={selectedStore.id}
          hasAnyData={!!(appointments && appointments.length > 0)}
        />
      )}

      {/* Stat Cards — 5-column on md+, 2×2 on mobile (Business Health spans 2) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {/* Revenue this month */}
        <div className="rounded-2xl p-5 bg-card border border-border/60 shadow-sm col-span-2 md:col-span-1">
          <p className="text-xs text-muted-foreground mb-3 font-medium">Revenue this month</p>
          <p className="text-2xl font-bold font-display mb-1.5 text-foreground">
            ${thisMonthRevenue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </p>
          {lastMonthRevenue > 0 ? (
            <p className={`text-xs font-medium flex items-center gap-1 ${monthRevenueChange >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              {monthRevenueChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(monthRevenueChange)}% vs last month
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">First month</p>
          )}
          <div className="mt-3 pt-3 border-t border-border/50">
            <RevenueGoalTracker
              currentRevenue={thisMonthRevenue}
              storageKey={`revenue-goal-${selectedStore?.id || "default"}`}
            />
          </div>
        </div>

        {/* Bookings today */}
        <div className="rounded-2xl p-5 bg-card border border-border shadow-sm">
          <p className="text-xs text-muted-foreground mb-3 font-medium">Bookings today</p>
          <p className="text-2xl font-bold font-display mb-1.5 text-foreground">{todayCount}</p>
          {yesterdayCount > 0 ? (
            <p className={`text-xs font-medium ${bookingDiff >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
              {bookingDiff >= 0 ? "↑" : "↓"} {Math.abs(bookingDiff)} vs yesterday
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No data yesterday</p>
          )}
        </div>

        {/* Fill rate */}
        <div className="rounded-2xl p-5 bg-card border border-border shadow-sm flex flex-col">
          <p className="text-xs text-muted-foreground mb-3 font-medium">Fill rate</p>
          <p className="text-2xl font-bold font-display mb-2 text-foreground">{fillRate}%</p>
          <div className="w-full bg-muted rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full bg-amber-500 transition-all duration-500"
              style={{ width: `${fillRate}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
            % of today's available staff slots that are booked. Higher is better — aim for 70%+.
          </p>
        </div>

        {/* Growth Score widget — spans 2 cols for legibility */}
        {selectedStore?.id ? (
          <div className="col-span-2 md:col-span-2">
            <GrowthScoreWidget storeId={selectedStore.id} />
          </div>
        ) : (
          <div className="rounded-2xl p-5 bg-card border border-border shadow-sm col-span-2 md:col-span-2">
            <p className="text-xs text-muted-foreground mb-3 font-medium">Business Health</p>
            <p className="text-2xl font-bold font-display text-muted-foreground/40">—</p>
          </div>
        )}
      </div>

      {/* Smart Daily Digest */}
      {selectedStore?.id && <SmartDigestWidget storeId={selectedStore.id} />}

      {/* Revenue Chart */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-6 mb-6">
        <p className="text-sm font-semibold text-foreground mb-5">Revenue — last 7 days</p>
        <ResponsiveContainer width="100%" height={185}>
          <BarChart data={chartData} barSize={28} margin={{ top: 24, right: 0, left: -20, bottom: 0 }}>
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis hide />
            <Bar dataKey="revenue" radius={[6, 6, 6, 6]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.isToday ? "#f59e0b" : "#7c3aed"}
                />
              ))}
              <LabelList
                dataKey="revenue"
                position="top"
                formatter={(v: number) => v > 0 ? `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}` : ""}
                style={{ fontSize: 11, fontWeight: 600, fill: "hsl(var(--foreground))" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Today's Appointments */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-6">
        <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase mb-4">
          Today's Appointments
        </p>

        {sortedToday.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No appointments scheduled for today.
          </p>
        ) : (
          <div className="space-y-1">
            {sortedToday.map((apt: any) => {
              const customerName = apt.customer?.name || apt.customerName || "Guest";
              const serviceName = apt.service?.name || "Service";
              const status = (apt.status || "pending").toLowerCase();
              const initials = getInitials(customerName);
              const avatarGrad = getAvatarColor(customerName);
              const price = parseFloat(apt.totalPaid || apt.price || "0");

              return (
                <div
                  key={apt.id}
                  onClick={() => setSelectedApt(apt)}
                  className="flex items-center gap-4 py-3 px-2 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  {/* Time */}
                  <span className="text-sm text-muted-foreground w-12 shrink-0 font-medium">
                    {formatInTz(apt.date, timezone, "HH:mm")}
                  </span>

                  {/* Avatar */}
                  <div
                    className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarGrad} flex items-center justify-center text-white text-xs font-bold shrink-0`}
                  >
                    {initials}
                  </div>

                  {/* Name + Service */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground leading-tight truncate">
                      {customerName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{serviceName}</p>
                  </div>

                  {/* Price */}
                  <span className="text-sm font-bold text-foreground shrink-0">
                    {price > 0 ? `$${price.toFixed(0)}` : "—"}
                  </span>

                  {/* Status Badge */}
                  <span
                    className={`text-xs font-semibold px-3 py-1 rounded-full shrink-0 capitalize ${statusStyle[status] || statusStyle["pending"]}`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Appointment Detail Drawer ──────────────────────────────────────── */}
      <Sheet open={!!selectedApt} onOpenChange={(open) => { if (!open) setSelectedApt(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          {selectedApt && (() => {
            const apt = selectedApt;
            const customerName = apt.customer?.name || apt.customerName || "Guest";
            const serviceName = apt.service?.name || "Service";
            const staffName = apt.staff?.name || "—";
            const status = (apt.status || "pending").toLowerCase();
            const isCompleted = status === "completed";
            const price = parseFloat(apt.totalPaid || apt.price || "0");
            const initials = getInitials(customerName);
            const avatarGrad = getAvatarColor(customerName);
            const aptDate = new Date(apt.date);
            const endDate = addMinutes(aptDate, apt.duration || 30);
            const dateStr = formatInTz(apt.date, timezone, "EEEE, d MMM yyyy");
            const timeStr = `${formatInTz(apt.date, timezone, "h:mm a")} – ${formatInTz(endDate.toISOString(), timezone, "h:mm a")}`;
            const paymentMethod = apt.paymentMethod
              ? apt.paymentMethod.charAt(0).toUpperCase() + apt.paymentMethod.slice(1)
              : null;

            const statusColors: Record<string, string> = {
              completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
              confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
              pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
              "no-show": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
              cancelled: "bg-gray-100 text-gray-500",
            };

            return (
              <>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-border">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${avatarGrad} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                      {initials}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground leading-tight">{customerName}</p>
                      <p className="text-xs text-muted-foreground">{serviceName}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${statusColors[status] || statusColors["pending"]}`}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </span>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                  {/* Date / Time / Duration */}
                  <div className="rounded-xl border border-border bg-muted/30 divide-y divide-border">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Date</p>
                        <p className="text-sm font-medium text-foreground">{dateStr}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Time</p>
                        <p className="text-sm font-medium text-foreground">{timeStr}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Scissors className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Service</p>
                        <p className="text-sm font-medium text-foreground">{serviceName}{apt.duration ? ` · ${apt.duration} min` : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <User className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Staff</p>
                        <p className="text-sm font-medium text-foreground">{staffName}</p>
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  {apt.notes && (
                    <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex items-start gap-3">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Notes</p>
                        <p className="text-sm text-foreground">{apt.notes}</p>
                      </div>
                    </div>
                  )}

                  {/* Receipt section — completed only */}
                  {isCompleted && (
                    <div className="rounded-xl border border-border overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3 bg-muted/40 border-b border-border">
                        <Receipt className="h-4 w-4 text-muted-foreground" />
                        <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">Receipt</p>
                      </div>

                      {/* Monospace receipt body */}
                      <div className="px-4 py-4 space-y-1 font-mono text-sm bg-card">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground truncate mr-4">{serviceName}</span>
                          <span className="text-foreground font-semibold shrink-0">
                            ${parseFloat(apt.service?.price || apt.price || "0").toFixed(2)}
                          </span>
                        </div>

                        {/* Addons if present */}
                        {apt.addons?.map((addon: any) => (
                          <div key={addon.id} className="flex justify-between text-xs">
                            <span className="text-muted-foreground truncate mr-4">+ {addon.name}</span>
                            <span className="text-foreground">${parseFloat(addon.price || "0").toFixed(2)}</span>
                          </div>
                        ))}

                        <div className="border-t border-dashed border-border my-2" />

                        {/* Tip if price > service price */}
                        {(() => {
                          const servicePrice = parseFloat(apt.service?.price || apt.price || "0");
                          const tip = price - servicePrice;
                          if (tip > 0.01) return (
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>Tip</span>
                              <span>${tip.toFixed(2)}</span>
                            </div>
                          );
                        })()}

                        <div className="flex justify-between font-bold text-foreground pt-1">
                          <span>Total</span>
                          <span>${price.toFixed(2)}</span>
                        </div>

                        {paymentMethod && (
                          <div className="flex items-center gap-2 pt-3 text-xs text-muted-foreground">
                            <CreditCard className="h-3 w-3 shrink-0" />
                            <span>Paid by {paymentMethod}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Pending / confirmed price */}
                  {!isCompleted && price > 0 && (
                    <div className="rounded-xl border border-border bg-muted/30 flex items-center justify-between px-4 py-3">
                      <span className="text-sm text-muted-foreground">Price</span>
                      <span className="text-sm font-bold text-foreground">${price.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                {/* Footer actions */}
                <div className="px-6 py-4 border-t border-border flex gap-3">
                  <button
                    onClick={() => { setSelectedApt(null); navigate(`/booking/new?editId=${apt.id}`); }}
                    className="flex-1 text-sm font-medium rounded-xl border border-border py-2.5 hover:bg-muted transition-colors"
                  >
                    Edit Booking
                  </button>
                  <button
                    onClick={() => { setSelectedApt(null); navigate("/calendar"); }}
                    className="flex-1 text-sm font-medium rounded-xl bg-primary text-primary-foreground py-2.5 hover:bg-primary/90 transition-colors"
                  >
                    Open in Calendar
                  </button>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
