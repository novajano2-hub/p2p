"use client";

import { Desktop, Moon, ShieldCheck, SignOut, Sun } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { adminClient, type AdminIdentity } from "@/lib/admin/client";
import {
  applyThemeChoice,
  getServerThemeChoice,
  readThemeChoice,
  subscribeThemeChoice,
  type ThemeChoice,
} from "@/lib/theme";

/*
  The chrome around the admin area, and the gate in front of it.

  Visibly not the customer app. That is the point rather than a style choice:
  somebody who can approve identity documents should never be a moment's
  confusion away from thinking they are looking at their own account. The bar
  is pinned dark in both themes (--admin-bar-bg/-fg in globals.css) rather
  than built from the tokens that flip with the viewer's theme - a bar built
  from bg-foreground/text-background would turn near-white the moment an
  administrator's system sits in dark mode, which says the opposite of what
  this bar exists to say.
*/

const AdminContext = createContext<AdminIdentity | null>(null);

export function useAdmin(): AdminIdentity {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error("useAdmin() must be used inside AdminShell");
  return admin;
}

type State =
  | { status: "loading" }
  | { status: "in"; admin: AdminIdentity }
  | { status: "error"; message: string };

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let live = true;
    void adminClient.me().then((result) => {
      if (!live) return;
      if (result.ok) {
        setState({ status: "in", admin: result.admin });
        return;
      }
      if (result.code === "AUTH") {
        router.replace("/admin/login");
        return;
      }
      setState({ status: "error", message: result.message });
    });
    return () => {
      live = false;
    };
  }, [router]);

  if (state.status === "loading") {
    return (
      <Frame>
        <p role="status" className="text-muted-foreground text-sm">
          Checking your session&hellip;
        </p>
      </Frame>
    );
  }

  if (state.status === "error") {
    return (
      <Frame>
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      </Frame>
    );
  }

  return (
    <AdminContext.Provider value={state.admin}>
      <div className="flex min-h-full flex-1 flex-col">
        <header
          className="sticky top-0 z-20"
          style={{ backgroundColor: "var(--admin-bar-bg)", color: "var(--admin-bar-fg)" }}
        >
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-5">
            <div className="flex items-center gap-2.5">
              <ShieldCheck size={20} weight="fill" aria-hidden="true" />
              <span className="text-[15px] font-semibold tracking-tight">BIRQ administration</span>
            </div>
            <div className="flex items-center gap-3">
              <AdminThemeToggle />
              <span
                aria-hidden="true"
                className="h-5 w-px shrink-0"
                style={{ backgroundColor: "var(--admin-bar-fg)", opacity: 0.2 }}
              />
              <span className="hidden max-w-[16rem] truncate text-[13px] opacity-80 sm:inline">
                {state.admin.email}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await adminClient.logout();
                  router.replace("/admin/login");
                }}
                className="rounded-control flex h-8 items-center gap-1.5 px-2 text-[13px] font-medium transition-opacity duration-150 hover:opacity-70"
              >
                <SignOut size={15} weight="bold" aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:py-10">{children}</main>
      </div>
    </AdminContext.Provider>
  );
}

/*
  System / Light / Dark, three icon-only buttons sized to sit in a 56px bar.
  Reuses lib/theme.ts - the same preference a customer sets, since it is a
  property of the browser, not of which realm's account is signed in - but
  keeps its own compact markup rather than the customer AccountMenu's full
  labelled control, which is styled for a light surface and has no room to
  spare in a header this slim.
*/
const THEME_OPTIONS: readonly { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "Match system theme", Icon: Desktop },
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
];

function AdminThemeToggle() {
  const choice = useSyncExternalStore(subscribeThemeChoice, readThemeChoice, getServerThemeChoice);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-full p-0.5"
      style={{ backgroundColor: "color-mix(in srgb, var(--admin-bar-fg) 12%, transparent)" }}
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => {
        const checked = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            onClick={() => applyThemeChoice(value)}
            className="flex size-7 items-center justify-center rounded-full transition-[background-color,opacity] duration-150"
            style={
              checked
                ? { backgroundColor: "var(--admin-bar-fg)", color: "var(--admin-bar-bg)" }
                : { color: "var(--admin-bar-fg)", opacity: 0.75 }
            }
          >
            <Icon size={14} weight={checked ? "fill" : "regular"} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/** What the gate shows before it knows, centred and without the bar. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-sm text-center">{children}</div>
    </main>
  );
}

/** Shown where a role is missing, in place of the thing it would have gated. */
export function NeedsRole({ role, children }: { role: string; children?: ReactNode }) {
  return (
    <div className="rounded-surface border-border bg-surface border px-5 py-8 text-center">
      <p className="text-foreground text-sm font-medium">You do not have the {role} role.</p>
      <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed">
        Capability here is granted per task, never by being an administrator. Another administrator
        can grant it with the command line.
      </p>
      {children}
    </div>
  );
}

/** A button that runs an async action and reports what came back, its own busy state included. */
export function ActionButton({
  label,
  busyLabel,
  variant,
  size = "lg",
  className,
  disabled,
  onRun,
}: {
  label: ReactNode;
  busyLabel: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  disabled?: boolean;
  onRun: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      loading={busy}
      disabled={disabled}
      className={className}
      onClick={async () => {
        setBusy(true);
        try {
          await onRun();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? busyLabel : label}
    </Button>
  );
}
