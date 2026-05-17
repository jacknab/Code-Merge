import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useAppointments, useUpdateAppointment } from "@/hooks/use-appointments";
import { useStaffList } from "@/hooks/use-staff";
import { useSelectedStore } from "@/hooks/use-store";
import { useCalendarSettings, DEFAULT_CALENDAR_SETTINGS } from "@/hooks/use-calendar-settings";
import { formatInTz, toStoreLocal, getTimezoneAbbr, getNowInTimezone } from "@/lib/timezone";
import { addDays, subDays, isSameDay, addMinutes, format } from "date-fns";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, CalendarPlus, Users, Globe, ArrowLeft, ArrowUp, X, Clock, Loader2, CreditCard, Banknote, Smartphone, DollarSign, Check, Receipt, Percent, Tag, Delete, Printer, XCircle, Settings, PersonStanding, LayoutDashboard, TrendingUp, CalendarDays, Scissors, ShoppingBag, UserCircle, Gift, ClipboardList, FileText, BarChart3, MessageSquare, Mail, Building2, MapPin, Star, Sparkle, ThumbsUp, ListOrdered, Search, AlertCircle, Lock, Unlock, Bell, ListFilter, MoreVertical, Plus, LayoutList, Zap, Send } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AvailableTimeBanner } from "@/components/AvailableTimeBanner";
import { cn } from "@/lib/utils";
import type { AppointmentWithDetails } from "@shared/schema";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { CashDrawerPanel } from "@/pages/CashDrawer";
import { MobileCalendarView } from "@/components/MobileCalendarView";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { WeeklyAgendaView } from "@/components/WeeklyAgendaView";
import { OpenRegisterModal } from "@/components/cash/OpenRegisterModal";
import { DayCloseModal } from "@/components/cash/DayCloseModal";

type SidebarItem =
  | { kind: "link"; to: string; label: string; icon: any }
  | { kind: "action"; action: "quick-checkout" | "cash-drawer" | "day-close" | "open-register"; label: string; icon: any };

const calendarSidebarItems: SidebarItem[] = [
  { kind: "link", to: "/calendar", label: "Calendar", icon: CalendarDays },
  { kind: "link", to: "/customers", label: "Customers", icon: Users },
  { kind: "link", to: "/reports", label: "Reports", icon: FileText },
  { kind: "action", action: "quick-checkout", label: "Quick Cash Out", icon: Receipt },
  { kind: "action", action: "open-register", label: "Open Register", icon: Unlock },
  { kind: "action", action: "cash-drawer", label: "Cash Drawer", icon: Banknote },
  { kind: "action", action: "day-close", label: "Day Close", icon: Lock },
  { kind: "link", to: "/business-settings", label: "Business Settings", icon: Building2 },
];

const HOUR_HEIGHT = 180;
const STAFF_CALENDAR_COLUMN_WIDTH = 210;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}
const CALENDAR_COLUMN_SEPARATOR_COLOR = "#d9e2ea";
const DEFAULT_BUSINESS_START = 9;
const DEFAULT_BUSINESS_END = 18;

function useCurrentTimeLine(timezone: string, startHour: number, endHour: number) {
  const [position, setPosition] = useState<number | null>(null);
  const [timeLabel, setTimeLabel] = useState("");

  const updatePosition = useCallback(() => {
    const now = getNowInTimezone(timezone);
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    const startMinutes = startHour * 60;
    const endMinutes = endHour * 60;

    if (totalMinutes < startMinutes || totalMinutes > endMinutes) {
      setPosition(null);
      setTimeLabel("");
      return;
    }

    const pixelsFromTop = (totalMinutes - startMinutes) * (HOUR_HEIGHT / 60);
    setPosition(pixelsFromTop);

    const h = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    const m = String(minutes).padStart(2, "0");
    setTimeLabel(`${h}:${m}`);
  }, [timezone, startHour, endHour]);

  useEffect(() => {
    updatePosition();
    const interval = setInterval(updatePosition, 60000);
    return () => clearInterval(interval);
  }, [updatePosition]);

  return { position, timeLabel };
}

