import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useCreateWebsite, useListTemplates, useCheckSlug, useListWebsites, getListWebsitesQueryKey, getCheckSlugQueryKey } from "@workspace/api-client-react";
import { Zap, MapPin, Phone, Clock, Scissors, CalendarCheck, Store } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, LayoutTemplate, Lock } from "lucide-react";
import { useIsAdmin } from "@/hooks/use-is-admin";

const MAX_WEBSITES = 5;

const BUSINESS_TYPE_TO_TEMPLATE_CATEGORY: Record<string, string> = {
  "Nail Salon": "nail_salon",
  "Hair Salon": "hair_salon",
  "Barbershop": "barbershop",
};

export default function CreateWebsite() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isAdmin = useIsAdmin();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [templateCategory, setTemplateCategory] = useState<string | undefined>(undefined);

  // Pre-selected template from query param
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const tid = searchParams.get('templateId');
    if (tid) setTemplateId(parseInt(tid, 10));
  }, []);

  // Fetch store category to filter templates
  const storeid = typeof window !== "undefined" ? localStorage.getItem("storeid") : null;
  useEffect(() => {
    if (!storeid) return;
    fetch(`/api/store-info?storeid=${encodeURIComponent(storeid)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { category?: string } | null) => {
        if (data?.category) {
          const mapped = BUSINESS_TYPE_TO_TEMPLATE_CATEGORY[data.category];
          if (mapped) setTemplateCategory(mapped);
        }
      })
      .catch(() => {});
  }, [storeid]);

  const templateParams = templateCategory ? { category: templateCategory } : undefined;
  const { data: templates, isLoading: templatesLoading } = useListTemplates(templateParams);
  const { data: websites, isLoading: websitesLoading } = useListWebsites();
  const createWebsite = useCreateWebsite();

  const userWebsites = storeid ? (websites ?? []).filter((w) => w.storeid === storeid) : (websites ?? []);
  const existingSlug = userWebsites.length > 0 ? userWebsites[0].slug : null;

  const websiteCount = websites?.length ?? 0;
  const atLimit = !websitesLoading && websiteCount >= MAX_WEBSITES;

  // If user already has a subdomain, lock it in and mark available
  useEffect(() => {
    if (existingSlug && !slug) {
      setSlug(existingSlug);
      setSlugStatus('available');
    }
  }, [existingSlug, slug]);

  // Slug formatting — only allowed when no existing slug
  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (existingSlug) return;
    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setSlug(val);
    setSlugStatus(val.length > 0 ? 'checking' : 'idle');
  };

  // Debounced slug check — only run when there's no locked existing slug
  const [debouncedSlug, setDebouncedSlug] = useState("");
  useEffect(() => {
    if (existingSlug) return;
    const timer = setTimeout(() => setDebouncedSlug(slug), 500);
    return () => clearTimeout(timer);
  }, [slug, existingSlug]);

  const { data: checkResult } = useCheckSlug(
    { slug: debouncedSlug },
    { query: { queryKey: getCheckSlugQueryKey({ slug: debouncedSlug }), enabled: !existingSlug && debouncedSlug.length > 0 } }
  );

  useEffect(() => {
    if (existingSlug) return;
    if (debouncedSlug.length === 0) {
      setSlugStatus('idle');
    } else if (checkResult) {
      setSlugStatus(checkResult.available ? 'available' : 'taken');
    }
  }, [debouncedSlug, checkResult, existingSlug]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !slug.trim() || !templateId) {
      toast({ variant: "destructive", title: "Error", description: "Please fill all required fields and select a template." });
      return;
    }

    if (slugStatus !== 'available') {
      toast({ variant: "destructive", title: "Error", description: "Please choose an available subdomain." });
      return;
    }

    const storeid = localStorage.getItem("storeid") || undefined;

    createWebsite.mutate({
      data: { name, slug, templateId, storeid, content: {} }
    }, {
      onSuccess: (res) => {
        toast({ title: "Website created", description: "Taking you to the builder..." });
        queryClient.invalidateQueries({ queryKey: getListWebsitesQueryKey() });
        setLocation(`/websites/${res.id}/edit`);
      },
      onError: (err) => {
        toast({ variant: "destructive", title: "Failed to create", description: (err?.data as { error?: string })?.error || err?.message || "Unknown error" });
      }
    });
  };

  // Show limit wall if user is at their max
  if (atLimit) {
    return (
      <div className="max-w-2xl mx-auto px-6 lg:px-10 py-24 flex flex-col items-center text-center gap-8">
        <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center">
          <Lock className="w-10 h-10 text-red-400" />
        </div>
        <div>
          <h1 className="font-serif text-4xl font-bold text-[#3B0764] mb-4">Template Limit Reached</h1>
          <p className="text-gray-600 text-lg mb-2">
            You've created <strong>{websiteCount} of {MAX_WEBSITES}</strong> website templates — the maximum allowed.
          </p>
          <p className="text-gray-500">
            Delete an existing website to free up a slot, or go back and switch your live site to a different template.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/websites">
            <Button className="rounded-full bg-[#1A0333] hover:bg-[#2b0554] text-white h-12 px-8">
              Manage My Websites
            </Button>
          </Link>
        </div>
        <p className="text-xs text-gray-400">
          Tip: You can swap which template is live at any time from the My Websites page — no rebuild needed.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-10 py-12 flex flex-col gap-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-serif text-4xl font-bold text-[#3B0764] mb-3">Create Website</h1>
          <p className="text-gray-600 text-lg">Set up a new online presence for your salon.</p>
        </div>
        {!websitesLoading && (
          <div className="flex flex-col items-end gap-1 pt-2">
            <span className="text-xs font-semibold text-gray-400 tracking-wide uppercase">Templates</span>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {Array.from({ length: MAX_WEBSITES }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-5 h-2 rounded-full ${i < websiteCount ? 'bg-[#3B0764]' : 'bg-gray-200'}`}
                  />
                ))}
              </div>
              <span className="text-sm font-bold text-gray-700">{websiteCount} / {MAX_WEBSITES}</span>
            </div>
          </div>
        )}
      </div>

      {/* Auto-fill explainer */}
      <div className="rounded-2xl border border-[#3B0764]/10 bg-gradient-to-r from-[#3B0764]/5 to-transparent p-5 flex flex-col sm:flex-row items-start gap-5">
        <div className="w-10 h-10 rounded-xl bg-[#3B0764] flex items-center justify-center shrink-0">
          <Zap className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[#3B0764] mb-1">Your website builds itself — using your real salon data</p>
          <p className="text-xs text-gray-500 mb-3 leading-relaxed">
            As soon as you pick a template and publish, your website is automatically populated with your live data from SalonOS. No copy-pasting needed.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { icon: Store, label: "Business name & address" },
              { icon: Phone, label: "Phone & email" },
              { icon: Clock, label: "Business hours" },
              { icon: Scissors, label: "Services & prices" },
              { icon: CalendarCheck, label: "Booking link" },
              { icon: MapPin, label: "Location" },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-white border border-[#3B0764]/15 text-[#3B0764] px-2.5 py-1 rounded-full">
                <Icon className="w-3 h-3" />{label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-10">
        <Card className="rounded-2xl border-gray-100 shadow-sm p-8 bg-white flex flex-col gap-8">
          <div className="space-y-3">
            <Label htmlFor="name" className="text-base font-semibold text-gray-900">Website Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Awesome Salon"
              className="rounded-lg h-12 bg-gray-50 text-lg"
            />
          </div>

          <div className="space-y-3">
            <Label htmlFor="slug" className="text-base font-semibold text-gray-900">Subdomain</Label>
            <div className="flex relative">
              <Input
                id="slug"
                value={slug}
                onChange={handleSlugChange}
                placeholder="my-awesome-salon"
                readOnly={!!existingSlug}
                className={`rounded-l-lg rounded-r-none h-12 text-lg border-r-0 ${
                  existingSlug
                    ? 'bg-gray-100 text-gray-500 cursor-not-allowed select-none'
                    : slugStatus === 'available' ? 'bg-gray-50 focus-visible:ring-green-500' :
                      slugStatus === 'taken' ? 'bg-gray-50 focus-visible:ring-red-500' : 'bg-gray-50'
                }`}
              />
              <div className="flex items-center px-4 bg-gray-100 border border-l-0 border-gray-200 rounded-r-lg text-gray-500 text-lg">
                .certxa.com
              </div>
              {!existingSlug && (
                <div className="absolute right-36 top-3">
                  {slugStatus === 'checking' && <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />}
                  {slugStatus === 'available' && <CheckCircle2 className="w-6 h-6 text-green-500" />}
                  {slugStatus === 'taken' && <XCircle className="w-6 h-6 text-red-500" />}
                </div>
              )}
            </div>
            {existingSlug ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Your subdomain is locked to <strong>{existingSlug}.certxa.com</strong> — all your websites share one subdomain. Switching which site is live is done from My Websites.
              </p>
            ) : (
              <>
                {slugStatus === 'taken' && (
                  <p className="text-red-500 text-sm font-medium">This subdomain is already taken.</p>
                )}
                {slugStatus === 'available' && (
                  <p className="text-green-600 text-sm font-medium">Subdomain available!</p>
                )}
                <p className="text-xs text-gray-400">
                  This will be your website address. You can add a custom domain from the editor later.
                </p>
              </>
            )}
          </div>
        </Card>

        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-6">Select a Template</h2>

          {templatesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
            </div>
          ) : !templates || templates.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed bg-gray-50 p-10 text-center">
              <p className="text-gray-500 mb-4">
                {isAdmin
                  ? "No templates available. Please import one first."
                  : "No templates available yet. Check back soon."}
              </p>
              {isAdmin && (
                <Link href="/templates/import">
                  <Button variant="outline">Import Template</Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {templates.map(template => (
                <div
                  key={template.id}
                  className={`rounded-2xl border-2 cursor-pointer transition-all overflow-hidden ${
                    templateId === template.id
                      ? 'border-[#3B0764] ring-4 ring-[#3B0764]/10 bg-[#3B0764]/5 shadow-md'
                      : 'border-transparent bg-white shadow-sm hover:border-gray-200'
                  }`}
                  onClick={() => setTemplateId(template.id)}
                >
                  <div className="aspect-[4/3] bg-gray-100 flex items-center justify-center overflow-hidden">
                    {template.thumbnail ? (
                      <img src={template.thumbnail} alt={template.name} className="w-full h-full object-cover" />
                    ) : (
                      <LayoutTemplate className="w-12 h-12 text-gray-300" />
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-gray-900 line-clamp-1">{template.name}</h3>
                    <p className="text-sm text-gray-500 capitalize">{template.category.replace('_', ' ')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-4 mt-4">
          <Button
            type="button"
            variant="outline"
            className="rounded-full px-6 h-12"
            onClick={() => setLocation("/websites")}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createWebsite.isPending || slugStatus !== 'available' || !templateId || !name}
            className="rounded-full bg-[#1A0333] hover:bg-[#2b0554] text-white shadow-[0px_8px_32px_0px_rgba(201,123,43,0.25)] px-10 h-12 text-base font-medium"
          >
            {createWebsite.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : null}
            Create Website
          </Button>
        </div>
      </form>
    </div>
  );
}
