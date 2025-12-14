import type { BGamepadButton } from '../../input/inputtypes';
import type { IdeThemeVariant } from './types';

/**
 * IMPORTANT: MSX PALETTE INDEX DESCRIPTIONS!
 * 0: Transparent
 * 1: Black
 * 2: Green
 * 3: Light green
 * 4: Dark blue
 * 5: Blue
 * 6: Dark red
 * 7: Light blue
 * 8: Red
 * 9: Light red
 * 10: Dark yellow
 * 11: Light yellow
 * 12: Dark green
 * 13: Magenta
 * 14: Grey
 * 15: White
 * 16: Brown (Extended palette color)
 * 17: Very dark blue (Extended palette color)
 */

export const TAB_SPACES = 2;
export const INITIAL_REPEAT_DELAY = 0.28;
export const REPEAT_INTERVAL = 0.05;
export const CURSOR_BLINK_INTERVAL = 0.45;
export const UNDO_HISTORY_LIMIT = 512;
export const UNDO_COALESCE_INTERVAL_MS = 550;
export const WHEEL_SCROLL_STEP = 40;
export const DOUBLE_CLICK_MAX_INTERVAL_MS = 320;
export const DEFAULT_THEME = 'light';

const PALETTE = {
	transparent: 0,
	black: 1,
	green: 2,
	lightGreen: 3,
	darkBlue: 4,
	blue: 5,
	darkRed: 6,
	lightBlue: 7,
	red: 8,
	lightRed: 9,
	darkYellow: 10,
	lightYellow: 11,
	darkGreen: 12,
	magenta: 13,
	grey: 14,
	white: 15,
	brown: 16, // Extended palette color
	veryDarkBlue: 17, // Extended palette color
	softWhite: 18,
	panelGrey: 19,
	borderGrey: 20,
	accentBlue: 21,
	deepGrey: 22,
	nearBlack: 23,
	lightBorderGrey: 24,
	midGrey: 25,
	gentleWhite: 26,
	hintGrey: 27,
	statusTextGrey: 28,
	listTextGrey: 29,
	buttonBlue: 30,
	buttonBlueHover: 31,
	successGreen: 32,
	successGreenHover: 33,
	diffInserted: 34,
	scrollbarBase: 35,
	scrollbarHover: 36,
	scrollbarActive: 37,
	keywordMagenta: 38,
	stringGreen: 39,
	numberBrown: 40,
	cyanBlue: 41,
	accentRed: 42,
	functionBlue: 43,
	commentGrey: 44,
	warningAmber: 45,
	infoBlue: 46,
	lineHighlightOverlay: 47,
	selectionOverlay: 48,
};

type ThemeDefinition = {
	surfaces: {
		frame: number;
		topBar: number;
		editor: number;
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
		secondary: number;
		keyword: number;
		string: number;
		number: number;
		comment: number;
		operator: number;
		dim: number;
		builtin: number;
		functionName: number;
		parameter: number;
		globalVar: number;
		label: number;
		localTop: number;
		localFunction: number;
		functionHandle: number;
		selection: number;
		selectionBorder: number;
		errorOverlayText: number;
	};
	status: {
		background: number;
		text: number;
		warning: number;
		success: number;
		error: number;
		alert: number;
	};
	input: {
		text: number;
		secondaryText: number;
		placeholder: number;
		outline: number;
	};
	tab: {
		border: number;
		activeText: number;
		inactiveText: number;
	};
	server_status: {
		connected: number;
		disconnected: number;
	};
	searchBackground: number;
	highlightOverlay: number;
	scrollbarThumb?: number;
	caret: {
		editor: number;
		inline: number;
	};
	overlays: ThemeOverlays;
};

