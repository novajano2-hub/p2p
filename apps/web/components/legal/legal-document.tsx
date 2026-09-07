import { Container } from "@/components/marketing/section";
import { StatusPill } from "@/components/ui/status-pill";

/*
  Layout for the legal pages. The text on them today is a labelled placeholder:
  it says what each section will cover and nothing more, because inventing
  terms that are not in force would be worse than an honest gap. The pill at
  the top stays until real wording replaces the placeholder.
*/
export type LegalSection = { heading: string; body: ReadonlyArray<string> };

type LegalDocumentProps = {
  title: string;
  intro: string;
  sections: ReadonlyArray<LegalSection>;
};

export function LegalDocument({ title, intro, sections }: LegalDocumentProps) {
  return (
    <Container className="py-14 sm:py-16 lg:py-20">
      <article className="max-w-2xl">
        <StatusPill status="pending">Placeholder, not yet in force</StatusPill>
        <h1 className="font-display text-foreground mt-5 text-3xl leading-tight text-balance sm:text-4xl">
          {title}
        </h1>
        <p className="text-muted-foreground mt-5 text-[15px] leading-relaxed text-pretty sm:text-base">
          {intro}
        </p>

        <div className="border-border mt-10 flex flex-col gap-8 border-t pt-8">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="font-display text-foreground text-lg leading-snug">
                {section.heading}
              </h2>
              {section.body.map((paragraph, index) => (
                <p
                  key={index}
                  className="text-muted-foreground mt-2 text-[15px] leading-relaxed text-pretty"
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </Container>
  );
}
