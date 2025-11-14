import type { BGamepadButton } from '../../input/inputtypes';
import { Msx1Colors } from '../../systems/msx';

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
	veryDarkBlue: 17 // Extended palette color
};

const THEME_BASE = {
	surfaces: {
		frame: PALETTE.white,
		topBar: PALETTE.grey,
		editor: PALETTE.veryDarkBlue,
		gutter: PALETTE.grey,
		resourcePanel: PALETTE.grey,
		resourcePanelHighlight: PALETTE.black,
		resourceViewer: PALETTE.black,
		tabInactive: PALETTE.grey,
		tabActive: PALETTE.black
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
		localTop: PALETTE.white,
		localFunction: PALETTE.white,
		functionHandle: PALETTE.lightGreen,
		selection: PALETTE.black,
	},
	status: {
		background: PALETTE.grey,
		text: PALETTE.black,
		warning: PALETTE.lightRed,
		success: PALETTE.darkBlue,
		error: PALETTE.white,
		alert: PALETTE.red
	},
	input: {
		text: PALETTE.black,
		secondaryText: PALETTE.magenta,
		placeholder: PALETTE.lightRed,
		outline: PALETTE.black
	},
	tab: {
		border: PALETTE.darkBlue,
		activeText: PALETTE.grey,
		inactiveText: PALETTE.black
	},
	server_status: {
		connected: PALETTE.darkGreen,
		disconnected: PALETTE.red,
	}
};

const PANEL_BASE = {
	problems: {
		background: THEME_BASE.status.background,
		headerBackground: THEME_BASE.surfaces.topBar,
		headerText: THEME_BASE.text.topBar,
		border: THEME_BASE.text.topBar,
		text: THEME_BASE.status.text,
		location: THEME_BASE.text.dim,
		hoverText: THEME_BASE.status.warning
	},
	resource: {
		background: THEME_BASE.surfaces.resourcePanel,
		text: THEME_BASE.status.text,
		highlight: THEME_BASE.surfaces.resourcePanelHighlight,
		highlightText: THEME_BASE.text.primary,
		viewerBackground: THEME_BASE.surfaces.resourceViewer,
		viewerText: THEME_BASE.text.primary
	}
};

const TAB_BASE = {
	barBackground: THEME_BASE.status.background,
	border: THEME_BASE.tab.border,
	inactiveBackground: THEME_BASE.surfaces.tabInactive,
	activeBackground: THEME_BASE.surfaces.tabActive,
	inactiveText: THEME_BASE.tab.inactiveText,
	activeText: THEME_BASE.tab.activeText,
	dirtyMarker: THEME_BASE.status.warning
};

const SEARCH_BASE = {
	background: PALETTE.lightBlue,
	text: THEME_BASE.input.text,
	secondaryText: THEME_BASE.input.secondaryText,
	placeholder: THEME_BASE.input.placeholder,
	outline: THEME_BASE.input.outline
};

const COMPLETION_BASE = {
	background: SEARCH_BASE.background,
	border: SEARCH_BASE.outline,
	text: SEARCH_BASE.text,
	detail: SEARCH_BASE.secondaryText,
	highlight: TAB_BASE.activeBackground,
	highlightText: TAB_BASE.activeText
};

const ACTION_BASE = {
	dialogBackground: SEARCH_BASE.background,
	dialogBorder: SEARCH_BASE.outline,
	dialogText: SEARCH_BASE.text,
	buttonBackground: THEME_BASE.status.background,
	buttonText: THEME_BASE.status.text
};

const HEADER_BUTTON_BASE = {
	background: THEME_BASE.status.background,
	border: THEME_BASE.text.topBar,
	disabledBackground: THEME_BASE.surfaces.gutter,
	text: THEME_BASE.text.topBar,
	disabledText: THEME_BASE.text.dim,
	activeBackground: THEME_BASE.status.warning,
	activeText: THEME_BASE.text.topBar
};

const SYMBOL_SEARCH_BASE = {
	background: SEARCH_BASE.background,
	text: SEARCH_BASE.text,
	placeholder: SEARCH_BASE.placeholder,
	outline: SEARCH_BASE.outline,
	kind: SEARCH_BASE.secondaryText
};

const QUICK_OPEN_BASE = {
	background: SYMBOL_SEARCH_BASE.background,
	text: SEARCH_BASE.text,
	placeholder: SEARCH_BASE.placeholder,
	outline: SEARCH_BASE.outline,
	kind: SEARCH_BASE.secondaryText
};

