import { CodeTextDecoration, type CodeTextDecorationStyle, type EditorMessageKind } from './models';
import { EDITOR_THEME_COLORS, type EditorTheme } from '../theme/editor_colors';
import { WORKBENCH_TEXT_COLORS, type WorkbenchTextTheme } from '../theme/workbench_text_colors';
import { WORKBENCH_CONTROL_COLORS, type WorkbenchControlTheme } from '../theme/workbench_control_colors';
import {
	THEME_TOKEN_ACCENT_BLUE,
	THEME_TOKEN_ACTION_OVERLAY,
	THEME_TOKEN_BLACK,
	THEME_TOKEN_BORDER_GREY,
	THEME_TOKEN_PROBLEM_ERROR_TEXT,
	THEME_TOKEN_PROBLEM_WARNING_TEXT,
	THEME_TOKEN_DARK_NAVY,
	THEME_TOKEN_DARK_PURPLE,
	THEME_TOKEN_DARK_TEAL,
	THEME_TOKEN_DEEP_GREY,
	THEME_TOKEN_DEEP_TEAL,
	THEME_TOKEN_DROP_SHADOW,
	THEME_TOKEN_FOCUS_BLUE,
	THEME_TOKEN_DIFF_INSERTED_LIGHT,
	THEME_TOKEN_DIFF_REMOVED_LIGHT,
	THEME_TOKEN_DIFF_INSERTED_DARK,
	THEME_TOKEN_DIFF_REMOVED_DARK,
	THEME_TOKEN_ERROR_OVERLAY_BACKGROUND,
	THEME_TOKEN_ERROR_OVERLAY_BACKGROUND_HOVER,
	THEME_TOKEN_ERROR_OVERLAY_LINE_HOVER,
	THEME_TOKEN_GENTLE_WHITE,
	THEME_TOKEN_HINT_GREY,
	THEME_TOKEN_LIGHT_PURPLE,
	THEME_TOKEN_LIGHT_TEAL,
	THEME_TOKEN_LINE_HIGHLIGHT_OVERLAY,
	THEME_TOKEN_MID_GREY,
	THEME_TOKEN_MUTED_GREY,
	THEME_TOKEN_NEAR_BLACK,
	THEME_TOKEN_PALE_TEAL,
	THEME_TOKEN_PANEL_GREY,
	THEME_TOKEN_SCROLLBAR_BASE,
	THEME_TOKEN_SELECTION_OVERLAY,
	THEME_TOKEN_SOFT_WHITE,
	THEME_TOKEN_STATUS_TEXT_GREY,
	THEME_TOKEN_TERMINAL_CYAN,
	THEME_TOKEN_TERMINAL_DARK_BLUE,
	THEME_TOKEN_TERMINAL_GREY,
	THEME_TOKEN_TERMINAL_LIGHT_RED,
	THEME_TOKEN_TERMINAL_MAGENTA,
	THEME_TOKEN_TEXT_GREY,
	THEME_TOKEN_WARNING_AMBER,
	THEME_TOKEN_WHITE,
} from '../theme/tokens';

export const TAB_SPACES = 2;
export const CURSOR_BLINK_INTERVAL = 0.45;
export const UNDO_HISTORY_LIMIT = 512;
export const UNDO_COALESCE_INTERVAL_MS = 550;
export const DOUBLE_CLICK_MAX_INTERVAL_MS = 320;
export const DEFAULT_THEME = 'light';

type ThemeDefinition = {
	editor: EditorTheme;
	workbenchText: WorkbenchTextTheme;
	controls: WorkbenchControlTheme;
	resourceMatch: { background: number; text: number };
	disabledForeground: number;
	descriptionForeground: number;
	surfaces: {
		frame: number;
		topBar: number;
		gutter: number;
		resourcePanel: number;
		resourcePanelHighlight: number;
		resourceViewer: number;
		tabInactive: number;
		tabActive: number;
	};
	text: {
		topBar: number;
		primary: number;
		strong: number;
		secondary: number;
		selection: number;
		selectionText: number;
		inactiveSelection: number;
		inactiveSelectionText: number;
		selectionBorder: number;
		errorOverlayText: number;
	};
	status: {
		background: number;
		text: number;
	};
	timeline: {
		track: number;
		position: number;
	};
	graph: { muted: number };
	canvas: { gridMinor: number; gridMajor: number; boundary: number };
	inspection: { label: number; changedValue: number; warningValue: number };
	diff: { insertedBackground: number; removedBackground: number };
	focusBorder: number;
	markdown: {
		codeBackground: number;
		codeText: number;
		emphasisText: number;
		linkText: number;
		mutedText: number;
	};
	input: {
		background: number;
		text: number;
		placeholder: number;
		outline: number;
	};
	tab: {
		border: number;
		activeText: number;
		inactiveText: number;
	};
	window: {
		background: number;
		activeHeader: number;
		activeText: number;
		activeDisabledText: number;
		inactiveHeader: number;
		inactiveText: number;
		border: number;
	};
	searchBackground: number;
	highlightOverlay: number;
	scrollbarThumb?: number;
	caret: {
		inline: number;
	};
	overlays: ThemeOverlays;
};

type ThemeOverlays = {
	hover: {
		background: number;
		border: number;
		text: number;
	};
	search: {
		background: number;
		text: number;
		secondaryText: number;
		placeholder: number;
		outline: number;
		selectionBackground: number;
		selectionText: number;
		hoverBackground: number;
		hoverText: number;
	};
	completion: {
		background: number;
		border: number;
		text: number;
		detail: number;
		highlight: number;
		highlightText: number;
	};
	parameterHint: {
		background: number;
		border: number;
		text: number;
		active: number;
	};
	action: {
		dialogBackground: number;
		dialogBorder: number;
		dialogText: number;
		buttonBackground: number;
		buttonText: number;
	};
	quickOpen: {
		background: number;
		text: number;
		outline: number;
		kind: number;
		match: number;
		selectionMatch: number;
	};
};

