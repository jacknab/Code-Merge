import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface NotificationItem {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  staffName: string | null;
  storeId: number | null;
  graduatedAt: string;
}

interface NotificationResponse {
  notifications: NotificationItem[];
}

const POLL_MS = 60_000;

/**
 * Phase 6 — graduation notifier.
 *
 * Polls /api/training/notifications for the signed-in owner/manager. When a
 * staff member fully graduates (every category complete), shows a single
 * celebratory toast and dismisses the notification server-side so it never
 * fires twice.
 */
export function GraduationNotifier() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dismissedRef = useRef<Set<string>>(new Set());

  const role = (user as any)?.role;
  const isManager = role === "owner" || role === "admin" || role === "manager";

  const enabled = !!user && !isLoading && isManager;

  const { data } = useQuery<NotificationResponse>({
    queryKey: ["/api/training/notifications"],
    enabled,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: POLL_MS,
  });

  useEffect(() => {
    if (!data?.notifications?.length) return;
    for (const n of data.notifications) {
      if (dismissedRef.current.has(n.userId)) continue;
      dismissedRef.current.add(n.userId);
      const name =
        [n.firstName, n.lastName].filter(Boolean).join(" ").trim() ||
        n.staffName ||
        n.email;
      toast({
        title: `${name} just graduated training`,
        description:
          "They're flying solo now. The coaching overlays will stay quiet from here on.",
        duration: 8000,
      });
      // Mark on the server so it never fires again, even after a reload.
      apiRequest("POST", "/api/training/notifications/dismiss", { userId: n.userId })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/training/notifications"] });
        })
        .catch(() => {
          // Allow retry on next poll if the dismiss failed.
          dismissedRef.current.delete(n.userId);
        });
    }
  }, [data, toast, queryClient]);

  return null;
}

// Re-export icon so callers don't need a separate import for related UI.
export { GraduationCap };
