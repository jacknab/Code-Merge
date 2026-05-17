import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useSelectedStore } from "@/hooks/use-store";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Save, ChevronLeft, ChevronRight, Calendar as CalendarIcon, CreditCard, ShoppingCart, Clock } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Store, BusinessHours } from "@shared/schema";
import { insertLocationSchema } from "@shared/schema";
import { format, addWeeks, subWeeks, startOfWeek, endOfWeek, addDays } from "date-fns";

const businessProfileBaseSchema = insertLocationSchema.pick({
  name: true,
  category: true,
  email: true,
  phone: true,
  city: true,
  state: true,
  address: true,
  postcode: true,
});

const businessProfileSchema = businessProfileBaseSchema.pick({
  name: true,
  email: true,
  phone: true,
  city: true,
  state: true,
  address: true,
  postcode: true,
}).extend({
  name: z.string().min(1, "Business name is required"),
  email: z.string().email("Please enter a valid email").or(z.literal("")).optional().default(""),
  category: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  address: z.string().optional().default(""),
  postcode: z.string().optional().default(""),
});

type BusinessProfileForm = z.infer<typeof businessProfileSchema>;

type DayHours = {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
};

type StripeSettingsForm = {
  publishableKey: string;
  secretKey: string;
  testMagstripeEnabled: boolean;
};

const CATEGORIES = [
  "Hair Salon",
  "Nail Salon",
  "Spa",
  "Barbershop",
  "Esthetician",
  "Pet Groomer",
  "Tattoo Studio",
  "Other",
];

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DEFAULT_HOURS: DayHours[] = [
  { dayOfWeek: 0, openTime: "09:00", closeTime: "19:00", isClosed: false },
  { dayOfWeek: 1, openTime: "09:00", closeTime: "19:00", isClosed: false },
  { dayOfWeek: 2, openTime: "09:00", closeTime: "19:00", isClosed: false },
  { dayOfWeek: 3, openTime: "09:00", closeTime: "19:00", isClosed: false },
  { dayOfWeek: 4, openTime: "09:00", closeTime: "19:00", isClosed: false },
  { dayOfWeek: 5, openTime: "10:00", closeTime: "20:00", isClosed: false },
  { dayOfWeek: 6, openTime: "10:00", closeTime: "20:00", isClosed: false },
];

function formatTime12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function computeWeeklyHours(hours: DayHours[]): string {
  let total = 0;
  for (const h of hours) {
    if (h.isClosed) continue;
    const [oh, om] = h.openTime.split(":").map(Number);
    const [ch, cm] = h.closeTime.split(":").map(Number);
    const diff = (ch * 60 + cm) - (oh * 60 + om);
    if (diff > 0) total += diff;
  }
  const hrs = Math.floor(total / 60);
  const mins = total % 60;
  return `${hrs} hours ${mins} min`;
}

export type SectionRef = { save: () => Promise<void> };

const BusinessProfile = forwardRef<SectionRef, { store: Store }>(
  function BusinessProfile({ store }, ref) {
    const form = useForm<BusinessProfileForm>({
      resolver: zodResolver(businessProfileSchema),
      defaultValues: {
        name: store.name || "",
        category: store.category || "",
        email: store.email || "",
        phone: store.phone || "",
        city: store.city || "",
        state: store.state || "",
        address: store.address || "",
        postcode: store.postcode || "",
      },
    });

    useEffect(() => {
      form.reset({
        name: store.name || "",
        category: store.category || "",
        email: store.email || "",
        phone: store.phone || "",
        city: store.city || "",
        state: store.state || "",
        address: store.address || "",
        postcode: store.postcode || "",
      });
    }, [store.id]);

    const updateStore = useMutation({
      mutationFn: async (data: BusinessProfileForm) => {
        const res = await apiRequest("PATCH", `/api/stores/${store.id}`, data);
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stores", store.id] });
      },
    });

    useImperativeHandle(ref, () => ({
      save: () =>
        new Promise<void>((resolve, reject) => {
          form.handleSubmit(
            async (data) => {
              try {
                await updateStore.mutateAsync(data);
                resolve();
              } catch (e) {
                reject(e);
              }
            },
            (errors) => {
              const firstError = Object.values(errors)[0];
              reject(new Error(firstError?.message || "Please fix the business profile errors"));
            }
          )();
        }),
    }));

    return (
      <Form {...form}>
        <div>
          <h2 className="text-lg font-semibold mb-6" data-testid="text-business-profile-title">
            Business Profile
          </h2>
          <Card>
            <CardContent className="p-6 space-y-6">
              <h3 className="text-base font-semibold">Location Details</h3>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Name</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-store-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-category">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} data-testid="input-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telephone</FormLabel>
                    <FormControl>
                      <Input type="tel" {...field} data-testid="input-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="border-t pt-4">
                <h3 className="text-base font-semibold mb-4">Address</h3>
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City or Town</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-city" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-state" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Street Address</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-address" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="postcode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Postcode</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-postcode" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </Form>
    );
  }
);

