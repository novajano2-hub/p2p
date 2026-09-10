"use client";

import { ArrowLeft, Warning } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ActionButton, NeedsRole, useAdmin } from "@/components/admin/admin-shell";
import { AppLink } from "@/components/ui/app-link";
import { Field, Input } from "@/components/ui/field";
import { adminClient, type KycDocumentKind, type KycReviewItem } from "@/lib/admin/client";

/*
  One submission, and the decision.

  The photographs and the typed details are side by side because that is the
  whole job: the reviewer is checking one against the other. The rejection
  reason is a required field rather than an optional note, because it is shown
  to the customer and "rejected" with no explanation is not something they can
  act on.

  Opening this page is recorded on the server. Somebody's identity document is
  on screen, and who looked at it is a question that should have an answer.
*/

const LABELS: Record<KycDocumentKind, string> = {
  FRONT: "Front of document",
  BACK: "Back of document",
  SELFIE: "Holding the document",
};

const longDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long" });

type Photo = { id: string; kind: KycDocumentKind; url: string };

export function KycReview({ submissionId }: { submissionId: string }) {
  const admin = useAdmin();
  const router = useRouter();
  const [item, setItem] = useState<KycReviewItem | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
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
              ? "rounded-surface bg-status-complete text-status-complete-fg mb-5 px-4 py-3 text-sm font-medium"
              : "rounded-surface bg-status-attention text-status-attention-fg mb-5 px-4 py-3 text-sm font-medium"
          }
        >
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
                <Field
                  label="Note (optional)"
                  hint="Recorded in the audit trail, not shown to the customer."
                >
                  {(a11y) => (
                    <Input
                      {...a11y}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Anything worth recording"
                    />
                  )}
                </Field>

                <ActionButton
                  label="Approve"
                  busyLabel="Approving…"
                  onRun={async () => {
                    setError(null);
                    const result = await adminClient.approve(item.id, note);
                    if (result.ok) setDecided("APPROVED");
                    else setError(result.message);
                  }}
                />

                <div className="border-border border-t pt-4">
                  <Field
                    label="Reason for rejecting"
                    hint="Shown to the customer. Say what to fix, in a sentence."
                  >
                    {(a11y) => (
                      <Input
                        {...a11y}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="The name on the card does not match…"
                      />
                    )}
                  </Field>
                  <div className="mt-3">
                    <ActionButton
                      label="Reject"
                      busyLabel="Rejecting…"
                      variant="destructive"
                      disabled={reason.trim().length < 10}
                      onRun={async () => {
                        setError(null);
                        const result = await adminClient.reject(item.id, reason.trim());
                        if (result.ok) setDecided("REJECTED");
                        else setError(result.message);
                      }}
                    />
                  </div>
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
                <ActionButton
                  label="Back to the queue"
                  busyLabel="…"
                  variant="secondary"
                  onRun={async () => {
                    router.push("/admin");
                    return Promise.resolve();
                  }}
                />
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
