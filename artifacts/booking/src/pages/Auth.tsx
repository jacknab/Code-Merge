import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import MarketingNav from "@/components/layout/MarketingNav";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2, ArrowRight, Calendar, Users, Wrench,
  CalendarDays, CreditCard, Star, Gift,
  BarChart2, ClipboardList, MessageSquare, ShieldCheck,
  Smartphone, Globe, Clock, Zap, Check,
  Scissors, Sparkles, QrCode, TrendingUp,
} from "lucide-react";
import { FaGoogle } from "react-icons/fa";
import { useToast } from "@/hooks/use-toast";

const GROUP_CONFIG = {
  booking: {
    label: "Certxa Booking",
    tagline: "Fill your calendar. Automate the rest.",
    icon: <Calendar className="w-5 h-5" />,
  },
  queue: {
    label: "Certxa Queue",
    tagline: "No appointments. No chaos.",
    icon: <Users className="w-5 h-5" />,
  },
  pro: {
    label: "Certxa Pro",
    tagline: "Run the office. Empower the crew.",
    icon: <Wrench className="w-5 h-5" />,
  },
} as const;

type GroupKey = keyof typeof GROUP_CONFIG;

const PLUM      = "#3B0764";
const PLUM_MID  = "#5B21B6";
const GOLD      = "#F59E0B";
const CHARCOAL  = "#1C1917";

const TRIAL_FEATURES = [
  { icon: CalendarDays, text: "Appointments & calendar" },
  { icon: Globe,        text: "Online booking widget" },
  { icon: CreditCard,   text: "Point of Sale & payments" },
  { icon: Users,        text: "Staff management" },
  { icon: MessageSquare,text: "SMS & email reminders (credits sold separately)" },
  { icon: Star,         text: "Loyalty program & rewards" },
  { icon: Gift,         text: "Gift cards" },
  { icon: Clock,        text: "Waitlist & virtual queue" },
  { icon: Smartphone,   text: "Google Reviews manager" },
  { icon: BarChart2,    text: "Analytics & reports" },
  { icon: ClipboardList,text: "Client intake forms" },
  { icon: Zap,          text: "Unlimited clients" },
];

