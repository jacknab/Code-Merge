import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link, useSearch } from "wouter";
import {
  useGetWebsite,
  useUpdateWebsite,
  usePublishWebsite,
  useUnpublishWebsite,
  getGetWebsiteQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Globe,
  ArrowLeft,
  Save,
  ScanText,
  RefreshCw,
  ExternalLink,
  Link2,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  MousePointerClick,
  Pencil,
  RotateCcw,
  X,
  ImageIcon,
  Type,
  Undo2,
  Database,
  LayoutGrid,
  Search,
  Plus,
  Monitor,
  Smartphone,
} from "lucide-react";
import { BLOCK_LIBRARY } from "@/lib/block-library";
import type { Block, BlockCategory } from "@/lib/block-library";
import { SALON_IMAGES, IMAGE_CATEGORIES, detectCategory, type ImageCategory } from "@/lib/image-library";

interface ContentField {
  id: string;
  label: string;
  original: string;
  current: string;
  elementType: string;
}

interface BlockOps {
  order: string[];
  deleted: string[];
}

interface WebsiteContent {
  fields?: ContentField[];
  blockOps?: BlockOps;
  imageOps?: Record<string, string>;
}

type EditorMode = "text" | "image";

interface SelectedImg {
  src: string;
  category: ImageCategory;
  displayWidth: number;
  displayHeight: number;
}

const VPS_IP = "216.128.140.207";

// ── Custom Domain Dialog ───────────────────────────────────────────────────────

interface CustomDomainDialogProps {
  open: boolean;
  onClose: () => void;
  websiteId: number;
  currentDomain: string | null | undefined;
  currentStatus: string | null | undefined;
  onActivated: (domain: string) => void;
  onRemoved?: () => void;
}

type VerifyStatus = { dnsOk: boolean; httpOk: boolean } | null;

function sanitizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split("?")[0];
}

