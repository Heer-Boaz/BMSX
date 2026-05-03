import type { color } from '../../common/color';

export const THEME_TOKEN_TRANSPARENT = 0;
export const THEME_TOKEN_BLACK = 1;
export const THEME_TOKEN_TERMINAL_GREEN = 2;
export const THEME_TOKEN_TERMINAL_LIGHT_GREEN = 3;
export const THEME_TOKEN_TERMINAL_DARK_BLUE = 4;
export const THEME_TOKEN_TERMINAL_BLUE = 5;
export const THEME_TOKEN_TERMINAL_DARK_RED = 6;
export const THEME_TOKEN_TERMINAL_CYAN = 7;
export const THEME_TOKEN_TERMINAL_RED = 8;
export const THEME_TOKEN_TERMINAL_LIGHT_RED = 9;
export const THEME_TOKEN_TERMINAL_DARK_YELLOW = 10;
export const THEME_TOKEN_TERMINAL_LIGHT_YELLOW = 11;
export const THEME_TOKEN_TERMINAL_DARK_GREEN = 12;
export const THEME_TOKEN_TERMINAL_MAGENTA = 13;
export const THEME_TOKEN_TERMINAL_GREY = 14;
export const THEME_TOKEN_WHITE = 15;
export const THEME_TOKEN_BROWN = 16;
export const THEME_TOKEN_DARK_NAVY = 17;
export const THEME_TOKEN_SOFT_WHITE = 18;
export const THEME_TOKEN_PANEL_GREY = 19;
export const THEME_TOKEN_BORDER_GREY = 20;
export const THEME_TOKEN_ACCENT_BLUE = 21;
export const THEME_TOKEN_DEEP_GREY = 22;
export const THEME_TOKEN_NEAR_BLACK = 23;
export const THEME_TOKEN_LIGHT_BORDER_GREY = 24;
export const THEME_TOKEN_MID_GREY = 25;
export const THEME_TOKEN_GENTLE_WHITE = 26;
export const THEME_TOKEN_HINT_GREY = 27;
export const THEME_TOKEN_STATUS_TEXT_GREY = 28;
export const THEME_TOKEN_LIST_TEXT_GREY = 29;
export const THEME_TOKEN_BUTTON_BLUE = 30;
export const THEME_TOKEN_BUTTON_BLUE_HOVER = 31;
export const THEME_TOKEN_SUCCESS_GREEN = 32;
export const THEME_TOKEN_SUCCESS_GREEN_HOVER = 33;
export const THEME_TOKEN_DIFF_INSERTED = 34;
export const THEME_TOKEN_SCROLLBAR_BASE = 35;
export const THEME_TOKEN_SCROLLBAR_HOVER = 36;
export const THEME_TOKEN_SCROLLBAR_ACTIVE = 37;
export const THEME_TOKEN_KEYWORD_MAGENTA = 38;
export const THEME_TOKEN_STRING_GREEN = 39;
export const THEME_TOKEN_NUMBER_BROWN = 40;
export const THEME_TOKEN_CYAN_BLUE = 41;
export const THEME_TOKEN_ACCENT_RED = 42;
export const THEME_TOKEN_FUNCTION_BLUE = 43;
export const THEME_TOKEN_COMMENT_GREY = 44;
export const THEME_TOKEN_WARNING_AMBER = 45;
export const THEME_TOKEN_INFO_BLUE = 46;
export const THEME_TOKEN_LINE_HIGHLIGHT_OVERLAY = 47;
export const THEME_TOKEN_SELECTION_OVERLAY = 48;
export const THEME_TOKEN_SEARCH_MATCH_OVERLAY = 49;
export const THEME_TOKEN_SEARCH_MATCH_ACTIVE_OVERLAY = 50;
export const THEME_TOKEN_REFERENCES_MATCH_OVERLAY = 51;
export const THEME_TOKEN_REFERENCES_MATCH_ACTIVE_OVERLAY = 52;
export const THEME_TOKEN_ERROR_OVERLAY_BACKGROUND = 53;
export const THEME_TOKEN_ERROR_OVERLAY_BACKGROUND_HOVER = 54;
export const THEME_TOKEN_ERROR_OVERLAY_LINE_HOVER = 55;
export const THEME_TOKEN_EXECUTION_STOP_OVERLAY = 56;
export const THEME_TOKEN_HOVER_TOOLTIP_BACKGROUND = 57;
export const THEME_TOKEN_ACTION_OVERLAY = 58;

