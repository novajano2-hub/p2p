import type { Metadata } from "next";

import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy" };

/*
  PLACEHOLDER. Each section states what it will cover once the policy is
  written against the data the platform actually holds. Not in force.
*/
const sections: ReadonlyArray<LegalSection> = [
  {
    heading: "What we collect",
    body: [
      "This section will list the information the platform holds: your email and login details, the payment instructions you choose to share with a trade counterparty, your trade and transaction history, and the technical data needed to keep the service secure.",
    ],
  },
  {
    heading: "Why we collect it",
    body: [
      "This section will explain each purpose: operating your account, running trades and escrow, preventing fraud and abuse, resolving disputes, and meeting any legal obligations that apply.",
    ],
  },
  {
    heading: "Who we share it with",
    body: [
      "This section will name the categories of third parties that may process your data, such as the email provider, the custody provider that holds USDT, and the storage provider for dispute evidence, and the safeguards in place with each.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      "This section will set out retention periods, including why financial records are kept longer than other data and what is deleted when an account closes.",
    ],
  },
  {
    heading: "Your choices",
    body: [
      "This section will describe how to view, correct or export your data, how to close your account, and how to raise a complaint.",
    ],
  },
  {
    heading: "Security",
    body: [
      "This section will summarise how data is protected in transit and at rest, including that payment instructions are encrypted and that private keys for USDT are never held on the platform's own servers.",
    ],
  },
  {
    heading: "Contact",
    body: ["This section will give the address to write to with a privacy question or request."],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      intro={`How ${site.name} handles your information. This page is a labelled placeholder: it describes what each section will cover so the structure can be reviewed before the wording is written.`}
      sections={sections}
    />
  );
}
