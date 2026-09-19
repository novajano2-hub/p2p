import { z } from "zod";

import { adFields, type AdForm } from "./forms";

/*
  The ad a person was writing when they went to add a payment method.

  "Add a payment method", in the second step of posting an ad, leaves the
  form for the payment methods page, which comes back once the method is in
  (lib/next-path.ts). The form lives in React state, so without this the
  price, the amounts and the step would all be lost on the way. The tab's
  session storage carries them - this tab only, for half an hour - and the
  form takes them back once, on its return.

  With storage off (a private window, site data blocked) nothing is kept, and
  the form starts again, as it always did.
*/
const KEEP_KEY = "birq.ad-draft";
const KEEP_MS = 30 * 60_000;

export interface KeptDraft {
  /** Whose form it is: "new", or the id of the ad being changed. */
  ad: string;
  step: number;
  values: AdForm;
  /** The payment methods there were on leaving, so the one added meanwhile can be told apart. */
  methodIds: string[];
}

const kept = z.object({
  ad: z.string(),
  at: z.number(),
  step: z.number().int().min(0),
  values: adFields,
  methodIds: z.array(z.string()),
});

export function keepDraft(draft: KeptDraft): void {
  try {
    window.sessionStorage.setItem(KEEP_KEY, JSON.stringify({ ...draft, at: Date.now() }));
  } catch {
    // Storage off: the form starts again, as it did before there was this.
  }
}

/** The draft kept for this form, once: reading it forgets it. */
export function takeDraft(ad: string, now: number = Date.now()): KeptDraft | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(KEEP_KEY);
    window.sessionStorage.removeItem(KEEP_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = kept.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.ad !== ad || now - parsed.data.at > KEEP_MS) return null;
    const { step, values, methodIds } = parsed.data;
    return { ad, step, values, methodIds };
  } catch {
    return null;
  }
}

/**
 * The ad's payment methods on its return: those it had, and the one just
 * added - which is what the person left to do - while there is room for it.
 */
export function withAdded(draft: KeptDraft, methods: readonly string[], most: number): string[] {
  const chosen = draft.values.methodIds;
  const before = new Set(draft.methodIds);
  const added = methods.filter((id) => !before.has(id));
  return [...chosen, ...added.slice(0, Math.max(0, most - chosen.length))];
}
