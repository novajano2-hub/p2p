import { TradePreview } from "@/components/marketing/trade-preview";
import { Container } from "@/components/marketing/section";
import { ButtonLink } from "@/components/ui/button";
import { cta, site } from "@/lib/site";

/*
  Entrance: each block fades and rises 12px on first paint, cascaded 80ms
  apart, via the CSS starting-style transition. Purpose is hierarchy: the
  headline lands first, then the explanation, then the actions. No JS, and
  motion-reduce removes it entirely.
*/
const enter =
  "transition-[opacity,translate] duration-700 ease-out starting:translate-y-3 starting:opacity-0 motion-reduce:transition-none";

export function Hero() {
  return (
    <Container className="pt-14 pb-20 sm:pt-20 lg:pt-24 lg:pb-28">
      <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-7">
          <h1
            className={`${enter} max-w-[24ch] text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.25rem]`}
          >
            {site.tagline}
          </h1>
          <p
            className={`${enter} text-muted-foreground mt-6 max-w-[42ch] text-lg leading-relaxed text-pretty delay-100 sm:text-xl`}
          >
            Your USDT stays locked until you confirm the birr arrived. No platform fee on trades.
          </p>
          <div className={`${enter} mt-9 flex flex-col gap-3 delay-200 sm:flex-row`}>
            <ButtonLink href={cta.signup.href} size="lg">
              {cta.signup.label}
            </ButtonLink>
            <ButtonLink href={cta.learn.href} variant="secondary" size="lg">
              {cta.learn.label}
            </ButtonLink>
          </div>
        </div>

        <div className={`${enter} delay-150 lg:col-span-5`}>
          <TradePreview />
        </div>
      </div>
    </Container>
  );
}
