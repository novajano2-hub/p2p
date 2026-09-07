import type { Metadata } from "next";

import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Service" };

/*
  PLACEHOLDER. Each section states what it will cover once legal wording
  exists. None of this is in force and none of it should be quoted as a term.
*/
const sections: ReadonlyArray<LegalSection> = [
  {
    heading: "Who can open an account",
    body: [
      "This section will set out who is eligible to use the platform, including minimum age, residency, and the identity checks that may be required before trading or withdrawing.",
    ],
  },
  {
    heading: "Your account",
    body: [
      "This section will describe your responsibility for the credentials and security settings on your account, and when the platform may restrict or close it.",
    ],
  },
  {
    heading: "Trades and escrow",
    body: [
      "This section will explain how a trade works: that the seller's USDT is held by the platform from the moment a trade starts, that birr is paid between the two parties outside the platform, and that USDT is released only when the seller confirms payment or a dispute is resolved.",
    ],
  },
  {
    heading: "Fees",
    body: [
      "This section will state the platform's fees. At launch the platform charges no fee on trades, deposits or withdrawals; network or third-party fees may still apply and are shown before you confirm.",
    ],
  },
  {
    heading: "What you may not do",
    body: [
      "This section will list prohibited uses, including trading on behalf of others without disclosure, attempting to reverse a birr payment after release, and any use that breaks the law of your jurisdiction.",
    ],
  },
  {
    heading: "Disputes",
    body: [
      "This section will describe how a dispute is opened, what evidence each side can submit, how a reviewer decides, and what happens to the USDT held in escrow while a dispute is open.",
    ],
  },
  {
    heading: "Liability",
    body: [
      "This section will set out the limits of the platform's liability, including for delays or losses caused by the networks and third parties the platform relies on.",
    ],
  },
  {
    heading: "Changes to these terms",
    body: [
      "This section will explain how and when these terms may change, and how you will be told.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      intro={`The agreement between you and ${site.name}. This page is a labelled placeholder: it describes what each section will cover so the structure can be reviewed before the wording is written.`}
      sections={sections}
    />
  );
}
