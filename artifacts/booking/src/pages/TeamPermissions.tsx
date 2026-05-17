import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PERMISSIONS, ROLE_DEFAULTS, normalizeRole, type Permission, type Role } from "@shared/permissions";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface TeamMember {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  staffId: number | null;
  permissions: Record<string, boolean> | null;
  isOwner: boolean;
  kind?: "user" | "staff";
}

interface TeamResponse {
  members: TeamMember[];
  staff: { id: number; name: string; email: string | null; storeId: number }[];
}

const PERM_GROUPS: { label: string; perms: { key: Permission; label: string; help?: string }[] }[] = [
  {
    label: "Calendar & appointments",
    perms: [
      { key: PERMISSIONS.APPOINTMENTS_VIEW_ALL, label: "View all appointments", help: "See appointments for everyone, not just their own" },
      { key: PERMISSIONS.APPOINTMENTS_VIEW_OWN, label: "View own appointments" },
      { key: PERMISSIONS.APPOINTMENTS_EDIT, label: "Edit appointments" },
      { key: PERMISSIONS.APPOINTMENTS_CANCEL, label: "Cancel appointments" },
      { key: PERMISSIONS.APPOINTMENTS_DELETE, label: "Delete appointments" },
      { key: PERMISSIONS.APPOINTMENTS_OVERRIDE_RULES, label: "Override booking rules", help: "Book outside business hours or past blocked slots" },
      { key: PERMISSIONS.WAITLIST_ACCESS, label: "Access waitlist" },
    ],
  },
  {
    label: "Clients",
    perms: [
      { key: PERMISSIONS.CUSTOMERS_VIEW, label: "View clients" },
      { key: PERMISSIONS.CUSTOMERS_VIEW_CONTACT, label: "View contact info (phone/email)" },
      { key: PERMISSIONS.CUSTOMERS_EDIT, label: "Edit clients" },
      { key: PERMISSIONS.CUSTOMERS_DELETE, label: "Delete clients" },
      { key: PERMISSIONS.CUSTOMERS_EXPORT, label: "Export client list" },
      { key: PERMISSIONS.CUSTOMERS_IMPORT, label: "Import clients" },
    ],
  },
  {
    label: "Payments & checkout",
    perms: [
      { key: PERMISSIONS.POS_USE, label: "Use POS" },
      { key: PERMISSIONS.CHECKOUT_CLIENTS, label: "Check out clients" },
      { key: PERMISSIONS.PAYMENTS_VIEW, label: "View payment history" },
      { key: PERMISSIONS.DISCOUNTS_APPLY, label: "Apply discounts" },
      { key: PERMISSIONS.REFUNDS_ISSUE, label: "Issue refunds", help: "Tightly controlled — grant with care" },
      { key: PERMISSIONS.VOID_TRANSACTIONS, label: "Void transactions", help: "Owner/manager only by default" },
      { key: PERMISSIONS.CASH_DRAWER_VIEW, label: "View cash drawer" },
      { key: PERMISSIONS.CASH_DRAWER_CLOSE, label: "Close cash drawer" },
    ],
  },
  {
    label: "Catalog & inventory",
    perms: [
      { key: PERMISSIONS.SERVICES_MANAGE, label: "Manage services" },
      { key: PERMISSIONS.PRODUCTS_MANAGE, label: "Manage retail products" },
      { key: PERMISSIONS.PRICING_VIEW, label: "View pricing" },
      { key: PERMISSIONS.PRICING_EDIT, label: "Edit pricing" },
      { key: PERMISSIONS.INVENTORY_MANAGE, label: "Manage inventory & stock" },
    ],
  },
  {
    label: "Reports & commissions",
    perms: [
      { key: PERMISSIONS.REPORTS_VIEW, label: "View reports" },
      { key: PERMISSIONS.REPORTS_FINANCIAL, label: "View financial reports" },
      { key: PERMISSIONS.REPORTS_EXPORT, label: "Export reports" },
      { key: PERMISSIONS.COMMISSIONS_VIEW_ALL, label: "View all commissions" },
      { key: PERMISSIONS.COMMISSIONS_VIEW_OWN, label: "View own commissions" },
    ],
  },
  {
    label: "Marketing",
    perms: [
      { key: PERMISSIONS.MARKETING_SMS, label: "Send SMS campaigns" },
      { key: PERMISSIONS.MARKETING_EMAIL, label: "Send email campaigns" },
      { key: PERMISSIONS.REVIEW_REQUESTS, label: "Send review requests" },
    ],
  },
  {
    label: "Engagement features",
    perms: [
      { key: PERMISSIONS.GIFT_CARDS_MANAGE, label: "Manage gift cards" },
      { key: PERMISSIONS.LOYALTY_MANAGE, label: "Manage loyalty program" },
      { key: PERMISSIONS.INTAKE_FORMS_MANAGE, label: "Manage intake forms" },
    ],
  },
  {
    label: "Team & settings",
    perms: [
      { key: PERMISSIONS.STAFF_MANAGE, label: "Manage team members" },
      { key: PERMISSIONS.STAFF_INVITE, label: "Invite team members" },
      { key: PERMISSIONS.STAFF_REMOVE, label: "Remove team members" },
      { key: PERMISSIONS.STAFF_PERMISSIONS_MANAGE, label: "Edit team permissions", help: "Owner only by default" },
      { key: PERMISSIONS.STORE_SETTINGS, label: "Edit store settings" },
      { key: PERMISSIONS.INTEGRATIONS_MANAGE, label: "Manage integrations" },
      { key: PERMISSIONS.BILLING_MANAGE, label: "Manage billing & subscription", help: "Owner only by default" },
      { key: PERMISSIONS.STORE_DELETE, label: "Delete stores", help: "Owner only by default" },
    ],
  },
];

