"use client";

import {
  ArrowRight,
  CheckCircle,
  Hourglass,
  SealCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Panel } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { ButtonLink } from "@/components/ui/button";
import { authClient, type KycState } from "@/lib/auth/client";
import { UNLOCKS } from "@/lib/kyc";

/*
  The call to action a new account lands on, and the only thing on this page
  that is asking for something rather than reporting something.

  It has three states and no fourth: once verified it disappears entirely
  rather than becoming a "you are verified" card nobody needs to read twice.
  That is what makes it a task a person can finish - it is either in the way,
  or it is gone.
*/
export function KycCard({ className }: { className?: string | undefined }) {
  const { user } = useSession();
  // The session carries the status, which is enough for every state except
  // the reason behind a refusal; that is fetched only when it is needed.
  const [state, setState] = useState<KycState | null>(null);

  useEffect(() => {
    if (user.kycStatus !== "REJECTED") return;
    let live = true;
    void authClient.kycState().then((result) => {
      if (live && result.ok) setState(result.state);
    });
    return () => {
      live = false;
    };
  }, [user.kycStatus]);

  if (user.kycStatus === "APPROVED") return null;

  if (user.kycStatus === "PENDING") {
    return (
      <Panel className={className}>
        <div className="flex items-start gap-3.5">
          <span className="bg-status-pending text-status-pending-fg flex size-10 shrink-0 items-center justify-center rounded-full">
            <Hourglass size={20} weight="duotone" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-foreground text-[15px] font-semibold">
              Your verification is under review
            </h2>
            <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
              Someone is checking your details. Until that is done your limits stay where they were,
              and you cannot post offers. We will email you the moment it is decided.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  if (user.kycStatus === "REJECTED") {
    return (
      <Panel className={className}>
        <div className="flex items-start gap-3.5">
          <span className="bg-status-attention text-status-attention-fg flex size-10 shrink-0 items-center justify-center rounded-full">
            <WarningCircle size={20} weight="duotone" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-foreground text-[15px] font-semibold">
              We could not verify your identity
            </h2>
            <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
              {state?.rejectionReason ??
                "Check that your details match your document exactly, then try again."}
            </p>
            <div className="mt-4">
              <ButtonLink href="/verify" size="sm" arrow={false}>
                Try again
              </ButtonLink>
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  // NOT_STARTED: the one card on this page that asks for something.
  return (
    <Panel className={className}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3.5">
          <span className="bg-primary-soft text-primary-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
            <SealCheck size={20} weight="duotone" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-foreground text-[15px] font-semibold">Verify your identity</h2>
            <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
              You can trade small amounts now. Verifying lifts your limits and lets you post your
              own offers. Have your ID card, passport or driver&apos;s licence ready: it takes a
              couple of minutes, and a person reviews it.
            </p>
          </div>
        </div>
        <ButtonLink href="/verify" className="shrink-0 sm:mt-0.5" arrow={false}>
          Verify now
          <ArrowRight size={16} weight="bold" aria-hidden="true" />
        </ButtonLink>
      </div>

      <ul className="border-border mt-5 grid gap-3 border-t pt-5 sm:grid-cols-3">
        {UNLOCKS.map((unlock) => (
          <li key={unlock.title} className="flex items-start gap-2.5">
            <CheckCircle
              size={17}
              weight="fill"
              aria-hidden="true"
              className="text-primary mt-0.5 shrink-0"
            />
            <div>
              <p className="text-foreground text-[13px] font-medium">{unlock.title}</p>
              <p className="text-muted-foreground text-[12px] leading-relaxed">{unlock.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The pill in the page header. Says verified, or how far off it is. */
export function KycPill() {
  const { user } = useSession();
  if (user.kycStatus !== "APPROVED") return null;
  return (
    <span className="bg-status-complete text-status-complete-fg inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap">
      <SealCheck size={14} weight="fill" aria-hidden="true" />
      Verified
    </span>
  );
}
