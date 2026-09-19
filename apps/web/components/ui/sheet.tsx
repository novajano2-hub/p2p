"use client";

import { X } from "@phosphor-icons/react";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

/*
  The sheet that slides up from the bottom of a phone's screen.

  It began as the select's, for a picker's choices. Now it is the one way
  anything comes up on a phone here - the market's filters and its amount,
  adding a payment method - so that they all look and move the same: a scrim,
  a grabber, the title, and whatever the caller puts under it, sliding up over
  a page that stops scrolling behind it. Escape and the scrim close it, Tab
  stays inside it, and the focus goes back to where it was when it closes.

  From sm up it is nothing by itself. A phone's sheet is a desktop's popover,
  panel or plain field, and the caller shows that instead - unless it says
  `desktop="panel"`, which makes this a panel from the right edge there, for
  a form too long to hang from a button.
*/

/** Below this width things come up as a sheet. Tailwind's sm breakpoint. */
export const PHONE = "(max-width: 639px)";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type SheetProps = {
  open: boolean;
  title: string;
  /** The title's element id, when the caller refers to it. */
  titleId?: string | undefined;
  onClose: () => void;
  /** A close button in the header, named this. Without one, the scrim and Escape close it. */
  closeLabel?: string | undefined;
  /** From sm up: the same, as a panel from the right edge. Otherwise the caller draws its own. */
  desktop?: "panel" | undefined;
  /**
   * What gets the focus as it opens: a selector inside it, or the first
   * thing in it that can take focus. False leaves that to the caller.
   */
  initialFocus?: string | false | undefined;
  dialogRef?: Ref<HTMLDivElement> | undefined;
  onKeyDown?: ((event: ReactKeyboardEvent<HTMLDivElement>) => void) | undefined;
  /** For the part under the title: its padding, mostly. */
  className?: string | undefined;
  children: ReactNode;
};

export function Sheet({ open, ...props }: SheetProps) {
  // Mounted only while open: opening and closing are what run its effects.
  return open ? <OpenSheet {...props} /> : null;
}

function OpenSheet({
  title,
  titleId: givenTitleId,
  onClose,
  closeLabel,
  desktop,
  initialFocus,
  dialogRef,
  onKeyDown,
  className,
  children,
}: Omit<SheetProps, "open">) {
  const ownTitleId = useId();
  const titleId = givenTitleId ?? ownTitleId;
  const dialog = useRef<HTMLDivElement | null>(null);
  const panel = desktop === "panel";
  // The caller's ref sees the same element, e.g. to tell a tap inside from one outside.
  useImperativeHandle(dialogRef, () => dialog.current as HTMLDivElement, []);

  // Escape closes it, unless the caller already dealt with the key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The page behind it does not scroll, and the focus goes back to where it came from.
  useEffect(() => {
    const opener = document.activeElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // The focus goes in as it opens.
  useEffect(() => {
    if (initialFocus === false) return;
    const frame = requestAnimationFrame(() => {
      const root = dialog.current;
      if (!root) return;
      const asked = initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null;
      (asked ?? firstFocusable(root) ?? root).focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [initialFocus]);

  // Tab stays inside: it is modal.
  const keyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.key !== "Tab" || event.defaultPrevented || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div aria-hidden="true" onClick={onClose} className="bg-foreground/40 absolute inset-0" />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={keyDown}
        className={cn(
          "bg-surface shadow-panel absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-[20px] pb-[env(safe-area-inset-bottom)] outline-none",
          "motion-safe:animate-[sheet-up_220ms_ease-out]",
          panel &&
            "sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-0 sm:max-h-none sm:w-[26rem] sm:rounded-none sm:pb-0 sm:motion-safe:animate-[panel-in_220ms_ease-out]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("bg-border mx-auto mt-2.5 h-1 w-10 rounded-full", panel && "sm:hidden")}
        />
        <div
          className={cn(
            "flex items-center justify-between px-5 pt-3 pb-3",
            panel && "sm:px-6 sm:pt-6",
          )}
        >
          <h2 id={titleId} className="text-foreground text-[17px] font-semibold">
            {title}
          </h2>
          {closeLabel ? (
            <button
              type="button"
              aria-label={closeLabel}
              data-sheet-close
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground -mr-2 flex size-9 items-center justify-center"
            >
              <X size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The first thing in the sheet that can take focus, the close button apart. */
function firstFocusable(root: HTMLElement): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (!element.hasAttribute("data-sheet-close")) return element;
  }
  return null;
}
