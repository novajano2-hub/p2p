"use client";

import { ArrowLeft, Eye, ImageBroken, Paperclip } from "@phosphor-icons/react";
import { notFound } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Amount,
  AmountHeader,
  Birr,
  CopyValue,
  CustomerLine,
  dateTime,
  DetailList,
  DetailRow,
  Notice,
  Panel,
  ReasonNote,
  StepRail,
  Tag,
} from "@/components/admin/admin-bits";
import { NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import { DisputeDecision } from "@/components/admin/dispute-decision";
import { AppLink } from "@/components/ui/app-link";
import {
  disputesClient,
  type AdminDispute,
  type AdminDisputeDetail,
  type DisputeEvidence,
  type DisputeParty,
} from "@/lib/admin/disputes";
import {
  ACTOR_WORDS,
  claimSaid,
  DISPUTE_WORDS,
  disputeRail,
  EVENT_WORDS,
  OUTCOME_WORDS,
  partyRecord,
  PAYMENT_WORDS,
  TRADE_WORDS,
} from "@/lib/admin/disputes-view";

/*
  One dispute, and everything there is to know about it in one place.

  A resolver is deciding between two people who cannot both be telling the
  truth, so this page puts the whole case on one screen rather than making
  somebody hold half of it in their head: what each side claims, what they
  attached, everything they said to each other, where the buyer was told to
  pay, and what the trade itself did and when.

  Reading it is written to the audit log by the API - the payment
  instructions on this page are the seller's account details, decrypted for
  this view alone (threat model B7.5). The page says so where they are shown.
*/

export function DisputeReview({ disputeId }: { disputeId: string }) {
  const admin = useAdmin();
  const may = admin.roles.includes("DISPUTE_RESOLVER");
  const [dispute, setDispute] = useState<AdminDisputeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!may) return;
    let live = true;
    void disputesClient.one(disputeId).then((result) => {
      if (!live) return;
      if (result.ok) setDispute(result.dispute);
      else if (result.code === "NOT_FOUND") setMissing(true);
      else setError(result.message);
    });
    return () => {
      live = false;
    };
  }, [disputeId, may, attempt]);

  if (missing) notFound();

  if (!may) return <NeedsRole role="DISPUTE_RESOLVER" />;

  const said = dispute ? DISPUTE_WORDS[dispute.status] : null;

  return (
    <>
      <AppLink
        href="/admin/disputes"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150"
      >
        <ArrowLeft size={15} weight="bold" aria-hidden="true" />
        Disputes
      </AppLink>

      {error ? (
        <Notice
          tone="error"
          onRetry={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        >
          {error}
        </Notice>
      ) : null}
      {!dispute && !error ? <Notice tone="loading">Loading&hellip;</Notice> : null}

      {dispute && said ? (
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="flex min-w-0 flex-col gap-5 lg:col-span-3">
            <Panel>
              <AmountHeader
                sign=""
                amount={dispute.trade.amount}
                asset="USDT"
                tone={said.tone}
                status={said.words}
                {...(said.note ? { note: said.note } : {})}
              />
              <StepRail steps={disputeRail(dispute)} />
            </Panel>

            <Panel title="The trade">
              <DetailList>
                <DetailRow label="Status">
                  <Tag tone={TRADE_WORDS[dispute.trade.status].tone}>
                    {TRADE_WORDS[dispute.trade.status].words}
                  </Tag>
                </DetailRow>
                <DetailRow label="USDT">
                  <Amount value={dispute.trade.amount} /> USDT
                </DetailRow>
                <DetailRow label="Birr">
                  <Birr value={dispute.trade.fiatSantim} /> birr
                </DetailRow>
                <DetailRow label="Price">
                  <Birr value={dispute.trade.priceSantim} /> birr per USDT
                </DetailRow>
                <DetailRow label="Fee">
                  <Amount value={dispute.trade.fee} /> USDT
                </DetailRow>
                <DetailRow label="Advertised as">
                  {dispute.trade.offerSide === "SELL" ? "a sell offer" : "a buy offer"}
                </DetailRow>
                <DetailRow label="Opened">
                  {dateTime.format(new Date(dispute.trade.createdAt))}
                </DetailRow>
                <DetailRow label="Payment window">
                  until {dateTime.format(new Date(dispute.trade.paymentDeadline))}
                </DetailRow>
                <DetailRow label="Marked paid">
                  {dispute.trade.paidAt ? (
                    dateTime.format(new Date(dispute.trade.paidAt))
                  ) : (
                    <span className="text-muted-foreground">never</span>
                  )}
                </DetailRow>
                <DetailRow label="Closed">
                  {dispute.trade.closedAt ? (
                    <>
                      {dateTime.format(new Date(dispute.trade.closedAt))}
                      {dispute.trade.closeReason ? ` · ${dispute.trade.closeReason}` : ""}
                    </>
                  ) : (
                    <span className="text-muted-foreground">still open</span>
                  )}
                </DetailRow>
                <DetailRow label="Trade" wrap>
                  <CopyValue value={dispute.trade.id} label="Trade id" />
                </DetailRow>
              </DetailList>
            </Panel>

            <Panel title="Where the buyer was told to pay">
              <DetailList>
                <DetailRow label="Rail">{PAYMENT_WORDS[dispute.payment.kind].label}</DetailRow>
                <DetailRow label="Account holder">
                  {dispute.payment.instructions.accountHolder}
                </DetailRow>
                <DetailRow
                  label={PAYMENT_WORDS[dispute.payment.instructions.kind].numberLabel}
                  wrap
                >
                  <CopyValue
                    value={dispute.payment.instructions.accountNumber}
                    label="Account number"
                  />
                </DetailRow>
                <DetailRow label="Buyer's reference">
                  {dispute.trade.paymentReference ?? (
                    <span className="text-muted-foreground">none given</span>
                  )}
                </DetailRow>
              </DetailList>
              <p className="text-muted-foreground border-border flex items-start gap-2 border-t px-5 py-3 text-[12px] leading-relaxed">
                <Eye size={14} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
                These are the seller&rsquo;s own account details, shown for this decision only.
                Opening this page is recorded with your name against it.
              </p>
            </Panel>

            {dispute.terms ? (
              <Panel title="The advertiser's terms">
                <p className="text-foreground px-4 py-3 text-[13px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-line">
                  {dispute.terms}
                </p>
                <p className="text-muted-foreground border-border border-t px-4 py-3 text-[12px] leading-relaxed">
                  As they stood when the order opened. The ad may say something else now.
                </p>
              </Panel>
            ) : null}

            <Evidence dispute={dispute} />
            <Transcript dispute={dispute} />

            <Panel title="What the trade did">
              <ol className="flex flex-col">
                {dispute.events.map((event) => (
                  <li
                    key={event.id}
                    className="border-border flex flex-col gap-0.5 border-b px-5 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                  >
                    <span className="text-foreground text-[13px]">
                      {EVENT_WORDS[event.kind]}
                      <span className="text-muted-foreground"> · {ACTOR_WORDS[event.actor]}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-[12px] tabular-nums">
                      {dateTime.format(new Date(event.createdAt))}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
            <Panel title="What is claimed">
              <div className="flex flex-col gap-2.5 px-5 py-4">
                <p className="text-foreground text-[14px] font-medium">
                  {claimSaid(dispute.reason, dispute.openedBy)}
                </p>
                <p className="text-muted-foreground text-[13px] leading-relaxed whitespace-pre-wrap">
                  {dispute.description}
                </p>
                <p className="text-muted-foreground text-[12px]">
                  Opened {dateTime.format(new Date(dispute.createdAt))}
                  {dispute.withdrawnAt
                    ? ` · withdrawn ${dateTime.format(new Date(dispute.withdrawnAt))}`
                    : ""}
                </p>
              </div>
            </Panel>

            <PartyPanel title="The buyer" party={dispute.buyer} />
            <PartyPanel title="The seller" party={dispute.seller} />

            {dispute.status === "RESOLVED" && dispute.outcome ? (
              <section className="flex flex-col gap-2.5">
                <h2 className="text-foreground text-[15px] font-semibold">What was decided</h2>
                <div className="rounded-surface border-status-complete-fg/25 bg-status-complete/40 border px-4 py-3.5">
                  <p className="text-foreground text-[13px] font-medium">
                    {OUTCOME_WORDS[dispute.outcome].words}
                  </p>
                  <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
                    {OUTCOME_WORDS[dispute.outcome].consequence}
                  </p>
                </div>
                <ReasonNote
                  by={dispute.resolvedByEmail ?? "an administrator"}
                  at={
                    dispute.resolvedAt
                      ? dateTime.format(new Date(dispute.resolvedAt))
                      : "an unknown time"
                  }
                >
                  {dispute.resolutionNote ?? "No note was recorded."}
                </ReasonNote>
              </section>
            ) : null}

            {/* The decision answers with the dispute as a queue row: everything
                this page also holds - the transcript, the evidence, the
                instructions - is unchanged by deciding, so it is kept. */}
            <DisputeDecision
              dispute={dispute}
              onDecided={(decided: AdminDispute) => setDispute({ ...dispute, ...decided })}
            />

            <Panel title="For the record">
              <DetailList>
                <DetailRow label="Dispute" wrap>
                  <CopyValue value={dispute.id} label="Dispute id" />
                </DetailRow>
                <DetailRow label="Correlation" wrap>
                  <CopyValue value={dispute.correlationId} label="Correlation id" />
                </DetailRow>
                {/* The ledger's filters are held on its own screen rather than
                    in the address, so the code is given to paste rather than
                    linked to. It is where the USDT is sitting until this is
                    decided, and it is exactly zero once it has been. */}
                <DetailRow label="Escrow account" wrap>
                  <CopyValue
                    value={`LIAB:TRADE:${dispute.trade.id}:USDT:ESCROW`}
                    label="Escrow account code"
                  />
                </DetailRow>
              </DetailList>
            </Panel>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PartyPanel({ title, party }: { title: string; party: DisputeParty }) {
  return (
    <Panel title={title}>
      <DetailList>
        <DetailRow label="Account" wrap>
          <CustomerLine customer={party.customer} />
        </DetailRow>
        {party.customer ? (
          <DetailRow label="Standing">
            {party.customer.status.toLowerCase()} ·{" "}
            {party.customer.kycStatus.replace(/_/g, " ").toLowerCase()}
          </DetailRow>
        ) : null}
        <DetailRow label="Record">{partyRecord(party)}</DetailRow>
      </DetailList>
    </Panel>
  );
}

/** What each side attached, theirs together, with whatever they said about it. */
function Evidence({ dispute }: { dispute: AdminDisputeDetail }) {
  const buyer = dispute.evidence.filter((file) => file.uploadedBy === "BUYER");
  const seller = dispute.evidence.filter((file) => file.uploadedBy === "SELLER");

  return (
    <Panel title={`Evidence (${dispute.evidence.length})`}>
      {dispute.evidence.length === 0 ? (
        <p className="text-muted-foreground px-5 py-6 text-[13px]">
          Neither side attached anything. Decide on the transcript and the trade&rsquo;s own record.
        </p>
      ) : (
        <div className="flex flex-col gap-5 px-5 py-5">
          <Side title="From the buyer" disputeId={dispute.id} files={buyer} />
          <Side title="From the seller" disputeId={dispute.id} files={seller} />
        </div>
      )}
    </Panel>
  );
}

function Side({
  title,
  disputeId,
  files,
}: {
  title: string;
  disputeId: string;
  files: DisputeEvidence[];
}) {
  if (files.length === 0) return null;
  return (
    <section>
      <h3 className="text-muted-foreground flex items-center gap-1.5 text-[12px] font-medium">
        <Paperclip size={13} weight="bold" aria-hidden="true" />
        {title}
      </h3>
      <ul className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {files.map((file) => (
          <li key={file.id} className="flex flex-col gap-1.5">
            <Attachment
              disputeId={disputeId}
              id={file.id}
              kind="evidence"
              alt={`Evidence from the ${file.uploadedBy.toLowerCase()}`}
            />
            {file.note ? (
              <p className="text-foreground text-[13px] leading-relaxed">{file.note}</p>
            ) : null}
            <p className="text-muted-foreground text-[12px] tabular-nums">
              {dateTime.format(new Date(file.createdAt))}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/*
  Everything the two of them said to each other, in order, with the sides
  named. A resolver is not in this conversation, so neither side is "me": the
  columns are buyer on the left and seller on the right only to make a long
  exchange readable at a glance.
*/
function Transcript({ dispute }: { dispute: AdminDisputeDetail }) {
  const buyerId = dispute.buyer.customer?.userId ?? null;

  return (
    <Panel title={`The chat (${dispute.messages.length})`}>
      {dispute.messages.length === 0 ? (
        <p className="text-muted-foreground px-5 py-6 text-[13px]">
          They never said anything to each other.
        </p>
      ) : (
        <ol className="flex flex-col gap-3 px-5 py-5">
          {dispute.messages.map((message) => {
            const fromBuyer = buyerId !== null && message.senderId === buyerId;
            return (
              <li
                key={message.id}
                className={fromBuyer ? "flex flex-col items-start" : "flex flex-col items-end"}
              >
                <span className="text-muted-foreground mb-1 text-[11px] font-medium">
                  {fromBuyer ? "Buyer" : "Seller"} ·{" "}
                  <span className="tabular-nums">
                    {dateTime.format(new Date(message.createdAt))}
                  </span>
                </span>
                <div
                  className={
                    fromBuyer
                      ? "rounded-surface border-border bg-surface max-w-[85%] border px-3.5 py-2.5"
                      : "rounded-surface border-border bg-muted/50 max-w-[85%] border px-3.5 py-2.5"
                  }
                >
                  {message.kind === "IMAGE" ? (
                    <Attachment
                      disputeId={dispute.id}
                      id={message.id}
                      kind="message"
                      alt={`Image sent by the ${fromBuyer ? "buyer" : "seller"}`}
                    />
                  ) : (
                    <p className="text-foreground text-[13px] leading-relaxed whitespace-pre-wrap">
                      {message.body}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

/*
  A picture only a resolver may see. The route wants the admin session, which
  an <img src> would not carry, so the bytes are fetched here and turned into
  an object URL - revoked when the element goes, because a blob URL outlives
  the component that made it until somebody says otherwise.

  Nothing has scanned or even parsed these files (threat model B5.1): they are
  whatever one of the two parties uploaded. A file that will not decode says
  so in words rather than leaving a broken image on the page.
*/
function Attachment({
  disputeId,
  id,
  kind,
  alt,
}: {
  disputeId: string;
  id: string;
  kind: "evidence" | "message";
  alt: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    let made: string | null = null;
    const fetching =
      kind === "evidence"
        ? disputesClient.evidence(disputeId, id)
        : disputesClient.chatImage(disputeId, id);

    void fetching.then((blob) => {
      if (!live || !blob) {
        if (live) setFailed(true);
        return;
      }
      made = URL.createObjectURL(blob);
      setUrl(made);
    });

    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [disputeId, id, kind]);

  if (failed) {
    return (
      <span className="rounded-surface border-border text-muted-foreground flex aspect-[3/2] w-full items-center justify-center gap-2 border border-dashed text-[12px]">
        <ImageBroken size={16} weight="regular" aria-hidden="true" />
        Could not load this file
      </span>
    );
  }

  if (!url) {
    return (
      <span
        role="status"
        aria-label="Loading the image"
        className="rounded-surface border-border bg-muted/40 flex aspect-[3/2] w-full animate-pulse border"
      />
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL, which next/image cannot take */}
      <img
        src={url}
        alt={alt}
        onError={() => setFailed(true)}
        className="rounded-surface border-border max-h-80 w-full border object-contain"
      />
    </a>
  );
}
