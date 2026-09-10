"use client";

import {
  ArrowRight,
  CheckCircle,
  Hourglass,
  SealCheck,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Panel } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { AppLink } from "@/components/ui/app-link";
import { ButtonLink } from "@/components/ui/button";
import { authClient, type KycState, type KycStatus } from "@/lib/auth/client";
import { dismissKycStatus, readDismissedKycStatus } from "@/lib/kyc-notice";
import { UNLOCKS } from "@/lib/kyc";

/*
  The call to action a new account lands on, and the only thing on this page
  that is asking for something rather than reporting something.

  It has four states and shows at most one of them at a time, and each is
  dismissible: an X in the corner, the way the platforms this audience already
  uses handle a task banner. Dismissing does not mean the account forgets
  where it stands - KycPill, below, is a small permanent fixture next to the
  username that says the same thing at all times and is the way back to
  /verify once the big card is gone.

  "Once" is per status, not forever: dismissing "under review" says nothing
  about a rejection that has not happened yet, so when the status actually
  changes the card reappears once for the new one. lib/kyc-notice.ts is the
  one stored value that makes that true without this component tracking a
  history of what it has shown.
*/
export function KycCard({ className }: { className?: string | undefined }) {
  const { user } = useSession();
  // The session carries the status, which is enough for every state except
  // the reason behind a refusal; that is fetched only when it is needed.
  const [state, setState] = useState<KycState | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissedKycStatus());

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
  if (dismissed === user.kycStatus) return null;

  const dismiss = () => {
    dismissKycStatus(user.kycStatus);
    setDismissed(user.kycStatus);
  };

  if (user.kycStatus === "PENDING") {
    return (
      <Panel className={className}>
        <div className="flex items-start gap-3.5">
          <span className="bg-status-pending text-status-pending-fg flex size-10 shrink-0 items-center justify-center rounded-full">
            <Hourglass size={20} weight="duotone" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-foreground text-[15px] font-semibold">
              Your verification is under review
            </h2>
            <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
              Someone is checking your details. Until that is done your limits stay where they were,
              and you cannot post offers. We will let you know the moment it is decided.
            </p>
          </div>
          <DismissButton onDismiss={dismiss} />
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
          <div className="min-w-0 flex-1">
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
          <DismissButton onDismiss={dismiss} />
        </div>
      </Panel>
    );
  }

  // NOT_STARTED: the one card on this page that asks for something.
  return (
    <Panel className={className}>
      <div className="flex items-start gap-2">
        <div className="flex flex-1 flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
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
        <DismissButton onDismiss={dismiss} />
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

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss"
      className="rounded-control text-muted-foreground hover:bg-muted hover:text-foreground -m-1 flex size-7 shrink-0 items-center justify-center transition-colors duration-150"
    >
      <X size={15} weight="bold" aria-hidden="true" />
    </button>
  );
}

const PILL_CONTENT: Record<
  Exclude<KycStatus, "APPROVED">,
  { label: string; icon: typeof SealCheck; tone: string }
> = {
  NOT_STARTED: {
    label: "Unverified",
    icon: SealCheck,
    tone: "bg-status-neutral text-status-neutral-fg",
  },
  PENDING: {
    label: "Under review",
    icon: Hourglass,
    tone: "bg-status-pending text-status-pending-fg",
  },
  REJECTED: {
    label: "Verification failed",
    icon: WarningCircle,
    tone: "bg-status-attention text-status-attention-fg",
  },
};

/*
  The permanent fixture next to the username. Always there, never dismissed,
  and always a link to /verify: whatever the big card above says and however
  long ago it was dismissed, this is the one place that never stops telling
  the truth about where the account stands.
*/
export function KycPill() {
  const { user } = useSession();

  if (user.kycStatus === "APPROVED") {
    return (
      <AppLink
        href="/verify"
        className="bg-status-complete text-status-complete-fg inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap"
      >
        <SealCheck size={14} weight="fill" aria-hidden="true" />
        Verified
      </AppLink>
    );
  }

  const { label, icon: Icon, tone } = PILL_CONTENT[user.kycStatus];
  return (
    <AppLink
      href="/verify"
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap transition-opacity duration-150 hover:opacity-80 ${tone}`}
    >
      <Icon size={14} weight="fill" aria-hidden="true" />
      {label}
    </AppLink>
  );
}
