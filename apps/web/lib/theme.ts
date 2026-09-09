/*
  Theme preference for signed-in customers: follow the operating system, or pin
  light or dark. The landing page follows the system for everyone; once a
  preference is saved it applies everywhere, because a person who chose dark
  should not get a light landing page the moment they click the logo.

  The choice lives in localStorage and is applied as `data-theme` on <html>,
  which globals.css keys its tokens on. THEME_BOOT_SCRIPT applies it before
  first paint so a dark preference never flashes light on load.
*/

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "birq.theme";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

/** The saved choice, or "system" when nothing is saved or storage is unavailable. */
export function readThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

const listeners = new Set<() => void>();

export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);

  try {
    if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Private mode or storage disabled: the attribute still applies to this
    // page, it just will not survive a reload.
  }

  for (const listener of listeners) listener();
}

/** For useSyncExternalStore: a change here, or in another tab, re-renders the control. */
export function subscribeThemeChoice(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export const getServerThemeChoice = (): ThemeChoice => "system";

/*
  Inlined into the document by the root layout. A string, not a module, so it
  runs before any bundle is fetched. Deliberately does nothing for "system":
  with no attribute, the CSS follows prefers-color-scheme as it always has.
*/
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;
