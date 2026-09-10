import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import type { ComponentPropsWithRef } from "react";

import { cn } from "@/lib/cn";

export type SelectProps = ComponentPropsWithRef<"select">;

/*
  A real <select>. On a phone that means the operating system's own picker,
  which is faster to use and more accessible than anything hand-rolled; the
  only styling here makes it match the kit's text control. The caret is drawn
  separately because a native select's own arrow cannot be restyled.
*/
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(
          "rounded-control bg-surface text-foreground h-11 w-full appearance-none border pr-10 pl-3.5 text-[15px]",
          "transition-[border-color,box-shadow] duration-150 ease-out",
          "focus:border-primary focus:ring-primary/25 focus:ring-2 focus:outline-none",
          "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
          "border-border aria-invalid:border-destructive aria-invalid:focus:ring-destructive/25",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <CaretDown
        size={15}
        weight="bold"
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3.5 my-auto"
      />
    </div>
  );
}
