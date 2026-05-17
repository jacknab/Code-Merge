import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Scissors, Sparkles, Flower2, Lamp, ArrowRight, ArrowLeft, Loader2, Check, Plus, Minus, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

const businessTypes = [
  {
    id: "Hair Salon",
    label: "Hair Salon",
    description: "Haircuts, color & styling",
    videoUrl: "/videos/hair_salon.mp4",
    fallbackGradient: "from-rose-400 via-pink-500 to-fuchsia-600",
  },
  {
    id: "Nail Salon",
    label: "Nail Salon",
    description: "Manicures, pedicures & nail art",
    videoUrl: "/videos/nail_salon.mp4",
    fallbackGradient: "from-violet-400 via-purple-500 to-indigo-600",
  },
  {
    id: "Spa",
    label: "Spa",
    description: "Massage, facials & body treatments",
    videoUrl: "/videos/spa.mp4",
    fallbackGradient: "from-emerald-400 via-teal-500 to-cyan-600",
  },
  {
    id: "Barbershop",
    label: "Barbershop",
    description: "Cuts, fades & beard trims",
    videoUrl: "/videos/barbershop.mp4",
    fallbackGradient: "from-amber-400 via-orange-500 to-red-500",
  },
  {
    id: "Esthetician",
    label: "Esthetician",
    description: "Skin care, facials & waxing",
    videoUrl: "/videos/esthetician.mp4",
    fallbackGradient: "from-sky-400 via-blue-500 to-indigo-500",
  },
  {
    id: "Pet Groomer",
    label: "Pet Groomer",
    description: "Grooming, baths & trims",
    videoUrl: "/videos/pet_groomer.mp4",
    fallbackGradient: "from-lime-400 via-green-500 to-teal-600",
  },
  {
    id: "Tattoo Studio",
    label: "Tattoo Studio",
    description: "Tattoos, piercings & body art",
    videoUrl: "/videos/tattoo_studio.mp4",
    fallbackGradient: "from-slate-600 via-gray-700 to-zinc-800",
  },
  {
    id: "Other",
    label: "Other",
    description: "Any appointment-based business",
    videoUrl: "/videos/other_business.mp4",
    fallbackGradient: "from-pink-400 via-rose-500 to-orange-500",
  },
];

const timezones = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "America/Toronto", label: "Eastern Canada" },
  { value: "America/Vancouver", label: "Pacific Canada" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Central Europe (CET)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
];

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const defaultHours = dayNames.map((_, i) => ({
  dayOfWeek: i,
  openTime: "09:00",
  closeTime: "17:00",
  isClosed: true,
}));

function formatTime(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${mStr} ${ampm}`;
}

const staffColors = ["#f472b6", "#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#818cf8", "#fb923c", "#2dd4bf", "#e879f9"];

// Maps US state abbreviation → best-fit timezone from the timezones list above.
// Used by the ZIP lookup so city+state+timezone all update together.
const stateTimezoneMap: Record<string, string> = {
  CT: "America/New_York", DC: "America/New_York", DE: "America/New_York",
  FL: "America/New_York", GA: "America/New_York", IN: "America/New_York",
  KY: "America/New_York", MA: "America/New_York", MD: "America/New_York",
  ME: "America/New_York", MI: "America/New_York", NC: "America/New_York",
  NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York",
  OH: "America/New_York", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", TN: "America/New_York", VA: "America/New_York",
  VT: "America/New_York", WV: "America/New_York",
  AL: "America/Chicago",  AR: "America/Chicago",  IA: "America/Chicago",
  IL: "America/Chicago",  KS: "America/Chicago",  LA: "America/Chicago",
  MN: "America/Chicago",  MO: "America/Chicago",  MS: "America/Chicago",
  ND: "America/Chicago",  NE: "America/Chicago",  OK: "America/Chicago",
  SD: "America/Chicago",  TX: "America/Chicago",  WI: "America/Chicago",
  CO: "America/Denver",   ID: "America/Denver",   MT: "America/Denver",
  NM: "America/Denver",   UT: "America/Denver",   WY: "America/Denver",
  AZ: "America/Phoenix",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles",
  OR: "America/Los_Angeles", WA: "America/Los_Angeles",
  AK: "America/Anchorage",
  HI: "Pacific/Honolulu",
};

function detectTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const match = timezones.find(tz => tz.value === detected);
    if (match) return match.value;
    if (detected.includes("America/")) {
      if (detected.includes("New_York") || detected.includes("Detroit") || detected.includes("Indiana")) return "America/New_York";
      if (detected.includes("Chicago") || detected.includes("Menominee")) return "America/Chicago";
      if (detected.includes("Denver") || detected.includes("Boise")) return "America/Denver";
      if (detected.includes("Los_Angeles")) return "America/Los_Angeles";
      if (detected.includes("Anchorage")) return "America/Anchorage";
      if (detected.includes("Toronto") || detected.includes("Montreal")) return "America/Toronto";
      if (detected.includes("Vancouver")) return "America/Vancouver";
      if (detected.includes("Phoenix")) return "America/Phoenix";
    }
    if (detected.includes("Europe/")) {
      if (detected.includes("London")) return "Europe/London";
      return "Europe/Paris";
    }
    if (detected.includes("Australia/")) return "Australia/Sydney";
    if (detected.includes("Pacific/Honolulu")) return "Pacific/Honolulu";
    return "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function generateTimeOptions() {
  const options: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h >= 12 ? "PM" : "AM";
      const label = `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
      options.push({ value, label });
    }
  }
  return options;
}

