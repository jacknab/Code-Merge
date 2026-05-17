import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useSelectedStore } from "@/hooks/use-store";
import { useAppointments, useUpdateAppointment } from "@/hooks/use-appointments";
import { useStaffList } from "@/hooks/use-staff";
import { useCalendarSettings, DEFAULT_CALENDAR_SETTINGS } from "@/hooks/use-calendar-settings";
import { useQueryClient } from "@tanstack/react-query";
import { MobileCalendarView } from "@/components/MobileCalendarView";
import { PERMISSIONS } from "@shared/permissions";
import { getNowInTimezone, toStoreLocal, formatInTz } from "@/lib/timezone";
import { addDays, subDays, isSameDay } from "date-fns";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Users,
  Menu as MenuIcon,
  LogOut,
  Phone,
  Mail,
  Clock,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Play,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Constants ───────────────────────────────────────────────────────────────

const HOUR_HEIGHT = 180; // must match Calendar.tsx / MobileCalendarView expectations

// ─── useCurrentTimeLine ───────────────────────────────────────────────────────

function useCurrentTimeLine(timezone: string, startHour: number, endHour: number) {
  const [position, setPosition] = useState<number | null>(null);
  const [timeLabel, setTimeLabel] = useState("");

  const update = useCallback(() => {
    const now = getNowInTimezone(timezone);
    const totalMins = now.getHours() * 60 + now.getMinutes();
    const startMins = startHour * 60;
    const endMins = endHour * 60;
    if (totalMins < startMins || totalMins > endMins) {
      setPosition(null);
      setTimeLabel("");
      return;
    }
    setPosition((totalMins - startMins) * (HOUR_HEIGHT / 60));
    const h = now.getHours();
    const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
    setTimeLabel(`${dh}:${String(now.getMinutes()).padStart(2, "0")}`);
  }, [timezone, startHour, endHour]);

  useEffect(() => {
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [update]);

  return { position, timeLabel };
}

// ─── Status badge config ──────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  confirmed: { label: "Confirmed",   color: "text-blue-700",  bg: "bg-blue-50"   },
  started:   { label: "In Progress", color: "text-amber-700", bg: "bg-amber-50"  },
  completed: { label: "Completed",   color: "text-green-700", bg: "bg-green-50"  },
  cancelled: { label: "Cancelled",   color: "text-red-700",   bg: "bg-red-50"    },
  no_show:   { label: "No Show",     color: "text-gray-600",  bg: "bg-gray-100"  },
};

// ─── StaffCalendar ────────────────────────────────────────────────────────────

