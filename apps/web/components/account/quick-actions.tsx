"use client";

import { ArrowCircleDown, ArrowCircleUp, Megaphone } from "@phosphor-icons/react";

import { AppLink } from "@/components/ui/app-link";
import { ButtonLink } from "@/components/ui/button";

/*
  The three things a customer comes here to do. Big targets, one line each:
  the marketplace is where the detail lives.

  The first two carry the side the marketplace actually reads, so the toggle is
  already where it should be on arrival. These were written before that screen
  existed and invented their own names for it - side=buy, view=offers - which
  nothing ever read, so all three landed on the default Buy view.
*/

const actions = [
  {
    href: "/trade?want=BUY",
    title: "Buy USDT",
    description: "Pay ETB to a seller; the USDT is held for you until it arrives.",
    Icon: ArrowCircleDown,
    variant: "primary",
  },
  {
    href: "/trade?want=SELL",
    title: "Sell USDT",
    description: "Lock USDT in escrow, get paid in ETB, then release it.",
    Icon: ArrowCircleUp,
    variant: "sell",
  },
  {
    href: "/trade/ads/new",
    title: "Post an ad",
    description: "Set your own price and limits and let buyers come to you.",
    Icon: Megaphone,
    variant: "secondary",
  },
] as const;

export function QuickActions() {
  return (
    <>
      {/* A phone has no room for three sentences: there they are three buttons, Buy green and Sell red as in the market. */}
      <div className="flex gap-2 sm:hidden" role="group" aria-label="Quick actions">
        {actions.map(({ href, title, variant }) => (
          <ButtonLink
            key={href}
            href={href}
            variant={variant}
            arrow={false}
            className="h-11 flex-1 px-2 text-sm"
          >
            {title}
          </ButtonLink>
        ))}
      </div>
      <Cards />
    </>
  );
}

function Cards() {
  return (
    <ul className="hidden gap-3 sm:grid sm:grid-cols-3" aria-label="Quick actions">
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
