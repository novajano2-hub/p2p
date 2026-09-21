"use client";

import { Check } from "@phosphor-icons/react";
import { type ReactNode } from "react";

import { cn } from "@/lib/cn";

/*
  Moving money, as steps down one line: coin, network, address to deposit;
  coin, where to, how much to withdraw. It is the shape every exchange this
  audience already uses, and the order is the point of it - the network is
  settled before the address is shown, the address before the amount.

  A step already answered shows a tick; the one being done shows its number.
  The line between them runs from marker to marker and stops at the last.
*/
export function Steps({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {children}
    </ol>
  );
}

export function Step({
  n,
  title,
  done = false,
  last = false,
  children,
}: {
  n: number;
  title: string;
  /** Answered already: a tick instead of its number. */
  done?: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 sm:gap-x-4">
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular-nums"
        >
          {done ? <Check size={14} weight="bold" /> : n}
        </span>
        {last ? null : <span aria-hidden="true" className="bg-border my-1 w-0.5 flex-1" />}
      </div>
      <div className={cn("min-w-0", last ? "" : "pb-7")}>
        <h2 className="font-display text-foreground mb-2.5 text-base leading-7 font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </li>
  );
}
