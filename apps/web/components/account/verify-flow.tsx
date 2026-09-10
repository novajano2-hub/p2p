"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Hourglass, Info, SealCheck } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { PageHeader, Panel } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { PhotoCapture, type CapturedPhoto } from "@/components/account/photo-capture";
import { FormError } from "@/components/auth/notices";
import { Button, ButtonLink } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Field, Input } from "@/components/ui/field";
import { authClient, type KycDocumentKind, type KycDocumentType } from "@/lib/auth/client";
import {
  kycDetailsForm,
  kycDocumentForm,
  MAXIMUM_AGE_YEARS,
  MINIMUM_AGE_YEARS,
  type KycDetailsForm,
  type KycDocumentForm,
} from "@/lib/auth/schemas";
import { cn } from "@/lib/cn";
import { DOCUMENT_LABELS, DOCUMENT_OPTIONS, PHOTO_GUIDE, requiredKinds, UNLOCKS } from "@/lib/kyc";

/*
  Identity verification, in the shape the exchanges this audience already
  knows: say which document, type what it says, photograph it, photograph
  yourself with it, read it all back, submit. It ends in "under review"
  rather than a verdict, because an administrator makes the decision.

  Each photograph is uploaded the moment it is taken, so the last step has
  nothing left to wait for and a dropped connection costs one photo, not the
  application. The flow holds the ids those uploads returned and hands them
  to the submission at the end.
*/
type Step = "document" | "details" | "photos" | "selfie" | "review";

const STEPS: readonly { id: Step; label: string }[] = [
  { id: "document", label: "Document" },
  { id: "details", label: "Your details" },
  { id: "photos", label: "Photos" },
  { id: "selfie", label: "Selfie" },
  { id: "review", label: "Review" },
];

type Photos = Partial<Record<KycDocumentKind, CapturedPhoto>>;

