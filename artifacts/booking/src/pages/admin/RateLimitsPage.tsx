import { useState } from "react";
import { useLocation } from "react-router-dom";
import { AdminLayout } from "./PlatformAdminLayout";

type Category = "google_login" | "oauth_connect" | "sync_reviews";

interface RateLimitEntry {
  key: string;
  count: number | null;
  windowStartMs: number | null;
  lastActivityMs: number | null;
  expiresInSecs: number;
  blocked: boolean;
}

interface RateLimitSnapshot {
  category: Category;
  label: string;
  windowMs: number;
  maxAttempts: number | null;
  entries: RateLimitEntry[];
}

function fmtSecs(secs: number): string {
  if (secs <= 0) return "expired";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function fmtTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString();
}

function windowLabel(ms: number): string {
  const mins = Math.round(ms / 60000);
  return `${mins} min window`;
}

const CATEGORY_COLORS: Record<Category, { bg: string; border: string; dot: string; text: string }> = {
  google_login:  { bg: "#fef9c3", border: "#fde047", dot: "#ca8a04", text: "#713f12" },
  oauth_connect: { bg: "#dbeafe", border: "#93c5fd", dot: "#2563eb", text: "#1e3a8a" },
  sync_reviews:  { bg: "#f0fdf4", border: "#86efac", dot: "#16a34a", text: "#14532d" },
};

