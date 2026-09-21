/*
  "The API answered." Said by the request helper whenever any response comes
  back, whatever its status, and heard by whatever is waiting for the server
  to return - today the live connection, which otherwise sits out the rest of
  a backoff it earned while the server was away, with "Reconnecting" on the
  screen for up to half a minute after everything else works again.

  Deliberately not heard by screens that retry a failed load: their retry is
  itself a request, so an answer that was another failure would set off the
  next retry, and that one the next.
*/

const listeners = new Set<() => void>();

/** Hears that the API answered. Returns the way to stop hearing. */
export function onServerAnswered(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function serverAnswered(): void {
  for (const listener of listeners) listener();
}
