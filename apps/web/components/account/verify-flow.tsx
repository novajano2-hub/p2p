"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  Check,
  Hourglass,
  IdentificationCard,
  Info,
  LockKey,
  SealCheck,
  UserFocus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Controller, useForm } from "react-hook-form";

import { PageHeader, Panel } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { PhotoCapture, type CapturedPhoto } from "@/components/account/photo-capture";
import { FormError } from "@/components/auth/notices";
import { revealProblems } from "@/lib/reveal-problems";
import { toast, toastFailure } from "@/lib/toast";
import { Button, ButtonLink } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Field, Input } from "@/components/ui/field";
import { Radio, RadioGroup } from "@/components/ui/radio";
import { authClient, type KycDocumentKind, type KycDocumentType } from "@/lib/auth/client";
import { cn } from "@/lib/cn";
import {
  kycDetailsForm,
  kycDocumentForm,
  MAXIMUM_AGE_YEARS,
  MINIMUM_AGE_YEARS,
  type KycDetailsForm,
  type KycDocumentForm,
} from "@/lib/auth/schemas";
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

  Because the photographs are already on the server, coming back to this page
  picks up where the last visit stopped rather than starting over. Whatever
  nobody comes back for is deleted after a day by the sweep in the worker.

  Before any of it, one screen says what is needed and what it is for, so
  nobody is three steps in before finding their ID is in another room - and
  after a refusal, the same screen is the reviewer's reason and one way
  forward. On a phone, where you are is a line and a bar rather than five
  names, and the buttons are pinned within reach of a thumb.
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
  // Only these two states have a form to fill in at all; the others return
  // early below, so there is nothing to restore for them.
  const resumable = user.kycStatus === "NOT_STARTED" || user.kycStatus === "REJECTED";
  // Both of these come from one call to the state endpoint below.
  const [restoring, setRestoring] = useState(resumable);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  // The screen before the first step: what is needed, or why the last attempt was refused.
  const [started, setStarted] = useState(false);

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

  /*
    A new step starts at the top of the panel, not wherever the previous
    step's Continue button happened to be - on a phone, the bottom of the
    screen. Focus moves to the step's name in the list, so the change is
    announced as well as seen. Compared against the step last shown rather
    than a first-render flag: arriving at the page must not scroll, and
    development's double run of effects would otherwise make it.
  */
  const stepsRef = useRef<HTMLDivElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    const list = stepsRef.current;
    if (!list) return;
    list.scrollIntoView({ block: "start" });
    // Where you are is written twice, once for each width: the one on the screen takes the focus.
    [...list.querySelectorAll<HTMLElement>('[aria-current="step"]')]
      .find((element) => element.offsetParent !== null)
      ?.focus({ preventScroll: true });
  }, [step]);

  /*
    Picking up where the last visit stopped. The typed details are
    deliberately not restored: they are personal data, and re-typing a name
    costs nothing next to re-taking three photographs.
  */
  useEffect(() => {
    if (!resumable) return;
    let live = true;
    void (async () => {
      const result = await authClient.kycState();
      if (!live) return;
      if (!result.ok) {
        setRestoring(false);
        return;
      }
      setRejectionReason(result.state.rejectionReason);

      const restored: CapturedPhoto[] = [];
      await Promise.all(
        result.state.documents.map(async (document) => {
          const blob = await authClient.kycPhoto({ id: document.id });
          if (!blob) return;
          restored.push({
            id: document.id,
            kind: document.kind,
            previewUrl: URL.createObjectURL(blob),
          });
        }),
      );
      if (!live) {
        for (const photo of restored) URL.revokeObjectURL(photo.previewUrl);
        return;
      }
      setPhotos((current) => {
        const next = { ...current };
        for (const photo of restored) {
          // A photo taken while this was in flight is the newer one, so the
          // restored copy of that slot is released rather than leaked.
          if (next[photo.kind]) URL.revokeObjectURL(photo.previewUrl);
          else next[photo.kind] = photo;
        }
        return next;
      });
      setRestoring(false);
    })();
    return () => {
      live = false;
    };
  }, [resumable]);

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

  if (!started) {
    return (
      <Intro
        refused={user.kycStatus === "REJECTED"}
        reason={rejectionReason}
        onStart={() => setStarted(true)}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Verify your identity"
        description="A person reviews this, so use the details exactly as they appear on your document. We verify Ethiopian documents."
      />

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <div className="min-w-0 lg:col-span-2">
          <Panel>
            <Steps current={step} ref={stepsRef} />

            {user.kycStatus === "REJECTED" ? <PreviousAttempt reason={rejectionReason} /> : null}

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
                restoring={restoring}
                ready={hasAll(documentKinds)}
                onBack={() => setStep("details")}
                onContinue={() => setStep("selfie")}
              />
            ) : null}

            {step === "selfie" ? (
              <SelfieStep
                photo={photos.SELFIE ?? null}
                onPhoto={addPhoto}
                restoring={restoring}
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
          {/* Room for the buttons pinned above the tab bar on a phone. */}
          <div aria-hidden="true" className="h-20 lg:hidden" />
        </div>

        <Panel title="What this unlocks" className="max-lg:hidden">
          <Unlocks />
          <p className="text-muted-foreground border-border mt-4 border-t pt-4 text-[12px] leading-relaxed">
            {PRIVACY}
          </p>
        </Panel>
      </div>
    </>
  );
}

