import { AppLink } from "@/components/ui/app-link";

import { Logo } from "@/components/brand/logo";
import { Container } from "@/components/marketing/section";
import { nav, site } from "@/lib/site";

const legal = [
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
] as const;

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-border border-t">
      <Container className="py-12 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <Logo />
            <p className="text-muted-foreground mt-4 max-w-sm text-[15px] leading-relaxed">
              A peer-to-peer marketplace for USDT and Ethiopian birr. The USDT is held in escrow;
              the birr goes straight to the other person.
            </p>
          </div>

          <FooterGroup title="Product" links={nav} className="lg:col-span-3" />
          <FooterGroup title="Legal" links={legal} className="lg:col-span-3" />
        </div>

        <div className="border-border text-muted-foreground mt-12 flex flex-col gap-2 border-t pt-6 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {year} {site.name}.{site.isPlaceholderBrand ? " Placeholder brand name." : ""}
          </p>
          <p>USDT deposits and withdrawals use one network at launch. Check it before sending.</p>
        </div>
      </Container>
    </footer>
  );
}

type FooterGroupProps = {
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
  className?: string;
};

function FooterGroup({ title, links, className }: FooterGroupProps) {
  return (
    <div className={className}>
      <h2 className="text-foreground text-sm font-medium">{title}</h2>
      <ul className="mt-4 flex flex-col gap-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <AppLink
              href={link.href}
              className="text-muted-foreground hover:text-foreground text-[15px] transition-colors duration-150"
            >
              {link.label}
            </AppLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
