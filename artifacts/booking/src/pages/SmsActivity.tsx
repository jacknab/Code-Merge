import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { useSelectedStore } from "@/hooks/use-store";
import {
  MessageSquare, TrendingUp, Wallet, DollarSign,
  ChevronDown, ChevronUp, Loader2, Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

// ── helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function typeLabel(t: string) {
  const map: Record<string, string> = {
    booking_confirmation: "Confirmation",
    confirmation: "Confirmation",
    reminder: "Reminder",
    review_request: "Review",
    review: "Review",
    marketing: "Marketing",
    system: "System",
    "sandbox-skipped": "Sandbox",
  };
  return map[t] ?? t;
}

function sourceBadge(src: string | null) {
  if (src === "allowance")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/25">
        Allowance
      </span>
    );
  if (src === "credits")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
        Credits
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-700/40 text-zinc-400 border border-zinc-700/40">
      —
    </span>
  );
}

function statusDot(status: string) {
  if (status === "sent") return "bg-emerald-400";
  if (status === "failed") return "bg-red-400";
  if (status === "sandbox-skipped") return "bg-zinc-500";
  return "bg-zinc-500";
}

// ── types ─────────────────────────────────────────────────────────────────────

interface SmsLogRow {
  id: number;
  storeId: number;
  phone: string;
  messageType: string;
  messageBody: string;
  status: string;
  smsSource: string | null;
  costEstimate: string | null;
  sentAt: string;
}

interface Summary {
  totalSent: number;
  fromAllowance: number;
  fromCredits: number;
  estimatedCost: number;
  estimatedRevenue: number;
  byType: Record<string, number>;
  days: number;
}

