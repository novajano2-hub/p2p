"use client";

import { ArrowsLeftRight, Receipt, Wallet } from "@phosphor-icons/react";

import { EmptyState, PageHeader, Panel } from "@/components/app/panel";

/*
  What a section shows before the feature behind it exists. Real navigation
  needs real destinations - a tab that 404s is worse than one that says what
  is coming - so each section has a page from day one, and this is it.

  The icon is named, not passed: the pages are server components and a
  component is a function, which cannot cross into a client component as a prop.
*/
const ICONS = {
  trade: ArrowsLeftRight,
  orders: Receipt,
  wallet: Wallet,
} as const;

type Props = {
  title: string;
  description: string;
  icon: keyof typeof ICONS;
  empty: { title: string; description: string };
};

export function SectionPlaceholder({ title, description, icon, empty }: Props) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Panel>
        <EmptyState icon={ICONS[icon]} title={empty.title} description={empty.description} />
      </Panel>
    </>
  );
}
