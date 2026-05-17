import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { useSelectedStore } from "@/hooks/use-store";
import { Building2, TrendingUp, Users, Calendar, DollarSign, BarChart3 } from "lucide-react";
import { format } from "date-fns";

type LocationSummary = {
  id: number;
  name: string;
  city?: string;
  state?: string;
  revenue: number;
  bookings: number;
  clients: number;
  fillRate: number;
};

export default function MultiLocationDashboard() {
  const { user } = useAuth();

  const { data: stores = [], isLoading: storesLoading } = useQuery<any[]>({
    queryKey: ["/api/stores"],
    queryFn: async () => {
      const res = await fetch("/api/stores");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: summaries = [], isLoading: summaryLoading } = useQuery<LocationSummary[]>({
    queryKey: ["/api/multi-location/summary"],
    queryFn: async () => {
      const res = await fetch("/api/multi-location/summary");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: stores.length > 0,
  });

  const isLoading = storesLoading || summaryLoading;

  const totalRevenue = summaries.reduce((s, l) => s + l.revenue, 0);
  const totalBookings = summaries.reduce((s, l) => s + l.bookings, 0);
  const totalClients = summaries.reduce((s, l) => s + l.clients, 0);
  const avgFillRate = summaries.length > 0
    ? summaries.reduce((s, l) => s + l.fillRate, 0) / summaries.length
    : 0;

  if (stores.length <= 1) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Building2 className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Multi-Location Dashboard</h1>
            <p className="text-muted-foreground text-sm">Aggregate KPIs across all your locations</p>
          </div>
        </div>
        <div className="text-center py-20 border-2 border-dashed rounded-xl">
          <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-1">Only one location found</h3>
          <p className="text-muted-foreground text-sm">Add more locations to use the multi-location dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Building2 className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Multi-Location Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            {stores.length} locations · {format(new Date(), "MMMM yyyy")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Revenue", value: `$${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 0 })}`, icon: DollarSign, color: "text-green-600 bg-green-50" },
          { label: "Total Bookings", value: totalBookings.toLocaleString(), icon: Calendar, color: "text-blue-600 bg-blue-50" },
          { label: "Total Clients", value: totalClients.toLocaleString(), icon: Users, color: "text-purple-600 bg-purple-50" },
          { label: "Avg Fill Rate", value: `${Math.round(avgFillRate)}%`, icon: TrendingUp, color: "text-amber-600 bg-amber-50" },
        ].map((stat) => (
          <div key={stat.label} className="border rounded-xl p-4 bg-card">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 ${stat.color}`}>
              <stat.icon className="w-5 h-5" />
            </div>
            <div className="text-2xl font-bold mb-1">{isLoading ? "–" : stat.value}</div>
            <div className="text-xs text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="border rounded-xl overflow-hidden bg-card">
        <div className="px-6 py-4 border-b flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Per-Location Breakdown</h2>
        </div>
        <div className="divide-y">
          {isLoading ? (
            <div className="text-center py-10 text-muted-foreground text-sm">Loading…</div>
          ) : summaries.length === 0 ? (
            stores.map((store) => (
              <div key={store.id} className="px-6 py-4 flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{store.name}</div>
                  <div className="text-xs text-muted-foreground">{store.city || store.address || "No address"}</div>
                </div>
                <div className="grid grid-cols-4 gap-8 text-right">
                  <div>
                    <div className="text-sm font-semibold">$0</div>
                    <div className="text-xs text-muted-foreground">Revenue</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">0</div>
                    <div className="text-xs text-muted-foreground">Bookings</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">0</div>
                    <div className="text-xs text-muted-foreground">Clients</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">—</div>
                    <div className="text-xs text-muted-foreground">Fill Rate</div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            summaries.map((loc) => (
              <div key={loc.id} className="px-6 py-4 flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{loc.name}</div>
                  <div className="text-xs text-muted-foreground">{loc.city || "—"}{loc.state ? `, ${loc.state}` : ""}</div>
                </div>
                <div className="grid grid-cols-4 gap-8 text-right">
                  <div>
                    <div className="text-sm font-semibold">${loc.revenue.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Revenue</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{loc.bookings.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Bookings</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{loc.clients.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Clients</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{loc.fillRate}%</div>
                    <div className="text-xs text-muted-foreground">Fill Rate</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
