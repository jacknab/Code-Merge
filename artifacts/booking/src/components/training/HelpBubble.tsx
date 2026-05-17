import { useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, Loader2 } from "lucide-react";
import { useTraining } from "@/contexts/TrainingContext";

/**
 * Phase 4 — Floating help bubble.
 *
 * Persistent ? button shown to enrolled (non-graduated) users on any page that
 * has registered an active training category. Clicking it:
 *   - Optimistically snaps the visible help level for that category back to L3
 *   - Records a `help-requested` event so the reducer locks in L3 server-side
 *   - Shows a brief "got it" toast so the staff member knows help is coming
 */
export function HelpBubble() {
  const { enabled, graduated, activeCategory, requestHelp, isCategoryGraduated, settings } = useTraining();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (!enabled || !activeCategory) return null;
  // After graduation, only show the bubble if the owner has opted in.
  const showAfterGraduation = settings?.showHelpBubbleAfterGraduation ?? true;
  if (graduated && !showAfterGraduation) return null;
  if (isCategoryGraduated(activeCategory) && !showAfterGraduation) return null;

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await requestHelp(activeCategory);
      setConfirm(true);
      window.setTimeout(() => setConfirm(false), 2200);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed bottom-5 right-5 z-[1100] flex flex-col items-end gap-2 pointer-events-none">
      {confirm && (
        <div
          className="pointer-events-auto rounded-lg bg-popover text-popover-foreground border shadow-lg px-3 py-2 text-xs font-medium animate-in fade-in slide-in-from-bottom-2"
          data-testid="help-bubble-confirm"
        >
          Help is back on — follow the highlights.
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-label="Show me how"
        title="Show me how"
        data-testid="help-bubble"
        className="pointer-events-auto h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-xl hover:scale-105 active:scale-95 transition-transform flex items-center justify-center disabled:opacity-70"
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <HelpCircle className="w-6 h-6" />}
      </button>
    </div>,
    document.body,
  );
}
