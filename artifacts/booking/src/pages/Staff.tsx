import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useStaffList, useCreateStaff } from "@/hooks/use-staff";
import { useSelectedStore } from "@/hooks/use-store";
import { usePermissions } from "@/hooks/use-permissions";
import { PERMISSIONS } from "@shared/permissions";
import type { Staff } from "@shared/schema";
import {
  Plus, Search, Mail, Phone, Shield, UserX, UserCheck,
  MoreHorizontal, Send, Users, UserCircle, Clock, CheckCircle2,
  AlertCircle, RefreshCw, ExternalLink, Camera,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertStaffSchema } from "@shared/schema";
import { z } from "zod";

const EMPLOYMENT_TYPES = [
  { value: "stylist",      label: "Stylist",       color: "#5B21B6" },
  { value: "manager",      label: "Manager",       color: "#0369a1" },
  { value: "receptionist", label: "Receptionist",  color: "#0891b2" },
  { value: "assistant",    label: "Assistant",     color: "#059669" },
  { value: "booth_renter", label: "Booth Renter",  color: "#d97706" },
  { value: "marketer",     label: "Marketer",      color: "#db2777" },
  { value: "accountant",   label: "Accountant",    color: "#7c3aed" },
  { value: "owner",        label: "Owner",         color: "#3B0764" },
  { value: "custom",       label: "Custom",        color: "#6b7280" },
];

const ACCESS_ROLES = [
  { value: "staff",   label: "Staff — standard access" },
  { value: "manager", label: "Manager — elevated access" },
];

function getEmploymentConfig(type?: string | null) {
  return EMPLOYMENT_TYPES.find(t => t.value === type) ?? EMPLOYMENT_TYPES[0];
}

function StatusBadge({ status }: { status?: string | null }) {
  if (!status || status === "active") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 10px", borderRadius: 50, fontSize: ".7rem", fontWeight: 600,
        background: "rgba(22,163,74,0.1)", color: "#15803d",
      }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
        Active
      </span>
    );
  }
  if (status === "invited") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 10px", borderRadius: 50, fontSize: ".7rem", fontWeight: 600,
        background: "rgba(217,119,6,0.1)", color: "#b45309",
      }}>
        <Clock style={{ width: 10, height: 10 }} />
        Invited
      </span>
    );
  }
  if (status === "deactivated") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 10px", borderRadius: 50, fontSize: ".7rem", fontWeight: 600,
        background: "rgba(107,114,128,0.1)", color: "#6b7280",
      }}>
        <UserX style={{ width: 10, height: 10 }} />
        Deactivated
      </span>
    );
  }
  return null;
}

function EmptyTypeBadge({ type }: { type?: string | null }) {
  const cfg = getEmploymentConfig(type);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 10px", borderRadius: 50, fontSize: ".68rem", fontWeight: 700,
      background: cfg.color + "18", color: cfg.color,
      letterSpacing: ".03em", textTransform: "uppercase",
    }}>
      {cfg.label}
    </span>
  );
}

