"use client";

import { ArrowsClockwise, WarningCircle } from "@phosphor-icons/react";
import { useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/*
  What a screen shows when what it needed did not load: the reason, in the
  words the request came back with, and a way to ask again. Every screen that
  loads anything uses this one, so none of them is a dead end - before it, a
  failed load left a sentence and nothing to press.

  Coming back online is a retry nobody has to press: the browser says when
  the connection returns, and the screen asks again by itself.
*/
export function LoadFailed({
  message,
  onRetry,
  className,
}: {
  message: ReactNode;
  onRetry: () => void;
  className?: string | undefined;
}) {
  useEffect(() => {
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [onRetry]);

  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center gap-3 px-4 py-8 text-center", className)}
    >
      <WarningCircle
        size={26}
        weight="duotone"
        aria-hidden="true"
        className="text-status-attention-fg"
      />
      <p className="text-foreground max-w-sm text-sm leading-relaxed">{message}</p>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        <ArrowsClockwise size={15} weight="bold" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