const StripePaymentsSettings = forwardRef<SectionRef, { store: Store }>(
  function StripePaymentsSettings({ store }, ref) {
    const [formState, setFormState] = useState<StripeSettingsForm>({
      publishableKey: "",
      secretKey: "",
      testMagstripeEnabled: true,
    });

    const { data: settings, isLoading } = useQuery<any>({
      queryKey: ["/api/stripe-settings", store.id],
      queryFn: async () => {
        const res = await fetch(`/api/stripe-settings/${store.id}`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load Stripe settings");
        return res.json();
      },
      enabled: !!store.id,
    });

    useEffect(() => {
      if (!settings) {
        setFormState({ publishableKey: "", secretKey: "", testMagstripeEnabled: true });
        return;
      }
      setFormState({
        publishableKey: settings.publishableKey || "",
        secretKey: settings.secretKey || "",
        testMagstripeEnabled: settings.testMagstripeEnabled !== false,
      });
    }, [settings]);

    const saveSettings = useMutation({
      mutationFn: async (data: StripeSettingsForm) => {
        const res = await apiRequest("PUT", `/api/stripe-settings/${store.id}`, {
          publishableKey: data.publishableKey.trim() || null,
          secretKey: data.secretKey.trim() || null,
          testMagstripeEnabled: data.testMagstripeEnabled,
        });
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/stripe-settings", store.id] });
      },
    });

    useImperativeHandle(ref, () => ({
      save: async () => {
        await saveSettings.mutateAsync(formState);
      },
    }));

    const modeLabel = settings?.mode === "test" ? "Test mode" : settings?.mode === "live" ? "Live mode" : "Not connected";
    const connected = settings?.connected;

    return (
      <div>
        <div className="flex items-center gap-2 mb-6">
          <CreditCard className="w-5 h-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold" data-testid="text-stripe-settings-title">
              Stripe Payments
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Save this store&apos;s Stripe keys for POS test payments.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Status:</span>
              <span className={connected ? "text-green-600" : "text-muted-foreground"}>{modeLabel}</span>
              {settings?.mode === "live" && (
                <span className="text-xs text-amber-600">Mag-stripe test payments are blocked for live keys.</span>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="stripe-publishable-key">Publishable key</Label>
                <Input
                  id="stripe-publishable-key"
                  value={formState.publishableKey}
                  onChange={(e) => setFormState(prev => ({ ...prev, publishableKey: e.target.value }))}
                  placeholder="pk_test_..."
                  disabled={isLoading}
                  data-testid="input-stripe-publishable-key"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="stripe-secret-key">Secret key</Label>
                <Input
                  id="stripe-secret-key"
                  type="password"
                  value={formState.secretKey}
                  onChange={(e) => setFormState(prev => ({ ...prev, secretKey: e.target.value }))}
                  placeholder="sk_test_..."
                  disabled={isLoading}
                  data-testid="input-stripe-secret-key"
                />
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
              <Checkbox
                checked={formState.testMagstripeEnabled}
                onCheckedChange={(checked) => setFormState(prev => ({ ...prev, testMagstripeEnabled: checked === true }))}
                data-testid="checkbox-test-magstripe-enabled"
              />
              <span>
                <span className="block text-sm font-medium">Enable USB mag-stripe reader test mode</span>
                <span className="block text-xs text-muted-foreground mt-1">
                  This only accepts Stripe test card swipes and only runs with an sk_test key.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>
      </div>
    );
  }
);

const CancellationSettings = forwardRef<SectionRef, { store: Store }>(
  function CancellationSettings({ store }, ref) {
    const [hours, setHours] = useState<string>(
      String((store as any).cancellationHoursCutoff ?? 24)
    );

    const updateStore = useMutation({
      mutationFn: async (cancellationHoursCutoff: number) => {
        const res = await apiRequest("PATCH", `/api/stores/${store.id}`, { cancellationHoursCutoff });
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stores", store.id] });
      },
    });

    useImperativeHandle(ref, () => ({
      save: async () => {
        const val = parseInt(hours, 10);
        if (isNaN(val) || val < 0) throw new Error("Please enter a valid cancellation notice period");
        await updateStore.mutateAsync(val);
      },
    }));

    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Cancellation Policy</h2>
        </div>
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cancellation-cutoff">Minimum notice required to cancel (hours)</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="cancellation-cutoff"
                  type="number"
                  min="0"
                  max="168"
                  className="w-32"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">hours before appointment</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Customers cannot cancel online within this window. Set to 0 to allow cancellations at any time.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
);

const POSSettings = forwardRef<SectionRef, { store: Store }>(
  function POSSettings({ store }, ref) {
    const [posEnabled, setPosEnabled] = useState((store as any).posEnabled !== false);

    const updateStore = useMutation({
      mutationFn: async (enabled: boolean) => {
        const res = await apiRequest("PATCH", `/api/stores/${store.id}`, { posEnabled: enabled });
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stores", store.id] });
      },
    });

    useImperativeHandle(ref, () => ({
      save: async () => {
        await updateStore.mutateAsync(posEnabled);
      },
    }));

    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <ShoppingCart className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Point of Sale</h2>
        </div>
        <Card>
          <CardContent className="p-6">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={posEnabled}
                onCheckedChange={(checked) => setPosEnabled(checked === true)}
                data-testid="checkbox-pos-enabled"
              />
              <span>
                <span className="block text-sm font-medium">Enable built-in POS</span>
                <span className="block text-xs text-muted-foreground mt-1">
                  When enabled, completed appointments go through a checkout flow for payment collection, tips, and discounts.
                  Financial reports and analytics are also available. Disable this if you handle payments externally and only need
                  appointment tracking.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>
      </div>
    );
  }
);

const BusinessHoursEditor = forwardRef<SectionRef, { store: Store }>(
  function BusinessHoursEditor({ store }, ref) {
    const [weekDate, setWeekDate] = useState(new Date());
    const [editingDay, setEditingDay] = useState<number | null>(null);
    const [hours, setHours] = useState<DayHours[]>(DEFAULT_HOURS);

    const weekStart = startOfWeek(weekDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(weekDate, { weekStartsOn: 1 });

    const { data: savedHours } = useQuery<BusinessHours[]>({
      queryKey: ["/api/business-hours", store.id],
      queryFn: async () => {
        const res = await fetch(`/api/business-hours?storeId=${store.id}`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to fetch business hours");
        return res.json();
      },
      enabled: !!store.id,
    });

    useEffect(() => {
      if (savedHours && savedHours.length > 0) {
        setHours(savedHours.map(h => ({
          dayOfWeek: h.dayOfWeek,
          openTime: h.openTime,
          closeTime: h.closeTime,
          isClosed: h.isClosed,
        })));
      }
    }, [savedHours]);

    const saveHours = useMutation({
      mutationFn: async (data: DayHours[]) => {
        const res = await apiRequest("PUT", "/api/business-hours", {
          storeId: store.id,
          hours: data,
        });
        return res.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/business-hours", store.id] });
        setEditingDay(null);
      },
    });

    useImperativeHandle(ref, () => ({
      save: () =>
        new Promise<void>((resolve, reject) => {
          for (const h of hours) {
            if (h.isClosed) continue;
            const [oh, om] = h.openTime.split(":").map(Number);
            const [ch, cm] = h.closeTime.split(":").map(Number);
            if ((ch * 60 + cm) <= (oh * 60 + om)) {
              reject(new Error(`${DAY_NAMES[h.dayOfWeek]}: Close time must be after open time`));
              return;
            }
          }
          saveHours.mutateAsync(hours).then(() => resolve()).catch(reject);
        }),
    }));

    const updateDayHours = (dayIdx: number, field: keyof DayHours, value: string | boolean) => {
      setHours(prev => prev.map((h, i) => i === dayIdx ? { ...h, [field]: value } : h));
    };

    const weeklyTotal = computeWeeklyHours(hours);

    const timeOptions: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 30) {
        timeOptions.push(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`);
      }
    }

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-lg font-semibold" data-testid="text-business-hours-title">Business Hours</h2>
          <p className="text-sm text-muted-foreground">Manage your business working hours</p>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setWeekDate(subWeeks(weekDate, 1))}
                data-testid="button-prev-week"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-2 text-sm font-medium">
                <span>This Week</span>
                <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                <span>{format(weekStart, "dd")} - {format(weekEnd, "dd MMM yyyy").toUpperCase()}</span>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setWeekDate(addWeeks(weekDate, 1))}
                data-testid="button-next-week"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left p-3 text-sm font-medium text-muted-foreground border-b w-[200px]"></th>
                    {DAY_NAMES.map((day, i) => {
                      const date = addDays(weekStart, i);
                      return (
                        <th key={day} className="text-center p-3 text-sm font-semibold border-b min-w-[120px]">
                          <div>{day}</div>
                          <div className="text-muted-foreground font-normal text-xs">{format(date, "dd MMM.")}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="p-3 border-b">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm">Business Hours</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingDay(editingDay !== null ? null : 0)}
                          data-testid="button-edit-hours"
                        >
                          {editingDay !== null ? "Done" : "Edit"}
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Week: {weeklyTotal}
                      </div>
                    </td>
                    {hours.map((h, i) => (
                      <td key={i} className="text-center p-3 border-b text-sm" data-testid={`text-hours-day-${i}`}>
                        {h.isClosed ? (
                          <span className="text-muted-foreground">Closed</span>
                        ) : (
                          <div>
                            <div>{formatTime12(h.openTime)} -</div>
                            <div>{formatTime12(h.closeTime)}</div>
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {editingDay !== null && (
              <div className="mt-6 border-t pt-6 space-y-4">
                <h3 className="font-semibold text-sm">Edit Business Hours</h3>
                <div className="grid gap-4">
                  {hours.map((h, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-4 p-3 rounded-md bg-muted/30" data-testid={`edit-hours-day-${i}`}>
                      <span className="font-medium text-sm w-24">{DAY_NAMES[i]}</span>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={h.isClosed}
                          onCheckedChange={(checked) => updateDayHours(i, "isClosed", !!checked)}
                          data-testid={`checkbox-closed-day-${i}`}
                        />
                        <Label className="text-sm">Closed</Label>
                      </div>
                      {!h.isClosed && (
                        <>
                          <Select
                            value={h.openTime}
                            onValueChange={(v) => updateDayHours(i, "openTime", v)}
                          >
                            <SelectTrigger className="w-[130px]" data-testid={`select-open-time-day-${i}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {timeOptions.map((t) => (
                                <SelectItem key={t} value={t}>{formatTime12(t)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-muted-foreground">to</span>
                          <Select
                            value={h.closeTime}
                            onValueChange={(v) => updateDayHours(i, "closeTime", v)}
                          >
                            <SelectTrigger className="w-[130px]" data-testid={`select-close-time-day-${i}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {timeOptions.map((t) => (
                                <SelectItem key={t} value={t}>{formatTime12(t)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }
);

export default function BusinessSettings() {
  const { selectedStore } = useSelectedStore();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const profileRef = useRef<SectionRef>(null);
  const cancellationRef = useRef<SectionRef>(null);
  const posRef = useRef<SectionRef>(null);
  const stripeRef = useRef<SectionRef>(null);
  const hoursRef = useRef<SectionRef>(null);

  const { data: store, isLoading } = useQuery<Store>({
    queryKey: ["/api/stores", selectedStore?.id],
    enabled: !!selectedStore?.id,
  });

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      await Promise.all([
        profileRef.current?.save(),
        cancellationRef.current?.save(),
        posRef.current?.save(),
        stripeRef.current?.save(),
        hoursRef.current?.save(),
      ]);
      toast({
        title: "Settings saved",
        description: "All business settings have been updated successfully.",
      });
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : "Some settings could not be saved. Please check your inputs and try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !store) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">Loading...</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {/* Sticky page-level header with single Save button */}
      <div className="sticky top-14 md:top-0 z-20 -mx-4 md:-mx-8 px-4 md:px-8 py-3 bg-background/95 backdrop-blur-sm border-b flex items-center justify-between mb-8">
        <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
          Business Settings
        </h1>
        <Button
          onClick={handleSaveAll}
          disabled={isSaving}
          className="gap-2"
          data-testid="button-save-all"
        >
          <Save className="w-4 h-4" />
          {isSaving ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      <div className="space-y-8">
        <BusinessProfile ref={profileRef} store={store} />
        <CancellationSettings ref={cancellationRef} store={store} />
        <POSSettings ref={posRef} store={store} />
        <StripePaymentsSettings ref={stripeRef} store={store} />
        <BusinessHoursEditor ref={hoursRef} store={store} />
      </div>
    </AppLayout>
  );
}
