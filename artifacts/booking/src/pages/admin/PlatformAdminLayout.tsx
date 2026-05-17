import React from 'react';

const NAV_ITEMS = [
  { label: "Dashboard",    href: "/admin",                icon: "⊞" },
  { label: "Accounts",     href: "/admin/accounts",       icon: "👥" },
  { label: "SEO Pages",    href: "/admin/seo-regions",    icon: "🔍" },
  { label: "Rate Limits",  href: "/admin/rate-limits",    icon: "🔒" },
  { label: "DB Health",    href: "/admin/db-health",      icon: "🗄️" },
];

interface AdminLayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children, currentPath }) => {
  const active = currentPath ?? (typeof window !== "undefined" ? window.location.pathname : "");

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f3f4f6" }}>
      {/* Sidebar */}
      <div style={{
        width: 220, background: "#fff", borderRight: "1px solid #e5e7eb",
        display: "flex", flexDirection: "column", flexShrink: 0,
        position: "sticky", top: 0, height: "100vh", overflowY: "auto",
      }}>
        {/* Logo / brand */}
        <div style={{ padding: "22px 20px 16px", borderBottom: "1px solid #f3f4f6" }}>
          <div style={{ fontWeight: 900, fontSize: "1.15rem", color: "#111", letterSpacing: "-0.5px" }}>
            Certxa
          </div>
          <div style={{ fontSize: "0.72rem", color: "#9ca3af", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>
            Admin
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: "12px 10px", flex: 1 }}>
          {NAV_ITEMS.map(item => {
            const isActive = active === item.href || (item.href !== "/admin" && active.startsWith(item.href));
            return (
              <a
                key={item.href}
                href={item.href}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 12px", borderRadius: 9, marginBottom: 2,
                  textDecoration: "none", fontSize: "0.875rem", fontWeight: isActive ? 700 : 500,
                  background: isActive ? "#f0fdf4" : "transparent",
                  color: isActive ? "#15803d" : "#374151",
                  borderLeft: isActive ? "3px solid #22c55e" : "3px solid transparent",
                  transition: "all 0.1s",
                }}
              >
                <span style={{ fontSize: "1rem", lineHeight: 1 }}>{item.icon}</span>
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{ padding: "12px 10px", borderTop: "1px solid #f3f4f6" }}>
          <a
            href="/"
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 9,
              textDecoration: "none", fontSize: "0.83rem", fontWeight: 500,
              color: "#9ca3af",
            }}
          >
            ← Back to app
          </a>
        </div>
      </div>

      {/* Main */}
      <main style={{ flex: 1, padding: "36px 40px", minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
};
