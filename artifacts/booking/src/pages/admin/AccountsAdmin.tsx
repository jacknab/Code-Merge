import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { AdminLayout } from "./PlatformAdminLayout";

interface Account {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  createdAt: string;
  subscriptionStatus: string;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  computedStatus: string;
  storeId: number | null;
  storeName: string | null;
  storeCity: string | null;
  storeState: string | null;
  storePhone: string | null;
  storeCategory: string | null;
  accountStatus: string | null;
}

type StatusFilter = "All" | "Active" | "Free Trial" | "Subscriber" | "Expired" | "Inactive";

const STATUS_FILTERS: StatusFilter[] = ["All", "Subscriber", "Free Trial", "Active", "Expired", "Inactive"];

const STATUS_STYLES: Record<string, { bg: string; color: string; dot: string }> = {
  "Subscriber":  { bg: "#dcfce7", color: "#15803d", dot: "#22c55e" },
  "Free Trial":  { bg: "#fef9c3", color: "#854d0e", dot: "#eab308" },
  "Active":      { bg: "#dbeafe", color: "#1d4ed8", dot: "#3b82f6" },
  "Expired":     { bg: "#fee2e2", color: "#b91c1c", dot: "#ef4444" },
  "Inactive":    { bg: "#f3f4f6", color: "#6b7280", dot: "#9ca3af" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES["Active"];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px", borderRadius: 20, fontSize: "0.78rem", fontWeight: 700,
      background: s.bg, color: s.color,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot, display: "inline-block" }} />
      {status}
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function trialDaysLeft(endsAt: string | null) {
  if (!endsAt) return null;
  const diff = new Date(endsAt).getTime() - Date.now();
  const days = Math.ceil(diff / 86400000);
  return days;
}

