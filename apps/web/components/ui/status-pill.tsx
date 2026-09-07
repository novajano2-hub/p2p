import { CheckCircle, Circle, Clock, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

export type StatusTone = "complete" | "pending" | "attention" | "neutral";

const tone: Record<StatusTone, { classes: string; Icon: typeof CheckCircle }> = {
  complete: { classes: "bg-status-complete text-status-complete-fg", Icon: CheckCircle },
  pending: { classes: "bg-status-pending text-status-pending-fg", Icon: Clock },
  attention: { classes: "bg-status-attention text-status-attention-fg", Icon: WarningCircle },
  neutral: { classes: "bg-status-neutral text-status-neutral-fg", Icon: Circle },
};

type StatusPillProps = ComponentPropsWithoutRef<"span"> & { status: StatusTone };

/** The kit's status pill: tinted surface, filled glyph, 13px label. */
export function StatusPill({ status, className, children, ...props }: StatusPillProps) {
  const { classes, Icon } = tone[status];
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap",
        classes,
        className,
      )}
      {...props}
    >
      <Icon size={14} weight="fill" aria-hidden="true" />
      {children}
    </span>
  );
}
