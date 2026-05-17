import { useEffect, useState } from "react";
import { Sparkles, Brain, TrendingUp, Users, Zap, ArrowRight, ChevronRight, Star } from "lucide-react";

const BUSINESS_TYPES = [
  {
    type: "nail",
    emoji: "💅",
    label: "Nail Salon",
    store: "Luxe Nails & Spa",
    description: "Acrylics, gel manicures, and combination treatments across a real client roster",
    color: "#e879f9",
    glow: "rgba(232,121,249,0.25)",
    border: "rgba(232,121,249,0.35)",
    bg: "rgba(232,121,249,0.08)",
    stats: ["340+ client profiles", "8 staff members", "Live churn scoring"],
  },
  {
    type: "hair",
    emoji: "✂️",
    label: "Hair Salon",
    store: "Elevate Hair Studio",
    description: "Color, balayage, highlights, and cuts — with real revenue leakage mapped to real clients",
    color: "#38bdf8",
    glow: "rgba(56,189,248,0.25)",
    border: "rgba(56,189,248,0.35)",
    bg: "rgba(56,189,248,0.08)",
    stats: ["290+ client profiles", "6 stylists", "Dead seat detection"],
  },
  {
    type: "spa",
    emoji: "🧖",
    label: "Day Spa",
    store: "Serenity Spa & Wellness",
    description: "Swedish and deep tissue massages, facials — with drift recovery and growth score",
    color: "#34d399",
    glow: "rgba(52,211,153,0.25)",
    border: "rgba(52,211,153,0.35)",
    bg: "rgba(52,211,153,0.08)",
    stats: ["260+ client profiles", "5 therapists", "Growth score engine"],
  },
  {
    type: "barber",
    emoji: "💈",
    label: "Barbershop",
    store: "Prime Cuts Barbershop",
    description: "Fades, beard trims, and shaves — with no-show prediction and staff performance data",
    color: "#fb923c",
    glow: "rgba(251,146,60,0.25)",
    border: "rgba(251,146,60,0.35)",
    bg: "rgba(251,146,60,0.08)",
    stats: ["310+ client profiles", "4 barbers", "No-show risk scoring"],
  },
];

const WHAT_YOU_SEE = [
  {
    icon: Brain,
    title: "8 AI Engines fire in real time",
    desc: "Watch client profiles, churn scores, dead seats, and revenue leakage compute live — not a slideshow.",
  },
  {
    icon: TrendingUp,
    title: "Growth Score 0–100 with grade",
    desc: "A composite health score built from booking density, client retention, and staff utilisation.",
  },
  {
    icon: Users,
    title: "Every client classified",
    desc: "Power clients, drifting regulars, at-risk lapsed — each scored against their own personal visit cadence.",
  },
  {
    icon: Zap,
    title: "Revenue leakage mapped to names",
    desc: "Not averages — actual dollar amounts tied to specific clients who have stopped coming in.",
  },
];

