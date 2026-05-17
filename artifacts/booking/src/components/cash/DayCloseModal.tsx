import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Clock } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CashDrawerSessionWithActions } from "@shared/schema";

interface DayCloseModalProps {
  open: boolean;
  onClose: () => void;
  storeId: number;
  userName: string;
}

interface OpenTicket {
  id: number;
  customerName?: string | null;
  staffName?: string | null;
  serviceName?: string | null;
  startedAt?: string | null;
}

function fmt(n: number) {
  return `$ ${n.toFixed(2)}`;
}

function DiffCell({ value }: { value: number }) {
  return (
    <span className="text-cyan-600 font-medium tabular-nums">
      {value >= 0 ? `$ ${value.toFixed(2)}` : `-$ ${Math.abs(value).toFixed(2)}`}
    </span>
  );
}

export function DayCloseModal({ open, onClose, storeId, userName }: DayCloseModalProps) {
  const { toast } = useToast();
  const [pettyCount, setPettyCount] = useState("");
  const [bankDeposit, setBankDeposit] = useState("");
  const [note, setNote] = useState("");
  const [serverBlockedTickets, setServerBlockedTickets] = useState<OpenTicket[]>([]);

  const { data: openSession, isLoading: sessionLoading } = useQuery<CashDrawerSessionWithActions | null>({
    queryKey: [`/api/cash-drawer/open?storeId=${storeId}`],
    enabled: open && !!storeId,
  });

  const { data: liveZReport } = useQuery<any>({
    queryKey: [`/api/cash-drawer/sessions/${openSession?.id}/z-report`],
    enabled: open && !!openSession?.id,
  });

  const today = new Date();
  const fromParam = new Date(today);
  fromParam.setHours(0, 0, 0, 0);
  const toParam = new Date(today);
  toParam.setHours(23, 59, 59, 999);

  const { data: todayAppointments, isLoading: aptsLoading } = useQuery<any[]>({
    queryKey: [`/api/appointments?storeId=${storeId}&from=${fromParam.toISOString()}&to=${toParam.toISOString()}`],
    queryFn: () =>
      fetch(
        `/api/appointments?storeId=${storeId}&from=${fromParam.toISOString()}&to=${toParam.toISOString()}`,
        { credentials: "include" },
      ).then((r) => r.json()),
    enabled: open && !!storeId,
    staleTime: 30_000,
  });

  const openTickets: OpenTicket[] = (todayAppointments ?? [])
    .filter((apt: any) => apt.status === "started")
    .map((apt: any) => ({
      id: apt.id,
      customerName: apt.customer?.name ?? apt.customerName ?? null,
      staffName: apt.staff?.name ?? apt.staffName ?? null,
      serviceName: apt.service?.name ?? apt.serviceName ?? null,
      startedAt: apt.startedAt ?? apt.date ?? null,
    }));

  const blockedTickets = serverBlockedTickets.length > 0 ? serverBlockedTickets : openTickets;
  const isBlocked = blockedTickets.length > 0;

  const closeDrawerMutation = useMutation({
    mutationFn: async () => {
      const petty = parseFloat(pettyCount || "0");
      const bank = parseFloat(bankDeposit || "0");
      const noteText = [
        note.trim(),
        bank > 0 ? `Bank Deposit: $${bank.toFixed(2)}` : "",
      ].filter(Boolean).join(" | ");

      const res = await apiRequest("POST", `/api/cash-drawer/sessions/${openSession!.id}/close`, {
        closingBalance: petty.toFixed(2),
        reportedCardSales: null,
        closedBy: userName,
        notes: noteText || null,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code === "UNPAID_TICKETS" && Array.isArray(body.unpaidTickets)) {
          setServerBlockedTickets(body.unpaidTickets);
        }
        throw new Error(body.message || "Could not close the day");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/cash-drawer/open?storeId=${storeId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/cash-drawer/sessions?storeId=${storeId}`] });
      toast({ title: "Day closed", description: "End of Day report submitted successfully." });
      setPettyCount("");
      setBankDeposit("");
      setNote("");
      setServerBlockedTickets([]);
      onClose();
    },
    onError: (err: any) => {
      if (!serverBlockedTickets.length) {
        toast({ title: "Error", description: err.message || "Could not close the day", variant: "destructive" });
      }
    },
  });

  const handleSave = () => {
    if (!openSession || isBlocked) return;
    closeDrawerMutation.mutate();
  };

  const isLoading = sessionLoading || aptsLoading;

  // ── Derived values ────────────────────────────────────────────────────────
  const previousFloat = Number(openSession?.openingBalance ?? 0);
  const pettyCountNum = parseFloat(pettyCount || "0");
  const pettyDiff = pettyCountNum;

  const totalExpected = previousFloat;
  const totalCounted = previousFloat + pettyCountNum;
  const totalDiff = totalCounted - totalExpected;

  const bankDepositNum = parseFloat(bankDeposit || "0");
  const cashRemaining = totalCounted - bankDepositNum;

  // Non-cash rows from Z-report (all payment types except cash)
  const nonCashRows = Object.entries(liveZReport?.paymentBreakdown ?? {})
    .filter(([method]) => method !== "cash")
    .map(([method, amount]) => ({
      label: method.charAt(0).toUpperCase() + method.slice(1),
      expected: amount as number,
      counted: amount as number,
      diff: 0,
    }));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-5 py-4 border-b">
          <DialogTitle className="text-base font-semibold text-gray-900">End Of Day</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
        ) : !openSession ? (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                No open register session found. Open the register first before closing the day.
              </p>
            </div>
            <Button className="w-full" variant="outline" onClick={onClose}>Close</Button>
          </div>
        ) : isBlocked ? (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3">
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-800">
                <p className="font-semibold mb-1">
                  {blockedTickets.length} open ticket{blockedTickets.length === 1 ? "" : "s"} must be checked out first
                </p>
                <p className="text-red-700 text-xs">
                  Cash out all in-progress bookings before closing the day.
                </p>
              </div>
            </div>
            <ul className="space-y-2">
              {blockedTickets.map((ticket) => (
                <li key={ticket.id} className="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <Clock className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                  <div className="text-xs leading-snug">
                    <p className="font-medium text-gray-900">
                      {ticket.customerName ?? "Walk-in"}
                      {ticket.serviceName ? ` — ${ticket.serviceName}` : ""}
                    </p>
                    {ticket.staffName && (
                      <p className="text-gray-500">with {ticket.staffName}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Button className="w-full" variant="outline" onClick={onClose}>
              Go back and cash out
            </Button>
          </div>
        ) : (
          <div className="overflow-y-auto max-h-[80vh]">
            {/* Non-cash Transactions */}
            <div className="px-5 pt-4 pb-2">
              <p className="text-sm font-semibold text-gray-800 mb-2">Non-cash Transactions</p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-1.5 pr-3 font-medium text-gray-600 w-1/4">Payment Type</th>
                    <th className="text-right py-1.5 px-3 font-medium text-gray-600 w-1/4">Expected</th>
                    <th className="text-right py-1.5 px-3 font-medium text-gray-600 w-1/4">Counted</th>
                    <th className="text-right py-1.5 pl-3 font-medium text-gray-600 w-1/4">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {nonCashRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-gray-400 italic text-xs">No non-cash transactions</td>
                    </tr>
                  ) : nonCashRows.map((row) => (
                    <tr key={row.label} className="border-b border-gray-100">
                      <td className="py-2 pr-3 text-gray-700">{row.label}</td>
                      <td className="py-2 px-3 text-right text-gray-700 tabular-nums">{fmt(row.expected)}</td>
                      <td className="py-2 px-3 text-right text-gray-700 tabular-nums">{fmt(row.counted)}</td>
                      <td className="py-2 pl-3 text-right"><DiffCell value={row.diff} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mx-5 border-t border-gray-200 my-1" />

            {/* Cash Transactions */}
            <div className="px-5 pt-2 pb-3">
              <p className="text-sm font-semibold text-gray-800 mb-2">Cash Transactions</p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-1.5 pr-3 font-medium text-gray-600 w-1/4">Payment Type</th>
                    <th className="text-right py-1.5 px-3 font-medium text-gray-600 w-1/4">Expected</th>
                    <th className="text-right py-1.5 px-3 font-medium text-gray-600 w-1/4">Counted</th>
                    <th className="text-right py-1.5 pl-3 font-medium text-gray-600 w-1/4">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Petty Cash row */}
                  <tr className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-700">Petty Cash</td>
                    <td className="py-2 px-3 text-right text-gray-400">—</td>
                    <td className="py-2 px-3 text-right">
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={pettyCount}
                        onChange={(e) => setPettyCount(e.target.value.replace(/[^0-9.]/g, ""))}
                        className="h-7 w-24 text-right text-xs ml-auto"
                      />
                    </td>
                    <td className="py-2 pl-3 text-right"><DiffCell value={pettyDiff} /></td>
                  </tr>
                  {/* Previous Float row */}
                  <tr className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-700">Previous Float</td>
                    <td className="py-2 px-3 text-right text-gray-700 tabular-nums">{fmt(previousFloat)}</td>
                    <td className="py-2 px-3 text-right text-gray-700 tabular-nums">{fmt(previousFloat)}</td>
                    <td className="py-2 pl-3 text-right"><DiffCell value={0} /></td>
                  </tr>
                  {/* Total row */}
                  <tr className="bg-gray-50">
                    <td className="py-2 pr-3 text-gray-800 font-medium">Total</td>
                    <td className="py-2 px-3 text-right text-gray-800 font-medium tabular-nums">{fmt(totalExpected)}</td>
                    <td className="py-2 px-3 text-right text-gray-800 font-medium tabular-nums">{fmt(totalCounted)}</td>
                    <td className="py-2 pl-3 text-right"><DiffCell value={totalDiff} /></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mx-5 border-t border-gray-200" />

            {/* Bank Deposit + Note */}
            <div className="px-5 py-4 grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-gray-800">Bank Deposit</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">$</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={bankDeposit}
                    onChange={(e) => setBankDeposit(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="pl-7 h-9 text-sm"
                  />
                </div>
                <p className="text-xs text-gray-500">
                  Cash remaining for the next day:{" "}
                  <span className="font-medium">
                    $ {cashRemaining < 0 ? "0.00" : cashRemaining.toFixed(2)}
                  </span>
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-gray-800">Note</p>
                <Textarea
                  placeholder=""
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="h-20 text-sm resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 px-5 py-3 flex gap-3">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={onClose}
                disabled={closeDrawerMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-10 bg-[#1A0333] hover:bg-[#2b0554] text-white"
                onClick={handleSave}
                disabled={closeDrawerMutation.isPending}
              >
                {closeDrawerMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
