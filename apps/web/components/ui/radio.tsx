import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/*
  A radio drawn from our own tokens rather than by the operating system.

  `accent-color` on a native radio tints the dot and nothing else. The ring
  around it stays whatever the platform draws, which on a dark surface is a
  pale circle belonging to no theme here, and on iOS is a shape that ignores
  the border radius of everything beside it. So the real input stays in the
  page, visually hidden, doing the work for the keyboard and for assistive
  technology, and the control the eye sees is drawn beside it.

  The dot is one element rather than two. A checked radio is a filled circle
  with a ring of the surface colour punched out of its middle by an inset
  shadow; a nested second span would need a sibling selector that cannot
  reach it from the input.
*/

type RadioProps = Omit<ComponentPropsWithRef<"input">, "type" | "children"> & {
  label: ReactNode;
  description?: ReactNode;
  /** The right of the row: an arrival time, a fee, a status. */
  meta?: ReactNode;
};

export function Radio({
  label,
  description,
  meta,
  className,
  id: idProp,
  disabled,
  ...props
}: RadioProps) {
  const autoId = useId();
  const id = idProp ?? autoId;

  return (
    <label
      htmlFor={id}
      className={cn(
        "group rounded-control border-border bg-surface flex items-start gap-3 border px-4 py-3.5",
        "transition-[border-color,background-color,box-shadow] duration-150 ease-out",
        "has-checked:border-primary has-checked:bg-primary-soft",
        "has-focus-visible:ring-ring/40 has-focus-visible:ring-2",
        disabled ? "cursor-not-allowed opacity-55" : "hover:border-primary/40 cursor-pointer",
        className,
      )}
    >
      <input id={id} type="radio" disabled={disabled} className="sr-only" {...props} />
      <span
        aria-hidden="true"
        className={cn(
          "border-sage bg-surface mt-0.5 size-[18px] shrink-0 rounded-full border-2",
          "transition-[background-color,border-color,box-shadow] duration-150 ease-out",
          "group-has-checked:border-primary group-has-checked:bg-primary",
          "group-has-checked:shadow-[inset_0_0_0_4px_var(--color-surface)]",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-[15px] font-medium">{label}</span>
        {description ? (
          <span className="text-muted-foreground mt-0.5 block text-[13px] leading-relaxed">
            {description}
          </span>
        ) : null}
      </span>
      {meta ? (
        <span className="text-muted-foreground shrink-0 pt-0.5 text-right text-[13px] whitespace-nowrap">
          {meta}
        </span>
      ) : null}
    </label>
  );
}

/*
  The radios as one question. A fieldset and a legend rather than a div and a
  paragraph, so a screen reader announces what the options are for before it
  starts reading them out.
*/
export function RadioGroup({
  legend,
  hint,
  error,
  className,
  children,
}: {
  legend: string;
  hint?: string | undefined;
  error?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <fieldset className={cn("flex flex-col gap-2.5", className)}>
      <legend className="text-foreground mb-1 text-sm font-medium">{legend}</legend>
      {hint ? (
        <p className="text-muted-foreground -mt-1 mb-1 text-[13px] leading-relaxed">{hint}</p>
      ) : null}
      {children}
      {error ? (
        <p role="alert" className="text-destructive text-[13px] leading-relaxed">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
