import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Calendar, Globe, CreditCard, LayoutDashboard,
  Settings, ExternalLink, AlertTriangle, Zap, RefreshCw,
  Building2, MapPin, Phone,
  ChevronRight, Sparkles, Users, Scissors, ShoppingBag,
  Star, BarChart3,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useSelectedStore } from "@/hooks/use-store";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SUB_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  active:    { label: "Active",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",  dot: "bg-emerald-500" },
  trialing:  { label: "Trial",     cls: "bg-violet-50 text-violet-700 border-violet-200",     dot: "bg-violet-500" },
  trial:     { label: "Trial",     cls: "bg-violet-50 text-violet-700 border-violet-200",     dot: "bg-violet-500" },
  past_due:  { label: "Past Due",  cls: "bg-red-50 text-red-700 border-red-200",             dot: "bg-red-500" },
  canceled:  { label: "Canceled",  cls: "bg-gray-100 text-gray-500 border-gray-200",         dot: "bg-gray-400" },
  cancelled: { label: "Canceled",  cls: "bg-gray-100 text-gray-500 border-gray-200",         dot: "bg-gray-400" },
  unpaid:    { label: "Unpaid",    cls: "bg-orange-50 text-orange-700 border-orange-200",    dot: "bg-orange-500" },
  none:      { label: "No Plan",   cls: "bg-gray-100 text-gray-500 border-gray-200",         dot: "bg-gray-400" },
};

