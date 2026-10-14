import { Math, type MathProps } from "./Math";

export interface MathTexProps {
  /** LaTeX source string. */
  tex: string;
  /** Render as centered block equation. */
  display?: boolean;
}

/**
 * Backward compatibility wrapper around `<Math>`.
 * Prefer `<M>formula</M>` or `<MathText>` in new code.
 */
export function MathTex({ tex, display = false }: MathTexProps) {
  return <Math tex={tex} display={display} />;
}
