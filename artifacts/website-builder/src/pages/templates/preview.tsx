import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useGetTemplate, getGetTemplateQueryKey } from "@workspace/api-client-react";
import { Monitor, Smartphone, ArrowLeft } from "lucide-react";

export default function TemplatePreview() {
  const [, params] = useRoute("/templates/:id/preview");
  const [, navigate] = useLocation();
  const id = Number(params?.id);

  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  const { data: template } = useGetTemplate(id, {
    query: { queryKey: getGetTemplateQueryKey(id), enabled: !!id },
  });

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-100 z-50">
      {/* ── Top bar ── */}
      <div className="h-12 shrink-0 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shadow-sm">
        {/* Back */}
        <button
          onClick={() => navigate("/templates")}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors pr-3 border-r border-gray-200"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Template name */}
        <span className="flex-1 text-sm font-semibold text-gray-800 truncate">
          {template?.name ?? "Template Preview"}
        </span>

        {/* Device toggle */}
        <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
          <button
            onClick={() => setDevice("desktop")}
            title="Desktop view"
            className={`flex items-center justify-center w-9 h-8 transition-colors ${
              device === "desktop"
                ? "bg-[#1B6EF0] text-white"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            <Monitor className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDevice("mobile")}
            title="Mobile view"
            className={`flex items-center justify-center w-9 h-8 border-l border-gray-200 transition-colors ${
              device === "mobile"
                ? "bg-[#1B6EF0] text-white"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            <Smartphone className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Preview area ── */}
      <div
        className={`flex-1 overflow-auto ${device === "mobile" ? "bg-gray-200" : "bg-white"}`}
      >
        {device === "desktop" ? (
          <iframe
            src={`/api/templates/${id}/preview`}
            className="w-full h-full border-none"
            title="Template preview"
          />
        ) : (
          <div className="flex items-start justify-center py-6 min-h-full">
            <div
              className="rounded-[2.5rem] border-4 border-gray-800 shadow-2xl overflow-hidden bg-white shrink-0"
              style={{ width: 390 }}
            >
              {/* Phone notch bar */}
              <div className="h-6 bg-gray-800 flex items-center justify-center">
                <div className="w-20 h-3 bg-gray-700 rounded-full" />
              </div>
              <iframe
                src={`/api/templates/${id}/preview`}
                className="w-full border-none block"
                style={{ height: "80vh" }}
                title="Template preview (mobile)"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