export default function AccountsAdmin() {
  const location = useLocation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [sortBy, setSortBy] = useState<"createdAt" | "storeName" | "email">("createdAt");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/accounts");
      if (!r.ok) {
        if (r.status === 401) throw new Error("Not authorized — please log in as an admin.");
        throw new Error("Failed to load accounts");
      }
      setAccounts(await r.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    accounts.forEach(a => { if (a.storeCategory) set.add(a.storeCategory); });
    return ["All", ...Array.from(set).sort()];
  }, [accounts]);

  const filtered = useMemo(() => {
    let list = accounts;
    if (statusFilter !== "All") list = list.filter(a => a.computedStatus === statusFilter);
    if (categoryFilter !== "All") list = list.filter(a => a.storeCategory === categoryFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.email.toLowerCase().includes(q) ||
        (a.storeName ?? "").toLowerCase().includes(q) ||
        (a.firstName ?? "").toLowerCase().includes(q) ||
        (a.lastName ?? "").toLowerCase().includes(q) ||
        (a.storeCity ?? "").toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      let av: string, bv: string;
      if (sortBy === "createdAt") { av = a.createdAt ?? ""; bv = b.createdAt ?? ""; }
      else if (sortBy === "storeName") { av = (a.storeName ?? a.email).toLowerCase(); bv = (b.storeName ?? b.email).toLowerCase(); }
      else { av = a.email.toLowerCase(); bv = b.email.toLowerCase(); }
      return sortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
    });
    return list;
  }, [accounts, statusFilter, categoryFilter, search, sortBy, sortDir]);

  const counts = useMemo(() => ({
    total: accounts.length,
    subscriber: accounts.filter(a => a.computedStatus === "Subscriber").length,
    trial: accounts.filter(a => a.computedStatus === "Free Trial").length,
    expired: accounts.filter(a => a.computedStatus === "Expired").length,
    inactive: accounts.filter(a => a.computedStatus === "Inactive").length,
  }), [accounts]);

  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  }

  const SortIcon = ({ col }: { col: typeof sortBy }) =>
    sortBy === col ? <span style={{ marginLeft: 3, opacity: 0.7 }}>{sortDir === "asc" ? "↑" : "↓"}</span> : null;

  return (
    <AdminLayout currentPath={location.pathname}>
      <div style={{ maxWidth: 1200 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 800, margin: 0, color: "#111" }}>Accounts</h1>
            <p style={{ margin: "4px 0 0", color: "#666", fontSize: "0.9rem" }}>
              All registered accounts on the Certxa platform.
            </p>
          </div>
          <button onClick={load} style={{ padding: "9px 18px", borderRadius: 10, border: "1px solid #d1d5db", background: "#f9fafb", color: "#374151", fontWeight: 600, cursor: "pointer", fontSize: "0.88rem" }}>
            ⟳ Refresh
          </button>
        </div>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 28 }}>
          {[
            { label: "Total", value: counts.total, color: "#6366f1" },
            { label: "Subscribers", value: counts.subscriber, color: "#22c55e" },
            { label: "Free Trial", value: counts.trial, color: "#eab308" },
            { label: "Expired", value: counts.expired, color: "#ef4444" },
            { label: "Inactive", value: counts.inactive, color: "#9ca3af" },
          ].map(c => (
            <div key={c.label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px 18px" }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 800, color: c.color, lineHeight: 1 }}>{loading ? "—" : c.value}</div>
              <div style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, city…"
            style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid #d1d5db", fontSize: "0.88rem", outline: "none", width: 260, background: "#fff" }}
          />

          <div style={{ display: "flex", gap: 4, background: "#f3f4f6", borderRadius: 10, padding: 3 }}>
            {STATUS_FILTERS.map(f => (
              <button key={f} onClick={() => setStatusFilter(f)}
                style={{ padding: "6px 14px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer",
                  background: statusFilter === f ? "#fff" : "transparent",
                  color: statusFilter === f ? "#111" : "#6b7280",
                  boxShadow: statusFilter === f ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                }}>
                {f}
              </button>
            ))}
          </div>

          {categories.length > 1 && (
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #d1d5db", fontSize: "0.88rem", background: "#fff", cursor: "pointer", outline: "none" }}>
              <option value="All">All Business Types</option>
              {categories.filter(c => c !== "All").map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}

          {(search || statusFilter !== "All" || categoryFilter !== "All") && (
            <button onClick={() => { setSearch(""); setStatusFilter("All"); setCategoryFilter("All"); }}
              style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", fontSize: "0.82rem", color: "#6b7280", cursor: "pointer", fontWeight: 600 }}>
              Clear filters
            </button>
          )}

          <span style={{ marginLeft: "auto", fontSize: "0.82rem", color: "#9ca3af" }}>
            {loading ? "Loading…" : `${filtered.length.toLocaleString()} account${filtered.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontWeight: 600, fontSize: "0.9rem" }}>
            {error}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", padding: "40px", textAlign: "center", color: "#9ca3af", fontWeight: 600 }}>
            Loading accounts…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", padding: "56px 32px", textAlign: "center" }}>
            <p style={{ fontWeight: 700, color: "#374151", marginBottom: 6 }}>No accounts match your filters</p>
            <p style={{ color: "#9ca3af", fontSize: "0.9rem" }}>Try adjusting your search or filters above.</p>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                <thead>
                  <tr style={{ background: "#fafafa", borderBottom: "1px solid #e5e7eb" }}>
                    <th onClick={() => toggleSort("storeName")} style={thStyle}>
                      Business <SortIcon col="storeName" />
                    </th>
                    <th onClick={() => toggleSort("email")} style={thStyle}>
                      Owner / Email <SortIcon col="email" />
                    </th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Business Type</th>
                    <th style={thStyle}>Location</th>
                    <th onClick={() => toggleSort("createdAt")} style={thStyle}>
                      Joined <SortIcon col="createdAt" />
                    </th>
                    <th style={thStyle}>Trial Ends</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a, i) => {
                    const daysLeft = trialDaysLeft(a.trialEndsAt);
                    const isTrialSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;
                    return (
                      <tr key={a.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                        <td style={tdStyle}>
                          {a.storeName ? (
                            <>
                              <div style={{ fontWeight: 700, color: "#111" }}>{a.storeName}</div>
                              {a.storePhone && <div style={{ fontSize: "0.76rem", color: "#9ca3af" }}>{a.storePhone}</div>}
                            </>
                          ) : (
                            <span style={{ color: "#d1d5db", fontStyle: "italic" }}>No store</span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <div style={{ color: "#374151" }}>
                            {a.firstName || a.lastName ? `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() : null}
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{a.email}</div>
                        </td>
                        <td style={tdStyle}>
                          <StatusBadge status={a.computedStatus} />
                        </td>
                        <td style={tdStyle}>
                          {a.storeCategory ? (
                            <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: "#f3f4f6", color: "#374151", fontSize: "0.78rem", fontWeight: 600 }}>
                              {a.storeCategory}
                            </span>
                          ) : (
                            <span style={{ color: "#d1d5db" }}>—</span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          {a.storeCity ? (
                            <span style={{ color: "#374151" }}>
                              {a.storeCity}{a.storeState ? `, ${a.storeState}` : ""}
                            </span>
                          ) : (
                            <span style={{ color: "#d1d5db" }}>—</span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ color: "#6b7280", fontSize: "0.82rem" }}>{formatDate(a.createdAt)}</span>
                        </td>
                        <td style={tdStyle}>
                          {a.trialEndsAt ? (
                            <div>
                              <div style={{ fontSize: "0.8rem", color: isTrialSoon ? "#b45309" : "#6b7280" }}>
                                {formatDate(a.trialEndsAt)}
                              </div>
                              {daysLeft !== null && daysLeft >= 0 && (
                                <div style={{ fontSize: "0.72rem", color: isTrialSoon ? "#d97706" : "#9ca3af", fontWeight: 600 }}>
                                  {daysLeft === 0 ? "Ends today" : `${daysLeft}d left`}
                                </div>
                              )}
                              {daysLeft !== null && daysLeft < 0 && (
                                <div style={{ fontSize: "0.72rem", color: "#ef4444", fontWeight: 600 }}>Expired</div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: "#d1d5db" }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

const thStyle: React.CSSProperties = {
  padding: "11px 16px", textAlign: "left", fontWeight: 700, fontSize: "0.75rem",
  color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer",
  userSelect: "none", whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  padding: "12px 16px", verticalAlign: "middle",
};
