"use client";

import { ArrowsClockwise, WarningOctagon } from "@phosphor-icons/react";
import { useEffect } from "react";

import { DocumentTitle } from "@/components/app/document-title";
import { Fallback } from "@/components/app/fallback";
import { Button, ButtonLink } from "@/components/ui/button";
import { site } from "@/lib/site";

/*
  An admin page that crashed while drawing. Deliberately without the admin
  shell around it: the shell may be what failed, and drawing it again here
  would fail the same way. Nothing an administrator decides is lost to this -
  a decision is a request that either reached the server or did not.
*/
export default function AdminError({
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
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-10">
      <DocumentTitle title={`Something went wrong | ${site.name} administration`} />
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
            <ButtonLink href="/admin" variant="secondary" arrow={false}>
              Back to the queues
            </ButtonLink>
          </>
        }
      >
        Something went wrong while showing it. Trying again usually works; if it keeps happening,
        send the reference below to whoever runs the platform.
      </Fallback>
    </main>
  );
}
