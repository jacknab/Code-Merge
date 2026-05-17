/**
 * Phase 9.3 — Practice Mode context.
 *
 * Tracks whether the practice overlay is open and exposes enter/exit. Phase
 * 9.4 will piggyback on this to swap the active storeId; for now the context
 * just controls the portal's visibility.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface PracticeModeContextValue {
  inPractice: boolean;
  enterPractice: () => void;
  exitPractice: () => void;
  togglePractice: () => void;
}

const PracticeModeContext = createContext<PracticeModeContextValue>({
  inPractice: false,
  enterPractice: () => {},
  exitPractice: () => {},
  togglePractice: () => {},
});

export function PracticeModeProvider({ children }: { children: ReactNode }) {
  const [inPractice, setInPractice] = useState(false);

  const enterPractice = useCallback(() => setInPractice(true), []);
  const exitPractice = useCallback(() => setInPractice(false), []);
  const togglePractice = useCallback(() => setInPractice((p) => !p), []);

  // Cmd/Ctrl+Shift+P opens the overlay; Esc closes it (Esc is also handled
  // inside the overlay for outside-click parity).
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      const isToggle =
        (e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "p" || e.key === "P");
      if (isToggle) {
        e.preventDefault();
        togglePractice();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [togglePractice]);

  const value = useMemo(
    () => ({ inPractice, enterPractice, exitPractice, togglePractice }),
    [inPractice, enterPractice, exitPractice, togglePractice],
  );

  return (
    <PracticeModeContext.Provider value={value}>
      {children}
    </PracticeModeContext.Provider>
  );
}

export function usePracticeMode() {
  return useContext(PracticeModeContext);
}
