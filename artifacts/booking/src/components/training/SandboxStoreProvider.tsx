/**
 * Phase 9.4 — wraps overlay content in a StoreContext that points at the
 * caller's practice sandbox instead of the live store. Components that read
 * `useSelectedStore()` (Calendar, NewBooking, ClientLookup, POS, etc.)
 * automatically operate on the sandbox without any code changes.
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Store } from "@shared/schema";
import { StoreContext } from "@/hooks/use-store";

interface SandboxResponse {
  store: Store;
}

export function SandboxStoreProvider({ children }: { children: ReactNode }) {
  const sandboxQuery = useQuery<SandboxResponse>({
    queryKey: ["/api/training/sandbox"],
    queryFn: async () => {
      const res = await fetch("/api/training/sandbox", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load practice store");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (sandboxQuery.isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Setting up your practice store…
      </div>
    );
  }

  if (sandboxQuery.error || !sandboxQuery.data?.store) {
    return (
      <div className="h-full w-full flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Couldn't load a practice store for your account. Make sure you're linked
        to a staff record on a store.
      </div>
    );
  }

  const sandboxStore = sandboxQuery.data.store;

  return (
    <StoreContext.Provider
      value={{
        selectedStore: sandboxStore,
        setSelectedStoreId: () => {
          // Inside practice mode, the store is fixed to the sandbox.
        },
        stores: [sandboxStore],
        isLoading: false,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}