type ThemeOverlays = {
	search: {
		background: number;
		text: number;
		secondaryText: number;
		placeholder: number;
		outline: number;
	};
	completion: {
		background: number;
		border: number;
		text: number;
		detail: number;
		previewText: number;
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
	symbolSearch: {
		background: number;
		text: number;
		placeholder: number;
		outline: number;
		kind: number;
	};
	quickOpen: {
		background: number;
		text: number;
		placeholder: number;
		outline: number;
		kind: number;
	};
};

const THEME_DEFINITIONS: Record<string, ThemeDefinition> = {
	dark: {
		surfaces: {
			frame: PALETTE.white,
			topBar: PALETTE.grey,
			editor: PALETTE.veryDarkBlue,
			gutter: PALETTE.grey,
			resourcePanel: PALETTE.grey,
			resourcePanelHighlight: PALETTE.black,
			resourceViewer: PALETTE.black,
			tabInactive: PALETTE.grey,
			tabActive: PALETTE.black,
		},
		text: {
			topBar: PALETTE.black,
			primary: PALETTE.white,
			secondary: PALETTE.black,
			keyword: PALETTE.brown,
			string: PALETTE.lightRed,
			number: PALETTE.lightBlue,
			comment: PALETTE.darkGreen,
			operator: PALETTE.white,
			dim: PALETTE.lightRed,
			builtin: PALETTE.darkYellow,
			functionName: PALETTE.white,
			parameter: PALETTE.red,
			globalVar: PALETTE.lightYellow,
			label: PALETTE.darkRed,
			localTop: PALETTE.cyanBlue,
			localFunction: PALETTE.functionBlue,
			functionHandle: PALETTE.lightGreen,
			selection: PALETTE.darkBlue,
			selectionBorder: PALETTE.blue,
			errorOverlayText: PALETTE.white,
		},
		status: {
			background: PALETTE.grey,
			text: PALETTE.black,
			warning: PALETTE.lightRed,
			success: PALETTE.darkBlue,
			error: PALETTE.white,
			alert: PALETTE.red,
		},
		input: {
			text: PALETTE.black,
			secondaryText: PALETTE.magenta,
			placeholder: PALETTE.lightRed,
			outline: PALETTE.black,
		},
		tab: {
			border: PALETTE.darkBlue,
			activeText: PALETTE.grey,
			inactiveText: PALETTE.black,
		},
		server_status: {
			connected: PALETTE.darkGreen,
			disconnected: PALETTE.red,
		},
		searchBackground: PALETTE.lightBlue,
		highlightOverlay: PALETTE.veryDarkBlue,
		caret: {
			editor: PALETTE.white,
			inline: PALETTE.black,
		},
		overlays: {
			search: {
				background: PALETTE.lightBlue,
				text: PALETTE.black,
				secondaryText: PALETTE.magenta,
				placeholder: PALETTE.lightRed,
				outline: PALETTE.black,
			},
			completion: {
				background: PALETTE.lightBlue,
				border: PALETTE.black,
				text: PALETTE.black,
				detail: PALETTE.magenta,
				previewText: PALETTE.commentGrey,
				highlight: PALETTE.black,
				highlightText: PALETTE.grey,
			},
			parameterHint: {
				background: PALETTE.lightBlue,
				border: PALETTE.black,
				text: PALETTE.black,
				active: PALETTE.lightRed,
			},
			action: {
				dialogBackground: PALETTE.lightBlue,
				dialogBorder: PALETTE.black,
				dialogText: PALETTE.black,
				buttonBackground: PALETTE.grey,
				buttonText: PALETTE.black,
			},
			symbolSearch: {
				background: PALETTE.lightBlue,
				text: PALETTE.black,
				placeholder: PALETTE.lightRed,
				outline: PALETTE.black,
				kind: PALETTE.magenta,
			},
			quickOpen: {
				background: PALETTE.lightBlue,
				text: PALETTE.black,
				placeholder: PALETTE.lightRed,
				outline: PALETTE.black,
				kind: PALETTE.magenta,
			},
		},
	},
	light: {
		surfaces: {
			frame: PALETTE.softWhite,
			topBar: PALETTE.panelGrey,
			editor: PALETTE.softWhite,
			gutter: PALETTE.panelGrey,
			resourcePanel: PALETTE.panelGrey,
			resourcePanelHighlight: PALETTE.borderGrey,
			resourceViewer: PALETTE.gentleWhite,
			tabInactive: PALETTE.panelGrey,
			tabActive: PALETTE.softWhite,
		},
		text: {
			topBar: PALETTE.statusTextGrey,
			primary: PALETTE.deepGrey,
			secondary: PALETTE.listTextGrey,
			keyword: PALETTE.keywordMagenta,
			string: PALETTE.stringGreen,
			number: PALETTE.numberBrown,
			comment: PALETTE.commentGrey,
			operator: PALETTE.deepGrey,
			dim: PALETTE.commentGrey,
			builtin: PALETTE.cyanBlue,
			functionName: PALETTE.functionBlue,
			parameter: PALETTE.deepGrey,
			globalVar: PALETTE.numberBrown,
			label: PALETTE.accentRed,
			localTop: PALETTE.cyanBlue,
			localFunction: PALETTE.functionBlue,
			functionHandle: PALETTE.functionBlue,
			selection: PALETTE.selectionOverlay,
			selectionBorder: PALETTE.midGrey,
			errorOverlayText: PALETTE.white,
		},
		status: {
			background: PALETTE.panelGrey,
			text: PALETTE.statusTextGrey,
			warning: PALETTE.warningAmber,
			success: PALETTE.successGreen,
			error: PALETTE.accentRed,
			alert: PALETTE.accentRed,
		},
		input: {
			text: PALETTE.deepGrey,
			secondaryText: PALETTE.commentGrey,
			placeholder: PALETTE.commentGrey,
			outline: PALETTE.borderGrey,
		},
		tab: {
			border: PALETTE.borderGrey,
			activeText: PALETTE.deepGrey,
			inactiveText: PALETTE.listTextGrey,
		},
		server_status: {
			connected: PALETTE.successGreen,
			disconnected: PALETTE.accentRed,
		},
		searchBackground: PALETTE.panelGrey,
		highlightOverlay: PALETTE.lineHighlightOverlay,
		scrollbarThumb: PALETTE.scrollbarBase,
		caret: {
			editor: PALETTE.accentBlue,
			inline: PALETTE.deepGrey,
		},
		overlays: {
			search: {
				background: PALETTE.lightBlue,
				text: PALETTE.black,
				secondaryText: PALETTE.magenta,
				placeholder: PALETTE.lightRed,
				outline: PALETTE.black,
			},
			completion: {
				background: PALETTE.lightBlue,
				border: PALETTE.black,
				text: PALETTE.black,
				detail: PALETTE.magenta,
				previewText: PALETTE.commentGrey,
				highlight: PALETTE.black,
				highlightText: PALETTE.grey,
			},
			parameterHint: {
				background: PALETTE.lightBlue,
				border: PALETTE.black,
				text: PALETTE.black,
				active: PALETTE.lightRed,
			},
			action: {
				dialogBackground: PALETTE.lightBlue,
				dialogBorder: PALETTE.black,
				dialogText: PALETTE.black,
				buttonBackground: PALETTE.grey,
				buttonText: PALETTE.black,
			},
			symbolSearch: {
				background: PALETTE.lightBlue,
				text: PALETTE.black,
				placeholder: PALETTE.lightRed,
				outline: PALETTE.black,
				kind: PALETTE.magenta,
			},
			quickOpen: {
				background: PALETTE.lightBlue,
				text: PALETTE.black,
				placeholder: PALETTE.lightRed,
				outline: PALETTE.black,
				kind: PALETTE.magenta,
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
			location: theme.text.dim,
			hoverText: theme.status.warning,
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
		dirtyMarker: theme.status.warning,
	};
}

function buildHeaderButtonBase(theme: ThemeDefinition) {
	return {
		background: theme.status.background,
		border: theme.text.topBar,
		disabledBackground: theme.surfaces.gutter,
		text: theme.text.topBar,
		disabledText: theme.text.dim,
		activeBackground: theme.status.warning,
		activeText: theme.text.topBar,
	};
}

const DEFAULT_THEME_VARIANT: IdeThemeVariant = 'light';
let activeThemeVariant: IdeThemeVariant = DEFAULT_THEME_VARIANT;

export let COLOR_FRAME: number;
export let COLOR_TOP_BAR: number;
export let COLOR_TOP_BAR_TEXT: number;
export let COLOR_CODE_BACKGROUND: number;
export let COLOR_GUTTER_BACKGROUND: number;
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
export let CARET_COLOR = 0;
export let INLINE_CARET_COLOR = 0;
export let SEARCH_RESULT_SELECTION_OVERLAY = 0;
export let SEARCH_RESULT_HOVER_OVERLAY = 0;
export let COLOR_STATUS_BACKGROUND: number;
export let COLOR_STATUS_TEXT: number;
export let COLOR_STATUS_WARNING: number;
export let COLOR_STATUS_SUCCESS: number;
export let COLOR_STATUS_ERROR: number;
export let COLOR_STATUS_ALERT: number;
export let COLOR_DIAGNOSTIC_ERROR: number = PALETTE.lightRed;
export let COLOR_DIAGNOSTIC_WARNING: number;
export let COLOR_PROBLEMS_PANEL_BACKGROUND: number;
export let COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND: number;
export let COLOR_PROBLEMS_PANEL_HEADER_TEXT: number;
export let COLOR_PROBLEMS_PANEL_BORDER: number;
export let COLOR_PROBLEMS_PANEL_SELECTION_BORDER: number;
export let COLOR_PROBLEMS_PANEL_TEXT: number;
export let COLOR_PROBLEMS_PANEL_LOCATION: number;
export let COLOR_PROBLEMS_PANEL_HOVER_TEXT: number;
export let COLOR_RESOURCE_PANEL_BACKGROUND: number;
export let COLOR_RESOURCE_PANEL_TEXT: number;
export let COLOR_RESOURCE_PANEL_HIGHLIGHT: number;
export let COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT: number;
export let COLOR_RESOURCE_VIEWER_BACKGROUND: number;
export let COLOR_RESOURCE_VIEWER_TEXT: number;
export let COLOR_SEARCH_SECONDARY_TEXT: number;
export let COLOR_SEARCH_TEXT: number;
export let COLOR_SEARCH_PLACEHOLDER: number;
export let COLOR_SEARCH_OUTLINE: number;
export let COLOR_SEARCH_BACKGROUND: number;
export const SEARCH_MATCH_OVERLAY = 49;
export const SEARCH_MATCH_ACTIVE_OVERLAY = 50;
export const REFERENCES_MATCH_OVERLAY = 51;
export const REFERENCES_MATCH_ACTIVE_OVERLAY = 52;
export const SEARCH_BAR_MARGIN_Y = 2;
export let COLOR_LINE_JUMP_BACKGROUND: number;
export let COLOR_LINE_JUMP_TEXT: number;
export let COLOR_LINE_JUMP_PLACEHOLDER: number;
export let COLOR_LINE_JUMP_OUTLINE: number;
export const ERROR_OVERLAY_BACKGROUND = 53;
export const ERROR_OVERLAY_BACKGROUND_HOVER = 54;
export const ERROR_OVERLAY_LINE_HOVER = 55;
export const ERROR_OVERLAY_PADDING_X = 4;
export const ERROR_OVERLAY_PADDING_Y = 2;
export const ERROR_OVERLAY_CONNECTOR_OFFSET = 6;
export let ERROR_OVERLAY_TEXT_COLOR: number;
export const EXECUTION_STOP_OVERLAY = 56;
export const HOVER_TOOLTIP_PADDING_X = 4;
export const HOVER_TOOLTIP_PADDING_Y = 2;
export const HOVER_TOOLTIP_BACKGROUND = 57;
export let HOVER_TOOLTIP_BORDER: number;
export const HOVER_TOOLTIP_MAX_VISIBLE_LINES = 10;
export const HOVER_TOOLTIP_MAX_LINE_LENGTH = 160;
export const LINE_JUMP_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;
export let COLOR_CREATE_RESOURCE_BACKGROUND: number;
export let COLOR_CREATE_RESOURCE_TEXT: number;
export let COLOR_CREATE_RESOURCE_PLACEHOLDER: number;
export let COLOR_CREATE_RESOURCE_OUTLINE: number;
export let COLOR_CREATE_RESOURCE_ERROR: number;
export let COLOR_SERVER_STATUS_CONNECTED: number;
export let COLOR_SERVER_STATUS_DISCONNECTED: number;
export let COLOR_HEADER_BUTTON_BACKGROUND: number;
export let COLOR_HEADER_BUTTON_BORDER: number;
export let COLOR_HEADER_BUTTON_DISABLED_BACKGROUND: number;
export let COLOR_HEADER_BUTTON_TEXT: number;
export let COLOR_HEADER_BUTTON_TEXT_DISABLED: number;
export let COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND: number;
export let COLOR_HEADER_BUTTON_ACTIVE_TEXT: number;
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
export let COLOR_SYMBOL_SEARCH_BACKGROUND: number;
export let COLOR_SYMBOL_SEARCH_TEXT: number;
export let COLOR_SYMBOL_SEARCH_PLACEHOLDER: number;
export let COLOR_SYMBOL_SEARCH_OUTLINE: number;
export let COLOR_SYMBOL_SEARCH_KIND: number;
export let COLOR_QUICK_OPEN_BACKGROUND: number;
export let COLOR_QUICK_OPEN_TEXT: number;
export let COLOR_QUICK_OPEN_PLACEHOLDER: number;
export let COLOR_QUICK_OPEN_OUTLINE: number;
export let COLOR_QUICK_OPEN_KIND: number;
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
export const CREATE_RESOURCE_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;
export const CREATE_RESOURCE_MAX_PATH_LENGTH = 1024;

applyThemeDefinition(THEME_DEFINITIONS[DEFAULT_THEME_VARIANT]);

export function setIdeThemeVariant(variant: IdeThemeVariant): void {
	const requestedVariant = variant ?? DEFAULT_THEME_VARIANT;
	if (requestedVariant === activeThemeVariant) {
		return;
	}
	const nextTheme = THEME_DEFINITIONS[requestedVariant] ?? THEME_DEFINITIONS[DEFAULT_THEME_VARIANT];
	if (!nextTheme) {
		throw new Error('[vm/ide/constants] Default IDE theme definition missing.');
	}
	activeThemeVariant = nextTheme === THEME_DEFINITIONS[requestedVariant]
		? requestedVariant
		: DEFAULT_THEME_VARIANT;
	applyThemeDefinition(nextTheme);
}

export function getActiveIdeThemeVariant(): IdeThemeVariant {
	return activeThemeVariant;
}

function applyThemeDefinition(theme: ThemeDefinition): void {
	const panel = buildPanelBase(theme);
	const tab = buildTabBase(theme);
	const headerButtons = buildHeaderButtonBase(theme);
	const search = theme.overlays.search;
	const completion = theme.overlays.completion;
	const action = theme.overlays.action;
	const symbolSearch = theme.overlays.symbolSearch;
	const quickOpen = theme.overlays.quickOpen;
	const parameterHint = theme.overlays.parameterHint;

	COLOR_FRAME = theme.surfaces.frame;
	COLOR_TOP_BAR = theme.surfaces.topBar;
	COLOR_TOP_BAR_TEXT = theme.text.topBar;
	COLOR_CODE_BACKGROUND = theme.surfaces.editor;
	COLOR_GUTTER_BACKGROUND = theme.surfaces.gutter;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT = theme.text.primary;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_KEYWORD = theme.text.keyword;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING = theme.text.string;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_NUMBER = theme.text.number;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_COMMENT = theme.text.comment;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR = theme.text.operator;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM = theme.text.dim;
	COLOR_BREAKPOINT_BORDER = theme.text.topBar;
	COLOR_BREAKPOINT_FILL = theme.status.alert;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_BUILTIN = theme.text.builtin;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_FUNCTION_NAME = theme.text.functionName;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_PARAMETER = theme.text.parameter;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_GLOBAL_VARIABLE = theme.text.globalVar;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_LABEL = theme.text.label;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_LOCAL_TOP = theme.text.localTop;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_LOCAL_FUNCTION = theme.text.localFunction;
	COLOR_SYNTAX_HIGHLIGHTS.COLOR_FUNCTION_HANDLE = theme.text.functionHandle;
	HIGHLIGHT_OVERLAY = theme.highlightOverlay;
	SELECTION_OVERLAY = theme.text.selection;
	CARET_COLOR = theme.caret.editor;
	INLINE_CARET_COLOR = theme.caret.inline;
	SEARCH_RESULT_SELECTION_OVERLAY = theme.text.selection;
	SEARCH_RESULT_HOVER_OVERLAY = theme.highlightOverlay;
	COLOR_STATUS_BACKGROUND = theme.status.background;
	COLOR_STATUS_TEXT = theme.status.text;
	COLOR_STATUS_WARNING = theme.status.warning;
	COLOR_STATUS_SUCCESS = theme.status.success;
	COLOR_STATUS_ERROR = theme.status.error;
	COLOR_STATUS_ALERT = theme.status.alert;
	COLOR_DIAGNOSTIC_WARNING = theme.status.warning;
	COLOR_PROBLEMS_PANEL_BACKGROUND = panel.problems.background;
	COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND = panel.problems.headerBackground;
	COLOR_PROBLEMS_PANEL_HEADER_TEXT = panel.problems.headerText;
	COLOR_PROBLEMS_PANEL_BORDER = panel.problems.border;
	COLOR_PROBLEMS_PANEL_TEXT = panel.problems.text;
	COLOR_PROBLEMS_PANEL_LOCATION = panel.problems.location;
	COLOR_PROBLEMS_PANEL_HOVER_TEXT = panel.problems.hoverText;
	COLOR_PROBLEMS_PANEL_SELECTION_BORDER = panel.problems.selectionBorder;
	COLOR_RESOURCE_PANEL_BACKGROUND = panel.resource.background;
	COLOR_RESOURCE_PANEL_TEXT = panel.resource.text;
	COLOR_RESOURCE_PANEL_HIGHLIGHT = panel.resource.highlight;
	COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT = panel.resource.highlightText;
	COLOR_RESOURCE_VIEWER_BACKGROUND = panel.resource.viewerBackground;
	COLOR_RESOURCE_VIEWER_TEXT = panel.resource.viewerText;
	COLOR_SEARCH_SECONDARY_TEXT = search.secondaryText;
	COLOR_SEARCH_TEXT = search.text;
	COLOR_SEARCH_PLACEHOLDER = search.placeholder;
	COLOR_SEARCH_OUTLINE = search.outline;
	COLOR_SEARCH_BACKGROUND = search.background;
	COLOR_LINE_JUMP_BACKGROUND = search.background;
	COLOR_LINE_JUMP_TEXT = search.text;
	COLOR_LINE_JUMP_PLACEHOLDER = search.placeholder;
	COLOR_LINE_JUMP_OUTLINE = search.outline;
	ERROR_OVERLAY_TEXT_COLOR = theme.text.errorOverlayText;
	HOVER_TOOLTIP_BORDER = theme.text.topBar;
	COLOR_CREATE_RESOURCE_BACKGROUND = search.background;
	COLOR_CREATE_RESOURCE_TEXT = search.text;
	COLOR_CREATE_RESOURCE_PLACEHOLDER = search.placeholder;
	COLOR_CREATE_RESOURCE_OUTLINE = search.outline;
	COLOR_CREATE_RESOURCE_ERROR = theme.status.warning;
	COLOR_SERVER_STATUS_CONNECTED = theme.server_status.connected;
	COLOR_SERVER_STATUS_DISCONNECTED = theme.server_status.disconnected;
	COLOR_HEADER_BUTTON_BACKGROUND = headerButtons.background;
	COLOR_HEADER_BUTTON_BORDER = headerButtons.border;
	COLOR_HEADER_BUTTON_DISABLED_BACKGROUND = headerButtons.disabledBackground;
	COLOR_HEADER_BUTTON_TEXT = headerButtons.text;
	COLOR_HEADER_BUTTON_TEXT_DISABLED = headerButtons.disabledText;
	COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND = headerButtons.activeBackground;
	COLOR_HEADER_BUTTON_ACTIVE_TEXT = headerButtons.activeText;
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
	COLOR_GOTO_UNDERLINE = tab.border;
	RESOURCE_PANEL_DIVIDER_COLOR = tab.border;
	SCROLLBAR_TRACK_COLOR = theme.status.background;
	SCROLLBAR_THUMB_COLOR = theme.scrollbarThumb ?? theme.status.text;
	COLOR_SYMBOL_SEARCH_BACKGROUND = symbolSearch.background;
	COLOR_SYMBOL_SEARCH_TEXT = symbolSearch.text;
	COLOR_SYMBOL_SEARCH_PLACEHOLDER = symbolSearch.placeholder;
	COLOR_SYMBOL_SEARCH_OUTLINE = symbolSearch.outline;
	COLOR_SYMBOL_SEARCH_KIND = symbolSearch.kind;
	COLOR_QUICK_OPEN_BACKGROUND = quickOpen.background;
	COLOR_QUICK_OPEN_TEXT = quickOpen.text;
	COLOR_QUICK_OPEN_PLACEHOLDER = quickOpen.placeholder;
	COLOR_QUICK_OPEN_OUTLINE = quickOpen.outline;
	COLOR_QUICK_OPEN_KIND = quickOpen.kind;
	COLOR_COMPLETION_BACKGROUND = completion.background;
	COLOR_COMPLETION_BORDER = completion.border;
	COLOR_COMPLETION_TEXT = completion.text;
	COLOR_COMPLETION_DETAIL = completion.detail;
	COLOR_COMPLETION_PREVIEW_TEXT = completion.previewText;
	COLOR_COMPLETION_HIGHLIGHT = completion.highlight;
	COLOR_COMPLETION_HIGHLIGHT_TEXT = completion.highlightText;
	COLOR_PARAMETER_HINT_BACKGROUND = parameterHint.background;
	COLOR_PARAMETER_HINT_BORDER = parameterHint.border;
	COLOR_PARAMETER_HINT_TEXT = parameterHint.text;
	COLOR_PARAMETER_HINT_ACTIVE = parameterHint.active;
}
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
export const DEFAULT_NEW_FSM_RESOURCE_CONTENT = `\n`;
export const HEADER_BUTTON_PADDING_X = 5;
export const HEADER_BUTTON_PADDING_Y = 1;
export const HEADER_BUTTON_SPACING = 4;
export const ACTION_OVERLAY_COLOR = 58;
export const TAB_BUTTON_PADDING_X = 4;
export const TAB_BUTTON_PADDING_Y = 1;
export const TAB_BUTTON_SPACING = 3;
export const TAB_DRAG_ACTIVATION_THRESHOLD = 8;
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
export const SYMBOL_SEARCH_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;
export const SYMBOL_SEARCH_MAX_RESULTS = 8;
export const SYMBOL_SEARCH_RESULT_PADDING_X = 4;
export const SYMBOL_SEARCH_RESULT_SPACING = 1;
export const SEARCH_RESULT_SPACING = SYMBOL_SEARCH_RESULT_SPACING;
export const SYMBOL_SEARCH_COMPACT_MAX_RESULTS = 4;
export const SYMBOL_SEARCH_COMPACT_WIDTH = 320;
export const QUICK_OPEN_BAR_MARGIN_Y = SYMBOL_SEARCH_BAR_MARGIN_Y;
export const QUICK_OPEN_RESULT_PADDING_X = SYMBOL_SEARCH_RESULT_PADDING_X;
export const QUICK_OPEN_RESULT_SPACING = SYMBOL_SEARCH_RESULT_SPACING;
export const QUICK_OPEN_MAX_RESULTS = SYMBOL_SEARCH_MAX_RESULTS;
export const QUICK_OPEN_COMPACT_MAX_RESULTS = SYMBOL_SEARCH_COMPACT_MAX_RESULTS;
export const REFERENCE_SEARCH_MAX_RESULTS = SYMBOL_SEARCH_MAX_RESULTS;
export const SEARCH_MAX_RESULTS = SYMBOL_SEARCH_MAX_RESULTS;
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
export const EDITOR_TOGGLE_KEY = 'F1';
export const VM_TOGGLE_KEY = 'F2';
export const ESCAPE_KEY = 'Escape';
export const EDITOR_TOGGLE_GAMEPAD_BUTTONS: readonly BGamepadButton[] = ['select', 'start'];
export const GAME_PAUSE_KEY = 'F5';
export const GLOBAL_SEARCH_RESULT_LIMIT = SEARCH_MAX_RESULTS * 4;

export const TAB_DIRTY_MARKER_METRICS = { width: 4, height: 4 };
export const TAB_DIRTY_LEFT_MARGIN = 4;
export const TAB_DIRTY_RIGHT_MARGIN = 4;