const PRIVACY =
  "Your details and photos are held to meet the rules that apply to holding money for someone else. They are seen by the person reviewing them and never by anyone you trade with.";

/** A step's buttons: in the panel on a desk, pinned above the tab bar on a phone, the way forward the wide one. */
const ACTIONS =
  "flex gap-2 max-lg:border-border max-lg:bg-surface max-lg:above-tab-bar max-lg:fixed max-lg:inset-x-0 max-lg:z-30 max-lg:border-t max-lg:px-4 max-lg:py-3 max-lg:[&>button:last-child]:flex-1";

function Unlocks() {
  return (
    <ul className="flex flex-col gap-3.5">
      {UNLOCKS.map((unlock) => (
        <li key={unlock.title} className="flex items-start gap-2.5">
          <Check
            size={15}
            weight="bold"
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
  );
}

/*
  The screen before the first step. It says what to have in hand and what it
  is for - or, after a refusal, what the reviewer found and that there is a way
  forward. One button either way.
*/
function Intro({
  refused,
  reason,
  onStart,
}: {
  refused: boolean;
  reason: string | null;
  onStart: () => void;
}) {
  return (
    <>
      <PageHeader
        title={refused ? "We could not verify your identity" : "Verify your identity"}
        description={
          refused
            ? "Fix what the reviewer found and send it again. The photos you already took are kept, so you only redo what was wrong."
            : "It takes a couple of minutes, and a person reviews it. We verify Ethiopian documents."
        }
      />
      <Panel className="mx-auto max-w-xl">
        <div className="flex flex-col gap-6">
          {refused ? (
            <div
              role="note"
              className="rounded-control border-destructive/30 bg-status-attention text-status-attention-fg flex items-start gap-2.5 border px-3.5 py-3 text-[13px] leading-relaxed"
            >
              <WarningCircle
                size={17}
                weight="fill"
                aria-hidden="true"
                className="mt-0.5 shrink-0"
              />
              <p>
                <strong className="font-semibold">The reviewer said:</strong>{" "}
                {reason ??
                  "Check that everything matches your document exactly, then submit again."}
              </p>
            </div>
          ) : null}

          <section aria-labelledby="verify-need">
            <h2 id="verify-need" className={GROUP}>
              What you need
            </h2>
            <ul className="mt-2.5 flex flex-col gap-2">
              <Need
                icon={<IdentificationCard size={22} aria-hidden="true" />}
                title="An identity document"
              >
                National ID, passport or driver&apos;s licence.
              </Need>
              <Need icon={<UserFocus size={22} aria-hidden="true" />} title="A selfie holding it">
                So the reviewer can tie the document to you.
              </Need>
            </ul>
          </section>

          <section aria-labelledby="verify-unlocks">
            <h2 id="verify-unlocks" className={GROUP}>
              What it unlocks
            </h2>
            <div className="mt-3">
              <Unlocks />
            </div>
          </section>

          <p className="text-muted-foreground flex items-start gap-2 text-[12px] leading-relaxed">
            <LockKey size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{PRIVACY}</span>
          </p>

          <div className={ACTIONS}>
            <Button type="button" size="lg" onClick={onStart} className="lg:min-w-40">
              {refused ? "Try again" : "Start"}
            </Button>
          </div>
        </div>
      </Panel>
      <div aria-hidden="true" className="h-20 lg:hidden" />
    </>
  );
}

const GROUP = "text-muted-foreground text-[12px] font-semibold tracking-wide uppercase";

function Need({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="rounded-control bg-muted flex items-center gap-3 px-4 py-3.5">
      <span className="text-primary shrink-0">{icon}</span>
      <span>
        <span className="text-foreground block text-sm font-semibold">{title}</span>
        <span className="text-muted-foreground block text-[12.5px]">{children}</span>
      </span>
    </li>
  );
}

/*
  Where you are in the five. On a desk, all five by name, the ones behind you
  ticked. On a phone there is no room for five names, so it is one line -
  "Step 3 of 5 · Photos" - and a bar.
*/
function Steps({ current, ref }: { current: Step; ref: RefObject<HTMLDivElement | null> }) {
  const index = STEPS.findIndex((step) => step.id === current);
  const label = STEPS[index]?.label ?? "";
  return (
    <div ref={ref} className="mb-6 scroll-mt-24">
      <div className="sm:hidden">
        <p
          aria-current="step"
          tabIndex={-1}
          className="text-muted-foreground text-[13px] font-medium focus:outline-none"
        >
          Step {index + 1} of {STEPS.length} · <span className="text-foreground">{label}</span>
        </p>
        <div
          role="progressbar"
          aria-label="Verification progress"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={index + 1}
          className="bg-border mt-2 h-1 overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      <ol className="flex items-center gap-x-1.5 text-[13px] max-sm:hidden md:gap-x-2.5">
        {STEPS.map((step, position) => {
          const done = position < index;
          const active = position === index;
          return (
            <li key={step.id} className="flex min-w-0 items-center gap-1.5 md:gap-2.5">
              <span
                aria-current={active ? "step" : undefined}
                tabIndex={active ? -1 : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap focus:outline-none",
                  active
                    ? "text-foreground font-semibold"
                    : done
                      ? "text-muted-foreground"
                      : "text-muted-foreground/70",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold tabular-nums",
                    active || done
                      ? "bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground border",
                  )}
                >
                  {done ? <Check size={12} weight="bold" /> : position + 1}
                </span>
                {step.label}
              </span>
              {position < STEPS.length - 1 ? (
                // The line gives way before the names do: five of them only just fit a small tablet.
                <span aria-hidden="true" className="bg-border h-px w-5 min-w-1.5 lg:w-8" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** What makes a photograph a reviewer can pass, said where the camera is. */
function PhotoRules({ rules }: { rules: readonly { ok: boolean; text: string }[] }) {
  return (
    <ul className="rounded-control bg-muted flex flex-col gap-1.5 px-4 py-3.5 text-[13px]">
      {rules.map((rule) => (
        <li key={rule.text} className="flex items-start gap-2">
          {rule.ok ? (
            <Check
              size={14}
              weight="bold"
              aria-hidden="true"
              className="text-status-complete-fg mt-0.5 shrink-0"
            />
          ) : (
            <X
              size={14}
              weight="bold"
              aria-hidden="true"
              className="text-status-attention-fg mt-0.5 shrink-0"
            />
          )}
          <span className="text-foreground">
            <span className="sr-only">{rule.ok ? "Do: " : "Do not: "}</span>
            {rule.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

const DOCUMENT_RULES = [
  { ok: true, text: "The original document, flat, filling the frame." },
  { ok: true, text: "All four corners in, every word readable." },
  { ok: false, text: "No copies or screenshots, no glare, nothing cut off." },
] as const;

const SELFIE_RULES = [
  { ok: true, text: "Your face and the document, both clear, in good light." },
  { ok: false, text: "No hat, no sunglasses, nobody else in the frame." },
] as const;

/** Why the last attempt was refused, so this one can fix the actual problem. */
function PreviousAttempt({ reason }: { reason: string | null }) {
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
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<KycDocumentForm>({
    resolver: zodResolver(kycDocumentForm),
    defaultValues: initial ? { documentType: initial } : {},
    shouldFocusError: false,
  });

  return (
    <form
      ref={setFormElement}
      onSubmit={handleSubmit(
        (value) => onContinue(value.documentType),
        () => revealProblems(formElement),
      )}
      noValidate
      className="flex flex-col gap-5"
    >
      <RadioGroup legend="Which document will you photograph?" error={errors.documentType?.message}>
        {DOCUMENT_OPTIONS.map((option) => (
          <Radio
            key={option.type}
            value={option.type}
            label={option.label}
            description={option.detail}
            {...register("documentType")}
          />
        ))}
      </RadioGroup>

      <div className={ACTIONS}>
        <Button type="submit" size="lg">
          Continue
        </Button>
      </div>
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
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<KycDetailsForm>({
    resolver: zodResolver(kycDetailsForm),
    defaultValues: initial ?? { legalName: "", dateOfBirth: "", documentNumber: "" },
    shouldFocusError: false,
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
    <form
      ref={setFormElement}
      onSubmit={handleSubmit(onContinue, () => revealProblems(formElement))}
      noValidate
      className="flex flex-col gap-5"
    >
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

      <div className={ACTIONS}>
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
  restoring,
  ready,
  onBack,
  onContinue,
}: {
  kinds: readonly KycDocumentKind[];
  photos: Photos;
  onPhoto: (photo: CapturedPhoto) => void;
  restoring: boolean;
  ready: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        Each photo is uploaded as soon as you take it.
      </p>
      <PhotoRules rules={DOCUMENT_RULES} />

      <Restoring restoring={restoring} />

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

      <div className={ACTIONS}>
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

/** Said once, while the photographs from a previous visit are being fetched. */
function Restoring({ restoring }: { restoring: boolean }) {
  if (!restoring) return null;
  return (
    <p role="status" className="text-muted-foreground text-[13px]">
      Checking for photos you already uploaded&hellip;
    </p>
  );
}

function SelfieStep({
  photo,
  onPhoto,
  restoring,
  onBack,
  onContinue,
}: {
  photo: CapturedPhoto | null;
  onPhoto: (photo: CapturedPhoto) => void;
  restoring: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        This is what ties the document to you. The person reviewing compares your face with the
        photo on the document, so both need to be clear.
      </p>
      <PhotoRules rules={SELFIE_RULES} />

      <Restoring restoring={restoring} />

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

      <div className={ACTIONS}>
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

      <div className={ACTIONS}>
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
              toastFailure(result);
              return;
            }
            toast.success("Sent for review", {
              description:
                "A person checks your details against your photos. We will let you know.",
            });
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
            Your details and photos are with a reviewer. We will email you when it is decided. Until
            then your limits stay where they were and you cannot post offers.
          </p>
          <ol className="border-border mt-6 flex w-full max-w-xs flex-col gap-3.5 border-t pt-5 text-left">
            <Stage state="done" title="Sent" detail="Your details and photos are in." />
            <Stage
              state="now"
              title="A person is checking it"
              detail="Nothing is needed from you."
            />
            <Stage state="next" title="Decision" detail="By email, and on this page." />
          </ol>
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

/** One stage of a review: behind you, happening, or still to come. */
function Stage({
  state,
  title,
  detail,
}: {
  state: "done" | "now" | "next";
  title: string;
  detail: string;
}) {
  return (
    <li className="flex items-start gap-3" aria-current={state === "now" ? "step" : undefined}>
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          state === "done"
            ? "bg-primary text-primary-foreground"
            : state === "now"
              ? "bg-status-pending text-status-pending-fg"
              : "border-border border",
        )}
      >
        {state === "done" ? <Check size={11} weight="bold" /> : null}
        {state === "now" ? <Hourglass size={11} weight="fill" /> : null}
      </span>
      <span>
        <span
          className={cn(
            "block text-sm font-medium",
            state === "next" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {title}
        </span>
        <span className="text-muted-foreground block text-[12.5px]">{detail}</span>
      </span>
    </li>
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
