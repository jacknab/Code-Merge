import { CalendarDays, TrendingUp, Users, AlignJustify, X, LayoutDashboard, Calendar, Scissors, ShoppingBag, Banknote, Building2, FileText, Star, MessageSquare, Clock, ListOrdered, MapPin, ClipboardList, BarChart3, GraduationCap, Settings, LogOut } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { useSelectedStore } from "@/hooks/use-store";
import { useQuery } from "@tanstack/react-query";

const TABS = [
  { icon: CalendarDays, to: "/calendar", label: "Calendar" },
  { icon: TrendingUp,   to: "/reports",         label: "Analytics" },
  { icon: Users,        to: "/dashboard/queue", label: "Crew" },
];

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard",  label: "Dashboard",  icon: LayoutDashboard },
      { to: "/analytics",  label: "Analytics",  icon: TrendingUp },
    ],
  },
  {
    label: "Calendar",
    items: [
      { to: "/calendar",          label: "Calendar",          icon: Calendar },
      { to: "/calendar-settings", label: "Calendar Settings", icon: Settings },
    ],
  },
  {
    label: "Clients",
    items: [
      { to: "/customers",      label: "Customers",     icon: Users },
      { to: "/waitlist",       label: "Waitlist",      icon: Clock },
      { to: "/dashboard/queue",label: "Queue",         icon: ListOrdered },
      { to: "/loyalty",        label: "Loyalty",       icon: Star },
      { to: "/sms-inbox",      label: "SMS Inbox",     icon: MessageSquare },
      { to: "/campaigns",      label: "Campaigns",     icon: MessageSquare },
      { to: "/google-business",label: "Google Reviews",icon: MapPin },
    ],
  },
  {
    label: "Business",
    items: [
      { to: "/services",          label: "Services",       icon: Scissors },
      { to: "/staff",             label: "Team",           icon: Users },
      { to: "/dashboard/training",label: "Staff Training", icon: GraduationCap },
      { to: "/products",          label: "Products",       icon: ShoppingBag },
      { to: "/intake-forms",      label: "Intake Forms",   icon: ClipboardList },
    ],
  },
  {
    label: "Finance",
    items: [
      { to: "/reports",           label: "Reports",     icon: FileText },
      { to: "/cash-drawer",       label: "Cash Drawer", icon: Banknote },
      { to: "/commission-report", label: "Commissions", icon: BarChart3 },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/business-settings", label: "Business Settings", icon: Building2 },
    ],
  },
];

export function MobileBottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { logoutAsync } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const { selectedStore } = useSelectedStore();

  const { data: subscription } = useQuery<any>({
    queryKey: ["/api/billing/subscription", selectedStore?.id],
    queryFn: async () => {
      if (!selectedStore?.id) return null;
      const res = await fetch(`/api/billing/subscription/${selectedStore.id}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedStore?.id,
    staleTime: 5 * 60 * 1000,
  });
  const isSolo = (selectedStore as any)?.teamSize === "myself" || !!subscription?.planCode?.toLowerCase().includes("solo");

  return (
    <>
      {/* ── Bottom Tab Bar ── */}
      <div
        className={cn(
          "fixed bottom-0 inset-x-0 z-50 md:hidden flex items-stretch",
          "bg-white border-t border-gray-100",
        )}
        style={{
          height: "calc(60px + env(safe-area-inset-bottom, 0px))",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {TABS.map(({ icon: Icon, label, to }) => {
          const active =
            pathname === to ||
            (to === "/calendar" && pathname.startsWith("/calendar"));
          return (
            <Link
              key={to}
              to={to}
              aria-label={label}
              className="flex-1 flex flex-col items-center justify-center select-none active:opacity-50 transition-opacity"
            >
              <Icon
                className={cn(
                  "transition-colors",
                  active ? "text-teal-500" : "text-slate-400"
                )}
                size={24}
                strokeWidth={active ? 2.2 : 1.8}
              />
            </Link>
          );
        })}

        {/* Menu tab — opens drawer */}
        <button
          aria-label="Menu"
          onClick={() => setMenuOpen(true)}
          className="flex-1 flex flex-col items-center justify-center select-none active:opacity-50 transition-opacity"
        >
          <AlignJustify
            className={cn("transition-colors", menuOpen ? "text-teal-500" : "text-slate-400")}
            size={24}
            strokeWidth={menuOpen ? 2.2 : 1.8}
          />
        </button>
      </div>

      {/* ── Nav Drawer ── */}
      <AnimatePresence>
        {menuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              className="fixed inset-0 z-[60] bg-black/40 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMenuOpen(false)}
            />

            {/* Drawer panel — slides in from left */}
            <motion.div
              key="drawer"
              className="fixed left-0 top-0 bottom-0 z-[61] md:hidden flex flex-col bg-white shadow-2xl"
              style={{ width: 280 }}
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
                <Link to="/dashboard" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 group">
                  <div className="relative">
                    <div
                      className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        background: "radial-gradient(circle, rgba(0,212,170,0.3) 0%, transparent 70%)",
                        filter: "blur(8px)",
                      }}
                    />
                    <img
                      src="/web-app.png"
                      alt="Certxa"
                      className="relative w-7 h-7 rounded-xl shadow-md"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                  <span
                    className="text-slate-800 font-black text-[17px]"
                    style={{ letterSpacing: "-0.025em", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                  >
                    Certxa
                  </span>
                </Link>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full active:bg-gray-100 transition-colors"
                  aria-label="Close menu"
                >
                  <X size={18} className="text-slate-500" />
                </button>
              </div>

              {/* Nav sections — scrollable */}
              <div className="flex-1 overflow-y-auto py-2">
                {NAV_SECTIONS.map((section) => (
                  <div key={section.label} className="mb-1">
                    <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                      {section.label}
                    </p>
                    {section.items.filter(({ to }) => {
                      if (isSolo && to === "/staff") return false;
                      return true;
                    }).map(({ to, label, icon: Icon }) => {
                      const active = pathname === to || pathname.startsWith(to + "/");
                      return (
                        <Link
                          key={to}
                          to={to}
                          onClick={() => setMenuOpen(false)}
                          className={cn(
                            "flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors active:bg-gray-50",
                            active
                              ? "text-teal-600 bg-teal-50/60"
                              : "text-slate-600 hover:text-slate-900 hover:bg-gray-50"
                          )}
                        >
                          <Icon
                            size={18}
                            className={active ? "text-teal-500" : "text-slate-400"}
                            strokeWidth={active ? 2.2 : 1.8}
                          />
                          {label}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Log out */}
              <div className="border-t border-gray-100 pb-[env(safe-area-inset-bottom,0px)]">
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    await logoutAsync();
                    navigate("/auth");
                  }}
                  className="w-full flex items-center gap-3 px-4 py-4 text-sm font-medium text-red-500 active:bg-red-50 transition-colors"
                >
                  <LogOut size={18} className="text-red-400" strokeWidth={1.8} />
                  Log out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
