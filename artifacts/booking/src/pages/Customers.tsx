import { useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClients, useCreateClient, useClientTags, useMigrateFromCustomers, type ClientListItem } from "@/hooks/use-clients";
import { useSelectedStore } from "@/hooks/use-store";
import { Link } from "react-router-dom";
import {
  Plus, Search, Download, Upload, Filter, Tag, Users,
  Phone, Mail, MoreHorizontal, TrendingUp, ArrowUpDown,
  RefreshCw, Loader2, ChevronLeft, ChevronRight,
} from "lucide-react";
import { ExportDialog } from "@/components/clients/ExportDialog";
import { ImportDialog } from "@/components/clients/ImportDialog";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import debounce from "lodash.debounce";

const SORT_OPTIONS = [
  { value: "fullName", label: "Name A–Z" },
  { value: "fullName-desc", label: "Name Z–A" },
  { value: "lastVisitAt-desc", label: "Last Visit (recent)" },
  { value: "totalSpent-desc", label: "Highest spend" },
  { value: "totalVisits-desc", label: "Most visits" },
  { value: "createdAt-desc", label: "Newest clients" },
];

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "vip", label: "VIP" },
  { value: "inactive", label: "Inactive" },
];

export default function Customers() {
  const { selectedStore } = useSelectedStore();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedTag, setSelectedTag] = useState("all");
  const [sort, setSort] = useState("fullName");
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const { mutate: migrateFromCustomers, isPending: isMigrating } = useMigrateFromCustomers();

  const [sortField, sortOrder] = sort.includes("-desc")
    ? [sort.replace("-desc", ""), "desc"]
    : [sort, "asc"];

  const debouncedSetSearch = useCallback(
    debounce((val: string) => { setDebouncedSearch(val); setPage(1); }, 350),
    []
  );

  function handleSearchChange(val: string) {
    setSearch(val);
    debouncedSetSearch(val);
  }

  const { data, isLoading } = useClients({
    search: debouncedSearch || undefined,
    status: status !== "all" ? status : undefined,
    tag: selectedTag !== "all" ? selectedTag : undefined,
    sort: sortField,
    order: sortOrder as "asc" | "desc",
    page,
    limit: LIMIT,
  });

  const { data: tags = [] } = useClientTags();

  const clients = data?.clients ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  function handleMigrate() {
    migrateFromCustomers(undefined, {
      onSuccess: (res: any) => {
        toast({ title: "Migration complete", description: `${res.migrated} clients migrated from existing records.` });
      },
    });
  }

  return (
    <AppLayout>
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Clients</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {total > 0 ? `${total.toLocaleString()} total clients` : "Manage your client database"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}>
            <Upload className="w-4 h-4 mr-1.5" />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsExportOpen(true)}>
            <Download className="w-4 h-4 mr-1.5" />
            Export
          </Button>
          <Button size="sm" onClick={() => setIsCreateOpen(true)} className="bg-primary hover:bg-primary/90 text-white shadow-sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Add Client
          </Button>
        </div>
      </div>

      {/* ── Migration banner (if no clients yet) ── */}
      {total === 0 && !isLoading && (
        <div className="mb-4 p-4 rounded-xl border bg-amber-50 border-amber-200 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-sm text-amber-900">Import your existing contacts</p>
            <p className="text-xs text-amber-700 mt-0.5">Migrate your booking history contacts into the new client database.</p>
          </div>
          <Button size="sm" variant="outline" onClick={handleMigrate} disabled={isMigrating} className="border-amber-300 bg-white text-amber-900 hover:bg-amber-50 shrink-0">
            {isMigrating ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
            Sync contacts
          </Button>
        </div>
      )}

      {/* ── Filters bar ── */}
      <div className="bg-card rounded-2xl border shadow-sm overflow-hidden mb-4">
        <div className="p-3 flex flex-col sm:flex-row gap-2 border-b">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, or phone..."
              className="pl-9 h-9 text-sm"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="h-9 w-auto text-sm gap-1.5">
                <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-sm">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {tags.length > 0 && (
              <Button
                variant={showFilters ? "secondary" : "outline"}
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="w-3.5 h-3.5" />
                {selectedTag !== "all" ? "1 filter" : "Filter"}
              </Button>
            )}
          </div>
        </div>

        {/* Tag filter row */}
        {showFilters && tags.length > 0 && (
          <div className="px-4 py-3 border-b bg-muted/30 flex flex-wrap gap-2 items-center">
            <Tag className="w-3.5 h-3.5 text-muted-foreground" />
            <button
              onClick={() => setSelectedTag("all")}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedTag === "all" ? "bg-primary text-white border-primary" : "border-border hover:bg-muted/50"}`}
            >
              All tags
            </button>
            {tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => setSelectedTag(selectedTag === tag.tagName ? "all" : tag.tagName)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1 ${
                  selectedTag === tag.tagName ? "text-white border-transparent" : "border-border hover:bg-muted/50"
                }`}
                style={selectedTag === tag.tagName ? { backgroundColor: tag.tagColor, borderColor: tag.tagColor } : {}}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: selectedTag === tag.tagName ? "white" : tag.tagColor }} />
                {tag.tagName}
                {tag.count !== undefined && (
                  <span className={`${selectedTag === tag.tagName ? "opacity-75" : "text-muted-foreground"}`}>({tag.count})</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Status tabs */}
        <div className="px-4 pt-3 pb-0">
          <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <TabsList className="bg-transparent h-auto p-0 gap-0 border-b-0">
              {STATUS_TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 pb-3 text-sm font-medium"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* ── Mobile card list ── */}
        <div className="md:hidden divide-y">
          {isLoading ? (
            <div className="p-8 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : clients.length === 0 ? (
            <EmptyState search={debouncedSearch} onAdd={() => setIsCreateOpen(true)} />
          ) : (
            clients.map((client) => <ClientCard key={client.id} client={client} />)
          )}
        </div>

        {/* ── Desktop table ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Contact</th>
                <th className="px-5 py-3 font-medium">Tags</th>
                <th className="px-5 py-3 font-medium">Visits</th>
                <th className="px-5 py-3 font-medium">Lifetime Spend</th>
                <th className="px-5 py-3 font-medium">Last Visit</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState search={debouncedSearch} onAdd={() => setIsCreateOpen(true)} />
                  </td>
                </tr>
              ) : (
                clients.map((client) => (
                  <tr key={client.id} className="hover:bg-muted/20 transition-colors group">
                    <td className="px-5 py-3">
                      <Link to={`/clients/${client.id}`} className="flex items-center gap-3">
                        <ClientAvatar name={client.fullName} status={client.clientStatus} />
                        <div>
                          <p className="font-semibold text-sm group-hover:text-primary transition-colors">{client.fullName || "No name"}</p>
                          {client.clientStatus === "vip" && (
                            <span className="text-xs text-amber-600 font-medium">⭐ VIP</span>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <div className="space-y-0.5">
                        {client.primaryEmail && (
                          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                            <Mail className="w-3 h-3 shrink-0" />
                            <span className="truncate max-w-[160px]">{client.primaryEmail}</span>
                          </div>
                        )}
                        {client.primaryPhone && (
                          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                            <Phone className="w-3 h-3 shrink-0" />
                            <span>{client.primaryPhone}</span>
                          </div>
                        )}
                        {!client.primaryEmail && !client.primaryPhone && (
                          <span className="text-xs text-muted-foreground/60">No contact info</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(client.tags ?? []).slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                            style={{ backgroundColor: tag.tagColor }}
                          >
                            {tag.tagName}
                          </span>
                        ))}
                        {(client.tags ?? []).length > 3 && (
                          <span className="text-xs text-muted-foreground">+{client.tags.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      <span className="font-medium text-foreground">{client.totalVisits}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-medium">
                        ${((client.totalSpentCents ?? 0) / 100).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground text-xs">
                      {client.lastVisitAt
                        ? formatDistanceToNow(new Date(client.lastVisitAt), { addSuffix: true })
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t text-sm text-muted-foreground">
            <span>
              {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-8 w-8 p-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="px-2">{page} / {totalPages}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="h-8 w-8 p-0"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Dialogs ── */}
      <CreateClientDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
      <ExportDialog open={isExportOpen} onOpenChange={setIsExportOpen} />
      <ImportDialog open={isImportOpen} onOpenChange={setIsImportOpen} />
    </AppLayout>
  );
}

