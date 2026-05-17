/**
 * Phase 9.3 — PracticeOverlay portal.
 *
 * Mounts a fixed, ~90% viewport overlay above the live app so the live
 * calendar stays visible at the edges (a constant reminder you're in
 * practice, not production). Closes on ✕, Esc, and outside-click.
 *
 * Phase 9.4 will mount the full app routes inside `<main>` against a
 * sandbox storeId. For now this is an empty shell with a header — enough to
 * verify open/close UX and the portal plumbing.
 */
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Beaker, X, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { usePracticeMode } from "@/contexts/PracticeModeContext";
import { SandboxStoreProvider } from "@/components/training/SandboxStoreProvider";
import { SandboxRoutes } from "@/components/training/SandboxRoutes";
import { PracticePersistence } from "@/components/training/PracticePersistence";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Scenario = { key: string; label: string; description: string };
type ScenarioMetric = { label: string; value: number; outOf?: number };
type ScenarioResults = {
  scenario: { key: string; label: string };
  startedAt: string;
  metrics: ScenarioMetric[];
  headline: string;
  score: number;
};

function ScenarioPicker({
  onScenarioStarted,
}: {
  onScenarioStarted: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery<{ scenarios: Scenario[] }>({
    queryKey: ["/api/training/sandbox/scenarios"],
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async (scenario: string) => {
      const res = await apiRequest("POST", "/api/training/sandbox/scenario", { scenario });
      return res.json();
    },
    onSuccess: (result, scenario) => {
      const label = data?.scenarios.find((s) => s.key === scenario)?.label ?? "Scenario";
      toast({
        title: `${label} loaded`,
        description: `${result.appointmentsCreated ?? 0} practice bookings ready to work through.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      onScenarioStarted(scenario);
      setOpen(false);
    },
    onError: () => {
      toast({ title: "Could not load scenario", variant: "destructive" });
    },
  });

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const scenarios = data?.scenarios ?? [];

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={mutation.isPending}
        data-testid="button-scenario-picker"
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border border-amber-300 dark:border-amber-700 bg-white/60 dark:bg-amber-900/40 hover:bg-white dark:hover:bg-amber-900/60 transition-colors disabled:opacity-60"
      >
        {mutation.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Sparkles className="w-3.5 h-3.5" />
        )}
        Quick Scenarios
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg z-10 overflow-hidden"
          data-testid="menu-scenarios"
        >
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b">
            Load themed practice data
          </div>
          {scenarios.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted-foreground">Loading…</div>
          )}
          {scenarios.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => mutation.mutate(s.key)}
              disabled={mutation.isPending}
              data-testid={`button-scenario-${s.key}`}
              className="w-full text-left px-3 py-2.5 hover:bg-muted transition-colors block disabled:opacity-60"
            >
              <div className="text-sm font-medium">{s.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ScenarioScoreboard({
  onDismiss,
  onClose,
}: {
  onDismiss: () => void;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<{ results: ScenarioResults | null }>({
    queryKey: ["/api/training/sandbox/scenario/results"],
  });
  const results = data?.results;

  return (
    <div
      role="dialog"
      aria-label="Scenario results"
      data-testid="scenario-scoreboard"
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="w-[420px] max-w-[90%] rounded-xl bg-background shadow-2xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b bg-muted/40">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Scenario complete
          </div>
          <div className="text-lg font-semibold mt-0.5">
            {results?.scenario.label ?? "Practice Scenario"}
          </div>
        </div>
        <div className="p-5">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Scoring your run…
            </div>
          )}
          {!isLoading && !results && (
            <div className="text-sm text-muted-foreground">
              No scenario is currently running.
            </div>
          )}
          {!isLoading && results && (
            <>
              <div className="flex items-baseline justify-between mb-3">
                <div className="text-sm text-muted-foreground">{results.headline}</div>
                <div
                  className="text-2xl font-bold tabular-nums"
                  data-testid="scenario-score"
                >
                  {results.score}%
                </div>
              </div>
              <ul className="space-y-2">
                {results.metrics.map((m) => (
                  <li
                    key={m.label}
                    className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-b-0"
                  >
                    <span className="text-muted-foreground">{m.label}</span>
                    <span className="font-medium tabular-nums">
                      {m.value}
                      {m.outOf != null && (
                        <span className="text-muted-foreground"> / {m.outOf}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t bg-muted/40 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            data-testid="button-scoreboard-keep-practicing"
            className="px-3 py-1.5 text-sm rounded-md border hover:bg-muted transition-colors"
          >
            Keep practicing
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="button-scoreboard-close"
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Close practice mode
          </button>
        </div>
      </div>
    </div>
  );
}

interface SandboxBoundaryState {
  error: Error | null;
}

class SandboxErrorBoundary extends Component<
  { onReset: () => void; children: ReactNode },
  SandboxBoundaryState
> {
  state: SandboxBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): SandboxBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PracticeOverlay] sandbox render crashed:", error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          data-testid="sandbox-error"
          className="h-full w-full flex flex-col items-center justify-center gap-3 p-8 text-center"
        >
          <AlertTriangle className="w-8 h-8 text-amber-600" />
          <div className="text-base font-semibold">
            Practice Mode hit an error
          </div>
          <div className="text-sm text-muted-foreground max-w-md">
            {this.state.error.message ||
              "Something inside the practice sandbox failed to render."}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => {
                this.reset();
                this.props.onReset();
              }}
              data-testid="button-sandbox-reset-state"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border hover:bg-muted transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset practice state
            </button>
            <button
              type="button"
              onClick={this.reset}
              data-testid="button-sandbox-retry"
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}

export function PracticeOverlay() {
  const { inPractice, exitPractice } = usePracticeMode();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const queryClient = useQueryClient();

  const dismissScenario = async () => {
    setShowScoreboard(false);
    setActiveScenario(null);
    try {
      await apiRequest("POST", "/api/training/sandbox/scenario/dismiss", {});
    } catch {
      // best-effort cleanup; safe to ignore network errors here
    }
    queryClient.removeQueries({ queryKey: ["/api/training/sandbox/scenario/results"] });
  };

  const requestExit = () => {
    if (activeScenario && !showScoreboard) {
      // Pre-fetch latest results before showing the scoreboard.
      queryClient.invalidateQueries({ queryKey: ["/api/training/sandbox/scenario/results"] });
      setShowScoreboard(true);
      return;
    }
    if (activeScenario) {
      void dismissScenario();
    }
    exitPractice();
  };

  // Esc to close
  useEffect(() => {
    if (!inPractice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestExit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [inPractice, activeScenario, showScoreboard]);

  // Lock body scroll while open so the page underneath doesn't shift on
  // open/close — also kills the perceived "lag" the plan calls out.
  useEffect(() => {
    if (!inPractice) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [inPractice]);

  if (!inPractice) return null;

  const onBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
      requestExit();
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Practice mode"
      data-testid="practice-overlay"
      onMouseDown={onBackdropMouseDown}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-150"
    >
      <div
        ref={panelRef}
        className="relative w-[90vw] h-[90vh] bg-background rounded-xl shadow-2xl border border-border overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-2.5 border-b bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Beaker className="w-4 h-4" />
            Practice Mode
            <span className="text-xs font-normal opacity-70">
              · nothing here is real · changes reset nightly
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ScenarioPicker onScenarioStarted={(key) => setActiveScenario(key)} />
            {activeScenario && (
              <button
                type="button"
                onClick={() => {
                  queryClient.invalidateQueries({
                    queryKey: ["/api/training/sandbox/scenario/results"],
                  });
                  setShowScoreboard(true);
                }}
                data-testid="button-show-results"
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border border-amber-300 dark:border-amber-700 bg-white/60 dark:bg-amber-900/40 hover:bg-white dark:hover:bg-amber-900/60 transition-colors"
              >
                Results
              </button>
            )}
            <button
              type="button"
              onClick={requestExit}
              data-testid="button-practice-close"
              className="p-1.5 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
              aria-label="Close practice mode"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-auto bg-background">
          {/*
           * MemoryRouter keeps practice navigation isolated from the live URL,
           * so a trainee clicking around inside the overlay never changes the
           * browser address bar. SandboxStoreProvider overrides StoreContext
           * so every reused page component reads/writes the sandbox store.
           * PracticePersistence (Phase 9.5) restores the previous path +
           * scroll position so re-opening picks up exactly where you left off.
           */}
          <MemoryRouter initialEntries={["/calendar"]}>
            <SandboxErrorBoundary
              onReset={() => {
                try {
                  for (let i = localStorage.length - 1; i >= 0; i--) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith("practice-mode:")) {
                      localStorage.removeItem(k);
                    }
                  }
                } catch {
                  /* ignore storage errors */
                }
                queryClient.invalidateQueries({
                  queryKey: ["/api/training/sandbox"],
                });
              }}
            >
              <PracticePersistence scrollRef={scrollRef} />
              <SandboxStoreProvider>
                <SandboxRoutes />
              </SandboxStoreProvider>
            </SandboxErrorBoundary>
          </MemoryRouter>
        </div>

        {showScoreboard && (
          <ScenarioScoreboard
            onDismiss={() => setShowScoreboard(false)}
            onClose={() => {
              setShowScoreboard(false);
              void dismissScenario();
              exitPractice();
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
