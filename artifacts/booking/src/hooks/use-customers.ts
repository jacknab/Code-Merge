import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { Customer, InsertCustomer } from "@shared/schema";
import { useSelectedStore } from "@/hooks/use-store";

export function useCustomers() {
  const { selectedStore } = useSelectedStore();
  const storeId = selectedStore?.id;

  return useQuery<Customer[]>({
    queryKey: [api.customers.list.path, storeId],
    queryFn: async () => {
      const url = storeId
        ? `${api.customers.list.path}?storeId=${storeId}`
        : api.customers.list.path;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch customers");
      return res.json() as Promise<Customer[]>;
    },
    enabled: !!storeId,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  const { selectedStore } = useSelectedStore();

  return useMutation({
    mutationFn: async (data: InsertCustomer) => {
      const payload = { ...data, storeId: selectedStore?.id ?? null };
      const res = await fetch(api.customers.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create customer");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.customers.list.path] }),
  });
}
