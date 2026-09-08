"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AuthCard, AuthFootnote, AuthLink } from "@/components/auth/auth-card";
import { CodeStep } from "@/components/auth/code-step";
import { FormError } from "@/components/auth/notices";
import { PasswordRules } from "@/components/auth/password-rules";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth/client";
import {
  newPasswordForm,
  recoverForm,
  type NewPasswordForm,
  type RecoverForm,
} from "@/lib/auth/schemas";
import { cta } from "@/lib/site";

/*
  Password reset: email, the code sent to it, the new password, done. The
  response to the email step is the same whether or not an account exists for
  the address (the brief forbids account enumeration), so the page never
  confirms one either way; a code for an unknown address is simply never
  valid. Finishing signs the account out everywhere: "someone changed my
  password" has to mean "and whoever was in is now out".
*/
type Step = "email" | "code" | "password" | "done";

export function RecoverFlow() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");

  if (step === "done") {
    return (
      <>
        <AuthCard
          title="Password changed"
          description="You have been signed out on every device. Log in with your new password."
        >
          <ButtonLink href={cta.login.href} size="lg" className="w-full" arrow={false}>
            {cta.login.label}
          </ButtonLink>
        </AuthCard>
      </>
    );
  }

  if (step === "code") {
    return (
      <>
        <AuthCard
          title="Check your email"
          description="If an account exists for that address, a code is on its way."
        >
          <CodeStep
            email={email}
            verify={(code) => authClient.verifyPasswordResetCode({ email, code })}
            resend={() => authClient.requestPasswordReset({ email })}
            onVerified={() => setStep("password")}
            onChangeEmail={() => setStep("email")}
          />
        </AuthCard>
        <Footnote />
      </>
    );
  }

  if (step === "password") {
    return (
      <>
        <AuthCard title="Choose a new password">
          <PasswordStep onDone={() => setStep("done")} />
        </AuthCard>
        <Footnote />
      </>
    );
  }

  return (
    <>
      <AuthCard
        title="Reset your password"
        description="Enter the email you signed up with. If it matches an account, we will send a code to choose a new password."
      >
        <EmailStep
          initialEmail={email}
          onContinue={(value) => {
            setEmail(value);
            setStep("code");
          }}
        />
      </AuthCard>
      <Footnote />
    </>
  );
}

function Footnote() {
  return (
    <AuthFootnote>
      <AuthLink href={cta.login.href}>Back to {cta.login.label.toLowerCase()}</AuthLink>
    </AuthFootnote>
  );
}

function EmailStep({
  initialEmail,
  onContinue,
}: {
  initialEmail: string;
  onContinue: (email: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecoverForm>({
    resolver: zodResolver(recoverForm),
    defaultValues: { email: initialEmail },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    const result = await authClient.requestPasswordReset({ email });
    if (result.ok) onContinue(email);
    else setError(result.message);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormError message={error} />
      <Field label="Email" error={errors.email?.message}>
        {(control) => (
          <Input
            {...control}
            {...register("email")}
            type="email"
            autoComplete="username"
            inputMode="email"
            placeholder="you@example.com"
            autoFocus
          />
        )}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        Send reset code
      </Button>
    </form>
  );
}

function PasswordStep({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordForm>({
    resolver: zodResolver(newPasswordForm),
    defaultValues: { password: "" },
  });
  // useWatch, not watch(): the React Compiler cannot memoize watch() safely.
  const password = useWatch({ control, name: "password" });

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    const result = await authClient.completePasswordReset({ password });
    if (result.ok) onDone();
    else setError(result.message);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormError message={error} />
      <div>
        <Field label="New password" error={errors.password?.message}>
          {(control) => (
            <PasswordInput
              {...control}
              {...register("password")}
              autoComplete="new-password"
              autoFocus
            />
          )}
        </Field>
        <PasswordRules value={password} />
      </div>
      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        Change password
      </Button>
    </form>
  );
}
