"use client";

import { Check } from "@phosphor-icons/react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { site } from "@/lib/site";

/*
  A real, miniature trade room, not a picture of one. It walks through the
  three states a trade passes through so the escrow model is understood
  before a word of the copy is read. Purpose: explanation.

  Cycles every 2.8s while in view and not hovered or focused. Under reduced
  motion it renders the final state, statically, with no interval at all.
*/

const steps = [
  {
    key: "locked",
    label: "USDT locked in escrow",
    detail: "Selam's 250 USDT is held by the platform. Dawit can now pay.",
  },
  {
    key: "paid",
    label: "Birr sent, marked paid",
    detail: "Dawit sent 39,600 ETB by bank transfer and marked the trade paid.",
  },
  {
    key: "released",
    label: "USDT released to buyer",
    detail: "Selam confirmed the birr arrived. 250 USDT is now in Dawit's balance.",
  },
] as const;

const STEP_MS = 2800;
const ease = [0.23, 1, 0.32, 1] as const;

export function TradePreview() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const running = !reduce && inView && !paused;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % steps.length);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [running]);

  const shown = reduce ? steps.length - 1 : index;
  const current = steps[shown] ?? steps[0];
  const progress = shown / (steps.length - 1);

  return (
    <div
      ref={ref}
      className="relative"
      // Only a mouse can "leave"; a touch tap must not pause the cycle for good.
      onPointerEnter={(event) => event.pointerType === "mouse" && setPaused(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setPaused(false)}
    >
      <div
        aria-hidden="true"
        className="rounded-panel bg-primary-soft absolute inset-0 translate-x-3 translate-y-3"
      />

      <article
        aria-label="Example trade"
        className="rounded-panel border-border bg-surface shadow-panel relative border p-5 sm:p-6"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-sm">Buying</p>
            <p className="mt-0.5 font-mono text-[1.75rem] leading-none font-medium tabular-nums">
              250.00 <span className="text-muted-foreground text-base">USDT</span>
            </p>
          </div>
          <StatusBadge stepKey={current.key} label={current.label} reduce={reduce === true} />
        </header>

        <dl className="border-border mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-5 text-sm">
          <Field term="Rate" value="158.40 ETB / USDT" mono />
          <Field term="You pay" value="39,600.00 ETB" mono />
          <Field term="Seller" value="Selam A." />
          <Field term="Pay by" value="Bank transfer" />
        </dl>

        <ol className="relative mt-6 flex flex-col gap-3.5" aria-label="Trade progress">
          <span aria-hidden="true" className="bg-border absolute top-3 bottom-3 left-[11px] w-px" />
          <motion.span
            aria-hidden="true"
            className="bg-primary absolute top-3 bottom-3 left-[11px] w-px origin-top"
            initial={false}
            animate={{ transform: `scaleY(${progress})` }}
            transition={reduce ? { duration: 0 } : { duration: 0.5, ease }}
          />
          {steps.map((step, i) => {
            const state = i < shown ? "done" : i === shown ? "active" : "pending";
            return (
              <li key={step.key} className="relative flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color] duration-300 ease-out",
                    state === "done" && "border-primary bg-primary text-primary-foreground",
                    state === "active" && "border-primary bg-surface",
                    state === "pending" && "border-border bg-surface",
                  )}
                  aria-hidden="true"
                >
                  {state === "done" ? (
                    <Check size={13} weight="bold" />
                  ) : state === "active" ? (
                    <span className="bg-primary size-2 rounded-full" />
                  ) : null}
                </span>
                <span
                  className={cn(
                    "text-[15px] transition-colors duration-300 ease-out",
                    state === "pending" ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {step.label}
                </span>
                <span className="sr-only">
                  {state === "done" ? " (done)" : state === "active" ? " (current)" : " (pending)"}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="border-border mt-6 min-h-[2.75rem] border-t pt-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={current.key}
              className="text-muted-foreground text-[15px] leading-snug text-pretty"
              initial={reduce ? false : { opacity: 0, transform: "translateY(4px)" }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              {...(reduce ? {} : { exit: { opacity: 0, transform: "translateY(-4px)" } })}
              transition={{ duration: 0.22, ease }}
            >
              {current.detail}
            </motion.p>
          </AnimatePresence>
        </div>

        <p className="text-muted-foreground mt-4 text-xs">
          Example trade on {site.name}. Names and rate are illustrative.
        </p>
      </article>
    </div>
  );
}

type FieldProps = { term: string; value: string; mono?: boolean };

function Field({ term, value, mono = false }: FieldProps) {
  return (
    <div>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className={cn("text-foreground mt-0.5 font-medium", mono && "font-mono tabular-nums")}>
        {value}
      </dd>
    </div>
  );
}

type StatusBadgeProps = { stepKey: (typeof steps)[number]["key"]; label: string; reduce: boolean };

const badgeTone: Record<StatusBadgeProps["stepKey"], string> = {
  locked: "bg-muted text-foreground",
  paid: "bg-primary-soft text-primary-soft-foreground",
  released: "bg-primary text-primary-foreground",
};

function StatusBadge({ stepKey, label, reduce }: StatusBadgeProps) {
  return (
    <div className="relative h-7 shrink-0" role="status" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={stepKey}
          className={cn(
            "inline-flex h-7 items-center rounded-full px-3 text-xs font-medium whitespace-nowrap",
            badgeTone[stepKey],
          )}
          initial={reduce ? false : { opacity: 0, transform: "translateY(4px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          {...(reduce ? {} : { exit: { opacity: 0, transform: "translateY(-4px)" } })}
          transition={{ duration: 0.2, ease }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
