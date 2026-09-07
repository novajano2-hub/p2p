import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/marketing/section";

/** One sentence. The rule the whole product is built around. */
export function Statement() {
  return (
    <Section bare className="border-border border-t py-16 sm:py-20">
      <Reveal>
        <p className="font-display text-foreground max-w-3xl text-xl leading-[1.35] text-balance sm:text-2xl lg:text-[1.75rem]">
          The USDT is locked before any birr moves, and it is released only by the person who was
          paid. Not by a timer, not by a screenshot, and never by the buyer.
        </p>
      </Reveal>
    </Section>
  );
}
