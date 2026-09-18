"use client";

import { ArrowsClockwise, WarningOctagon } from "@phosphor-icons/react";
import { useEffect } from "react";

import { DocumentTitle } from "@/components/app/document-title";
import { Fallback } from "@/components/app/fallback";
import { Button, ButtonLink } from "@/components/ui/button";
import { site } from "@/lib/site";

/*
  A page that crashed while drawing, anywhere a nearer boundary did not catch
  it. Retry draws the page again, fetching what it needs afresh - most of
  these are a bad moment rather than a bad page. The digest is the id the
  server's log carries for the same failure; nothing else about the error is
  shown, because in production nothing else about it is safe to show.
*/
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // The browser console is where a developer looks; the digest ties it to the server's log.
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center px-5 py-10">
      <DocumentTitle title={`Something went wrong | ${site.name}`} />
      <Fallback
        icon={WarningOctagon}
        tone="attention"
        title="This page did not load"
        reference={error.digest}
        actions={
          <>
            <Button type="button" onClick={() => retry()}>
              <ArrowsClockwise size={16} weight="bold" aria-hidden="true" />
              Try again
            </Button>
            <ButtonLink href="/" variant="secondary" arrow={false}>
              Go to the home page
            </ButtonLink>
          </>
        }
      >
        Something went wrong while showing it. Trying again usually works; if it keeps happening,
        tell us the reference below.
      </Fallback>
    </main>
  );
}
