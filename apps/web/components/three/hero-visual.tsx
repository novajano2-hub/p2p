"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

import { SceneErrorBoundary } from "@/components/three/scene-error-boundary";
import { cn } from "@/lib/cn";
import { useDelayedTrue, useLowPower, useMediaQuery } from "@/lib/use-media-query";

/*
  three.js is loaded only in the browser, only at desktop widths, only after
  the hero entrance has had the main thread to itself, and only once the
  viewer's motion preference is known. Everywhere else nothing is fetched.
*/
const EscrowScene = dynamic(() => import("@/components/three/escrow-scene"), {
  ssr: false,
  loading: () => null,
});

/** Below this width the scene is not rendered at all; the hero is text only. */
const DESKTOP = "(min-width: 1024px)";

export function HeroVisual({ className }: { className?: string }) {
  const desktop = useMediaQuery(DESKTOP);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const lowPower = useLowPower();
  // Mount the scene after the headline entrance so the chunk parse never stutters it.
  const settled = useDelayedTrue(reduced ? 0 : 1400);
  const mounted = desktop && settled;

  return (
    <div
      data-hero-visual
      data-state={desktop ? "ready" : "hidden"}
      aria-hidden="true"
      className={cn("relative aspect-square w-full", className)}
    >
      <Backdrop />
      {mounted ? (
        <div className="absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none starting:opacity-0">
          <SceneErrorBoundary fallback={<StillCoin />}>
            <Suspense fallback={null}>
              <EscrowScene reduced={reduced} lowPower={lowPower} />
            </Suspense>
          </SceneErrorBoundary>
        </div>
      ) : null}
    </div>
  );
}

/** Soft sage floor the scene sits on. Always present, under the canvas. */
function Backdrop() {
  return (
    <div className="rounded-surface absolute inset-0 bg-[radial-gradient(58%_48%_at_50%_60%,color-mix(in_oklab,var(--color-sage)_32%,transparent),transparent_72%)]" />
  );
}

/** Static stand-in when WebGL is unavailable: the coin, held. */
function StillCoin() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="rounded-surface border-border bg-surface/70 shadow-panel flex size-[46%] items-center justify-center border">
        <div className="bg-primary ring-sage/70 size-[42%] rounded-full ring-4" />
      </div>
    </div>
  );
}