const THEME_DEFINITIONS: Record<string, ThemeDefinition> = {
	dark: {
		editor: EDITOR_THEME_COLORS.dark,
		workbenchText: WORKBENCH_TEXT_COLORS.dark,
		controls: WORKBENCH_CONTROL_COLORS.dark,
		resourceMatch: { background: THEME_TOKEN_DEEP_TEAL, text: THEME_TOKEN_WHITE },
		disabledForeground: THEME_TOKEN_MUTED_GREY,
		descriptionForeground: THEME_TOKEN_HINT_GREY,
		window: { background: THEME_TOKEN_BLACK, activeHeader: THEME_TOKEN_DEEP_GREY, activeText: THEME_TOKEN_WHITE, activeDisabledText: THEME_TOKEN_MID_GREY,
			inactiveHeader: THEME_TOKEN_NEAR_BLACK, inactiveText: THEME_TOKEN_TERMINAL_GREY, border: THEME_TOKEN_MID_GREY },
		inspection: { label: THEME_TOKEN_HINT_GREY, changedValue: THEME_TOKEN_LIGHT_PURPLE, warningValue: THEME_TOKEN_WARNING_AMBER },
		diff: { insertedBackground: THEME_TOKEN_DIFF_INSERTED_DARK, removedBackground: THEME_TOKEN_DIFF_REMOVED_DARK },
		markdown: {
			codeBackground: THEME_TOKEN_DEEP_TEAL,
			codeText: THEME_TOKEN_LIGHT_TEAL,
			emphasisText: THEME_TOKEN_LIGHT_PURPLE,
			linkText: THEME_TOKEN_TERMINAL_CYAN,
			mutedText: THEME_TOKEN_HINT_GREY,
		},
		surfaces: {
			frame: THEME_TOKEN_WHITE,
			topBar: THEME_TOKEN_TERMINAL_GREY,
			gutter: THEME_TOKEN_TERMINAL_GREY,
			resourcePanel: THEME_TOKEN_TERMINAL_GREY,
			resourcePanelHighlight: THEME_TOKEN_BLACK,
			resourceViewer: THEME_TOKEN_BLACK,
			tabInactive: THEME_TOKEN_TERMINAL_GREY,
			tabActive: THEME_TOKEN_BLACK,
		},
		text: {
			topBar: THEME_TOKEN_TEXT_GREY,
			primary: THEME_TOKEN_TERMINAL_GREY,
			strong: THEME_TOKEN_WHITE,
			secondary: THEME_TOKEN_TEXT_GREY,
			selection: THEME_TOKEN_TERMINAL_DARK_BLUE,
			selectionText: THEME_TOKEN_WHITE,
			inactiveSelection: THEME_TOKEN_DEEP_GREY,
			inactiveSelectionText: THEME_TOKEN_WHITE,
			selectionBorder: THEME_TOKEN_FOCUS_BLUE,
			errorOverlayText: THEME_TOKEN_WHITE,
		},
		status: {
			background: THEME_TOKEN_TERMINAL_GREY,
			text: THEME_TOKEN_TEXT_GREY,
		},
		timeline: {
			track: THEME_TOKEN_MID_GREY,
			position: THEME_TOKEN_TERMINAL_DARK_BLUE,
		},
		graph: { muted: THEME_TOKEN_MUTED_GREY },
		canvas: { gridMinor: THEME_TOKEN_DEEP_GREY, gridMajor: THEME_TOKEN_MUTED_GREY, boundary: THEME_TOKEN_HINT_GREY },
		focusBorder: THEME_TOKEN_FOCUS_BLUE,
		input: {
			background: THEME_TOKEN_BLACK,
			text: THEME_TOKEN_TERMINAL_GREY,
			placeholder: THEME_TOKEN_HINT_GREY,
			outline: THEME_TOKEN_MUTED_GREY,
		},
		tab: {
			border: THEME_TOKEN_TERMINAL_DARK_BLUE,
			activeText: THEME_TOKEN_TERMINAL_GREY,
			inactiveText: THEME_TOKEN_TEXT_GREY,
		},
		searchBackground: THEME_TOKEN_TERMINAL_CYAN,
		highlightOverlay: THEME_TOKEN_DARK_NAVY,
		caret: {
			inline: THEME_TOKEN_BLACK,
		},
		overlays: {
			hover: {
				background: THEME_TOKEN_DARK_NAVY,
				border: THEME_TOKEN_MID_GREY,
				text: THEME_TOKEN_TERMINAL_GREY,
			},
			search: {
				background: THEME_TOKEN_NEAR_BLACK,
				text: THEME_TOKEN_TERMINAL_GREY,
				secondaryText: THEME_TOKEN_HINT_GREY,
				placeholder: THEME_TOKEN_HINT_GREY,
				outline: THEME_TOKEN_MID_GREY,
				selectionBackground: THEME_TOKEN_DARK_NAVY,
				selectionText: THEME_TOKEN_WHITE,
				hoverBackground: THEME_TOKEN_DEEP_GREY,
				hoverText: THEME_TOKEN_TERMINAL_GREY,
			},
			completion: {
				background: THEME_TOKEN_TERMINAL_CYAN,
				border: THEME_TOKEN_BLACK,
				text: THEME_TOKEN_TEXT_GREY,
				detail: THEME_TOKEN_TERMINAL_MAGENTA,
				highlight: THEME_TOKEN_BLACK,
				highlightText: THEME_TOKEN_TERMINAL_GREY,
			},
			parameterHint: {
				background: THEME_TOKEN_TERMINAL_CYAN,
				border: THEME_TOKEN_BLACK,
				text: THEME_TOKEN_TEXT_GREY,
				active: THEME_TOKEN_TERMINAL_LIGHT_RED,
			},
			action: {
				dialogBackground: THEME_TOKEN_NEAR_BLACK,
				dialogBorder: THEME_TOKEN_MID_GREY,
				dialogText: THEME_TOKEN_TERMINAL_GREY,
				buttonBackground: THEME_TOKEN_TERMINAL_GREY,
				buttonText: THEME_TOKEN_TEXT_GREY,
			},
			quickOpen: {
				background: THEME_TOKEN_DARK_NAVY,
				text: THEME_TOKEN_TERMINAL_GREY,
				outline: THEME_TOKEN_MID_GREY,
				kind: THEME_TOKEN_HINT_GREY,
				match: THEME_TOKEN_TERMINAL_CYAN,
				selectionMatch: THEME_TOKEN_WHITE,
			},
		},
	},
	light: {
		editor: EDITOR_THEME_COLORS.light,
		workbenchText: WORKBENCH_TEXT_COLORS.light,
		controls: WORKBENCH_CONTROL_COLORS.light,
		resourceMatch: { background: THEME_TOKEN_PALE_TEAL, text: THEME_TOKEN_TEXT_GREY },
		disabledForeground: THEME_TOKEN_MUTED_GREY,
		descriptionForeground: THEME_TOKEN_MUTED_GREY,
		window: { background: THEME_TOKEN_GENTLE_WHITE, activeHeader: THEME_TOKEN_DEEP_GREY, activeText: THEME_TOKEN_WHITE, activeDisabledText: THEME_TOKEN_MID_GREY,
			inactiveHeader: THEME_TOKEN_PANEL_GREY, inactiveText: THEME_TOKEN_TEXT_GREY, border: THEME_TOKEN_MID_GREY },
		inspection: { label: THEME_TOKEN_STATUS_TEXT_GREY, changedValue: THEME_TOKEN_DARK_PURPLE, warningValue: THEME_TOKEN_PROBLEM_WARNING_TEXT },
		diff: { insertedBackground: THEME_TOKEN_DIFF_INSERTED_LIGHT, removedBackground: THEME_TOKEN_DIFF_REMOVED_LIGHT },
		markdown: {
			codeBackground: THEME_TOKEN_PALE_TEAL,
			codeText: THEME_TOKEN_DARK_TEAL,
			emphasisText: THEME_TOKEN_DARK_PURPLE,
			linkText: THEME_TOKEN_TERMINAL_DARK_BLUE,
			mutedText: THEME_TOKEN_MUTED_GREY,
		},
		surfaces: {
			frame: THEME_TOKEN_SOFT_WHITE,
			topBar: THEME_TOKEN_PANEL_GREY,
			gutter: THEME_TOKEN_PANEL_GREY,
			resourcePanel: THEME_TOKEN_PANEL_GREY,
			resourcePanelHighlight: THEME_TOKEN_BORDER_GREY,
			resourceViewer: THEME_TOKEN_GENTLE_WHITE,
			tabInactive: THEME_TOKEN_PANEL_GREY,
			tabActive: THEME_TOKEN_SOFT_WHITE,
		},
		text: {
			topBar: THEME_TOKEN_TEXT_GREY,
			primary: THEME_TOKEN_TEXT_GREY,
			strong: THEME_TOKEN_NEAR_BLACK,
			secondary: THEME_TOKEN_TEXT_GREY,
			selection: THEME_TOKEN_SELECTION_OVERLAY,
			selectionText: THEME_TOKEN_GENTLE_WHITE,
			inactiveSelection: THEME_TOKEN_BORDER_GREY,
			inactiveSelectionText: THEME_TOKEN_TEXT_GREY,
			selectionBorder: THEME_TOKEN_ACCENT_BLUE,
			errorOverlayText: THEME_TOKEN_WHITE,
		},
		status: {
			background: THEME_TOKEN_PANEL_GREY,
			text: THEME_TOKEN_TEXT_GREY,
		},
		timeline: {
			track: THEME_TOKEN_MID_GREY,
			position: THEME_TOKEN_ACCENT_BLUE,
		},
		graph: { muted: THEME_TOKEN_MUTED_GREY },
		canvas: { gridMinor: THEME_TOKEN_BORDER_GREY, gridMajor: THEME_TOKEN_MID_GREY, boundary: THEME_TOKEN_MUTED_GREY },
		focusBorder: THEME_TOKEN_ACCENT_BLUE,
		input: {
			background: THEME_TOKEN_GENTLE_WHITE,
			text: THEME_TOKEN_TEXT_GREY,
			placeholder: THEME_TOKEN_MUTED_GREY,
			outline: THEME_TOKEN_MUTED_GREY,
		},
		tab: {
			border: THEME_TOKEN_BORDER_GREY,
			activeText: THEME_TOKEN_TEXT_GREY,
			inactiveText: THEME_TOKEN_TEXT_GREY,
		},
		searchBackground: THEME_TOKEN_PANEL_GREY,
		highlightOverlay: THEME_TOKEN_LINE_HIGHLIGHT_OVERLAY,
		scrollbarThumb: THEME_TOKEN_SCROLLBAR_BASE,
		caret: {
			inline: THEME_TOKEN_DEEP_GREY,
		},
		overlays: {
			hover: {
				background: THEME_TOKEN_PANEL_GREY,
				border: THEME_TOKEN_MID_GREY,
				text: THEME_TOKEN_TEXT_GREY,
			},
			search: {
				background: THEME_TOKEN_GENTLE_WHITE,
				text: THEME_TOKEN_TEXT_GREY,
				secondaryText: THEME_TOKEN_MUTED_GREY,
				placeholder: THEME_TOKEN_MUTED_GREY,
				outline: THEME_TOKEN_MID_GREY,
				selectionBackground: THEME_TOKEN_DARK_NAVY,
				selectionText: THEME_TOKEN_WHITE,
				hoverBackground: THEME_TOKEN_PANEL_GREY,
				hoverText: THEME_TOKEN_TEXT_GREY,
			},
			completion: {
				background: THEME_TOKEN_TERMINAL_CYAN,
				border: THEME_TOKEN_BLACK,
				text: THEME_TOKEN_TEXT_GREY,
				detail: THEME_TOKEN_TERMINAL_MAGENTA,
				highlight: THEME_TOKEN_BLACK,
				highlightText: THEME_TOKEN_TERMINAL_GREY,
			},
			parameterHint: {
				background: THEME_TOKEN_TERMINAL_CYAN,
				border: THEME_TOKEN_BLACK,
				text: THEME_TOKEN_TEXT_GREY,
				active: THEME_TOKEN_TERMINAL_LIGHT_RED,
			},
			action: {
				dialogBackground: THEME_TOKEN_SOFT_WHITE,
				dialogBorder: THEME_TOKEN_MID_GREY,
				dialogText: THEME_TOKEN_TEXT_GREY,
				buttonBackground: THEME_TOKEN_TERMINAL_GREY,
				buttonText: THEME_TOKEN_TEXT_GREY,
			},
			quickOpen: {
				background: THEME_TOKEN_PANEL_GREY,
				text: THEME_TOKEN_TEXT_GREY,
				outline: THEME_TOKEN_MID_GREY,
				kind: THEME_TOKEN_DEEP_GREY,
				match: THEME_TOKEN_DARK_TEAL,
				selectionMatch: THEME_TOKEN_WHITE,
			},
		},
	},
};

