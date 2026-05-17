import { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  useStaffMember, useUpdateStaff, useDeleteStaff,
  useStaffServices, useSetStaffServices,
  useStaffAvailability, useSetStaffAvailability, useDeleteStaffAvailabilityRule
} from "@/hooks/use-staff";
import { useServices } from "@/hooks/use-services";
import { useServiceCategories } from "@/hooks/use-addons";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertStaffSchema } from "@shared/schema";
import type { Staff, Service, StaffAvailability } from "@shared/schema";
import { z } from "zod";
import {
  ArrowLeft, Save, Trash2, User, Clock, Scissors,
  Plus, DollarSign
} from "lucide-react";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "M", "T", "W", "T", "F", "Sat"];

export default function StaffDetail() {
  const params = useParams();
  const staffId = Number(params.id);
  const navigate = useNavigate();

  const { data: staffMember, isLoading } = useStaffMember(staffId);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </AppLayout>
    );
  }

  if (!staffMember) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Staff member not found.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate("/staff")}
          className="mb-4"
          data-testid="button-back-to-staff"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Staff
        </Button>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center text-2xl font-bold text-muted-foreground uppercase">
            {staffMember.avatarUrl ? (
              <img src={staffMember.avatarUrl} alt={staffMember.name} className="w-full h-full object-cover rounded-md" />
            ) : (
              staffMember.name.slice(0, 2)
            )}
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold" data-testid="text-staff-name">{staffMember.name}</h1>
            <p className="text-primary text-sm font-medium capitalize" data-testid="text-staff-role">{staffMember.role}</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="mb-6">
          <TabsTrigger value="profile" data-testid="tab-profile">
            <User className="w-4 h-4 mr-2" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="availability" data-testid="tab-availability">
            <Clock className="w-4 h-4 mr-2" />
            Availability
          </TabsTrigger>
          <TabsTrigger value="services" data-testid="tab-services">
            <Scissors className="w-4 h-4 mr-2" />
            Services
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileTab staff={staffMember} onDelete={() => navigate("/staff")} />
        </TabsContent>
        <TabsContent value="availability">
          <AvailabilityTab staffId={staffId} />
        </TabsContent>
        <TabsContent value="services">
          <AssignedServicesTab staffId={staffId} />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}

import { Camera } from "lucide-react";

