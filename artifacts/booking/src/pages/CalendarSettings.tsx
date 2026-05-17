import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCalendarSettings, useUpdateCalendarSettings, DEFAULT_CALENDAR_SETTINGS } from "@/hooks/use-calendar-settings";
import { useSelectedStore } from "@/hooks/use-store";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm, Controller } from "react-hook-form";
import { Save, HelpCircle, Clock3 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Store } from "@shared/schema";

type CalendarSettingsForm = {
  startOfWeek: string;
  timeSlotInterval: number;
  nonWorkingHoursDisplay: number;
  allowBookingOutsideHours: boolean;
  autoCompleteAppointments: boolean;
  showPrices: boolean;
  walkInsEnabled: boolean;
};

function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help inline-block ml-1" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px]">
        <p className="text-xs">{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function CalendarOpsSettings({ store, enabled: initialEnabled }: { store: Store; enabled: boolean }) {
  const { toast } = useToast();
  const updateCalendarSettings = useUpdateCalendarSettings();
  const [grace, setGrace] = useState<number>((store as any).lateGracePeriodMinutes ?? 10);
  const [enabled, setEnabled] = useState<boolean>(initialEnabled);

  useEffect(() => {
    setGrace((store as any).lateGracePeriodMinutes ?? 10);
  }, [store]);

  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  const updateStore = useMutation({
    mutationFn: async (data: { lateGracePeriodMinutes: number }) => {
      const res = await apiRequest("PATCH", `/api/stores/${store.id}`, data);
      return res.json();
    },
  });

  const onSave = async () => {
    const value = Math.max(0, Math.min(120, Math.round(grace) || 0));
    try {
      await Promise.all([
        updateCalendarSettings.mutateAsync({ autoMarkNoShows: enabled }),
        updateStore.mutateAsync({ lateGracePeriodMinutes: value }),
      ]);
      await queryClient.invalidateQueries({ queryKey: ["/api/stores"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/stores", store.id] });
      toast({ title: "Saved", description: "No-show settings updated." });
    } catch {
      toast({ title: "Error", description: "Failed to save.", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold">Check-In &amp; No-Show</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Use this to turn on automatic No-Show handling and set how long to wait after the booked start time.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={updateStore.isPending || updateCalendarSettings.isPending}
            data-testid="button-save-calendar-ops"
          >
            <Save className="w-4 h-4 mr-2" />
            {updateStore.isPending || updateCalendarSettings.isPending ? "Saving..." : "Save"}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 py-2 border-t pt-6">
          <div>
            <Label className="text-base font-medium">Enable automatic no-show</Label>
            <p className="text-sm text-muted-foreground mt-0.5">
              Turn this on to automatically set overdue bookings to No-Show.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-auto-no-show" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="late-grace" className="flex items-center gap-2">
              <Clock3 className="w-4 h-4 text-muted-foreground" />
              Grace period
            </Label>
            <span className="text-sm font-medium tabular-nums">{grace} min</span>
          </div>
          <input
            id="late-grace"
            type="range"
            min={0}
            max={120}
            step={5}
            value={grace}
            onChange={(e) => setGrace(Number(e.target.value))}
            className="w-full accent-[#00D4AA]"
            data-testid="slider-late-grace"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="late-grace-input"
              type="number"
              min={0}
              max={120}
              value={grace}
              onChange={(e) => setGrace(Number(e.target.value))}
              className="w-32"
              data-testid="input-late-grace"
            />
            <span className="text-sm text-muted-foreground">
              How long after the booked start time before the booking is automatically changed to No-Show.
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CalendarSettings() {
  const { selectedStore } = useSelectedStore();
  const { data: settings, isLoading } = useCalendarSettings();
  const updateSettings = useUpdateCalendarSettings();
  const { toast } = useToast();
  const { data: store, isLoading: storeLoading } = useQuery<Store>({
    queryKey: ["/api/stores", selectedStore?.id],
    enabled: !!selectedStore?.id,
  });

  const { control, handleSubmit, reset } = useForm<CalendarSettingsForm>({
    defaultValues: DEFAULT_CALENDAR_SETTINGS,
  });

  useEffect(() => {
    if (settings) {
      reset({
        startOfWeek: settings.startOfWeek,
        timeSlotInterval: settings.timeSlotInterval,
        nonWorkingHoursDisplay: settings.nonWorkingHoursDisplay,
        allowBookingOutsideHours: settings.allowBookingOutsideHours,
        autoCompleteAppointments: settings.autoCompleteAppointments,
        showPrices: settings.showPrices ?? true,
        walkInsEnabled: (settings as any).walkInsEnabled ?? true,
      });
    }
  }, [settings, reset]);

  const onSubmit = (data: CalendarSettingsForm) => {
    updateSettings.mutate(data, {
      onSuccess: () => {
        toast({ title: "Settings saved", description: "Calendar settings have been updated." });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
      },
    });
  };

  if (isLoading || storeLoading || !store) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">Loading...</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-3xl font-display font-bold" data-testid="text-page-title">Calendar Settings</h1>
          <Button type="submit" disabled={updateSettings.isPending} data-testid="button-save-settings">
            <Save className="w-4 h-4 mr-2" />
            {updateSettings.isPending ? "Saving..." : "Save"}
          </Button>
        </div>

        <Card>
          <CardContent className="p-6 space-y-8">
            <h2 className="text-xl font-semibold">Calendar Settings</h2>

            <div className="space-y-2">
              <Label className="flex items-center">
                Calendar start of week
                <InfoTooltip text="Choose which day the calendar week starts on." />
              </Label>
              <Controller
                name="startOfWeek"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger data-testid="select-start-of-week">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monday">Monday</SelectItem>
                      <SelectItem value="sunday">Sunday</SelectItem>
                      <SelectItem value="saturday">Saturday</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center">
                Time slot intervals
                <InfoTooltip text="The time interval between each slot on the calendar grid." />
              </Label>
              <Controller
                name="timeSlotInterval"
                control={control}
                render={({ field }) => (
                  <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                    <SelectTrigger data-testid="select-time-slot-interval">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 min</SelectItem>
                      <SelectItem value="10">10 min</SelectItem>
                      <SelectItem value="15">15 min</SelectItem>
                      <SelectItem value="20">20 min</SelectItem>
                      <SelectItem value="30">30 min</SelectItem>
                      <SelectItem value="60">60 min</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center">
                Non-working hours displayed in calendar
                <InfoTooltip text="How many non-working hours to show before and after business hours on the calendar." />
              </Label>
              <Controller
                name="nonWorkingHoursDisplay"
                control={control}
                render={({ field }) => (
                  <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                    <SelectTrigger data-testid="select-non-working-hours">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">None</SelectItem>
                      <SelectItem value="1">1 hour</SelectItem>
                      <SelectItem value="2">2 hours</SelectItem>
                      <SelectItem value="3">3 hours</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex items-center justify-between gap-4 py-2 border-t pt-6">
              <div>
                <Label className="text-base font-medium">Allow staff to be booked outside opening hours</Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  You are able to allow appointments to be made via your booking page beyond your closing time.
                </p>
              </div>
              <Controller
                name="allowBookingOutsideHours"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="switch-allow-outside-hours"
                  />
                )}
              />
            </div>

            <div className="flex items-center justify-between gap-4 py-2 border-t pt-6">
              <div>
                <Label className="text-base font-medium">Set appointments to auto-complete</Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Set appointments to completed status at the end of the working day.
                </p>
              </div>
              <Controller
                name="autoCompleteAppointments"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="switch-auto-complete"
                  />
                )}
              />
            </div>

            <div className="flex items-center justify-between gap-4 py-2 border-t pt-6">
              <div>
                <Label className="text-base font-medium">Show prices on appointments</Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Display service prices on calendar appointment cards and in the appointment details panel.
                </p>
              </div>
              <Controller
                name="showPrices"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="switch-show-prices"
                  />
                )}
              />
            </div>

            <div className="flex items-center justify-between gap-4 py-2 border-t pt-6">
              <div>
                <Label className="text-base font-medium">Allow walk-ins</Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  When off, the walk-in button is hidden and staff must always look up or create a client. Useful if you want to capture customer contact info for SMS or marketing on every booking.
                </p>
              </div>
              <Controller
                name="walkInsEnabled"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="switch-walk-ins-enabled"
                  />
                )}
              />
            </div>

          </CardContent>
        </Card>
        <div className="mt-8">
          <CalendarOpsSettings store={store} enabled={settings?.autoMarkNoShows ?? false} />
        </div>
      </form>
    </AppLayout>
  );
}
