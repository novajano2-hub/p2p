"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CreditCard,
  EnvelopeSimple,
  LockKey,
  Palette,
  SealCheck,
  ShieldCheck,
  SignOut,
  User,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";

import { UidChip } from "@/components/app/copy-button";
import { PageHeader, Panel } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { ThemeControl } from "@/components/app/theme-control";
import { FormError } from "@/components/auth/notices";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth/client";
import { usernameForm, type UsernameForm } from "@/lib/auth/schemas";
import { STATUS_LABELS } from "@/lib/kyc";
import { placeOnField, revealProblems } from "@/lib/reveal-problems";
import { toast, toastFailure } from "@/lib/toast";

/*
  Settings: who the account is, how it looks, and how it is protected.

  Five sections, one visible at a time behind a tab each: what used to be five
  cards stacked the length of the page is now one, switched rather than
  scrolled past. Changing the password goes through the same code-verified
  flow as recovering it, which is why it links there rather than duplicating it.

  Who you are - the name, the address, the account number to hand to someone -
  is not behind a tab: it sits beside them on a desk and above them on a
  phone, so it is there whichever one is open. Each row says its state with
  a pill and not only a word, and what can be acted on has its button.
*/
export function SettingsPanel() {
  const items: TabItem[] = [
    { id: "profile", label: "Profile", content: <ProfileTab /> },
    { id: "appearance", label: "Appearance", content: <AppearanceTab /> },
    { id: "account", label: "Account", content: <AccountTab /> },
    { id: "security", label: "Security", content: <SecurityTab /> },
    { id: "session", label: "Session", content: <SessionTab /> },
  ];

  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[18.75rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <ProfileCard />
        <Tabs items={items} label="Settings sections" className="min-w-0" />
      </div>
    </>
  );
}

/** Who this account is, whichever tab is open. The account number never changes. */
function ProfileCard() {
  const { user } = useSession();
  return (
    <section
      aria-label="Your account"
      className="rounded-surface border-border bg-surface shadow-panel flex min-w-0 items-center gap-3.5 border px-5 py-5 lg:flex-col lg:gap-3 lg:py-6 lg:text-center"
    >
      <span
        aria-hidden="true"
        className="bg-primary-soft text-primary-soft-foreground flex size-14 shrink-0 items-center justify-center rounded-full text-xl font-semibold uppercase"
      >
        {user.username.slice(0, 1)}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5 lg:items-center">
        <p className="font-display text-foreground flex items-center gap-1.5 text-lg leading-tight font-semibold [overflow-wrap:anywhere]">
          {user.username}
          {user.kycStatus === "APPROVED" ? (
            <SealCheck
              size={17}
              weight="fill"
              aria-label="Verified"
              className="text-primary shrink-0"
            />
          ) : null}
        </p>
        <p className="text-muted-foreground text-[13px] break-all">{user.email}</p>
        <UidChip platformId={user.platformId} />
      </div>
    </section>
  );
}

function ProfileTab() {
  return (
    <Panel description="What people you trade with see.">
      <UsernameForm />
    </Panel>
  );
}

function AppearanceTab() {
  return (
    <Panel>
      <dl className="-my-1.5">
        <Row icon={Palette} label="Theme" detail="Follow your device, or pick one.">
          <ThemeControl className="w-full sm:w-72" />
        </Row>
      </dl>
    </Panel>
  );
}

function AccountTab() {
  const { user } = useSession();
  return (
    <Panel>
      <dl className="divide-border -my-1.5 divide-y">
        <KycRow />
        <Row icon={EnvelopeSimple} label="Email" detail={user.email}>
          {user.emailVerified ? (
            <StatusPill status="complete">Verified</StatusPill>
          ) : (
            <StatusPill status="pending">Not verified</StatusPill>
          )}
        </Row>
        <Row icon={User} label="Account status">
          <StatusPill status={user.status === "ACTIVE" ? "complete" : "attention"}>
            {user.status.charAt(0) + user.status.slice(1).toLowerCase()}
          </StatusPill>
        </Row>
        {/* They live under Trade, where an ad needs them; this is where a person looks for them. */}
        <Row icon={CreditCard} label="Payment methods" detail="The accounts buyers pay you into.">
          <ButtonLink href="/trade/payment-methods" size="sm" variant="secondary" arrow={false}>
            Manage
          </ButtonLink>
        </Row>
      </dl>
    </Panel>
  );
}