interface LogResponse {
  rows: SmsLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface LocationGroup {
  storeId: number;
  storeName: string;
  totalSent: number;
  fromAllowance: number;
  fromCredits: number;
  estimatedCost: number;
}

const DAY_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

const TYPE_OPTIONS = [
  { label: "All types", value: "" },
  { label: "Reminders", value: "reminder" },
  { label: "Confirmations", value: "booking_confirmation" },
  { label: "Reviews", value: "review_request" },
  { label: "Marketing", value: "marketing" },
  { label: "System", value: "system" },
];

const SOURCE_OPTIONS = [
  { label: "All sources", value: "" },
  { label: "Allowance", value: "allowance" },
  { label: "Credits", value: "credits" },
];

// ── component ─────────────────────────────────────────────────────────────────

export default function SmsActivity() {
  const { selectedStore } = useSelectedStore();

  const [days, setDays] = useState(30);
  const [typeFilter, setTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [page, setPage] = useState(1);
  const [expandedLocations, setExpandedLocations] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"table" | "locations">("table");

  const storeId = selectedStore?.id;

  const summaryQuery = useQuery<Summary>({
    queryKey: ["sms-activity-summary", storeId, days],
    queryFn: () => apiFetch(`/api/sms-activity/summary?storeId=${storeId}&days=${days}`),
    enabled: !!storeId,
  });

  const logQuery = useQuery<LogResponse>({
    queryKey: ["sms-activity-log", storeId, days, typeFilter, sourceFilter, page],
    queryFn: () =>
      apiFetch(
        `/api/sms-activity/log?storeId=${storeId}&days=${days}&type=${typeFilter}&source=${sourceFilter}&page=${page}&pageSize=25`
      ),
    enabled: !!storeId,
  });

  const locationQuery = useQuery<LocationGroup[]>({
    queryKey: ["sms-activity-by-location", days],
    queryFn: () => apiFetch(`/api/sms-activity/by-location?days=${days}`),
    enabled: viewMode === "locations",
  });

  const summary = summaryQuery.data;

  const handleFilterChange = () => setPage(1);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6 pb-20">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">SMS Activity</h1>
            <p className="text-zinc-500 text-xs mt-0.5">Full transparency ledger of all outbound SMS</p>
          </div>
          {/* View toggle */}
          <div className="flex rounded-lg border border-zinc-700/50 overflow-hidden">
            {(["table", "locations"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  viewMode === v
                    ? "bg-violet-600 text-white"
                    : "bg-zinc-900 text-zinc-400 hover:text-white"
                }`}
              >
                {v === "table" ? "Log" : "By Location"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Summary cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            {
              label: "Total Sent",
              value: summaryQuery.isLoading ? "—" : (summary?.totalSent ?? 0).toLocaleString(),
              icon: MessageSquare,
              color: "text-violet-400",
              bg: "bg-violet-500/10 border-violet-500/20",
            },
            {
              label: "From Allowance",
              value: summaryQuery.isLoading ? "—" : (summary?.fromAllowance ?? 0).toLocaleString(),
              icon: TrendingUp,
              color: "text-blue-400",
              bg: "bg-blue-500/10 border-blue-500/20",
            },
            {
              label: "From Credits",
              value: summaryQuery.isLoading ? "—" : (summary?.fromCredits ?? 0).toLocaleString(),
              icon: Wallet,
              color: "text-emerald-400",
              bg: "bg-emerald-500/10 border-emerald-500/20",
            },
            {
              label: "Est. Twilio Cost",
              value: summaryQuery.isLoading ? "—" : `$${(summary?.estimatedCost ?? 0).toFixed(2)}`,
              icon: DollarSign,
              color: "text-amber-400",
              bg: "bg-amber-500/10 border-amber-500/20",
            },
            {
              label: "Est. Revenue Value",
              value: summaryQuery.isLoading ? "—" : `$${(summary?.estimatedRevenue ?? 0).toFixed(2)}`,
              icon: DollarSign,
              color: "text-pink-400",
              bg: "bg-pink-500/10 border-pink-500/20",
            },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div
              key={label}
              className={`rounded-xl border p-4 ${bg} bg-zinc-900/60 space-y-2`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${bg}`}>
                <Icon className={`w-3.5 h-3.5 ${color}`} />
              </div>
              <div>
                <p className="text-white font-bold text-lg leading-none">{value}</p>
                <p className="text-zinc-500 text-[10px] mt-1 font-medium uppercase tracking-wider">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Filter bar ────────────────────────────────────────────────────── */}
        <Card className="bg-zinc-900/60 border-zinc-700/50">
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <Filter className="w-4 h-4 text-zinc-500 flex-shrink-0" />

            {/* Date range */}
            <div className="flex rounded-lg border border-zinc-700/50 overflow-hidden flex-shrink-0">
              {DAY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setDays(opt.value); setPage(1); handleFilterChange(); }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    days === opt.value
                      ? "bg-violet-600 text-white"
                      : "bg-zinc-900 text-zinc-400 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Type */}
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              className="text-xs bg-zinc-800 border border-zinc-700/50 text-zinc-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {/* Source */}
            <select
              value={sourceFilter}
              onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
              className="text-xs bg-zinc-800 border border-zinc-700/50 text-zinc-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <span className="text-zinc-600 text-xs ml-auto">
              {logQuery.data ? `${logQuery.data.total.toLocaleString()} records` : ""}
            </span>
          </CardContent>
        </Card>

        {/* ── Table view ───────────────────────────────────────────────────── */}
        {viewMode === "table" && (
          <Card className="bg-zinc-900/60 border-zinc-700/50 overflow-hidden">
            <CardHeader className="pb-0 pt-5 px-6">
              <CardTitle className="text-white text-sm font-semibold">SMS Log</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {logQuery.isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
                </div>
              ) : !logQuery.data?.rows.length ? (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                  <MessageSquare className="w-10 h-10 mb-3 opacity-40" />
                  <p className="text-sm">No SMS records found for the selected filters.</p>
                </div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800/60 text-left">
                          {["Time", "SMS Type", "Recipient", "Source", "Cost", "Status"].map(col => (
                            <th key={col} className="px-6 py-3 text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/40">
                        {logQuery.data.rows.map((row) => (
                          <tr key={row.id} className="hover:bg-zinc-800/20 transition-colors">
                            <td className="px-6 py-3.5 text-zinc-400 text-xs whitespace-nowrap">
                              {format(new Date(row.sentAt), "MMM d, h:mm a")}
                            </td>
                            <td className="px-6 py-3.5">
                              <span className="text-zinc-300 text-xs font-medium">
                                {typeLabel(row.messageType)}
                              </span>
                            </td>
                            <td className="px-6 py-3.5 text-zinc-400 text-xs font-mono">
                              {row.phone}
                            </td>
                            <td className="px-6 py-3.5">
                              {sourceBadge(row.smsSource)}
                            </td>
                            <td className="px-6 py-3.5 text-zinc-500 text-xs">
                              ${Number(row.costEstimate ?? 0).toFixed(4)}
                            </td>
                            <td className="px-6 py-3.5">
                              <span className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${statusDot(row.status)}`} />
                                <span className="text-zinc-400 text-xs capitalize">
                                  {row.status === "sandbox-skipped" ? "Sandbox" : row.status}
                                </span>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="md:hidden divide-y divide-zinc-800/40">
                    {logQuery.data.rows.map((row) => (
                      <div key={row.id} className="px-4 py-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-300 text-sm font-medium">{typeLabel(row.messageType)}</span>
                          <span className="text-zinc-500 text-xs">{format(new Date(row.sentAt), "MMM d, h:mm a")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {sourceBadge(row.smsSource)}
                          <span className="text-zinc-500 text-xs font-mono">{row.phone}</span>
                          <span className="text-zinc-600 text-xs ml-auto">${Number(row.costEstimate ?? 0).toFixed(4)}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  {(logQuery.data.totalPages ?? 1) > 1 && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800/50">
                      <span className="text-zinc-500 text-xs">
                        Page {logQuery.data.page} of {logQuery.data.totalPages}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-zinc-700"
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={page <= 1}
                        >
                          Previous
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-zinc-700"
                          onClick={() => setPage(p => Math.min(logQuery.data!.totalPages, p + 1))}
                          disabled={page >= logQuery.data.totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Location grouping view ────────────────────────────────────────── */}
        {viewMode === "locations" && (
          <Card className="bg-zinc-900/60 border-zinc-700/50 overflow-hidden">
            <CardHeader className="pb-0 pt-5 px-6">
              <CardTitle className="text-white text-sm font-semibold">SMS by Location</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {locationQuery.isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
                </div>
              ) : !locationQuery.data?.length ? (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                  <MessageSquare className="w-10 h-10 mb-3 opacity-40" />
                  <p className="text-sm">No location data available.</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/40">
                  {locationQuery.data.map((loc) => {
                    const expanded = expandedLocations.has(loc.storeId);
                    return (
                      <div key={loc.storeId}>
                        <button
                          className="w-full flex items-center gap-4 px-6 py-4 hover:bg-zinc-800/20 transition-colors text-left"
                          onClick={() => setExpandedLocations(prev => {
                            const next = new Set(prev);
                            if (expanded) next.delete(loc.storeId);
                            else next.add(loc.storeId);
                            return next;
                          })}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold truncate">{loc.storeName}</p>
                            <p className="text-zinc-500 text-xs mt-0.5">
                              {loc.totalSent} sent · ${loc.estimatedCost.toFixed(2)} est. cost
                            </p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right">
                              <p className="text-violet-300 text-xs font-semibold">{loc.fromAllowance}</p>
                              <p className="text-zinc-600 text-[10px]">allowance</p>
                            </div>
                            <div className="text-right">
                              <p className="text-emerald-300 text-xs font-semibold">{loc.fromCredits}</p>
                              <p className="text-zinc-600 text-[10px]">credits</p>
                            </div>
                            {expanded ? (
                              <ChevronUp className="w-4 h-4 text-zinc-500" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-zinc-500" />
                            )}
                          </div>
                        </button>

                        {expanded && (
                          <div className="px-6 pb-4 bg-zinc-800/20 border-t border-zinc-800/40">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                              {[
                                { label: "Total SMS", value: loc.totalSent.toLocaleString(), color: "text-white" },
                                { label: "Allowance", value: loc.fromAllowance.toLocaleString(), color: "text-violet-300" },
                                { label: "Credits", value: loc.fromCredits.toLocaleString(), color: "text-emerald-300" },
                                { label: "Est. Cost", value: `$${loc.estimatedCost.toFixed(2)}`, color: "text-amber-300" },
                              ].map(({ label, value, color }) => (
                                <div key={label} className="bg-zinc-900/60 rounded-lg p-3">
                                  <p className={`text-sm font-bold ${color}`}>{value}</p>
                                  <p className="text-zinc-500 text-[10px] mt-0.5 uppercase tracking-wider">{label}</p>
                                </div>
                              ))}
                            </div>
                            {/* Allowance vs credits bar */}
                            {loc.totalSent > 0 && (
                              <div className="mt-3">
                                <p className="text-zinc-600 text-[10px] mb-1.5 uppercase tracking-wider">Allowance vs Credits split</p>
                                <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden flex">
                                  <div
                                    className="h-full bg-violet-500 transition-all"
                                    style={{ width: `${(loc.fromAllowance / loc.totalSent) * 100}%` }}
                                  />
                                  <div
                                    className="h-full bg-emerald-500 transition-all"
                                    style={{ width: `${(loc.fromCredits / loc.totalSent) * 100}%` }}
                                  />
                                </div>
                                <div className="flex gap-4 mt-1.5">
                                  <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                                    <span className="w-2 h-2 rounded-full bg-violet-500" /> Allowance
                                  </span>
                                  <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500" /> Credits
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
