"use client";

import { GoogleLogo } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient, type AuthResult } from "@/lib/auth/client";
import { stashNext } from "@/lib/next-path";

/*
  The single OAuth option (owner decision, 2026-09-08: Google only). Renders the
  same on sign-up and log-in; the server decides which it is.
*/
export function GoogleButton({
  onResult,
  next,
}: {
  onResult: (result: AuthResult) => void;
  /** Where to land after signing in. Google sends everybody to the front door; this goes on from there. */
  next?: string | undefined;
}) {
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className="w-full"
      loading={pending}
      onClick={async () => {
        setPending(true);
        if (next) stashNext(next);
        try {
          onResult(await authClient.continueWithGoogle());
        } finally {
          setPending(false);
        }
      }}
    >
      <GoogleLogo size={18} weight="bold" aria-hidden="true" />
      Continue with Google
    </Button>
  );
}
