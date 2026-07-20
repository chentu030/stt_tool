/** Restore TeX commands whose leading `\` was stripped (common paste / HTML attr bug). */

const TEX_CMDS = [
  "arcsin",
  "arccos",
  "arctan",
  "operatorname",
  "varepsilon",
  "vartheta",
  "varsigma",
  "varphi",
  "varrho",
  "rightarrow",
  "leftarrow",
  "Rightarrow",
  "Leftarrow",
  "leftrightarrow",
  "Leftrightarrow",
  "hookrightarrow",
  "longmapsto",
  "overline",
  "underline",
  "overbrace",
  "underbrace",
  "subseteq",
  "supseteq",
  "setminus",
  "emptyset",
  "partial",
  "infty",
  "nabla",
  "qquad",
  "quad",
  "cdots",
  "ldots",
  "vdots",
  "ddots",
  "dots",
  "times",
  "cdot",
  "circ",
  "ast",
  "star",
  "oplus",
  "ominus",
  "otimes",
  "oslash",
  "odot",
  "wedge",
  "vee",
  "cap",
  "cup",
  "sqcup",
  "bigsqcup",
  "langle",
  "rangle",
  "lfloor",
  "rfloor",
  "lceil",
  "rceil",
  "forall",
  "exists",
  "notin",
  "subset",
  "supset",
  "approx",
  "equiv",
  "simeq",
  "cong",
  "propto",
  "leq",
  "geq",
  "neq",
  "ll",
  "gg",
  "prec",
  "succ",
  "perp",
  "parallel",
  "angle",
  "triangle",
  "binom",
  "dfrac",
  "tfrac",
  "frac",
  "sqrt",
  "sum",
  "prod",
  "oint",
  "int",
  "lim",
  "max",
  "min",
  "sup",
  "inf",
  "det",
  "dim",
  "ker",
  "deg",
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "log",
  "ln",
  "exp",
  "left",
  "right",
  "big",
  "Big",
  "bigg",
  "Bigg",
  "text",
  "mathrm",
  "mathbf",
  "mathit",
  "mathsf",
  "mathtt",
  "mathbb",
  "mathcal",
  "mathfrak",
  "boldsymbol",
  "hat",
  "bar",
  "vec",
  "dot",
  "ddot",
  "tilde",
  "check",
  "breve",
  "acute",
  "grave",
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "pi",
  "rho",
  "sigma",
  "tau",
  "upsilon",
  "phi",
  "chi",
  "psi",
  "omega",
  "Gamma",
  "Delta",
  "Theta",
  "Lambda",
  "Xi",
  "Pi",
  "Sigma",
  "Upsilon",
  "Phi",
  "Psi",
  "Omega",
  "mapsto",
  "to",
  "pm",
  "mp",
  "div",
  "neg",
  "in",
  "ni",
];

// Longer names first so "operatorname" wins over "or" etc.
// No leading \b — digits may abut commands (e.g. 3\right).
const CMD_RE = new RegExp(`(?<![A-Za-z\\\\])(${TEX_CMDS.join("|")})(?![a-zA-Z])`, "g");

/** Decode formula from HTML attribute (supports encodeURIComponent). */
export function decodeFormulaAttr(raw: string): string {
  const s = raw || "";
  if (!/%[0-9A-Fa-f]{2}/.test(s)) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Encode formula for safe HTML data-formula attributes. */
export function encodeFormulaAttr(raw: string): string {
  return encodeURIComponent(raw || "");
}

/**
 * Fix formulas where `\` was stripped (int → \int, frac13 → \frac{1}{3}, …).
 * Safe to run on already-correct LaTeX.
 */
export function normalizeLatexFormula(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return s;

  // Differential thin space: "f(x), dx" → "f(x)\, dx" (skip if already \,)
  s = s.replace(/(?<!\\),\s*(d[a-zA-Z]\b)/g, "\\, $1");

  // frac12 / frac13 without braces (after optional leftover backslash)
  s = s.replace(/(?<!\\)\\?frac(\d)(\d)/g, "\\frac{$1}{$2}");

  // text + CJK without braces: text其中… → \text{其中…} up to = ) ( or end
  s = s.replace(
    /(?<!\\)\\?text([\u4e00-\u9fff][^\\=()]*?)(?=[=()F]|\\|$)/g,
    (_m, zh: string) => `\\text{${zh}}`
  );

  // Restore command backslashes
  s = s.replace(CMD_RE, "\\$1");

  // Collapse accidental double backslashes before commands (keep \\ for linebreak)
  s = s.replace(/\\\\(int|sum|prod|frac|left|right|text|quad|cdot|times|to|in)\b/g, "\\$1");

  return s;
}
