import { Sidebar } from "./Sidebar";
import { ReactNode, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, Menu, SlidersHorizontal } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { FlipBoardBanner } from "@/components/FlipBoardBanner";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { useTrial } from "@/hooks/use-trial";
import { MobileSettingsSheet } from "@/components/MobileSettingsSheet";

export function AppLayout({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const needsOnboarding = isAuthenticated && user && !user.onboardingCompleted;
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { daysRemaining, subscriptionStatus } = useTrial();

  useEffect(() => {
    if (needsOnboarding) {
      navigate("/onboarding");
    }
  }, [needsOnboarding, navigate]);

  if (isLoading || needsOnboarding) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <FlipBoardBanner />
      <TrialCountdownBanner daysRemaining={daysRemaining} subscriptionStatus={subscriptionStatus} />

      <div className="flex flex-1 overflow-hidden">
        <div className="hidden md:block">
          <Sidebar />
        </div>
        <main className="flex-1 overflow-y-auto">
          {/* Mobile header */}
          <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-30">
            {/* Left: hamburger → full sidebar sheet */}
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-64">
                <Sidebar onLinkClick={() => setIsSheetOpen(false)} />
              </SheetContent>
            </Sheet>

            {/* Center: app name */}
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Certxa
            </span>

            {/* Right: settings trigger */}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Open settings"
            >
              <SlidersHorizontal className="h-5 w-5" />
            </Button>
          </header>

          <div className="container mx-auto p-4 md:p-8">
            {children}
            {/* Spacer so content clears the fixed mobile bottom nav */}
            <div
              className="md:hidden"
              style={{ height: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
              aria-hidden="true"
            />
          </div>
        </main>
      </div>

      {/* Mobile settings bottom sheet */}
      <MobileSettingsSheet
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
    </div>
  );
}
