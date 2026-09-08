"use client";

import { useRef, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

/*
  The six boxes for a verification code. One real <input> per digit, because
  that is what a screen reader, a password manager and iOS's code suggestion
  all understand; the code itself is the six values joined.

  Typing advances, Backspace retreats, the arrow keys move, and a paste (or an
  autofill that drops all six digits into one box) fills every box from the
  first. When the last digit lands, onComplete fires, so the person never has
  to find the button after typing the code they were just sent.
*/

type CodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Called with the full code the moment every box is filled. */
  onComplete?: ((value: string) => void) | undefined;
  length?: number;
  /** Goes on the first box, so a <label htmlFor> has something to point at. */
  id?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: true | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
};

export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  id,
  disabled,
  autoFocus,
  ...aria
}: CodeInputProps) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, index) => value[index] ?? "");

  const commit = (next: string[]) => {
    const code = next.join("").replace(/\D/g, "").slice(0, length);
    onChange(code);
    if (code.length === length) onComplete?.(code);
  };

  const focusBox = (index: number) => {
    const box = boxes.current[Math.max(0, Math.min(length - 1, index))];
    box?.focus();
    box?.select();
  };

  /** Puts `text` into the boxes starting at `from`, then focuses the box after the last one filled. */
  const fillFrom = (from: number, text: string) => {
    const incoming = text
      .replace(/\D/g, "")
      .slice(0, length - from)
      .split("");
    if (incoming.length === 0) return;
    const next = [...digits];
    incoming.forEach((digit, offset) => {
      next[from + offset] = digit;
    });
    commit(next);
    focusBox(from + incoming.length);
  };

  const onBoxChange = (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
    const typed = event.target.value.replace(/\D/g, "");
    if (typed.length === 0) {
      const next = [...digits];
      next[index] = "";
      commit(next);
      return;
    }
    // More than one character means a paste or an autofill landed here.
    fillFrom(index, typed);
  };

  const onBoxKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = [...digits];
      if (next[index]) {
        next[index] = "";
        commit(next);
      } else if (index > 0) {
        next[index - 1] = "";
        commit(next);
        focusBox(index - 1);
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    // A pasted code is the whole code, wherever the caret happened to be.
    fillFrom(0, event.clipboardData.getData("text"));
  };

  return (
    <div role="group" aria-label="Verification code" className="flex gap-2 sm:gap-3">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          id={index === 0 ? id : undefined}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          // The first box is where iOS and Android offer the code they saw
          // arrive; the rest must not compete for that suggestion.
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`Verification code, digit ${index + 1} of ${length}`}
          aria-describedby={aria["aria-describedby"]}
          aria-invalid={aria["aria-invalid"]}
          value={digit}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          onChange={onBoxChange(index)}
          onKeyDown={onBoxKeyDown(index)}
          onPaste={onPaste}
          onFocus={(event) => event.target.select()}
          className={cn(
            "rounded-control bg-surface text-foreground h-13 min-w-0 flex-1 border text-center font-mono text-2xl font-medium tabular-nums",
            "transition-[border-color,box-shadow] duration-150 ease-out",
            "focus:border-primary focus:ring-primary/25 focus:ring-2 focus:outline-none",
            "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
            "border-border aria-invalid:border-destructive aria-invalid:focus:ring-destructive/25",
            digit ? "border-foreground/40" : "",
          )}
        />
      ))}
    </div>
  );
}