export function VerifyFlow() {
  const { user } = useSession();
  const [step, setStep] = useState<Step>("document");
  const [documentType, setDocumentType] = useState<KycDocumentType | null>(null);
  const [details, setDetails] = useState<KycDetailsForm | null>(null);
  const [photos, setPhotos] = useState<Photos>({});

  // Every preview is an object URL, and object URLs are only released by
  // hand. The ref follows the newest set, so leaving the page releases them all.
  const previews = useRef<Photos>({});
  useEffect(() => {
    previews.current = photos;
  }, [photos]);
  useEffect(
    () => () => {
      for (const photo of Object.values(previews.current)) URL.revokeObjectURL(photo.previewUrl);
    },
    [],
  );

  const addPhoto = (photo: CapturedPhoto) => {
    setPhotos((current) => {
      const previous = current[photo.kind];
      if (previous && previous.previewUrl !== photo.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return { ...current, [photo.kind]: photo };
    });
  };

  // Already settled, or already waiting: there is nothing to fill in.
  if (user.kycStatus === "APPROVED") return <AlreadyVerified />;
  if (user.kycStatus === "PENDING") return <UnderReview />;

  const kinds = documentType ? requiredKinds(documentType) : [];
  const documentKinds = kinds.filter((kind) => kind !== "SELFIE");
  const hasAll = (wanted: readonly KycDocumentKind[]) => wanted.every((kind) => photos[kind]);

  return (
    <>
      <PageHeader
        title="Verify your identity"
        description="A person reviews this, so use the details exactly as they appear on your document. We verify Ethiopian documents."
      />

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="lg:col-span-2">
          <Panel>
            <Steps current={step} />

            {user.kycStatus === "REJECTED" ? <PreviousAttempt /> : null}

            {step === "document" ? (
              <DocumentStep
                initial={documentType}
                onContinue={(value) => {
                  setDocumentType(value);
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
                  setStep("photos");
                }}
              />
            ) : null}

            {step === "photos" && documentType ? (
              <PhotosStep
                kinds={documentKinds}
                photos={photos}
                onPhoto={addPhoto}
                ready={hasAll(documentKinds)}
                onBack={() => setStep("details")}
                onContinue={() => setStep("selfie")}
              />
            ) : null}

            {step === "selfie" ? (
              <SelfieStep
                photo={photos.SELFIE ?? null}
                onPhoto={addPhoto}
                onBack={() => setStep("photos")}
                onContinue={() => setStep("review")}
              />
            ) : null}

            {step === "review" && documentType && details && hasAll(kinds) ? (
              <ReviewStep
                documentType={documentType}
                details={details}
                photos={photos}
                onBack={() => setStep("selfie")}
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
            Your details and photos are held to meet the rules that apply to holding money for
            someone else. They are seen by the person reviewing them and never by anyone you trade
            with.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Steps({ current }: { current: Step }) {
  const index = STEPS.findIndex((step) => step.id === current);
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
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

/** Why the last attempt was refused, so this one can fix the actual problem. */
function PreviousAttempt() {
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void authClient.kycState().then((result) => {
      if (live && result.ok) setReason(result.state.rejectionReason);
    });
    return () => {
      live = false;
    };
  }, []);
  return (
    <FormError>
      {reason
        ? `Your last attempt was refused: ${reason} Fix that and submit again.`
        : "Your last attempt was refused. Check that everything matches your document exactly, then submit again."}
    </FormError>
  );
}

function DocumentStep({
  initial,
  onContinue,
}: {
  initial: KycDocumentType | null;
  onContinue: (value: KycDocumentType) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<KycDocumentForm>({
    resolver: zodResolver(kycDocumentForm),
    defaultValues: initial ? { documentType: initial } : {},
  });

  return (
    <form
      onSubmit={handleSubmit((value) => onContinue(value.documentType))}
      noValidate
      className="flex flex-col gap-5"
    >
      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-foreground mb-3 text-sm font-medium">
          Which document will you photograph?
        </legend>
        {DOCUMENT_OPTIONS.map((option) => (
          <label
            key={option.type}
            className={cn(
              "rounded-control border-border bg-surface flex cursor-pointer items-start gap-3 border px-4 py-3.5",
              "transition-[border-color,background-color] duration-150 ease-out",
              "hover:border-primary/40 has-checked:border-primary has-checked:bg-primary-soft",
              "has-focus-visible:ring-primary/25 has-focus-visible:ring-2",
            )}
          >
            <input
              type="radio"
              value={option.type}
              {...register("documentType")}
              className="accent-primary mt-1 size-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="text-foreground block text-[15px] font-medium">{option.label}</span>
              <span className="text-muted-foreground block text-[13px] leading-relaxed">
                {option.detail}
              </span>
            </span>
          </label>
        ))}
        {errors.documentType?.message ? (
          <p role="alert" className="text-destructive text-[13px] leading-relaxed">
            {errors.documentType.message}
          </p>
        ) : null}
      </fieldset>

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
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<KycDetailsForm>({
    resolver: zodResolver(kycDetailsForm),
    defaultValues: initial ?? { legalName: "", dateOfBirth: "", documentNumber: "" },
  });

  // The youngest birthday allowed is today's date MINIMUM_AGE_YEARS ago; the
  // calendar cannot go past it, so the rule is felt before it is enforced.
  const today = new Date();
  const latest = new Date(
    today.getFullYear() - MINIMUM_AGE_YEARS,
    today.getMonth(),
    today.getDate(),
  );
  const earliest = new Date(today.getFullYear() - MAXIMUM_AGE_YEARS, 0, 1);
  const initialMonth = new Date(today.getFullYear() - 25, today.getMonth(), 1);

  return (
    <form onSubmit={handleSubmit(onContinue)} noValidate className="flex flex-col gap-5">
      <Field
        label="Full name"
        error={errors.legalName?.message}
        hint="Exactly as printed on your document."
      >
        {(a11y) => <Input {...a11y} {...register("legalName")} autoComplete="name" />}
      </Field>

      <Field
        label="Date of birth"
        error={errors.dateOfBirth?.message}
        hint={`You must be ${MINIMUM_AGE_YEARS} or over.`}
      >
        {(a11y) => (
          <Controller
            control={control}
            name="dateOfBirth"
            render={({ field }) => (
              <DateField
                {...a11y}
                value={field.value}
                onChange={field.onChange}
                earliest={earliest}
                latest={latest}
                initialMonth={initialMonth}
                placeholder="Choose your date of birth"
              />
            )}
          />
        )}
      </Field>

      <Field label="Document number" error={errors.documentNumber?.message}>
        {(a11y) => (
          <Input
            {...a11y}
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

function PhotosStep({
  kinds,
  photos,
  onPhoto,
  ready,
  onBack,
  onContinue,
}: {
  kinds: readonly KycDocumentKind[];
  photos: Photos;
  onPhoto: (photo: CapturedPhoto) => void;
  ready: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        Lay the document flat, fill the frame with it, and make sure nothing is cut off or shining.
        Each photo is uploaded as soon as you take it.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {kinds.map((kind) => (
          <PhotoCapture
            key={kind}
            kind={kind}
            title={PHOTO_GUIDE[kind].title}
            hint={PHOTO_GUIDE[kind].hint}
            facing="environment"
            value={photos[kind] ?? null}
            onChange={onPhoto}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="lg" onClick={onBack}>
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back
        </Button>
        <Button type="button" size="lg" disabled={!ready} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function SelfieStep({
  photo,
  onPhoto,
  onBack,
  onContinue,
}: {
  photo: CapturedPhoto | null;
  onPhoto: (photo: CapturedPhoto) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        This is what ties the document to you. The person reviewing compares your face with the
        photo on the document, so both need to be clear.
      </p>

      <div className="sm:max-w-sm">
        <PhotoCapture
          kind="SELFIE"
          title={PHOTO_GUIDE.SELFIE.title}
          hint={PHOTO_GUIDE.SELFIE.hint}
          facing="user"
          value={photo}
          onChange={onPhoto}
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="lg" onClick={onBack}>
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back
        </Button>
        <Button type="button" size="lg" disabled={!photo} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}

const longDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function ReviewStep({
  documentType,
  details,
  photos,
  onBack,
}: {
  documentType: KycDocumentType;
  details: KycDetailsForm;
  photos: Photos;
  onBack: () => void;
}) {
  const { user, updateUser } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const kinds = requiredKinds(documentType);
  const birthday = new Date(details.dateOfBirth + "T00:00:00");

  return (
    <div className="flex flex-col gap-5">
      <FormError message={error} />

      <dl className="divide-border divide-y text-sm">
        <Row label="Document">{DOCUMENT_LABELS[documentType]}</Row>
        <Row label="Full name">{details.legalName}</Row>
        <Row label="Date of birth">
          {Number.isNaN(birthday.getTime()) ? details.dateOfBirth : longDate.format(birthday)}
        </Row>
        <Row label="Document number">{details.documentNumber}</Row>
      </dl>

      <div>
        <p className="text-foreground mb-2 text-sm font-medium">Photos</p>
        <ul className="grid grid-cols-3 gap-2">
          {kinds.map((kind) => {
            const photo = photos[kind];
            return (
              <li key={kind} className="flex flex-col gap-1.5">
                <div className="rounded-control bg-muted aspect-[3/2] overflow-hidden">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a blob: URL from this device; there is nothing for the image optimiser to fetch
                    <img
                      src={photo.previewUrl}
                      alt={PHOTO_GUIDE[kind].title}
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>
                <span className="text-muted-foreground text-[12px]">{PHOTO_GUIDE[kind].title}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-muted-foreground rounded-control bg-muted flex items-start gap-2.5 px-3.5 py-3 text-[12px] leading-relaxed">
        <Info size={15} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>
          A person checks these against your photos. If anything does not match, the review is
          refused with the reason, and you can fix it and submit again.
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
            const front = photos.FRONT;
            const selfie = photos.SELFIE;
            if (!front || !selfie) return;
            setSubmitting(true);
            setError(null);
            const result = await authClient.submitKyc({
              ...details,
              documentType,
              documents: {
                front: front.id,
                selfie: selfie.id,
                ...(kinds.includes("BACK") && photos.BACK ? { back: photos.BACK.id } : {}),
              },
            });
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
            Your details and photos are with an administrator. We will email you when it is decided.
            Until then your limits stay where they were and you cannot post offers.
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
