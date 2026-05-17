// Step descriptors for the staff training overlay.
// A step targets an element via data-testid and advances on a condition.

export type AdvanceCondition =
  | { kind: "click"; testid?: string }              // advance when target (or override) is clicked
  | { kind: "any-click"; testidPrefix: string }      // advance when any element whose testid starts with prefix is clicked
  | { kind: "route"; pathPrefix: string }            // advance when location.pathname starts with prefix
  | { kind: "manual" };                              // advance only via api.next()

export interface StepDescriptor {
  id: string;
  testid: string;                  // primary target element selector
  testidPrefix?: string;           // optional: also match any testid starting with this (for dynamic lists)
  title: string;
  body: string;
  why?: string;                    // "why this matters" expander
  variant?: "spotlight" | "tooltip" | "whisper";  // override; otherwise derived from helpLevel
  advance: AdvanceCondition;
  optional?: boolean;              // if target never appears, skip after timeout
}

export type Variant = "spotlight" | "tooltip" | "whisper" | "silent";

export function variantForHelpLevel(level: number, override?: StepDescriptor["variant"]): Variant {
  if (override) return override;
  if (level >= 3) return "spotlight";
  if (level === 2) return "tooltip";
  if (level === 1) return "whisper";
  return "silent";
}