function getSubStatus(s: string | null | undefined) {
  return SUB_STATUS[s ?? "none"] ?? SUB_STATUS["none"];
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AccountOverview() {
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();
  const { selectedStore } = useSelectedStore();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery<ManageOverview>({
    queryKey: ["/api/manage/overview"],
    queryFn: async () => {
      const res = await fetch("/api/manage/overview", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load overview");
      return res.json();
    },
    staleTime: 30_000,
    retry: false,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const user = data?.user;
  const displayName = user
    ? ([user.firstName, user.lastName].filter(Boolean).join(" ") || user.email)
    : (authUser ? `${authUser.firstName ?? ""} ${authUser.lastName ?? ""}`.trim() || authUser.email : "");
  const initials = user
    ? ([user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join("").toUpperCase() || user.email[0].toUpperCase())
    : (authUser ? (authUser.firstName?.[0] ?? authUser.email?.[0] ?? "U").toUpperCase() : "U");

  const subCfg = getSubStatus(user?.subscriptionStatus);
  const trialDays = daysUntil(user?.trialEndsAt);
  const isTrialing = user?.subscriptionStatus === "trialing" || user?.subscriptionStatus === "trial";
  const isPastDue = user?.subscriptionStatus === "past_due";

  const stores = data?.salonos?.stores ?? [];

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6 pb-20">

        {/* ── Page header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isLoading ? "My Account" : `Welcome back${user?.firstName ? `, ${user.firstName}` : ""}`}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">All your Certxa apps and settings in one place.</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          </button>
        </div>

        {/* ── Loading state ────────────────────────────────────────────────────── */}
        {isLoading && (
          <div className="flex items-center justify-center min-h-[200px]">
            <div className="text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-gray-400 text-sm">Loading your account…</p>
            </div>
          </div>
        )}

        {!isLoading && (
          <>
            {/* ── Alert banners ─────────────────────────────────────────────────── */}
            {isPastDue && (
              <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-red-700 text-sm font-semibold">Payment past due</p>
                  <p className="text-red-500 text-xs mt-0.5">Update your payment method to keep your account active.</p>
                </div>
                <Link to="/billing" className="flex-shrink-0 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition-colors">
                  Fix now
                </Link>
              </div>
            )}
            {isTrialing && trialDays !== null && trialDays <= 14 && (
              <div className="flex items-center gap-3 bg-violet-50 border border-violet-200 rounded-xl p-4">
                <Zap className="w-5 h-5 text-violet-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-violet-700 text-sm font-semibold">
                    {trialDays <= 0 ? "Trial expired" : `${trialDays} day${trialDays === 1 ? "" : "s"} left in your trial`}
                  </p>
                  <p className="text-violet-500 text-xs mt-0.5">Add a payment method to keep access after your trial ends.</p>
                </div>
                <Link to="/billing" className="flex-shrink-0 text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg transition-colors">
                  Subscribe
                </Link>
              </div>
            )}

            {/* ── Profile card ──────────────────────────────────────────────────── */}
            <Card className="border-gray-200 shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary flex-shrink-0">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-bold text-gray-900 truncate">{displayName}</p>
                    <p className="text-sm text-gray-400 truncate">{user?.email ?? authUser?.email}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border",
                      subCfg.cls
                    )}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", subCfg.dot)} />
                      {subCfg.label}
                    </span>
                    {isTrialing && user?.trialEndsAt && (
                      <p className="text-xs text-gray-400">
                        Trial ends {formatDate(user.trialEndsAt)}
                        {trialDays !== null && trialDays > 0 && ` · ${trialDays}d left`}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── SalonOS locations ─────────────────────────────────────────────── */}
            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="pb-3 pt-5 px-5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-gray-900 text-sm flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary" />
                    SalonOS — Locations
                  </CardTitle>
                  <span className="text-xs text-gray-400">{stores.length} location{stores.length !== 1 ? "s" : ""}</span>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-3">
                {stores.length === 0 ? (
                  <div className="text-center py-8 space-y-3">
                    <Building2 className="w-8 h-8 text-gray-200 mx-auto" />
                    <p className="text-gray-400 text-sm">No salon set up yet.</p>
                    <Link to="/onboarding">
                      <Button size="sm" variant="outline" className="border-gray-200 text-gray-600">
                        Complete setup
                      </Button>
                    </Link>
                  </div>
                ) : (
                  stores.map((store, i) => (
                    <div key={store.id} className={cn(
                      "flex items-start gap-4 p-4 rounded-xl border",
                      i === 0 ? "border-primary/20 bg-primary/5" : "border-gray-100 bg-gray-50"
                    )}>
                      <div className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 shadow-sm">
                        <Scissors className="w-4 h-4 text-gray-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-gray-900 font-semibold text-sm truncate">{store.name}</p>
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Active
                          </span>
                        </div>
                        {store.address && (
                          <p className="text-gray-400 text-xs mt-0.5 flex items-center gap-1 truncate">
                            <MapPin className="w-3 h-3 flex-shrink-0" />
                            {store.address}
                          </p>
                        )}
                        {store.phone && (
                          <p className="text-gray-400 text-xs mt-0.5 flex items-center gap-1">
                            <Phone className="w-3 h-3 flex-shrink-0" />
                            {store.phone}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        {store.bookingSlug && (
                          <a
                            href={`/book/${store.bookingSlug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                          >
                            Booking page <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        <Link to="/calendar" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                          Calendar →
                        </Link>
                      </div>
                    </div>
                  ))
                )}

                {/* Action grid */}
                {stores.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    {[
                      { label: "Calendar",   to: "/calendar",          icon: Calendar },
                      { label: "Customers",  to: "/customers",         icon: Users },
                      { label: "Services",   to: "/services",          icon: Scissors },
                      { label: "Products",   to: "/products",          icon: ShoppingBag },
                    ].map(({ label, to, icon: Icon }) => (
                      <Link
                        key={to}
                        to={to}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all text-sm text-gray-600 hover:text-gray-900 shadow-sm"
                      >
                        <Icon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        {label}
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Billing summary ───────────────────────────────────────────────── */}
            <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-white to-violet-50">
              <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
              <div className="relative p-6">
                <div className="flex items-center justify-between gap-4 mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 shadow-sm">
                      <CreditCard className="w-5 h-5 text-gray-400" />
                    </div>
                    <div>
                      <p className="font-bold text-gray-900 text-sm">Billing & Subscription</p>
                      <p className="text-gray-400 text-xs mt-0.5">Real-time status of your plan</p>
                    </div>
                  </div>
                  <span className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border flex-shrink-0",
                    subCfg.cls
                  )}>
                    <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", subCfg.dot)} />
                    {subCfg.label}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                  {[
                    { label: "Status",  value: subCfg.label },
                    { label: "Billing", value: isTrialing && user?.trialEndsAt ? `Trial ends ${formatDate(user.trialEndsAt)}` : "Monthly" },
                    { label: "Email",   value: user?.email ?? "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm">
                      <p className="text-gray-400 text-[10px] font-semibold uppercase tracking-wider mb-1">{label}</p>
                      <p className="font-semibold text-sm text-gray-900 truncate">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Link to="/billing" className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 transition-colors text-sm font-semibold text-white">
                    <Sparkles className="w-4 h-4" />
                    Manage Billing
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                  <Link to="/billing" className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-sm text-gray-500 hover:text-gray-800 shadow-sm">
                    View invoices
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>

            {/* ── Quick links ───────────────────────────────────────────────────── */}
            <div>
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-widest mb-3">Quick Access</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { label: "Calendar",         to: "/calendar",           icon: Calendar,       internal: true },
                  { label: "Dashboard",         to: "/dashboard",          icon: LayoutDashboard, internal: true },
                  { label: "Billing",           to: "/billing",            icon: CreditCard,      internal: true },
                  { label: "Business Settings", to: "/business-settings",  icon: Settings,        internal: true },
                  { label: "Analytics",         to: "/analytics",          icon: BarChart3,       internal: true },
                  { label: "Loyalty Program",   to: "/loyalty",            icon: Star,            internal: true },
                  { label: "SMS Inbox",         to: "/sms-inbox",          icon: LayoutDashboard, internal: true },
                  { label: "Online Booking",    to: "/online-booking",     icon: Globe,           internal: true },
                ].map(({ label, to, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-sm text-gray-500 hover:text-gray-900 transition-all shadow-sm"
                  >
                    <Icon className="w-4 h-4 text-gray-300 flex-shrink-0" />
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
