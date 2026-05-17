import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSelectedStore } from "@/hooks/use-store";
import { useAppointments } from "@/hooks/use-appointments";
import { useStaffList } from "@/hooks/use-staff";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";
import {
  TrendingUp, DollarSign, Users, Calendar, Star, Clock,
  ArrowUpRight, ArrowDownRight, Award
} from "lucide-react";
import { format, subDays, startOfDay, endOfDay, eachDayOfInterval, getDay, getHours } from "date-fns";
import type { AppointmentWithDetails } from "@shared/schema";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316"];

type Range = "7d" | "30d" | "90d";

export default function Analytics() {
  const { selectedStore } = useSelectedStore();
  const [range, setRange] = useState<Range>("30d");

  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const { data: appointments = [] } = useAppointments();
  const { data: staffList = [] } = useStaffList();

  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["/api/customers"],
    enabled: !!selectedStore,
  });

  const { data: services = [] } = useQuery<any[]>({
    queryKey: ["/api/services"],
    enabled: !!selectedStore,
  });

  const now = new Date();
  const rangeStart = startOfDay(subDays(now, days - 1));

  const rangeAppointments = useMemo(() => {
    return (appointments as AppointmentWithDetails[]).filter(a => {
      const d = new Date(a.date);
      return d >= rangeStart && a.status === "completed";
    });
  }, [appointments, rangeStart]);

  const allCompleted = useMemo(() => {
    return (appointments as AppointmentWithDetails[]).filter(a => a.status === "completed");
  }, [appointments]);

  const totalRevenue = useMemo(() =>
    rangeAppointments.reduce((sum, a) => sum + parseFloat(a.totalPaid || "0"), 0),
    [rangeAppointments]);

  const avgTicket = rangeAppointments.length > 0 ? totalRevenue / rangeAppointments.length : 0;

  const uniqueClients = useMemo(() => {
    const ids = new Set(rangeAppointments.map(a => a.customerId).filter(Boolean));
    return ids.size;
  }, [rangeAppointments]);

  const prevRangeStart = subDays(rangeStart, days);
  const prevAppointments = useMemo(() => {
    return (appointments as AppointmentWithDetails[]).filter(a => {
      const d = new Date(a.date);
      return d >= prevRangeStart && d < rangeStart && a.status === "completed";
    });
  }, [appointments, prevRangeStart, rangeStart]);

  const prevRevenue = prevAppointments.reduce((sum, a) => sum + parseFloat(a.totalPaid || "0"), 0);
  const revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;
  const appointmentsChange = prevAppointments.length > 0
    ? ((rangeAppointments.length - prevAppointments.length) / prevAppointments.length) * 100 : 0;

  const revenueByDay = useMemo(() => {
    const interval = eachDayOfInterval({ start: rangeStart, end: now });
    return interval.map(day => {
      const dayAppts = rangeAppointments.filter(a => {
        const d = new Date(a.date);
        return d >= startOfDay(day) && d <= endOfDay(day);
      });
      return {
        date: format(day, days <= 7 ? "EEE" : "MMM d"),
        revenue: dayAppts.reduce((s, a) => s + parseFloat(a.totalPaid || "0"), 0),
        bookings: dayAppts.length,
      };
    });
  }, [rangeAppointments, rangeStart, now, days]);

  const topServices = useMemo(() => {
    const map: Record<string, { name: string; count: number; revenue: number }> = {};
    rangeAppointments.forEach(a => {
      const name = a.service?.name || "Unknown";
      if (!map[name]) map[name] = { name, count: 0, revenue: 0 };
      map[name].count++;
      map[name].revenue += parseFloat(a.totalPaid || "0");
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  }, [rangeAppointments]);

  const staffPerformance = useMemo(() => {
    const map: Record<number, { name: string; count: number; revenue: number }> = {};
    rangeAppointments.forEach(a => {
      if (!a.staffId) return;
      if (!map[a.staffId]) map[a.staffId] = { name: a.staff?.name || "Unknown", count: 0, revenue: 0 };
      map[a.staffId].count++;
      map[a.staffId].revenue += parseFloat(a.totalPaid || "0");
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [rangeAppointments]);

  const bookingsByDow = useMemo(() => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const counts = Array(7).fill(0);
    rangeAppointments.forEach(a => {
      counts[getDay(new Date(a.date))]++;
    });
    return days.map((name, i) => ({ name, bookings: counts[i] }));
  }, [rangeAppointments]);

  const bookingsByHour = useMemo(() => {
    const counts: Record<number, number> = {};
    for (let h = 6; h <= 20; h++) counts[h] = 0;
    rangeAppointments.forEach(a => {
      const h = getHours(new Date(a.date));
      if (h >= 6 && h <= 20) counts[h]++;
    });
    return Object.entries(counts).map(([h, count]) => ({
      hour: `${parseInt(h) % 12 || 12}${parseInt(h) < 12 ? "am" : "pm"}`,
      bookings: count,
    }));
  }, [rangeAppointments]);

  const returningVsNew = useMemo(() => {
    const customerVisitCount: Record<number, number> = {};
    allCompleted.forEach(a => {
      if (a.customerId) customerVisitCount[a.customerId] = (customerVisitCount[a.customerId] || 0) + 1;
    });
    let returning = 0, newC = 0;
    rangeAppointments.forEach(a => {
      if (!a.customerId) { newC++; return; }
      if ((customerVisitCount[a.customerId] || 0) > 1) {
        returning++;
      } else {
        newC++;
      }
    });
    return [
      { name: "Returning", value: returning },
      { name: "New", value: newC },
    ];
  }, [rangeAppointments, allCompleted]);

  const statCards = [
    {
      label: "Total Revenue",
      value: `$${totalRevenue.toFixed(2)}`,
      change: revenueChange,
      icon: DollarSign,
      color: "text-emerald-500",
      bg: "bg-emerald-50 dark:bg-emerald-950",
    },
    {
      label: "Appointments",
      value: rangeAppointments.length,
      change: appointmentsChange,
      icon: Calendar,
      color: "text-indigo-500",
      bg: "bg-indigo-50 dark:bg-indigo-950",
    },
    {
      label: "Unique Clients",
      value: uniqueClients,
      change: 0,
      icon: Users,
      color: "text-amber-500",
      bg: "bg-amber-50 dark:bg-amber-950",
    },
    {
      label: "Avg Ticket",
      value: `$${avgTicket.toFixed(2)}`,
      change: 0,
      icon: TrendingUp,
      color: "text-purple-500",
      bg: "bg-purple-50 dark:bg-purple-950",
    },
  ];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-muted-foreground">Business performance insights</p>
          </div>
          <Select value={range} onValueChange={(v: Range) => setRange(v)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <Card key={card.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{card.label}</span>
                  <div className={`p-2 rounded-lg ${card.bg}`}>
                    <card.icon className={`h-4 w-4 ${card.color}`} />
                  </div>
                </div>
                <div className="text-2xl font-bold">{card.value}</div>
                {card.change !== 0 && (
                  <div className={`flex items-center gap-1 text-xs mt-1 ${card.change >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {card.change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {Math.abs(card.change).toFixed(1)}% vs prev period
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Revenue & Bookings Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={revenueByDay}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} />
                  <Area type="monotone" dataKey="revenue" stroke="#6366f1" fill="url(#revGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily Bookings</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={revenueByDay}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="bookings" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Top Services + Client Mix */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Top Services by Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              {topServices.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topServices} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                    <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, "Revenue"]} />
                    <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                      {topServices.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Client Mix</CardTitle>
            </CardHeader>
            <CardContent>
              {returningVsNew[0].value + returningVsNew[1].value === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={returningVsNew} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" paddingAngle={4}>
                      {returningVsNew.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Busiest Days + Hours */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bookings by Day of Week</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={bookingsByDow}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="bookings" radius={[4, 4, 0, 0]}>
                    {bookingsByDow.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Peak Hours</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={bookingsByHour}>
                  <defs>
                    <linearGradient id="hourGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="bookings" stroke="#f59e0b" fill="url(#hourGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Staff Performance */}
        {staffPerformance.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Award className="h-4 w-4 text-amber-500" />
                Staff Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {staffPerformance.map((s, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
                      style={{ background: COLORS[i % COLORS.length] + "22", color: COLORS[i % COLORS.length] }}>
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-muted-foreground">{s.count} appts · <span className="font-semibold text-foreground">${s.revenue.toFixed(2)}</span></span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(s.revenue / (staffPerformance[0].revenue || 1)) * 100}%`,
                            background: COLORS[i % COLORS.length],
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
