import { Info, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { authClient } from "@/lib/auth/client";

/** Shown only while the auth client is the preview. Disappears on its own in Phase 1. */
export function PreviewNotice() {
  if (authClient.mode !== "preview") return null;
  return (
    <p className="rounded-control bg-status-pending text-status-pending-fg mb-5 flex items-start gap-2.5 px-3.5 py-3 text-[13px] leading-relaxed">
      <Info size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        Preview. Accounts are not connected yet: every step can be walked, and nothing is saved.
      </span>
    </p>
  );
}

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
