import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/*
  The kit's "02 / Fields": label above, control, then one line below that is
  either a hint or an error, never both. The render prop hands the control the
  ids it needs so label, hint and error are wired for assistive tech without
  the caller repeating them.
*/

type ControlProps = {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
};

type FieldProps = {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  className?: string;
  children: (control: ControlProps) => ReactNode;
};

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-foreground text-sm font-medium">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-[13px] leading-relaxed">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-muted-foreground text-[13px] leading-relaxed">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export type InputProps = ComponentPropsWithRef<"input">;

/** Text control in the kit's four states: default, focus, error, disabled. */
export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "rounded-control bg-surface text-foreground h-11 w-full border px-3.5 text-[15px]",
        "placeholder:text-muted-foreground/70",
        "transition-[border-color,box-shadow] duration-150 ease-out",
        "focus:border-primary focus:ring-primary/25 focus:ring-2 focus:outline-none",
        "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
        "border-border aria-invalid:border-destructive aria-invalid:focus:ring-destructive/25",
        className,
      )}
      {...props}
    />
  );
}

export type TextareaProps = ComponentPropsWithRef<"textarea">;

/** The same control, for the few places a sentence is wanted rather than a word. */
export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "rounded-control bg-surface text-foreground w-full resize-y border px-3.5 py-2.5 text-[15px] leading-relaxed",
        "placeholder:text-muted-foreground/70",
        "transition-[border-color,box-shadow] duration-150 ease-out",
        "focus:border-primary focus:ring-primary/25 focus:ring-2 focus:outline-none",
        "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
        "border-border aria-invalid:border-destructive aria-invalid:focus:ring-destructive/25",
        className,
      )}
      {...props}
    />
  );
}
