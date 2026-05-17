import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { AdminLayout } from "./PlatformAdminLayout";

interface SeoRegion {
  id: number;
  city: string;
  state: string;
  stateCode: string;
  slug: string;
  phone?: string;
  zip?: string;
  product: string;
  businessType?: string;
  businessTypes?: string;
  nearbyCities?: string;
  metaTitle?: string;
  metaDesc?: string;
  h1Override?: string;
  pageGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SeoCity {
  city: string;
  state: string;
  stateCode: string;
  country: "US" | "CA";
  nearbyCities?: string;
}

const PRODUCT_OPTIONS = [
  { value: "booking", label: "Certxa Booking (Appointments)" },
  { value: "queue",   label: "Certxa Queue (Walk-Ins)" },
  { value: "pro",     label: "Certxa Pro (Field Service)" },
];

function slugify(city: string, stateCode: string, businessType?: string, product?: string) {
  const c = city.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const s = stateCode.toLowerCase().replace(/[^a-z]/g, "");
  if (businessType) {
    const bt = businessType.toLowerCase().replace(/&/g, "and").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    return `${c}-${s}-${bt}`;
  }
  const p = product && product !== "all" ? `-${product}` : "";
  return `${c}-${s}${p}`;
}

interface FormState {
  city: string; state: string; stateCode: string; slug: string;
  phone: string; zip: string; product: string;
  businessType: string; nearbyCities: string;
  metaTitle: string; metaDesc: string; h1Override: string;
}

const EMPTY_FORM: FormState = {
  city: "", state: "", stateCode: "", slug: "",
  phone: "", zip: "", product: "booking",
  businessType: "", nearbyCities: "",
  metaTitle: "", metaDesc: "", h1Override: "",
};

export default function SeoRegionsAdmin() {
  const location = useLocation();
  const [tab, setTab] = useState<"pages" | "bulk">("pages");
  const [regions, setRegions] = useState<SeoRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState<number | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const slugManual = useRef(false);

  // Bulk seed state
  const [refCities, setRefCities] = useState<SeoCity[]>([]);
  const [refBusinessTypes, setRefBusinessTypes] = useState<string[]>([]);
  const [selectedCities, setSelectedCities] = useState<Set<string>>(new Set());
  const [selectedBizTypes, setSelectedBizTypes] = useState<Set<string>>(new Set());
  const [bulkPhone, setBulkPhone] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [bulkSeeding, setBulkSeeding] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ created: number; skipped: number; total: number } | null>(null);

  useEffect(() => { loadRegions(); loadRefData(); }, []);

  async function loadRegions() {
    setLoading(true);
    try {
      const r = await fetch("/api/seo-regions");
      setRegions(await r.json());
    } finally { setLoading(false); }
  }

  async function loadRefData() {
    try {
      const r = await fetch("/api/seo-regions/reference-data");
      const data = await r.json();
      setRefCities(data.cities ?? []);
      setRefBusinessTypes(data.bookingBusinessTypes ?? []);
    } catch { /* ignore */ }
  }

  function openNew() {
    setEditId(null); setForm(EMPTY_FORM); slugManual.current = false;
    setError(null); setShowForm(true);
  }

  function openEdit(region: SeoRegion) {
    setEditId(region.id);
    setForm({
      city: region.city, state: region.state, stateCode: region.stateCode, slug: region.slug,
      phone: region.phone ?? "", zip: region.zip ?? "", product: region.product,
      businessType: region.businessType ?? "",
      nearbyCities: region.nearbyCities ?? "",
      metaTitle: region.metaTitle ?? "", metaDesc: region.metaDesc ?? "", h1Override: region.h1Override ?? "",
    });
    slugManual.current = true; setError(null); setShowForm(true);
  }

