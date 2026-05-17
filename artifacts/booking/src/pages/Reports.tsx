import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSelectedStore } from "@/hooks/use-store";
import { useAppointments } from "@/hooks/use-appointments";
import { useStaffList } from "@/hooks/use-staff";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import {
  DollarSign, Calendar, Users, Scissors, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, Printer, UserCheck, UserX, AlertCircle, Download, FileText,
} from "lucide-react";
import {
  format, subDays, startOfDay, eachDayOfInterval, parseISO, isWithinInterval,
  startOfMonth, eachMonthOfInterval, subMonths,
} from "date-fns";
import type { AppointmentWithDetails } from "@shared/schema";
import { cn } from "@/lib/utils";

const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"];

type Range = "7d" | "30d" | "90d" | "12m";

function rangeLabel(r: Range) {
  return r === "7d" ? "Last 7 Days" : r === "30d" ? "Last 30 Days" : r === "90d" ? "Last 90 Days" : "Last 12 Months";
}

function fmt(n: number) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatCard({
  title, value, sub, icon: Icon, trend, trendLabel,
}: {
  title: string; value: string; sub?: string;
  icon: React.ElementType; trend?: number; trendLabel?: string;
}) {
  const up = trend !== undefined && trend >= 0;
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="rounded-full bg-primary/10 p-2">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 mt-3 text-xs font-medium ${up ? "text-green-600" : "text-red-500"}`}>
            {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(trend).toFixed(1)}% {trendLabel || "vs prior period"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Reports() {
  const { selectedStore } = useSelectedStore();
  const [range, setRange] = useState<Range>("30d");

  const { data: allAppointments = [] } = useAppointments();
  const { data: staffList = [] } = useStaffList();
  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["/api/customers"],
    enabled: !!selectedStore,
  });
  const { data: services = [] } = useQuery<any[]>({
    queryKey: ["/api/services"],
    enabled: !!selectedStore,
  });

  const appointments = allAppointments as AppointmentWithDetails[];

  const { days, rangeStart, prevStart } = useMemo(() => {
    if (range === "12m") {
      const rangeStart = startOfDay(subDays(new Date(), 365));
      const prevStart = startOfDay(subDays(new Date(), 730));
      return { days: 365, rangeStart, prevStart };
    }
    const d = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const rangeStart = startOfDay(subDays(new Date(), d - 1));
    const prevStart = startOfDay(subDays(new Date(), d * 2 - 1));
    return { days: d, rangeStart, prevStart };
  }, [range]);

  const now = new Date();

  const periodAppts = useMemo(() =>
    appointments.filter(a => {
      const d = new Date(a.date);
      return d >= rangeStart && d <= now;
    }), [appointments, rangeStart]);

  const prevAppts = useMemo(() =>
    appointments.filter(a => {
      const d = new Date(a.date);
      return d >= prevStart && d < rangeStart;
    }), [appointments, prevStart, rangeStart]);

  const completedAppts = useMemo(() => periodAppts.filter(a => a.status === "completed"), [periodAppts]);
  const prevCompleted = useMemo(() => prevAppts.filter(a => a.status === "completed"), [prevAppts]);

  function pct(cur: number, prev: number) {
    if (!prev) return cur > 0 ? 100 : 0;
    return ((cur - prev) / prev) * 100;
  }

  // ── Revenue ──────────────────────────────────────────────────────────────
  const totalRevenue = useMemo(() =>
    completedAppts.reduce((s, a) => s + parseFloat(a.totalPaid || "0"), 0), [completedAppts]);
  const prevRevenue = useMemo(() =>
    prevCompleted.reduce((s, a) => s + parseFloat(a.totalPaid || "0"), 0), [prevCompleted]);
  const totalTips = useMemo(() =>
    completedAppts.reduce((s, a) => s + parseFloat((a as any).tipAmount || "0"), 0), [completedAppts]);
  const avgTicket = completedAppts.length ? totalRevenue / completedAppts.length : 0;

  const revenueByDay = useMemo(() => {
    if (range === "12m") {
      const months = eachMonthOfInterval({ start: subMonths(now, 11), end: now });
      return months.map(m => {
        const label = format(m, "MMM yy");
        const rev = completedAppts
          .filter(a => format(new Date(a.date), "MMM yy") === label)
          .reduce((s, a) => s + parseFloat(a.totalPaid || "0"), 0);
        return { date: label, revenue: parseFloat(rev.toFixed(2)) };
      });
    }
    return eachDayOfInterval({ start: rangeStart, end: now }).map(day => {
      const label = format(day, range === "7d" ? "EEE d" : "MMM d");
      const rev = completedAppts
        .filter(a => format(new Date(a.date), "yyyy-MM-dd") === format(day, "yyyy-MM-dd"))
        .reduce((s, a) => s + parseFloat(a.totalPaid || "0"), 0);
      return { date: label, revenue: parseFloat(rev.toFixed(2)) };
    });
  }, [completedAppts, rangeStart, range]);

  const paymentBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    completedAppts.forEach(a => {
      const m = (a as any).paymentMethod || "unknown";
      map[m] = (map[m] || 0) + parseFloat(a.totalPaid || "0");
    });
    return Object.entries(map).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value: parseFloat(value.toFixed(2)),
    }));
  }, [completedAppts]);

  // ── Appointments ─────────────────────────────────────────────────────────
  const cancelled = useMemo(() => periodAppts.filter(a => a.status === "cancelled"), [periodAppts]);
  const noShow = useMemo(() => periodAppts.filter(a => a.status === "no_show"), [periodAppts]);
  const pending = useMemo(() => periodAppts.filter(a => a.status === "pending" || a.status === "confirmed"), [periodAppts]);

  const apptsByDay = useMemo(() => {
    if (range === "12m") {
      const months = eachMonthOfInterval({ start: subMonths(now, 11), end: now });
      return months.map(m => {
        const label = format(m, "MMM yy");
        return {
          date: label,
          completed: completedAppts.filter(a => format(new Date(a.date), "MMM yy") === label).length,
          cancelled: cancelled.filter(a => format(new Date(a.date), "MMM yy") === label).length,
        };
      });
    }
    return eachDayOfInterval({ start: rangeStart, end: now }).map(day => {
      const key = format(day, "yyyy-MM-dd");
      const label = format(day, range === "7d" ? "EEE d" : "MMM d");
      return {
        date: label,
        completed: completedAppts.filter(a => format(new Date(a.date), "yyyy-MM-dd") === key).length,
        cancelled: cancelled.filter(a => format(new Date(a.date), "yyyy-MM-dd") === key).length,
      };
    });
  }, [completedAppts, cancelled, rangeStart, range]);

  const statusBreakdown = useMemo(() => [
    { name: "Completed", value: completedAppts.length },
    { name: "Cancelled", value: cancelled.length },
    { name: "No-Show", value: noShow.length },
    { name: "Pending", value: pending.length },
  ].filter(x => x.value > 0), [completedAppts, cancelled, noShow, pending]);

  // ── Staff Performance ─────────────────────────────────────────────────────
  const staffStats = useMemo(() =>
    staffList.map((s: any) => {
      const appts = completedAppts.filter(a => (a as any).staffId === s.id);
      const revenue = appts.reduce((sum, a) => sum + parseFloat(a.totalPaid || "0"), 0);

      const timed = appts.filter((a: any) => a.startedAt && a.completedAt);
      const totalActualMin = timed.reduce((sum: number, a: any) => {
        const start = new Date(a.startedAt).getTime();
        const end = new Date(a.completedAt).getTime();
        return sum + Math.max(0, (end - start) / 60000);
      }, 0);
      const totalBookedMin = timed.reduce((sum: number, a: any) => {
        const addonMin = (a.appointmentAddons || []).reduce(
          (acc: number, aa: any) => acc + (aa.addon?.duration || 0),
          0,
        );
        return sum + (a.duration || 0) + addonMin;
      }, 0);
      const avgActualMin = timed.length ? totalActualMin / timed.length : 0;
      const avgBookedMin = timed.length ? totalBookedMin / timed.length : 0;
      const efficiency = totalActualMin > 0 ? totalBookedMin / totalActualMin : 0;

      return {
        id: s.id,
        name: s.name,
        appointments: appts.length,
        revenue,
        avgTicket: appts.length ? revenue / appts.length : 0,
        timedCount: timed.length,
        avgActualMin,
        avgBookedMin,
        efficiency,
      };
    }).sort((a, b) => b.revenue - a.revenue),
  [staffList, completedAppts]);

  // ── Services ──────────────────────────────────────────────────────────────
  const serviceStats = useMemo(() =>
    services.map((svc: any) => {
      const appts = completedAppts.filter(a => (a as any).serviceId === svc.id);
      const revenue = appts.reduce((sum, a) => sum + parseFloat(a.totalPaid || "0"), 0);

      const timed = appts.filter((a: any) => a.startedAt && a.completedAt);
      const totalActualMin = timed.reduce((sum: number, a: any) => {
        const start = new Date(a.startedAt).getTime();
        const end = new Date(a.completedAt).getTime();
        return sum + Math.max(0, (end - start) / 60000);
      }, 0);
      const bookedDur = svc.duration || 0;
      const avgActualMin = timed.length ? totalActualMin / timed.length : 0;
      const efficiency = avgActualMin > 0 ? bookedDur / avgActualMin : 0;
      const avgOverMin = avgActualMin - bookedDur;

      return {
        id: svc.id,
        name: svc.name,
        bookings: appts.length,
        revenue,
        avgTicket: appts.length ? revenue / appts.length : 0,
        bookedDur,
        timedCount: timed.length,
        avgActualMin,
        avgOverMin,
        efficiency,
      };
    }).sort((a, b) => b.bookings - a.bookings).slice(0, 10),
  [services, completedAppts]);

  // ── Customers ─────────────────────────────────────────────────────────────
  const customerStats = useMemo(() => {
    return (customers as any[]).map(c => {
      const appts = completedAppts.filter(a => (a as any).customerId === c.id);
      const total = appts.reduce((s, a) => s + parseFloat(a.totalPaid || "0"), 0);
      return { id: c.id, name: c.name, visits: appts.length, totalSpend: total };
    }).sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 10);
  }, [customers, completedAppts]);

  // ── No-Show Risk (lifetime, not period-bound) ─────────────────────────────
  const noShowRisks = useMemo(() => {
    const byCustomer = new Map<number, { total: number; noShows: number; cancels: number }>();
    (appointments as any[]).forEach(a => {
      const cid = a.customerId;
      if (!cid) return;
      const entry = byCustomer.get(cid) || { total: 0, noShows: 0, cancels: 0 };
      entry.total += 1;
      if (a.status === "no_show") entry.noShows += 1;
      if (a.status === "cancelled") entry.cancels += 1;
      byCustomer.set(cid, entry);
    });
    return (customers as any[])
      .map(c => {
        const stats = byCustomer.get(c.id) || { total: 0, noShows: 0, cancels: 0 };
        const rate = stats.total > 0 ? stats.noShows / stats.total : 0;
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          total: stats.total,
          noShows: stats.noShows,
          cancels: stats.cancels,
          rate,
        };
      })
      .filter(r => r.total >= 3 && r.noShows > 0)
      .sort((a, b) => b.rate - a.rate || b.noShows - a.noShows)
      .slice(0, 10);
  }, [customers, appointments]);

  // ── Tax Summary ───────────────────────────────────────────────────────────
  const taxMonthlyRows = useMemo(() => {
    const months = eachMonthOfInterval({ start: subMonths(new Date(), 11), end: new Date() });
    return months.map(m => {
      const label = format(m, "MMM yyyy");
      const monthAppts = completedAppts.filter(a => format(new Date(a.date), "MMM yyyy") === label);
      const revenue = monthAppts.reduce((s, a) => s + parseFloat(a.totalPaid || "0"), 0);
      const tips = monthAppts.reduce((s, a) => s + parseFloat((a as any).tipAmount || "0"), 0);
      const services = revenue - tips;
      return { month: label, services: parseFloat(services.toFixed(2)), tips: parseFloat(tips.toFixed(2)), total: parseFloat(revenue.toFixed(2)) };
    });
  }, [completedAppts]);

  function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const newCustomers = useMemo(() =>
    (customers as any[]).filter(c => {
      const d = new Date(c.createdAt || c.created_at || 0);
      return d >= rangeStart;
    }), [customers, rangeStart]);

  const returningCount = useMemo(() =>
    completedAppts.reduce((acc, a) => {
      const cid = (a as any).customerId;
      if (cid) acc.add(cid);
      return acc;
    }, new Set<number>()).size, [completedAppts]);

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Reports</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Business performance across all key metrics</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={range} onValueChange={v => setRange(v as Range)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                <SelectItem value="90d">Last 90 Days</SelectItem>
                <SelectItem value="12m">Last 12 Months</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2">
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </div>
        </div>

        <Tabs defaultValue="revenue">
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="appointments">Appointments</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="customers">Customers</TabsTrigger>
            <TabsTrigger value="tax">Tax Summary</TabsTrigger>
          </TabsList>

          {/* ── REVENUE TAB ───────────────────────────────────────────────── */}
          <TabsContent value="revenue" className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Total Revenue" value={fmt(totalRevenue)} icon={DollarSign}
                trend={pct(totalRevenue, prevRevenue)} sub={rangeLabel(range)} />
              <StatCard title="Avg Daily Revenue" value={fmt(totalRevenue / Math.max(days, 1))} icon={TrendingUp}
                sub="per day in period" />
              <StatCard title="Total Tips" value={fmt(totalTips)} icon={DollarSign}
                sub={`${completedAppts.length} completed appts`} />
              <StatCard title="Avg Ticket" value={fmt(avgTicket)} icon={TrendingUp}
                trend={pct(avgTicket, prevRevenue / Math.max(prevCompleted.length, 1))} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revenue Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={revenueByDay}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                      interval={range === "7d" ? 0 : "preserveStartEnd"} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                      tickFormatter={v => "$" + (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v)} />
                    <Tooltip formatter={(v: number) => [fmt(v), "Revenue"]} />
                    <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2}
                      fill="url(#revGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {paymentBreakdown.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Revenue by Payment Method</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col md:flex-row items-center gap-6">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={paymentBreakdown} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                        dataKey="value" paddingAngle={3}>
                        {paymentBreakdown.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmt(v)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="w-full md:w-56 shrink-0 space-y-2">
                    {paymentBreakdown.map((p, i) => (
                      <div key={p.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          {p.name}
                        </div>
                        <span className="font-medium">{fmt(p.value)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── APPOINTMENTS TAB ──────────────────────────────────────────── */}
          <TabsContent value="appointments" className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Total Bookings" value={String(periodAppts.length)} icon={Calendar}
                trend={pct(periodAppts.length, prevAppts.length)} sub={rangeLabel(range)} />
              <StatCard title="Completed" value={String(completedAppts.length)} icon={UserCheck}
                sub={`${periodAppts.length ? ((completedAppts.length / periodAppts.length) * 100).toFixed(0) : 0}% completion rate`} />
              <StatCard title="Cancelled" value={String(cancelled.length)} icon={UserX}
                sub={`${periodAppts.length ? ((cancelled.length / periodAppts.length) * 100).toFixed(0) : 0}% of bookings`} />
              <StatCard title="No-Shows" value={String(noShow.length)} icon={AlertCircle}
                sub={`${periodAppts.length ? ((noShow.length / periodAppts.length) * 100).toFixed(0) : 0}% of bookings`} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Appointments Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={apptsByDay}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                      interval={range === "7d" ? 0 : "preserveStartEnd"} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="completed" name="Completed" fill="#22c55e" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="cancelled" name="Cancelled" fill="#ef4444" radius={[3, 3, 0, 0]} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {statusBreakdown.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Status Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col md:flex-row items-center gap-6">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={statusBreakdown} cx="50%" cy="50%" outerRadius={80}
                        dataKey="value" paddingAngle={3}>
                        {statusBreakdown.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="w-full md:w-56 shrink-0 space-y-2">
                    {statusBreakdown.map((s, i) => (
                      <div key={s.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          {s.name}
                        </div>
                        <span className="font-medium">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── STAFF TAB ─────────────────────────────────────────────────── */}
          <TabsContent value="staff" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <StatCard title="Active Staff" value={String(staffList.length)} icon={Users} sub="total staff members" />
              <StatCard title="Avg Revenue / Staff" value={fmt(staffList.length ? totalRevenue / staffList.length : 0)}
                icon={DollarSign} sub={rangeLabel(range)} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Revenue by Staff Member</CardTitle>
              </CardHeader>
              <CardContent>
                {staffStats.filter(s => s.appointments > 0).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No completed appointments in this period.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={staffStats.filter(s => s.appointments > 0)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                        tickFormatter={v => "$" + (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v)} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={90} />
                      <Tooltip formatter={(v: number) => fmt(v)} />
                      <Bar dataKey="revenue" name="Revenue" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Staff Performance Table</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-medium">Staff Member</th>
                        <th className="text-right py-2 px-4 font-medium">Appointments</th>
                        <th className="text-right py-2 px-4 font-medium">Revenue</th>
                        <th className="text-right py-2 px-4 font-medium">Avg Ticket</th>
                        <th className="text-right py-2 px-4 font-medium">Avg Booked</th>
                        <th className="text-right py-2 px-4 font-medium">Avg Actual</th>
                        <th className="text-right py-2 pl-4 font-medium">Efficiency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffStats.map(s => {
                        const eff = s.efficiency;
                        const effLabel = s.timedCount > 0 ? `${Math.round(eff * 100)}%` : "—";
                        const effClass = s.timedCount === 0
                          ? "text-muted-foreground"
                          : eff >= 1
                            ? "text-emerald-600 font-semibold"
                            : eff >= 0.85
                              ? "text-amber-600 font-semibold"
                              : "text-red-600 font-semibold";
                        const fmtMin = (m: number) => s.timedCount > 0
                          ? (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`)
                          : "—";
                        return (
                          <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                            <td className="py-2.5 pr-4 font-medium">{s.name}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums">{s.appointments}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums">{fmt(s.revenue)}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums">{fmt(s.avgTicket)}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground">{fmtMin(s.avgBookedMin)}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums">{fmtMin(s.avgActualMin)}</td>
                            <td className={cn("py-2.5 pl-4 text-right tabular-nums", effClass)}>{effLabel}</td>
                          </tr>
                        );
                      })}
                      {staffStats.length === 0 && (
                        <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No data available.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Avg Booked / Actual / Efficiency are calculated only from completed appointments where staff tapped Start and Checkout. Efficiency = booked time ÷ actual time (100%+ means on or under booked time).
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── SERVICES TAB ──────────────────────────────────────────────── */}
          <TabsContent value="services" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <StatCard title="Total Services" value={String(services.length)} icon={Scissors} sub="in your menu" />
              <StatCard title="Most Booked" value={serviceStats[0]?.name || "—"} icon={TrendingUp}
                sub={serviceStats[0] ? `${serviceStats[0].bookings} bookings` : ""} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top 10 Services by Bookings</CardTitle>
              </CardHeader>
              <CardContent>
                {serviceStats.filter(s => s.bookings > 0).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No completed appointments in this period.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={serviceStats.filter(s => s.bookings > 0)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                        width={120} tickFormatter={v => v.length > 16 ? v.slice(0, 15) + "…" : v} />
                      <Tooltip />
                      <Bar dataKey="bookings" name="Bookings" fill="#22c55e" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Service Revenue & Timing</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-medium">Service</th>
                        <th className="text-right py-2 px-4 font-medium">Bookings</th>
                        <th className="text-right py-2 px-4 font-medium">Revenue</th>
                        <th className="text-right py-2 px-4 font-medium">Avg Ticket</th>
                        <th className="text-right py-2 px-4 font-medium">Booked</th>
                        <th className="text-right py-2 px-4 font-medium">Avg Actual</th>
                        <th className="text-right py-2 pl-4 font-medium">+/− vs Booked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviceStats.map(s => {
                        const fmtMin = (m: number) => m >= 60
                          ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`
                          : `${Math.round(m)}m`;
                        const hasTiming = s.timedCount > 0;
                        const overMin = Math.round(s.avgOverMin);
                        const overLabel = !hasTiming
                          ? "—"
                          : overMin === 0
                            ? "On time"
                            : overMin > 0
                              ? `+${overMin}m over`
                              : `${overMin}m under`;
                        const overClass = !hasTiming
                          ? "text-muted-foreground"
                          : overMin <= 0
                            ? "text-emerald-600 font-semibold"
                            : overMin <= Math.max(5, s.bookedDur * 0.15)
                              ? "text-amber-600 font-semibold"
                              : "text-red-600 font-semibold";
                        return (
                          <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                            <td className="py-2.5 pr-4 font-medium">{s.name}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums">{s.bookings}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums">{fmt(s.revenue)}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums">{fmt(s.avgTicket)}</td>
                            <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground">
                              {s.bookedDur ? fmtMin(s.bookedDur) : "—"}
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums">
                              {hasTiming ? fmtMin(s.avgActualMin) : "—"}
                            </td>
                            <td className={cn("py-2.5 pl-4 text-right tabular-nums", overClass)}>{overLabel}</td>
                          </tr>
                        );
                      })}
                      {serviceStats.length === 0 && (
                        <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No data available.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Avg Actual is measured from when staff tap Start to Checkout. If a service consistently shows "+ over", consider increasing its booked duration to reduce schedule overruns.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── CUSTOMERS TAB ─────────────────────────────────────────────── */}
          <TabsContent value="customers" className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Total Customers" value={String((customers as any[]).length)} icon={Users} sub="all time" />
              <StatCard title="New This Period" value={String(newCustomers.length)} icon={UserCheck}
                sub={rangeLabel(range)} />
              <StatCard title="Active Clients" value={String(returningCount)} icon={TrendingUp}
                sub="booked in period" />
              <StatCard title="Avg Spend / Client" value={fmt(returningCount ? totalRevenue / returningCount : 0)}
                icon={DollarSign} sub="completed appointments" />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  No-Show Risks
                </CardTitle>
              </CardHeader>
              <CardContent>
                {noShowRisks.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No clients with a meaningful no-show history. Great news.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="text-left py-2 pr-4 font-medium">Customer</th>
                          <th className="text-right py-2 px-4 font-medium">Total Bookings</th>
                          <th className="text-right py-2 px-4 font-medium">No-Shows</th>
                          <th className="text-right py-2 px-4 font-medium">Cancels</th>
                          <th className="text-right py-2 pl-4 font-medium">No-Show Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {noShowRisks.map(r => {
                          const pctVal = Math.round(r.rate * 100);
                          const cls = r.rate >= 0.5
                            ? "text-red-600 font-bold"
                            : r.rate >= 0.25
                              ? "text-amber-600 font-semibold"
                              : "text-muted-foreground";
                          return (
                            <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                              <td className="py-2.5 pr-4">
                                <div className="font-medium">{r.name}</div>
                                {r.phone && <div className="text-xs text-muted-foreground">{r.phone}</div>}
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums">{r.total}</td>
                              <td className="py-2.5 px-4 text-right tabular-nums">{r.noShows}</td>
                              <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground">{r.cancels}</td>
                              <td className={cn("py-2.5 pl-4 text-right tabular-nums", cls)}>{pctVal}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="text-xs text-muted-foreground mt-3">
                      Lifetime no-show rate (not limited to the selected period). Only clients with 3+ total bookings and at least one no-show appear here.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top 10 Customers by Spend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-medium">Customer</th>
                        <th className="text-right py-2 px-4 font-medium">Visits</th>
                        <th className="text-right py-2 pl-4 font-medium">Total Spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerStats.map((c, i) => (
                        <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                                {i + 1}
                              </span>
                              <span className="font-medium">{c.name}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums">{c.visits}</td>
                          <td className="py-2.5 pl-4 text-right tabular-nums font-semibold">{fmt(c.totalSpend)}</td>
                        </tr>
                      ))}
                      {customerStats.length === 0 && (
                        <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">No data available.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          {/* ── TAX TAB ─────────────────────────────────────────────────── */}
          <TabsContent value="tax" className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard title="Total Revenue (12m)" value={fmt(taxMonthlyRows.reduce((s, r) => s + r.total, 0))} icon={DollarSign} sub="Last 12 months" />
              <StatCard title="Service Revenue" value={fmt(taxMonthlyRows.reduce((s, r) => s + r.services, 0))} icon={Scissors} sub="Excluding tips" />
              <StatCard title="Total Tips" value={fmt(taxMonthlyRows.reduce((s, r) => s + r.tips, 0))} icon={TrendingUp} sub="Last 12 months" />
            </div>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base">Monthly Income Breakdown</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Last 12 months — for self-assessment & accountant reports</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => downloadCsv(
                    `tax-summary-${format(new Date(), "yyyy-MM")}.csv`,
                    ["Month", "Service Revenue", "Tips", "Total Income"],
                    taxMonthlyRows.map(r => [r.month, r.services.toFixed(2), r.tips.toFixed(2), r.total.toFixed(2)])
                  )}
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-4 font-medium">Month</th>
                        <th className="text-right py-2 px-4 font-medium">Service Revenue</th>
                        <th className="text-right py-2 px-4 font-medium">Tips</th>
                        <th className="text-right py-2 pl-4 font-medium">Total Income</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxMonthlyRows.map((r) => (
                        <tr key={r.month} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="py-2.5 pr-4 font-medium">{r.month}</td>
                          <td className="py-2.5 px-4 text-right tabular-nums">{fmt(r.services)}</td>
                          <td className="py-2.5 px-4 text-right tabular-nums">{fmt(r.tips)}</td>
                          <td className="py-2.5 pl-4 text-right tabular-nums font-semibold">{fmt(r.total)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 font-bold bg-muted/30">
                        <td className="py-2.5 pr-4">Total</td>
                        <td className="py-2.5 px-4 text-right tabular-nums">{fmt(taxMonthlyRows.reduce((s, r) => s + r.services, 0))}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums">{fmt(taxMonthlyRows.reduce((s, r) => s + r.tips, 0))}</td>
                        <td className="py-2.5 pl-4 text-right tabular-nums">{fmt(taxMonthlyRows.reduce((s, r) => s + r.total, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  This report covers completed appointments only. Consult your accountant for tax advice specific to your business.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
