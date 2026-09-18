import { toast } from "@/lib/toast";

/*
  After a submit that could not go: bring the first problem into view, put the
  cursor in it, and say what it is where the person is looking. On a phone that
  is the button at the bottom of a long form, a long way from the field that
  needs fixing - which is how a person ends up pressing a button that seems to
  do nothing.

  The problems are read off the page, not out of a form library's state. The
  order a person reads a form in is the page's order, and every field that can
  be wrong marks itself the same way whoever checked it: aria-invalid on a
  control, data-invalid on a group of them (a set of checkboxes has no one
  control to mark), with the sentence in the element aria-describedby names,
  or in a role="alert" inside the group.

  A form hands over its own element, held in state through a callback ref
  (ref={setFormElement}) rather than in a ref object: the submit handler is
  built during render, and nothing built during render may read a ref.
*/

const INVALID = '[aria-invalid="true"], [data-invalid="true"]';
const FOCUSABLE =
  'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), a[href]';

/** One toast for a form's problems, replaced by the next attempt rather than stacked under it. */
const TOAST_ID = "form-problems";

export function revealProblems(container: HTMLElement | null | undefined): void {
  // The errors are drawn by the render the failed submit causes: look after it.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!container) return;
      const marked = Array.from(container.querySelectorAll<HTMLElement>(INVALID));
      // A control inside a marked group is the group's problem, not a second one.
      const problems = marked.filter(
        (element) => !marked.some((other) => other !== element && other.contains(element)),
      );
      const first = problems[0];
      if (!first) return;

      const more = problems.length - 1;
      toast.error(sentenceFor(first) ?? "Check the highlighted field.", {
        id: TOAST_ID,
        description:
          more === 0
            ? undefined
            : more === 1
              ? "One more field needs a look too."
              : `${more} more fields need a look too.`,
      });

      // The middle of the screen clears both the sticky header and the tab bar.
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      first.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
      const target = first.matches(FOCUSABLE) ? first : first.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus({ preventScroll: true });
    });
  });
}

/**
 * A refusal from the server that names one of the form's own fields - "That
 * password is not right." - is shown on that field, like any other problem
 * with it, and brought into view the same way. True when it was; false leaves
 * it to the caller to say another way.
 *
 * `fields` maps the request's field names to the form's, where they differ.
 */
export function placeOnField<F extends string>(
  failure: { code: string; message: string; field?: string | undefined },
  fields: Readonly<Record<string, F>>,
  setError: (field: F, error: { type: string; message: string }) => void,
  container: HTMLElement | null | undefined,
): boolean {
  if (failure.code !== "VALIDATION" || !failure.field) return false;
  const field = Object.hasOwn(fields, failure.field) ? fields[failure.field] : undefined;
  if (!field) return false;
  setError(field, { type: "server", message: failure.message });
  revealProblems(container);
  return true;
}

function sentenceFor(element: HTMLElement): string | null {
  for (const id of (element.getAttribute("aria-describedby") ?? "").split(/\s+/)) {
    const text = id ? document.getElementById(id)?.textContent?.trim() : "";
    if (text) return text;
  }
  return element.querySelector('[role="alert"]')?.textContent?.trim() || null;
}