const PARAMETER_HINT_BASE = {
	background: SEARCH_BASE.background,
	border: SEARCH_BASE.outline,
	text: SEARCH_BASE.text,
	active: THEME_BASE.status.warning
};

export const COLOR_FRAME = THEME_BASE.surfaces.frame;
export const COLOR_TOP_BAR = THEME_BASE.surfaces.topBar;
export const COLOR_TOP_BAR_TEXT = THEME_BASE.text.topBar;
export const COLOR_CODE_BACKGROUND = THEME_BASE.surfaces.editor;
export const COLOR_GUTTER_BACKGROUND = THEME_BASE.surfaces.gutter;
export const COLOR_CODE_TEXT = THEME_BASE.text.primary;
export const COLOR_KEYWORD = THEME_BASE.text.keyword;
export const COLOR_STRING = THEME_BASE.text.string;
export const COLOR_NUMBER = THEME_BASE.text.number;
export const COLOR_COMMENT = THEME_BASE.text.comment;
export const COLOR_OPERATOR = THEME_BASE.text.operator;
export const COLOR_CODE_DIM = THEME_BASE.text.dim;
export const COLOR_BREAKPOINT_BORDER = Msx1Colors[THEME_BASE.text.topBar];
export const COLOR_BREAKPOINT_FILL = Msx1Colors[THEME_BASE.status.alert];
export const COLOR_BUILTIN = THEME_BASE.text.builtin;
export const COLOR_FUNCTION_NAME = THEME_BASE.text.functionName;
export const COLOR_PARAMETER = THEME_BASE.text.parameter;
export const COLOR_GLOBAL_VARIABLE = THEME_BASE.text.globalVar;
export const COLOR_LABEL = THEME_BASE.text.label;
export const COLOR_LOCAL_TOP = THEME_BASE.text.localTop;
export const COLOR_LOCAL_FUNCTION = THEME_BASE.text.localFunction;
export const COLOR_FUNCTION_HANDLE = THEME_BASE.text.functionHandle;
export const HIGHLIGHT_OVERLAY = Msx1Colors[THEME_BASE.surfaces.editor]; //Msx1Colors[PALETTE.darkBlue];
export const SELECTION_OVERLAY = Msx1Colors[THEME_BASE.text.selection];
export const CARET_COLOR = Msx1Colors[PALETTE.white];
export const INLINE_CARET_COLOR = Msx1Colors[PALETTE.black];
export const COLOR_STATUS_BACKGROUND = THEME_BASE.status.background;
export const COLOR_STATUS_TEXT = THEME_BASE.status.text;
export const COLOR_STATUS_WARNING = THEME_BASE.status.warning;
export const COLOR_STATUS_SUCCESS = THEME_BASE.status.success;
export const COLOR_STATUS_ERROR = THEME_BASE.status.error;
export const COLOR_STATUS_ALERT = THEME_BASE.status.alert;
export const COLOR_DIAGNOSTIC_ERROR = PALETTE.lightRed;
export const COLOR_DIAGNOSTIC_WARNING = THEME_BASE.status.warning;
export const COLOR_PROBLEMS_PANEL_BACKGROUND = PANEL_BASE.problems.background;
export const COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND = PANEL_BASE.problems.headerBackground;
export const COLOR_PROBLEMS_PANEL_HEADER_TEXT = PANEL_BASE.problems.headerText;
export const COLOR_PROBLEMS_PANEL_BORDER = PANEL_BASE.problems.border;
export const COLOR_PROBLEMS_PANEL_TEXT = PANEL_BASE.problems.text;
export const COLOR_PROBLEMS_PANEL_LOCATION = PANEL_BASE.problems.location;
export const COLOR_PROBLEMS_PANEL_HOVER_TEXT = PANEL_BASE.problems.hoverText;
export const COLOR_RESOURCE_PANEL_BACKGROUND = PANEL_BASE.resource.background;
export const COLOR_RESOURCE_PANEL_TEXT = PANEL_BASE.resource.text;
export const COLOR_RESOURCE_PANEL_HIGHLIGHT = PANEL_BASE.resource.highlight;
export const COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT = PANEL_BASE.resource.highlightText;
export const COLOR_RESOURCE_VIEWER_BACKGROUND = PANEL_BASE.resource.viewerBackground;
export const COLOR_RESOURCE_VIEWER_TEXT = PANEL_BASE.resource.viewerText;
export const COLOR_SEARCH_SECONDARY_TEXT = SEARCH_BASE.secondaryText;
export const COLOR_SEARCH_TEXT = SEARCH_BASE.text;
export const COLOR_SEARCH_PLACEHOLDER = SEARCH_BASE.placeholder;
export const COLOR_SEARCH_OUTLINE = SEARCH_BASE.outline;
export const COLOR_SEARCH_BACKGROUND = SEARCH_BASE.background;
export const SEARCH_MATCH_OVERLAY = { r: 0.9, g: 0.35, b: 0.35, a: 0.38 };
export const SEARCH_MATCH_ACTIVE_OVERLAY = { r: 1, g: 0.85, b: 0.25, a: 0.6 };
export const REFERENCES_MATCH_OVERLAY = { r: 0.25, g: 0.62, b: 0.95, a: 0.32 };
export const REFERENCES_MATCH_ACTIVE_OVERLAY = { r: 0.18, g: 0.44, b: 0.9, a: 0.54 };
export const SEARCH_BAR_MARGIN_Y = 2;
export const COLOR_LINE_JUMP_BACKGROUND = SEARCH_BASE.background;
export const COLOR_LINE_JUMP_TEXT = SEARCH_BASE.text;
export const COLOR_LINE_JUMP_PLACEHOLDER = SEARCH_BASE.placeholder;
export const COLOR_LINE_JUMP_OUTLINE = SEARCH_BASE.outline;
export const ERROR_OVERLAY_BACKGROUND = { r: 0.6, g: 0, b: 0, a: 1 };
export const ERROR_OVERLAY_BACKGROUND_HOVER = { r: 0.75, g: 0.1, b: 0.1, a: 1 };
export const ERROR_OVERLAY_LINE_HOVER = { r: 1, g: 1, b: 1, a: 0.18 };
export const ERROR_OVERLAY_PADDING_X = 4;
export const ERROR_OVERLAY_PADDING_Y = 2;
export const ERROR_OVERLAY_CONNECTOR_OFFSET = 6;
export const ERROR_OVERLAY_TEXT_COLOR = THEME_BASE.text.primary;
export const EXECUTION_STOP_OVERLAY = { r: 0.95, g: 0.45, b: 0.1, a: 0.45 };
export const HOVER_TOOLTIP_PADDING_X = 4;
export const HOVER_TOOLTIP_PADDING_Y = 2;
export const HOVER_TOOLTIP_BACKGROUND = { r: 0.1, g: 0.1, b: 0.1, a: 0.9 };
export const HOVER_TOOLTIP_BORDER = THEME_BASE.text.topBar;
export const HOVER_TOOLTIP_MAX_VISIBLE_LINES = 10;
export const HOVER_TOOLTIP_MAX_LINE_LENGTH = 160;
export const LINE_JUMP_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;
export const COLOR_CREATE_RESOURCE_BACKGROUND = SEARCH_BASE.background;
export const COLOR_CREATE_RESOURCE_TEXT = SEARCH_BASE.text;
export const COLOR_CREATE_RESOURCE_PLACEHOLDER = SEARCH_BASE.placeholder;
export const COLOR_CREATE_RESOURCE_OUTLINE = SEARCH_BASE.outline;
export const COLOR_CREATE_RESOURCE_ERROR = THEME_BASE.status.warning;
export const COLOR_SERVER_STATUS_CONNECTED = THEME_BASE.server_status.connected;
export const COLOR_SERVER_STATUS_DISCONNECTED = THEME_BASE.server_status.disconnected;
export const CREATE_RESOURCE_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;
export const CREATE_RESOURCE_MAX_PATH_LENGTH = 1024;
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
export const DEFAULT_NEW_LUA_RESOURCE_CONTENT = '-- New Lua resource\n';
export const DEFAULT_NEW_FSM_RESOURCE_CONTENT = `return {
\tid = '<MACHINE_ID>',
\tstates = {
\t\t_idle = { -- '_'-prefix to make it the initial state
\t\t\ttimeline = {
\t\t\t\tid = '<MACHINE_ID>.idle',
\t\t\t\tframes = { 0 },
\t\t\t\tticks_per_frame = 50,
\t\t\t},
\t\t\tentering_state = function(self, state, payload)
\t\t\tend,
\t\t\ttape_next = function(self, state, payload)
\t\t\t\treturn '../running'
\t\t\tend,
\t\t\ton = {
\t\t\t\t['$start'] = '../running' -- '$'-prefix to denote self-scoped event
\t\t\t}
\t\t},
\t\trunning = {
\t\t\ttimeline = {
\t\t\t\tid = '<MACHINE_ID>.running',
\t\t\t\tframes = { 0 },
\t\t\t\tticks_per_frame = 100,
\t\t\t},
\t\t\tentering_state = function(self, state, payload)
\t\t\tend,
\t\t\ttape_next = function(self, state, payload)
\t\t\t\treturn '../_idle'
\t\t\tend,
\t\t\ton = {
\t\t\t\t['$stop'] = '../idle'
\t\t\t}
\t\t}
\t}
}
`;
export const HEADER_BUTTON_PADDING_X = 5;
export const HEADER_BUTTON_PADDING_Y = 1;
export const HEADER_BUTTON_SPACING = 4;
export const COLOR_HEADER_BUTTON_BACKGROUND = HEADER_BUTTON_BASE.background;
export const COLOR_HEADER_BUTTON_BORDER = HEADER_BUTTON_BASE.border;
export const COLOR_HEADER_BUTTON_DISABLED_BACKGROUND = HEADER_BUTTON_BASE.disabledBackground;
export const COLOR_HEADER_BUTTON_TEXT = HEADER_BUTTON_BASE.text;
export const COLOR_HEADER_BUTTON_TEXT_DISABLED = HEADER_BUTTON_BASE.disabledText;
export const COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND = HEADER_BUTTON_BASE.activeBackground;
export const COLOR_HEADER_BUTTON_ACTIVE_TEXT = HEADER_BUTTON_BASE.activeText;
export const ACTION_OVERLAY_COLOR = { r: 0, g: 0, b: 0, a: 0.65 };
export const ACTION_DIALOG_BACKGROUND_COLOR = ACTION_BASE.dialogBackground;
export const ACTION_DIALOG_BORDER_COLOR = ACTION_BASE.dialogBorder;
export const ACTION_DIALOG_TEXT_COLOR = ACTION_BASE.dialogText;
export const ACTION_BUTTON_BACKGROUND = ACTION_BASE.buttonBackground;
export const ACTION_BUTTON_TEXT = ACTION_BASE.buttonText;
export const TAB_BUTTON_PADDING_X = 4;
export const TAB_BUTTON_PADDING_Y = 1;
export const TAB_BUTTON_SPACING = 3;
export const TAB_DRAG_ACTIVATION_THRESHOLD = 8;
export const TAB_DIRTY_MARKER_SPACING = 2;
export const COLOR_TAB_BAR_BACKGROUND = TAB_BASE.barBackground;
export const COLOR_TAB_BORDER = TAB_BASE.border;
export const COLOR_TAB_INACTIVE_BACKGROUND = TAB_BASE.inactiveBackground;
export const COLOR_TAB_ACTIVE_BACKGROUND = TAB_BASE.activeBackground;
export const COLOR_TAB_INACTIVE_TEXT = TAB_BASE.inactiveText;
export const COLOR_TAB_ACTIVE_TEXT = TAB_BASE.activeText;
export const COLOR_TAB_DIRTY_MARKER = TAB_BASE.dirtyMarker;
export const TAB_CLOSE_BUTTON_PADDING_X = 3;
export const TAB_CLOSE_BUTTON_PADDING_Y = 1;
export const TAB_CLOSE_BUTTON_SYMBOL = 'x';
export const COLOR_GOTO_UNDERLINE = TAB_BASE.border; // Black
export const RESOURCE_VIEWER_MAX_LINES = 512;
export const RESOURCE_PANEL_MIN_RATIO = 0.18;
export const RESOURCE_PANEL_MAX_RATIO = 0.6;
export const RESOURCE_PANEL_DEFAULT_RATIO = 0.3;
export const RESOURCE_PANEL_MIN_EDITOR_RATIO = 0.35;
export const RESOURCE_PANEL_DIVIDER_COLOR = TAB_BASE.border;
export const RESOURCE_PANEL_PADDING_X = 4;
export const RESOURCE_PANEL_DIVIDER_DRAG_MARGIN = 4;
export const SCROLLBAR_WIDTH = 3;
export const CODE_AREA_RIGHT_MARGIN = 6;
export const SCROLLBAR_MIN_THUMB_HEIGHT = 6;
export const SCROLLBAR_TRACK_COLOR = THEME_BASE.status.background;
export const SCROLLBAR_THUMB_COLOR = THEME_BASE.status.text;
export const SYMBOL_SEARCH_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;
export const SYMBOL_SEARCH_MAX_RESULTS = 8;
export const COLOR_SYMBOL_SEARCH_BACKGROUND = SYMBOL_SEARCH_BASE.background;
export const COLOR_SYMBOL_SEARCH_TEXT = SYMBOL_SEARCH_BASE.text;
export const COLOR_SYMBOL_SEARCH_PLACEHOLDER = SYMBOL_SEARCH_BASE.placeholder;
export const COLOR_SYMBOL_SEARCH_OUTLINE = SYMBOL_SEARCH_BASE.outline;
export const COLOR_SYMBOL_SEARCH_KIND = SYMBOL_SEARCH_BASE.kind;
export const SYMBOL_SEARCH_RESULT_PADDING_X = 4;
export const SYMBOL_SEARCH_RESULT_SPACING = 1;
export const SEARCH_RESULT_SPACING = SYMBOL_SEARCH_RESULT_SPACING;
export const SYMBOL_SEARCH_COMPACT_MAX_RESULTS = 4;
export const SYMBOL_SEARCH_COMPACT_WIDTH = 320;
export const QUICK_OPEN_BAR_MARGIN_Y = SYMBOL_SEARCH_BAR_MARGIN_Y;
export const QUICK_OPEN_RESULT_PADDING_X = SYMBOL_SEARCH_RESULT_PADDING_X;
export const QUICK_OPEN_RESULT_SPACING = SYMBOL_SEARCH_RESULT_SPACING;
export const COLOR_QUICK_OPEN_BACKGROUND = QUICK_OPEN_BASE.background;
export const COLOR_QUICK_OPEN_TEXT = QUICK_OPEN_BASE.text;
export const COLOR_QUICK_OPEN_PLACEHOLDER = QUICK_OPEN_BASE.placeholder;
export const COLOR_QUICK_OPEN_OUTLINE = QUICK_OPEN_BASE.outline;
export const COLOR_QUICK_OPEN_KIND = QUICK_OPEN_BASE.kind;
export const QUICK_OPEN_MAX_RESULTS = SYMBOL_SEARCH_MAX_RESULTS;
export const QUICK_OPEN_COMPACT_MAX_RESULTS = SYMBOL_SEARCH_COMPACT_MAX_RESULTS;
export const REFERENCE_SEARCH_MAX_RESULTS = SYMBOL_SEARCH_MAX_RESULTS;
export const SEARCH_MAX_RESULTS = SYMBOL_SEARCH_MAX_RESULTS;
export const COMPLETION_POPUP_PADDING_X = 4;
export const COMPLETION_POPUP_PADDING_Y = 2;
export const COMPLETION_POPUP_ITEM_SPACING = 1;
export const COMPLETION_POPUP_MAX_VISIBLE = 8;
export const COMPLETION_POPUP_MIN_WIDTH = 96;
export const COLOR_COMPLETION_BACKGROUND = COMPLETION_BASE.background;
export const COLOR_COMPLETION_BORDER = COMPLETION_BASE.border;
export const COLOR_COMPLETION_TEXT = COMPLETION_BASE.text;
export const COLOR_COMPLETION_DETAIL = COMPLETION_BASE.detail;
export const COLOR_COMPLETION_HIGHLIGHT = COMPLETION_BASE.highlight;
export const COLOR_COMPLETION_HIGHLIGHT_TEXT = COMPLETION_BASE.highlightText;
export const PARAMETER_HINT_PADDING_X = 4;
export const PARAMETER_HINT_PADDING_Y = 2;
export const COLOR_PARAMETER_HINT_BACKGROUND = PARAMETER_HINT_BASE.background;
export const COLOR_PARAMETER_HINT_BORDER = PARAMETER_HINT_BASE.border;
export const COLOR_PARAMETER_HINT_TEXT = PARAMETER_HINT_BASE.text;
export const COLOR_PARAMETER_HINT_ACTIVE = PARAMETER_HINT_BASE.active;
export const COMPLETION_AUTO_TRIGGER_DELAY_SECONDS = 0.16;
export const EDITOR_TOGGLE_KEY = 'F1';
export const ESCAPE_KEY = 'Escape';
export const EDITOR_TOGGLE_GAMEPAD_BUTTONS: readonly BGamepadButton[] = ['select', 'start'];
export const GLOBAL_SEARCH_RESULT_LIMIT = SEARCH_MAX_RESULTS * 4;