function effectivePerms(role: string | null, overrides: Record<string, boolean> | null | undefined): Set<string> {
  const r = normalizeRole(role);
  const set = new Set<string>(ROLE_DEFAULTS[r]);
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v) set.add(k);
      else set.delete(k);
    }
  }
  return set;
}

export default function TeamPermissions() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<TeamResponse>({
    queryKey: ["/api/team"],
    queryFn: async () => {
      const res = await fetch("/api/team", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load team");
      return res.json();
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: Role }) => {
      const res = await apiRequest("PATCH", `/api/team/${userId}/role`, { role });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/team"] });
      toast({ title: "Role updated" });
    },
    onError: (e: any) => toast({ title: "Failed to update role", description: e?.message, variant: "destructive" }),
  });

  const updatePerms = useMutation({
    mutationFn: async ({ userId, permissions }: { userId: string; permissions: Record<string, boolean> }) => {
      const res = await apiRequest("PATCH", `/api/team/${userId}/permissions`, { permissions });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/team"] });
      toast({ title: "Permissions updated" });
    },
    onError: (e: any) => toast({ title: "Failed to update permissions", description: e?.message, variant: "destructive" }),
  });

  const members = data?.members ?? [];
  const selected = members.find((m) => m.id === selectedId) ?? members.find((m) => !m.isOwner) ?? members[0];

  const togglePerm = (perm: Permission, granted: boolean) => {
    if (!selected || selected.isOwner) return;
    const role = normalizeRole(selected.role);
    const defaultGranted = ROLE_DEFAULTS[role].has(perm);
    const current = { ...(selected.permissions ?? {}) };
    if (granted === defaultGranted) {
      delete current[perm];
    } else {
      current[perm] = granted;
    }
    updatePerms.mutate({ userId: selected.id, permissions: current });
  };

  const resetToDefaults = () => {
    if (!selected || selected.isOwner) return;
    updatePerms.mutate({ userId: selected.id, permissions: {} });
  };

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading team…</div>;
  }

  const effective = selected ? effectivePerms(selected.role, selected.permissions) : new Set<string>();

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Team Permissions</h1>
        <p className="text-muted-foreground text-sm">
          Control what each member of your team can see and do. Owners always have full access.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team members</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <div className="space-y-1">
              {members.map((m) => {
                const role = normalizeRole(m.role);
                const isSel = selected?.id === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition ${
                      isSel ? "bg-primary/10 border border-primary/20" : "hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {m.firstName || m.lastName ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() : m.email}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                      </div>
                      <Badge variant={role === "owner" ? "default" : role === "manager" ? "secondary" : "outline"} className="capitalize">
                        {role}
                      </Badge>
                    </div>
                  </button>
                );
              })}
              {members.length === 0 && (
                <p className="text-sm text-muted-foreground p-3">No team members yet. Add staff to get started.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {selected && (
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle>
                    {selected.firstName || selected.lastName
                      ? `${selected.firstName ?? ""} ${selected.lastName ?? ""}`.trim()
                      : selected.email}
                  </CardTitle>
                  <CardDescription>{selected.email}</CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  {selected.isOwner ? (
                    <Badge>Owner</Badge>
                  ) : (
                    <>
                      <Select
                        value={normalizeRole(selected.role)}
                        onValueChange={(v) => updateRole.mutate({ userId: selected.id, role: v as Role })}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="staff">Staff</SelectItem>
                        </SelectContent>
                      </Select>
                      {can(PERMISSIONS.STAFF_PERMISSIONS_MANAGE) && (
                        <Button variant="outline" size="sm" onClick={resetToDefaults}>
                          Reset to role defaults
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              {selected.isOwner && (
                <p className="text-sm text-muted-foreground">
                  Owners always have every permission. To customize access, select a manager or staff member.
                </p>
              )}
              {!selected.isOwner &&
                PERM_GROUPS.map((group) => (
                  <div key={group.label}>
                    <h3 className="text-sm font-semibold mb-3">{group.label}</h3>
                    <div className="space-y-3">
                      {group.perms.map((p) => {
                        const granted = effective.has(p.key);
                        const isOverride =
                          selected.permissions && Object.prototype.hasOwnProperty.call(selected.permissions, p.key);
                        return (
                          <div key={p.key} className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="text-sm font-medium flex items-center gap-2">
                                {p.label}
                                {isOverride && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    custom
                                  </Badge>
                                )}
                              </div>
                              {p.help && <div className="text-xs text-muted-foreground">{p.help}</div>}
                            </div>
                            <Switch
                              checked={granted}
                              onCheckedChange={(v) => togglePerm(p.key, v)}
                              disabled={!can(PERMISSIONS.STAFF_PERMISSIONS_MANAGE) || updatePerms.isPending}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
