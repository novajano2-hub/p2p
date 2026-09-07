import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/marketing/section";
import { ButtonLink } from "@/components/ui/button";
import { cta } from "@/lib/site";

/*
  A quiet band rather than a slab of green: the sentence on the left, the
  action on the right, a hairline above and below. The button carries the
  colour, which is the only place it is needed.
*/
export function FinalCta() {
  return (
    <Section bare className="cta-surface border-border border-t">
      <div className="py-14 sm:py-16 lg:py-20">
        <Reveal>
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
            <div className="max-w-xl">
              <h2 className="font-display text-foreground text-2xl leading-[1.15] text-balance sm:text-3xl lg:text-[2.125rem]">
                Open an account.
              </h2>
              <p className="text-muted-foreground mt-4 max-w-[46ch] text-[15px] leading-relaxed text-pretty sm:text-base">
                Deposit USDT, pick an offer, and trade with escrow sitting between you and the other
                side.
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              <ButtonLink href={cta.signup.href} size="lg" className="group/btn">
                {cta.signup.label}
              </ButtonLink>
              <ButtonLink href={cta.login.href} variant="ghost" className="group/btn">
                {cta.login.label}
              </ButtonLink>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
