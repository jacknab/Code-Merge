// Adaptive weaning reducer for the staff training tool.
// Pure function: given the current per-category state and an incoming event,
// returns the next state. See docs/STAFF_TRAINING_TOOL_PLAN.md §3a.

export type TrainingEventType =
  | "view"
  | "success"
  | "hesitation"
  | "wrong-click"
  | "help-requested"
  | "abandoned";

export interface CategoryState {
  helpLevel: number;          // 0..3, current adaptive level
  successStreak: number;      // consecutive unaided successes at current level
  failures: number;           // running fail counter (informational; promotion is per-event)
  totalAttempts: number;      // total successful completions ever
  lastSeenAt: Date | null;
  graduatedAt: Date | null;
  pinnedLevel: number | null; // owner override; if set, helpLevel never changes
  enrolledAt: Date;           // when this category first became active for the user
}

export interface ReducerInput {
  state: CategoryState;
  event: { type: TrainingEventType; at?: Date };
  highRisk?: boolean;
}

const SUCCESSES_TO_DEMOTE: Record<number, number> = {
  3: 2, // L3 -> L2 after 2 consecutive successes
  2: 3, // L2 -> L1 after 3
  1: 3, // L1 -> L0 after 3 (plus 24h gate handled below)
  0: Infinity,
};

const L1_TO_L0_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const PER_CATEGORY_GRAD_SUCCESSES = 5;

export function reduce({ state, event, highRisk }: ReducerInput): CategoryState {
  const now = event.at ?? new Date();
  const next: CategoryState = { ...state, lastSeenAt: now };

  // Owner pin: helpLevel is locked, but we still record streaks for analytics.
  const isPinned = next.pinnedLevel !== null && next.pinnedLevel !== undefined;
  // Once graduated, stay graduated (Phase 7 will handle "welcome back" reset).
  if (next.graduatedAt) {
    return next;
  }

  switch (event.type) {
    case "view":
      // Pure observation; no state change beyond lastSeenAt.
      return next;

    case "success": {
      next.successStreak += 1;
      next.totalAttempts += 1;
      if (!isPinned) {
        const required = SUCCESSES_TO_DEMOTE[next.helpLevel] ?? Infinity;
        if (next.successStreak >= required) {
          // L1 -> L0 also requires 24h since enrollment (anti speed-run).
          const ageMs = now.getTime() - next.enrolledAt.getTime();
          const allowDemote =
            next.helpLevel !== 1 || ageMs >= L1_TO_L0_MIN_AGE_MS;
          if (allowDemote && next.helpLevel > 0) {
            next.helpLevel -= 1;
            next.successStreak = 0;
            next.failures = 0;
          }
        }
        // High-risk categories never auto-graduate below L1 without owner action.
        if (
          next.helpLevel === 0 &&
          !highRisk &&
          next.totalAttempts >= PER_CATEGORY_GRAD_SUCCESSES
        ) {
          next.graduatedAt = now;
        }
      }
      return next;
    }

    case "hesitation":
    case "wrong-click":
    case "abandoned": {
      next.failures += 1;
      next.successStreak = 0;
      if (!isPinned && next.helpLevel < 3) {
        next.helpLevel += 1;
      }
      return next;
    }

    case "help-requested": {
      // Explicit ask for guidance — jump straight back to full spotlight (L3).
      next.failures += 1;
      next.successStreak = 0;
      if (!isPinned) {
        next.helpLevel = 3;
      }
      return next;
    }

    default:
      return next;
  }
}
