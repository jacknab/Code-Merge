import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  X,
  Plus,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  CheckCircle2,
  User,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInTz, getNowInTimezone } from "@/lib/timezone";
import { apiRequest } from "@/lib/queryClient";
import { addDays, subDays, isSameDay } from "date-fns";
import { StoreData, ServiceData, CategoryData, TimeSlot, AddonData, ServiceAddonData } from "./types";

type Step = "client" | "services" | "time" | "confirm";

interface SimpleThemeProps {
  store: StoreData;
  slug: string;
  preselectedStaffId?: number;
}

export default function SimpleTheme({ store, slug, preselectedStaffId }: SimpleThemeProps) {
  const [step, setStep] = useState<Step>("client");
  const [clientType, setClientType] = useState<"new" | "returning" | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [returningPhone, setReturningPhone] = useState("");
  const [preselectedStaffName, setPreselectedStaffName] = useState<string | null>(null);

  const { data: publicStaff = [] } = useQuery<any[]>({
    queryKey: ["/api/public/store", slug, "staff"],
    queryFn: async () => {
      const res = await fetch(`/api/public/store/${slug}/staff`);
      if (!res.ok) throw new Error("Failed to fetch staff");
      return res.json();
    },
    enabled: !!preselectedStaffId,
  });
  const preselectedStaff = preselectedStaffId
    ? publicStaff.find((m) => m.id === preselectedStaffId) ?? null
    : null;
  const [selectedServices, setSelectedServices] = useState<ServiceData[]>([]);
  const [selectedAddons, setSelectedAddons] = useState<Record<number, number[]>>({});
  const [viewingAddonsForService, setViewingAddonsForService] = useState<ServiceData | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [bookingSuccess, setBookingSuccess] = useState(false);

  const timezone = store.timezone || "UTC";

  const { data: storeData } = useQuery<StoreData & { businessHours: any[] }>({
    queryKey: [`/api/public/store/${slug}`],
    enabled: !!slug,
  });

  const closingTime = useMemo(() => {
    if (!storeData?.businessHours) return null;
    const today = getNowInTimezone(timezone);
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const todayHours = storeData.businessHours.find((h: any) => h.dayOfWeek === dayOfWeek);
    if (!todayHours || todayHours.isClosed) return null;
    
    // Parse HH:mm:ss
    const [h, m] = todayHours.closeTime.split(':');
    const date = new Date();
    date.setHours(parseInt(h), parseInt(m));
    return formatInTz(date, timezone, "h:mm a");
  }, [storeData, timezone]);

  const { data: servicesData, isLoading: servicesLoading } = useQuery<{
    services: ServiceData[];
    categories: CategoryData[];
    addons: AddonData[];
    serviceAddons: ServiceAddonData[];
  }>({
    queryKey: [`/api/public/store/${slug}/services`],
    enabled: !!slug,
  });

  const services = servicesData?.services || [];
  const categories = servicesData?.categories || [];
  const addons = servicesData?.addons || [];
  const serviceAddons = servicesData?.serviceAddons || [];
  const showPrices = (storeData as any)?.showPrices ?? true;

  const getAddonsForService = (serviceId: number) => {
    const mappings = serviceAddons.filter(sa => sa.serviceId === serviceId);
    const addonIds = new Set(mappings.map(sa => sa.addonId));
    return addons.filter(a => addonIds.has(a.id));
  };

  const totalPrice = useMemo(() => {
    let total = selectedServices.reduce((sum, s) => sum + Number(s.price), 0);
    Object.entries(selectedAddons).forEach(([svcId, addonIds]) => {
      addonIds.forEach(id => {
        const addon = addons.find(a => a.id === id);
        if (addon) total += Number(addon.price);
      });
    });
    return total;
  }, [selectedServices, selectedAddons, addons]);

  const totalDuration = useMemo(() => {
    let total = selectedServices.reduce((sum, s) => sum + s.duration, 0);
    Object.entries(selectedAddons).forEach(([svcId, addonIds]) => {
      addonIds.forEach(id => {
        const addon = addons.find(a => a.id === id);
        if (addon) total += Number(addon.duration);
      });
    });
    return total;
  }, [selectedServices, selectedAddons, addons]);

  const primaryService = selectedServices[0];

  const dateString = selectedDate
    ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`
    : null;

  const { data: slots, isLoading: slotsLoading } = useQuery<TimeSlot[]>({
    queryKey: ["/api/public/store", slug, "availability", primaryService?.id, dateString, totalDuration, preselectedStaffId],
    queryFn: async () => {
      const params = new URLSearchParams({
        serviceId: String(primaryService!.id),
        date: dateString!,
        duration: String(totalDuration),
      });
      if (preselectedStaffId) params.set("staffId", String(preselectedStaffId));
      const res = await fetch(`/api/public/store/${slug}/availability?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch availability");
      return res.json();
    },
    enabled: !!slug && !!primaryService && !!dateString && totalDuration > 0,
  });

  useMemo(() => {
    if (preselectedStaffId && slots && slots.length > 0 && !preselectedStaffName) {
      const match = slots.find(s => s.staffId === preselectedStaffId);
      if (match) setPreselectedStaffName(match.staffName);
    }
  }, [slots, preselectedStaffId]);

  const bookMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", `/api/public/store/${slug}/book`, body);
      return res.json();
    },
    onSuccess: () => {
      setBookingSuccess(true);
      if (customerPhone) {
        localStorage.setItem(`booking_user_phone_${slug}`, customerPhone);
      }
    },
  });

  const now = useMemo(() => {
    return getNowInTimezone(timezone);
  }, [timezone]);

  // Initialize date
  useMemo(() => {
     if (selectedDate === null) {
        const today = getNowInTimezone(timezone);
        setSelectedDate(today);
        setWeekStart(today);
     }
  }, [timezone]);

  // Check for stored user session
  useMemo(() => {
    const storedPhone = localStorage.getItem(`booking_user_phone_${slug}`);
    if (storedPhone && !clientType) {
      setReturningPhone(storedPhone);
      setCustomerPhone(storedPhone);
      setClientType("returning");
      setStep("services");
    }
  }, [slug]);

  const weekDays = useMemo(() => {
    if (!weekStart) return [];
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const groupedServices = useMemo(() => {
    const groups: Record<string, ServiceData[]> = {};
    for (const s of services) {
      const cat = s.category || "General";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    }
    return groups;
  }, [services]);

  const groupedSlots = useMemo(() => {
    if (!slots) return { morning: [], afternoon: [], evening: [] };
    const morning: TimeSlot[] = [];
    const afternoon: TimeSlot[] = [];
    const evening: TimeSlot[] = [];
    for (const slot of slots) {
      const hour = parseInt(formatInTz(slot.time, timezone, "H"));
      if (hour < 12) morning.push(slot);
      else if (hour < 17) afternoon.push(slot);
      else evening.push(slot);
    }
    return { morning, afternoon, evening };
  }, [slots, timezone]);

  const toggleService = (service: ServiceData) => {
    setSelectedServices((prev) => {
      const exists = prev.find((s) => s.id === service.id);
      if (exists) {
        const newAddons = { ...selectedAddons };
        delete newAddons[service.id];
        setSelectedAddons(newAddons);
        return prev.filter((s) => s.id !== service.id);
      }
      const serviceAddonsList = getAddonsForService(service.id);
      if (serviceAddonsList.length > 0) {
        setViewingAddonsForService(service);
      }
      return [...prev, service];
    });
  };

  const toggleAddon = (serviceId: number, addonId: number) => {
    setSelectedAddons((prev) => {
      const current = prev[serviceId] || [];
      const exists = current.includes(addonId);
      let updated;
      if (exists) {
        updated = current.filter((id) => id !== addonId);
      } else {
        updated = [...current, addonId];
      }
      return { ...prev, [serviceId]: updated };
    });
  };

  const handleClientSelect = (type: "new" | "returning") => {
    setClientType(type);
    if (type === "new") {
      setStep("services");
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    let formatted = raw;
    if (raw.length > 0) {
      if (raw.length <= 3) formatted = raw;
      else if (raw.length <= 6) formatted = `(${raw.slice(0, 3)}) ${raw.slice(3)}`;
      else formatted = `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6, 10)}`;
    }
    setReturningPhone(formatted);
    if (phoneError) setPhoneError("");
  };

  const handleReturningContinue = () => {
    if (clientType === "returning") {
      const digits = returningPhone.replace(/\D/g, "");
      if (digits.length !== 10) {
        setPhoneError("Enter a valid 10-digit phone number.");
        return;
      }
      setCustomerPhone(returningPhone);
      localStorage.setItem(`booking_user_phone_${slug}`, returningPhone);
    }
    setStep("services");
  };

  const handleChooseTime = () => {
    if (selectedServices.length === 0) return;
    setStep("time");
  };

  const handleSelectSlot = (slot: TimeSlot) => {
    setSelectedSlot(slot);
    setStep("confirm");
  };

  const handleConfirmBooking = () => {
    const phoneDigits = customerPhone.replace(/\D/g, "");
    if (!primaryService || !selectedSlot || !customerName.trim()) return;
    if (phoneDigits.length !== 10) {
      setPhoneError("Enter a valid 10-digit phone number.");
      return;
    }
    const allAddonIds = Object.values(selectedAddons).flat();
    bookMutation.mutate({
      serviceId: primaryService.id,
      staffId: selectedSlot.staffId,
      date: selectedSlot.time,
      duration: totalDuration,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim() || undefined,
      customerPhone: customerPhone.trim(),
      addonIds: allAddonIds,
    });
  };

  const navigateWeek = (direction: "prev" | "next") => {
    if (!weekStart) return;
    const newStart = direction === "next" ? addDays(weekStart, 7) : subDays(weekStart, 7);
    setWeekStart(newStart);
    setSelectedDate(newStart);
  };

  const isPhoneValid = customerPhone.replace(/\D/g, "").length === 10;
  const isReturningPhoneValid = returningPhone.replace(/\D/g, "").length === 10;

  if (bookingSuccess) {
    const confirmationDigits = customerPhone.replace(/\D/g, "");
    const confirmationUrl = confirmationDigits.length === 10
      ? `${window.location.origin}/booking/${confirmationDigits}?slug=${encodeURIComponent(slug)}`
      : null;
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Booking Confirmed!</h2>
          <p className="text-gray-500 mb-6">
            Your appointment at {store.name} has been booked successfully.
          </p>
          {selectedSlot && (
            <p className="text-gray-700 font-medium">
              {new Date(selectedSlot.time).toLocaleString()}
            </p>
          )}
                  {phoneError && (
                    <p className="text-xs text-destructive">{phoneError}</p>
                  )}
          {confirmationUrl && (
            <div className="mt-6 space-y-2">
              <p className="text-sm text-gray-500">Confirmation number: {confirmationDigits}</p>
                    disabled={!isReturningPhoneValid}
              <Button onClick={() => window.location.assign(confirmationUrl)} className="w-full">
                View Confirmation
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="sticky top-0 z-50 bg-white border-b px-4 py-3 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-bold text-2xl md:text-3xl text-gray-900" style={{ fontFamily: "'Outfit', sans-serif" }} data-testid="text-store-name">
            {store.name}
          </h1>
          <div className="flex flex-col gap-0.5 mt-1">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="flex items-center gap-1">
                <span className="font-bold text-gray-900 text-base">4.8</span>
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className={cn("w-4 h-4", i <= 4 ? "fill-yellow-400 text-yellow-400" : "fill-gray-200 text-gray-200")} />
                  ))}
                </div>
                <span className="text-sm">(51 Reviews)</span>
              </div>
              <span className="text-gray-300">|</span>
              <span className="font-medium text-gray-700">Open until {closingTime || "Close"}</span>
            </div>
            {preselectedStaffId && (
              <div className="flex items-center gap-1 mt-1">
                <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full">
                  <User className="w-3 h-3" />
                  {preselectedStaffName ? `Booking with ${preselectedStaffName}` : "Booking with your chosen stylist"}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {preselectedStaff && (
        <div className="border-b bg-primary/5">
          <div className={cn("mx-auto px-4 py-3", step === "services" ? "max-w-5xl" : "max-w-2xl")}>
            <div className="flex items-center gap-3">
              {preselectedStaff.avatarUrl ? (
                <img
                  src={preselectedStaff.avatarUrl}
                  alt={preselectedStaff.name}
                  className="w-11 h-11 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-primary" />
                </div>
              )}
              <div className="min-w-0">
                <p className="font-semibold text-sm text-gray-900">{preselectedStaff.name}</p>
                {preselectedStaff.bio && (
                  <p className="text-xs text-gray-500 leading-snug line-clamp-2">{preselectedStaff.bio}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <main className={cn("mx-auto", step === "services" ? "max-w-5xl" : "max-w-2xl")}>
        {step === "client" && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
            <div className="w-full max-w-sm space-y-4">
              {clientType === null ? (
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1 h-14 text-base"
                    onClick={() => handleClientSelect("new")}
                    data-testid="button-new-client"
                  >
                    <User className="w-5 h-5 mr-2" />
                    New Client
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 h-14 text-base"
                    onClick={() => handleClientSelect("returning")}
                    data-testid="button-returning-client"
                  >
                    <User className="w-5 h-5 mr-2" />
                    Returning Client
                  </Button>
                </div>
              ) : clientType === "returning" ? (
                <div className="space-y-4 mt-4">
                  <div className="flex items-center mb-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="p-0 hover:bg-transparent -ml-2"
                      onClick={() => setClientType(null)}
                    >
                      <ChevronLeft className="w-5 h-5 mr-1" />
                      Back
                    </Button>
                  </div>
                  <div className="text-center mb-6">
                    <h2 className="text-xl font-semibold mb-2">Welcome Back!</h2>
                    <p className="text-gray-500">Please enter your phone number to continue</p>
                  </div>
                  <Input
                    placeholder="(555) 555-5555"
                    value={returningPhone}
                    onChange={handlePhoneChange}
                    className="text-2xl h-16 text-center tracking-wide"
                    autoFocus
                    data-testid="input-returning-phone"
                  />
                  {phoneError && (
                    <p className="text-xs text-destructive text-center">{phoneError}</p>
                  )}
                  <Button
                    className="w-full h-12 text-lg"
                    onClick={handleReturningContinue}
                    data-testid="button-continue-returning"
                    disabled={!isReturningPhoneValid}
                  >
                    Continue
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {step === "services" && (
          <div className="pb-24">
            {viewingAddonsForService && (
              <div className="fixed inset-0 z-[60] bg-white flex flex-col animate-in fade-in slide-in-from-bottom-10 duration-200">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-white sticky top-0">
                  <div>
                    <h2 className="font-semibold text-lg">Enhance your service</h2>
                    <p className="text-sm text-gray-500">Add-ons for {viewingAddonsForService.name}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setViewingAddonsForService(null)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
                  {getAddonsForService(viewingAddonsForService.id).map((addon) => {
                    const isSelected = (selectedAddons[viewingAddonsForService.id] || []).includes(addon.id);
                    return (
                      <div
                        key={addon.id}
                        className={cn(
                          "border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md",
                          isSelected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-gray-200"
                        )}
                        onClick={() => toggleAddon(viewingAddonsForService.id, addon.id)}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold text-gray-900">{addon.name}</h3>
                            {addon.description && (
                              <p className="text-sm text-gray-500 mt-1">{addon.description}</p>
                            )}
                            <div className="mt-2 text-sm text-gray-500">+{addon.duration} min</div>
                          </div>
                          <div className="text-right">
                            {showPrices && (
                              <div className="font-semibold text-primary">
                                +${Number(addon.price).toFixed(2)}
                              </div>
                            )}
                            {isSelected && (
                              <CheckCircle2 className="w-5 h-5 text-primary mt-2 ml-auto" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="fixed bottom-0 left-0 right-0 bg-pink-50 border-t px-4 py-3 flex items-center justify-between gap-4 z-[60]">
                  <div>
                    <span className="text-sm font-medium">
                      {selectedServices.length} Service{selectedServices.length > 1 ? "s" : ""}
                    </span>
                    {showPrices && (
                      <span className="text-sm text-gray-500 ml-2">
                        ${totalPrice.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <Button onClick={() => {
                    setViewingAddonsForService(null);
                    handleChooseTime();
                  }}>
                    Choose Date/Time
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (activeCategory) {
                    setActiveCategory(null);
                  } else {
                    setStep("client");
                    setClientType(null);
                    // Clear all client details for privacy/reset
                    setReturningPhone("");
                    setCustomerName("");
                    setCustomerEmail("");
                    setCustomerPhone("");
                  }
                }}
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <h2 className="font-semibold text-lg">
                {activeCategory ? activeCategory : "Select Category"}
              </h2>
            </div>

            <div className="px-4 py-2">
              {servicesLoading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="space-y-2">
                  {!activeCategory ? (
                    Object.keys(groupedServices).map((category) => (
                      <button
                        key={category}
                        className="w-full flex items-center justify-between p-4 bg-white border rounded-lg shadow-sm hover:shadow-md transition-all text-left"
                        onClick={() => setActiveCategory(category)}
                        data-testid={`button-category-${category}`}
                      >
                        <div>
                          <span className="font-semibold text-gray-900 text-lg">
                            {category}
                          </span>
                          <p className="text-sm text-gray-500 mt-1">
                            {groupedServices[category].length} Service{groupedServices[category].length !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      </button>
                    ))
                  ) : (
                    <div className="space-y-3">
                      {groupedServices[activeCategory]?.map((service) => {
                        const isSelected = selectedServices.some(
                          (s) => s.id === service.id
                        );
                        return (
                          <div
                            key={service.id}
                            className={cn(
                              "border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md",
                              isSelected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-gray-200 bg-white"
                            )}
                            onClick={() => toggleService(service)}
                            data-testid={`button-service-${service.id}`}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex-1 pr-4">
                                <h3 className="font-semibold text-gray-900">{service.name}</h3>
                                {service.description && (
                                  <p className="text-sm text-gray-500 mt-1">{service.description}</p>
                                )}
                                <div className="mt-2 text-sm text-gray-500">{service.duration} min</div>
                              </div>
                              <div className="text-right flex flex-col items-end">
                                {showPrices && (
                                  <div className={cn(
                                    "font-semibold",
                                    isSelected ? "text-primary" : "text-gray-900"
                                  )}>
                                    ${Number(service.price).toFixed(2)}
                                  </div>
                                )}
                                {isSelected && (
                                  <CheckCircle2 className="w-5 h-5 text-primary mt-2" />
                                )}
                                {!isSelected && (
                                   <div className="w-5 h-5 rounded-full border border-gray-300 mt-2"></div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedServices.length > 0 && (
              <div className="fixed bottom-0 left-0 right-0 bg-pink-50 border-t px-4 py-3 flex items-center justify-between gap-4 z-50">
                <div>
                  <span className="text-sm font-medium">
                    {selectedServices.length} Service{selectedServices.length > 1 ? "s" : ""}
                  </span>
                  {showPrices && (
                    <span className="text-sm text-gray-500 ml-2" data-testid="text-total-price">
                      ${totalPrice.toFixed(2)}
                    </span>
                  )}
                </div>
                <Button onClick={handleChooseTime} data-testid="button-choose-staff">
                  Choose Date/Time
                </Button>
              </div>
            )}
          </div>
        )}

        {step === "time" && (
          <div className="pb-6">
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setStep("services")}
                data-testid="button-back-services"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <h2 className="font-semibold text-lg">Choose Time</h2>
            </div>

            <div className="px-4 py-3 border-b">
              <div className="flex items-center justify-between mb-3">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => navigateWeek("prev")}
                  data-testid="button-week-prev"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-sm">
                    {selectedDate
                      ? formatInTz(selectedDate, timezone, "d MMM yyyy")
                      : ""}
                  </span>
                  <ChevronDown className="w-3 h-3 text-gray-400" />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => navigateWeek("next")}
                  data-testid="button-week-next"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex justify-between">
                {weekDays.map((day) => {
                  const isToday = isSameDay(day, now);
                  const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                  const dayName = formatInTz(day, timezone, "EEE");
                  const dayNum = formatInTz(day, timezone, "d");
                  return (
                    <button
                      key={day.toISOString()}
                      className="flex flex-col items-center gap-1 py-1 px-2"
                      onClick={() => setSelectedDate(day)}
                      data-testid={`button-day-${dayNum}`}
                    >
                      <span className="text-xs text-gray-500 uppercase">{dayName}</span>
                      <span
                        className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                          isSelected
                            ? "bg-primary text-white"
                            : isToday
                              ? "border border-primary text-primary"
                              : "text-gray-700"
                        )}
                      >
                        {dayNum}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-4 py-4">
              {slotsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : !slots || slots.length === 0 ? (
                <p className="text-center text-gray-500 py-8">
                  No available slots for this date.
                </p>
              ) : (
                <div className="space-y-6">
                  {groupedSlots.morning.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                        Morning
                      </h3>
                      <div className="grid grid-cols-4 gap-2">
                        {groupedSlots.morning.map((slot) => (
                          <Button
                            key={slot.time}
                            variant="outline"
                            className="text-sm"
                            onClick={() => handleSelectSlot(slot)}
                          >
                            {formatInTz(slot.time, timezone, "h:mm")}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {groupedSlots.afternoon.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                        Afternoon
                      </h3>
                      <div className="grid grid-cols-4 gap-2">
                        {groupedSlots.afternoon.map((slot) => (
                          <Button
                            key={slot.time}
                            variant="outline"
                            className="text-sm"
                            onClick={() => handleSelectSlot(slot)}
                          >
                            {formatInTz(slot.time, timezone, "h:mm")}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {groupedSlots.evening.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                        Evening
                      </h3>
                      <div className="grid grid-cols-4 gap-2">
                        {groupedSlots.evening.map((slot) => (
                          <Button
                            key={slot.time}
                            variant="outline"
                            className="text-sm"
                            onClick={() => handleSelectSlot(slot)}
                          >
                            {formatInTz(slot.time, timezone, "h:mm")}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setStep("time")}
                data-testid="button-back-time"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <h2 className="font-semibold text-lg">Confirm Booking</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Your full name"
                  data-testid="input-customer-name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email (Optional)
                </label>
                <Input
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  data-testid="input-customer-email"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <Input
                  value={customerPhone}
                  onChange={(e) => {
                    let value = e.target.value.replace(/\D/g, "");
                    if (value.length > 10) value = value.substring(0, 10);
                    if (value.length >= 6) {
                      value = `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6)}`;
                    } else if (value.length >= 3) {
                      value = `(${value.slice(0, 3)}) ${value.slice(3)}`;
                    }
                    setCustomerPhone(value);
                    if (phoneError) setPhoneError("");
                  }}
                  placeholder="(555) 555-5555"
                  type="tel"
                  data-testid="input-customer-phone"
                />
                {phoneError && (
                  <p className="text-xs text-destructive mt-1">{phoneError}</p>
                )}
              </div>

              <div className="bg-gray-50 p-4 rounded-lg mt-6">
                <h3 className="font-semibold mb-2">{primaryService?.name}</h3>
                <p className="text-sm text-gray-600 mb-1">
                  {selectedSlot &&
                    formatInTz(selectedSlot.time, timezone, "EEEE, d MMMM yyyy 'at' h:mm a")}
                </p>
                <p className="text-sm text-gray-600">
                  With {selectedSlot?.staffName}
                </p>
                {showPrices && (
                  <div className="mt-3 pt-3 border-t border-gray-200 space-y-1">
                    <div className="flex justify-between font-semibold">
                      <span>Total</span>
                      <span>${totalPrice.toFixed(2)}</span>
                    </div>
                    {primaryService?.depositRequired && primaryService?.depositAmount && (
                      <div className="flex justify-between text-sm text-amber-700 bg-amber-50 -mx-4 px-4 py-2 rounded mt-2">
                        <span>Deposit required today</span>
                        <span className="font-semibold">${Number(primaryService.depositAmount).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Button
                className="w-full mt-4"
                onClick={handleConfirmBooking}
                disabled={!customerName.trim() || !isPhoneValid || bookMutation.isPending}
                data-testid="button-confirm-booking"
              >
                {bookMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Confirm Booking
              </Button>
            </div>
          </div>
        )}
      </main>
      
      <footer className="py-8 text-center bg-white border-t border-gray-100">
          <p className="text-sm" style={{ fontFamily: 'DM Sans, sans-serif' }}>
            <span className="text-gray-500 font-medium">Powered by </span>
            <span className="font-bold" style={{ color: '#FF5722' }}>CertXa</span>
          </p>
      </footer>
    </div>
  );
}