export default function StaffPage() {
  const { data: staffList = [], isLoading } = useStaffList();
  const { selectedStore } = useSelectedStore();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "active" | "invited" | "deactivated">("all");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Stats
  const { data: stats } = useQuery<{ active: number; invited: number; deactivated: number; total: number }>({
    queryKey: ["/api/team/stats"],
    queryFn: async () => {
      const res = await fetch("/api/team/stats", { credentials: "include" });
      if (!res.ok) return { active: 0, invited: 0, deactivated: 0, total: 0 };
      return res.json();
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/team/staff/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/staff"] });
      qc.invalidateQueries({ queryKey: ["/api/team/stats"] });
      toast({ title: "Staff status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const resendInvite = useMutation({
    mutationFn: async (staffId: number) => {
      const member = staffList.find((s: any) => s.id === staffId);
      if (!member) throw new Error("Member not found");
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: (member as any).email,
          name: member.name,
          role: member.role,
          employmentType: (member as any).employmentType,
          storeId: selectedStore?.id,
        }),
      });
      if (!res.ok) throw new Error("Failed to resend invite");
      return res.json();
    },
    onSuccess: () => toast({ title: "Invitation resent" }),
    onError: () => toast({ title: "Failed to resend invite", variant: "destructive" }),
  });

  const filtered = staffList.filter((s: any) => {
    const matchSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.email ?? "").toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchSearch) return false;
    if (filterTab === "all") return true;
    if (filterTab === "active") return !s.status || s.status === "active";
    return s.status === filterTab;
  });

  const tabs = [
    { key: "all",         label: "All",         count: stats?.total ?? staffList.length },
    { key: "active",      label: "Active",      count: stats?.active ?? 0 },
    { key: "invited",     label: "Invited",     count: stats?.invited ?? 0 },
    { key: "deactivated", label: "Deactivated", count: stats?.deactivated ?? 0 },
  ] as const;

  return (
    <AppLayout>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
        .team-card { animation: fadeUp .3s ease both; }
        .team-card:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(59,7,100,0.10); }
        .team-card { transition: transform .18s ease, box-shadow .18s ease; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: "1.65rem", fontWeight: 800, color: "#1c1917", margin: 0, letterSpacing: "-0.03em" }}>Team</h1>
          <p style={{ color: "#6b7280", fontSize: ".875rem", margin: "4px 0 0" }}>
            Manage your staff, roles, and permissions.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {can(PERMISSIONS.STAFF_MANAGE) && (
            <>
              <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Send className="w-4 h-4" />
                    Invite by email
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Invite a team member</DialogTitle>
                  </DialogHeader>
                  <InviteForm
                    storeId={selectedStore?.id}
                    onSuccess={() => {
                      setIsInviteOpen(false);
                      qc.invalidateQueries({ queryKey: ["/api/staff"] });
                      qc.invalidateQueries({ queryKey: ["/api/team/stats"] });
                    }}
                  />
                </DialogContent>
              </Dialog>

              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="w-4 h-4" />
                    Add staff
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add staff member</DialogTitle>
                  </DialogHeader>
                  <CreateStaffForm onSuccess={() => setIsAddOpen(false)} />
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24,
      }}>
        {[
          { label: "Active members", value: stats?.active ?? 0, color: "#16a34a", bg: "rgba(22,163,74,0.07)" },
          { label: "Pending invites", value: stats?.invited ?? 0, color: "#d97706", bg: "rgba(217,119,6,0.07)" },
          { label: "Deactivated", value: stats?.deactivated ?? 0, color: "#6b7280", bg: "rgba(107,114,128,0.07)" },
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{
            background: bg, borderRadius: 14, padding: "14px 18px",
            border: `1px solid ${color}20`,
          }}>
            <p style={{ fontSize: "1.6rem", fontWeight: 800, color, margin: 0, lineHeight: 1 }}>{value}</p>
            <p style={{ fontSize: ".72rem", color: "#6b7280", margin: "4px 0 0", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</p>
          </div>
        ))}
      </div>

      {/* ── Filters + search ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, background: "#f9fafb", borderRadius: 10, padding: 3, border: "1px solid #e5e7eb" }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilterTab(tab.key)}
              style={{
                padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer",
                fontSize: ".78rem", fontWeight: 600,
                background: filterTab === tab.key ? "#fff" : "transparent",
                color: filterTab === tab.key ? "#1c1917" : "#6b7280",
                boxShadow: filterTab === tab.key ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                transition: "all .15s",
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{
                  marginLeft: 6, padding: "1px 6px", borderRadius: 50,
                  background: filterTab === tab.key ? "#f3f4f6" : "transparent",
                  fontSize: ".7rem", fontWeight: 700,
                }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#9ca3af" }} />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by name or email…"
            style={{
              width: "100%", height: 38, paddingLeft: 34, paddingRight: 12,
              borderRadius: 9, border: "1px solid #e5e7eb", background: "#fff",
              fontSize: ".84rem", outline: "none", color: "#1c1917",
            }}
          />
        </div>

        {can(PERMISSIONS.STAFF_PERMISSIONS_MANAGE) && (
          <Link to="/team-permissions">
            <Button variant="outline" size="sm" className="gap-2">
              <Shield className="w-3.5 h-3.5" />
              Manage permissions
            </Button>
          </Link>
        )}
      </div>

      {/* ── Staff grid ── */}
      {isLoading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", color: "#9ca3af" }}>
          <RefreshCw style={{ width: 20, height: 20, marginRight: 8, animation: "spin 1s linear infinite" }} />
          Loading team…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "60px 24px",
          background: "#fafafa", borderRadius: 16, border: "1px dashed #e5e7eb",
        }}>
          <Users style={{ width: 36, height: 36, color: "#d1d5db", margin: "0 auto 12px" }} />
          <p style={{ fontWeight: 700, color: "#374151", margin: "0 0 4px" }}>No team members found</p>
          <p style={{ color: "#9ca3af", fontSize: ".85rem", margin: 0 }}>
            {searchTerm ? "Try a different search." : "Invite or add your first team member to get started."}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {filtered.map((member: any, i: number) => (
            <StaffCard
              key={member.id}
              member={member}
              index={i}
              canManage={can(PERMISSIONS.STAFF_MANAGE)}
              canViewPermissions={can(PERMISSIONS.STAFF_PERMISSIONS_MANAGE)}
              onDeactivate={() => updateStatus.mutate({ id: member.id, status: "deactivated" })}
              onReactivate={() => updateStatus.mutate({ id: member.id, status: "active" })}
              onRemove={() => {
                if (confirm(`Remove ${member.name} from the team? Their history will be preserved.`)) {
                  updateStatus.mutate({ id: member.id, status: "removed" });
                }
              }}
              onResendInvite={() => resendInvite.mutate(member.id)}
              onViewProfile={() => navigate(`/staff/${member.id}`)}
            />
          ))}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </AppLayout>
  );
}

