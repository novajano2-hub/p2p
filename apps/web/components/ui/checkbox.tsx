import { Check } from "@phosphor-icons/react/dist/ssr";
import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/*
  Drawn from our own tokens, for the same reason as the radio beside it:
  `accent-color` tints a native tick and leaves the box the platform's own,
  which on a dark surface is a pale square that matches nothing else here.
  The real input stays in the page, visually hidden, so the keyboard and
  assistive technology are unaffected.

  The label may contain links: the HTML spec skips label activation when the
  click lands on interactive content, so clicking "Terms" follows the link
  without toggling the box.
*/
type CheckboxProps = Omit<ComponentPropsWithRef<"input">, "type" | "children"> & {
  label: ReactNode;
  error?: string | undefined;
};

export function Checkbox({ label, error, className, id: idProp, ...props }: CheckboxProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errorId = `${id}-error`;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label
        htmlFor={id}
        className="group text-muted-foreground flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed"
      >
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="sr-only"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            "border-sage bg-surface mt-px flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-2",
            "transition-[background-color,border-color] duration-150 ease-out",
            "group-has-checked:border-primary group-has-checked:bg-primary",
            "group-has-focus-visible:ring-ring/40 group-has-focus-visible:ring-2",
            "group-has-[:invalid]:border-destructive",
          )}
        >
          <Check
            size={12}
            weight="bold"
            className="text-primary-foreground opacity-0 transition-opacity duration-150 ease-out group-has-checked:opacity-100"
          />
        </span>
        <span>{label}</span>
      </label>
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-[13px] leading-relaxed">
          {error}
        </p>
      ) : null}
    </div>
  );
}
