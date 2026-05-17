import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { useTrainingCategory, useActiveTrainingCategory } from "@/contexts/TrainingContext";
import { variantForHelpLevel, type StepDescriptor, type Variant } from "./types";
import { useTargetRect } from "./useTargetRect";

interface Props {
  category: string;
  steps: StepDescriptor[];
  /** When true, restart the sequence from step 0. */
  active: boolean;
  /** Called once the user reaches the end of the sequence. */
  onComplete?: () => void;
}

const HESITATION_MS = 8000;

export function CoachOverlay({ category, steps, active, onComplete }: Props) {
  const { helpLevel, graduated, record } = useTrainingCategory(category);
  // Register this category as the page's active flow so the floating
  // help bubble knows which slug to bump back to L3.
  useActiveTrainingCategory(category, active && !graduated);
  const [stepIndex, setStepIndex] = useState(0);
  const [whyOpen, setWhyOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const location = useLocation();

  const step: StepDescriptor | undefined = steps[stepIndex];
  const variant: Variant = step ? variantForHelpLevel(helpLevel, step.variant) : "silent";
  const showOverlay = active && !graduated && !dismissed && !!step && variant !== "silent";

  const rect = useTargetRect(showOverlay ? step?.testid ?? null : null, showOverlay);

  // Reset on activation / category change.
  useEffect(() => {
    if (active) {
      setStepIndex(0);
      setDismissed(false);
      setWhyOpen(false);
    }
  }, [active, category]);

  // Hesitation timer: if rect is visible and user idles 8s without advancing.
  useEffect(() => {
    if (!showOverlay || !rect) return;
    const timer = window.setTimeout(() => {
      record("hesitation", { stepId: step?.id });
    }, HESITATION_MS);
    return () => window.clearTimeout(timer);
  }, [showOverlay, rect, step?.id, record]);

  // Click detection — advances or fires wrong-click.
  useEffect(() => {
    if (!showOverlay || !step) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Ignore clicks inside the coach card itself.
      if (target.closest("[data-coach-card]")) return;
      const tidEl = target.closest<HTMLElement>("[data-testid]");
      const clickedId = tidEl?.dataset.testid ?? null;

      const adv = step.advance;
      let matched = false;
      if (adv.kind === "click") {
        const expected = adv.testid ?? step.testid;
        matched = clickedId === expected;
      } else if (adv.kind === "any-click") {
        matched = !!clickedId && clickedId.startsWith(adv.testidPrefix);
      }

      if (matched) {
        advance();
      } else if (clickedId) {
        // Only count interactive misclicks, not random div clicks.
        const interactive = !!target.closest("button, a, [role='button'], input, select, textarea");
        if (interactive) {
          record("wrong-click", { stepId: step.id, clickedTestId: clickedId });
        }
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [showOverlay, step?.id, step?.testid]);

  // Route-based advance.
  const lastPathRef = useRef(location.pathname);
  useEffect(() => {
    if (!showOverlay || !step) return;
    const adv = step.advance;
    if (adv.kind === "route" && location.pathname.startsWith(adv.pathPrefix)) {
      advance();
    }
    lastPathRef.current = location.pathname;
  }, [location.pathname]);

  // Abandonment: route changes away while overlay is active and not on last step.
  useEffect(() => {
    return () => {
      // On unmount only; if we were active and not finished, mark abandoned.
      if (active && stepIndex < steps.length && !graduated) {
        record("abandoned", { stepId: step?.id, stepIndex });
      }
    };
  }, []);

  function advance() {
    setWhyOpen(false);
    setStepIndex((i) => {
      const next = i + 1;
      if (next >= steps.length) {
        record("success", { stepId: step?.id });
        onComplete?.();
        return steps.length; // off the end → unmount
      }
      return next;
    });
  }

  if (!showOverlay) return null;

  return createPortal(
    <>
      {variant === "spotlight" && rect && <Backdrop rect={rect} onSkip={() => setDismissed(true)} />}
      {variant === "spotlight" && rect && <SpotlightRing rect={rect} />}
      {variant === "whisper" && rect && <WhisperDot rect={rect} />}
      {(variant === "spotlight" || variant === "tooltip") && rect && step && (
        <CoachCard
          rect={rect}
          title={step.title}
          body={step.body}
          why={step.why}
          whyOpen={whyOpen}
          onToggleWhy={() => setWhyOpen((v) => !v)}
          onDismiss={() => setDismissed(true)}
          variant={variant}
        />
      )}
    </>,
    document.body,
  );
}

function Backdrop({ rect, onSkip }: { rect: { top: number; left: number; width: number; height: number }; onSkip: () => void }) {
  // Four dim panes around the rect, leaving the target visible.
  const pad = 8;
  const t = Math.max(0, rect.top - pad);
  const l = Math.max(0, rect.left - pad);
  const w = rect.width + pad * 2;
  const h = rect.height + pad * 2;
  return (
    <div
      onClick={onSkip}
      className="fixed inset-0 z-[1000] pointer-events-auto"
      data-testid="training-backdrop"
      style={{
        background: `radial-gradient(circle at center, transparent, transparent), rgba(0,0,0,0)`,
        clipPath: `polygon(
          0 0, 100vw 0, 100vw 100vh, 0 100vh, 0 0,
          ${l}px ${t}px,
          ${l}px ${t + h}px,
          ${l + w}px ${t + h}px,
          ${l + w}px ${t}px,
          ${l}px ${t}px
        )`,
      }}
    >
      <div className="absolute inset-0 bg-black/45" />
    </div>
  );
}

function SpotlightRing({ rect }: { rect: { top: number; left: number; width: number; height: number } }) {
  const pad = 6;
  return (
    <div
      className="fixed z-[1001] pointer-events-none rounded-xl ring-4 ring-primary shadow-[0_0_0_9999px_rgba(0,0,0,0)] animate-pulse"
      style={{
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }}
    />
  );
}

function WhisperDot({ rect }: { rect: { top: number; left: number; width: number; height: number } }) {
  return (
    <div
      className="fixed z-[1001] pointer-events-none"
      style={{ top: rect.top + rect.height / 2 - 8, left: rect.left + rect.width + 6 }}
    >
      <div className="relative">
        <div className="w-4 h-4 rounded-full bg-primary animate-ping absolute inset-0 opacity-75" />
        <div className="w-4 h-4 rounded-full bg-primary relative" />
      </div>
    </div>
  );
}

function CoachCard({
  rect,
  title,
  body,
  why,
  whyOpen,
  onToggleWhy,
  onDismiss,
  variant,
}: {
  rect: { top: number; left: number; width: number; height: number };
  title: string;
  body: string;
  why?: string;
  whyOpen: boolean;
  onToggleWhy: () => void;
  onDismiss: () => void;
  variant: "spotlight" | "tooltip";
}) {
  // Position card below the target if there's room; otherwise above.
  const cardWidth = variant === "tooltip" ? 260 : 320;
  const margin = 12;
  const placeBelow = rect.top + rect.height + 240 < window.innerHeight;
  const top = placeBelow ? rect.top + rect.height + margin : Math.max(margin, rect.top - 200);
  const rawLeft = rect.left + rect.width / 2 - cardWidth / 2;
  const left = Math.max(margin, Math.min(window.innerWidth - cardWidth - margin, rawLeft));

  return (
    <div
      data-coach-card
      data-testid="training-coach-card"
      className="fixed z-[1002] rounded-xl bg-popover text-popover-foreground border shadow-2xl"
      style={{ top, left, width: cardWidth }}
    >
      <div className="flex items-start gap-2 p-3">
        <div className="flex-1">
          <div className="text-sm font-semibold leading-tight">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{body}</div>
          {why && (
            <button
              type="button"
              onClick={onToggleWhy}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              data-testid="training-why-toggle"
            >
              {whyOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Why this matters
            </button>
          )}
          {why && whyOpen && (
            <div className="mt-1 text-xs text-muted-foreground border-l-2 border-primary/40 pl-2">
              {why}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="p-1 rounded hover:bg-muted text-muted-foreground"
          aria-label="Dismiss"
          data-testid="training-dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