function buildPanelBase(theme: ThemeDefinition) {
	return {
		problems: {
			background: theme.status.background,
			headerBackground: theme.surfaces.topBar,
			headerText: theme.text.topBar,
			border: theme.text.topBar,
			text: theme.status.text,
			location: theme.status.text,
			error: THEME_TOKEN_PROBLEM_ERROR_TEXT,
			warning: THEME_TOKEN_PROBLEM_WARNING_TEXT,
			hoverText: theme.status.text,
			selectionBorder: theme.text.topBar,
		},
		resource: {
			background: theme.surfaces.resourcePanel,
			text: theme.status.text,
			highlight: theme.surfaces.resourcePanelHighlight,
			highlightText: theme.text.primary,
			viewerBackground: theme.surfaces.resourceViewer,
			viewerText: theme.text.primary,
		},
	};
}

function buildTabBase(theme: ThemeDefinition) {
	return {
		barBackground: theme.status.background,
		border: theme.tab.border,
		inactiveBackground: theme.surfaces.tabInactive,
		activeBackground: theme.surfaces.tabActive,
		inactiveText: theme.tab.inactiveText,
		activeText: theme.tab.activeText,
		dirtyMarker: theme.controls.markers.dirtyTab,
	};
}

const DEFAULT_THEME_VARIANT: string = 'light';
let activeThemeVariant: string = DEFAULT_THEME_VARIANT;
const themeChangeListeners = new Set<() => void>();

