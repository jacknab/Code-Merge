import { useNavigate } from "react-router-dom";
import { AlertTriangle, CreditCard, ArrowRight, HelpCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";

export default function AccountSuspended() {
  const navigate = useNavigate();
  const [creatingPortal, setCreatingPortal] = useState(false);

  const { data: statusData } = useQuery<any>({
    queryKey: ["/api/billing/account-status"],
    queryFn: () =>
      fetch("/api/billing/account-status", { credentials: "include" }).then((r) => r.json()),
  });

  const suspendedAt = statusData?.suspendedAt
    ? new Date(statusData.suspendedAt)
    : null;

  const daysSuspended = suspendedAt
    ? Math.floor((Date.now() - suspendedAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const daysLeft =
    daysSuspended !== null ? Math.max(0, 30 - daysSuspended) : null;

  async function openBillingPortal() {
    setCreatingPortal(true);
    try {
      const salonId = statusData?.salonId;
      if (!salonId) return;
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ salonId, returnUrl: window.location.href }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      // silent
    } finally {
      setCreatingPortal(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    navigate("/auth");
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4">
      {/* Subtle top bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />

      <div className="w-full max-w-lg space-y-8">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <AlertTriangle className="w-10 h-10 text-amber-400" />
          </div>
        </div>

        {/* Heading */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-bold text-white">Account Suspended</h1>
          <p className="text-zinc-400 text-base leading-relaxed">
            Your account has been temporarily suspended due to a failed payment.
            Your data is safe — no appointments or history have been deleted.
          </p>
        </div>

        {/* Status banner */}
        {daysLeft !== null && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 text-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-300 font-medium">
                  {daysLeft === 0
                    ? "Your account will be deactivated today"
                    : `${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining to restore service`}
                </p>
                <p className="text-zinc-500 mt-0.5">
                  After 30 days without payment, your subscription will be canceled
                  and your account locked. Update your payment method now to avoid
                  service interruption.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Steps */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
          <p className="text-sm font-medium text-zinc-300">How to restore your account</p>
          <ol className="space-y-3">
            {[
              'Click "Update Payment Method" below',
              "Update your card details in the secure billing portal",
              "Your subscription will automatically resume",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-zinc-400">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/15 text-amber-400 text-xs flex items-center justify-center font-bold mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Button
            className="w-full h-12 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-base"
            onClick={openBillingPortal}
            disabled={creatingPortal}
          >
            <CreditCard className="w-5 h-5 mr-2" />
            {creatingPortal ? "Opening billing portal…" : "Update Payment Method"}
          </Button>

          <Button
            variant="ghost"
            className="w-full text-zinc-500 hover:text-zinc-300 text-sm"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-1.5" />
            Sign out
          </Button>
        </div>

        {/* Support */}
        <p className="text-center text-xs text-zinc-600">
          Need help?{" "}
          <a
            href="mailto:support@certxa.com"
            className="text-zinc-400 hover:text-white transition-colors"
          >
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}
