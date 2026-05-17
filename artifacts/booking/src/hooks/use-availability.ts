import { useQuery } from "@tanstack/react-query";

export type TimeSlot = {
  time: string;
  staffId: number;
  staffName: string;
};

export function useAvailableSlots(
  serviceId: number | null,
  storeId: number | null,
  date: string | null,
  duration: number,
  staffId?: number | null
) {
  return useQuery<TimeSlot[]>({
    queryKey: ["/api/availability/slots", serviceId, storeId, date, duration, staffId],
    enabled: !!serviceId && !!storeId && !!date && duration > 0,
    queryFn: async () => {
      const params = new URLSearchParams({
        serviceId: String(serviceId),
        storeId: String(storeId),
        date: date!,
        duration: String(duration),
      });
      if (staffId) {
        params.set("staffId", String(staffId));
      }
      const res = await fetch(`/api/availability/slots?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch availability");
      return res.json();
    },
  });
}
