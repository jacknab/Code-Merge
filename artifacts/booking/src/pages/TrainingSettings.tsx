import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GraduationCap, Loader2, Save } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useSelectedStore } from "@/hooks/use-store";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface TrainingSettings {
  storeId: number;
  enabled: boolean;
  autoEnrollNewStaff: boolean;
  graduationMinDays: number;
  showHelpBubbleAfterGraduation: boolean;
}

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 rounded-xl border p-4 cursor-pointer transition-colors ${
        disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-muted/30"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform mt-0.5 ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

export default function TrainingSettings() {
  const { user, isLoading: authLoading } = useAuth();
  const { selectedStore, isLoading: storeLoading } = useSelectedStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TrainingSettings | null>(null);

  const role = (user as any)?.role;
  const canManage = role === "owner" || role === "admin" || role === "manager";
  const storeId = selectedStore?.id;

  const { data, isLoading, error } = useQuery<{ settings: TrainingSettings }>({
    queryKey: ["/api/training/admin/settings", storeId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/training/admin/settings?storeId=${storeId}`,
      );
      return res.json();
    },
    enabled: !!storeId && canManage,
    retry: false,
  });

  useEffect(() => {
    if (data?.settings) setDraft(data.settings);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (s: TrainingSettings) => {
      const res = await apiRequest("PUT", "/api/training/admin/settings", s);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Settings saved", description: "Training preferences updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/training/admin/settings", storeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/training/state"] });
    },
    onError: () => {
      toast({ title: "Couldn't save", description: "Please try again.", variant: "destructive" });
    },
  });

  if (authLoading || storeLoading || isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!canManage) {
    return (
      <AppLayout>
        <div className="p-8 text-center text-muted-foreground">
          You need owner or manager access to change training settings.
        </div>
      </AppLayout>
    );
  }

  if (!draft) {
    if (!storeId) {
      return (
        <AppLayout>
          <div className="p-8 text-center text-muted-foreground">
            Pick a store from the switcher to manage training settings.
          </div>
        </AppLayout>
      );
    }
    if (error) {
      return (
        <AppLayout>
          <div className="p-8 text-center text-muted-foreground">
            Couldn't load training settings for this store. You may not have permission, or the server returned an error.
          </div>
        </AppLayout>
      );
    }
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <Link
            to="/dashboard/training"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="w-4 h-4" /> Back to staff training
          </Link>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 text-primary p-2.5">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Training Settings</h1>
              <p className="text-sm text-muted-foreground">
                Control how the adaptive coaching tool behaves for everyone in this store.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <Toggle
            label="Adaptive coaching enabled"
            description="Master switch. When off, no overlays, tooltips, or help bubbles are shown to anyone."
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
          />
          <Toggle
            label="Auto-enroll new staff"
            description="Automatically opt new logins into training. Turn off if you'd rather enroll people manually from the dashboard."
            checked={draft.autoEnrollNewStaff}
            onChange={(v) => setDraft({ ...draft, autoEnrollNewStaff: v })}
            disabled={!draft.enabled}
          />
          <Toggle
            label="Keep help bubble after graduation"
            description="Once someone graduates, leave the floating ? button visible so they can still summon help on demand."
            checked={draft.showHelpBubbleAfterGraduation}
            onChange={(v) => setDraft({ ...draft, showHelpBubbleAfterGraduation: v })}
            disabled={!draft.enabled}
          />

          <div className={`rounded-xl border p-4 ${!draft.enabled ? "opacity-60" : ""}`}>
            <div className="text-sm font-semibold text-foreground">
              Minimum days before graduation
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Even if a staff member crushes every category, hold off on the "fully trained"
              celebration until they've been enrolled this many days. Set to 0 for no waiting period.
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="number"
                min={0}
                max={365}
                value={draft.graduationMinDays}
                disabled={!draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, graduationMinDays: Math.max(0, Number(e.target.value) || 0) })
                }
                className="w-24 rounded-md border bg-background px-3 py-2 text-sm"
                data-testid="input-grad-min-days"
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => data?.settings && setDraft(data.settings)}
            className="px-4 py-2 text-sm rounded-md border hover:bg-muted transition-colors"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => draft && saveMutation.mutate(draft)}
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60"
            data-testid="button-save-training-settings"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save changes
          </button>
        </div>
      </div>
    </AppLayout>
  );
}
