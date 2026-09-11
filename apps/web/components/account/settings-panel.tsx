"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { CopyButton } from "@/components/app/copy-button";
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

/*
  Settings: who the account is, how it looks, and how it is protected.

  Five sections, one visible at a time behind a tab each: what used to be five
  cards stacked the length of the page is now one, switched rather than
  scrolled past. Changing the password goes through the same code-verified
  flow as recovering it, which is why it links there rather than duplicating it.
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
      <Tabs items={items} />
    </>
  );
}

function ProfileTab() {
  const { user } = useSession();
  return (
    <Panel description="What people you trade with see. Your account number never changes.">
      <dl className="divide-border divide-y text-sm">
        <Row label="Account number">
          <span className="inline-flex items-center gap-1">
            <span className="text-foreground font-mono font-medium tabular-nums">
              {user.platformId}
            </span>
            <CopyButton value={user.platformId} label="Copy account number" />
          </span>
        </Row>
        <Row label="Email">
          <span className="text-foreground break-all">{user.email}</span>
        </Row>
      </dl>
      <UsernameForm />
    </Panel>
  );
}

function AppearanceTab() {
  return (
    <Panel description="Follow your device, or pick one.">
      <ThemeControl className="max-w-sm" />
    </Panel>
  );
}

function AccountTab() {
  const { user } = useSession();
  return (
    <Panel>
      <dl className="divide-border divide-y text-sm">
        <Row label="Email verified">
          {user.emailVerified ? (
            <StatusPill status="complete">Verified</StatusPill>
          ) : (
            <StatusPill status="pending">Not verified</StatusPill>
          )}
        </Row>
        <Row label="Status">
          <StatusPill status={user.status === "ACTIVE" ? "complete" : "attention"}>
            {user.status.charAt(0) + user.status.slice(1).toLowerCase()}
          </StatusPill>
        </Row>
        <KycRow />
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

  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between gap-4">
        <dt className="text-muted-foreground shrink-0">Identity verification</dt>
        <dd className="flex items-center gap-2.5">
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
        </dd>
      </div>
      {user.kycStatus === "PENDING" ? (
        <p className="text-muted-foreground mt-1.5 text-[13px] leading-relaxed">
          Someone is checking your details. We will let you know once it is decided.
        </p>
      ) : null}
      {user.kycStatus === "REJECTED" && reason ? (
        <p className="text-muted-foreground mt-1.5 text-[13px] leading-relaxed">{reason}</p>
      ) : null}
    </div>
  );
}

function SecurityTab() {
  return (
    <Panel>
      <dl className="divide-border divide-y text-sm">
        <Row label="Password">
          <ButtonLink href="/recover" size="sm" variant="secondary" arrow={false}>
            Change password
          </ButtonLink>
        </Row>
        <Row label="Log-in verification">
          <span className="text-muted-foreground">
            A code is sent to your email on every log-in.
          </span>
        </Row>
        <Row label="Authenticator app">
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
      <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
        Signing out ends this session on the server, not just in this browser.
      </p>
      <Button
        type="button"
        variant="secondary"
        loading={signingOut}
        onClick={async () => {
          setSigningOut(true);
          setSignOutError(null);
          const result = await signOut();
          if (!result.ok) {
            setSigningOut(false);
            setSignOutError(result.message);
          }
        }}
      >
        Log out
      </Button>
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
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UsernameForm>({
    resolver: zodResolver(usernameForm),
    defaultValues: { username: user.username },
  });

  const onSubmit = handleSubmit(async ({ username }) => {
    setError(null);
    setSaved(false);
    const result = await authClient.updateUsername({ username });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    updateUser(result.user);
    reset({ username: result.user.username });
    setSaved(true);
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="border-border mt-1 flex flex-col gap-4 border-t pt-4"
    >
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
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" loading={isSubmitting} disabled={!isDirty}>
          Save username
        </Button>
        {saved && !isDirty ? (
          <span className="text-status-complete-fg text-[13px]" role="status">
            Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
