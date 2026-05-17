import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, GraduationCap, Pin, PinOff, RotateCcw, X, Settings, Beaker } from "lucide-react";
import { Link } from "react-router-dom";
import { useSelectedStore } from "@/hooks/use-store";
import { useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface Category {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  defaultHelpLevel: number;
  highRisk: boolean;
}

interface StaffRow {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  staffName: string | null;
  graduatedCategories: number;
  totalCategories: number;
  avgHelpLevel: number;
  lastActivityAt: string | null;
}

interface DetailState {
  id: number;
  categoryId: number;
  helpLevel: number;
  successStreak: number;
  failures: number;
  totalAttempts: number;
  lastSeenAt: string | null;
  graduatedAt: string | null;
  pinnedLevel: number | null;
}

interface DetailEvent {
  id: number;
  categoryId: number;
  type: string;
  helpLevelAtTime: number;
  occurredAt: string;
}

interface StaffListResponse {
  categories: Category[];
  staff: StaffRow[];
}

interface StaffDetailResponse {
  user: { id: string; email: string; firstName: string | null; lastName: string | null; role: string };
  profile: { enrolledAt: string; graduatedAt: string | null } | null;
  categories: Category[];
  state: DetailState[];
  recentEvents: DetailEvent[];
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function levelBadgeClass(level: number): string {
  if (level >= 3) return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
  if (level === 2) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  if (level === 1) return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
}

function levelLabel(level: number): string {
  if (level >= 3) return "L3 · Spotlight";
  if (level === 2) return "L2 · Tooltip";
  if (level === 1) return "L1 · Whisper";
  return "L0 · Silent";
}

function fullName(u: { firstName: string | null; lastName: string | null; email: string; staffName?: string | null }) {
  const composed = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return composed || u.staffName || u.email;
}

export default function TrainingAdmin() {
  const { selectedStore, isLoading: storeLoading } = useSelectedStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const storeId = selectedStore?.id ?? null;

  const listQuery = useQuery<StaffListResponse>({
    queryKey: ["/api/training/admin/staff", storeId],
    enabled: !!storeId,
    queryFn: async () => {
      const res = await fetch(`/api/training/admin/staff?storeId=${storeId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load staff");
      return res.json();
    },
  });

  const detailQuery = useQuery<StaffDetailResponse>({
    queryKey: ["/api/training/admin/staff", selectedUserId, storeId],
    enabled: !!selectedUserId && !!storeId,
    queryFn: async () => {
      const res = await fetch(`/api/training/admin/staff/${selectedUserId}?storeId=${storeId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load staff detail");
      return res.json();
    },
  });

  const pinMutation = useMutation({
    mutationFn: async (vars: { userId: string; categoryId: number; pinnedLevel: number | null }) => {
      const res = await apiRequest("POST", "/api/training/admin/pin", { ...vars, storeId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/training/admin/staff"] });
      toast({ title: "Updated", description: "Training level saved." });
    },
    onError: () => {
      toast({ title: "Could not update", variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", `/api/training/reset/${userId}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/training/admin/staff"] });
      toast({ title: "Reset complete", description: "Staff member starts fresh at L3." });
    },
    onError: () => {
      toast({ title: "Could not reset", variant: "destructive" });
    },
  });

  const sandboxResetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/training/sandbox/reset", { storeId });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Practice data reset",
        description: "Fresh demo staff, services, clients, and bookings are loaded.",
      });
    },
    onError: () => {
      toast({ title: "Could not reset practice data", variant: "destructive" });
    },
  });

  const role = (user as any)?.role;
  const isManager = role === "owner" || role === "admin" || role === "manager";

  if (storeLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!isManager) {
    return (
      <div className="h-screen w-full flex">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          You need owner or manager access to view training progress.
        </div>
      </div>
    );
  }

  const rows = listQuery.data?.staff ?? [];

  return (
    <div className="h-screen w-full flex bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 md:p-8">
          <header className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <GraduationCap className="w-6 h-6 text-primary" />
                Staff Training
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                See where each team member is on the learning curve. Pin a level to lock guidance,
                or reset someone back to full coaching.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (
                    window.confirm(
                      "Wipe all practice-mode data and reload fresh demo staff, services, clients, and bookings?",
                    )
                  ) {
                    sandboxResetMutation.mutate();
                  }
                }}
                disabled={!storeId || sandboxResetMutation.isPending}
                data-testid="button-reset-practice-data"
              >
                {sandboxResetMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Beaker className="w-4 h-4" />
                )}
                Reset Practice Data
              </Button>
              <Link
                to="/dashboard/training/settings"
                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:bg-muted transition-colors"
                data-testid="link-training-settings"
              >
                <Settings className="w-4 h-4" /> Settings
              </Link>
            </div>
          </header>

          {listQuery.isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading staff…
            </div>
          )}
          {listQuery.error && (
            <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm">
              Could not load staff training data.
            </div>
          )}
          {!listQuery.isLoading && rows.length === 0 && (
            <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
              No staff with logins yet. Once a staff member signs in, their training progress will
              show up here.
            </div>
          )}

          {rows.length > 0 && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">Staff</th>
                    <th className="text-left p-3">Role</th>
                    <th className="text-left p-3">Avg level</th>
                    <th className="text-left p-3">Graduated</th>
                    <th className="text-left p-3">Last activity</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.userId}
                      data-testid={`training-staff-row-${r.userId}`}
                      className="border-t hover:bg-muted/30 cursor-pointer"
                      onClick={() => setSelectedUserId(r.userId)}
                    >
                      <td className="p-3">
                        <div className="font-medium">{fullName(r)}</div>
                        <div className="text-xs text-muted-foreground">{r.email}</div>
                      </td>
                      <td className="p-3 capitalize">{r.role}</td>
                      <td className="p-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${levelBadgeClass(Math.round(r.avgHelpLevel))}`}>
                          {r.avgHelpLevel.toFixed(1)}
                        </span>
                      </td>
                      <td className="p-3">
                        {r.graduatedCategories} / {r.totalCategories}
                      </td>
                      <td className="p-3 text-muted-foreground">{formatRelative(r.lastActivityAt)}</td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedUserId(r.userId);
                          }}
                          data-testid={`training-staff-open-${r.userId}`}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {selectedUserId && (
        <StaffDetailDrawer
          loading={detailQuery.isLoading}
          data={detailQuery.data}
          onClose={() => setSelectedUserId(null)}
          onPin={(categoryId, level) =>
            pinMutation.mutate({ userId: selectedUserId, categoryId, pinnedLevel: level })
          }
          onReset={() => {
            if (window.confirm("Reset this staff member back to L3 across all categories?")) {
              resetMutation.mutate(selectedUserId);
            }
          }}
          pinPending={pinMutation.isPending}
          resetPending={resetMutation.isPending}
        />
      )}
    </div>
  );
}

