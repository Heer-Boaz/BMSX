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

export const THEME_TOKEN_COLORS: readonly number[] = [
	0x00000000,
	0xff000000,
	0xff00f114,
	0xff44f956,
	0xff554fff,
	0xff806fff,
	0xfffa5033,
	0xff0cffff,
	0xffff5134,
	0xffff7356,
	0xffe2d204,
	0xfff2d947,
	0xff04d413,
	0xffe750e5,
	0xffd0d0d0,
	0xffffffff,
	0xffdeb887,
	0xff000040,
	0xfffafafa,
	0xffeaeaeb,
	0xffdbdbdc,
	0xff526fff,
	0xff383a42,
	0xff121417,
	0xffe5e5e6,
	0xff9d9d9f,
	0xfff5f5f5,
	0xffafb2bb,
	0xff424243,
	0xff232324,
	0xff5871ef,
	0xff6b83ed,
	0xff3bba54,
	0xff4cc263,
	0x3300809b,
	0x7f4e5666,
	0x7f5a6375,
	0x7f747d91,
	0xffa626a4,
	0xff50a14f,
	0xff986801,
	0xff0184bc,
	0xffe45649,
	0xff4078f2,
	0xffa0a1a7,
	0xffbf8803,
	0xff42ade1,
	0x00383a42,
	0xff000040,
	0x60e55959,
	0x99ffd83f,
	0x513f9ef2,
	0x892d70e5,
	0xff990000,
	0xffbf1919,
	0x2dffffff,
	0x72f27219,
	0xe5191919,
	0xa5000000,
];

export function resolveThemeTokenColor(token: number): number {
	return THEME_TOKEN_COLORS[token];
}


export function invertThemeToken(token: number): number {
	const color = THEME_TOKEN_COLORS[token];
	const luminance = 0.2126 * ((color >> 16) & 0xff) / 255 + 0.7152 * ((color >> 8) & 0xff) / 255 + 0.0722 * (color & 0xff) / 255;
	return luminance > 0.5 ? THEME_TOKEN_BLACK : THEME_TOKEN_WHITE;
}
