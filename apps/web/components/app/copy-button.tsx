"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";

import { cn } from "@/lib/cn";

/*
  Copies a value to the clipboard and says so for a moment. Used for the
  things a person hands to someone else: their account number, later a
  deposit address.
*/
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string | undefined;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // No clipboard access (insecure context, permission denied): the
          // value is on screen to select by hand, so nothing else to do.
        }
      }}
      className={cn(
        "rounded-control text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-7 items-center justify-center transition-colors duration-150",
        className,
      )}
    >
      {copied ? (
        <Check size={15} weight="bold" aria-hidden="true" className="text-status-complete-fg" />
      ) : (
        <Copy size={15} aria-hidden="true" />
      )}
    </button>
  );
}

/** The account number as a chip: "UID BQ-12345678" with a copy button. */
export function UidChip({ platformId }: { platformId: string }) {
  return (
    <span className="border-border bg-surface inline-flex h-8 items-center gap-1 rounded-full border pr-0.5 pl-3 text-[13px]">
      <span className="text-muted-foreground">UID</span>
      <span className="text-foreground font-mono font-medium tabular-nums">{platformId}</span>
      <CopyButton value={platformId} label="Copy account number" />
    </span>
  );
}
