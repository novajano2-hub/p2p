"use client";

import { Compass, Megaphone, Receipt } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";

import { DocumentTitle } from "@/components/app/document-title";
import { Fallback } from "@/components/app/fallback";
import { ButtonLink } from "@/components/ui/button";
import { afterAuth, site } from "@/lib/site";

/*
  Something asked for inside the app that is not there - an order that does
  not exist or is somebody else's, an ad that went offline. The screens call
  notFound() when the API answers 404, and a stranger's order answers exactly
  like a missing one (the API makes sure of that), so the sentence says both.

  A client component only to read the address: what is missing decides the
  words and the way back.
*/

const PLACES = [
  {
    prefix: "/orders/",
    icon: Receipt,
    title: "This order is not here",
    tab: "Order not found",
    body: "It does not exist, or it is not one of yours.",
    back: { label: "Your orders", href: "/orders" },
  },
  {
    prefix: "/trade/offers/",
    icon: Megaphone,
    title: "This ad is not available",
    tab: "Ad not available",
    body: "Its owner took it offline or closed it, or the link is wrong.",
    back: { label: "Back to the market", href: "/trade" },
  },
  {
    prefix: "/trade/ads/",
    icon: Megaphone,
    title: "This ad is not here",
    tab: "Ad not found",
    body: "It does not exist, or it is not one of yours.",
    back: { label: "My ads", href: "/trade/ads" },
  },
] as const;

const ANYWHERE = {
  icon: Compass,
  title: "This page does not exist",
  tab: "Page not found",
  body: "The link may be wrong, or the page may have moved.",
  back: { label: "Go to your home", href: afterAuth },
};

export default function AppNotFound() {
  const pathname = usePathname();
  const place = PLACES.find((candidate) => pathname.startsWith(candidate.prefix)) ?? ANYWHERE;

  return (
    <>
      <DocumentTitle title={`${place.tab} | ${site.name}`} />
      <Fallback
        icon={place.icon}
        title={place.title}
        actions={
          <ButtonLink href={place.back.href} arrow={false}>
            {place.back.label}
          </ButtonLink>
        }
      >
        {place.body}
      </Fallback>
    </>
  );
}
