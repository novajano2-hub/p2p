"use client";

import { CheckCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import { AppLink } from "@/components/ui/app-link";
import { adminClient, type KycReviewItem } from "@/lib/admin/client";

/*
  Everything waiting for a decision, oldest first. A queue rather than a list:
  the useful question is "what is next", and the oldest submission is the
  person who has been waiting longest to use their account.
*/

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function KycQueue() {
  const admin = useAdmin();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; items: KycReviewItem[] }
    | { status: "error"; message: string }
  >({ status: "loading" });

  const mayReview = admin.roles.includes("KYC_REVIEWER");

  useEffect(() => {
    if (!mayReview) return;
    let live = true;
    void adminClient.queue().then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { status: "ready", items: result.submissions }
          : { status: "error", message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [mayReview]);

  if (!mayReview) {
    return (
      <>
        <Heading count={null} />
        <NeedsRole role="KYC_REVIEWER" />
      </>
    );
  }

  return (
    <>
      <Heading count={state.status === "ready" ? state.items.length : null} />

      {state.status === "loading" ? (
        <p role="status" className="text-muted-foreground text-sm">
          Loading the queue&hellip;
        </p>
      ) : null}

      {state.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      ) : null}

      {state.status === "ready" && state.items.length === 0 ? (
        <div className="rounded-surface border-border bg-surface border px-5 py-12 text-center">
          <span className="bg-status-complete text-status-complete-fg mx-auto mb-3 flex size-11 items-center justify-center rounded-full">
            <CheckCircle size={22} weight="duotone" aria-hidden="true" />
          </span>
          <p className="text-foreground text-sm font-medium">Nothing waiting</p>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Every submission has been decided.
          </p>
        </div>
      ) : null}

      {state.status === "ready" && state.items.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {state.items.map((item) => (
            <li key={item.id}>
              <AppLink
                href={`/admin/submissions/${item.id}`}
                className="group rounded-surface border-border bg-surface hover:border-primary/40 flex flex-col gap-2 border px-4 py-3.5 transition-[border-color] duration-150 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-foreground group-hover:text-primary text-[15px] font-medium transition-colors duration-150">
                    {item.legalName}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-[13px]">
                    <span className="font-mono">{item.account.platformId}</span> ·{" "}
                    {item.account.username} · {item.documentType.replace(/_/g, " ").toLowerCase()}
                  </p>
                </div>
                <p className="text-muted-foreground shrink-0 text-[12px] tabular-nums">
                  waiting since {dateTime.format(new Date(item.submittedAt))}
                </p>
              </AppLink>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Heading({ count }: { count: number | null }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-foreground text-2xl leading-tight">Verification queue</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {count === null
          ? "Identity submissions waiting for a decision."
          : count === 1
            ? "1 submission waiting for a decision."
            : `${count} submissions waiting for a decision.`}
      </p>
    </div>
  );
}
