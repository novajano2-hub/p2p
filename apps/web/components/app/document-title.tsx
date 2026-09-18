"use client";

import { useEffect } from "react";

/*
  The tab's title for a screen the page's metadata cannot name: a not-found or
  error boundary drawn in the browser, over a page whose metadata already
  titled the tab ("Order | BIRQ" above an order that is not there).

  A <title> element does not do it. React puts it in the head after the one
  the metadata wrote, and the browser reads the first.

  The page's own title comes back when the boundary goes - but only if the
  tab still carries this one. A navigation that brought its own title
  already put it there, and is left alone.
*/
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => {
      if (document.title === title) document.title = before;
    };
  }, [title]);
  return null;
}
