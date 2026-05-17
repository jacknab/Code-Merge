import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { InsertAppointment } from "@shared/schema";
import { useSelectedStore } from "@/hooks/use-store";
import { storeLocalToUtc } from "@/lib/timezone";

type AppointmentFilters = {
  from?: string;
  to?: string;
  staffId?: number;
};

export function useAppointments(filters?: AppointmentFilters) {
  const { selectedStore } = useSelectedStore();
  const storeId = selectedStore?.id;

  const queryKey = [api.appointments.list.path, storeId, filters];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (storeId) params.append("storeId", String(storeId));
      if (filters?.from) params.append("from", filters.from);
      if (filters?.to) params.append("to", filters.to);
      if (filters?.staffId) params.append("staffId", String(filters.staffId));
      const url = `${api.appointments.list.path}?${params.toString()}`;

      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch appointments");
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!storeId,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 5 * 60 * 1000, // Poll every 5 minutes for new bookings
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();
  const { selectedStore } = useSelectedStore();

  return useMutation({
    mutationFn: async (data: Partial<InsertAppointment> & { date: string; serviceId: number; staffId: number; customerId: number; duration: number }) => {
      let dateStr: string = String(data.date);
      if (!dateStr.endsWith("Z") && !dateStr.match(/[+-]\d{2}:\d{2}$/)) {
        const timezone = selectedStore?.timezone || "UTC";
        const utcDate = storeLocalToUtc(dateStr, timezone);
        dateStr = utcDate.toISOString();
      }

      const { date: _date, ...rest } = data;
      const payload = {
        ...rest,
        storeId: selectedStore?.id ?? null,
        date: dateStr,
      };

      const res = await fetch(api.appointments.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to create appointment");
      return res.json();
    },
    onSuccess: () => {
      // Invalidate all appointment queries for this store
      queryClient.invalidateQueries({ 
        queryKey: [api.appointments.list.path],
        refetchType: 'active'
      });
    },
  });
}

export function useUpdateAppointment() {
  const queryClient = useQueryClient();
  const { selectedStore } = useSelectedStore();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertAppointment>) => {
      const url = buildUrl(api.appointments.update.path, { id });
      const payload = { ...updates };
      if (payload.date) {
        const dateVal = String(payload.date);
        if (!dateVal.endsWith("Z") && !dateVal.match(/[+-]\d{2}:\d{2}$/)) {
          const timezone = selectedStore?.timezone || "UTC";
          const utcDate = storeLocalToUtc(dateVal, timezone);
          payload.date = utcDate.toISOString() as any;
        }
      }

      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update appointment");
      return res.json();
    },
    onSuccess: () => {
      // Invalidate all appointment queries for this store
      queryClient.invalidateQueries({ 
        queryKey: [api.appointments.list.path],
        refetchType: 'active'
      });
    },
  });
}
