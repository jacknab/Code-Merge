import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { 
  LayoutDashboard, 
  Calendar, 
  Users, 
  Scissors, 
  ShoppingBag, 
  LogOut,
  UserCircle,
  Banknote,
  Settings,
  BarChart3,
  Globe,
  MessageSquare,
  Mail,
  Megaphone,
  Key,
  TrendingUp,
  Clock,
  ClipboardList,
  Star,
  MapPin,
  FileText,
  ListOrdered,
  GraduationCap,
  ChevronDown,
  ChevronRight,
  CircleUser,
  Brain,
  Building2,
  HelpCircle,
  LayoutTemplate,
  ReceiptText,
} from "lucide-react";
import { Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useSelectedStore } from "@/hooks/use-store";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { PERMISSIONS } from "@shared/permissions";
import { useQuery } from "@tanstack/react-query";

type NavItem = {
  to: string;
  href?: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: string;
  anyOf?: string[];
  hideForStaff?: boolean;
  eliteOnly?: boolean;
  hideForSolo?: boolean;
};

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, hideForStaff: true },
      { to: "/analytics", label: "Analytics", icon: TrendingUp, permission: PERMISSIONS.REPORTS_VIEW, hideForStaff: true },
      { to: "/intelligence", label: "Revenue Intelligence", icon: Brain, permission: PERMISSIONS.REPORTS_VIEW, hideForStaff: true },
    ],
  },
  {
    label: "Calendar",
    items: [
      { to: "/calendar", label: "Calendar", icon: Calendar, anyOf: [PERMISSIONS.APPOINTMENTS_VIEW_ALL, PERMISSIONS.APPOINTMENTS_VIEW_OWN] },
      { to: "/calendar-settings", label: "Calendar Settings", icon: Settings, permission: PERMISSIONS.STORE_SETTINGS },
    ],
  },
  {
    label: "Clients",
    items: [
      { to: "/customers", label: "Customers", icon: Users, permission: PERMISSIONS.CUSTOMERS_VIEW },
      { to: "/waitlist", label: "Waitlist", icon: Clock, permission: PERMISSIONS.CUSTOMERS_VIEW },
      { to: "/dashboard/queue", label: "Queue", icon: ListOrdered },
      { to: "/loyalty", label: "Loyalty Program", icon: Star, permission: PERMISSIONS.CUSTOMERS_VIEW },
      { to: "/sms-inbox", label: "SMS Inbox", icon: MessageSquare, permission: PERMISSIONS.CUSTOMERS_VIEW },
      { to: "/campaigns", label: "Campaigns", icon: Megaphone, permission: PERMISSIONS.CUSTOMERS_VIEW },
      { to: "/google-business", label: "Google Reviews", icon: MapPin, permission: PERMISSIONS.INTEGRATIONS_MANAGE },
    ],
  },
  {
    label: "Business",
    items: [
      { to: "/services", label: "Services", icon: Scissors, permission: PERMISSIONS.SERVICES_MANAGE, hideForStaff: true },
      { to: "/staff", label: "Team", icon: UserCircle, permission: PERMISSIONS.STAFF_MANAGE, hideForStaff: true, hideForSolo: true },
      { to: "/dashboard/training", label: "Staff Training", icon: GraduationCap, permission: PERMISSIONS.STAFF_MANAGE, hideForSolo: true },
      { to: "/products", label: "Products", icon: ShoppingBag, permission: PERMISSIONS.PRODUCTS_MANAGE },
      { to: "/intake-forms", label: "Intake Forms", icon: ClipboardList, permission: PERMISSIONS.SERVICES_MANAGE },
    ],
  },
  {
    label: "Finance",
    items: [
      { to: "/reports", label: "Reports", icon: FileText, permission: PERMISSIONS.REPORTS_VIEW, hideForStaff: true },
      { to: "/register-reports", label: "Register Reports", icon: ReceiptText, permission: PERMISSIONS.CASH_DRAWER_VIEW, hideForStaff: true },
      { to: "/cash-drawer", label: "Cash Drawer", icon: Banknote, permission: PERMISSIONS.CASH_DRAWER_VIEW },
      {
        to: "/commission-report",
        label: "Commissions",
        icon: BarChart3,
        anyOf: [PERMISSIONS.COMMISSIONS_VIEW_ALL, PERMISSIONS.COMMISSIONS_VIEW_OWN],
      },
    ],
  },
  {
    label: "Website Builder",
    items: [
      { to: "/website-builder", href: "/website-builder/", label: "Website Builder", icon: Globe, hideForStaff: true },
      { to: "/website-builder/websites", href: "/website-builder/websites", label: "My Websites", icon: LayoutTemplate, hideForStaff: true },
    ],
  },
  {
    label: "Help",
    items: [
      { to: "/help", label: "Help Center", icon: HelpCircle },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/account", label: "My Account", icon: CircleUser, permission: PERMISSIONS.STORE_SETTINGS, hideForStaff: true },
      { to: "/online-booking", label: "Online Booking", icon: Globe, permission: PERMISSIONS.STORE_SETTINGS },
      { to: "/sms-settings", label: "SMS Notifications", icon: MessageSquare, permission: PERMISSIONS.STORE_SETTINGS },
      { to: "/mail-settings", label: "Email Notifications", icon: Mail, permission: PERMISSIONS.STORE_SETTINGS },
      { to: "/business-settings", label: "Business Settings", icon: Building2, permission: PERMISSIONS.STORE_SETTINGS, hideForStaff: true },
      { to: "/team-permissions", label: "Roles & Permissions", icon: Shield, permission: PERMISSIONS.STAFF_MANAGE, hideForSolo: true },
      { to: "/api-keys", label: "API Keys", icon: Key, permission: PERMISSIONS.STORE_SETTINGS, hideForStaff: true, eliteOnly: true },
      { to: "/multi-location", label: "Multi-Location", icon: Building2, permission: PERMISSIONS.STORE_SETTINGS, hideForStaff: true, eliteOnly: true },
    ],
  },
];

