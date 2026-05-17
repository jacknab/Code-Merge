import { useState, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { useServices } from "@/hooks/use-services";
import { useStaffList } from "@/hooks/use-staff";
import { useCustomers } from "@/hooks/use-customers";
import { useCreateAppointment } from "@/hooks/use-appointments";
import { useQuery } from "@tanstack/react-query";
import { useAddonsForService, useSetAppointmentAddons, useServiceCategories } from "@/hooks/use-addons";
import { useAvailableTime } from "@/hooks/use-available-time";
import { AvailableTimeBanner } from "@/components/AvailableTimeBanner";
import { useAvailableSlots, type TimeSlot } from "@/hooks/use-availability";
import { useSelectedStore } from "@/hooks/use-store";
import { getTimezoneAbbr, formatInTz, storeLocalToUtc, getNowInTimezone } from "@/lib/timezone";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, User, Users, X, Scissors, Sparkles, Loader2, Check, CalendarDays, Timer, AlertCircle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Service, Staff, Customer, Addon } from "@shared/schema";

type BookingStep = "services" | "addons" | "details";

export default function NewBooking() {
  const navigate = useNavigate();
  const { isLoading: authLoading } = useAuth();
  const { selectedStore } = useSelectedStore();
  const timezone = selectedStore?.timezone || "UTC";
  const tzAbbr = getTimezoneAbbr(timezone);

  const params = new URLSearchParams(window.location.search);
  const calStaffId = params.get("staffId") ? Number(params.get("staffId")) : null;
  const calDate = params.get("date");
  const calTime = params.get("time");
  const calAvailableMinutes = params.get("availableMinutes") ? Number(params.get("availableMinutes")) : null;
  const paramClientId = params.get("clientId") ? Number(params.get("clientId")) : null;
  const editAppointmentId = params.get("editId") ? Number(params.get("editId")) : null;
  const isReschedule = params.get("reschedule") === "1";
  const isCalendarBooking = !!(calStaffId && calDate && calTime);
  const isWalkIn = params.get("walkIn") === "1";

  const { data: services, isLoading: servicesLoading } = useServices();
  const { data: categories } = useServiceCategories();
  const { data: staffList } = useStaffList();
  const { data: customers } = useCustomers();
  const createAppointment = useCreateAppointment();
  const setAppointmentAddons = useSetAppointmentAddons();
  const { data: editAvailableTimeData } = useAvailableTime(editAppointmentId);

  const { data: serviceSuggestions } = useQuery<any[]>({
    queryKey: ["/api/intelligence/service-suggestion", paramClientId, selectedStore?.id],
    queryFn: async () => {
      const cid = paramClientId || null;
      if (!cid) return [];
      const res = await fetch(
        `/api/intelligence/service-suggestion/${cid}?storeId=${selectedStore?.id}`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!paramClientId && !!selectedStore?.id,
    staleTime: 5 * 60 * 1000,
  });

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categoryOrder, setCategoryOrder] = useState<string[] | null>(null);
  const [mobileCatStep, setMobileCatStep] = useState<"categories" | "services">("categories");
  const [mobileDetailsStep, setMobileDetailsStep] = useState<"staff" | "date" | "time">("staff");
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<Addon[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<BookingStep>("services");
  const [editInitialized, setEditInitialized] = useState(false);
  const [clientInitialized, setClientInitialized] = useState(false);

  const availableMinutes = isCalendarBooking && calAvailableMinutes && calAvailableMinutes > 0 ? calAvailableMinutes : null;

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => {
    if (calDate) {
      const [y, m, d] = calDate.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return getNowInTimezone(timezone);
  });
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [staffMode, setStaffMode] = useState<"any" | "specific">(isCalendarBooking ? "specific" : "any");
  const [specificStaffId, setSpecificStaffId] = useState<number | null>(calStaffId);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [calendarSlotInitialized, setCalendarSlotInitialized] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [walkInBookingPending, setWalkInBookingPending] = useState(false);
  const [detailsTab, setDetailsTab] = useState<"staff" | "time">(() =>
    isReschedule || isCalendarBooking || calStaffId ? "time" : "staff"
  );

  const handleCancel = () => {
    if (!selectedService) {
      navigate("/calendar");
    } else {
      setShowCancelConfirm(true);
    }
  };

  const addonTotalEarly = selectedAddons.reduce((sum, a) => sum + Number(a.price), 0);
  const addonDurationEarly = selectedAddons.reduce((sum, a) => sum + a.duration, 0);
  const totalDurationEarly = (selectedService?.duration || 0) + addonDurationEarly;
  const dateStringEarly = selectedDate
    ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`
    : null;

  const { data: slots, isLoading: slotsLoading } = useAvailableSlots(
    selectedService?.id || null,
    selectedStore?.id || null,
    dateStringEarly,
    totalDurationEarly,
    staffMode === "specific" ? specificStaffId : null
  );

  useEffect(() => {
    if (isCalendarBooking && staffList && !calendarSlotInitialized) {
      const staffMember = staffList.find((s: Staff) => s.id === calStaffId);
      if (staffMember) {
        const utcTime = storeLocalToUtc(`${calDate}T${calTime}:00`, timezone);
        if (utcTime.getTime() <= Date.now()) {
          navigate("/calendar");
          return;
        }
        setSelectedStaff(staffMember);
        setSelectedSlot({
          time: utcTime.toISOString(),
          staffId: calStaffId!,
          staffName: staffMember.name,
        });
        setCalendarSlotInitialized(true);
      }
    }
  }, [isCalendarBooking, staffList, calStaffId, calTime, calDate, timezone, calendarSlotInitialized, navigate]);

  useEffect(() => {
    if (!isWalkIn) return;
    if (selectedSlot) return;
    if (slotsLoading) return;
    if (!slots || slots.length === 0) return;
    const next = slots.find((s) => new Date(s.time).getTime() > Date.now());
    if (!next) return;
    setSelectedSlot(next);
    setSelectedStaff(staffList?.find((s: Staff) => s.id === next.staffId) || null);
  }, [isWalkIn, selectedSlot, slots, slotsLoading, staffList]);

  useEffect(() => {
    if (!walkInBookingPending) return;
    if (!selectedSlot) return;
    setWalkInBookingPending(false);
    handleRequestBooking();
  }, [walkInBookingPending, selectedSlot]);

  useEffect(() => {
    if (!walkInBookingPending) return;
    if (slotsLoading) return;
    if (selectedSlot) return;
    if (slots && slots.length > 0) return;
    setWalkInBookingPending(false);
    window.alert("No staff are available for a walk-in right now. Please pick a future time slot manually.");
    navigate("/calendar");
  }, [walkInBookingPending, slotsLoading, selectedSlot, slots, navigate]);

  useEffect(() => {
    if (paramClientId && customers && !clientInitialized) {
      const client = customers.find((c: Customer) => String(c.id) === String(paramClientId));
      if (client) {
        setSelectedCustomer(client);
        setClientInitialized(true);
      }
    }
  }, [paramClientId, customers, clientInitialized]);

  useEffect(() => {
    if (editAppointmentId && services && staffList && !editInitialized) {
      fetch(`/api/appointments?storeId=${selectedStore?.id}`, { credentials: "include" })
        .then(res => res.json())
        .then((allAppointments: any[]) => {
          const apt = allAppointments.find((a: any) => a.id === editAppointmentId);
          if (!apt) return;

          const svc = services.find((s: Service) => s.id === apt.serviceId);
          if (svc) {
            setSelectedService(svc);
            setSelectedCategory(svc.category);
          }

          const staff = staffList.find((s: Staff) => s.id === apt.staffId);
          if (staff) {
            setSelectedStaff(staff);
            setStaffMode("specific");
            setSpecificStaffId(staff.id);
          }

          if (apt.customer && customers) {
            const client = customers.find((c: Customer) => c.id === apt.customerId);
            if (client) setSelectedCustomer(client);
          }

          if (apt.notes) setNotes(apt.notes);

          if (apt.appointmentAddons && apt.appointmentAddons.length > 0) {
            const addonItems = apt.appointmentAddons
              .map((aa: any) => aa.addon)
              .filter(Boolean);
            setSelectedAddons(addonItems);
          }

          if (isReschedule) {
            setSelectedDate(getNowInTimezone(timezone));
            setSelectedSlot(null);
          } else {
            const aptDate = new Date(apt.date);
            setSelectedDate(aptDate);
            setSelectedSlot({
              time: apt.date,
              staffId: apt.staffId,
              staffName: staff?.name || "",
            });
          }

          setEditInitialized(true);

          if (isReschedule) {
            setStep("details");
          } else if (apt.appointmentAddons && apt.appointmentAddons.length > 0) {
            setStep("addons");
          }
        })
        .catch(() => {});
    }
  }, [editAppointmentId, services, staffList, customers, selectedStore, editInitialized]);

  const { data: availableAddons, isLoading: addonsLoading } = useAddonsForService(selectedService?.id || null);

  const addonTotal = addonTotalEarly;
  const addonDuration = addonDurationEarly;
  const servicePrice = selectedService ? Number(selectedService.price) : 0;
  const totalPrice = servicePrice + addonTotal;
  const totalDuration = totalDurationEarly;
  const dateString = dateStringEarly;

  const autoAdvanceOriginRef = useRef<Date | null>(null);
  const [autoAdvancing, setAutoAdvancing] = useState(false);

  useEffect(() => {
    autoAdvanceOriginRef.current = null;
    setAutoAdvancing(false);
  }, [selectedService?.id, specificStaffId, staffMode, totalDuration, selectedStore?.id]);

  useEffect(() => {
    if (isCalendarBooking) return;
    if (!selectedDate) return;
    if (slotsLoading) return;
    if (!slots) return;
    if (slots.length > 0) {
      setAutoAdvancing(false);
      return;
    }
    if (!selectedService || !selectedStore || totalDuration <= 0) return;
    if (staffMode === "specific" && !specificStaffId) return;

    if (!autoAdvanceOriginRef.current) {
      autoAdvanceOriginRef.current = selectedDate;
    }
    const daysAhead = Math.floor(
      (selectedDate.getTime() - autoAdvanceOriginRef.current.getTime()) / 86400000,
    );
    if (daysAhead >= 60) {
      setAutoAdvancing(false);
      return;
    }

    setAutoAdvancing(true);
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    setSelectedDate(next);
  }, [
    slots,
    slotsLoading,
    selectedDate,
    selectedService,
    selectedStore,
    totalDuration,
    staffMode,
    specificStaffId,
    isCalendarBooking,
  ]);

  const categoryNames = useMemo(() => {
    let names: string[] = [];
    if (categories && categories.length > 0) {
      names = Array.from(new Set(categories.map((c: any) => c.name))) as string[];
    } else if (services) {
      const catSet = new Set<string>();
      services.forEach((s: Service) => catSet.add(s.category));
      names = Array.from(catSet);
    }
    if (categoryOrder) {
      return categoryOrder.filter((c) => names.includes(c)).concat(names.filter((c) => !categoryOrder.includes(c)));
    }
    return names.sort();
  }, [services, categories, categoryOrder]);

  useEffect(() => {
    const stored = localStorage.getItem("categoryOrder");
    if (stored) setCategoryOrder(JSON.parse(stored));
  }, []);

  const filteredServices = useMemo(() => {
    if (!services) return [];
    const activeCat = selectedCategory || (categoryNames.length > 0 ? categoryNames[0] : null);
    if (!activeCat) return services;
    return services.filter((s: Service) => s.category === activeCat);
  }, [services, selectedCategory, categoryNames]);

  const activeCategory = selectedCategory || (categoryNames.length > 0 ? categoryNames[0] : null);

  const handleSelectService = (service: Service) => {
    if (selectedService?.id !== service.id) {
      setSelectedAddons([]);
      if (!isCalendarBooking) {
        setSelectedSlot(null);
        setSelectedStaff(null);
      }
    }
    setSelectedService(service);
    setStep("addons");
  };

  const handleRemoveService = () => {
    setSelectedService(null);
    setSelectedAddons([]);
    setSelectedSlot(null);
    setSelectedStaff(null);
    setStep("services");
  };

  const handleToggleAddon = (addon: Addon) => {
    setSelectedAddons(prev => {
      const exists = prev.find(a => a.id === addon.id);
      if (exists) return prev.filter(a => a.id !== addon.id);
      return [...prev, addon];
    });
  };

  const handleRemoveAddon = (addonId: number) => {
    setSelectedAddons(prev => prev.filter(a => a.id !== addonId));
  };

  const triggerWalkInBooking = () => {
    if (selectedSlot) {
      handleRequestBooking();
    } else {
      setWalkInBookingPending(true);
    }
  };

  const handleContinueToAddons = () => {
    if (availableAddons && availableAddons.length > 0) {
      setStep("addons");
    } else if (isCalendarBooking) {
      handleRequestBooking();
    } else if (isWalkIn) {
      triggerWalkInBooking();
    } else {
      setStep("details");
    }
  };

  const handleContinueToDetails = () => {
    if (isCalendarBooking) {
      handleRequestBooking();
    } else if (isWalkIn) {
      triggerWalkInBooking();
    } else {
      setStep("details");
    }
  };

  const handleSaveEdit = () => {
    if (!editAppointmentId) return;
    setAppointmentAddons.mutate(
      { appointmentId: editAppointmentId, addonIds: selectedAddons.map(a => a.id) },
      { onSuccess: () => navigate("/calendar") }
    );
  };

  const handleDateChange = (date: Date | undefined) => {
    setSelectedDate(date);
    setSelectedSlot(null);
  };

  const handleStaffModeChange = (mode: "any" | "specific") => {
    setStaffMode(mode);
    setSelectedSlot(null);
    if (mode === "any") {
      setSpecificStaffId(null);
    }
  };

  const handleSpecificStaffSelect = (staffId: number) => {
    setSpecificStaffId(staffId);
    setSelectedSlot(null);
  };

  const handleRequestBooking = () => {
    if (!selectedService || !selectedSlot) return;

    const staffId = selectedSlot.staffId;

    createAppointment.mutate(
      {
        date: selectedSlot.time,
        serviceId: selectedService.id,
        staffId,
        customerId: selectedCustomer?.id || undefined,
        duration: totalDuration,
        notes: notes || undefined,
        status: "pending",
      } as any,
      {
        onSuccess: (data: any) => {
          if (selectedAddons.length > 0 && data?.id) {
            setAppointmentAddons.mutate(
              { appointmentId: data.id, addonIds: selectedAddons.map(a => a.id) },
              {
                onSuccess: () => setShowConfirmation(true),
                onError: () => setShowConfirmation(true),
              }
            );
          } else {
            setShowConfirmation(true);
          }
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
    <div className="h-screen w-screen flex bg-[#F7F5F0] overflow-hidden">
      {/* ── SERVICES STEP ── */}
      {step === "services" && (
        <>
          {/* ── Mobile layout ── */}
          <div className="flex flex-col flex-1 overflow-hidden md:hidden">

            {/* ── Mobile: Category picker page ── */}
            {mobileCatStep === "categories" && (
              <>
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-4 bg-white border-b border-gray-200 shrink-0">
                  <Button variant="ghost" size="icon" onClick={handleCancel} className="text-gray-500 hover:text-gray-900 hover:bg-gray-100" data-testid="button-cancel-booking">
                    <X className="w-5 h-5" />
                  </Button>
                  <h1 className="font-bold text-lg flex-1 text-gray-900 tracking-tight">New Booking</h1>
                  {selectedCustomer && (
                    <span className="text-sm text-gray-500 truncate max-w-[120px]">{selectedCustomer.name}</span>
                  )}
                </div>
                <div className="flex gap-1.5 px-4 pb-3 pt-3 bg-white border-b border-gray-100 shrink-0">
                  {[1,2,3,4,5,6].map((s) => (
                    <div key={s} className={cn("h-1 flex-1 rounded-full transition-all duration-300", s <= 1 ? "bg-primary" : "bg-gray-200")} />
                  ))}
                </div>

                {/* Category list — full page, desktop sidebar style */}
                <div className="flex-1 overflow-y-auto bg-[#F7F5F0]">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Services</p>
                  </div>
                  {servicesLoading ? (
                    <div className="flex items-center justify-center h-40">
                      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                    </div>
                  ) : (
                    <nav className="py-2">
                      {categoryNames.map((cat) => {
                        const count = services?.filter((s: Service) => s.category === cat).length ?? 0;
                        return (
                          <button
                            key={cat}
                            onClick={() => {
                              setSelectedCategory(cat);
                              setMobileCatStep("services");
                            }}
                            data-testid={`button-category-${cat.toLowerCase().replace(/\s+/g, "-")}`}
                            className="w-full text-left px-5 py-4 flex items-center justify-between gap-3 border-l-[3px] border-transparent hover:bg-gray-100 active:bg-gray-200 transition-colors"
                          >
                            <span className="font-semibold text-base text-gray-900">{cat}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-gray-400">{count} service{count !== 1 ? "s" : ""}</span>
                              <ArrowLeft className="w-4 h-4 text-gray-400 rotate-180" />
                            </div>
                          </button>
                        );
                      })}
                    </nav>
                  )}
                </div>
              </>
            )}

            {/* ── Mobile: Services list page (after category selected) ── */}
            {mobileCatStep === "services" && (
              <>
                {/* Header with back to categories */}
                <div className="flex items-center gap-3 px-4 py-4 bg-white border-b border-gray-200 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setMobileCatStep("categories")}
                    className="text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                    data-testid="button-back-categories"
                  >
                    <ArrowLeft className="w-5 h-5" />

                  </Button>
                  <div className="flex-1 min-w-0">
                    <h1 className="font-bold text-base text-gray-900 leading-tight truncate">{activeCategory}</h1>
                    {selectedCustomer && (
                      <p className="text-xs text-gray-500 truncate">{selectedCustomer.name}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 px-4 pb-3 pt-3 bg-white border-b border-gray-100 shrink-0">
                  {[1,2,3,4,5,6].map((s) => (
                    <div key={s} className={cn("h-1 flex-1 rounded-full transition-all duration-300", s <= 2 ? "bg-primary" : "bg-gray-200")} />
                  ))}
                </div>

                {/* Service grid */}
                <div className="flex-1 overflow-y-auto p-4 pb-32 bg-gray-50">
                  {servicesLoading ? (
                    <div className="flex items-center justify-center h-40">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {filteredServices.map((service: Service) => {
                        const isSelected = selectedService?.id === service.id;
                        return (
                          <Card
                            key={service.id}
                            className={cn(
                              "p-3 cursor-pointer transition-all flex flex-col",
                              isSelected
                                ? "ring-2 ring-primary bg-primary/5 shadow-lg shadow-primary/20"
                                : "bg-white hover-elevate"
                            )}
                            onClick={() => handleSelectService(service)}
                            data-testid={`card-service-${service.id}`}
                          >
                            {service.imageUrl && (
                              <div className="w-full aspect-[4/3] rounded-md bg-muted/50 mb-2 overflow-hidden">
                                <img
                                  src={service.imageUrl.replace(/_/g, '/').replace(/-/g, '+')}
                                  alt={service.name}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <h3 className="font-semibold text-sm leading-tight" data-testid={`text-service-name-${service.id}`}>
                              {service.name}
                            </h3>
                            <div className="flex items-center justify-between mt-auto pt-2">
                              <span className={cn("font-bold text-sm", isSelected ? "text-primary" : "text-foreground")}>
                                ${Number(service.price).toFixed(2)}
                              </span>
                              <Badge variant="secondary" className="no-default-active-elevate text-xs">
                                {service.duration}m
                              </Badge>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Mobile bottom action bar */}
                <div
                  className="fixed bottom-0 left-0 right-0 bg-gray-950 px-4 pt-4 md:pb-4 z-20"
                  style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
                >
                  {selectedService ? (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate text-white" data-testid="text-summary-service">{selectedService.name}</p>
                        <p className="text-xs text-white/50">
                          ${Number(selectedService.price).toFixed(2)} · {selectedService.duration} min
                        </p>
                      </div>
                      <Button
                        className="h-12 px-6 bg-primary hover:bg-primary/90 text-white shrink-0 rounded-xl font-semibold"
                        onClick={handleContinueToAddons}
                        data-testid="button-request-booking"
                      >
                        Continue
                      </Button>
                    </div>
                  ) : (
                    <Button className="w-full h-12 rounded-xl bg-white/10 text-white/40 border-0 hover:bg-white/10" disabled data-testid="button-request-booking">
                      Select a service to continue
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── Desktop layout ── */}
          <div className="hidden md:flex flex-1 overflow-hidden">
            <div className="w-[180px] flex-shrink-0 border-r bg-gray-50 flex flex-col shadow-[4px_0_20px_rgba(0,0,0,0.1)] z-10">
              <div className="px-5 py-4 border-b">
                <span className="font-bold text-lg tracking-tight font-display">Services</span>
              </div>
              <nav className="flex-1 overflow-y-auto py-2">
                {categoryNames.map((cat) => (
                  <div key={cat}>
                    <button
                      onClick={() => setSelectedCategory(cat)}
                      className={cn(
                        "w-full text-left px-5 py-3 text-sm font-semibold font-display transition-colors flex items-center gap-2",
                        activeCategory === cat
                          ? "text-gray-900 border-l-[3px] border-gray-900 bg-gray-200/60"
                          : "text-gray-700 border-l-[3px] border-transparent hover:text-gray-900 hover:bg-gray-100"
                      )}
                      data-testid={`button-category-${cat.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {cat}
                    </button>
                  </div>
                ))}
              </nav>
              <div className="p-3 border-t">
                <Button
                  className="w-full bg-gray-900 hover:bg-gray-800 text-white h-12"
                  onClick={handleCancel}
                  data-testid="button-cancel-booking"
                >
                  <span className="font-semibold">Cancel</span>
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {servicesLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Service suggestion strip for returning clients */}
                  {serviceSuggestions && serviceSuggestions.length > 0 && !selectedService && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                        Last Booked
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {serviceSuggestions.slice(0, 3).map((s: any) => (
                          <button
                            key={s.serviceId}
                            type="button"
                            onClick={() => {
                              const match = services?.find((sv: Service) => sv.id === s.serviceId);
                              if (match) handleSelectService(match);
                            }}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-violet-200 bg-violet-50 hover:bg-violet-100 text-sm font-medium text-violet-900 transition-colors"
                          >
                            <Sparkles className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
                            <span className="truncate max-w-[140px]">{s.serviceName}</span>
                            <span className="text-xs text-violet-500 flex-shrink-0 ml-1">×{s.visitCount}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {filteredServices.map((service: Service) => {
                      const isSelected = selectedService?.id === service.id;
                      return (
                        <Card
                          key={service.id}
                          className={cn(
                            "p-4 cursor-pointer transition-all h-40 flex flex-col",
                            isSelected ? "ring-2 ring-primary shadow-md" : "hover-elevate"
                          )}
                          onClick={() => handleSelectService(service)}
                          data-testid={`card-service-${service.id}`}
                        >
                          <div className="flex flex-col gap-2 flex-1">
                            {service.imageUrl && (
                              <div className="w-full aspect-[4/3] rounded-md bg-muted/50 flex items-center justify-center mb-1 overflow-hidden relative">
                                <img
                                  src={service.imageUrl.replace(/_/g, '/').replace(/-/g, '+')}
                                  alt={service.name}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <h3 className="font-semibold text-base leading-tight" data-testid={`text-service-name-${service.id}`}>{service.name}</h3>
                            <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                              <span className="font-bold text-base">${Number(service.price).toFixed(2)}</span>
                              <Badge variant="secondary" className="no-default-active-elevate text-xs">
                                {service.duration}m
                              </Badge>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="hidden md:flex">
            <BookingSummaryPanel
              selectedService={selectedService}
              selectedAddons={selectedAddons}
              selectedStaff={selectedStaff}
              selectedCustomer={selectedCustomer}
              customers={customers}
              totalPrice={totalPrice}
              totalDuration={totalDuration}
              onSetCustomer={setSelectedCustomer}
              onRemoveService={handleRemoveService}
              onRemoveAddon={handleRemoveAddon}
              onEditAddons={() => setStep("addons")}
              availableMinutes={availableMinutes}
              isCalendarBooking={isCalendarBooking}
              isEditMode={!!editAppointmentId}
              footerContent={
                editAppointmentId ? (
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 h-12 border-2 border-gray-400 text-gray-800 font-semibold hover:bg-gray-50"
                      onClick={() => navigate("/calendar")}
                      data-testid="button-edit-checkout"
                    >
                      Checkout
                    </Button>
                    <Button
                      className="flex-1 h-12 bg-gray-900 hover:bg-gray-800 text-white font-semibold"
                      onClick={handleSaveEdit}
                      disabled={setAppointmentAddons.isPending}
                      data-testid="button-save-edit"
                    >
                      {setAppointmentAddons.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="w-full bg-gray-900 hover:bg-gray-800 text-white h-12"
                    onClick={handleContinueToAddons}
                    disabled={!selectedService}
                    data-testid="button-request-booking"
                  >
                    <span className="flex flex-col items-center leading-tight">
                      <span className="font-semibold">Request Booking</span>
                      <span className="font-semibold opacity-90">{totalDuration} min</span>
                    </span>
                  </Button>
                )
              }
            />
          </div>
        </>
      )}

      {/* ── ADDONS STEP ── */}
      {step === "addons" && (
        <>
          {/* ── Mobile layout ── */}
          <div className="flex flex-col flex-1 overflow-hidden md:hidden">
            <div className="px-4 py-4 flex items-center gap-3 bg-gray-950 shrink-0">
              {!editAppointmentId && (
                <Button variant="ghost" size="icon" onClick={() => setStep("services")} className="text-white/70 hover:text-white hover:bg-white/10" data-testid="button-back-services">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              )}
              <div className="flex-1">
                <h2 className="font-semibold text-lg text-white" data-testid="text-extras-heading">Extras</h2>
                <p className="text-xs text-white/50" data-testid="text-extras-subheading">for {selectedService?.name}</p>
              </div>
            </div>
            <div className="flex gap-1.5 px-4 pb-3 bg-gray-950 shrink-0">
              {[1,2,3,4,5,6].map((s) => (
                <div key={s} className={cn("h-1 flex-1 rounded-full transition-all duration-300", s <= 3 ? "bg-primary" : "bg-white/15")} />
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-28 bg-gray-50">
              {addonsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : !availableAddons || availableAddons.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
                  <Sparkles className="w-10 h-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No extras for this service</p>
                  <Button onClick={handleContinueToDetails} className="mt-2 bg-primary text-white h-11 px-8 rounded-xl">
                    Continue
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {availableAddons.map((addon: Addon) => {
                    const isSelected = selectedAddons.some(a => a.id === addon.id);
                    return (
                      <Card
                        key={addon.id}
                        className={cn(
                          "p-3 cursor-pointer transition-all relative",
                          isSelected ? "ring-2 ring-primary shadow-md" : "hover-elevate"
                        )}
                        onClick={() => handleToggleAddon(addon)}
                        data-testid={`card-addon-${addon.id}`}
                      >
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center" data-testid={`addon-selected-${addon.id}`}>
                            <Check className="w-3 h-3 text-primary-foreground" />
                          </div>
                        )}
                        <div className="flex flex-col gap-1.5">
                          {addon.imageUrl && (
                            <div className="w-full aspect-[4/3] rounded-md bg-muted/50 mb-1 overflow-hidden">
                              <img
                                src={addon.imageUrl.replace(/_/g, '/').replace(/-/g, '+')}
                                alt={addon.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <h3 className="font-semibold text-xs leading-tight" data-testid={`text-addon-name-${addon.id}`}>{addon.name}</h3>
                          <div className="flex items-center justify-between mt-auto pt-1">
                            <span className="font-bold text-xs">${Number(addon.price).toFixed(2)}</span>
                            <Badge variant="secondary" className="no-default-active-elevate text-[10px]">{addon.duration}m</Badge>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Mobile bottom action bar */}
            <div
              className="fixed bottom-0 left-0 right-0 bg-gray-950 px-4 pt-4 md:pb-4 z-20"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate text-white">{selectedService?.name}</p>
                  <p className="text-xs text-white/50">
                    ${totalPrice.toFixed(2)} · {totalDuration} min
                    {selectedAddons.length > 0 && ` · ${selectedAddons.length} extra${selectedAddons.length > 1 ? "s" : ""}`}
                  </p>
                </div>
                <Button
                  className="h-12 px-6 bg-primary hover:bg-primary/90 text-white shrink-0 rounded-xl font-semibold"
                  onClick={handleContinueToDetails}
                  data-testid="button-request-booking-addons"
                >
                  {isCalendarBooking || isWalkIn ? "Book" : "Continue"}
                </Button>
              </div>
            </div>
          </div>

          {/* ── Desktop layout ── */}
          <div className="hidden md:flex flex-1 overflow-y-auto flex-col">
            <div className="p-4 border-b flex items-center gap-3 bg-card">
              {!editAppointmentId && (
                <Button variant="ghost" size="icon" onClick={() => setStep("services")} data-testid="button-back-services">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              )}
              <div className="flex-1">
                <h2 className="font-semibold text-lg" data-testid="text-extras-heading">Extras</h2>
                <p className="text-xs text-muted-foreground" data-testid="text-extras-subheading">for {selectedService?.name}</p>
              </div>
              {!editAppointmentId && (
                <Button variant="outline" size="sm" onClick={() => setStep("services")} data-testid="button-no-addons">
                  No Addons
                </Button>
              )}
            </div>
            <div className="p-6 space-y-5">
              {addonsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {availableAddons?.map((addon: Addon) => {
                    const isSelected = selectedAddons.some(a => a.id === addon.id);
                    return (
                      <Card
                        key={addon.id}
                        className={cn(
                          "p-4 cursor-pointer transition-all relative",
                          isSelected ? "ring-2 ring-primary shadow-md" : "hover-elevate"
                        )}
                        onClick={() => handleToggleAddon(addon)}
                        data-testid={`card-addon-${addon.id}`}
                      >
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center" data-testid={`addon-selected-${addon.id}`}>
                            <Check className="w-3 h-3 text-primary-foreground" />
                          </div>
                        )}
                        <div className="flex flex-col gap-2">
                          <div className="w-full aspect-[4/3] rounded-md bg-muted/50 flex items-center justify-center mb-1 overflow-hidden relative">
                            {addon.imageUrl ? (
                              <img
                                src={addon.imageUrl.replace(/_/g, '/').replace(/-/g, '+')}
                                alt={addon.name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const fallback = e.currentTarget.parentElement?.querySelector('.fallback-icon');
                                  if (fallback) fallback.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            <div className={`fallback-icon ${addon.imageUrl ? 'hidden' : ''} absolute inset-0 flex items-center justify-center`}>
                              <Sparkles className="w-8 h-8 text-muted-foreground/40" />
                            </div>
                          </div>
                          <h3 className="font-semibold text-sm leading-tight" data-testid={`text-addon-name-${addon.id}`}>{addon.name}</h3>
                          {addon.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{addon.description}</p>
                          )}
                          <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                            <span className="font-bold text-sm">${Number(addon.price).toFixed(2)}</span>
                            <Badge variant="secondary" className="no-default-active-elevate text-[10px]">
                              {addon.duration}m
                            </Badge>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="hidden md:flex">
            <BookingSummaryPanel
              selectedService={selectedService}
              selectedAddons={selectedAddons}
              selectedStaff={selectedStaff}
              selectedCustomer={selectedCustomer}
              customers={customers}
              totalPrice={totalPrice}
              totalDuration={totalDuration}
              onSetCustomer={setSelectedCustomer}
              onRemoveService={handleRemoveService}
              onRemoveAddon={handleRemoveAddon}
              onEditAddons={() => setStep("addons")}
              availableMinutes={availableMinutes}
              editAvailableMinutes={editAvailableTimeData?.availableMinutes}
              isCalendarBooking={isCalendarBooking}
              isEditMode={!!editAppointmentId}
              footerContent={
                editAppointmentId ? (
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 h-12 border-2 border-gray-400 text-gray-800 font-semibold hover:bg-gray-50"
                      onClick={() => navigate("/calendar")}
                      data-testid="button-edit-checkout-addons"
                    >
                      Checkout
                    </Button>
                    <Button
                      className="flex-1 h-12 bg-gray-900 hover:bg-gray-800 text-white font-semibold"
                      onClick={handleSaveEdit}
                      disabled={setAppointmentAddons.isPending}
                      data-testid="button-save-edit-addons"
                    >
                      {setAppointmentAddons.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="w-full bg-gray-900 hover:bg-gray-800 text-white h-12"
                    onClick={handleContinueToDetails}
                    data-testid="button-request-booking-addons"
                  >
                    <span className="flex flex-col items-center leading-tight">
                      <span className="font-semibold">Request Booking</span>
                      <span className="font-semibold opacity-90">{totalDuration} min</span>
                    </span>
                  </Button>
                )
              }
            />
          </div>
        </>
      )}

      {/* ── DETAILS STEP ── */}
      {step === "details" && (
        <>
          {/* ── Mobile layout — 3 dedicated pages ── */}
          <div className="flex flex-col flex-1 overflow-hidden md:hidden">

            {/* ─── Page 1: Choose Staff ─── */}
            {mobileDetailsStep === "staff" && (
              <>
                <div className="px-4 py-4 flex items-center gap-2 bg-gray-950 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (availableAddons && availableAddons.length > 0) setStep("addons");
                      else setMobileCatStep("services");
                      if (availableAddons && availableAddons.length === 0) setStep("services");
                    }}
                    className="text-white/70 hover:text-white hover:bg-white/10"
                    data-testid="button-back-from-details"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div className="flex-1">
                    <span className="font-semibold text-lg text-white">Choose Staff</span>
                    <p className="text-xs text-white/40">{selectedService?.name}</p>
                  </div>
                  <span className="text-xs text-white/30 font-medium">1 of 3</span>
                </div>
                <div className="flex gap-1.5 px-4 pb-3 bg-gray-950 shrink-0">
                  {[1,2,3,4,5,6].map((s) => (
                    <div key={s} className={cn("h-1 flex-1 rounded-full transition-all duration-300", s <= 4 ? "bg-primary" : "bg-white/15")} />
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto bg-white">
                  <div className="p-5">
                    <p className="text-sm text-muted-foreground mb-5">Pick who will perform the service, or let us choose the first available.</p>
                    <div className="space-y-3">
                      {/* Any Staff */}
                      <button
                        onClick={() => handleStaffModeChange("any")}
                        className={cn(
                          "w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left",
                          staffMode === "any" ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300 bg-white"
                        )}
                        data-testid="card-staff-any"
                      >
                        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <Users className="w-7 h-7 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-base">Any Staff</p>
                          <p className="text-sm text-muted-foreground">First available</p>
                        </div>
                        {staffMode === "any" && (
                          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                            <Check className="w-3.5 h-3.5 text-white" />
                          </div>
                        )}
                      </button>

                      {/* Staff members */}
                      {staffList?.map((member: Staff) => {
                        const isSelected = staffMode === "specific" && specificStaffId === member.id;
                        const color = member.color || "#3b82f6";
                        return (
                          <button
                            key={member.id}
                            onClick={() => { setStaffMode("specific"); handleSpecificStaffSelect(member.id); }}
                            className={cn(
                              "w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left",
                              isSelected ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300 bg-white"
                            )}
                            data-testid={`card-staff-${member.id}`}
                          >
                            <Avatar className="w-14 h-14 shrink-0">
                              <AvatarFallback style={{ backgroundColor: color + "22", color }} className="text-lg font-bold">
                                {member.name.split(" ").map((n: string) => n[0]).join("").toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-base truncate">{member.name}</p>
                              {member.role && <p className="text-sm text-muted-foreground capitalize truncate">{member.role}</p>}
                            </div>
                            {isSelected && (
                              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                                <Check className="w-3.5 h-3.5 text-white" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div
                  className="bg-white border-t px-4 pt-4 md:pb-4"
                  style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
                >
                  <Button
                    className="w-full h-13 rounded-2xl font-semibold text-base"
                    onClick={() => setMobileDetailsStep("date")}
                    disabled={staffMode === "specific" && !specificStaffId}
                    data-testid="button-staff-next"
                  >
                    Next: Choose Date
                  </Button>
                </div>
              </>
            )}

            {/* ─── Page 2: Choose Date ─── */}
            {mobileDetailsStep === "date" && (
              <>
                <div className="px-4 py-4 flex items-center gap-2 bg-gray-950 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setMobileDetailsStep("staff")}
                    className="text-white/70 hover:text-white hover:bg-white/10"
                    data-testid="button-back-to-staff"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div className="flex-1">
                    <span className="font-semibold text-lg text-white">Choose Date</span>
                    <p className="text-xs text-white/40">
                      {staffMode === "any" ? "Any Staff" : staffList?.find((s: Staff) => s.id === specificStaffId)?.name}
                    </p>
                  </div>
                  <span className="text-xs text-white/30 font-medium">2 of 3</span>
                </div>
                <div className="flex gap-1.5 px-4 pb-3 bg-gray-950 shrink-0">
                  {[1,2,3,4,5,6].map((s) => (
                    <div key={s} className={cn("h-1 flex-1 rounded-full transition-all duration-300", s <= 5 ? "bg-primary" : "bg-white/15")} />
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto bg-white">
                  <div className="p-4">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={handleDateChange}
                      disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                      className="rounded-2xl border mx-auto w-full"
                      data-testid="calendar-date-picker"
                    />

                    {/* Notes field on date page */}
                    <div className="mt-5 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes (optional)</p>
                      <Input
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Any special requests?"
                        data-testid="input-booking-notes"
                      />
                    </div>
                  </div>
                </div>

                <div
                  className="bg-white border-t px-4 pt-4 md:pb-4"
                  style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
                >
                  <Button
                    className="w-full h-13 rounded-2xl font-semibold text-base"
                    onClick={() => setMobileDetailsStep("time")}
                    disabled={!selectedDate}
                    data-testid="button-date-next"
                  >
                    Next: Choose Time
                  </Button>
                </div>
              </>
            )}

            {/* ─── Page 3: Choose Time Slot ─── */}
            {mobileDetailsStep === "time" && (
              <>
                <div className="px-4 py-4 flex items-center gap-2 bg-gray-950 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setMobileDetailsStep("date")}
                    className="text-white/70 hover:text-white hover:bg-white/10"
                    data-testid="button-back-to-date"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div className="flex-1">
                    <span className="font-semibold text-lg text-white">Choose Time</span>
                    <p className="text-xs text-white/40">
                      {selectedDate?.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    </p>
                  </div>
                  <span className="text-xs text-white/30 font-medium">3 of 3</span>
                </div>
                <div className="flex gap-1.5 px-4 pb-3 bg-gray-950 shrink-0">
                  {[1,2,3,4,5,6].map((s) => (
                    <div key={s} className={cn("h-1 flex-1 rounded-full transition-all duration-300", s <= 6 ? "bg-primary" : "bg-white/15")} />
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto bg-white">
                  <div className="p-4">
                    {slotsLoading || autoAdvancing ? (
                      <div className="flex flex-col items-center justify-center h-48 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        {autoAdvancing && <p className="text-sm text-muted-foreground">Finding next available date…</p>}
                      </div>
                    ) : !slots || slots.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
                        <Clock className="w-10 h-10 text-muted-foreground/30" />
                        <div>
                          <p className="text-base font-semibold text-foreground">No times available</p>
                          <p className="text-sm text-muted-foreground mt-1">No slots in the next 60 days</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setMobileDetailsStep("date")}>
                          Change Date
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground mb-4">
                          {slots.length} slot{slots.length !== 1 ? "s" : ""} available · {totalDuration} min · {tzAbbr}
                        </p>
                        <div className="grid grid-cols-3 gap-2.5">
                          {slots.map((slot) => {
                            const timePart = formatInTz(slot.time, timezone, "h:mm");
                            const periodPart = formatInTz(slot.time, timezone, "a").toUpperCase();
                            const staffForSlot = staffList?.find((s: Staff) => s.id === slot.staffId);
                            const isSelected = selectedSlot?.time === slot.time;
                            return (
                              <button
                                key={slot.time}
                                onClick={() => {
                                  setSelectedSlot(slot);
                                  setSelectedStaff(staffForSlot || null);
                                }}
                                className={cn(
                                  "flex flex-col items-center justify-center py-4 rounded-2xl border-2 transition-all",
                                  isSelected
                                    ? "bg-primary border-primary text-white shadow-lg shadow-primary/30"
                                    : "border-gray-200 hover:border-primary/40 bg-white"
                                )}
                                data-testid={`button-slot-${slot.time}`}
                              >
                                <span className="font-bold text-base leading-tight">{timePart}</span>
                                <span className={cn("text-xs font-medium mt-0.5", isSelected ? "text-white/80" : "text-muted-foreground")}>
                                  {periodPart}
                                </span>
                                {staffMode === "any" && staffForSlot && (
                                  <span className={cn("text-[10px] mt-1 truncate max-w-full px-1", isSelected ? "text-white/70" : "text-muted-foreground/70")}>
                                    {staffForSlot.name.split(" ")[0]}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div
                  className="bg-white border-t px-4 pt-4 md:pb-4"
                  style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
                >
                  {selectedSlot && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{formatInTz(selectedSlot.time, timezone, "h:mm a")} · {selectedSlot.staffName}</span>
                    </div>
                  )}
                  <Button
                    className="w-full h-13 rounded-2xl font-semibold text-base"
                    onClick={handleRequestBooking}
                    disabled={!selectedService || !selectedSlot || createAppointment.isPending}
                    data-testid="button-complete-booking"
                  >
                    {createAppointment.isPending ? "Booking..." : "Complete Booking"}
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* ── Desktop layout ── */}
          <div className="hidden md:flex flex-1 overflow-hidden">
            <div className="w-[300px] flex-shrink-0 border-r bg-card flex flex-col shadow-[4px_0_20px_rgba(0,0,0,0.1)] z-10">
              <div className="p-4 border-b flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => {
                  if (availableAddons && availableAddons.length > 0) setStep("addons");
                  else setStep("services");
                }} data-testid="button-back-from-details">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <span className="font-semibold text-lg">Select Date</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateChange}
                  disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  className="rounded-md border mx-auto"
                  data-testid="calendar-date-picker"
                />

                {!selectedCustomer && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Client</Label>
                    <Select onValueChange={(val) => {
                      const cust = customers?.find((c: Customer) => c.id === Number(val));
                      if (cust) setSelectedCustomer(cust);
                    }}>
                      <SelectTrigger data-testid="select-details-customer">
                        <SelectValue placeholder="Select Client" />
                      </SelectTrigger>
                      <SelectContent>
                        {customers?.map((c: Customer) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Notes</Label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any special requests?"
                    data-testid="input-booking-notes"
                  />
                </div>
              </div>
              <div className="p-3 border-t">
                <Button
                  className="w-full bg-gray-900 hover:bg-gray-800 text-white h-12"
                  onClick={handleCancel}
                  data-testid="button-cancel-booking-details"
                >
                  <span className="font-semibold">Cancel</span>
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="p-4 border-b bg-card flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-muted-foreground" />
                  <span className="font-semibold">
                    {selectedDate
                      ? selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
                      : "Select a date"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-md border p-0.5 bg-muted/40">
                    <button
                      type="button"
                      onClick={() => setDetailsTab("staff")}
                      className={cn(
                        "flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded transition-colors",
                        detailsTab === "staff"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      data-testid="tab-staff"
                    >
                      <User className="w-3.5 h-3.5" />
                      Staff
                      <span className="text-[10px] text-muted-foreground/80 ml-0.5">
                        ({staffMode === "any" ? "Any" : (staffList?.find((s: Staff) => s.id === specificStaffId)?.name?.split(" ")[0] || "—")})
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailsTab("time")}
                      className={cn(
                        "flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded transition-colors",
                        detailsTab === "time"
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      data-testid="tab-time"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      Time Slot
                    </button>
                  </div>
                  <Badge variant="secondary" className="no-default-active-elevate text-xs">
                    {tzAbbr} &middot; {timezone}
                  </Badge>
                </div>
              </div>

              {detailsTab === "staff" ? (
                <div className="p-6 space-y-6">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Pick who will perform the service, or let us pick the first available.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    <button
                      onClick={() => handleStaffModeChange("any")}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 transition-colors min-h-[140px]",
                        staffMode === "any"
                          ? "border-primary bg-primary/5"
                          : "border-border hover-elevate"
                      )}
                      data-testid="card-staff-any"
                    >
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Users className="w-6 h-6 text-primary" />
                      </div>
                      <p className="text-sm font-semibold">Any Staff</p>
                      <p className="text-[11px] text-muted-foreground text-center leading-tight">First available</p>
                      {staffMode === "any" && (
                        <Check className="w-4 h-4 text-primary" />
                      )}
                    </button>
                    {staffList?.map((member: Staff) => {
                      const isSelected = staffMode === "specific" && specificStaffId === member.id;
                      const color = member.color || "#3b82f6";
                      return (
                        <button
                          key={member.id}
                          onClick={() => {
                            setStaffMode("specific");
                            handleSpecificStaffSelect(member.id);
                          }}
                          className={cn(
                            "flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 transition-colors min-h-[140px]",
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "border-border hover-elevate"
                          )}
                          data-testid={`card-staff-${member.id}`}
                        >
                          <Avatar className="w-12 h-12">
                            <AvatarFallback
                              style={{ backgroundColor: color + "22", color: color }}
                              className="text-base font-bold"
                            >
                              {member.name.split(" ").map((n: string) => n[0]).join("").toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <p className="text-sm font-semibold text-center leading-tight truncate max-w-full">{member.name}</p>
                          <p className="text-[11px] text-muted-foreground text-center leading-tight truncate max-w-full">{member.role}</p>
                          {isSelected && (
                            <Check className="w-4 h-4 text-primary" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex justify-center pt-2">
                    <Button
                      className="h-11 px-8"
                      onClick={() => setDetailsTab("time")}
                      disabled={staffMode === "specific" && !specificStaffId}
                      data-testid="button-staff-continue"
                    >
                      Continue
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-6">
                  {!selectedDate ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center">
                      <CalendarDays className="w-10 h-10 text-muted-foreground/30 mb-3" />
                      <p className="text-sm text-muted-foreground">Pick a date to see available time slots</p>
                    </div>
                  ) : staffMode === "specific" && !specificStaffId ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center">
                      <User className="w-10 h-10 text-muted-foreground/30 mb-3" />
                      <p className="text-sm text-muted-foreground">Select a staff member to see their availability</p>
                    </div>
                  ) : slotsLoading || autoAdvancing ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      {autoAdvancing && (
                        <p className="text-sm text-muted-foreground">Finding next available date…</p>
                      )}
                    </div>
                  ) : !slots || slots.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center">
                      <Clock className="w-10 h-10 text-muted-foreground/30 mb-3" />
                      <p className="text-sm text-muted-foreground">No available time slots in the next 60 days</p>
                      <p className="text-xs text-muted-foreground mt-1">Try a different staff preference or service</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        {slots.length} available slot{slots.length !== 1 ? "s" : ""} &middot; {totalDuration} min per booking
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                        {slots.map((slot) => {
                          const timePart = formatInTz(slot.time, timezone, "h:mm");
                          const periodPart = formatInTz(slot.time, timezone, "a").toUpperCase();
                          const isSelected = selectedSlot?.time === slot.time;
                          const slotStaffColor = staffList?.find((s: Staff) => s.id === slot.staffId)?.color || "#3b82f6";

                          return (
                            <button
                              key={slot.time}
                              onClick={() => {
                                setSelectedSlot(slot);
                                setSelectedStaff(staffList?.find((s: Staff) => s.id === slot.staffId) || null);
                              }}
                              className={cn(
                                "flex flex-col items-center justify-center gap-0 px-3 py-3 rounded-md border text-sm transition-colors",
                                isSelected
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "hover-elevate"
                              )}
                              data-testid={`button-slot-${slot.time}`}
                            >
                              <span className="font-semibold leading-tight">{timePart}</span>
                              <span className={cn(
                                "text-[11px] font-medium leading-tight",
                                isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                              )}>{periodPart}</span>
                              {staffMode === "specific" && (
                                <span className={cn(
                                  "flex items-center gap-1 text-[10px] truncate max-w-full mt-0.5",
                                  isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                                )}>
                                  <span
                                    className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: isSelected ? "rgba(255,255,255,0.7)" : slotStaffColor }}
                                  />
                                  {slot.staffName}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="hidden md:flex">
            <BookingSummaryPanel
              selectedService={selectedService}
              selectedAddons={selectedAddons}
              selectedStaff={selectedStaff}
              selectedCustomer={selectedCustomer}
              customers={customers}
              totalPrice={totalPrice}
              totalDuration={totalDuration}
              onSetCustomer={setSelectedCustomer}
              onRemoveService={handleRemoveService}
              onRemoveAddon={handleRemoveAddon}
              onEditAddons={() => setStep("addons")}
              availableMinutes={availableMinutes}
              isCalendarBooking={isCalendarBooking}
              isEditMode={!!editAppointmentId}
              footerContent={
                <div className="space-y-2">
                  {selectedSlot && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <Clock className="w-3.5 h-3.5" />
                      <span>
                        {formatInTz(selectedSlot.time, timezone, "h:mm a")} &middot; {selectedSlot.staffName}
                      </span>
                    </div>
                  )}
                  <Button
                    className="w-full h-12 bg-primary text-primary-foreground"
                    onClick={handleRequestBooking}
                    disabled={!selectedService || !selectedSlot || createAppointment.isPending}
                    data-testid="button-complete-booking"
                  >
                    {createAppointment.isPending ? "Booking..." : "Complete Booking"}
                  </Button>
                </div>
              }
            />
          </div>
        </>
      )}

      {/* Desktop booking confirmation dialog */}
      <Dialog open={showConfirmation && window.innerWidth >= 768} onOpenChange={(open) => { if (!open) navigate("/calendar"); }}>
        <DialogContent className="sm:max-w-md" data-testid="booking-confirmation-dialog">
          <h2 className="text-xl font-bold">Appointment Confirmation</h2>
          <div className="space-y-4 mt-2">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Service</p>
              <p className="font-semibold text-base mt-1" data-testid="confirm-service-name">{selectedService?.name}</p>
            </div>
            {selectedSlot && (
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <CalendarDays className="w-4 h-4 text-muted-foreground" />
                  <span data-testid="confirm-date">{formatInTz(selectedSlot.time, timezone, "EEEE, MMM d, yyyy")}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span data-testid="confirm-time">{formatInTz(selectedSlot.time, timezone, "h:mm a")}</span>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Customer</p>
                <p className="font-medium text-sm mt-1" data-testid="confirm-customer">{selectedCustomer?.name || "Walk-In"}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Staff</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-medium text-sm" data-testid="confirm-staff">{selectedSlot?.staffName}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-center mt-4">
            <Button
              className="px-8"
              onClick={() => navigate("/calendar")}
              data-testid="button-confirmation-ok"
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mobile full-screen booking confirmed success screen */}
      {showConfirmation && window.innerWidth < 768 && (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-background"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          data-testid="mobile-booking-success-screen"
        >
          {/* Top gradient accent */}
          <div className="flex-shrink-0 h-2 bg-gradient-to-r from-green-400 via-emerald-400 to-teal-400" />

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto flex flex-col items-center px-6 pt-10 pb-6">
            {/* Animated checkmark */}
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mb-5 shadow-lg">
              <Check className="w-10 h-10 text-green-600" strokeWidth={2.5} />
            </div>

            <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Booked!</h1>
            <p className="text-sm text-muted-foreground mt-1 mb-8">Appointment successfully created</p>

            {/* Summary card */}
            <div className="w-full max-w-sm bg-card border rounded-2xl shadow-sm overflow-hidden">
              {/* Service */}
              <div className="px-5 py-4 border-b">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Service</p>
                <p className="text-base font-bold text-foreground" data-testid="confirm-service-name">{selectedService?.name}</p>
                {selectedAddons.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">{selectedAddons.map(a => a.name).join(", ")}</p>
                )}
              </div>

              {/* Date & time */}
              {selectedSlot && (
                <div className="px-5 py-4 border-b flex items-start gap-3">
                  <CalendarDays className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold" data-testid="confirm-date">
                      {formatInTz(selectedSlot.time, timezone, "EEEE, MMM d, yyyy")}
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5" data-testid="confirm-time">
                      {formatInTz(selectedSlot.time, timezone, "h:mm a")}
                    </p>
                  </div>
                </div>
              )}

              {/* Customer & staff */}
              <div className="px-5 py-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Customer</p>
                  <p className="text-sm font-semibold" data-testid="confirm-customer">{selectedCustomer?.name || "Walk-In"}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Staff</p>
                  <p className="text-sm font-semibold" data-testid="confirm-staff">{selectedSlot?.staffName}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom action buttons */}
          <div className="flex-shrink-0 px-6 pb-4 space-y-3">
            {/* Share button — only shown if Web Share API is available */}
            {typeof navigator !== "undefined" && typeof (navigator as any).share === "function" && selectedSlot && (
              <button
                className="w-full min-h-[52px] flex items-center justify-center gap-2 rounded-2xl border-2 border-primary/20 bg-primary/5 text-primary font-semibold text-sm active:opacity-70 transition-opacity"
                onClick={async () => {
                  try {
                    await (navigator as any).share({
                      title: "Appointment Confirmed",
                      text: `${selectedCustomer?.name || "Walk-In"} booked ${selectedService?.name} with ${selectedSlot?.staffName} on ${formatInTz(selectedSlot.time, timezone, "EEEE, MMM d")} at ${formatInTz(selectedSlot.time, timezone, "h:mm a")}`,
                    });
                  } catch (_) {}
                }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share Appointment
              </button>
            )}
            <button
              className="w-full min-h-[52px] flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground font-bold text-sm active:opacity-80 transition-opacity"
              onClick={() => { navigate("/booking/new"); window.location.reload(); }}
              data-testid="button-book-another"
            >
              Book Another
            </button>
            <button
              className="w-full min-h-[48px] flex items-center justify-center rounded-2xl border border-border text-sm font-semibold text-foreground active:bg-muted transition-colors"
              onClick={() => navigate("/calendar")}
              data-testid="button-confirmation-ok"
            >
              Back to Calendar
            </button>
          </div>
        </div>
      )}

      {/* Cancel confirmation dialog */}
      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="max-w-sm text-center" data-testid="cancel-confirm-dialog">
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="w-14 h-14 rounded-full border-[3px] border-amber-400 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-amber-400" strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Service not saved</h3>
              <p className="text-sm text-muted-foreground mt-1">Are you sure you want to leave the page?</p>
            </div>
            <div className="flex gap-3 w-full pt-1">
              <Button
                variant="outline"
                className="flex-1 h-11"
                onClick={() => setShowCancelConfirm(false)}
                data-testid="button-cancel-no"
              >
                No
              </Button>
              <Button
                className="flex-1 h-11 bg-gray-900 hover:bg-gray-800 text-white"
                onClick={() => navigate("/calendar")}
                data-testid="button-cancel-yes"
              >
                Yes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InlineAddonsSection({
  serviceId,
  serviceName,
  selectedAddons,
  onToggleAddon,
}: {
  serviceId: number;
  serviceName: string;
  selectedAddons: Addon[];
  onToggleAddon: (addon: Addon) => void;
}) {
  const { data: availableAddons, isLoading } = useAddonsForService(serviceId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading extras...</span>
      </div>
    );
  }

  if (!availableAddons || availableAddons.length === 0) return null;

  return (
    <div data-testid="inline-addons-section">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">Extras for {serviceName}</h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {availableAddons.map((addon: Addon) => {
          const isSelected = selectedAddons.some(a => a.id === addon.id);
          return (
            <Card
              key={addon.id}
              className={cn(
                "p-3 cursor-pointer transition-all relative",
                isSelected ? "ring-2 ring-primary shadow-md" : "hover-elevate"
              )}
              onClick={() => onToggleAddon(addon)}
              data-testid={`inline-addon-${addon.id}`}
            >
              {isSelected && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                  <Check className="w-3 h-3 text-primary-foreground" />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <h4 className="font-semibold text-xs leading-tight">{addon.name}</h4>
                {addon.description && (
                  <p className="text-[10px] text-muted-foreground line-clamp-2">{addon.description}</p>
                )}
                <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                  <span className="font-bold text-xs">${Number(addon.price).toFixed(2)}</span>
                  <Badge variant="secondary" className="no-default-active-elevate text-[10px]">
                    {addon.duration}m
                  </Badge>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function BookingSummaryPanel({
  selectedService,
  selectedAddons,
  selectedStaff,
  selectedCustomer,
  customers,
  totalPrice,
  totalDuration,
  onSetCustomer,
  onRemoveService,
  onRemoveAddon,
  onEditAddons,
  footerContent,
  availableMinutes,
  editAvailableMinutes,
  isCalendarBooking,
  isEditMode,
}: {
  selectedService: Service | null;
  selectedAddons: Addon[];
  selectedStaff: Staff | null;
  selectedCustomer: Customer | null;
  customers: Customer[] | undefined;
  totalPrice: number;
  totalDuration: number;
  onSetCustomer: (c: Customer | null) => void;
  onRemoveService: () => void;
  onRemoveAddon: (id: number) => void;
  onEditAddons?: () => void;
  footerContent: React.ReactNode;
  availableMinutes?: number | null;
  editAvailableMinutes?: number | null;
  isCalendarBooking?: boolean;
  isEditMode?: boolean;
}) {
  const remainingMinutes = availableMinutes != null ? availableMinutes - totalDuration : null;
  const isOverTime = remainingMinutes != null && remainingMinutes < 0;
  const [highlightedServiceId, setHighlightedServiceId] = useState<number | null>(null);

  const formatPhoneNumber = (raw: string) => {
    const digits = (raw || "").replace(/\D/g, "");
    const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (ten.length !== 10) return raw;
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  };
  const { selectedStore: panelStore } = useSelectedStore();
  const { data: allAppts = [] } = useQuery<any[]>({
    queryKey: ["/api/appointments", panelStore?.id],
    queryFn: () =>
      fetch(`/api/appointments?storeId=${panelStore?.id}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!panelStore?.id && !!selectedCustomer,
    staleTime: 60_000,
  });

  const { data: clientIntelData } = useQuery<any>({
    queryKey: ["/api/intelligence/client", selectedCustomer?.id, panelStore?.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/intelligence/client/${selectedCustomer!.id}?storeId=${panelStore?.id}`,
        { credentials: "include" }
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedCustomer?.id && !!panelStore?.id,
    staleTime: 5 * 60 * 1000,
  });
  const bookingIntel = clientIntelData?.intel;
  const noShowInfo = useMemo(() => {
    if (!selectedCustomer) return null;
    const mine = (allAppts as any[]).filter(a => a.customerId === selectedCustomer.id);
    const total = mine.length;
    const noShows = mine.filter(a => a.status === "no_show").length;
    if (total < 3 || noShows === 0) return null;
    const rate = noShows / total;
    if (rate < 0.25) return null;
    return { rate, noShows, total };
  }, [allAppts, selectedCustomer]);
  return (
    <div className="w-[460px] flex-shrink-0 border-l bg-card flex flex-col shadow-[-4px_0_20px_rgba(0,0,0,0.1)] z-10" data-testid="booking-summary-panel">
      <div className="p-4 border-b flex items-center gap-3">
        <Avatar className="w-10 h-10">
          <AvatarFallback className="text-sm font-bold bg-slate-200 text-slate-700">
            {selectedCustomer ? selectedCustomer.name.slice(0, 1).toUpperCase() : "W"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          {selectedCustomer ? (
            <>
              <button
                type="button"
                onClick={() => onSetCustomer(null)}
                className="w-full text-left flex items-center gap-2 -m-1 p-1 rounded-md hover:bg-muted/50 active:bg-muted transition-colors"
                data-testid="button-replace-client"
                title="Replace client"
              >
                <span className="text-xl font-bold text-foreground truncate">
                  {selectedCustomer.name}
                </span>
                <X className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
              {selectedCustomer.phone && (
                <p className="text-xs text-muted-foreground mt-0.5">{formatPhoneNumber(selectedCustomer.phone)}</p>
              )}
              {noShowInfo && (
                <div
                  className={cn(
                    "mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                    noShowInfo.rate >= 0.5
                      ? "bg-red-50 border-red-300 text-red-700"
                      : "bg-amber-50 border-amber-300 text-amber-700",
                  )}
                  data-testid="badge-no-show-risk"
                  title={`${noShowInfo.noShows} no-shows out of ${noShowInfo.total} bookings`}
                >
                  <AlertCircle className="w-3 h-3" />
                  No-show risk · {Math.round(noShowInfo.rate * 100)}% ({noShowInfo.noShows}/{noShowInfo.total})
                </div>
              )}
              {/* Deposit recommendation for high-risk clients */}
              {noShowInfo && noShowInfo.rate >= 0.4 && (
                <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                  <AlertCircle className="w-3 h-3" />
                  Deposit recommended
                </div>
              )}
              {/* Intelligence cadence hint */}
              {bookingIntel && bookingIntel.avgVisitCadenceDays > 0 && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {bookingIntel.totalVisits > 0 && (
                    <span>{bookingIntel.totalVisits} visits</span>
                  )}
                  {bookingIntel.totalVisits > 0 && <span className="text-muted-foreground/40">·</span>}
                  <span>
                    every {bookingIntel.avgVisitCadenceDays}d
                  </span>
                  {bookingIntel.lifetimeValue > 0 && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="font-medium text-foreground">${Math.round(bookingIntel.lifetimeValue).toLocaleString()} LTV</span>
                    </>
                  )}
                </div>
              )}
              {selectedCustomer?.allergies && (
                <div
                  className="mt-1.5 flex items-start gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-700"
                  data-testid="badge-allergy-alert"
                  title={selectedCustomer.allergies}
                >
                  <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>Allergy alert: {selectedCustomer.allergies}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium" data-testid="text-walk-in">Walk-In</span>
              <Select onValueChange={(val) => {
                const cust = customers?.find((c: Customer) => c.id === Number(val));
                if (cust) onSetCustomer(cust);
              }}>
                <SelectTrigger className="h-7 w-7 p-0 border-0 [&>svg]:hidden" data-testid="select-booking-customer">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                </SelectTrigger>
                <SelectContent>
                  {customers?.map((c: Customer) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        {highlightedServiceId !== null && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemoveService(); setHighlightedServiceId(null); }}
            className="flex-shrink-0 p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
            data-testid="button-remove-service-trash"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedService ? (
          <div
            className={cn(
              "w-full border-b cursor-pointer transition-colors duration-150 select-none",
              highlightedServiceId === selectedService.id
                ? "bg-yellow-100 border-yellow-300"
                : "bg-gray-50 hover:bg-yellow-50"
            )}
            onClick={() => {
              if (selectedAddons.length > 0 && onEditAddons) {
                onEditAddons();
              } else {
                setHighlightedServiceId(
                  highlightedServiceId === selectedService.id ? null : selectedService.id
                );
              }
            }}
          >
            <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
              <div className="flex-1">
                <h4 className="font-bold text-base leading-snug" data-testid="text-summary-service">
                  {selectedService.name} <span className="font-medium text-sm text-muted-foreground">({selectedService.duration}m)</span>
                </h4>
                {selectedStaff && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <Badge variant="outline" className="no-default-active-elevate text-[10px] px-1.5 py-0">{selectedStaff.name}</Badge>
                  </p>
                )}
              </div>
              <span className="font-bold text-base" data-testid="text-summary-service-price">${Number(selectedService.price).toFixed(2)}</span>
            </div>

            {selectedAddons.length > 0 && (
              <div className="px-4 pb-3 space-y-1.5 border-t border-dashed border-gray-300">
                {selectedAddons.map((addon) => (
                  <div key={addon.id} className="flex items-center justify-between gap-2 pt-2" data-testid={`summary-addon-${addon.id}`}>
                    <span className="text-sm font-semibold text-gray-800">
                      + {addon.name} <span className="font-medium text-muted-foreground">({addon.duration}m)</span>
                    </span>
                    <span className="text-sm font-bold text-gray-800">${Number(addon.price).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <Sparkles className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Select a service to begin</p>
          </div>
        )}
      </div>

      {isEditMode && editAvailableMinutes != null && (
        <div className="px-4 pb-3">
          <AvailableTimeBanner availableMinutes={editAvailableMinutes} />
        </div>
      )}

      <div className="border-t p-4 space-y-3">
        {isCalendarBooking && availableMinutes != null && (
          <div
            className={cn(
              "rounded-md p-3 flex items-start gap-2.5",
              isOverTime
                ? "bg-destructive/10 border border-destructive/20"
                : "bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800"
            )}
            data-testid="available-time-banner"
          >
            <Timer className={cn("w-4 h-4 mt-0.5 flex-shrink-0", isOverTime ? "text-destructive" : "text-sky-600 dark:text-sky-400")} />
            <div>
              <p className={cn("text-sm font-semibold", isOverTime ? "text-destructive" : "text-foreground")}>
                Available Time
              </p>
              <p className={cn("text-xs", isOverTime ? "text-destructive/80" : "text-muted-foreground")}>
                {isOverTime
                  ? `Exceeds available time by ${Math.abs(remainingMinutes!)} min.`
                  : `You have ${availableMinutes} minutes available for this slot. Used: ${totalDuration} min.`
                }
              </p>
            </div>
          </div>
        )}
        {isEditMode ? (
          <p className="text-sm text-muted-foreground text-center">
            Total: <span className="font-semibold text-foreground">${totalPrice.toFixed(2)}</span>
            {totalDuration > 0 && <span> ({totalDuration} mins)</span>}
          </p>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold">Total</span>
              {totalDuration > 0 && <p className="text-xs text-muted-foreground">{totalDuration} min</p>}
            </div>
            <span className="font-bold text-lg" data-testid="text-summary-total">${totalPrice.toFixed(2)}</span>
          </div>
        )}
        {footerContent}
      </div>
    </div>
  );
}
