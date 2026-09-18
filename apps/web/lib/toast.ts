import { toast as sonner } from "sonner";

/*
  What the app says after something happens: an action that worked, an action
  the server refused, a form that cannot be sent yet, news from the socket.
  One vocabulary over sonner, so every toast has the same timings and the same
  shape, and nothing else imports sonner (eslint holds that line).

  A toast is the event, not the record. It fades; anything a person may need
  to read again - a refusal beside the button that caused it, a field's own
  error - stays on the page as well.
*/

/** A confirmation is read at a glance. Paused while the pointer rests on it or the tab is hidden. */
const DONE_MS = 4_000;
/** A refusal, or news from somebody else, is read slowly and may need acting on. */
const READ_MS = 8_000;

export type ToastAction = { label: string; onClick: () => void };

export type ToastOptions = {
  description?: string | undefined;
  action?: ToastAction | undefined;
  /** A toast with the same id replaces the one showing, rather than stacking a second. */
  id?: string | undefined;
  /**
   * The notification this toast already says, as notificationKey() names it.
   * The same news arriving over the socket a moment later is then not said twice.
   */
  covers?: string | undefined;
};

function settings(options: ToastOptions | undefined, duration: number) {
  if (options?.covers) remember(options.covers);
  return {
    duration,
    ...(options?.description ? { description: options.description } : {}),
    ...(options?.action ? { action: options.action } : {}),
    ...(options?.id ? { id: options.id } : {}),
  };
}

export const toast = {
  /** Something the person did, done. */
  success: (title: string, options?: ToastOptions) =>
    sonner.success(title, settings(options, DONE_MS)),
  /** Something that did not happen, and why. */
  error: (title: string, options?: ToastOptions) => sonner.error(title, settings(options, READ_MS)),
  /** News that asks for care: a dispute, a trade that ran out of time. */
  warning: (title: string, options?: ToastOptions) =>
    sonner.warning(title, settings(options, READ_MS)),
  /** News, neither good nor bad. */
  info: (title: string, options?: ToastOptions) => sonner.info(title, settings(options, READ_MS)),
  /**
   * News from somebody else, drawn by its tone. Always read slowly - nobody was
   * expecting it, and it usually offers somewhere to go - even good news, which
   * a confirmation of the person's own action says in half the time.
   */
  news: (tone: "good" | "warn" | "note", title: string, options?: ToastOptions) =>
    (tone === "good" ? sonner.success : tone === "warn" ? sonner.warning : sonner.info)(
      title,
      settings(options, READ_MS),
    ),
  dismiss: (id?: string) => sonner.dismiss(id),
};

/** A refusal as the API gave it: its sentence, and the reference when the fault was the server's. */
export type Refusal = { message: string; reference?: string | undefined };

/**
 * A refusal from the API, in the server's own words - they are written to be
 * shown - with the reference a support request can quote when the fault was
 * on the server's side.
 */
export function toastFailure(failure: Refusal, options?: ToastOptions) {
  return toast.error(failure.message, {
    ...options,
    description:
      options?.description ?? (failure.reference ? `Reference: ${failure.reference}` : undefined),
  });
}

/* ------------------------------------------------ said once, not twice */

/*
  A few notifications tell the person about their own action: the seller who
  releases is also sent "USDT sent", for their other devices and their inbox.
  This tab already said so when the release came back, so the copy that comes
  over the socket is dropped - here, in this tab only; every other tab still
  shows it.
*/

/** Long enough for the socket's copy to arrive over a slow connection; short enough to forget. */
const COVERS_MS = 60_000;
const said = new Map<string, number>();

/** How a notification is named for the purpose above: its type and where it points. */
export const notificationKey = (type: string, link: string | null | undefined): string =>
  `${type} ${link ?? ""}`;

function remember(key: string): void {
  said.set(key, Date.now());
}

/** Whether this tab has just said this itself. Asking forgets it: the next one is news again. */
export function alreadySaid(key: string, now: number = Date.now()): boolean {
  const at = said.get(key);
  if (at === undefined) return false;
  said.delete(key);
  return now - at < COVERS_MS;
}