  function handleField(key: keyof FormState, value: string) {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if ((key === "city" || key === "stateCode" || key === "businessType" || key === "product") && !slugManual.current) {
        const city = key === "city" ? value : prev.city;
        const sc = key === "stateCode" ? value : prev.stateCode;
        const bt = key === "businessType" ? value : prev.businessType;
        const prod = key === "product" ? value : prev.product;
        next.slug = slugify(city, sc, bt || undefined, prod);
      }
      if (key === "slug") slugManual.current = true;
      return next;
    });
  }

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      const payload = {
        city: form.city, state: form.state, stateCode: form.stateCode.toUpperCase(),
        slug: form.slug, phone: form.phone || null, zip: form.zip || null, product: form.product,
        businessType: form.businessType || null,
        nearbyCities: form.nearbyCities || null,
        metaTitle: form.metaTitle || null, metaDesc: form.metaDesc || null, h1Override: form.h1Override || null,
      };
      const url = editId ? `/api/seo-regions/${editId}` : "/api/seo-regions";
      const r = await fetch(url, { method: editId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "Save failed"); }
      setShowForm(false);
      setSuccessMsg(editId ? "Region updated and page regenerated!" : "Region created and page generated!");
      setTimeout(() => setSuccessMsg(null), 4000);
      await loadRegions();
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function handleGenerate(id: number) {
    setGenerating(id);
    try {
      const r = await fetch(`/api/seo-regions/${id}/generate`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSuccessMsg(`Page rebuilt: /regions/${data.slug}.html`);
      setTimeout(() => setSuccessMsg(null), 4000);
      await loadRegions();
    } catch (err: any) { setError(err.message); }
    finally { setGenerating(null); }
  }

  async function handleGenerateAll() {
    setGenerating("all");
    try {
      const r = await fetch("/api/seo-regions/generate-all", { method: "POST" });
      const data = await r.json();
      setSuccessMsg(`Rebuilt ${data.generated} of ${data.total} pages`);
      setTimeout(() => setSuccessMsg(null), 5000);
      await loadRegions();
    } catch (err: any) { setError(err.message); }
    finally { setGenerating(null); }
  }

  async function handleDelete(id: number, city: string) {
    if (!confirm(`Delete the SEO page for ${city}? This cannot be undone.`)) return;
    try { await fetch(`/api/seo-regions/${id}`, { method: "DELETE" }); await loadRegions(); }
    catch (err: any) { setError(err.message); }
  }

  // Bulk seed helpers
  const filteredCities = refCities.filter(c =>
    citySearch === "" ||
    c.city.toLowerCase().includes(citySearch.toLowerCase()) ||
    c.state.toLowerCase().includes(citySearch.toLowerCase()) ||
    c.stateCode.toLowerCase().includes(citySearch.toLowerCase())
  );
  const usCities = filteredCities.filter(c => c.country === "US");
  const caCities = filteredCities.filter(c => c.country === "CA");

  function cityKey(c: SeoCity) { return `${c.city}-${c.stateCode}`; }

  function toggleCity(c: SeoCity) {
    setSelectedCities(prev => {
      const n = new Set(prev);
      if (n.has(cityKey(c))) {
        n.delete(cityKey(c));
      } else {
        n.add(cityKey(c));
      }
      return n;
    });
  }

  function selectAllCities(group: SeoCity[]) {
    setSelectedCities(prev => { const n = new Set(prev); group.forEach(c => n.add(cityKey(c))); return n; });
  }

  function deselectAllCities(group: SeoCity[]) {
    setSelectedCities(prev => { const n = new Set(prev); group.forEach(c => n.delete(cityKey(c))); return n; });
  }

  function toggleBizType(bt: string) {
    setSelectedBizTypes(prev => {
      const n = new Set(prev);
      if (n.has(bt)) {
        n.delete(bt);
      } else {
        n.add(bt);
      }
      return n;
    });
  }

  const bulkTotal = selectedCities.size * selectedBizTypes.size;

  async function handleBulkSeed() {
    if (bulkTotal === 0) return;
    if (!confirm(`This will create up to ${bulkTotal} pages (${selectedCities.size} cities × ${selectedBizTypes.size} business types). Continue?`)) return;
    setBulkSeeding(true); setBulkResult(null); setError(null);
    try {
      const cities = refCities.filter(c => selectedCities.has(cityKey(c)));
      const businessTypes = Array.from(selectedBizTypes);
      const r = await fetch("/api/seo-regions/bulk-seed", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cities, businessTypes, phone: bulkPhone || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Bulk seed failed");
      setBulkResult({ created: data.created, skipped: data.skipped, total: data.total });
      await loadRegions();
    } catch (err: any) { setError(err.message); }
    finally { setBulkSeeding(false); }
  }

  const productLabel: Record<string, string> = { booking: "Booking", queue: "Queue", pro: "Pro", all: "All" };
  const productColor: Record<string, string> = { booking: "#00D4AA", queue: "#F59E0B", pro: "#3B82F6", all: "#a78bfa" };

  return (
    <AdminLayout currentPath={location.pathname}>
      <div style={{ maxWidth: 1100 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 800, margin: 0, color: "#111" }}>SEO Page Builder</h1>
            <p style={{ margin: "4px 0 0", color: "#666", fontSize: "0.9rem" }}>
              Generate static HTML landing pages for every business type in every major city.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {tab === "pages" && (
              <>
                <button onClick={handleGenerateAll} disabled={generating === "all" || regions.length === 0}
                  style={{ padding: "9px 18px", borderRadius: 10, border: "1px solid #d1d5db", background: "#f9fafb", color: "#374151", fontWeight: 600, cursor: "pointer", fontSize: "0.88rem" }}>
                  {generating === "all" ? "Rebuilding…" : "⟳ Rebuild All"}
                </button>
                <button onClick={openNew}
                  style={{ padding: "9px 20px", borderRadius: 10, background: "#111827", color: "#fff", fontWeight: 700, border: "none", cursor: "pointer", fontSize: "0.9rem" }}>
                  + Add Single Page
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "#f3f4f6", borderRadius: 12, padding: 4, width: "fit-content" }}>
          {(["pages", "bulk"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "7px 20px", borderRadius: 9, border: "none", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer",
                background: tab === t ? "#fff" : "transparent",
                color: tab === t ? "#111" : "#6b7280",
                boxShadow: tab === t ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
              }}>
              {t === "pages" ? `Pages (${regions.length})` : "Bulk Generator"}
            </button>
          ))}
        </div>

        {/* Alerts */}
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontWeight: 600, fontSize: "0.9rem" }}>
            {error} <button onClick={() => setError(null)} style={{ float: "right", background: "none", border: "none", cursor: "pointer", color: "#b91c1c" }}>✕</button>
          </div>
        )}
        {successMsg && (
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontWeight: 600, fontSize: "0.9rem" }}>
            ✓ {successMsg}
          </div>
        )}

        {/* ── BULK GENERATOR TAB ────────────────────────────────────── */}
        {tab === "bulk" && (
          <div>
            {bulkResult && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", borderRadius: 12, padding: "16px 20px", marginBottom: 24 }}>
                <strong>Done!</strong> Created {bulkResult.created} new pages, skipped {bulkResult.skipped} duplicates (of {bulkResult.total} combinations).
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

              {/* Business Types */}
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1rem" }}>
                    Business Types <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: "0.85rem" }}>({selectedBizTypes.size} selected)</span>
                  </h3>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setSelectedBizTypes(new Set(refBusinessTypes))}
                      style={{ fontSize: "0.75rem", color: "#6366f1", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                      All
                    </button>
                    <button onClick={() => setSelectedBizTypes(new Set())}
                      style={{ fontSize: "0.75rem", color: "#6b7280", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                      None
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {refBusinessTypes.map(bt => (
                    <label key={bt} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: "0.88rem", color: "#374151", fontWeight: selectedBizTypes.has(bt) ? 700 : 400 }}>
                      <input type="checkbox" checked={selectedBizTypes.has(bt)} onChange={() => toggleBizType(bt)}
                        style={{ width: 16, height: 16, accentColor: "#00D4AA" }} />
                      {bt}
                    </label>
                  ))}
                </div>
              </div>

              {/* Cities */}
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1rem" }}>
                    Cities <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: "0.85rem" }}>({selectedCities.size} selected)</span>
                  </h3>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => selectAllCities(filteredCities)}
                      style={{ fontSize: "0.75rem", color: "#6366f1", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                      All
                    </button>
                    <button onClick={() => deselectAllCities(refCities)}
                      style={{ fontSize: "0.75rem", color: "#6b7280", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                      None
                    </button>
                  </div>
                </div>
                <input value={citySearch} onChange={e => setCitySearch(e.target.value)}
                  placeholder="Search cities…" style={{ ...inputStyle, marginBottom: 14 }} />

                {/* US Cities */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9ca3af" }}>
                      United States ({usCities.length})
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => selectAllCities(usCities)} style={{ fontSize: "0.72rem", color: "#6366f1", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Select all US</button>
                      <button onClick={() => deselectAllCities(usCities)} style={{ fontSize: "0.72rem", color: "#6b7280", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Clear</button>
                    </div>
                  </div>
                  <div style={{ maxHeight: 220, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                    {usCities.map(c => (
                      <label key={cityKey(c)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.8rem", color: "#374151", padding: "2px 0", fontWeight: selectedCities.has(cityKey(c)) ? 700 : 400 }}>
                        <input type="checkbox" checked={selectedCities.has(cityKey(c))} onChange={() => toggleCity(c)}
                          style={{ width: 14, height: 14, accentColor: "#00D4AA" }} />
                        {c.city}, {c.stateCode}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Canadian Cities */}
                {caCities.length > 0 && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9ca3af" }}>
                        Canada ({caCities.length})
                      </span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => selectAllCities(caCities)} style={{ fontSize: "0.72rem", color: "#6366f1", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Select all CA</button>
                        <button onClick={() => deselectAllCities(caCities)} style={{ fontSize: "0.72rem", color: "#6b7280", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Clear</button>
                      </div>
                    </div>
                    <div style={{ maxHeight: 140, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                      {caCities.map(c => (
                        <label key={cityKey(c)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.8rem", color: "#374151", padding: "2px 0", fontWeight: selectedCities.has(cityKey(c)) ? 700 : 400 }}>
                          <input type="checkbox" checked={selectedCities.has(cityKey(c))} onChange={() => toggleCity(c)}
                            style={{ width: 14, height: 14, accentColor: "#00D4AA" }} />
                          {c.city}, {c.stateCode}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Generate controls */}
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 24, marginTop: 20 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: "0 0 280px" }}>
                  <label style={labelStyle}>Phone Number (optional — appears on all generated pages)</label>
                  <input value={bulkPhone} onChange={e => setBulkPhone(e.target.value)}
                    placeholder="(555) 000-0000" style={inputStyle} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: "0.82rem", color: "#6b7280", marginBottom: 8 }}>
                    {bulkTotal > 0
                      ? <><strong style={{ color: "#111" }}>{bulkTotal.toLocaleString()} pages</strong> will be created ({selectedCities.size} cities × {selectedBizTypes.size} business types). Duplicates are skipped automatically.</>
                      : "Select cities and business types above to see your page count."}
                  </div>
                  <button onClick={handleBulkSeed} disabled={bulkSeeding || bulkTotal === 0}
                    style={{ padding: "11px 32px", borderRadius: 12, background: bulkTotal === 0 ? "#e5e7eb" : "#111827", color: bulkTotal === 0 ? "#9ca3af" : "#fff",
                      fontWeight: 800, border: "none", cursor: bulkTotal === 0 ? "not-allowed" : "pointer", fontSize: "0.95rem" }}>
                    {bulkSeeding ? `Generating ${bulkTotal.toLocaleString()} pages…` : `⚡ Generate ${bulkTotal > 0 ? bulkTotal.toLocaleString() + " " : ""}Pages`}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 20, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 12, padding: "16px 20px", fontSize: "0.88rem", color: "#0c4a6e", lineHeight: 1.8 }}>
              <strong style={{ color: "#0369a1" }}>How bulk generation works:</strong> Each city × business type combination becomes its own standalone HTML page at <code>/regions/dallas-tx-hair-salons.html</code>. Each page has unique content — its own title, meta description, H1, H2 sections, FAQ, and JSON-LD structured data — written specifically for that business type. Google indexes each page separately, giving you broad keyword coverage across hundreds of local search terms. Existing pages are never overwritten; only new combinations are created.
            </div>
          </div>
        )}

        {/* ── PAGES TAB ────────────────────────────────────────────── */}
        {tab === "pages" && (
          <>
            {/* Form Modal */}
            {showForm && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: "100%", maxWidth: 680, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.25)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800 }}>{editId ? "Edit Page" : "Add Single Page"}</h2>
                    <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", fontSize: "1.4rem", cursor: "pointer", color: "#9ca3af" }}>✕</button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <FormField label="City *" value={form.city} onChange={v => handleField("city", v)} placeholder="Dallas" />
                    <FormField label="State (full name) *" value={form.state} onChange={v => handleField("state", v)} placeholder="Texas" />
                    <FormField label="State Code *" value={form.stateCode} onChange={v => handleField("stateCode", v)} placeholder="TX" maxLength={10} />
                    <FormField label="Phone Number" value={form.phone} onChange={v => handleField("phone", v)} placeholder="(214) 555-0100" />
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <label style={labelStyle}>Business Type (for targeted page)</label>
                    <input value={form.businessType} onChange={e => handleField("businessType", e.target.value)}
                      placeholder="Hair Salons" style={inputStyle} list="bt-list" />
                    <datalist id="bt-list">
                      {["Hair Salons","Barber Shops","Nail Salons","Spas & Massage","Estheticians","Tattoo Studios","Pet Groomers","Personal Trainers","Yoga Studios","Pilates Studios","Lash Studios","Eyebrow & Threading","Medical Aesthetics","Physical Therapy","Chiropractic Offices","Dance Studios","Tutoring Services","Dental Offices"].map(bt => (
                        <option key={bt} value={bt} />
                      ))}
                    </datalist>
                    <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#9ca3af" }}>Leave blank for a general product landing page. Use Bulk Generator for many cities at once.</p>
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <label style={labelStyle}>URL Slug *</label>
                      <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>/regions/<strong>{form.slug}</strong>.html</span>
                    </div>
                    <input value={form.slug} onChange={e => handleField("slug", e.target.value)}
                      placeholder="dallas-tx-hair-salons" style={{ ...inputStyle, fontFamily: "monospace" }} />
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      <FormField label="ZIP Code" value={form.zip} onChange={v => handleField("zip", v)} placeholder="75201" />
                      <div>
                        <label style={labelStyle}>Product</label>
                        <select value={form.product} onChange={e => handleField("product", e.target.value)} style={inputStyle as any}>
                          {PRODUCT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <label style={labelStyle}>Nearby Cities (comma separated — boosts long-tail keywords)</label>
                    <textarea value={form.nearbyCities} onChange={e => handleField("nearbyCities", e.target.value)}
                      rows={2} placeholder="Plano, Frisco, Arlington, Fort Worth, Irving…" style={{ ...inputStyle, resize: "vertical" } as any} />
                  </div>

                  <details style={{ marginTop: 20 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: "0.88rem", color: "#6366f1" }}>⚙ Advanced SEO Overrides (optional)</summary>
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                      <FormField label="Custom Meta Title" value={form.metaTitle} onChange={v => handleField("metaTitle", v)} placeholder="Leave blank to auto-generate" />
                      <div>
                        <label style={labelStyle}>Custom Meta Description</label>
                        <textarea value={form.metaDesc} onChange={e => handleField("metaDesc", e.target.value)} rows={3}
                          placeholder="Leave blank to auto-generate" style={{ ...inputStyle, resize: "vertical" } as any} />
                      </div>
                      <FormField label="Custom H1 Override" value={form.h1Override} onChange={v => handleField("h1Override", v)} placeholder="Leave blank to auto-generate" />
                    </div>
                  </details>

                  {error && (
                    <div style={{ marginTop: 16, color: "#b91c1c", fontWeight: 600, fontSize: "0.88rem", background: "#fef2f2", padding: "10px 14px", borderRadius: 8 }}>
                      {error}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 28 }}>
                    <button onClick={() => setShowForm(false)} style={{ padding: "10px 22px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#f9fafb", fontWeight: 600, cursor: "pointer" }}>
                      Cancel
                    </button>
                    <button onClick={handleSave} disabled={saving || !form.city || !form.state || !form.stateCode || !form.slug}
                      style={{ padding: "10px 28px", borderRadius: 10, background: "#111827", color: "#fff", fontWeight: 700, border: "none", cursor: "pointer" }}>
                      {saving ? "Saving…" : editId ? "Save & Rebuild Page" : "Create & Generate Page"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Table */}
            {loading ? (
              <p style={{ color: "#9ca3af" }}>Loading…</p>
            ) : regions.length === 0 ? (
              <div style={{ background: "#f9fafb", border: "2px dashed #e5e7eb", borderRadius: 16, padding: "56px 32px", textAlign: "center" }}>
                <p style={{ fontSize: "1.1rem", fontWeight: 700, color: "#374151", margin: "0 0 8px" }}>No pages yet</p>
                <p style={{ color: "#9ca3af", marginBottom: 20, fontSize: "0.9rem" }}>Use the Bulk Generator to create pages for all your cities and business types at once.</p>
                <button onClick={() => setTab("bulk")} style={{ padding: "10px 24px", background: "#111827", color: "#fff", borderRadius: 10, border: "none", fontWeight: 700, cursor: "pointer" }}>
                  Open Bulk Generator →
                </button>
              </div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", background: "#fafafa", fontSize: "0.82rem", color: "#6b7280" }}>
                  {regions.length.toLocaleString()} pages · {regions.filter(r => r.pageGenerated).length} live · {regions.filter(r => !r.pageGenerated).length} pending
                </div>
                <div style={{ maxHeight: 600, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                    <thead style={{ position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
                      <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                        <th style={thStyle}>City / State</th>
                        <th style={thStyle}>Business Type</th>
                        <th style={thStyle}>URL</th>
                        <th style={thStyle}>Status</th>
                        <th style={thStyle}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regions.map((r, i) => (
                        <tr key={r.id} style={{ borderBottom: i < regions.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 700, color: "#111" }}>{r.city}</div>
                            <div style={{ color: "#9ca3af", fontSize: "0.78rem" }}>{r.stateCode}</div>
                          </td>
                          <td style={tdStyle}>
                            {r.businessType ? (
                              <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: "#00D4AA18", color: "#00A882", fontSize: "0.78rem", fontWeight: 700 }}>
                                {r.businessType}
                              </span>
                            ) : (
                              <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: `${productColor[r.product]}18`, color: productColor[r.product], fontSize: "0.78rem", fontWeight: 700 }}>
                                {productLabel[r.product] ?? r.product}
                              </span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            <a href={`/regions/${r.slug}.html`} target="_blank" rel="noreferrer"
                              style={{ color: "#6366f1", fontFamily: "monospace", fontSize: "0.78rem" }}>
                              /{r.slug}.html ↗
                            </a>
                          </td>
                          <td style={tdStyle}>
                            {r.pageGenerated
                              ? <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.78rem" }}>✓ Live</span>
                              : <span style={{ color: "#dc2626", fontWeight: 700, fontSize: "0.78rem" }}>✗ Pending</span>}
                          </td>
                          <td style={tdStyle}>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => handleGenerate(r.id)} disabled={generating === r.id} title="Rebuild"
                                style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600 }}>
                                {generating === r.id ? "…" : "⟳"}
                              </button>
                              <button onClick={() => openEdit(r)}
                                style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid #e5e7eb", background: "#f9fafb", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600 }}>
                                Edit
                              </button>
                              <button onClick={() => handleDelete(r.id, r.city)}
                                style={{ padding: "4px 8px", borderRadius: 7, border: "1px solid #fee2e2", background: "#fff5f5", color: "#dc2626", cursor: "pointer", fontSize: "0.78rem" }}>
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

function FormField({ label, value, onChange, placeholder, maxLength }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} style={inputStyle} />
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#374151", marginBottom: 5,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid #d1d5db",
  fontSize: "0.9rem", outline: "none", fontFamily: "inherit",
  background: "#fff", boxSizing: "border-box",
};
const thStyle: React.CSSProperties = {
  padding: "11px 14px", textAlign: "left", fontWeight: 700, fontSize: "0.75rem",
  color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em",
};
const tdStyle: React.CSSProperties = {
  padding: "11px 14px", verticalAlign: "middle",
};