/*
  Identity verification, as a row rather than the big dismissible card on
  /account: this is the permanent, always-reachable place to check where it
  stands, now that nothing in the header links there any more. The rejection
  reason is fetched only for the one status where it exists to show.
*/
function KycRow() {
  const { user } = useSession();
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (user.kycStatus !== "REJECTED") return;
    let live = true;
    void authClient.kycState().then((result) => {
      if (live && result.ok) setReason(result.state.rejectionReason);
    });
    return () => {
      live = false;
    };
  }, [user.kycStatus]);

  const tone =
    user.kycStatus === "APPROVED"
      ? "complete"
      : user.kycStatus === "PENDING"
        ? "pending"
        : user.kycStatus === "REJECTED"
          ? "attention"
          : "neutral";

  const detail =
    user.kycStatus === "APPROVED"
      ? "Your full limits are active and you can post your own offers."
      : user.kycStatus === "PENDING"
        ? "Someone is checking your details. We will let you know once it is decided."
        : user.kycStatus === "REJECTED"
          ? (reason ?? undefined)
          : "Lifts your limits and lets you post your own offers.";

  return (
    <Row icon={ShieldCheck} label="Identity verification" detail={detail}>
      <StatusPill status={tone}>{STATUS_LABELS[user.kycStatus]}</StatusPill>
      {user.kycStatus === "NOT_STARTED" ? (
        <ButtonLink href="/verify" size="sm" arrow={false}>
          Verify
        </ButtonLink>
      ) : null}
      {user.kycStatus === "REJECTED" ? (
        <ButtonLink href="/verify" size="sm" arrow={false}>
          Verify again
        </ButtonLink>
      ) : null}
    </Row>
  );
}

function SecurityTab() {
  return (
    <Panel>
      <dl className="divide-border -my-1.5 divide-y">
        <Row icon={LockKey} label="Password">
          <ButtonLink href="/recover" size="sm" variant="secondary" arrow={false}>
            Change password
          </ButtonLink>
        </Row>
        <Row
          icon={EnvelopeSimple}
          label="Log-in verification"
          detail="A code is sent to your email on every log-in."
        >
          <StatusPill status="complete">On</StatusPill>
        </Row>
        <Row icon={ShieldCheck} label="Authenticator app">
          <StatusPill status="neutral">Not available yet</StatusPill>
        </Row>
      </dl>
    </Panel>
  );
}

function SessionTab() {
  const { signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  return (
    <Panel>
      <FormError message={signOutError} />
      <dl className="-my-1.5">
        <Row
          icon={SignOut}
          label="This session"
          detail="Signing out ends this session on the server, not just in this browser."
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={signingOut}
            onClick={async () => {
              setSigningOut(true);
              setSignOutError(null);
              const result = await signOut();
              if (!result.ok) {
                setSigningOut(false);
                setSignOutError(result.message);
                toastFailure(result);
              }
            }}
          >
            Log out
          </Button>
        </Row>
      </dl>
    </Panel>
  );
}

/*
  The username, editable in place. Saving updates the session everywhere the
  name is shown, without a reload.
*/
function UsernameForm() {
  const { user, updateUser } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError: setFieldError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UsernameForm>({
    resolver: zodResolver(usernameForm),
    defaultValues: { username: user.username },
    shouldFocusError: false,
  });

  const onSubmit = handleSubmit(
    async ({ username }) => {
      setError(null);
      const result = await authClient.updateUsername({ username });
      if (!result.ok) {
        // "That username is taken" belongs on the username.
        if (result.code === "CONFLICT") {
          setFieldError("username", { type: "server", message: result.message });
          revealProblems(formElement);
          return;
        }
        if (placeOnField(result, { username: "username" }, setFieldError, formElement)) return;
        setError(result.message);
        toastFailure(result);
        return;
      }
      updateUser(result.user);
      reset({ username: result.user.username });
      toast.success("Username saved", {
        description: `People you trade with now see ${result.user.username}.`,
      });
    },
    () => revealProblems(formElement),
  );

  return (
    <form ref={setFormElement} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError message={error} />
      <Field
        label="Username"
        error={errors.username?.message}
        hint="3 to 20 characters: letters, numbers and underscores."
      >
        {(control) => (
          <Input
            {...control}
            {...register("username")}
            autoComplete="username"
            spellCheck={false}
          />
        )}
      </Field>
      <div>
        <Button type="submit" size="sm" loading={isSubmitting} disabled={!isDirty}>
          Save username
        </Button>
      </div>
    </form>
  );
}

/** One setting: what it is, a line about it, and on the right where it stands or what can be done. */
function Row({
  icon: RowIcon,
  label,
  detail,
  children,
}: {
  icon: Icon;
  label: string;
  detail?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 py-3.5">
      <dt className="flex min-w-0 items-start gap-3">
        <RowIcon size={18} aria-hidden="true" className="text-muted-foreground mt-0.5 shrink-0" />
        <span className="min-w-0">
          <span className="text-foreground block text-sm font-medium">{label}</span>
          {detail ? (
            <span className="text-muted-foreground mt-0.5 block text-[13px] leading-relaxed [overflow-wrap:anywhere]">
              {detail}
            </span>
          ) : null}
        </span>
      </dt>
      <dd className="flex items-center gap-2.5 max-sm:pl-[1.875rem]">{children}</dd>
    </div>
  );
}
