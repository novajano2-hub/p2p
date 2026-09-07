import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { AppLink } from "@/components/ui/app-link";

/*
  One card, one step, one input. The logo sits inside the card and is the way
  home; there is no site header on these pages so nothing competes with the
  single thing the visitor is here to do.
*/
type AuthCardProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <div className="rounded-surface border-border bg-surface shadow-panel w-full max-w-[27rem] border px-6 py-7 sm:px-9 sm:py-9">
      <AppLink href="/" aria-label="Home" className="rounded-control inline-flex">
        <Logo />
      </AppLink>
      <h1 className="font-display text-foreground mt-7 text-2xl leading-tight">{title}</h1>
      {description ? (
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
          {description}
        </p>
      ) : null}
      <div className="mt-6">{children}</div>
    </div>
  );
}

/** The one line under the card: the way to the other flow. */
export function AuthFootnote({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground mt-6 text-center text-sm">{children}</p>;
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <AppLink
      href={href}
      className="rounded-control text-primary hover:text-primary-hover font-medium underline-offset-4 transition-colors duration-150 hover:underline"
    >
      {children}
    </AppLink>
  );
}

/** Divider between the form and the OAuth option. */
export function OrDivider() {
  return (
    <div
      className="text-muted-foreground my-5 flex items-center gap-3 text-xs"
      role="separator"
      aria-label="or"
    >
      <span aria-hidden="true" className="bg-border h-px flex-1" />
      <span aria-hidden="true">or</span>
      <span aria-hidden="true" className="bg-border h-px flex-1" />
    </div>
  );
}
