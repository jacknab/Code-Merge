import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertServiceSchema } from "@shared/schema";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCreateService, useUpdateService } from "@/hooks/use-services";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import { Camera } from "lucide-react";

type ServiceFormProps = {
  onSuccess: () => void;
  categories: any[];
  initialData?: any;
};

export function ServiceForm({ onSuccess, categories, initialData }: ServiceFormProps) {
  const { mutate: createService, isPending: isCreating } = useCreateService();
  const { mutate: updateService, isPending: isUpdating } = useUpdateService();
  const { toast } = useToast();

  const formSchema = insertServiceSchema.extend({
    duration: z.coerce.number().min(1, "Duration must be at least 1 minute"),
    price: z.coerce.number().min(0, "Price must be positive"),
    depositRequired: z.boolean().optional().default(false),
    depositAmount: z.coerce.number().min(0).optional().nullable(),
  });

  const { register, handleSubmit, formState: { errors }, setValue, watch, reset } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: initialData ? {
      name: initialData.name,
      category: initialData.category,
      duration: initialData.duration,
      price: initialData.price,
      description: initialData.description || "",
      imageUrl: initialData.imageUrl || null,
      depositRequired: initialData.depositRequired || false,
      depositAmount: initialData.depositAmount ? Number(initialData.depositAmount) : null,
    } : {
      depositRequired: false,
      depositAmount: null,
    }
  });

  const imageUrl = watch("imageUrl");
  const depositRequired = watch("depositRequired");

  useEffect(() => {
    if (initialData) {
      reset({
        name: initialData.name,
        category: initialData.category,
        duration: initialData.duration,
        price: initialData.price,
        description: initialData.description || "",
        imageUrl: initialData.imageUrl || null,
        depositRequired: initialData.depositRequired || false,
        depositAmount: initialData.depositAmount ? Number(initialData.depositAmount) : null,
      });
    }
  }, [initialData, reset]);

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

  const uniqueCategories = categories.length > 0
    ? categories.map((c: any) => c.name)
    : ["Hair", "Nails", "Face", "Massage"];

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const submissionData = {
      ...data,
      price: String(data.price),
      depositAmount: data.depositRequired && data.depositAmount != null ? String(data.depositAmount) : null,
    };

    if (initialData) {
      updateService({ id: initialData.id, ...submissionData } as any, {
        onSuccess: () => {
          toast({ title: "Service updated" });
          onSuccess();
        },
        onError: () => toast({ title: "Failed to update service", variant: "destructive" }),
      });
    } else {
      createService(submissionData as any, {
        onSuccess: () => {
          toast({ title: "Service created" });
          onSuccess();
        },
        onError: () => toast({ title: "Failed to create service", variant: "destructive" }),
      });
    }
  };

  const isPending = isCreating || isUpdating;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Service Name</Label>
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
              id="service-image-upload"
              onChange={handleFileChange}
            />
            <label
              htmlFor="service-image-upload"
              className="absolute inset-0 cursor-pointer"
              title="Upload Image"
            />
          </div>
          <div className="flex-1 space-y-2">
            <Input id="name" {...register("name")} placeholder="e.g. Women's Haircut" data-testid="input-service-name" />
            {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="category">Category</Label>
        <Select onValueChange={(val) => setValue("category", val)} defaultValue={initialData?.category}>
          <SelectTrigger data-testid="select-service-category">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {uniqueCategories.map((cat: string) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.category && <span className="text-xs text-destructive">{errors.category.message}</span>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="duration">Duration (min)</Label>
          <Input id="duration" type="number" {...register("duration")} placeholder="60" data-testid="input-service-duration" />
          {errors.duration && <span className="text-xs text-destructive">{errors.duration.message}</span>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="price">Price ($)</Label>
          <Input id="price" type="number" step="0.01" {...register("price")} placeholder="80.00" data-testid="input-service-price" />
          {errors.price && <span className="text-xs text-destructive">{errors.price.message}</span>}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input id="description" {...register("description")} placeholder="Brief description..." data-testid="input-service-desc" />
      </div>

      <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Require Deposit</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Clients must pay a deposit when booking online</p>
          </div>
          <Switch
            checked={depositRequired || false}
            onCheckedChange={(checked) => setValue("depositRequired", checked)}
            data-testid="switch-deposit-required"
          />
        </div>
        {depositRequired && (
          <div className="space-y-2">
            <Label htmlFor="depositAmount">Deposit Amount ($)</Label>
            <Input
              id="depositAmount"
              type="number"
              step="0.01"
              {...register("depositAmount")}
              placeholder="e.g. 25.00"
              data-testid="input-deposit-amount"
            />
            {errors.depositAmount && <span className="text-xs text-destructive">{errors.depositAmount.message}</span>}
          </div>
        )}
      </div>

      <div className="flex justify-end pt-4">
        <Button type="submit" disabled={isPending} data-testid="button-submit-service">
          {isPending ? (initialData ? "Updating..." : "Creating...") : (initialData ? "Update Service" : "Create Service")}
        </Button>
      </div>
    </form>
  );
}
