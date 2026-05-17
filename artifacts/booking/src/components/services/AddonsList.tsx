import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAddons, useCreateAddon, useUpdateAddon, useDeleteAddon, useServiceAddonMappings, useSetAddonServices } from "@/hooks/use-addons";
import { useServices } from "@/hooks/use-services";
import { Plus, Pencil, Search, Save, X, MoreHorizontal, Upload, Camera } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertAddonSchema } from "@shared/schema";
import type { Addon, Service } from "@shared/schema";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AddonsList() {
  const { data: addons, isLoading } = useAddons();
  const { data: services } = useServices();
  const { data: mappings } = useServiceAddonMappings();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editAddonId, setEditAddonId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editedRows, setEditedRows] = useState<Record<number, Partial<Addon>>>({});
  const { mutate: updateAddon } = useUpdateAddon();
  const { mutate: deleteAddon } = useDeleteAddon();
  const { toast } = useToast();

  const addonServiceMap = useMemo(() => {
    const map: Record<number, number[]> = {};
    (mappings || []).forEach(m => {
      if (!map[m.addonId]) map[m.addonId] = [];
      map[m.addonId].push(m.serviceId);
    });
    return map;
  }, [mappings]);

  const filtered = (addons || []).filter((a: Addon) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFieldChange = (id: number, field: string, value: string | number) => {
    setEditedRows(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const saveAllChanges = () => {
    const entries = Object.entries(editedRows);
    if (entries.length === 0) {
      setEditMode(false);
      return;
    }

    let completed = 0;
    entries.forEach(([idStr, changes]) => {
      const id = Number(idStr);
      updateAddon({ id, ...changes } as any, {
        onSuccess: () => {
          completed++;
          if (completed === entries.length) {
            toast({ title: "All changes saved" });
            setEditedRows({});
            setEditMode(false);
          }
        },
        onError: () => {
          toast({ title: "Failed to save some changes", variant: "destructive" });
        },
      });
    });
  };

  const cancelEdit = () => {
    setEditedRows({});
    setEditMode(false);
  };

  const getFieldValue = (addon: Addon, field: keyof Addon) => {
    if (editedRows[addon.id] && field in editedRows[addon.id]!) {
      return (editedRows[addon.id] as any)[field];
    }
    return addon[field];
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search add-ons..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[220px]"
              data-testid="input-search-addons"
            />
          </div>
          <Button
            variant={editMode ? "default" : "outline"}
            onClick={() => editMode ? saveAllChanges() : setEditMode(true)}
            data-testid="button-addon-edit-mode"
          >
            {editMode ? (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save All
              </>
            ) : (
              <>
                <Pencil className="w-4 h-4 mr-2" />
                Edit Mode
              </>
            )}
          </Button>
          {editMode && (
            <Button variant="ghost" onClick={cancelEdit} data-testid="button-addon-cancel-edit">
              <X className="w-4 h-4" />
            </Button>
          )}
          <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <SheetTrigger asChild>
              <Button data-testid="button-add-addon">
                <Plus className="w-4 h-4 mr-2" />
                Add Add-On
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:w-[540px] !max-w-[540px] sm:max-w-[540px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Add New Add-On</SheetTitle>
              <SheetDescription>
                Create a new add-on service that can be attached to main services.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6">
              <AddonForm services={services || []} onSuccess={() => setIsCreateOpen(false)} />
            </div>
          </SheetContent>
          </Sheet>

          <Sheet open={editAddonId !== null} onOpenChange={(open) => !open && setEditAddonId(null)}>
            <SheetContent side="right" className="w-full sm:w-[540px] !max-w-[540px] sm:max-w-[540px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Edit Add-On</SheetTitle>
              <SheetDescription>
                Update the details of this add-on service.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6">
              {editAddonId && (
                  <AddonForm 
                    services={services || []} 
                    onSuccess={() => setEditAddonId(null)} 
                    initialData={addons?.find(a => a.id === editAddonId)}
                    initialServiceIds={addonServiceMap[editAddonId] || []}
                  />
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading add-ons...</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table data-testid="addons-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">ID</TableHead>
                <TableHead className="min-w-[180px]">Name</TableHead>
                <TableHead className="min-w-[180px]">Description</TableHead>
                <TableHead className="w-[90px]">Duration</TableHead>
                <TableHead className="text-right w-[90px]">Price</TableHead>
                <TableHead className="text-right w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    {searchQuery ? "No add-ons match your search." : "No add-ons added yet."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((addon: Addon) => {
                  return (
                    <TableRow
                      key={addon.id}
                      className="group"
                      data-testid={`row-addon-${addon.id}`}
                    >
                      <TableCell className="text-muted-foreground font-mono text-xs">{addon.id}</TableCell>
                      <TableCell>
                        <span className="font-medium" data-testid={`text-addon-name-${addon.id}`}>{addon.name}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground text-xs">{addon.description || "-"}</span>
                      </TableCell>
                      <TableCell>
                        {editMode ? (
                          <Input
                            type="number"
                            value={String(getFieldValue(addon, "duration"))}
                            onChange={(e) => handleFieldChange(addon.id, "duration", Number(e.target.value))}
                            className="h-8 w-20"
                            data-testid={`input-addon-duration-${addon.id}`}
                          />
                        ) : (
                          <span className="text-muted-foreground">{addon.duration} min</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {editMode ? (
                          <Input
                            type="number"
                            step="0.01"
                            value={String(getFieldValue(addon, "price"))}
                            onChange={(e) => handleFieldChange(addon.id, "price", e.target.value)}
                            className="h-8 w-24 ml-auto"
                            data-testid={`input-addon-price-${addon.id}`}
                          />
                        ) : (
                          <span className="font-semibold text-green-700">${Number(addon.price).toFixed(2)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0" data-testid={`button-actions-${addon.id}`}>
                              <span className="sr-only">Open menu</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => setEditAddonId(addon.id)} data-testid={`action-edit-${addon.id}`}>
                              Edit Details
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={() => {
                                if (confirm("Delete this add-on?")) deleteAddon(addon.id);
                              }} 
                              className="text-destructive"
                              data-testid={`action-delete-${addon.id}`}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <div className="bg-muted/50 border-t px-4 py-2 flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">{filtered.length} records</span>
            {editMode && Object.keys(editedRows).length > 0 && (
              <span className="text-xs text-primary font-medium">{Object.keys(editedRows).length} modified</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddonForm({ 
  services, 
  onSuccess, 
  initialData, 
  initialServiceIds = [] 
}: { 
  services: Service[]; 
  onSuccess: () => void; 
  initialData?: Addon;
  initialServiceIds?: number[];
}) {
  const { mutate: createAddon, isPending: isCreating } = useCreateAddon();
  const { mutate: updateAddon, isPending: isUpdating } = useUpdateAddon();
  const { mutate: setAddonServices, isPending: isMapping } = useSetAddonServices();
  const [selectedServiceIds, setSelectedServiceIds] = useState<number[]>(initialServiceIds);
  const { toast } = useToast();

  const isPending = isCreating || isUpdating || isMapping;

  const formSchema = insertAddonSchema.extend({
    duration: z.coerce.number().min(1, "Duration must be at least 1 minute"),
    price: z.coerce.number().min(0, "Price must be positive"),
    imageUrl: z.string().optional().nullable(),
  });

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: initialData ? {
      ...initialData,
      imageUrl: initialData.imageUrl || "",
      price: Number(initialData.price),
      duration: initialData.duration,
    } : {
      name: "",
      description: "",
      duration: 15,
      price: 0,
      imageUrl: "",
    },
  });

  const imageUrl = watch("imageUrl");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new window.FileReader();
    reader.onloadend = () => {
      setValue("imageUrl", reader.result as string);
    };
    reader.onerror = () => {
      toast({ title: "Failed to read image", variant: "destructive" });
    };
    reader.readAsDataURL(file);
  };

  const toggleService = (serviceId: number) => {
    setSelectedServiceIds(prev =>
      prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]
    );
  };

  const grouped = useMemo(() => {
    const groups: Record<string, Service[]> = {};
    services.forEach((s: Service) => {
      const cat = s.category || "Uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    });
    return groups;
  }, [services]);

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const submissionData = {
      ...data,
      price: String(data.price),
      imageUrl: data.imageUrl || null,
    };

    if (initialData) {
      updateAddon({ id: initialData.id, ...submissionData } as any, {
        onSuccess: () => {
          setAddonServices({ addonId: initialData.id, serviceIds: selectedServiceIds }, {
            onSuccess: () => {
              toast({ title: "Add-on updated successfully" });
              onSuccess();
            },
            onError: (error) => {
              console.error("Failed to update addon services:", error);
              toast({ title: "Add-on updated but failed to link services", variant: "destructive" });
              onSuccess();
            }
          });
        },
        onError: (error) => {
          console.error("Failed to update addon:", error);
          toast({ title: "Failed to update add-on", description: error.message, variant: "destructive" });
        }
      });
    } else {
      createAddon(submissionData as any, {
        onSuccess: (newAddon: any) => {
          if (selectedServiceIds.length > 0) {
            setAddonServices({ addonId: newAddon.id, serviceIds: selectedServiceIds }, {
              onSuccess: () => {
                toast({ title: "Add-on created successfully" });
                onSuccess();
              },
              onError: (error) => {
                console.error("Failed to set addon services:", error);
                toast({ title: "Add-on created but failed to link services", variant: "destructive" });
                onSuccess();
              }
            });
          } else {
            toast({ title: "Add-on created successfully" });
            onSuccess();
          }
        },
        onError: (error) => {
          console.error("Failed to create addon:", error);
          toast({ title: "Failed to create add-on", description: error.message, variant: "destructive" });
        }
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" {...register("name")} placeholder="e.g. Deep Conditioning" data-testid="input-addon-name" />
          {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Input id="description" {...register("description")} placeholder="Brief description..." data-testid="input-addon-desc" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="imageUrl">Image</Label>
          <div className="flex gap-4">
            <div className="relative shrink-0">
              {imageUrl ? (
                <img src={imageUrl} alt="Preview" className="w-16 h-16 rounded object-cover border" />
              ) : (
                <div className="w-16 h-16 rounded border bg-muted flex items-center justify-center">
                  <Camera className="w-6 h-6 text-muted-foreground" />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                id="addon-image-upload"
                onChange={handleFileChange}
              />
              <label
                htmlFor="addon-image-upload"
                className="absolute inset-0 cursor-pointer"
                title="Upload Image"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Input id="imageUrl" {...register("imageUrl")} placeholder="https://..." data-testid="input-addon-image-url" />
              <p className="text-xs text-muted-foreground">Or paste an image URL directly.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="duration">Duration (minutes)</Label>
            <Input id="duration" type="number" {...register("duration")} placeholder="15" data-testid="input-addon-duration" />
            {errors.duration && <span className="text-xs text-destructive">{errors.duration.message}</span>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="price">Price ($)</Label>
            <Input id="price" type="number" step="0.01" {...register("price")} placeholder="15.00" data-testid="input-addon-price" />
            {errors.price && <span className="text-xs text-destructive">{errors.price.message}</span>}
          </div>
        </div>
      </div>

      <div className="space-y-3 pt-2 border-t">
        <div className="flex items-center justify-between">
            <Label>Parent Services</Label>
            <span className="text-xs text-muted-foreground">Select which services this add-on can be added to.</span>
        </div>
        
        <div className="max-h-60 overflow-y-auto border rounded-md p-3 space-y-4">
          {Object.entries(grouped).map(([category, categoryServices]) => (
            <div key={category}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 sticky top-0 bg-background pb-1">{category}</p>
              <div className="grid grid-cols-1 gap-1">
                {categoryServices.map((service: Service) => (
                  <label key={service.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer text-sm">
                    <Checkbox
                      checked={selectedServiceIds.includes(service.id)}
                      onCheckedChange={() => toggleService(service.id)}
                    />
                    <span className="flex-1">{service.name}</span>
                    <span className="text-xs text-muted-foreground">${Number(service.price).toFixed(2)}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {services.length === 0 && (
             <p className="text-center text-muted-foreground py-4">No services available.</p>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-2 gap-2">
        <Button type="button" variant="outline" onClick={onSuccess}>Cancel</Button>
        <Button type="submit" disabled={isPending} data-testid="button-submit-addon">
          {isPending ? "Saving..." : (initialData ? "Save Changes" : "Create Add-On")}
        </Button>
      </div>
    </form>
  );
}
