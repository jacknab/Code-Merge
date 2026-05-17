import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GoogleBusinessProfileSetup } from "@/components/GoogleBusinessProfileSetup";
import { GoogleReviewsManager } from "@/components/GoogleReviewsManager";
import { useSelectedStore } from "@/hooks/use-store";
import { Building2, Loader2, Star } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function GoogleBusiness() {
  const { selectedStore, isLoading } = useSelectedStore();
  const storeId = selectedStore?.id ?? null;
  const [activeTab, setActiveTab] = useState<string>("setup");

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Google Business Profile</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Connect your Google Business Profile to manage and respond to customer reviews
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-gray-400" size={32} />
          </div>
        ) : !storeId ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader>
              <CardTitle className="text-amber-800">No Store Found</CardTitle>
              <CardDescription className="text-amber-700">
                You need to complete onboarding and create a store before connecting your Google Business Profile.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="setup" className="gap-2">
                <Building2 size={15} />
                Connection
              </TabsTrigger>
              <TabsTrigger value="reviews" className="gap-2">
                <Star size={15} />
                Reviews
              </TabsTrigger>
            </TabsList>

            <TabsContent value="setup">
              <GoogleBusinessProfileSetup
                storeId={storeId}
                onConnectSuccess={() => setActiveTab("reviews")}
              />
            </TabsContent>

            <TabsContent value="reviews">
              <GoogleReviewsManager storeId={storeId} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
