"use client";

import { Info, ShieldCheck } from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { adminClient } from "@/lib/admin/client";
import { safeNext } from "@/lib/next-path";

/*
  Signing in to the admin realm.

  Password, then - for an enrolled account - six digits from an authenticator
  app. No emailed code, no Google, no "forgot your password": every one of
  those is a remotely reachable path into the most privileged accounts here,
  and an administrator who is locked out is reset by another administrator
  out of band (`npm run admin -- mfa-reset` for a lost phone).

  The code field is not on screen until the server asks for it, because the
  form cannot know in advance whether this address has enrolled - and a first
  sign-in, which happens exactly once per account, has no code to give. The
  failure message before that point never says which half was wrong, and an
  address that is not an administrator answers exactly like one whose
  password was mistyped.

  Signed out in the middle of something - the session ran out, or was ended -
  the page carries ?next= with where they were and ?why= with what happened,
  and signing in goes straight back there. Only to an admin page: this form
  never sends anybody into the customer app.
*/

const WHY: Record<string, string> = {
  ended: "Your session ended. Sign in again and you will be taken back to where you were.",
  idle: "You were signed out after a long time without activity. Sign in again to carry on where you were.",
  expired: "Your session reached its time limit. Sign in again to carry on where you were.",
};

const HOME = "/admin";
export function AdminLogin() {
  const searchParams = useSearchParams();
  const asked = safeNext(searchParams.get("next"), HOME);
  const next = asked === HOME || asked.startsWith(`${HOME}/`) ? asked : HOME;
  const why = WHY[searchParams.get("why") ?? ""] ?? null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [askCode, setAskCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await adminClient.login({
      email: email.trim(),
      password,
      ...(askCode && code.trim() ? { code: code.trim() } : {}),
    });
    if (result.ok) {
      // A full load, so nothing cached from a previous session survives.
      window.location.replace(next);
      return;
    }
    setBusy(false);
    if (result.code === "MFA" && !askCode) {
      // The password was right. Ask for the second half, quietly: this is
      // the expected next step, not something going wrong.
      setAskCode(true);
      return;
    }
    setError(result.message);
  };

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-[24rem]">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="bg-foreground text-background flex size-9 items-center justify-center rounded-full">
            <ShieldCheck size={18} weight="fill" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-foreground text-[17px] leading-tight font-semibold">
              BIRQ administration
            </h1>
            <p className="text-muted-foreground text-[12px]">
              Staff only. Every action is recorded.
            </p>
          </div>
        </div>

        <form
          onSubmit={(event) => void onSubmit(event)}
          noValidate
          className="rounded-surface border-border bg-surface shadow-panel flex flex-col gap-5 border px-5 py-6"
        >
          {why && !error ? (
            <p
              role="status"
              className="rounded-control bg-primary-soft text-primary-soft-foreground flex items-start gap-2.5 px-3.5 py-3 text-[13px] leading-relaxed"
            >
              <Info size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
              {why}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="rounded-control border-destructive/30 bg-status-attention text-status-attention-fg border px-3.5 py-3 text-[13px] leading-relaxed"
            >
              {error}
            </p>
          ) : null}

          <Field label="Email">
            {(a11y) => (
              <Input
                {...a11y}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                autoFocus
              />
            )}
          </Field>

          <Field label="Password">
            {(a11y) => (
              <PasswordInput
                {...a11y}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            )}
          </Field>

          {askCode ? (
            <Field label="Authenticator code" hint="The 6 digits showing in your app right now.">
              {(a11y) => (
                <Input
                  {...a11y}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  autoFocus
                />
              )}
            </Field>
          ) : null}

          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Sign in
          </Button>
        </form>

        <p className="text-muted-foreground mt-5 text-center text-[12px] leading-relaxed">
          Accounts are issued from the command line, not requested here. There is no sign-up and no
          self-service reset.
        </p>
      </div>
    </main>
  );
}
