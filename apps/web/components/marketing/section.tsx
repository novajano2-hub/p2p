import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

type SectionProps = ComponentPropsWithoutRef<"section"> & {
  /** Remove the default vertical rhythm, for sections that manage their own. */
  bare?: boolean;
};

/**
 * Page section with the site's vertical rhythm and horizontal container.
 * Every marketing section goes through this so spacing stays identical.
 */
export function Section({ bare = false, className, children, ...props }: SectionProps) {
  return (
    <section className={cn(!bare && "py-20 sm:py-24 lg:py-32", className)} {...props}>
      <Container>{children}</Container>
    </section>
  );
}

export function Container({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)} {...props} />;
}

type HeadingProps = {
  title: string;
  lede?: string;
  id?: string;
  className?: string;
};

/** Section headline in the display serif, stacked. Never split left/right. */
export function SectionHeading({ title, lede, id, className }: HeadingProps) {
  return (
    <div className={cn("max-w-2xl", className)}>
      <h2
        id={id}
        className="font-display text-foreground text-4xl leading-[1.08] text-balance sm:text-5xl lg:text-[3.4rem]"
      >
        {title}
      </h2>
      {lede ? (
        <p className="text-muted-foreground mt-5 max-w-[56ch] text-lg leading-relaxed text-pretty">
          {lede}
        </p>
      ) : null}
    </div>
  );
}
