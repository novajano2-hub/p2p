import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/marketing/section";

/** One sentence, set large. The rule the whole product is built around. */
export function Statement() {
  return (
    <Section bare className="border-border border-t py-20 sm:py-24 lg:py-28">
      <Reveal>
        <p className="font-display text-foreground max-w-4xl text-3xl leading-[1.18] text-balance sm:text-4xl lg:text-[3.25rem] lg:leading-[1.14]">
          The USDT is locked before any birr moves, and it is released only by the person who was
          paid. Not by a timer, not by a screenshot, and never by the buyer.
        </p>
      </Reveal>
    </Section>
  );
}
