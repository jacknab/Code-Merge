import { useState, useEffect } from "react";

/**
 * Returns true when the current browser session has admin privileges.
 *
 * Admin mode is activated by visiting any page with `?admin=true` in the URL.
 * The flag is stored in sessionStorage (not localStorage) so it resets when
 * the tab or browser is closed — regular end-users always start without it.
 *
 * Deactivate by visiting any page with `?admin=false`.
 */
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    // Migrate any stale localStorage flag to sessionStorage then clear it
    const legacy = localStorage.getItem("isAdmin");
    if (legacy !== null) {
      localStorage.removeItem("isAdmin");
      if (legacy === "true") sessionStorage.setItem("isAdmin", "true");
    }
    return sessionStorage.getItem("isAdmin") === "true";
  });

  useEffect(() => {
    // Honour ?admin=true / ?admin=false in the URL on every navigation
    const params = new URLSearchParams(window.location.search);
    if (params.get("admin") === "true") {
      sessionStorage.setItem("isAdmin", "true");
      setIsAdmin(true);
    } else if (params.get("admin") === "false") {
      sessionStorage.removeItem("isAdmin");
      setIsAdmin(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      setIsAdmin(sessionStorage.getItem("isAdmin") === "true");
    };
    window.addEventListener("certxa:adminChanged", handler);
    return () => window.removeEventListener("certxa:adminChanged", handler);
  }, []);

  return isAdmin;
}
