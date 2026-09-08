import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

/*
  The inline error the flows show when a submission fails. Real error styling
  from the kit. Takes `message` for the usual case, or children when the error
  has somewhere to send the person - "log in instead", say.
*/
export function FormError({
  message,
  children,
}: {
  message?: string | null | undefined;
  children?: ReactNode | undefined;
}) {
  const content = children ?? message;
  if (!content) return null;
  return (
    <div
      role="alert"
      className="rounded-control border-destructive/30 bg-status-attention text-status-attention-fg mb-5 flex items-start gap-2.5 border px-3.5 py-3 text-[13px] leading-relaxed"
    >
      <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>{content}</p>
    </div>
  );
}
