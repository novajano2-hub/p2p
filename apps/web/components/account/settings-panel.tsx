"use client";

import { useState } from "react";

import { PageHeader, Panel } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { ThemeControl } from "@/components/app/theme-control";
import { FormError } from "@/components/auth/notices";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

/*
  Settings: the account, how it looks, and how it is protected. Changing the
  password goes through the same code-verified flow as recovering it, which
  is why it links there rather than duplicating it.
*/
export function SettingsPanel() {
  const { user, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Settings" />

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <Panel title="Account">
          <dl className="divide-border divide-y text-sm">
            <Row label="Email">
              <span className="text-foreground break-all">{user.email}</span>
            </Row>
            <Row label="Email verified">
              {user.emailVerified ? (
                <StatusPill status="complete">Verified</StatusPill>
              ) : (
                <StatusPill status="pending">Not verified</StatusPill>
              )}
            </Row>
            <Row label="Status">
              <StatusPill status={user.status === "ACTIVE" ? "complete" : "attention"}>
                {user.status.charAt(0) + user.status.slice(1).toLowerCase()}
              </StatusPill>
            </Row>
            <Row label="Account ID">
              {/* Mono, because it is an identifier a support ticket may quote. */}
              <span className="text-muted-foreground font-mono text-xs break-all">{user.id}</span>
            </Row>
          </dl>
        </Panel>

        <Panel title="Appearance" description="Follow your device, or pick one.">
          <ThemeControl className="max-w-sm" />
        </Panel>

        <Panel title="Security" className="lg:col-span-2">
          <dl className="divide-border divide-y text-sm">
            <Row label="Password">
              <ButtonLink href="/recover" size="sm" variant="secondary" arrow={false}>
                Change password
              </ButtonLink>
            </Row>
            <Row label="Log-in verification">
              <span className="text-muted-foreground">
                A code is sent to your email on every log-in.
              </span>
            </Row>
            <Row label="Authenticator app">
              <StatusPill status="neutral">Not available yet</StatusPill>
            </Row>
          </dl>
        </Panel>

        <Panel title="Session" className="lg:col-span-2">
          <FormError message={signOutError} />
          <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
            Signing out ends this session on the server, not just in this browser.
          </p>
          <Button
            type="button"
            variant="secondary"
            loading={signingOut}
            onClick={async () => {
              setSigningOut(true);
              setSignOutError(null);
              const result = await signOut();
              if (!result.ok) {
                setSigningOut(false);
                setSignOutError(result.message);
              }
            }}
          >
            Log out
          </Button>
        </Panel>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
