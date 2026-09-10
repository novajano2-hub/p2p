"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { CopyButton } from "@/components/app/copy-button";
import { PageHeader, Panel } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { ThemeControl } from "@/components/app/theme-control";
import { FormError } from "@/components/auth/notices";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { authClient } from "@/lib/auth/client";
import { usernameForm, type UsernameForm } from "@/lib/auth/schemas";

/*
  Settings: who the account is, how it looks, and how it is protected.
  Changing the password goes through the same code-verified flow as
  recovering it, which is why it links there rather than duplicating it.
*/
export function SettingsPanel() {
  const { user, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Settings" />

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <Panel
          title="Profile"
          description="What people you trade with see. Your account number never changes."
        >
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

        <div className="flex flex-col gap-4 lg:gap-6">
          <Panel title="Appearance" description="Follow your device, or pick one.">
            <ThemeControl className="max-w-sm" />
          </Panel>

          <Panel title="Account">
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
            </dl>
          </Panel>
        </div>

        <Panel title="Security" className="lg:col-span-2">
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

        <Panel title="Session" className="lg:col-span-2">
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
      </div>
    </>
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
