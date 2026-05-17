import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { Layout } from "@/components/layout";
import { useIsAdmin } from "@/hooks/use-is-admin";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Templates from "@/pages/templates";
import TemplatePreview from "@/pages/templates/preview";
import ImportTemplate from "@/pages/templates/import";
import Websites from "@/pages/websites";
import CreateWebsite from "@/pages/websites/new";
import EditWebsite from "@/pages/websites/edit";
import Settings from "@/pages/settings";
import Docs from "@/pages/docs";
import Support from "@/pages/support";
import ImageLibrary from "@/pages/ImageLibrary";

const queryClient = new QueryClient();

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const isAdmin = useIsAdmin();
  return isAdmin ? <Component /> : <Redirect to="/templates" />;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/"><Redirect to="/websites" /></Route>
        <Route path="/templates" component={Templates} />
        <Route path="/templates/:id/preview" component={TemplatePreview} />
        <Route path="/templates/import">
          {() => <AdminRoute component={ImportTemplate} />}
        </Route>
        <Route path="/websites" component={Websites} />
        <Route path="/websites/new" component={CreateWebsite} />
        <Route path="/websites/:id/edit" component={EditWebsite} />
        <Route path="/settings" component={Settings} />
        <Route path="/docs" component={Docs} />
        <Route path="/support" component={Support} />
        <Route path="/image-library">
          {() => <AdminRoute component={ImageLibrary} />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get("token");
    const admin = urlParams.get("admin");

    if (token) {
      localStorage.setItem("storeid", token);
    }
    if (admin === "true") {
      localStorage.setItem("isAdmin", "true");
      window.dispatchEvent(new Event("certxa:adminChanged"));
    }
    if (token || admin) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
