import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useSelectedStore } from "@/hooks/use-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MessageSquare, Send, ArrowLeft, Phone } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";

type Conversation = {
  clientPhone: string;
  clientName: string | null;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  direction: "inbound" | "outbound";
};

type Message = {
  id: number;
  direction: "inbound" | "outbound";
  body: string;
  createdAt: string;
  readAt: string | null;
};

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d");
}

function formatPhoneNumber(raw: string) {
  const digits = (raw || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

export default function SmsInbox() {
  const { selectedStore } = useSelectedStore();
  const qc = useQueryClient();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const storeId = selectedStore?.id;

  const { data: conversations = [], isLoading: convsLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/sms-inbox/conversations", storeId],
    queryFn: () =>
      fetch(`/api/sms-inbox/conversations?storeId=${storeId}`, { credentials: "include" })
        .then(r => r.json()),
    enabled: !!storeId,
    refetchInterval: 15_000,
  });

  const { data: messages = [], isLoading: msgsLoading } = useQuery<Message[]>({
    queryKey: ["/api/sms-inbox/messages", storeId, selectedPhone],
    queryFn: () =>
      fetch(`/api/sms-inbox/messages?storeId=${storeId}&phone=${encodeURIComponent(selectedPhone!)}`, {
        credentials: "include",
      }).then(r => r.json()),
    enabled: !!storeId && !!selectedPhone,
    refetchInterval: 10_000,
  });

  const sendReply = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sms-inbox/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ storeId, phone: selectedPhone, body: replyText }),
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["/api/sms-inbox/messages", storeId, selectedPhone] });
      qc.invalidateQueries({ queryKey: ["/api/sms-inbox/conversations", storeId] });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedConv = conversations.find(c => c.clientPhone === selectedPhone);
  const totalUnread = conversations.reduce((s, c) => s + c.unreadCount, 0);

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* Conversation list */}
        <div className={cn(
          "w-full md:w-80 flex-shrink-0 border-r bg-background flex flex-col",
          selectedPhone ? "hidden md:flex" : "flex"
        )}>
          <div className="p-4 border-b">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold">SMS Inbox</h1>
              {totalUnread > 0 && (
                <Badge className="bg-primary text-white text-xs">{totalUnread}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Two-way client messaging</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {convsLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-6">
                <MessageSquare className="w-10 h-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No messages yet. When clients reply to your SMS messages, they'll appear here.</p>
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.clientPhone}
                  onClick={() => setSelectedPhone(conv.clientPhone)}
                  className={cn(
                    "w-full px-4 py-3 border-b text-left hover:bg-muted/40 transition-colors flex gap-3 items-start",
                    selectedPhone === conv.clientPhone && "bg-primary/5 border-l-2 border-l-primary"
                  )}
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary font-bold text-sm">
                    {(conv.clientName || conv.clientPhone).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">
                        {conv.clientName || formatPhoneNumber(conv.clientPhone)}
                      </span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {formatTime(conv.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {conv.direction === "outbound" && (
                        <span className="text-xs text-muted-foreground">You: </span>
                      )}
                      <p className="text-xs text-muted-foreground truncate">{conv.lastMessage}</p>
                      {conv.unreadCount > 0 && (
                        <Badge className="ml-auto flex-shrink-0 h-4 min-w-[16px] px-1 text-[10px] bg-primary text-white">
                          {conv.unreadCount}
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Message thread */}
        <div className={cn(
          "flex-1 flex flex-col bg-background",
          !selectedPhone ? "hidden md:flex" : "flex"
        )}>
          {!selectedPhone ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
              <MessageSquare className="w-16 h-16 text-muted-foreground/20" />
              <div>
                <p className="font-semibold text-muted-foreground">Select a conversation</p>
                <p className="text-sm text-muted-foreground/70 mt-1">Choose a client from the list to view messages</p>
              </div>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="p-4 border-b flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  onClick={() => setSelectedPhone(null)}
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary font-bold text-sm">
                  {(selectedConv?.clientName || selectedConv?.clientPhone || "?").charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-sm">
                    {selectedConv?.clientName || formatPhoneNumber(selectedPhone)}
                  </p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="w-3 h-3" />
                    {formatPhoneNumber(selectedPhone)}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgsLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground mt-8">No messages in this conversation yet.</div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn("flex", msg.direction === "outbound" ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[72%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                          msg.direction === "outbound"
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-muted text-foreground rounded-bl-sm"
                        )}
                      >
                        <p>{msg.body}</p>
                        <p className={cn(
                          "text-[10px] mt-1",
                          msg.direction === "outbound" ? "text-primary-foreground/70 text-right" : "text-muted-foreground"
                        )}>
                          {format(new Date(msg.createdAt), "h:mm a")}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply input */}
              <div className="p-4 border-t bg-background">
                <div className="flex gap-2">
                  <Input
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type a message..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && replyText.trim()) {
                        e.preventDefault();
                        sendReply.mutate();
                      }
                    }}
                    className="flex-1"
                  />
                  <Button
                    onClick={() => sendReply.mutate()}
                    disabled={!replyText.trim() || sendReply.isPending}
                    size="icon"
                    className="flex-shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">Press Enter to send · Twilio tokens apply</p>
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
