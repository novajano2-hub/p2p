import { WarningCircle } from "@phosphor-icons/react/dist/ssr";

/** The inline error the flows show when a submission fails. Real error styling from the kit. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-control border-destructive/30 bg-status-attention text-status-attention-fg mb-5 flex items-start gap-2.5 border px-3.5 py-3 text-[13px] leading-relaxed"
    >
      <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