export let COLOR_FRAME: number;
export let COLOR_TOP_BAR: number;
export let COLOR_TOP_BAR_TEXT: number;
export let COLOR_CODE_BACKGROUND: number;
export let COLOR_GUTTER_BACKGROUND: number;
export let COLOR_GUTTER_TEXT: number;
export let COLOR_GUTTER_ACTIVE_BACKGROUND: number;
export let COLOR_GUTTER_ACTIVE_TEXT: number;
export let COLOR_GUTTER_EXECUTION_BACKGROUND: number;
export let COLOR_GUTTER_EXECUTION_TEXT: number;
export const CODE_TEXT_DECORATION_STYLES: readonly CodeTextDecorationStyle[] = Array.from({ length: CodeTextDecoration.Selection + 1 }, (_, role) => ({ ...EDITOR_THEME_COLORS.light.decorations[role] }));
export let COLOR_TEXT_STRONG: number;
export let COLOR_MARKDOWN_CODE_BACKGROUND: number;
export let COLOR_MARKDOWN_CODE_TEXT: number;
export let COLOR_MARKDOWN_EMPHASIS_TEXT: number;
export let COLOR_MARKDOWN_LINK_TEXT: number;
export let COLOR_MARKDOWN_MUTED_TEXT: number;
export let COLOR_BREAKPOINT_BORDER = 0;
export let COLOR_BREAKPOINT_FILL = 0;
export let COLOR_SYNTAX_HIGHLIGHTS = {
	COLOR_CODE_TEXT: undefined as number,
	COLOR_KEYWORD: undefined as number,
	COLOR_STRING: undefined as number,
	COLOR_NUMBER: undefined as number,
	COLOR_COMMENT: undefined as number,
	COLOR_OPERATOR: undefined as number,
	COLOR_CODE_DIM: undefined as number,
	COLOR_BUILTIN: undefined as number,
	COLOR_FUNCTION_NAME: undefined as number,
	COLOR_PARAMETER: undefined as number,
	COLOR_GLOBAL_VARIABLE: undefined as number,
	COLOR_MODULE: undefined as number,
	COLOR_TYPE: undefined as number,
	COLOR_LABEL: undefined as number,
	COLOR_LOCAL_TOP: undefined as number,
	COLOR_LOCAL_FUNCTION: undefined as number,
	COLOR_LOCAL_TABLE_FIELD: undefined as number,
	COLOR_FUNCTION_HANDLE: undefined as number,
};
export let HIGHLIGHT_OVERLAY = 0;
export let SELECTION_OVERLAY = 0;
export let COLOR_SELECTION_TEXT = 0;
export let COLOR_FOCUS_BORDER = 0;
export let INACTIVE_SELECTION_OVERLAY = 0;
export let COLOR_INACTIVE_SELECTION_TEXT = 0;
export let CARET_COLOR = 0;
export let INLINE_CARET_COLOR = 0;
export let SEARCH_RESULT_SELECTION_OVERLAY = 0;
export let SEARCH_RESULT_HOVER_OVERLAY = 0;
export let COLOR_STATUS_BACKGROUND: number;
export let COLOR_STATUS_TEXT: number;
export let COLOR_STATUS_FAULT_MARKER: number;
export let COLOR_BODY_ACCENT: number;
export let COLOR_INPUT_BACKGROUND: number;
export let COLOR_INPUT_TEXT: number;
export let COLOR_INPUT_PLACEHOLDER: number;
export let COLOR_INPUT_OUTLINE: number;
export let COLOR_CONTENT_PROGRESS_TEXT: number;
export let COLOR_CONTENT_SUCCESS_TEXT: number;
export let COLOR_CONTENT_WARNING_TEXT: number;
export let COLOR_CONTENT_ERROR_TEXT: number;
export const STATUS_MESSAGE_TEXT_COLORS: Record<EditorMessageKind, number> = { info: 0, success: 0, warning: 0, error: 0 };
export let COLOR_TIMELINE_TRACK: number;
export let COLOR_TIMELINE_POSITION: number;
export let COLOR_GRAPH_ACTIVE_BODY: number;
export let COLOR_GRAPH_ACTIVE_CARD: number;
export let COLOR_GRAPH_ACTIVE_HOVER: number;
export let COLOR_GRAPH_MUTED: number;
export let COLOR_CANVAS_GRID_MINOR: number;
export let COLOR_CANVAS_GRID_MAJOR: number;
export let COLOR_CANVAS_BOUNDARY: number;
export let COLOR_INSPECTOR_LABEL: number;
export let COLOR_DESCRIPTION_TEXT: number;
export let COLOR_INSPECTOR_VALUE_CHANGED: number;
export let COLOR_INSPECTOR_WARNING_TEXT: number;
export let COLOR_DIFF_INSERTED_BACKGROUND: number;
export let COLOR_DIFF_REMOVED_BACKGROUND: number;
export let COLOR_SERVER_CONNECTED: number;
export let COLOR_SERVER_DISCONNECTED: number;
export let COLOR_SERVER_CONNECTING: number;
export let COLOR_DIAGNOSTIC_ERROR: number = THEME_TOKEN_TERMINAL_LIGHT_RED;
export let COLOR_DIAGNOSTIC_WARNING: number;
export let COLOR_PROBLEMS_PANEL_BACKGROUND: number;
export let COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND: number;
export let COLOR_PROBLEMS_PANEL_HEADER_TEXT: number;
export let COLOR_PROBLEMS_PANEL_BORDER: number;
export let COLOR_PROBLEMS_PANEL_SELECTION_BORDER: number;
export let COLOR_PROBLEMS_PANEL_TEXT: number;
export let COLOR_PROBLEMS_PANEL_LOCATION: number;
export let COLOR_PROBLEMS_PANEL_ERROR: number;
export let COLOR_PROBLEMS_PANEL_WARNING: number;
export let COLOR_PROBLEMS_PANEL_HOVER_TEXT: number;
export let COLOR_RESOURCE_PANEL_BACKGROUND: number;
export let COLOR_RESOURCE_PANEL_TEXT: number;
export let COLOR_RESOURCE_PANEL_HIGHLIGHT: number;
export let COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT: number;
export let COLOR_RESOURCE_MATCH_BACKGROUND: number;
export let COLOR_RESOURCE_MATCH_TEXT: number;
export let COLOR_RESOURCE_VIEWER_BACKGROUND: number;
export let COLOR_RESOURCE_VIEWER_TEXT: number;
export let COLOR_SEARCH_SECONDARY_TEXT: number;
export let COLOR_SEARCH_TEXT: number;
export let COLOR_SEARCH_SELECTION_TEXT: number;
export let COLOR_SEARCH_HOVER_TEXT: number;
export let COLOR_SEARCH_PLACEHOLDER: number;
export let COLOR_SEARCH_OUTLINE: number;
export let COLOR_SEARCH_BACKGROUND: number;
export const SEARCH_BAR_MARGIN_Y = 2;
export let COLOR_LINE_JUMP_BACKGROUND: number;
export let COLOR_LINE_JUMP_TEXT: number;
export let COLOR_LINE_JUMP_PLACEHOLDER: number;
export let COLOR_LINE_JUMP_OUTLINE: number;
export const ERROR_OVERLAY_BACKGROUND = THEME_TOKEN_ERROR_OVERLAY_BACKGROUND;
export const ERROR_OVERLAY_BACKGROUND_HOVER = THEME_TOKEN_ERROR_OVERLAY_BACKGROUND_HOVER;
export const ERROR_OVERLAY_LINE_HOVER = THEME_TOKEN_ERROR_OVERLAY_LINE_HOVER;
export const ERROR_OVERLAY_PADDING_X = 4;
export const ERROR_OVERLAY_PADDING_Y = 2;
export const ERROR_OVERLAY_CONNECTOR_OFFSET = 6;
export let ERROR_OVERLAY_TEXT_COLOR: number;
export let EXECUTION_STOP_OVERLAY: number;
export const HOVER_TOOLTIP_PADDING_X = 4;
export const HOVER_TOOLTIP_PADDING_Y = 2;
export let HOVER_TOOLTIP_BACKGROUND: number;
export let HOVER_TOOLTIP_BORDER: number;
export let HOVER_TOOLTIP_TEXT: number;
export const HOVER_TOOLTIP_MAX_VISIBLE_LINES = 10;
export const LINE_JUMP_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;
export let COLOR_HEADER_BUTTON_BACKGROUND: number;
export let COLOR_HEADER_BUTTON_BORDER: number;
export let COLOR_HEADER_BUTTON_DISABLED_BACKGROUND: number;
export let COLOR_HEADER_BUTTON_TEXT: number;
export let COLOR_HEADER_BUTTON_TEXT_DISABLED: number;
export let COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND: number;
export let COLOR_HEADER_BUTTON_ACTIVE_TEXT: number;
export let COLOR_HEADER_BUTTON_PRESSED_BACKGROUND: number;
export let COLOR_HEADER_BUTTON_PRESSED_TEXT: number;
export let ACTION_DIALOG_BACKGROUND_COLOR: number;
export let ACTION_DIALOG_BORDER_COLOR: number;
export let ACTION_DIALOG_TEXT_COLOR: number;
export let ACTION_BUTTON_BACKGROUND: number;
export let ACTION_BUTTON_TEXT: number;
export let COLOR_TAB_BAR_BACKGROUND: number;
export let COLOR_TAB_BORDER: number;
export let COLOR_TAB_INACTIVE_BACKGROUND: number;
export let COLOR_TAB_ACTIVE_BACKGROUND: number;
export let COLOR_TAB_INACTIVE_TEXT: number;
export let COLOR_TAB_ACTIVE_TEXT: number;
export let COLOR_TAB_DIRTY_MARKER: number;
export let COLOR_GOTO_UNDERLINE: number;
export let RESOURCE_PANEL_DIVIDER_COLOR: number;
export let SCROLLBAR_TRACK_COLOR: number;
export let SCROLLBAR_THUMB_COLOR: number;
export let COLOR_QUICK_OPEN_BACKGROUND: number;
export let COLOR_QUICK_OPEN_TEXT: number;
export let COLOR_QUICK_OPEN_OUTLINE: number;
export let COLOR_QUICK_OPEN_KIND: number;
export let COLOR_QUICK_OPEN_MATCH: number;
export let COLOR_QUICK_OPEN_SELECTION_MATCH: number;
export let COLOR_QUICK_OPEN_SELECTION_BACKGROUND: number;
export let COLOR_QUICK_OPEN_SELECTION_TEXT: number;
export let COLOR_QUICK_OPEN_HOVER_BACKGROUND: number;
export let COLOR_MENU_BACKGROUND: number;
export let COLOR_MENU_BORDER: number;
export let COLOR_MENU_TEXT: number;
export let COLOR_MENU_DISABLED_TEXT: number;
export let COLOR_MENU_SELECTION_BACKGROUND: number;
export let COLOR_MENU_SELECTION_TEXT: number;
export const COLOR_SURFACE_SHADOW = THEME_TOKEN_DROP_SHADOW;
export let COLOR_WINDOW_BACKGROUND: number;
export let COLOR_WINDOW_HEADER_ACTIVE_BACKGROUND: number;
export let COLOR_WINDOW_HEADER_ACTIVE_TEXT: number;
export let COLOR_WINDOW_HEADER_ACTIVE_TEXT_DISABLED: number;
export let COLOR_WINDOW_HEADER_INACTIVE_BACKGROUND: number;
export let COLOR_WINDOW_HEADER_INACTIVE_TEXT: number;
export let COLOR_WINDOW_BORDER: number;
export let COLOR_COMPLETION_BACKGROUND: number;
export let COLOR_COMPLETION_BORDER: number;
export let COLOR_COMPLETION_TEXT: number;
export let COLOR_COMPLETION_DETAIL: number;
export let COLOR_COMPLETION_PREVIEW_TEXT: number;
export let COLOR_COMPLETION_HIGHLIGHT: number;
export let COLOR_COMPLETION_HIGHLIGHT_TEXT: number;
export let COLOR_PARAMETER_HINT_BACKGROUND: number;
export let COLOR_PARAMETER_HINT_BORDER: number;
export let COLOR_PARAMETER_HINT_TEXT: number;
export let COLOR_PARAMETER_HINT_ACTIVE: number;