// ─── Client Avatar ────────────────────────────────────────────────────────────

function ClientAvatar({ name, status }: { name: string; status: string }) {
  const initials = name
    ? name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";
  const isVip = status === "vip";
  return (
    <div
      className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
        isVip ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary"
      }`}
    >
      {initials}
    </div>
  );
}

// ─── Mobile Client Card ───────────────────────────────────────────────────────

function ClientCard({ client }: { client: ClientListItem }) {
  return (
    <Link
      to={`/clients/${client.id}`}
      className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors"
    >
      <ClientAvatar name={client.fullName} status={client.clientStatus} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">{client.fullName || "No name"}</p>
        <p className="text-xs text-muted-foreground truncate">
          {client.primaryEmail || client.primaryPhone || "No contact info"}
        </p>
        {(client.tags ?? []).length > 0 && (
          <div className="flex gap-1 mt-1">
            {client.tags.slice(0, 2).map((tag) => (
              <span
                key={tag.id}
                className="text-xs px-1.5 py-0.5 rounded-full text-white"
                style={{ backgroundColor: tag.tagColor }}
              >
                {tag.tagName}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="text-right text-xs text-muted-foreground shrink-0">
        <p className="font-medium text-foreground">{client.totalVisits} visits</p>
        {client.lastVisitAt && (
          <p>{formatDistanceToNow(new Date(client.lastVisitAt), { addSuffix: true })}</p>
        )}
      </div>
    </Link>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ search, onAdd }: { search: string; onAdd: () => void }) {
  return (
    <div className="p-12 text-center space-y-3">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
        <Users className="w-6 h-6 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold text-sm">
          {search ? `No clients match "${search}"` : "No clients yet"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {search ? "Try a different search." : "Add your first client or import a list to get started."}
        </p>
      </div>
      {!search && (
        <Button size="sm" onClick={onAdd} className="bg-primary text-white hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-1.5" />
          Add first client
        </Button>
      )}
    </div>
  );
}

// ─── Create Client Dialog ─────────────────────────────────────────────────────

function CreateClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { mutate, isPending } = useCreateClient();
  const { toast } = useToast();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    notes: string;
    allergies: string;
  }>();

  function onSubmit(data: any) {
    mutate(data, {
      onSuccess: () => {
        toast({ title: "Client added" });
        reset();
        onOpenChange(false);
      },
      onError: (err: any) => {
        toast({ title: "Failed to add client", description: err.message, variant: "destructive" });
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Client</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input {...register("firstName")} placeholder="Jane" />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input {...register("lastName")} placeholder="Doe" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" {...register("email")} placeholder="jane@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input {...register("phone")} placeholder="(555) 123-4567" />
          </div>
          <div className="space-y-1.5">
            <Label>Allergies / Sensitivities</Label>
            <Input {...register("allergies")} placeholder="e.g. Latex, Ammonia, Perm solution..." />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input {...register("notes")} placeholder="Preferences, special requests..." />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending} className="bg-primary text-white hover:bg-primary/90">
              {isPending ? "Adding..." : "Add Client"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
