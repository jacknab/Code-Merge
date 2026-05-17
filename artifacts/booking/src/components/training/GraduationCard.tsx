import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GraduationCap, X } from "lucide-react";
import { useTraining } from "@/contexts/TrainingContext";
import { apiRequest } from "@/lib/queryClient";

/**
 * Phase 8.2 — one-time "You've graduated 🎓" celebration card.
 *
 * Shown to the staff member on their next page load after the graduation
 * scheduler (or per-event check) sets profile.graduatedAt. Dismissing posts
 * to /api/training/acknowledge-graduation so it never fires again.
 */
export function GraduationCard() {
  const { profile, enabled } = useTraining();
  const queryClient = useQueryClient();
  const [dismissing, setDismissing] = useState(false);
  const [hidden, setHidden] = useState(false);

  const shouldShow =
    enabled &&
    !hidden &&
    !!profile?.graduatedAt &&
    !profile?.graduationStaffNotified;

  useEffect(() => {
    if (shouldShow) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [shouldShow]);

  if (!shouldShow) return null;

  const dismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    setHidden(true);
    try {
      await apiRequest("POST", "/api/training/acknowledge-graduation", {});
      queryClient.invalidateQueries({ queryKey: ["/api/training/state"] });
    } catch {
      // Non-critical — if it fails the card will reappear next session, that's fine.
      setHidden(false);
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      data-testid="training-graduation-card"
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl p-6 sm:p-8 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-3 top-3 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          data-testid="button-dismiss-graduation"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <GraduationCap className="w-9 h-9 text-primary" />
        </div>

        <h2 className="text-2xl font-bold text-foreground mb-2">
          You've graduated! 🎓
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          You've finished the in-app training for every action. The coach will
          stay quiet from here on, but the floating <strong>?</strong> button is
          always there if you'd like a refresher.
        </p>

        <button
          type="button"
          onClick={dismiss}
          disabled={dismissing}
          className="w-full px-4 py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60"
          data-testid="button-graduation-continue"
        >
          {dismissing ? "Saving…" : "Got it, thanks"}
        </button>
      </div>
    </div>
  );
}
