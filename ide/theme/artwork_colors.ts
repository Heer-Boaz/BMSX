import * as token from './tokens';

/** Artifact pixels keep a neutral viewing surface independently of surrounding UI chrome. */
export const ARTWORK_COLORS = {
	background: token.THEME_TOKEN_ARTWORK_BACKGROUND,
	annotation: {
		background: token.THEME_TOKEN_NEAR_BLACK,
		foreground: token.THEME_TOKEN_WHITE,
		warning: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW,
	},
	axes: [token.THEME_TOKEN_TERMINAL_RED, token.THEME_TOKEN_TERMINAL_GREEN, token.THEME_TOKEN_TERMINAL_BLUE],
	active: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW,
} as const;