const STORAGE_KEY = "sidebar_expanded_groups";

export function Sidebar({ onLinkClick }: { onLinkClick?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logoutAsync, user } = useAuth();
  const { selectedStore } = useSelectedStore();
  const { can, canAny, isStaff } = usePermissions();
  const posEnabled = (selectedStore as any)?.posEnabled !== false;

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
  const isElite = subscription?.planCode === "elite";
  const isSolo = (selectedStore as any)?.teamSize === "myself" || !!subscription?.planCode?.toLowerCase().includes("solo");

  const { data: smsConversations } = useQuery<any[]>({
    queryKey: ["/api/sms-inbox/conversations", selectedStore?.id],
    queryFn: async () => {
      if (!selectedStore?.id) return [];
      const res = await fetch(`/api/sms-inbox/conversations?storeId=${selectedStore.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedStore?.id,
    refetchInterval: 30000,
  });
  const smsUnreadCount = smsConversations?.reduce((sum: number, c: any) => sum + (c.unreadCount || 0), 0) || 0;

  // Find which group label contains the current route so we can auto-expand it
  const activeGroupLabel = navGroups.find((g) =>
    g.items.some((item) => location.pathname === item.to || location.pathname.startsWith(item.to + "/"))
  )?.label ?? null;

  // Expanded state: persisted in localStorage, starts with only active group open
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: string[] = JSON.parse(stored);
        // Always include the active group even if it wasn't stored
        const set = new Set(parsed);
        if (activeGroupLabel) set.add(activeGroupLabel);
        return set;
      }
    } catch {}
    // Default: only the active group is expanded
    return new Set(activeGroupLabel ? [activeGroupLabel] : []);
  });

  // When route changes, expand only the active group (accordion — close everything else)
  useEffect(() => {
    if (activeGroupLabel) {
      setExpandedGroups((prev) => {
        if (prev.size === 1 && prev.has(activeGroupLabel)) return prev;
        return new Set([activeGroupLabel]);
      });
    }
  }, [activeGroupLabel]);

  // Persist expanded state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...expandedGroups]));
    } catch {}
  }, [expandedGroups]);

  // Accordion: opening a group closes all others
  function toggleGroup(label: string) {
    setExpandedGroups((prev) => {
      if (prev.has(label)) {
        // Clicking the already-open group collapses it
        return new Set<string>();
      }
      // Open only this group
      return new Set([label]);
    });
  }

  const handleLogout = async () => {
    try {
      await logoutAsync();
    } catch {}
    navigate("/auth");
  };

  return (
    <aside className="w-64 border-r border-border/60 bg-background/95 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link to="/" className="flex items-center" onClick={onLinkClick}>
            <span
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontWeight: 700,
                fontSize: "1.55rem",
                letterSpacing: "-0.02em",
                color: "#3B0764",
                lineHeight: 1,
              }}
            >
              Certxa<span style={{ color: "#F59E0B" }}>.</span>
            </span>
          </Link>
        </div>
        
        <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [-ms-overflow-style:none]">
          <nav className="px-2 text-sm font-medium lg:px-4 pb-4">
            {navGroups.map((group) => {
              const posHiddenRoutes = ["/analytics", "/reports", "/cash-drawer", "/commission-report"];
              const items = (posEnabled
                ? group.items
                : group.items.filter((item) => !posHiddenRoutes.includes(item.to))
              ).filter((item) => {
                if (isStaff && item.hideForStaff) return false;
                if (isSolo && item.hideForSolo) return false;
                if (item.permission && !can(item.permission)) return false;
                if (item.anyOf && !canAny(...item.anyOf)) return false;
                if (item.eliteOnly && !isElite) return false;
                return true;
              });
              if (items.length === 0) return null;

              const isExpanded = expandedGroups.has(group.label);
              const hasActiveChild = items.some(
                (item) => location.pathname === item.to || location.pathname.startsWith(item.to + "/")
              );

              return (
                <div key={group.label} className="mb-1">
                  {/* Group header — clickable to toggle */}
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition-colors duration-150",
                      "hover:bg-muted/50 group",
                      hasActiveChild && !isExpanded && "text-primary"
                    )}
                  >
                    <span className={cn(
                      "text-xs font-semibold uppercase tracking-wider transition-colors duration-150",
                      hasActiveChild && !isExpanded
                        ? "text-primary"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}>
                      {group.label}
                    </span>
                    <span className={cn(
                      "transition-colors duration-150",
                      hasActiveChild && !isExpanded ? "text-primary" : "text-muted-foreground/50 group-hover:text-muted-foreground"
                    )}>
                      {isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5" />
                        : <ChevronRight className="h-3.5 w-3.5" />
                      }
                    </span>
                  </button>

                  {/* Collapsible items */}
                  <div
                    className={cn(
                      "overflow-hidden transition-all duration-200 ease-in-out",
                      isExpanded ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
                    )}
                  >
                    <div className="pt-0.5 pb-1">
                      {items.map((item) => {
                        const isActive = location.pathname === item.to;
                        const linkClass = cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200 hover:text-primary",
                          isActive
                            ? "border border-primary/10 bg-card text-primary shadow-[0_3px_12px_rgba(15,23,42,0.08)] ring-1 ring-primary/5"
                            : "border border-transparent text-muted-foreground hover:border-border/70 hover:bg-card hover:shadow-[0_2px_10px_rgba(15,23,42,0.04)]"
                        );
                        const inner = (
                          <>
                            <item.icon className="h-4 w-4 flex-shrink-0" />
                            <span className="flex-1">{item.label}</span>
                            {item.to === "/sms-inbox" && smsUnreadCount > 0 && (
                              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-1">
                                {smsUnreadCount > 9 ? "9+" : smsUnreadCount}
                              </span>
                            )}
                          </>
                        );
                        return item.href ? (
                          <a
                            key={item.to}
                            href={item.href}
                            onClick={onLinkClick}
                            className={linkClass}
                          >
                            {inner}
                          </a>
                        ) : (
                          <Link
                            key={item.to}
                            to={item.to}
                            onClick={onLinkClick}
                            className={linkClass}
                          >
                            {inner}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
        </div>
        
        <div className="mt-auto p-4 border-t">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
              {user?.firstName?.[0] || "U"}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full justify-start gap-2"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>
    </aside>
  );
}
