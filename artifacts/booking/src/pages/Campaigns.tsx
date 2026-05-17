import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useSelectedStore } from "@/hooks/use-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Megaphone, Plus, Send, Clock, CheckCircle, FileEdit, Trash2, Users, MessageSquare, Mail, RefreshCw,
} from "lucide-react";
import { format } from "date-fns";

type Campaign = {
  id: number;
  name: string;
  status: string;
  channel: string;
  audience: string;
  audienceValue?: string;
  messageTemplate: string;
  scheduledAt?: string;
  sentAt?: string;
  sentCount: number;
  failedCount: number;
  createdAt: string;
};

const AUDIENCE_OPTIONS = [
  { value: "all", label: "All Clients" },
  { value: "lapsed_30", label: "Lapsed 30+ days" },
  { value: "lapsed_60", label: "Lapsed 60+ days" },
  { value: "lapsed_90", label: "Lapsed 90+ days" },
];

const CHANNEL_OPTIONS = [
  { value: "sms", label: "SMS", icon: MessageSquare },
  { value: "email", label: "Email", icon: Mail },
  { value: "both", label: "SMS + Email", icon: RefreshCw },
];

const MERGE_TAGS = ["{{firstName}}", "{{businessName}}", "{{bookingLink}}"];

function statusBadge(status: string) {
  if (status === "sent") return <Badge className="bg-green-100 text-green-800 border-green-200">Sent</Badge>;
  if (status === "scheduled") return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Scheduled</Badge>;
  if (status === "sending") return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Sending…</Badge>;
  return <Badge variant="outline">Draft</Badge>;
}

export default function Campaigns() {
  const { selectedStore } = useSelectedStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    channel: "sms",
    audience: "all",
    audienceValue: "",
    messageTemplate: "",
    scheduledAt: "",
  });

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns", selectedStore?.id],
    queryFn: async () => {
      if (!selectedStore?.id) return [];
      const res = await fetch(`/api/campaigns?storeId=${selectedStore.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedStore?.id,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, storeId: selectedStore?.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Campaign created" });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", selectedStore?.id] });
      setShowCreate(false);
      setForm({ name: "", channel: "sms", audience: "all", audienceValue: "", messageTemplate: "", scheduledAt: "" });
    },
    onError: (e: any) => toast({ title: "Failed to create campaign", description: e.message, variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/campaigns/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStore?.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Campaign sent!" });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", selectedStore?.id] });
    },
    onError: (e: any) => toast({ title: "Failed to send", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStore?.id }),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      toast({ title: "Campaign deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns", selectedStore?.id] });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const insertTag = (tag: string) => {
    setForm((f) => ({ ...f, messageTemplate: f.messageTemplate + tag }));
  };

  return (
    <AppLayout>
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-primary" />
            Campaigns
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Send targeted messages to your clients</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Campaign
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Loading campaigns…</div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed rounded-xl">
          <Megaphone className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-1">No campaigns yet</h3>
          <p className="text-muted-foreground text-sm mb-4">Create your first campaign to re-engage clients</p>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Campaign
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div key={c.id} className="border rounded-xl p-4 bg-card flex items-start gap-4">
              <div className="mt-1">
                {c.channel === "sms" ? <MessageSquare className="w-5 h-5 text-primary" /> :
                 c.channel === "email" ? <Mail className="w-5 h-5 text-blue-500" /> :
                 <RefreshCw className="w-5 h-5 text-purple-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm">{c.name}</span>
                  {statusBadge(c.status)}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{c.messageTemplate}</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {AUDIENCE_OPTIONS.find(a => a.value === c.audience)?.label || c.audience}
                  </span>
                  {c.sentAt && (
                    <span className="flex items-center gap-1">
                      <CheckCircle className="w-3 h-3 text-green-500" />
                      Sent {format(new Date(c.sentAt), "MMM d, yyyy")} · {c.sentCount} delivered
                    </span>
                  )}
                  {c.scheduledAt && c.status === "scheduled" && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-blue-500" />
                      Scheduled {format(new Date(c.scheduledAt), "MMM d, h:mm a")}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {c.status === "draft" && (
                  <Button
                    size="sm"
                    onClick={() => sendMutation.mutate(c.id)}
                    disabled={sendMutation.isPending}
                  >
                    <Send className="w-3 h-3 mr-1" />
                    Send Now
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => deleteMutation.mutate(c.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Campaign Name</Label>
              <Input
                placeholder="e.g. Summer Re-engagement"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={form.channel} onValueChange={(v) => setForm((f) => ({ ...f, channel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CHANNEL_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Audience</Label>
                <Select value={form.audience} onValueChange={(v) => setForm((f) => ({ ...f, audience: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AUDIENCE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea
                placeholder="Write your message… Use merge tags below to personalize."
                value={form.messageTemplate}
                onChange={(e) => setForm((f) => ({ ...f, messageTemplate: e.target.value }))}
                rows={4}
              />
              <div className="flex gap-2 flex-wrap">
                {MERGE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertTag(tag)}
                    className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 font-mono"
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Tags are replaced with real values when the message is sent.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Schedule (optional)</Label>
              <Input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Leave blank to save as draft and send manually.</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate(form)}
                disabled={!form.name.trim() || !form.messageTemplate.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Saving…" : "Save Campaign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </AppLayout>
  );
}