export default function StaffCalendar() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const { can } = usePermissions();
  const { selectedStore } = useSelectedStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const staffId = user?.staffId as number | undefined;
  const timezone = selectedStore?.timezone ?? "UTC";
  const lateGracePeriodMinutes = (selectedStore as any)?.lateGracePeriodMinutes ?? 10;
  const storeNow = getNowInTimezone(timezone);

  // ── Permissions ────────────────────────────────────────────────────────────
  const canViewAll     = can(PERMISSIONS.APPOINTMENTS_VIEW_ALL);
  const canEdit        = can(PERMISSIONS.APPOINTMENTS_EDIT);
  const canCancel      = can(PERMISSIONS.APPOINTMENTS_CANCEL);
  const canViewClients = can(PERMISSIONS.CUSTOMERS_VIEW);
  const canViewContact = can(PERMISSIONS.CUSTOMERS_VIEW_CONTACT);

  // ── State ──────────────────────────────────────────────────────────────────
  const [currentDate, setCurrentDate]           = useState(storeNow);
  const [selectedAppointment, setSelectedAppointment] = useState<any | null>(null);
  const [selectedSlot, setSelectedSlot]         = useState<{ staffId: number; hour: number; minute: number } | null>(null);
  const [showDatePicker, setShowDatePicker]      = useState(false);
  const [activeTab, setActiveTab]               = useState<"calendar" | "menu">("calendar");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [selectedStaffId, setSelectedStaffId]   = useState<number | "all">(
    canViewAll ? "all" : (staffId ?? "all"),
  );

  // ── Guards ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) navigate("/staff-auth", { replace: true });
  }, [authLoading, user, navigate]);

  // Lock non-viewAll users to their own column even if permissions load late
  useEffect(() => {
    if (!canViewAll && staffId) setSelectedStaffId(staffId);
  }, [canViewAll, staffId]);

  // Reset date when store changes
  useEffect(() => {
    setCurrentDate(getNowInTimezone(timezone));
    setSelectedAppointment(null);
    setSelectedSlot(null);
  }, [selectedStore?.id, timezone]);

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data: appointments = [] }  = useAppointments();
  const { data: staffList = [] }     = useStaffList();
  const { data: calSettings }        = useCalendarSettings();
  const updateAppointment            = useUpdateAppointment();

  const ownStaff = useMemo(
    () => (staffList as any[]).find((s) => s.id === staffId),
    [staffList, staffId],
  );

  // ── Calendar settings ──────────────────────────────────────────────────────
  const timeSlotInterval       = calSettings?.timeSlotInterval       ?? DEFAULT_CALENDAR_SETTINGS.timeSlotInterval;
  const showPrices             = calSettings?.showPrices             ?? DEFAULT_CALENDAR_SETTINGS.showPrices;
  const nonWorkingHoursDisplay = (calSettings as any)?.nonWorkingHoursDisplay ?? DEFAULT_CALENDAR_SETTINGS.nonWorkingHoursDisplay;
  const startOfWeek            = (calSettings as any)?.startOfWeek   ?? DEFAULT_CALENDAR_SETTINGS.startOfWeek;
  const settings               = { timeSlotInterval };

  // ── Hour range (expands to fit appointments) ───────────────────────────────
  const { START_HOUR, END_HOUR } = useMemo(() => {
    let s = Math.max(0, 9 - nonWorkingHoursDisplay);
    let e = Math.min(24, 18 + nonWorkingHoursDisplay);
    for (const apt of appointments as any[]) {
      const local = toStoreLocal(apt.date, timezone);
      if (!isSameDay(local, currentDate)) continue;
      if (!canViewAll && apt.staffId !== staffId) continue;
      const startMin = local.getHours() * 60 + local.getMinutes();
      const endMin   = Math.min(24 * 60, startMin + Math.max(Number(apt.duration ?? 0), 15));
      s = Math.min(s, Math.floor(startMin / 60));
      e = Math.max(e, Math.ceil(endMin / 60));
    }
    return { START_HOUR: Math.max(0, s), END_HOUR: Math.min(24, Math.max(e, s + 1)) };
  }, [appointments, currentDate, timezone, staffId, canViewAll, nonWorkingHoursDisplay]);

  const TOTAL_HOURS = END_HOUR - START_HOUR;
  const isToday     = isSameDay(currentDate, storeNow);

  const { position: timeLinePosition, timeLabel: timeLineLabel } =
    useCurrentTimeLine(timezone, START_HOUR, END_HOUR);

  // ── Filtered staff ─────────────────────────────────────────────────────────
  const filteredStaff = useMemo(() => {
    const list = staffList as any[];
    if (!list.length) return [];
    if (canViewAll && selectedStaffId === "all") return list;
    const targetId = canViewAll
      ? (selectedStaffId === "all" ? null : (selectedStaffId as number))
      : staffId;
    if (!targetId) return list;
    return list.filter((s) => s.id === targetId);
  }, [staffList, selectedStaffId, canViewAll, staffId]);

  // ── Time slots ─────────────────────────────────────────────────────────────
  const timeSlots = useMemo(() => {
    const slots: { hour: number; minute: number; label: string; isHour: boolean }[] = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      for (let m = 0; m < 60; m += timeSlotInterval) {
        if (h === END_HOUR && m > 0) break;
        const isHour = m === 0;
        const label = isHour
          ? h === 0 ? "12 AM" : h === 12 ? "12 PM" : h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`
          : `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
        slots.push({ hour: h, minute: m, label, isHour });
      }
    }
    return slots;
  }, [START_HOUR, END_HOUR, timeSlotInterval]);

  // ── Week day labels ────────────────────────────────────────────────────────
  const weekDayLabels = useMemo(() => {
    const dow  = currentDate.getDay();
    const wsd  = startOfWeek === "sunday" ? 0 : startOfWeek === "saturday" ? 6 : 1;
    const diff = (dow - wsd + 7) % 7;
    const start = subDays(currentDate, diff);
    return Array.from({ length: 7 }).map((_, i) => {
      const d = addDays(start, i);
      return { date: d, label: formatInTz(d, timezone, "EEE"), isToday: isSameDay(d, storeNow) };
    });
  }, [currentDate, timezone, storeNow, startOfWeek]);

  // ── Data helpers ───────────────────────────────────────────────────────────
  const getAppointmentsForStaff = useCallback(
    (sid: number) =>
      (appointments as any[]).filter((apt) => {
        const local = toStoreLocal(apt.date, timezone);
        return apt.staffId === sid && isSameDay(local, currentDate);
      }),
    [appointments, timezone, currentDate],
  );

  const getAppointmentStyle = useCallback(
    (apt: any) => {
      const local    = toStoreLocal(apt.date, timezone);
      const startMin = local.getHours() * 60 + local.getMinutes();
      const endMin   = startMin + Math.max(Number(apt.duration ?? 0), 15);
      const visStart = START_HOUR * 60;
      const visEnd   = END_HOUR * 60;
      const cStart   = Math.max(startMin, visStart);
      const cEnd     = Math.min(endMin, visEnd);
      return {
        top:    `${((cStart - visStart) / 60) * HOUR_HEIGHT}px`,
        height: `${Math.max(((cEnd - cStart) / 60) * HOUR_HEIGHT, 30)}px`,
      };
    },
    [timezone, START_HOUR, END_HOUR],
  );

  const getStaffColor = useCallback((member: any) => member?.color ?? "#22c55e", []);

  // ── Slot interaction ───────────────────────────────────────────────────────
  const handleSlotClick = useCallback(
    (sid: number, hour: number, minute: number) => {
      if (!canEdit) return;
      const slotStart = new Date(
        currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), hour, minute,
      );
      if (slotStart.getTime() <= storeNow.getTime()) return;
      setSelectedSlot((prev) =>
        prev?.staffId === sid && prev.hour === hour && prev.minute === minute
          ? null
          : { staffId: sid, hour, minute },
      );
    },
    [canEdit, currentDate, storeNow],
  );

  const handleBookSlot = useCallback(
    (sid: number, hour: number, minute: number) => {
      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
      const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      navigate(`/booking/new?staffId=${sid}&date=${dateStr}&time=${timeStr}`);
    },
    [currentDate, navigate],
  );

  // ── Appointment quick actions ──────────────────────────────────────────────
  const handleQuickStart = useCallback(
    (apt: any) => {
      updateAppointment.mutate({ id: apt.id, status: "started" } as any, {
        onSuccess: () => {
          setSelectedAppointment((prev: any) => prev?.id === apt.id ? { ...prev, status: "started" } : prev);
          toast({ title: "Service started" });
        },
      });
    },
    [updateAppointment, toast],
  );

  const handleQuickComplete = useCallback(
    (apt: any) => {
      updateAppointment.mutate({ id: apt.id, status: "completed" } as any, {
        onSuccess: () => {
          setSelectedAppointment(null);
          toast({ title: "Appointment completed" });
        },
      });
    },
    [updateAppointment, toast],
  );

  const handleQuickCancel = useCallback(
    (apt: any) => {
      setSelectedAppointment(apt);
      setShowCancelConfirm(true);
    },
    [],
  );

  const confirmCancel = useCallback(() => {
    if (!selectedAppointment) return;
    updateAppointment.mutate(
      { id: selectedAppointment.id, status: "cancelled", cancellationReason: "Cancelled by staff" } as any,
      {
        onSuccess: () => {
          setSelectedAppointment(null);
          setShowCancelConfirm(false);
          toast({ title: "Appointment cancelled" });
        },
      },
    );
  }, [selectedAppointment, updateAppointment, toast]);

  // ── Realtime: invalidate appointments on WebSocket notification ────────────
  useEffect(() => {
    if (!selectedStore?.id) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/notifications?storeId=${selectedStore.id}`);
    ws.onmessage = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
    };
    ws.onerror = () => ws.close();
    return () => { try { ws.close(); } catch { /* ignore */ } };
  }, [selectedStore?.id, queryClient]);

  // ── Loading guard ──────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const staffName  = ownStaff?.name ?? user?.firstName ?? "Staff";
  const staffColor = ownStaff?.color ?? "#3b82f6";
  const initials   = (staffName[0] ?? "S").toUpperCase();
  const aptStatus  = selectedAppointment
    ? (STATUS_CFG[selectedAppointment.status] ?? STATUS_CFG.confirmed)
    : null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col bg-background overflow-hidden" style={{ height: "100dvh" }}>

      {/* ── Top header ── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 border-b bg-white dark:bg-[#0f172a]"
           style={{ height: 52 }}>

        {/* Staff avatar */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden"
          style={{ backgroundColor: `${staffColor}22`, color: staffColor }}
        >
          {ownStaff?.avatarUrl
            ? <img src={ownStaff.avatarUrl} alt={staffName} className="w-full h-full object-cover" />
            : initials}
        </div>

        {/* Date navigation — center */}
        <div className="flex-1 flex items-center justify-center gap-0.5">
          <button
            className="p-1.5 text-slate-400 active:text-slate-700 transition-colors"
            onClick={() => setCurrentDate((d) => subDays(d, 1))}
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            className="px-2 py-1 text-[13px] font-bold text-slate-700 dark:text-slate-200 rounded-md active:bg-slate-100 dark:active:bg-slate-800 transition-colors"
            onClick={() => setShowDatePicker(true)}
          >
            {isToday ? "Today" : formatInTz(currentDate, timezone, "EEE, MMM d")}
          </button>
          <button
            className="p-1.5 text-slate-400 active:text-slate-700 transition-colors"
            onClick={() => setCurrentDate((d) => addDays(d, 1))}
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Bell */}
        <button className="w-8 h-8 flex items-center justify-center text-slate-400 active:text-slate-700 transition-colors shrink-0">
          <Bell className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* ── Main content area (fills between header and bottom nav) ── */}
      <div className="flex-1 relative overflow-hidden">

        {/* Calendar tab */}
        {activeTab === "calendar" && (
          <div className="absolute inset-0">
            <MobileCalendarView
              filteredStaff={filteredStaff}
              timeSlots={timeSlots}
              START_HOUR={START_HOUR}
              END_HOUR={END_HOUR}
              TOTAL_HOURS={TOTAL_HOURS}
              HOUR_HEIGHT={HOUR_HEIGHT}
              getAppointmentsForStaff={getAppointmentsForStaff}
              getAppointmentStyle={getAppointmentStyle}
              getStaffColor={getStaffColor}
              timezone={timezone}
              selectedAppointment={selectedAppointment}
              onSelectAppointment={(apt) => {
                setSelectedAppointment(apt);
                setShowCancelConfirm(false);
              }}
              handleSlotClick={handleSlotClick}
              selectedSlot={selectedSlot}
              setSelectedSlot={(s) => setSelectedSlot(s)}
              handleBookSlot={handleBookSlot}
              isToday={isToday}
              timeLinePosition={timeLinePosition}
              timeLineLabel={timeLineLabel}
              showPrices={showPrices}
              lateGracePeriodMinutes={lateGracePeriodMinutes}
              storeNow={storeNow}
              settings={settings}
              weekDayLabels={weekDayLabels}
              currentDate={currentDate}
              onSelectDate={(date) => setCurrentDate(date)}
              onNewBooking={() => canEdit && navigate("/booking/new")}
              onLookup={() => navigate("/client-lookup")}
              selectedStaffId={canViewAll ? selectedStaffId : (staffId ?? "all")}
              onFilterStaff={(id) => { if (canViewAll) setSelectedStaffId(id); }}
              onQuickStart={handleQuickStart}
              onQuickComplete={handleQuickComplete}
              onQuickCancel={handleQuickCancel}
            />
          </div>
        )}

        {/* Menu tab */}
        {activeTab === "menu" && (
          <div className="absolute inset-0 overflow-y-auto bg-slate-50 dark:bg-[#0a0f1e] px-4 pt-5 pb-4">
            {/* Profile card */}
            <div className="bg-white dark:bg-[#0f172a] rounded-2xl p-5 flex items-center gap-4 mb-3 shadow-sm">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold shrink-0 overflow-hidden"
                style={{ backgroundColor: `${staffColor}22`, color: staffColor }}
              >
                {ownStaff?.avatarUrl
                  ? <img src={ownStaff.avatarUrl} alt={staffName} className="w-full h-full object-cover" />
                  : initials}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white truncate">{staffName}</p>
                <p className="text-sm text-gray-500 capitalize">{user?.role ?? "Staff"}</p>
                <p className="text-xs text-gray-400 truncate">{user?.email ?? ""}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="bg-white dark:bg-[#0f172a] rounded-2xl overflow-hidden shadow-sm">
              <button
                className="w-full px-5 py-4 flex items-center gap-3 text-red-600 active:bg-red-50 dark:active:bg-red-950/40 transition-colors"
                onClick={async () => {
                  await logout();
                  navigate("/staff-auth", { replace: true });
                }}
              >
                <LogOut className="w-5 h-5" />
                <span className="font-medium">Sign out</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom tab bar ── */}
      <StaffBottomNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          if (tab === "clients") { navigate("/customers"); return; }
          setActiveTab(tab);
        }}
        canViewClients={canViewClients}
      />

      {/* ─── Appointment detail sheet ───────────────────────────────────────── */}
      <Sheet
        open={!!selectedAppointment && !showCancelConfirm}
        onOpenChange={(open) => { if (!open) setSelectedAppointment(null); }}
      >
        <SheetContent
          side="bottom"
          className="rounded-t-3xl max-h-[80vh] overflow-y-auto px-5 pb-8 pt-4"
        >
          {selectedAppointment && (() => {
            const cfg = STATUS_CFG[selectedAppointment.status] ?? STATUS_CFG.confirmed;
            const isDone = selectedAppointment.status === "completed" || selectedAppointment.status === "cancelled";
            return (
              <div>
                {/* Drag handle */}
                <div className="flex justify-center mb-4">
                  <div className="w-9 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
                </div>

                {/* Status + close */}
                <div className="flex items-center justify-between mb-4">
                  <span className={cn("text-xs font-bold px-2.5 py-1 rounded-full", cfg.bg, cfg.color)}>
                    {cfg.label}
                  </span>
                  <button
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 active:scale-95 transition-transform"
                    onClick={() => setSelectedAppointment(null)}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Client info */}
                {canViewClients ? (
                  <div className="mb-4">
                    <p className="text-xl font-bold text-gray-900 dark:text-white">
                      {selectedAppointment.customer?.name ?? "Client"}
                    </p>
                    {canViewContact && (
                      <div className="flex flex-col gap-1 mt-1.5">
                        {selectedAppointment.customer?.phone && (
                          <a
                            href={`tel:${selectedAppointment.customer.phone}`}
                            className="inline-flex items-center gap-2 text-sm text-primary"
                          >
                            <Phone className="w-4 h-4" />
                            {selectedAppointment.customer.phone}
                          </a>
                        )}
                        {selectedAppointment.customer?.email && (
                          <a
                            href={`mailto:${selectedAppointment.customer.email}`}
                            className="inline-flex items-center gap-2 text-sm text-primary"
                          >
                            <Mail className="w-4 h-4" />
                            {selectedAppointment.customer.email}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xl font-bold text-gray-900 dark:text-white mb-4">Appointment</p>
                )}

                {/* Service details */}
                <div className="flex items-center gap-3 py-3 border-t border-b border-gray-100 dark:border-gray-800 mb-5">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: `${getStaffColor(
                        (staffList as any[]).find((s) => s.id === selectedAppointment.staffId),
                      )}22`,
                    }}
                  >
                    <Clock className="w-5 h-5 text-gray-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">
                      {selectedAppointment.service?.name ?? "Service"}
                    </p>
                    <p className="text-sm text-gray-500">
                      {selectedAppointment.duration} min
                      {showPrices && selectedAppointment.price
                        ? ` · $${Number(selectedAppointment.price).toFixed(2)}`
                        : ""}
                    </p>
                  </div>
                </div>

                {/* Action buttons */}
                {!isDone && canEdit && (
                  <div className="flex flex-col gap-2.5">
                    {selectedAppointment.status === "confirmed" && (
                      <button
                        className="w-full py-3.5 rounded-2xl bg-amber-500 text-white font-semibold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-sm"
                        onClick={() => { handleQuickStart(selectedAppointment); }}
                      >
                        <Play className="w-4 h-4 fill-white" />
                        Start Service
                      </button>
                    )}
                    {selectedAppointment.status === "started" && (
                      <button
                        className="w-full py-3.5 rounded-2xl bg-green-600 text-white font-semibold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-sm"
                        onClick={() => handleQuickComplete(selectedAppointment)}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Mark Complete
                      </button>
                    )}
                    {canCancel && (
                      <button
                        className="w-full py-3.5 rounded-2xl border-2 border-red-200 text-red-600 font-semibold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                        onClick={() => handleQuickCancel(selectedAppointment)}
                      >
                        <XCircle className="w-4 h-4" />
                        Cancel Appointment
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* ─── Cancel confirmation ─────────────────────────────────────────────── */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end">
          <div className="w-full bg-white dark:bg-[#0f172a] rounded-t-3xl px-5 pt-5 pb-8 shadow-2xl">
            <div className="flex justify-center mb-4">
              <div className="w-9 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              Cancel appointment?
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              Cancel{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {selectedAppointment?.customer?.name ?? "this client"}
              </span>
              's appointment. This cannot be undone.
            </p>
            <div className="flex flex-col gap-2.5">
              <button
                className="w-full py-3.5 rounded-2xl bg-red-600 text-white font-semibold text-[15px] active:scale-[0.98] transition-transform"
                onClick={confirmCancel}
                disabled={updateAppointment.isPending}
              >
                {updateAppointment.isPending ? "Cancelling…" : "Yes, cancel"}
              </button>
              <button
                className="w-full py-3.5 rounded-2xl border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-[15px] active:scale-[0.98] transition-transform"
                onClick={() => setShowCancelConfirm(false)}
              >
                Keep appointment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Date picker overlay ─────────────────────────────────────────────── */}
      {showDatePicker && (
        <div className="fixed inset-0 z-50 bg-white dark:bg-[#0a0f1e] flex flex-col">
          <div className="flex items-center justify-between px-4 h-14 border-b border-gray-100 dark:border-gray-800">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white">Select Date</h2>
            <button
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500"
              onClick={() => setShowDatePicker(false)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 flex items-start justify-center pt-4 overflow-auto">
            <Calendar
              mode="single"
              selected={currentDate}
              onSelect={(date) => {
                if (date) { setCurrentDate(date); setShowDatePicker(false); }
              }}
              className="rounded-md"
              initialFocus
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── StaffBottomNav ───────────────────────────────────────────────────────────

function StaffBottomNav({
  activeTab,
  onTabChange,
  canViewClients,
}: {
  activeTab: string;
  onTabChange: (tab: "calendar" | "clients" | "menu") => void;
  canViewClients: boolean;
}) {
  const tabs = [
    { id: "calendar" as const, Icon: CalendarDays, label: "Calendar" },
    ...(canViewClients ? [{ id: "clients" as const, Icon: Users, label: "Clients" }] : []),
    { id: "menu" as const, Icon: MenuIcon, label: "More" },
  ];

  return (
    <div
      className="flex-shrink-0 flex items-stretch bg-white dark:bg-[#0f172a] border-t border-gray-100 dark:border-white/[0.07]"
      style={{
        height: "calc(56px + env(safe-area-inset-bottom, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {tabs.map(({ id, Icon, label }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            className="flex-1 flex flex-col items-center justify-center gap-[3px] select-none active:opacity-50 transition-opacity relative"
            onClick={() => onTabChange(id)}
          >
            {active && (
              <span className="absolute top-0 inset-x-0 flex justify-center">
                <span className="w-5 h-[2px] rounded-full bg-primary dark:bg-white/80" />
              </span>
            )}
            <Icon
              className={cn(
                "w-[22px] h-[22px] transition-colors",
                active ? "text-primary dark:text-white" : "text-muted-foreground dark:text-white/55",
              )}
              strokeWidth={active ? 2.2 : 1.7}
            />
            <span
              className={cn(
                "text-[10px] font-medium leading-none transition-colors",
                active ? "text-primary dark:text-white" : "text-muted-foreground dark:text-white/55",
              )}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