export default function Auth() {
  const navigate = useNavigate();
  const { isAuthenticated, user, login, register, isLoggingIn, isRegistering, isLoading, hasStoredSession, loginWithGoogle } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();

  const [mode, setMode] = useState<"login" | "register">(
    searchParams.get("mode") === "register" ? "register" : "login"
  );
  const rawGroup = searchParams.get("group") ?? "";
  const group: GroupKey | null = rawGroup in GROUP_CONFIG ? (rawGroup as GroupKey) : null;
  const cfg = group ? GROUP_CONFIG[group] : null;
  const redirectTo = searchParams.get("redirect") ?? null;

  useEffect(() => {
    const error = searchParams.get("error");
    if (!error) return;
    const messages: Record<string, string> = {
      google_not_configured: "Google sign-in is not available right now. Please use email and password.",
      google_failed: "Google sign-in failed. Please try again or use email and password.",
      google_no_user: "Could not retrieve your Google account. Please try again.",
      rate_limited: `Too many sign-in attempts. Please wait ${searchParams.get("retry") ?? "a few"} minute(s) and try again.`,
    };
    const description = messages[error] ?? "An unexpected error occurred. Please try again.";
    toast({ title: "Sign-in error", description, variant: "destructive" });
  }, []);

  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(false);

  // Load Cormorant Garamond to match PHP nav exactly
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@300;400;500;600;700;800;900&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => { if (document.head.contains(link)) document.head.removeChild(link); };
  }, []);

  const postAuthRedirect = (onboardingCompleted: boolean) => {
    if (redirectTo) return navigate(redirectTo, { replace: true });
    if (!onboardingCompleted) {
      if (group === "pro") return navigate("/pro-setup");
      return navigate("/onboarding");
    }
    if (group === "pro") return navigate("/pro-dashboard");
    return navigate("/manage");
  };

  useEffect(() => {
    if (isAuthenticated) {
      if (redirectTo) { navigate(redirectTo, { replace: true }); return; }
      if (user && !user.onboardingCompleted) {
        if (group === "pro") navigate("/pro-setup");
        else navigate("/onboarding");
      } else {
        if (group === "pro") navigate("/pro-dashboard");
        else navigate("/manage");
      }
    }
  }, [isAuthenticated, user, navigate, group, redirectTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let result: any;
      if (mode === "login") {
        result = await login({ email, password, keepSignedIn });
      } else {
        result = await register({ email, password, firstName: firstName || undefined, lastName: lastName || undefined, keepSignedIn });
      }
      postAuthRedirect(!!(result && result.onboardingCompleted));
    } catch (error: any) {
      const message = error?.message || (mode === "login" ? "Login failed" : "Registration failed");
      let description = message;
      try {
        const parsed = JSON.parse(message.replace(/^\d+:\s*/, ""));
        description = parsed.message || message;
      } catch {
        if (message.includes(":")) description = message.split(":").slice(1).join(":").trim();
      }
      toast({ title: mode === "login" ? "Login failed" : "Registration failed", description, variant: "destructive" });
    }
  };

  const isPending = isLoggingIn || isRegistering;

  if (isLoading && hasStoredSession) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <MarketingNav hideActions />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
          <div style={{ textAlign: "center" }}>
            <Loader2 style={{ width: 32, height: 32, color: PLUM_MID, margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
            <p style={{ color: "#9ca3af", fontSize: ".875rem" }}>Welcome back! Restoring your session…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", maxHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "'Inter', sans-serif", overflow: "hidden" }}>
      {/* Nav — matches PHP overview.php nav exactly */}
      <MarketingNav hideActions />

      <div style={{ flex: 1, display: "flex", alignItems: "stretch", overflow: "hidden", minHeight: 0 }}>

        {/* ── Left panel ── */}
        {mode === "register" ? (
          <TrialLeftPanel cfg={cfg} />
        ) : (
          <LoginLeftPanel cfg={cfg} />
        )}

        {/* ── Right panel — form ── */}
        <div style={{
          flex: "0 0 460px",
          display: "flex", flexDirection: "column",
          background: "#fff",
          overflowY: "auto",
          borderLeft: "1px solid #f0f0f2",
          minHeight: 0,
        }}>
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            justifyContent: "center", padding: "12px 44px 20px",
            marginTop: "-24px",
          }}>

            {/* Group badge */}
            {cfg && mode === "register" && (
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 12px", borderRadius: 50,
                background: "rgba(91,33,182,0.07)", border: "1px solid rgba(91,33,182,0.18)",
                color: PLUM_MID, fontSize: ".72rem", fontWeight: 700,
                marginBottom: 14, width: "fit-content",
              }}>
                {cfg.icon}
                Starting with {cfg.label}
              </div>
            )}

            {/* Heading */}
            <h1 style={{
              fontFamily: mode === "register" ? "'Cormorant Garamond', serif" : "'Inter', sans-serif",
              fontSize: mode === "register" ? "2.2rem" : "1.85rem",
              fontWeight: mode === "register" ? 700 : 800,
              letterSpacing: mode === "register" ? "-0.02em" : "-0.03em",
              color: CHARCOAL, lineHeight: 1.1,
              margin: "0 0 8px",
            }}>
              {mode === "login" ? "Welcome back" : "Start your free trial"}
            </h1>

            {/* Subtext */}
            {mode === "register" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "3px 10px", borderRadius: 50,
                  background: "rgba(245,158,11,0.1)", color: "#92400e",
                  fontSize: ".72rem", fontWeight: 700,
                }}>
                  <ShieldCheck style={{ width: 11, height: 11 }} />
                  60 days free
                </span>
                <span style={{ color: "#9ca3af", fontSize: ".78rem" }}>No credit card required</span>
              </div>
            ) : (
              <p style={{ color: "#6b7280", fontSize: ".88rem", marginBottom: 20 }}>
                Sign in to continue to your dashboard.
              </p>
            )}

            {/* Google */}
            <button
              type="button"
              onClick={() => loginWithGoogle({ keepSignedIn })}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                gap: 10, padding: "11px 20px", borderRadius: 9,
                border: "1.5px solid #e5e7eb", background: "#fff",
                fontSize: ".85rem", fontWeight: 600, color: "#374151",
                cursor: "pointer", transition: "border-color .15s, background .15s",
                marginBottom: 14,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#f9fafb"; (e.currentTarget as HTMLElement).style.borderColor = "#d1d5db"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#fff"; (e.currentTarget as HTMLElement).style.borderColor = "#e5e7eb"; }}
            >
              <FaGoogle style={{ color: "#ea4335", width: 15, height: 15 }} />
              {mode === "login" ? "Sign in with Google" : "Sign up with Google"}
            </button>

            {/* Divider */}
            <div style={{ position: "relative", marginBottom: 14 }}>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center" }}>
                <span style={{ width: "100%", borderTop: "1px solid #f3f4f6" }} />
              </div>
              <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
                <span style={{ background: "#fff", padding: "0 12px", fontSize: ".7rem", color: "#9ca3af", letterSpacing: ".1em", textTransform: "uppercase" }}>or</span>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {mode === "register" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <Label htmlFor="firstName" style={{ display: "block", fontSize: ".68rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>First name</Label>
                    <Input
                      id="firstName"
                      data-testid="input-first-name"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      placeholder="Jane"
                      style={{ height: 40, borderRadius: 8, borderColor: "#e5e7eb", background: "#fafafa", fontSize: ".85rem" }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName" style={{ display: "block", fontSize: ".68rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>Last name</Label>
                    <Input
                      id="lastName"
                      data-testid="input-last-name"
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                      placeholder="Doe"
                      style={{ height: 40, borderRadius: 8, borderColor: "#e5e7eb", background: "#fafafa", fontSize: ".85rem" }}
                    />
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="email" style={{ display: "block", fontSize: ".68rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>Email</Label>
                <Input
                  id="email"
                  type="email"
                  data-testid="input-email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@yourbusiness.com"
                  required
                  style={{ height: 40, borderRadius: 8, borderColor: "#e5e7eb", background: "#fafafa", fontSize: ".85rem" }}
                />
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <Label htmlFor="password" style={{ fontSize: ".68rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".08em" }}>Password</Label>
                  {mode === "login" && (
                    <Link to="/forgot-password" style={{ fontSize: ".78rem", fontWeight: 600, color: PLUM_MID, textDecoration: "none" }}>
                      Forgot password?
                    </Link>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  data-testid="input-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                  style={{ height: 40, borderRadius: 8, borderColor: "#e5e7eb", background: "#fafafa", fontSize: ".85rem" }}
                />
              </div>

              {/* Keep signed in */}
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  onChange={e => setKeepSignedIn(e.target.checked)}
                  data-testid="checkbox-keep-signed-in"
                  style={{ marginTop: 2, width: 14, height: 14, accentColor: PLUM_MID, cursor: "pointer" }}
                />
                <span>
                  <span style={{ display: "block", fontSize: ".78rem", fontWeight: 600, color: "#374151" }}>Keep me signed in on this device</span>
                  <span style={{ display: "block", fontSize: ".7rem", color: "#9ca3af", marginTop: 1 }}>Use for the front-desk computer — staff won't have to log in.</span>
                </span>
              </label>

              {/* CTA */}
              <button
                type="submit"
                disabled={isPending}
                data-testid="button-submit-auth"
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 8, padding: "12px 20px", borderRadius: 9, border: "none",
                  fontFamily: "'Inter', sans-serif",
                  fontSize: ".875rem", fontWeight: 700, color: "#fff",
                  cursor: isPending ? "not-allowed" : "pointer",
                  opacity: isPending ? 0.65 : 1,
                  background: mode === "register"
                    ? `linear-gradient(135deg, ${PLUM} 0%, ${PLUM_MID} 100%)`
                    : `linear-gradient(135deg, ${GOLD} 0%, #E8950F 100%)`,
                  boxShadow: mode === "register"
                    ? "0 4px 20px rgba(59,7,100,0.35)"
                    : "0 4px 16px rgba(245,158,11,0.35)",
                  transition: "transform .15s, box-shadow .15s, opacity .15s",
                  marginTop: 2,
                }}
                onMouseEnter={e => { if (!isPending) { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow = mode === "register" ? "0 8px 28px rgba(59,7,100,0.45)" : "0 8px 24px rgba(245,158,11,0.45)"; } }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = mode === "register" ? "0 4px 20px rgba(59,7,100,0.35)" : "0 4px 16px rgba(245,158,11,0.35)"; }}
              >
                {isPending && <Loader2 style={{ width: 15, height: 15, animation: "spin 1s linear infinite" }} />}
                {mode === "login" ? "Sign in" : "Start my 60-day free trial"}
                {!isPending && <ArrowRight style={{ width: 15, height: 15 }} />}
              </button>

              {mode === "register" && (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 7,
                  background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.22)",
                  borderRadius: 7, padding: "6px 9px",
                }}>
                  <span style={{ fontSize: ".78rem", lineHeight: 1, marginTop: 1, flexShrink: 0 }}>📱</span>
                  <p style={{ fontSize: ".68rem", color: "#b45309", lineHeight: 1.4, margin: 0 }}>
                    <strong style={{ color: "#92400e" }}>SMS not included in trial.</strong>{" "}
                    Purchase an SMS package from your dashboard after signing up.
                  </p>
                </div>
              )}
            </form>

            {/* Switch mode */}
            <p style={{ textAlign: "center", color: "#9ca3af", fontSize: ".82rem", marginTop: 16 }}>
              {mode === "login" ? (
                <>
                  Don't have an account?{" "}
                  <button type="button" onClick={() => setMode("register")}
                    data-testid="link-switch-to-register"
                    style={{ color: PLUM_MID, fontWeight: 700, background: "none", border: "none", cursor: "pointer", fontSize: ".82rem" }}>
                    Start free trial
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button type="button" onClick={() => setMode("login")}
                    data-testid="link-switch-to-login"
                    style={{ color: PLUM_MID, fontWeight: 700, background: "none", border: "none", cursor: "pointer", fontSize: ".82rem" }}>
                    Log in
                  </button>
                </>
              )}
            </p>

            {/* Footer links */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginTop: 16, paddingTop: 16, borderTop: "1px solid #f3f4f6" }}>
              <a href="https://certxa.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "#d1d5db", fontSize: ".75rem", textDecoration: "none" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#6b7280"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#d1d5db"; }}>
                Privacy
              </a>
              <a href="https://certxa.com/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#d1d5db", fontSize: ".75rem", textDecoration: "none" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#6b7280"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#d1d5db"; }}>
                Terms
              </a>
              <Link to="/staff-auth" style={{ color: "#d1d5db", fontSize: ".75rem", textDecoration: "none" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#6b7280"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#d1d5db"; }}>
                Staff login
              </Link>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes orbFloat1 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(30px,-20px) scale(1.08); } }
        @keyframes orbFloat2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-20px,30px) scale(1.05); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:none; } }
        @media (max-width: 900px) {
          .auth-left-panel { display: none !important; }
          .auth-right-panel { max-width: 100% !important; }
        }
      `}</style>
    </div>
  );
}

/* ─── Rotating ad slides for the register panel ─── */
const AD_SLIDES = [
  {
    tag: "SalonOS",
    tagColor: "#c4b5fd",
    tagBg: "rgba(139,92,246,0.20)",
    tagBorder: "rgba(139,92,246,0.35)",
    icon: <Scissors style={{ width: 13, height: 13 }} />,
    headline: ["Your whole salon,", "one screen."],
    accentWord: "salon,",
    sub: "Booking, POS, loyalty, intake forms — finally unified.",
    testimonial: {
      quote: "I replaced three separate apps with Certxa. Everything finally talks to each other — and my front desk actually loves coming to work now.",
      name: "Marcus T.",
      title: "Owner, Crown Barbershop",
      initials: "MT",
    },
  },
  {
    tag: "Smart Scheduling",
    tagColor: "#FCD34D",
    tagBg: "rgba(245,158,11,0.12)",
    tagBorder: "rgba(245,158,11,0.28)",
    icon: <Calendar style={{ width: 13, height: 13 }} />,
    headline: ["Fill your calendar", "while you sleep."],
    accentWord: "calendar",
    sub: "Online booking works for you 24/7 — even after hours.",
    testimonial: {
      quote: "I wake up every morning to new appointments. My book fills itself. I haven't had a slow Tuesday in months.",
      name: "Aaliyah K.",
      title: "Independent Stylist",
      initials: "AK",
    },
  },
  {
    tag: "Client Retention",
    tagColor: "#6ee7b7",
    tagBg: "rgba(16,185,129,0.12)",
    tagBorder: "rgba(16,185,129,0.28)",
    icon: <Sparkles style={{ width: 13, height: 13 }} />,
    headline: ["Turn one-timers", "into regulars."],
    accentWord: "regulars.",
    sub: "Loyalty rewards, gift cards & automated follow-ups.",
    testimonial: {
      quote: "The loyalty program brought back 40% of clients I thought were gone forever. The automated follow-ups do all the work for me.",
      name: "Priya S.",
      title: "Owner, Glow Nail Studio",
      initials: "PS",
    },
  },
  {
    tag: "Certxa Queue",
    tagColor: "#a5f3fc",
    tagBg: "rgba(14,165,233,0.12)",
    tagBorder: "rgba(14,165,233,0.28)",
    icon: <QrCode style={{ width: 13, height: 13 }} />,
    headline: ["Walk-ins without", "the wait-around."],
    accentWord: "wait-around.",
    sub: "Virtual check-in, live board display & smart SMS alerts.",
    testimonial: {
      quote: "Walk-in chaos is completely gone. Clients check in from the parking lot and we text them when we're ready. Genius.",
      name: "DeShawn M.",
      title: "Owner, Elite Cuts",
      initials: "DM",
    },
  },
];

/* ─── Trial left panel (register mode) ─── */
function TrialLeftPanel({ cfg }: { cfg: { label: string; tagline: string; icon: React.ReactNode } | null }) {
  const PLUM      = "#3B0764";
  const PLUM_MID  = "#5B21B6";
  const GOLD      = "#F59E0B";

  const [slideIdx, setSlideIdx] = useState(0);
  const [visible, setVisible]   = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setSlideIdx(i => (i + 1) % AD_SLIDES.length);
        setVisible(true);
      }, 420);
    }, 4200);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const slide = AD_SLIDES[slideIdx];

  return (
    <div
      className="auth-left-panel"
      style={{
        flex: 1, position: "relative", overflow: "hidden",
        display: "flex", flexDirection: "column",
        background: "#0d0020",
      }}
    >
      {/* Background video */}
      <video
        autoPlay
        muted
        loop
        playsInline
        style={{
          position: "absolute", top: 0, left: 0,
          width: "100%", height: "100%",
          objectFit: "cover", zIndex: 1,
        }}
      >
        <source src="/videos/salon_booking.mp4" type="video/mp4" />
      </video>

      {/* Dark purple gradient overlay for readability */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 2,
        background: "linear-gradient(145deg, rgba(26,0,64,0.88) 0%, rgba(45,0,96,0.82) 50%, rgba(26,10,46,0.90) 100%)",
      }} />

      {/* Content */}
      <div style={{
        position: "relative", zIndex: 10,
        display: "flex", flexDirection: "column",
        justifyContent: "center",
        height: "100%", padding: "36px 48px",
        animation: "fadeUp .5s ease both",
      }}>

        {/* Logo */}
        <a href="/overview.php" style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: "1.45rem", fontWeight: 700,
          letterSpacing: "-0.02em",
          color: "#fff", textDecoration: "none",
          marginBottom: 28, display: "block",
        }}>
          Certxa<span style={{ color: GOLD }}>.</span>
        </a>

        {/* ── Animated ad block ── */}
        <div style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 0.38s ease, transform 0.38s ease",
          marginBottom: 22,
        }}>
          {/* Product tag */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "5px 13px", borderRadius: 50,
            background: slide.tagBg,
            border: `1px solid ${slide.tagBorder}`,
            marginBottom: 16, width: "fit-content",
          }}>
            <span style={{ color: slide.tagColor, display: "flex" }}>{slide.icon}</span>
            <span style={{ fontSize: ".7rem", fontWeight: 700, color: slide.tagColor, letterSpacing: ".07em", textTransform: "uppercase" }}>
              {slide.tag}
            </span>
          </div>

          {/* Headline */}
          <h2 style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: "clamp(2.4rem, 3.4vw, 3.1rem)",
            fontWeight: 700, letterSpacing: "-0.03em",
            lineHeight: 1.06, color: "#fff",
            margin: "0 0 12px",
          }}>
            {slide.headline.map((line, i) => (
              <span key={i} style={{ display: "block" }}>
                {line.split(" ").map((word, wi) =>
                  word === slide.accentWord
                    ? <em key={wi} style={{ color: GOLD, fontStyle: "italic" }}>{word} </em>
                    : <span key={wi}>{word} </span>
                )}
              </span>
            ))}
          </h2>

          {/* Sub */}
          <p style={{
            color: "rgba(255,255,255,0.52)", fontSize: ".88rem",
            lineHeight: 1.6, maxWidth: 340, margin: 0,
          }}>
            {slide.sub}
          </p>
        </div>

        {/* Slide dots */}
        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          {AD_SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => { setVisible(false); setTimeout(() => { setSlideIdx(i); setVisible(true); }, 300); }}
              style={{
                width: i === slideIdx ? 22 : 6,
                height: 6, borderRadius: 3,
                background: i === slideIdx ? GOLD : "rgba(255,255,255,0.2)",
                border: "none", cursor: "pointer", padding: 0,
                transition: "width 0.35s ease, background 0.35s ease",
              }}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>

        {/* Testimonial — synced with active slide */}
        <div style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(6px)",
          transition: "opacity 0.38s ease 0.05s, transform 0.38s ease 0.05s",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.09)",
          backdropFilter: "blur(8px)",
          borderRadius: 12, padding: "14px 16px",
          marginBottom: 18,
        }}>
          <div style={{ display: "flex", gap: 2, marginBottom: 8 }}>
            {[...Array(5)].map((_, i) => (
              <svg key={i} width="11" height="11" viewBox="0 0 20 20" fill={GOLD}>
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
              </svg>
            ))}
          </div>
          <p style={{ fontSize: ".78rem", color: "rgba(255,255,255,0.62)", lineHeight: 1.55, fontStyle: "italic", margin: "0 0 10px" }}>
            "{slide.testimonial.quote}"
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: ".6rem", fontWeight: 800, color: "#fff",
              background: `linear-gradient(135deg, ${slide.tagColor}55, ${slide.tagColor}22)`,
              border: `1px solid ${slide.tagColor}44`,
            }}>
              {slide.testimonial.initials}
            </div>
            <div>
              <p style={{ fontSize: ".76rem", fontWeight: 700, color: "rgba(255,255,255,0.85)", margin: 0, lineHeight: 1 }}>{slide.testimonial.name}</p>
              <p style={{ fontSize: ".66rem", color: "rgba(255,255,255,0.32)", margin: "3px 0 0" }}>{slide.testimonial.title}</p>
            </div>
          </div>
        </div>

        {/* 60-day free pill */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "5px 14px", borderRadius: 50,
          background: "rgba(245,158,11,0.10)",
          border: "1px solid rgba(245,158,11,0.22)",
          marginBottom: 20, width: "fit-content",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD, flexShrink: 0 }} />
          <span style={{ fontSize: ".7rem", fontWeight: 700, color: "#FCD34D", letterSpacing: ".06em", textTransform: "uppercase" }}>
            Free for 60 days — no credit card
          </span>
        </div>

        {/* Feature grid — first 8 only */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: ".62rem", fontWeight: 700, color: "rgba(255,255,255,0.28)", textTransform: "uppercase", letterSpacing: ".14em", marginBottom: 10 }}>
            What's included
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
            {TRIAL_FEATURES.slice(0, 8).map(({ text }) => (
              <div key={text} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(139,92,246,0.3)",
                }}>
                  <Check style={{ width: 10, height: 10, color: "#c4b5fd" }} />
                </div>
                <span style={{ fontSize: ".76rem", color: "rgba(255,255,255,0.65)", lineHeight: 1.3 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div style={{
          display: "flex", gap: 28,
          paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.08)",
        }}>
          {[
            { num: "50K+", label: "Businesses" },
            { num: "2M+",  label: "Bookings/mo" },
            { num: "4.9★", label: "Avg rating" },
          ].map(({ num, label }) => (
            <div key={label}>
              <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.45rem", fontWeight: 700, color: "#fff", margin: 0, lineHeight: 1 }}>{num}</p>
              <p style={{ fontSize: ".65rem", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: ".08em", margin: "3px 0 0" }}>{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Login left panel ─── */
function LoginLeftPanel({ cfg }: { cfg: { label: string; tagline: string; icon: React.ReactNode } | null }) {
  const PLUM_MID  = "#5B21B6";
  const GOLD      = "#F59E0B";
  const PLUM      = "#3B0764";

  return (
    <div
      className="auth-left-panel"
      style={{
        flex: 1, position: "relative", overflow: "hidden",
        display: "flex", flexDirection: "column",
        background: "#0d0020",
      }}
    >
      {/* Background video */}
      <video
        autoPlay
        muted
        loop
        playsInline
        style={{
          position: "absolute", top: 0, left: 0,
          width: "100%", height: "100%",
          objectFit: "cover", zIndex: 1,
        }}
      >
        <source src="/videos/hair_salon.mp4" type="video/mp4" />
      </video>

      {/* Deep plum gradient overlay */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 2,
        background: "linear-gradient(145deg, rgba(26,0,64,0.86) 0%, rgba(45,0,96,0.80) 50%, rgba(26,10,46,0.88) 100%)",
      }} />

      <div style={{
        position: "relative", zIndex: 10,
        display: "flex", flexDirection: "column",
        height: "100%", padding: "52px 56px",
        animation: "fadeUp .5s ease both",
      }}>

        {/* Logo */}
        <a href="/overview.php" style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: "1.55rem", fontWeight: 700,
          letterSpacing: "-0.02em",
          color: "#fff", textDecoration: "none",
          marginBottom: 60, display: "block",
        }}>
          Certxa<span style={{ color: GOLD }}>.</span>
        </a>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {cfg && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "7px 16px", borderRadius: 50,
              background: "rgba(139,92,246,0.18)", border: "1px solid rgba(139,92,246,0.35)",
              color: "#c4b5fd", fontSize: ".8rem", fontWeight: 700,
              marginBottom: 24,
            }}>
              {cfg.icon}
              {cfg.label}
            </div>
          )}

          <h2 style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: "clamp(2.6rem, 3.5vw, 3.6rem)",
            fontWeight: 700, letterSpacing: "-0.03em",
            lineHeight: 1.06, color: "#fff",
            margin: "0 0 16px",
          }}>
            The platform<br />
            <em style={{ color: GOLD, fontStyle: "italic" }}>built for</em><br />
            service pros.
          </h2>

          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: ".95rem", lineHeight: 1.65, maxWidth: 340, margin: "0 0 32px" }}>
            Bookings, front desk, POS, loyalty rewards, check-in, waitlist — all in one place.
          </p>

          {/* Stats */}
          <div style={{ display: "flex", gap: 32, marginBottom: 32, paddingBottom: 28, borderBottom: "1px solid rgba(255,255,255,0.10)" }}>
            {[
              { num: "50K+", label: "Businesses" },
              { num: "2M+",  label: "Bookings/mo" },
              { num: "4.9★", label: "Avg rating" },
            ].map(({ num, label }) => (
              <div key={label}>
                <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.6rem", fontWeight: 700, color: "#fff", margin: 0, lineHeight: 1 }}>{num}</p>
                <p style={{ fontSize: ".68rem", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: ".08em", margin: "4px 0 0" }}>{label}</p>
              </div>
            ))}
          </div>

          {/* Testimonial */}
          <div style={{
            background: "rgba(255,255,255,0.06)", borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            backdropFilter: "blur(8px)",
            padding: "20px 22px", maxWidth: 400,
          }}>
            <div style={{ display: "flex", gap: 2, marginBottom: 10 }}>
              {[...Array(5)].map((_, i) => (
                <svg key={i} width="13" height="13" viewBox="0 0 20 20" fill={GOLD}>
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
              ))}
            </div>
            <p style={{ fontSize: ".84rem", color: "rgba(255,255,255,0.65)", lineHeight: 1.6, fontStyle: "italic", margin: "0 0 12px" }}>
              "Setting up took one afternoon. By the next morning we already had 6 new bookings come in overnight."
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: ".68rem", fontWeight: 700, color: "#fff",
                background: `linear-gradient(135deg, ${PLUM_MID}, ${PLUM})`,
              }}>JR</div>
              <div>
                <p style={{ fontSize: ".8rem", fontWeight: 700, color: "rgba(255,255,255,0.85)", margin: 0, lineHeight: 1 }}>Jasmine R.</p>
                <p style={{ fontSize: ".7rem", color: "rgba(255,255,255,0.35)", margin: "3px 0 0" }}>Owner, Luxe Hair Studio</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
