import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoreProvider } from "@/components/StoreProvider";
import { useSelectedStore } from "@/hooks/use-store";
import { useTheme } from "@/hooks/use-theme";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TrainingProvider } from "@/contexts/TrainingContext";
import { PracticeModeProvider } from "@/contexts/PracticeModeContext";
import { HelpBubble } from "@/components/training/HelpBubble";
import { GraduationNotifier } from "@/components/training/GraduationNotifier";
import { PracticeOverlay } from "@/components/training/PracticeOverlay";
import { GraduationCard } from "@/components/training/GraduationCard";
import Dashboard from "@/pages/Dashboard";
import Services from "@/pages/Services";
import Staff from "@/pages/Staff";
import Customers from "@/pages/Customers";
import Calendar from "@/pages/Calendar";
import Products from "@/pages/Products";
import NewBooking from "@/pages/NewBooking";
import ClientLookup from "@/pages/ClientLookup";
import POSInterface from "@/pages/POSInterface";
import ClientProfile from "@/pages/ClientProfile";
import ClientDetail from "@/pages/ClientDetail";
import StaffDetail from "@/pages/StaffDetail";
import CalendarSettingsPage from "@/pages/CalendarSettings";
import BusinessSettings from "@/pages/BusinessSettings";
import CashDrawer from "@/pages/CashDrawer";
import AddonsPage from "@/pages/Addons";
import CommissionReport from "@/pages/CommissionReport";
import Analytics from "@/pages/Analytics";
import Reports from "@/pages/Reports";
import RegisterReports from "@/pages/RegisterReports";
import Waitlist from "@/pages/Waitlist";
import QueueDashboard from "@/pages/queue/QueueDashboard";
import QueueSettings from "@/pages/queue/QueueSettings";
import PublicCheckIn from "@/pages/queue/PublicCheckIn";
import QueueDisplay from "@/pages/queue/QueueDisplay";
import GiftCards from "@/pages/GiftCards";
import IntakeForms from "@/pages/IntakeForms";
import Loyalty from "@/pages/Loyalty";
import Reviews from "@/pages/Reviews";
import GoogleBusiness from "@/pages/GoogleBusiness";
import ReviewSubmit from "@/pages/ReviewSubmit";
import OnlineBooking from "@/pages/OnlineBooking";
import SmsSettings from "@/pages/SmsSettings";
import MailSettings from "@/pages/MailSettings";
import SmsInbox from "@/pages/SmsInbox";
import SmsActivity from "@/pages/SmsActivity";
import Campaigns from "@/pages/Campaigns";
import ApiKeys from "@/pages/ApiKeys";
import EliteApiDocs from "@/pages/EliteApiDocs";
import EliteDetails from "@/pages/EliteDetails";
import MultiLocationDashboard from "@/pages/MultiLocationDashboard";
import { AdminDashboard } from "@/pages/Admin/AdminDashboard";
import SeoRegionsAdmin from "@/pages/admin/SeoRegionsAdmin";
import AccountsAdmin from "@/pages/admin/AccountsAdmin";
import RateLimitsPage from "@/pages/admin/RateLimitsPage";
import DbHealthPage from "@/pages/admin/DbHealthPage";
import Auth from "@/pages/Auth";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import StaffAuth from "@/pages/StaffAuth";
import StaffPasswordChange from "@/pages/StaffPasswordChange";
import StaffDashboard from "@/pages/StaffDashboard";
import Onboarding from "@/pages/Onboarding";
import PublicBooking from "@/pages/PublicBooking";
import BookingWidgetPage from "@/pages/BookingWidgetPage";
import BookingConfirmation from "@/pages/public-booking/BookingConfirmation";
import StaffCalendar from "@/pages/StaffCalendar";
import NotFound from "@/pages/not-found";
import ProDashboardLayout from "@/pages/pro-dashboard/ProDashboardLayout";
import DispatchDashboard from "@/pages/pro-dashboard/DispatchDashboard";
import JobsBoard from "@/pages/pro-dashboard/JobsBoard";
import JobDetail from "@/pages/pro-dashboard/JobDetail";
import NewJob from "@/pages/pro-dashboard/NewJob";
import EstimatesPage from "@/pages/pro-dashboard/EstimatesPage";
import CustomersPage from "@/pages/pro-dashboard/CustomersPage";
import CrewsPage from "@/pages/pro-dashboard/CrewsPage";
import InvoicesPage from "@/pages/pro-dashboard/InvoicesPage";
import ReportsPage from "@/pages/pro-dashboard/ReportsPage";
import SettingsPage from "@/pages/pro-dashboard/SettingsPage";
import GoogleReviewsPage from "@/pages/pro-dashboard/GoogleReviewsPage";
import SchedulePage from "@/pages/pro-dashboard/SchedulePage";
import MapPage from "@/pages/pro-dashboard/MapPage";
import ProFeaturesSetup from "@/pages/ProFeaturesSetup";
import TeamPermissions from "@/pages/TeamPermissions";
import SpaLandingPage from "@/pages/SpaLandingPage";
import TattooStudioLandingPage from "@/pages/TattooStudioLandingPage";
import AcceptInvite from "@/pages/AcceptInvite";
import TrainingAdmin from "@/pages/TrainingAdmin";
import TrainingSettings from "@/pages/TrainingSettings";
import ManageDashboard from "@/pages/manage/ManageDashboard";
import BillingPage from "@/pages/manage/BillingPage";
import DashboardBilling from "@/pages/DashboardBilling";
import AccountOverview from "@/pages/AccountOverview";
import Intelligence from "@/pages/Intelligence";
import HelpCenter from "@/pages/HelpCenter";
import DemoLaunchEngines from "@/pages/DemoLaunchEngines";
import DemoLanding from "@/pages/DemoLanding";
import { RequirePermission } from "@/components/RequirePermission";
import { PERMISSIONS } from "@shared/permissions";
import { AccountStatusGate } from "@/components/AccountStatusGate";

