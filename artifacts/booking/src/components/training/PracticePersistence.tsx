/**
 * Phase 9.5 — resume-where-you-left-off helpers for the practice overlay.
 *
 * The MemoryRouter inside the overlay forgets its location every time the
 * portal unmounts. We snapshot the current path + the scroll position of the
 * overlay scroll container into localStorage (keyed by user id) so re-opening
 * the overlay drops the trainee back exactly where they were.
 *
 * Pages that hold in-progress form state can also opt into persistence via
 * `usePracticeFormState` below — give it a stable key and it'll read/write
 * to the same per-user namespace.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";

interface SavedState {
  path: string;
  scroll: number;
  savedAt: number;
}

const STORAGE_PREFIX = "practice-mode:state:";
const FORM_PREFIX = "practice-mode:form:";

function storageKey(userId: string | null | undefined): string {
  return `${STORAGE_PREFIX}${userId ?? "anon"}`;
}

function readSnapshot(userId: string | null | undefined): SavedState | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedState;
    if (typeof parsed.path !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(userId: string | null | undefined, snap: SavedState) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(snap));
  } catch {
    // Quota / private mode — ignore.
  }
}

/**
 * Mounted once inside the overlay's MemoryRouter. Restores the saved path on
 * mount, and continuously snapshots the current path + scroll on changes.
 */
export function PracticePersistence({
  scrollRef,
}: {
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const { user } = useAuth();
  const userId = (user as any)?.id ?? null;
  const location = useLocation();
  const navigate = useNavigate();
  const restoredRef = useRef(false);

  // Restore once on mount.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const snap = readSnapshot(userId);
    if (snap && snap.path && snap.path !== location.pathname + location.search) {
      navigate(snap.path, { replace: true });
      // Wait one tick for the new route to render before applying scroll.
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = snap.scroll;
      });
    } else if (snap && scrollRef.current) {
      scrollRef.current.scrollTop = snap.scroll;
    }
    // Intentionally only on mount.
  }, []);

  // Snapshot on path change (always) and on scroll (debounced).
  useEffect(() => {
    if (!restoredRef.current) return;
    writeSnapshot(userId, {
      path: location.pathname + location.search,
      scroll: scrollRef.current?.scrollTop ?? 0,
      savedAt: Date.now(),
    });
  }, [location.pathname, location.search, scrollRef, userId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer: number | null = null;
    const onScroll = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        writeSnapshot(userId, {
          path: location.pathname + location.search,
          scroll: el.scrollTop,
          savedAt: Date.now(),
        });
      }, 250);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [scrollRef, location.pathname, location.search, userId]);

  return null;
}

/**
 * Opt-in form-state persistence for pages that want to survive overlay close.
 * Behaves like useState but mirrors the value to localStorage under a
 * per-user, per-key namespace.
 *
 * Example:
 *   const [draft, setDraft] = usePracticeFormState("new-booking", { name: "" });
 */
export function usePracticeFormState<T>(
  key: string,
  initial: T,
): [T, (v: T | ((prev: T) => T)) => void, () => void] {
  const { user } = useAuth();
  const userId = (user as any)?.id ?? "anon";
  const fullKey = `${FORM_PREFIX}${userId}:${key}`;

  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(fullKey, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [fullKey, state]);

  const clear = () => {
    try {
      localStorage.removeItem(fullKey);
    } catch {
      // ignore
    }
    setState(initial);
  };

  return [state, setState, clear];
}
