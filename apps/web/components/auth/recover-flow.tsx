"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AuthCard, AuthFootnote, AuthLink } from "@/components/auth/auth-card";
import { FormError, PreviewNotice } from "@/components/auth/notices";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth/client";
import { recoverForm, type RecoverForm } from "@/lib/auth/schemas";
import { cta } from "@/lib/site";

/*
  Password reset request. The response is deliberately the same whether or not
  an account exists for the address: the brief forbids account enumeration, so
  the page never confirms one either way.
*/
export function RecoverFlow() {
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecoverForm>({ resolver: zodResolver(recoverForm), defaultValues: { email: "" } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    const result = await authClient.requestPasswordReset({ email });
    if (result.ok) setSentTo(email);
    else setError(result.message);
  });

  return (
    <>
      <AuthCard
        title="Reset your password"
        description={
          sentTo
            ? undefined
            : "Enter the email you signed up with. If it matches an account, you will get a link to choose a new password."
        }
      >
        <PreviewNotice />
        {sentTo ? (
          <p className="text-muted-foreground text-sm leading-relaxed" role="status">
            If an account exists for <span className="text-foreground font-medium">{sentTo}</span>,
            a reset link is on its way. It expires in 30 minutes.
          </p>
        ) : (
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
              Send reset link
            </Button>
          </form>
        )}
      </AuthCard>
      <AuthFootnote>
        <AuthLink href={cta.login.href}>Back to {cta.login.label.toLowerCase()}</AuthLink>
      </AuthFootnote>
    </>
  );
}
