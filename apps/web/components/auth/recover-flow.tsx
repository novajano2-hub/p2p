"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AuthCard, AuthFootnote, AuthLink } from "@/components/auth/auth-card";
import { FormError } from "@/components/auth/notices";
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
            : "Enter the email you signed up with. If it matches an account, we will send a code to choose a new password."
        }
      >
        {sentTo ? (
          <div className="text-muted-foreground flex flex-col gap-3 text-sm leading-relaxed">
            <p role="status">
              If an account exists for <span className="text-foreground font-medium">{sentTo}</span>
              , a reset code is on its way. It expires in 30 minutes.
            </p>
            {/*
              Said plainly rather than left to be discovered: the reset code is
              issued, but choosing the new password with it is not built yet, and
              there is no mail provider to deliver it either. Unconditional, so it
              still reveals nothing about whether the address has an account.
            */}
            <p>Choosing a new password is not available yet. Contact support for now.</p>
          </div>
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
              Send reset code
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