const timeOptions = generateTimeOptions();

const usStates = [
  { value: "AL", label: "Alabama" },
  { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" },
  { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" },
  { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" },
  { value: "DE", label: "Delaware" },
  { value: "FL", label: "Florida" },
  { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" },
  { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" },
  { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" },
  { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" },
  { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" },
  { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" },
  { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" },
  { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" },
  { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" },
  { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" },
  { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" },
  { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" },
  { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" },
  { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" },
  { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" },
  { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" },
  { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" },
  { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" },
  { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" },
  { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" },
  { value: "WY", label: "Wyoming" },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isLoading } = useAuth();

  // ── All hooks must be declared before any conditional return ──
  const [step, setStep] = useState(1);
  const [teamSize, setTeamSize] = useState<"myself" | "team" | null>(null);
  const totalSteps = teamSize === "team" ? 5 : 4;
  const [goals, setGoals] = useState<string[]>([]);
  const [showBusinessTypePanel, setShowBusinessTypePanel] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postcode, setPostcode] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [postcodeError, setPostcodeError] = useState("");
  const [zipLookupStatus, setZipLookupStatus] = useState<"idle" | "loading" | "found" | "not-found">("idle");
  const [emailError, setEmailError] = useState("");
  const [timezone, setTimezone] = useState(() => detectTimezone());
  const [hours, setHours] = useState(defaultHours);
  const [addOpenTime, setAddOpenTime] = useState("09:00");
  const [addCloseTime, setAddCloseTime] = useState("17:00");
  const [addDays, setAddDays] = useState<number[]>([]);
  const [staffCount, setStaffCount] = useState(1);
  const [staffNames, setStaffNames] = useState<string[]>(["Owner"]);

  // Initialize email from user account
  useEffect(() => {
    if (user?.email && !email) {
      setEmail(user.email);
    }
  }, [user?.email]);

  // Auto-detect City, State, and Timezone from the user's IP address (one-time, on mount)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("https://ipapi.co/json/", { credentials: "omit" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const detectedCity: string | undefined = data?.city;
        const detectedState: string | undefined = data?.region_code;
        const detectedTz: string | undefined = data?.timezone;
        // Only populate fields the user hasn't already filled in
        setCity((prev) => (prev.trim() ? prev : detectedCity || prev));
        if (detectedState && usStates.some((s) => s.value === detectedState)) {
          setState((prev) => (prev ? prev : detectedState));
        }
        if (detectedTz && timezones.some((t) => t.value === detectedTz)) {
          setTimezone((prev) => (prev === detectTimezone() ? detectedTz : prev));
        }
      } catch {
        // Silent fail — user can still enter manually
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Validation functions
  const validateEmail = (value: string): boolean => {
    if (!value.trim()) return true; // Optional field
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  };

  const validatePhone = (value: string): boolean => {
    if (!value.trim()) return true; // Optional field
    return /^\d{10}$/.test(value);
  };

  const validatePostcode = (value: string): boolean => {
    if (!value.trim()) return true; // Optional field
    return /^\d{5}$/.test(value);
  };

  const validateAddress = (value: string): boolean => {
    if (!value.trim()) return true; // Optional field
    if (/[;'"`]/.test(value)) return false;
    if (/--|\/\*/.test(value)) return false;
    return /^[a-zA-Z0-9\s.,#\-\/]*$/.test(value);
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (value.trim() && !validateEmail(value)) {
      setEmailError("Please enter a valid email address");
    } else {
      setEmailError("");
    }
  };

  const handlePhoneChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, "");
    setPhone(digitsOnly);
    if (digitsOnly.trim() && !validatePhone(digitsOnly)) {
      setPhoneError("Please enter a valid phone number");
    } else {
      setPhoneError("");
    }
  };

  const handlePostcodeChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, "");
    setPostcode(digitsOnly);
    if (digitsOnly.trim() && !validatePostcode(digitsOnly)) {
      setPostcodeError("Zip code must be 5 digits");
      setZipLookupStatus("idle");
    } else {
      setPostcodeError("");
    }

    // Trigger ZIP lookup as soon as 5 digits are complete
    if (digitsOnly.length === 5) {
      setZipLookupStatus("loading");
      (async () => {
        try {
          const res = await fetch(`https://api.zippopotam.us/us/${digitsOnly}`, { credentials: "omit" });
          if (!res.ok) { setZipLookupStatus("not-found"); return; }
          const data = await res.json();
          const place = data?.places?.[0];
          if (!place) { setZipLookupStatus("not-found"); return; }
          const detectedCity: string = place["place name"] ?? "";
          const detectedState: string = place["state abbreviation"] ?? "";
          if (detectedCity) setCity(detectedCity);
          if (detectedState && usStates.some(s => s.value === detectedState)) {
            setState(detectedState);
            const tz = stateTimezoneMap[detectedState];
            if (tz) setTimezone(tz);
          }
          setZipLookupStatus("found");
        } catch {
          setZipLookupStatus("not-found");
        }
      })();
    } else if (digitsOnly.length < 5) {
      setZipLookupStatus("idle");
    }
  };

  const handleAddressChange = (value: string) => {
    setAddress(value);
    if (value.trim() && !validateAddress(value)) {
      setAddressError("Address contains invalid characters");
    } else {
      setAddressError("");
    }
  };

  // Redirect side-effects in useEffect (never call navigate during render)
  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/auth");
    } else if (!isLoading && user?.onboardingCompleted) {
      navigate("/calendar");
    }
  }, [user, isLoading, navigate]);

  // useMutation must be declared before any conditional return
  const onboardMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/onboarding", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/user"], data.user);
      queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      toast({ title: "You're all set!", description: "Your business is ready to use." });
      navigate("/calendar");
    },
    onError: (error: any) => {
      toast({ title: "Setup failed", description: error.message || "Something went wrong", variant: "destructive" });
    },
  });

  // ── Guard: nothing to render until we know the user state ──
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || user.onboardingCompleted) {
    return null;
  }

  const updateStaffCount = (newCount: number) => {
    if (newCount < 1) return;
    if (newCount > 20) return;
    const newNames = [...staffNames];
    if (newCount > staffNames.length) {
      for (let i = staffNames.length; i < newCount; i++) {
        newNames.push("");
      }
    } else {
      newNames.length = newCount;
    }
    setStaffCount(newCount);
    setStaffNames(newNames);
  };

  const updateStaffName = (index: number, name: string) => {
    const newNames = [...staffNames];
    newNames[index] = name;
    setStaffNames(newNames);
  };

  const updateHour = (dayIdx: number, field: "openTime" | "closeTime" | "isClosed", value: any) => {
    const newHours = [...hours];
    newHours[dayIdx] = { ...newHours[dayIdx], [field]: value };
    setHours(newHours);
  };

  const handleComplete = () => {
    if (!selectedType || !businessName.trim()) {
      toast({ title: "Missing business info", description: "Please go back and fill in your business name and type.", variant: "destructive" });
      return;
    }
    const validStaff = staffNames.filter(n => n.trim()).map((name, i) => ({
      name: name.trim(),
      color: staffColors[i % staffColors.length],
    }));
    if (validStaff.length === 0) {
      toast({ title: "Add at least one staff member", variant: "destructive" });
      return;
    }
    onboardMutation.mutate({
      businessType: selectedType,
      businessName: businessName.trim(),
      email: email.trim() || undefined,
      timezone,
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      postcode: postcode.trim() || undefined,
      phone: phone.trim() || undefined,
      businessHours: hours,
      staff: validStaff,
      teamSize: teamSize ?? undefined,
    });
  };

  const canProceed = (s: number) => {
    if (s === 1) return teamSize !== null;
    if (s === 2) return true;
    if (s === 3) return businessName.trim().length > 0 && !!selectedType && (!phone.trim() || !phoneError);
    if (s === 4) return true;
    if (s === 5) return staffNames.length > 0 && staffNames.every(n => n.trim().length > 0);
    return false;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#050C18] via-[#0f0524] to-[#050C18] text-white p-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div className="w-full max-w-xl transition-all duration-300">

        <div className="flex items-center justify-center gap-2 mb-10">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all ${step > i + 1 ? "bg-[#3B0764] text-white" : step === i + 1 ? "bg-[#F59E0B] text-[#3B0764]" : "bg-white/10 text-white/40"}`}
                data-testid={`step-indicator-${i + 1}`}
              >
                {step > i + 1 ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              {i < totalSteps - 1 && (
                <div className={`h-0.5 w-10 rounded-full transition-all ${step > i + 1 ? "bg-[#3B0764]" : "bg-white/10"}`} />
              )}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="bg-white rounded-2xl shadow-xl p-10 text-center">
            <div className="text-center mb-6">
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "2.1rem", fontWeight: 700, color: "#3B0764", letterSpacing: "-0.02em", lineHeight: 1 }}>
                Certxa<span style={{ color: "#F59E0B" }}>.</span>
              </span>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-3" data-testid="text-step1-title">Tell us a little about yourself</h2>
            <p className="text-gray-500 text-sm mb-6">Let's tailor Certxa to you! Just a few quick questions</p>
            <p className="text-gray-800 font-semibold mb-5">Who do you need Certxa for?</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  setTeamSize("myself");
                  const firstName = (user as any)?.firstName || user?.email?.split("@")[0] || "Me";
                  setStaffNames([firstName]);
                  setStaffCount(1);
                  setStep(2);
                }}
                className={`w-full py-4 rounded-xl border-2 font-semibold text-base transition-all ${teamSize === "myself" ? "border-[#3B0764] bg-[#3B0764]/10 text-[#3B0764]" : "border-[#3B0764] text-[#3B0764] hover:bg-[#3B0764]/5"}`}
              >
                Myself
              </button>
              <button
                type="button"
                onClick={() => { setTeamSize("team"); setStep(2); }}
                className={`w-full py-4 rounded-xl border-2 font-semibold text-base transition-all ${teamSize === "team" ? "border-[#3B0764] bg-[#3B0764]/10 text-[#3B0764]" : "border-[#3B0764] text-[#3B0764] hover:bg-[#3B0764]/5"}`}
              >
                Me and my team
              </button>
            </div>
          </div>
        )}

        {step === 2 && (() => {
          const goalOptions = [
            "Reduce my no-shows",
            "Allow my clients to book online",
            "Send promotions to my clients",
            "Accept credit cards",
            "Get more online reviews",
            "Get more client referrals",
            "Manage my staff schedules",
            "Sell gift cards",
          ];
          const toggleGoal = (g: string) =>
            setGoals(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
          return (
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              <div className="px-8 pt-8 pb-4">
                <div className="text-center mb-5">
                  <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "2.1rem", fontWeight: 700, color: "#3B0764", letterSpacing: "-0.02em", lineHeight: 1 }}>
                    Certxa<span style={{ color: "#F59E0B" }}>.</span>
                  </span>
                </div>
                <h2 className="text-xl font-bold text-gray-900 text-center mb-4">How can Certxa help you better manage your business</h2>
                <p className="text-sm text-gray-500 mb-5 text-center">I want to....</p>
                <div className="flex flex-col gap-1">
                  {goalOptions.map((g) => (
                    <label key={g} className="flex items-center gap-3 py-2.5 cursor-pointer group">
                      <div
                        onClick={() => toggleGoal(g)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${goals.includes(g) ? "bg-[#3B0764] border-[#3B0764]" : "border-gray-300 bg-white"}`}
                      >
                        {goals.includes(g) && (
                          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <span onClick={() => toggleGoal(g)} className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">{g}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 text-center mt-5 mb-4">We would like to better understand your needs</p>
              </div>
              <div className="flex border-t border-gray-100">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-4 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors border-r border-gray-100"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 py-4 text-sm font-semibold text-white bg-[#3B0764] hover:bg-[#2d0552] transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          );
        })()}

        {step === 3 && (() => {
          const allBusinessTypes = [
            "Barbershop", "Esthetician", "Hair Salon", "Nail Salon",
            "Pet Groomer", "Spa", "Tattoo Studio", "Other",
          ];
          return showBusinessTypePanel ? (
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
                <button type="button" onClick={() => setShowBusinessTypePanel(false)} className="text-gray-500 hover:text-[#3B0764] transition-colors">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <span className="font-semibold text-gray-800 text-sm">Select Business Type</span>
              </div>
              <div className="overflow-y-auto max-h-[420px]">
                {allBusinessTypes.map((bt) => (
                  <button
                    key={bt}
                    type="button"
                    onClick={() => { setSelectedType(bt); setShowBusinessTypePanel(false); }}
                    className="w-full text-left px-5 py-4 text-sm text-gray-700 border-b border-gray-100 last:border-0 hover:bg-[#3B0764]/5 hover:text-[#3B0764] transition-colors"
                  >
                    {bt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              <div className="px-6 pt-6 pb-2 space-y-4">
                <div className="text-center mb-1">
                  <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "2.1rem", fontWeight: 700, color: "#3B0764", letterSpacing: "-0.02em", lineHeight: 1 }}>
                    Certxa<span style={{ color: "#F59E0B" }}>.</span>
                  </span>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Business Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Enter Business Name"
                    data-testid="input-business-name"
                    autoFocus
                    className="w-full h-12 px-4 rounded-xl border border-gray-200 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-[#3B0764] text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Business Telephone Number <span className="text-red-500">*</span></label>
                  <div className="flex items-center h-12 rounded-xl border border-gray-200 overflow-hidden focus-within:border-[#3B0764] transition-colors">
                    <span className="flex items-center gap-1 px-3 text-sm text-gray-600 border-r border-gray-200 h-full bg-gray-50 shrink-0">
                      🇺🇸 <ChevronRight className="w-3 h-3 text-gray-400" />
                    </span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      placeholder="Enter Business Telephone Number"
                      data-testid="input-phone"
                      inputMode="numeric"
                      maxLength={10}
                      className="flex-1 px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none h-full"
                    />
                  </div>
                  {phoneError && <p className="text-xs text-red-500 mt-1">{phoneError}</p>}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Choose Business Type <span className="text-red-500">*</span></label>
                  <button
                    type="button"
                    onClick={() => setShowBusinessTypePanel(true)}
                    className="w-full h-12 px-4 rounded-xl border border-gray-200 text-left flex items-center justify-between hover:border-[#3B0764] transition-colors"
                  >
                    <span className={selectedType ? "text-sm text-gray-800" : "text-sm text-gray-400"}>
                      {selectedType || "Select Business Type"}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </button>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Street Address</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => handleAddressChange(e.target.value)}
                    placeholder="123 Main St, Suite 100"
                    data-testid="input-address"
                    className="w-full h-12 px-4 rounded-xl border border-gray-200 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-[#3B0764] text-sm"
                  />
                  {addressError && <p className="text-xs text-red-500 mt-1">{addressError}</p>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">City</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Auto-detected"
                      data-testid="input-city"
                      className="w-full h-12 px-4 rounded-xl border border-gray-200 text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-[#3B0764] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">State</label>
                    <Select value={state} onValueChange={setState}>
                      <SelectTrigger data-testid="select-state" className="w-full h-12 px-4 rounded-xl border border-gray-200 text-sm text-gray-800 bg-white focus:border-[#3B0764]">
                        <SelectValue placeholder="Auto-detected" />
                      </SelectTrigger>
                      <SelectContent>
                        {usStates.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Zip Code</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={postcode}
                        onChange={(e) => handlePostcodeChange(e.target.value)}
                        placeholder="e.g. 90210"
                        data-testid="input-postcode"
                        inputMode="numeric"
                        maxLength={5}
                        className={`w-full h-12 px-4 pr-10 rounded-xl border text-gray-800 placeholder:text-gray-400 focus:outline-none text-sm transition-colors ${
                          zipLookupStatus === "found" ? "border-green-400 focus:border-green-500" :
                          zipLookupStatus === "not-found" ? "border-red-300 focus:border-red-400" :
                          "border-gray-200 focus:border-[#3B0764]"
                        }`}
                      />
                      {zipLookupStatus === "loading" && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Loader2 className="w-4 h-4 text-[#3B0764] animate-spin" />
                        </div>
                      )}
                      {zipLookupStatus === "found" && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Check className="w-4 h-4 text-green-500" />
                        </div>
                      )}
                    </div>
                    {postcodeError && <p className="text-xs text-red-500 mt-1">{postcodeError}</p>}
                    {zipLookupStatus === "found" && !postcodeError && (
                      <p className="text-xs text-green-600 mt-1">City, state &amp; timezone updated</p>
                    )}
                    {zipLookupStatus === "not-found" && !postcodeError && (
                      <p className="text-xs text-amber-600 mt-1">ZIP not found — fill in city &amp; state manually</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Timezone</label>
                    <Select value={timezone} onValueChange={setTimezone}>
                      <SelectTrigger data-testid="select-timezone" className="w-full h-12 px-4 rounded-xl border border-gray-200 text-sm text-gray-800 bg-white focus:border-[#3B0764]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {timezones.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value} data-testid={`option-tz-${tz.value}`}>
                            {tz.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <p className="text-xs text-[#3B0764]/70 text-center pb-1">City, state &amp; timezone are auto-detected from your location — edit if needed</p>
              </div>
              <div className="flex border-t border-gray-100">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-4 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors border-r border-gray-100"
                >
                  back
                </button>
                <button
                  onClick={() => setStep(4)}
                  disabled={!canProceed(3)}
                  className="flex-1 py-4 text-sm font-semibold text-white bg-[#3B0764] hover:bg-[#2d0552] transition-colors disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
            </div>
          );
        })()}

        {step === 4 && (() => {
          const openDayIndices = hours.filter(h => !h.isClosed).map(h => h.dayOfWeek);
          const allDaysSet = openDayIndices.length === 7;

          const toggleAddDay = (idx: number) => {
            if (openDayIndices.includes(idx)) return;
            setAddDays(prev => prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx]);
          };

          const handleAddHours = () => {
            if (addDays.length === 0) return;
            const newHours = [...hours];
            addDays.forEach(dayIdx => {
              newHours[dayIdx] = { ...newHours[dayIdx], openTime: addOpenTime, closeTime: addCloseTime, isClosed: false };
            });
            setHours(newHours);
            setAddDays([]);
          };

          const handleRemoveDay = (dayIdx: number) => {
            const newHours = [...hours];
            newHours[dayIdx] = { ...newHours[dayIdx], isClosed: true };
            setHours(newHours);
            setAddDays(prev => prev.filter(d => d !== dayIdx));
          };

          const dayAbbr = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

          return (
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              <div className="px-6 pt-6 pb-2">
                <div className="text-center mb-4">
                  <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "2.1rem", fontWeight: 700, color: "#3B0764", letterSpacing: "-0.02em", lineHeight: 1 }}>
                    Certxa<span style={{ color: "#F59E0B" }}>.</span>
                  </span>
                </div>
                <h2 className="text-xl font-bold text-center text-gray-900 mb-1" data-testid="text-step3-title">Set your business hours</h2>
                <p className="text-sm text-gray-400 text-center mb-5">These will be your default staff hours too</p>

                {/* Builder card */}
                {!allDaysSet && (
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 mb-4">
                    <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">Add hours</p>

                    {/* Time inputs */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Open</label>
                        <input
                          type="time"
                          value={addOpenTime}
                          onChange={e => setAddOpenTime(e.target.value)}
                          className="w-full bg-white border border-gray-200 text-gray-800 rounded-xl h-11 px-3 text-sm focus:outline-none focus:border-[#3B0764]"
                        />
                      </div>
                      <span className="text-gray-400 text-sm mt-5">to</span>
                      <div className="flex-1 space-y-1">
                        <label className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Close</label>
                        <input
                          type="time"
                          value={addCloseTime}
                          onChange={e => setAddCloseTime(e.target.value)}
                          className="w-full bg-white border border-gray-200 text-gray-800 rounded-xl h-11 px-3 text-sm focus:outline-none focus:border-[#3B0764]"
                        />
                      </div>
                    </div>

                    {/* Day toggles */}
                    <div className="flex flex-wrap gap-2 mb-4">
                      {dayAbbr.map((abbr, idx) => {
                        const alreadySet = openDayIndices.includes(idx);
                        const selected = addDays.includes(idx);
                        return (
                          <button
                            key={idx}
                            type="button"
                            disabled={alreadySet}
                            onClick={() => toggleAddDay(idx)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                              alreadySet
                                ? "bg-gray-100 border-gray-200 text-gray-300 cursor-not-allowed"
                                : selected
                                ? "bg-[#F59E0B] border-[#F59E0B] text-[#3B0764]"
                                : "bg-white border-gray-200 text-gray-600 hover:border-[#3B0764] hover:text-[#3B0764]"
                            }`}
                          >
                            {abbr}
                          </button>
                        );
                      })}
                    </div>

                    {/* Add button */}
                    <button
                      type="button"
                      onClick={handleAddHours}
                      disabled={addDays.length === 0}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#F59E0B] text-[#3B0764] font-bold text-sm transition-all disabled:opacity-30"
                    >
                      <Plus className="w-4 h-4" />
                      Add {addDays.length > 0 ? `${addDays.length} day${addDays.length > 1 ? "s" : ""}` : "days"}
                    </button>
                  </div>
                )}

                {/* Schedule preview — always Sun–Sat order */}
                <div className="bg-gray-50 border border-gray-100 rounded-2xl overflow-hidden mb-4">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider px-5 pt-4 pb-2">Your schedule</p>
                  {hours.map((day, i) => (
                    <div key={i} className="flex items-center justify-between px-5 py-3 border-t border-gray-100 first:border-0" data-testid={`row-day-${i}`}>
                      <span className={`text-sm font-semibold w-24 ${day.isClosed ? "text-gray-300" : "text-gray-800"}`}>
                        {dayNames[i]}
                      </span>
                      {day.isClosed ? (
                        <span className="text-sm text-gray-300 italic flex-1">Closed</span>
                      ) : (
                        <span className="text-sm text-[#3B0764] flex-1 font-medium">
                          {formatTime(day.openTime)} – {formatTime(day.closeTime)}
                        </span>
                      )}
                      {!day.isClosed && (
                        <button
                          type="button"
                          onClick={() => handleRemoveDay(i)}
                          className="ml-3 w-6 h-6 rounded-full flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 transition-all text-xs"
                          title="Remove"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex border-t border-gray-100">
                <button onClick={() => setStep(3)} data-testid="button-back-step"
                  className="flex-1 py-4 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors border-r border-gray-100">
                  Back
                </button>
                <button
                  onClick={() => teamSize === "myself" ? handleComplete() : setStep(5)}
                  disabled={!canProceed(4) || onboardMutation.isPending}
                  data-testid="button-next-step"
                  className="flex-1 py-4 text-sm font-semibold text-white bg-[#3B0764] hover:bg-[#2d0552] transition-colors disabled:opacity-50">
                  {onboardMutation.isPending && <Loader2 className="w-4 h-4 animate-spin inline mr-1" />}
                  {teamSize === "myself"
                    ? (onboardMutation.isPending ? "Setting up…" : "Complete Setup")
                    : "Continue"}
                </button>
              </div>
            </div>
          );
        })()}

        {step === 5 && (
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 pt-6 pb-2">
              <div className="text-center mb-4">
                <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "2.1rem", fontWeight: 700, color: "#3B0764", letterSpacing: "-0.02em", lineHeight: 1 }}>
                  Certxa<span style={{ color: "#F59E0B" }}>.</span>
                </span>
              </div>
              <h2 className="text-xl font-bold text-center text-gray-900 mb-1" data-testid="text-step4-title">Add your team</h2>
              <p className="text-sm text-gray-400 text-center mb-5">Each member will get your services and hours by default</p>

              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5">
                <div className="space-y-3">
                  {staffNames.map((name, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow"
                          style={{ backgroundColor: staffColors[i % staffColors.length] }}
                        >
                          {(name.trim() || "?").charAt(0).toUpperCase()}
                        </div>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => updateStaffName(i, e.target.value)}
                          placeholder={i === 0 ? "Owner name" : "Staff member name"}
                          data-testid={`input-staff-name-${i}`}
                          autoFocus={i === staffNames.length - 1 && staffNames.length > 1}
                          className={`flex-1 h-11 px-4 rounded-xl border text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-[#3B0764] text-sm bg-white transition-colors ${name.trim() === "" ? "border-red-400" : "border-gray-200"}`}
                        />
                        {i > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const newNames = staffNames.filter((_, idx) => idx !== i);
                              setStaffNames(newNames);
                              setStaffCount(newNames.length);
                            }}
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 border border-gray-200 transition-all shrink-0"
                            title="Remove"
                          >
                            ×
                          </button>
                        )}
                        {i === 0 && (
                          <div className="w-9 h-9 shrink-0 flex items-center justify-center">
                            <span className="text-[10px] text-[#3B0764] font-bold border border-[#3B0764]/30 rounded px-1.5 py-0.5 bg-[#3B0764]/8">YOU</span>
                          </div>
                        )}
                      </div>
                      {name.trim() === "" && (
                        <p className="text-xs text-red-500 ml-12">Name is required</p>
                      )}
                    </div>
                  ))}
                </div>

                {staffNames.length < 20 && (
                  <button
                    type="button"
                    onClick={() => {
                      setStaffNames(prev => [...prev, ""]);
                      setStaffCount(prev => prev + 1);
                    }}
                    className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-gray-300 text-gray-400 hover:border-[#3B0764] hover:text-[#3B0764] text-sm font-semibold transition-all"
                  >
                    <Plus className="w-4 h-4" /> Add staff member
                  </button>
                )}

                {selectedType && (
                  <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 mt-4">
                    <p className="text-xs text-gray-400">
                      Setting up as a <span className="font-semibold text-gray-600">{selectedType}</span> — you can add more staff and customize further in your dashboard.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex border-t border-gray-100 mt-4">
              <button onClick={() => setStep(4)} data-testid="button-back-step"
                className="flex-1 py-4 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors border-r border-gray-100">
                Back
              </button>
              <button
                onClick={handleComplete}
                disabled={!canProceed(5) || onboardMutation.isPending}
                data-testid="button-complete-setup"
                className="flex-1 py-4 text-sm font-semibold text-white bg-[#3B0764] hover:bg-[#2d0552] transition-colors disabled:opacity-50"
              >
                {onboardMutation.isPending && <Loader2 className="w-4 h-4 animate-spin inline mr-1" />}
                {onboardMutation.isPending ? "Setting up…" : "Complete Setup"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BusinessTypeCard({
  type,
  isSelected,
  onSelect,
}: {
  type: { id: string; label: string; description: string; videoUrl: string; fallbackGradient: string };
  isSelected: boolean;
  onSelect: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const playVideo = () => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  };

  const pauseVideo = () => {
    if (!isSelected && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  useEffect(() => {
    if (isSelected) {
      playVideo();
    } else {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    }
  }, [isSelected]);

  return (
    <div
      className="flex flex-col flex-shrink-0 w-44 cursor-pointer snap-start"
      onClick={onSelect}
      onMouseEnter={playVideo}
      onMouseLeave={pauseVideo}
      data-testid={`card-business-type-${type.id.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div
        className={`relative h-64 w-full rounded-2xl overflow-hidden transition-all duration-200 bg-gradient-to-br ${type.fallbackGradient} ${
          isSelected
            ? "ring-2 ring-[#F59E0B] ring-offset-2 ring-offset-[#050C18] shadow-xl shadow-[#F59E0B]/20 scale-[1.03]"
            : "hover:scale-[1.01] hover:shadow-lg opacity-80 hover:opacity-100"
        }`}
      >
        <video
          ref={videoRef}
          src={type.videoUrl}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10" />
        {isSelected && (
          <div className="absolute top-3 right-3 z-10 w-6 h-6 rounded-full bg-[#F59E0B] flex items-center justify-center shadow">
            <Check className="w-3.5 h-3.5 text-[#3B0764]" />
          </div>
        )}
      </div>
      <div className="mt-2.5 px-0.5">
        <p className={`font-bold text-sm leading-tight ${isSelected ? "text-[#F59E0B]" : "text-white"}`}>{type.label}</p>
        <p className="text-xs text-white/40 mt-0.5 leading-snug">{type.description}</p>
      </div>
    </div>
  );
}

function Step1BusinessType({
  selectedType,
  setSelectedType,
  onNext,
  canProceed,
}: {
  selectedType: string | null;
  setSelectedType: (id: string) => void;
  onNext: () => void;
  canProceed: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 8);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    return () => el.removeEventListener("scroll", updateScrollState);
  }, []);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
  };

  return (
    <div>
      <h2 className="text-2xl font-extrabold mb-1 text-white" data-testid="text-step1-title">What type of business do you run?</h2>
      <p className="text-sm text-white/45 mb-6">Pick the one that matches how you operate — you can switch later.</p>

      <div className="relative">
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            className="absolute left-0 top-1/2 -translate-y-8 -translate-x-2 z-10 w-9 h-9 rounded-full bg-[#0D1F35] border border-white/15 shadow-md flex items-center justify-center hover:bg-white/10 transition-colors"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x snap-mandatory scrollbar-none"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {businessTypes.map((type) => (
            <BusinessTypeCard
              key={type.id}
              type={type}
              isSelected={selectedType === type.id}
              onSelect={() => setSelectedType(type.id)}
            />
          ))}
        </div>

        {canScrollRight && (
          <button
            onClick={() => scroll("right")}
            className="absolute right-0 top-1/2 -translate-y-8 translate-x-2 z-10 w-9 h-9 rounded-full bg-[#0D1F35] border border-white/15 shadow-md flex items-center justify-center hover:bg-white/10 transition-colors"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-5 h-5 text-white" />
          </button>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <button onClick={onNext} disabled={!canProceed} data-testid="button-next-step"
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#F59E0B] text-[#3B0764] font-bold text-sm transition-all disabled:opacity-40">
          Next <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
