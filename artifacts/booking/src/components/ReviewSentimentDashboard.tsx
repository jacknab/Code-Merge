import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, ThumbsUp, ThumbsDown, Minus, Quote } from "lucide-react";
import axios from "axios";

interface Theme {
  name: string;
  sentiment: "positive" | "neutral" | "negative";
  count: number;
  examples: string[];
}

interface SentimentResult {
  themes: Theme[];
  reviewCount: number;
}

interface ReviewSentimentDashboardProps {
  storeId: number;
}

const SENTIMENT_CONFIG = {
  positive: {
    label: "Positive",
    icon: ThumbsUp,
    bar: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
    ring: "border-emerald-200",
    bg: "bg-emerald-50/60",
    iconColor: "text-emerald-500",
  },
  neutral: {
    label: "Neutral",
    icon: Minus,
    bar: "bg-amber-400",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    ring: "border-amber-200",
    bg: "bg-amber-50/40",
    iconColor: "text-amber-500",
  },
  negative: {
    label: "Needs attention",
    icon: ThumbsDown,
    bar: "bg-red-400",
    badge: "bg-red-100 text-red-700 border-red-200",
    ring: "border-red-200",
    bg: "bg-red-50/40",
    iconColor: "text-red-500",
  },
} as const;

export function ReviewSentimentDashboard({ storeId }: ReviewSentimentDashboardProps) {
  const [result, setResult] = useState<SentimentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState(false);

  const analyse = async () => {
    try {
      setLoading(true);
      setError(null);
      const resp = await axios.post(
        `/api/google-business/reviews-sentiment/${storeId}`
      );
      setResult(resp.data);
      setAnalyzed(true);
    } catch (err) {
      setError("Couldn't run the analysis. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const maxCount = result ? Math.max(...result.themes.map((t) => t.count), 1) : 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-violet-500" />
            <CardTitle className="text-sm font-semibold">Review Themes & Sentiment</CardTitle>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={analyse}
            disabled={loading}
            className="gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50 text-xs"
          >
            {loading ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Analysing…
              </>
            ) : analyzed ? (
              <>
                <Sparkles size={13} />
                Re-analyse
              </>
            ) : (
              <>
                <Sparkles size={13} />
                Analyse Reviews
              </>
            )}
          </Button>
        </div>
        <CardDescription className="text-xs">
          {analyzed && result
            ? `AI-identified themes across ${result.reviewCount} review${result.reviewCount !== 1 ? "s" : ""}`
            : "AI reads all your reviews and categorises them by topic and sentiment."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {/* Pre-analysis placeholder */}
        {!analyzed && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
            <div className="rounded-full bg-violet-100 p-3">
              <Sparkles size={22} className="text-violet-500" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700">Discover what customers talk about most</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Click "Analyse Reviews" to see a breakdown of recurring themes — staff, service quality, wait times, and more.
              </p>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-violet-600">
            <Loader2 size={16} className="animate-spin" />
            Reading through your reviews…
          </div>
        )}

        {/* Empty result */}
        {analyzed && result && result.themes.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Not enough review text to identify themes yet. Try again after more reviews come in.
          </p>
        )}

        {/* Theme cards */}
        {analyzed && result && result.themes.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {result.themes.map((theme) => {
              const config = SENTIMENT_CONFIG[theme.sentiment] ?? SENTIMENT_CONFIG.neutral;
              const Icon = config.icon;
              const barWidth = Math.round((theme.count / maxCount) * 100);

              return (
                <div
                  key={theme.name}
                  className={`rounded-lg border ${config.ring} ${config.bg} p-3.5 space-y-2.5`}
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon size={13} className={`${config.iconColor} shrink-0`} />
                      <span className="text-sm font-semibold text-gray-800 truncate">{theme.name}</span>
                    </div>
                    <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${config.badge}`}>
                      {config.label}
                    </span>
                  </div>

                  {/* Mention bar */}
                  <div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                      <span>Mentions</span>
                      <span className="font-medium">{theme.count}</span>
                    </div>
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${config.bar} rounded-full transition-all duration-500`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>

                  {/* Example quotes */}
                  {theme.examples && theme.examples.length > 0 && (
                    <div className="space-y-1">
                      {theme.examples.slice(0, 2).map((ex, i) => (
                        <p key={i} className="text-[11px] text-gray-500 flex items-start gap-1 leading-snug">
                          <Quote size={9} className="text-gray-400 mt-0.5 shrink-0" />
                          <span className="italic line-clamp-2">{ex}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        {analyzed && result && result.themes.length > 0 && (
          <p className="text-[10px] text-muted-foreground text-center pt-1">
            AI-generated summary — review manually before acting on insights.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