const authenticatedPaths = [
  "/onboarding",
  "/dashboard",
  "/analytics",
  "/services",
  "/staff",
  "/customers",
  "/waitlist",
  "/loyalty",
  "/reviews",
  "/google-business",
  "/calendar",
  "/appointments",
  "/booking",
  "/client-lookup",
  "/pos",
  "/client",
  "/products",
  "/addons",
  "/gift-cards",
  "/intake-forms",
  "/reports",
  "/commission-report",
  "/calendar-settings",
  "/business-settings",
  "/team-permissions",
  "/dashboard/training",
  "/dashboard/training/settings",
  "/online-booking",
  "/sms-settings",
  "/mail-settings",
  "/campaigns",
  "/sms-inbox",
  "/sms-activity",
  "/admin",
  "/cash-drawer",
  "/pro-dashboard",
  "/pro-setup",
  "/dashboard/queue",
  "/billing",
  "/account",
  "/staff-calendar",
  "/staff-dashboard",
  "/intelligence",
  "/api-keys",
  "/elite-api-docs",
  "/elite-details",
  "/multi-location",
];

function SoloGuard({ children }: { children: React.ReactNode }) {
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
  if (isSolo) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function App() {
  useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <ErrorBoundary>
          <TrainingProvider>
            <PracticeModeProvider>
              <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <AppRoutes />
                <HelpBubble />
                <GraduationNotifier />
                <GraduationCard />
              </BrowserRouter>
              <PracticeOverlay />
            </PracticeModeProvider>
          </TrainingProvider>
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function AppRoutes() {
  const location = useLocation();
  const isPublicConfirmation = location.pathname.startsWith("/booking/") && !location.pathname.startsWith("/booking/new");

  const isAuthenticatedRoute = authenticatedPaths.some(path =>
    location.pathname === path || location.pathname.startsWith(path + "/")
  ) && !isPublicConfirmation;

  const routes = (
    <Routes>
      {/* Root → login */}
      <Route path="/" element={<Navigate to="/auth" replace />} />

      {/* Manage hub */}
      <Route path="/manage" element={<ManageDashboard />} />
      <Route path="/manage/billing" element={<ManageBillingWrapper />} />

      {/* Auth */}
      <Route path="/auth" element={<Auth />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Staff portal */}
      <Route path="/staff-auth" element={<StaffAuth />} />
      <Route path="/staff-change-password" element={<StaffPasswordChange />} />
      <Route path="/staff-dashboard" element={<StaffDashboard />} />
      <Route path="/staff-calendar" element={<StaffCalendar />} />

      {/* Team invite acceptance (public) */}
      <Route path="/accept-invite" element={<AcceptInvite />} />

      {/* Public booking & review */}
      <Route path="/widget" element={<BookingWidgetPage />} />
      <Route path="/book/:slug" element={<PublicBooking />} />
      <Route path="/booking/:confirmationNumber" element={<BookingConfirmation />} />
      <Route path="/review/:appointmentId" element={<ReviewSubmit />} />

      {/* Public queue */}
      <Route path="/q/:slug" element={<PublicCheckIn />} />
      <Route path="/q/:slug/display" element={<QueueDisplay />} />

      {/* Industry landing pages */}
      <Route path="/spa" element={<SpaLandingPage />} />
      <Route path="/tattoo-studio" element={<TattooStudioLandingPage />} />

      {/* Demo landing */}
      <Route path="/demo" element={<DemoLanding />} />

      {/* Admin */}
      <Route path="/isadmin/*" element={<AdminDashboard />} />
      <Route path="/admin/seo-regions" element={<SeoRegionsAdmin />} />
      <Route path="/admin/accounts" element={<AccountsAdmin />} />
      <Route path="/admin/rate-limits" element={<RateLimitsPage />} />
      <Route path="/admin/db-health" element={<DbHealthPage />} />

      {/* Onboarding */}
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/pro-setup" element={<ProFeaturesSetup />} />

      {/* Core booking system */}
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/services" element={<Services />} />
      <Route path="/staff" element={<SoloGuard><Staff /></SoloGuard>} />
      <Route path="/staff/:id" element={<SoloGuard><StaffDetail /></SoloGuard>} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/calendar" element={<Calendar />} />
      <Route path="/appointments" element={<Calendar />} />
      <Route path="/booking/new" element={<NewBooking />} />
      <Route path="/client-lookup" element={<ClientLookup />} />
      <Route path="/pos" element={<POSInterface />} />
      <Route path="/client/:id" element={<ClientProfile />} />
      <Route path="/clients/:id" element={<ClientDetail />} />
      <Route path="/products" element={<Products />} />
      <Route path="/addons" element={<AddonsPage />} />
      <Route path="/analytics" element={<Analytics />} />
      <Route path="/waitlist" element={<Waitlist />} />
      <Route path="/gift-cards" element={<GiftCards />} />
      <Route path="/intake-forms" element={<IntakeForms />} />
      <Route path="/loyalty" element={<Loyalty />} />
      <Route path="/reviews" element={<Reviews />} />
      <Route path="/google-business" element={<GoogleBusiness />} />
      <Route path="/reports" element={<Reports />} />
      <Route path="/register-reports" element={<RegisterReports />} />
      <Route path="/commission-report" element={<CommissionReport />} />
      <Route path="/calendar-settings" element={<CalendarSettingsPage />} />
      <Route path="/business-settings" element={<BusinessSettings />} />
      <Route
        path="/team-permissions"
        element={
          <RequirePermission permission={PERMISSIONS.STAFF_MANAGE}>
            <TeamPermissions />
          </RequirePermission>
        }
      />
      <Route path="/online-booking" element={<OnlineBooking />} />
      <Route path="/sms-settings" element={<SmsSettings />} />
      <Route path="/mail-settings" element={<MailSettings />} />
      <Route path="/sms-inbox" element={<SmsInbox />} />
      <Route path="/sms-activity" element={<SmsActivity />} />
      <Route path="/campaigns" element={<Campaigns />} />
      <Route path="/api-keys" element={<ApiKeys />} />
      <Route path="/elite-api-docs" element={<EliteApiDocs />} />
      <Route path="/elite-details" element={<EliteDetails />} />
      <Route path="/multi-location" element={<MultiLocationDashboard />} />
      <Route path="/cash-drawer" element={<CashDrawer />} />
      <Route path="/billing" element={<DashboardBilling />} />
      <Route path="/account" element={<AccountOverview />} />
      <Route path="/intelligence" element={<Intelligence />} />
      <Route path="/help" element={<HelpCenter />} />
      <Route path="/intelligence/launch" element={<DemoLaunchEngines />} />
      <Route path="/marketing" element={<Navigate to="/campaigns" replace />} />

      {/* Training */}
      <Route path="/dashboard/training" element={<TrainingAdmin />} />
      <Route path="/dashboard/training/settings" element={<TrainingSettings />} />

      {/* Queue */}
      <Route path="/dashboard/queue" element={<QueueDashboard />} />
      <Route path="/dashboard/queue/settings" element={<QueueSettings />} />

      {/* Pro Dashboard */}
      <Route path="/pro-dashboard" element={<ProDashboardLayout><DispatchDashboard /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/schedule" element={<ProDashboardLayout><SchedulePage /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/jobs" element={<ProDashboardLayout><JobsBoard /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/jobs/new" element={<ProDashboardLayout><NewJob /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/jobs/:id" element={<ProDashboardLayout><JobDetail /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/estimates" element={<ProDashboardLayout><EstimatesPage /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/customers" element={<ProDashboardLayout><CustomersPage /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/invoices" element={<ProDashboardLayout><InvoicesPage /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/crews" element={<ProDashboardLayout><CrewsPage /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/map" element={<ProDashboardLayout><MapPage /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/reports" element={<ProDashboardLayout><ReportsPage /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/settings" element={<ProDashboardLayout><SettingsPage /></ProDashboardLayout>} />
      <Route path="/pro-dashboard/google-reviews" element={<ProDashboardLayout><GoogleReviewsPage /></ProDashboardLayout>} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );

  if (isAuthenticatedRoute) {
    return (
      <StoreProvider>
        <AccountStatusGate>
          {routes}
        </AccountStatusGate>
      </StoreProvider>
    );
  }

  return routes;
}

function ManageBillingWrapper() {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/manage/overview"],
    queryFn: () =>
      fetch("/api/manage/overview", { credentials: "include" }).then((r) => {
        if (r.status === 401) throw new Error("unauthorized");
        if (!r.ok) throw new Error("failed");
        return r.json();
      }),
    retry: false,
  });

  useEffect(() => {
    if (error?.message === "unauthorized") {
      navigate("/auth?redirect=/manage/billing", { replace: true });
    }
  }, [error, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    );
  }

  const stores: any[] = data?.salonos?.stores ?? [];
  const salonId = stores[0]?.id ?? null;

  if (!salonId) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-6 text-center">
        <header className="fixed top-0 inset-x-0 border-b border-white/8 bg-zinc-950/80 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-6 h-14 flex items-center">
            <a href="/" className="font-semibold text-lg tracking-tight text-white">
              Certxa<span className="text-violet-400">.</span>
            </a>
          </div>
        </header>
        <div className="max-w-sm w-full space-y-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h.008v.008H13.5v-.008zm0-4.5h.008v.008H13.5v-.008zm-7.5 9h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0021 4.5H6a2.25 2.25 0 00-2.25 2.25v12.375A2.25 2.25 0 006 21.375z" />
            </svg>
          </div>
          <div>
            <h1 className="text-white text-xl font-bold mb-2">No salon set up yet</h1>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Your billing dashboard will be available once you've finished setting up your salon.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => navigate("/onboarding")}
              className="w-full bg-violet-600 hover:bg-violet-500 text-white font-medium text-sm py-3 px-4 rounded-xl transition-colors"
            >
              Complete setup
            </button>
            <button
              onClick={() => navigate("/manage")}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-sm py-3 px-4 rounded-xl transition-colors"
            >
              Back to account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <BillingPage salonId={salonId} />;
}

export default App;
