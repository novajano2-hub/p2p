"use client";

import { Hourglass, SealCheck, WarningCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Panel } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { ButtonLink } from "@/components/ui/button";

/*
  Advertising is the side a stranger sends birr to, so it is the side worth
  having a name against: only a verified account may post (KYC_TIERS
  .canPostOffers, enforced in the API's OfferService.assertMayPost).

  The server is where that rule lives and this is not a second copy of it -
  it is the same rule said early. Without this the refusal arrives on the
  submit button, after a person has chosen a price, limits, a window, a
  payment method and written their terms, which is the worst moment to learn
  it. Taking somebody else's ad needs none of this; only posting one does.
*/

/** Whether this session may post an ad, and what to say if not. */
export function useMayPostAds(): boolean {
  return useSession().user.kycStatus === "APPROVED";
}

export function VerifyToPost({ className }: { className?: string | undefined }) {
  const { user } = useSession();

  if (user.kycStatus === "APPROVED") return null;

  if (user.kycStatus === "PENDING") {
    return (
      <Notice
        className={className}
        tone="pending"
        icon={<Hourglass size={20} weight="duotone" aria-hidden="true" />}
        title="Your verification is under review"
      >
        You can post an ad the moment it is approved. Until then you can still take somebody
        else&rsquo;s.
      </Notice>
    );
  }

  if (user.kycStatus === "REJECTED") {
    return (
      <Notice
        className={className}
        tone="attention"
        icon={<WarningCircle size={20} weight="duotone" aria-hidden="true" />}
        title="We could not verify your identity"
        action={
          <ButtonLink href="/verify" size="sm" arrow={false}>
            Try again
          </ButtonLink>
        }
      >
        Posting an ad needs a verified account. Check that your details match your document exactly,
        then submit again.
      </Notice>
    );
  }

  return (
    <Notice
      className={className}
      tone="primary"
      icon={<SealCheck size={20} weight="duotone" aria-hidden="true" />}
      title="Verify your identity to post an ad"
      action={
        <ButtonLink href="/verify" size="sm" arrow={false}>
          Verify now
        </ButtonLink>
      }
    >
      An ad is the side a buyer sends money to, so it carries a name. You can take somebody
      else&rsquo;s ad without this.
    </Notice>
  );
}

const TONES = {
  primary: "bg-primary/10 text-primary",
  pending: "bg-status-pending text-status-pending-fg",
  attention: "bg-status-attention text-status-attention-fg",
} as const;

function Notice({
  className,
  tone,
  icon,
  title,
  action,
  children,
}: {
  className?: string | undefined;
  tone: keyof typeof TONES;
  icon: ReactNode;
  title: string;
  action?: ReactNode | undefined;
  children: ReactNode;
}) {
  return (
    <Panel className={className}>
      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${TONES[tone]}`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground text-[15px] font-semibold">{title}</h2>
          <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">{children}</p>
        </div>
        {action ? <div className="shrink-0 sm:mt-0.5">{action}</div> : null}
      </div>
    </Panel>
  );
}
