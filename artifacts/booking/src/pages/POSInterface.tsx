import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { useServices } from "@/hooks/use-services";
import { useServiceCategories, useAddonsForService } from "@/hooks/use-addons";
import { useStaffList } from "@/hooks/use-staff";
import { useSelectedStore } from "@/hooks/use-store";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, User, X, Sparkles, Loader2, Check, Heart, Printer, CheckCircle2, CreditCard, Trash2, Star, Gift, Mail, Banknote } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Service, Addon, Customer, Staff } from "@shared/schema";
import { ReceiptContent, useReceiptPrinter, type ReceiptData } from "@/components/Receipt";
import { useToast } from "@/hooks/use-toast";

const SWIPE_REVEAL_PX = 72;
const SWIPE_THRESHOLD_PX = 48;

function SwipeableCartItem({
  children,
  onDelete,
}: {
  children: React.ReactNode;
  onDelete: () => void;
}) {
  const [offsetX, setOffsetX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const isDragging = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isDragging.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (startX.current === null || startY.current === null) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = Math.abs(e.touches[0].clientY - startY.current);
    if (!isDragging.current && dy > 8) { startX.current = null; return; }
    if (Math.abs(dx) > 4) isDragging.current = true;
    if (!isDragging.current) return;
    const base = revealed ? -SWIPE_REVEAL_PX : 0;
    const raw = base + dx;
    const clamped = Math.max(-SWIPE_REVEAL_PX - 8, Math.min(0, raw));
    setOffsetX(clamped);
  }, [revealed]);

  const handleTouchEnd = useCallback(() => {
    if (startX.current === null) return;
    startX.current = null;
    if (offsetX < -SWIPE_THRESHOLD_PX) {
      setOffsetX(-SWIPE_REVEAL_PX);
      setRevealed(true);
    } else {
      setOffsetX(0);
      setRevealed(false);
    }
  }, [offsetX]);

  const collapse = useCallback(() => {
    setOffsetX(0);
    setRevealed(false);
  }, []);

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Red delete button revealed on swipe */}
      <div
        className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-red-500"
        style={{ width: SWIPE_REVEAL_PX }}
      >
        <button
          className="w-full h-full flex flex-col items-center justify-center gap-1 text-white active:bg-red-600 transition-colors"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="w-4 h-4" />
          <span className="text-[9px] font-bold uppercase tracking-wide">Remove</span>
        </button>
      </div>

      {/* Swipeable content */}
      <div
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isDragging.current ? "none" : "transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94)",
          willChange: "transform",
          backgroundColor: "hsl(var(--background))",
          position: "relative",
          zIndex: 1,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={revealed ? collapse : undefined}
      >
        {children}
      </div>
    </div>
  );
}

type TicketItem = { service: Service; addons: Addon[]; staffId: number | null };

const STRIPE_TEST_CARD_MAP: Record<string, { testPaymentMethod: string; cardBrand: string }> = {
  "4242424242424242": { testPaymentMethod: "pm_card_visa", cardBrand: "Visa" },
  "5555555555554444": { testPaymentMethod: "pm_card_mastercard", cardBrand: "Mastercard" },
  "378282246310005": { testPaymentMethod: "pm_card_amex", cardBrand: "American Express" },
  "6011111111111117": { testPaymentMethod: "pm_card_discover", cardBrand: "Discover" },
  "4000000000000002": { testPaymentMethod: "pm_card_chargeDeclined", cardBrand: "Declined test card" },
};

function parseStripeTestSwipe(input: string) {
  const cleaned = input.trim();
  const trackTwo = cleaned.match(/;(\d{12,19})=(\d{4})/);
  const trackOne = cleaned.match(/%B(\d{12,19})\^/);
  const keyedDigits = cleaned.replace(/\D/g, "");
  const cardNumber = trackTwo?.[1] || trackOne?.[1] || keyedDigits;
  const testCard = STRIPE_TEST_CARD_MAP[cardNumber];
  if (!testCard) return null;
  return {
    ...testCard,
    cardLast4: cardNumber.slice(-4),
  };
}

