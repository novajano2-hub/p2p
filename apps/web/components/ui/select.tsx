"use client";

import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { useMediaQuery } from "@/lib/use-media-query";

/*
  A select drawn from our own tokens, the way Binance draws theirs.

  The native <select> was the honest first choice: the platform's own
  picker, for free. It is also the one control on these screens that ignores
  the kit - its popup is the operating system's, in its own colours and
  type, and a payment rail cannot carry its coloured bar into it. So this is
  the listbox pattern done by hand. On a desktop, a panel under the field
  with the choices, a tick beside the current one, and a search box once the
  list is long. On a phone, a sheet from the bottom of the screen, with the
  choices as rows a thumb can actually hit. Same component, same props, and
  the keyboard does what a native select's does: arrows, Home and End,
  typing to jump, Enter to choose, Escape to leave.
*/

export type SelectOption = {
  value: string;
  label: string;
  /** A second line under the name. */
  description?: string | undefined;
  /** A coloured bar before the name, the mark of a payment rail: a background class. */
  bar?: string | undefined;
  disabled?: boolean | undefined;
};

export type SelectProps = {
  id?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: true | undefined;
  "aria-label"?: string | undefined;
  /** What the sheet on a phone is called. The field's label, unless said otherwise. */
  title?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  onBlur?: (() => void) | undefined;
  options: readonly SelectOption[];
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  /** A hidden input by this name carries the value, for a plain form post. */
  name?: string | undefined;
  /** A search box above the choices. On by itself once there are this many. */
  searchable?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
};

const SEARCH_FROM = 9;
/** Below this width the choices come up as a sheet. Tailwind's sm breakpoint. */
const PHONE = "(max-width: 639px)";
/** Letters typed within this long of each other are one word to jump to. */
const TYPEAHEAD_MS = 600;
/** A row, for guessing whether the panel fits below the field. */
const ROW_PX = 44;

/** The first choice that can be chosen, looking forward from `start` and wrapping. */
function firstEnabled(from: readonly SelectOption[], start = 0): number {
  for (let i = 0; i < from.length; i += 1) {
    const index = (start + i) % from.length;
    if (!from[index]?.disabled) return index;
  }
  return -1;
}

