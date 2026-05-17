import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { Addon, InsertAddon, ServiceAddon } from "@shared/schema";
import { useSelectedStore } from "@/hooks/use-store";

export function useReorderServiceCategories() {
  const { selectedStore } = useSelectedStore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: number[]) => {
      if (!selectedStore?.id) throw new Error("No store selected");
      const res = await fetch("/api/service-categories/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds, storeId: selectedStore.id }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to reorder categories");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.serviceCategories.list.path, selectedStore?.id] });
    },
  });
}

export function useAddons() {
  const { selectedStore } = useSelectedStore();
  const storeId = selectedStore?.id;

  return useQuery({
    queryKey: [api.addons.list.path, storeId],
    queryFn: async () => {
      const url = storeId
        ? `${api.addons.list.path}?storeId=${storeId}`
        : api.addons.list.path;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch addons");
      return res.json() as Promise<Addon[]>;
    },
    enabled: !!storeId,
  });
}

export function useAddonsForService(serviceId: number | null) {
  return useQuery({
    queryKey: [api.serviceAddons.forService.path, serviceId],
    queryFn: async () => {
      const url = buildUrl(api.serviceAddons.forService.path, { id: serviceId! });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch service addons");
      return res.json() as Promise<Addon[]>;
    },
    enabled: !!serviceId,
  });
}

export function useSetAppointmentAddons() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ appointmentId, addonIds }: { appointmentId: number; addonIds: number[] }) => {
      const url = buildUrl(api.appointmentAddons.set.path, { id: appointmentId });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addonIds }),
        credentials: "include",
      });
      if (res.status === 409) {
        const error = await res.json();
        throw new Error(error.message);
      }
      if (!res.ok) throw new Error("Failed to set appointment addons");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.appointments.list.path] });
    },
  });
}

export function useCreateAddon() {
  const queryClient = useQueryClient();
  const { selectedStore } = useSelectedStore();

  return useMutation({
    mutationFn: async (data: InsertAddon) => {
      const payload = { ...data, storeId: selectedStore?.id ?? null };
      const res = await fetch(api.addons.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create addon");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.addons.list.path, selectedStore?.id] }),
  });
}

export function useUpdateAddon() {
  const queryClient = useQueryClient();
  const { selectedStore } = useSelectedStore();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertAddon>) => {
      const url = buildUrl(api.addons.update.path, { id });
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update addon");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.addons.list.path, selectedStore?.id] }),
  });
}

export function useDeleteAddon() {
  const queryClient = useQueryClient();
  const { selectedStore } = useSelectedStore();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.addons.delete.path, { id });
      const res = await fetch(url, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete addon");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.addons.list.path, selectedStore?.id] }),
  });
}

export function useServiceAddonMappings() {
  return useQuery({
    queryKey: ["/api/service-addon-mappings"],
    queryFn: async () => {
      const res = await fetch("/api/service-addon-mappings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch mappings");
      return res.json() as Promise<ServiceAddon[]>;
    },
  });
}

export function useSetAddonServices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ addonId, serviceIds }: { addonId: number; serviceIds: number[] }) => {
      const res = await fetch(`/api/addons/${addonId}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceIds }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update addon services");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-addon-mappings"] });
    },
  });
}

export function useServiceCategories() {
  const { selectedStore } = useSelectedStore();
  const storeId = selectedStore?.id;

  return useQuery({
    queryKey: [api.serviceCategories.list.path, storeId],
    queryFn: async () => {
      const url = storeId
        ? `${api.serviceCategories.list.path}?storeId=${storeId}`
        : api.serviceCategories.list.path;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch categories");
      return res.json();
    },
    enabled: !!storeId,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  const { selectedStore } = useSelectedStore();
  const storeId = selectedStore?.id;

  return useMutation({
    mutationFn: async (data: { name: string; imageUrl?: string | null | undefined }) => {
      if (!storeId) throw new Error("No store selected");
      const payload = { ...data, storeId };
      const res = await fetch(api.serviceCategories.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create category");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.serviceCategories.list.path, storeId] }),
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  const { selectedStore } = useSelectedStore();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number; name?: string; imageUrl?: string | null | undefined }) => {
      const url = buildUrl(api.serviceCategories.update.path, { id });
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update category");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.serviceCategories.list.path, selectedStore?.id] });
      queryClient.invalidateQueries({ queryKey: [api.services.list.path, selectedStore?.id] });
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  const { selectedStore } = useSelectedStore();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.serviceCategories.delete.path, { id });
      const res = await fetch(url, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete category");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.serviceCategories.list.path, selectedStore?.id] });
      queryClient.invalidateQueries({ queryKey: [api.services.list.path, selectedStore?.id] });
    },
  });
}
