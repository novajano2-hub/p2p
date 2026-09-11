"use client";

import { ArrowLeft, CheckCircle, Warning, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { ActionButton, NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import { ButtonLink } from "@/components/ui/button";
import { AppLink } from "@/components/ui/app-link";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import {
  KYC_REJECTION_REASONS,
  adminClient,
  type KycDocumentKind,
  type KycRejectionReason,
  type KycReviewItem,
} from "@/lib/admin/client";

/*
  One submission, and the decision.

  The photographs and the typed details are side by side because that is the
  whole job: the reviewer is checking one against the other. Approving asks
  nothing further - there is nothing to explain when the answer is yes.
  Rejecting is choosing one of a fixed set of reasons (lib/admin/client.ts),
  never a sentence typed on the spot: the wording a customer reads is settled
  once, here, rather than composed fresh by whoever is on shift, and a closed
  set is what a rejection reason actually is - a small number of ways a
  document fails to check out.

  Opening this page is recorded on the server. Somebody's identity document is
  on screen, and who looked at it is a question that should have an answer.
*/

const LABELS: Record<KycDocumentKind, string> = {
  FRONT: "Front of document",
  BACK: "Back of document",
  SELFIE: "Holding the document",
};

const REASON_OPTIONS = Object.entries(KYC_REJECTION_REASONS) as [KycRejectionReason, string][];

const longDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long" });

type Photo = { id: string; kind: KycDocumentKind; url: string };

export function KycReview({ submissionId }: { submissionId: string }) {
  const admin = useAdmin();
  const [item, setItem] = useState<KycReviewItem | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<KycRejectionReason | "">("");
  const [decided, setDecided] = useState<"APPROVED" | "REJECTED" | null>(null);

  const mayReview = admin.roles.includes("KYC_REVIEWER");
  const loaded = useRef<Photo[]>([]);
  useEffect(() => {
    loaded.current = photos;
  }, [photos]);
  useEffect(
    () => () => {
      for (const photo of loaded.current) URL.revokeObjectURL(photo.url);
    },
    [],
  );

  useEffect(() => {
    if (!mayReview) return;
    let live = true;
    void (async () => {
      const result = await adminClient.submission(submissionId);
      if (!live) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setItem(result.submission);

      const fetched: Photo[] = [];
      await Promise.all(
        result.submission.documents.map(async (document) => {
          const blob = await adminClient.photo(submissionId, document.id);
          if (!blob) return;
          fetched.push({ id: document.id, kind: document.kind, url: URL.createObjectURL(blob) });
        }),
      );
      if (!live) {
        for (const photo of fetched) URL.revokeObjectURL(photo.url);
        return;
      }
      setPhotos(fetched);
    })();
    return () => {
      live = false;
    };
  }, [submissionId, mayReview]);

  if (!mayReview) return <NeedsRole role="KYC_REVIEWER" />;

  return (
    <>
      <AppLink
        href="/admin"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors duration-150"
      >
        <ArrowLeft size={15} weight="bold" aria-hidden="true" />
        Queue
      </AppLink>

      {error ? (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      ) : null}

      {decided ? (
        <div
          role="status"
          className={
            decided === "APPROVED"
              ? "rounded-surface bg-status-complete text-status-complete-fg mb-5 flex items-center gap-2.5 px-4 py-3 text-sm font-medium"
              : "rounded-surface bg-status-attention text-status-attention-fg mb-5 flex items-center gap-2.5 px-4 py-3 text-sm font-medium"
          }
        >
          {decided === "APPROVED" ? (
            <CheckCircle size={18} weight="fill" aria-hidden="true" className="shrink-0" />
          ) : (
            <WarningCircle size={18} weight="fill" aria-hidden="true" className="shrink-0" />
          )}
          {decided === "APPROVED"
            ? "Approved. The account has full limits and can post offers."
            : "Rejected. The customer has been told why and can submit again."}
        </div>
      ) : null}

      {item ? (
        <div className="grid gap-6 lg:grid-cols-5">
          <section className="lg:col-span-3">
            <h2 className="text-foreground mb-3 text-[15px] font-semibold">Photographs</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {item.documents.map((document) => {
                const photo = photos.find((entry) => entry.id === document.id);
                return (
                  <figure key={document.id} className="flex flex-col gap-1.5">
                    <div className="rounded-surface border-border bg-muted aspect-[3/2] overflow-hidden border">
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a blob: URL held in memory; there is nothing for the optimiser to fetch
                        <img
                          src={photo.url}
                          alt={LABELS[document.kind]}
                          className="size-full object-contain"
                        />
                      ) : (
                        <div className="text-muted-foreground flex size-full items-center justify-center text-[12px]">
                          Loading&hellip;
                        </div>
                      )}
                    </div>
                    <figcaption className="text-muted-foreground text-[12px]">
                      {LABELS[document.kind]}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>

          <section className="lg:col-span-2">
            <h2 className="text-foreground mb-3 text-[15px] font-semibold">What they entered</h2>
            <dl className="divide-border rounded-surface border-border bg-surface divide-y border px-4">
              <Row label="Full name">{item.legalName}</Row>
              <Row label="Date of birth">{longDate.format(new Date(item.dateOfBirth))}</Row>
              <Row label="Document">{item.documentType.replace(/_/g, " ").toLowerCase()}</Row>
              <Row label="Number">
                <span className="font-mono text-[13px]">{item.documentNumber}</span>
              </Row>
              <Row label="Country">{item.country}</Row>
              <Row label="Account">
                <span className="font-mono text-[13px]">{item.account.platformId}</span>
              </Row>
              <Row label="Username">{item.account.username}</Row>
              <Row label="Email">
                <span className="break-all">{item.account.email}</span>
              </Row>
            </dl>

            {item.status === "PENDING" && !decided ? (
              <div className="mt-6 flex flex-col gap-4">
                <h2 className="text-foreground text-[15px] font-semibold">Decision</h2>

                <div className="rounded-surface border-status-complete-fg/25 bg-status-complete/40 flex flex-col gap-3 border px-4 py-4">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle
                      size={18}
                      weight="fill"
                      aria-hidden="true"
                      className="text-status-complete-fg mt-0.5 shrink-0"
                    />
                    <div>
                      <p className="text-foreground text-[14px] font-medium">Approve</p>
                      <p className="text-muted-foreground mt-0.5 text-[12px] leading-relaxed">
                        The account is lifted to full limits and can post its own offers
                        immediately.
                      </p>
                    </div>
                  </div>
                  <ActionButton
                    label="Approve"
                    busyLabel="Approving…"
                    className="w-full"
                    onRun={async () => {
                      setError(null);
                      const result = await adminClient.approve(item.id);
                      if (result.ok) setDecided("APPROVED");
                      else setError(result.message);
                    }}
                  />
                </div>

                <div className="rounded-surface border-status-attention-fg/25 bg-status-attention/30 flex flex-col gap-3 border px-4 py-4">
                  <div className="flex items-start gap-2.5">
                    <WarningCircle
                      size={18}
                      weight="fill"
                      aria-hidden="true"
                      className="text-status-attention-fg mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground text-[14px] font-medium">Reject</p>
                      <p className="text-muted-foreground mt-0.5 text-[12px] leading-relaxed">
                        Choose the reason closest to what is wrong. It is shown to the customer
                        exactly as written here.
                      </p>
                    </div>
                  </div>

                  <Field label="Reason">
                    {(a11y) => (
                      <Select
                        {...a11y}
                        value={reason}
                        onChange={(event) => setReason(event.target.value as KycRejectionReason)}
                      >
                        <option value="" disabled>
                          Choose a reason&hellip;
                        </option>
                        {REASON_OPTIONS.map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <ActionButton
                    label="Reject"
                    busyLabel="Rejecting…"
                    variant="destructive"
                    className="w-full"
                    disabled={!reason}
                    onRun={async () => {
                      if (!reason) return;
                      setError(null);
                      const result = await adminClient.reject(item.id, reason);
                      if (result.ok) setDecided("REJECTED");
                      else setError(result.message);
                    }}
                  />
                </div>

                <p className="text-muted-foreground flex items-start gap-2 text-[12px] leading-relaxed">
                  <Warning size={14} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
                  Both decisions are final and recorded against your account. A submission can only
                  be decided once.
                </p>
              </div>
            ) : null}

            {item.status !== "PENDING" || decided ? (
              <div className="mt-6">
                <ButtonLink
                  href="/admin"
                  variant="secondary"
                  size="lg"
                  arrow={false}
                  className="w-full"
                >
                  Back to the queue
                </ButtonLink>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground shrink-0 text-[13px]">{label}</dt>
      <dd className="text-foreground text-right text-[13px]">{children}</dd>
    </div>
  );
}
