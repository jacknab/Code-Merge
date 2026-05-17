import { useParams, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { StoreData } from "./public-booking/types";
import SimpleTheme from "./public-booking/SimpleTheme";
import MobileTheme from "./public-booking/MobileTheme";
import ClassicTheme from "./public-booking/ClassicTheme";

export default function PublicBooking() {
  const { slug } = useParams<{ slug?: string }>();
  const [searchParams] = useSearchParams();
  const staffParam = searchParams.get("staff");
  const preselectedStaffId = staffParam ? Number(staffParam) : undefined;

  // If accessed via slug URL, fetch store from public endpoint (no auth required)
  const { data: slugStore, isLoading: slugLoading } = useQuery<StoreData>({
    queryKey: [`/api/public/store/${slug}`],
    enabled: !!slug,
  });

  // If accessed via subdomain (no slug in URL), fetch store from subdomain endpoint
  const { data: subdomainStore, isLoading: subdomainLoading } = useQuery<StoreData>({
    queryKey: ["/api/store/by-subdomain"],
    enabled: !slug,
  });

  const effectiveStore = slug ? slugStore : subdomainStore;
  const isLoading = slug ? slugLoading : subdomainLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!effectiveStore) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900">Store not found</h2>
          <p className="text-gray-500 mt-2">This booking page doesn't exist.</p>
        </div>
      </div>
    );
  }

  // For subdomain-based access, use the slug from the store's bookingSlug field
  const effectiveSlug = slug || effectiveStore.bookingSlug;

  if (effectiveStore.bookingTheme === "mobile") {
    return <MobileTheme store={effectiveStore as StoreData} slug={effectiveSlug!} preselectedStaffId={preselectedStaffId} />;
  }

  if (effectiveStore.bookingTheme === "classic") {
    return <ClassicTheme store={effectiveStore as StoreData} slug={effectiveSlug!} preselectedStaffId={preselectedStaffId} />;
  }

  return <SimpleTheme store={effectiveStore as StoreData} slug={effectiveSlug!} preselectedStaffId={preselectedStaffId} />;
}
