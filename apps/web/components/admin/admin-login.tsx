"use client";

import { ShieldCheck } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { adminClient } from "@/lib/admin/client";

/*
  Signing in to the admin realm.

  One step, password only. No emailed code, no Google, no "forgot your
  password": every one of those is a remotely reachable path into the most
  privileged accounts here, and an administrator who is locked out is reset by
  another administrator out of band.

  The failure message never says which half was wrong, and an address that is
  not an administrator answers exactly like one whose password was mistyped.
*/
export function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await adminClient.login({ email: email.trim(), password });
    if (result.ok) {
      // A full load, so nothing cached from a previous session survives.
      window.location.replace("/admin");
      return;
    }
    setBusy(false);
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
