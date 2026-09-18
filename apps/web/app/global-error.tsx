"use client";

import { ArrowsClockwise, WarningOctagon } from "@phosphor-icons/react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { Fallback } from "@/components/app/fallback";
import { Button, buttonClasses } from "@/components/ui/button";
import { site } from "@/lib/site";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

import "./globals.css";

/*
  The last boundary: the root layout itself failed. This replaces the whole
  document, so it brings everything the layout would have - the stylesheet,
  the typeface, and the saved theme, applied before paint as the layout does
  - or it would be the one page on the site in the wrong colours.

  The way home is a plain link, a full load: whatever broke the layout may
  still be sitting in the client's state.
*/

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html
      lang={site.locale}
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col font-sans">
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <title>{`Something went wrong | ${site.name}`}</title>
        <main className="flex flex-1 flex-col items-center justify-center px-5 py-10">
          <Fallback
            icon={WarningOctagon}
            tone="attention"
            title={`${site.name} did not load`}
            reference={error.digest}
            actions={
              <>
                <Button type="button" onClick={() => retry()}>
                  <ArrowsClockwise size={16} weight="bold" aria-hidden="true" />
                  Try again
                </Button>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load on purpose: whatever broke the layout may still be in the client */}
                <a href="/" className={buttonClasses({ variant: "secondary" })}>
                  Go to the home page
                </a>
              </>
            }
          >
            Something went wrong before the page could be drawn. Trying again usually works; if it
            keeps happening, tell us the reference below.
          </Fallback>
        </main>
      </body>
    </html>
  );
}