export default function RateLimitsPage() {
  const location = useLocation();
  const [data, setData] = useState<RateLimitSnapshot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/rate-limits", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setLastRefreshed(new Date());
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function clearEntry(category: Category, key: string) {
    const id = `${category}:${key}`;
    setClearing(id);
    try {
      const r = await fetch(`/api/admin/rate-limits/${category}/${encodeURIComponent(key)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e: any) {
      setError(e.message ?? "Failed to clear");
    } finally {
      setClearing(null);
    }
  }

  async function clearAll(category?: Category) {
    setClearing(category ?? "all");
    try {
      const url = category
        ? `/api/admin/rate-limits/clear-all/${category}`
        : "/api/admin/rate-limits/clear-all";
      const r = await fetch(url, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e: any) {
      setError(e.message ?? "Failed to clear");
    } finally {
      setClearing(null);
    }
  }

  const totalBlocked = data?.reduce((acc, s) => acc + s.entries.filter(e => e.blocked).length, 0) ?? 0;
  const totalActive  = data?.reduce((acc, s) => acc + s.entries.length, 0) ?? 0;

  return (
    <AdminLayout currentPath={location.pathname}>
      <div style={{ maxWidth: 900 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111", margin: 0 }}>Rate Limit Monitor</h1>
            <p style={{ color: "#6b7280", fontSize: "0.875rem", marginTop: 4 }}>
              View and reset active in-memory rate limit counters for Google OAuth endpoints.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            {data && (
              <button
                onClick={() => clearAll()}
                disabled={clearing !== null}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "1px solid #fca5a5",
                  background: "#fee2e2", color: "#b91c1c", fontWeight: 600, fontSize: "0.85rem",
                  cursor: "pointer", opacity: clearing !== null ? 0.6 : 1,
                }}
              >
                Clear All
              </button>
            )}
            <button
              onClick={load}
              disabled={loading}
              style={{
                padding: "8px 20px", borderRadius: 8, border: "none",
                background: "#111", color: "#fff", fontWeight: 600, fontSize: "0.85rem",
                cursor: "pointer", opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Loading…" : data ? "Refresh" : "Load"}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#b91c1c", marginBottom: 20, fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        {/* Summary */}
        {data && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 28 }}>
            {[
              { label: "Active Windows", value: totalActive, sub: "entries currently tracked" },
              { label: "Blocked",        value: totalBlocked, sub: "currently rate-limited" },
              { label: "Last Refreshed", value: lastRefreshed ? lastRefreshed.toLocaleTimeString() : "—", sub: "of this snapshot" },
            ].map(card => (
              <div key={card.label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 18px" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111" }}>{card.value}</div>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#374151", marginTop: 2 }}>{card.label}</div>
                <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: 1 }}>{card.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!data && !loading && (
          <div style={{
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
            padding: "48px 32px", textAlign: "center", color: "#6b7280",
          }}>
            <div style={{ fontSize: "2rem", marginBottom: 12 }}>🔒</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No data loaded yet</div>
            <div style={{ fontSize: "0.875rem" }}>Click "Load" to fetch the current rate-limit state from the server.</div>
          </div>
        )}

        {/* Snapshots */}
        {data?.map(snapshot => {
          const colors = CATEGORY_COLORS[snapshot.category];
          return (
            <div key={snapshot.category} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, marginBottom: 18, overflow: "hidden" }}>

              {/* Section header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 20px", borderBottom: snapshot.entries.length ? "1px solid #f3f4f6" : "none",
                background: "#fafafa",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: colors.dot, display: "inline-block" }} />
                  <span style={{ fontWeight: 700, color: "#111", fontSize: "0.95rem" }}>{snapshot.label}</span>
                  <span style={{
                    fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                    background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`,
                  }}>
                    {windowLabel(snapshot.windowMs)}
                    {snapshot.maxAttempts ? ` · max ${snapshot.maxAttempts}` : " · 1 per window"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                    {snapshot.entries.length} active
                  </span>
                  {snapshot.entries.length > 0 && (
                    <button
                      onClick={() => clearAll(snapshot.category)}
                      disabled={clearing !== null}
                      style={{
                        padding: "4px 12px", borderRadius: 6, border: "1px solid #e5e7eb",
                        background: "#fff", color: "#6b7280", fontSize: "0.78rem", fontWeight: 600,
                        cursor: "pointer", opacity: clearing !== null ? 0.5 : 1,
                      }}
                    >
                      Clear group
                    </button>
                  )}
                </div>
              </div>

              {/* Entries */}
              {snapshot.entries.length === 0 ? (
                <div style={{ padding: "16px 20px", color: "#9ca3af", fontSize: "0.85rem" }}>
                  No active entries — all clear.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {[
                        snapshot.category === "google_login" ? "IP Address" : snapshot.category === "oauth_connect" ? "User ID" : "Store ID",
                        snapshot.maxAttempts ? "Attempts" : "Last Sync",
                        "Expires In",
                        "Status",
                        "",
                      ].map((h, i) => (
                        <th key={i} style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #f3f4f6" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.entries.map(entry => {
                      const id = `${snapshot.category}:${entry.key}`;
                      return (
                        <tr key={entry.key} style={{ borderBottom: "1px solid #f9fafb" }}>
                          <td style={{ padding: "10px 16px", fontFamily: "monospace", color: "#374151" }}>{entry.key}</td>
                          <td style={{ padding: "10px 16px", color: "#374151" }}>
                            {entry.count !== null
                              ? `${entry.count} / ${snapshot.maxAttempts ?? "∞"}`
                              : fmtTime(entry.lastActivityMs)}
                          </td>
                          <td style={{ padding: "10px 16px", color: entry.expiresInSecs < 60 ? "#b91c1c" : "#374151" }}>
                            {fmtSecs(entry.expiresInSecs)}
                          </td>
                          <td style={{ padding: "10px 16px" }}>
                            {entry.blocked ? (
                              <span style={{ background: "#fee2e2", color: "#b91c1c", padding: "2px 10px", borderRadius: 20, fontSize: "0.75rem", fontWeight: 700 }}>Blocked</span>
                            ) : (
                              <span style={{ background: "#f0fdf4", color: "#15803d", padding: "2px 10px", borderRadius: 20, fontSize: "0.75rem", fontWeight: 700 }}>Active</span>
                            )}
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right" }}>
                            <button
                              onClick={() => clearEntry(snapshot.category, entry.key)}
                              disabled={clearing === id}
                              style={{
                                padding: "4px 12px", borderRadius: 6, border: "1px solid #e5e7eb",
                                background: "#fff", color: "#374151", fontSize: "0.78rem", fontWeight: 600,
                                cursor: "pointer", opacity: clearing === id ? 0.5 : 1,
                              }}
                            >
                              {clearing === id ? "…" : "Reset"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </AdminLayout>
  );
}
