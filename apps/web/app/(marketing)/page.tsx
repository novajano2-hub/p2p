import { Faq } from "@/components/marketing/faq";
import { Fees } from "@/components/marketing/fees";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { LedgerProof } from "@/components/marketing/ledger-proof";
import { Statement } from "@/components/marketing/statement";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Statement />
      <HowItWorks />
      <Fees />
      <LedgerProof />
      <Faq />
      <FinalCta />
    </>
  );
}
