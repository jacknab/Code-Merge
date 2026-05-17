import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useSelectedStore } from "@/hooks/use-store";
import type { CalendarSettings } from "@shared/schema";

export function useCalendarSettings() {
  const { selectedStore } = useSelectedStore();
  return useQuery<CalendarSettings | null>({
    queryKey: [`/api/calendar-settings?storeId=${selectedStore?.id}`],
    enabled: !!selectedStore?.id,
  });
}

export function useUpdateCalendarSettings() {
  const { selectedStore } = useSelectedStore();
  return useMutation({
    mutationFn: async (data: Partial<CalendarSettings>) => {
      const res = await apiRequest("PUT", "/api/calendar-settings", {
        ...data,
        storeId: selectedStore?.id,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/calendar-settings?storeId=${selectedStore?.id}`] });
    },
  });
}

export const DEFAULT_CALENDAR_SETTINGS = {
  startOfWeek: "monday" as string,
  timeSlotInterval: 15,
  nonWorkingHoursDisplay: 1,
  allowBookingOutsideHours: true,
  autoCompleteAppointments: true,
  autoMarkNoShows: false,
  showPrices: true,
  walkInsEnabled: true,
};