function StaffDetailDrawer({
  loading,
  data,
  onClose,
  onPin,
  onReset,
  pinPending,
  resetPending,
}: {
  loading: boolean;
  data: StaffDetailResponse | undefined;
  onClose: () => void;
  onPin: (categoryId: number, level: number | null) => void;
  onReset: () => void;
  pinPending: boolean;
  resetPending: boolean;
}) {
  const stateByCategory = useMemo(() => {
    const m = new Map<number, DetailState>();
    data?.state?.forEach((s) => m.set(s.categoryId, s));
    return m;
  }, [data]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} data-testid="training-detail-backdrop" />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-xl bg-background border-l shadow-2xl z-50 flex flex-col">
        <div className="flex items-start justify-between p-4 border-b">
          <div>
            {data ? (
              <>
                <h2 className="text-lg font-semibold">{fullName({ ...data.user, staffName: null })}</h2>
                <p className="text-xs text-muted-foreground">{data.user.email}</p>
                {data.profile && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Enrolled {formatRelative(data.profile.enrolledAt)}
                    {data.profile.graduatedAt ? ` · Fully graduated ${formatRelative(data.profile.graduatedAt)}` : ""}
                  </p>
                )}
              </>
            ) : (
              <h2 className="text-lg font-semibold">Staff training</h2>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              disabled={resetPending}
              data-testid="training-detail-reset"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Reset
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-muted text-muted-foreground"
              aria-label="Close"
              data-testid="training-detail-close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {data?.categories.map((cat) => {
            const s = stateByCategory.get(cat.id);
            const level = s?.helpLevel ?? cat.defaultHelpLevel;
            const pinned = s?.pinnedLevel ?? null;
            const graduated = !!s?.graduatedAt;
            return (
              <div
                key={cat.id}
                className="rounded-lg border bg-card p-4"
                data-testid={`training-detail-category-${cat.slug}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold flex items-center gap-2">
                      {cat.title}
                      {cat.highRisk && (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          High risk
                        </span>
                      )}
                      {graduated && (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          Graduated
                        </span>
                      )}
                    </div>
                    {cat.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{cat.description}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${levelBadgeClass(level)}`}
                  >
                    {levelLabel(level)}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <Stat label="Streak" value={s?.successStreak ?? 0} />
                  <Stat label="Failures" value={s?.failures ?? 0} />
                  <Stat label="Total runs" value={s?.totalAttempts ?? 0} />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Last seen {formatRelative(s?.lastSeenAt ?? null)}
                </div>

                <div className="mt-3 flex items-center gap-1 flex-wrap">
                  <span className="text-xs text-muted-foreground mr-1">Pin to:</span>
                  {[0, 1, 2, 3].map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      disabled={pinPending}
                      onClick={() => onPin(cat.id, lvl)}
                      data-testid={`training-pin-${cat.slug}-${lvl}`}
                      className={`text-xs px-2 py-1 rounded border ${
                        pinned === lvl
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      <Pin className="w-3 h-3 inline mr-1" />L{lvl}
                    </button>
                  ))}
                  {pinned !== null && (
                    <button
                      type="button"
                      disabled={pinPending}
                      onClick={() => onPin(cat.id, null)}
                      data-testid={`training-unpin-${cat.slug}`}
                      className="text-xs px-2 py-1 rounded border bg-background hover:bg-muted text-muted-foreground"
                    >
                      <PinOff className="w-3 h-3 inline mr-1" />Unpin
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {data && data.recentEvents.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <div className="font-semibold text-sm mb-2">Recent activity</div>
              <ul className="space-y-1 text-xs">
                {data.recentEvents.slice(0, 15).map((e) => {
                  const cat = data.categories.find((c) => c.id === e.categoryId);
                  return (
                    <li key={e.id} className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span className="truncate">
                        <span className="font-medium text-foreground">{e.type}</span>
                        {cat ? ` · ${cat.title}` : ""} · L{e.helpLevelAtTime}
                      </span>
                      <span className="shrink-0">{formatRelative(e.occurredAt)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-muted/40 px-2 py-1.5 text-center">
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
