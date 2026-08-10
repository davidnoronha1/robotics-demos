/** Generic params-block editing shared by the editable-code demos. Each
 * editable template ships a `const params = { ... }` block that sliders can
 * rewrite, or the user can edit by hand. This module parses and rewrites that
 * block without understanding the surrounding code. */

export type ParamsMap = Record<string, unknown>;

/**
 * Finds the `const params = { ... }` block by counting braces from the first
 * match of the marker. Doesn't understand string/template literals — a param
 * value containing a literal `{` or `}` (e.g. `note: "a { b"`) would miscount
 * and return the wrong end index. Not a concern for the numeric/boolean/array
 * params this feature actually supports, but worth knowing before extending
 * with free-form string values.
 */
function findParamsBlock(src: string): { start: number; end: number; body: string } | null {
  // Must include "const " itself: `start` marks where injectParams() begins
  // its replacement, and formatParamsBlock() below re-emits "const params = "
  // as part of its output — if `start` pointed at "params" instead, the
  // original "const " prefix would survive the slice and get duplicated.
  const marker = "const params = {";
  const idx = src.indexOf(marker);
  if (idx < 0) return null;
  let depth = 0;
  for (let i = idx + marker.indexOf("{") + 1; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      if (depth === 0) return { start: idx, end: i + 1, body: src.slice(idx, i + 1) };
      depth--;
    }
  }
  return null;
}

/** Strip `//` line comments while leaving strings intact, so the params
 * block (which ships with human-readable trailing comments) can be parsed
 * as JSON. Only handles `//` comments and single/double-quoted strings —
 * block comments and template literals (backticks) inside the params block
 * are not recognized and will pass through unstripped. */
function stripComments(src: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += src[i + 1] ?? "";
        i++;
      } else if (c === '"' || c === "'") {
        inStr = false;
      }
    } else if (c === '"' || c === "'") {
      inStr = true;
      out += c;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += " ";
    } else {
      out += c;
    }
  }
  return out;
}

export function extractParams(source: string): ParamsMap | null {
  const block = findParamsBlock(source);
  if (!block) return null;
  let json = block.body.slice(block.body.indexOf("{"));
  json = stripComments(json);
  json = json.replace(/,\s*([}\]])/g, "$1"); // trailing commas are legal JS, not JSON
  json = json.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  try {
    return JSON.parse(json) as ParamsMap;
  } catch {
    return null;
  }
}

const fmt = (n: number): string => String(Number(n.toPrecision(4)));

function formatParamsBlock(obj: ParamsMap): string {
  const lines: string[] = ["const params = {"];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "number") lines.push(`  ${key}: ${fmt(value)},`);
    else if (typeof value === "boolean") lines.push(`  ${key}: ${value},`);
    else if (typeof value === "string") lines.push(`  ${key}: "${value}",`);
    else if (Array.isArray(value)) lines.push(`  ${key}: [${value.map((v) => fmt(Number(v))).join(", ")}],`);
  }
  lines.push("};");
  return lines.join("\n");
}

/** Rewrite the `params` literal in the editable source. Keeps any keys the
 * user added; only known values are overwritten, so editing by hand and
 * sliders can coexist. */
export function injectParams(source: string, overrides: ParamsMap): string {
  const block = findParamsBlock(source);
  if (!block) return source;
  const current = extractParams(source) ?? {};
  const merged: ParamsMap = { ...current };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) merged[k] = v;
  }
  return source.slice(0, block.start) + formatParamsBlock(merged) + source.slice(block.end);
}