function StaffCard({
  member, index, canManage, canViewPermissions,
  onDeactivate, onReactivate, onRemove, onResendInvite, onViewProfile,
}: {
  member: any;
  index: number;
  canManage: boolean;
  canViewPermissions: boolean;
  onDeactivate: () => void;
  onReactivate: () => void;
  onRemove: () => void;
  onResendInvite: () => void;
  onViewProfile: () => void;
}) {
  const cfg = getEmploymentConfig(member.employmentType);
  const isActive = !member.status || member.status === "active";
  const isInvited = member.status === "invited";
  const isDeactivated = member.status === "deactivated";

  const initials = member.name
    ? member.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()
    : "??";

  return (
    <div
      className="team-card"
      style={{
        background: "#fff", borderRadius: 16,
        border: "1px solid #f3f4f6",
        boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
        overflow: "hidden",
        opacity: isDeactivated ? 0.7 : 1,
        animationDelay: `${index * 40}ms`,
      }}
    >
      {/* Colored header bar */}
      <div style={{ height: 6, background: isDeactivated ? "#e5e7eb" : isInvited ? "#fde68a" : cfg.color + "60" }} />

      <div style={{ padding: "18px 20px 16px" }}>
        {/* Top row */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
          {/* Avatar */}
          <div
            onClick={onViewProfile}
            style={{
              width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: ".85rem", fontWeight: 800, color: "#fff",
              background: isDeactivated ? "#9ca3af" : cfg.color,
              cursor: "pointer", overflow: "hidden",
            }}
          >
            {member.avatarUrl ? (
              <img src={member.avatarUrl} alt={member.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : initials}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <button
              onClick={onViewProfile}
              style={{
                display: "block", fontWeight: 700, fontSize: ".925rem", color: "#1c1917",
                background: "none", border: "none", cursor: "pointer", padding: 0,
                textAlign: "left", margin: "0 0 4px",
              }}
            >
              {member.name}
            </button>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <EmptyTypeBadge type={member.employmentType} />
            </div>
          </div>

          {/* Actions dropdown */}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button style={{
                  width: 28, height: 28, borderRadius: 6, border: "1px solid #e5e7eb",
                  background: "none", cursor: "pointer", display: "flex",
                  alignItems: "center", justifyContent: "center", color: "#6b7280",
                  flexShrink: 0,
                }}>
                  <MoreHorizontal style={{ width: 14, height: 14 }} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onViewProfile}>
                  <UserCircle className="w-3.5 h-3.5 mr-2" /> View profile
                </DropdownMenuItem>
                {canViewPermissions && (
                  <DropdownMenuItem asChild>
                    <Link to="/team-permissions" style={{ display: "flex", alignItems: "center" }}>
                      <Shield className="w-3.5 h-3.5 mr-2" /> Edit permissions
                    </Link>
                  </DropdownMenuItem>
                )}
                {isInvited && (
                  <DropdownMenuItem onClick={onResendInvite}>
                    <Send className="w-3.5 h-3.5 mr-2" /> Resend invite
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {isActive && (
                  <DropdownMenuItem onClick={onDeactivate} className="text-orange-600">
                    <UserX className="w-3.5 h-3.5 mr-2" /> Deactivate
                  </DropdownMenuItem>
                )}
                {isDeactivated && (
                  <DropdownMenuItem onClick={onReactivate} className="text-green-600">
                    <UserCheck className="w-3.5 h-3.5 mr-2" /> Reactivate
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onRemove} className="text-red-600">
                  <UserX className="w-3.5 h-3.5 mr-2" /> Remove from team
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Contact */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
          {member.email && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Mail style={{ width: 12, height: 12, color: "#9ca3af", flexShrink: 0 }} />
              <span style={{ fontSize: ".78rem", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {member.email}
              </span>
            </div>
          )}
          {member.phone && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Phone style={{ width: 12, height: 12, color: "#9ca3af", flexShrink: 0 }} />
              <span style={{ fontSize: ".78rem", color: "#6b7280" }}>{member.phone}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          paddingTop: 10, borderTop: "1px solid #f3f4f6",
        }}>
          <StatusBadge status={member.status} />
          {isInvited && (
            <span style={{ fontSize: ".7rem", color: "#9ca3af", display: "flex", alignItems: "center", gap: 3 }}>
              <AlertCircle style={{ width: 10, height: 10 }} /> Awaiting acceptance
            </span>
          )}
          {isActive && member.commissionEnabled && (
            <span style={{ fontSize: ".7rem", color: "#5B21B6", fontWeight: 600 }}>
              {member.commissionRate}% commission
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function InviteForm({ storeId, onSuccess }: { storeId?: number; onSuccess: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [employmentType, setEmploymentType] = useState("stylist");
  const [role, setRole] = useState("staff");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ inviteUrl?: string; emailSent?: boolean } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId) { toast({ title: "No store selected", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, email, role, employmentType, storeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Failed to invite");
      setResult(data);
      toast({ title: "Invitation sent!", description: data.emailSent ? "An email was sent." : "Copy the invite link below." });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Failed to send invite", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div className="space-y-2">
        <Label>Full name</Label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" required />
      </div>
      <div className="space-y-2">
        <Label>Email address</Label>
        <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@yoursalon.com" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Job type</Label>
          <Select value={employmentType} onValueChange={setEmploymentType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Access level</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACCESS_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
        An invitation link will be generated. If Mailgun is configured, an email will be sent automatically. Otherwise, copy and share the link manually.
      </p>
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={submitting} className="gap-2">
          {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {submitting ? "Sending…" : "Send invitation"}
        </Button>
      </div>
    </form>
  );
}

function CreateStaffForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateStaff();
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<z.infer<typeof insertStaffSchema>>({
    resolver: zodResolver(insertStaffSchema),
    defaultValues: { role: "stylist" },
  });
  const avatarUrl = watch("avatarUrl");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new window.FileReader();
    reader.onloadend = () => setValue("avatarUrl", reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <form onSubmit={handleSubmit((data) => mutate(data, { onSuccess }))} className="space-y-4 pt-2">
      <div className="space-y-2">
        <Label htmlFor="name">Full Name</Label>
        <Input id="name" {...register("name")} placeholder="Sarah Smith" data-testid="input-new-staff-name" />
        {errors.name && <span className="text-xs text-destructive">{errors.name.message}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" {...register("email")} placeholder="sarah@salon.com" data-testid="input-new-staff-email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" {...register("phone")} placeholder="(555) 123-4567" data-testid="input-new-staff-phone" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" {...register("password")} placeholder="min 6 chars" data-testid="input-new-staff-password" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <Input id="role" {...register("role")} placeholder="stylist" data-testid="input-new-staff-role" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Photo</Label>
        <div className="flex gap-3 items-center">
          <div className="relative w-14 h-14 rounded-full overflow-hidden border bg-muted flex items-center justify-center shrink-0">
            {avatarUrl
              ? <img src={avatarUrl} alt="Preview" className="w-full h-full object-cover" />
              : <Camera className="w-5 h-5 text-muted-foreground" />}
            <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileChange} />
          </div>
          <span className="text-xs text-muted-foreground">Upload a profile photo</span>
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isPending} data-testid="button-submit-new-staff">
          {isPending ? "Adding…" : "Add staff member"}
        </Button>
      </div>
    </form>
  );
}