function TipScreen({
  amountDue,
  staffMember,
  onAddTip,
  onCancel,
}: {
  amountDue: number;
  staffMember: Staff | null;
  onAddTip: (tipAmount: number) => void;
  onCancel: () => void;
}) {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [isPercentMode, setIsPercentMode] = useState(false);

  const presets = [
    { label: "10%", pct: 0.1 },
    { label: "15%", pct: 0.15 },
    { label: "20%", pct: 0.2 },
  ];

  const handlePresetClick = (index: number) => {
    setSelectedPreset(index);
    setCustomAmount("");
  };

  const getTipAmount = (): number => {
    if (customAmount && customAmount !== "0") {
      const val = parseFloat(customAmount);
      if (isNaN(val)) return 0;
      return isPercentMode ? (amountDue * val) / 100 : val;
    }
    if (selectedPreset !== null) {
      return amountDue * presets[selectedPreset].pct;
    }
    return 0;
  };

  const tipAmount = getTipAmount();

  const staffInitials = staffMember
    ? staffMember.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "";

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
      <Card className="w-full max-w-md mx-4 p-0 overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b">
          <Button variant="ghost" size="icon" onClick={onCancel} data-testid="button-tip-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h2 className="font-bold text-lg">Add tip</h2>
        </div>

        <div className="p-6 space-y-6">
          <div className="text-center">
            <p className="text-4xl font-bold" data-testid="text-tip-amount-due">
              $ {amountDue.toFixed(2)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Amount Due</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {presets.map((preset, i) => (
              <Card
                key={i}
                className={cn(
                  "p-4 text-center cursor-pointer transition-all",
                  selectedPreset === i && !customAmount
                    ? "ring-2 ring-primary"
                    : "hover-elevate"
                )}
                onClick={() => handlePresetClick(i)}
                data-testid={`button-tip-preset-${preset.label}`}
              >
                <p className="font-semibold text-sm">{preset.label}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  $ {(amountDue * preset.pct).toFixed(2)}
                </p>
              </Card>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-center">Custom amount</p>
            <div className="flex items-center justify-center gap-3">
              <span className={cn("text-sm font-medium", isPercentMode && "text-muted-foreground")}>%</span>
              <Switch
                checked={!isPercentMode}
                onCheckedChange={(checked) => setIsPercentMode(!checked)}
                data-testid="switch-tip-mode"
              />
              <span className={cn("text-sm font-medium", !isPercentMode && "text-muted-foreground")}>$</span>
              <div className="relative w-[140px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {isPercentMode ? "%" : "$"}
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value);
                    setSelectedPreset(null);
                  }}
                  className="pl-7"
                  placeholder="0.00"
                  data-testid="input-tip-custom"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Received By</Label>
            <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/30">
              <Avatar className="w-9 h-9">
                {staffMember?.avatarUrl && (
                  <AvatarImage src={staffMember.avatarUrl} alt={staffMember.name} />
                )}
                <AvatarFallback className="text-xs">{staffInitials || "?"}</AvatarFallback>
              </Avatar>
              <span className="font-medium text-sm" data-testid="text-tip-staff-name">
                {staffMember?.name || "No staff assigned"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-3 p-4 border-t">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            data-testid="button-tip-cancel"
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={() => onAddTip(tipAmount)}
            data-testid="button-tip-confirm"
          >
            Add tip
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function POSInterface() {
  const navigate = useNavigate();
  const { selectedStore } = useSelectedStore();
  const { toast } = useToast();

  const params = new URLSearchParams(window.location.search);
  const clientIdParam = params.get("clientId");
  const staffIdParam = params.get("staffId");

  const [ticketItems, setTicketItems] = useState<TicketItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);
  const [showTipScreen, setShowTipScreen] = useState(false);
  const [tipAmount, setTipAmount] = useState(0);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
  const [loyaltyPointsRedeemed, setLoyaltyPointsRedeemed] = useState(0);
  const [pointsEarnedThisVisit, setPointsEarnedThisVisit] = useState(0);
  const [checkoutComplete, setCheckoutComplete] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [stripeReaderActive, setStripeReaderActive] = useState(false);
  const [stripeSwipeInput, setStripeSwipeInput] = useState("");
  const [stripeSwipeStatus, setStripeSwipeStatus] = useState("");
  const [stripeProcessing, setStripeProcessing] = useState(false);
  const [mobileView, setMobileView] = useState<"menu" | "cart">("menu");
  const [showSplitPayment, setShowSplitPayment] = useState(false);
  const [splitCash, setSplitCash] = useState("");
  const [splitCard, setSplitCard] = useState("");
  const [emailReceiptSending, setEmailReceiptSending] = useState(false);
  const { printReceipt } = useReceiptPrinter();

  const { data: services, isLoading: servicesLoading } = useServices();
  const { data: categories } = useServiceCategories();
  const { data: staffList } = useStaffList();

  const activeServiceId = activeItemIndex !== null && ticketItems[activeItemIndex]
    ? ticketItems[activeItemIndex].service.id
    : null;
  const { data: availableAddons, isLoading: addonsLoading } = useAddonsForService(activeServiceId);

  const { data: client } = useQuery<Customer | null>({
    queryKey: ["/api/customers", clientIdParam],
    queryFn: async () => {
      if (!clientIdParam || !selectedStore?.id) return null;
      try {
        const res = await fetch(`/api/customers?storeId=${selectedStore.id}`, { credentials: "include" });
        if (!res.ok) return null;
        const custs: Customer[] = await res.json();
        const found = custs.find(c => String(c.id) === String(clientIdParam)) || null;
        return found;
      } catch (err) {
        console.error("Error fetching client for POS:", err);
        return null;
      }
    },
    enabled: !!clientIdParam && !!selectedStore?.id,
  });

  const defaultStaffId = staffIdParam ? Number(staffIdParam) : (staffList && staffList.length > 0 ? staffList[0].id : null);

  const primaryStaffId = ticketItems.length > 0
    ? ticketItems[0].staffId || defaultStaffId
    : defaultStaffId;

  const primaryStaff = staffList?.find((s: Staff) => s.id === primaryStaffId) || null;

  const categoryNames = useMemo(() => {
    if (categories && categories.length > 0) {
      return Array.from(new Set(categories.map((c: any) => c.name))).sort() as string[];
    }
    if (!services) return [];
    const catSet = new Set<string>();
    services.forEach((s: Service) => catSet.add(s.category));
    return Array.from(catSet).sort();
  }, [services, categories]);

  const activeCategory = selectedCategory || (categoryNames.length > 0 ? categoryNames[0] : null);

  const filteredServices = useMemo(() => {
    if (!services) return [];
    if (!activeCategory) return services;
    return services.filter((s: Service) => s.category === activeCategory);
  }, [services, activeCategory]);

  const handleAddService = (service: Service) => {
    const newIndex = ticketItems.length;
    setTicketItems(prev => [...prev, { service, addons: [], staffId: defaultStaffId }]);
    setActiveItemIndex(newIndex);
  };

  const handleDismissAddons = () => {
    setActiveItemIndex(null);
  };

  const handleRemoveItem = (index: number) => {
    setTicketItems(prev => prev.filter((_, i) => i !== index));
    if (activeItemIndex === index) {
      setActiveItemIndex(null);
    } else if (activeItemIndex !== null && activeItemIndex > index) {
      setActiveItemIndex(activeItemIndex - 1);
    }
  };

  const handleToggleAddon = (addon: Addon) => {
    if (activeItemIndex === null) return;
    setTicketItems(prev => prev.map((item, i) => {
      if (i !== activeItemIndex) return item;
      const exists = item.addons.find(a => a.id === addon.id);
      return {
        ...item,
        addons: exists
          ? item.addons.filter(a => a.id !== addon.id)
          : [...item.addons, addon],
      };
    }));
  };

  const LOYALTY_POINTS_PER_DOLLAR = 1;
  const LOYALTY_REDEEM_THRESHOLD = 500;
  const LOYALTY_REDEEM_VALUE = 10;

  const ticketTotal = ticketItems.reduce((sum, item) => {
    const svcPrice = Number(item.service.price);
    const addonPrice = item.addons.reduce((s, a) => s + Number(a.price), 0);
    return sum + svcPrice + addonPrice;
  }, 0);
  const ticketDuration = ticketItems.reduce((sum, item) => {
    const addonDur = item.addons.reduce((s, a) => s + a.duration, 0);
    return sum + item.service.duration + addonDur;
  }, 0);
  const grandTotal = Math.max(0, ticketTotal + tipAmount - loyaltyDiscount);

  const clientPoints = (client as any)?.loyaltyPoints ?? 0;
  const redeemableSets = client ? Math.floor(clientPoints / LOYALTY_REDEEM_THRESHOLD) : 0;
  const canRedeemLoyalty = redeemableSets > 0 && ticketItems.length > 0;

  const handleRedeemLoyalty = () => {
    if (!canRedeemLoyalty) return;
    const maxDiscount = redeemableSets * LOYALTY_REDEEM_VALUE;
    const discount = Math.min(maxDiscount, ticketTotal + tipAmount);
    const pointsUsed = Math.ceil(discount / LOYALTY_REDEEM_VALUE) * LOYALTY_REDEEM_THRESHOLD;
    setLoyaltyDiscount(discount);
    setLoyaltyPointsRedeemed(pointsUsed);
    toast({ title: "Loyalty points applied", description: `$${discount.toFixed(2)} discount applied (${pointsUsed} pts).` });
  };

  const handleClearLoyalty = () => {
    setLoyaltyDiscount(0);
    setLoyaltyPointsRedeemed(0);
  };

  const handleAddTip = (amount: number) => {
    setTipAmount(amount);
    setShowTipScreen(false);
  };

  const handleCheckout = async (paymentMethod = "Card", transactionId?: string) => {
    const now = new Date();
    const txnId = transactionId || Math.random().toString(36).substring(2, 10).toUpperCase();
    const data: ReceiptData = {
      store: selectedStore,
      client: client || null,
      staff: primaryStaff,
      items: ticketItems,
      subtotal: ticketTotal,
      tipAmount,
      grandTotal,
      paymentMethod,
      transactionId: txnId,
      dateStr: now.toLocaleDateString(),
      timeStr: now.toLocaleTimeString(),
    };
    setReceiptData(data);
    setCheckoutComplete(true);
    printReceipt(data);

    // Auto-award loyalty points (1 pt per dollar paid) if a client is attached
    if (client && selectedStore?.id) {
      const earned = Math.floor(grandTotal * LOYALTY_POINTS_PER_DOLLAR);
      if (earned > 0) {
        setPointsEarnedThisVisit(earned);
        try {
          await fetch("/api/loyalty/adjust", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerId: client.id,
              storeId: selectedStore.id,
              type: "earn",
              points: earned,
              description: `POS checkout — ${earned} pt${earned !== 1 ? "s" : ""} earned`,
            }),
          });
        } catch (err) {
          console.error("Loyalty earn failed:", err);
        }
      }
      // Record redemption if points were used
      if (loyaltyPointsRedeemed > 0) {
        try {
          await fetch("/api/loyalty/adjust", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerId: client.id,
              storeId: selectedStore.id,
              type: "redeem",
              points: -loyaltyPointsRedeemed,
              description: `POS redemption — $${loyaltyDiscount.toFixed(2)} discount`,
            }),
          });
        } catch (err) {
          console.error("Loyalty redeem record failed:", err);
        }
      }
    }
  };

  const handleStripeSwipeInput = async (value: string) => {
    setStripeSwipeInput(value);
    if (!value.includes("?") && !value.includes("\n") && value.replace(/\D/g, "").length < 15) return;

    const parsed = parseStripeTestSwipe(value);
    setStripeSwipeInput("");

    if (!parsed) {
      setStripeSwipeStatus("Only Stripe test cards are accepted here.");
      return;
    }

    if (!selectedStore?.id) {
      setStripeSwipeStatus("Select a store before taking a Stripe payment.");
      return;
    }

    try {
      setStripeProcessing(true);
      setStripeSwipeStatus(`Processing ${parsed.cardBrand} ending in ${parsed.cardLast4}...`);
      const res = await fetch(`/api/stripe-settings/${selectedStore.id}/test-magstripe-payment`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: grandTotal,
          testPaymentMethod: parsed.testPaymentMethod,
          appointmentId: null,
          cardLast4: parsed.cardLast4,
          cardBrand: parsed.cardBrand,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Stripe test payment failed");
      }

      setStripeReaderActive(false);
      setStripeSwipeStatus("");
      toast({
        title: "Stripe test payment approved",
        description: `${parsed.cardBrand} ending in ${parsed.cardLast4} charged for $${(data.amount || grandTotal).toFixed(2)}.`,
      });
      handleCheckout("Stripe Test", data.paymentIntentId);
    } catch (error: any) {
      setStripeSwipeStatus(error.message || "Stripe test payment failed.");
      toast({ title: "Stripe payment failed", description: error.message || "Try another test card.", variant: "destructive" });
    } finally {
      setStripeProcessing(false);
    }
  };

  const handleNewTransaction = () => {
    setTicketItems([]);
    setTipAmount(0);
    setLoyaltyDiscount(0);
    setLoyaltyPointsRedeemed(0);
    setPointsEarnedThisVisit(0);
    setCheckoutComplete(false);
    setReceiptData(null);
    setActiveItemIndex(null);
    setSelectedCategory(null);
    setShowSplitPayment(false);
    setSplitCash("");
    setSplitCard("");
  };

  const handleSplitCheckout = () => {
    const cashAmt = parseFloat(splitCash) || 0;
    const cardAmt = parseFloat(splitCard) || 0;
    const combined = cashAmt + cardAmt;
    if (Math.abs(combined - grandTotal) > 0.01) {
      toast({ title: "Split amounts don't match total", description: `Cash + Card must equal $${grandTotal.toFixed(2)}`, variant: "destructive" });
      return;
    }
    setShowSplitPayment(false);
    handleCheckout(`Cash:${cashAmt.toFixed(2)},Card:${cardAmt.toFixed(2)}`);
  };

  const handleEmailReceipt = async () => {
    if (!receiptData || !client?.email || !selectedStore?.id) return;
    setEmailReceiptSending(true);
    try {
      const res = await fetch("/api/pos/email-receipt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStore.id,
          email: client.email,
          storeName: selectedStore.name,
          clientName: client.name?.split(" ")[0] || "there",
          items: receiptData.items.map(i => ({
            name: i.service.name,
            price: Number(i.service.price),
            addons: i.addons.map(a => ({ name: a.name, price: Number(a.price) })),
          })),
          subtotal: receiptData.subtotal,
          tipAmount: receiptData.tipAmount,
          grandTotal: receiptData.grandTotal,
          paymentMethod: receiptData.paymentMethod,
          transactionId: receiptData.transactionId,
          dateStr: receiptData.dateStr,
          timeStr: receiptData.timeStr,
        }),
      });
      if (res.ok) {
        toast({ title: "Receipt sent!", description: `Emailed to ${client.email}` });
      } else {
        const d = await res.json();
        toast({ title: "Couldn't send receipt", description: d.message || "Please try again", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to send email receipt", variant: "destructive" });
    } finally {
      setEmailReceiptSending(false);
    }
  };

  if (checkoutComplete && receiptData) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-start bg-background overflow-y-auto">
        <div className="w-full max-w-md mx-auto py-8 px-4 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold" data-testid="text-checkout-success">Payment Complete</h1>
            <p className="text-muted-foreground">Transaction #{receiptData.transactionId}</p>
          </div>
          {(pointsEarnedThisVisit > 0 || loyaltyPointsRedeemed > 0) && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 font-semibold text-sm text-primary">
                <Star className="w-4 h-4 fill-primary" />
                Loyalty Points
              </div>
              {pointsEarnedThisVisit > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Points earned this visit</span>
                  <span className="font-bold text-green-600 dark:text-green-400">+{pointsEarnedThisVisit} pts</span>
                </div>
              )}
              {loyaltyPointsRedeemed > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Points redeemed</span>
                  <span className="font-bold text-orange-500">−{loyaltyPointsRedeemed} pts</span>
                </div>
              )}
              {client && (
                <div className="flex items-center justify-between text-sm border-t pt-2 mt-1">
                  <span className="text-muted-foreground">New balance</span>
                  <span className="font-bold">{Math.max(0, clientPoints + pointsEarnedThisVisit - loyaltyPointsRedeemed)} pts</span>
                </div>
              )}
            </div>
          )}

          <Card className="p-0 overflow-hidden">
            <div className="flex items-center justify-center bg-muted/30 py-4">
              <ReceiptContent data={receiptData} />
            </div>
          </Card>

          <div className="flex flex-col gap-3">
            <Button
              onClick={() => printReceipt(receiptData)}
              className="w-full"
              data-testid="button-print-receipt"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print Receipt
            </Button>
            {client?.email && (
              <Button
                variant="outline"
                className="w-full"
                onClick={handleEmailReceipt}
                disabled={emailReceiptSending}
                data-testid="button-email-receipt"
              >
                {emailReceiptSending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4 mr-2" />
                )}
                Email Receipt to {client.email}
              </Button>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={handleNewTransaction}
                data-testid="button-new-transaction"
              >
                New Sale
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate("/dashboard")}
                data-testid="button-back-dashboard"
              >
                Dashboard
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── MOBILE LAYOUT ── */}
      <div className="md:hidden flex flex-col h-screen bg-background">
        {showTipScreen && (
          <TipScreen
            amountDue={ticketTotal}
            staffMember={primaryStaff}
            onAddTip={handleAddTip}
            onCancel={() => setShowTipScreen(false)}
          />
        )}

        {/* Tab bar */}
        <div className="flex border-b flex-shrink-0">
          <button
            onClick={() => setMobileView("menu")}
            className={cn(
              "flex-1 py-3 text-sm font-semibold border-b-2 transition-colors",
              mobileView === "menu" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            )}
          >
            Menu
          </button>
          <button
            onClick={() => setMobileView("cart")}
            className={cn(
              "flex-1 py-3 text-sm font-semibold border-b-2 transition-colors",
              mobileView === "cart" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
            )}
          >
            Cart
            {ticketItems.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold align-middle">
                {ticketItems.length}
              </span>
            )}
          </button>
        </div>

        {mobileView === "menu" && (
          <>
            {/* Category chips - horizontal scroll */}
            <div className="flex overflow-x-auto border-b flex-shrink-0 px-3 py-2 gap-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              <button
                onClick={() => navigate("/client-lookup")}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-medium flex-shrink-0 text-muted-foreground"
              >
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
              {categoryNames.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0 transition-colors",
                    activeCategory === cat
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Services / add-ons */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeItemIndex !== null && availableAddons && availableAddons.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">
                      Add-ons for {ticketItems[activeItemIndex]?.service.name}
                    </h2>
                    <Button variant="outline" size="sm" onClick={handleDismissAddons}>Done</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {availableAddons.map((addon: Addon) => {
                      const isSelected = ticketItems[activeItemIndex]?.addons.some(a => a.id === addon.id) || false;
                      return (
                        <Card
                          key={addon.id}
                          className={cn("p-3 cursor-pointer transition-all", isSelected ? "ring-2 ring-primary" : "hover-elevate")}
                          onClick={() => handleToggleAddon(addon)}
                        >
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-start justify-between gap-1">
                              <h3 className="font-semibold text-xs leading-tight">{addon.name}</h3>
                              {isSelected && (
                                <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                                  <Check className="w-2.5 h-2.5 text-primary-foreground" />
                                </div>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-1 mt-auto">
                              <span className="font-bold text-xs">+${Number(addon.price).toFixed(2)}</span>
                              <Badge variant="secondary" className="text-[9px]">+{addon.duration}m</Badge>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ) : servicesLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredServices.map((service: Service) => (
                    <Card
                      key={service.id}
                      className="p-3 cursor-pointer hover-elevate active:scale-95 transition-transform"
                      onClick={() => { handleAddService(service); setMobileView("cart"); }}
                    >
                      <div className="flex flex-col gap-1.5">
                        <h3 className="font-semibold text-xs leading-tight">{service.name}</h3>
                        <div className="flex items-center justify-between gap-1 mt-auto pt-0.5">
                          <span className="font-bold text-xs">${Number(service.price).toFixed(2)}</span>
                          <Badge variant="secondary" className="text-[9px]">{service.duration}m</Badge>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {mobileView === "cart" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Client selector */}
            <div
              className="p-4 border-b flex items-center gap-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigate("/client-lookup")}
            >
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <span className="text-sm font-semibold uppercase">{client ? client.name : "GUEST"}</span>
              </div>
              <User className="w-4 h-4 text-muted-foreground" />
            </div>

            {primaryStaff && (
              <div className="px-4 py-2 border-b flex items-center gap-2">
                <Avatar className="w-6 h-6">
                  {primaryStaff.avatarUrl && <AvatarImage src={primaryStaff.avatarUrl} alt={primaryStaff.name} />}
                  <AvatarFallback className="text-[10px]">
                    {primaryStaff.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground">with</span>
                <span className="text-xs font-medium">{primaryStaff.name}</span>
              </div>
            )}

            {/* Cart items */}
            <div className="flex-1 overflow-y-auto p-4">
              {ticketItems.length > 0 ? (
                <div className="space-y-2">
                  {ticketItems.map((item, index) => (
                    <SwipeableCartItem key={index} onDelete={() => handleRemoveItem(index)}>
                      <div className="py-2 px-1">
                        <div className="flex items-start justify-between gap-2">
                          <div
                            className="flex-1 cursor-pointer"
                            onClick={() => { setActiveItemIndex(index); setMobileView("menu"); }}
                          >
                            <h4 className={cn("font-semibold text-sm", activeItemIndex === index && "text-primary")}>{item.service.name}</h4>
                            <p className="text-xs text-muted-foreground">{item.service.duration} min</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">${Number(item.service.price).toFixed(2)}</span>
                            <button
                              onClick={() => handleRemoveItem(index)}
                              className="text-muted-foreground p-1 -mr-1"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {item.addons.length > 0 && (
                          <div className="space-y-1 pl-3 mt-1.5 border-l-2 border-muted">
                            {item.addons.map((addon) => (
                              <div key={addon.id} className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium">+{addon.name}</span>
                                <span className="text-xs font-medium">${Number(addon.price).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </SwipeableCartItem>
                  ))}
                  <p className="text-center text-[10px] text-muted-foreground/50 mt-1">Swipe left to remove</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-32 text-center">
                  <Sparkles className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">Add services from the Menu tab</p>
                </div>
              )}
            </div>

            {/* Checkout footer */}
            <div className="border-t p-4 space-y-3">
              {/* Loyalty points balance + redeem */}
              {client && clientPoints > 0 && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Star className="w-3.5 h-3.5 text-primary fill-primary" />
                      <span className="text-xs font-semibold text-primary">{clientPoints} pts</span>
                      {loyaltyDiscount === 0 && redeemableSets > 0 && (
                        <span className="text-xs text-muted-foreground">· can redeem</span>
                      )}
                    </div>
                    {loyaltyDiscount > 0 ? (
                      <button onClick={handleClearLoyalty} className="text-[10px] font-semibold text-destructive underline">Remove</button>
                    ) : (
                      canRedeemLoyalty && (
                        <button onClick={handleRedeemLoyalty} className="text-[10px] font-semibold text-primary underline flex items-center gap-1">
                          <Gift className="w-3 h-3" /> Redeem
                        </button>
                      )
                    )}
                  </div>
                  {loyaltyDiscount > 0 && (
                    <p className="text-[10px] text-green-600 dark:text-green-400 font-medium mt-0.5">−${loyaltyDiscount.toFixed(2)} discount applied</p>
                  )}
                </div>
              )}
              {tipAmount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tip</span>
                  <span className="font-medium">${tipAmount.toFixed(2)}</span>
                </div>
              )}
              {loyaltyDiscount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Loyalty discount</span>
                  <span className="font-medium text-green-600 dark:text-green-400">−${loyaltyDiscount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold">Total</span>
                  {ticketDuration > 0 && <p className="text-xs text-muted-foreground">{ticketDuration} min</p>}
                </div>
                <span className="font-bold text-lg">${grandTotal.toFixed(2)}</span>
              </div>
              {showSplitPayment && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-semibold">Split Payment — Total: ${grandTotal.toFixed(2)}</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">Cash</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={splitCash}
                      onChange={e => { setSplitCash(e.target.value); setSplitCard((grandTotal - (parseFloat(e.target.value) || 0)).toFixed(2)); }}
                      placeholder="0.00"
                      className="mt-0.5"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">Card</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={splitCard}
                      onChange={e => { setSplitCard(e.target.value); setSplitCash((grandTotal - (parseFloat(e.target.value) || 0)).toFixed(2)); }}
                      placeholder="0.00"
                      className="mt-0.5"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={handleSplitCheckout}>Confirm Split</Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowSplitPayment(false); setSplitCash(""); setSplitCard(""); }}>Cancel</Button>
                </div>
              </div>
            )}
          <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-shrink-0"
                  disabled={ticketItems.length === 0}
                  onClick={() => setShowTipScreen(true)}
                >
                  <Heart className="w-4 h-4 mr-1" /> Tip
                </Button>
                <Button
                  variant="outline"
                  className="flex-shrink-0"
                  disabled={ticketItems.length === 0}
                  onClick={() => { setShowSplitPayment(!showSplitPayment); setSplitCash(""); setSplitCard(""); }}
                  title="Split payment between cash and card"
                >
                  <Banknote className="w-4 h-4" />
                </Button>
                <Button
                  className="flex-1"
                  size="lg"
                  disabled={ticketItems.length === 0}
                  onClick={() => handleCheckout()}
                >
                  Checkout — ${grandTotal.toFixed(2)}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── DESKTOP LAYOUT ── */}
      <div className="hidden md:flex h-screen w-screen bg-background">
      {showTipScreen && (
        <TipScreen
          amountDue={ticketTotal}
          staffMember={primaryStaff}
          onAddTip={handleAddTip}
          onCancel={() => setShowTipScreen(false)}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[180px] flex-shrink-0 border-r bg-card flex flex-col">
          <div className="p-4 border-b flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate("/client-lookup")} data-testid="button-back-lookup">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <span className="font-semibold text-lg">Services</span>
          </div>
          <nav className="flex-1 overflow-y-auto py-2">
            {categoryNames.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "w-full text-left px-5 py-3 text-sm font-medium transition-colors",
                  activeCategory === cat
                    ? "text-primary border-l-[3px] border-primary bg-primary/5"
                    : "text-muted-foreground border-l-[3px] border-transparent"
                )}
                data-testid={`pos-category-${cat.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {cat}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeItemIndex !== null && availableAddons && availableAddons.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">
                    Add-ons for {ticketItems[activeItemIndex]?.service.name}
                  </h2>
                  <p className="text-sm text-muted-foreground">Select optional extras</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDismissAddons}
                  data-testid="button-done-addons"
                >
                  Done
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {availableAddons.map((addon: Addon) => {
                  const isSelected = ticketItems[activeItemIndex]?.addons.some(a => a.id === addon.id) || false;
                  return (
                    <Card
                      key={addon.id}
                      className={cn(
                        "p-4 cursor-pointer transition-all",
                        isSelected ? "ring-2 ring-primary shadow-md" : "hover-elevate"
                      )}
                      onClick={() => handleToggleAddon(addon)}
                      data-testid={`pos-addon-${addon.id}`}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-sm leading-tight">{addon.name}</h3>
                          {isSelected && (
                            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                              <Check className="w-3 h-3 text-primary-foreground" />
                            </div>
                          )}
                        </div>
                        {addon.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{addon.description}</p>
                        )}
                        <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                          <span className="font-bold text-sm">+${Number(addon.price).toFixed(2)}</span>
                          <Badge variant="secondary" className="no-default-active-elevate text-[10px]">
                            +{addon.duration}m
                          </Badge>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ) : servicesLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredServices.map((service: Service) => (
                  <Card
                    key={service.id}
                    className="p-4 cursor-pointer hover-elevate"
                    onClick={() => handleAddService(service)}
                    data-testid={`pos-service-${service.id}`}
                  >
                    <div className="flex flex-col gap-2">
                      <h3 className="font-semibold text-sm leading-tight">{service.name}</h3>
                      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                        <span className="font-bold text-sm">${Number(service.price).toFixed(2)}</span>
                        <Badge variant="secondary" className="no-default-active-elevate text-[10px]">
                          {service.duration}m
                        </Badge>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="w-[320px] flex-shrink-0 border-l bg-card flex flex-col" data-testid="pos-ticket-panel">
        <div 
          className="p-4 border-b flex items-center gap-3 cursor-pointer hover:bg-muted/50 transition-colors" 
          onClick={() => navigate("/client-lookup")}
          data-testid="pos-client-selector"
        >
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden">
            <User className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <span className="text-sm font-semibold uppercase" data-testid="pos-client-name">
              {client ? client.name : "GUEST"}
            </span>
          </div>
          <User className="w-4 h-4 text-muted-foreground" />
        </div>

        {primaryStaff && (
          <div className="px-4 py-2 border-b flex items-center gap-2">
            <Avatar className="w-6 h-6">
              {primaryStaff.avatarUrl && <AvatarImage src={primaryStaff.avatarUrl} alt={primaryStaff.name} />}
              <AvatarFallback className="text-[10px]">
                {primaryStaff.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground">with</span>
            <span className="text-xs font-medium" data-testid="pos-staff-name">{primaryStaff.name}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {ticketItems.length > 0 ? (
            <div className="space-y-3">
              {ticketItems.map((item, index) => (
                <div key={index} data-testid={`pos-ticket-item-${index}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 cursor-pointer" onClick={() => setActiveItemIndex(index)}>
                      <h4 className={cn("font-semibold text-sm", activeItemIndex === index && "text-primary")}>{item.service.name}</h4>
                      <p className="text-xs text-muted-foreground">{item.service.duration} min</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">${Number(item.service.price).toFixed(2)}</span>
                      <button onClick={() => handleRemoveItem(index)} className="text-muted-foreground">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  {item.addons.length > 0 && (
                    <div className="space-y-1 pl-3 mt-1 border-l-2 border-muted">
                      {item.addons.map((addon) => (
                        <div key={addon.id} className="flex items-center justify-between gap-2" data-testid={`pos-ticket-addon-${addon.id}`}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">+</span>
                            <span className="text-xs font-medium">{addon.name}</span>
                          </div>
                          <span className="text-xs font-medium">${Number(addon.price).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <Sparkles className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Start adding services...</p>
            </div>
          )}
        </div>

        <div className="border-t p-4 space-y-3">
          {/* Desktop loyalty points balance + redeem */}
          {client && clientPoints > 0 && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-primary fill-primary" />
                  <span className="text-xs font-semibold text-primary">{clientPoints} pts</span>
                  {loyaltyDiscount === 0 && redeemableSets > 0 && (
                    <span className="text-xs text-muted-foreground">· can redeem</span>
                  )}
                </div>
                {loyaltyDiscount > 0 ? (
                  <button onClick={handleClearLoyalty} className="text-[10px] font-semibold text-destructive underline">Remove</button>
                ) : (
                  canRedeemLoyalty && (
                    <button onClick={handleRedeemLoyalty} className="text-[10px] font-semibold text-primary underline flex items-center gap-1">
                      <Gift className="w-3 h-3" /> Redeem
                    </button>
                  )
                )}
              </div>
              {loyaltyDiscount > 0 && (
                <p className="text-[10px] text-green-600 dark:text-green-400 font-medium mt-0.5">−${loyaltyDiscount.toFixed(2)} discount applied</p>
              )}
            </div>
          )}
          {tipAmount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tip</span>
              <span className="font-medium" data-testid="pos-tip-amount">${tipAmount.toFixed(2)}</span>
            </div>
          )}
          {loyaltyDiscount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Loyalty discount</span>
              <span className="font-medium text-green-600 dark:text-green-400">−${loyaltyDiscount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold">Total</span>
              {ticketDuration > 0 && <p className="text-xs text-muted-foreground">{ticketDuration} min</p>}
            </div>
            <span className="font-bold text-lg" data-testid="pos-ticket-total">${grandTotal.toFixed(2)}</span>
          </div>
          {showSplitPayment && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-sm font-semibold">Split Payment — Total: ${grandTotal.toFixed(2)}</p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Cash</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={splitCash}
                    onChange={e => { setSplitCash(e.target.value); setSplitCard((grandTotal - (parseFloat(e.target.value) || 0)).toFixed(2)); }}
                    placeholder="0.00"
                    className="mt-0.5"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Card</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={splitCard}
                    onChange={e => { setSplitCard(e.target.value); setSplitCash((grandTotal - (parseFloat(e.target.value) || 0)).toFixed(2)); }}
                    placeholder="0.00"
                    className="mt-0.5"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={handleSplitCheckout} data-testid="button-split-confirm">Confirm Split</Button>
                <Button size="sm" variant="outline" onClick={() => { setShowSplitPayment(false); setSplitCash(""); setSplitCard(""); }}>Cancel</Button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-shrink-0"
              disabled={ticketItems.length === 0}
              onClick={() => setShowTipScreen(true)}
              data-testid="button-pos-tip"
            >
              <Heart className="w-4 h-4 mr-1" />
              Tip
            </Button>
            <Button
              variant="outline"
              className="flex-shrink-0"
              disabled={ticketItems.length === 0}
              onClick={() => { setShowSplitPayment(!showSplitPayment); setSplitCash(""); setSplitCard(""); }}
              title="Split payment between cash and card"
              data-testid="button-pos-split"
            >
              <Banknote className="w-4 h-4" />
            </Button>
            <Button
              className="flex-1"
              size="lg"
              disabled={ticketItems.length === 0}
              onClick={() => handleCheckout()}
              data-testid="button-pos-checkout"
            >
              Checkout - ${grandTotal.toFixed(2)}
            </Button>
          </div>
          <Button
            variant="outline"
            className="w-full"
            disabled={ticketItems.length === 0 || stripeProcessing}
            onClick={() => {
              setStripeReaderActive(true);
              setStripeSwipeInput("");
              setStripeSwipeStatus("Swipe a Stripe test card now.");
            }}
            data-testid="button-pos-stripe-test-swipe"
          >
            <CreditCard className="w-4 h-4 mr-2" />
            Stripe Test Swipe
          </Button>
          {stripeReaderActive && (
            <div className="rounded-md border p-3 space-y-2 bg-indigo-50 dark:bg-indigo-950/20">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Stripe test swipe</p>
                  <p className="text-xs text-muted-foreground">Amount: ${grandTotal.toFixed(2)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStripeReaderActive(false);
                    setStripeSwipeInput("");
                    setStripeSwipeStatus("");
                  }}
                  disabled={stripeProcessing}
                  data-testid="button-pos-cancel-stripe-swipe"
                >
                  Cancel
                </Button>
              </div>
              <Input
                type="password"
                autoFocus
                value={stripeSwipeInput}
                onChange={(e) => handleStripeSwipeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleStripeSwipeInput(stripeSwipeInput + "\n");
                  }
                }}
                disabled={stripeProcessing}
                placeholder={stripeProcessing ? "Processing..." : "Swipe reader input lands here"}
                data-testid="input-pos-stripe-test-swipe"
              />
              <p className="text-xs text-muted-foreground">
                {stripeSwipeStatus || "Use a Stripe test card track, like Visa 4242."}
              </p>
            </div>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
