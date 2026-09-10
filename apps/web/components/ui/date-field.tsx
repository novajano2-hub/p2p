"use client";

import { CalendarBlank, CaretDown, CaretLeft, CaretRight, CaretUp } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/cn";

/*
  A calendar for choosing a date, dressed as one of the kit's text controls.

  Built for a date of birth. The month and the year are dropdowns, because
  nobody should press "previous month" three hundred times, and the calendar
  is bounded to the dates the caller allows, so the youngest permitted
  birthday is the last day that can be chosen. The value is a plain
  "YYYY-MM-DD" made from local calendar parts: the day chosen is the day
  stored, whatever time zone the phone is in.

  react-day-picker draws the grid and handles the keyboard; the paint is in
  globals.css under .rdp-*, in the kit's tokens, so dark mode is free.
*/

type DateFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** The oldest and the newest dates that may be chosen, both inclusive. */
  earliest: Date;
  latest: Date;
  /** Where the calendar opens when nothing is chosen yet. */
  initialMonth: Date;
  placeholder?: string | undefined;
  id?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: true | undefined;
  disabled?: boolean | undefined;
};

const longDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const shortMonth = new Intl.DateTimeFormat("en-GB", { month: "short" });

function parseIso(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toIso(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function DateField({
  value,
  onChange,
  earliest,
  latest,
  initialMonth,
  placeholder = "Choose a date",
  id,
  disabled,
  ...aria
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = parseIso(value);

  // A press anywhere else closes it. pointerdown rather than click, so a
  // drag that starts outside closes it wherever the pointer ends up.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Opening puts focus inside: on the chosen day, or else on the year,
  // which is where a date of birth starts.
  useEffect(() => {
    if (!open) return;
    const target =
      wrapper.current?.querySelector<HTMLElement>(".rdp-selected .rdp-day_button") ??
      wrapper.current?.querySelector<HTMLElement>("select.rdp-years_dropdown");
    target?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      ref={wrapper}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={aria["aria-describedby"]}
        // A button has no aria-invalid; the error text is reached through
        // aria-describedby, and the border says the same thing visually.
        data-invalid={aria["aria-invalid"] ? "" : undefined}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "rounded-control bg-surface flex h-11 w-full items-center justify-between gap-3 border px-3.5 text-left text-[15px]",
          "transition-[border-color,box-shadow] duration-150 ease-out",
          "focus-visible:border-primary focus-visible:ring-primary/25 focus-visible:ring-2 focus-visible:outline-none",
          "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
          "border-border data-invalid:border-destructive data-invalid:focus-visible:ring-destructive/25",
          selected ? "text-foreground" : "text-muted-foreground/70",
        )}
      >
        <span className="truncate">{selected ? longDate.format(selected) : placeholder}</span>
        <CalendarBlank size={18} aria-hidden="true" className="text-muted-foreground shrink-0" />
      </button>

      {open ? (
        <div className="rounded-surface border-border bg-surface shadow-panel absolute top-[calc(100%+0.375rem)] left-0 z-30 border p-3">
          <DayPicker
            mode="single"
            role="dialog"
            aria-label="Choose a date"
            selected={selected}
            onSelect={(date) => {
              if (!date) return;
              onChange(toIso(date));
              close();
            }}
            defaultMonth={selected ?? initialMonth}
            captionLayout="dropdown"
            startMonth={earliest}
            endMonth={latest}
            disabled={[{ before: earliest }, { after: latest }]}
            components={{ Chevron }}
            formatters={{ formatMonthDropdown: (month) => shortMonth.format(month) }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The library's caret, drawn with the same icon set as everything else here. */
function Chevron({
  orientation = "left",
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
  size?: number;
  disabled?: boolean;
  orientation?: "up" | "down" | "left" | "right";
}) {
  const Icon =
    orientation === "left"
      ? CaretLeft
      : orientation === "right"
        ? CaretRight
        : orientation === "up"
          ? CaretUp
          : CaretDown;
  return (
    <Icon
      size={orientation === "down" ? 12 : 14}
      weight="bold"
      aria-hidden="true"
      className={className}
      style={style}
    />
  );
}
