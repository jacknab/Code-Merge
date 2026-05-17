import { useEffect, useRef, useState, useCallback } from "react";
import { useSelectedStore } from "@/hooks/use-store";

export type AppNotification = {
  id: string;
  ts: number;
  type: "new_booking" | "payment_received" | "appointment_cancelled";
  customerName: string;
  serviceName?: string;
  staffName?: string;
  time?: string;
  amount?: number;
  read: boolean;
};

const MAX_STORED = 50;

function storageKey(storeId: number) {
  return `certxa_notifications_${storeId}`;
}

function loadStored(storeId: number): AppNotification[] {
  try {
    const raw = localStorage.getItem(storageKey(storeId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persist(storeId: number, items: AppNotification[]) {
  try {
    localStorage.setItem(storageKey(storeId), JSON.stringify(items.slice(0, MAX_STORED)));
  } catch {}
}

export function useNotifications() {
  const { selectedStore } = useSelectedStore();
  const storeId = selectedStore?.id;

  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    storeId ? loadStored(storeId) : []
  );

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!storeId) return;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/ws/notifications?storeId=${storeId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const notification: AppNotification = {
          id: data.id || `${Date.now()}`,
          ts: data.ts || Date.now(),
          type: data.type,
          customerName: data.customerName,
          serviceName: data.serviceName,
          staffName: data.staffName,
          time: data.time,
          amount: data.amount,
          read: false,
        };

        setNotifications((prev) => {
          const next = [notification, ...prev].slice(0, MAX_STORED);
          persist(storeId, next);
          return next;
        });
      } catch {}
    };

    ws.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 4000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    setNotifications(loadStored(storeId));
    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [storeId, connect]);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      if (storeId) persist(storeId, next);
      return next;
    });
  }, [storeId]);

  const clearAll = useCallback(() => {
    setNotifications([]);
    if (storeId) persist(storeId, []);
  }, [storeId]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount, markAllRead, clearAll };
}
