"use client";

import { ArrowsClockwise, WarningOctagon } from "@phosphor-icons/react";
import { useEffect } from "react";

import { DocumentTitle } from "@/components/app/document-title";
import { Fallback } from "@/components/app/fallback";
import { Button, ButtonLink } from "@/components/ui/button";
import { afterAuth, site } from "@/lib/site";

/*
  A signed-in page that crashed while drawing. It renders inside the app's own
  frame - the header, the tab bar, the session - so the person is still
  somewhere they recognise, with the page they asked for one press away.
*/
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
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
            <ButtonLink href={afterAuth} variant="secondary" arrow={false}>
              Go to your home
            </ButtonLink>
          </>
        }
      >
        Something went wrong while showing it. Trying again usually works; if it keeps happening,
        tell us the reference below.
      </Fallback>
    </>
  );
}
