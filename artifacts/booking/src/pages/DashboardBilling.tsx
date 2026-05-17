import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import {
  CreditCard, FileText, XCircle, CheckCircle, Clock, AlertTriangle,
  Download, Loader2, Zap, Shield, LifeBuoy, ChevronRight,
  Calendar, RefreshCw, ExternalLink, Info, BadgeCheck, Sparkles,
  Code2, MessageSquare, ShoppingCart, ChevronsUpDown,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useSelectedStore } from "@/hooks/use-store";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ─── Plans ────────────────────────────────────────────────────────────────────
const PLANS = [
  {
    code: "solo",
    name: "Solo",
    price: 9,
    tagline: "For independent stylists & booth renters",
    highlight: "1 calendar · 1 staff",
    features: ["1 calendar", "1 staff member", "Online booking page", "200 SMS/mo"],
    notIncluded: ["Payments & card reader"],
    apiDocs: false,
  },
  {
    code: "professional",
    name: "Professional",
    price: 22,
    tagline: "Everything, unlimited — any salon size",
    highlight: "Unlimited calendars & staff",
    features: ["Unlimited calendars", "Unlimited staff", "Online booking page", "Payments & card reader", "Unlimited SMS", "Reserve With Google", "Advanced reporting", "Priority support"],
    notIncluded: [],
    apiDocs: false,
  },
  {
    code: "elite",
    name: "Elite",
    price: 49,
    tagline: "Full API access for custom integrations",
    highlight: "Unlimited API · 50K SMS · Webhooks",
    features: ["Everything in Professional", "Unlimited API keys", "50,000 SMS credits/mo", "Chatbot & Dialer API", "Webhooks & real-time events", "1,000 API requests/min", "99.9% uptime SLA", "Priority support (4 h)"],
    notIncluded: [],
    apiDocs: true,
  },
];

