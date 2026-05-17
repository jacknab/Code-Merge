import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useSelectedStore } from "@/hooks/use-store";
import { useAuth } from "@/hooks/use-auth";
import {
  Database, Users, AlertTriangle, Star, Clock,
  TrendingUp, DollarSign, Zap, CheckCircle2,
  Radio
} from "lucide-react";

type EngineStatus = "offline" | "initializing" | "running" | "online";

interface EngineState {
  status: EngineStatus;
  progress: number;
  result: string;
}

const ENGINES = [
  {
    id: "data_scan",
    label: "Appointment History Scanner",
    description: "Indexing 6 months of booking data",
    Icon: Database,
    color: "#60a5fa",
    glow: "rgba(96,165,250,0.35)",
  },
  {
    id: "client_profiles",
    label: "Client Profile Engine",
    description: "Cadence & lifetime value per client",
    Icon: Users,
    color: "#a78bfa",
    glow: "rgba(167,139,250,0.35)",
  },
  {
    id: "churn_scoring",
    label: "Churn Risk Scoring",
    description: "Multi-factor retention risk analysis",
    Icon: AlertTriangle,
    color: "#fbbf24",
    glow: "rgba(251,191,36,0.35)",
  },
  {
    id: "staff_intelligence",
    label: "Staff Intelligence",
    description: "Rebooking rates & tech performance",
    Icon: Star,
    color: "#22d3ee",
    glow: "rgba(34,211,238,0.35)",
  },
  {
    id: "dead_seats",
    label: "Dead Seat Detector",
    description: "Chronically underbooked slot analysis",
    Icon: Clock,
    color: "#fb923c",
    glow: "rgba(251,146,60,0.35)",
  },
  {
    id: "growth_score",
    label: "Growth Score Engine",
    description: "Composite 0–100 business health score",
    Icon: TrendingUp,
    color: "#34d399",
    glow: "rgba(52,211,153,0.35)",
  },
  {
    id: "revenue_leakage",
    label: "Revenue Leakage Scanner",
    description: "Lapsed client & lost revenue mapping",
    Icon: DollarSign,
    color: "#f87171",
    glow: "rgba(248,113,113,0.35)",
  },
  {
    id: "drift_engine",
    label: "Drift Recovery Engine",
    description: "Win-back candidate identification",
    Icon: Zap,
    color: "#c084fc",
    glow: "rgba(192,132,252,0.35)",
  },
];

const defaultState = (): EngineState => ({ status: "offline", progress: 0, result: "" });

