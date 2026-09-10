"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Hourglass, Info, SealCheck } from "@phosphor-icons/react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { PageHeader, Panel } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { FormError } from "@/components/auth/notices";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { authClient, type KycDocumentType } from "@/lib/auth/client";
import { COUNTRIES, DOCUMENT_LABELS, UNLOCKS } from "@/lib/kyc";
import {
  kycDetailsForm,
  kycDocumentForm,
  type KycDetailsForm,
  type KycDocumentForm,
} from "@/lib/auth/schemas";

/*
  Identity verification, in the shape the exchanges this audience already
  knows: choose where the document is from and what it is, type what it says,
  read it back, submit. It ends in "under review" rather than a verdict,
  because an administrator makes the decision.

  Two steps of form and one of confirmation. Each step asks for one kind of
  thing, so a mistake is obvious where it was made rather than at the end.
*/
type Step = "document" | "details" | "confirm";

export function VerifyFlow() {
  const { user } = useSession();
  const [step, setStep] = useState<Step>("document");
  const [document, setDocument] = useState<KycDocumentForm | null>(null);
  const [details, setDetails] = useState<KycDetailsForm | null>(null);

  // Already settled, or already waiting: there is nothing to fill in.
  if (user.kycStatus === "APPROVED") return <AlreadyVerified />;
  if (user.kycStatus === "PENDING") return <UnderReview />;

  return (
    <>
      <PageHeader
        title="Verify your identity"
        description="A person reviews this, so use the details exactly as they appear on your document."
      />

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="lg:col-span-2">
          <Panel>
            <Steps current={step} />

            {step === "document" ? (
              <DocumentStep
                initial={document}
                onContinue={(value) => {
                  setDocument(value);
                  setStep("details");
                }}
              />
            ) : null}

            {step === "details" ? (
              <DetailsStep
                initial={details}
                onBack={() => setStep("document")}
                onContinue={(value) => {
                  setDetails(value);
                  setStep("confirm");
                }}
              />
            ) : null}

            {step === "confirm" && document && details ? (
              <ConfirmStep
                document={document}
                details={details}
                onBack={() => setStep("details")}
              />
            ) : null}
          </Panel>
        </div>

        <Panel title="What this unlocks">
          <ul className="flex flex-col gap-3.5">
            {UNLOCKS.map((unlock) => (
              <li key={unlock.title}>
                <p className="text-foreground text-[13px] font-medium">{unlock.title}</p>
                <p className="text-muted-foreground text-[12px] leading-relaxed">{unlock.detail}</p>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground border-border mt-4 border-t pt-4 text-[12px] leading-relaxed">
            Your details are held to meet the rules that apply to holding money for someone else.
            They are never shown to anyone you trade with.
          </p>
        </Panel>
      </div>
    </>
  );
}

const STEPS: readonly { id: Step; label: string }[] = [
  { id: "document", label: "Document" },
  { id: "details", label: "Your details" },
  { id: "confirm", label: "Confirm" },
];

function Steps({ current }: { current: Step }) {
  const index = STEPS.findIndex((step) => step.id === current);
  return (
    <ol className="mb-6 flex items-center gap-2 text-[13px]">
      {STEPS.map((step, position) => {
        const done = position < index;
        const active = position === index;
        return (
          <li key={step.id} className="flex items-center gap-2">
            <span
              aria-current={active ? "step" : undefined}
              className={
                active
                  ? "text-foreground font-medium"
                  : done
                    ? "text-muted-foreground"
                    : "text-muted-foreground/60"
              }
            >
              {position + 1}. {step.label}
            </span>
            {position < STEPS.length - 1 ? (
              <span aria-hidden="true" className="bg-border h-px w-4" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function DocumentStep({
  initial,
  onContinue,
}: {
  initial: KycDocumentForm | null;
  onContinue: (value: KycDocumentForm) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<KycDocumentForm>({
    resolver: zodResolver(kycDocumentForm),
    defaultValues: initial ?? { country: "ET", documentType: "NATIONAL_ID" },
  });

  return (
    <form onSubmit={handleSubmit(onContinue)} noValidate className="flex flex-col gap-5">
      <Field label="Country that issued your document" error={errors.country?.message}>
        {(control) => (
          <Select {...control} {...register("country")}>
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Document type" error={errors.documentType?.message}>
        {(control) => (
          <Select {...control} {...register("documentType")}>
            {(Object.keys(DOCUMENT_LABELS) as KycDocumentType[]).map((type) => (
              <option key={type} value={type}>
                {DOCUMENT_LABELS[type]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Button type="submit" size="lg" className="w-full sm:w-auto sm:self-start">
        Continue
      </Button>
    </form>
  );
}

function DetailsStep({
  initial,
  onBack,
  onContinue,
}: {
  initial: KycDetailsForm | null;
  onBack: () => void;
  onContinue: (value: KycDetailsForm) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<KycDetailsForm>({
    resolver: zodResolver(kycDetailsForm),
    defaultValues: initial ?? { legalName: "", dateOfBirth: "", documentNumber: "" },
  });

  return (
    <form onSubmit={handleSubmit(onContinue)} noValidate className="flex flex-col gap-5">
      <Field
        label="Full name"
        error={errors.legalName?.message}
        hint="Exactly as printed on your document."
      >
        {(control) => <Input {...control} {...register("legalName")} autoComplete="name" />}
      </Field>

      <Field label="Date of birth" error={errors.dateOfBirth?.message}>
        {(control) => (
          <Input {...control} {...register("dateOfBirth")} type="date" autoComplete="bday" />
        )}
      </Field>

      <Field label="Document number" error={errors.documentNumber?.message}>
        {(control) => (
          <Input
            {...control}
            {...register("documentNumber")}
            spellCheck={false}
            autoCapitalize="characters"
          />
        )}
      </Field>

      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="lg" onClick={onBack}>
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back
        </Button>
        <Button type="submit" size="lg">
          Continue
        </Button>
      </div>
    </form>
  );
}

function ConfirmStep({
  document,
  details,
  onBack,
}: {
  document: KycDocumentForm;
  details: KycDetailsForm;
  onBack: () => void;
}) {
  const { user, updateUser } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const country = COUNTRIES.find((entry) => entry.code === document.country);

  return (
    <div className="flex flex-col gap-5">
      <FormError message={error} />

      <dl className="divide-border divide-y text-sm">
        <Row label="Country">{country?.name ?? document.country}</Row>
        <Row label="Document">{DOCUMENT_LABELS[document.documentType]}</Row>
        <Row label="Full name">{details.legalName}</Row>
        <Row label="Date of birth">{details.dateOfBirth}</Row>
        <Row label="Document number">{details.documentNumber}</Row>
      </dl>

      <p className="text-muted-foreground rounded-control bg-muted flex items-start gap-2.5 px-3.5 py-3 text-[12px] leading-relaxed">
        <Info size={15} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>
          A person checks these against your document. If anything does not match, we may email you
          asking for a photo of it before deciding.
        </span>
      </p>

      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="lg" onClick={onBack} disabled={submitting}>
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back
        </Button>
        <Button
          type="button"
          size="lg"
          loading={submitting}
          onClick={async () => {
            setSubmitting(true);
            setError(null);
            const result = await authClient.submitKyc({ ...document, ...details });
            if (!result.ok) {
              setSubmitting(false);
              setError(result.message);
              return;
            }
            // The session carries the status, so every screen switches to
            // "under review" at once without another request.
            updateUser({ ...user, kycStatus: result.state.status });
          }}
        >
          Submit for review
        </Button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-foreground text-right break-all">{children}</dd>
    </div>
  );
}

function UnderReview() {
  return (
    <>
      <PageHeader title="Verify your identity" />
      <Panel className="mx-auto max-w-lg">
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <span className="bg-status-pending text-status-pending-fg mb-4 flex size-12 items-center justify-center rounded-full">
            <Hourglass size={24} weight="duotone" aria-hidden="true" />
          </span>
          <h2 className="text-foreground text-lg font-semibold">Under review</h2>
          <p className="text-muted-foreground mt-2 max-w-sm text-[13px] leading-relaxed">
            Your details are with an administrator. We will email you when it is decided. Until then
            your limits stay where they were and you cannot post offers.
          </p>
          <div className="mt-6">
            <ButtonLink href="/account" variant="secondary" arrow={false}>
              Back to home
            </ButtonLink>
          </div>
        </div>
      </Panel>
    </>
  );
}

function AlreadyVerified() {
  return (
    <>
      <PageHeader title="Verify your identity" />
      <Panel className="mx-auto max-w-lg">
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <span className="bg-status-complete text-status-complete-fg mb-4 flex size-12 items-center justify-center rounded-full">
            <SealCheck size={24} weight="duotone" aria-hidden="true" />
          </span>
          <h2 className="text-foreground text-lg font-semibold">You are verified</h2>
          <p className="text-muted-foreground mt-2 max-w-sm text-[13px] leading-relaxed">
            Your full limits are active and you can post your own offers.
          </p>
          <div className="mt-6">
            <ButtonLink href="/account" variant="secondary" arrow={false}>
              Back to home
            </ButtonLink>
          </div>
        </div>
      </Panel>
    </>
  );
}
