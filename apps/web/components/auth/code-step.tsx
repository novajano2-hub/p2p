"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { FormError } from "@/components/auth/notices";
import { Button } from "@/components/ui/button";
import { CodeInput } from "@/components/ui/code-input";
import { Field } from "@/components/ui/field";
import type { AuthResult } from "@/lib/auth/client";
import { maskEmail } from "@/lib/auth/mask-email";
import { codeForm, type CodeForm } from "@/lib/auth/schemas";

/*
  "A 6-digit code has been sent to sam***@gmail.com." Six boxes, a button for
  anyone who wants one (the sixth digit submits on its own), a resend link
  that rests for a minute after each send, and a way back if the address was
  wrong. Shared by sign-up, sign-in and password reset.
*/

const RESEND_REST_SECONDS = 60;
const CODE_VALID_MINUTES = 30;

type CodeStepProps = {
  email: string;
  verify: (code: string) => Promise<AuthResult>;
  resend: () => Promise<AuthResult>;
  onVerified: () => void;
  onChangeEmail: () => void;
};

export function CodeStep({ email, verify, resend, onVerified, onChangeEmail }: CodeStepProps) {
  const [error, setError] = useState<string | null>(null);
  const [rest, setRest] = useState(RESEND_REST_SECONDS);
  const [resending, setResending] = useState(false);
  const [help, setHelp] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CodeForm>({ resolver: zodResolver(codeForm), defaultValues: { code: "" } });

  // Count the resend rest down. The interval owns the state change, not the effect body.
  useEffect(() => {
    if (rest <= 0) return;
    const id = window.setInterval(() => setRest((value) => value - 1), 1000);
    return () => window.clearInterval(id);
  }, [rest]);

  const onSubmit = handleSubmit(async ({ code }) => {
    setError(null);
    const result = await verify(code);
    if (result.ok) onVerified();
    else setError(result.message);
  });

  const onResend = async () => {
    setResending(true);
    setError(null);
    try {
      const result = await resend();
      if (result.ok) setRest(RESEND_REST_SECONDS);
      else setError(result.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormError message={error} />

      <Field
        label="Verification code"
        error={errors.code?.message}
        hint={`Sent to ${maskEmail(email)}. Enter it within the next ${CODE_VALID_MINUTES} minutes.`}
      >
        {(a11y) => (
          <Controller
            control={control}
            name="code"
            render={({ field }) => (
              <CodeInput
                {...a11y}
                value={field.value}
                onChange={field.onChange}
                // The sixth digit submits. The value is already in the form's
                // store by the time this fires, so the submit reads the full code.
                onComplete={() => void onSubmit()}
                disabled={isSubmitting}
                autoFocus
              />
            )}
          />
        )}
      </Field>

      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        Continue
      </Button>

      <div className="text-muted-foreground flex flex-col gap-2 text-[13px]">
        <button
          type="button"
          onClick={onResend}
          disabled={rest > 0 || resending}
          className="text-primary hover:text-primary-hover disabled:text-muted-foreground self-start font-medium underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:no-underline"
        >
          {rest > 0 ? `Resend code in ${rest}s` : resending ? "Sending…" : "Resend code"}
        </button>
        <button
          type="button"
          onClick={() => setHelp((value) => !value)}
          aria-expanded={help}
          className="text-primary hover:text-primary-hover self-start font-medium underline-offset-4 hover:underline"
        >
          Didn&apos;t receive the code?
        </button>
        {help ? (
          <p className="leading-relaxed">
            Check your spam folder. If the address above is wrong,{" "}
            <button
              type="button"
              onClick={onChangeEmail}
              className="text-primary hover:text-primary-hover font-medium underline-offset-4 hover:underline"
            >
              use a different email
            </button>
            .
          </p>
        ) : null}
      </div>
    </form>
  );
}
