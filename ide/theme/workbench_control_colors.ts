import * as token from './tokens';

type ControlColorPair = { foreground: number; background: number };

export type WorkbenchControlTheme = {
	button: {
		normal: ControlColorPair;
		highlighted: ControlColorPair;
		pressed: ControlColorPair;
		disabled: ControlColorPair;
		border: number;
	};
	markers: {
		chrome: { success: number; warning: number; error: number };
		dirtyTab: number;
		bodyAccent: number;
		graph: { body: number; card: number; hover: number };
	};
};

/** Control pairs and markers belong to their painted surfaces, not status-message ink. */
export const WORKBENCH_CONTROL_COLORS: Record<'light' | 'dark', WorkbenchControlTheme> = {
	light: {
		button: {
			normal: { foreground: token.THEME_TOKEN_TEXT_GREY, background: token.THEME_TOKEN_PANEL_GREY },
			highlighted: { foreground: token.THEME_TOKEN_NEAR_BLACK, background: token.THEME_TOKEN_BORDER_GREY },
			pressed: { foreground: token.THEME_TOKEN_GENTLE_WHITE, background: token.THEME_TOKEN_DARK_NAVY },
			disabled: { foreground: token.THEME_TOKEN_MUTED_GREY, background: token.THEME_TOKEN_PANEL_GREY },
			border: token.THEME_TOKEN_TEXT_GREY,
		},
		markers: {
			chrome: { success: token.THEME_TOKEN_TEXT_SUCCESS, warning: token.THEME_TOKEN_TEXT_WARNING, error: token.THEME_TOKEN_TEXT_ERROR },
			dirtyTab: token.THEME_TOKEN_FOCUS_BLUE,
			bodyAccent: token.THEME_TOKEN_FOCUS_BLUE,
			graph: { body: token.THEME_TOKEN_TEXT_SUCCESS, card: token.THEME_TOKEN_TEXT_SUCCESS, hover: token.THEME_TOKEN_TEXT_SUCCESS },
		},
	},
	dark: {
		button: {
			normal: { foreground: token.THEME_TOKEN_TEXT_GREY, background: token.THEME_TOKEN_TERMINAL_GREY },
			highlighted: { foreground: token.THEME_TOKEN_NEAR_BLACK, background: token.THEME_TOKEN_SOFT_WHITE },
			pressed: { foreground: token.THEME_TOKEN_WHITE, background: token.THEME_TOKEN_TERMINAL_DARK_BLUE },
			disabled: { foreground: token.THEME_TOKEN_MUTED_GREY, background: token.THEME_TOKEN_TERMINAL_GREY },
			border: token.THEME_TOKEN_TEXT_GREY,
		},
		markers: {
			chrome: { success: token.THEME_TOKEN_TEXT_SUCCESS, warning: token.THEME_TOKEN_TEXT_WARNING, error: token.THEME_TOKEN_TEXT_ERROR },
			dirtyTab: token.THEME_TOKEN_FOCUS_BLUE,
			bodyAccent: token.THEME_TOKEN_INFO_BLUE,
			graph: { body: token.THEME_TOKEN_TERMINAL_LIGHT_GREEN, card: token.THEME_TOKEN_TEXT_SUCCESS, hover: token.THEME_TOKEN_TERMINAL_LIGHT_GREEN },
		},
	},
};