function ProfileTab({ staff, onDelete }: { staff: Staff; onDelete: () => void }) {
  const { mutate: updateStaff, isPending: isUpdating } = useUpdateStaff();
  const { mutate: deleteStaff, isPending: isDeleting } = useDeleteStaff();
  const { toast } = useToast();

  const [commissionEnabled, setCommissionEnabled] = useState(staff.commissionEnabled ?? false);
  const [commissionRate, setCommissionRate] = useState(String(staff.commissionRate || "0"));
  const [calendarAccess, setCalendarAccess] = useState(false); // Will be updated from API

  // Fetch calendar access status on component load
  useEffect(() => {
    const fetchCalendarAccessStatus = async () => {
      try {
        const response = await fetch(`/api/staff/${staff.id}/calendar-access-status`);
        if (response.ok) {
          const data = await response.json();
          setCalendarAccess(data.enabled);
        }
      } catch (error) {
        console.error("Failed to fetch calendar access status:", error);
      }
    };

    fetchCalendarAccessStatus();
  }, [staff.id]);

  const handleCalendarAccessChange = async (enabled: boolean) => {
    try {
      const endpoint = enabled
        ? `/api/staff/${staff.id}/enable-calendar-access`
        : `/api/staff/${staff.id}/disable-calendar-access`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      if (response.ok) {
        toast({
          title: enabled ? "Calendar access enabled" : "Calendar access disabled",
          description: enabled
            ? "An email with a temporary password has been sent to the staff member."
            : "This staff member can no longer log in to the calendar.",
        });
        setCalendarAccess(enabled);
      } else {
        toast({ title: "Failed to update access", description: data.message, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "An error occurred", variant: "destructive" });
    }
  };


  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<z.infer<typeof insertStaffSchema>>({
    resolver: zodResolver(insertStaffSchema),
    defaultValues: {
      name: staff.name,
      email: staff.email || "",
      phone: staff.phone || "",
      role: staff.role || "stylist",
      bio: staff.bio || "",
      color: staff.color || "#3b82f6",
      avatarUrl: staff.avatarUrl || "",
    },
  });
  const avatarUrl = watch("avatarUrl");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new window.FileReader();
    reader.onloadend = () => {
      setValue("avatarUrl", reader.result as string);
    };
    reader.onerror = () => {
      toast({ title: "Failed to read image", variant: "destructive" });
    };
    reader.readAsDataURL(file);
  };

  const onSubmit = (data: z.infer<typeof insertStaffSchema>) => {
    updateStaff({
      id: staff.id,
      ...data,
      commissionEnabled,
      commissionRate,
    }, {
      onSuccess: () => {
        toast({ title: "Staff member updated" });
      },
      onError: () => {
        toast({ title: "Failed to update staff member", variant: "destructive" });
      },
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Edit Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-lg">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" {...register("name")} data-testid="input-staff-name" />
              {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register("email")} data-testid="input-staff-email" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" {...register("password")} placeholder="Leave blank to keep current password" data-testid="input-staff-password" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" {...register("phone")} data-testid="input-staff-phone" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Input id="role" {...register("role")} data-testid="input-staff-role" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="avatarUrl">Avatar</Label>
              <div className="flex gap-4 items-center">
                <div className="relative shrink-0">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Preview" className="w-16 h-16 rounded object-cover border" />
                  ) : (
                    <div className="w-16 h-16 rounded border bg-muted flex items-center justify-center">
                      <Camera className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    id="staff-avatar-upload-edit"
                    onChange={handleFileChange}
                  />
                  <label
                    htmlFor="staff-avatar-upload-edit"
                    className="absolute inset-0 cursor-pointer"
                    title="Upload Avatar"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                {...register("bio")}
                rows={3}
                placeholder="A short bio shown to clients on your booking page and website embed..."
                data-testid="input-staff-bio"
              />
              <p className="text-xs text-muted-foreground">This bio appears on team booking cards and the public booking page.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="color">Calendar Color</Label>
              <div className="flex items-center gap-3">
                <input type="color" {...register("color")} className="w-10 h-9 rounded-md cursor-pointer border" data-testid="input-staff-color" />
                <Input {...register("color")} className="w-32" data-testid="input-staff-color-text" />
              </div>
            </div>

            <div className="border-t pt-4 mt-4">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Commission Settings</h3>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Enable Commission</Label>
                    <p className="text-xs text-muted-foreground">Track commission earnings for this staff member</p>
                  </div>
                  <Switch
                    checked={commissionEnabled}
                    onCheckedChange={setCommissionEnabled}
                    data-testid="switch-commission-enabled"
                  />
                </div>
                {commissionEnabled && (
                  <div className="space-y-2">
                    <Label htmlFor="commissionRate">Commission Rate (%)</Label>
                    <Input
                      id="commissionRate"
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      value={commissionRate}
                      onChange={(e) => setCommissionRate(e.target.value)}
                      className="w-32"
                      data-testid="input-commission-rate"
                    />
                    <p className="text-xs text-muted-foreground">
                      Percentage of service revenue earned as commission
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t pt-4 mt-4">
              <div className="flex items-center gap-2 mb-4">
                <h3 className="font-semibold text-sm">Online Access</h3>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Enable Calendar Access</Label>
                    <p className="text-xs text-muted-foreground">Allow staff to log in and view their calendar.</p>
                  </div>
                  <Switch
                    checked={calendarAccess}
                    onCheckedChange={handleCalendarAccessChange}
                    disabled={!staff.email}
                  />
                </div>
                {!staff.email && (
                    <p className="text-xs text-destructive">An email address is required to enable calendar access.</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-4">
              <Button type="submit" disabled={isUpdating} data-testid="button-save-profile">
                <Save className="w-4 h-4 mr-2" />
                {isUpdating ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                data-testid="button-delete-staff"
                onClick={() => {
                  if (confirm("Are you sure you want to delete this staff member?")) {
                    deleteStaff(staff.id, { onSuccess: onDelete });
                  }
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {isDeleting ? "Deleting..." : "Delete Staff"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function AvailabilityTab({ staffId }: { staffId: number }) {
  const { data: rules = [], isLoading } = useStaffAvailability(staffId);
  const { mutate: setAvailability, isPending } = useSetStaffAvailability();
  const { mutate: deleteRule } = useDeleteStaffAvailabilityRule();
  const { toast } = useToast();

  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  const toggleDay = (day: number) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const addRules = () => {
    if (selectedDays.length === 0) return;

    const existingRules = rules.map(r => ({
      dayOfWeek: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
    }));

    const newRules = selectedDays
      .filter(day => !existingRules.some(r => r.dayOfWeek === day))
      .map(day => ({
        dayOfWeek: day,
        startTime,
        endTime,
      }));

    const allRules = [...existingRules, ...newRules];

    setAvailability({ staffId, rules: allRules }, {
      onSuccess: () => {
        toast({ title: "Availability updated" });
        setSelectedDays([]);
      },
      onError: () => {
        toast({ title: "Failed to update availability", variant: "destructive" });
      },
    });
  };

  const handleDeleteRule = (rule: StaffAvailability) => {
    const remaining = rules
      .filter(r => r.id !== rule.id)
      .map(r => ({ dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime }));

    setAvailability({ staffId, rules: remaining }, {
      onSuccess: () => {
        toast({ title: "Rule removed" });
      },
    });
  };

  const sortedRules = [...rules].sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Weekly Availability</CardTitle>
          <p className="text-sm text-muted-foreground">Set working hours for this staff member.</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4 mb-6">
            <div className="space-y-2">
              <Label>Days</Label>
              <div className="flex gap-1">
                {DAY_SHORT.map((label, idx) => (
                  <Button
                    key={idx}
                    type="button"
                    variant={selectedDays.includes(idx) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleDay(idx)}
                    data-testid={`button-day-${idx}`}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Start</Label>
              <Input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-32"
                data-testid="input-start-time"
              />
            </div>

            <div className="space-y-2">
              <Label>End</Label>
              <Input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className="w-32"
                data-testid="input-end-time"
              />
            </div>

            <Button
              onClick={addRules}
              disabled={isPending || selectedDays.length === 0}
              size="icon"
              data-testid="button-add-availability"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : sortedRules.length === 0 ? (
            <p className="text-muted-foreground text-sm">No availability rules set. Add working days above.</p>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Current Rules</Label>
              <div className="space-y-2">
                {sortedRules.map(rule => (
                  <Card key={rule.id}>
                    <CardContent className="flex items-center justify-between gap-4 py-3 px-4">
                      <div className="flex items-center gap-4">
                        <span className="inline-block min-w-[90px] text-center text-sm font-medium bg-primary/10 text-primary px-3 py-1 rounded-md">
                          {DAY_NAMES[rule.dayOfWeek]}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {rule.startTime} - {rule.endTime}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteRule(rule)}
                        data-testid={`button-delete-rule-${rule.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AssignedServicesTab({ staffId }: { staffId: number }) {
  const { data: staffServiceLinks = [], isLoading: isLoadingLinks } = useStaffServices(staffId);
  const { data: allServices = [], isLoading: isLoadingServices } = useServices();
  const { data: categories = [] } = useServiceCategories();
  const { mutate: setServices, isPending } = useSetStaffServices();
  const { toast } = useToast();

  const assignedServiceIds = new Set(staffServiceLinks.map((ss: any) => ss.serviceId));
  const [localSelection, setLocalSelection] = useState<Set<number> | null>(null);

  const selection = localSelection ?? assignedServiceIds;

  const toggleService = (serviceId: number) => {
    const newSet = new Set(selection);
    if (newSet.has(serviceId)) {
      newSet.delete(serviceId);
    } else {
      newSet.add(serviceId);
    }
    setLocalSelection(newSet);
  };

  const toggleCategory = (categoryServices: Service[]) => {
    const newSet = new Set(selection);
    const allSelected = categoryServices.every(s => newSet.has(s.id));
    categoryServices.forEach(s => {
      if (allSelected) {
        newSet.delete(s.id);
      } else {
        newSet.add(s.id);
      }
    });
    setLocalSelection(newSet);
  };

  const saveChanges = () => {
    setServices({ staffId, serviceIds: Array.from(selection) }, {
      onSuccess: () => {
        toast({ title: "Assigned services updated" });
        setLocalSelection(null);
      },
      onError: () => {
        toast({ title: "Failed to update services", variant: "destructive" });
      },
    });
  };

  const isLoading = isLoadingLinks || isLoadingServices;

  const categorizedServices = categories.map((cat: any) => ({
    category: cat,
    services: allServices.filter((s: Service) => s.categoryId === cat.id || s.category === cat.name),
  })).filter((g: any) => g.services.length > 0);

  const uncategorized = allServices.filter(
    (s: Service) => !categories.some((cat: any) => s.categoryId === cat.id || s.category === cat.name)
  );

  const hasChanges = localSelection !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assigned Services</CardTitle>
        <p className="text-sm text-muted-foreground">Select services this staff member can perform.</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : allServices.length === 0 ? (
          <p className="text-muted-foreground text-sm">No services created yet. Add services first.</p>
        ) : (
          <div className="space-y-6">
            {categorizedServices.map((group: any) => {
              const allSelected = group.services.every((s: Service) => selection.has(s.id));
              const someSelected = group.services.some((s: Service) => selection.has(s.id));
              return (
                <div key={group.category.id}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={() => toggleCategory(group.services)}
                        data-testid={`checkbox-category-${group.category.id}`}
                      />
                      <span className="font-semibold">{group.category.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{group.services.length} services</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 ml-6">
                    {group.services.map((service: Service) => (
                      <label
                        key={service.id}
                        className="flex items-center gap-3 p-3 rounded-md border cursor-pointer hover-elevate"
                        data-testid={`label-service-${service.id}`}
                      >
                        <Checkbox
                          checked={selection.has(service.id)}
                          onCheckedChange={() => toggleService(service.id)}
                          data-testid={`checkbox-service-${service.id}`}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{service.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {service.duration} mins &middot; ${Number(service.price).toFixed(2)}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            {uncategorized.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-semibold">Other</span>
                  <span className="text-xs text-muted-foreground">{uncategorized.length} services</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 ml-6">
                  {uncategorized.map((service: Service) => (
                    <label
                      key={service.id}
                      className="flex items-center gap-3 p-3 rounded-md border cursor-pointer hover-elevate"
                      data-testid={`label-service-${service.id}`}
                    >
                      <Checkbox
                        checked={selection.has(service.id)}
                        onCheckedChange={() => toggleService(service.id)}
                        data-testid={`checkbox-service-${service.id}`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{service.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {service.duration} mins &middot; ${Number(service.price).toFixed(2)}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-4">
              <Button onClick={saveChanges} disabled={isPending || !hasChanges} data-testid="button-save-services">
                <Save className="w-4 h-4 mr-2" />
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
