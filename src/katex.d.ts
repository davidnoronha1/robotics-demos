declare module "katex/dist/contrib/auto-render.mjs" {
  export default function renderMathInElement(
    el: Element,
    options?: {
      delimiters?: Array<{ left: string; right: string; display: boolean }>;
      throwOnError?: boolean;
    },
  ): void;
}