export default function DemoLaunchEngines() {
  const { user } = useAuth();
  const { selectedStore } = useSelectedStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<"idle" | "seeding" | "launching" | "complete">("idle");
  const [engines, setEngines] = useState<Record<string, EngineState>>(
    () => Object.fromEntries(ENGINES.map((e) => [e.id, defaultState()]))
  );
  const [log, setLog] = useState<string[]>([]);
  const [dots, setDots] = useState(".");

  // Finish overlay state
  const [showFinish, setShowFinish] = useState(false);
  const [finishPct, setFinishPct] = useState(0);
  const [finishLabel, setFinishLabel] = useState("Finalising dashboard...");

  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (phase !== "launching" && phase !== "seeding") return;
    const iv = setInterval(() => setDots((d) => (d.length >= 3 ? "." : d + ".")), 400);
    return () => clearInterval(iv);
  }, [phase]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  useEffect(() => () => { esRef.current?.close(); }, []);

  // Auto-redirect after finish overlay completes
  useEffect(() => {
    if (!showFinish) return;

    let pct = 0;
    const step = () => {
      pct += 1.4;
      setFinishPct(Math.min(100, pct));
      if (pct >= 70 && pct < 72) {
        setFinishLabel("Loading intelligence data...");
      }
      if (pct >= 95) {
        setFinishLabel("Finished ✓");
      }
      if (pct < 100) {
        setTimeout(step, 28);
      } else {
        // Remove all cached intelligence data so Intelligence.tsx starts a
        // fresh fetch on mount — invalidateQueries alone keeps the stale
        // "hasData: false" value in cache and the gate fires before the
        // background refetch completes.
        queryClient.removeQueries({ queryKey: ["/api/intelligence"] });
        setTimeout(() => navigate("/intelligence", { replace: true }), 600);
      }
    };
    setTimeout(step, 200);
  }, [showFinish, navigate, queryClient]);

  // Guard: only tester accounts (accountType === "tester") or legacy demo emails can access
  const isDemoUser = (user as any)?.accountType === "tester" || [
    "nail-demo@certxa.com",
    "hair-demo@certxa.com",
    "spa-demo@certxa.com",
    "barber-demo@certxa.com",
  ].includes(user?.email ?? "");

  useEffect(() => {
    if (user && !isDemoUser) {
      navigate("/intelligence", { replace: true });
    }
  }, [user, isDemoUser, navigate]);

  function setEngine(id: string, patch: Partial<EngineState>) {
    setEngines((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function appendLog(msg: string) {
    setLog((prev) => [...prev.slice(-120), msg]);
  }

  function handleLaunch() {
    if (!selectedStore?.id) return;
    setPhase("seeding");
    appendLog("[SYSTEM] ═══════════════════════════════════════════════════");
    appendLog("[SYSTEM] Certxa Revenue Intelligence — Engine Boot Sequence");
    appendLog("[SYSTEM] ═══════════════════════════════════════════════════");
    appendLog("[SYSTEM] Establishing secure data pipeline...");

    const url = `/api/intelligence/demo/launch?storeId=${selectedStore.id}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);

        // ── Seed pre-phase ─────────────────────────────────────────────────
        if (data.phase === "seed") {
          if (data.logLine) appendLog(data.logLine);
          if (data.status === "done") {
            // Seed finished — transition to engine launch phase
            setPhase("launching");
            appendLog("[SYSTEM] ───────────────────────────────────────────────");
            appendLog("[SYSTEM] 8 engines standing by for initialisation.");
          }
          return;
        }

        // ── Engine complete ────────────────────────────────────────────────
        if (data.phase === "complete") {
          appendLog("[SYSTEM] ───────────────────────────────────────────────");
          appendLog("[SYSTEM] ✅ ALL 8 ENGINES ONLINE — Intelligence stack ready");
          appendLog("[SYSTEM] ───────────────────────────────────────────────");
          setPhase("complete");
          es.close();
          setTimeout(() => setShowFinish(true), 800);
          return;
        }

        if (data.phase === "error") {
          appendLog(`[ERROR] ${data.error || "Unknown engine error"}`);
          es.close();
          return;
        }

        // ── Per-engine events ──────────────────────────────────────────────
        const { phase: p, status, result, progress, logLine } = data;

        if (logLine) appendLog(logLine);

        if (status === "starting") {
          setEngine(p, { status: "initializing", progress: 0, result: "" });
        } else if (status === "running") {
          setEngine(p, { status: "running", progress: progress ?? 50 });
        } else if (status === "done") {
          setEngine(p, { status: "online", progress: 100, result: result || "" });
        }
      } catch {
        /* ignore parse errors */
      }
    };

    es.onerror = () => {
      appendLog("[ERROR] Stream connection lost.");
      es.close();
    };
  }

  return (
    <div
      className="min-h-screen w-full overflow-auto"
      style={{
        background: "radial-gradient(ellipse at 50% 0%, #1a0a2e 0%, #0f0f1a 60%, #07070f 100%)",
        backgroundAttachment: "fixed",
      }}
    >
      <style>{`
        @keyframes blink-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes all-online-glow {
          0%, 100% { text-shadow: 0 0 20px #34d399, 0 0 40px #34d39966; }
          50%       { text-shadow: 0 0 40px #34d399, 0 0 80px #34d39966; }
        }
        @keyframes button-pulse {
          0%, 100% { box-shadow: 0 0 20px #7c3aed88, 0 0 40px #7c3aed44; }
          50%       { box-shadow: 0 0 40px #7c3aedcc, 0 0 80px #7c3aed66; }
        }
        @keyframes overlay-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes card-in {
          from { opacity: 0; transform: scale(0.92) translateY(20px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .engine-card { transition: all 0.4s ease; }
        .engine-card.online {
          border-color: var(--card-color) !important;
          box-shadow: 0 0 0 1px var(--card-color), 0 0 24px var(--card-glow), inset 0 0 24px rgba(0,0,0,0.6);
        }
        .engine-card.initializing {
          border-color: #fbbf24 !important;
          box-shadow: 0 0 12px rgba(251,191,36,0.3);
        }
        .engine-card.running {
          border-color: var(--card-color) !important;
          box-shadow: 0 0 16px var(--card-glow);
        }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .status-dot.offline  { background: #374151; }
        .status-dot.initializing { background: #fbbf24; animation: blink-dot 0.6s infinite; }
        .status-dot.running  { background: var(--dot-color); animation: blink-dot 0.8s infinite; }
        .status-dot.online   { background: #34d399; box-shadow: 0 0 8px #34d39988; }
        .grid-bg {
          background-image: linear-gradient(rgba(124,58,237,0.05) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(124,58,237,0.05) 1px, transparent 1px);
          background-size: 40px 40px;
        }
        .log-line-online  { color: #34d399; }
        .log-line-error   { color: #f87171; }
        .log-line-system  { color: #a78bfa; }
        .log-line-boot    { color: #fbbf24; }
        .log-line-run     { color: #60a5fa; }
        .log-line-seed    { color: #22d3ee; }
        .log-line-default { color: #64748b; }
      `}</style>

      {/* ── Finish overlay ──────────────────────────────────────────────────── */}
      {showFinish && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(7, 0, 15, 0.82)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            animation: "overlay-in 0.4s ease both",
          }}
        >
          <div
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(139,92,246,0.35)",
              borderRadius: 24,
              padding: "48px 56px",
              textAlign: "center",
              minWidth: 360,
              animation: "card-in 0.5s cubic-bezier(0.34,1.56,0.64,1) both",
            }}
          >
            {/* Icon */}
            <div style={{
              width: 64, height: 64, borderRadius: "50%", margin: "0 auto 24px",
              background: finishPct >= 100
                ? "radial-gradient(circle, #059669, #047857)"
                : "radial-gradient(circle, #7c3aed, #5b21b6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: finishPct >= 100 ? "0 0 32px #05966966" : "0 0 32px #7c3aed66",
              transition: "all 0.5s ease",
            }}>
              {finishPct >= 100
                ? <CheckCircle2 size={28} color="#fff" />
                : <Zap size={28} color="#fff" />
              }
            </div>

            {/* Label */}
            <p style={{
              fontSize: "1rem",
              fontWeight: 700,
              color: finishPct >= 100 ? "#34d399" : "#e2e8f0",
              marginBottom: 24,
              letterSpacing: "0.02em",
              transition: "color 0.4s ease",
            }}>
              {finishLabel}
            </p>

            {/* Progress bar track */}
            <div style={{
              height: 8,
              background: "rgba(255,255,255,0.07)",
              borderRadius: 100,
              overflow: "hidden",
              marginBottom: 16,
              width: "100%",
            }}>
              <div style={{
                height: "100%",
                width: `${finishPct}%`,
                borderRadius: 100,
                background: finishPct >= 100
                  ? "linear-gradient(90deg, #059669, #34d399)"
                  : "linear-gradient(90deg, #7c3aed, #a78bfa)",
                boxShadow: finishPct >= 100
                  ? "0 0 12px #34d39966"
                  : "0 0 12px #a78bfa66",
                transition: "background 0.5s ease, box-shadow 0.5s ease",
              }} />
            </div>

            <p style={{ fontSize: "0.72rem", color: "#475569", fontFamily: "monospace", letterSpacing: "0.06em" }}>
              {finishPct >= 100 ? "Redirecting to dashboard..." : `${Math.round(finishPct)}% — loading intelligence data`}
            </p>
          </div>
        </div>
      )}

      <div className="grid-bg min-h-screen">

        {/* Header bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <Radio size={14} className="text-violet-400" />
            <span className="text-xs font-mono tracking-widest text-violet-400 uppercase">
              Certxa Intelligence System · Demo Mode
            </span>
          </div>
          <button
            onClick={() => navigate("/intelligence")}
            className="text-xs font-mono text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
          >
            Skip to Dashboard →
          </button>
        </div>

        <div className="max-w-5xl mx-auto px-4 pb-16 pt-10">

          {/* Title */}
          <div className="text-center mb-10">
            {phase === "idle" && (
              <div style={{ animation: "slide-up 0.6s ease both" }}>
                <p className="text-xs font-mono tracking-widest text-violet-500 uppercase mb-3">
                  8 engines · standing by
                </p>
                <h1 className="text-4xl sm:text-5xl font-black text-white mb-4 tracking-tight">
                  Revenue Intelligence
                </h1>
                <p className="text-slate-400 text-base max-w-md mx-auto">
                  All engines are offline. Press the button below to initialise the full intelligence stack against your live demo data.
                </p>
              </div>
            )}
            {phase === "seeding" && (
              <div style={{ animation: "slide-up 0.4s ease both" }}>
                <p className="text-xs font-mono tracking-widest text-cyan-400 uppercase mb-3">
                  preparing demo data
                </p>
                <h1 className="text-4xl sm:text-5xl font-black text-white mb-4 tracking-tight">
                  Loading Store{dots}
                </h1>
                <p className="text-slate-400 text-sm max-w-sm mx-auto">
                  Resetting &amp; seeding fresh demo data. Engines will launch automatically when ready.
                </p>
                {/* Indeterminate seed progress bar */}
                <div className="mt-6 mx-auto max-w-xs h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                  <div
                    style={{
                      height: "100%",
                      width: "40%",
                      borderRadius: 100,
                      background: "linear-gradient(90deg, #22d3ee, #67e8f9)",
                      boxShadow: "0 0 10px #22d3ee88",
                      animation: "slide-indeterminate 1.6s ease-in-out infinite",
                    }}
                  />
                </div>
                <style>{`
                  @keyframes slide-indeterminate {
                    0%   { transform: translateX(-150%); }
                    100% { transform: translateX(450%); }
                  }
                `}</style>
              </div>
            )}
            {phase === "launching" && (
              <div style={{ animation: "slide-up 0.4s ease both" }}>
                <p className="text-xs font-mono tracking-widest text-amber-400 uppercase mb-3">
                  boot sequence in progress
                </p>
                <h1 className="text-4xl sm:text-5xl font-black text-white mb-4 tracking-tight">
                  Initialising{dots}
                </h1>
                <p className="text-slate-400 text-sm">
                  Engines are coming online one by one. This takes 30–60 seconds.
                </p>
              </div>
            )}
            {phase === "complete" && (
              <div style={{ animation: "slide-up 0.4s ease both" }}>
                <p className="text-xs font-mono tracking-widest text-emerald-400 uppercase mb-3">
                  all systems nominal
                </p>
                <h1
                  className="text-4xl sm:text-5xl font-black tracking-tight"
                  style={{
                    color: "#34d399",
                    animation: "all-online-glow 2s ease-in-out infinite",
                  }}
                >
                  All Engines Online
                </h1>
                <p className="text-slate-400 text-sm mt-3">
                  Revenue Intelligence is fully initialised. Loading your dashboard...
                </p>
              </div>
            )}
          </div>

          {/* Engine grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {ENGINES.map((engine) => {
              const state = engines[engine.id];
              return (
                <div
                  key={engine.id}
                  className={`engine-card relative rounded-xl border p-4 ${state.status}`}
                  style={{
                    borderColor: state.status === "offline" ? "rgba(255,255,255,0.06)" : undefined,
                    background: state.status === "online"
                      ? `linear-gradient(135deg, rgba(0,0,0,0.7), rgba(0,0,0,0.5))`
                      : "rgba(0,0,0,0.5)",
                    ["--card-color" as any]: engine.color,
                    ["--card-glow" as any]: engine.glow,
                    ["--dot-color" as any]: engine.color,
                  }}
                >
                  {/* Status dot + label */}
                  <div className="flex items-center justify-between mb-3">
                    <span
                      className={`status-dot ${state.status}`}
                      style={{ ["--dot-color" as any]: engine.color }}
                    />
                    <span className="text-[9px] font-mono uppercase tracking-widest"
                      style={{
                        color: state.status === "online" ? engine.color
                          : state.status === "initializing" ? "#fbbf24"
                          : state.status === "running" ? engine.color
                          : "#374151",
                      }}
                    >
                      {state.status === "offline" ? "OFFLINE"
                        : state.status === "initializing" ? "BOOT"
                        : state.status === "running" ? "RUN"
                        : "ONLINE"}
                    </span>
                  </div>

                  {/* Icon */}
                  <engine.Icon
                    size={22}
                    style={{
                      color: state.status === "offline" ? "#374151" : engine.color,
                      transition: "color 0.4s ease",
                      filter: state.status === "online" ? `drop-shadow(0 0 6px ${engine.color})` : undefined,
                    }}
                    className="mb-2"
                  />

                  {/* Label */}
                  <p className="text-[11px] font-semibold leading-tight mb-1"
                    style={{ color: state.status === "offline" ? "#4b5563" : "#e2e8f0" }}
                  >
                    {engine.label}
                  </p>
                  <p className="text-[10px] leading-snug"
                    style={{ color: state.status === "offline" ? "#374151" : "#64748b" }}
                  >
                    {state.status === "online" && state.result
                      ? state.result
                      : engine.description}
                  </p>

                  {/* Progress bar */}
                  {(state.status === "running" || state.status === "initializing") && (
                    <div className="mt-3 h-0.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${state.progress}%`,
                          background: `linear-gradient(90deg, ${engine.color}88, ${engine.color})`,
                          boxShadow: `0 0 6px ${engine.color}`,
                          minWidth: state.status === "initializing" ? "20%" : undefined,
                        }}
                      />
                    </div>
                  )}

                  {/* Online checkmark */}
                  {state.status === "online" && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle2 size={13} style={{ color: "#34d399", filter: "drop-shadow(0 0 4px #34d399)" }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Launch button */}
          {phase === "idle" && (
            <div className="flex justify-center mb-8" style={{ animation: "slide-up 0.8s ease both" }}>
              <button
                onClick={handleLaunch}
                disabled={!selectedStore?.id}
                className="relative px-12 py-5 rounded-2xl font-black text-lg tracking-wider text-white uppercase disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
                  animation: "button-pulse 2s ease-in-out infinite",
                  letterSpacing: "0.12em",
                }}
              >
                <span className="flex items-center gap-3">
                  <Zap size={20} />
                  Initiate Intelligence Engines
                  <Zap size={20} />
                </span>
              </button>
            </div>
          )}

          {/* Activity log — shown during and after launch */}
          {phase !== "idle" && (
            <div
              className="rounded-xl border border-white/5 overflow-hidden"
              style={{ background: "rgba(0,0,0,0.6)" }}
            >
              <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{
                      background: phase === "complete" ? "#34d399" : phase === "seeding" ? "#22d3ee" : "#fbbf24",
                      boxShadow: phase === "complete" ? "0 0 8px #34d399" : phase === "seeding" ? "0 0 8px #22d3ee" : "0 0 8px #fbbf24",
                      animation: (phase === "launching" || phase === "seeding") ? "blink-dot 1s infinite" : undefined,
                    }}
                  />
                  <span className="text-[10px] font-mono text-slate-500 tracking-widest uppercase">
                    Engine Activity Log
                  </span>
                </div>
                <span className="text-[9px] font-mono text-slate-600 tracking-widest">
                  {log.length} lines
                </span>
              </div>
              <div
                ref={logRef}
                className="font-mono text-[11px] px-4 py-3 space-y-0.5 overflow-y-auto"
                style={{ maxHeight: "260px" }}
              >
                {log.map((line, i) => {
                  const cls = line.startsWith("[ONLINE]") ? "log-line-online"
                    : line.startsWith("[ERROR]") ? "log-line-error"
                    : line.startsWith("[SYSTEM]") ? "log-line-system"
                    : line.startsWith("[BOOT]") ? "log-line-boot"
                    : line.startsWith("[RUN]") ? "log-line-run"
                    : line.startsWith("[SEED]") ? "log-line-seed"
                    : "log-line-default";
                  return (
                    <div key={i} className={cls}>
                      {line}
                    </div>
                  );
                })}
                {(phase === "seeding" || phase === "launching") && (
                  <div
                    className={phase === "seeding" ? "log-line-seed" : "log-line-system"}
                    style={{ animation: "blink-dot 1s infinite" }}
                  >
                    ▋
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