export default function DemoLanding() {
  const [entering, setEntering] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Live Demo — Certxa Revenue Intelligence";
  }, []);

  function handleEnter(type: string) {
    setEntering(type);
    // Full-page navigation so the server sets the session cookie
    window.location.href = `/api/intelligence/demo/enter/${type}`;
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #08000f 0%, #0d0520 40%, #050011 100%)",
      color: "#e2e8f0",
      fontFamily: "'Inter', system-ui, sans-serif",
      overflowX: "hidden",
    }}>

      {/* ── Top nav bar ───────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 32px",
        borderBottom: "1px solid rgba(139,92,246,0.15)",
        backdropFilter: "blur(12px)",
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(8,0,15,0.7)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Sparkles size={16} color="#fff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#f1f5f9", letterSpacing: "-.01em" }}>
            Certxa
          </span>
          <span style={{
            fontSize: ".7rem", fontWeight: 600, color: "#a78bfa",
            background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)",
            borderRadius: 50, padding: "2px 10px", marginLeft: 6, letterSpacing: ".06em",
          }}>
            INTELLIGENCE DEMO
          </span>
        </div>
        <a href="/auth" style={{
          fontSize: ".8rem", color: "#94a3b8", textDecoration: "none",
          display: "flex", alignItems: "center", gap: 4,
        }}>
          Sign in to your account <ChevronRight size={14} />
        </a>
      </div>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", padding: "80px 24px 56px", position: "relative" }}>

        {/* Radial glow behind heading */}
        <div style={{
          position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
          width: 700, height: 400,
          background: "radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.2) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        {/* Badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)",
          borderRadius: 50, padding: "6px 18px", marginBottom: 28,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#a78bfa", boxShadow: "0 0 8px #a78bfa",
            display: "inline-block", animation: "pulse 2s infinite",
          }} />
          <span style={{ fontSize: ".75rem", fontWeight: 600, color: "#a78bfa", letterSpacing: ".08em" }}>
            LIVE DEMO — REAL DATA, REAL ENGINES
          </span>
        </div>

        <h1 style={{
          fontSize: "clamp(2.2rem, 5vw, 3.6rem)", fontWeight: 800,
          lineHeight: 1.1, letterSpacing: "-.03em",
          color: "#f8fafc", marginBottom: 20, maxWidth: 780, margin: "0 auto 20px",
        }}>
          See your business through{" "}
          <span style={{
            background: "linear-gradient(90deg, #a78bfa, #818cf8, #67e8f9)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            the eyes of AI
          </span>
        </h1>

        <p style={{
          fontSize: "clamp(1rem, 2vw, 1.2rem)", color: "#94a3b8",
          maxWidth: 580, margin: "0 auto 16px", lineHeight: 1.65,
        }}>
          Pick your business type below and step straight in. No account, no password, no credit card.
          The intelligence engines will fire the moment you land.
        </p>

        <p style={{ fontSize: ".85rem", color: "#64748b", marginBottom: 0 }}>
          Each demo resets automatically — every session starts fresh.
        </p>
      </div>

      {/* ── Business type cards ───────────────────────────────────────────── */}
      <div style={{
        maxWidth: 1120, margin: "0 auto", padding: "0 24px 80px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 20,
      }}>
        {BUSINESS_TYPES.map((biz) => (
          <BusinessCard
            key={biz.type}
            biz={biz}
            isEntering={entering === biz.type}
            disabled={entering !== null && entering !== biz.type}
            onEnter={() => handleEnter(biz.type)}
          />
        ))}
      </div>

      {/* ── What you'll see ───────────────────────────────────────────────── */}
      <div style={{
        borderTop: "1px solid rgba(139,92,246,0.12)",
        background: "rgba(139,92,246,0.04)",
        padding: "64px 24px",
      }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <p style={{
            textAlign: "center", fontSize: ".75rem", fontWeight: 700,
            color: "#7c3aed", letterSpacing: ".1em", marginBottom: 12,
          }}>
            WHAT YOU'LL SEE INSIDE
          </p>
          <h2 style={{
            textAlign: "center", fontSize: "clamp(1.5rem, 3vw, 2rem)",
            fontWeight: 700, color: "#f1f5f9", marginBottom: 48,
            letterSpacing: "-.02em",
          }}>
            Not a product tour. A live intelligence run.
          </h2>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 24,
          }}>
            {WHAT_YOU_SEE.map(({ icon: Icon, title, desc }) => (
              <div key={title} style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(139,92,246,0.18)",
                borderRadius: 14, padding: "24px 20px",
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, marginBottom: 14,
                  background: "rgba(139,92,246,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon size={20} color="#a78bfa" />
                </div>
                <p style={{ fontWeight: 600, color: "#e2e8f0", marginBottom: 8, fontSize: ".95rem" }}>
                  {title}
                </p>
                <p style={{ fontSize: ".83rem", color: "#64748b", lineHeight: 1.6, margin: 0 }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Social proof strip ────────────────────────────────────────────── */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.05)",
        padding: "40px 24px",
        textAlign: "center",
      }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 10 }}>
          {[1,2,3,4,5].map(i => (
            <Star key={i} size={16} color="#fbbf24" fill="#fbbf24" />
          ))}
        </div>
        <p style={{ color: "#64748b", fontSize: ".88rem", maxWidth: 480, margin: "0 auto" }}>
          "I clicked into the spa demo and five minutes later I was on the phone with sales.
          The data felt like it was about my actual business."
        </p>
        <p style={{ color: "#475569", fontSize: ".78rem", marginTop: 10 }}>
          — Salon owner, Dallas TX
        </p>
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.04)",
        padding: "24px 32px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 12,
      }}>
        <span style={{ fontSize: ".78rem", color: "#334155" }}>
          © {new Date().getFullYear()} Certxa. All rights reserved.
        </span>
        <div style={{ display: "flex", gap: 20 }}>
          <a href="/auth" style={{ fontSize: ".78rem", color: "#475569", textDecoration: "none" }}>Sign in</a>
          <a href="/auth" style={{ fontSize: ".78rem", color: "#475569", textDecoration: "none" }}>Start free trial</a>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: .4; }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ── Individual business type card ─────────────────────────────────────────────
