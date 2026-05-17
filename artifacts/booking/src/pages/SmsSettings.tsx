import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { useSelectedStore } from "@/hooks/use-store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Bell,
  Star,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Phone,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface SmsSettingsData {
  id?: number;
  storeId: number;
  bookingConfirmationEnabled: boolean;
  reminderEnabled: boolean;
  reminderHoursBefore: number;
  reviewRequestEnabled: boolean;
  googleReviewUrl: string | null;
  confirmationTemplate: string | null;
  reminderTemplate: string | null;
  reviewTemplate: string | null;
}

interface SmsLogEntry {
  id: number;
  storeId: number;
  appointmentId: number | null;
  customerId: number | null;
  phone: string;
  messageType: string;
  messageBody: string;
  status: string;
  twilioSid: string | null;
  errorMessage: string | null;
  sentAt: string;
}

export default function SmsSettings() {
  const { selectedStore } = useSelectedStore();
  const { toast } = useToast();
  const [testPhone, setTestPhone] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const [form, setForm] = useState<Partial<SmsSettingsData>>({
    bookingConfirmationEnabled: false,
    reminderEnabled: false,
    reminderHoursBefore: 24,
    reviewRequestEnabled: false,
    googleReviewUrl: "",
    confirmationTemplate:
      "Hi {customerName}, your appointment at {storeName} is confirmed for {appointmentDate} at {appointmentTime}. See you then!",
    reminderTemplate:
      "Hi {customerName}, this is a reminder of your appointment at {storeName} tomorrow at {appointmentTime}. Reply STOP to opt out.",
    reviewTemplate:
      "Hi {customerName}, thank you for visiting {storeName}! We'd love your feedback. Leave us a review: {reviewUrl}",
  });

  const { data: settings, isLoading } = useQuery<SmsSettingsData | null>({
    queryKey: ["/api/sms-settings", selectedStore?.id],
    queryFn: async () => {
      if (!selectedStore?.id) return null;
      const res = await fetch(`/api/sms-settings/${selectedStore.id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch SMS settings");
      return res.json();
    },
    enabled: !!selectedStore?.id,
  });

  const { data: logs } = useQuery<SmsLogEntry[]>({
    queryKey: ["/api/sms-log", selectedStore?.id],
    queryFn: async () => {
      if (!selectedStore?.id) return [];
      const res = await fetch(`/api/sms-log/${selectedStore.id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch SMS logs");
      return res.json();
    },
    enabled: !!selectedStore?.id,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        bookingConfirmationEnabled: settings.bookingConfirmationEnabled,
        reminderEnabled: settings.reminderEnabled,
        reminderHoursBefore: settings.reminderHoursBefore,
        reviewRequestEnabled: settings.reviewRequestEnabled,
        googleReviewUrl: settings.googleReviewUrl || "",
        confirmationTemplate: settings.confirmationTemplate || "",
        reminderTemplate: settings.reminderTemplate || "",
        reviewTemplate: settings.reviewTemplate || "",
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<SmsSettingsData>) => {
      const res = await apiRequest(
        "PUT",
        `/api/sms-settings/${selectedStore!.id}`,
        data
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/sms-settings", selectedStore?.id],
      });
      toast({ title: "SMS settings saved" });
    },
    onError: () => {
      toast({
        title: "Failed to save",
        description: "Please check your settings and try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate(form);
  };

  const handleTestSms = async () => {
    if (!testPhone.trim() || !selectedStore?.id) return;
    setSendingTest(true);
    try {
      const res = await apiRequest(
        "POST",
        `/api/sms-settings/${selectedStore.id}/test`,
        { phone: testPhone.trim() }
      );
      const result = await res.json();
      if (result.success) {
        toast({ title: "Test SMS sent successfully" });
        queryClient.invalidateQueries({
          queryKey: ["/api/sms-log", selectedStore.id],
        });
      }
    } catch (err: any) {
      toast({
        title: "Test SMS failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSendingTest(false);
    }
  };

  if (!selectedStore) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">
            Please select a store first.
          </p>
        </div>
      </AppLayout>
    );
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            SMS Notifications
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure SMS for booking confirmations, reminders, and
            review requests.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          data-testid="button-save-sms-settings"
        >
          {saveMutation.isPending && (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          )}
          Save Settings
        </Button>
      </div>

      <div className="max-w-3xl space-y-6">
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold">SMS Token Balance</h3>
              <p className="text-sm text-muted-foreground">
                Your available SMS tokens
              </p>
            </div>
          </div>
          <div className="text-3xl font-bold text-blue-600">
            {selectedStore?.smsTokens ?? 0}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Each SMS message sent costs 1 token. Contact us to purchase more tokens.
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold">Booking Confirmations</h3>
              <p className="text-sm text-muted-foreground">
                Send an SMS when a new booking is made
              </p>
            </div>
            <Switch
              checked={form.bookingConfirmationEnabled || false}
              onCheckedChange={(checked) =>
                setForm((f) => ({
                  ...f,
                  bookingConfirmationEnabled: checked,
                }))
              }
              data-testid="switch-confirmation"
            />
          </div>
          {form.bookingConfirmationEnabled && (
            <div>
              <label className="text-sm font-medium mb-1 block">
                Message Template
              </label>
              <Textarea
                value={form.confirmationTemplate || ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    confirmationTemplate: e.target.value,
                  }))
                }
                className="text-sm"
                rows={3}
                data-testid="textarea-confirmation-template"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Variables: {"{customerName}"}, {"{storeName}"},{" "}
                {"{appointmentDate}"}, {"{appointmentTime}"},{" "}
                {"{serviceName}"}
              </p>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Bell className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold">Appointment Reminders</h3>
              <p className="text-sm text-muted-foreground">
                Send a reminder before the appointment
              </p>
            </div>
            <Switch
              checked={form.reminderEnabled || false}
              onCheckedChange={(checked) =>
                setForm((f) => ({ ...f, reminderEnabled: checked }))
              }
              data-testid="switch-reminder"
            />
          </div>
          {form.reminderEnabled && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Hours Before Appointment
                </label>
                <Input
                  type="number"
                  min={1}
                  max={72}
                  value={form.reminderHoursBefore || 24}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      reminderHoursBefore: parseInt(e.target.value) || 24,
                    }))
                  }
                  className="w-32"
                  data-testid="input-reminder-hours"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Message Template
                </label>
                <Textarea
                  value={form.reminderTemplate || ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      reminderTemplate: e.target.value,
                    }))
                  }
                  className="text-sm"
                  rows={3}
                  data-testid="textarea-reminder-template"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Variables: {"{customerName}"}, {"{storeName}"},{" "}
                  {"{appointmentDate}"}, {"{appointmentTime}"},{" "}
                  {"{serviceName}"}
                </p>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Star className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold">Google Review Requests</h3>
              <p className="text-sm text-muted-foreground">
                Send a review request after appointment completion
              </p>
            </div>
            <Switch
              checked={form.reviewRequestEnabled || false}
              onCheckedChange={(checked) =>
                setForm((f) => ({ ...f, reviewRequestEnabled: checked }))
              }
              data-testid="switch-review"
            />
          </div>
          {form.reviewRequestEnabled && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Google Review URL
                </label>
                <Input
                  value={form.googleReviewUrl || ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      googleReviewUrl: e.target.value,
                    }))
                  }
                  placeholder="https://g.page/r/your-business/review"
                  data-testid="input-google-review-url"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Message Template
                </label>
                <Textarea
                  value={form.reviewTemplate || ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      reviewTemplate: e.target.value,
                    }))
                  }
                  className="text-sm"
                  rows={3}
                  data-testid="textarea-review-template"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Variables: {"{customerName}"}, {"{storeName}"},{" "}
                  {"{reviewUrl}"}
                </p>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold mb-3">Send Test SMS</h3>
          <div className="flex items-center gap-3">
            <Input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+1234567890"
              className="flex-1"
              data-testid="input-test-phone"
            />
            <Button
              onClick={handleTestSms}
              disabled={sendingTest || !testPhone.trim()}
              data-testid="button-send-test"
            >
              {sendingTest ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Send Test
            </Button>
          </div>
        </Card>

        {logs && logs.length > 0 && (
          <Card className="p-6">
            <h3 className="font-semibold mb-4">Recent SMS Log</h3>
            <div className="space-y-3">
              {logs.slice(0, 20).map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 text-sm border-b pb-3 last:border-0 last:pb-0"
                  data-testid={`sms-log-${log.id}`}
                >
                  <div className="mt-0.5">
                    {log.status === "sent" ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {log.messageType.replace("_", " ")}
                      </Badge>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {log.phone}
                      </span>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(log.sentAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 truncate">
                      {log.messageBody}
                    </p>
                    {log.errorMessage && (
                      <p className="text-red-500 text-xs mt-1">
                        {log.errorMessage}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
