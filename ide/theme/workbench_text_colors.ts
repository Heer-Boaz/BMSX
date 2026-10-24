import type { EditorMessageKind } from '../common/models';
import * as token from './tokens';

export type WorkbenchTextTheme = {
	content: { progress: number; success: number; warning: number; error: number };
	status: Record<EditorMessageKind, number>;
};

/** Informative ink, not the brighter accents used for icons, borders or filled controls. */
export const WORKBENCH_TEXT_COLORS: Record<'light' | 'dark', WorkbenchTextTheme> = {
	light: {
		content: { progress: token.THEME_TOKEN_DARK_TEAL, success: token.THEME_TOKEN_TEXT_SUCCESS,
			warning: token.THEME_TOKEN_PROBLEM_WARNING_TEXT, error: token.THEME_TOKEN_PROBLEM_ERROR_TEXT },
		status: { info: token.THEME_TOKEN_TEXT_GREY, success: token.THEME_TOKEN_TEXT_SUCCESS,
			warning: token.THEME_TOKEN_PROBLEM_WARNING_TEXT, error: token.THEME_TOKEN_PROBLEM_ERROR_TEXT },
	},
	dark: {
		content: { progress: token.THEME_TOKEN_INFO_BLUE, success: token.THEME_TOKEN_SUCCESS_GREEN,
			warning: token.THEME_TOKEN_WARNING_AMBER, error: token.THEME_TOKEN_TERMINAL_LIGHT_RED },
		status: { info: token.THEME_TOKEN_TEXT_GREY, success: token.THEME_TOKEN_TEXT_SUCCESS,
			warning: token.THEME_TOKEN_TEXT_WARNING, error: token.THEME_TOKEN_TEXT_ERROR },
	},
};
