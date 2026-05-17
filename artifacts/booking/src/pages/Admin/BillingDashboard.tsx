import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign, Users, AlertTriangle, CheckCircle, Clock, TrendingUp,
  Search, ChevronDown, RefreshCw, XCircle, FileText, CreditCard,
  Activity, Loader2, ArrowUpCircle, ArrowDownCircle, RotateCcw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number | string | null | undefined): string {
  if (cents == null) return "$0.00";
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function statusBadge(status: string | null | undefined) {
  const map: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    trialing: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    past_due: "bg-red-500/15 text-red-400 border-red-500/30",
    canceled: "bg-zinc-600/20 text-zinc-400 border-zinc-600/30",
    unpaid: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    paused: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    none: "bg-zinc-700/20 text-zinc-500 border-zinc-700/30",
  };
  const cls = map[status ?? "none"] ?? map.none;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {status ?? "none"}
    </span>
  );
}

function severityIcon(severity: string) {
  switch (severity) {
    case "success": return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    case "warn":    return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    case "error":   return <XCircle className="w-4 h-4 text-red-400" />;
    default:        return <Activity className="w-4 h-4 text-zinc-400" />;
  }
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, { credentials: "include", ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ─── Refund Dialog ────────────────────────────────────────────────────────────

function RefundDialog({
  open, onClose, salonId, charge,
}: {
  open: boolean;
  onClose: () => void;
  salonId: number;
  charge?: { stripeChargeId?: string; stripePaymentIntentId?: string; amountCents?: number };
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(charge?.amountCents ? String(charge.amountCents / 100) : "");
  const [reason, setReason] = useState<string>("requested_by_customer");
  const [notes, setNotes] = useState("");

  const refundMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/billing/admin/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId,
          stripeChargeId: charge?.stripeChargeId,
          stripePaymentIntentId: charge?.stripePaymentIntentId,
          amountCents: amount ? Math.round(Number(amount) * 100) : undefined,
          reason,
          internalNotes: notes,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-salon-billing", salonId] });
      toast({ title: "Refund issued", description: "The refund has been processed." });
      onClose();
    },
    onError: (err: any) => toast({ title: "Refund failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle>Issue Refund</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Amount (leave blank for full refund)</label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 29.00"
              className="bg-zinc-800 border-zinc-600 text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Reason</label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="bg-zinc-800 border-zinc-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="requested_by_customer">Requested by customer</SelectItem>
                <SelectItem value="duplicate">Duplicate charge</SelectItem>
                <SelectItem value="fraudulent">Fraudulent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Internal notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Agent notes (not visible to customer)"
              className="bg-zinc-800 border-zinc-600 text-white resize-none"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="text-zinc-400" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-violet-600 hover:bg-violet-500"
            onClick={() => refundMutation.mutate()}
            disabled={refundMutation.isPending}
          >
            {refundMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            Issue Refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Salon Detail ─────────────────────────────────────────────────────────────

function SalonBillingDetail({ salonId, onBack }: { salonId: number; onBack: () => void }) {
  const { toast } = useToast();
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [selectedCharge, setSelectedCharge] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-salon-billing", salonId],
    queryFn: () => apiFetch(`/api/billing/admin/salon/${salonId}`),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
      </div>
    );
  }

  const { billing, invoices, transactions, refunds: refundList, timeline, planChanges } = data ?? {};
  const profile = billing?.profile;
  const sub = billing?.subscription;
  const plan = billing?.plan;
  const pm = billing?.paymentMethod;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" className="text-zinc-400 hover:text-white px-2" onClick={onBack}>
          ← Back
        </Button>
        <h2 className="text-xl font-bold text-white">{billing?.store?.name ?? `Salon #${salonId}`}</h2>
        {statusBadge(sub?.status ?? profile?.currentSubscriptionStatus)}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Lifetime Spend", value: formatCents(profile?.lifetimeValueCents), icon: DollarSign, color: "text-emerald-400" },
          { label: "Current Plan", value: plan?.name ?? "—", icon: TrendingUp, color: "text-violet-400" },
          { label: "Failed Payments", value: profile?.totalFailedPayments ?? 0, icon: AlertTriangle, color: "text-red-400" },
          { label: "Delinquent", value: profile?.delinquent ? "Yes" : "No", icon: XCircle, color: profile?.delinquent ? "text-red-400" : "text-zinc-400" },
        ].map((kpi) => (
          <Card key={kpi.label} className="bg-zinc-900/60 border-zinc-700/40">
            <CardContent className="p-4 flex items-start gap-3">
              <kpi.icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${kpi.color}`} />
              <div>
                <p className="text-zinc-400 text-xs">{kpi.label}</p>
                <p className="text-white font-semibold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview" className="space-y-3">
        <TabsList className="bg-zinc-800/60 border border-zinc-700/40">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="refunds">Refunds</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="history">Plan History</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4 mt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Subscription */}
            <Card className="bg-zinc-900/60 border-zinc-700/40">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-300">Subscription</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Status" value={statusBadge(sub?.status)} />
                <Row label="Plan" value={plan?.name ?? "—"} />
                <Row label="Price" value={formatCents(plan?.priceCents)} />
                <Row label="Interval" value={sub?.interval ?? "—"} />
                <Row label="Period End" value={sub?.currentPeriodEnd ? format(new Date(Number(sub.currentPeriodEnd) > 9999999999 ? Number(sub.currentPeriodEnd) : Number(sub.currentPeriodEnd) * 1000), "MMM d, yyyy") : "—"} />
                <Row label="Cancel at End" value={sub?.cancelAtPeriodEnd === 1 ? "Yes" : "No"} />
              </CardContent>
            </Card>

            {/* Billing Profile */}
            <Card className="bg-zinc-900/60 border-zinc-700/40">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-300">Billing Profile</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Email" value={profile?.customerEmail ?? "—"} />
                <Row label="Payment Method" value={pm ? `${pm.brand} ···· ${pm.last4}` : "—"} />
                <Row label="Delinquent" value={profile?.delinquent ? <span className="text-red-400">Yes</span> : "No"} />
                <Row label="Account Hold" value={profile?.accountHold ? <span className="text-red-400">Yes</span> : "No"} />
                <Row label="Last Payment" value={profile?.lastPaymentDate ? format(new Date(profile.lastPaymentDate), "MMM d, yyyy") : "—"} />
                <Row label="Last Failed" value={profile?.lastFailedPaymentDate ? format(new Date(profile.lastFailedPaymentDate), "MMM d, yyyy") : "—"} />
              </CardContent>
            </Card>
          </div>

          {profile?.internalBillingNotes && (
            <Card className="bg-amber-500/10 border-amber-500/25">
              <CardContent className="p-4">
                <p className="text-amber-300 text-sm font-medium">Internal Notes</p>
                <p className="text-amber-200 text-sm mt-1">{profile.internalBillingNotes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Invoices */}
        <TabsContent value="invoices" className="mt-2">
          <Card className="bg-zinc-900/60 border-zinc-700/40">
            <CardContent className="p-0">
              {!invoices?.length ? (
                <p className="text-zinc-500 text-sm p-4">No invoices.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700/50">
                      {["Invoice", "Date", "Total", "Paid", "Status", ""].map((h) => (
                        <th key={h} className="text-left text-zinc-400 font-medium px-4 py-3 text-xs">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {invoices.map((inv: any) => (
                      <tr key={inv.id} className="hover:bg-zinc-800/20">
                        <td className="px-4 py-3 text-zinc-300">{inv.invoiceNumber ?? inv.stripeInvoiceId?.slice(-8)}</td>
                        <td className="px-4 py-3 text-zinc-400">{format(new Date(inv.createdAt), "MMM d, yyyy")}</td>
                        <td className="px-4 py-3 text-white font-medium">{formatCents(inv.totalCents)}</td>
                        <td className="px-4 py-3 text-white font-medium">{formatCents(inv.amountPaidCents)}</td>
                        <td className="px-4 py-3">{statusBadge(inv.status)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {inv.hostedInvoiceUrl && (
                              <a href={inv.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-zinc-400 hover:text-white">
                                  <FileText className="w-3.5 h-3.5" />
                                </Button>
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payments */}
        <TabsContent value="payments" className="mt-2">
          <Card className="bg-zinc-900/60 border-zinc-700/40">
            <CardContent className="p-0">
              {!transactions?.length ? (
                <p className="text-zinc-500 text-sm p-4">No transactions.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700/50">
                      {["Date", "Amount", "Card", "Status", "Failure", ""].map((h) => (
                        <th key={h} className="text-left text-zinc-400 font-medium px-4 py-3 text-xs">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {transactions.map((txn: any) => (
                      <tr key={txn.id} className="hover:bg-zinc-800/20">
                        <td className="px-4 py-3 text-zinc-400">{format(new Date(txn.createdAt), "MMM d, yyyy")}</td>
                        <td className="px-4 py-3 text-white font-medium">{formatCents(txn.amountCents)}</td>
                        <td className="px-4 py-3 text-zinc-300">
                          {txn.paymentMethodBrand ? `${txn.paymentMethodBrand} ···· ${txn.paymentMethodLast4}` : "—"}
                        </td>
                        <td className="px-4 py-3">{statusBadge(txn.status)}</td>
                        <td className="px-4 py-3 text-red-400 text-xs max-w-[200px] truncate">{txn.failureMessage ?? "—"}</td>
                        <td className="px-4 py-3">
                          {!txn.refunded && txn.stripeChargeId && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-zinc-400 hover:text-violet-400"
                              onClick={() => { setSelectedCharge(txn); setRefundDialogOpen(true); }}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {txn.refunded && <span className="text-xs text-amber-400">Refunded</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Refunds */}
        <TabsContent value="refunds" className="mt-2">
          <Card className="bg-zinc-900/60 border-zinc-700/40">
            <CardContent className="p-0">
              {!refundList?.length ? (
                <p className="text-zinc-500 text-sm p-4">No refunds issued.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700/50">
                      {["Date", "Amount", "Reason", "Type", "Status", "Notes"].map((h) => (
                        <th key={h} className="text-left text-zinc-400 font-medium px-4 py-3 text-xs">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {refundList.map((r: any) => (
                      <tr key={r.id} className="hover:bg-zinc-800/20">
                        <td className="px-4 py-3 text-zinc-400">{format(new Date(r.createdAt), "MMM d, yyyy")}</td>
                        <td className="px-4 py-3 text-white font-medium">{formatCents(r.amountCents)}</td>
                        <td className="px-4 py-3 text-zinc-300 capitalize">{r.reason?.replace(/_/g, " ") ?? "—"}</td>
                        <td className="px-4 py-3 text-zinc-400 capitalize">{r.refundType ?? "manual"}</td>
                        <td className="px-4 py-3">{statusBadge(r.status)}</td>
                        <td className="px-4 py-3 text-zinc-500 text-xs max-w-[160px] truncate">{r.internalReasonNotes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timeline */}
        <TabsContent value="timeline" className="mt-2">
          <Card className="bg-zinc-900/60 border-zinc-700/40">
            <CardContent className="p-4">
              {!timeline?.length ? (
                <p className="text-zinc-500 text-sm">No activity yet.</p>
              ) : (
                <div className="space-y-3">
                  {timeline.map((event: any) => (
                    <div key={event.id} className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5">{severityIcon(event.severity)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-zinc-200 text-sm">{event.message}</p>
                        <p className="text-zinc-500 text-xs mt-0.5">
                          {format(new Date(event.createdAt), "MMM d, yyyy 'at' h:mm a")}
                          {event.source && event.source !== "system" ? ` · via ${event.source}` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Plan History */}
        <TabsContent value="history" className="mt-2">
          <Card className="bg-zinc-900/60 border-zinc-700/40">
            <CardContent className="p-0">
              {!planChanges?.length ? (
                <p className="text-zinc-500 text-sm p-4">No plan changes recorded.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-700/50">
                      {["Date", "Type", "From", "To", "Proration", "By"].map((h) => (
                        <th key={h} className="text-left text-zinc-400 font-medium px-4 py-3 text-xs">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {planChanges.map((c: any) => (
                      <tr key={c.id} className="hover:bg-zinc-800/20">
                        <td className="px-4 py-3 text-zinc-400">{format(new Date(c.createdAt), "MMM d, yyyy")}</td>
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1 text-xs font-medium ${c.changeType === "upgrade" ? "text-emerald-400" : "text-amber-400"}`}>
                            {c.changeType === "upgrade"
                              ? <ArrowUpCircle className="w-3.5 h-3.5" />
                              : <ArrowDownCircle className="w-3.5 h-3.5" />}
                            {c.changeType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-300">{formatCents(c.oldPriceCents)}</td>
                        <td className="px-4 py-3 text-zinc-300">{formatCents(c.newPriceCents)}</td>
                        <td className="px-4 py-3 text-zinc-400">{c.proractionUsed ? formatCents(c.proratedAmountCents) : "None"}</td>
                        <td className="px-4 py-3 text-zinc-500 text-xs">{c.initiatedBy ?? "system"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RefundDialog
        open={refundDialogOpen}
        onClose={() => setRefundDialogOpen(false)}
        salonId={salonId}
        charge={selectedCharge}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200 text-right">{value}</span>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function BillingDashboard() {
  const [selectedSalon, setSelectedSalon] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { data: overview, isLoading } = useQuery({
    queryKey: ["admin-billing-overview"],
    queryFn: () => apiFetch("/api/billing/admin/overview"),
  });

  if (selectedSalon) {
    return (
      <div className="p-6">
        <SalonBillingDetail salonId={selectedSalon} onBack={() => setSelectedSalon(null)} />
      </div>
    );
  }

  const profiles: any[] = overview?.profiles ?? [];
  const filtered = profiles.filter((row) => {
    if (!search) return true;
    const name = row.profile?.customerName?.toLowerCase() ?? "";
    const email = row.profile?.customerEmail?.toLowerCase() ?? "";
    const q = search.toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Billing Dashboard</h1>
        <p className="text-zinc-400 text-sm mt-1">Full visibility into subscription and payment status</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Monthly Recurring Revenue", value: formatCents(overview?.totalMrrCents), icon: DollarSign, color: "text-emerald-400" },
          { label: "Active Subscriptions", value: overview?.activeCount ?? 0, icon: CheckCircle, color: "text-emerald-400" },
          { label: "Trialing", value: overview?.trialCount ?? 0, icon: Clock, color: "text-violet-400" },
          { label: "Delinquent", value: overview?.delinquentCount ?? 0, icon: AlertTriangle, color: "text-red-400" },
        ].map((stat) => (
          <Card key={stat.label} className="bg-zinc-900/70 border-zinc-700/50">
            <CardContent className="p-4 flex items-start gap-3">
              <stat.icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${stat.color}`} />
              <div>
                <p className="text-zinc-500 text-xs">{stat.label}</p>
                <p className="text-white text-xl font-bold">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          className="pl-9 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
        />
      </div>

      {/* Profiles Table */}
      <Card className="bg-zinc-900/70 border-zinc-700/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
            </div>
          ) : !filtered.length ? (
            <p className="text-zinc-500 text-sm p-6">{search ? "No results found." : "No billing profiles yet."}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700/50">
                  {["Account", "Status", "Plan", "MRR", "Lifetime", "Delinquent", ""].map((h) => (
                    <th key={h} className="text-left text-zinc-400 font-medium px-4 py-3 text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {filtered.map((row: any) => (
                  <tr
                    key={row.profile.id}
                    className="hover:bg-zinc-800/30 transition-colors cursor-pointer"
                    onClick={() => row.profile.salonId && setSelectedSalon(row.profile.salonId)}
                  >
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{row.profile.customerName ?? "—"}</p>
                      <p className="text-zinc-500 text-xs">{row.profile.customerEmail ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3">{statusBadge(row.profile.currentSubscriptionStatus)}</td>
                    <td className="px-4 py-3 text-zinc-300">{row.plan?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-white font-medium">{row.plan?.priceCents ? formatCents(row.plan.priceCents) : "—"}</td>
                    <td className="px-4 py-3 text-zinc-300">{formatCents(row.profile.lifetimeValueCents)}</td>
                    <td className="px-4 py-3">
                      {row.profile.delinquent ? (
                        <span className="text-red-400 flex items-center gap-1 text-xs">
                          <AlertTriangle className="w-3.5 h-3.5" /> Yes
                        </span>
                      ) : (
                        <span className="text-zinc-500 text-xs">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      <ChevronDown className="w-4 h-4 -rotate-90" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
