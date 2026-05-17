import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Loader2, Mail, Lock, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

export default function StaffAuth() {
  const navigate = useNavigate();
  const { user, isAuthenticated, login, isLoggingIn } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      if (user?.role === "staff" && user.passwordChanged === false) {
        navigate("/staff-change-password");
      } else if (user?.role === "staff") {
        navigate("/staff-calendar");
      } else {
        navigate("/calendar");
      }
    }
  }, [isAuthenticated, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login({ email, password });
      navigate("/staff-calendar");
    } catch (error: any) {
      toast({
        title: "Login failed",
        description: error.message || "Invalid credentials",
        variant: "destructive",
      });
    }
  };

  return (
    <div
      className="min-h-screen w-full bg-[#050C18] text-white font-['Plus_Jakarta_Sans',sans-serif] flex flex-col"
      style={{ minHeight: "100dvh" }}
    >
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[#00D4AA]/10 rounded-full blur-[120px]" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 px-5 pt-6 pb-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img
            src="/web-app.png"
            alt="Certxa"
            className="w-8 h-8 rounded-lg"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <span className="font-extrabold text-lg tracking-tight">Certxa</span>
        </Link>
        <Link
          to="/auth"
          className="text-white/50 hover:text-white text-xs font-medium transition-colors"
        >
          Owner login
        </Link>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex flex-col justify-center px-5 pb-8 pt-4 max-w-md mx-auto w-full">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#00D4AA]/10 border border-[#00D4AA]/30 text-[#00D4AA] mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00D4AA] animate-pulse" />
            <span className="text-[11px] font-bold uppercase tracking-wider">Staff Portal</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black leading-tight mb-2">
            Welcome back
          </h1>
          <p className="text-white/55 text-sm">
            Sign in to view your schedule and manage your day.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-[11px] font-bold uppercase tracking-wider text-white/50 mb-2"
            >
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                data-testid="input-staff-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@example.com"
                required
                className="w-full h-14 pl-12 pr-4 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-white/30 text-base focus:outline-none focus:border-[#00D4AA]/60 focus:bg-white/8 transition-colors"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-[11px] font-bold uppercase tracking-wider text-white/50 mb-2"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                data-testid="input-staff-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                className="w-full h-14 pl-12 pr-4 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-white/30 text-base focus:outline-none focus:border-[#00D4AA]/60 focus:bg-white/8 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoggingIn}
            data-testid="button-staff-login"
            className="w-full h-14 mt-2 rounded-2xl bg-[#00D4AA] text-[#050C18] font-bold text-base flex items-center justify-center gap-2 hover:bg-[#00bfa5] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLoggingIn ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                Sign in
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-white/35 text-xs">
            Trouble signing in? Ask your salon owner to reset your password.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-5 py-5 text-center">
        <p className="text-white/25 text-[11px]">
          © {new Date().getFullYear()} Certxa
        </p>
      </footer>
    </div>
  );
}
