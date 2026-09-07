import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/marketing/section";
import { ButtonLink } from "@/components/ui/button";
import { cta } from "@/lib/site";

export function FinalCta() {
  return (
    <Section bare className="pb-20 lg:pb-28">
      <Reveal>
        <div className="rounded-panel bg-primary text-primary-foreground px-6 py-14 sm:px-12 sm:py-16 lg:px-16 lg:py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-4xl lg:text-[2.75rem]">
              Create your account.
            </h2>
            <p className="text-primary-foreground/85 mt-4 max-w-[46ch] text-lg leading-relaxed text-pretty">
              Deposit USDT, pick an offer, and trade with escrow holding the line at every step.
            </p>
            <div className="mt-8">
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
