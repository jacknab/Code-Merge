import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServicesList } from "@/components/services/ServicesList";
import { CategoryManager } from "@/components/services/CategoryManager";
import { AddonsList } from "@/components/services/AddonsList";
import { ProductsList } from "@/components/services/ProductsList";

export default function Services() {
  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-display font-bold">Services & Products</h1>
        <p className="text-muted-foreground">Manage your service menu, add-ons, and product inventory.</p>
      </div>

      <Tabs defaultValue="services" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-[600px]">
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="addons">Add-Ons</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="space-y-4">
          <div className="bg-card border rounded-md p-6">
            <CategoryManager />
          </div>
        </TabsContent>

        <TabsContent value="services" className="space-y-4">
          <ServicesList />
        </TabsContent>

        <TabsContent value="addons" className="space-y-4">
          <AddonsList />
        </TabsContent>

        <TabsContent value="products" className="space-y-4">
          <ProductsList />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
