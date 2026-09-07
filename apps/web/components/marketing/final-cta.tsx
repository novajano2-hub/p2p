import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/marketing/section";
import { ButtonLink } from "@/components/ui/button";
import { cta } from "@/lib/site";

export function FinalCta() {
  return (
    <Section bare className="pb-20 lg:pb-28">
      <Reveal>
        <div className="rounded-surface bg-primary text-primary-foreground px-6 py-14 sm:px-12 sm:py-16 lg:px-16 lg:py-20">
          <div className="max-w-2xl">
            <h2 className="font-display text-4xl leading-[1.08] text-balance sm:text-5xl lg:text-[3.4rem]">
              Open an account.
            </h2>
            <p className="text-primary-foreground/80 mt-5 max-w-[46ch] text-lg leading-relaxed text-pretty">
              Deposit USDT, pick an offer, and trade with escrow sitting between you and the other
              side.
            </p>
            <div className="mt-9">
              <ButtonLink href={cta.signup.href} variant="inverse" size="lg">
                {cta.signup.label}
              </ButtonLink>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
