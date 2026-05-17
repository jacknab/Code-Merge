import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

export type NotificationEvent =
  | { type: "new_booking"; storeId: number; customerName: string; serviceName: string; staffName?: string; time: string }
  | { type: "payment_received"; storeId: number; customerName: string; amount: number }
  | { type: "appointment_cancelled"; storeId: number; customerName: string; serviceName: string };

const storeClients = new Map<number, Set<WebSocket>>();

export function setupNotificationServer(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/notifications" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", `http://localhost`);
    const storeId = Number(url.searchParams.get("storeId"));
    if (!storeId || isNaN(storeId)) {
      ws.close(1008, "storeId required");
      return;
    }

    if (!storeClients.has(storeId)) {
      storeClients.set(storeId, new Set());
    }
    storeClients.get(storeId)!.add(ws);

    ws.on("close", () => {
      storeClients.get(storeId)?.delete(ws);
      if (storeClients.get(storeId)?.size === 0) {
        storeClients.delete(storeId);
      }
    });

    ws.on("error", () => {
      storeClients.get(storeId)?.delete(ws);
    });
  });
}

export function broadcastNotification(event: NotificationEvent) {
  const clients = storeClients.get(event.storeId);
  if (!clients || clients.size === 0) return;

  const payload = JSON.stringify({ ...event, id: `${Date.now()}-${Math.random()}`, ts: Date.now() });
  for (const ws of Array.from(clients)) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}
