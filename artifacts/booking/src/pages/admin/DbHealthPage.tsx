import { useState } from "react";
import { useLocation } from "react-router-dom";
import { AdminLayout } from "./PlatformAdminLayout";

interface ColumnCheck {
  column: string;
  exists: boolean;
}

interface TableCheck {
  table: string;
  exists: boolean;
  columns: ColumnCheck[];
  rowCount: number | null;
}

interface DbHealthResponse {
  checkedAt: string;
  tables: TableCheck[];
  summary: {
    total: number;
    ok: number;
    missing: number;
    missingColumns: number;
  };
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: "inline-block", width: 9, height: 9, borderRadius: "50%",
      background: ok ? "#22c55e" : "#ef4444", flexShrink: 0,
    }} />
  );
}

function Badge({ ok, label }: { ok: boolean; label?: string }) {
  const text = label ?? (ok ? "OK" : "Missing");
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 10px", borderRadius: 20, fontSize: "0.75rem", fontWeight: 700,
      background: ok ? "#f0fdf4" : "#fee2e2",
      color: ok ? "#15803d" : "#b91c1c",
    }}>
      <StatusDot ok={ok} />
      {text}
    </span>
  );
}

function fmt(n: number | null) {
  if (n === null) return "—";
  return n.toLocaleString();
}

export default function DbHealthPage() {
  const location = useLocation();
  const [data, setData] = useState<DbHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/db-health", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setData(json);
      // Auto-expand any tables with issues
      const issues = new Set<string>(
        json.tables
          .filter((t: TableCheck) => !t.exists || t.columns.some((c: ColumnCheck) => !c.exists))
          .map((t: TableCheck) => t.table)
      );
      setExpanded(issues);
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  function toggle(table: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(table)) {
        next.delete(table);
      } else {
        next.add(table);
      }
      return next;
    });
  }

  function expandAll() {
    if (!data) return;
    setExpanded(new Set(data.tables.map(t => t.table)));
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  const { summary } = data ?? { summary: { total: 0, ok: 0, missing: 0, missingColumns: 0 } };
  const allOk = data && summary.missing === 0 && summary.missingColumns === 0;

  return (
    <AdminLayout currentPath={location.pathname}>
      <div style={{ maxWidth: 900 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111", margin: 0 }}>
              Database Health
            </h1>
            <p style={{ color: "#6b7280", fontSize: "0.875rem", marginTop: 4 }}>
              Checks that all required tables and columns exist in the database.
              Run this after deploying a migration to confirm it applied correctly.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            {data && (
              <>
                <button onClick={expandAll} style={ghostBtn}>Expand all</button>
                <button onClick={collapseAll} style={ghostBtn}>Collapse all</button>
              </>
            )}
            <button
              onClick={load}
              disabled={loading}
              style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontWeight: 600, fontSize: "0.85rem", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "Checking…" : data ? "Re-check" : "Run check"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#b91c1c", marginBottom: 20, fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        {/* Empty state */}
        {!data && !loading && (
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "56px 32px", textAlign: "center", color: "#6b7280" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 14 }}>🗄️</div>
            <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 6 }}>No check run yet</div>
            <div style={{ fontSize: "0.875rem" }}>Click "Run check" to verify all database tables and columns.</div>
          </div>
        )}

        {/* Summary cards */}
        {data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
              {[
                { label: "Tables checked", value: summary.total, color: "#374151" },
                { label: "Tables OK", value: summary.ok, color: "#15803d" },
                { label: "Tables missing", value: summary.missing, color: summary.missing > 0 ? "#b91c1c" : "#15803d" },
                { label: "Columns missing", value: summary.missingColumns, color: summary.missingColumns > 0 ? "#b91c1c" : "#15803d" },
              ].map(card => (
                <div key={card.label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ fontSize: "1.6rem", fontWeight: 800, color: card.color }}>{card.value}</div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#6b7280", marginTop: 2 }}>{card.label}</div>
                </div>
              ))}
            </div>

            {/* All-clear banner */}
            {allOk && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "14px 20px", marginBottom: 22, display: "flex", alignItems: "center", gap: 12, color: "#15803d", fontWeight: 600 }}>
                <span style={{ fontSize: "1.25rem" }}>✅</span>
                All {summary.total} tables and their columns exist. Your VPS database is in sync.
              </div>
            )}

            {/* Checked at */}
            <div style={{ fontSize: "0.78rem", color: "#9ca3af", marginBottom: 16 }}>
              Checked at {new Date(data.checkedAt).toLocaleString()}
            </div>

            {/* Table list */}
            {data.tables.map(t => {
              const isOpen = expanded.has(t.table);
              const missingCols = t.columns.filter(c => !c.exists);
              const hasIssue = !t.exists || missingCols.length > 0;
              return (
                <div key={t.table} style={{ background: "#fff", border: `1px solid ${hasIssue ? "#fca5a5" : "#e5e7eb"}`, borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
                  <button
                    onClick={() => toggle(t.table)}
                    style={{ width: "100%", background: "none", border: "none", padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left" }}
                  >
                    <StatusDot ok={!hasIssue} />
                    <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "0.9rem", color: "#111", flex: 1 }}>
                      {t.table}
                    </span>
                    {t.exists && t.rowCount !== null && (
                      <span style={{ fontSize: "0.78rem", color: "#9ca3af", marginRight: 8 }}>
                        {fmt(t.rowCount)} rows
                      </span>
                    )}
                    {!t.exists && <Badge ok={false} label="Table missing" />}
                    {t.exists && missingCols.length > 0 && (
                      <Badge ok={false} label={`${missingCols.length} col${missingCols.length > 1 ? "s" : ""} missing`} />
                    )}
                    {!hasIssue && <Badge ok label="OK" />}
                    <span style={{ color: "#9ca3af", fontSize: "0.8rem", marginLeft: 4 }}>{isOpen ? "▲" : "▼"}</span>
                  </button>

                  {isOpen && t.exists && t.columns.length > 0 && (
                    <div style={{ borderTop: "1px solid #f3f4f6", padding: "10px 18px 14px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {t.columns.map(col => (
                          <span
                            key={col.column}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              padding: "3px 10px", borderRadius: 6, fontSize: "0.78rem", fontWeight: 600,
                              fontFamily: "monospace",
                              background: col.exists ? "#f9fafb" : "#fee2e2",
                              color: col.exists ? "#374151" : "#b91c1c",
                              border: `1px solid ${col.exists ? "#e5e7eb" : "#fca5a5"}`,
                            }}
                          >
                            <StatusDot ok={col.exists} />
                            {col.column}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {isOpen && !t.exists && (
                    <div style={{ borderTop: "1px solid #fee2e2", padding: "12px 18px", background: "#fff5f5" }}>
                      <div style={{ fontSize: "0.85rem", color: "#b91c1c" }}>
                        This table does not exist in the database. Run migration <code style={{ background: "#fee2e2", padding: "1px 4px", borderRadius: 4 }}>0011_vps_schema_sync.sql</code> to create it.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb",
  background: "#fff", color: "#374151", fontWeight: 600, fontSize: "0.85rem",
  cursor: "pointer",
};
