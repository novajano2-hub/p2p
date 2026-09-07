import type { Icon } from "@phosphor-icons/react";
import { Fingerprint, LockKey, QrCode, Scales } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import type { ReactNode } from "react";

import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHeading } from "@/components/marketing/section";
import { cn } from "@/lib/cn";

export function Safety() {
  return (
    <Section id="safety" aria-labelledby="safety-title">
      <Reveal>
        <SectionHeading
          id="safety-title"
          title="Built so your money is never in limbo"
          lede="Every rule below exists because the birr side of a trade happens outside the platform, where nobody can see it."
        />
      </Reveal>

      {/* Five items, five cells: 2+1 over 1+1+1. */}
      <div className="mt-14 grid gap-4 lg:mt-16 lg:grid-cols-3">
        <Reveal className="lg:col-span-2">
          <Cell
            tone="tinted"
            Icon={LockKey}
            title="Escrow, not promises"
            body="USDT is locked before anyone pays a single birr, and released only when the seller confirms the money arrived. A buyer clicking a button cannot move it."
          >
            <EscrowStrip />
          </Cell>
        </Reveal>

        <Reveal delay={0.06}>
          <figure className="rounded-panel border-border bg-muted relative h-full min-h-64 overflow-hidden border">
            {/* TODO: replace with a real photograph (people, a market, a bank counter) at 800x1000. */}
            <Image
              src="https://picsum.photos/seed/abay-market-addis/800/1000?grayscale"
              alt="Placeholder photograph"
              fill
              sizes="(min-width: 1024px) 33vw, 100vw"
              className="object-cover"
            />
          </figure>
        </Reveal>

        <Reveal delay={0.12}>
          <Cell
            Icon={QrCode}
            title="Your own deposit address"
            body="Every account gets a unique USDT address, so a deposit is always matched to you and never to someone else."
          />
        </Reveal>

        <Reveal delay={0.18}>
          <Cell
            Icon={Scales}
            title="Real dispute review"
            body="If a trade goes wrong, a reviewer looks at evidence from both sides before any funds move, and every decision is recorded."
          />
        </Reveal>

        <Reveal delay={0.24}>
          <Cell
            Icon={Fingerprint}
            title="A second confirmation for the big moments"
            body="Withdrawals and escrow release ask you to confirm again, even when you are already logged in."
          />
        </Reveal>
      </div>
    </Section>
  );
}

type CellProps = {
  Icon: Icon;
  title: string;
  body: string;
  tone?: "surface" | "tinted";
  children?: ReactNode;
};

function Cell({ Icon, title, body, tone = "surface", children }: CellProps) {
  return (
    <div
      className={cn(
        "rounded-panel flex h-full flex-col border p-6 sm:p-7",
        tone === "surface" && "border-border bg-surface",
        tone === "tinted" && "border-primary/15 bg-primary-soft text-primary-soft-foreground",
      )}
    >
      <span
        className={cn(
          "rounded-control flex size-11 items-center justify-center",
          tone === "surface"
            ? "bg-primary-soft text-primary-soft-foreground"
            : "bg-primary text-primary-foreground",
        )}
      >
        <Icon size={22} aria-hidden="true" />
      </span>
      <h3
        className={cn(
          "mt-5 text-xl font-semibold tracking-tight text-balance",
          tone === "surface" ? "text-foreground" : "text-primary-soft-foreground",
        )}
      >
        {title}
      </h3>
      <p
        className={cn(
          "mt-2 max-w-prose text-[15px] leading-relaxed text-pretty",
          tone === "surface" ? "text-muted-foreground" : "text-primary-soft-foreground/85",
        )}
      >
        {body}
      </p>
      {children ? <div className="mt-auto pt-8">{children}</div> : null}
    </div>
  );
}

/** Static illustration of the ledger move that escrow actually is. */
function EscrowStrip() {
  return (
    <div className="rounded-control border-primary/15 bg-surface/70 grid gap-2 border p-4 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-4">
      <Balance label="Seller available" before="250.00" after="0.00" />
      <span aria-hidden="true" className="text-muted-foreground hidden sm:block">
        &rarr;
      </span>
      <Balance label="Trade escrow" before="0.00" after="250.00" />
    </div>
  );
}

function Balance({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-mono text-base tabular-nums">
        <span className="text-muted-foreground decoration-muted-foreground/60 line-through">
          {before}
        </span>{" "}
        <span className="text-foreground font-medium">{after}</span>{" "}
        <span className="text-muted-foreground">USDT</span>
      </p>
    </div>
  );
}
