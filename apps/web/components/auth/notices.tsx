import { Info, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

/*
  The inline error the flows show when a submission fails. Real error styling
  from the kit. Takes `message` for the usual case, or children when the error
  has somewhere to send the person - "log in instead", say.
*/
/**
 * Something the person should know before they start - why they are being
 * asked to sign in again, say. Not an error: nothing they did went wrong.
 */
export function FormNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-control bg-primary-soft text-primary-soft-foreground mb-5 flex items-start gap-2.5 px-3.5 py-3 text-[13px] leading-relaxed"
    >
      <Info size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

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
