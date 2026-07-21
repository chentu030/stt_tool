/** Shared style for Albireus community package covers (flat poster / screen-print). */
export const COVER_STYLE_BASE = `Flat vector movie-poster illustration, minimalist screen-print aesthetic.
Limited palette with hard geometric shadows, no gradients, no photorealism, subtle paper grain.
Mood: calm, focused knowledge workspace. Landscape 16:9. No logos, no watermarks, no readable UI text.`;

export type CoverPromptInput = {
  name: string;
  description?: string;
  kind?: "extension" | "template" | string;
  tags?: string[];
};

/** Built-in prompts aligned to Albireus product surfaces. */
export const BUILTIN_COVER_PROMPTS: Record<string, string> = {
  "weekly-review": `${COVER_STYLE_BASE}
Subject: Albireus weekly review journal template.
Top-down open cream notebook on deep teal desk, burnt-orange checkmarks on a week calendar strip,
three floating note cards with checklist shapes, tiny silhouette person sitting on notebook edge reflecting on the week.
Vintage travel-poster geometry, navy hard shadows.`,

  "project-kickoff": `${COVER_STYLE_BASE}
Subject: Albireus project kickoff pack (brief, milestones, risks).
Low-angle view of a giant cream laptop key on deep navy, three kanban cards (teal, cream, burnt orange)
launching upward with graphic speed lines, tiny silhouette developer standing on the key.
Mid-century poster composition.`,

  "meeting-os": `${COVER_STYLE_BASE}
Subject: Albireus meeting operating system (agenda, decisions, todos).
Top-down long wooden table as geometric shapes, three simplified laptop rectangles facing each other,
teal accent sticky notes for resolutions, navy hard shadows, calm office poster mood.`,

  "web-browser-pack": `${COVER_STYLE_BASE}
Subject: Albireus sandbox browser page extension.
Giant stylized browser window frame at low angle, floating tab shapes as white birds against sky-blue,
tiny silhouette navigating between split panes, playful editorial flat illustration.`,

  "yahoo-stocks": `${COVER_STYLE_BASE}
Subject: Albireus stock chart extension.
Top-down teal desk with a glowing candlestick chart made of solid orange/cream bars,
tiny silhouette studying the chart, concentric ripples like calm water around the board.`,

  "vocab-srs": `${COVER_STYLE_BASE}
Subject: Albireus spaced-repetition vocabulary extension.
Giant cream flashcard tilting diagonally on salmon-pink background, tiny silhouette sitting on the card edge,
hard teal shadows, mid90s poster scale contrast, study mood.`,
};

export function buildCoverPrompt(input: CoverPromptInput): string {
  const kindLabel =
    input.kind === "extension" ? "browser extension / workspace tool" : "knowledge template";
  const tags = (input.tags || []).filter(Boolean).slice(0, 6).join(", ");
  const desc = (input.description || "").trim().slice(0, 220);
  return `${COVER_STYLE_BASE}

Subject: Albireus ${kindLabel} named "${input.name}".
${desc ? `Product idea: ${desc}` : ""}
${tags ? `Motifs / tags: ${tags}.` : ""}
Visualize the product metaphor with geometric objects from a knowledge workspace
(notes, tabs, split panes, kanban cards, whiteboard shapes, graph nodes, calendar strips)—
not a stock photo of people. One strong focal object, tiny human silhouette optional for scale.`;
}

export function resolveCoverPrompt(packageId: string, input: CoverPromptInput): string {
  return BUILTIN_COVER_PROMPTS[packageId] || buildCoverPrompt(input);
}
