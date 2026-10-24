import { CodeTextDecoration, type CodeTextDecorationStyle } from '../common/models';
import * as token from './tokens';

export type EditorTheme = {
	background: number;
	foreground: number;
	dim: number;
	ghost: number;
	caret: number;
	gutter: { background: number; foreground: number; activeBackground: number; activeForeground: number;
		executionBackground: number; executionForeground: number; breakpointBorder: number; breakpointFill: number };
	executionBackground: number;
	syntax: { keyword: number; string: number; number: number; comment: number; operator: number;
		builtin: number; functionName: number; parameter: number; globalVar: number; label: number;
		localTop: number; localFunction: number; functionHandle: number };
	decorations: Readonly<Record<CodeTextDecoration, CodeTextDecorationStyle>>;
};

/** Opaque surface/ink pairs in CodeTextDecoration priority order. */
export const EDITOR_THEME_COLORS: Record<'light' | 'dark', EditorTheme> = {
	light: {
		background: token.THEME_TOKEN_SOFT_WHITE, foreground: token.THEME_TOKEN_TEXT_GREY,
		dim: token.THEME_TOKEN_MUTED_GREY, ghost: token.THEME_TOKEN_MUTED_GREY, caret: token.THEME_TOKEN_EDITOR_FUNCTION_LIGHT,
		gutter: { background: token.THEME_TOKEN_PANEL_GREY, foreground: token.THEME_TOKEN_TEXT_GREY,
			activeBackground: token.THEME_TOKEN_BORDER_GREY, activeForeground: token.THEME_TOKEN_NEAR_BLACK,
			executionBackground: token.THEME_TOKEN_EDITOR_EXECUTION_LIGHT, executionForeground: token.THEME_TOKEN_NEAR_BLACK,
			breakpointBorder: token.THEME_TOKEN_TEXT_GREY, breakpointFill: token.THEME_TOKEN_ACCENT_RED },
		executionBackground: token.THEME_TOKEN_EDITOR_EXECUTION_LIGHT,
		syntax: { keyword: token.THEME_TOKEN_KEYWORD_MAGENTA, string: token.THEME_TOKEN_EDITOR_STRING_LIGHT,
			number: token.THEME_TOKEN_EDITOR_NUMBER_LIGHT, comment: token.THEME_TOKEN_MUTED_GREY, operator: token.THEME_TOKEN_TEXT_GREY,
			builtin: token.THEME_TOKEN_EDITOR_BUILTIN_LIGHT, functionName: token.THEME_TOKEN_EDITOR_FUNCTION_LIGHT,
			parameter: token.THEME_TOKEN_TEXT_GREY, globalVar: token.THEME_TOKEN_EDITOR_NUMBER_LIGHT,
			label: token.THEME_TOKEN_EDITOR_LABEL_LIGHT, localTop: token.THEME_TOKEN_EDITOR_BUILTIN_LIGHT,
			localFunction: token.THEME_TOKEN_EDITOR_FUNCTION_LIGHT, functionHandle: token.THEME_TOKEN_EDITOR_FUNCTION_LIGHT },
		decorations: {
			[CodeTextDecoration.None]: { background: token.THEME_TOKEN_SOFT_WHITE, foreground: token.THEME_TOKEN_TEXT_GREY,
				errorUnderline: token.THEME_TOKEN_EDITOR_LABEL_LIGHT, warningUnderline: token.THEME_TOKEN_EDITOR_NUMBER_LIGHT, gotoUnderline: token.THEME_TOKEN_EDITOR_FUNCTION_LIGHT },
			[CodeTextDecoration.Reference]: { background: token.THEME_TOKEN_PALE_TEAL, foreground: token.THEME_TOKEN_TEXT_GREY,
				errorUnderline: token.THEME_TOKEN_EDITOR_LABEL_LIGHT, warningUnderline: token.THEME_TOKEN_EDITOR_NUMBER_LIGHT, gotoUnderline: token.THEME_TOKEN_EDITOR_FUNCTION_LIGHT },
			[CodeTextDecoration.ActiveReference]: { background: token.THEME_TOKEN_EDITOR_REFERENCE_ACTIVE_LIGHT, foreground: token.THEME_TOKEN_NEAR_BLACK,
				errorUnderline: token.THEME_TOKEN_EDITOR_LABEL_LIGHT, warningUnderline: token.THEME_TOKEN_EDITOR_NUMBER_LIGHT, gotoUnderline: token.THEME_TOKEN_EDITOR_FUNCTION_LIGHT },
			[CodeTextDecoration.Search]: { background: token.THEME_TOKEN_EDITOR_EXECUTION_LIGHT, foreground: token.THEME_TOKEN_NEAR_BLACK,
				errorUnderline: token.THEME_TOKEN_EDITOR_LABEL_LIGHT, warningUnderline: token.THEME_TOKEN_EDITOR_NUMBER_LIGHT, gotoUnderline: token.THEME_TOKEN_EDITOR_FUNCTION_LIGHT },
			[CodeTextDecoration.ActiveSearch]: { background: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW, foreground: token.THEME_TOKEN_NEAR_BLACK,
				errorUnderline: token.THEME_TOKEN_EDITOR_LABEL_LIGHT, warningUnderline: token.THEME_TOKEN_EDITOR_NUMBER_LIGHT, gotoUnderline: token.THEME_TOKEN_EDITOR_FUNCTION_LIGHT },
			[CodeTextDecoration.InactiveSelection]: { background: token.THEME_TOKEN_PANEL_GREY, foreground: token.THEME_TOKEN_TEXT_GREY,
				errorUnderline: token.THEME_TOKEN_EDITOR_LABEL_LIGHT, warningUnderline: token.THEME_TOKEN_EDITOR_NUMBER_LIGHT, gotoUnderline: token.THEME_TOKEN_EDITOR_FUNCTION_LIGHT },
			[CodeTextDecoration.Selection]: { background: token.THEME_TOKEN_DARK_NAVY, foreground: token.THEME_TOKEN_WHITE,
				errorUnderline: token.THEME_TOKEN_EDITOR_ERROR_ON_DARK, warningUnderline: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW, gotoUnderline: token.THEME_TOKEN_LIGHT_TEAL },
		},
	},
	dark: {
		background: token.THEME_TOKEN_DARK_NAVY, foreground: token.THEME_TOKEN_TERMINAL_GREY,
		dim: token.THEME_TOKEN_COMMENT_GREY, ghost: token.THEME_TOKEN_COMMENT_GREY, caret: token.THEME_TOKEN_WHITE,
		gutter: { background: token.THEME_TOKEN_TERMINAL_GREY, foreground: token.THEME_TOKEN_TEXT_GREY,
			activeBackground: token.THEME_TOKEN_BORDER_GREY, activeForeground: token.THEME_TOKEN_NEAR_BLACK,
			executionBackground: token.THEME_TOKEN_EDITOR_EXECUTION_LIGHT, executionForeground: token.THEME_TOKEN_NEAR_BLACK,
			breakpointBorder: token.THEME_TOKEN_TEXT_GREY, breakpointFill: token.THEME_TOKEN_TERMINAL_RED },
		executionBackground: token.THEME_TOKEN_BLACK,
		syntax: { keyword: token.THEME_TOKEN_BROWN, string: token.THEME_TOKEN_TERMINAL_LIGHT_RED,
			number: token.THEME_TOKEN_TERMINAL_CYAN, comment: token.THEME_TOKEN_TERMINAL_DARK_GREEN, operator: token.THEME_TOKEN_TERMINAL_GREY,
			builtin: token.THEME_TOKEN_TERMINAL_DARK_YELLOW, functionName: token.THEME_TOKEN_TERMINAL_GREY,
			parameter: token.THEME_TOKEN_TERMINAL_RED, globalVar: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW,
			label: token.THEME_TOKEN_TERMINAL_DARK_RED, localTop: token.THEME_TOKEN_CYAN_BLUE,
			localFunction: token.THEME_TOKEN_FUNCTION_BLUE, functionHandle: token.THEME_TOKEN_TERMINAL_LIGHT_GREEN },
		decorations: {
			[CodeTextDecoration.None]: { background: token.THEME_TOKEN_DARK_NAVY, foreground: token.THEME_TOKEN_TERMINAL_GREY,
				errorUnderline: token.THEME_TOKEN_EDITOR_ERROR_ON_DARK, warningUnderline: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW, gotoUnderline: token.THEME_TOKEN_LIGHT_TEAL },
			[CodeTextDecoration.Reference]: { background: token.THEME_TOKEN_DEEP_TEAL, foreground: token.THEME_TOKEN_WHITE,
				errorUnderline: token.THEME_TOKEN_EDITOR_ERROR_ON_DARK, warningUnderline: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW, gotoUnderline: token.THEME_TOKEN_LIGHT_TEAL },
			[CodeTextDecoration.ActiveReference]: { background: token.THEME_TOKEN_EDITOR_REFERENCE_ACTIVE_DARK, foreground: token.THEME_TOKEN_WHITE,
				errorUnderline: token.THEME_TOKEN_EDITOR_ERROR_ON_DARK, warningUnderline: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW, gotoUnderline: token.THEME_TOKEN_LIGHT_TEAL },
			[CodeTextDecoration.Search]: { background: token.THEME_TOKEN_EDITOR_SEARCH_DARK, foreground: token.THEME_TOKEN_WHITE,
				errorUnderline: token.THEME_TOKEN_EDITOR_ERROR_ON_DARK, warningUnderline: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW, gotoUnderline: token.THEME_TOKEN_LIGHT_TEAL },
			[CodeTextDecoration.ActiveSearch]: { background: token.THEME_TOKEN_PROBLEM_WARNING_TEXT, foreground: token.THEME_TOKEN_WHITE,
				errorUnderline: token.THEME_TOKEN_EDITOR_ERROR_ON_DARK, warningUnderline: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW, gotoUnderline: token.THEME_TOKEN_LIGHT_TEAL },
			[CodeTextDecoration.InactiveSelection]: { background: token.THEME_TOKEN_BLACK, foreground: token.THEME_TOKEN_WHITE,
				errorUnderline: token.THEME_TOKEN_EDITOR_ERROR_ON_DARK, warningUnderline: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW, gotoUnderline: token.THEME_TOKEN_LIGHT_TEAL },
			[CodeTextDecoration.Selection]: { background: token.THEME_TOKEN_TERMINAL_DARK_BLUE, foreground: token.THEME_TOKEN_WHITE,
				errorUnderline: token.THEME_TOKEN_EDITOR_ERROR_ON_DARK, warningUnderline: token.THEME_TOKEN_TERMINAL_LIGHT_YELLOW, gotoUnderline: token.THEME_TOKEN_LIGHT_TEAL },
		},
	},
};
