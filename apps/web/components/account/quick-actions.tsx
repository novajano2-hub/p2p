"use client";

import { ArrowCircleDown, ArrowCircleUp, Megaphone } from "@phosphor-icons/react";

import { AppLink } from "@/components/ui/app-link";

/*
  The three things a customer comes here to do. Big targets, one line each:
  the marketplace is where the detail lives.
*/

const actions = [
  {
    href: "/trade?side=buy",
    title: "Buy USDT",
    description: "Pay birr to a seller; the USDT is held for you until it arrives.",
    Icon: ArrowCircleDown,
  },
  {
    href: "/trade?side=sell",
    title: "Sell USDT",
    description: "Lock USDT in escrow, get paid in birr, then release it.",
    Icon: ArrowCircleUp,
  },
  {
    href: "/trade?view=offers",
    title: "Post an offer",
    description: "Set your own price and limits and let buyers come to you.",
    Icon: Megaphone,
  },
] as const;

export function QuickActions() {
  return (
    <ul className="grid gap-3 sm:grid-cols-3" aria-label="Quick actions">
      {actions.map(({ href, title, description, Icon }) => (
        <li key={href}>
          <AppLink
            href={href}
            className="group rounded-surface border-border bg-surface shadow-raised-soft hover:border-primary/30 hover:shadow-raised-soft-hover flex h-full items-start gap-3.5 border px-4 py-4 transition-[border-color,box-shadow,translate] duration-150 ease-out hover:-translate-y-px motion-reduce:hover:translate-y-0"
          >
            <span className="bg-primary-soft text-primary-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
              <Icon size={22} weight="duotone" aria-hidden="true" />
            </span>
            <span>
              <span className="text-foreground group-hover:text-primary block text-[15px] font-medium transition-colors duration-150">
                {title}
              </span>
              <span className="text-muted-foreground mt-0.5 block text-[13px] leading-relaxed">
                {description}
              </span>
            </span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}
