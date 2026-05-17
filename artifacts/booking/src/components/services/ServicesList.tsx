import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { useServices, useUpdateService, useDeleteService } from "@/hooks/use-services";
import { useServiceCategories } from "@/hooks/use-addons";
import { Plus, Pencil, Search, Save, X, Trash2, MoreHorizontal } from "lucide-react";
import { ServiceForm } from "./ServiceForm";
import type { Service } from "@shared/schema";
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

export function ServicesList() {
  const { data: services, isLoading } = useServices();
  const { data: categories = [] } = useServiceCategories();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editServiceId, setEditServiceId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editedRows, setEditedRows] = useState<Record<number, Partial<Service>>>({});
  const { mutate: updateService } = useUpdateService();
  const { mutate: deleteService } = useDeleteService();
  const { toast } = useToast();

  const filtered = (services || []).filter((s: Service) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.category.toLowerCase().includes(searchQuery.toLowerCase())
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
      updateService({ id, ...changes } as any, {
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

  const getFieldValue = (service: Service, field: keyof Service) => {
    if (editedRows[service.id] && field in editedRows[service.id]!) {
      return (editedRows[service.id] as any)[field];
    }
    return service[field];
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this service?")) {
      deleteService(id, {
        onSuccess: () => toast({ title: "Service deleted" }),
        onError: () => toast({ title: "Failed to delete service", variant: "destructive" }),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search services..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[220px]"
              data-testid="input-search-services"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={editMode ? "default" : "outline"}
            onClick={() => editMode ? saveAllChanges() : setEditMode(true)}
            data-testid="button-edit-mode"
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
            <Button variant="ghost" onClick={cancelEdit} data-testid="button-cancel-edit">
              <X className="w-4 h-4" />
            </Button>
          )}
          
          <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <SheetTrigger asChild>
              <Button data-testid="button-add-service">
                <Plus className="w-4 h-4 mr-2" />
                Add Service
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:w-[540px] !max-w-[540px] sm:max-w-[540px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Add New Service</SheetTitle>
              </SheetHeader>
              <div className="mt-6">
                <ServiceForm onSuccess={() => setIsCreateOpen(false)} categories={categories} />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={editServiceId !== null} onOpenChange={(open) => !open && setEditServiceId(null)}>
            <SheetContent side="right" className="w-full sm:w-[540px] !max-w-[540px] sm:max-w-[540px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Edit Service</SheetTitle>
                <SheetDescription>
                  Edit the details of this service.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6">
                {editServiceId && (
                  <ServiceForm 
                    onSuccess={() => setEditServiceId(null)} 
                    categories={categories}
                    initialData={services?.find((s: Service) => s.id === editServiceId)} 
                  />
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading services...</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table data-testid="services-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">ID</TableHead>
                <TableHead className="min-w-[200px]">Name</TableHead>
                <TableHead className="min-w-[140px]">Category</TableHead>
                <TableHead className="w-[100px]">Duration</TableHead>
                <TableHead className="text-right w-[100px]">Price</TableHead>
                <TableHead className="text-right w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    {searchQuery ? "No services match your search." : "No services added yet."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((service: Service) => (
                  <TableRow
                    key={service.id}
                    className="group"
                    data-testid={`row-service-${service.id}`}
                  >
                    <TableCell className="font-mono text-xs">{service.id}</TableCell>
                    <TableCell>
                      <span className="font-medium" data-testid={`text-service-name-${service.id}`}>{service.name}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize" data-testid={`badge-service-category-${service.id}`}>
                        {service.category}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {editMode ? (
                        <Input
                          type="number"
                          value={String(getFieldValue(service, "duration"))}
                          onChange={(e) => handleFieldChange(service.id, "duration", Number(e.target.value))}
                          className="h-8 w-20"
                          data-testid={`input-service-duration-${service.id}`}
                        />
                      ) : (
                        <span data-testid={`text-service-duration-${service.id}`}>{service.duration} min</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editMode ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={String(getFieldValue(service, "price"))}
                          onChange={(e) => handleFieldChange(service.id, "price", e.target.value)}
                          className="h-8 w-24 ml-auto"
                          data-testid={`input-service-price-${service.id}`}
                        />
                      ) : (
                        <span className="font-semibold text-green-700" data-testid={`text-service-price-${service.id}`}>
                          ${Number(service.price).toFixed(2)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0" data-testid={`button-actions-${service.id}`}>
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => setEditServiceId(service.id)} data-testid={`action-edit-${service.id}`}>
                            Edit Details
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleDelete(service.id)} className="text-destructive" data-testid={`action-delete-${service.id}`}>
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
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