export default function Calendar() {
  const { isLoading: authLoading, user } = useAuth();
  const isStaffUser = user?.role === "staff" && !!user?.staffId;
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedStore } = useSelectedStore();
  const timezone = selectedStore?.timezone || "UTC";
  const lateGracePeriodMinutes = (selectedStore as any)?.lateGracePeriodMinutes ?? 10;
  const posEnabled = (selectedStore as any)?.posEnabled !== false;
  const tzAbbr = getTimezoneAbbr(timezone);

  // Query the open cash drawer session so we know whether to auto-prompt on mount
  const { data: openDrawerSession } = useQuery({
    queryKey: [`/api/cash-drawer/open?storeId=${selectedStore?.id}`],
    enabled: !!posEnabled && !!selectedStore?.id,
    staleTime: 60_000,
  });
  const { data: calSettings } = useCalendarSettings();

  const settings = {
    startOfWeek: calSettings?.startOfWeek || DEFAULT_CALENDAR_SETTINGS.startOfWeek,
    timeSlotInterval: calSettings?.timeSlotInterval || DEFAULT_CALENDAR_SETTINGS.timeSlotInterval,
    nonWorkingHoursDisplay: calSettings?.nonWorkingHoursDisplay ?? DEFAULT_CALENDAR_SETTINGS.nonWorkingHoursDisplay,
    allowBookingOutsideHours: calSettings?.allowBookingOutsideHours ?? DEFAULT_CALENDAR_SETTINGS.allowBookingOutsideHours,
    autoCompleteAppointments: calSettings?.autoCompleteAppointments ?? DEFAULT_CALENDAR_SETTINGS.autoCompleteAppointments,
  };
  const showPrices = calSettings?.showPrices ?? DEFAULT_CALENDAR_SETTINGS.showPrices;

  const storeNow = getNowInTimezone(timezone);
  const [currentDate, setCurrentDate] = useState(storeNow);
  const [selectedStaffId, setSelectedStaffId] = useState<number | "all">("all");
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentWithDetails | null>(null);
  const [showCancelFlow, setShowCancelFlow] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showClientLookup, setShowClientLookup] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showNewApptMenu, setShowNewApptMenu] = useState(false);
  const [lookupMode, setLookupMode] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ staffId: number; hour: number; minute: number } | null>(null);
  const [quickCheckoutOpen, setQuickCheckoutOpen] = useState(false);
  const [showCashDrawer, setShowCashDrawer] = useState(false);
  const [showOpenRegister, setShowOpenRegister] = useState(false);
  const [showDayClose, setShowDayClose] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [calView, setCalView] = useState<"grid" | "agenda">("grid");
  const navDrawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!navOpen) return;
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (navDrawerRef.current && target && !navDrawerRef.current.contains(target)) {
        setNavOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [navOpen]);
  const [showJumpToNow, setShowJumpToNow] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Returns ms until the next 1:00 AM Eastern Time (handles EST/EDT automatically)
  function msUntilNext1AMET(): number {
    const now = new Date();
    const fmt = (unit: Intl.DateTimeFormatOptions) =>
      parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...unit }).format(now));
    const etHour   = fmt({ hour: "numeric", hour12: false });
    const etMinute = fmt({ minute: "2-digit" });
    const etSecond = fmt({ second: "2-digit" });
    const secsFromMidnight = etHour * 3600 + etMinute * 60 + etSecond;
    const secsUntil1AM = secsFromMidnight < 3600
      ? 3600 - secsFromMidnight                      // still before 1 AM today
      : 24 * 3600 - secsFromMidnight + 3600;          // past 1 AM — wait until tomorrow 1 AM
    return secsUntil1AM * 1000;
  }

  // Returns today's date string in ET (YYYY-MM-DD), used as the localStorage day key
  function todayET(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  }

  // On-mount check: show the Open Register prompt if the drawer hasn't been
  // opened today and it is already past 1 AM Eastern Time
  useEffect(() => {
    if (!posEnabled || !selectedStore) return;
    if (openDrawerSession === undefined) return; // still loading
    if (openDrawerSession) return; // drawer already open — no prompt needed

    const storageKey = `certxa_drawer_prompted_${selectedStore.id}_${todayET()}`;
    if (localStorage.getItem(storageKey)) return; // already prompted today

    const etHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
    );
    if (etHour >= 1) setShowOpenRegister(true);
  }, [posEnabled, selectedStore, openDrawerSession]);

  // Recurring timer: fire at each 1 AM Eastern and re-schedule for the next day
  useEffect(() => {
    if (!posEnabled) return;
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = setTimeout(() => {
        setShowOpenRegister(true);
        schedule(); // re-schedule for next 1 AM
      }, msUntilNext1AMET());
    };
    schedule();
    return () => clearTimeout(t);
  }, [posEnabled]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const quickListRef = useRef<HTMLDivElement>(null);
  const shouldAutoCenterTimeLineRef = useRef(true);
  const programmaticScrollRef = useRef(false);

  const isMobile = useIsMobile();
  const updateAppointment = useUpdateAppointment();
  const { toast } = useToast();

  const { data: appointments } = useAppointments();
  const { data: staffList, isLoading: staffLoading } = useStaffList();

  const { data: businessHours } = useQuery({
    queryKey: ["/api/business-hours", selectedStore?.id],
    queryFn: async () => {
      if (!selectedStore?.id) return [];
      const res = await fetch(`/api/business-hours?storeId=${selectedStore.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch business hours");
      return res.json();
    },
    enabled: !!selectedStore?.id,
  });

  const businessHoursForDay = useMemo(() => {
    if (!businessHours || (businessHours as any[]).length === 0) return null;
    const dayOfWeek = currentDate.getDay();
    return (businessHours as any[]).find((h: any) => h.dayOfWeek === dayOfWeek) || null;
  }, [businessHours, currentDate]);

  const { BUSINESS_START_HOUR, BUSINESS_END_HOUR } = useMemo(() => {
    if (!businessHoursForDay || businessHoursForDay.isClosed) {
      return { BUSINESS_START_HOUR: DEFAULT_BUSINESS_START, BUSINESS_END_HOUR: DEFAULT_BUSINESS_END };
    }
    const [openHourRaw] = String(businessHoursForDay.openTime || "09:00").split(":");
    const [closeHourRaw] = String(businessHoursForDay.closeTime || "17:00").split(":");
    const openHour = Math.max(0, Math.min(24, Number(openHourRaw)));
    const closeHour = Math.max(0, Math.min(24, Number(closeHourRaw)));
    return { BUSINESS_START_HOUR: openHour, BUSINESS_END_HOUR: closeHour };
  }, [businessHoursForDay]);

  const baseStartHour = Math.max(0, BUSINESS_START_HOUR - settings.nonWorkingHoursDisplay);
  const baseEndHour = Math.min(24, BUSINESS_END_HOUR + settings.nonWorkingHoursDisplay);

  const displayedDayAppointments = useMemo(() => {
    if (!appointments) return [];
    return appointments.filter((apt: any) => {
      if (selectedStaffId !== "all" && apt.staffId !== selectedStaffId) return false;
      const localDate = toStoreLocal(apt.date, timezone);
      return isSameDay(localDate, currentDate);
    });
  }, [appointments, selectedStaffId, timezone, currentDate]);

  const { START_HOUR, END_HOUR } = useMemo(() => {
    let startHour = baseStartHour;
    let endHour = baseEndHour;

    for (const apt of displayedDayAppointments) {
      const localDate = toStoreLocal(apt.date, timezone);
      const startMinutes = localDate.getHours() * 60 + localDate.getMinutes();
      const duration = Number(apt.duration || 0);
      const endMinutes = Math.min(24 * 60, startMinutes + Math.max(duration, 15));

      startHour = Math.min(startHour, Math.floor(startMinutes / 60));
      endHour = Math.max(endHour, Math.ceil(endMinutes / 60));
    }

    startHour = Math.max(0, startHour);
    endHour = Math.min(24, Math.max(endHour, startHour + 1));

    return { START_HOUR: startHour, END_HOUR: endHour };
  }, [baseStartHour, baseEndHour, displayedDayAppointments, timezone]);

  const TOTAL_HOURS = END_HOUR - START_HOUR;
  const { position: timeLinePosition, timeLabel: timeLineLabel } = useCurrentTimeLine(timezone, START_HOUR, END_HOUR);
  const isToday = isSameDay(currentDate, storeNow);

  // Auto-select the staff column for staff users once auth resolves
  useEffect(() => {
    if (isStaffUser && user?.staffId) {
      setSelectedStaffId(user.staffId as number);
    }
  }, [isStaffUser, user?.staffId]);

  useEffect(() => {
    setCurrentDate(getNowInTimezone(timezone));
    // Staff users are locked to their own column — don't reset to "all"
    setSelectedStaffId(isStaffUser && user?.staffId ? (user.staffId as number) : "all");
    setSelectedAppointment(null);
    setShowCheckout(false);
    setSelectedSlot(null);
    shouldAutoCenterTimeLineRef.current = true;
  }, [selectedStore?.id, timezone]);

  useEffect(() => {
    setSelectedSlot(null);
  }, [currentDate]);

  useEffect(() => {
    if (!isToday || timeLinePosition === null || !scrollContainerRef.current) return;
    if (!shouldAutoCenterTimeLineRef.current) return;
    const container = scrollContainerRef.current;
    // Center the line once on load, then let the user control the scroll.
    const scrollTarget = Math.max(0, timeLinePosition - container.clientHeight / 3);
    programmaticScrollRef.current = true;
    container.scrollTo({ top: scrollTarget, behavior: "smooth" });
    shouldAutoCenterTimeLineRef.current = false;
  }, [isToday, timeLinePosition]);

  const scrollToNow = useCallback(() => {
    if (timeLinePosition === null || !scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const scrollTarget = Math.max(0, timeLinePosition - container.clientHeight / 3);
    programmaticScrollRef.current = true;
    container.scrollTo({ top: scrollTarget, behavior: "smooth" });
  }, [timeLinePosition]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const checkVisibility = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      shouldAutoCenterTimeLineRef.current = false;
      if (!isToday || timeLinePosition === null) {
        setShowJumpToNow(false);
        return;
      }
      const headerOffset = 80;
      const lineTop = timeLinePosition + headerOffset;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;
      const visible = lineTop >= viewTop + 40 && lineTop <= viewBottom - 40;
      setShowJumpToNow(!visible);
    };
    checkVisibility();
    container.addEventListener("scroll", checkVisibility, { passive: true });
    return () => container.removeEventListener("scroll", checkVisibility);
  }, [isToday, timeLinePosition]);

  const filteredStaff = useMemo(() => {
    if (!staffList) return [];
    if (selectedStaffId === "all") return staffList;
    return staffList.filter((s: any) => s.id === selectedStaffId);
  }, [staffList, selectedStaffId]);

  const timeSlots = useMemo(() => {
    const slots: { hour: number; minute: number; label: string; isHour: boolean }[] = [];
    const interval = settings.timeSlotInterval;
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      for (let m = 0; m < 60; m += interval) {
        if (h === END_HOUR && m > 0) break;
        const isHour = m === 0;
        const label = isHour
          ? h === 0 ? "12 AM" : h === 12 ? "12 PM" : h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`
          : `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
        slots.push({ hour: h, minute: m, label, isHour });
      }
    }
    return slots;
  }, [START_HOUR, END_HOUR, settings.timeSlotInterval]);

  const getAppointmentsForStaff = (staffId: number) => {
    if (!appointments) return [];
    return appointments.filter((apt: any) => {
      const localDate = toStoreLocal(apt.date, timezone);
      return apt.staffId === staffId && isSameDay(localDate, currentDate);
    });
  };

  const getAppointmentStyle = (apt: any) => {
    const localDate = toStoreLocal(apt.date, timezone);
    const startMinutes = localDate.getHours() * 60 + localDate.getMinutes();
    const duration = Number(apt.duration || 0);
    const endMinutes = startMinutes + Math.max(duration, 15);
    const visibleStartMinutes = START_HOUR * 60;
    const visibleEndMinutes = END_HOUR * 60;
    const clampedStartMinutes = Math.max(startMinutes, visibleStartMinutes);
    const clampedEndMinutes = Math.min(endMinutes, visibleEndMinutes);
    const topOffset = ((clampedStartMinutes - visibleStartMinutes) / 60) * HOUR_HEIGHT;
    const height = ((clampedEndMinutes - clampedStartMinutes) / 60) * HOUR_HEIGHT;
    return {
      top: `${topOffset}px`,
      height: `${Math.max(height, 30)}px`,
    };
  };

  const getStaffColor = (staffMember: any) => {
    return staffMember?.color || "#22c55e";
  };

  const formatHourLabel = (timeStr: string) => {
    if (!timeStr) return "";
    const [hStr, mStr] = timeStr.split(":");
    const h24 = Number(hStr);
    const m = Number(mStr || 0);
    const ampm = h24 >= 12 ? "pm" : "am";
    const h = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
    return `${h}:${String(m).padStart(2, "0")}${ampm}`;
  };

  const weekDayLabels = useMemo(() => {
    const dayOfWeek = currentDate.getDay();
    const weekStartDay = settings.startOfWeek === "sunday" ? 0 : settings.startOfWeek === "saturday" ? 6 : 1;
    const diff = (dayOfWeek - weekStartDay + 7) % 7;
    const start = subDays(currentDate, diff);
    return Array.from({ length: 7 }).map((_, i) => {
      const d = addDays(start, i);
      return { date: d, label: formatInTz(d, timezone, "EEE"), isToday: isSameDay(d, storeNow) };
    });
  }, [currentDate, timezone, storeNow, settings.startOfWeek]);

  const goToday = () => {
    shouldAutoCenterTimeLineRef.current = true;
    setCurrentDate(getNowInTimezone(timezone));
  };
  const [slideDir, setSlideDir] = useState<'next' | 'prev'>('next');
  const goPrev = useCallback(() => { setSlideDir('prev'); setCurrentDate(d => subDays(d, 1)); }, []);
  const goNext = useCallback(() => { setSlideDir('next'); setCurrentDate(d => addDays(d, 1)); }, []);

  useEffect(() => {
    if (isMobile) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const deltaX = e.changedTouches[0].clientX - startX;
      const deltaY = e.changedTouches[0].clientY - startY;
      if (Math.abs(deltaX) < 50) return;
      if (Math.abs(deltaX) < Math.abs(deltaY)) return;
      if (deltaX < 0) goNext(); else goPrev();
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [isMobile, goPrev, goNext]);

  const getAvailableMinutesForSlot = useCallback((staffId: number, slotHour: number, slotMinute: number) => {
    if (!appointments) return END_HOUR * 60 - (slotHour * 60 + slotMinute);
    const staffApts = appointments.filter((apt: any) => {
      if (apt.staffId !== staffId || apt.status === "cancelled") return false;
      const localDate = toStoreLocal(apt.date, timezone);
      return isSameDay(localDate, currentDate);
    });
    const slotStartMin = slotHour * 60 + slotMinute;
    const endOfDayMin = END_HOUR * 60;
    let nextBoundary = endOfDayMin;
    for (const apt of staffApts) {
      const localDate = toStoreLocal(apt.date, timezone);
      const aptStartMin = localDate.getHours() * 60 + localDate.getMinutes();
      if (aptStartMin > slotStartMin && aptStartMin < nextBoundary) {
        nextBoundary = aptStartMin;
      }
    }
    return nextBoundary - slotStartMin;
  }, [appointments, timezone, currentDate, END_HOUR]);

  const handleSlotClick = useCallback((staffId: number, slotHour: number, slotMinute: number) => {
    const slotStart = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate(),
      slotHour,
      slotMinute,
      0,
      0,
    );
    if (slotStart.getTime() <= storeNow.getTime()) return;
    const availMins = getAvailableMinutesForSlot(staffId, slotHour, slotMinute);
    if (availMins <= 0) return;
    setSelectedSlot(prev =>
      prev?.staffId === staffId && prev?.hour === slotHour && prev?.minute === slotMinute
        ? null
        : { staffId, hour: slotHour, minute: slotMinute }
    );
  }, [currentDate, storeNow, getAvailableMinutesForSlot]);

  const handleBookSlot = useCallback((staffId: number, slotHour: number, slotMinute: number) => {
    const availMins = getAvailableMinutesForSlot(staffId, slotHour, slotMinute);
    if (availMins <= 0) return;
    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
    const timeStr = `${String(slotHour).padStart(2, "0")}:${String(slotMinute).padStart(2, "0")}`;
    navigate(`/booking/new?staffId=${staffId}&date=${dateStr}&time=${timeStr}&availableMinutes=${availMins}`);
  }, [currentDate, navigate, getAvailableMinutesForSlot]);

  const handleCancelAppointment = (apt: AppointmentWithDetails) => {
    setShowCancelFlow(true);
  };

  const handleMarkNoShow = (apt: AppointmentWithDetails) => {
    updateAppointment.mutate(
      { id: apt.id, status: "no_show", cancellationReason: "No Show" } as any,
      {
        onSuccess: () => {
          setSelectedAppointment(null);
          setShowCancelFlow(false);
        },
      }
    );
  };

  const handleConfirmCancel = (apt: AppointmentWithDetails, reason: string) => {
    updateAppointment.mutate(
      {
        id: apt.id,
        status: reason === "No Show" ? "no_show" : "cancelled",
        cancellationReason: reason,
      } as any,
      {
        onSuccess: () => {
          setSelectedAppointment(null);
          setShowCancelFlow(false);
        },
      }
    );
  };

  const handleStartService = (apt: AppointmentWithDetails) => {
    updateAppointment.mutate(
      { id: apt.id, status: "started" } as any,
      {
        onSuccess: (updated: any) => {
          setSelectedAppointment({ ...apt, status: "started" });
        },
      }
    );
  };

  const handleCheckout = (apt: AppointmentWithDetails) => {
    if (!openDrawerSession) {
      setShowOpenRegister(true);
      return;
    }
    setShowCheckout(true);
  };

  const handleComplete = (apt: AppointmentWithDetails) => {
    updateAppointment.mutate(
      { id: apt.id, status: "completed" } as any,
      { onSuccess: () => setSelectedAppointment(null) }
    );
  };

  const handleFinalizePayment = (apt: AppointmentWithDetails, paymentData: { paymentMethod: string; tip: number; discount: number; totalPaid: number }) => {
    updateAppointment.mutate(
      {
        id: apt.id,
        status: "completed",
        paymentMethod: paymentData.paymentMethod,
        tipAmount: String(paymentData.tip),
        discountAmount: String(paymentData.discount),
        totalPaid: String(paymentData.totalPaid),
      } as any,
      {
        onSuccess: () => {
          setSelectedAppointment(null);
          setShowCheckout(false);
        },
      }
    );
  };

  if (authLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-screen w-full overflow-hidden flex flex-col bg-background">
      {/* ── Mobile header ── */}
      {isMobile && (
        <div
          className="flex-shrink-0 flex items-center gap-1 px-2 h-12 border-b"
          style={{ backgroundColor: "#f1f5f9" }}
          data-testid="calendar-header"
        >
          {/* Bell */}
          <button className="w-9 h-9 flex items-center justify-center rounded-full text-slate-400 active:text-slate-700 transition-colors shrink-0">
            <Bell className="w-[18px] h-[18px]" />
          </button>

          {/* Center: date + hours */}
          <button
            className="flex-1 flex flex-col items-center leading-none active:opacity-70 transition-opacity"
            onClick={() => setShowDatePicker(true)}
            data-testid="button-current-date"
          >
            <div className="flex items-center gap-1">
              <span className="text-[13px] font-bold text-slate-700">
                {isToday ? "Today" : formatInTz(currentDate, timezone, "EEE, MMM d")}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5">
              {START_HOUR}:00 – {END_HOUR}:00
            </span>
          </button>

          {/* Staff filter */}
          {!isStaffUser ? (
            <Select
              value={selectedStaffId === "all" ? "all" : String(selectedStaffId)}
              onValueChange={(val) => setSelectedStaffId(val === "all" ? "all" : Number(val))}
            >
              <SelectTrigger
                className="w-9 h-9 border-0 shadow-none px-0 bg-transparent [&>svg]:hidden text-slate-400 data-[state=open]:text-slate-700 shrink-0"
                data-testid="select-staff-filter"
              >
                <div className="relative flex items-center justify-center">
                  <ListFilter className="w-[18px] h-[18px]" />
                  {selectedStaffId !== "all" && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-pink-300" />
                  )}
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Staff</SelectItem>
                {staffList?.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="w-9 shrink-0" />
          )}

          {/* View toggle: grid ↔ agenda */}
          <button
            onClick={() => setCalView(v => v === "grid" ? "agenda" : "grid")}
            className="w-9 h-9 flex items-center justify-center rounded-full active:opacity-60 transition-opacity shrink-0"
            aria-label={calView === "grid" ? "Switch to agenda view" : "Switch to grid view"}
          >
            {calView === "grid"
              ? <LayoutList className="w-[18px] h-[18px] text-slate-400" />
              : <CalendarDays className="w-[18px] h-[18px] text-teal-500" />
            }
          </button>
        </div>
      )}

      {/* ── Desktop header ── */}
      {!isMobile && (
      <div className="flex items-center justify-between gap-2 flex-wrap py-2 px-3 border-b bg-card" data-testid="calendar-header">
        <div className="flex items-center gap-2">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon" data-testid="button-back-dashboard">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          {!isStaffUser && (
            <Select
              value={selectedStaffId === "all" ? "all" : String(selectedStaffId)}
              onValueChange={(val) => setSelectedStaffId(val === "all" ? "all" : Number(val))}
            >
              <SelectTrigger className="w-[160px] ml-5" data-testid="select-staff-filter">
                <Users className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="All Staff" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Staff</SelectItem>
                {staffList?.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={goPrev} data-testid="button-prev-day">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <button
            className="text-base font-semibold whitespace-nowrap px-2 rounded-md hover:bg-muted transition-colors"
            onClick={() => setShowDatePicker(true)}
            data-testid="button-current-date"
          >
            {formatInTz(currentDate, timezone, "EEE d MMM, yyyy")}
          </button>
          <div className="hidden lg:flex items-center gap-0.5 ml-2">
            {weekDayLabels.map((wd) => {
              const wdIsToday = isSameDay(wd.date, storeNow);
              const isSelected = isSameDay(wd.date, currentDate);
              return (
                <button
                  key={wd.label + wd.date.toISOString()}
                  className={cn(
                    "flex flex-col items-center px-2.5 py-1 rounded-full transition-colors leading-none gap-0.5",
                    isSelected
                      ? "bg-blue-600 text-white"
                      : wdIsToday
                        ? "bg-blue-100 text-blue-700"
                        : "text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => setCurrentDate(wd.date)}
                  data-testid={`button-weekday-${wd.label.toLowerCase()}`}
                >
                  <span className="text-[11px] font-medium">{wd.label}</span>
                  <span className="text-[10px] font-bold">{formatInTz(wd.date, timezone, "d")}</span>
                </button>
              );
            })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={goToday}
            className="lg:hidden"
            data-testid="button-today"
          >
            Today
          </Button>
          <Button variant="ghost" size="icon" onClick={goNext} data-testid="button-next-day">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle: grid ↔ agenda */}
          <div className="flex items-center rounded-lg border bg-muted/50 p-0.5 gap-0.5">
            <button
              onClick={() => setCalView("grid")}
              aria-label="Grid view"
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-md transition-all",
                calView === "grid"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <CalendarDays className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCalView("agenda")}
              aria-label="Agenda view"
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-md transition-all",
                calView === "agenda"
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutList className="w-4 h-4" />
            </button>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowNewApptMenu(v => !v)}
              data-testid="button-new-appointment"
              aria-label="New appointment"
              className={cn(
                "flex items-center justify-center rounded-full shadow-lg hover:opacity-90 active:scale-95 transition-all duration-100",
                isMobile && "hidden"
              )}
              style={{ width: 44, height: 44, backgroundColor: "#0f172a" }}
            >
              <Plus className="w-5 h-5 text-white" />
            </button>
            {showNewApptMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowNewApptMenu(false)}
                />
                <div
                  className="absolute right-0 top-full mt-2 z-50 bg-card border border-border rounded-lg shadow-xl overflow-hidden"
                  onClick={e => e.stopPropagation()}
                  data-testid="popover-new-appointment-menu"
                >
                  <div className="px-3 py-2 border-b bg-muted/50">
                    <span className="text-xs font-semibold text-foreground">Appointment</span>
                  </div>
                  <div className="p-2 flex flex-col gap-2 min-w-[200px]">
                  <button
                    className="w-full min-h-[56px] px-3 py-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                    onClick={() => {
                      setShowNewApptMenu(false);
                      setLookupMode(false);
                      setSelectedAppointment(null);
                      setShowCancelFlow(false);
                      setShowCheckout(false);
                      setShowClientLookup(true);
                    }}
                    data-testid="button-create-new-appointment"
                  >
                    <CalendarPlus className="w-4 h-4 shrink-0" />
                    <span>BOOK</span>
                  </button>
                  <button
                    className="w-full min-h-[56px] px-3 py-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                    onClick={() => {
                      setShowNewApptMenu(false);
                      setLookupMode(true);
                      setSelectedAppointment(null);
                      setShowCancelFlow(false);
                      setShowCheckout(false);
                      setShowClientLookup(true);
                    }}
                    data-testid="button-lookup-appointment"
                  >
                    <Search className="w-4 h-4 shrink-0" />
                    <span>LOOK UP</span>
                  </button>
                  <button
                    className="w-full min-h-[56px] px-3 py-3 rounded-md border border-border text-sm font-semibold hover:bg-muted transition-colors flex items-center justify-center gap-2"
                    onClick={() => {
                      setShowNewApptMenu(false);
                    }}
                    data-testid="button-cancel-new-appointment-menu"
                  >
                    <span>Cancel</span>
                  </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {/* Collapsible navigation drawer */}
        <nav
          ref={navDrawerRef}
          className={cn(
            "hidden sm:flex flex-shrink-0 border-r border-border/70 bg-card/95 shadow-[4px_0_18px_rgba(15,23,42,0.06)] flex-col items-stretch py-3 gap-1.5 z-30 transition-[width] duration-200 ease-out overflow-hidden",
            navOpen ? "w-44" : "w-16"
          )}
          data-testid="calendar-nav-drawer"
        >
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-label={navOpen ? "Collapse menu" : "Expand menu"}
            data-testid="button-toggle-nav-drawer"
            className="mx-auto mb-1 flex items-center justify-center w-11 h-11 rounded-xl text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
          >
            {navOpen ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </button>
          {calendarSidebarItems.filter((item) => {
            if (!posEnabled) {
              if (item.kind === "action" && (item.action === "quick-checkout" || item.action === "cash-drawer" || item.action === "day-close" || item.action === "open-register")) return false;
              if (item.kind === "link" && (item.to === "/analytics" || item.to === "/reports")) return false;
            }
            return true;
          }).map((item, idx) => {
            const baseClasses = cn(
              "mx-2 flex flex-col items-center justify-center rounded-xl border border-transparent transition-all duration-200 py-2 gap-1",
              navOpen ? "px-2" : "px-0"
            );
            if (item.kind === "action") {
              const isCashDrawer = item.action === "cash-drawer";
              const isDayClose = item.action === "day-close";
              const isOpenRegister = item.action === "open-register";
              return (
                <button
                  key={`action-${idx}`}
                  type="button"
                  onClick={() => {
                    if (isCashDrawer) {
                      setShowCashDrawer(true);
                    } else if (isDayClose) {
                      setShowDayClose(true);
                    } else if (isOpenRegister) {
                      setShowOpenRegister(true);
                    } else {
                      if (!openDrawerSession) {
                        setShowOpenRegister(true);
                      } else {
                        setQuickCheckoutOpen(true);
                      }
                    }
                    setNavOpen(false);
                  }}
                  data-testid={isCashDrawer ? "button-cash-drawer" : isDayClose ? "button-day-close" : isOpenRegister ? "button-open-register" : "button-quick-checkout"}
                  className={cn(
                    baseClasses,
                    isDayClose
                      ? "text-violet-500 hover:border-violet-200/70 hover:bg-violet-50 hover:text-violet-700 hover:shadow-[0_2px_10px_rgba(124,58,237,0.08)]"
                      : isOpenRegister
                      ? "text-emerald-600 hover:border-emerald-200/70 hover:bg-emerald-50 hover:text-emerald-700 hover:shadow-[0_2px_10px_rgba(16,185,129,0.08)]"
                      : "text-muted-foreground hover:border-border/70 hover:bg-background hover:text-foreground hover:shadow-[0_2px_10px_rgba(15,23,42,0.05)]"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {navOpen && (
                    <span className="text-[11px] font-medium leading-tight text-center whitespace-nowrap">
                      {item.label}
                    </span>
                  )}
                </button>
              );
            }
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setNavOpen(false)}
                className={cn(
                  baseClasses,
                  isActive
                    ? "border-primary/10 bg-background text-primary shadow-[0_3px_12px_rgba(15,23,42,0.08)] ring-1 ring-primary/5"
                    : "text-muted-foreground hover:border-border/70 hover:bg-background hover:text-foreground hover:shadow-[0_2px_10px_rgba(15,23,42,0.05)]"
                )}
              >
                <item.icon className="h-5 w-5" />
                {navOpen && (
                  <span className="text-[11px] font-medium leading-tight text-center whitespace-nowrap">
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1 overflow-hidden relative">
          {showCashDrawer && (
            <div
              className="absolute inset-0 z-[48] bg-background"
              data-testid="cash-drawer-overlay"
            >
              <CashDrawerPanel
                embedded
                onClose={() => setShowCashDrawer(false)}
              />
            </div>
          )}

          {/* Open Register modal — triggers at 1 AM ET and on calendar mount when drawer not yet open */}
          {posEnabled && selectedStore && (
            <OpenRegisterModal
              open={showOpenRegister}
              onClose={() => {
                // Track dismissal so we don't re-prompt if they navigate away and back today
                const storageKey = `certxa_drawer_prompted_${selectedStore.id}_${todayET()}`;
                localStorage.setItem(storageKey, "1");
                setShowOpenRegister(false);
              }}
              storeId={selectedStore.id}
              userName={user?.firstName || user?.email || "Staff"}
            />
          )}

          {/* Day Close modal — opened from the toolbar Lock icon */}
          {posEnabled && selectedStore && (
            <DayCloseModal
              open={showDayClose}
              onClose={() => setShowDayClose(false)}
              storeId={selectedStore.id}
              userName={user?.firstName || user?.email || "Staff"}
            />
          )}
          {showJumpToNow && calView === "grid" && (
            <button
              onClick={scrollToNow}
              className="absolute bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold shadow-lg hover:bg-blue-700 transition-colors"
              data-testid="button-jump-to-now"
            >
              <Clock className="w-4 h-4" />
              Now
            </button>
          )}

          {/* ── Weekly Agenda View (all screen sizes) ── */}
          {calView === "agenda" && (
            <div className="absolute inset-0 overflow-hidden" style={isMobile ? { paddingBottom: 72 } : undefined}>
              <WeeklyAgendaView
                appointments={appointments ?? []}
                staffList={staffList ?? []}
                timezone={timezone}
                weekDayLabels={weekDayLabels}
                currentDate={currentDate}
                selectedAppointment={selectedAppointment}
                onSelectAppointment={(apt) => {
                  setSelectedAppointment(apt);
                  setShowCheckout(false);
                  setShowCancelFlow(false);
                }}
                onNewBooking={() => {
                  setLookupMode(false);
                  setSelectedAppointment(null);
                  setShowCancelFlow(false);
                  setShowCheckout(false);
                  setShowClientLookup(true);
                }}
                getStaffColor={getStaffColor}
              />
            </div>
          )}

          {/* ── Grid view (mobile + desktop) ── */}
          {calView === "grid" && (
          <AnimatePresence initial={false} custom={slideDir}>
          <motion.div
            key={currentDate.toISOString().slice(0, 10)}
            ref={scrollContainerRef}
            custom={slideDir}
            initial={((dir: string) => ({ x: dir === 'next' ? '100%' : '-100%' })) as any}
            animate={{ x: 0 }}
            exit={((dir: string) => ({ x: dir === 'next' ? '-100%' : '100%' })) as any}
            transition={{ type: 'tween', ease: [0.25, 0.46, 0.45, 0.94], duration: 0.22 }}
            className={isMobile ? "absolute inset-0 overflow-hidden" : "absolute inset-0 overflow-auto"}
            style={isMobile ? { paddingBottom: 128 } : undefined}
          >
            {isMobile ? (
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
                onSelectAppointment={(apt) => { setSelectedAppointment(apt); setShowCheckout(false); setShowCancelFlow(false); }}
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
                onSelectDate={(date) => { setCurrentDate(date); }}
                onNewBooking={() => {
                  setLookupMode(false);
                  setSelectedAppointment(null);
                  setShowCancelFlow(false);
                  setShowCheckout(false);
                  setShowClientLookup(true);
                }}
                onLookup={() => {
                  setLookupMode(true);
                  setSelectedAppointment(null);
                  setShowCancelFlow(false);
                  setShowCheckout(false);
                  setShowClientLookup(true);
                }}
                selectedStaffId={selectedStaffId}
                onFilterStaff={(id) => setSelectedStaffId(id)}
                onQuickStart={(apt) => handleStartService(apt)}
                onQuickComplete={(apt) => handleComplete(apt)}
                onQuickCancel={(apt) => {
                  setSelectedAppointment(apt);
                  setShowCancelFlow(true);
                  setShowCheckout(false);
                }}
              />
            ) : (
            <div className="flex min-w-[600px] relative">
              {isToday && timeLinePosition !== null && (
                <div
                  className="absolute left-0 right-0 z-[46] pointer-events-none flex items-center -translate-y-1/2"
                  style={{ top: `${timeLinePosition + 88}px` }}
                  data-testid="current-time-line-full"
                >
                  {/* Pill — fills the full 90px time-column so it covers the label beneath */}
                  <div className="w-[90px] flex-shrink-0 flex px-1">
                    <span
                      className="flex-1 inline-flex items-center justify-center rounded-md py-1 text-xs font-bold text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)]"
                      style={{ backgroundColor: "#2563eb" }}
                      data-testid="current-time-label"
                    >
                      {timeLineLabel}
                    </span>
                  </div>
                  {/* Line anchored to pill's right edge */}
                  <div className="flex-1 h-[3px]" style={{ backgroundColor: "#2563eb" }} />
                </div>
              )}
              <div className="w-[90px] flex-shrink-0 bg-card z-30 sticky left-0">
                <div className="h-[88px] border-b sticky top-0 bg-card z-40" />
                <div className="relative" style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}>
                  {Array.from({ length: TOTAL_HOURS * 4 + 1 }, (_, i) => {
                    const totalMins = i * 15;
                    const h = START_HOUR + Math.floor(totalMins / 60);
                    const m = totalMins % 60;
                    if (h > END_HOUR || (h === END_HOUR && m > 0)) return null;
                    if (m !== 0 && m !== 30) return null;
                    const isHour = m === 0;
                    const hMod = h % 24;
                    const displayH = hMod === 0 ? 12 : hMod > 12 ? hMod - 12 : hMod;
                    const ampm = hMod >= 12 ? "PM" : "AM";
                    const timePart = `${displayH}:${String(m).padStart(2, "0")}`;
                    const topPx = (totalMins / 60) * HOUR_HEIGHT;
                    return (
                      <div
                        key={`label-${h}-${m}`}
                        className="absolute left-0 right-0 flex items-center justify-end pr-2 -translate-y-1/2"
                        style={{ top: `${topPx}px` }}
                      >
                        {isHour ? (
                          <span className="text-[11px] font-medium text-slate-500">
                            {timePart}{ampm.toLowerCase()}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400/70">
                            {timePart}
                          </span>
                        )}
                      </div>
                    );
                  })}

                </div>
              </div>

              <div className="flex flex-1 relative" style={{ backgroundColor: "#d9e2ea" }}>

                {filteredStaff.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-20">
                    {staffLoading ? "Loading staff..." : "No staff members found for this store."}
                  </div>
                ) : (
                  <>
                  {filteredStaff.map((member: any, idx: number) => {
                    const staffApts = getAppointmentsForStaff(member.id);
                    const color = getStaffColor(member);

                    return (
                      <div
                        key={member.id}
                        className="flex-none"
                        style={{
                          width: `${STAFF_CALENDAR_COLUMN_WIDTH}px`,
                          minWidth: `${STAFF_CALENDAR_COLUMN_WIDTH}px`,
                          maxWidth: `${STAFF_CALENDAR_COLUMN_WIDTH}px`,
                        }}
                      >
                          <div className="h-[88px] border-b flex flex-col items-center justify-center gap-0.5 px-2 sticky top-0 bg-card z-20">
                            <Avatar className="w-11 h-11">
                              {member.avatarUrl && (
                                <AvatarImage src={member.avatarUrl} alt={member.name} className="object-cover" />
                              )}
                              <AvatarFallback
                                style={{ backgroundColor: color }}
                                className="text-sm font-bold text-white"
                              >
                                {member.name.split(" ").map((n: string) => n[0]).join("").toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-[13px] font-semibold truncate max-w-full leading-tight mt-0.5" data-testid={`text-staff-name-${member.id}`}>
                              {member.name}
                            </span>
                            {businessHoursForDay && !businessHoursForDay.isClosed ? (
                              <span className="text-[10px] text-muted-foreground leading-tight">
                                {formatHourLabel(businessHoursForDay.openTime)} – {formatHourLabel(businessHoursForDay.closeTime)}
                              </span>
                            ) : null}
                          </div>

                        <div
                          className="relative bg-slate-50 border-l last:border-r"
                          style={{
                            height: `${TOTAL_HOURS * HOUR_HEIGHT}px`,
                            borderLeftColor: CALENDAR_COLUMN_SEPARATOR_COLOR,
                            borderRightColor: CALENDAR_COLUMN_SEPARATOR_COLOR,
                          }}
                        >
                          {timeSlots.map((slot) => {
                            const topPx = ((slot.hour - START_HOUR) + slot.minute / 60) * HOUR_HEIGHT;
                            const slotHeight = (settings.timeSlotInterval / 60) * HOUR_HEIGHT;
                            const isSlotSelected =
                              selectedSlot?.staffId === member.id &&
                              selectedSlot?.hour === slot.hour &&
                              selectedSlot?.minute === slot.minute;
                            const slotH = slot.hour > 12 ? slot.hour - 12 : slot.hour === 0 ? 12 : slot.hour;
                            const slotM = String(slot.minute).padStart(2, "0");
                            const slotAmpm = slot.hour >= 12 ? "PM" : "AM";
                            const slotLabel = `${slotH}:${slotM} ${slotAmpm}`;
                            return (
                              <div
                                key={`${slot.hour}-${slot.minute}`}
                                className={cn(
                                  "absolute left-0 right-0 border-b-[4px] cursor-pointer transition-colors border-border",
                                  isSlotSelected
                                    ? "bg-blue-100 dark:bg-blue-950/60"
                                    : "hover:bg-primary/5"
                                )}
                                style={{
                                  top: `${topPx}px`,
                                  height: `${slotHeight}px`,
                                }}
                                onClick={() => handleSlotClick(member.id, slot.hour, slot.minute)}
                                data-testid={`calendar-slot-${member.id}-${slot.hour}-${slot.minute}`}
                              >
                                {isSlotSelected && (
                                  <div
                                    className="absolute z-50 bg-card border border-border rounded-lg shadow-xl overflow-hidden"
                                    style={{ top: 0, left: "calc(100% + 6px)", minWidth: "180px" }}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <div className="px-3 py-2 border-b bg-muted/50">
                                      <span className="text-xs font-semibold text-foreground">{slotLabel}</span>
                                    </div>
                                    <div className="p-1.5 flex flex-col gap-1">
                                      <button
                                        className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleBookSlot(member.id, slot.hour, slot.minute);
                                        }}
                                        data-testid={`book-slot-btn-${member.id}-${slot.hour}-${slot.minute}`}
                                      >
                                        Create New Appointment
                                      </button>
                                      <button
                                        className="w-full px-3 py-2 rounded-md border border-border text-xs font-semibold hover:bg-muted transition-colors"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedSlot(null);
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {staffApts.map((apt: any) => {
                            const style = getAppointmentStyle(apt);
                            const startTime = formatInTz(apt.date, timezone, "h:mm");
                            const endTime = formatInTz(addMinutes(new Date(apt.date), apt.duration), timezone, "h:mm a");
                            const isSelected = selectedAppointment?.id === apt.id;

                            // Band color by status
                            const bandColor =
                              apt.status === "completed" ? "#9ca3af"
                              : apt.status === "started" ? "#22c55e"
                              : apt.status === "late" ? "#fb923c"
                              : apt.status === "no_show" ? "#fb7185"
                              : "#3b82f6"; // pending / confirmed / default = booked (blue)

                            const isLocked = apt.status === "completed";

                            // Band side: left = staff/store booked, right = online booked
                            // apt.source === "online" would indicate online booking (stub: always left for now)
                            const isOnlineBooking = apt.source === "online";

                            const aptAddons = apt.appointmentAddons?.map((aa: any) => aa.addon).filter(Boolean) || [];
                            const addonTotal = aptAddons.reduce((sum: number, a: any) => sum + Number(a.price), 0);
                            const serviceTotal = Number(apt.service?.price || 0) + addonTotal;

                            const aptMinutesPastStart = Math.floor(
                              (Date.now() - new Date(apt.date).getTime()) / 60000,
                            );
                            const isAptOverdue =
                              aptMinutesPastStart >= lateGracePeriodMinutes &&
                              (apt.status === "pending" || apt.status === "confirmed");

                            // Pastel background palette matching the reference design
                            const pastelBg =
                              apt.status === "completed" ? "#f1f5f9"
                              : apt.status === "started" ? "#dcfce7"
                              : apt.status === "late" ? "#fef9c3"
                              : apt.status === "no_show" ? "#fce7f3"
                              : isOnlineBooking ? "#e0f2fe"
                              : "#fef9c3";

                            const pastelBorder =
                              apt.status === "completed" ? "#cbd5e1"
                              : apt.status === "started" ? "#86efac"
                              : apt.status === "late" ? "#fde047"
                              : apt.status === "no_show" ? "#f9a8d4"
                              : isOnlineBooking ? "#7dd3fc"
                              : "#fde047";

                            const effectiveBg = isAptOverdue ? "#fef2f2" : pastelBg;
                            const effectiveBorder = isAptOverdue ? "#fca5a5" : pastelBorder;

                            return (
                              <div
                                key={apt.id}
                                className={cn(
                                  "absolute left-1 right-1 rounded-lg overflow-hidden cursor-pointer z-[5] transition-shadow hover:shadow-md",
                                  isLocked && "opacity-75",
                                )}
                                style={{
                                  ...style,
                                  backgroundColor: effectiveBg,
                                  border: `1px solid ${effectiveBorder}`,
                                  ...(isSelected ? { boxShadow: `0 0 0 2px ${isAptOverdue ? "#ef4444" : bandColor}` } : {}),
                                }}
                                onClick={() => { setSelectedAppointment(apt); setShowCheckout(false); setShowCancelFlow(false); }}
                                data-testid={`appointment-block-${apt.id}`}
                              >
                                <div className="px-2 py-1.5 overflow-hidden flex flex-col min-h-0 gap-0.5">
                                  {/* Row 1: time range + status dot */}
                                  <div className="flex items-start justify-between gap-1">
                                    <span className="text-[10px] font-medium text-gray-600 leading-tight">{startTime} – {endTime}</span>
                                    <span
                                      className="flex-shrink-0 w-2 h-2 rounded-full mt-0.5"
                                      style={{ backgroundColor: isAptOverdue ? "#ef4444" : bandColor }}
                                    />
                                  </div>

                                  {/* Client name — prominent */}
                                  <div className="text-[11px] font-bold text-gray-900 truncate leading-tight">
                                    {apt.customer?.name || "Walk-In"}
                                  </div>

                                  {/* Service name */}
                                  <div className="text-[10px] font-medium text-gray-700 truncate leading-tight">
                                    {apt.service?.name || "Service"}
                                  </div>

                                  {/* Addons */}
                                  {aptAddons.map((addon: any) => (
                                    <div key={addon.id} className="text-[10px] text-gray-500 truncate leading-tight" data-testid={`calendar-addon-${addon.id}`}>
                                      + {addon.name}
                                    </div>
                                  ))}

                                  {/* Price */}
                                  {showPrices && (
                                    <div className="mt-auto pt-0.5 flex items-center justify-between gap-1">
                                      <span className="text-[10px] font-semibold text-gray-700">$ {serviceTotal.toFixed(2)}</span>
                                      {isLocked && (
                                        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 bg-white/70 px-1 py-0.5 rounded">
                                          Paid
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex-1 sticky top-0 h-[88px] bg-card border-b z-[5] self-start" />
                  </>
                )}
              </div>
            </div>
            )}
          </motion.div>
          </AnimatePresence>
          )}
        </div>

        <Sheet open={quickCheckoutOpen} onOpenChange={setQuickCheckoutOpen}>
          <SheetContent
            side="left"
            className="w-[340px] sm:w-[360px] p-0 flex flex-col gap-0"
          >
            <SheetHeader className="px-4 py-3 border-b">
              <SheetTitle className="text-base font-bold flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                Quick Cash Out
              </SheetTitle>
              <p className="text-xs text-muted-foreground text-left">
                {format(currentDate, "EEE MMM d")} · Tap a ticket to open
              </p>
            </SheetHeader>

            <div className="flex justify-center border-b">
              <button
                type="button"
                onClick={() => quickListRef.current?.scrollBy({ top: -240, behavior: "smooth" })}
                data-testid="button-quick-scroll-up"
                className="flex-1 h-12 flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground hover:bg-muted active:bg-muted/70 transition-colors"
              >
                <ChevronUp className="w-5 h-5" />
                Up
              </button>
            </div>

            <div ref={quickListRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
              {(() => {
                const todayAppts = (appointments || []).filter((apt: any) => {
                  if (apt.status !== "started") return false;
                  const localDate = toStoreLocal(apt.date, timezone);
                  return isSameDay(localDate, currentDate);
                });

                if (todayAppts.length === 0) {
                  return (
                    <div className="text-center py-12 text-sm text-muted-foreground">
                      No checked-in clients
                    </div>
                  );
                }

                const byStaff = new Map<number, any[]>();
                for (const apt of todayAppts) {
                  if (!byStaff.has(apt.staffId)) byStaff.set(apt.staffId, []);
                  byStaff.get(apt.staffId)!.push(apt);
                }

                const orderedStaff = (staffList || []).filter((s: any) =>
                  byStaff.has(s.id),
                );

                return orderedStaff.map((staffMember: any) => {
                  const list = (byStaff.get(staffMember.id) || []).sort(
                    (a: any, b: any) => {
                      const aAddons = (a.appointmentAddons || []).reduce(
                        (s: number, aa: any) => s + (aa.addon?.duration || 0),
                        0,
                      );
                      const bAddons = (b.appointmentAddons || []).reduce(
                        (s: number, aa: any) => s + (aa.addon?.duration || 0),
                        0,
                      );
                      const aDur = (a.duration || 0) + aAddons;
                      const bDur = (b.duration || 0) + bAddons;
                      return aDur - bDur;
                    },
                  );
                  return (
                    <div key={staffMember.id}>
                      <div className="flex items-center gap-2 px-1 mb-2">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={staffMember.profilePicture || undefined} />
                          <AvatarFallback
                            className="text-[11px] font-bold text-white"
                            style={{ backgroundColor: getStaffColor(staffMember) }}
                          >
                            {staffMember.name?.[0]?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-bold text-sm">{staffMember.name}</span>
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {list.length} {list.length === 1 ? "ticket" : "tickets"}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {list.map((apt: any) => {
                          const localDate = toStoreLocal(apt.date, timezone);
                          const timeStr = format(localDate, "h:mm a");
                          const customerFirst =
                            (apt.customer?.name || "").trim().split(/\s+/)[0] || "";
                          const isPaid = apt.status === "completed" || apt.paymentStatus === "paid";
                          const aptAddonsDur = (apt.appointmentAddons || []).reduce(
                            (s: number, aa: any) => s + (aa.addon?.duration || 0),
                            0,
                          );
                          const totalDur = (apt.duration || 0) + aptAddonsDur;
                          const startedAt = apt.startedAt ? new Date(apt.startedAt).getTime() : null;
                          const elapsedMin = startedAt ? Math.max(0, Math.floor((nowTick - startedAt) / 60000)) : 0;
                          const overBy = totalDur > 0 ? elapsedMin - totalDur : 0;
                          const elapsedLabel = elapsedMin >= 60
                            ? `${Math.floor(elapsedMin / 60)}h ${elapsedMin % 60}m`
                            : `${elapsedMin}m`;
                          const elapsedClass = overBy > 0
                            ? "bg-red-100 text-red-700 border-red-300"
                            : elapsedMin >= totalDur * 0.75 && totalDur > 0
                              ? "bg-amber-100 text-amber-700 border-amber-300"
                              : "bg-emerald-100 text-emerald-700 border-emerald-300";
                          return (
                            <button
                              key={apt.id}
                              type="button"
                              data-testid={`quick-ticket-${apt.id}`}
                              onClick={() => {
                                setSelectedAppointment(apt);
                                setShowCheckout(false);
                                setShowCancelFlow(false);
                                setQuickCheckoutOpen(false);
                              }}
                              className="w-full text-left rounded-lg border bg-card hover:bg-muted active:bg-muted/70 transition-colors p-3 flex items-center gap-3"
                              style={{
                                borderLeft: `4px solid ${getStaffColor(staffMember)}`,
                              }}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-sm truncate">
                                  {customerFirst || "Walk-In"}
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                  {timeStr}
                                  {apt.services?.[0]?.name
                                    ? ` · ${apt.services[0].name}`
                                    : ""}
                                </div>
                              </div>
                              {startedAt && (
                                <span
                                  className={cn(
                                    "text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums",
                                    elapsedClass,
                                  )}
                                  data-testid={`quick-ticket-elapsed-${apt.id}`}
                                  title={totalDur > 0 ? `Booked for ${totalDur}m` : undefined}
                                >
                                  {elapsedLabel}
                                </span>
                              )}
                              {isPaid ? (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                  Paid
                                </Badge>
                              ) : (
                                <DollarSign className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="flex justify-center border-t">
              <button
                type="button"
                onClick={() => quickListRef.current?.scrollBy({ top: 240, behavior: "smooth" })}
                data-testid="button-quick-scroll-down"
                className="flex-1 h-12 flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground hover:bg-muted active:bg-muted/70 transition-colors"
              >
                <ChevronDown className="w-5 h-5" />
                Down
              </button>
            </div>
          </SheetContent>
        </Sheet>

        {selectedAppointment && !showCancelFlow && !showCheckout && (
          <AppointmentDetailsPanel
            appointment={selectedAppointment}
            timezone={timezone}
            onClose={() => setSelectedAppointment(null)}
            onCancel={() => handleCancelAppointment(selectedAppointment)}
            onStart={() => handleStartService(selectedAppointment)}
            onCheckout={() => handleCheckout(selectedAppointment)}
            onComplete={() => handleComplete(selectedAppointment)}
            onEdit={() => navigate(`/booking/new?editId=${selectedAppointment.id}`)}
            onReschedule={() => navigate(`/booking/new?editId=${selectedAppointment.id}&reschedule=1`)}
            onMarkNoShow={() => handleMarkNoShow(selectedAppointment)}
            lateGraceMinutes={lateGracePeriodMinutes}
            isUpdating={updateAppointment.isPending}
            posEnabled={posEnabled}
            showPrices={showPrices}
          />
        )}

        {selectedAppointment && showCancelFlow && (
          <CancelAppointmentPanel
            appointment={selectedAppointment}
            timezone={timezone}
            onClose={() => setShowCancelFlow(false)}
            onConfirmCancel={(reason) => handleConfirmCancel(selectedAppointment, reason)}
            isUpdating={updateAppointment.isPending}
          />
        )}

        {selectedAppointment && showCheckout && (
          <CheckoutPOSPanel
            appointment={selectedAppointment}
            timezone={timezone}
            onClose={() => { setShowCheckout(false); }}
            onFinalize={(paymentData) => handleFinalizePayment(selectedAppointment, paymentData)}
            isUpdating={updateAppointment.isPending}
          />
        )}

        {showDatePicker && (
          <MonthCalendarOverlay
            selectedDate={currentDate}
            timezone={timezone}
            appointments={appointments || []}
            onSelectDate={(date) => {
              setCurrentDate(date);
              setShowDatePicker(false);
            }}
            onSelectAppointment={(apt) => {
              setSelectedAppointment(apt);
              setShowDatePicker(false);
            }}
            onClose={() => setShowDatePicker(false)}
          />
        )}

        {showClientLookup && (
          <ChooseClientPanel
            walkInsEnabled={(calSettings as any)?.walkInsEnabled ?? true}
            onClose={() => setShowClientLookup(false)}
            onSelectClient={(clientId) => {
              setShowClientLookup(false);
              if (lookupMode) {
                const now = Date.now();
                const clientAppts = (appointments || []).filter(
                  (apt: any) => apt.customerId === clientId,
                );
                const upcoming = clientAppts
                  .filter((apt: any) => new Date(apt.date).getTime() + (apt.duration || 0) * 60000 >= now)
                  .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
                const target = upcoming[0]
                  || clientAppts.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
                if (target) {
                  setSelectedAppointment(target);
                  setShowCancelFlow(false);
                  setShowCheckout(false);
                } else {
                  toast({
                    title: "No appointments found",
                    description: "This client has no appointments to look up.",
                  });
                }
                setLookupMode(false);
              } else {
                navigate(`/booking/new?clientId=${clientId}`);
              }
            }}
            onWalkIn={() => {
              setShowClientLookup(false);
              if (lookupMode) {
                setLookupMode(false);
                return;
              }
              navigate("/booking/new?walkIn=1");
            }}
          />
        )}
      </div>
      {isMobile && <MobileBottomNav />}
    </div>
  );
}

interface FillSlotCandidate {
  customerId: number;
  customerName: string;
  customerPhone: string | null;
  lastVisitDate: string | null;
  daysSinceLast: number | null;
  preferredService: string | null;
  preferredStaff: string | null;
  suggestedMessage: string;
  priority: "high" | "medium" | "low";
}

function FillSlotSection({
  appointment,
  storeId,
}: {
  appointment: AppointmentWithDetails;
  storeId: number;
}) {
  const [sentIds, setSentIds] = useState<Set<number>>(new Set());
  const [sendingId, setSendingId] = useState<number | null>(null);
  const { toast: fillToast } = useToast();

  const { data: candidates, isLoading } = useQuery<FillSlotCandidate[]>({
    queryKey: ["/api/intelligence/cancellation-recovery", appointment.id, storeId],
    queryFn: async () => {
      const res = await fetch(
        `/api/intelligence/cancellation-recovery/${appointment.id}?storeId=${storeId}`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!appointment.id && !!storeId,
    staleTime: 5 * 60 * 1000,
  });

  const handleSend = async (candidate: FillSlotCandidate) => {
    setSendingId(candidate.customerId);
    try {
      const res = await fetch("/api/intelligence/fill-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          storeId,
          customerId: candidate.customerId,
          message: candidate.suggestedMessage,
          cancelledAppointmentId: appointment.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSentIds(prev => new Set([...prev, candidate.customerId]));
        fillToast({ title: "Message sent!", description: `${candidate.customerName} has been notified about the open slot.` });
      } else {
        fillToast({ title: "Could not send", description: data.error || "Failed to send SMS.", variant: "destructive" });
      }
    } catch {
      fillToast({ title: "Failed to send", variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  };

  const priorityConfig: Record<string, { bg: string; text: string; label: string }> = {
    high: { bg: "bg-red-50 border-red-200", text: "text-red-700", label: "High" },
    medium: { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", label: "Mid" },
    low: { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", label: "Low" },
  };

  return (
    <div className="pt-3 border-t space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-500 flex-shrink-0" />
        <span className="text-sm font-semibold">Fill this slot</span>
        {!isLoading && candidates && candidates.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {Math.min(candidates.length, 3)} match{Math.min(candidates.length, 3) !== 1 ? "es" : ""}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Finding candidates…
        </div>
      )}

      {!isLoading && (!candidates || candidates.length === 0) && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          No matching candidates found — consider posting about the opening or checking your waitlist.
        </p>
      )}

      {!isLoading && candidates && candidates.slice(0, 3).map((candidate) => {
        const isSent = sentIds.has(candidate.customerId);
        const isSending = sendingId === candidate.customerId;
        const pc = priorityConfig[candidate.priority] || priorityConfig.low;
        const hasPhone = !!candidate.customerPhone;

        return (
          <div
            key={candidate.customerId}
            className={cn(
              "rounded-lg border p-3 space-y-2 transition-colors",
              isSent ? "bg-emerald-50 border-emerald-200" : "bg-muted/40 border-border"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
                  {candidate.customerName[0]?.toUpperCase() || "?"}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate leading-tight">{candidate.customerName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {candidate.daysSinceLast !== null
                      ? `${candidate.daysSinceLast}d since last visit`
                      : "First-time candidate"}
                  </p>
                </div>
              </div>
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0",
                pc.bg, pc.text
              )}>
                {pc.label}
              </span>
            </div>

            <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed italic">
              "{candidate.suggestedMessage.split("\n")[0]}"
            </p>

            <Button
              size="sm"
              className={cn(
                "w-full h-8 text-xs font-semibold gap-1.5",
                isSent
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : hasPhone
                  ? "bg-amber-500 hover:bg-amber-600 text-white"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
              onClick={() => !isSent && hasPhone && handleSend(candidate)}
              disabled={isSent || isSending || !hasPhone}
            >
              {isSent ? (
                <><Check className="h-3.5 w-3.5" /> Sent ✓</>
              ) : isSending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
              ) : !hasPhone ? (
                "No phone on file"
              ) : (
                <><Send className="h-3.5 w-3.5" /> Send Message</>
              )}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function AppointmentDetailsPanel({
  appointment,
  timezone,
  onClose,
  onCancel,
  onStart,
  onCheckout,
  onComplete,
  onEdit,
  onReschedule,
  onMarkNoShow,
  lateGraceMinutes,
  isUpdating,
  posEnabled,
  showPrices,
}: {
  appointment: AppointmentWithDetails;
  timezone: string;
  onClose: () => void;
  onCancel: () => void;
  onStart: () => void;
  onCheckout: () => void;
  onComplete: () => void;
  onEdit: () => void;
  onReschedule: () => void;
  onMarkNoShow: () => void;
  lateGraceMinutes: number;
  isUpdating: boolean;
  posEnabled: boolean;
  showPrices: boolean;
}) {
  const minutesPastStart = Math.floor(
    (Date.now() - new Date(appointment.date).getTime()) / 60000,
  );
  const isOverdue =
    minutesPastStart >= lateGraceMinutes &&
    (appointment.status === "pending" || appointment.status === "confirmed");
  const localDate = toStoreLocal(appointment.date, timezone);
  const isAppointmentToday = isSameDay(localDate, getNowInTimezone(timezone)) && minutesPastStart >= -60;
  const endTime = addMinutes(new Date(appointment.date), appointment.duration);
  const dateStr = formatInTz(appointment.date, timezone, "EEEE, d MMM yyyy");
  const timeStr = `${formatInTz(appointment.date, timezone, "h:mm a")} - ${formatInTz(endTime, timezone, "h:mm a")}`;

  const { data: availableTimeData } = useQuery<{ availableMinutes: number }>({
    queryKey: ["/api/appointments", appointment.id, "available-time"],
    queryFn: async () => {
      const res = await fetch(`/api/appointments/${appointment.id}/available-time`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch available time");
      return res.json();
    },
    staleTime: 30 * 1000,
  });

  const { selectedStore: detailStore } = useSelectedStore();
  const { data: clientIntel } = useQuery<any>({
    queryKey: ["/api/intelligence/client", appointment.customerId, detailStore?.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/intelligence/client/${appointment.customerId}?storeId=${detailStore?.id}`,
        { credentials: "include" }
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!appointment.customerId && !!detailStore?.id,
    staleTime: 5 * 60 * 1000,
  });
  const intel = clientIntel?.intel;

  const { toast: detailToast } = useToast();
  const [reviewSent, setReviewSent] = useState(false);
  const [reviewSending, setReviewSending] = useState(false);

  const handleSendReview = async () => {
    setReviewSending(true);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/send-review-request`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setReviewSent(true);
        detailToast({ title: "Review request sent!", description: "Your client will receive a text shortly." });
      } else {
        detailToast({ title: "Could not send", description: data.error || "Review requests require SMS enabled with a Google review URL.", variant: "destructive" });
      }
    } catch {
      detailToast({ title: "Failed to send", variant: "destructive" });
    } finally {
      setReviewSending(false);
    }
  };

  const statusMap: Record<string, { label: string; variant: "destructive" | "secondary"; color: string }> = {
    pending: { label: "Booked", variant: "secondary", color: "#3b82f6" },
    confirmed: { label: "Booked", variant: "secondary", color: "#3b82f6" },
    started: { label: "Started", variant: "secondary", color: "#22c55e" },
    cancelled: { label: "Cancelled", variant: "destructive", color: "#ef4444" },
    completed: { label: "Completed", variant: "secondary", color: "#22c55e" },
    "no_show": { label: "No-Show", variant: "destructive", color: "#ef4444" },
  };
  const statusInfo = statusMap[appointment.status || "pending"] || statusMap.pending;
  const statusLabel = statusInfo.label;
  const statusVariant = statusInfo.variant;
  const progressColor = statusInfo.color;

  const aptAddons = appointment.appointmentAddons?.map(aa => aa.addon).filter(Boolean) || [];
  const addonTotal = aptAddons.reduce((sum, a) => sum + Number(a!.price), 0);
  const grandTotal = Number(appointment.service?.price || 0) + addonTotal;

  const formatPhone = (phone: string | null | undefined) => {
    if (!phone) return "";
    const d = phone.replace(/\D/g, "");
    if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
    if (d.length === 11 && d[0] === "1") return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
    return phone;
  };

  const panelDragStartY = useRef<number | null>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="fixed inset-0 z-50" data-testid="appointment-details-panel">
      <button
        type="button"
        aria-label="Close appointment details"
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className={cn(
        "absolute right-0 top-0 h-full w-full sm:w-[460px] bg-card flex flex-col shadow-[-8px_0_24px_rgba(0,0,0,0.12)] border-l",
        isOverdue && "ring-2 ring-red-400 ring-inset",
      )}
        onTouchStart={(e) => {
          const scrollTop = panelScrollRef.current?.scrollTop ?? 0;
          if (scrollTop === 0) {
            panelDragStartY.current = e.touches[0].clientY;
          } else {
            panelDragStartY.current = null;
          }
        }}
        onTouchEnd={(e) => {
          if (panelDragStartY.current === null) return;
          const dy = e.changedTouches[0].clientY - panelDragStartY.current;
          panelDragStartY.current = null;
          if (dy > 80) onClose();
        }}
      >
      {/* Mobile swipe-down handle */}
      <div className="sm:hidden flex justify-center pt-2 pb-0 flex-shrink-0">
        <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
      </div>
      {isOverdue && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center gap-2 text-red-700 text-sm font-semibold" data-testid="overdue-banner">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>Client is {minutesPastStart} min late · check them in or mark as no-show</span>
        </div>
      )}
      {appointment.status === "cancelled" && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-amber-700 text-sm font-semibold">
          <Zap className="w-4 h-4 flex-shrink-0" />
          <span>Slot is open — find someone to fill it below</span>
        </div>
      )}
      <div className="p-4 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9">
            <AvatarFallback className="text-sm font-bold bg-muted">
              {appointment.customer?.name?.[0]?.toUpperCase() || "W"}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-bold text-base leading-tight" data-testid="text-detail-customer">
              {appointment.customer?.name || "Walk-In"}
            </p>
            {appointment.customer?.phone && (
              <p className="text-xs text-muted-foreground mt-0.5">{formatPhone(appointment.customer.phone)}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant} className="no-default-active-elevate text-[10px]" data-testid="badge-detail-status">
            {statusLabel}
          </Badge>
          <button onClick={onClose} className="text-muted-foreground ml-1" data-testid="button-close-details">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div ref={panelScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold" data-testid="text-detail-date">{dateStr}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-sm font-bold text-foreground" data-testid="text-detail-time">{timeStr}</span>
            </div>
          </div>
          <div className="flex-shrink-0 border-2 border-gray-200 rounded-lg px-3 py-1.5 bg-white">
            <span className="text-sm font-bold text-gray-900">{appointment.duration}m</span>
          </div>
        </div>

        <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full" style={{ width: "100%", backgroundColor: progressColor }} />
        </div>

        <div className="space-y-2 mt-[25px]">
          {/* Staff tag above service line */}
          {appointment.staff && (
            <Badge variant="outline" className="no-default-active-elevate text-[10px] px-1.5" data-testid="badge-detail-staff">
              {appointment.staff.name}
            </Badge>
          )}

          {/* Service row: name · duration on left, price on right */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h4 className="font-semibold text-sm truncate" data-testid="text-detail-service">{appointment.service?.name || "Service"}</h4>
              <span className="text-xs text-muted-foreground flex-shrink-0">({appointment.service?.duration || appointment.duration}m)</span>
            </div>
            {showPrices && (
              <span className="text-sm font-normal text-gray-800" data-testid="text-detail-price">
                ${appointment.service?.price ? Number(appointment.service.price).toFixed(2) : "0.00"}
              </span>
            )}
          </div>

          {/* Addons — same font size as service */}
          {aptAddons.length > 0 && (
            <div className="space-y-1.5 pl-3 border-l-2 border-muted" data-testid="detail-addons-list">
              {aptAddons.map((addon: any) => (
                <div key={addon.id} className="flex items-center justify-between gap-2" data-testid={`detail-addon-${addon.id}`}>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-sm font-medium truncate">+ {addon.name}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">({addon.duration}m)</span>
                  </div>
                  {showPrices && <span className="text-sm font-normal text-gray-800">${Number(addon.price).toFixed(2)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {availableTimeData && (
          <AvailableTimeBanner availableMinutes={availableTimeData.availableMinutes} />
        )}

        {appointment.notes && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">{appointment.notes}</p>
          </div>
        )}

        {/* ── Client Intelligence strip ── */}
        {intel && appointment.customerId && (
          <div className="pt-2 border-t space-y-2">
            {/* No-show / churn risk */}
            {(intel.noShowRisk === "high" || intel.churnRisk === "high" || intel.churnRisk === "critical") && (
              <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs font-medium ${
                intel.churnRisk === "critical" || intel.noShowRisk === "high"
                  ? "bg-red-50 border-red-200 text-red-700"
                  : "bg-amber-50 border-amber-200 text-amber-700"
              }`}>
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  {intel.churnRisk === "critical"
                    ? "At-risk client — hasn't visited in a while"
                    : intel.noShowRisk === "high"
                    ? "High no-show risk — consider confirming"
                    : "Drifting — cadence slipping"}
                </span>
              </div>
            )}

            {/* LTV + visit cadence */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {intel.lifetimeValue > 0 && (
                <span className="flex items-center gap-1">
                  <span className="font-medium text-foreground">${Math.round(intel.lifetimeValue).toLocaleString()}</span>
                  LTV
                </span>
              )}
              {intel.avgVisitCadenceDays > 0 && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="flex items-center gap-1">
                    every <span className="font-medium text-foreground">{intel.avgVisitCadenceDays}d</span>
                  </span>
                </>
              )}
              {intel.totalVisits > 0 && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <span><span className="font-medium text-foreground">{intel.totalVisits}</span> visits</span>
                </>
              )}
              {/* Predicted next visit */}
              {intel.avgVisitCadenceDays > 0 && intel.lastVisitDate && (() => {
                const last = new Date(intel.lastVisitDate);
                const predicted = new Date(last.getTime() + intel.avgVisitCadenceDays * 24 * 60 * 60 * 1000);
                const daysUntil = Math.round((predicted.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                if (daysUntil < -14 || daysUntil > 60) return null;
                const label = daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : daysUntil === 0 ? "due today" : `due in ${daysUntil}d`;
                return (
                  <>
                    <span className="text-muted-foreground/30">·</span>
                    <span className={`flex items-center gap-1 ${daysUntil < 0 ? "text-amber-600 font-medium" : ""}`}>
                      <CalendarDays className="h-3 w-3" />
                      {label}
                    </span>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Fill Slot — shown for cancelled appointments ── */}
        {appointment.status === "cancelled" && detailStore?.id && (
          <FillSlotSection appointment={appointment} storeId={detailStore.id} />
        )}
      </div>

      <div
        className="border-t p-4 space-y-3 md:pb-4"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
      >
        {showPrices && (
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold">Total</span>
            </div>
            <div className="text-right">
              <span className="font-bold text-lg" data-testid="text-detail-total">
                ${grandTotal.toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* Cancelled footer — book a new client into the same slot */}
        {appointment.status === "cancelled" && (
          <Button
            variant="outline"
            className="w-full gap-2 font-semibold border-amber-400 text-amber-700 hover:bg-amber-50"
            onClick={() => {
              const params = new URLSearchParams();
              if (appointment.staffId) params.set("staffId", String(appointment.staffId));
              if (appointment.serviceId) params.set("serviceId", String(appointment.serviceId));
              const d = new Date(appointment.date);
              params.set("date", d.toISOString().split("T")[0]);
              params.set("hour", String(d.getHours()));
              params.set("minute", String(d.getMinutes()));
              window.location.href = `/booking/new?${params.toString()}`;
            }}
          >
            <CalendarPlus className="h-4 w-4" />
            Book New Client into this Slot
          </Button>
        )}

        {/* Review Request — shown for completed appointments with a phone number */}
        {appointment.status === "completed" && appointment.customer?.phone && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className={`flex-1 gap-2 font-semibold transition-colors ${reviewSent ? "border-emerald-500 text-emerald-700 hover:bg-emerald-50" : "border-violet-400 text-violet-700 hover:bg-violet-50"}`}
              onClick={handleSendReview}
              disabled={reviewSending || reviewSent}
              data-testid="button-send-review-request"
            >
              <Star className="h-4 w-4" />
              {reviewSent ? "Review Request Sent ✓" : reviewSending ? "Sending…" : "Request a Review"}
            </Button>
            <Button
              variant="outline"
              className="flex-1 gap-2 font-semibold border-emerald-400 text-emerald-700 hover:bg-emerald-50"
              onClick={() => {
                const params = new URLSearchParams();
                if (appointment.customerId) params.set("customerId", String(appointment.customerId));
                if (appointment.staffId) params.set("staffId", String(appointment.staffId));
                if (appointment.serviceId) params.set("serviceId", String(appointment.serviceId));
                window.location.href = `/booking/new?${params.toString()}`;
              }}
            >
              <CalendarPlus className="h-4 w-4" />
              Rebook
            </Button>
          </div>
        )}

        {appointment.status !== "cancelled" && appointment.status !== "completed" && appointment.status !== "no_show" && (
          <>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-2 border-gray-400 text-gray-800 hover:border-gray-600 hover:bg-gray-50 font-semibold"
                onClick={onEdit}
                data-testid="button-edit-appointment"
              >
                Edit
              </Button>
              <Button
                variant="outline"
                className="flex-1 text-destructive border-destructive/30"
                onClick={onCancel}
                disabled={isUpdating}
                data-testid="button-cancel-appointment"
              >
                {isUpdating ? "Updating..." : "Cancel Appointment"}
              </Button>
            </div>

            <Button
              variant="outline"
              className="w-full border-2 border-amber-500 text-amber-700 hover:bg-amber-50 font-semibold"
              onClick={onReschedule}
              disabled={isUpdating}
              data-testid="button-reschedule-appointment"
            >
              Reschedule
            </Button>

            {appointment.status === "started" ? (
              posEnabled ? (
                <Button
                  className="w-full bg-green-600 text-white h-12"
                  onClick={onCheckout}
                  disabled={isUpdating}
                  data-testid="button-checkout"
                >
                  <span className="flex flex-col items-center leading-tight">
                    <span className="font-semibold">Checkout</span>
                    <span className="text-[10px] opacity-80">Finish Appointment</span>
                  </span>
                </Button>
              ) : (
                <Button
                  className="w-full bg-green-600 text-white h-12"
                  onClick={onComplete}
                  disabled={isUpdating}
                  data-testid="button-complete"
                >
                  <span className="flex flex-col items-center leading-tight">
                    <span className="font-semibold">Complete</span>
                    <span className="text-[10px] opacity-80">Mark as Done</span>
                  </span>
                </Button>
              )
            ) : isAppointmentToday ? (
              <div className="flex gap-2">
                <Button
                  className="flex-1 bg-blue-600 text-white h-12"
                  onClick={onStart}
                  disabled={isUpdating}
                  data-testid="button-start-service"
                >
                  <span className="flex flex-col items-center leading-tight">
                    <span className="font-semibold">Start</span>
                    <span className="text-[10px] opacity-80">Begin Service</span>
                  </span>
                </Button>
                {isOverdue && (
                  <Button
                    variant="outline"
                    className="flex-1 h-12 border-2 border-red-500 text-red-700 hover:bg-red-50 font-semibold"
                    onClick={onMarkNoShow}
                    disabled={isUpdating}
                    data-testid="button-mark-no-show"
                  >
                    <span className="flex flex-col items-center leading-tight">
                      <span className="font-semibold">No-Show</span>
                      <span className="text-[10px] opacity-80">Mark Did Not Arrive</span>
                    </span>
                  </Button>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
      </div>
    </div>
  );
}

const CANCEL_REASONS = [
  "Client Canceled",
  "Duplicated Booking",
  "No Show",
  "Other",
];

function CancelAppointmentPanel({
  appointment,
  timezone,
  onClose,
  onConfirmCancel,
  isUpdating,
}: {
  appointment: AppointmentWithDetails;
  timezone: string;
  onClose: () => void;
  onConfirmCancel: (reason: string) => void;
  isUpdating: boolean;
}) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);

  const endTime = addMinutes(new Date(appointment.date), appointment.duration);
  const dateStr = formatInTz(appointment.date, timezone, "MM/dd/yyyy, h:mm a");
  const grandTotal = Number(appointment.service?.price || 0) +
    (appointment.appointmentAddons?.reduce((sum, aa) => sum + Number(aa.addon?.price || 0), 0) || 0);

  return (
    <div className="fixed inset-0 z-50" data-testid="cancel-appointment-panel">
      <button
        type="button"
        aria-label="Close cancel appointment"
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[380px] bg-card flex flex-col shadow-[-8px_0_24px_rgba(0,0,0,0.12)] border-l">
      <div className="p-4 border-b flex items-center justify-between gap-2">
        <h2 className="font-semibold text-lg">Cancel Appointment</h2>
        <button onClick={onClose} className="text-muted-foreground" data-testid="button-close-cancel">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div>
          <p className="text-sm text-muted-foreground mb-3">Following services will be cancelled:</p>
          <div className="border rounded-md p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-sm">{appointment.service?.name || "Service"}</span>
                {appointment.staff && (
                  <span className="text-sm text-muted-foreground"> ( {appointment.staff.name} )</span>
                )}
              </div>
              <span className="font-semibold text-sm" data-testid="cancel-service-price">
                ${Number(appointment.service?.price || 0).toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="cancel-service-date">{dateStr}</p>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="font-semibold text-sm">Cancellation Reason</h3>
          <div className="grid grid-cols-2 gap-2">
            {CANCEL_REASONS.map((reason) => (
              <Button
                key={reason}
                variant="outline"
                className={cn(
                  "h-auto py-3 text-sm justify-center",
                  selectedReason === reason && "border-primary bg-primary/5 text-primary"
                )}
                onClick={() => setSelectedReason(reason)}
                data-testid={`cancel-reason-${reason.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
              >
                {reason}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t p-4">
        <Button
          className="w-full bg-pink-400 text-white h-12"
          onClick={() => selectedReason && onConfirmCancel(selectedReason)}
          disabled={!selectedReason || isUpdating}
          data-testid="button-confirm-cancel"
        >
          {isUpdating ? "Cancelling..." : "Cancel Appointment"}
        </Button>
      </div>
      </div>
    </div>
  );
}

const TAX_RATE = 0.07;

const PAYMENT_METHODS = [
  { id: "cash", label: "Cash", icon: Banknote },
  { id: "card", label: "Card", icon: CreditCard },
  { id: "stripe", label: "Stripe Test", icon: CreditCard },
  { id: "mobile", label: "Mobile", icon: Smartphone },
] as const;

const STRIPE_TEST_CARD_MAP: Record<string, { testPaymentMethod: string; cardBrand: string }> = {
  "4242424242424242": { testPaymentMethod: "pm_card_visa", cardBrand: "Visa" },
  "5555555555554444": { testPaymentMethod: "pm_card_mastercard", cardBrand: "Mastercard" },
  "378282246310005": { testPaymentMethod: "pm_card_amex", cardBrand: "American Express" },
  "6011111111111117": { testPaymentMethod: "pm_card_discover", cardBrand: "Discover" },
  "4000000000000002": { testPaymentMethod: "pm_card_chargeDeclined", cardBrand: "Declined test card" },
};

function parseStripeTestSwipe(input: string) {
  const cleaned = input.trim();
  const trackTwo = cleaned.match(/;(\d{12,19})=(\d{4})/);
  const trackOne = cleaned.match(/%B(\d{12,19})\^/);
  const keyedDigits = cleaned.replace(/\D/g, "");
  const cardNumber = trackTwo?.[1] || trackOne?.[1] || keyedDigits;
  const testCard = STRIPE_TEST_CARD_MAP[cardNumber];
  if (!testCard) return null;
  return {
    ...testCard,
    cardLast4: cardNumber.slice(-4),
  };
}

const TIP_PRESETS = [
  { label: "No Tip", value: 0 },
  { label: "15%", percent: 0.15 },
  { label: "18%", percent: 0.18 },
  { label: "20%", percent: 0.20 },
  { label: "25%", percent: 0.25 },
];

type TenderLine = {
  id: number;
  method: string;
  amount: number;
};

function CheckoutPOSPanel({
  appointment,
  timezone,
  onClose,
  onFinalize,
  isUpdating,
}: {
  appointment: AppointmentWithDetails;
  timezone: string;
  onClose: () => void;
  onFinalize: (data: { paymentMethod: string; tip: number; discount: number; totalPaid: number }) => void;
  isUpdating: boolean;
}) {
  const { selectedStore } = useSelectedStore();
  const { toast } = useToast();
  const [phase, setPhase] = useState<"cart" | "payment">("cart");
  const [tipMode, setTipMode] = useState<"preset" | "custom">("preset");
  const [selectedTipIndex, setSelectedTipIndex] = useState(0);
  const [customTip, setCustomTip] = useState("");
  const [discountValue, setDiscountValue] = useState("");
  const [discountType, setDiscountType] = useState<"dollar" | "percent">("dollar");

  const [tenders, setTenders] = useState<TenderLine[]>([]);
  const [keypadDisplay, setKeypadDisplay] = useState("0");
  const [nextTenderId, setNextTenderId] = useState(1);
  const [showComplete, setShowComplete] = useState(false);
  const [stripeReaderActive, setStripeReaderActive] = useState(false);
  const [stripeSwipeAmount, setStripeSwipeAmount] = useState(0);
  const [stripeSwipeInput, setStripeSwipeInput] = useState("");
  const [stripeSwipeStatus, setStripeSwipeStatus] = useState("");
  const [stripeProcessing, setStripeProcessing] = useState(false);

  const aptAddons = appointment.appointmentAddons?.map(aa => aa.addon).filter(Boolean) || [];
  const servicePrice = Number(appointment.service?.price || 0);
  const addonTotal = aptAddons.reduce((sum, a) => sum + Number(a!.price), 0);
  const subtotal = servicePrice + addonTotal;

  const discountNum = Number(discountValue) || 0;
  const discount = discountType === "percent" ? subtotal * (discountNum / 100) : discountNum;
  const discountedSubtotal = Math.max(0, subtotal - discount);

  const tax = discountedSubtotal * TAX_RATE;
  const preTotal = discountedSubtotal + tax;

  const tip = tipMode === "custom"
    ? (Number(customTip) || 0)
    : (TIP_PRESETS[selectedTipIndex]?.percent
        ? preTotal * (TIP_PRESETS[selectedTipIndex] as any).percent
        : (TIP_PRESETS[selectedTipIndex] as any)?.value || 0);

  const grandTotal = Math.round((preTotal + tip) * 100) / 100;
  const totalTendered = tenders.reduce((sum, t) => sum + t.amount, 0);
  const balanceDue = Math.round((grandTotal - totalTendered) * 100) / 100;
  const changeDue = balanceDue < 0 ? Math.abs(balanceDue) : 0;

  const endTime = addMinutes(new Date(appointment.date), appointment.duration);
  const dateStr = formatInTz(appointment.date, timezone, "EEE, MMM d");
  const timeStr = `${formatInTz(appointment.date, timezone, "h:mm a")} - ${formatInTz(endTime, timezone, "h:mm a")}`;

  const handleKeypadPress = (key: string) => {
    if (key === "C") {
      setKeypadDisplay("0");
      return;
    }
    if (key === "BS") {
      setKeypadDisplay(prev => prev.length <= 1 ? "0" : prev.slice(0, -1));
      return;
    }
    if (key === ".") {
      if (keypadDisplay.includes(".")) return;
      setKeypadDisplay(prev => prev + ".");
      return;
    }
    setKeypadDisplay(prev => {
      if (prev === "0" && key !== ".") return key;
      const parts = prev.split(".");
      if (parts[1] && parts[1].length >= 2) return prev;
      return prev + key;
    });
  };

  useEffect(() => {
    if (phase === "payment") {
      setShowComplete(totalTendered >= grandTotal && tenders.length > 0);
    }
  }, [totalTendered, grandTotal, tenders.length, phase]);

  const handleApplyTender = (method: string) => {
    const amount = Number(keypadDisplay);
    if (amount <= 0) return;
    setTenders(prev => [...prev, { id: nextTenderId, method, amount }]);
    setNextTenderId(prev => prev + 1);
    setKeypadDisplay("0");
  };

  const handleStartStripeSwipe = () => {
    const amount = Number(keypadDisplay);
    if (amount <= 0) return;
    setStripeSwipeAmount(amount);
    setStripeReaderActive(true);
    setStripeSwipeInput("");
    setStripeSwipeStatus("Swipe a Stripe test card now.");
  };

  const handleStripeSwipeInput = async (value: string) => {
    setStripeSwipeInput(value);
    if (!value.includes("?") && !value.includes("\n") && value.replace(/\D/g, "").length < 15) return;

    const parsed = parseStripeTestSwipe(value);
    setStripeSwipeInput("");

    if (!parsed) {
      setStripeSwipeStatus("Only Stripe test cards are accepted here.");
      return;
    }

    if (!selectedStore?.id) {
      setStripeSwipeStatus("Select a store before taking a Stripe payment.");
      return;
    }

    try {
      setStripeProcessing(true);
      setStripeSwipeStatus(`Processing ${parsed.cardBrand} ending in ${parsed.cardLast4}...`);
      const res = await fetch(`/api/stripe-settings/${selectedStore.id}/test-magstripe-payment`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: stripeSwipeAmount,
          testPaymentMethod: parsed.testPaymentMethod,
          appointmentId: appointment.id,
          cardLast4: parsed.cardLast4,
          cardBrand: parsed.cardBrand,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Stripe test payment failed");
      }

      setTenders(prev => [...prev, { id: nextTenderId, method: "stripe", amount: data.amount || stripeSwipeAmount }]);
      setNextTenderId(prev => prev + 1);
      setKeypadDisplay("0");
      setStripeReaderActive(false);
      setStripeSwipeStatus("");
      toast({
        title: "Stripe test payment approved",
        description: `${parsed.cardBrand} ending in ${parsed.cardLast4} charged for $${(data.amount || stripeSwipeAmount).toFixed(2)}.`,
      });
    } catch (error: any) {
      setStripeSwipeStatus(error.message || "Stripe test payment failed.");
      toast({ title: "Stripe payment failed", description: error.message || "Try another test card.", variant: "destructive" });
    } finally {
      setStripeProcessing(false);
    }
  };

  const handleRemoveTender = (id: number) => {
    setTenders(prev => prev.filter(t => t.id !== id));
  };

  const handleQuickAmount = (amount: number) => {
    setKeypadDisplay(String(amount.toFixed(2)));
  };

  const handleCompleteTransaction = () => {
    const methodsSummary = tenders.map(t => `${t.method}:${t.amount.toFixed(2)}`).join(",");
    onFinalize({
      paymentMethod: methodsSummary,
      tip: Math.round(tip * 100) / 100,
      discount: Math.round(discount * 100) / 100,
      totalPaid: Math.round(totalTendered * 100) / 100,
    });
  };

  const handlePrintReceipt = () => {
    const escapeHtml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const storeName = escapeHtml((selectedStore as any)?.name || "Receipt");
    const storeAddr = escapeHtml(
      [
        (selectedStore as any)?.address,
        (selectedStore as any)?.city,
        (selectedStore as any)?.state,
        (selectedStore as any)?.zipCode,
      ]
        .filter(Boolean)
        .join(", "),
    );
    const storePhone = escapeHtml((selectedStore as any)?.phone || "");
    const customerName = escapeHtml(appointment.customer?.name || "Walk-In");
    const staffName = escapeHtml((appointment as any).staff?.name || "");
    const apptDate = escapeHtml(dateStr);
    const apptTime = escapeHtml(timeStr);
    const printedAt = escapeHtml(
      formatInTz(new Date(), timezone, "EEE, MMM d • h:mm a"),
    );

    const lineItems: { label: string; price: number }[] = [];
    if (appointment.service) {
      lineItems.push({
        label: appointment.service.name || "Service",
        price: servicePrice,
      });
    }
    for (const a of aptAddons) {
      if (!a) continue;
      lineItems.push({ label: `+ ${a.name}`, price: Number(a.price) });
    }

    const itemsHtml = lineItems
      .map(
        (li) => `
        <tr>
          <td>${escapeHtml(li.label)}</td>
          <td class="r">$${li.price.toFixed(2)}</td>
        </tr>`,
      )
      .join("");

    const tendersHtml = tenders
      .map(
        (t) => `
        <tr>
          <td>${escapeHtml(t.method.toUpperCase())}</td>
          <td class="r">$${t.amount.toFixed(2)}</td>
        </tr>`,
      )
      .join("");

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt #${appointment.id}</title>
<style>
  @page { margin: 8mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Courier New', ui-monospace, monospace;
    font-size: 12px;
    color: #000;
    margin: 0;
    padding: 12px;
    width: 80mm;
  }
  .center { text-align: center; }
  .r { text-align: right; }
  .bold { font-weight: 700; }
  .lg { font-size: 14px; }
  .xl { font-size: 16px; }
  .muted { color: #444; }
  hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  .total-row td { padding-top: 6px; font-weight: 700; font-size: 14px; }
  .footer { margin-top: 12px; font-size: 11px; }
</style>
</head>
<body>
  <div class="center bold xl">${storeName}</div>
  ${storeAddr ? `<div class="center muted">${storeAddr}</div>` : ""}
  ${storePhone ? `<div class="center muted">${storePhone}</div>` : ""}
  <hr />
  <div>Receipt #${appointment.id}</div>
  <div>${printedAt}</div>
  <div>Appt: ${apptDate} ${apptTime}</div>
  <div>Client: ${customerName}</div>
  ${staffName ? `<div>Staff: ${staffName}</div>` : ""}
  <hr />
  <table>${itemsHtml}</table>
  <hr />
  <table>
    <tr><td>Subtotal</td><td class="r">$${subtotal.toFixed(2)}</td></tr>
    ${
      discount > 0
        ? `<tr><td>Discount</td><td class="r">-$${discount.toFixed(2)}</td></tr>`
        : ""
    }
    <tr><td>Tax</td><td class="r">$${tax.toFixed(2)}</td></tr>
    ${
      tip > 0
        ? `<tr><td>Tip</td><td class="r">$${tip.toFixed(2)}</td></tr>`
        : ""
    }
    <tr class="total-row"><td>TOTAL</td><td class="r">$${grandTotal.toFixed(2)}</td></tr>
  </table>
  <hr />
  <table>${tendersHtml}</table>
  <table>
    <tr><td>Tendered</td><td class="r">$${totalTendered.toFixed(2)}</td></tr>
    ${
      changeDue > 0
        ? `<tr class="bold"><td>Change Due</td><td class="r">$${changeDue.toFixed(2)}</td></tr>`
        : ""
    }
  </table>
  <hr />
  <div class="center footer">Thank you!</div>
  <script>
    window.onload = function() {
      window.focus();
      window.print();
      setTimeout(function() { window.close(); }, 300);
    };
  </script>
</body>
</html>`;

    const w = window.open("", "_blank", "width=420,height=640");
    if (!w) {
      toast({
        title: "Pop-up blocked",
        description: "Allow pop-ups for this site to print receipts.",
        variant: "destructive",
      });
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const handlePrintAndComplete = () => {
    handlePrintReceipt();
    handleCompleteTransaction();
  };

  const getMethodIcon = (method: string) => {
    const found = PAYMENT_METHODS.find(m => m.id === method);
    if (!found) return Banknote;
    return found.icon;
  };

  if (phase === "cart") {
    return (
      <div className="fixed inset-0 z-50" data-testid="checkout-pos-panel">
        <button
          type="button"
          aria-label="Close checkout"
          className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
          onClick={onClose}
        />
        <div className="absolute left-0 top-0 h-full w-full sm:w-[420px] bg-card flex flex-col shadow-[8px_0_24px_rgba(0,0,0,0.12)] border-r">
        <div className="p-4 border-b flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-muted-foreground" />
            <h2 className="font-semibold text-lg">Checkout</h2>
            <Badge variant="outline" className="no-default-active-elevate text-[10px]">#{appointment.id}</Badge>
          </div>
          <button onClick={onClose} className="text-muted-foreground" data-testid="button-close-checkout">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div className="flex items-center gap-3">
            <Avatar className="w-8 h-8">
              <AvatarFallback className="text-xs font-bold bg-muted">
                {appointment.customer?.name?.[0]?.toUpperCase() || "W"}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-sm" data-testid="pos-customer-name">{appointment.customer?.name || "Walk-In"}</p>
              <p className="text-xs text-muted-foreground">{dateStr} &middot; {timeStr}</p>
            </div>
            {appointment.staff && (
              <Badge variant="outline" className="no-default-active-elevate text-[10px] ml-auto">{appointment.staff.name}</Badge>
            )}
          </div>

          <div className="space-y-1">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Line Items</h3>
            <div className="border rounded-md divide-y">
              <div className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm font-medium" data-testid="pos-service-name">{appointment.service?.name}</p>
                  <p className="text-xs text-muted-foreground">{appointment.service?.duration} min</p>
                </div>
                <span className="text-sm font-semibold" data-testid="pos-service-price">${servicePrice.toFixed(2)}</span>
              </div>
              {aptAddons.map((addon: any) => (
                <div key={addon.id} className="flex items-center justify-between p-3" data-testid={`pos-addon-${addon.id}`}>
                  <div>
                    <p className="text-sm font-medium">+ {addon.name}</p>
                    <p className="text-xs text-muted-foreground">{addon.duration} min</p>
                  </div>
                  <span className="text-sm font-semibold">${Number(addon.price).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Discount</h3>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className="pl-9"
                  data-testid="input-discount"
                />
              </div>
              <div className="flex rounded-md border overflow-visible">
                <button
                  className={cn(
                    "px-3 py-2 text-sm transition-colors",
                    discountType === "dollar" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  )}
                  onClick={() => setDiscountType("dollar")}
                  data-testid="button-discount-dollar"
                >
                  $
                </button>
                <button
                  className={cn(
                    "px-3 py-2 text-sm transition-colors",
                    discountType === "percent" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  )}
                  onClick={() => setDiscountType("percent")}
                  data-testid="button-discount-percent"
                >
                  %
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Tip</h3>
            <div className="grid grid-cols-5 gap-1.5">
              {TIP_PRESETS.map((preset, i) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "text-xs",
                    tipMode === "preset" && selectedTipIndex === i && "border-primary bg-primary/5 text-primary"
                  )}
                  onClick={() => { setTipMode("preset"); setSelectedTipIndex(i); }}
                  data-testid={`button-tip-${preset.label.replace(/[^a-z0-9]/gi, "").toLowerCase()}`}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Custom:</span>
              <div className="relative flex-1">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={customTip}
                  onChange={(e) => { setCustomTip(e.target.value); setTipMode("custom"); }}
                  onFocus={() => setTipMode("custom")}
                  className={cn("pl-8", tipMode === "custom" && "border-primary")}
                  data-testid="input-custom-tip"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="border-t p-4 space-y-3 bg-card">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span data-testid="pos-subtotal">${subtotal.toFixed(2)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Discount</span>
                <span data-testid="pos-discount">-${discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax ({(TAX_RATE * 100).toFixed(0)}%)</span>
              <span data-testid="pos-tax">${tax.toFixed(2)}</span>
            </div>
            {tip > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tip</span>
                <span data-testid="pos-tip">${tip.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg pt-2 border-t">
              <span>Total</span>
              <span data-testid="pos-total">${grandTotal.toFixed(2)}</span>
            </div>
          </div>

          <Button
            className="w-full bg-green-600 text-white h-12"
            onClick={() => setPhase("payment")}
            data-testid="button-finalize-pay"
          >
            <Receipt className="w-4 h-4 mr-2" />
            Finalize & Pay
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={onClose}
            data-testid="button-abort-checkout"
          >
          Back to Appointment
          </Button>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50" data-testid="checkout-payment-panel">
      <button
        type="button"
        aria-label="Close payment"
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="absolute left-0 top-0 h-full w-full sm:w-[680px] bg-card flex flex-col shadow-[8px_0_24px_rgba(0,0,0,0.12)] border-r">
      <div className="p-3 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-muted-foreground" />
          <h2 className="font-semibold">Payment</h2>
          <Badge variant="outline" className="no-default-active-elevate text-[10px]">#{appointment.id}</Badge>
          <span className="text-xs text-muted-foreground">&middot; {appointment.customer?.name || "Walk-In"}</span>
        </div>
        <button onClick={() => setPhase("cart")} className="text-muted-foreground" data-testid="button-back-to-cart">
          <ArrowLeft className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[300px] flex-shrink-0 border-r flex flex-col">
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            <div className="space-y-1">
              <div className="flex items-center justify-between py-1.5 text-sm">
                <span className="font-medium">{appointment.service?.name}</span>
                <span>${servicePrice.toFixed(2)}</span>
              </div>
              {aptAddons.map((addon: any) => (
                <div key={addon.id} className="flex items-center justify-between py-1 text-sm text-muted-foreground pl-2">
                  <span>+ {addon.name}</span>
                  <span>${Number(addon.price).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="border-t pt-2 mt-2 space-y-1 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span>
                  <span>-${discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>Tax ({(TAX_RATE * 100).toFixed(0)}%)</span>
                <span>${tax.toFixed(2)}</span>
              </div>
              {tip > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Tip</span>
                  <span>${tip.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-sm pt-1 border-t">
                <span>Total</span>
                <span data-testid="payment-total">${grandTotal.toFixed(2)}</span>
              </div>
            </div>

            {tenders.length > 0 && (
              <div className="border-t pt-2 mt-2 space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Payments Applied</h4>
                {tenders.map((tender) => {
                  const Icon = getMethodIcon(tender.method);
                  return (
                    <div key={tender.id} className="flex items-center justify-between bg-muted/50 rounded-md p-2" data-testid={`tender-line-${tender.id}`}>
                      <div className="flex items-center gap-2">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm capitalize">{tender.method}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-green-600" data-testid={`tender-amount-${tender.id}`}>${tender.amount.toFixed(2)}</span>
                        <button
                          onClick={() => handleRemoveTender(tender.id)}
                          className="text-muted-foreground"
                          data-testid={`button-remove-tender-${tender.id}`}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t p-3">
            {balanceDue > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Balance Due</span>
                <span className="text-lg font-bold text-destructive" data-testid="pos-balance-due">${balanceDue.toFixed(2)}</span>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-green-600">Paid in Full</span>
                  <Check className="w-4 h-4 text-green-600" />
                </div>
                {changeDue > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Change Due</span>
                    <span className="font-medium" data-testid="pos-change-due">${changeDue.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col relative">
          <div className="bg-muted/30 px-4 py-3 border-b flex items-center justify-end">
            <div className="text-right">
              <span className="text-2xl font-mono font-bold tracking-wider" data-testid="keypad-display">${keypadDisplay}</span>
            </div>
          </div>

          <div className="flex-1 p-3 flex flex-col gap-2">
            <div className="grid grid-cols-4 gap-1.5 flex-1">
              {["7","8","9","BS","4","5","6","C","1","2","3",".","00","0"].map((key) => (
                <Button
                  key={key}
                  variant="outline"
                  className={cn(
                    "text-lg font-medium h-auto",
                    key === "C" && "text-destructive",
                    key === "BS" && "text-muted-foreground"
                  )}
                  onClick={() => handleKeypadPress(key)}
                  data-testid={`keypad-${key === "BS" ? "backspace" : key === "." ? "dot" : key}`}
                >
                  {key === "BS" ? <Delete className="w-5 h-5" /> : key === "C" ? "CLR" : key}
                </Button>
              ))}
              <Button
                variant="outline"
                className="text-lg font-medium h-auto col-span-2 bg-primary/5 border-primary text-primary"
                onClick={() => setKeypadDisplay(balanceDue > 0 ? balanceDue.toFixed(2) : "0")}
                data-testid="keypad-exact"
              >
                EXACT
              </Button>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {[1, 5, 10, 20].map((amt) => (
                <Button
                  key={amt}
                  variant="secondary"
                  size="sm"
                  className="text-sm font-medium"
                  onClick={() => handleQuickAmount(amt)}
                  data-testid={`quick-amount-${amt}`}
                >
                  ${amt}
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-1.5 mt-1">
              {PAYMENT_METHODS.map((method) => {
                const Icon = method.icon;
                return (
                  <Button
                    key={method.id}
                    className={cn(
                      "h-auto py-3 flex flex-col items-center gap-1",
                      method.id === "cash" && "bg-green-600 text-white",
                      method.id === "card" && "bg-blue-600 text-white",
                      method.id === "stripe" && "bg-indigo-600 text-white",
                      method.id === "mobile" && "bg-purple-600 text-white"
                    )}
                    onClick={() => method.id === "stripe" ? handleStartStripeSwipe() : handleApplyTender(method.id)}
                    disabled={Number(keypadDisplay) <= 0}
                    data-testid={`tender-${method.id}`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-medium">{method.label}</span>
                  </Button>
                );
              })}
            </div>

            {stripeReaderActive && (
              <div className="rounded-md border p-3 space-y-2 bg-indigo-50 dark:bg-indigo-950/20">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">Stripe test swipe</p>
                    <p className="text-xs text-muted-foreground">Amount: ${stripeSwipeAmount.toFixed(2)}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStripeReaderActive(false);
                      setStripeSwipeInput("");
                      setStripeSwipeStatus("");
                    }}
                    disabled={stripeProcessing}
                    data-testid="button-cancel-stripe-swipe"
                  >
                    Cancel
                  </Button>
                </div>
                <Input
                  type="password"
                  autoFocus
                  value={stripeSwipeInput}
                  onChange={(e) => handleStripeSwipeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleStripeSwipeInput(stripeSwipeInput + "\n");
                    }
                  }}
                  disabled={stripeProcessing}
                  placeholder={stripeProcessing ? "Processing..." : "Swipe reader input lands here"}
                  data-testid="input-stripe-test-swipe"
                />
                <p className="text-xs text-muted-foreground">
                  {stripeSwipeStatus || "Use a Stripe test card track, like Visa 4242."}
                </p>
              </div>
            )}
          </div>

          {showComplete && (
            <div className="absolute inset-0 bg-background/95 flex flex-col items-center justify-center gap-6 z-10" data-testid="payment-complete-overlay">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-xl font-bold">Payment Complete</h3>
                <p className="text-sm text-muted-foreground">Total: ${grandTotal.toFixed(2)}</p>
                {changeDue > 0 && (
                  <p className="text-sm font-medium">Change Due: ${changeDue.toFixed(2)}</p>
                )}
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handlePrintAndComplete}
                  disabled={isUpdating}
                  data-testid="button-print-receipt"
                >
                  <Printer className="w-4 h-4" />
                  {isUpdating ? "Processing..." : "Print Receipt"}
                </Button>
                <Button
                  className="gap-2 bg-green-600 text-white"
                  onClick={handleCompleteTransaction}
                  disabled={isUpdating}
                  data-testid="button-no-receipt"
                >
                  <Check className="w-4 h-4" />
                  {isUpdating ? "Processing..." : "No Receipt"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function ChooseClientPanel({
  onClose,
  onSelectClient,
  onWalkIn,
  walkInsEnabled = true,
}: {
  onClose: () => void;
  onSelectClient: (clientId: number) => void;
  onWalkIn: () => void;
  walkInsEnabled?: boolean;
}) {
  const [phoneDigits, setPhoneDigits] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [showNameEntry, setShowNameEntry] = useState(false);
  const [clientName, setClientName] = useState("");
  const [shiftActive, setShiftActive] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const { selectedStore } = useSelectedStore();

  useEffect(() => {
    (document.activeElement as HTMLElement)?.blur();
  }, [showNameEntry]);

  const formatPhone = (digits: string): string => {
    if (digits.length <= 3) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const formatPhoneFull = (digits: string): string => {
    if (digits.length !== 10) return digits;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const handleDigit = useCallback((digit: string) => {
    if (phoneDigits.length < 10) {
      setPhoneDigits(prev => prev + digit);
      setSearchDone(false);
    }
  }, [phoneDigits.length]);

  const handleBackspace = useCallback(() => {
    setPhoneDigits(prev => prev.slice(0, -1));
    setSearchDone(false);
  }, []);

  useEffect(() => {
    if (phoneDigits.length === 10 && !searchDone && selectedStore) {
      setIsSearching(true);
      fetch(`/api/customers/search?phone=${encodeURIComponent(phoneDigits)}&storeId=${selectedStore.id}`, {
        credentials: "include",
      })
        .then(res => res.json())
        .then((customer: any) => {
          setIsSearching(false);
          setSearchDone(true);
          if (customer && customer.id) {
            onSelectClient(customer.id);
          } else {
            setShowNameEntry(true);
          }
        })
        .catch(() => {
          setIsSearching(false);
          setSearchDone(true);
          setShowNameEntry(true);
        });
    }
  }, [phoneDigits, searchDone, selectedStore, onSelectClient]);

  const handleNameKey = useCallback((key: string) => {
    const char = shiftActive ? key.toUpperCase() : key.toLowerCase();
    setClientName(prev => prev + char);
    if (shiftActive) setShiftActive(false);
  }, [shiftActive]);

  const handleNameBackspace = useCallback(() => {
    setClientName(prev => prev.slice(0, -1));
  }, []);

  const handleNameDone = useCallback(async () => {
    if (!clientName.trim() || !selectedStore) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: clientName.trim(),
          phone: phoneDigits,
          storeId: selectedStore.id,
        }),
      });
      const newCustomer = await res.json();
      if (newCustomer && newCustomer.id) {
        onSelectClient(newCustomer.id);
      }
    } catch {
      setIsCreating(false);
    }
  }, [clientName, phoneDigits, selectedStore, onSelectClient]);

  const handleGuestDone = useCallback(() => {
    onWalkIn();
  }, [onWalkIn]);

  const numKeys = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    [walkInsEnabled ? "walk-in" : "blank", "0", "backspace"],
  ];

  const kbRow1 = ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"];
  const kbRow2 = ["A", "S", "D", "F", "G", "H", "J", "K", "L"];
  const kbRow3 = ["Z", "X", "C", "V", "B", "N", "M"];

  if (showNameEntry) {
    return (
      <div className="fixed inset-0 z-50" data-testid="enter-name-panel">
        <button
          type="button"
          aria-label="Close name entry"
          className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
          onClick={onClose}
        />
        <div className="absolute right-0 top-0 h-full w-full sm:w-[740px] bg-[#F7F5F0] flex flex-col shadow-[-8px_0_24px_rgba(0,0,0,0.12)] border-l">
          <div className="px-4 py-4 flex items-center justify-between gap-2 bg-white border-b border-gray-200">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onPointerDown={e => e.preventDefault()} onClick={() => { setShowNameEntry(false); setClientName(""); setPhoneDigits(""); setSearchDone(false); setShiftActive(true); }} className="text-gray-500 hover:text-gray-900 hover:bg-gray-100" data-testid="button-back-name-entry">
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <span className="font-semibold text-sm text-gray-900">Enter Client Name</span>
            </div>
            <Button variant="ghost" size="icon" onPointerDown={e => e.preventDefault()} onClick={onClose} className="text-gray-500 hover:text-gray-900 hover:bg-gray-100" data-testid="button-close-name-entry">
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 flex flex-col px-3 pt-6 pb-3 min-h-0">
            <div className="text-center mb-4 px-2">
              <p className="text-3xl font-bold tracking-wide min-h-[44px]" data-testid="text-client-name-display">
                {clientName || <span className="text-muted-foreground/30">Name</span>}
              </p>
              <p className="text-xs text-primary mt-1 font-medium" data-testid="text-creating-for-phone">
                New client · {formatPhoneFull(phoneDigits)}
              </p>
            </div>

            <div className="flex-1 flex flex-col gap-1.5 min-h-0 justify-end">
              {/* Row 1: QWERTYUIOP */}
              <div className="flex gap-1">
                {kbRow1.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onPointerDown={e => e.preventDefault()}
                    onClick={() => handleNameKey(k)}
                    className="flex-1 h-[52px] rounded-md bg-muted text-sm font-semibold text-foreground hover-elevate active-elevate-2 flex items-center justify-center"
                    data-testid={`kb-${k.toLowerCase()}`}
                  >
                    {shiftActive ? k : k.toLowerCase()}
                  </button>
                ))}
              </div>
              {/* Row 2: ASDFGHJKL */}
              <div className="flex gap-1 px-[4%]">
                {kbRow2.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onPointerDown={e => e.preventDefault()}
                    onClick={() => handleNameKey(k)}
                    className="flex-1 h-[52px] rounded-md bg-muted text-sm font-semibold text-foreground hover-elevate active-elevate-2 flex items-center justify-center"
                    data-testid={`kb-${k.toLowerCase()}`}
                  >
                    {shiftActive ? k : k.toLowerCase()}
                  </button>
                ))}
              </div>
              {/* Row 3: Shift + ZXCVBNM + Backspace */}
              <div className="flex gap-1">
                <button
                  type="button"
                  onPointerDown={e => e.preventDefault()}
                  onClick={() => setShiftActive(prev => !prev)}
                  className={cn(
                    "w-[52px] h-[52px] rounded-md text-sm font-semibold flex items-center justify-center hover-elevate active-elevate-2 flex-shrink-0",
                    shiftActive ? "bg-foreground text-background" : "bg-muted text-foreground"
                  )}
                  data-testid="kb-shift"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                {kbRow3.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onPointerDown={e => e.preventDefault()}
                    onClick={() => handleNameKey(k)}
                    className="flex-1 h-[52px] rounded-md bg-muted text-sm font-semibold text-foreground hover-elevate active-elevate-2 flex items-center justify-center"
                    data-testid={`kb-${k.toLowerCase()}`}
                  >
                    {shiftActive ? k : k.toLowerCase()}
                  </button>
                ))}
                <button
                  type="button"
                  onPointerDown={e => e.preventDefault()}
                  onClick={handleNameBackspace}
                  className="w-[52px] h-[52px] rounded-md bg-muted text-muted-foreground flex items-center justify-center hover-elevate active-elevate-2 flex-shrink-0"
                  data-testid="kb-backspace"
                >
                  <Delete className="w-5 h-5" />
                </button>
              </div>
              {/* Row 4: Guest / @ / Space / Return */}
              <div className="flex gap-1">
                <button
                  type="button"
                  onPointerDown={e => e.preventDefault()}
                  onClick={handleGuestDone}
                  className="h-[52px] px-3 rounded-md bg-muted text-sm font-medium text-foreground hover-elevate active-elevate-2 flex-shrink-0"
                  data-testid="kb-guest"
                >
                  Guest
                </button>
                <button
                  type="button"
                  onPointerDown={e => e.preventDefault()}
                  onClick={() => handleNameKey("@")}
                  className="h-[52px] px-3 rounded-md bg-muted text-sm font-medium text-foreground hover-elevate active-elevate-2 flex-shrink-0"
                  data-testid="kb-at"
                >
                  @
                </button>
                <button
                  type="button"
                  onPointerDown={e => e.preventDefault()}
                  onClick={() => { handleNameKey(" "); setShiftActive(true); }}
                  className="flex-1 h-[52px] rounded-md bg-muted text-sm font-medium text-foreground hover-elevate active-elevate-2"
                  data-testid="kb-space"
                >
                  space
                </button>
                <button
                  type="button"
                  onPointerDown={e => e.preventDefault()}
                  onClick={handleNameDone}
                  className="h-[52px] px-3 rounded-md bg-muted text-sm font-medium text-foreground hover-elevate active-elevate-2 flex-shrink-0"
                  data-testid="kb-return"
                >
                  return
                </button>
              </div>
            </div>

            <Button
              className="mt-3 w-full bg-green-600 text-white h-[58px] text-base font-semibold rounded-xl"
              onPointerDown={e => e.preventDefault()}
              onClick={handleNameDone}
              disabled={!clientName.trim() || isCreating}
              data-testid="button-name-done"
            >
              {isCreating ? "Creating..." : "Done"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50" data-testid="choose-client-panel">
      <button
        type="button"
        aria-label="Close client lookup"
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[380px] bg-[#F7F5F0] flex flex-col shadow-[-8px_0_24px_rgba(0,0,0,0.12)] border-l">
        {/* Header */}
        <div className="px-4 py-4 flex items-center justify-between gap-2 bg-white border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-500 hover:text-gray-900 hover:bg-gray-100" data-testid="button-back-client-lookup">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <span className="font-semibold text-base text-gray-900">Choose A Client</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-500 hover:text-gray-900 hover:bg-gray-100" data-testid="button-close-client-lookup">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content fills all remaining height — bottom padding clears the mobile nav bar (56px + safe area) */}
        <div
          className="flex-1 flex flex-col px-4 pt-5 min-h-0 bg-[#F7F5F0] md:pb-4"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
        >
          {/* Phone number display */}
          <div className="w-full rounded-2xl bg-white border border-gray-200 shadow-sm py-6 px-4 mb-5 text-center">
            {phoneDigits.length > 0 ? (
              <p className="text-4xl font-bold tracking-widest text-primary" data-testid="text-phone-display">
                {formatPhone(phoneDigits)}
              </p>
            ) : (
              <>
                <p className="text-base font-semibold text-gray-900" data-testid="text-enter-phone">Enter Phone Number</p>
                <p className="text-sm text-gray-400 mt-1 flex items-center justify-center gap-1.5">
                  Tap <PersonStanding className="w-4 h-4 inline" /> for walk-in
                </p>
              </>
            )}
            {isSearching && (
              <p className="text-sm text-primary mt-2 animate-pulse" data-testid="text-searching">Searching...</p>
            )}
          </div>

          {/* Numpad — flex-1 rows fill remaining height equally */}
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            {numKeys.map((row, ri) => (
              <div key={ri} className="flex gap-3 flex-1">
                {row.map((key) => {
                  if (key === "walk-in") {
                    return (
                      <button
                        key={key}
                        type="button"
                        onPointerDown={e => e.preventDefault()}
                        onClick={onWalkIn}
                        className="flex-1 rounded-2xl bg-gray-200 text-gray-500 flex items-center justify-center hover:bg-gray-300 active:scale-95 transition-all"
                        data-testid="numpad-walkin"
                      >
                        <PersonStanding className="w-7 h-7" />
                      </button>
                    );
                  }
                  if (key === "blank") {
                    return <div key={key} className="flex-1" aria-hidden="true" />;
                  }
                  if (key === "backspace") {
                    return (
                      <button
                        key={key}
                        type="button"
                        onPointerDown={e => e.preventDefault()}
                        onClick={handleBackspace}
                        className="flex-1 rounded-2xl bg-gray-200 text-gray-500 flex items-center justify-center hover:bg-gray-300 active:scale-95 transition-all"
                        data-testid="numpad-backspace"
                      >
                        <Delete className="w-7 h-7" />
                      </button>
                    );
                  }
                  return (
                    <button
                      key={key}
                      type="button"
                      onPointerDown={e => e.preventDefault()}
                      onClick={() => handleDigit(key)}
                      className="flex-1 rounded-2xl bg-white text-3xl font-bold text-gray-900 shadow-sm border border-gray-100 hover:bg-gray-50 active:scale-95 transition-all"
                      data-testid={`numpad-${key}`}
                    >
                      {key}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function MonthCalendarOverlay({
  selectedDate,
  timezone,
  appointments,
  onSelectDate,
  onSelectAppointment,
  onClose,
}: {
  selectedDate: Date;
  timezone: string;
  appointments: any[];
  onSelectDate: (date: Date) => void;
  onSelectAppointment: (apt: any) => void;
  onClose: () => void;
}) {
  const storeNow = getNowInTimezone(timezone);
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const [previewDay, setPreviewDay] = useState<Date>(selectedDate);
  const [view, setView] = useState<"calendar" | "list">("calendar");

  const nowMonth = storeNow.getMonth();
  const nowYear = storeNow.getFullYear();
  const monthTabs = [0, 1, 2].map((i) => {
    const totalMonth = nowMonth + i;
    return {
      month: totalMonth % 12,
      year: nowYear + Math.floor(totalMonth / 12),
    };
  });

  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const startDow = firstDay.getDay();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(viewYear, viewMonth, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const dayAppts = appointments
    .filter((apt: any) => isSameDay(toStoreLocal(apt.date, timezone), previewDay))
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const previewDayLabel = format(previewDay, "EEE, MMM d");

  const today0 = new Date(storeNow.getFullYear(), storeNow.getMonth(), storeNow.getDate());

  const apptMap = useMemo(() => {
    const map = new Map<string, any[]>();
    appointments.forEach((apt: any) => {
      const localDate = toStoreLocal(apt.date, timezone);
      const key = `${localDate.getFullYear()}-${localDate.getMonth()}-${localDate.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(apt);
    });
    return map;
  }, [appointments, timezone]);

  const listAppts = useMemo(() => {
    return appointments
      .filter((apt: any) => {
        const localDate = toStoreLocal(apt.date, timezone);
        return (
          localDate >= today0 &&
          localDate.getMonth() === viewMonth &&
          localDate.getFullYear() === viewYear
        );
      })
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [appointments, timezone, viewMonth, viewYear, today0]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" data-testid="month-calendar-overlay">
      <button
        type="button"
        aria-label="Close date picker"
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative z-10 bg-card rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-border"
        style={{ width: "min(1020px, 96vw)", height: "min(94vh, 94dvh)" }}
      >
        {/* ── HEADER ── */}
        <div className="flex items-center px-4 py-3 border-b flex-shrink-0 gap-3">
          {/* View toggle */}
          <div className="flex rounded-xl overflow-hidden border border-border flex-shrink-0">
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors",
                view === "calendar"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              )}
              data-testid="view-toggle-calendar"
            >
              <CalendarDays className="w-3.5 h-3.5" />
              Cal
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors border-l border-border",
                view === "list"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              )}
              data-testid="view-toggle-list"
            >
              <ListOrdered className="w-3.5 h-3.5" />
              List
            </button>
          </div>

          {/* Month/year label — centered */}
          <span className="flex-1 text-center text-lg font-bold tracking-tight">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>

          {/* Close — large tap target for tablet */}
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded-xl bg-muted hover:bg-muted/70 active:bg-muted/50 px-4 py-2 text-sm font-semibold text-foreground transition-colors"
            data-testid="datepicker-close"
          >
            Close
          </button>
        </div>

        {/* ── BODY: left (tabs + grid/list) | right panel full-height ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* LEFT column */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Month tabs — compact */}
            <div className="flex gap-2 px-4 py-2 border-b flex-shrink-0">
              {monthTabs.map((tab) => {
                const isActive = tab.month === viewMonth && tab.year === viewYear;
                return (
                  <button
                    key={`${tab.year}-${tab.month}`}
                    type="button"
                    onClick={() => { setViewMonth(tab.month); setViewYear(tab.year); }}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted text-foreground hover:bg-muted/70"
                    )}
                    data-testid={`monthtab-${MONTH_NAMES[tab.month].toLowerCase()}`}
                  >
                    {MONTH_NAMES[tab.month]}
                  </button>
                );
              })}
            </div>

            {/* ── CALENDAR grid ── */}
            {view === "calendar" && (
              <>
                <div className="grid grid-cols-7 px-4 pt-2 pb-1 flex-shrink-0">
                  {DOW_LABELS.map((d) => (
                    <div key={d} className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide py-1">
                      {d}
                    </div>
                  ))}
                </div>
                <div
                  className="flex-1 px-4 pb-4 grid"
                  style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}
                >
                  {weeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7">
                      {week.map((day, di) => {
                        if (!day) return <div key={di} />;
                        const isToday = isSameDay(day, storeNow);
                        const isPreviewing = isSameDay(day, previewDay);
                        const isOtherMonth = day.getMonth() !== viewMonth;
                        const isPast = day < today0 && !isToday;
                        const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
                        const hasBookings = !isPast && !isOtherMonth && (apptMap.get(dayKey)?.length ?? 0) > 0;
                        const showDot = hasBookings && !isPreviewing;

                        if (isPast || isOtherMonth) {
                          return (
                            <div
                              key={di}
                              className="flex items-center justify-center rounded-xl m-[3px] min-h-[48px] select-none"
                            >
                              <span className="text-base font-medium text-muted-foreground/25">
                                {day.getDate()}
                              </span>
                            </div>
                          );
                        }

                        return (
                          <button
                            key={di}
                            type="button"
                            onClick={() => setPreviewDay(day)}
                            className={cn(
                              "flex items-center justify-center rounded-xl m-[3px] transition-colors select-none min-h-[48px]",
                              isPreviewing
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : isToday
                                  ? "border-2 border-primary"
                                  : "hover:bg-muted/60"
                            )}
                            data-testid={`day-${day.getDate()}`}
                          >
                            {showDot ? (
                              <span className={cn(
                                "w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center text-base font-bold text-amber-950",
                                isToday && "ring-2 ring-primary ring-offset-1"
                              )}>
                                {day.getDate()}
                              </span>
                            ) : (
                              <span className={cn(
                                "text-base font-medium",
                                isPreviewing ? "text-primary-foreground font-bold"
                                  : isToday ? "text-primary font-bold"
                                  : "text-foreground"
                              )}>
                                {day.getDate()}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── LIST view ── */}
            {view === "list" && (
              <div className="flex-1 overflow-y-auto p-4">
                {listAppts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-16">
                    <p className="text-base font-semibold text-muted-foreground">No upcoming bookings this month</p>
                    <p className="text-sm text-muted-foreground/60 mt-1">Switch months using the tabs above</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {listAppts.map((apt: any) => {
                      const localDate = toStoreLocal(apt.date, timezone);
                      const dateLabel = format(localDate, "M/d");
                      const firstName = (apt.customer?.name?.split(" ")[0] || "Walk-In").toUpperCase();
                      const service = (apt.service?.name || "—").toUpperCase();
                      return (
                        <button
                          key={apt.id}
                          type="button"
                          onClick={() => onSelectAppointment(apt)}
                          className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm hover:bg-muted/40 active:scale-[0.98] transition-all text-left"
                          data-testid={`list-appt-${apt.id}`}
                        >
                          <span className="text-sm font-bold text-muted-foreground w-8 flex-shrink-0">{dateLabel}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-foreground truncate">{firstName}</p>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{service}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

          </div>

          {/* RIGHT: appointments panel — full height from below header */}
          {view === "calendar" && (
            <div className="w-[280px] flex-shrink-0 border-l flex flex-col bg-muted/20">
              {/* Slim day label row */}
              <div className="px-4 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
                <div>
                  <p className="font-semibold text-sm">{previewDayLabel}</p>
                  <p className="text-xs text-muted-foreground">
                    {dayAppts.length === 0 ? "No appointments" : `${dayAppts.length} appointment${dayAppts.length !== 1 ? "s" : ""}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectDate(previewDay)}
                  className="text-xs font-semibold text-primary hover:underline flex-shrink-0"
                  data-testid="datepicker-goto"
                >
                  Go to day →
                </button>
              </div>
              {/* Cards — scrollable, fills remaining height */}
              <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
                {dayAppts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-10">
                    <p className="text-sm text-muted-foreground">No bookings on this day</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Tap a different date</p>
                  </div>
                ) : (
                  dayAppts.map((apt: any) => {
                    const firstName = apt.customer?.name?.split(" ")[0] || "Walk-In";
                    const phone = apt.customer?.phone || "—";
                    const service = apt.service?.name || "—";
                    const timeStr = formatInTz(apt.date, timezone, "h:mm a");
                    return (
                      <button
                        key={apt.id}
                        type="button"
                        onClick={() => onSelectAppointment(apt)}
                        className="w-full text-left rounded-xl border bg-card px-3 py-2.5 shadow-sm hover:bg-muted/40 transition-colors"
                        data-testid={`appt-card-${apt.id}`}
                      >
                        <p className="font-bold text-sm text-foreground leading-tight">{firstName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{phone}</p>
                        <p className="text-xs text-foreground mt-1 font-medium">{service}</p>
                        <p className="text-xs text-muted-foreground/70 mt-0.5">{timeStr}</p>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
