/**
 * Google Business API Quota Guard
 *
 * Persists quota cooldown state to disk so server restarts don't clear it.
 * Distinguishes between two kinds of 429:
 *
 *   • Per-minute rate limit  → 5-minute cooldown
 *   • Daily quota exhausted  → cooldown until midnight UTC (Google's reset time)
 *
 * On startup the persisted state is read back, so a Replit restart won't
 * immediately hammer the API again after hitting a daily quota wall.
 */

import fs from "fs";
import path from "path";

// ── Persistence ────────────────────────────────────────────────────────────────

const STATE_FILE = path.resolve("data/google-quota-state.json");

interface PersistedState {
  cooldownUntil: number;   // epoch ms; 0 = no active cooldown
  reason: "rate-limit" | "daily-quota" | "unknown";
  recordedAt: number;      // epoch ms when the 429 was first seen
}

function defaultState(): PersistedState {
  return { cooldownUntil: 0, reason: "unknown", recordedAt: 0 };
}

function loadState(): PersistedState {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const s = JSON.parse(raw) as PersistedState;
    // If the persisted cooldown has already expired, return clean state
    if (s.cooldownUntil && s.cooldownUntil <= Date.now()) return defaultState();
    return s;
  } catch {
    return defaultState();
  }
}

function saveState(s: PersistedState): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), "utf8");
  } catch (e) {
    console.error("[QuotaGuard] Failed to persist quota state:", e);
  }
}

// In-memory cache — loaded once at module init, kept in sync with disk
let _state: PersistedState = loadState();

if (_state.cooldownUntil > Date.now()) {
  const secsLeft = Math.ceil((_state.cooldownUntil - Date.now()) / 1000);
  console.warn(
    `[QuotaGuard] Startup: active cooldown restored from disk — ` +
    `reason="${_state.reason}"  expires in ${secsLeft}s  ` +
    `(${new Date(_state.cooldownUntil).toISOString()})`,
  );
}

// ── Cooldown logic ─────────────────────────────────────────────────────────────

/** ms until next midnight UTC (when Google daily quotas reset) */
function msTillMidnightUTC(): number {
  const now = Date.now();
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0); // next midnight UTC
  return Math.max(midnight.getTime() - now, 60_000); // at least 1 min
}

const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min for per-minute limits

/**
 * Inspect the error response to decide whether this is a daily quota wall
 * (needs a long cooldown) or a short per-minute rate limit.
 */
function classifyError(err: any): "daily-quota" | "rate-limit" {
  const parts = [
    err?.message,
    err?.response?.data?.error?.message,
    err?.response?.data?.error?.errors?.[0]?.reason,
    JSON.stringify(err?.response?.data ?? ""),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Google's error reason codes for daily limits
  if (
    parts.includes("dailylimitexceeded") ||
    parts.includes("daily_limit_exceeded") ||
    parts.includes("per-day") ||
    parts.includes("per_day") ||
    parts.includes("day") ||
    parts.includes("userrateli") === false && parts.includes("ratelimitexceeded")
  ) {
    return "daily-quota";
  }

  // Treat anything we can't classify as daily to be safe
  // (a 5-min cooldown for a daily-quota hit just means more retry burns)
  return "daily-quota";
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Record that a 429 was received from Google.
 * Pass the raw error object so we can classify the cooldown duration.
 */
export function recordQuota429(err?: any): void {
  const reason = err ? classifyError(err) : "daily-quota";
  const cooldownMs = reason === "rate-limit"
    ? RATE_LIMIT_COOLDOWN_MS
    : msTillMidnightUTC();

  const now = Date.now();
  const cooldownUntil = now + cooldownMs;
  _state = { cooldownUntil, reason, recordedAt: now };
  saveState(_state);

  const mins = Math.round(cooldownMs / 60_000);
  console.warn(
    `[QuotaGuard] 429 recorded — reason="${reason}"  ` +
    `cooldown=${mins}min  until=${new Date(cooldownUntil).toISOString()}`,
  );
}

/**
 * Check whether the quota is currently cooling down.
 */
export function isQuotaCoolingDown(): {
  coolingDown: boolean;
  retryAfterMs: number;
  reason: string;
} {
  const now = Date.now();

  if (!_state.cooldownUntil || _state.cooldownUntil <= now) {
    if (_state.cooldownUntil) {
      // Expired — clean up
      _state = defaultState();
      saveState(_state);
    }
    return { coolingDown: false, retryAfterMs: 0, reason: "none" };
  }

  return {
    coolingDown: true,
    retryAfterMs: _state.cooldownUntil - now,
    reason: _state.reason,
  };
}

/**
 * Seconds remaining in the current cooldown, rounded up. 0 if not cooling down.
 */
export function quotaCooldownSecondsRemaining(): number {
  const { retryAfterMs } = isQuotaCoolingDown();
  return Math.ceil(retryAfterMs / 1000);
}

/**
 * Expose the current state for diagnostic endpoints.
 */
export function getQuotaGuardStatus(): {
  active: boolean;
  reason: string;
  cooldownUntil: string | null;
  secsRemaining: number;
} {
  const { coolingDown, retryAfterMs, reason } = isQuotaCoolingDown();
  return {
    active: coolingDown,
    reason,
    cooldownUntil: coolingDown ? new Date(_state.cooldownUntil).toISOString() : null,
    secsRemaining: Math.ceil(retryAfterMs / 1000),
  };
}
