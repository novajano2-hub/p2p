"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AuthCard, AuthFootnote, AuthLink, OrDivider } from "@/components/auth/auth-card";
import { CodeStep } from "@/components/auth/code-step";
import { GoogleButton } from "@/components/auth/google-button";
import { FormError } from "@/components/auth/notices";
import { PasswordRules } from "@/components/auth/password-rules";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient } from "@/lib/auth/client";
import {
  newPasswordForm,
  registerEmailForm,
  type NewPasswordForm,
  type RegisterEmailForm,
} from "@/lib/auth/schemas";
import { afterAuth, cta, site } from "@/lib/site";

/*
  Sign-up in three steps, one card, one thing per step:
    1. email + consent           -> the server decides what happens next
    2. six-digit code            -> proves the inbox
    3. password with live rules  -> creates the account

  Identifier before password is the security shape the brief asks for: the
  response to step 1 is the same whether or not the address exists.
*/
type Step = "email" | "code" | "password";

export function RegisterFlow() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");

  if (step === "code") {
    return (
      <>
        <AuthCard title="Verify your email">
          <CodeStep
            email={email}
            verify={(code) => authClient.verifyEmailCode({ email, code })}
            resend={() => authClient.resendEmailCode({ email })}
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
        <AuthCard title="Create a password">
          <PasswordStep />
        </AuthCard>
        <Footnote />
      </>
    );
  }

  return (
    <>
      <AuthCard title={`Welcome to ${site.name}`}>
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
      Already have an account? <AuthLink href={cta.login.href}>{cta.login.label}</AuthLink>
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
  } = useForm<RegisterEmailForm>({
    resolver: zodResolver(registerEmailForm),
    defaultValues: { email: initialEmail, consent: false },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    const result = await authClient.startRegistration({ email });
    if (result.ok) onContinue(email);
    else setError(result.message);
  });

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormError message={error} />

        <Field label="Email" error={errors.email?.message}>
          {(control) => (
            <Input
              {...control}
              {...register("email")}
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              autoFocus
            />
          )}
        </Field>

        <Checkbox
          {...register("consent")}
          error={errors.consent?.message}
          label={
            <>
              By creating an account, I agree to {site.name}&apos;s{" "}
              <AuthLink href="/terms">Terms of Service</AuthLink> and{" "}
              <AuthLink href="/privacy">Privacy Policy</AuthLink>.
            </>
          }
        />

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Continue
        </Button>
      </form>

      <OrDivider />
      <GoogleButton onResult={(result) => setError(result.ok ? null : result.message)} />
    </>
  );
}

function PasswordStep() {
  const router = useRouter();
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
    const result = await authClient.completeRegistration({ password });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // replace, not push: once the account exists the sign-up form must not be
    // one Back press away.
    router.replace(afterAuth);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormError message={error} />

      <div>
        <Field label="Password" error={errors.password?.message}>
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
        {cta.signup.label}
      </Button>
    </form>
  );
}