export function onDidChangeIdeTheme(listener: () => void): () => void {
	themeChangeListeners.add(listener);
	return () => themeChangeListeners.delete(listener);
}

export function setIdeThemeVariant(variant: string): void {
	activeThemeVariant = variant;
	applyThemeDefinition(THEME_DEFINITIONS[variant]);
	for (const listener of themeChangeListeners) listener();
}

export function getActiveIdeThemeVariant(): string {
	return activeThemeVariant;
}

function applyThemeDefinition(theme: ThemeDefinition): void {
	const panel = buildPanelBase(theme);
	const tab = buildTabBase(theme);
	const headerButtons = theme.controls.button;
	const markers = theme.controls.markers;
	const search = theme.overlays.search;
	const completion = theme.overlays.completion;
	const action = theme.overlays.action;
	const quickOpen = theme.overlays.quickOpen;
	const parameterHint = theme.overlays.parameterHint;

	COLOR_FRAME = theme.surfaces.frame;
	COLOR_TOP_BAR = theme.surfaces.topBar;
	COLOR_TOP_BAR_TEXT = theme.text.topBar;
	COLOR_CODE_BACKGROUND = theme.editor.background;
	COLOR_GUTTER_BACKGROUND = theme.editor.gutter.background;
	COLOR_GUTTER_TEXT = theme.editor.gutter.foreground;
	COLOR_GUTTER_ACTIVE_BACKGROUND = theme.editor.gutter.activeBackground;
	COLOR_GUTTER_ACTIVE_TEXT = theme.editor.gutter.activeForeground;
	COLOR_GUTTER_EXECUTION_BACKGROUND = theme.editor.gutter.executionBackground;
	COLOR_GUTTER_EXECUTION_TEXT = theme.editor.gutter.executionForeground;
	EXECUTION_STOP_OVERLAY = theme.editor.executionBackground;
	for (let role = CodeTextDecoration.None; role <= CodeTextDecoration.Selection; role++) {
		const source = theme.editor.decorations[role], target = CODE_TEXT_DECORATION_STYLES[role];
		target.background = source.background; target.foreground = source.foreground;
		target.errorUnderline = source.errorUnderline; target.warningUnderline = source.warningUnderline;
		target.gotoUnderline = source.gotoUnderline;
	}
	COLOR_TEXT_STRONG = theme.text.strong;
	COLOR_MARKDOWN_CODE_BACKGROUND = theme.markdown.codeBackground;
	COLOR_MARKDOWN_CODE_TEXT = theme.markdown.codeText;
	COLOR_MARKDOWN_EMPHASIS_TEXT = theme.markdown.emphasisText;
	COLOR_MARKDOWN_LINK_TEXT = theme.markdown.linkText;
	COLOR_MARKDOWN_MUTED_TEXT = theme.markdown.mutedText;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT = theme.editor.foreground;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_KEYWORD = theme.editor.syntax.keyword;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING = theme.editor.syntax.string;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_NUMBER = theme.editor.syntax.number;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_COMMENT = theme.editor.syntax.comment;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR = theme.editor.syntax.operator;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM = theme.editor.dim;
	COLOR_BREAKPOINT_BORDER = theme.editor.gutter.breakpointBorder;
	COLOR_BREAKPOINT_FILL = theme.editor.gutter.breakpointFill;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_BUILTIN = theme.editor.syntax.builtin;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_FUNCTION_NAME = theme.editor.syntax.functionName;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_PARAMETER = theme.editor.syntax.parameter;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_GLOBAL_VARIABLE = theme.editor.syntax.globalVar;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_LOCAL_TABLE_FIELD = theme.editor.foreground;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_MODULE = theme.editor.foreground;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_TYPE = theme.editor.foreground;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_LABEL = theme.editor.syntax.label;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_LOCAL_TOP = theme.editor.syntax.localTop;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_LOCAL_FUNCTION = theme.editor.syntax.localFunction;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_FUNCTION_HANDLE = theme.editor.syntax.functionHandle;
	HIGHLIGHT_OVERLAY = theme.highlightOverlay;
	SELECTION_OVERLAY = theme.text.selection;
	COLOR_SELECTION_TEXT = theme.text.selectionText;
	COLOR_FOCUS_BORDER = theme.focusBorder;
	INACTIVE_SELECTION_OVERLAY = theme.text.inactiveSelection;
	COLOR_INACTIVE_SELECTION_TEXT = theme.text.inactiveSelectionText;
	CARET_COLOR = theme.editor.caret;
	INLINE_CARET_COLOR = theme.caret.inline;
	SEARCH_RESULT_SELECTION_OVERLAY = search.selectionBackground;
	SEARCH_RESULT_HOVER_OVERLAY = search.hoverBackground;
	COLOR_STATUS_BACKGROUND = theme.status.background;
	COLOR_STATUS_TEXT = theme.status.text;
	COLOR_STATUS_FAULT_MARKER = markers.chrome.error;
	COLOR_BODY_ACCENT = markers.bodyAccent;
	COLOR_INPUT_BACKGROUND = theme.input.background;
	COLOR_INPUT_TEXT = theme.input.text;
	COLOR_INPUT_PLACEHOLDER = theme.input.placeholder;
	COLOR_INPUT_OUTLINE = theme.input.outline;
	COLOR_CONTENT_PROGRESS_TEXT = theme.workbenchText.content.progress;
	COLOR_CONTENT_SUCCESS_TEXT = theme.workbenchText.content.success;
	COLOR_CONTENT_WARNING_TEXT = theme.workbenchText.content.warning;
	COLOR_CONTENT_ERROR_TEXT = theme.workbenchText.content.error;
	STATUS_MESSAGE_TEXT_COLORS.info = theme.workbenchText.status.info;
	STATUS_MESSAGE_TEXT_COLORS.success = theme.workbenchText.status.success;
	STATUS_MESSAGE_TEXT_COLORS.warning = theme.workbenchText.status.warning;
	STATUS_MESSAGE_TEXT_COLORS.error = theme.workbenchText.status.error;
	COLOR_TIMELINE_TRACK = theme.timeline.track;
	COLOR_TIMELINE_POSITION = theme.timeline.position;
	COLOR_GRAPH_ACTIVE_BODY = markers.graph.body;
	COLOR_GRAPH_ACTIVE_CARD = markers.graph.card;
	COLOR_GRAPH_ACTIVE_HOVER = markers.graph.hover;
	COLOR_GRAPH_MUTED = theme.graph.muted;
	COLOR_CANVAS_GRID_MINOR = theme.canvas.gridMinor;
	COLOR_CANVAS_GRID_MAJOR = theme.canvas.gridMajor;
	COLOR_CANVAS_BOUNDARY = theme.canvas.boundary;
	COLOR_INSPECTOR_LABEL = theme.inspection.label;
	COLOR_DESCRIPTION_TEXT = theme.descriptionForeground;
	COLOR_INSPECTOR_VALUE_CHANGED = theme.inspection.changedValue;
	COLOR_INSPECTOR_WARNING_TEXT = theme.inspection.warningValue;
	COLOR_DIFF_INSERTED_BACKGROUND = theme.diff.insertedBackground;
	COLOR_DIFF_REMOVED_BACKGROUND = theme.diff.removedBackground;
	COLOR_SERVER_CONNECTED = markers.chrome.success;
	COLOR_SERVER_DISCONNECTED = markers.chrome.error;
	COLOR_SERVER_CONNECTING = markers.chrome.warning;
	COLOR_DIAGNOSTIC_ERROR = CODE_TEXT_DECORATION_STYLES[CodeTextDecoration.None].errorUnderline;
	COLOR_DIAGNOSTIC_WARNING = CODE_TEXT_DECORATION_STYLES[CodeTextDecoration.None].warningUnderline;
	COLOR_PROBLEMS_PANEL_BACKGROUND = panel.problems.background;
	COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND = panel.problems.headerBackground;
	COLOR_PROBLEMS_PANEL_HEADER_TEXT = panel.problems.headerText;
	COLOR_PROBLEMS_PANEL_BORDER = panel.problems.border;
	COLOR_PROBLEMS_PANEL_TEXT = panel.problems.text;
	COLOR_PROBLEMS_PANEL_LOCATION = panel.problems.location;
	COLOR_PROBLEMS_PANEL_ERROR = panel.problems.error;
	COLOR_PROBLEMS_PANEL_WARNING = panel.problems.warning;
	COLOR_PROBLEMS_PANEL_HOVER_TEXT = panel.problems.hoverText;
	COLOR_PROBLEMS_PANEL_SELECTION_BORDER = panel.problems.selectionBorder;
	COLOR_RESOURCE_PANEL_BACKGROUND = panel.resource.background;
	COLOR_RESOURCE_PANEL_TEXT = panel.resource.text;
	COLOR_RESOURCE_PANEL_HIGHLIGHT = panel.resource.highlight;
	COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT = panel.resource.highlightText;
	COLOR_RESOURCE_VIEWER_BACKGROUND = panel.resource.viewerBackground;
	COLOR_RESOURCE_MATCH_BACKGROUND = theme.resourceMatch.background;
	COLOR_RESOURCE_MATCH_TEXT = theme.resourceMatch.text;
	COLOR_RESOURCE_VIEWER_TEXT = panel.resource.viewerText;
	COLOR_SEARCH_SECONDARY_TEXT = search.secondaryText;
	COLOR_SEARCH_TEXT = search.text;
	COLOR_SEARCH_SELECTION_TEXT = search.selectionText;
	COLOR_SEARCH_HOVER_TEXT = search.hoverText;
	COLOR_SEARCH_PLACEHOLDER = search.placeholder;
	COLOR_SEARCH_OUTLINE = search.outline;
	COLOR_SEARCH_BACKGROUND = search.background;
	COLOR_LINE_JUMP_BACKGROUND = search.background;
	COLOR_LINE_JUMP_TEXT = search.text;
	COLOR_LINE_JUMP_PLACEHOLDER = search.placeholder;
	COLOR_LINE_JUMP_OUTLINE = search.outline;
	ERROR_OVERLAY_TEXT_COLOR = theme.text.errorOverlayText;
	HOVER_TOOLTIP_BACKGROUND = theme.overlays.hover.background;
	HOVER_TOOLTIP_BORDER = theme.overlays.hover.border;
	HOVER_TOOLTIP_TEXT = theme.overlays.hover.text;
	COLOR_HEADER_BUTTON_BACKGROUND = headerButtons.normal.background;
	COLOR_HEADER_BUTTON_BORDER = headerButtons.border;
	COLOR_HEADER_BUTTON_DISABLED_BACKGROUND = headerButtons.disabled.background;
	COLOR_HEADER_BUTTON_TEXT = headerButtons.normal.foreground;
	COLOR_HEADER_BUTTON_TEXT_DISABLED = headerButtons.disabled.foreground;
	COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND = headerButtons.highlighted.background;
	COLOR_HEADER_BUTTON_ACTIVE_TEXT = headerButtons.highlighted.foreground;
	COLOR_HEADER_BUTTON_PRESSED_BACKGROUND = headerButtons.pressed.background;
	COLOR_HEADER_BUTTON_PRESSED_TEXT = headerButtons.pressed.foreground;
	ACTION_DIALOG_BACKGROUND_COLOR = action.dialogBackground;
	ACTION_DIALOG_BORDER_COLOR = action.dialogBorder;
	ACTION_DIALOG_TEXT_COLOR = action.dialogText;
	ACTION_BUTTON_BACKGROUND = action.buttonBackground;
	ACTION_BUTTON_TEXT = action.buttonText;
	COLOR_TAB_BAR_BACKGROUND = tab.barBackground;
	COLOR_TAB_BORDER = tab.border;
	COLOR_TAB_INACTIVE_BACKGROUND = tab.inactiveBackground;
	COLOR_TAB_ACTIVE_BACKGROUND = tab.activeBackground;
	COLOR_TAB_INACTIVE_TEXT = tab.inactiveText;
	COLOR_TAB_ACTIVE_TEXT = tab.activeText;
	COLOR_TAB_DIRTY_MARKER = tab.dirtyMarker;
	COLOR_GOTO_UNDERLINE = CODE_TEXT_DECORATION_STYLES[CodeTextDecoration.None].gotoUnderline;
	RESOURCE_PANEL_DIVIDER_COLOR = tab.border;
	SCROLLBAR_TRACK_COLOR = theme.status.background;
	SCROLLBAR_THUMB_COLOR = theme.scrollbarThumb ?? theme.status.text;
	COLOR_QUICK_OPEN_BACKGROUND = quickOpen.background;
	COLOR_QUICK_OPEN_TEXT = quickOpen.text;
	COLOR_QUICK_OPEN_OUTLINE = quickOpen.outline;
	COLOR_QUICK_OPEN_KIND = quickOpen.kind;
	COLOR_QUICK_OPEN_MATCH = quickOpen.match;
	COLOR_QUICK_OPEN_SELECTION_MATCH = quickOpen.selectionMatch;
	COLOR_QUICK_OPEN_SELECTION_BACKGROUND = theme.text.selection;
	COLOR_QUICK_OPEN_SELECTION_TEXT = theme.text.selectionText;
	COLOR_QUICK_OPEN_HOVER_BACKGROUND = theme.surfaces.resourcePanelHighlight;
	COLOR_MENU_BACKGROUND = theme.surfaces.topBar;
	COLOR_MENU_BORDER = theme.tab.border;
	COLOR_MENU_TEXT = theme.text.topBar;
	COLOR_MENU_DISABLED_TEXT = theme.disabledForeground;
	COLOR_MENU_SELECTION_BACKGROUND = theme.text.selection;
	COLOR_MENU_SELECTION_TEXT = theme.text.selectionText;
	COLOR_WINDOW_BACKGROUND = theme.window.background;
	COLOR_WINDOW_HEADER_ACTIVE_BACKGROUND = theme.window.activeHeader;
	COLOR_WINDOW_HEADER_ACTIVE_TEXT = theme.window.activeText;
	COLOR_WINDOW_HEADER_ACTIVE_TEXT_DISABLED = theme.window.activeDisabledText;
	COLOR_WINDOW_HEADER_INACTIVE_BACKGROUND = theme.window.inactiveHeader;
	COLOR_WINDOW_HEADER_INACTIVE_TEXT = theme.window.inactiveText;
	COLOR_WINDOW_BORDER = theme.window.border;
	COLOR_COMPLETION_BACKGROUND = completion.background;
	COLOR_COMPLETION_BORDER = completion.border;
	COLOR_COMPLETION_TEXT = completion.text;
	COLOR_COMPLETION_DETAIL = completion.detail;
	COLOR_COMPLETION_PREVIEW_TEXT = theme.editor.ghost;
	COLOR_COMPLETION_HIGHLIGHT = completion.highlight;
	COLOR_COMPLETION_HIGHLIGHT_TEXT = completion.highlightText;
	COLOR_PARAMETER_HINT_BACKGROUND = parameterHint.background;
	COLOR_PARAMETER_HINT_BORDER = parameterHint.border;
	COLOR_PARAMETER_HINT_TEXT = parameterHint.text;
	COLOR_PARAMETER_HINT_ACTIVE = parameterHint.active;
}