function CustomDomainDialog({
  open, onClose, websiteId, currentDomain, currentStatus, onActivated, onRemoved,
}: CustomDomainDialogProps) {
  const [domain, setDomain] = useState(sanitizeDomain(currentDomain ?? ""));
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  const isActive = currentStatus === "active";
  const isPending = currentStatus === "pending_dns" || currentStatus === "pending_payment";
  const bothOk = !!(verifyStatus?.dnsOk && verifyStatus?.httpOk);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setDomain(sanitizeDomain(currentDomain ?? ""));
      setVerifyToken(null);
      setVerifyStatus(null);
      setIsVerifying(false);
      setHasStarted(false);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }, [open, currentDomain]);

  // Auto-start verification if there's already a pending domain saved
  useEffect(() => {
    if (open && isPending && currentDomain && !hasStarted) {
      void startVerification(sanitizeDomain(currentDomain));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPending, currentDomain]);

  // Kick off polling once verifying is true and token is set
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (isVerifying && verifyToken) {
      void doVerify();
      pollRef.current = setInterval(() => { void doVerify(); }, 5000);
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVerifying, verifyToken]);

  // Stop polling once both checks pass
  useEffect(() => {
    if (bothOk && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      setIsVerifying(false);
    }
  }, [bothOk]);

  async function doVerify() {
    try {
      const res = await fetch(`/api/websites/${websiteId}/custom-domain/verify`);
      if (res.ok) {
        const data = await res.json() as VerifyStatus;
        setVerifyStatus(data);
      }
    } catch { /* network error — keep polling */ }
  }

  async function startVerification(domainOverride?: string) {
    const d = domainOverride ?? domain;
    if (!d || d.length < 3) {
      toast({ variant: "destructive", title: "Enter a valid domain name first" });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/websites/${websiteId}/custom-domain/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: d }),
      });
      const data = await res.json() as { domain?: string; token?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save domain");
      setDomain(data.domain ?? d);
      setVerifyToken(data.token ?? null);
      setVerifyStatus(null);
      setHasStarted(true);
      setIsVerifying(true);
    } catch (err) {
      toast({ variant: "destructive", title: "Could not start verification", description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setIsLoading(false);
    }
  }

  const handleActivate = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/websites/${websiteId}/custom-domain/activate`, {
        method: "POST",
      });
      const data = await res.json() as { success?: boolean; domain?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to activate domain");
      toast({ title: "Domain activated", description: `${data.domain ?? domain} is now connected.` });
      if (data.domain) onActivated(data.domain);
      onClose();
    } catch (err) {
      toast({ variant: "destructive", title: "Activation failed", description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(VPS_IP);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [isRemoving, setIsRemoving] = useState(false);
  const handleRemoveDomain = async () => {
    if (!confirm("Remove this custom domain? This will stop serving your site on the custom domain.")) return;
    setIsRemoving(true);
    try {
      const res = await fetch(`/api/websites/${websiteId}/custom-domain`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove domain");
      toast({ title: "Domain removed" });
      onRemoved?.();
      onClose();
    } catch (err) {
      toast({ variant: "destructive", title: "Could not remove domain", description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setIsRemoving(false);
    }
  };

  function CheckRow({ ok, label, pending }: { ok: boolean | undefined; label: string; pending: boolean }) {
    if (!pending && ok === undefined) return null;
    return (
      <div className="flex items-center gap-2.5 text-sm">
        {ok ? (
          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
        ) : pending ? (
          <Loader2 className="w-4 h-4 text-amber-400 shrink-0 animate-spin" />
        ) : (
          <Clock className="w-4 h-4 text-gray-400 shrink-0" />
        )}
        <span className={ok ? "text-green-700 font-medium" : pending ? "text-amber-700" : "text-gray-500"}>{label}</span>
        {ok && <Badge className="ml-auto text-[10px] bg-green-100 text-green-700 border-green-200 px-1.5 py-0">Verified</Badge>}
        {!ok && !pending && <span className="ml-auto text-[10px] text-gray-400">Waiting…</span>}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="w-4 h-4 text-[#3B0764]" />
            Bring Your Own Domain
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            Connect your own domain — included in your subscription.
          </DialogDescription>
        </DialogHeader>

        {/* Active domain banner */}
        {isActive && currentDomain && (
          <div className="rounded-lg px-4 py-3 flex items-center gap-3 text-sm bg-green-50 border border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-green-800">Domain active</p>
              <p className="text-xs text-green-600 truncate">{currentDomain}</p>
            </div>
            <Badge className="ml-auto bg-green-100 text-green-700 border-green-200 shrink-0">Live</Badge>
          </div>
        )}

        {/* ── Step 1: Enter domain ───────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Step 1 — Your Domain</p>
          </div>
          <div className="px-4 py-4 space-y-3">
            <div>
              <Label htmlFor="custom-domain" className="text-xs font-medium text-gray-600 mb-1.5 block">
                Domain name <span className="text-gray-400 font-normal">(e.g. mybarbershop.com)</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="custom-domain"
                  placeholder="mybarbershop.com"
                  value={domain}
                  onChange={(e) => {
                    setDomain(sanitizeDomain(e.target.value));
                    // Reset verification if domain changes
                    if (hasStarted) { setHasStarted(false); setIsVerifying(false); setVerifyToken(null); setVerifyStatus(null); }
                  }}
                  className="font-mono text-sm flex-1"
                  disabled={isLoading}
                />
                <Button
                  onClick={() => { void startVerification(); }}
                  disabled={isLoading || !domain || domain.length < 3}
                  variant="outline"
                  className="shrink-0 rounded-lg border-[#3B0764] text-[#3B0764] hover:bg-[#3B0764]/5 text-xs font-semibold h-9 px-3"
                >
                  {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : hasStarted ? "Re-verify" : "Start Verification"}
                </Button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">http://, https://, and www. are stripped automatically.</p>
            </div>
          </div>
        </div>

        {/* ── Step 2: DNS + verification status ─────────────────────── */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Step 2 — Point DNS to CertXA</p>
          </div>
          <div className="px-4 py-4 space-y-3">
            <p className="text-xs text-gray-500">Add this A record in your domain registrar's DNS settings:</p>
            <div className="rounded-lg bg-gray-900 text-gray-100 font-mono text-xs p-4">
              <div className="grid grid-cols-[60px_60px_1fr] gap-3 text-gray-400 text-[11px] uppercase tracking-wider mb-2">
                <span>Type</span><span>Name</span><span>Value</span>
              </div>
              <div className="grid grid-cols-[60px_60px_1fr] gap-3 items-center">
                <span className="text-purple-300">A</span>
                <span className="text-amber-300">@</span>
                <div className="flex items-center gap-2">
                  <span className="text-green-300">{VPS_IP}</span>
                  <button onClick={handleCopy} className="ml-auto text-gray-500 hover:text-gray-300" title="Copy IP">
                    {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Verification status — only shown after starting */}
            {hasStarted && (
              <div className="border border-gray-100 rounded-lg px-4 py-3 space-y-2.5 bg-gray-50/60">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Verification Status</p>
                <CheckRow
                  ok={verifyStatus?.dnsOk}
                  pending={isVerifying && !verifyStatus?.dnsOk}
                  label="DNS points to CertXA servers"
                />
                <CheckRow
                  ok={verifyStatus?.httpOk}
                  pending={isVerifying && !!verifyStatus?.dnsOk && !verifyStatus?.httpOk}
                  label="Domain reachable & verified"
                />
                {!bothOk && (
                  <p className="text-[11px] text-gray-400 pt-1">
                    DNS changes can take up to 48 hours to propagate. We'll keep checking automatically.
                  </p>
                )}
                {bothOk && (
                  <p className="text-[11px] text-green-600 font-medium pt-1">
                    All checks passed — you're ready to activate!
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Step 3: Activate ───────────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Step 3 — Activate Domain</p>
          </div>
          <div className="px-4 py-4 space-y-2">
            {!bothOk && !isActive && (
              <p className="text-xs text-gray-400 text-center pb-1">
                Complete DNS verification above to activate your domain.
              </p>
            )}
            <Button
              onClick={handleActivate}
              disabled={isLoading || (!bothOk && !isActive)}
              className="w-full rounded-full bg-[#1A0333] hover:bg-[#2b0554] text-white h-10 text-sm font-medium gap-2 disabled:opacity-40"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {isLoading ? "Activating…" : isActive ? "Domain Active" : "Activate Domain"}
            </Button>
          </div>
        </div>

        {/* Disconnect domain — shown when any domain is saved */}
        {(currentDomain || domain) && currentStatus && (
          <div className="pt-1 border-t border-gray-100 flex justify-end">
            <button
              onClick={() => { void handleRemoveDomain(); }}
              disabled={isRemoving}
              className="text-xs text-red-400 hover:text-red-600 transition-colors font-medium disabled:opacity-50"
            >
              {isRemoving ? "Removing…" : "Disconnect domain"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Block Picker Modal ──────────────────────────────────────────────────────────

interface BlockPickerModalProps {
  open: boolean;
  onClose: () => void;
  onInsert: (html: string) => void;
  activeCategoryId: string;
  setActiveCategoryId: (id: string) => void;
  search: string;
  setSearch: (s: string) => void;
}

function BlockPickerModal({
  open, onClose, onInsert, activeCategoryId, setActiveCategoryId, search, setSearch,
}: BlockPickerModalProps) {
  if (!open) return null;

  const activeCategory = BLOCK_LIBRARY.find((c) => c.id === activeCategoryId) ?? BLOCK_LIBRARY[0];
  const blocks = search.trim()
    ? BLOCK_LIBRARY.flatMap((c) => c.blocks).filter((b) =>
        b.name.toLowerCase().includes(search.toLowerCase())
      )
    : (activeCategory?.blocks ?? []);

  return (
    <div
      className="fixed inset-0 z-50 flex"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="m-auto flex w-full max-w-5xl h-[85vh] bg-white rounded-2xl overflow-hidden shadow-2xl">
        {/* ── Left: Category sidebar ── */}
        <div className="w-52 bg-gray-50 border-r border-gray-200 flex flex-col shrink-0">
          <div className="px-4 py-4 border-b border-gray-200">
            <h2 className="font-bold text-gray-900 text-sm">Add Layout</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">Choose a section to add</p>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {BLOCK_LIBRARY.map((cat) => (
              <button
                key={cat.id}
                onClick={() => { setActiveCategoryId(cat.id); setSearch(""); }}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium transition-colors text-left ${
                  activeCategoryId === cat.id && !search.trim()
                    ? "bg-[#1B6EF0]/10 text-[#1B6EF0] border-r-2 border-[#1B6EF0]"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <span className="text-base leading-none">{cat.icon}</span>
                <span>{cat.name}</span>
                <span className="ml-auto text-[10px] text-gray-400 font-normal">{cat.blocks.length}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: Block grid ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-200 shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search layouts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-[#1B6EF0] focus:bg-white transition-colors"
              />
            </div>
            <button
              onClick={onClose}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Category label */}
          <div className="px-5 py-2.5 border-b border-gray-100 shrink-0 flex items-center gap-2">
            <span className="text-base">{activeCategory?.icon}</span>
            <span className="font-semibold text-gray-700 text-sm">
              {search.trim() ? `Results for "${search}"` : activeCategory?.name}
            </span>
            <span className="text-xs text-gray-400 ml-1">· {blocks.length} layout{blocks.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Block grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {blocks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2">
                <Search className="w-8 h-8 text-gray-200" />
                <p className="text-sm">No layouts found</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {blocks.map((block) => (
                  <button
                    key={block.id}
                    onClick={() => onInsert(block.html)}
                    className="group text-left rounded-xl border-2 border-gray-200 hover:border-[#1B6EF0] overflow-hidden bg-white transition-all hover:shadow-lg focus:outline-none focus:border-[#1B6EF0]"
                  >
                    {/* Scaled HTML preview */}
                    <div className="relative overflow-hidden bg-gray-50" style={{ height: 130 }}>
                      <div
                        style={{
                          transform: "scale(0.22)",
                          transformOrigin: "top left",
                          width: "454%",
                          pointerEvents: "none",
                          position: "absolute",
                          top: 0,
                          left: 0,
                        }}
                        dangerouslySetInnerHTML={{ __html: block.html }}
                      />
                      {/* Hover overlay with "Add" CTA */}
                      <div className="absolute inset-0 bg-[#1B6EF0]/0 group-hover:bg-[#1B6EF0]/8 transition-colors flex items-center justify-center">
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-[#1B6EF0] text-white text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-md">
                          <Plus className="w-3 h-3" />
                          Add
                        </div>
                      </div>
                    </div>
                    {/* Block name */}
                    <div className="px-3 py-2 border-t border-gray-100 bg-white">
                      <p className="text-xs font-semibold text-gray-700 truncate">{block.name}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Editor ────────────────────────────────────────────────────────────────

export default function EditWebsite() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const searchString = useSearch();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data: website, isLoading } = useGetWebsite(id, {
    query: { enabled: !!id, queryKey: getGetWebsiteQueryKey(id) },
  });

  const updateWebsite = useUpdateWebsite();
  const publishWebsite = usePublishWebsite();
  const unpublishWebsite = useUnpublishWebsite();

  const [fields, setFields] = useState<ContentField[]>([]);
  const [blockOps, setBlockOps] = useState<BlockOps>({ order: [], deleted: [] });
  const [imageOps, setImageOps] = useState<Record<string, string>>({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [showDomainDialog, setShowDomainDialog] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("text");
  const [selectedImg, setSelectedImg] = useState<SelectedImg | null>(null);
  const [activeImgCategory, setActiveImgCategory] = useState<ImageCategory>("hero");
  const [showBlockPicker, setShowBlockPicker] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState(BLOCK_LIBRARY[0]?.id ?? "");
  const [blockSearch, setBlockSearch] = useState("");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const initializedForId = useRef<number | null>(null);
  const domainActivatedShown = useRef(false);

  const hasFields = fields.length > 0;

  // Changed fields (current !== original)
  const changedFields = fields.filter((f) => f.current !== f.original);

  // Sync fields + blockOps + imageOps when website loads
  useEffect(() => {
    if (website && initializedForId.current !== id) {
      initializedForId.current = id;
      const content = website.content as WebsiteContent | null;
      setFields(content?.fields ?? []);
      setBlockOps(content?.blockOps ?? { order: [], deleted: [] });
      setImageOps(content?.imageOps ?? {});
      setIsDirty(false);
    }
  }, [website, id]);

  // Notify iframe when editor mode changes
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "certxa-set-mode", mode: editorMode }, "*");
  }, [editorMode]);

  // Show success toast when returning from Stripe
  useEffect(() => {
    if (!domainActivatedShown.current && searchString.includes("domain_activated=true")) {
      domainActivatedShown.current = true;
      setTimeout(() => {
        toast({ title: "Custom domain activated!", description: "DNS changes may take up to 48 hours." });
        queryClient.invalidateQueries({ queryKey: getGetWebsiteQueryKey(id) });
      }, 500);
    }
  }, [searchString, id, toast, queryClient]);

  // Listen for postMessage from the editor iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || typeof e.data !== "object") return;

      if (e.data.type === "certxa-editor-ready") {
        setEditorReady(true);
      }

      if (e.data.type === "certxa-open-block-picker") {
        setShowBlockPicker(true);
        setBlockSearch("");
        setActiveCategoryId(BLOCK_LIBRARY[0]?.id ?? "");
      }

      // Known field edited (matched against saved fields)
      if (e.data.type === "certxa-field-update") {
        const { fieldId, value } = e.data as { fieldId: string; value: string };
        setFields((prev) =>
          prev.map((f) => (f.id === fieldId ? { ...f, current: value } : f))
        );
        setIsDirty(true);
      }

      // Block operations (move / delete / duplicate)
      if (e.data.type === "certxa-block-ops") {
        const { order, deleted } = e.data as { order: string[]; deleted: string[] };
        setBlockOps({ order: order ?? [], deleted: deleted ?? [] });
        setIsDirty(true);
      }

      // Image clicked in image-editor mode — show replacement picker
      if (e.data.type === "certxa-image-click") {
        const { src, displayWidth, displayHeight, alt, category } = e.data as {
          src: string; displayWidth: number; displayHeight: number; alt: string; category: string;
        };
        const cat = detectCategory(src, alt, displayWidth, displayHeight) as ImageCategory;
        setSelectedImg({ src, category: cat, displayWidth, displayHeight });
        setActiveImgCategory(cat);
      }

      // Image replaced in iframe — persist in imageOps
      if (e.data.type === "certxa-image-replaced") {
        const { originalSrc, newSrc } = e.data as { originalSrc: string; newSrc: string };
        setImageOps((prev) => ({ ...prev, [originalSrc]: newSrc }));
        setSelectedImg((prev) => prev ? { ...prev, src: newSrc } : null);
        setIsDirty(true);
      }

      // New field discovered live in the DOM (auto-wired, not previously scanned)
      if (e.data.type === "certxa-field-new") {
        const { fieldId, original, label, value } = e.data as {
          fieldId: string; original: string; label: string; value: string;
        };
        if (!original || value === original) return; // no change — nothing to save
        setFields((prev) => {
          const exists = prev.find((f) => f.id === fieldId);
          if (exists) return prev.map((f) => f.id === fieldId ? { ...f, current: value } : f);
          return [...prev, { id: fieldId, label: label || fieldId, original, current: value, elementType: "auto" }];
        });
        setIsDirty(true);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleExtract = async () => {
    setIsExtracting(true);
    setEditorReady(false);
    try {
      const res = await fetch(`/api/websites/${id}/extract-content`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Extraction failed");
      }
      const updated = await res.json();
      const content = (updated as { content: WebsiteContent }).content;
      const newFields = content?.fields ?? [];
      setFields(newFields);
      setIsDirty(false);
      // Reset the iframe key so it reloads with the editor script + fresh fields
      setIframeKey((k) => k + 1);
      queryClient.setQueryData(getGetWebsiteQueryKey(id), updated);
      toast({ title: `Found ${newFields.length} editable text fields`, description: "Click any text in the preview to edit it." });
    } catch (err) {
      toast({ variant: "destructive", title: "Scan failed", description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = useCallback(() => {
    const content = { fields, blockOps, imageOps } as Record<string, unknown>;
    updateWebsite.mutate(
      { id, data: { content } },
      {
        onSuccess: (data) => {
          toast({ title: "Changes saved" });
          setIsDirty(false);
          queryClient.setQueryData(getGetWebsiteQueryKey(id), data);
          // Reload iframe to pick up saved values
          setIframeKey((k) => k + 1);
          setEditorReady(false);
        },
        onError: () => toast({ variant: "destructive", title: "Failed to save changes" }),
      }
    );
  }, [fields, blockOps, imageOps, id, updateWebsite, queryClient, toast]);

  const handleTogglePublish = () => {
    if (!website) return;
    const mutation = website.published ? unpublishWebsite : publishWebsite;
    mutation.mutate(
      { id },
      {
        onSuccess: (data) => {
          toast({ title: website.published ? "Website unpublished" : "Website published" });
          queryClient.setQueryData(getGetWebsiteQueryKey(id), data);
        },
        onError: () => toast({ variant: "destructive", title: "Failed to update status" }),
      }
    );
  };

  const handleResetField = useCallback((fieldId: string) => {
    setFields((prev) =>
      prev.map((f) => (f.id === fieldId ? { ...f, current: f.original } : f))
    );
    setIsDirty(true);
    // Tell iframe to re-init so it picks up the reset value
    setIframeKey((k) => k + 1);
    setEditorReady(false);
  }, []);

  const handleInsertBlock = useCallback((html: string) => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: "certxa-insert-block", html }, "*");
    }
    setShowBlockPicker(false);
    setIsDirty(true);
  }, []);

  if (isLoading || !website) {
    return (
      <div className="flex h-[calc(100vh-64px)] items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#3B0764] animate-spin" />
      </div>
    );
  }

  const customDomain = (website as unknown as { customDomain?: string | null }).customDomain;
  const customDomainStatus = (website as unknown as { customDomainStatus?: string | null }).customDomainStatus;
  const domainIsActive = customDomainStatus === "active";

  // Always load in editor mode — the bridge script now wires all DOM text nodes live
  const previewSrc = `/api/websites/${id}/preview?editor=1`;

  return (
    <div className="flex flex-col bg-background">
      {/* ── Header ── */}
      <div className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/websites">
            <Button variant="ghost" size="icon" className="text-gray-500 rounded-full hover:bg-gray-100 h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="w-px h-5 bg-gray-200" />
          <div>
            <h2 className="font-bold text-gray-900 text-sm leading-none">{website.name}</h2>
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-0.5">
              <Globe className="w-3 h-3 text-[#C97B2B]" />
              <span>{website.slug}.mysalon.me</span>
              {domainIsActive && customDomain && (
                <><span className="text-gray-300">·</span><Link2 className="w-3 h-3 text-green-500" /><span className="text-green-600 font-medium">{customDomain}</span></>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost" size="sm"
            className={`rounded-full h-8 px-3 text-xs gap-1.5 ${domainIsActive ? "text-green-600 bg-green-50 hover:bg-green-100" : "text-gray-500 hover:text-gray-700"}`}
            onClick={() => setShowDomainDialog(true)}
          >
            <Link2 className="w-3.5 h-3.5" />
            {domainIsActive ? "Domain Active" : "Custom Domain"}
          </Button>

          <Button
            variant="ghost" size="sm"
            className="rounded-full text-gray-500 hover:text-gray-700 h-8 px-3 text-xs gap-1.5"
            onClick={handleExtract}
            disabled={isExtracting}
            title="Re-scan to refresh editable fields"
          >
            {isExtracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanText className="w-3.5 h-3.5" />}
            {isExtracting ? "Scanning…" : "Re-scan"}
          </Button>

          <Button
            variant="outline" size="sm"
            className={`rounded-full border-gray-200 h-8 px-3 text-xs ${website.published ? "text-green-600 bg-green-50 hover:bg-green-100 border-green-200" : "text-gray-600 hover:bg-gray-50"}`}
            onClick={handleTogglePublish}
            disabled={publishWebsite.isPending || unpublishWebsite.isPending}
          >
            {website.published ? "Published ✓" : "Draft — Publish"}
          </Button>

          <Button
            size="sm" onClick={handleSave}
            disabled={updateWebsite.isPending || !isDirty}
            className="rounded-full bg-[#1A0333] hover:bg-[#2b0554] text-white h-8 px-4 text-xs gap-1.5 shadow-[0px_4px_16px_0px_rgba(201,123,43,0.20)] disabled:opacity-50"
          >
            {updateWebsite.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isDirty ? `Save (${changedFields.length + Object.keys(imageOps).length})` : "Save"}
          </Button>
        </div>
      </div>

      <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 120px)', minHeight: '600px' }}>
        {/* ── Left Panel ── */}
        <div className="w-72 bg-white border-r border-gray-200 flex flex-col shrink-0 overflow-hidden">
          {isExtracting ? (
            // Scanning state
            <div className="flex flex-col items-center justify-center h-full gap-5 px-6 text-center">
              <div className="w-14 h-14 rounded-full bg-[#3B0764]/5 flex items-center justify-center">
                <ScanText className="w-7 h-7 text-[#3B0764] animate-pulse" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-sm">Scanning template…</p>
                <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">Reading all text fields. This takes about 10–20 seconds.</p>
              </div>
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="w-2 h-2 rounded-full bg-[#3B0764]/30 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          ) : !hasFields ? (
            // No fields — show scan CTA
            <div className="flex flex-col items-center justify-center h-full gap-5 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-[#3B0764]/5 flex items-center justify-center">
                <MousePointerClick className="w-8 h-8 text-[#3B0764]" />
              </div>
              <div>
                <p className="font-bold text-gray-900 text-base">Visual Editor</p>
                <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                  Scan your template to detect every text element — then click directly on the preview to edit it, just like a real website builder.
                </p>
              </div>
              <Button
                onClick={handleExtract}
                className="rounded-full bg-[#1A0333] hover:bg-[#2b0554] text-white text-sm h-10 px-6 gap-2 w-full shadow-[0px_4px_16px_0px_rgba(201,123,43,0.25)]"
              >
                <ScanText className="w-4 h-4" />
                Scan Template Text
              </Button>
              <p className="text-xs text-gray-400">Takes ~10–20 seconds</p>
            </div>
          ) : (
            // Editor mode — compact status + changed fields
            <>
              {/* Panel header */}
              <div className="px-4 pt-3 pb-2 border-b border-gray-100 bg-gray-50/60 shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Pencil className="w-3.5 h-3.5 text-[#3B0764]" />
                    <span className="font-semibold text-gray-900 text-sm">Visual Editor</span>
                  </div>
                  {editorReady ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">Active</span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />Loading
                    </span>
                  )}
                </div>
                {/* Mode toggle */}
                <div className="flex rounded-lg overflow-hidden border border-gray-200 bg-white text-xs font-semibold">
                  <button
                    onClick={() => { setEditorMode("text"); setSelectedImg(null); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 transition-colors ${
                      editorMode === "text"
                        ? "bg-[#1B6EF0] text-white"
                        : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    <Type className="w-3 h-3" />
                    Text
                  </button>
                  <button
                    onClick={() => setEditorMode("image")}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 transition-colors border-l border-gray-200 ${
                      editorMode === "image"
                        ? "bg-[#1B6EF0] text-white"
                        : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    <ImageIcon className="w-3 h-3" />
                    Images
                  </button>
                  <button
                    onClick={() => { setShowBlockPicker(true); setBlockSearch(""); setActiveCategoryId(BLOCK_LIBRARY[0]?.id ?? ""); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 transition-colors border-l border-gray-200 text-gray-500 hover:bg-gray-50"
                  >
                    <LayoutGrid className="w-3 h-3" />
                    Layout
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  {editorMode === "text"
                    ? editorReady ? "Click any text in the preview to edit." : "Loading editable fields…"
                    : "Click any image in the preview to swap it."}
                </p>
              </div>

              {/* ── TEXT MODE: Field summary / changes ── */}
              {editorMode === "text" && (
                <>
                  <div className="flex-1 overflow-y-auto">
                    {changedFields.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full gap-3 px-5 text-center">
                        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                          <MousePointerClick className="w-5 h-5 text-gray-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-600">No changes yet</p>
                          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                            Click any text in the preview to start editing.
                          </p>
                        </div>
                        <div className="w-full border-t border-gray-100 pt-3">
                          <p className="text-xs text-gray-400">{fields.length} field{fields.length !== 1 ? "s" : ""} detected</p>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 flex flex-col gap-2">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                          {changedFields.length} change{changedFields.length !== 1 ? "s" : ""}
                        </p>
                        {changedFields.map((field) => (
                          <div key={field.id} className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2.5 group">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider truncate">{field.label}</p>
                                <p className="text-xs text-gray-600 mt-0.5 line-clamp-2 leading-snug">{field.current}</p>
                              </div>
                              <button
                                onClick={() => handleResetField(field.id)}
                                className="shrink-0 text-gray-400 hover:text-red-500 transition-colors mt-0.5"
                                title="Reset to original"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                        <div className="mt-1 border-t border-gray-100 pt-3">
                          <p className="text-xs text-gray-400 text-center">
                            {fields.length - changedFields.length} of {fields.length} fields unchanged
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* SalonOS data footer */}
                  <div className="border-t border-[#3B0764]/10 px-3 py-2.5 shrink-0 bg-gradient-to-r from-[#3B0764]/5 to-transparent">
                    <div className="flex items-start gap-2">
                      <Database className="w-3 h-3 text-[#3B0764] mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] font-bold text-[#3B0764] uppercase tracking-wider mb-0.5">Powered by SalonOS</p>
                        <p className="text-[10px] text-gray-400 leading-snug">
                          Name, address, phone, hours, services &amp; booking link auto-fill from your live data.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-100 p-3 shrink-0 bg-gray-50/60">
                    <Button
                      variant="ghost" size="sm"
                      onClick={handleExtract}
                      disabled={isExtracting}
                      className="w-full text-xs text-gray-500 hover:text-gray-700 h-8 gap-1.5"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Re-scan template
                    </Button>
                  </div>
                </>
              )}

              {/* ── IMAGE MODE: Image picker ── */}
              {editorMode === "image" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Selected image info */}
                  {selectedImg && (
                    <div className="px-3 py-2 bg-blue-50 border-b border-blue-100 shrink-0">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-[#1B6EF0]">Image selected — choose a replacement below</p>
                        <button onClick={() => setSelectedImg(null)} className="text-blue-300 hover:text-blue-500">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[10px] text-blue-400 mt-0.5">{selectedImg.displayWidth}×{selectedImg.displayHeight}px</p>
                    </div>
                  )}

                  {/* Category tabs */}
                  <div className="flex overflow-x-auto gap-1 px-2 py-2 border-b border-gray-100 shrink-0 scrollbar-none">
                    {IMAGE_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setActiveImgCategory(cat.id)}
                        className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
                          activeImgCategory === cat.id
                            ? "bg-[#1B6EF0] text-white"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        <span>{cat.icon}</span>
                        <span>{cat.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Image grid */}
                  <div className="flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2 content-start">
                    {SALON_IMAGES.filter((img) => img.category === activeImgCategory).map((img) => (
                      <button
                        key={img.id}
                        onClick={() => {
                          if (!selectedImg) return;
                          const iframe = iframeRef.current;
                          if (iframe?.contentWindow) {
                            iframe.contentWindow.postMessage({
                              type: "certxa-replace-image",
                              originalSrc: selectedImg.src,
                              newSrc: img.full,
                            }, "*");
                          }
                        }}
                        title={img.alt}
                        className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                          selectedImg ? "hover:border-[#1B6EF0] cursor-pointer border-gray-200" : "border-transparent opacity-60 cursor-default"
                        }`}
                        style={{ aspectRatio: activeImgCategory === "hero" ? "16/9" : activeImgCategory === "team" ? "4/5" : "1/1" }}
                      >
                        <img
                          src={img.thumb}
                          alt={img.alt}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        {!selectedImg && (
                          <div className="absolute inset-0 flex items-end p-1.5">
                            <p className="text-[9px] text-white/80 leading-tight bg-black/30 rounded px-1 py-0.5 line-clamp-2">{img.alt}</p>
                          </div>
                        )}
                      </button>
                    ))}
                    {SALON_IMAGES.filter((img) => img.category === activeImgCategory).length === 0 && (
                      <div className="col-span-2 flex items-center justify-center h-32 text-gray-400 text-xs">No images in this category</div>
                    )}
                  </div>

                  {/* Image ops summary */}
                  {Object.keys(imageOps).length > 0 && (
                    <div className="border-t border-gray-100 px-3 py-2 bg-gray-50/60 shrink-0 flex items-center justify-between">
                      <p className="text-[11px] text-gray-500">
                        <span className="font-semibold text-[#1B6EF0]">{Object.keys(imageOps).length}</span> image{Object.keys(imageOps).length !== 1 ? "s" : ""} swapped
                      </p>
                      <button
                        onClick={() => {
                          setImageOps({});
                          setSelectedImg(null);
                          setIframeKey((k) => k + 1);
                          setEditorReady(false);
                          setIsDirty(true);
                        }}
                        className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Undo2 className="w-3 h-3" />
                        Reset all
                      </button>
                    </div>
                  )}

                  {!selectedImg && (
                    <div className="border-t border-gray-100 px-3 py-2 bg-amber-50/60 shrink-0">
                      <p className="text-[11px] text-amber-600 text-center">
                        ↑ Click an image in the preview first, then pick a replacement above
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Preview Pane ── */}
        <div className="flex-1 bg-gray-100 flex flex-col overflow-hidden">
          {/* Browser chrome bar */}
          <div className="h-9 bg-gray-200 border-b border-gray-300 flex items-center px-4 gap-3 shrink-0">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
            </div>
            <div className="flex-1 bg-white rounded px-3 py-1 text-xs text-gray-500 font-mono flex items-center gap-1.5 min-w-0">
              <Globe className="w-3 h-3 text-gray-400 shrink-0" />
              <span className="truncate">
                {domainIsActive && customDomain ? customDomain : `${website.slug}.mysalon.me`}
              </span>
              {hasFields && (
                <span className="ml-auto shrink-0 text-[10px] font-bold text-[#3B0764] bg-[#3B0764]/10 px-1.5 py-0.5 rounded">
                  EDIT MODE
                </span>
              )}
            </div>
            {/* Device toggle */}
            <div className="flex items-center rounded-md border border-gray-300 overflow-hidden bg-white shrink-0">
              <button
                onClick={() => setPreviewDevice("desktop")}
                title="Desktop view"
                className={`flex items-center justify-center w-7 h-6 transition-colors ${
                  previewDevice === "desktop"
                    ? "bg-[#1B6EF0] text-white"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setPreviewDevice("mobile")}
                title="Mobile view"
                className={`flex items-center justify-center w-7 h-6 border-l border-gray-300 transition-colors ${
                  previewDevice === "mobile"
                    ? "bg-[#1B6EF0] text-white"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>
            </div>

            <a href={`/api/websites/${id}/preview`} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="h-6 w-6 rounded text-gray-500 hover:text-gray-700">
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </a>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 rounded text-gray-500 hover:text-gray-700"
              onClick={() => { setIframeKey((k) => k + 1); setEditorReady(false); }}
              title="Refresh preview"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Preview iframe */}
          <div
            className={`flex-1 relative overflow-auto ${
              previewDevice === "mobile" ? "bg-gray-200" : ""
            }`}
          >
            <div
              className={
                previewDevice === "mobile"
                  ? "mx-auto my-4 rounded-[2rem] border-4 border-gray-700 shadow-2xl overflow-hidden bg-white"
                  : "w-full h-full"
              }
              style={
                previewDevice === "mobile"
                  ? { width: 390, minHeight: "calc(100% - 2rem)" }
                  : undefined
              }
            >
            {website.templateId ? (
              <iframe
                key={iframeKey}
                ref={iframeRef}
                src={previewSrc}
                className="w-full h-full border-none"
                style={previewDevice === "mobile" ? { minHeight: "80vh" } : undefined}
                title="Website Preview"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 gap-3">
                <p className="text-gray-500 text-sm font-medium">No template selected</p>
              </div>
            )}

            {/* "Click to edit" first-use hint overlay — fades away after editor is ready */}
            {hasFields && !editorReady && !isExtracting && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-[#1A0333]/80 backdrop-blur-sm text-white text-sm font-medium px-5 py-3 rounded-full flex items-center gap-2.5 shadow-xl">
                  <Loader2 className="w-4 h-4 animate-spin text-[#C97B2B]" />
                  Activating visual editor…
                </div>
              </div>
            )}
            </div>{/* end device wrapper */}
          </div>{/* end preview area */}
        </div>
      </div>

      <CustomDomainDialog
        open={showDomainDialog}
        onClose={() => setShowDomainDialog(false)}
        websiteId={id}
        currentDomain={customDomain}
        currentStatus={customDomainStatus}
        onActivated={(domain) => {
          queryClient.invalidateQueries({ queryKey: getGetWebsiteQueryKey(id) });
          toast({ title: "Custom domain connected", description: domain });
        }}
        onRemoved={() => {
          queryClient.invalidateQueries({ queryKey: getGetWebsiteQueryKey(id) });
        }}
      />

      <BlockPickerModal
        open={showBlockPicker}
        onClose={() => setShowBlockPicker(false)}
        onInsert={handleInsertBlock}
        activeCategoryId={activeCategoryId}
        setActiveCategoryId={setActiveCategoryId}
        search={blockSearch}
        setSearch={setBlockSearch}
      />
    </div>
  );
}
