import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Edit2, ToggleLeft, ToggleRight, Trash2, Loader2,
  Save, X, DollarSign, CheckCircle, XCircle, Tag, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Plan {
  id: number;
  code: string;
  name: string;
  description: string | null;
  priceCents: string;
  contactsMax: string | null;
  stripePriceId: string | null;
  stripeProductId: string | null;
  interval: string;
  smsCredits: string | null;
  currency: string;
  active: boolean;
  featuresJson: any;
  createdAt: string;
}

type PlanFormData = Omit<Plan, "id" | "createdAt">;

const BLANK_FORM: PlanFormData = {
  code: "",
  name: "",
  description: "",
  priceCents: "0",
  contactsMax: null,
  stripePriceId: "",
  stripeProductId: "",
  interval: "month",
  smsCredits: "0",
  currency: "usd",
  active: true,
  featuresJson: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: string | number | null | undefined): string {
  if (cents == null) return "$0.00";
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, { credentials: "include", ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ─── Plan Form ────────────────────────────────────────────────────────────────

function PlanForm({
  initial,
  onSave,
  onCancel,
  isLoading,
}: {
  initial: PlanFormData;
  onSave: (data: PlanFormData) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState<PlanFormData>(initial);
  const [featuresRaw, setFeaturesRaw] = useState(
    initial.featuresJson?.features?.join("\n") ?? ""
  );

  function set(key: keyof PlanFormData, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSave() {
    const features = featuresRaw
      .split("\n")
      .map((f: string) => f.trim())
      .filter(Boolean);

    const featuresJson = features.length
      ? { ...form.featuresJson, features }
      : form.featuresJson;

    onSave({ ...form, featuresJson });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Plan Code *</label>
          <Input
            value={form.code}
            onChange={(e) => set("code", e.target.value.toLowerCase().replace(/\s+/g, "_"))}
            placeholder="e.g. professional"
            className="bg-zinc-800 border-zinc-600 text-white"
          />
          <p className="text-xs text-zinc-600 mt-0.5">Lowercase, underscores. Never change after launch.</p>
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Display Name *</label>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Professional"
            className="bg-zinc-800 border-zinc-600 text-white"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-zinc-400 block mb-1">Description</label>
        <Input
          value={form.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Short tagline shown in pricing UI"
          className="bg-zinc-800 border-zinc-600 text-white"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Price (cents) *</label>
          <Input
            type="number"
            value={form.priceCents}
            onChange={(e) => set("priceCents", e.target.value)}
            placeholder="9900"
            className="bg-zinc-800 border-zinc-600 text-white"
          />
          <p className="text-xs text-zinc-600 mt-0.5">
            = {formatCents(form.priceCents)} / {form.interval}
          </p>
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Billing Interval</label>
          <Select value={form.interval} onValueChange={(v) => set("interval", v)}>
            <SelectTrigger className="bg-zinc-800 border-zinc-600 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="month">Monthly</SelectItem>
              <SelectItem value="year">Annual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">SMS Credits / period</label>
          <Input
            type="number"
            value={form.smsCredits ?? ""}
            onChange={(e) => set("smsCredits", e.target.value)}
            placeholder="750"
            className="bg-zinc-800 border-zinc-600 text-white"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Stripe Price ID</label>
          <Input
            value={form.stripePriceId ?? ""}
            onChange={(e) => set("stripePriceId", e.target.value)}
            placeholder="price_..."
            className="bg-zinc-800 border-zinc-600 text-white font-mono text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-400 block mb-1">Stripe Product ID</label>
          <Input
            value={form.stripeProductId ?? ""}
            onChange={(e) => set("stripeProductId", e.target.value)}
            placeholder="prod_..."
            className="bg-zinc-800 border-zinc-600 text-white font-mono text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-zinc-400 block mb-1">
          Features (one per line — shown in pricing table)
        </label>
        <Textarea
          value={featuresRaw}
          onChange={(e) => setFeaturesRaw(e.target.value)}
          placeholder={"Online booking & POS\n200 SMS credits / month\nBasic analytics"}
          className="bg-zinc-800 border-zinc-600 text-white resize-none"
          rows={5}
        />
      </div>

      <div className="flex items-center gap-3">
        <Switch
          checked={form.active}
          onCheckedChange={(v) => set("active", v)}
          className="data-[state=checked]:bg-violet-600"
        />
        <label className="text-sm text-zinc-300">Active (visible in checkout)</label>
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          className="bg-violet-600 hover:bg-violet-500 text-white"
          onClick={handleSave}
          disabled={isLoading || !form.code || !form.name}
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />}
          Save Plan
        </Button>
        <Button variant="ghost" className="text-zinc-400" onClick={onCancel}>
          <X className="w-4 h-4 mr-1.5" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Plan Row ─────────────────────────────────────────────────────────────────

function PlanRow({
  plan,
  onEdit,
  onToggle,
  onDelete,
  isTogglingId,
}: {
  plan: Plan;
  onEdit: (plan: Plan) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  isTogglingId: number | null;
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  return (
    <div className={`p-4 rounded-xl border flex items-start gap-4 transition-all ${plan.active
      ? "bg-zinc-900/60 border-zinc-700/40"
      : "bg-zinc-950/40 border-zinc-800/30 opacity-60"
    }`}>
      {/* Status indicator */}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-2 ${plan.active ? "bg-emerald-400" : "bg-zinc-600"}`} />

      {/* Plan info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-semibold">{plan.name}</span>
          <code className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-mono">{plan.code}</code>
          {!plan.active && (
            <span className="text-xs text-zinc-500 border border-zinc-700 px-1.5 py-0.5 rounded">Inactive</span>
          )}
        </div>

        <p className="text-zinc-400 text-sm mt-0.5">{plan.description}</p>

        <div className="flex flex-wrap gap-3 mt-2 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            {formatCents(plan.priceCents)} / {plan.interval}
          </span>
          {plan.smsCredits && (
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {Number(plan.smsCredits).toLocaleString()} SMS
            </span>
          )}
          {plan.stripePriceId ? (
            <span className="flex items-center gap-1 text-emerald-500">
              <CheckCircle className="w-3 h-3" />
              Stripe linked
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-500">
              <XCircle className="w-3 h-3" />
              No Stripe Price ID
            </span>
          )}
        </div>

        {/* Features preview */}
        {plan.featuresJson?.features?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {(plan.featuresJson.features as string[]).slice(0, 4).map((f) => (
              <span key={f} className="text-xs bg-zinc-800/60 text-zinc-500 px-2 py-0.5 rounded-full">{f}</span>
            ))}
            {plan.featuresJson.features.length > 4 && (
              <span className="text-xs text-zinc-600 px-2 py-0.5">+{plan.featuresJson.features.length - 4} more</span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="text-zinc-400 hover:text-white h-8 px-2"
          onClick={() => onEdit(plan)}
          title="Edit plan"
        >
          <Edit2 className="w-4 h-4" />
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className={`h-8 px-2 ${plan.active ? "text-zinc-400 hover:text-amber-400" : "text-zinc-600 hover:text-emerald-400"}`}
          onClick={() => onToggle(plan.id)}
          disabled={isTogglingId === plan.id}
          title={plan.active ? "Deactivate plan" : "Activate plan"}
        >
          {isTogglingId === plan.id
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : plan.active
            ? <ToggleRight className="w-4 h-4" />
            : <ToggleLeft className="w-4 h-4" />
          }
        </Button>

        {!deleteConfirm ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-zinc-600 hover:text-red-400 h-8 px-2"
            onClick={() => setDeleteConfirm(true)}
            title="Delete plan"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2 text-xs"
              onClick={() => { onDelete(plan.id); setDeleteConfirm(false); }}
            >
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-zinc-500"
              onClick={() => setDeleteConfirm(false)}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BillingPlansManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ plans: Plan[] }>({
    queryKey: ["admin-billing-plans"],
    queryFn: () => apiFetch("/api/billing/admin/plans"),
  });

  const createMutation = useMutation({
    mutationFn: (formData: PlanFormData) =>
      apiFetch("/api/billing/admin/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-billing-plans"] });
      queryClient.invalidateQueries({ queryKey: ["billing-plans"] });
      setShowCreateForm(false);
      toast({ title: "Plan created", description: "The new plan is now available." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<PlanFormData> }) =>
      apiFetch(`/api/billing/admin/plans/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-billing-plans"] });
      queryClient.invalidateQueries({ queryKey: ["billing-plans"] });
      setEditingPlan(null);
      toast({ title: "Plan updated", description: "Changes saved." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/billing/admin/plans/${id}/toggle`, { method: "PATCH" }),
    onMutate: (id) => setTogglingId(id),
    onSettled: () => setTogglingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-billing-plans"] });
      queryClient.invalidateQueries({ queryKey: ["billing-plans"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/billing/admin/plans/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-billing-plans"] });
      queryClient.invalidateQueries({ queryKey: ["billing-plans"] });
      toast({ title: "Plan deactivated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const plans = data?.plans ?? [];
  const activePlans = plans.filter((p) => p.active);
  const inactivePlans = plans.filter((p) => !p.active);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Billing Plans</h1>
          <p className="text-zinc-400 text-sm mt-1">
            {activePlans.length} active · {inactivePlans.length} inactive
          </p>
        </div>
        <Button
          className="bg-violet-600 hover:bg-violet-500 text-white"
          onClick={() => { setShowCreateForm(true); setEditingPlan(null); }}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          New Plan
        </Button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <Card className="bg-zinc-900/80 border-violet-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base">Create New Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <PlanForm
              initial={BLANK_FORM}
              onSave={(formData) => createMutation.mutate(formData)}
              onCancel={() => setShowCreateForm(false)}
              isLoading={createMutation.isPending}
            />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
        </div>
      ) : plans.length === 0 ? (
        <Card className="bg-zinc-900/60 border-zinc-700/40">
          <CardContent className="p-8 text-center">
            <Tag className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-400 font-medium">No plans yet</p>
            <p className="text-zinc-600 text-sm mt-1">
              Run <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300">npx tsx scripts/seed-billing-plans.ts</code> to seed starter plans, or create one manually above.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Active plans */}
          {activePlans.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium px-1">Active Plans</p>
              {activePlans.map((plan) =>
                editingPlan?.id === plan.id ? (
                  <Card key={plan.id} className="bg-zinc-900/80 border-violet-500/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white text-sm">Editing: {plan.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <PlanForm
                        initial={{
                          code: plan.code, name: plan.name, description: plan.description,
                          priceCents: plan.priceCents, contactsMax: plan.contactsMax,
                          stripePriceId: plan.stripePriceId, stripeProductId: plan.stripeProductId,
                          interval: plan.interval, smsCredits: plan.smsCredits,
                          currency: plan.currency, active: plan.active, featuresJson: plan.featuresJson,
                        }}
                        onSave={(formData) => updateMutation.mutate({ id: plan.id, data: formData })}
                        onCancel={() => setEditingPlan(null)}
                        isLoading={updateMutation.isPending}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <PlanRow
                    key={plan.id}
                    plan={plan}
                    onEdit={setEditingPlan}
                    onToggle={(id) => toggleMutation.mutate(id)}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    isTogglingId={togglingId}
                  />
                )
              )}
            </div>
          )}

          {/* Inactive plans */}
          {inactivePlans.length > 0 && (
            <div className="space-y-2 mt-4">
              <p className="text-xs text-zinc-600 uppercase tracking-widest font-medium px-1">Inactive Plans</p>
              {inactivePlans.map((plan) =>
                editingPlan?.id === plan.id ? (
                  <Card key={plan.id} className="bg-zinc-900/80 border-zinc-600/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white text-sm">Editing: {plan.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <PlanForm
                        initial={{
                          code: plan.code, name: plan.name, description: plan.description,
                          priceCents: plan.priceCents, contactsMax: plan.contactsMax,
                          stripePriceId: plan.stripePriceId, stripeProductId: plan.stripeProductId,
                          interval: plan.interval, smsCredits: plan.smsCredits,
                          currency: plan.currency, active: plan.active, featuresJson: plan.featuresJson,
                        }}
                        onSave={(formData) => updateMutation.mutate({ id: plan.id, data: formData })}
                        onCancel={() => setEditingPlan(null)}
                        isLoading={updateMutation.isPending}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <PlanRow
                    key={plan.id}
                    plan={plan}
                    onEdit={setEditingPlan}
                    onToggle={(id) => toggleMutation.mutate(id)}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    isTogglingId={togglingId}
                  />
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
