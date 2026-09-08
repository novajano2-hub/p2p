"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AuthCard, AuthFootnote, AuthLink, OrDivider } from "@/components/auth/auth-card";
import { CodeStep } from "@/components/auth/code-step";
import { GoogleButton } from "@/components/auth/google-button";
import { FormError } from "@/components/auth/notices";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { authClient, googleErrorMessage } from "@/lib/auth/client";
import {
  loginEmailForm,
  loginPasswordForm,
  type LoginEmailForm,
  type LoginPasswordForm,
} from "@/lib/auth/schemas";
import { afterAuth, cta, site } from "@/lib/site";

/*
  Log in: email, then password, then the code that was just sent to that
  email. The password proves the secret is known; the code proves the inbox is
  still held. A stolen password alone gets nobody in.
*/
type Step = "email" | "password" | "code";

export function LoginFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  // How a Google sign-in that did not finish reports back: ?error=google_<reason>.
  const [googleError, setGoogleError] = useState<string | null>(() =>
    googleErrorMessage(searchParams.get("error")),
  );

  if (step === "code") {
    return (
      <>
        <AuthCard title="Verify it's you">
          <CodeStep
            email={email}
            verify={(code) => authClient.verifyLogin({ code })}
            resend={() => authClient.resendLoginCode()}
            onVerified={() => router.replace(afterAuth)}
            onChangeEmail={() => setStep("email")}
          />
        </AuthCard>
        <Footnote />
      </>
    );
  }

  return (
    <>
      <AuthCard
        title="Log in"
        description={
          step === "password" ? (
            <>
              Signing in as <span className="text-foreground font-medium">{email}</span>.{" "}
              <button
                type="button"
                onClick={() => setStep("email")}
                className="text-primary hover:text-primary-hover font-medium underline-offset-4 hover:underline"
              >
                Not you?
              </button>
            </>
          ) : undefined
        }
      >
        {step === "email" ? (
          <EmailStep
            initialEmail={email}
            notice={googleError}
            onContinue={(value) => {
              setGoogleError(null);
              setEmail(value);
              setStep("password");
            }}
          />
        ) : (
          <PasswordStep email={email} onCodeSent={() => setStep("code")} />
        )}
      </AuthCard>
      <Footnote />
    </>
  );
}

function Footnote() {
  return (
    <AuthFootnote>
      New to {site.name}? <AuthLink href={cta.signup.href}>{cta.signup.label}</AuthLink>
    </AuthFootnote>
  );
}

function EmailStep({
  initialEmail,
  notice,
  onContinue,
}: {
  initialEmail: string;
  notice: string | null;
  onContinue: (email: string) => void;
}) {
  const [error, setError] = useState<string | null>(notice);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginEmailForm>({
    resolver: zodResolver(loginEmailForm),
    defaultValues: { email: initialEmail },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    const result = await authClient.startLogin({ email });
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
              autoComplete="username"
              inputMode="email"
              placeholder="you@example.com"
              autoFocus
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Continue
        </Button>
      </form>

      <OrDivider />
      <GoogleButton onResult={(result) => setError(result.ok ? null : result.message)} />
    </>
  );
}

function PasswordStep({ email, onCodeSent }: { email: string; onCodeSent: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginPasswordForm>({
    resolver: zodResolver(loginPasswordForm),
    defaultValues: { password: "" },
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    const result = await authClient.login({ email, password });
    if (result.ok) onCodeSent();
    else setError(result.message);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormError message={error} />
      <Field label="Password" error={errors.password?.message}>
        {(control) => (
          <PasswordInput
            {...control}
            {...register("password")}
            autoComplete="current-password"
            autoFocus
          />
        )}
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        {cta.login.label}
      </Button>
      <p className="text-center text-[13px]">
        <AuthLink href="/recover">Forgot password?</AuthLink>
      </p>
    </form>
  );
}