export function Select({
  id,
  title,
  value,
  onChange,
  onBlur,
  options,
  placeholder = "Choose…",
  disabled,
  name,
  searchable,
  className,
  ref,
  ...aria
}: SelectProps) {
  const listId = useId();
  const titleId = `${listId}-title`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [above, setAbove] = useState(false);
  const [sheetTitle, setSheetTitle] = useState("");
  const phone = useMediaQuery(PHONE);

  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const withSearch = searchable ?? options.length >= SEARCH_FROM;
  const selected = options.find((option) => option.value === value) ?? null;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options;
  const optionId = (index: number) => `${listId}-${index}`;

  const setTrigger = (node: HTMLButtonElement | null) => {
    trigger.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  /* ------------------------------------------------------------ opening */

  const show = () => {
    if (disabled) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      // Guessed before the panel exists, from what it will hold.
      const height = Math.min(options.length * ROW_PX + (withSearch ? 60 : 0) + 16, 340);
      setAbove(window.innerHeight - rect.bottom < height && rect.top > height);
    }
    const label = id ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() : "";
    setSheetTitle(title ?? aria["aria-label"] ?? label ?? "");
    setQuery("");
    const current = options.findIndex((option) => option.value === value);
    setActive(current >= 0 ? current : firstEnabled(options));
    setOpen(true);
  };

  const hide = (refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) trigger.current?.focus();
  };

  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    hide();
  };

  /* ----------------------------------------------------------- keyboard */

  /** The next choice that can be chosen in a direction, wrapping around. */
  const step = (from: number, direction: 1 | -1): number => {
    if (shown.length === 0) return -1;
    let index = from;
    for (let i = 0; i < shown.length; i += 1) {
      index = (index + direction + shown.length) % shown.length;
      if (!shown[index]?.disabled) return index;
    }
    return from;
  };

  /**
   * Letters typed in quick succession name the choice to jump to; the same
   * letter pressed again and again walks through the choices starting with
   * it, as a native select does.
   */
  const typeahead = (key: string, from: readonly SelectOption[], start: number): number => {
    const now = Date.now();
    const text = (
      now - typed.current.at < TYPEAHEAD_MS ? typed.current.text + key : key
    ).toLowerCase();
    typed.current = { text, at: now };
    const probe = /^(.)\1*$/.test(text) ? text.charAt(0) : text;
    for (let i = 1; i <= from.length; i += 1) {
      const index = (start + i) % from.length;
      const option = from[index];
      if (option && !option.disabled && option.label.toLowerCase().startsWith(probe)) return index;
    }
    return -1;
  };

  const isPrintable = (event: ReactKeyboardEvent) =>
    event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      show();
      return;
    }
    if (isPrintable(event)) {
      // Closed, a native select changes its value as you type. So does this.
      const current = options.findIndex((option) => option.value === value);
      const option = options[typeahead(event.key, options, current)];
      if (option) onChange(option.value);
    }
  };

  const onOpenKeyDown = (event: ReactKeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive(step(active, 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive(step(active, -1));
        return;
      case "Home":
        event.preventDefault();
        setActive(firstEnabled(shown));
        return;
      case "End":
        event.preventDefault();
        setActive(step(0, -1));
        return;
      case "Enter": {
        event.preventDefault();
        const option = shown[active];
        if (option) choose(option);
        return;
      }
      case "Escape":
        event.preventDefault();
        hide();
        return;
      case "Tab":
        if (phone) {
          // The sheet is modal: Tab moves between its own two parts.
          event.preventDefault();
          const next = document.activeElement === search.current ? list.current : search.current;
          (next ?? list.current)?.focus();
        } else {
          hide(false);
        }
        return;
      default:
        if (!withSearch && isPrintable(event)) {
          event.preventDefault();
          const index = typeahead(event.key, shown, active);
          if (index >= 0) setActive(index);
        }
    }
  };

  /* ------------------------------------------------------------ effects */

  // A click anywhere else closes it. The sheet lives outside the wrapper, in a portal.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapper.current?.contains(target) || sheet.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Focus goes to the search box if there is one, else to the list itself.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => (search.current ?? list.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // The page behind a sheet does not scroll.
  useEffect(() => {
    if (!open || !phone) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, phone]);

  // The active choice stays in view as the keyboard moves it.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  /* ---------------------------------------------------------- rendering */

  const searchBox = withSearch ? (
    <div className={cn("relative", phone ? "mx-4 mb-3" : "mb-1")}>
      <MagnifyingGlass
        size={15}
        weight="bold"
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 my-auto"
      />
      <input
        ref={search}
        type="text"
        role="searchbox"
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        aria-label="Search the choices"
        placeholder="Search"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          const trimmed = event.target.value.trim().toLowerCase();
          const next = trimmed
            ? options.filter((option) => option.label.toLowerCase().includes(trimmed))
            : options;
          setActive(firstEnabled(next));
        }}
        onKeyDown={onOpenKeyDown}
        className="rounded-control bg-muted text-foreground placeholder:text-muted-foreground focus:ring-primary/25 h-10 w-full pr-3 pl-9 text-[14px] focus:ring-2 focus:outline-none"
      />
    </div>
  ) : null;

  const listbox = (
    <ul
      ref={list}
      id={listId}
      role="listbox"
      tabIndex={-1}
      aria-labelledby={phone ? titleId : id}
      aria-activedescendant={active >= 0 ? optionId(active) : undefined}
      onKeyDown={onOpenKeyDown}
      className={cn(
        "focus:outline-none",
        phone ? "flex flex-col gap-2 overflow-y-auto px-4 pb-4" : "max-h-72 overflow-y-auto",
      )}
    >
      {shown.length === 0 ? (
        <li className="text-muted-foreground px-3 py-6 text-center text-[13px]">
          Nothing matches.
        </li>
      ) : (
        shown.map((option, index) => {
          const current = option.value === value;
          return (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={current}
              aria-disabled={option.disabled || undefined}
              data-active={index === active || undefined}
              onMouseMove={() => {
                if (active !== index) setActive(index);
              }}
              onClick={() => choose(option)}
              className={cn(
                "flex cursor-pointer items-center gap-3 text-[15px]",
                "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
                phone
                  ? cn(
                      "rounded-control border-border bg-surface border px-4 py-3.5",
                      "data-active:border-primary/40 aria-selected:border-primary aria-selected:bg-primary-soft",
                    )
                  : cn("rounded-control px-3 py-2.5", "data-active:bg-muted"),
              )}
            >
              {option.bar ? (
                <span aria-hidden="true" className={cn("h-3.5 w-0.5 rounded-full", option.bar)} />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="text-foreground block truncate">{option.label}</span>
                {option.description ? (
                  <span className="text-muted-foreground block text-[12px] leading-relaxed">
                    {option.description}
                  </span>
                ) : null}
              </span>
              <Check
                size={15}
                weight="bold"
                aria-hidden="true"
                className={cn("text-primary shrink-0", current ? "opacity-100" : "opacity-0")}
              />
            </li>
          );
        })
      )}
    </ul>
  );

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={setTrigger}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-describedby={aria["aria-describedby"]}
        aria-invalid={aria["aria-invalid"]}
        aria-label={aria["aria-label"]}
        disabled={disabled}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onTriggerKeyDown}
        onBlur={onBlur}
        className={cn(
          "rounded-control bg-surface text-foreground flex h-11 w-full items-center gap-2.5 border pr-10 pl-3.5 text-left text-[15px]",
          "transition-[border-color,box-shadow] duration-150 ease-out",
          "focus:border-primary focus:ring-primary/25 focus:ring-2 focus:outline-none",
          "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
          "border-border aria-invalid:border-destructive aria-invalid:focus:ring-destructive/25",
          className,
        )}
      >
        {selected?.bar ? (
          <span aria-hidden="true" className={cn("h-3.5 w-0.5 rounded-full", selected.bar)} />
        ) : null}
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
      </button>
      <CaretDown
        size={15}
        weight="bold"
        aria-hidden="true"
        className={cn(
          "text-muted-foreground pointer-events-none absolute top-0 right-3.5 my-auto h-11 transition-transform duration-150",
          open && "rotate-180",
        )}
      />
      {name ? <input type="hidden" name={name} value={value} /> : null}

      {open && !phone ? (
        <div
          className={cn(
            "border-border bg-surface shadow-panel rounded-surface absolute left-0 z-50 w-full min-w-[12rem] border p-1.5",
            "motion-safe:animate-[menu-in_140ms_ease-out]",
            above ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {searchBox}
          {listbox}
        </div>
      ) : null}

      {open && phone
        ? createPortal(
            <div className="fixed inset-0 z-50">
              <div aria-hidden="true" className="bg-foreground/40 absolute inset-0" />
              <div
                ref={sheet}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onKeyDown={onOpenKeyDown}
                className={cn(
                  "bg-surface shadow-panel absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-[20px] pb-[env(safe-area-inset-bottom)]",
                  "motion-safe:animate-[sheet-up_220ms_ease-out]",
                )}
              >
                <span
                  aria-hidden="true"
                  className="bg-border mx-auto mt-2.5 h-1 w-10 rounded-full"
                />
                <h2
                  id={titleId}
                  className="text-foreground px-5 pt-3 pb-3 text-[17px] font-semibold"
                >
                  {sheetTitle || "Choose"}
                </h2>
                {searchBox}
                {listbox}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
