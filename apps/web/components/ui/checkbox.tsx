import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

type CheckboxProps = ComponentPropsWithRef<"input"> & {
  label: ReactNode;
  error?: string | undefined;
};

/*
  Native checkbox coloured with the accent. The label may contain links: the
  HTML spec skips label activation when the click lands on interactive content,
  so clicking "Terms" follows the link without toggling the box.
*/
export function Checkbox({ label, error, className, id: idProp, ...props }: CheckboxProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errorId = `${id}-error`;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label
        htmlFor={id}
        className="text-muted-foreground flex items-start gap-2.5 text-[13px] leading-relaxed"
      >
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="accent-primary border-border mt-0.5 size-4 shrink-0 rounded-[3px]"
          {...props}
        />
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
