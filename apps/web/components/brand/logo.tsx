import { cn } from "@/lib/cn";

/*
  The BIRQ mark and wordmark, from the brand kit (Concept 02 / Exchange).

  Both are the kit's own outlined paths, not a redraw: the four pieces of the
  symbol and the lettering, so no font is loaded for the wordmark and the
  geometry is the designer's. Colours come from tokens rather than literals so
  one set of paths gives the light version (charcoal and lime) and the dark
  version (all lime, off-white lettering) as the theme changes, which is how
  the kit specifies the two.

  The kit's SVG files are in public/brand/ for anything that needs a plain
  image: email, social cards, a favicon.
*/

/** Top-left, top-right, bottom-left, bottom-right. */
const SYMBOL = [
  {
    d: "M12 10H54C84 10 108 33 108 64V160L52 144C25 136 12 116 12 88V10Z",
    fill: "var(--brand-mark)",
  },
  {
    d: "M128 10H162C196 10 224 36 224 68C224 100 198 128 166 128H161C140 128 128 115 128 94V10Z",
    fill: "var(--brand-leaf)",
  },
  {
    d: "M12 160L72 176C96 182 108 199 108 223V278H57C31 278 12 258 12 230V160Z",
    fill: "var(--brand-leaf)",
  },
  {
    d: "M128 139L187 152C222 158 248 181 248 214C248 249 222 278 184 278H128V139Z",
    fill: "var(--brand-mark)",
  },
] as const;

/** B, I, R, Q. */
const LETTERS = [
  "M0 0H39C57 0 67 7 67 19C67 26 64 31 58 34C65 37 69 42 69 49C69 60 59 66 41 66H0V0ZM20 15V26H38C43 26 47 24 47 20.5C47 17 43 15 38 15H20ZM20 40V52H39C45 52 49 50 49 46C49 42 45 40 39 40H20Z",
  "M77 0H97V66H77V0Z",
  "M108 0H143C160 0 171 9 171 23C171 33 165 40 155 43L174 66H150L134 43H128V66H108V0ZM128 15V31H141C148 31 152 28 152 23C152 18 148 15 141 15H128Z",
  "M207 0H223C242 0 253 11 253 28V44C253 49 252 54 249 58L261 74H238L231 64C228 65 224 66 220 66H207C188 66 177 55 177 38V28C177 11 188 0 207 0ZM209 16C202 16 198 20 198 26V40C198 47 202 50 209 50H219L210 39V36H225L231 43V26C231 20 227 16 220 16H209Z",
] as const;

type BrandProps = {
  className?: string | undefined;
  /** Give it a name when it stands alone; inside a labelled link it is decoration. */
  title?: string | undefined;
};

function Symbol() {
  return (
    <>
      {SYMBOL.map((piece) => (
        <path key={piece.d} d={piece.d} fill={piece.fill} />
      ))}
    </>
  );
}

/** The four-part symbol on its own. Square. */
export function LogoMark({ className, title }: BrandProps) {
  return (
    <svg
      viewBox="0 0 288 288"
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
    >
      {title ? <title>{title}</title> : null}
      <g transform="translate(16 0)">
        <Symbol />
      </g>
    </svg>
  );
}

/** The horizontal lockup, symbol then wordmark: what headers use. 11:4. */
export function Logo({ className, title }: BrandProps) {
  return (
    <svg
      viewBox="0 0 440 160"
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn("h-7 w-auto shrink-0", className)}
    >
      {title ? <title>{title}</title> : null}
      <g transform="translate(0 8) scale(0.5)">
        <Symbol />
      </g>
      <g
        transform="translate(160 43)"
        fill="var(--brand-wordmark)"
        fillRule="evenodd"
        clipRule="evenodd"
      >
        {LETTERS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
