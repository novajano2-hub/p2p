"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/*
  One panel of several, switched by a row of buttons above it - the WAI-ARIA
  tabs pattern, hand-built like every other control in this kit rather than
  pulled in as a dependency. Arrow keys move focus and selection together
  (the "automatic activation" model the pattern recommends for a small,
  static set of tabs like this one); Home and End jump to the ends.

  Only the active panel's content is mounted, not merely hidden: a settings
  section with its own network request (the KYC row, for one) should not run
  that request for four tabs nobody is looking at.
*/

export type TabItem = {
  id: string;
  label: string;
  content: ReactNode;
};

export function Tabs({
  items,
  defaultTab,
  className,
}: {
  items: readonly TabItem[];
  defaultTab?: string;
  className?: string;
}) {
  const [active, setActive] = useState(defaultTab ?? items[0]?.id ?? "");
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = (id: string) => {
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${id}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === active);
    if (index === -1) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = items[nextIndex];
    if (!next) return;
    setActive(next.id);
    focusTab(next.id);
  };

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label="Settings sections"
        onKeyDown={onKeyDown}
        className="border-border mb-5 flex gap-1 overflow-x-auto border-b sm:gap-2"
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              data-tab-id={item.id}
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.id)}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150",
                selected
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item) =>
        item.id === active ? (
          <div
            key={item.id}
            role="tabpanel"
            id={`${baseId}-panel-${item.id}`}
            aria-labelledby={`${baseId}-tab-${item.id}`}
            tabIndex={0}
          >
            {item.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
