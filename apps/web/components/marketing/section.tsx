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
  align?: "left" | "center";
  className?: string;
};

/** Section headline, vertically stacked. Never split into a left/right header. */
export function SectionHeading({ title, lede, id, align = "left", className }: HeadingProps) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      <h2
        id={id}
        className="text-3xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-4xl lg:text-[2.75rem]"
      >
        {title}
      </h2>
      {lede ? (
        <p className="text-muted-foreground mt-4 text-lg leading-relaxed text-pretty">{lede}</p>
      ) : null}
    </div>
  );
}
