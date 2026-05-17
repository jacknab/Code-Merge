import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStaffList } from "@/hooks/use-staff";
import { useAppointments } from "@/hooks/use-appointments";
import { useSelectedStore } from "@/hooks/use-store";
import { formatInTz, toStoreLocal } from "@/lib/timezone";
import { isWithinInterval, startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { DollarSign, Users, Calendar, FileText } from "lucide-react";
import type { Staff, AppointmentWithDetails } from "@shared/schema";

type DateRange = "this_week" | "last_week" | "this_month" | "last_month" | "custom";

export default function CommissionReport() {
  const { selectedStore } = useSelectedStore();
  const timezone = selectedStore?.timezone || "UTC";
  const payoutFrequency = selectedStore?.commissionPayoutFrequency || "monthly";

  const { data: staffList = [] } = useStaffList();
  const { data: appointments = [] } = useAppointments();

  const [dateRange, setDateRange] = useState<DateRange>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState<string>("all");

  const now = new Date();
  const { from, to } = useMemo(() => {
    switch (dateRange) {
      case "this_week":
        return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
      case "last_week": {
        const lastWeekStart = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
        return { from: lastWeekStart, to: endOfWeek(lastWeekStart, { weekStartsOn: 1 }) };
      }
      case "this_month":
        return { from: startOfMonth(now), to: endOfMonth(now) };
      case "last_month": {
        const lastMonthStart = startOfMonth(subDays(startOfMonth(now), 1));
        return { from: lastMonthStart, to: endOfMonth(lastMonthStart) };
      }
      case "custom":
        return {
          from: customFrom ? startOfDay(new Date(customFrom)) : subDays(now, 30),
          to: customTo ? endOfDay(new Date(customTo)) : now,
        };
      default:
        return { from: startOfMonth(now), to: endOfMonth(now) };
    }
  }, [dateRange, customFrom, customTo]);

  const commissionStaff = staffList.filter((s: Staff) => s.commissionEnabled);

  const staffCommissions = useMemo(() => {
    const targetStaff = selectedStaffId === "all"
      ? commissionStaff
      : commissionStaff.filter((s: Staff) => s.id === Number(selectedStaffId));

    return targetStaff.map((member: Staff) => {
      const staffAppointments = appointments.filter((apt: AppointmentWithDetails) => {
        if (apt.staffId !== member.id) return false;
        if (apt.status !== "completed") return false;
        const aptDate = toStoreLocal(apt.date, timezone);
        return isWithinInterval(aptDate, { start: from, end: to });
      });

      const totalServiceRevenue = staffAppointments.reduce((sum: number, apt: AppointmentWithDetails) => {
        return sum + Number(apt.service?.price || 0);
      }, 0);

      const totalAddonRevenue = staffAppointments.reduce((sum: number, apt: AppointmentWithDetails) => {
        const addonSum = apt.appointmentAddons?.reduce((s, aa) => s + Number(aa.addon?.price || 0), 0) || 0;
        return sum + addonSum;
      }, 0);

      const totalRevenue = totalServiceRevenue + totalAddonRevenue;
      const commissionRate = Number(member.commissionRate || 0);
      const commissionAmount = totalRevenue * (commissionRate / 100);

      return {
        staff: member,
        appointmentCount: staffAppointments.length,
        totalServiceRevenue,
        totalAddonRevenue,
        totalRevenue,
        commissionRate,
        commissionAmount,
      };
    });
  }, [commissionStaff, appointments, selectedStaffId, from, to, timezone]);

  const totalCommissions = staffCommissions.reduce((sum, sc) => sum + sc.commissionAmount, 0);
  const totalRevenue = staffCommissions.reduce((sum, sc) => sum + sc.totalRevenue, 0);

  return (
    <AppLayout>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Commission Report</h1>
          <p className="text-muted-foreground">
            Track staff commissions based on completed services.
            Payout frequency: <Badge variant="secondary" className="no-default-active-elevate ml-1 capitalize">{payoutFrequency}</Badge>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div className="space-y-1">
          <Label className="text-xs">Period</Label>
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="w-[180px]" data-testid="select-commission-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="this_week">This Week</SelectItem>
              <SelectItem value="last_week">Last Week</SelectItem>
              <SelectItem value="this_month">This Month</SelectItem>
              <SelectItem value="last_month">Last Month</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {dateRange === "custom" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-[160px]"
                data-testid="input-commission-from"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-[160px]"
                data-testid="input-commission-to"
              />
            </div>
          </>
        )}

        <div className="space-y-1">
          <Label className="text-xs">Staff</Label>
          <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
            <SelectTrigger className="w-[180px]" data-testid="select-commission-staff">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Commission Staff</SelectItem>
              {commissionStaff.map((s: Staff) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10">
              <DollarSign className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Revenue</p>
              <p className="text-xl font-bold" data-testid="text-total-revenue">${totalRevenue.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-green-500/10">
              <FileText className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Commissions</p>
              <p className="text-xl font-bold text-green-600" data-testid="text-total-commissions">${totalCommissions.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-blue-500/10">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Commission Staff</p>
              <p className="text-xl font-bold" data-testid="text-commission-staff-count">{commissionStaff.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {commissionStaff.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No staff members have commission enabled.</p>
            <p className="text-xs text-muted-foreground mt-1">Enable commissions in each staff member's profile settings.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="commission-table">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Staff Member</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Rate</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Appointments</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Service Revenue</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Add-On Revenue</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total Revenue</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Commission</th>
                </tr>
              </thead>
              <tbody>
                {staffCommissions.map((sc) => (
                  <tr key={sc.staff.id} className="border-b last:border-b-0 hover-elevate" data-testid={`row-commission-${sc.staff.id}`}>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: sc.staff.color || "#3b82f6" }}
                        >
                          {sc.staff.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-medium">{sc.staff.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="secondary" className="no-default-active-elevate">{sc.commissionRate}%</Badge>
                    </td>
                    <td className="py-3 px-4 text-center">{sc.appointmentCount}</td>
                    <td className="py-3 px-4 text-right">${sc.totalServiceRevenue.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right">${sc.totalAddonRevenue.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right font-medium">${sc.totalRevenue.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right font-bold text-green-600" data-testid={`text-commission-amount-${sc.staff.id}`}>
                      ${sc.commissionAmount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 border-t font-medium">
                  <td colSpan={5} className="py-3 px-4">Totals</td>
                  <td className="py-3 px-4 text-right">${totalRevenue.toFixed(2)}</td>
                  <td className="py-3 px-4 text-right font-bold text-green-600">${totalCommissions.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="bg-muted/30 border-t px-4 py-2">
            <span className="text-xs text-muted-foreground">
              Period: {formatInTz(from, timezone, "MMM d, yyyy")} - {formatInTz(to, timezone, "MMM d, yyyy")}
            </span>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
