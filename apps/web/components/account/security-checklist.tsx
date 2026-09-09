"use client";

import { CheckCircle, Circle } from "@phosphor-icons/react";

import { Panel } from "@/components/app/panel";
import { useSession } from "@/components/app/session-provider";
import { AppLink } from "@/components/ui/app-link";
import { settingsHref } from "@/lib/app-nav";

/*
  What is protecting the account, in plain terms. Custody means the stakes of
  a takeover are money, so this earns a place on the home page rather than
  being buried in settings. Only what the session actually knows is shown as
  done; the rest is shown as still to do, not assumed.
*/
export function SecurityChecklist({ className }: { className?: string | undefined }) {
  const { user } = useSession();

  const items = [
    {
      label: "Email verified",
      done: user.emailVerified,
      detail: user.emailVerified ? "Your address is confirmed." : "Confirm your address.",
    },
    {
      label: "Code on every log-in",
      done: true,
      detail: "A password alone never signs anyone in.",
    },
    {
      label: "Authenticator app",
      done: false,
      detail: "Not available yet.",
    },
  ];

  return (
    <Panel
      title="Security"
      action={
        <AppLink
          href={settingsHref}
          className="text-primary hover:text-primary-hover font-medium underline-offset-4 hover:underline"
        >
          Settings
        </AppLink>
      }
      className={className}
    >
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-2.5">
            {item.done ? (
              <CheckCircle
                size={18}
                weight="fill"
                aria-hidden="true"
                className="text-status-complete-fg mt-0.5 shrink-0"
              />
            ) : (
              <Circle size={18} aria-hidden="true" className="text-sage mt-0.5 shrink-0" />
            )}
            <div>
              <p className="text-foreground text-sm font-medium">{item.label}</p>
              <p className="text-muted-foreground text-[12px]">{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