applyThemeDefinition(THEME_DEFINITIONS[DEFAULT_THEME_VARIANT]);

export const PROBLEMS_PANEL_HEADER_PADDING_X = 6;
export const PROBLEMS_PANEL_HEADER_PADDING_Y = 2;
export const PROBLEMS_PANEL_CONTENT_PADDING_X = 6;
export const PROBLEMS_PANEL_CONTENT_PADDING_Y = 4;
export const PROBLEMS_PANEL_MIN_VISIBLE_ROWS = 3;
export const PROBLEMS_PANEL_MAX_VISIBLE_ROWS = 8;
export const PROBLEMS_PANEL_GAP_BETWEEN_COLUMNS = 10;
// Maximum wrapped lines per problem row in the problems panel
export const PROBLEMS_PANEL_MAX_WRAP_LINES = 3;
export const PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN = 4;
export const DEFAULT_NEW_LUA_RESOURCE_CONTENT = '\n';
export const HEADER_BUTTON_PADDING_X = 5;
export const HEADER_BUTTON_PADDING_Y = 1;
export const HEADER_BUTTON_SPACING = 4;
export const ACTION_OVERLAY_COLOR = THEME_TOKEN_ACTION_OVERLAY;
export const TAB_BUTTON_PADDING_X = 4;
export const TAB_BUTTON_PADDING_Y = 1;
export const TAB_BUTTON_SPACING = 3;
export const POINTER_DRAG_ACTIVATION_THRESHOLD = 8;
export const TAB_DIRTY_MARKER_SPACING = 2;
export const TAB_CLOSE_BUTTON_PADDING_X = 3;
export const TAB_CLOSE_BUTTON_PADDING_Y = 1;
export const TAB_CLOSE_BUTTON_SYMBOL = 'x';
export const RESOURCE_PANEL_MIN_RATIO = 0.18;
export const RESOURCE_PANEL_MAX_RATIO = 0.6;
export const RESOURCE_PANEL_DEFAULT_RATIO = 0.3;
export const RESOURCE_PANEL_MIN_EDITOR_RATIO = 0.35;
export const RESOURCE_PANEL_PADDING_X = 4;
export const RESOURCE_PANEL_DIVIDER_DRAG_MARGIN = 4;
export const SCROLLBAR_WIDTH = 3;
export const CODE_AREA_RIGHT_MARGIN = 6;
export const SCROLLBAR_MIN_THUMB_HEIGHT = 6;
export const SEARCH_RESULT_SPACING = 1;
export const QUICK_OPEN_RESULT_PADDING_X = 4;
export const SEARCH_MAX_RESULTS = 8;
export const COMPLETION_POPUP_PADDING_X = 4;
export const COMPLETION_POPUP_PADDING_Y = 2;
export const COMPLETION_POPUP_ITEM_SPACING = 1;
export const COMPLETION_POPUP_MAX_VISIBLE = 8;
export const COMPLETION_POPUP_MIN_WIDTH = 96;
export const PARAMETER_HINT_PADDING_X = 4;
export const PARAMETER_HINT_PADDING_Y = 2;
export const COMPLETION_AUTO_TRIGGER_DELAY_SECONDS = 0.16;
export const COMPLETION_TYPING_GRACE_MS = 1200;
export const PARAMETER_HINT_IDLE_DELAY_SECONDS = 0.32;
export const ESCAPE_KEY = 'Escape';

export const TAB_DIRTY_MARKER_METRICS = { width: 4, height: 4 };
export const TAB_DIRTY_LEFT_MARGIN = 4;
export const TAB_DIRTY_RIGHT_MARGIN = 4;
