import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { site } from "@/lib/site";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

import "./globals.css";

/*
  IBM Plex Sans carries the whole page. It is the open-source typeface that
  Binance's proprietary BinancePlex is derived from, and the closest thing to
  it anyone else can legally ship. Plex Mono is reserved for ledger figures.
*/
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${site.name}: ${site.tagline}`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
};

/*
  With no saved preference the page follows the operating system. A signed-in
  customer can pin light or dark (Settings, or the account menu); the choice
  is saved in the browser and applied as `data-theme` on <html> by the boot
  script below, before anything paints, so it holds on every page including
  this landing page.
*/
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#121614" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang={site.locale}
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      // The boot script sets data-theme before React hydrates; without this,
      // React would report the attribute as a mismatch and re-render it away.
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col font-sans">
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
