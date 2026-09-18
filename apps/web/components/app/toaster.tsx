"use client";

import { CheckCircle, Info, Warning, WarningCircle, X } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";
import { Toaster } from "sonner";

import { getServerThemeChoice, readThemeChoice, subscribeThemeChoice } from "@/lib/theme";
import { useMediaQuery } from "@/lib/use-media-query";

/*
  Where toasts appear: top centre, just under the 64px header, in one stack
  for the whole site - the landing page, the app and the admin realm alike -
  mounted by the root layout so that a toast said just before a navigation
  is still there after it ("Payment method added", back on the offer that
  needed it).

  Painted by tokens (globals.css, "Toasts"), so both themes follow without a
  palette here. The resolved theme is handed over anyway, because sonner keys
  a few fallbacks of its own on it, and those should agree with the page.
*/
export function AppToaster() {
  const choice = useSyncExternalStore(subscribeThemeChoice, readThemeChoice, getServerThemeChoice);
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = choice === "system" ? (systemDark ? "dark" : "light") : choice;

  return (
    <Toaster
      position="top-center"
      theme={theme}
      closeButton
      offset={{ top: 76 }}
      mobileOffset={{ top: 72, left: 12, right: 12 }}
      containerAriaLabel="Updates"
      toastOptions={{ closeButtonAriaLabel: "Dismiss" }}
      icons={{
        success: (
          <CheckCircle
            size={18}
            weight="fill"
            aria-hidden="true"
            className="text-status-complete-fg"
          />
        ),
        error: (
          <WarningCircle
            size={18}
            weight="fill"
            aria-hidden="true"
            className="text-status-attention-fg"
          />
        ),
        warning: (
          <Warning size={18} weight="fill" aria-hidden="true" className="text-status-pending-fg" />
        ),
        info: <Info size={18} weight="fill" aria-hidden="true" className="text-primary" />,
        close: <X size={11} weight="bold" aria-hidden="true" />,
      }}
    />
  );
}
