"use client";

import { ArrowsClockwise, CircleNotch, WifiSlash } from "@phosphor-icons/react";
import { useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { ConnectionState } from "@/lib/realtime/client";
import { site } from "@/lib/site";

/*
  One line under the header when the connection is not what the screen
  assumes, and nothing at all when it is.

  Offline comes first and says the thing that matters: nothing done now
  reaches BIRQ. Then the live connection, which a customer's screens lean on
  for a buyer's "I have paid" or a new message: quietly, once it has been
  down a few seconds (the client decides; a blip says nothing), or plainly
  when this tab was stood down for being one too many.

  The admin realm has no live connection; it passes none and gets the
  offline line only.
*/

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/*
  Pinned under the header (`className` carries the offset: the two realms'
  headers differ in height), so it stays in view on a long page.
*/
export function ConnectionBanner({
  live,
  className,
}: {
  live?: ConnectionState | undefined;
  className?: string | undefined;
}) {
  const online = useOnline();

  if (!online) {
    return (
      <Bar tone="attention" className={className}>
        <WifiSlash size={16} weight="bold" aria-hidden="true" className="shrink-0" />
        <span>
          <strong className="font-semibold">You are offline.</strong> Nothing you do can reach{" "}
          {site.name} until you are back online.
        </span>
      </Bar>
    );
  }

  if (live === "paused") {
    return (
      <Bar tone="neutral" className={className}>
        <span>Live updates are off in this tab because {site.name} is open in too many tabs.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-foreground inline-flex shrink-0 items-center gap-1 font-medium underline-offset-4 hover:underline"
        >
          <ArrowsClockwise size={14} weight="bold" aria-hidden="true" />
          Reload this tab
        </button>
      </Bar>
    );
  }

  if (live === "reconnecting") {
    return (
      <Bar tone="neutral" className={className}>
        <CircleNotch
          size={14}
          weight="bold"
          aria-hidden="true"
          className="shrink-0 animate-spin motion-reduce:animate-none"
        />
        <span>Reconnecting. Live updates will be back in a moment.</span>
      </Bar>
    );
  }

  return null;
}

function Bar({
  tone,
  className,
  children,
}: {
  tone: "attention" | "neutral";
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "sticky z-30 border-b",
        className,
        tone === "attention"
          ? "border-destructive/20 bg-status-attention text-status-attention-fg"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-[13px] leading-relaxed sm:px-8">
        {children}
      </div>
    </div>
  );
}