const CANCEL_REASONS = [
  "Too expensive for my business",
  "Switching to a different software",
  "Not using it enough",
  "Missing a feature I need",
  "Technical issues",
  "Taking a break",
  "Other",
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface BillingData {
  profile: any;
  subscription: any;
  stripeSub: any;
  plan: any;
  paymentMethod: { brand: string; last4: string; expMonth?: number; expYear?: number } | null;
  store: { id: number; name: string; email: string };
}

interface Invoice {
  id: number;
  stripeInvoiceId: string;
  invoiceNumber: string | null;
  status: string | null;
  paid: boolean;
  totalCents: number;
  amountPaidCents: number;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  billingReason: string | null;
  createdAt: string;
}

interface UpcomingInvoice {
  amountDueCents: number;
  nextPaymentAttempt: number | null;
  lines: { description: string; amountCents: number; quantity?: number }[];
  currency: string;
}

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
  billingEmail?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtExact(cents: number | null | undefined): string {
  if (cents == null) return "$0.00";
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, { credentials: "include", ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Request failed: ${res.status}`);
  }
  return res.json();
}

const STATUS_CONFIG: Record<string, { label: string; cls: string; dot: string }> = {
  active:   { label: "Active",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200",   dot: "bg-emerald-500" },
  trialing: { label: "Trial",    cls: "bg-violet-50 text-violet-700 border-violet-200",       dot: "bg-violet-500" },
  past_due: { label: "Past Due", cls: "bg-red-50 text-red-700 border-red-200",               dot: "bg-red-500" },
  canceled: { label: "Canceled", cls: "bg-gray-100 text-gray-500 border-gray-200",           dot: "bg-gray-400" },
  unpaid:   { label: "Unpaid",   cls: "bg-orange-50 text-orange-700 border-orange-200",      dot: "bg-orange-500" },
  paused:   { label: "Paused",   cls: "bg-blue-50 text-blue-700 border-blue-200",            dot: "bg-blue-500" },
  none:     { label: "No Plan",  cls: "bg-gray-100 text-gray-500 border-gray-200",           dot: "bg-gray-400" },
};

function getStatus(status: string | null | undefined) {
  return STATUS_CONFIG[status ?? "none"] ?? STATUS_CONFIG["none"];
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DashboardBilling() {
  const { selectedStore } = useSelectedStore();
  const salonId = selectedStore?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [showPlanConfirm, setShowPlanConfirm] = useState(false);
  const [cancelStep, setCancelStep] = useState<"idle" | "reason" | "retention" | "confirm">("idle");
  const [cancelReason, setCancelReason] = useState("");

  const sessionStatus = searchParams.get("status");

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: billing, isLoading: billingLoading } = useQuery<BillingData>({
    queryKey: ["billing-profile", salonId],
    queryFn: () => apiFetch(`/api/billing/profile/${salonId}`),
    enabled: !!salonId,
  });

  const { data: invoicesData } = useQuery<{ invoices: Invoice[] }>({
    queryKey: ["billing-invoices", salonId],
    queryFn: () => apiFetch(`/api/billing/invoices/${salonId}`),
    enabled: !!salonId,
  });

  const { data: upcomingData } = useQuery<UpcomingInvoice | null>({
    queryKey: ["billing-upcoming", salonId],
    queryFn: () => apiFetch(`/api/billing/upcoming/${salonId}`),
    enabled: !!salonId,
    retry: false,
  });

  const { data: paymentMethods } = useQuery<PaymentMethod[]>({
    queryKey: ["billing-payment-methods", salonId],
    queryFn: () => apiFetch(`/api/billing/payment-methods/${salonId}`),
    enabled: !!salonId,
    retry: false,
  });

  const { data: stripeStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["stripe-status"],
    queryFn: () => apiFetch("/api/billing/status"),
  });

  const { data: smsStatus, isLoading: smsLoading } = useQuery<{
    smsAllowance: number;
    smsCredits: number;
    smsCreditsTotalPurchased: number;
    planMonthlyAllowance: number;
    planName: string;
    packages: { id: string; priceCents: number; credits: number; label: string }[];
  }>({
    queryKey: ["sms-status", salonId],
    queryFn: () => apiFetch(`/api/billing/sms-status/${salonId}`),
    enabled: !!salonId,
  });

  const stripeConfigured = stripeStatus?.configured ?? false;

  // ── Mutations ────────────────────────────────────────────────────────────────
  const changePlanMutation = useMutation({
    mutationFn: (newPlanCode: string) =>
      apiFetch(`/api/billing/change-plan/${salonId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPlanCode, interval: "month" }),
      }),
    onSuccess: (_data, newPlanCode) => {
      queryClient.invalidateQueries({ queryKey: ["billing-profile", salonId] });
      queryClient.invalidateQueries({ queryKey: ["billing-upcoming", salonId] });
      queryClient.invalidateQueries({ queryKey: ["billing-invoices", salonId] });
      setShowPlanConfirm(false);
      setSwitchingTo(null);
      const newPlan = PLANS.find(p => p.code === newPlanCode) ?? PLANS[0];
      toast({ title: "Plan updated", description: `Switched to ${newPlan.name} — $${newPlan.price}/month.` });
    },
    onError: (err: any) =>
      toast({ title: "Could not switch plan", description: err.message, variant: "destructive" }),
  });

  const portalMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salonId }),
      }),
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/billing/cancel/${salonId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stripeSubscriptionId: billing?.subscription?.stripeSubscriptionId,
          atPeriodEnd: true,
          reason: cancelReason,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing-profile", salonId] });
      setCancelStep("idle");
      toast({ title: "Cancellation scheduled", description: "Your subscription will end at the current billing period." });
    },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/billing/resume/${salonId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stripeSubscriptionId: billing?.subscription?.stripeSubscriptionId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing-profile", salonId] });
      toast({ title: "Subscription resumed", description: "Your cancellation has been reversed." });
    },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const smsBucketMutation = useMutation({
    mutationFn: (packageId: string) =>
      apiFetch("/api/billing/sms-bucket/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salonId, packageId }),
      }),
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (err: any) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Derived state ─────────────────────────────────────────────────────────────
  const sub = billing?.subscription;
  const profile = billing?.profile;
  const pm = billing?.paymentMethod ?? paymentMethods?.[0] ?? null;

  const subStatus = sub?.status ?? profile?.currentSubscriptionStatus;
  const statusCfg = getStatus(subStatus);

  const isScheduledToCancel = sub?.cancelAtPeriodEnd === 1 || sub?.cancelAtPeriodEnd === true;
  const isActive = subStatus === "active" || subStatus === "trialing";
  const isTrialing = subStatus === "trialing";
  const isPastDue = subStatus === "past_due";

  const periodEnd = sub?.currentPeriodEnd
    ? new Date(Number(sub.currentPeriodEnd) > 1e10 ? Number(sub.currentPeriodEnd) : Number(sub.currentPeriodEnd) * 1000)
    : null;

  const periodStart = sub?.currentPeriodStart
    ? new Date(Number(sub.currentPeriodStart) > 1e10 ? Number(sub.currentPeriodStart) : Number(sub.currentPeriodStart) * 1000)
    : null;

  const currentPlan = PLANS.find(p => p.code === (billing?.plan?.code ?? sub?.planCode)) ?? PLANS[0];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6 pb-20">

        {/* ── Page header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Billing & Subscription</h1>
            <p className="text-sm text-gray-500 mt-0.5">{billing?.store?.name ?? selectedStore?.name}</p>
          </div>
          <span className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border",
            statusCfg.cls
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full", statusCfg.dot)} />
            {statusCfg.label}
          </span>
        </div>

        {/* ── Loading state ────────────────────────────────────────────────────── */}
        {billingLoading && (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-gray-500 text-sm">Loading billing information…</p>
            </div>
          </div>
        )}

        {!billingLoading && (
          <>
            {/* ── Banners ───────────────────────────────────────────────────────── */}
            {sessionStatus === "success" && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                <span className="text-emerald-700 text-sm font-medium">Subscription activated — welcome aboard!</span>
              </div>
            )}
            {!stripeConfigured && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <span className="text-amber-700 text-sm">Payment processing is not yet configured. Contact support to activate billing.</span>
              </div>
            )}
            {isPastDue && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <span className="text-red-700 text-sm font-medium">Your account has a past-due balance. Update your payment method to restore full access.</span>
                </div>
                {stripeConfigured && (
                  <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white text-xs flex-shrink-0"
                    onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
                    {portalMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Update Payment"}
                  </Button>
                )}
              </div>
            )}

            {/* ── Subscription hero ─────────────────────────────────────────────── */}
            <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-white to-violet-50">
              <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
              <div className="relative p-6 sm:p-8">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-2">
                        Certxa {currentPlan.name}
                      </p>
                      <div className="flex items-end gap-2">
                        <span className="text-5xl font-bold text-gray-900 tracking-tight">${currentPlan.price}</span>
                        <span className="text-gray-400 text-base mb-2">/ month</span>
                      </div>
                      <p className="text-gray-500 text-sm mt-1">{currentPlan.highlight}</p>
                    </div>
                    {isScheduledToCancel && periodEnd && (
                      <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 text-xs">
                        <Clock className="w-3.5 h-3.5" />
                        Access ends {format(periodEnd, "MMMM d, yyyy")}
                      </div>
                    )}
                    {isTrialing && (
                      <div className="inline-flex items-center gap-2 bg-violet-50 border border-violet-200 text-violet-700 rounded-lg px-3 py-2 text-xs">
                        <Zap className="w-3.5 h-3.5" />
                        Free trial active{periodEnd && ` — ends ${format(periodEnd, "MMM d")}`}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-1 gap-4 sm:min-w-[180px]">
                    {periodEnd && (
                      <div className="sm:text-right">
                        <p className="text-gray-400 text-[10px] uppercase tracking-wider font-semibold">
                          {isScheduledToCancel ? "Access ends" : "Next billing"}
                        </p>
                        <p className="text-gray-900 font-semibold text-sm mt-0.5">
                          {format(periodEnd, "MMM d, yyyy")}
                        </p>
                      </div>
                    )}
                    {periodStart && (
                      <div className="sm:text-right">
                        <p className="text-gray-400 text-[10px] uppercase tracking-wider font-semibold">Period start</p>
                        <p className="text-gray-700 text-sm mt-0.5">{format(periodStart, "MMM d, yyyy")}</p>
                      </div>
                    )}
                    {profile?.subscriptionStartedAt && (
                      <div className="sm:text-right">
                        <p className="text-gray-400 text-[10px] uppercase tracking-wider font-semibold">Member since</p>
                        <p className="text-gray-700 text-sm mt-0.5">
                          {format(new Date(profile.subscriptionStartedAt), "MMM yyyy")}
                        </p>
                      </div>
                    )}
                    <div className="sm:text-right">
                      <p className="text-gray-400 text-[10px] uppercase tracking-wider font-semibold">Annual estimate</p>
                      <p className="text-gray-700 text-sm mt-0.5">${currentPlan.price * 12}/year</p>
                    </div>
                  </div>
                </div>

                {isScheduledToCancel && stripeConfigured && (
                  <div className="mt-5 pt-5 border-t border-primary/10 flex items-center justify-between gap-3">
                    <p className="text-gray-500 text-sm">Changed your mind? Keep your subscription active.</p>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
                      {resumeMutation.isPending
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        : <CheckCircle className="w-3.5 h-3.5 mr-1.5" />}
                      Keep subscription
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Plan comparison ───────────────────────────────────────────────── */}
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-0 pt-5 px-6">
                <CardTitle className="text-gray-900 text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Your Plan
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                {PLANS.map((plan) => {
                  const isCurrent = currentPlan.code === plan.code;
                  const isElitePlan = plan.code === "elite";
                  return (
                    <div
                      key={plan.code}
                      className={cn(
                        "rounded-xl border p-5 relative transition-all",
                        isElitePlan && isCurrent
                          ? "border-amber-400 bg-amber-50 shadow-sm"
                          : isElitePlan
                          ? "border-amber-200 bg-amber-50/50 hover:border-amber-300"
                          : isCurrent
                          ? "border-primary/40 bg-primary/5 shadow-sm"
                          : "border-gray-200 bg-white hover:border-gray-300"
                      )}
                    >
                      {isCurrent && !isElitePlan && (
                        <span className="absolute -top-3 left-4 text-[10px] font-bold bg-primary text-white px-2.5 py-1 rounded-full uppercase tracking-wider">
                          Current
                        </span>
                      )}
                      {isElitePlan && isCurrent && (
                        <span className="absolute -top-3 left-4 text-[10px] font-bold bg-amber-500 text-white px-2.5 py-1 rounded-full uppercase tracking-wider">
                          Current
                        </span>
                      )}
                      {isElitePlan && !isCurrent && (
                        <span className="absolute -top-3 left-4 text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-300 px-2.5 py-1 rounded-full uppercase tracking-wider">
                          Highest Tier
                        </span>
                      )}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <p className={cn("font-bold text-sm", isElitePlan ? "text-amber-800" : "text-gray-900")}>{plan.name}</p>
                          <p className="text-gray-500 text-xs mt-0.5">{plan.tagline}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className={cn("text-2xl font-bold", isElitePlan ? "text-amber-700" : "text-gray-900")}>${plan.price}</span>
                          <span className="text-gray-400 text-xs">/mo</span>
                        </div>
                      </div>
                      <ul className="space-y-1.5 mb-4">
                        {plan.features.map((f) => (
                          <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
                            <span className={isElitePlan ? "text-amber-500" : "text-emerald-500"}>✓</span> {f}
                          </li>
                        ))}
                        {plan.notIncluded?.map((f) => (
                          <li key={f} className="flex items-center gap-2 text-xs text-gray-300 line-through">
                            <span className="text-gray-300">✕</span> {f}
                          </li>
                        ))}
                      </ul>
                      {plan.apiDocs && (
                        <Link
                          to="/elite-api-docs"
                          className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 transition-colors mb-3"
                        >
                          <Code2 className="w-3.5 h-3.5" />
                          View API Integration Documentation →
                        </Link>
                      )}
                      {isElitePlan && !isCurrent && (
                        <Link
                          to="/elite-details"
                          className="flex items-center justify-center gap-1.5 w-full bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-xs font-medium py-2 px-3 rounded-lg transition-all mt-1"
                        >
                          See Details <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      )}
                      {!isElitePlan && !isCurrent && isActive && stripeConfigured && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full border-gray-300 text-gray-700 hover:bg-gray-50 text-xs"
                          onClick={() => { setSwitchingTo(plan.code); setShowPlanConfirm(true); }}
                        >
                          Switch to {plan.name}
                        </Button>
                      )}
                      {isCurrent && (
                        <div className={cn("flex items-center gap-1.5 text-xs", isElitePlan ? "text-amber-600" : "text-primary")}>
                          <BadgeCheck className="w-3.5 h-3.5" /> Active plan
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* ── Plan switch confirm modal ──────────────────────────────────────── */}
            {showPlanConfirm && switchingTo && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                <div className="bg-white border border-gray-200 rounded-2xl p-6 max-w-sm w-full space-y-5 shadow-xl">
                  <div>
                    <h3 className="text-gray-900 font-bold text-lg">Switch plan?</h3>
                    <p className="text-gray-500 text-sm mt-1">
                      You're switching to the{" "}
                      <strong className="text-gray-900">{PLANS.find(p => p.code === switchingTo)?.name}</strong>{" "}
                      plan at ${PLANS.find(p => p.code === switchingTo)?.price}/month.
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Current plan</span>
                      <span className="text-gray-900">{currentPlan.name} — ${currentPlan.price}/mo</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">New plan</span>
                      <span className="text-gray-900 font-bold">
                        {PLANS.find(p => p.code === switchingTo)?.name} — ${PLANS.find(p => p.code === switchingTo)?.price}/mo
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1"
                      onClick={() => { setShowPlanConfirm(false); setSwitchingTo(null); }}>
                      Cancel
                    </Button>
                    <Button size="sm" className="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold"
                      onClick={() => changePlanMutation.mutate(switchingTo)}
                      disabled={changePlanMutation.isPending}>
                      {changePlanMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                      Confirm switch
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Billing cycle + Payment method ────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="pb-3 pt-5 px-5">
                  <CardTitle className="text-gray-900 text-sm flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-primary" />
                    Billing Cycle
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  {periodStart && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-sm">Cycle starts</span>
                      <span className="text-gray-900 text-sm font-medium">{format(periodStart, "MMMM d, yyyy")}</span>
                    </div>
                  )}
                  {periodEnd && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-sm">Cycle ends</span>
                      <span className="text-gray-900 text-sm font-medium">{format(periodEnd, "MMMM d, yyyy")}</span>
                    </div>
                  )}
                  {periodEnd && !isScheduledToCancel && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-sm">Next payment</span>
                      <span className="text-primary text-sm font-semibold">{format(periodEnd, "MMMM d, yyyy")}</span>
                    </div>
                  )}
                  <Separator className="bg-gray-100" />
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 text-sm">Billing interval</span>
                    <span className="text-gray-900 text-sm font-medium capitalize">{sub?.interval ?? "Monthly"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 text-sm">Plan</span>
                    <span className="text-gray-900 text-sm font-semibold">
                      {currentPlan.name} — <span className="text-primary">${currentPlan.price}/mo</span>
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="pb-3 pt-5 px-5">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-gray-900 text-sm flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-primary" />
                      Payment Method
                    </CardTitle>
                    {stripeConfigured && (
                      <Button size="sm" variant="ghost" className="text-gray-400 hover:text-gray-700 text-xs h-7 px-2"
                        onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
                        {portalMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                        Manage
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  {pm ? (
                    <>
                      <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <div className="w-10 h-7 bg-white border border-gray-200 rounded flex items-center justify-center text-sm shadow-sm">
                          💳
                        </div>
                        <div className="flex-1">
                          <p className="text-gray-900 text-sm font-semibold capitalize">
                            {pm.brand} •••• {pm.last4}
                          </p>
                          {pm.expMonth && pm.expYear && (
                            <p className="text-gray-400 text-xs">Expires {pm.expMonth}/{String(pm.expYear).slice(-2)}</p>
                          )}
                        </div>
                        {(pm as any).isDefault && (
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full border border-gray-200">Default</span>
                        )}
                      </div>
                      {(pm as any).billingEmail && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400 text-xs">Billing email</span>
                          <span className="text-gray-600 text-xs">{(pm as any).billingEmail}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-6 space-y-2">
                      <CreditCard className="w-8 h-8 text-gray-300 mx-auto" />
                      <p className="text-gray-400 text-sm">No payment method on file</p>
                      {stripeConfigured && (
                        <Button size="sm" variant="outline" className="border-gray-200 text-gray-600"
                          onClick={() => portalMutation.mutate()}>
                          Add payment method
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Upcoming invoice ──────────────────────────────────────────────── */}
            {upcomingData && (
              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="pb-3 pt-5 px-5">
                  <CardTitle className="text-gray-900 text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    Upcoming Invoice
                    {upcomingData.nextPaymentAttempt && (
                      <span className="ml-auto text-gray-400 text-xs font-normal">
                        Due {format(new Date(upcomingData.nextPaymentAttempt * 1000), "MMM d, yyyy")}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  <div className="space-y-2">
                    {upcomingData.lines.slice(0, 5).map((line, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-gray-500 flex-1 pr-4 truncate">{line.description}</span>
                        <span className={cn("font-medium", line.amountCents < 0 ? "text-emerald-600" : "text-gray-900")}>
                          {line.amountCents < 0 ? "-" : ""}{fmtExact(Math.abs(line.amountCents))}
                        </span>
                      </div>
                    ))}
                    <Separator className="bg-gray-100 my-2" />
                    <div className="flex items-center justify-between">
                      <span className="text-gray-900 font-semibold text-sm">Total due</span>
                      <span className="text-gray-900 font-bold text-base">{fmtExact(upcomingData.amountDueCents)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Invoice history ───────────────────────────────────────────────── */}
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-gray-900 text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    Invoice History
                  </CardTitle>
                  <span className="text-gray-400 text-xs">{invoicesData?.invoices?.length ?? 0} invoices</span>
                </div>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {!invoicesData?.invoices?.length ? (
                  <div className="text-center py-10 px-5">
                    <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-gray-400 text-sm">No invoices yet</p>
                    <p className="text-gray-300 text-xs mt-1">Invoices will appear here after your first billing cycle</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left text-gray-400 text-xs font-semibold px-5 py-2.5 uppercase tracking-wider">Invoice</th>
                          <th className="text-left text-gray-400 text-xs font-semibold px-3 py-2.5 uppercase tracking-wider">Date</th>
                          <th className="text-right text-gray-400 text-xs font-semibold px-3 py-2.5 uppercase tracking-wider">Amount</th>
                          <th className="text-center text-gray-400 text-xs font-semibold px-3 py-2.5 uppercase tracking-wider">Status</th>
                          <th className="text-right text-gray-400 text-xs font-semibold px-5 py-2.5 uppercase tracking-wider">Receipt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoicesData.invoices.map((inv) => {
                          const isPaid = inv.paid || inv.status === "paid";
                          return (
                            <tr key={inv.stripeInvoiceId} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                              <td className="px-5 py-3.5">
                                <span className="text-gray-600 font-mono text-xs">
                                  {inv.invoiceNumber ?? inv.stripeInvoiceId.slice(-8).toUpperCase()}
                                </span>
                              </td>
                              <td className="px-3 py-3.5 text-gray-500">
                                {format(new Date(inv.createdAt), "MMM d, yyyy")}
                              </td>
                              <td className="px-3 py-3.5 text-right text-gray-900 font-semibold">
                                {fmtExact(inv.totalCents)}
                              </td>
                              <td className="px-3 py-3.5 text-center">
                                {isPaid ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-700 text-xs bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                    <BadgeCheck className="w-3 h-3" /> Paid
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-red-700 text-xs bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                                    <AlertTriangle className="w-3 h-3" /> {inv.status ?? "Unpaid"}
                                  </span>
                                )}
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {inv.hostedInvoiceUrl && (
                                    <a href={inv.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer"
                                      className="text-gray-400 hover:text-gray-700 transition-colors">
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                  {inv.invoicePdfUrl && (
                                    <a href={inv.invoicePdfUrl} target="_blank" rel="noopener noreferrer"
                                      className="text-gray-400 hover:text-primary transition-colors">
                                      <Download className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Subscription actions ──────────────────────────────────────────── */}
            {stripeConfigured && isActive && !isScheduledToCancel && (
              <Card className="border-gray-200 shadow-sm">
                <CardHeader className="pb-3 pt-5 px-5">
                  <CardTitle className="text-gray-900 text-sm flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    Subscription Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-2">
                  <button
                    onClick={() => portalMutation.mutate()}
                    disabled={portalMutation.isPending}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <CreditCard className="w-4 h-4 text-gray-400" />
                      <div className="text-left">
                        <p className="text-gray-900 text-sm font-medium">Update payment method</p>
                        <p className="text-gray-400 text-xs">Change your card or billing details</p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </button>

                  <button
                    onClick={() => setCancelStep("reason")}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <XCircle className="w-4 h-4 text-gray-400" />
                      <div className="text-left">
                        <p className="text-gray-900 text-sm font-medium">Cancel subscription</p>
                        <p className="text-gray-400 text-xs">Access continues until end of billing period</p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </button>
                </CardContent>
              </Card>
            )}

            {/* ── Cancellation flow ─────────────────────────────────────────────── */}
            {cancelStep !== "idle" && (
              <Card className="border-red-100 shadow-sm">
                <CardHeader className="pb-3 pt-5 px-5">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-gray-900 text-sm">
                      {cancelStep === "reason" && "Why are you leaving?"}
                      {cancelStep === "retention" && "Before you go…"}
                      {cancelStep === "confirm" && "Confirm cancellation"}
                    </CardTitle>
                    <button onClick={() => setCancelStep("idle")} className="text-gray-400 hover:text-gray-700 transition-colors">
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-4">
                  {cancelStep === "reason" && (
                    <>
                      <p className="text-gray-500 text-sm">This helps us improve. Your feedback matters.</p>
                      <div className="space-y-2">
                        {CANCEL_REASONS.map((r) => (
                          <label key={r} className={cn(
                            "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                            cancelReason === r ? "border-primary/40 bg-primary/5" : "border-gray-200 hover:bg-gray-50"
                          )}>
                            <input type="radio" name="cancel-reason" value={r} checked={cancelReason === r}
                              onChange={() => setCancelReason(r)} className="accent-primary" />
                            <span className="text-gray-700 text-sm">{r}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="border-gray-200 text-gray-600"
                          onClick={() => setCancelStep("idle")}>Back</Button>
                        <Button size="sm" className="ml-auto bg-gray-800 hover:bg-gray-700 text-white"
                          disabled={!cancelReason}
                          onClick={() => setCancelStep("retention")}>
                          Continue <ChevronRight className="w-3.5 h-3.5 ml-1" />
                        </Button>
                      </div>
                    </>
                  )}

                  {cancelStep === "retention" && (
                    <>
                      <div className="space-y-3">
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
                          <p className="text-gray-900 font-semibold text-sm">Consider switching to a lower plan</p>
                          <p className="text-gray-500 text-sm">
                            The Solo plan is just $9/month — perfect for independent stylists and booth renters.
                          </p>
                          {currentPlan.code !== "solo" && (
                            <Button size="sm" variant="outline" className="border-gray-200 text-gray-700 mt-1"
                              onClick={() => { setSwitchingTo("solo"); setShowPlanConfirm(true); setCancelStep("idle"); }}>
                              Switch to Solo ($9/mo)
                            </Button>
                          )}
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                          <p className="text-gray-900 font-semibold text-sm mb-1">Need help with something?</p>
                          <p className="text-gray-500 text-sm">Our team can usually resolve most concerns quickly.</p>
                          <a href="mailto:support@certxa.com" className="text-primary text-sm underline mt-1 inline-block">
                            Contact support →
                          </a>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="border-gray-200 text-gray-600"
                          onClick={() => setCancelStep("reason")}>Back</Button>
                        <Button size="sm" className="ml-auto bg-gray-800 hover:bg-gray-700 text-white"
                          onClick={() => setCancelStep("confirm")}>
                          Still cancel <ChevronRight className="w-3.5 h-3.5 ml-1" />
                        </Button>
                      </div>
                    </>
                  )}

                  {cancelStep === "confirm" && (
                    <>
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2.5">
                        <p className="text-red-700 text-sm font-semibold">What happens when you cancel:</p>
                        <ul className="space-y-2">
                          {[
                            periodEnd && `Your subscription ends on ${format(periodEnd, "MMMM d, yyyy")}`,
                            "Staff accounts will lose platform access",
                            "Your data is retained for 30 days — reactivate anytime",
                            "No further charges will be made",
                          ].filter(Boolean).map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-gray-600 text-sm">
                              <span className="text-red-400 mt-0.5 flex-shrink-0">•</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <p className="text-gray-400 text-xs">
                        Reason: <span className="text-gray-600">{cancelReason}</span>
                      </p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="border-gray-200 text-gray-600"
                          onClick={() => setCancelStep("retention")}>Back</Button>
                        <Button size="sm" variant="destructive" className="ml-auto"
                          onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                          {cancelMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <XCircle className="w-3.5 h-3.5 mr-1.5" />}
                          Yes, cancel my subscription
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── SMS credits ───────────────────────────────────────────────────── */}
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-0 pt-5 px-6">
                <CardTitle className="text-gray-900 text-base flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  SMS Credits
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-5">
                {smsLoading ? (
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading SMS status…
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-gray-900 text-sm font-semibold">Monthly Allowance</p>
                            <p className="text-gray-400 text-xs mt-0.5">Included with your plan · resets each cycle</p>
                          </div>
                          <span className="text-xs font-semibold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                            {smsStatus?.planName ?? "Plan"}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-end justify-between mb-1.5">
                            <span className="text-2xl font-bold text-gray-900">
                              {(smsStatus?.smsAllowance ?? 0).toLocaleString()}
                            </span>
                            <span className="text-gray-400 text-xs">
                              of {(smsStatus?.planMonthlyAllowance ?? 0).toLocaleString()} remaining
                            </span>
                          </div>
                          {(smsStatus?.planMonthlyAllowance ?? 0) > 0 && (
                            <div className="w-full h-1.5 rounded-full bg-gray-200 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{
                                  width: `${Math.min(100, ((smsStatus?.smsAllowance ?? 0) / (smsStatus?.planMonthlyAllowance ?? 1)) * 100)}%`,
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-gray-900 text-sm font-semibold">Purchased Credits</p>
                            <p className="text-gray-400 text-xs mt-0.5">One-time top-ups · never expire</p>
                          </div>
                          <ShoppingCart className="w-4 h-4 text-gray-300" />
                        </div>
                        <div>
                          <span className="text-2xl font-bold text-gray-900">
                            {(smsStatus?.smsCredits ?? 0).toLocaleString()}
                          </span>
                          {(smsStatus?.smsCreditsTotalPurchased ?? 0) > 0 && (
                            <p className="text-gray-400 text-xs mt-1">
                              {(smsStatus?.smsCreditsTotalPurchased ?? 0).toLocaleString()} total purchased
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-lg p-3">
                      <Info className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
                      <p className="text-blue-600 text-xs leading-relaxed">
                        Monthly allowance is used first. When depleted, purchased credits are drawn from automatically.
                        Allowance resets every billing cycle; purchased credits never expire.
                      </p>
                    </div>

                    {stripeConfigured && (
                      <div className="space-y-3">
                        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Top Up Credits</p>
                        <div className="grid grid-cols-3 gap-3">
                          {(smsStatus?.packages ?? [
                            { id: "10", priceCents: 1000, credits: 333, label: "$10 — 333 SMS" },
                            { id: "25", priceCents: 2500, credits: 833, label: "$25 — 833 SMS" },
                            { id: "50", priceCents: 5000, credits: 1666, label: "$50 — 1,666 SMS" },
                          ]).map((pkg) => (
                            <button
                              key={pkg.id}
                              onClick={() => smsBucketMutation.mutate(pkg.id)}
                              disabled={smsBucketMutation.isPending}
                              className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 bg-white hover:border-primary/40 hover:bg-primary/5 p-4 transition-all group disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                            >
                              {smsBucketMutation.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                              ) : (
                                <span className="text-lg font-bold text-gray-900 group-hover:text-primary transition-colors">
                                  ${pkg.id}
                                </span>
                              )}
                              <span className="text-gray-500 text-xs font-medium">
                                {pkg.credits.toLocaleString()} SMS
                              </span>
                              <span className="text-gray-300 text-[10px]">
                                ~${(pkg.priceCents / 100 / pkg.credits * 1000).toFixed(1)}¢ / msg
                              </span>
                            </button>
                          ))}
                        </div>
                        <p className="text-gray-400 text-[11px]">
                          Credits are added instantly after checkout.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* ── Support ───────────────────────────────────────────────────────── */}
            <Card className="border-gray-200 shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <LifeBuoy className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-gray-900 text-sm font-semibold">Billing support</p>
                    <p className="text-gray-400 text-xs mt-0.5">Questions about your invoice or subscription? We're here to help.</p>
                  </div>
                  <a
                    href="mailto:support@certxa.com"
                    className="text-primary hover:text-primary/80 text-sm font-medium flex items-center gap-1 transition-colors"
                  >
                    Contact <ChevronRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