function BusinessCard({
  biz,
  isEntering,
  disabled,
  onEnter,
}: {
  biz: typeof BUSINESS_TYPES[0];
  isEntering: boolean;
  disabled: boolean;
  onEnter: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered
          ? `linear-gradient(135deg, ${biz.bg}, rgba(255,255,255,0.04))`
          : "rgba(255,255,255,0.03)",
        border: `1px solid ${hovered ? biz.border : "rgba(255,255,255,0.07)"}`,
        borderRadius: 18,
        padding: "28px 24px 24px",
        transition: "all 0.2s ease",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        boxShadow: hovered ? `0 0 32px ${biz.glow}` : "none",
        transform: hovered ? "translateY(-3px)" : "translateY(0)",
        display: "flex", flexDirection: "column",
      }}
    >
      {/* Icon + label */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: "2.2rem", marginBottom: 10, lineHeight: 1 }}>
          {biz.emoji}
        </div>
        <p style={{
          fontWeight: 700, fontSize: "1.1rem", color: "#f1f5f9",
          margin: "0 0 2px",
        }}>
          {biz.label}
        </p>
        <p style={{ fontSize: ".78rem", color: biz.color, fontWeight: 600, margin: 0 }}>
          {biz.store}
        </p>
      </div>

      {/* Description */}
      <p style={{
        fontSize: ".83rem", color: "#64748b", lineHeight: 1.6,
        margin: "0 0 18px", flexGrow: 1,
      }}>
        {biz.description}
      </p>

      {/* Stats pills */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 22 }}>
        {biz.stats.map((s) => (
          <div key={s} style={{
            display: "flex", alignItems: "center", gap: 7,
            fontSize: ".74rem", color: "#94a3b8",
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: "50%",
              background: biz.color, flexShrink: 0,
            }} />
            {s}
          </div>
        ))}
      </div>

      {/* CTA button */}
      <button
        onClick={onEnter}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "12px 0",
          borderRadius: 10,
          border: `1px solid ${biz.border}`,
          background: isEntering
            ? biz.color
            : hovered
              ? `rgba(${hexToRgb(biz.color)}, 0.18)`
              : "rgba(255,255,255,0.05)",
          color: isEntering ? "#fff" : biz.color,
          fontWeight: 700,
          fontSize: ".88rem",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          letterSpacing: ".01em",
        }}
      >
        {isEntering ? (
          <>
            <LoadingDots color={biz.color} />
            Launching engines…
          </>
        ) : (
          <>
            Enter Demo
            <ArrowRight size={15} />
          </>
        )}
      </button>
    </div>
  );
}

// ── Animated loading dots ─────────────────────────────────────────────────────
function LoadingDots({ color }: { color: string }) {
  return (
    <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 4, height: 4, borderRadius: "50%", background: "#fff",
            display: "inline-block",
            animation: `pulse 1s ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

// ── Utility: hex → "r, g, b" for rgba() ──────────────────────────────────────
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}
