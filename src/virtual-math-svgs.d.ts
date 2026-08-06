declare module "virtual:math-svgs" {
  /** Map of `"i"|"d" \u0000 <latex>` → pre-rendered inline SVG markup. */
  export const mathSvgs: Record<string, string>;
}