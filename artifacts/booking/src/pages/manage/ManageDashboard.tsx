import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, LogOut, Calendar, Globe, CreditCard, ArrowRight,
  ExternalLink, AlertTriangle, Zap,
  ChevronRight, LayoutDashboard, Settings, Sparkles, RefreshCw,
} from "lucide-react";

interface ManageOverview {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
    subscriptionStatus: string | null;
    trialEndsAt: string | null;
  };
  salonos: {
    stores: Array<{
      id: number;
      name: string;
      bookingSlug: string | null;
      timezone: string | null;
      phone: string | null;
      address: string | null;
    }>;
  };
}

async function fetchOverview(): Promise<ManageOverview> {
  const res = await fetch("/api/manage/overview", { credentials: "include" });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("Failed to load overview");
  return res.json();
}

const SUB_STATUS: Record<string, { label: string; color: string; dot: string; bg: string }> = {
  active:    { label: "Active",    color: "text-emerald-400", dot: "bg-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
  trialing:  { label: "Trial",     color: "text-violet-300",  dot: "bg-violet-400",  bg: "bg-violet-500/10 border-violet-500/25" },
  trial:     { label: "Trial",     color: "text-violet-300",  dot: "bg-violet-400",  bg: "bg-violet-500/10 border-violet-500/25" },
  past_due:  { label: "Past Due",  color: "text-red-400",     dot: "bg-red-400",     bg: "bg-red-500/10 border-red-500/25" },
  canceled:  { label: "Canceled",  color: "text-zinc-400",    dot: "bg-zinc-500",    bg: "bg-zinc-700/20 border-zinc-600/25" },
  cancelled: { label: "Canceled",  color: "text-zinc-400",    dot: "bg-zinc-500",    bg: "bg-zinc-700/20 border-zinc-600/25" },
  unpaid:    { label: "Unpaid",    color: "text-orange-400",  dot: "bg-orange-400",  bg: "bg-orange-500/10 border-orange-500/25" },
  none:      { label: "No Plan",   color: "text-zinc-500",    dot: "bg-zinc-600",    bg: "bg-zinc-700/20 border-zinc-600/25" },
};

function getSubStatus(status: string | null | undefined) {
  return SUB_STATUS[status ?? "none"] ?? SUB_STATUS["none"];
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ManageDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<ManageOverview>({
    queryKey: ["/api/manage/overview"],
    queryFn: fetchOverview,
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (error?.message === "unauthorized") {
      navigate("/auth?redirect=/manage", { replace: true });
    }
  }, [error, navigate]);

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/manage/logout", { method: "POST", credentials: "include" });
    },
    onSuccess: () => {
      queryClient.clear();
      navigate("/auth", { replace: true });
    },
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin mx-auto" />
          <p className="text-zinc-500 text-sm">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { user, salonos } = data;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const initials = ([user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join("").toUpperCase()) || user.email[0].toUpperCase();

  const subCfg = getSubStatus(user.subscriptionStatus);
  const trialDays = daysUntil(user.trialEndsAt);
  const isTrialing = user.subscriptionStatus === "trialing" || user.subscriptionStatus === "trial";
  const isPastDue = user.subscriptionStatus === "past_due";

  const primaryStore = salonos.stores[0] ?? null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/[0.06] bg-zinc-950/90 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <a href="/overview.php" className="font-bold text-lg tracking-tight">
            Certxa<span className="text-violet-400">.</span>
          </a>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-sm font-bold select-none">
              {initials}
            </div>
            <span className="text-sm text-zinc-400 hidden sm:block max-w-[160px] truncate">{displayName}</span>
            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white transition-colors pl-1"
            >
              {logoutMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <LogOut className="w-3.5 h-3.5" />
              }
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-10 space-y-8">

        {/* ── Welcome ─────────────────────────────────────────────────────── */}
        <div>
          <p className="text-xs text-zinc-600 font-semibold uppercase tracking-widest mb-1">My Account</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Welcome back{user.firstName ? `, ${user.firstName}` : ""}
          </h1>
          <p className="text-zinc-500 mt-1.5 text-sm">All your Certxa apps and settings in one place.</p>
        </div>

        {/* ── Alerts ──────────────────────────────────────────────────────── */}
        {isPastDue && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/25 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-red-300 text-sm font-semibold">Payment past due</p>
              <p className="text-red-400/70 text-xs mt-0.5">Update your payment method to keep your account active.</p>
            </div>
            <a
              href="/manage/billing"
              className="flex-shrink-0 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              Fix now
            </a>
          </div>
        )}
        {isTrialing && trialDays !== null && trialDays <= 14 && (
          <div className="flex items-center gap-3 bg-violet-500/10 border border-violet-500/25 rounded-xl p-4">
            <Zap className="w-5 h-5 text-violet-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-violet-300 text-sm font-semibold">
                {trialDays <= 0 ? "Trial expired" : `${trialDays} day${trialDays === 1 ? "" : "s"} left in your trial`}
              </p>
              <p className="text-violet-400/70 text-xs mt-0.5">Add a payment method to keep access after your trial ends.</p>
            </div>
            <a
              href="/manage/billing"
              className="flex-shrink-0 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              Subscribe
            </a>
          </div>
        )}

        {/* ── App cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-5">

          {/* ── SalonOS Booking ─────────────────────────────────────────── */}
          <AppCard
            gradient="from-violet-950/60 to-zinc-900/80"
            border="border-violet-500/20"
            glowColor="bg-violet-500/10"
            icon={<Calendar className="w-5 h-5 text-violet-400" />}
            iconBg="bg-violet-500/15"
            label="SalonOS"
            tagline="Booking, POS & salon management"
            accentColor="bg-violet-600 hover:bg-violet-500"
          >
            {!primaryStore ? (
              <EmptyState
                message="No salon set up yet."
                cta="Complete setup"
                href="/onboarding"
                accentClass="text-violet-400 hover:text-violet-300"
              />
            ) : (
              <div className="space-y-4">
                <div className="bg-white/[0.04] rounded-xl border border-white/[0.06] px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{primaryStore.name}</p>
                    {primaryStore.address && (
                      <p className="text-zinc-500 text-xs mt-0.5 truncate">{primaryStore.address}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Active
                    </span>
                    {primaryStore.bookingSlug && (
                      <a
                        href={`/book/${primaryStore.bookingSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-600 hover:text-zinc-300 transition-colors"
                        title="View booking page"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>

                {salonos.stores.length > 1 && (
                  <p className="text-zinc-600 text-xs px-1">+{salonos.stores.length - 1} more location{salonos.stores.length - 1 !== 1 ? "s" : ""}</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <a
                    href="/calendar"
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 transition-colors text-sm font-semibold"
                  >
                    <Calendar className="w-4 h-4" />
                    Calendar
                  </a>
                  <a
                    href="/dashboard"
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition-colors text-sm font-medium text-zinc-300"
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    Dashboard
                  </a>
                </div>
              </div>
            )}
          </AppCard>

        </div>

        {/* ── Billing & Subscription ──────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-zinc-700/40 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800/50">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-600/5 via-transparent to-fuchsia-600/5 pointer-events-none" />
          <div className="absolute top-0 right-0 w-80 h-80 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />

          <div className="relative p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700/60 flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-5 h-5 text-zinc-400" />
                </div>
                <div>
                  <p className="font-bold text-white">Billing & Subscription</p>
                  <p className="text-zinc-500 text-xs mt-0.5">Real-time status of your plan</p>
                </div>
              </div>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${subCfg.bg} ${subCfg.color} flex-shrink-0`}>
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${subCfg.dot}`} />
                {subCfg.label}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <BillingStatCard
                label="Status"
                value={subCfg.label}
                valueClass={subCfg.color}
              />
              {isTrialing && user.trialEndsAt ? (
                <BillingStatCard
                  label="Trial ends"
                  value={formatDate(user.trialEndsAt)}
                  valueClass={trialDays !== null && trialDays <= 7 ? "text-amber-300" : "text-white"}
                  subtext={trialDays !== null && trialDays > 0 ? `${trialDays} days remaining` : "Expired"}
                />
              ) : (
                <BillingStatCard
                  label="Billing"
                  value="Monthly"
                  valueClass="text-white"
                />
              )}
              <BillingStatCard
                label="Email"
                value={user.email}
                valueClass="text-zinc-300 text-xs font-normal truncate"
              />
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <a
                href="/manage/billing"
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 transition-colors text-sm font-semibold"
              >
                <Sparkles className="w-4 h-4" />
                Manage Billing
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href="/manage/billing"
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors text-sm text-zinc-400 hover:text-white"
              >
                View invoices
                <ChevronRight className="w-4 h-4" />
              </a>
              {user.subscriptionStatus === "active" || isTrialing ? (
                <a
                  href="/manage/billing#cancel"
                  className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-red-500/10 border border-white/[0.08] hover:border-red-500/30 transition-colors text-sm text-zinc-500 hover:text-red-400 sm:ml-auto"
                >
                  Cancel subscription
                </a>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── Quick links ─────────────────────────────────────────────────── */}
        <div>
          <p className="text-xs text-zinc-600 font-semibold uppercase tracking-widest mb-3">Quick Access</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { label: "Calendar",        href: "/calendar",          icon: <Calendar className="w-4 h-4" /> },
              { label: "Dashboard",       href: "/dashboard",         icon: <LayoutDashboard className="w-4 h-4" /> },
              { label: "Billing",         href: "/manage/billing",    icon: <CreditCard className="w-4 h-4" /> },
              { label: "Settings",        href: "/business-settings", icon: <Settings className="w-4 h-4" /> },
            ].map(({ label, href, icon }) => (
              <a
                key={href}
                href={href}
                className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-sm text-zinc-400 hover:text-white transition-all"
              >
                <span className="text-zinc-600">{icon}</span>
                {label}
              </a>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function AppCard({
  gradient, border, glowColor, icon, iconBg, label, tagline, children,
}: {
  gradient: string;
  border: string;
  glowColor: string;
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  tagline: string;
  accentColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${gradient} ${border} p-6 flex flex-col gap-5`}>
      <div className={`absolute top-0 right-0 w-48 h-48 ${glowColor} rounded-full blur-3xl pointer-events-none`} />
      <div className="relative flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          {icon}
        </div>
        <div>
          <p className="font-bold text-white">{label}</p>
          <p className="text-xs text-zinc-500">{tagline}</p>
        </div>
      </div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

function BillingStatCard({
  label, value, valueClass, subtext,
}: {
  label: string;
  value: string;
  valueClass?: string;
  subtext?: string;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
      <p className="text-zinc-600 text-[10px] font-semibold uppercase tracking-wider mb-1">{label}</p>
      <p className={`font-semibold text-sm ${valueClass ?? "text-white"}`}>{value}</p>
      {subtext && <p className="text-zinc-600 text-xs mt-0.5">{subtext}</p>}
    </div>
  );
}

function EmptyState({
  message, cta, href, accentClass,
}: {
  message: string;
  cta: string;
  href: string;
  accentClass: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-sm text-zinc-500">{message}</p>
      <a href={href} className={`text-sm font-semibold underline-offset-4 hover:underline transition-colors ${accentClass}`}>
        {cta} →
      </a>
    </div>
  );
}
