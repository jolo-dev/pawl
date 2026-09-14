/**
 * Pawl's brand tokens, mirrored from the documentation design system.
 *
 * The docs site owns the palette (`docs/DESIGN.md`): a redline-on-charcoal
 * drafting table. The terminal client reuses it rather than inventing a second
 * identity, and `tests/tui-theme.test.ts` compares these values against that
 * file so the two cannot drift apart.
 *
 * This module stays free of any renderer import so the tokens are usable (and
 * testable) without a terminal.
 */

/** Hex values, keyed by camelCase for use in code. */
export const PAWL_COLORS = {
	redlineInk: "#ea1b0a",
	redlineReadable: "#ff6a55",
	redlineDeep: "#7d1509",
	redlineHot: "#ff2e1c",
	charcoalPaper: "#1a1a1a",
	charcoalDeep: "#131211",
	charcoalRaised: "#232220",
	chalkText: "#d3cec4",
	chalkBright: "#f3f0e9",
	paperSheet: "#fbf8f1",
	paperInk: "#45403a",
	codeCharcoal: "#100f0e",
} as const;

export type PawlColorName = keyof typeof PAWL_COLORS;

/**
 * The token name each colour carries in `docs/DESIGN.md`, so the drift test can
 * compare like with like.
 */
export const DESIGN_TOKEN_NAMES: Record<PawlColorName, string> = {
	redlineInk: "redline-ink",
	redlineReadable: "redline-readable",
	redlineDeep: "redline-deep",
	redlineHot: "redline-hot",
	charcoalPaper: "charcoal-paper",
	charcoalDeep: "charcoal-deep",
	charcoalRaised: "charcoal-raised",
	chalkText: "chalk-text",
	chalkBright: "chalk-bright",
	paperSheet: "paper-sheet",
	paperInk: "paper-ink",
	codeCharcoal: "code-charcoal",
};

/** The product name as it appears in a terminal. */
export const PAWL_WORDMARK = "pawl";

/** What the product name stands for, per `docs/PRODUCT.md`. */
export const PAWL_TAGLINE = "Proficient AWS Library";

/**
 * Semantic roles, so a reader never has to guess which hex means what.
 *
 * `redline` is the accent for anything that asks the user to act — a pending
 * approval, a coverage gap — because the brand's whole metaphor is an engineer's
 * markup on a drawing.
 */
export const THEME = {
	background: PAWL_COLORS.charcoalPaper,
	panel: PAWL_COLORS.charcoalRaised,
	body: PAWL_COLORS.chalkText,
	strong: PAWL_COLORS.chalkBright,
	muted: PAWL_COLORS.paperInk,
	accent: PAWL_COLORS.redlineHot,
	accentInk: PAWL_COLORS.redlineInk,
	danger: PAWL_COLORS.redlineDeep,
	code: PAWL_COLORS.codeCharcoal,
} as const;

export type ThemeRole = keyof typeof THEME;
