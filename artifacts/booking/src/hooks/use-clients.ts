import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSelectedStore } from "@/hooks/use-store";

const BASE = "/api/clients";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClientTag {
  id: number;
  tagName: string;
  tagColor: string;
  count?: number;
}

export interface ClientListItem {
  id: number;
  storeId: number;
  firstName: string;
  lastName: string;
  fullName: string;
  preferredName: string | null;
  clientStatus: string;
  source: string | null;
  totalVisits: number;
  totalSpentCents: number;
  lastVisitAt: string | null;
  nextAppointmentAt: string | null;
  createdAt: string;
  updatedAt: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  tags: ClientTag[];
}

export interface ClientListResponse {
  clients: ClientListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ClientNote {
  id: number;
  clientId: number;
  storeId: number;
  noteType: string;
  visibility: string;
  noteContent: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientPhone {
  id: number;
  clientId: number;
  phoneNumberE164: string;
  displayPhone: string;
  phoneType: string;
  smsOptIn: boolean;
  isPrimary: boolean;
}

export interface ClientEmail {
  id: number;
  clientId: number;
  emailAddress: string;
  isPrimary: boolean;
  marketingOptIn: boolean;
}

export interface ClientAddress {
  id: number;
  clientId: number;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  addressType: string;
}

export interface ClientMarketingPreferences {
  smsMarketingOptIn: boolean;
  emailMarketingOptIn: boolean;
  promotionalNotifications: boolean;
  appointmentReminders: boolean;
  reviewRequests: boolean;
}

export interface ClientDetail extends Omit<ClientListItem, "tags"> {
  dateOfBirth: string | null;
  gender: string | null;
  referralSource: string | null;
  avatarUrl: string | null;
  emails: ClientEmail[];
  phones: ClientPhone[];
  addresses: ClientAddress[];
  notes: ClientNote[];
  tags: Array<{ tagId: number; tag: ClientTag }>;
  marketingPreferences: ClientMarketingPreferences | null;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

const QK = {
  list: (storeId: number, params?: object) => [BASE, "list", storeId, params],
  detail: (id: number) => [BASE, "detail", id],
  tags: (storeId: number) => [BASE, "tags", storeId],
  notes: (clientId: number) => [BASE, "notes", clientId],
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useClients(params?: {
  search?: string;
  tag?: string;
  status?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: string;
}) {
  const { selectedStore } = useSelectedStore();
  const storeId = selectedStore?.id;

  return useQuery<ClientListResponse>({
    queryKey: QK.list(storeId!, params),
    queryFn: async () => {
      const qs = new URLSearchParams({ storeId: String(storeId) });
      if (params?.search) qs.set("search", params.search);
      if (params?.tag) qs.set("tag", params.tag);
      if (params?.status) qs.set("status", params.status);
      if (params?.page) qs.set("page", String(params.page));
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.sort) qs.set("sort", params.sort);
      if (params?.order) qs.set("order", params.order);
      const res = await fetch(`${BASE}?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch clients");
      return res.json();
    },
    enabled: !!storeId,
  });
}

export function useClientDetail(clientId: number | null) {
  return useQuery<ClientDetail>({
    queryKey: QK.detail(clientId!),
    queryFn: async () => {
      const res = await fetch(`${BASE}/${clientId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch client");
      return res.json();
    },
    enabled: !!clientId,
  });
}

export function useClientTags() {
  const { selectedStore } = useSelectedStore();
  const storeId = selectedStore?.id;

  return useQuery<ClientTag[]>({
    queryKey: QK.tags(storeId!),
    queryFn: async () => {
      const res = await fetch(`${BASE}/tags/list?storeId=${storeId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tags");
      return res.json();
    },
    enabled: !!storeId,
  });
}

export function useClientNotes(clientId: number | null) {
  return useQuery<ClientNote[]>({
    queryKey: QK.notes(clientId!),
    queryFn: async () => {
      const res = await fetch(`${BASE}/${clientId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notes");
      return res.json();
    },
    enabled: !!clientId,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  const { selectedStore } = useSelectedStore();

  return useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, storeId: selectedStore?.id }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to create client");
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [BASE] }),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number; [k: string]: any }) => {
      const res = await fetch(`${BASE}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update client");
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [BASE] });
      qc.invalidateQueries({ queryKey: QK.detail(vars.id) });
    },
  });
}

export function useArchiveClient() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: number) => {
      const res = await fetch(`${BASE}/${clientId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to archive client");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [BASE] }),
  });
}

export function useCreateClientNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, ...data }: { clientId: number; storeId: number; noteContent: string; noteType?: string; pinned?: boolean }) => {
      const res = await fetch(`${BASE}/${clientId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create note");
      return res.json();
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: QK.notes(vars.clientId) }),
  });
}

export function useDeleteClientNote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, noteId }: { clientId: number; noteId: number }) => {
      const res = await fetch(`${BASE}/${clientId}/notes/${noteId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete note");
      return res.json();
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: QK.notes(vars.clientId) }),
  });
}

export function useCreateClientTag() {
  const qc = useQueryClient();
  const { selectedStore } = useSelectedStore();

  return useMutation({
    mutationFn: async (data: { tagName: string; tagColor?: string }) => {
      const res = await fetch(`${BASE}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, storeId: selectedStore?.id }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create tag");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [BASE, "tags"] }),
  });
}

export function useAddTagToClient() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, tagId }: { clientId: number; tagId: number }) => {
      const res = await fetch(`${BASE}/${clientId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to add tag");
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [BASE] });
      qc.invalidateQueries({ queryKey: QK.detail(vars.clientId) });
    },
  });
}

export function useRemoveTagFromClient() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, tagId }: { clientId: number; tagId: number }) => {
      const res = await fetch(`${BASE}/${clientId}/tags/${tagId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to remove tag");
      return res.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [BASE] });
      qc.invalidateQueries({ queryKey: QK.detail(vars.clientId) });
    },
  });
}

export function useMigrateFromCustomers() {
  const qc = useQueryClient();
  const { selectedStore } = useSelectedStore();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/migrate-from-customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStore?.id }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Migration failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [BASE] }),
  });
}
