"use client";

import { GoogleLogo } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient, type AuthResult } from "@/lib/auth/client";

/*
  The single OAuth option (owner decision, 2026-09-08: Google only). Renders the
  same on sign-up and log-in; the server decides which it is.
*/
export function GoogleButton({ onResult }: { onResult: (result: AuthResult) => void }) {
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
