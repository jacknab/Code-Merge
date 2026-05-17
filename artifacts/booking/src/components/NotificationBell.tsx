import { useRef, useState, useEffect } from "react";
import { Bell, BellDot, X, Trash2 } from "lucide-react";
import { useNotifications, type AppNotification } from "@/hooks/use-notifications";
import { formatDistanceToNow } from "date-fns";

function notifLabel(n: AppNotification): { title: string; body: string } {
  switch (n.type) {
    case "new_booking":
      return {
        title: "New Booking",
        body: `${n.customerName} just booked ${n.serviceName || "a service"}${n.time ? ` at ${n.time}` : ""}`,
      };
    case "payment_received":
      return {
        title: "Payment received",
        body: `$${(n.amount || 0).toFixed(0)} from ${n.customerName}`,
      };
    case "appointment_cancelled":
      return {
        title: "Booking cancelled",
        body: `${n.customerName} cancelled ${n.serviceName || "their appointment"}`,
      };
  }
}

function typeIcon(type: AppNotification["type"]) {
  switch (type) {
    case "new_booking":
      return "🗓️";
    case "payment_received":
      return "💳";
    case "appointment_cancelled":
      return "❌";
  }
}

export function NotificationBell() {
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleOpen = () => {
    setOpen((prev) => !prev);
    if (!open && unreadCount > 0) {
      setTimeout(markAllRead, 600);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="relative p-2 rounded-xl border border-border hover:bg-muted transition-colors mt-1"
        aria-label="Notifications"
      >
        {unreadCount > 0 ? (
          <BellDot className="w-5 h-5 text-violet-500" />
        ) : (
          <Bell className="w-5 h-5 text-muted-foreground" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-violet-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-12 w-80 bg-card border border-border rounded-2xl shadow-xl z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <div className="flex items-center gap-2">
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="p-1 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                  title="Clear all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <Bell className="w-7 h-7 mx-auto mb-2 opacity-30" />
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => {
                const { title, body } = notifLabel(n);
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                      !n.read ? "bg-violet-50 dark:bg-violet-950/20" : "hover:bg-muted/40"
                    }`}
                  >
                    <span className="text-lg mt-0.5 shrink-0">{typeIcon(n.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground leading-tight">{title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{body}</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-1">
                        {formatDistanceToNow(new Date(n.ts), { addSuffix: true })}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="w-2 h-2 rounded-full bg-violet-500 shrink-0 mt-1.5" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
