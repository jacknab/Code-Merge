/**
 * Phase 9.4 — route table mounted inside the practice overlay's MemoryRouter.
 *
 * Reuses the exact same page components as the live app. We only expose the
 * subset trainees actually drill (calendar, booking flows, lookup, POS,
 * client profile). Anything more exotic (settings, payouts, etc.) stays
 * out — practice mode is not a tour.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import Calendar from "@/pages/Calendar";
import NewBooking from "@/pages/NewBooking";
import ClientLookup from "@/pages/ClientLookup";
import POSInterface from "@/pages/POSInterface";
import ClientProfile from "@/pages/ClientProfile";
import Customers from "@/pages/Customers";
import Dashboard from "@/pages/Dashboard";

export function SandboxRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/calendar" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/calendar" element={<Calendar />} />
      <Route path="/appointments" element={<Calendar />} />
      <Route path="/booking/new" element={<NewBooking />} />
      <Route path="/client-lookup" element={<ClientLookup />} />
      <Route path="/pos" element={<POSInterface />} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/client/:id" element={<ClientProfile />} />
      <Route path="*" element={<Navigate to="/calendar" replace />} />
    </Routes>
  );
}