export const THEME_TOKEN_COLORS: readonly color[] = [
	{ r: 0 / 255, g: 0 / 255, b: 0 / 255, a: 0 },
	{ r: 0 / 255, g: 0 / 255, b: 0 / 255, a: 1 },
	{ r: 0 / 255, g: 241 / 255, b: 20 / 255, a: 1 },
	{ r: 68 / 255, g: 249 / 255, b: 86 / 255, a: 1 },
	{ r: 85 / 255, g: 79 / 255, b: 255 / 255, a: 1 },
	{ r: 128 / 255, g: 111 / 255, b: 255 / 255, a: 1 },
	{ r: 250 / 255, g: 80 / 255, b: 51 / 255, a: 1 },
	{ r: 12 / 255, g: 255 / 255, b: 255 / 255, a: 1 },
	{ r: 255 / 255, g: 81 / 255, b: 52 / 255, a: 1 },
	{ r: 255 / 255, g: 115 / 255, b: 86 / 255, a: 1 },
	{ r: 226 / 255, g: 210 / 255, b: 4 / 255, a: 1 },
	{ r: 242 / 255, g: 217 / 255, b: 71 / 255, a: 1 },
	{ r: 4 / 255, g: 212 / 255, b: 19 / 255, a: 1 },
	{ r: 231 / 255, g: 80 / 255, b: 229 / 255, a: 1 },
	{ r: 208 / 255, g: 208 / 255, b: 208 / 255, a: 1 },
	{ r: 255 / 255, g: 255 / 255, b: 255 / 255, a: 1 },
	{ r: 222 / 255, g: 184 / 255, b: 135 / 255, a: 1 },
	{ r: 0 / 255, g: 0 / 255, b: 64 / 255, a: 1 },
	{ r: 250 / 255, g: 250 / 255, b: 250 / 255, a: 1 },
	{ r: 234 / 255, g: 234 / 255, b: 235 / 255, a: 1 },
	{ r: 219 / 255, g: 219 / 255, b: 220 / 255, a: 1 },
	{ r: 82 / 255, g: 111 / 255, b: 255 / 255, a: 1 },
	{ r: 56 / 255, g: 58 / 255, b: 66 / 255, a: 1 },
	{ r: 18 / 255, g: 20 / 255, b: 23 / 255, a: 1 },
	{ r: 229 / 255, g: 229 / 255, b: 230 / 255, a: 1 },
	{ r: 157 / 255, g: 157 / 255, b: 159 / 255, a: 1 },
	{ r: 245 / 255, g: 245 / 255, b: 245 / 255, a: 1 },
	{ r: 175 / 255, g: 178 / 255, b: 187 / 255, a: 1 },
	{ r: 66 / 255, g: 66 / 255, b: 67 / 255, a: 1 },
	{ r: 35 / 255, g: 35 / 255, b: 36 / 255, a: 1 },
	{ r: 88 / 255, g: 113 / 255, b: 239 / 255, a: 1 },
	{ r: 107 / 255, g: 131 / 255, b: 237 / 255, a: 1 },
	{ r: 59 / 255, g: 186 / 255, b: 84 / 255, a: 1 },
	{ r: 76 / 255, g: 194 / 255, b: 99 / 255, a: 1 },
	{ r: 0 / 255, g: 128 / 255, b: 155 / 255, a: 0.2 },
	{ r: 78 / 255, g: 86 / 255, b: 102 / 255, a: 0.5 },
	{ r: 90 / 255, g: 99 / 255, b: 117 / 255, a: 0.5 },
	{ r: 116 / 255, g: 125 / 255, b: 145 / 255, a: 0.5 },
	{ r: 166 / 255, g: 38 / 255, b: 164 / 255, a: 1 },
	{ r: 80 / 255, g: 161 / 255, b: 79 / 255, a: 1 },
	{ r: 152 / 255, g: 104 / 255, b: 1 / 255, a: 1 },
	{ r: 1 / 255, g: 132 / 255, b: 188 / 255, a: 1 },
	{ r: 228 / 255, g: 86 / 255, b: 73 / 255, a: 1 },
	{ r: 64 / 255, g: 120 / 255, b: 242 / 255, a: 1 },
	{ r: 160 / 255, g: 161 / 255, b: 167 / 255, a: 1 },
	{ r: 191 / 255, g: 136 / 255, b: 3 / 255, a: 1 },
	{ r: 66 / 255, g: 173 / 255, b: 225 / 255, a: 1 },
	{ r: 56 / 255, g: 58 / 255, b: 66 / 255, a: 0 },
	{ r: 0 / 255, g: 0 / 255, b: 64 / 255, a: 1 },
	{ r: 0.9, g: 0.35, b: 0.35, a: 0.38 },
	{ r: 1, g: 0.85, b: 0.25, a: 0.6 },
	{ r: 0.25, g: 0.62, b: 0.95, a: 0.32 },
	{ r: 0.18, g: 0.44, b: 0.9, a: 0.54 },
	{ r: 0.6, g: 0, b: 0, a: 1 },
	{ r: 0.75, g: 0.1, b: 0.1, a: 1 },
	{ r: 1, g: 1, b: 1, a: 0.18 },
	{ r: 0.95, g: 0.45, b: 0.1, a: 0.45 },
	{ r: 0.1, g: 0.1, b: 0.1, a: 0.9 },
	{ r: 0, g: 0, b: 0, a: 0.65 },
];

export function resolveThemeTokenColor(token: number): color {
	return THEME_TOKEN_COLORS[token];
}


export function invertThemeToken(token: number): number {
	const color = THEME_TOKEN_COLORS[token];
	const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
	return luminance > 0.5 ? THEME_TOKEN_BLACK : THEME_TOKEN_WHITE;
}
