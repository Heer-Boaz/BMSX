import { $ } from '../core/game';
import type { KeyboardInput } from '../input/keyboardinput';
import type { ButtonState } from '../input/inputtypes';
import type { ClipboardService, ViewportMetrics } from '../platform/platform';
import type { BmsxConsoleApi } from './api';
import type { BmsxConsoleMetadata, ConsoleViewport, ConsoleResourceDescriptor, ConsoleLuaHoverRequest, ConsoleLuaHoverResult, ConsoleLuaHoverScope, ConsoleLuaHoverValueState, ConsoleLuaResourceCreationRequest, ConsoleLuaDefinitionLocation, ConsoleLuaSymbolEntry } from './types';
import { ConsoleEditorFont } from './editor_font';
import { Msx1Colors } from '../systems/msx';
import { clamp } from '../utils/utils';

type CharacterMapEntry = {
	normal: string;
	shift: string;
};

const CHARACTER_MAP: { [code: string]: CharacterMapEntry } = {
	KeyA: { normal: 'a', shift: 'A' },
	KeyB: { normal: 'b', shift: 'B' },
	KeyC: { normal: 'c', shift: 'C' },
	KeyD: { normal: 'd', shift: 'D' },
	KeyE: { normal: 'e', shift: 'E' },
	KeyF: { normal: 'f', shift: 'F' },
	KeyG: { normal: 'g', shift: 'G' },
	KeyH: { normal: 'h', shift: 'H' },
	KeyI: { normal: 'i', shift: 'I' },
	KeyJ: { normal: 'j', shift: 'J' },
	KeyK: { normal: 'k', shift: 'K' },
	KeyL: { normal: 'l', shift: 'L' },
	KeyM: { normal: 'm', shift: 'M' },
	KeyN: { normal: 'n', shift: 'N' },
	KeyO: { normal: 'o', shift: 'O' },
	KeyP: { normal: 'p', shift: 'P' },
	KeyQ: { normal: 'q', shift: 'Q' },
	KeyR: { normal: 'r', shift: 'R' },
	KeyS: { normal: 's', shift: 'S' },
	KeyT: { normal: 't', shift: 'T' },
	KeyU: { normal: 'u', shift: 'U' },
	KeyV: { normal: 'v', shift: 'V' },
	KeyW: { normal: 'w', shift: 'W' },
	KeyX: { normal: 'x', shift: 'X' },
	KeyY: { normal: 'y', shift: 'Y' },
	KeyZ: { normal: 'z', shift: 'Z' },
	Digit0: { normal: '0', shift: ')' },
	Digit1: { normal: '1', shift: '!' },
	Digit2: { normal: '2', shift: '@' },
	Digit3: { normal: '3', shift: '#' },
	Digit4: { normal: '4', shift: '$' },
	Digit5: { normal: '5', shift: '%' },
	Digit6: { normal: '6', shift: '^' },
	Digit7: { normal: '7', shift: '&' },
	Digit8: { normal: '8', shift: '*' },
	Digit9: { normal: '9', shift: '(' },
	Minus: { normal: '-', shift: '_' },
	Equal: { normal: '=', shift: '+' },
	BracketLeft: { normal: '[', shift: '{' },
	BracketRight: { normal: ']', shift: '}' },
	Backslash: { normal: '\\', shift: '|' },
	Semicolon: { normal: ';', shift: ':' },
	Quote: { normal: '\'', shift: '"' },
	Comma: { normal: ',', shift: '<' },
	Period: { normal: '.', shift: '>' },
	Slash: { normal: '/', shift: '?' },
	Backquote: { normal: '`', shift: '~' },
};
const CHARACTER_CODES = Object.keys(CHARACTER_MAP);

type RepeatEntry = {
	cooldown: number;
};

export type ConsoleEditorOptions = {
	playerIndex: number;
	viewport: ConsoleViewport;
	metadata: BmsxConsoleMetadata;
	loadSource: () => string;
	saveSource: (source: string) => Promise<void>;
	listResources: () => ConsoleResourceDescriptor[];
	loadLuaResource: (assetId: string) => string;
	saveLuaResource: (assetId: string, source: string) => Promise<void>;
	createLuaResource: (request: ConsoleLuaResourceCreationRequest) => Promise<ConsoleResourceDescriptor>;
	inspectLuaExpression: (request: ConsoleLuaHoverRequest) => ConsoleLuaHoverResult | null;
	primaryAssetId: string | null;
	listLuaSymbols: (assetId: string | null, chunkName: string | null) => ConsoleLuaSymbolEntry[];
	listGlobalLuaSymbols: () => ConsoleLuaSymbolEntry[];
};

export type Position = { row: number; column: number };

export type MessageState = {
	text: string;
	color: number;
	timer: number;
	visible: boolean;
};

type HighlightLine = {
	chars: string[];
	colors: number[];
	columnToDisplay: number[];
};

type CachedHighlight = {
	src: string;
	hi: HighlightLine;
	displayToColumn: number[];
	advancePrefix: number[];
};

export type SearchMatch = {
	row: number;
	start: number;
	end: number;
};

export type EditorSnapshot = {
	lines: string[];
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position | null;
	dirty: boolean;
};

type RectBounds = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

type SymbolCatalogEntry = {
	symbol: ConsoleLuaSymbolEntry;
	displayName: string;
	searchKey: string;
	line: number;
	kindLabel: string;
	sourceLabel: string | null;
};

type SymbolSearchResult = {
	entry: SymbolCatalogEntry;
	matchIndex: number;
};

type TopBarButtonId = 'resume' | 'reboot' | 'save' | 'resources';

type EditorTabId = `resource:${string}` | `lua:${string}`;
type EditorTabKind = 'resource_view' | 'lua_editor';

type ScrollbarKind = 'codeVertical' | 'codeHorizontal' | 'resourceVertical' | 'resourceHorizontal' | 'viewerVertical';

class ConsoleScrollbar {
	public readonly orientation: 'vertical' | 'horizontal';
	private track: RectBounds | null = null;
	private thumb: RectBounds | null = null;
	private scrollValue = 0;
	private maxScrollValue = 0;
	private viewportSize = 0;
	private contentSize = 0;

	constructor(public readonly kind: ScrollbarKind, orientation: 'vertical' | 'horizontal') {
		this.orientation = orientation;
	}

	public layout(track: RectBounds, contentSize: number, viewportSize: number, scroll: number): void {
		this.track = track;
		this.contentSize = Math.max(0, contentSize);
		this.viewportSize = Math.max(0, viewportSize);
		this.maxScrollValue = Math.max(0, this.contentSize - this.viewportSize);
		this.scrollValue = clamp(scroll, 0, this.maxScrollValue);
		this.updateThumb();
	}

	private updateThumb(): void {
		if (!this.track || this.viewportSize <= 0 || this.contentSize <= this.viewportSize) {
			this.thumb = null;
			return;
		}
		const trackStart = this.orientation === 'vertical' ? this.track.top : this.track.left;
		const trackEnd = this.orientation === 'vertical' ? this.track.bottom : this.track.right;
		const trackLength = Math.max(0, trackEnd - trackStart);
		if (trackLength <= 0) {
			this.thumb = null;
			return;
		}
		const viewportRatio = clamp(this.viewportSize / this.contentSize, 0, 1);
		let thumbLength = Math.max(SCROLLBAR_MIN_THUMB_HEIGHT, trackLength * viewportRatio);
		if (thumbLength > trackLength) {
			thumbLength = trackLength;
		}
		if (thumbLength <= 0) {
			this.thumb = null;
			return;
		}
		const maxThumbTravel = Math.max(0, trackLength - thumbLength);
		const normalized = this.maxScrollValue === 0 ? 0 : this.scrollValue / this.maxScrollValue;
		const thumbStart = trackStart + normalized * maxThumbTravel;
		const thumbEnd = thumbStart + thumbLength;
		if (this.orientation === 'vertical') {
			this.thumb = { left: this.track.left, top: thumbStart, right: this.track.right, bottom: thumbEnd };
		} else {
			this.thumb = { left: thumbStart, top: this.track.top, right: thumbEnd, bottom: this.track.bottom };
		}
	}

	public draw(api: BmsxConsoleApi, trackColor: number, thumbColor: number): void {
		if (!this.track) {
			return;
		}
		api.rectfill(this.track.left, this.track.top, this.track.right, this.track.bottom, trackColor);
		const thumbRect = this.thumb;
		if (!thumbRect) {
			return;
		}
		api.rectfill(thumbRect.left, thumbRect.top, thumbRect.right, thumbRect.bottom, thumbColor);
	}

	public isVisible(): boolean {
		return this.thumb !== null;
	}

	public getTrack(): RectBounds | null {
		return this.track;
	}

	public getThumb(): RectBounds | null {
		return this.thumb;
	}

	public getMaxScroll(): number {
		return this.maxScrollValue;
	}

	public getScroll(): number {
		return this.scrollValue;
	}

	public beginDrag(pointer: number): number | null {
		if (!this.track || this.maxScrollValue <= 0) {
			return null;
		}
		const thumbRect = this.thumb;
		if (!thumbRect) {
			return null;
		}
		const trackStart = this.orientation === 'vertical' ? this.track.top : this.track.left;
		const trackEnd = this.orientation === 'vertical' ? this.track.bottom : this.track.right;
		const thumbStart = this.orientation === 'vertical' ? thumbRect.top : thumbRect.left;
		const thumbEnd = this.orientation === 'vertical' ? thumbRect.bottom : thumbRect.right;
		const thumbLength = this.orientation === 'vertical'
			? (thumbRect.bottom - thumbRect.top)
			: (thumbRect.right - thumbRect.left);
		if (pointer < trackStart || pointer > trackEnd) {
			return null;
		}
		if (pointer < thumbStart || pointer > thumbEnd) {
			const maxThumbTravel = Math.max(0, (trackEnd - trackStart) - thumbLength);
			const target = clamp(pointer - thumbLength * 0.5, trackStart, trackEnd - thumbLength);
			const normalized = maxThumbTravel === 0 ? 0 : (target - trackStart) / maxThumbTravel;
			this.scrollValue = clamp(normalized * this.maxScrollValue, 0, this.maxScrollValue);
			this.updateThumb();
			const updatedThumb = this.thumb;
			if (!updatedThumb) {
				return null;
			}
			const updatedStart = this.orientation === 'vertical' ? updatedThumb.top : updatedThumb.left;
			return clamp(pointer - updatedStart, 0, thumbLength);
		}
		return clamp(pointer - thumbStart, 0, thumbLength);
	}

	public drag(pointer: number, pointerOffset: number): number {
		if (!this.track || !this.thumb) {
			return this.scrollValue;
		}
		if (this.maxScrollValue <= 0) {
			this.scrollValue = 0;
			this.updateThumb();
			return this.scrollValue;
		}
		const trackStart = this.orientation === 'vertical' ? this.track.top : this.track.left;
		const trackEnd = this.orientation === 'vertical' ? this.track.bottom : this.track.right;
		const thumbLength = this.orientation === 'vertical'
			? (this.thumb.bottom - this.thumb.top)
			: (this.thumb.right - this.thumb.left);
		const maxThumbTravel = Math.max(0, (trackEnd - trackStart) - thumbLength);
		if (maxThumbTravel <= 0) {
			this.scrollValue = 0;
			this.updateThumb();
			return this.scrollValue;
		}
		const clampedPosition = clamp(pointer - pointerOffset, trackStart, trackEnd - thumbLength);
		const normalized = (clampedPosition - trackStart) / maxThumbTravel;
		this.scrollValue = clamp(normalized * this.maxScrollValue, 0, this.maxScrollValue);
		this.updateThumb();
		return this.scrollValue;
	}
}

type CodeHoverTooltip = {
	expression: string;
	contentLines: string[];
	valueType: string;
	scope: ConsoleLuaHoverScope;
	state: ConsoleLuaHoverValueState;
	assetId: string | null;
	row: number;
	startColumn: number;
	endColumn: number;
	scrollOffset: number;
	visibleLineCount: number;
	bubbleBounds: RectBounds | null;
};

type ResourceViewerState = {
	descriptor: ConsoleResourceDescriptor;
	lines: string[];
	error: string | null;
	title: string;
	scroll: number;
	image?: {
		assetId: string;
		width: number;
		height: number;
		atlassed: boolean;
		atlasId?: number;
	};
};

type EditorTabDescriptor = {
	id: EditorTabId | string;
	kind: EditorTabKind;
	title: string;
	closable: boolean;
	dirty: boolean;
	resource?: ResourceViewerState;
};

type ResourceBrowserItem = {
	line: string;
	contentStartColumn: number;
	descriptor: ConsoleResourceDescriptor | null;
};

type CodeTabContext = {
	id: string;
	title: string;
	descriptor: ConsoleResourceDescriptor | null;
	load: () => string;
	save: (source: string) => Promise<void>;
	snapshot: EditorSnapshot | null;
	lastSavedSource: string;
	saveGeneration: number;
	appliedGeneration: number;
	dirty: boolean;
	runtimeErrorOverlay: RuntimeErrorOverlay | null;
};

type PendingActionPrompt = {
	action: 'resume' | 'reboot' | 'close';
};

type ConsoleRuntimeBridge = {
	getState(): unknown;
	setState(state: unknown): void;
	boot(): void;
	reloadLuaProgram(source: string): Promise<void>;
};

export type ConsoleEditorSerializedState = {
	active: boolean;
	activeTab: EditorTabKind;
	snapshot: EditorSnapshot;
	searchQuery: string;
	searchMatches: SearchMatch[];
	searchCurrentIndex: number;
	searchActive: boolean;
	searchVisible: boolean;
	lineJumpValue: string;
	lineJumpActive: boolean;
	lineJumpVisible: boolean;
	message: MessageState;
	runtimeErrorOverlay: RuntimeErrorOverlay | null;
	saveGeneration: number;
	appliedGeneration: number;
};

type PointerSnapshot = {
	viewportX: number;
	viewportY: number;
	insideViewport: boolean;
	valid: boolean;
	primaryPressed: boolean;
};

type KeyPressRecord = {
	lastPressId: number | null;
};

type InlineTextField = {
	text: string;
	cursor: number;
	selectionAnchor: number | null;
	desiredColumn: number;
	pointerSelecting: boolean;
	lastPointerClickTimeMs: number;
	lastPointerClickColumn: number;
};

type InlineInputOptions = {
	ctrlDown: boolean;
	metaDown: boolean;
	shiftDown: boolean;
	altDown: boolean;
	deltaSeconds: number;
	allowSpace: boolean;
	characterFilter?: (value: string) => boolean;
	maxLength?: number | null;
};

export type RuntimeErrorOverlay = {
	row: number;
	column: number;
	lines: string[];
	timer: number;
};

const TAB_SPACES = 2;
const INITIAL_REPEAT_DELAY = 0.28;
const REPEAT_INTERVAL = 0.05;
const CURSOR_BLINK_INTERVAL = 0.45;
const UNDO_HISTORY_LIMIT = 512;
const UNDO_COALESCE_INTERVAL_MS = 550;
const WHEEL_SCROLL_STEP = 40;
const DOUBLE_CLICK_MAX_INTERVAL_MS = 320;

const COLOR_FRAME = 0;
const COLOR_TOP_BAR = 13;
const COLOR_TOP_BAR_TEXT = 15;
const COLOR_CODE_BACKGROUND = 4;
const COLOR_GUTTER_BACKGROUND = 1;
const COLOR_CODE_TEXT = 14;
const COLOR_KEYWORD = 11;
const COLOR_STRING = 13;
const COLOR_NUMBER = 10;
const COLOR_COMMENT = 3;
const COLOR_OPERATOR = 12;
const COLOR_CODE_DIM = 6;
const HIGHLIGHT_OVERLAY = { r: 1, g: 0.6, b: 0.2, a: 0.35 };
const SELECTION_OVERLAY = Msx1Colors[6];
const CARET_COLOR = { r: 1, g: 1, b: 1, a: 1 };
const COLOR_STATUS_BACKGROUND = 8;
const COLOR_STATUS_TEXT = 15;
const COLOR_STATUS_WARNING = 9;
const COLOR_STATUS_SUCCESS = 10;
const COLOR_STATUS_ERROR = 2;
const COLOR_SEARCH_BACKGROUND = 7;
const COLOR_SEARCH_TEXT = 0;
const COLOR_SEARCH_PLACEHOLDER = COLOR_CODE_DIM;
const COLOR_SEARCH_OUTLINE = 0;
const SEARCH_MATCH_OVERLAY = { r: 0.9, g: 0.35, b: 0.35, a: 0.38 };
const SEARCH_MATCH_ACTIVE_OVERLAY = { r: 1, g: 0.85, b: 0.25, a: 0.6 };
const SEARCH_BAR_MARGIN_Y = 2;
const COLOR_LINE_JUMP_BACKGROUND = COLOR_SEARCH_BACKGROUND;
const COLOR_LINE_JUMP_TEXT = COLOR_SEARCH_TEXT;
const COLOR_LINE_JUMP_PLACEHOLDER = COLOR_CODE_DIM;
const COLOR_LINE_JUMP_OUTLINE = COLOR_SEARCH_OUTLINE;
const ERROR_OVERLAY_BACKGROUND = { r: 0.6, g: 0, b: 0, a: 1 };
const ERROR_OVERLAY_PADDING_X = 4;
const ERROR_OVERLAY_PADDING_Y = 2;
const ERROR_OVERLAY_CONNECTOR_OFFSET = 6;
const HOVER_TOOLTIP_PADDING_X = 4;
const HOVER_TOOLTIP_PADDING_Y = 2;
const HOVER_TOOLTIP_BACKGROUND = { r: 0.1, g: 0.1, b: 0.1, a: 0.9 };
const HOVER_TOOLTIP_BORDER = COLOR_TOP_BAR_TEXT;
const HOVER_TOOLTIP_MAX_VISIBLE_LINES = 10;
const HOVER_TOOLTIP_MAX_LINE_LENGTH = 160;
const LINE_JUMP_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;
const COLOR_CREATE_RESOURCE_BACKGROUND = COLOR_SEARCH_BACKGROUND;
const COLOR_CREATE_RESOURCE_TEXT = COLOR_SEARCH_TEXT;
const COLOR_CREATE_RESOURCE_PLACEHOLDER = COLOR_SEARCH_PLACEHOLDER;
const COLOR_CREATE_RESOURCE_OUTLINE = COLOR_SEARCH_OUTLINE;
const COLOR_CREATE_RESOURCE_ERROR = COLOR_STATUS_WARNING;
const CREATE_RESOURCE_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;
const CREATE_RESOURCE_MAX_PATH_LENGTH = 256;
const DEFAULT_NEW_LUA_RESOURCE_CONTENT = '-- New Lua resource\n';
const DEFAULT_NEW_FSM_RESOURCE_CONTENT = `return {
\tid = '<MACHINE_ID>',
\tenable_tape_autotick = true,
\tticks2advance_tape = 50,
\tstates = {
\t\t_idle = { -- '_'-prefix to make it the initial state
\t\t\tentering_state = function(self, state, payload)
\t\t\tend,
\t\t\ttick = function(self, state, payload)
\t\t\tend,
\t\t\ttapemove = function(self, state, payload)
\t\t\t\treturn '../running'
\t\t\tend,
\t\t\ton = {
\t\t\t\t['$start'] = '../running' -- '$'-prefix to denote self-scoped event
\t\t\t}
\t\t},
\t\tenable_tape_autotick = true,
\t\tticks2advance_tape = 100,
\t\trunning = {
\t\t\tentering_state = function(self, state, payload)
\t\t\tend,
\t\t\ttick = function(self, state, payload)
\t\t\tend,
\t\t\ttapemove = function(self, state, payload)
\t\t\t\treturn '../_idle'
\t\t\tend,
\t\t\ton = {
\t\t\t\t['$stop'] = '../idle' -- '$'-prefix to denote self-scoped event
\t\t\t}
\t\t}
\t}
}
`;
const HEADER_BUTTON_PADDING_X = 5;
const HEADER_BUTTON_PADDING_Y = 1;
const HEADER_BUTTON_SPACING = 4;
const COLOR_HEADER_BUTTON_BACKGROUND = COLOR_STATUS_BACKGROUND;
const COLOR_HEADER_BUTTON_BORDER = COLOR_TOP_BAR_TEXT;
const COLOR_HEADER_BUTTON_DISABLED_BACKGROUND = COLOR_GUTTER_BACKGROUND;
const COLOR_HEADER_BUTTON_TEXT = COLOR_TOP_BAR_TEXT;
const COLOR_HEADER_BUTTON_TEXT_DISABLED = COLOR_CODE_DIM;
const COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND = COLOR_STATUS_WARNING;
const COLOR_HEADER_BUTTON_ACTIVE_TEXT = COLOR_TOP_BAR_TEXT;
const ACTION_OVERLAY_COLOR = { r: 0, g: 0, b: 0, a: 0.65 };
const ACTION_DIALOG_BACKGROUND_COLOR = COLOR_SEARCH_BACKGROUND;
const ACTION_DIALOG_BORDER_COLOR = COLOR_SEARCH_OUTLINE;
const ACTION_DIALOG_TEXT_COLOR = COLOR_SEARCH_TEXT;
const ACTION_BUTTON_BACKGROUND = COLOR_STATUS_BACKGROUND;
const ACTION_BUTTON_TEXT = COLOR_STATUS_TEXT;
const TAB_BUTTON_PADDING_X = 4;
const TAB_BUTTON_PADDING_Y = 1;
const TAB_BUTTON_SPACING = 3;
const TAB_DIRTY_MARKER_SPACING = 2;
const COLOR_TAB_BAR_BACKGROUND = COLOR_STATUS_BACKGROUND;
const COLOR_TAB_BORDER = COLOR_TOP_BAR_TEXT;
const COLOR_TAB_INACTIVE_BACKGROUND = COLOR_STATUS_BACKGROUND;
const COLOR_TAB_ACTIVE_BACKGROUND = COLOR_CODE_BACKGROUND;
const COLOR_TAB_INACTIVE_TEXT = COLOR_TOP_BAR_TEXT;
const COLOR_TAB_ACTIVE_TEXT = COLOR_TOP_BAR_TEXT;
const TAB_CLOSE_BUTTON_PADDING_X = 3;
const TAB_CLOSE_BUTTON_PADDING_Y = 1;
const TAB_CLOSE_BUTTON_SYMBOL = 'X';
const COLOR_GOTO_UNDERLINE = COLOR_STATUS_WARNING;
const RESOURCE_VIEWER_MAX_LINES = 512;
const RESOURCE_PANEL_MIN_RATIO = 0.18;
const RESOURCE_PANEL_MAX_RATIO = 0.6;
const RESOURCE_PANEL_DEFAULT_RATIO = 0.3;
const RESOURCE_PANEL_MIN_EDITOR_RATIO = 0.35;
const RESOURCE_PANEL_DIVIDER_COLOR = COLOR_TAB_BORDER;
const RESOURCE_PANEL_PADDING_X = 4;
const RESOURCE_PANEL_DIVIDER_DRAG_MARGIN = 4;
const SCROLLBAR_WIDTH = 3;
const SCROLLBAR_MIN_THUMB_HEIGHT = 6;
const SCROLLBAR_TRACK_COLOR = COLOR_STATUS_BACKGROUND;
const SCROLLBAR_THUMB_COLOR = COLOR_STATUS_TEXT;
const SYMBOL_SEARCH_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;
const SYMBOL_SEARCH_MAX_RESULTS = 8;
const COLOR_SYMBOL_SEARCH_BACKGROUND = COLOR_SEARCH_BACKGROUND;
const COLOR_SYMBOL_SEARCH_TEXT = COLOR_SEARCH_TEXT;
const COLOR_SYMBOL_SEARCH_PLACEHOLDER = COLOR_SEARCH_PLACEHOLDER;
const COLOR_SYMBOL_SEARCH_OUTLINE = COLOR_SEARCH_OUTLINE;
const COLOR_SYMBOL_SEARCH_KIND = COLOR_CODE_DIM;
const SYMBOL_SEARCH_RESULT_PADDING_X = 4;
const SYMBOL_SEARCH_RESULT_SPACING = 1;

export class ConsoleCartEditor {
	private readonly playerIndex: number;
	private readonly metadata: BmsxConsoleMetadata;
	private readonly loadSourceFn: () => string;
	private readonly saveSourceFn: (source: string) => Promise<void>;
	private readonly loadLuaResourceFn: (assetId: string) => string;
	private readonly saveLuaResourceFn: (assetId: string, source: string) => Promise<void>;
	private readonly createLuaResourceFn: (request: ConsoleLuaResourceCreationRequest) => Promise<ConsoleResourceDescriptor>;
	private readonly listResourcesFn: () => ConsoleResourceDescriptor[];
	private readonly inspectLuaExpressionFn: (request: ConsoleLuaHoverRequest) => ConsoleLuaHoverResult | null;
	private readonly listLuaSymbolsFn: (assetId: string | null, chunkName: string | null) => ConsoleLuaSymbolEntry[];
	private readonly listGlobalLuaSymbolsFn: () => ConsoleLuaSymbolEntry[];
	private readonly primaryAssetId: string | null;
	private hoverTooltip: CodeHoverTooltip | null = null;
	private lastPointerSnapshot: PointerSnapshot | null = null;
	private lastInspectorResult: ConsoleLuaHoverResult | null = null;
	private gotoHoverHighlight: { row: number; startColumn: number; endColumn: number; expression: string } | null = null;
	private viewportWidth: number;
	private viewportHeight: number;
	private readonly font: ConsoleEditorFont;
	private readonly lineHeight: number;
	private readonly charAdvance: number;
	private readonly spaceAdvance: number;
	private readonly highlightCache: Map<number, CachedHighlight> = new Map();
	private readonly maxHighlightCache = 2048;
	private readonly gutterWidth: number;
	private readonly headerHeight: number;
	private readonly tabBarHeight: number;
	private readonly topMargin: number;
	private readonly bottomMargin: number;
	private readonly repeatState: Map<string, RepeatEntry> = new Map();
	private readonly keyPressRecords: Map<string, KeyPressRecord> = new Map();
	private readonly message: MessageState = { text: '', color: COLOR_STATUS_TEXT, timer: 0, visible: false };
	private deferredMessageDuration: number | null = null;
	private runtimeErrorOverlay: RuntimeErrorOverlay | null = null;
	private readonly codeTabContexts: Map<string, CodeTabContext> = new Map();
	private activeCodeTabContextId: string | null = null;
	private entryTabId: string | null = null;
	private readonly captureKeys: string[] = [...new Set([
		'Escape',
		'ArrowUp',
		'ArrowDown',
		'ArrowLeft',
		'ArrowRight',
		'Backspace',
		'Delete',
		'Enter',
		'NumpadEnter',
		'End',
		'Home',
		'PageDown',
		'PageUp',
		'Space',
		'Tab',
		'F3',
		'NumpadDivide',
		...CHARACTER_CODES,
	])];

	private static readonly KEYWORDS = new Set([
		'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
	]);
	private static customClipboard: string | null = null;

	private readonly topBarButtonBounds: Record<TopBarButtonId, RectBounds> = {
		resume: { left: 0, top: 0, right: 0, bottom: 0 },
		reboot: { left: 0, top: 0, right: 0, bottom: 0 },
		save: { left: 0, top: 0, right: 0, bottom: 0 },
		resources: { left: 0, top: 0, right: 0, bottom: 0 },
	};
	private readonly tabButtonBounds: Map<string, RectBounds> = new Map();
	private readonly tabCloseButtonBounds: Map<string, RectBounds> = new Map();
	private readonly actionPromptButtons: { saveAndContinue: RectBounds | null; continue: RectBounds; cancel: RectBounds } = {
		saveAndContinue: null,
		continue: { left: 0, top: 0, right: 0, bottom: 0 },
		cancel: { left: 0, top: 0, right: 0, bottom: 0 },
	};
	private pendingActionPrompt: PendingActionPrompt | null = null;
	private active = false;
	private lines: string[] = [''];
	private cursorRow = 0;
	private cursorColumn = 0;
	private scrollRow = 0;
	private scrollColumn = 0;
	private dirty = false;
	private blinkTimer = 0;
	private cursorVisible = true;
	private desiredColumn = 0;
	private selectionAnchor: Position | null = null;
	private warnNonMonospace = false;
	private undoStack: EditorSnapshot[] = [];
	private redoStack: EditorSnapshot[] = [];
	private lastHistoryKey: string | null = null;
	private lastHistoryTimestamp = 0;
	private pointerSelecting = false;
	private pointerPrimaryWasPressed = false;
	private pointerAuxWasPressed = false;
	private readonly searchField: InlineTextField;
	private readonly symbolSearchField: InlineTextField;
	private readonly lineJumpField: InlineTextField;
	private readonly createResourceField: InlineTextField;
	private readonly scrollbars: Record<ScrollbarKind, ConsoleScrollbar>;
	private activeScrollbarDrag: { kind: ScrollbarKind; pointerOffset: number } | null = null;
	private escapeToggleLatch = false;
	private lastPointerClickTimeMs = 0;
	private lastPointerClickRow = -1;
	private lastPointerClickColumn = -1;
	private tabHoverId: string | null = null;
	private readonly tabDirtyMarkerAssetId = 'msx_6b_font_ctrl_bel';
	private tabDirtyMarkerWidth: number | null = null;
	private tabDirtyMarkerHeight: number | null = null;
	private cursorRevealSuspended = false;
	private searchActive = false;
	private searchVisible = false;
	private searchQuery = '';
	private symbolSearchQuery = '';
	private lineJumpActive = false;
	private symbolSearchActive = false;
	private symbolSearchVisible = false;
	private symbolSearchGlobal = false;
	private lineJumpVisible = false;
	private lineJumpValue = '';
	private createResourceActive = false;
	private createResourceVisible = false;
	private createResourcePath = '';
	private createResourceError: string | null = null;
	private createResourceWorking = false;
	private lastCreateResourceDirectory: string | null = null;
	private symbolCatalog: SymbolCatalogEntry[] = [];
	private symbolCatalogContext: { scope: 'local' | 'global'; assetId: string | null; chunkName: string | null } | null = null;
	private symbolSearchMatches: SymbolSearchResult[] = [];
	private symbolSearchSelectionIndex = -1;
	private symbolSearchDisplayOffset = 0;
	private symbolSearchHoverIndex = -1;
	private searchMatches: SearchMatch[] = [];
	private searchCurrentIndex = -1;
	private textVersion = 0;
	private lastSearchVersion = 0;
	private saveGeneration = 0;
	private appliedGeneration = 0;
	private lastSavedSource = '';
	private tabs: EditorTabDescriptor[] = [];
	private activeTabId: string | null = null;
	private resourceBrowserItems: ResourceBrowserItem[] = [];
	private resourceBrowserScroll = 0;
	private resourceBrowserSelectionIndex = -1;
	private resourceBrowserHoverIndex = -1;
	private resourcePanelVisible = false;
	private resourcePanelFocused = false;
	private pendingResourceSelectionAssetId: string | null = null;
	private resourcePanelWidthRatio: number | null = null;
	private resourcePanelResizing = false;
	private resourceBrowserHorizontalScroll = 0;
	private resourceBrowserMaxLineWidth = 0;
	private codeVerticalScrollbarVisible = false;
	private codeHorizontalScrollbarVisible = false;
	private cachedVisibleRowCount = 1;
	private cachedVisibleColumnCount = 1;

	constructor(options: ConsoleEditorOptions) {
		this.playerIndex = options.playerIndex;
		this.metadata = options.metadata;
		this.loadSourceFn = options.loadSource;
		this.saveSourceFn = options.saveSource;
		this.listResourcesFn = options.listResources;
		this.loadLuaResourceFn = options.loadLuaResource;
		this.saveLuaResourceFn = options.saveLuaResource;
		this.createLuaResourceFn = options.createLuaResource;
		this.inspectLuaExpressionFn = options.inspectLuaExpression;
		this.listLuaSymbolsFn = options.listLuaSymbols;
		this.listGlobalLuaSymbolsFn = options.listGlobalLuaSymbols;
		this.primaryAssetId = options.primaryAssetId;
		if ($ && $.debug) {
			this.listResourcesFn();
		}
		this.viewportWidth = options.viewport.width;
		this.viewportHeight = options.viewport.height;
		this.font = new ConsoleEditorFont();
		this.searchField = this.createInlineField();
		this.symbolSearchField = this.createInlineField();
		this.lineJumpField = this.createInlineField();
		this.createResourceField = this.createInlineField();
		this.applySearchFieldText(this.searchQuery, true);
		this.applySymbolSearchFieldText(this.symbolSearchQuery, true);
		this.applyLineJumpFieldText(this.lineJumpValue, true);
		this.applyCreateResourceFieldText(this.createResourcePath, true);
		this.lineHeight = this.font.lineHeight();
		this.charAdvance = this.font.advance('M');
		this.spaceAdvance = this.font.advance(' ');
		this.gutterWidth = 2;
		const primaryBarHeight = this.lineHeight + 4;
		this.headerHeight = primaryBarHeight;
		this.tabBarHeight = this.lineHeight + 3;
		this.topMargin = this.headerHeight + this.tabBarHeight + 2;
		this.bottomMargin = this.lineHeight + 6;
		this.scrollbars = {
			codeVertical: new ConsoleScrollbar('codeVertical', 'vertical'),
			codeHorizontal: new ConsoleScrollbar('codeHorizontal', 'horizontal'),
			resourceVertical: new ConsoleScrollbar('resourceVertical', 'vertical'),
			resourceHorizontal: new ConsoleScrollbar('resourceHorizontal', 'horizontal'),
			viewerVertical: new ConsoleScrollbar('viewerVertical', 'vertical'),
		};
		this.codeVerticalScrollbarVisible = false;
		this.codeHorizontalScrollbarVisible = false;
		this.cachedVisibleRowCount = 1;
		this.cachedVisibleColumnCount = 1;
		const entryContext = this.createEntryTabContext();
		if (entryContext) {
			this.entryTabId = entryContext.id;
			this.codeTabContexts.set(entryContext.id, entryContext);
		}
		this.initializeTabs(entryContext);
		this.resetResourcePanelState();
		if (entryContext) {
			this.activateCodeEditorTab(entryContext.id);
		}
		this.desiredColumn = this.cursorColumn;
		this.assertMonospace();
		const initialContext = entryContext ? this.codeTabContexts.get(entryContext.id) ?? null : null;
		this.lastSavedSource = initialContext ? initialContext.lastSavedSource : '';
	}

	private drawHoverTooltip(api: BmsxConsoleApi, codeTop: number, codeBottom: number, textLeft: number): void {
		const tooltip = this.hoverTooltip;
		if (!tooltip) {
			return;
		}
		const content = tooltip.contentLines;
		if (!content || content.length === 0) {
			tooltip.bubbleBounds = null;
			return;
		}
		const visibleRows = this.visibleRowCount();
		const relativeRow = tooltip.row - this.scrollRow;
		if (relativeRow < 0 || relativeRow >= visibleRows) {
			tooltip.bubbleBounds = null;
			return;
		}
		const rowTop = codeTop + relativeRow * this.lineHeight;
		const entry = this.getCachedHighlight(tooltip.row);
		const highlight = entry.hi;
		const slice = this.sliceHighlightedLine(highlight, this.scrollColumn, this.visibleColumnCount() + 8);
		const startDisplay = this.columnToDisplay(highlight, tooltip.startColumn);
		const endDisplay = this.columnToDisplay(highlight, tooltip.endColumn);
		const clampedStartDisplay = clamp(startDisplay, slice.startDisplay, slice.endDisplay);
		const clampedEndDisplay = clamp(endDisplay, clampedStartDisplay, highlight.chars.length);
		const expressionStartX = textLeft + this.measureRangeFast(entry, slice.startDisplay, clampedStartDisplay);
		const expressionEndX = textLeft + this.measureRangeFast(entry, slice.startDisplay, clampedEndDisplay);
		const maxVisible = Math.max(1, Math.min(HOVER_TOOLTIP_MAX_VISIBLE_LINES, content.length));
		const maxOffset = Math.max(0, content.length - maxVisible);
		tooltip.scrollOffset = clamp(tooltip.scrollOffset, 0, maxOffset);
		const visibleCount = Math.max(1, Math.min(maxVisible, content.length - tooltip.scrollOffset));
		tooltip.visibleLineCount = visibleCount;
		const visibleLines = content.slice(tooltip.scrollOffset, tooltip.scrollOffset + visibleCount);
		let maxLineWidth = 0;
		for (const line of visibleLines) {
			const width = this.measureText(line);
			if (width > maxLineWidth) {
				maxLineWidth = width;
			}
		}
		const bubbleWidth = maxLineWidth + HOVER_TOOLTIP_PADDING_X * 2;
		const bubbleHeight = visibleLines.length * this.lineHeight + HOVER_TOOLTIP_PADDING_Y * 2;
		const viewportRight = this.viewportWidth - 1;
		let bubbleLeft = expressionEndX + this.spaceAdvance;
		if (bubbleLeft + bubbleWidth > viewportRight) {
			bubbleLeft = viewportRight - bubbleWidth;
		}
		if (bubbleLeft <= expressionEndX) {
			const leftCandidate = expressionStartX - bubbleWidth - this.spaceAdvance;
			if (leftCandidate >= textLeft) {
				bubbleLeft = leftCandidate;
			} else {
				bubbleLeft = Math.max(textLeft, bubbleLeft);
			}
		}
		if (bubbleLeft < textLeft) {
			bubbleLeft = textLeft;
		}
		let bubbleTop = rowTop;
		if (bubbleTop + bubbleHeight > codeBottom) {
			bubbleTop = Math.max(codeTop, codeBottom - bubbleHeight);
		}
		api.rectfillColor(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, HOVER_TOOLTIP_BACKGROUND);
		api.rect(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, HOVER_TOOLTIP_BORDER);
		for (let i = 0; i < visibleLines.length; i += 1) {
			const lineY = bubbleTop + HOVER_TOOLTIP_PADDING_Y + i * this.lineHeight;
			this.drawText(api, visibleLines[i], bubbleLeft + HOVER_TOOLTIP_PADDING_X, lineY, COLOR_STATUS_TEXT);
		}
		tooltip.bubbleBounds = { left: bubbleLeft, top: bubbleTop, right: bubbleLeft + bubbleWidth, bottom: bubbleTop + bubbleHeight };
	}

	public showWarningBanner(text: string, durationSeconds = 4.0): void {
		this.showMessage(text, COLOR_STATUS_WARNING, durationSeconds);
		if (!this.active) {
			this.message.timer = Number.POSITIVE_INFINITY;
			this.deferredMessageDuration = durationSeconds;
		} else {
			this.deferredMessageDuration = null;
		}
	}

	public showRuntimeErrorInChunk(chunkName: string | null, line: number, column: number, message: string, hint?: { assetId: string | null; path?: string | null }): void {
		this.focusChunkSource(chunkName, hint);
		const overlayMessage = chunkName && chunkName.length > 0 ? `${chunkName}: ${message}` : message;
		this.showRuntimeError(line, column, overlayMessage);
	}

	public showRuntimeError(line: number, column: number, message: string): void {
		if (!this.active) {
			this.activate();
		}
		const hasLocation = Number.isFinite(line) && line >= 1;
		const processedLine = hasLocation ? Math.max(1, Math.floor(line)) : null;
		const baseColumn = Number.isFinite(column) ? Math.floor(column) - 1 : null;
		let targetRow = this.cursorRow;
		if (processedLine !== null) {
			targetRow = clamp(processedLine - 1, 0, this.lines.length - 1);
			this.cursorRow = targetRow;
		}
		const currentLine = this.lines[targetRow] ?? '';
		let targetColumn = this.cursorColumn;
		if (baseColumn !== null) {
			targetColumn = clamp(baseColumn, 0, currentLine.length);
			this.cursorColumn = targetColumn;
		}
		this.clampCursorColumn();
		targetColumn = this.cursorColumn;
		this.selectionAnchor = null;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.activeScrollbarDrag = null;
		this.cursorRevealSuspended = false;
		this.centerCursorVertically();
		this.updateDesiredColumn();
		this.revealCursor();
		this.resetBlink();
		const normalizedMessage = (message && message.length > 0) ? message.trim() : 'Runtime error';
		const overlayMessage = processedLine !== null ? `Line ${processedLine}: ${normalizedMessage}` : normalizedMessage;
		const overlayLines = this.buildRuntimeErrorLines(overlayMessage);
		const overlay: RuntimeErrorOverlay = {
			row: targetRow,
			column: targetColumn,
			lines: overlayLines,
			timer: Number.POSITIVE_INFINITY,
		};
		this.setActiveRuntimeErrorOverlay(overlay);
		const statusLine = overlayLines.length > 0 ? overlayLines[0] : 'Runtime error';
		this.showMessage(statusLine, COLOR_STATUS_ERROR, 8.0);
	}

	private focusChunkSource(chunkName: string | null, hint?: { assetId: string | null; path?: string | null }): void {
		if (!this.active) {
			this.activate();
		}
		this.closeSymbolSearch(true);
		if (hint && typeof hint.assetId === 'string' && hint.assetId.length > 0) {
			const preferredPath = (typeof hint.path === 'string' && hint.path.length > 0) ? hint.path : null;
			this.focusResourceByAsset(hint.assetId, preferredPath);
			return;
		}
		if (hint && hint.assetId === null) {
			this.activateCodeTab();
			return;
		}
		const normalizedChunk = this.normalizeChunkName(chunkName);
		const descriptor = this.findResourceDescriptorForChunk(normalizedChunk);
		this.openResourceDescriptor(descriptor);
	}

	private focusResourceByAsset(assetId: string, preferredPath?: string | null): void {
		if (typeof assetId !== 'string' || assetId.length === 0) {
			throw new Error('[ConsoleCartEditor] Invalid asset id for runtime error highlight.');
		}
		const descriptors = this.listResourcesStrict();
		const match = descriptors.find(entry => entry.assetId === assetId);
		const normalizedPreferred = this.normalizeResourcePath(preferredPath);
		if (match) {
			const effectivePath = normalizedPreferred ? normalizedPreferred : match.path;
			this.openResourceDescriptor({ ...match, path: effectivePath });
			return;
		}
		if (!normalizedPreferred) {
			throw new Error(`[ConsoleCartEditor] No resource found for asset '${assetId}'.`);
		}
		this.openResourceDescriptor({ path: normalizedPreferred, type: 'lua', assetId });
	}

	private normalizeChunkName(name: string | null): string {
		if (typeof name !== 'string' || name.trim().length === 0) {
			throw new Error('[ConsoleCartEditor] Chunk name unavailable for runtime error.');
		}
		let normalized = name.trim();
		if (normalized.startsWith('@')) {
			normalized = normalized.slice(1);
		}
		normalized = normalized.replace(/\\/g, '/');
		if (normalized.length === 0) {
			throw new Error('[ConsoleCartEditor] Normalized chunk name is empty.');
		}
		return normalized;
	}

	private normalizeResourcePath(path?: string | null): string | undefined {
		if (path === null || path === undefined) {
			return undefined;
		}
		const normalized = path.replace(/\\/g, '/');
		return normalized.length > 0 ? normalized : undefined;
	}

	private findCodeTabContext(assetId: string | null, chunkName: string | null): CodeTabContext | null {
		const normalizedChunk = this.normalizeChunkReference(chunkName);
		for (const context of this.codeTabContexts.values()) {
			const descriptor = context.descriptor;
			if (assetId && descriptor && descriptor.assetId === assetId) {
				return context;
			}
			if (!assetId && normalizedChunk && descriptor) {
				const descriptorPath = this.normalizeChunkReference(descriptor.path);
				if (descriptorPath && descriptorPath === normalizedChunk) {
					return context;
				}
			}
		}
		if (!this.entryTabId) {
			return null;
		}
		const entryContext = this.codeTabContexts.get(this.entryTabId) ?? null;
		if (!entryContext) {
			return null;
		}
		if (assetId !== null) {
			return null;
		}
		if (!normalizedChunk) {
			return entryContext;
		}
		const entryDescriptor = entryContext.descriptor;
		if (!entryDescriptor) {
			return entryContext;
		}
		const entryPath = this.normalizeChunkReference(entryDescriptor.path);
		if (entryPath && entryPath === normalizedChunk) {
			return entryContext;
		}
		return null;
	}

	private normalizeChunkReference(reference: string | null): string | null {
		if (!reference) {
			return null;
		}
		let normalized = reference;
		if (normalized.startsWith('@')) {
			normalized = normalized.slice(1);
		}
		return normalized.replace(/\\/g, '/');
	}


	private listResourcesStrict(): ConsoleResourceDescriptor[] {
		const descriptors = this.listResourcesFn();
		if (!Array.isArray(descriptors)) {
			throw new Error('[ConsoleCartEditor] Resource enumeration returned an invalid result.');
		}
		return descriptors;
	}

	private findResourceDescriptorByAssetId(assetId: string): ConsoleResourceDescriptor | null {
		const descriptors = this.listResourcesStrict();
		const match = descriptors.find(entry => entry.assetId === assetId);
		return match ?? null;
	}

	private findResourceDescriptorForChunk(chunkPath: string): ConsoleResourceDescriptor {
		const descriptors = this.listResourcesStrict();
		const normalizedTarget = chunkPath.replace(/\\/g, '/');
		const exact = descriptors.find(entry => entry.path.replace(/\\/g, '/') === normalizedTarget);
		if (exact) {
			return exact;
		}
		const segments = normalizedTarget.split('/');
		const basename = segments.length > 0 ? segments[segments.length - 1] : normalizedTarget;
		const withoutExt = basename.endsWith('.lua') ? basename.slice(0, -4) : basename;
		const byAssetId = descriptors.find(entry => entry.assetId === basename || entry.assetId === withoutExt);
		if (byAssetId) {
			return byAssetId;
		}
		throw new Error(`[ConsoleCartEditor] Unable to resolve chunk '${normalizedTarget}' to a resource.`);
	}

	private openResourceDescriptor(descriptor: ConsoleResourceDescriptor): void {
		this.selectResourceInPanel(descriptor);
		if (descriptor.type === 'lua') {
			this.openLuaCodeTab(descriptor);
		} else {
			this.openResourceViewerTab(descriptor);
		}
		this.focusEditorFromResourcePanel();
	}

	public clearRuntimeErrorOverlay(): void {
		this.setActiveRuntimeErrorOverlay(null);
	}

	private setActiveRuntimeErrorOverlay(overlay: RuntimeErrorOverlay | null): void {
		this.runtimeErrorOverlay = overlay;
		const context = this.getActiveCodeTabContext();
		if (context) {
			context.runtimeErrorOverlay = overlay;
		}
	}

	private syncRuntimeErrorOverlayFromContext(context: CodeTabContext | null): void {
		this.runtimeErrorOverlay = context ? context.runtimeErrorOverlay ?? null : null;
	}

	private buildRuntimeErrorLines(message: string): string[] {
		const sanitized = message.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const rawLines = sanitized.split('\n');
		const maxWidth = this.runtimeErrorOverlayMaxTextWidth();
		const result: string[] = [];
		for (let i = 0; i < rawLines.length; i++) {
			const segments = this.wrapRuntimeErrorLine(rawLines[i], maxWidth);
			if (segments.length === 0) {
				result.push('');
				continue;
			}
			for (let s = 0; s < segments.length; s++) {
				result.push(segments[s]);
			}
		}
		if (result.length === 0) {
			result.push('');
		}
		return result;
	}

	private wrapRuntimeErrorLine(line: string, maxWidth: number): string[] {
		if (line.length === 0) {
			return [''];
		}
		const segments: string[] = [];
		let current = '';
		for (let index = 0; index < line.length; index++) {
			const ch = line.charAt(index);
			const candidate = current + ch;
			const candidateWidth = this.measureText(candidate);
			if (current.length > 0 && candidateWidth > maxWidth) {
				segments.push(current);
				current = ch;
				if (this.measureText(current) > maxWidth) {
					segments.push(current);
					current = '';
				}
				continue;
			}
			if (current.length === 0 && candidateWidth > maxWidth) {
				segments.push(ch);
				current = '';
				continue;
			}
			current = candidate;
		}
		if (current.length > 0) {
			segments.push(current);
		}
		if (segments.length === 0) {
			segments.push('');
		}
		return segments;
	}

	private runtimeErrorOverlayMaxTextWidth(): number {
		const horizontalMargin = this.gutterWidth + ERROR_OVERLAY_CONNECTOR_OFFSET + ERROR_OVERLAY_PADDING_X * 2 + 2;
		const available = this.viewportWidth - horizontalMargin;
		if (available <= this.charAdvance) {
			return this.charAdvance;
		}
		return available;
	}

	private tryShowLuaErrorOverlay(error: unknown): boolean {
		let candidate: { line?: unknown; column?: unknown; chunkName?: unknown; message?: unknown };
		if (typeof error === 'string') {
			candidate = { message: error };
		} else if (error && typeof error === 'object') {
			candidate = error as { line?: unknown; column?: unknown; chunkName?: unknown; message?: unknown };
		} else {
			throw new Error('[ConsoleCartEditor] Lua error payload is neither an object nor a string.');
		}
		const rawLine = typeof candidate.line === 'number' && Number.isFinite(candidate.line) ? candidate.line : null;
		const rawColumn = typeof candidate.column === 'number' && Number.isFinite(candidate.column) ? candidate.column : null;
		const chunkName = typeof candidate.chunkName === 'string' && candidate.chunkName.length > 0 ? candidate.chunkName : null;
		const messageText = typeof candidate.message === 'string' && candidate.message.length > 0 ? candidate.message : null;
		const hasLine = rawLine !== null && rawLine > 0;
		const hasColumn = rawColumn !== null && rawColumn > 0;
		if (!hasLine && !hasColumn) {
			if (messageText) {
				this.showMessage(messageText, COLOR_STATUS_ERROR, 4.0);
				return true;
			}
			return false;
		}
		const safeLine = hasLine ? Math.max(1, Math.floor(rawLine!)) : 0;
		const safeColumn = hasColumn ? Math.max(1, Math.floor(rawColumn!)) : 0;
		const baseMessage = messageText ?? 'Lua error';
		this.showRuntimeErrorInChunk(chunkName, safeLine, safeColumn, baseMessage);
		return true;
	}

	public update(deltaSeconds: number): void {
		this.refreshViewportDimensions();
		const keyboard = this.getKeyboard();
		this.updateMessage(deltaSeconds);
		this.updateRuntimeErrorOverlay(deltaSeconds);
		if (this.handleToggleRequest(keyboard)) {
			return;
		}
		if (!this.active) {
			return;
		}
		this.updateBlink(deltaSeconds);
		this.handlePointerWheel();
		this.handlePointerInput(deltaSeconds);
		if (this.pendingActionPrompt) {
			this.handleActionPromptInput(keyboard);
			return;
		}
		this.handleEditorInput(keyboard, deltaSeconds);
		if (this.searchQuery.length === 0) {
			this.lastSearchVersion = this.textVersion;
		} else if (this.searchActive && this.textVersion !== this.lastSearchVersion) {
			this.updateSearchMatches();
			this.lastSearchVersion = this.textVersion;
		}
		if (this.isCodeTabActive() && !this.cursorRevealSuspended) {
			this.ensureCursorVisible();
		}
	}

	public isActive(): boolean {
		return this.active;
	}

	public draw(api: BmsxConsoleApi): void {
		this.refreshViewportDimensions();
		if (!this.active) {
			return;
		}
		this.codeVerticalScrollbarVisible = false;
		this.codeHorizontalScrollbarVisible = false;
		const frameColor = Msx1Colors[COLOR_FRAME];
		api.rectfillColor(0, 0, this.viewportWidth, this.viewportHeight, { r: frameColor.r, g: frameColor.g, b: frameColor.b, a: frameColor.a });
		this.drawTopBar(api);
		this.drawTabBar(api);
		this.drawResourcePanel(api);
		if (this.isResourceViewActive()) {
			this.drawResourceViewer(api);
		} else {
			this.drawCreateResourceBar(api);
			this.drawSearchBar(api);
			this.drawSymbolSearchBar(api);
			this.drawLineJumpBar(api);
			this.drawCodeArea(api);
		}
		this.drawStatusBar(api);
		if (this.pendingActionPrompt) {
			this.drawActionPromptOverlay(api);
		}
	}

	public getSourceForChunk(assetId: string | null, chunkName: string | null): string {
		const context = this.findCodeTabContext(assetId, chunkName);
		if (!context) {
			throw new Error(`[ConsoleCartEditor] Unable to locate editor context for asset '${assetId ?? '<null>'}' and chunk '${chunkName ?? '<null>'}'.`);
		}
		if (context.id === this.activeCodeTabContextId) {
			return this.lines.join('\n');
		}
		if (context.snapshot) {
			return context.snapshot.lines.join('\n');
		}
		if (context.lastSavedSource.length > 0) {
			return context.lastSavedSource;
		}
		return context.load();
	}

	private drawTabBar(api: BmsxConsoleApi): void {
		const barTop = this.headerHeight;
		const barBottom = barTop + this.tabBarHeight;
		api.rectfill(0, barTop, this.viewportWidth, barBottom, COLOR_TAB_BAR_BACKGROUND);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, COLOR_TAB_BORDER);
		this.tabButtonBounds.clear();
		this.tabCloseButtonBounds.clear();
		let tabX = 4;
		for (let index = 0; index < this.tabs.length; index += 1) {
			const tab = this.tabs[index];
			const textWidth = this.measureText(tab.title);
			const dirty = tab.dirty === true;
			const hovered = tab.id === this.tabHoverId;
			let markerMetrics: { width: number; height: number } | null = null;
			if (dirty) {
				markerMetrics = this.getTabDirtyMarkerMetrics();
			}
			let closeWidth = 0;
			if (tab.closable) {
				closeWidth = this.measureText(TAB_CLOSE_BUTTON_SYMBOL) + TAB_CLOSE_BUTTON_PADDING_X * 2;
			}
			let indicatorWidth = 0;
			if (tab.closable) {
				indicatorWidth = closeWidth;
			} else if (markerMetrics) {
				indicatorWidth = markerMetrics.width + TAB_DIRTY_MARKER_SPACING;
			}
			const tabWidth = textWidth + TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
			const left = tabX;
			const right = left + tabWidth;
			const top = barTop + 1;
			const bottom = barBottom - 1;
			const bounds: RectBounds = { left, top, right, bottom };
			this.tabButtonBounds.set(tab.id, bounds);
			const active = this.activeTabId === tab.id;
			const fillColor = active ? COLOR_TAB_ACTIVE_BACKGROUND : COLOR_TAB_INACTIVE_BACKGROUND;
			const textColor = active ? COLOR_TAB_ACTIVE_TEXT : COLOR_TAB_INACTIVE_TEXT;
			api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, fillColor);
			api.rect(bounds.left, bounds.top, bounds.right, bounds.bottom, COLOR_TAB_BORDER);
			const textY = bounds.top + TAB_BUTTON_PADDING_Y;
			const showCloseButton = tab.closable && hovered;
			const indicatorLeft = bounds.right - indicatorWidth;
			const textX = bounds.left + TAB_BUTTON_PADDING_X;
			this.drawText(api, tab.title, textX, textY, textColor);
			if (tab.closable) {
				const closeBounds: RectBounds = {
					left: bounds.right - closeWidth,
					top: bounds.top,
					right: bounds.right,
					bottom: bounds.bottom,
				};
				if (showCloseButton) {
					this.tabCloseButtonBounds.set(tab.id, closeBounds);
					const closeX = closeBounds.left + TAB_CLOSE_BUTTON_PADDING_X;
					const closeY = closeBounds.top + TAB_CLOSE_BUTTON_PADDING_Y;
					this.drawText(api, TAB_CLOSE_BUTTON_SYMBOL, closeX, closeY, textColor);
				} else {
					this.tabCloseButtonBounds.delete(tab.id);
					if (dirty && markerMetrics) {
						const markerX = closeBounds.left + Math.floor((closeWidth - markerMetrics.width) / 2);
						const markerY = bounds.top + Math.floor(((bounds.bottom - bounds.top) - markerMetrics.height) / 2);
						api.spr(this.tabDirtyMarkerAssetId, markerX, markerY);
					}
				}
			} else {
				this.tabCloseButtonBounds.delete(tab.id);
				if (dirty && markerMetrics) {
					const indicatorAreaWidth = indicatorWidth;
					const spacing = Math.max(0, TAB_DIRTY_MARKER_SPACING);
					const markerX = indicatorAreaWidth > 0
						? indicatorLeft + Math.floor(Math.max(0, (indicatorAreaWidth - markerMetrics.width) / 2))
						: bounds.right - markerMetrics.width - spacing;
					const markerY = bounds.top + Math.floor(((bounds.bottom - bounds.top) - markerMetrics.height) / 2);
					api.spr(this.tabDirtyMarkerAssetId, markerX, markerY);
				}
			}
			if (active) {
				api.rectfill(bounds.left, bounds.bottom - 1, bounds.right, bounds.bottom, fillColor);
			}
			tabX = right + TAB_BUTTON_SPACING;
		}
		const remainingTop = barBottom - 1;
		if (tabX < this.viewportWidth) {
			api.rectfill(tabX, remainingTop, this.viewportWidth, barBottom, COLOR_TAB_BAR_BACKGROUND);
		}
	}

	private getTabDirtyMarkerMetrics(): { width: number; height: number } {
		if (this.tabDirtyMarkerWidth === null || this.tabDirtyMarkerHeight === null) {
			const rompack = $.rompack;
			if (!rompack || !rompack.img) {
				throw new Error('[ConsoleCartEditor] Rompack unavailable while resolving tab dirty marker.');
			}
			const entry = rompack.img[this.tabDirtyMarkerAssetId];
			if (!entry || !entry.imgmeta) {
				throw new Error(`[ConsoleCartEditor] Tab dirty marker asset '${this.tabDirtyMarkerAssetId}' unavailable.`);
			}
			const width = entry.imgmeta.width;
			const height = entry.imgmeta.height;
			if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
				throw new Error(`[ConsoleCartEditor] Tab dirty marker asset '${this.tabDirtyMarkerAssetId}' has invalid dimensions.`);
			}
			this.tabDirtyMarkerWidth = Math.max(1, Math.floor(width));
			this.tabDirtyMarkerHeight = Math.max(1, Math.floor(height));
		}
		const width = this.tabDirtyMarkerWidth;
		const height = this.tabDirtyMarkerHeight;
		if (width === null || height === null) {
			throw new Error('[ConsoleCartEditor] Failed to resolve tab dirty marker metrics.');
		}
		return { width, height };
	}

	private refreshViewportDimensions(): void {
		const view = $.view;
		if (!view) {
			throw new Error('[ConsoleCartEditor] Game view unavailable during editor frame.');
		}
		const renderSize = view.offscreenCanvasSize;
		if (!Number.isFinite(renderSize.x) || !Number.isFinite(renderSize.y) || renderSize.x <= 0 || renderSize.y <= 0) {
			throw new Error('[ConsoleCartEditor] Invalid offscreen dimensions.');
		}
		const width = renderSize.x;
		const height = renderSize.y;
		if (width === this.viewportWidth && height === this.viewportHeight) {
			return;
		}
		this.viewportWidth = width;
		this.viewportHeight = height;
		if (this.resourcePanelWidthRatio !== null) {
			this.resourcePanelWidthRatio = this.clampResourcePanelRatio(this.resourcePanelWidthRatio);
			if (this.resourcePanelVisible && this.computePanelPixelWidth(this.resourcePanelWidthRatio) <= 0) {
				this.hideResourcePanel();
			}
		}
		if (this.resourcePanelVisible) {
			this.updateResourceBrowserMetrics();
			this.resourceBrowserEnsureSelectionVisible();
		}
	}

	private initializeTabs(entryContext: CodeTabContext | null = null): void {
		this.tabs = [];
		this.tabHoverId = null;
		this.tabButtonBounds.clear();
		this.tabCloseButtonBounds.clear();
		if (entryContext) {
			this.tabs.push({
				id: entryContext.id,
				kind: 'lua_editor',
				title: entryContext.title,
				closable: true,
				dirty: entryContext.dirty,
			});
			this.activeTabId = entryContext.id;
			this.activeCodeTabContextId = entryContext.id;
			return;
		}
		this.activeTabId = null;
		this.activeCodeTabContextId = null;
	}

	private setTabDirty(tabId: string, dirty: boolean): void {
		const tab = this.tabs.find(candidate => candidate.id === tabId);
		if (!tab) {
			return;
		}
		tab.dirty = dirty;
	}

	private updateActiveContextDirtyFlag(): void {
		const context = this.getActiveCodeTabContext();
		if (!context) {
			return;
		}
		context.dirty = this.dirty;
		this.setTabDirty(context.id, context.dirty);
	}

	private getActiveTabKind(): EditorTabKind {
		if (!this.activeTabId) {
			return 'lua_editor';
		}
		const active = this.tabs.find(tab => tab.id === this.activeTabId);
		if (active) {
			return active.kind;
		}
		if (this.tabs.length > 0) {
			const first = this.tabs[0];
			this.activeTabId = first.id;
			return first.kind;
		}
		this.activeTabId = null;
		return 'lua_editor';
	}

	private getActiveResourceViewer(): ResourceViewerState | null {
		const tab = this.tabs.find(candidate => candidate.id === this.activeTabId);
		if (!tab) {
			return null;
		}
		if (tab.kind !== 'resource_view' || !tab.resource) {
			return null;
		}
		return tab.resource;
	}

	public serializeState(): ConsoleEditorSerializedState { // NOTE: UNUSED AS WE DON'T SAVE EDITOR STATE ANYMORE
		const snapshot = this.captureSnapshot();
		const message: MessageState = {
			text: this.message.text,
			color: this.message.color,
			timer: this.message.timer,
			visible: this.message.visible,
		};
		const overlay = this.runtimeErrorOverlay
			? {
				row: this.runtimeErrorOverlay.row,
				column: this.runtimeErrorOverlay.column,
				lines: this.runtimeErrorOverlay.lines.slice(),
				timer: this.runtimeErrorOverlay.timer,
			}
			: null;
		return {
			active: this.active,
			activeTab: this.getActiveTabKind(),
			snapshot,
			searchQuery: this.searchQuery,
			searchMatches: this.searchMatches.map(match => ({ row: match.row, start: match.start, end: match.end })),
			searchCurrentIndex: this.searchCurrentIndex,
			searchActive: this.searchActive,
			searchVisible: this.searchVisible,
			lineJumpValue: this.lineJumpValue,
			lineJumpActive: this.lineJumpActive,
			lineJumpVisible: this.lineJumpVisible,
			message,
			runtimeErrorOverlay: overlay,
			saveGeneration: this.saveGeneration,
			appliedGeneration: this.appliedGeneration,
		};
	}

	public restoreState(state: ConsoleEditorSerializedState): void { // NOTE: UNUSED AS WE DON'T SAVE EDITOR STATE ANYMORE
		if (!state) return;
		this.applyInputOverrides(false);
		this.codeTabContexts.clear();
		const entryContext = this.createEntryTabContext();
		if (entryContext) {
			this.entryTabId = entryContext.id;
			this.codeTabContexts.set(entryContext.id, entryContext);
			this.activeCodeTabContextId = entryContext.id;
		}
		else {
			this.activeCodeTabContextId = null;
		}
		this.initializeTabs(entryContext);
		this.resetResourcePanelState();
		this.hideResourcePanel();
		this.active = state.active;
		const restoredKind = state.activeTab ?? 'lua_editor';
		if (restoredKind === 'resource_view') {
			const activeResourceTab = this.tabs.find(tab => tab.kind === 'resource_view');
			if (activeResourceTab) {
				this.setActiveTab(activeResourceTab.id);
			}
		} else {
			this.activateCodeTab();
		}
		if (this.active) {
			this.applyInputOverrides(true);
		}
		this.restoreSnapshot(state.snapshot);
		this.applySearchFieldText(state.searchQuery, true);
		this.searchMatches = state.searchMatches.map(match => ({ row: match.row, start: match.start, end: match.end }));
		this.searchCurrentIndex = state.searchCurrentIndex;
		this.searchActive = state.searchActive;
		this.searchVisible = state.searchVisible;
		this.applyLineJumpFieldText(state.lineJumpValue, true);
		this.lineJumpActive = state.lineJumpActive;
		this.lineJumpVisible = state.lineJumpVisible;
		this.message.text = state.message.text;
		this.message.color = state.message.color;
		this.message.timer = state.message.timer;
		this.message.visible = state.message.visible;
		const restoredOverlay = state.runtimeErrorOverlay
			? {
				row: state.runtimeErrorOverlay.row,
				column: state.runtimeErrorOverlay.column,
				lines: state.runtimeErrorOverlay.lines.slice(),
				timer: state.runtimeErrorOverlay.timer,
			}
			: null;
		this.setActiveRuntimeErrorOverlay(restoredOverlay);
		this.lastSearchVersion = this.textVersion;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.clearGotoHoverHighlight();
		this.cursorRevealSuspended = false;
		this.repeatState.clear();
		this.resetKeyPressGuards();
		this.breakUndoSequence();
		this.saveGeneration = Number.isFinite(state.saveGeneration) ? Math.max(0, Math.floor(state.saveGeneration)) : 0;
		this.appliedGeneration = Number.isFinite(state.appliedGeneration) ? Math.max(0, Math.floor(state.appliedGeneration)) : 0;
		this.resetActionPromptState();
		const activeContext = this.getActiveCodeTabContext();
		const entryContextRef = this.entryTabId ? this.codeTabContexts.get(this.entryTabId) ?? null : null;
		if (activeContext) {
			activeContext.lastSavedSource = this.lines.join('\n');
			activeContext.dirty = this.dirty;
			this.setTabDirty(activeContext.id, activeContext.dirty);
		}
		if (entryContextRef) {
			if (activeContext && activeContext.id === entryContextRef.id) {
				entryContextRef.lastSavedSource = this.lines.join('\n');
			}
			this.lastSavedSource = entryContextRef.lastSavedSource;
		} else {
			this.lastSavedSource = '';
		}
	}

	public shutdown(): void {
		this.storeActiveCodeTabContext();
		this.applyInputOverrides(false);
		this.active = false;
		this.repeatState.clear();
		this.resetKeyPressGuards();
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.pointerAuxWasPressed = false;
		this.clearGotoHoverHighlight();
		this.cursorRevealSuspended = false;
		this.searchActive = false;
		this.searchVisible = false;
		this.lineJumpActive = false;
		this.lineJumpVisible = false;
		this.applyLineJumpFieldText('', true);
		this.createResourceActive = false;
		this.createResourceVisible = false;
		this.applyCreateResourceFieldText('', true);
		this.createResourceError = null;
		this.createResourceWorking = false;
		this.resetActionPromptState();
		this.hideResourcePanel();
		this.activateCodeTab();
	}

	private getKeyboard(): KeyboardInput {
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		if (!playerInput) {
			throw new Error(`[ConsoleCartEditor] Player input ${this.playerIndex} unavailable.`);
		}
		const handler = playerInput.inputHandlers['keyboard'];
		if (!handler) {
			throw new Error(`[ConsoleCartEditor] Keyboard handler missing for player ${this.playerIndex}.`);
		}
		const candidate = handler as KeyboardInput;
		if (typeof candidate.keydown !== 'function') {
			throw new Error(`[ConsoleCartEditor] Keyboard handler for player ${this.playerIndex} is invalid.`);
		}
		return candidate;
	}

	private handleToggleRequest(keyboard: KeyboardInput): boolean {
		const escapeState = this.getButtonState(keyboard, 'Escape');
		if (!escapeState || escapeState.pressed !== true) {
			this.escapeToggleLatch = false;
			return false;
		}
		if (this.escapeToggleLatch) {
			return false;
		}
		if (!this.isKeyJustPressed(keyboard, 'Escape')) {
			return false;
		}
		this.escapeToggleLatch = true;
		this.consumeKey(keyboard, 'Escape');
		if (this.pendingActionPrompt) {
			this.resetActionPromptState();
			return true;
		}
		if (this.runtimeErrorOverlay) {
			this.clearRuntimeErrorOverlay();
			this.message.visible = false;
			return true;
		}
		if (this.createResourceVisible) {
			this.closeCreateResourcePrompt(true);
			return true;
		}
		if (this.lineJumpActive || this.lineJumpVisible) {
			this.closeLineJump(false);
			return true;
		}
		if (this.searchActive || this.searchVisible) {
			this.closeSearch(false);
			this.searchVisible = false;
			return true;
		}
		if (this.active) {
			if (this.dirty) {
				this.openActionPrompt('close');
			} else {
				this.deactivate();
			}
		} else {
			this.activate();
		}
		return true;
	}

	private activate(): void {
		this.applyInputOverrides(true);
		if (this.activeCodeTabContextId) {
			const existingTab = this.tabs.find(candidate => candidate.id === this.activeCodeTabContextId);
			if (existingTab) {
				this.setActiveTab(this.activeCodeTabContextId);
			} else {
				this.activateCodeTab();
			}
		} else {
			this.activateCodeTab();
		}
		this.bumpTextVersion();
		this.cursorVisible = true;
		this.blinkTimer = 0;
		this.active = true;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.cursorRevealSuspended = false;
		this.repeatState.clear();
		this.resetKeyPressGuards();
		this.updateDesiredColumn();
		this.selectionAnchor = null;
		this.undoStack = [];
		this.redoStack = [];
		this.lastHistoryKey = null;
		this.lastHistoryTimestamp = 0;
		this.searchActive = false;
		this.searchVisible = false;
		this.lineJumpActive = false;
		this.lineJumpVisible = false;
		this.lineJumpValue = '';
		this.syncRuntimeErrorOverlayFromContext(this.getActiveCodeTabContext());
		this.resetActionPromptState();
		if (this.searchQuery.length === 0) {
			this.searchMatches = [];
			this.searchCurrentIndex = -1;
		} else {
			this.updateSearchMatches();
			if (this.searchMatches.length > 0) {
				this.focusSearchResult(this.searchCurrentIndex);
			}
		}
		this.ensureCursorVisible();
		if (this.message.visible && !Number.isFinite(this.message.timer) && this.deferredMessageDuration !== null) {
			this.message.timer = this.deferredMessageDuration;
		}
		this.deferredMessageDuration = null;
	}

	private deactivate(): void {
		this.storeActiveCodeTabContext();
		this.active = false;
		this.repeatState.clear();
		this.resetKeyPressGuards();
		this.applyInputOverrides(false);
		this.selectionAnchor = null;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.pointerAuxWasPressed = false;
		this.clearGotoHoverHighlight();
		this.activeScrollbarDrag = null;
		this.cursorRevealSuspended = false;
		this.undoStack = [];
		this.redoStack = [];
		this.lastHistoryKey = null;
		this.lastHistoryTimestamp = 0;
		this.searchActive = false;
		this.searchVisible = false;
		this.lineJumpActive = false;
		this.lineJumpVisible = false;
		this.runtimeErrorOverlay = null;
		this.resetActionPromptState();
		this.closeCreateResourcePrompt(false);
		this.hideResourcePanel();
	}

	private updateBlink(deltaSeconds: number): void {
		this.blinkTimer += deltaSeconds;
		if (this.blinkTimer >= CURSOR_BLINK_INTERVAL) {
			this.blinkTimer -= CURSOR_BLINK_INTERVAL;
			this.cursorVisible = !this.cursorVisible;
		}
	}

	private splitLines(source: string): string[] {
		return source.split(/\r?\n/);
	}

	private handleActionPromptInput(keyboard: KeyboardInput): void {
		if (!this.pendingActionPrompt) {
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'Escape')) {
			this.consumeKey(keyboard, 'Escape');
			this.resetActionPromptState();
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'Enter')) {
			this.consumeKey(keyboard, 'Enter');
			void this.handleActionPromptSelection('save-continue');
		}
	}

	private handleEditorInput(keyboard: KeyboardInput, deltaSeconds: number): void {
		if (this.resourcePanelVisible && this.resourcePanelFocused) {
			this.handleResourceBrowserKeyboard(keyboard, deltaSeconds);
			return;
		}
		if (this.isResourceViewActive()) {
			this.handleResourceViewerInput(keyboard, deltaSeconds);
			return;
		}
		const ctrlDown = this.isModifierPressed(keyboard, 'ControlLeft') || this.isModifierPressed(keyboard, 'ControlRight');
		const shiftDown = this.isModifierPressed(keyboard, 'ShiftLeft') || this.isModifierPressed(keyboard, 'ShiftRight');
		const metaDown = this.isModifierPressed(keyboard, 'MetaLeft') || this.isModifierPressed(keyboard, 'MetaRight');
		const altDown = this.isModifierPressed(keyboard, 'AltLeft') || this.isModifierPressed(keyboard, 'AltRight');

		if ((ctrlDown || metaDown) && shiftDown && this.isKeyJustPressed(keyboard, 'KeyO')) {
			this.consumeKey(keyboard, 'KeyO');
			this.openSymbolSearch();
			return;
		}
		if ((ctrlDown && altDown) && this.isKeyJustPressed(keyboard, 'Comma')) {
			this.consumeKey(keyboard, 'Comma');
			this.openSymbolSearch();
			return;
		}
		if (!ctrlDown && !metaDown && altDown && this.isKeyJustPressed(keyboard, 'Comma')) {
			this.consumeKey(keyboard, 'Comma');
			this.openGlobalSymbolSearch();
			return;
		}

		if (this.createResourceActive) {
			this.handleCreateResourceInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
			return;
		}

		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyN')) {
			this.consumeKey(keyboard, 'KeyN');
			this.openCreateResourcePrompt();
			return;
		}

		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyF')) {
			this.consumeKey(keyboard, 'KeyF');
			this.openSearch(true);
			return;
		}
		const inlineFieldFocused = this.searchActive || this.symbolSearchActive || this.lineJumpActive || this.createResourceActive;
		if ((ctrlDown || metaDown)
			&& !inlineFieldFocused
			&& !this.resourcePanelFocused
			&& this.isCodeTabActive()
			&& this.isKeyJustPressed(keyboard, 'KeyA')) {
			this.consumeKey(keyboard, 'KeyA');
			this.selectionAnchor = { row: 0, column: 0 };
			const lastRowIndex = this.lines.length > 0 ? this.lines.length - 1 : 0;
			const lastColumn = this.lines.length > 0 ? this.lines[lastRowIndex].length : 0;
			this.cursorRow = lastRowIndex;
			this.cursorColumn = lastColumn;
			this.updateDesiredColumn();
			this.resetBlink();
			this.revealCursor();
			return;
		}
		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyL')) {
			this.consumeKey(keyboard, 'KeyL');
			this.openLineJump();
			return;
		}
		if (this.symbolSearchActive) {
			this.handleSymbolSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
			return;
		}
		if (this.lineJumpActive) {
			this.handleLineJumpInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
			return;
		}
		if (this.searchActive) {
			this.handleSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
			return;
		}
		if (this.searchQuery.length > 0 && this.isKeyJustPressed(keyboard, 'F3')) {
			this.consumeKey(keyboard, 'F3');
			if (shiftDown) {
				this.jumpToPreviousMatch();
			} else {
				this.jumpToNextMatch();
			}
			return;
		}
		if ((ctrlDown || metaDown) && this.shouldFireRepeat(keyboard, 'KeyZ', deltaSeconds)) {
			this.consumeKey(keyboard, 'KeyZ');
			if (shiftDown) {
				this.redo();
			} else {
				this.undo();
			}
			return;
		}
		if ((ctrlDown || metaDown) && this.shouldFireRepeat(keyboard, 'KeyY', deltaSeconds)) {
			this.consumeKey(keyboard, 'KeyY');
			this.redo();
			return;
		}
		if (ctrlDown && this.isKeyJustPressed(keyboard, 'KeyS')) {
			this.consumeKey(keyboard, 'KeyS');
			void this.save();
			return;
		}
		if (ctrlDown && this.isKeyJustPressed(keyboard, 'KeyC')) {
			this.consumeKey(keyboard, 'KeyC');
			void this.copySelectionToClipboard();
			return;
		}
		if (ctrlDown && this.isKeyJustPressed(keyboard, 'KeyX')) {
			this.consumeKey(keyboard, 'KeyX');
			if (this.hasSelection()) {
				void this.cutSelectionToClipboard();
			} else {
				void this.cutLineToClipboard();
			}
			return;
		}
		if (ctrlDown && this.isKeyJustPressed(keyboard, 'KeyV')) {
			this.consumeKey(keyboard, 'KeyV');
			this.pasteFromClipboard();
			return;
		}
		if ((ctrlDown || metaDown) && !altDown && this.isKeyJustPressed(keyboard, 'Slash')) {
			this.consumeKey(keyboard, 'Slash');
			this.toggleLineComments();
			return;
		}
		if ((ctrlDown || metaDown) && !altDown && this.isKeyJustPressed(keyboard, 'NumpadDivide')) {
			this.consumeKey(keyboard, 'NumpadDivide');
			this.toggleLineComments();
			return;
		}
		if (ctrlDown && this.isKeyJustPressed(keyboard, 'BracketRight')) {
			this.consumeKey(keyboard, 'BracketRight');
			this.indentSelectionOrLine();
			return;
		}
		if (ctrlDown && this.isKeyJustPressed(keyboard, 'BracketLeft')) {
			this.consumeKey(keyboard, 'BracketLeft');
			this.unindentSelectionOrLine();
			return;
		}
		this.handleNavigationKeys(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown);
		this.handleEditingKeys(keyboard, deltaSeconds, shiftDown, ctrlDown);
		if (ctrlDown || metaDown || altDown) {
			return;
		}
		this.handleCharacterInput(keyboard, shiftDown);
		if (this.isKeyJustPressed(keyboard, 'Space')) {
			this.insertText(' ');
			this.consumeKey(keyboard, 'Space');
		}
	}

	private handleCreateResourceInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		const altDown = this.isModifierPressed(keyboard, 'AltLeft') || this.isModifierPressed(keyboard, 'AltRight');
		if (this.isKeyJustPressed(keyboard, 'Escape')) {
			this.consumeKey(keyboard, 'Escape');
			this.cancelCreateResourcePrompt();
			return;
		}
		if (!this.createResourceWorking && this.isKeyJustPressed(keyboard, 'Enter')) {
			this.consumeKey(keyboard, 'Enter');
			void this.confirmCreateResourcePrompt();
			return;
		}
		if (this.createResourceWorking) {
			return;
		}
		const textChanged = this.handleInlineFieldEditing(this.createResourceField, keyboard, {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			deltaSeconds,
			allowSpace: true,
			characterFilter: (value: string): boolean => this.isValidCreateResourceCharacter(value),
			maxLength: CREATE_RESOURCE_MAX_PATH_LENGTH,
		});
		if (textChanged) {
			this.createResourceError = null;
			this.resetBlink();
		}
		this.createResourcePath = this.createResourceField.text;
	}

	private openCreateResourcePrompt(): void {
		if (this.createResourceWorking) {
			return;
		}
		this.resourcePanelFocused = false;
		let defaultPath = this.createResourcePath.length === 0
			? this.determineCreateResourceDefaultPath()
			: this.createResourcePath;
		if (defaultPath.length > CREATE_RESOURCE_MAX_PATH_LENGTH) {
			defaultPath = defaultPath.slice(defaultPath.length - CREATE_RESOURCE_MAX_PATH_LENGTH);
		}
		this.applyCreateResourceFieldText(defaultPath, true);
		this.createResourceVisible = true;
		this.createResourceActive = true;
		this.createResourceError = null;
		this.cursorVisible = true;
		this.resetBlink();
	}

	private closeCreateResourcePrompt(focusEditor: boolean): void {
		this.createResourceActive = false;
		this.createResourceVisible = false;
		this.createResourceWorking = false;
		if (focusEditor) {
			this.focusEditorFromSearch();
			this.focusEditorFromLineJump();
		}
		this.applyCreateResourceFieldText('', true);
		this.createResourceError = null;
		this.resetBlink();
	}

	private cancelCreateResourcePrompt(): void {
		this.closeCreateResourcePrompt(true);
	}

	private async confirmCreateResourcePrompt(): Promise<void> {
		if (this.createResourceWorking) {
			return;
		}
		let normalizedPath: string;
		let assetId: string;
		let directory: string;
		try {
			const result = this.normalizeCreateResourceRequest(this.createResourcePath);
			normalizedPath = result.path;
			assetId = result.assetId;
			directory = result.directory;
			this.applyCreateResourceFieldText(normalizedPath, true);
			this.createResourceError = null;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.createResourceError = message;
			this.showMessage(message, COLOR_STATUS_ERROR, 4.0);
			this.resetBlink();
			return;
		}
		this.createResourceWorking = true;
		this.resetBlink();
		const contents = this.buildDefaultResourceContents(normalizedPath, assetId);
		try {
			const descriptor = await this.createLuaResourceFn({ path: normalizedPath, assetId, contents });
			this.lastCreateResourceDirectory = directory;
			this.pendingResourceSelectionAssetId = descriptor.assetId;
			if (this.resourcePanelVisible) {
				this.refreshResourcePanelContents();
			}
			this.openLuaCodeTab(descriptor);
			this.showMessage(`Created ${descriptor.path} (asset ${descriptor.assetId})`, COLOR_STATUS_SUCCESS, 2.5);
			this.closeCreateResourcePrompt(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const simplified = this.simplifyRuntimeErrorMessage(message);
			this.createResourceError = simplified;
			this.showMessage(`Failed to create resource: ${simplified}`, COLOR_STATUS_WARNING, 4.0);
		} finally {
			this.createResourceWorking = false;
			this.resetBlink();
		}
	}

	private isValidCreateResourceCharacter(value: string): boolean {
		if (value.length !== 1) {
			return false;
		}
		const code = value.charCodeAt(0);
		if (code >= 48 && code <= 57) {
			return true;
		}
		if (code >= 65 && code <= 90) {
			return true;
		}
		if (code >= 97 && code <= 122) {
			return true;
		}
		return value === '_' || value === '-' || value === '.' || value === '/';
	}

	private normalizeCreateResourceRequest(rawPath: string): { path: string; assetId: string; directory: string } {
		let candidate = rawPath.trim();
		if (candidate.length === 0) {
			throw new Error('Path must not be empty.');
		}
		if (candidate.indexOf('\n') !== -1 || candidate.indexOf('\r') !== -1) {
			throw new Error('Path cannot contain newlines.');
		}
		candidate = candidate.replace(/\\/g, '/');
		candidate = candidate.replace(/\/+/g, '/');
		if (candidate.startsWith('./')) {
			candidate = candidate.slice(2);
		}
		while (candidate.startsWith('/')) {
			candidate = candidate.slice(1);
		}
		const segments = candidate.split('/');
		for (let i = 0; i < segments.length; i += 1) {
			if (segments[i] === '..') {
				throw new Error('Path cannot contain ".." segments.');
			}
		}
		if (candidate.endsWith('/')) {
			throw new Error('Path must include a file name.');
		}
		if (!candidate.endsWith('.lua')) {
			candidate += '.lua';
		}
		const slashIndex = candidate.lastIndexOf('/');
		const directory = slashIndex === -1 ? '' : candidate.slice(0, slashIndex + 1);
		const fileName = slashIndex === -1 ? candidate : candidate.slice(slashIndex + 1);
		if (fileName.length === 0) {
			throw new Error('File name cannot be empty.');
		}
		const baseName = fileName.endsWith('.lua') ? fileName.slice(0, -4) : fileName;
		if (baseName.length === 0) {
			throw new Error('Asset id cannot be empty.');
		}
		return { path: candidate, assetId: baseName, directory: this.ensureDirectorySuffix(directory) };
	}

	private determineCreateResourceDefaultPath(): string {
		if (this.lastCreateResourceDirectory && this.lastCreateResourceDirectory.length > 0) {
			return this.lastCreateResourceDirectory;
		}
		const activeContext = this.getActiveCodeTabContext();
		if (activeContext && activeContext.descriptor && typeof activeContext.descriptor.path === 'string' && activeContext.descriptor.path.length > 0) {
			return this.ensureDirectorySuffix(activeContext.descriptor.path);
		}
		let descriptors: ConsoleResourceDescriptor[] = [];
		try {
			descriptors = this.listResourcesFn();
		} catch (error) {
			descriptors = [];
		}
		const firstLua = descriptors.find(entry => entry.type === 'lua' && typeof entry.path === 'string' && entry.path.length > 0);
		if (firstLua && typeof firstLua.path === 'string') {
			return this.ensureDirectorySuffix(firstLua.path);
		}
		return 'res/lua/';
	}

	private ensureDirectorySuffix(path: string): string {
		if (!path || path.length === 0) {
			return '';
		}
		const normalized = path.replace(/\\/g, '/');
		const slashIndex = normalized.lastIndexOf('/');
		if (slashIndex === -1) {
			return '';
		}
		return normalized.slice(0, slashIndex + 1);
	}

	private buildDefaultResourceContents(path: string, assetId: string): string {
		if (this.resourcePathRepresentsFsm(path, assetId)) {
			const blueprintId = this.sanitizeFsmBlueprintId(assetId);
			if (blueprintId === 'new_fsm') {
				return DEFAULT_NEW_FSM_RESOURCE_CONTENT;
			}
			return DEFAULT_NEW_FSM_RESOURCE_CONTENT.replace('new_fsm', blueprintId);
		}
		return DEFAULT_NEW_LUA_RESOURCE_CONTENT;
	}

	private resourcePathRepresentsFsm(path: string, assetId: string): boolean {
		if (path.toLowerCase().indexOf('.fsm.') !== -1) {
			return true;
		}
		return assetId.toLowerCase().indexOf('.fsm') !== -1;
	}

	private sanitizeFsmBlueprintId(assetId: string): string {
		let id = assetId.replace(/\.lua$/i, '').replace(/\.fsm$/i, '');
		id = id.replace(/[^A-Za-z0-9_]/g, '_');
		if (id.length === 0) {
			return 'new_fsm';
		}
		return id;
	}

	private handleSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		const altDown = this.isModifierPressed(keyboard, 'AltLeft') || this.isModifierPressed(keyboard, 'AltRight');
		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyF')) {
			this.consumeKey(keyboard, 'KeyF');
			this.openSearch(false);
			return;
		}
		if ((ctrlDown || metaDown) && this.shouldFireRepeat(keyboard, 'KeyZ', deltaSeconds)) {
			this.consumeKey(keyboard, 'KeyZ');
			if (shiftDown) {
				this.redo();
			} else {
				this.undo();
			}
			return;
		}
		if ((ctrlDown || metaDown) && this.shouldFireRepeat(keyboard, 'KeyY', deltaSeconds)) {
			this.consumeKey(keyboard, 'KeyY');
			this.redo();
			return;
		}
		if (ctrlDown && this.isKeyJustPressed(keyboard, 'KeyS')) {
			this.consumeKey(keyboard, 'KeyS');
			void this.save();
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'Enter')) {
			this.consumeKey(keyboard, 'Enter');
			if (shiftDown) {
				this.jumpToPreviousMatch();
			} else {
				this.jumpToNextMatch();
			}
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'F3')) {
			this.consumeKey(keyboard, 'F3');
			if (shiftDown) {
				this.jumpToPreviousMatch();
			} else {
				this.jumpToNextMatch();
			}
			return;
		}

		const textChanged = this.handleInlineFieldEditing(this.searchField, keyboard, {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			deltaSeconds,
			allowSpace: true,
			characterFilter: undefined,
			maxLength: null,
		});

		this.searchQuery = this.searchField.text;
		if (textChanged) {
			this.onSearchQueryChanged();
		}
	}

	private handleLineJumpInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyL')) {
			this.consumeKey(keyboard, 'KeyL');
			this.openLineJump();
			return;
		}
		const altDown = this.isModifierPressed(keyboard, 'AltLeft') || this.isModifierPressed(keyboard, 'AltRight');
		if (this.isKeyJustPressed(keyboard, 'Enter')) {
			this.consumeKey(keyboard, 'Enter');
			this.applyLineJump();
			return;
		}
		if (!shiftDown && this.isKeyJustPressed(keyboard, 'NumpadEnter')) {
			this.consumeKey(keyboard, 'NumpadEnter');
			this.applyLineJump();
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'Escape')) {
			this.consumeKey(keyboard, 'Escape');
			this.closeLineJump(false);
			return;
		}

		const digitFilter = (value: string): boolean => value >= '0' && value <= '9';
		const textChanged = this.handleInlineFieldEditing(this.lineJumpField, keyboard, {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			deltaSeconds,
			allowSpace: false,
			characterFilter: digitFilter,
			maxLength: 6,
		});
		this.lineJumpValue = this.lineJumpField.text;
		if (textChanged) {
			// keep value in sync; no additional processing required
		}
	}

	private openSearch(useSelection: boolean): void {
		this.closeSymbolSearch(false);
		this.closeLineJump(false);
		this.searchVisible = true;
		this.searchActive = true;
		this.applySearchFieldText(this.searchQuery, true);
		let appliedSelection = false;
		if (useSelection) {
			const range = this.getSelectionRange();
			const selected = this.getSelectionText();
			if (range && selected !== null && selected.length > 0 && selected.indexOf('\n') === -1) {
				this.applySearchFieldText(selected, true);
				this.cursorRow = range.start.row;
				this.cursorColumn = range.start.column;
				appliedSelection = true;
			}
		}
		if (!appliedSelection && this.searchField.text.length === 0) {
			this.searchCurrentIndex = -1;
		}
		this.searchQuery = this.searchField.text;
		this.onSearchQueryChanged();
		this.resetBlink();
	}

	private closeSearch(clearQuery: boolean): void {
		this.searchActive = false;
		if (clearQuery) {
			this.applySearchFieldText('', true);
		}
		this.searchQuery = this.searchField.text;
		const shouldHide = clearQuery || this.searchQuery.length === 0;
		this.searchVisible = shouldHide ? false : true;
		this.searchMatches = [];
		this.searchCurrentIndex = -1;
		this.selectionAnchor = null;
		this.resetBlink();
	}

	private focusEditorFromSearch(): void {
		if (!this.searchActive && !this.searchVisible) {
			return;
		}
		this.searchActive = false;
		if (this.searchQuery.length === 0) {
			this.searchVisible = false;
		}
		this.searchMatches = [];
		this.searchCurrentIndex = -1;
		this.selectionAnchor = null;
		this.searchField.selectionAnchor = null;
		this.searchField.pointerSelecting = false;
		this.resetBlink();
	}

	private openSymbolSearch(): void {
		this.closeSearch(false);
		this.closeLineJump(false);
		this.symbolSearchGlobal = false;
		this.symbolSearchVisible = true;
		this.symbolSearchActive = true;
		this.applySymbolSearchFieldText('', true);
		this.refreshSymbolCatalog(true);
		this.updateSymbolSearchMatches();
		this.symbolSearchHoverIndex = -1;
		this.resetBlink();
	}

	private openGlobalSymbolSearch(): void {
		this.closeSearch(false);
		this.closeLineJump(false);
		this.symbolSearchGlobal = true;
		this.symbolSearchVisible = true;
		this.symbolSearchActive = true;
		this.applySymbolSearchFieldText('', true);
		this.refreshSymbolCatalog(true);
		this.updateSymbolSearchMatches();
		this.symbolSearchHoverIndex = -1;
		this.resetBlink();
	}

	private closeSymbolSearch(clearQuery: boolean): void {
		if (clearQuery) {
			this.applySymbolSearchFieldText('', true);
		}
		this.symbolSearchActive = false;
		this.symbolSearchVisible = false;
		this.symbolSearchGlobal = false;
		this.symbolSearchMatches = [];
		this.symbolSearchSelectionIndex = -1;
		this.symbolSearchDisplayOffset = 0;
		this.symbolSearchHoverIndex = -1;
		this.symbolSearchField.selectionAnchor = null;
		this.symbolSearchField.pointerSelecting = false;
		this.resetBlink();
	}

	private focusEditorFromSymbolSearch(): void {
		if (!this.symbolSearchActive && !this.symbolSearchVisible) {
			return;
		}
		this.symbolSearchActive = false;
		if (this.symbolSearchQuery.length === 0) {
			this.symbolSearchVisible = false;
			this.symbolSearchMatches = [];
			this.symbolSearchSelectionIndex = -1;
			this.symbolSearchDisplayOffset = 0;
		}
		this.symbolSearchField.selectionAnchor = null;
		this.symbolSearchField.pointerSelecting = false;
		this.resetBlink();
	}

	private refreshSymbolCatalog(force: boolean): void {
		const scope: 'local' | 'global' = this.symbolSearchGlobal ? 'global' : 'local';
		let assetId: string | null = null;
		let chunkName: string | null = null;
		if (scope === 'local') {
			const context = this.getActiveCodeTabContext();
			assetId = this.resolveHoverAssetId(context);
			chunkName = this.resolveHoverChunkName(context);
		}
		const existing = this.symbolCatalogContext;
		const unchanged = existing !== null
			&& existing.scope === scope
			&& (scope === 'global'
				|| (existing.assetId === assetId && existing.chunkName === chunkName));
		if (!force && unchanged) {
			return;
		}
		let entries: ConsoleLuaSymbolEntry[] = [];
		try {
			if (scope === 'global') {
				entries = this.listGlobalLuaSymbolsFn();
			} else {
				entries = this.listLuaSymbolsFn(assetId, chunkName);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.symbolCatalog = [];
			this.symbolSearchMatches = [];
			this.symbolSearchSelectionIndex = -1;
			this.symbolSearchDisplayOffset = 0;
			this.symbolSearchHoverIndex = -1;
			this.showMessage(`Failed to list symbols: ${message}`, COLOR_STATUS_ERROR, 3.0);
			return;
		}
		this.symbolCatalogContext = { scope, assetId, chunkName };
		this.symbolCatalog = entries.map((entry) => {
			const display = entry.path && entry.path.length > 0 ? entry.path : entry.name;
			const sourceLabel = scope === 'global' ? this.symbolSourceLabel(entry) : null;
			const combinedKey = (display + ' ' + (sourceLabel ?? '')).toLowerCase();
			return {
				symbol: entry,
				displayName: display,
				searchKey: combinedKey,
				line: entry.location.range.startLine,
				kindLabel: this.symbolKindLabel(entry.kind),
				sourceLabel,
			};
		}).sort((a, b) => {
			if (a.line !== b.line) {
				return a.line - b.line;
			}
			if (a.displayName !== b.displayName) {
				return a.displayName.localeCompare(b.displayName);
			}
			const aSource = a.sourceLabel ?? '';
			const bSource = b.sourceLabel ?? '';
			return aSource.localeCompare(bSource);
		});
	}

	private symbolPriority(kind: ConsoleLuaSymbolEntry['kind']): number {
		switch (kind) {
			case 'table_field':
				return 5;
			case 'function':
				return 4;
			case 'parameter':
				return 3;
			case 'variable':
				return 2;
			case 'assignment':
			default:
				return 1;
		}
	}

	private symbolKindLabel(kind: ConsoleLuaSymbolEntry['kind']): string {
		switch (kind) {
			case 'function':
				return 'FUNC';
			case 'table_field':
				return 'FIELD';
			case 'parameter':
				return 'PARAM';
			case 'variable':
				return 'VAR';
			case 'assignment':
			default:
				return 'SET';
		}
	}

	private symbolSourceLabel(entry: ConsoleLuaSymbolEntry): string | null {
		let label = entry.location.path ?? entry.location.assetId ?? entry.location.chunkName ?? null;
		if (!label) {
			return null;
		}
		label = label.replace(/\\/g, '/');
		const lastSlash = label.lastIndexOf('/');
		if (lastSlash !== -1 && lastSlash + 1 < label.length) {
			label = label.slice(lastSlash + 1);
		}
		return label;
	}

	private updateSymbolSearchMatches(): void {
		this.refreshSymbolCatalog(false);
		this.symbolSearchMatches = [];
		this.symbolSearchSelectionIndex = -1;
		this.symbolSearchDisplayOffset = 0;
		this.symbolSearchHoverIndex = -1;
		if (this.symbolCatalog.length === 0) {
			return;
		}
		const query = this.symbolSearchQuery.trim().toLowerCase();
		if (query.length === 0) {
			this.symbolSearchMatches = this.symbolCatalog.map(entry => ({ entry, matchIndex: 0 }));
			if (this.symbolSearchMatches.length > 0) {
				this.symbolSearchSelectionIndex = 0;
			}
			return;
		}
		const matches: SymbolSearchResult[] = [];
		for (const entry of this.symbolCatalog) {
			const idx = entry.searchKey.indexOf(query);
			if (idx === -1) {
				continue;
			}
			matches.push({ entry, matchIndex: idx });
		}
		if (matches.length === 0) {
			this.symbolSearchMatches = [];
			return;
		}
		matches.sort((a, b) => {
			if (a.matchIndex !== b.matchIndex) {
				return a.matchIndex - b.matchIndex;
			}
			const aPriority = this.symbolPriority(a.entry.symbol.kind);
			const bPriority = this.symbolPriority(b.entry.symbol.kind);
			if (aPriority !== bPriority) {
				return bPriority - aPriority;
			}
			if (a.entry.searchKey.length !== b.entry.searchKey.length) {
				return a.entry.searchKey.length - b.entry.searchKey.length;
			}
			if (a.entry.line !== b.entry.line) {
				return a.entry.line - b.entry.line;
			}
			return a.entry.displayName.localeCompare(b.entry.displayName);
		});
		this.symbolSearchMatches = matches;
		this.symbolSearchSelectionIndex = 0;
		this.symbolSearchDisplayOffset = 0;
	}

	private symbolSearchVisibleResultCount(): number {
		if (!this.symbolSearchVisible) {
			return 0;
		}
		const remaining = Math.max(0, this.symbolSearchMatches.length - this.symbolSearchDisplayOffset);
		return Math.min(remaining, SYMBOL_SEARCH_MAX_RESULTS);
	}

	private ensureSymbolSearchSelectionVisible(): void {
		if (this.symbolSearchSelectionIndex < 0) {
			this.symbolSearchDisplayOffset = 0;
			return;
		}
		const maxVisible = SYMBOL_SEARCH_MAX_RESULTS;
		if (this.symbolSearchSelectionIndex < this.symbolSearchDisplayOffset) {
			this.symbolSearchDisplayOffset = this.symbolSearchSelectionIndex;
		}
		if (this.symbolSearchSelectionIndex >= this.symbolSearchDisplayOffset + maxVisible) {
			this.symbolSearchDisplayOffset = this.symbolSearchSelectionIndex - maxVisible + 1;
		}
		if (this.symbolSearchDisplayOffset < 0) {
			this.symbolSearchDisplayOffset = 0;
		}
		const maxOffset = Math.max(0, this.symbolSearchMatches.length - maxVisible);
		if (this.symbolSearchDisplayOffset > maxOffset) {
			this.symbolSearchDisplayOffset = maxOffset;
		}
	}

	private moveSymbolSearchSelection(delta: number): void {
		if (this.symbolSearchMatches.length === 0) {
			return;
		}
		let next = this.symbolSearchSelectionIndex;
		if (next === -1) {
			next = delta > 0 ? 0 : this.symbolSearchMatches.length - 1;
		} else {
			next = clamp(next + delta, 0, this.symbolSearchMatches.length - 1);
		}
		if (next === this.symbolSearchSelectionIndex) {
			return;
		}
		this.symbolSearchSelectionIndex = next;
		this.ensureSymbolSearchSelectionVisible();
		this.resetBlink();
	}

	private applySymbolSearchSelection(index: number): void {
		if (index < 0 || index >= this.symbolSearchMatches.length) {
			this.showMessage('Symbol not found', COLOR_STATUS_WARNING, 1.5);
			return;
		}
		const match = this.symbolSearchMatches[index];
		this.closeSymbolSearch(true);
		this.navigateToLuaDefinition(match.entry.symbol.location);
	}

	private handleSymbolSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		const altDown = this.isModifierPressed(keyboard, 'AltLeft') || this.isModifierPressed(keyboard, 'AltRight');
		if (this.isKeyJustPressed(keyboard, 'Enter')) {
			this.consumeKey(keyboard, 'Enter');
			if (shiftDown) {
				this.moveSymbolSearchSelection(-1);
				return;
			}
			if (this.symbolSearchSelectionIndex >= 0) {
				this.applySymbolSearchSelection(this.symbolSearchSelectionIndex);
			} else {
				this.showMessage('No symbol selected', COLOR_STATUS_WARNING, 1.5);
			}
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'Escape')) {
			this.consumeKey(keyboard, 'Escape');
			this.closeSymbolSearch(true);
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
			this.consumeKey(keyboard, 'ArrowUp');
			this.moveSymbolSearchSelection(-1);
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
			this.consumeKey(keyboard, 'ArrowDown');
			this.moveSymbolSearchSelection(1);
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
			this.consumeKey(keyboard, 'PageUp');
			this.moveSymbolSearchSelection(-SYMBOL_SEARCH_MAX_RESULTS);
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			this.consumeKey(keyboard, 'PageDown');
			this.moveSymbolSearchSelection(SYMBOL_SEARCH_MAX_RESULTS);
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'Home')) {
			this.consumeKey(keyboard, 'Home');
			this.symbolSearchSelectionIndex = this.symbolSearchMatches.length > 0 ? 0 : -1;
			this.ensureSymbolSearchSelectionVisible();
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'End')) {
			this.consumeKey(keyboard, 'End');
			this.symbolSearchSelectionIndex = this.symbolSearchMatches.length > 0 ? this.symbolSearchMatches.length - 1 : -1;
			this.ensureSymbolSearchSelectionVisible();
			return;
		}
		const textChanged = this.handleInlineFieldEditing(this.symbolSearchField, keyboard, {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			deltaSeconds,
			allowSpace: true,
			characterFilter: undefined,
			maxLength: null,
		});
		this.symbolSearchQuery = this.symbolSearchField.text;
		if (textChanged) {
			this.updateSymbolSearchMatches();
		}
	}

	private openLineJump(): void {
		this.closeSymbolSearch(false);
		this.closeSearch(false);
		this.searchVisible = false;
		this.lineJumpVisible = true;
		this.lineJumpActive = true;
		this.applyLineJumpFieldText('', true);
		this.resetBlink();
	}

	private closeLineJump(clearValue: boolean): void {
		this.lineJumpActive = false;
		this.lineJumpVisible = false;
		if (clearValue) {
			this.applyLineJumpFieldText('', true);
		}
		this.lineJumpField.selectionAnchor = null;
		this.lineJumpField.pointerSelecting = false;
		this.resetBlink();
	}

	private focusEditorFromLineJump(): void {
		if (!this.lineJumpActive && !this.lineJumpVisible) {
			return;
		}
		this.lineJumpActive = false;
		this.lineJumpVisible = false;
		this.lineJumpField.selectionAnchor = null;
		this.lineJumpField.pointerSelecting = false;
		this.resetBlink();
	}

	private focusEditorFromResourcePanel(): void {
		if (!this.resourcePanelFocused) {
			return;
		}
		this.resourcePanelFocused = false;
		this.resetBlink();
	}

	private applyLineJump(): void {
		if (this.lineJumpValue.length === 0) {
			this.showMessage('Enter a line number', COLOR_STATUS_WARNING, 1.5);
			return;
		}
		const target = Number.parseInt(this.lineJumpValue, 10);
		if (!Number.isFinite(target) || target < 1 || target > this.lines.length) {
			const limit = this.lines.length <= 0 ? 1 : this.lines.length;
			this.showMessage(`Line must be between 1 and ${limit}`, COLOR_STATUS_WARNING, 1.8);
			return;
		}
		this.setCursorPosition(target - 1, 0);
		this.clearSelection();
		this.breakUndoSequence();
		this.closeLineJump(true);
		this.showMessage(`Jumped to line ${target}`, COLOR_STATUS_SUCCESS, 1.5);
	}

	private onSearchQueryChanged(): void {
		this.updateSearchMatches();
		if (this.searchMatches.length === 0) {
			this.selectionAnchor = null;
			this.searchCurrentIndex = -1;
			return;
		}
		if (this.searchCurrentIndex < 0 || this.searchCurrentIndex >= this.searchMatches.length) {
			this.searchCurrentIndex = 0;
		}
		this.focusSearchResult(this.searchCurrentIndex);
	}

	private updateSearchMatches(): void {
		this.searchMatches = [];
		this.searchCurrentIndex = -1;
		if (this.searchQuery.length === 0) {
			this.lastSearchVersion = this.textVersion;
			return;
		}
		const needle = this.searchQuery.toLowerCase();
		for (let row = 0; row < this.lines.length; row++) {
			const line = this.lines[row];
			if (line.length === 0) {
				continue;
			}
			const lower = line.toLowerCase();
			let start = 0;
			while (start <= lower.length - needle.length) {
				const index = lower.indexOf(needle, start);
				if (index === -1) {
					break;
				}
				this.searchMatches.push({ row, start: index, end: index + needle.length });
				if (this.searchCurrentIndex === -1) {
					if (row > this.cursorRow || (row === this.cursorRow && index >= this.cursorColumn)) {
						this.searchCurrentIndex = this.searchMatches.length - 1;
					}
				}
				start = index + needle.length;
			}
		}
		if (this.searchCurrentIndex === -1 && this.searchMatches.length > 0) {
			this.searchCurrentIndex = 0;
		}
		this.lastSearchVersion = this.textVersion;
	}

	private focusSearchResult(index: number): void {
		if (index < 0 || index >= this.searchMatches.length) {
			return;
		}
		const match = this.searchMatches[index];
		this.cursorRow = match.row;
		this.cursorColumn = match.start;
		this.selectionAnchor = { row: match.row, column: match.end };
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
	}

	private jumpToNextMatch(): void {
		if (this.searchMatches.length === 0) {
			this.showMessage('No matches found', COLOR_STATUS_WARNING, 1.5);
			return;
		}
		if (this.searchCurrentIndex < 0) {
			this.searchCurrentIndex = 0;
		} else {
			this.searchCurrentIndex += 1;
			if (this.searchCurrentIndex >= this.searchMatches.length) {
				this.searchCurrentIndex = 0;
			}
		}
		this.focusSearchResult(this.searchCurrentIndex);
	}

	private jumpToPreviousMatch(): void {
		if (this.searchMatches.length === 0) {
			this.showMessage('No matches found', COLOR_STATUS_WARNING, 1.5);
			return;
		}
		if (this.searchCurrentIndex < 0) {
			this.searchCurrentIndex = this.searchMatches.length - 1;
		} else {
			this.searchCurrentIndex -= 1;
			if (this.searchCurrentIndex < 0) {
				this.searchCurrentIndex = this.searchMatches.length - 1;
			}
		}
		this.focusSearchResult(this.searchCurrentIndex);
	}

	private handleNavigationKeys(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, altDown: boolean): void {
		const previousPosition: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (shiftDown) {
			this.ensureSelectionAnchor(previousPosition);
		}

		if (altDown) {
			let movedAlt = false;
			if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
				this.consumeKey(keyboard, 'ArrowUp');
				this.moveSelectionLines(-1);
				movedAlt = true;
			}
			if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
				this.consumeKey(keyboard, 'ArrowDown');
				this.moveSelectionLines(1);
				movedAlt = true;
			}
			if (movedAlt) {
				return;
			}
			if (this.isKeyPressed(keyboard, 'ArrowUp') || this.isKeyPressed(keyboard, 'ArrowDown')) {
				return;
			}
		}

		if (!shiftDown && this.collapseSelectionOnNavigation(keyboard)) {
			return;
		}

		let moved = false;

		if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
			this.moveCursorVertical(-1);
			this.consumeKey(keyboard, 'ArrowUp');
			moved = true;
		}
		if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
			this.moveCursorVertical(1);
			this.consumeKey(keyboard, 'ArrowDown');
			moved = true;
		}
		if (ctrlDown) {
			if (this.shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) {
				this.moveWordLeft();
				this.consumeKey(keyboard, 'ArrowLeft');
				moved = true;
			}
			if (this.shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) {
				this.moveWordRight();
				this.consumeKey(keyboard, 'ArrowRight');
				moved = true;
			}
		}
		else {
			if (this.shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) {
				this.moveCursorHorizontal(-1);
				this.consumeKey(keyboard, 'ArrowLeft');
				moved = true;
			}
			if (this.shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) {
				this.moveCursorHorizontal(1);
				this.consumeKey(keyboard, 'ArrowRight');
				moved = true;
			}
		}

		if (this.shouldFireRepeat(keyboard, 'Home', deltaSeconds)) {
			if (ctrlDown) {
				this.cursorRow = 0;
				this.cursorColumn = 0;
			} else {
				this.cursorColumn = 0;
			}
			this.updateDesiredColumn();
			this.resetBlink();
			this.consumeKey(keyboard, 'Home');
			moved = true;
		}
		if (this.shouldFireRepeat(keyboard, 'End', deltaSeconds)) {
			if (ctrlDown) {
				const lastRow = this.lines.length - 1;
				if (lastRow < 0) {
					this.cursorRow = 0;
					this.cursorColumn = 0;
				} else {
					this.cursorRow = lastRow;
					this.cursorColumn = this.lines[lastRow].length;
				}
			} else {
				this.cursorColumn = this.currentLine().length;
			}
			this.updateDesiredColumn();
			this.resetBlink();
			this.consumeKey(keyboard, 'End');
			moved = true;
		}
		if (this.shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
			const rows = this.visibleRowCount();
			this.cursorRow = Math.max(0, this.cursorRow - rows);
			const lineLength = this.currentLine().length;
			this.cursorColumn = clamp(Math.floor(this.desiredColumn), 0, lineLength);
			this.resetBlink();
			this.consumeKey(keyboard, 'PageUp');
			moved = true;
		}
		if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			const rows = this.visibleRowCount();
			this.cursorRow = Math.min(this.lines.length - 1, this.cursorRow + rows);
			const lineLength = this.currentLine().length;
			this.cursorColumn = clamp(Math.floor(this.desiredColumn), 0, lineLength);
			this.resetBlink();
			this.consumeKey(keyboard, 'PageDown');
			moved = true;
		}

		if (!shiftDown && moved) {
			this.clearSelection();
		}
		if (moved) {
			this.breakUndoSequence();
			this.revealCursor();
		}

		if (shiftDown && this.isKeyJustPressed(keyboard, 'Tab')) {
			this.unindentSelectionOrLine();
			this.consumeKey(keyboard, 'Tab');
		}
	}

	private handleEditingKeys(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean): void {
		if (this.shouldFireRepeat(keyboard, 'Backspace', deltaSeconds)) {
			if (ctrlDown) {
				this.deleteWordBackward();
			} else {
				this.backspace();
			}
			this.consumeKey(keyboard, 'Backspace');
		}
		if (this.shouldFireRepeat(keyboard, 'Delete', deltaSeconds)) {
			this.deleteForward();
			this.consumeKey(keyboard, 'Delete');
		}
		if (!shiftDown && this.isKeyJustPressed(keyboard, 'Tab')) {
			this.insertTab();
			this.consumeKey(keyboard, 'Tab');
		}
		if (this.isKeyJustPressed(keyboard, 'Enter')) {
			this.insertLineBreak();
			this.consumeKey(keyboard, 'Enter');
		}
	}

	private handlePointerInput(_deltaSeconds: number): void {
		const keyboard = this.getKeyboard();
		const ctrlDown = this.isModifierPressed(keyboard, 'ControlLeft') || this.isModifierPressed(keyboard, 'ControlRight');
		const metaDown = this.isModifierPressed(keyboard, 'MetaLeft') || this.isModifierPressed(keyboard, 'MetaRight');
		const gotoModifierActive = ctrlDown || metaDown;
		if (!gotoModifierActive) {
			this.clearGotoHoverHighlight();
		}
		const activeContext = this.getActiveCodeTabContext();
		const snapshot = this.readPointerSnapshot();
		this.updateTabHoverState(snapshot);
		this.lastPointerSnapshot = snapshot && snapshot.valid ? snapshot : null;
		if (!snapshot) {
			this.pointerPrimaryWasPressed = false;
			this.activeScrollbarDrag = null;
			this.clearHoverTooltip();
			this.clearGotoHoverHighlight();
			return;
		}
		if (!snapshot.valid) {
			this.activeScrollbarDrag = null;
			this.clearGotoHoverHighlight();
		} else if (this.activeScrollbarDrag && !snapshot.primaryPressed) {
			this.activeScrollbarDrag = null;
		} else if (this.activeScrollbarDrag && snapshot.primaryPressed) {
			if (this.updateScrollbarDrag(snapshot)) {
				this.pointerSelecting = false;
				this.clearHoverTooltip();
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				return;
			}
		}
		if (!snapshot.primaryPressed) {
			this.searchField.pointerSelecting = false;
			this.symbolSearchField.pointerSelecting = false;
			this.lineJumpField.pointerSelecting = false;
			this.createResourceField.pointerSelecting = false;
			this.symbolSearchHoverIndex = -1;
		}
		let pointerAuxJustPressed = false;
		let pointerAuxPressed = false;
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		if (playerInput) {
			const auxAction = playerInput.getActionState('pointer_aux');
			if (auxAction && auxAction.justpressed === true && auxAction.consumed !== true) {
				pointerAuxJustPressed = true;
				pointerAuxPressed = true;
			} else if (auxAction && auxAction.pressed === true && auxAction.consumed !== true) {
				pointerAuxPressed = true;
				pointerAuxJustPressed = !this.pointerAuxWasPressed;
			}
		}
		this.pointerAuxWasPressed = pointerAuxPressed;
		const wasPressed = this.pointerPrimaryWasPressed;
		const justPressed = snapshot.primaryPressed && !wasPressed;
		const justReleased = !snapshot.primaryPressed && wasPressed;
		if (justReleased || (!snapshot.primaryPressed && this.pointerSelecting)) {
			this.pointerSelecting = false;
		}
		if (justPressed && this.tryStartScrollbarDrag(snapshot)) {
			this.pointerSelecting = false;
			this.clearHoverTooltip();
			this.clearGotoHoverHighlight();
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			return;
		}
		if (this.resourcePanelResizing && !snapshot.valid) {
			this.resourcePanelResizing = false;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearGotoHoverHighlight();
			return;
		}
		if (!snapshot.valid) {
			this.resourceBrowserHoverIndex = -1;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearHoverTooltip();
			this.clearGotoHoverHighlight();
			return;
		}
		if (this.resourcePanelResizing) {
			if (!snapshot.primaryPressed) {
				this.resourcePanelResizing = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			} else {
				const viewportWidth = this.viewportWidth > 0 ? this.viewportWidth : 1;
				const requestedRatio = snapshot.viewportX / viewportWidth;
				const clampedRatio = this.clampResourcePanelRatio(requestedRatio);
				const pixelWidth = this.computePanelPixelWidth(clampedRatio);
				if (pixelWidth <= 0) {
					this.hideResourcePanel();
				} else {
					this.resourcePanelWidthRatio = clampedRatio;
					this.clampResourceBrowserHorizontalScroll();
					this.resourceBrowserEnsureSelectionVisible();
				}
				this.resourceBrowserHoverIndex = -1;
				this.resourcePanelFocused = true;
				this.pointerSelecting = false;
				this.resetPointerClickTracking();
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			}
			this.clearGotoHoverHighlight();
			return;
		}
		if (justPressed && snapshot.viewportY >= 0 && snapshot.viewportY < this.headerHeight) {
			if (this.handleTopBarPointer(snapshot)) {
				this.pointerSelecting = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.resetPointerClickTracking();
				this.clearGotoHoverHighlight();
				return;
			}
		}
		if (this.resourcePanelVisible && justPressed && this.isPointerOverResourcePanelDivider(snapshot.viewportX, snapshot.viewportY)) {
			if (this.getResourcePanelWidth() > 0) {
				this.resourcePanelResizing = true;
				this.resourcePanelFocused = true;
				this.pointerSelecting = false;
				this.resourceBrowserHoverIndex = -1;
				this.resetPointerClickTracking();
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			}
			this.clearGotoHoverHighlight();
			return;
		}
		const tabTop = this.headerHeight;
		const tabBottom = tabTop + this.tabBarHeight;
		if (pointerAuxJustPressed && this.handleTabBarMiddleClick(snapshot)) {
			if (playerInput) {
				playerInput.consumeAction('pointer_aux');
			}
			this.pointerSelecting = false;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.resetPointerClickTracking();
			this.clearGotoHoverHighlight();
			return;
		}
		if (justPressed && snapshot.viewportY >= tabTop && snapshot.viewportY < tabBottom) {
			if (this.handleTabBarPointer(snapshot)) {
				this.pointerSelecting = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.resetPointerClickTracking();
				this.clearGotoHoverHighlight();
				return;
			}
		}
		const panelBounds = this.getResourcePanelBounds();
		const pointerInPanel = this.resourcePanelVisible
			&& panelBounds !== null
			&& this.pointInRect(snapshot.viewportX, snapshot.viewportY, panelBounds);
		if (pointerInPanel) {
			this.resourcePanelFocused = true;
			this.resetPointerClickTracking();
			this.clearHoverTooltip();
			const margin = Math.max(4, this.lineHeight);
			if (snapshot.viewportY < panelBounds.top + margin) {
				this.scrollResourceBrowser(-1);
			} else if (snapshot.viewportY >= panelBounds.bottom - margin) {
				this.scrollResourceBrowser(1);
			}
			const hoverIndex = this.resourceBrowserIndexAtPosition(snapshot.viewportX, snapshot.viewportY);
			this.resourceBrowserHoverIndex = hoverIndex;
			if (hoverIndex >= 0) {
				if (hoverIndex !== this.resourceBrowserSelectionIndex) {
					this.resourceBrowserSelectionIndex = hoverIndex;
					this.resourceBrowserEnsureSelectionVisible();
				}
				if (justPressed) {
					const item = this.resourceBrowserItems[hoverIndex];
					if (item && item.descriptor) {
						this.openResourceDescriptor(item.descriptor);
						this.resourcePanelFocused = false;
					}
				}
			}
			if (!snapshot.primaryPressed && hoverIndex === -1) {
				this.resourceBrowserHoverIndex = -1;
			}
			this.pointerSelecting = false;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearGotoHoverHighlight();
			return;
		}
		if (justPressed && !pointerInPanel) {
			this.resourcePanelFocused = false;
		}
		if (this.resourcePanelVisible && !snapshot.primaryPressed) {
			this.resourceBrowserHoverIndex = -1;
		}
		if (this.isResourceViewActive()) {
			this.resetPointerClickTracking();
			this.pointerSelecting = false;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearHoverTooltip();
			this.clearGotoHoverHighlight();
			return;
		}
		if (this.pendingActionPrompt) {
			this.resetPointerClickTracking();
			if (justPressed) {
				this.handleActionPromptPointer(snapshot);
			}
			this.pointerSelecting = false;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearHoverTooltip();
			this.clearGotoHoverHighlight();
			return;
		}
		const createResourceBounds = this.getCreateResourceBarBounds();
		if (this.createResourceVisible && createResourceBounds) {
			const insideCreateBar = this.pointInRect(snapshot.viewportX, snapshot.viewportY, createResourceBounds);
			if (insideCreateBar) {
				if (justPressed) {
					this.createResourceActive = true;
					this.cursorVisible = true;
					this.resetBlink();
					this.resourcePanelFocused = false;
				}
				const label = 'NEW FILE:';
				const labelX = 4;
				const textLeft = labelX + this.measureText(label + ' ');
				this.handleInlineFieldPointer(this.createResourceField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				this.pointerSelecting = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearHoverTooltip();
				this.clearGotoHoverHighlight();
				return;
			}
			if (justPressed) {
				this.createResourceActive = false;
			}
		}
		const symbolBounds = this.getSymbolSearchBarBounds();
		if (this.symbolSearchVisible && symbolBounds) {
			const insideSymbol = this.pointInRect(snapshot.viewportX, snapshot.viewportY, symbolBounds);
			if (insideSymbol) {
				const baseHeight = this.lineHeight + SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
				const fieldBottom = symbolBounds.top + baseHeight;
				const resultsStart = fieldBottom + SYMBOL_SEARCH_RESULT_SPACING;
				if (snapshot.viewportY < fieldBottom) {
					if (justPressed) {
						this.closeLineJump(false);
						this.closeSearch(false);
						this.symbolSearchVisible = true;
						this.symbolSearchActive = true;
						this.resourcePanelFocused = false;
						this.cursorVisible = true;
						this.resetBlink();
					}
					const label = 'SYMBOL @:';
					const labelX = 4;
					const textLeft = labelX + this.measureText(label + ' ');
					this.handleInlineFieldPointer(this.symbolSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
					this.pointerSelecting = false;
					this.pointerPrimaryWasPressed = snapshot.primaryPressed;
					this.clearHoverTooltip();
					this.clearGotoHoverHighlight();
					return;
				}
				const visibleCount = this.symbolSearchVisibleResultCount();
				let hoverIndex = -1;
				if (snapshot.viewportY >= resultsStart) {
					const relative = snapshot.viewportY - resultsStart;
					const indexWithin = Math.floor(relative / this.lineHeight);
					if (indexWithin >= 0 && indexWithin < visibleCount) {
						hoverIndex = this.symbolSearchDisplayOffset + indexWithin;
					}
				}
				this.symbolSearchHoverIndex = hoverIndex;
				if (hoverIndex >= 0 && justPressed) {
					if (hoverIndex !== this.symbolSearchSelectionIndex) {
						this.symbolSearchSelectionIndex = hoverIndex;
						this.ensureSymbolSearchSelectionVisible();
					}
					this.applySymbolSearchSelection(hoverIndex);
					this.pointerSelecting = false;
					this.pointerPrimaryWasPressed = snapshot.primaryPressed;
					this.clearHoverTooltip();
					this.clearGotoHoverHighlight();
					return;
				}
				this.pointerSelecting = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearHoverTooltip();
				this.clearGotoHoverHighlight();
				return;
			}
			if (justPressed) {
				this.symbolSearchActive = false;
			}
			this.symbolSearchHoverIndex = -1;
		}

		const lineJumpBounds = this.getLineJumpBarBounds();
		if (this.lineJumpVisible && lineJumpBounds) {
			const insideLineJump = this.pointInRect(snapshot.viewportX, snapshot.viewportY, lineJumpBounds);
			if (insideLineJump) {
				if (justPressed) {
					this.closeSearch(false);
					this.lineJumpActive = true;
					this.resetBlink();
				}
				const label = 'LINE #:';
				const labelX = 4;
				const textLeft = labelX + this.measureText(label + ' ');
				this.handleInlineFieldPointer(this.lineJumpField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				this.pointerSelecting = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearHoverTooltip();
				this.clearGotoHoverHighlight();
				return;
			}
			if (justPressed) {
				this.lineJumpActive = false;
			}
		}
		const searchBounds = this.getSearchBarBounds();
		if (this.searchVisible && searchBounds) {
			const insideSearch = this.pointInRect(snapshot.viewportX, snapshot.viewportY, searchBounds);
			if (insideSearch) {
				if (justPressed) {
					this.closeLineJump(false);
					this.searchVisible = true;
					this.searchActive = true;
					this.resourcePanelFocused = false;
					this.cursorVisible = true;
					this.resetBlink();
				}
				const label = 'SEARCH:';
				const labelX = 4;
				const textLeft = labelX + this.measureText(label + ' ');
				this.handleInlineFieldPointer(this.searchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				this.pointerSelecting = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearHoverTooltip();
				this.clearGotoHoverHighlight();
				return;
			}
			if (justPressed) {
				this.searchActive = false;
			}
		}

		const bounds = this.getCodeAreaBounds();
		const insideCodeArea = snapshot.viewportY >= bounds.codeTop
			&& snapshot.viewportY < bounds.codeBottom
			&& snapshot.viewportX >= bounds.codeLeft
			&& snapshot.viewportX < bounds.codeRight;
		if (justPressed && insideCodeArea) {
			this.resourcePanelFocused = false;
			this.focusEditorFromLineJump();
			this.focusEditorFromSearch();
			this.focusEditorFromSymbolSearch();
			const targetRow = this.resolvePointerRow(snapshot.viewportY);
			const targetColumn = this.resolvePointerColumn(targetRow, snapshot.viewportX);
			if (gotoModifierActive && this.tryGotoDefinitionAt(targetRow, targetColumn)) {
				this.pointerSelecting = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.resetPointerClickTracking();
				return;
			}
			const doubleClick = this.registerPointerClick(targetRow, targetColumn);
			if (doubleClick) {
				this.selectWordAtPosition(targetRow, targetColumn);
				this.pointerSelecting = false;
			} else {
				this.selectionAnchor = { row: targetRow, column: targetColumn };
				this.setCursorPosition(targetRow, targetColumn);
				this.pointerSelecting = true;
			}
		}
		if (this.pointerSelecting && snapshot.primaryPressed) {
			this.clearGotoHoverHighlight();
			this.handlePointerAutoScroll(snapshot.viewportX, snapshot.viewportY);
			const targetRow = this.resolvePointerRow(snapshot.viewportY);
			const targetColumn = this.resolvePointerColumn(targetRow, snapshot.viewportX);
			if (!this.selectionAnchor) {
				this.selectionAnchor = { row: targetRow, column: targetColumn };
			}
			this.setCursorPosition(targetRow, targetColumn);
		}
		if (this.isCodeTabActive() && !snapshot.primaryPressed && !this.pointerSelecting && insideCodeArea && gotoModifierActive) {
			const hoverRow = this.resolvePointerRow(snapshot.viewportY);
			const hoverColumn = this.resolvePointerColumn(hoverRow, snapshot.viewportX);
			this.refreshGotoHoverHighlight(hoverRow, hoverColumn, activeContext);
		} else if (!gotoModifierActive || !insideCodeArea || snapshot.primaryPressed || this.pointerSelecting || !this.isCodeTabActive()) {
			this.clearGotoHoverHighlight();
		}
		if (this.isCodeTabActive()) {
			const altDown = this.isModifierPressed(keyboard, 'AltLeft') || this.isModifierPressed(keyboard, 'AltRight');
			if (!snapshot.primaryPressed && !this.pointerSelecting && insideCodeArea && altDown) {
				this.updateHoverTooltip(snapshot);
			} else {
				this.clearHoverTooltip();
			}
		} else {
			this.clearHoverTooltip();
		}
		this.pointerPrimaryWasPressed = snapshot.primaryPressed;
	}

	private updateTabHoverState(snapshot: PointerSnapshot | null): void {
		if (!snapshot || !snapshot.valid || !snapshot.insideViewport) {
			this.tabHoverId = null;
			return;
		}
		const tabTop = this.headerHeight;
		const tabBottom = tabTop + this.tabBarHeight;
		const y = snapshot.viewportY;
		if (y < tabTop || y >= tabBottom) {
			this.tabHoverId = null;
			return;
		}
		const x = snapshot.viewportX;
		let hovered: string | null = null;
		for (const [tabId, bounds] of this.tabButtonBounds) {
			if (this.pointInRect(x, y, bounds)) {
				hovered = tabId;
				break;
			}
		}
		this.tabHoverId = hovered;
	}

	private updateHoverTooltip(snapshot: PointerSnapshot): void {
		const context = this.getActiveCodeTabContext();
		const assetId = this.resolveHoverAssetId(context);
		const row = this.resolvePointerRow(snapshot.viewportY);
		const column = this.resolvePointerColumn(row, snapshot.viewportX);
		const token = this.extractHoverExpression(row, column);
		if (!token) {
			this.clearHoverTooltip();
			return;
		}
		const chunkName = this.resolveHoverChunkName(context);
		const request: ConsoleLuaHoverRequest = {
			assetId,
			expression: token.expression,
			chunkName,
			row: row + 1,
			column: token.startColumn + 1,
		};
		const inspection = this.inspectLuaExpressionFn(request);
		const previousInspection = this.lastInspectorResult;
		this.lastInspectorResult = inspection;
		if (!inspection) {
			this.clearHoverTooltip();
			return;
		}
		if (inspection.isFunction && (inspection.isLocalFunction || inspection.isBuiltin)) {
			this.clearHoverTooltip();
			return;
		}
		const contentLines = this.buildHoverContentLines(inspection);
		const existing = this.hoverTooltip;
		if (existing && existing.expression === inspection.expression && existing.assetId === assetId) {
			existing.contentLines = contentLines;
			existing.valueType = inspection.valueType;
			existing.scope = inspection.scope;
			existing.state = inspection.state;
			existing.assetId = assetId;
			existing.row = row;
			existing.startColumn = token.startColumn;
			existing.endColumn = token.endColumn;
			existing.bubbleBounds = null;
			if (!previousInspection || previousInspection.expression !== inspection.expression) {
				existing.scrollOffset = 0;
				existing.visibleLineCount = 0;
			}
			const maxOffset = Math.max(0, contentLines.length - Math.max(1, existing.visibleLineCount));
			if (existing.scrollOffset > maxOffset) {
				existing.scrollOffset = maxOffset;
			}
			return;
		}
		this.hoverTooltip = {
			expression: inspection.expression,
			contentLines,
			valueType: inspection.valueType,
			scope: inspection.scope,
			state: inspection.state,
			assetId,
			row,
			startColumn: token.startColumn,
			endColumn: token.endColumn,
			scrollOffset: 0,
			visibleLineCount: 0,
			bubbleBounds: null,
		};
	}

	private buildHoverContentLines(result: ConsoleLuaHoverResult): string[] {
		const lines: string[] = [];
		const push = (value: string) => {
			lines.push(this.truncateHoverLine(value));
		};
		if (result.state === 'not_defined') {
			push(`${result.expression} = not defined`);
			return lines;
		}
		const valueLines = result.lines.length > 0 ? result.lines : [''];
		if (valueLines.length === 1) {
			const suffix = result.valueType && result.valueType !== 'unknown' ? ` (${result.valueType})` : '';
			push(`${result.expression} = ${valueLines[0]}${suffix}`);
			return lines;
		}
		const suffix = result.valueType && result.valueType !== 'unknown' ? ` (${result.valueType})` : '';
		push(`${result.expression}${suffix}`);
		for (const line of valueLines) {
			push(`  ${line}`);
		}
		return lines;
	}

	private truncateHoverLine(text: string): string {
		if (text.length <= HOVER_TOOLTIP_MAX_LINE_LENGTH) {
			return text;
		}
		return text.slice(0, HOVER_TOOLTIP_MAX_LINE_LENGTH - 3) + '...';
	}

	private clearHoverTooltip(): void {
		this.hoverTooltip = null;
		this.lastInspectorResult = null;
	}

	private tryStartScrollbarDrag(snapshot: PointerSnapshot): boolean {
		if (!snapshot.valid || !snapshot.primaryPressed) {
			return false;
		}
		const order: ScrollbarKind[] = ['codeVertical', 'codeHorizontal', 'resourceVertical', 'resourceHorizontal', 'viewerVertical'];
		for (let i = 0; i < order.length; i += 1) {
			const kind = order[i];
			const scrollbar = this.scrollbars[kind];
			const track = scrollbar.getTrack();
			if (!track) {
				continue;
			}
			const pointerX = snapshot.viewportX;
			const pointerY = snapshot.viewportY;
			const thumb = scrollbar.getThumb();
			const pointerCoord = scrollbar.orientation === 'vertical' ? pointerY : pointerX;
			const hitsThumb = thumb !== null && this.pointInRect(pointerX, pointerY, thumb);
			const hitsTrack = this.pointInRect(pointerX, pointerY, track);
			const extendedHorizontalHit = scrollbar.orientation === 'horizontal'
				&& pointerX >= track.left
				&& pointerX < track.right
				&& pointerY >= track.top
				&& pointerY < track.top + this.bottomMargin;
			if (!hitsThumb && !hitsTrack && !extendedHorizontalHit) {
				continue;
			}
			const pointerOffset = scrollbar.beginDrag(pointerCoord);
			if (pointerOffset === null) {
				continue;
			}
			if (!hitsThumb) {
				this.applyScrollbarScroll(kind, scrollbar.getScroll());
			}
			this.activeScrollbarDrag = { kind, pointerOffset };
			return true;
		}
		return false;
	}

	private updateScrollbarDrag(snapshot: PointerSnapshot): boolean {
		if (!this.activeScrollbarDrag) {
			return false;
		}
		const scrollbar = this.scrollbars[this.activeScrollbarDrag.kind];
		if (!scrollbar.isVisible()) {
			this.activeScrollbarDrag = null;
			return false;
		}
		const pointerCoord = scrollbar.orientation === 'vertical' ? snapshot.viewportY : snapshot.viewportX;
		const newScroll = scrollbar.drag(pointerCoord, this.activeScrollbarDrag.pointerOffset);
		this.applyScrollbarScroll(this.activeScrollbarDrag.kind, newScroll);
		return true;
	}

	private applyScrollbarScroll(kind: ScrollbarKind, scroll: number): void {
		if (Number.isNaN(scroll)) {
			return;
		}
		switch (kind) {
			case 'codeVertical': {
				const rowCount = this.visibleRowCount();
				const maxScroll = Math.max(0, this.lines.length - rowCount);
				this.scrollRow = clamp(Math.round(scroll), 0, maxScroll);
				this.cursorRevealSuspended = true;
				break;
			}
			case 'codeHorizontal': {
				const maxScroll = this.computeMaximumScrollColumn();
				this.scrollColumn = clamp(Math.round(scroll), 0, maxScroll);
				this.cursorRevealSuspended = true;
				break;
			}
			case 'resourceVertical': {
				const capacity = this.resourcePanelLineCapacity();
				const itemCount = this.resourceBrowserItems.length;
				const maxScroll = Math.max(0, itemCount - capacity);
				this.resourceBrowserScroll = clamp(Math.round(scroll), 0, maxScroll);
				this.resourcePanelFocused = true;
				break;
			}
			case 'resourceHorizontal': {
				const maxScroll = this.computeResourceBrowserMaxHorizontalScroll();
				this.resourceBrowserHorizontalScroll = clamp(scroll, 0, maxScroll);
				this.clampResourceBrowserHorizontalScroll();
				this.resourcePanelFocused = true;
				break;
			}
			case 'viewerVertical': {
				const viewer = this.getActiveResourceViewer();
				if (!viewer) {
					break;
				}
				const capacity = this.resourceViewerTextCapacity(viewer);
				const maxScroll = Math.max(0, viewer.lines.length - capacity);
				viewer.scroll = clamp(Math.round(scroll), 0, maxScroll);
				break;
			}
		}
	}

	private adjustHoverTooltipScroll(stepCount: number): boolean {
		if (!this.hoverTooltip) {
			return false;
		}
		if (stepCount === 0) {
			return false;
		}
		const tooltip = this.hoverTooltip;
		const totalLines = tooltip.contentLines.length;
		if (totalLines <= tooltip.visibleLineCount || tooltip.visibleLineCount <= 0) {
			const maxVisible = Math.max(1, Math.min(HOVER_TOOLTIP_MAX_VISIBLE_LINES, totalLines));
			if (totalLines <= maxVisible) {
				return false;
			}
			tooltip.visibleLineCount = maxVisible;
		}
		const maxOffset = Math.max(0, totalLines - tooltip.visibleLineCount);
		if (maxOffset === 0) {
			return false;
		}
		const nextOffset = clamp(tooltip.scrollOffset + stepCount, 0, maxOffset);
		if (nextOffset === tooltip.scrollOffset) {
			return false;
		}
		tooltip.scrollOffset = nextOffset;
		return true;
	}

	private isPointInHoverTooltip(x: number, y: number): boolean {
		const tooltip = this.hoverTooltip;
		if (!tooltip || !tooltip.bubbleBounds) {
			return false;
		}
		return this.pointInRect(x, y, tooltip.bubbleBounds);
	}

	private pointerHitsHoverTarget(snapshot: PointerSnapshot, tooltip: CodeHoverTooltip): boolean {
		if (!snapshot.valid || !snapshot.insideViewport) {
			return false;
		}
		const bounds = this.getCodeAreaBounds();
		if (snapshot.viewportY < bounds.codeTop || snapshot.viewportY >= bounds.codeBottom) {
			return false;
		}
		const row = this.resolvePointerRow(snapshot.viewportY);
		if (row !== tooltip.row) {
			return false;
		}
		const column = this.resolvePointerColumn(row, snapshot.viewportX);
		return column >= tooltip.startColumn && column <= tooltip.endColumn;
	}

	private resolveHoverAssetId(context: CodeTabContext | null): string | null {
		if (context && context.descriptor) {
			return context.descriptor.assetId;
		}
		return this.primaryAssetId;
	}

	private resolveHoverChunkName(context: CodeTabContext | null): string | null {
		if (context && context.descriptor) {
			if (context.descriptor.path && context.descriptor.path.length > 0) {
				return context.descriptor.path;
			}
			if (context.descriptor.assetId && context.descriptor.assetId.length > 0) {
				return context.descriptor.assetId;
			}
		}
		if (this.primaryAssetId) {
			return this.primaryAssetId;
		}
		return null;
	}

	private extractHoverExpression(row: number, column: number): { expression: string; startColumn: number; endColumn: number } | null {
		if (row < 0 || row >= this.lines.length) {
			return null;
		}
		const line = this.lines[row] ?? '';
		if (line.length === 0) {
			return null;
		}
		const clampedColumn = Math.min(Math.max(column, 0), Math.max(0, line.length - 1));
		let probe = clampedColumn;
		if (!this.isIdentifierChar(line.charCodeAt(probe))) {
			if (line.charCodeAt(probe) === 46 && probe > 0) {
				probe -= 1;
			}
			else if (probe > 0 && this.isIdentifierChar(line.charCodeAt(probe - 1))) {
				probe -= 1;
			}
			else {
				return null;
			}
		}
		let expressionStart = probe;
		while (expressionStart > 0 && this.isIdentifierChar(line.charCodeAt(expressionStart - 1))) {
			expressionStart -= 1;
		}
		if (!this.isIdentifierStartChar(line.charCodeAt(expressionStart))) {
			return null;
		}
		let expressionEnd = probe + 1;
		while (expressionEnd < line.length && this.isIdentifierChar(line.charCodeAt(expressionEnd))) {
			expressionEnd += 1;
		}
		// extend to include preceding segments (left of initial segment)
		let left = expressionStart;
		while (left > 0) {
			const dotIndex = left - 1;
			if (line.charCodeAt(dotIndex) !== 46) {
				break;
			}
			let segmentStart = dotIndex - 1;
			while (segmentStart >= 0 && this.isIdentifierChar(line.charCodeAt(segmentStart))) {
				segmentStart -= 1;
			}
			segmentStart += 1;
			if (segmentStart >= dotIndex) {
				break;
			}
			if (!this.isIdentifierStartChar(line.charCodeAt(segmentStart))) {
				break;
			}
			left = segmentStart;
		}
		expressionStart = left;
		let right = expressionEnd;
		while (right < line.length) {
			if (line.charCodeAt(right) !== 46) {
				break;
			}
			const identifierStart = right + 1;
			if (identifierStart >= line.length) {
				break;
			}
			if (!this.isIdentifierStartChar(line.charCodeAt(identifierStart))) {
				break;
			}
			let identifierEnd = identifierStart + 1;
			while (identifierEnd < line.length && this.isIdentifierChar(line.charCodeAt(identifierEnd))) {
				identifierEnd += 1;
			}
			right = identifierEnd;
		}
		expressionEnd = right;
		if (expressionEnd <= expressionStart) {
			return null;
		}
		const segments: Array<{ text: string; start: number; end: number }> = [];
		let segmentStart = expressionStart;
		while (segmentStart < expressionEnd) {
			let segmentEnd = segmentStart;
			while (segmentEnd < expressionEnd && line.charCodeAt(segmentEnd) !== 46) {
				segmentEnd += 1;
			}
			if (segmentEnd > segmentStart) {
				segments.push({ text: line.slice(segmentStart, segmentEnd), start: segmentStart, end: segmentEnd });
			}
			segmentStart = segmentEnd + 1;
		}
		if (segments.length === 0) {
			return null;
		}
		let pointerColumn = Math.min(column, expressionEnd - 1);
		if (pointerColumn < expressionStart) {
			pointerColumn = expressionStart;
		}
		if (line.charCodeAt(pointerColumn) === 46 && pointerColumn > expressionStart) {
			pointerColumn -= 1;
		}
		let segmentIndex = -1;
		for (let i = 0; i < segments.length; i += 1) {
			const seg = segments[i];
			if (pointerColumn >= seg.start && pointerColumn < seg.end) {
				segmentIndex = i;
				break;
			}
		}
		if (segmentIndex === -1) {
			segmentIndex = segments.length - 1;
		}
		const expression = segments.slice(0, segmentIndex + 1).map(segment => segment.text).join('.');
		if (expression.length === 0) {
			return null;
		}
		const targetSegment = segments[segmentIndex];
		return { expression, startColumn: targetSegment.start, endColumn: targetSegment.end };
	}

	private refreshGotoHoverHighlight(row: number, column: number, context: CodeTabContext | null): void {
		const token = this.extractHoverExpression(row, column);
		if (!token) {
			this.clearGotoHoverHighlight();
			return;
		}
		const existing = this.gotoHoverHighlight;
		if (existing
			&& existing.row === row
			&& column >= existing.startColumn
			&& column <= existing.endColumn
			&& existing.expression === token.expression) {
			return;
		}
		const assetId = this.resolveHoverAssetId(context);
		const chunkName = this.resolveHoverChunkName(context);
		const inspection = this.inspectLuaExpressionFn({
			assetId,
			expression: token.expression,
			chunkName,
			row: row + 1,
			column: token.startColumn + 1,
		});
		if (!inspection || !inspection.definition) {
			this.clearGotoHoverHighlight();
			return;
		}
		this.gotoHoverHighlight = {
			row,
			startColumn: token.startColumn,
			endColumn: token.endColumn,
			expression: token.expression,
		};
	}

	private clearGotoHoverHighlight(): void {
		this.gotoHoverHighlight = null;
	}

	private tryGotoDefinitionAt(row: number, column: number): boolean {
		const context = this.getActiveCodeTabContext();
		const assetId = this.resolveHoverAssetId(context);
		const token = this.extractHoverExpression(row, column);
		if (!token) {
			this.showMessage('Definition not found', COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		const chunkName = this.resolveHoverChunkName(context);
		let inspection: ConsoleLuaHoverResult | null;
		try {
			inspection = this.inspectLuaExpressionFn({
				assetId,
				expression: token.expression,
				chunkName,
				row: row + 1,
				column: token.startColumn + 1,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(message, COLOR_STATUS_ERROR, 3.2);
			return false;
		}
		if (!inspection || !inspection.definition) {
			this.showMessage(`Definition not found for ${token.expression}`, COLOR_STATUS_WARNING, 1.8);
			return false;
		}
		this.navigateToLuaDefinition(inspection.definition);
		return true;
	}

	private navigateToLuaDefinition(definition: ConsoleLuaDefinitionLocation): void {
		const hint: { assetId: string | null; path?: string | null } = { assetId: definition.assetId };
		if (definition.path !== undefined) {
			hint.path = definition.path;
		}
		try {
			this.focusChunkSource(definition.chunkName, hint);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(`Failed to open definition: ${message}`, COLOR_STATUS_ERROR, 3.2);
			return;
		}
		this.activateCodeTab();
		this.applyDefinitionSelection(definition.range);
		this.cursorRevealSuspended = false;
		this.clearHoverTooltip();
		this.clearGotoHoverHighlight();
		this.showMessage('Jumped to definition', COLOR_STATUS_SUCCESS, 1.6);
	}

	private applyDefinitionSelection(range: ConsoleLuaDefinitionLocation['range']): void {
		const lastRowIndex = Math.max(0, this.lines.length - 1);
		const startRow = clamp(range.startLine - 1, 0, lastRowIndex);
		const startLine = this.lines[startRow] ?? '';
		const startColumn = clamp(range.startColumn - 1, 0, startLine.length);
		const bounds = this.getCodeAreaBounds();
		const gutterOffset = bounds.textLeft - bounds.codeLeft;
		const horizontalScrollbar = this.codeHorizontalScrollbarVisible ? SCROLLBAR_WIDTH : 0;
		const verticalScrollbar = this.codeVerticalScrollbarVisible ? SCROLLBAR_WIDTH : 0;
		const availableHeight = Math.max(1, (bounds.codeBottom - bounds.codeTop) - horizontalScrollbar);
		const availableWidth = Math.max(1, (bounds.codeRight - bounds.codeLeft) - verticalScrollbar - gutterOffset);
		const lineHeight = this.lineHeight;
		const advance = this.warnNonMonospace ? this.spaceAdvance : this.charAdvance;
		const safeAdvance = advance > 0 ? advance : 1;
		const currentTopRow = this.scrollRow;
		const currentLeftColumn = this.scrollColumn;
		const rowOffsetPx = (startRow - currentTopRow) * lineHeight;
		const columnOffsetPx = (startColumn - currentLeftColumn) * safeAdvance;
		const rowVisible = rowOffsetPx >= 0 && rowOffsetPx + lineHeight <= availableHeight;
		const columnVisible = columnOffsetPx >= 0 && columnOffsetPx + safeAdvance <= availableWidth;
		const rowSpan = Math.max(1, Math.floor(availableHeight / lineHeight));
		const columnSpan = Math.max(1, Math.floor(availableWidth / safeAdvance));
		this.cursorRow = startRow;
		this.cursorColumn = startColumn;
		this.selectionAnchor = null;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.pointerAuxWasPressed = false;
		this.updateDesiredColumn();
		this.resetBlink();
		this.cursorRevealSuspended = false;
		let targetVisible = rowVisible && columnVisible;
		if (!rowVisible) {
			const maxTopRow = Math.max(0, this.lines.length - rowSpan);
			const offset = Math.max(0, Math.floor(rowSpan / 2) - 1);
			const centeredTop = clamp(startRow - offset, 0, maxTopRow);
			this.scrollRow = centeredTop;
			targetVisible = false;
		}
		if (!columnVisible) {
			const maxLeftColumn = Math.max(0, (startLine.length - columnSpan));
			const centeredLeft = clamp(startColumn - Math.floor(columnSpan / 2), 0, maxLeftColumn);
			this.scrollColumn = centeredLeft;
			targetVisible = false;
		}
		if (!targetVisible) {
			this.ensureCursorVisible();
		}
	}

	private isIdentifierStartChar(code: number): boolean {
		if (code >= 65 && code <= 90) {
			return true;
		}
		if (code >= 97 && code <= 122) {
			return true;
		}
		return code === 95;
	}

	private isIdentifierChar(code: number): boolean {
		if (this.isIdentifierStartChar(code)) {
			return true;
		}
		return code >= 48 && code <= 57;
	}

	private handleActionPromptPointer(snapshot: PointerSnapshot): void {
		if (!this.pendingActionPrompt) {
			return;
		}
		const x = snapshot.viewportX;
		const y = snapshot.viewportY;
		const saveBounds = this.actionPromptButtons.saveAndContinue;
		if (saveBounds && this.pointInRect(x, y, saveBounds)) {
			void this.handleActionPromptSelection('save-continue');
			return;
		}
		if (this.pointInRect(x, y, this.actionPromptButtons.continue)) {
			void this.handleActionPromptSelection('continue');
			return;
		}
		if (this.pointInRect(x, y, this.actionPromptButtons.cancel)) {
			void this.handleActionPromptSelection('cancel');
		}
	}

	private handleTopBarPointer(snapshot: PointerSnapshot): boolean {
		const y = snapshot.viewportY;
		if (y < 0 || y >= this.headerHeight) {
			return false;
		}
		const x = snapshot.viewportX;
		if (this.pointInRect(x, y, this.topBarButtonBounds.resume)) {
			this.handleTopBarButtonPress('resume');
			return true;
		}
		if (this.pointInRect(x, y, this.topBarButtonBounds.reboot)) {
			this.handleTopBarButtonPress('reboot');
			return true;
		}
		if (this.dirty && this.pointInRect(x, y, this.topBarButtonBounds.save)) {
			this.handleTopBarButtonPress('save');
			return true;
		}
		if (this.pointInRect(x, y, this.topBarButtonBounds.resources)) {
			this.handleTopBarButtonPress('resources');
			return true;
		}
		return false;
	}

	private handleTabBarPointer(snapshot: PointerSnapshot): boolean {
		const tabTop = this.headerHeight;
		const tabBottom = tabTop + this.tabBarHeight;
		const y = snapshot.viewportY;
		if (y < tabTop || y >= tabBottom) {
			return false;
		}
		const x = snapshot.viewportX;
		for (let index = 0; index < this.tabs.length; index += 1) {
			const tab = this.tabs[index];
			const closeBounds = this.tabCloseButtonBounds.get(tab.id);
			if (closeBounds && this.pointInRect(x, y, closeBounds)) {
				this.closeTab(tab.id);
				this.tabHoverId = null;
				return true;
			}
			const tabBounds = this.tabButtonBounds.get(tab.id);
			if (tabBounds && this.pointInRect(x, y, tabBounds)) {
				this.setActiveTab(tab.id);
				return true;
			}
		}
		return false;
	}

	private handleTabBarMiddleClick(snapshot: PointerSnapshot): boolean {
		const tabTop = this.headerHeight;
		const tabBottom = tabTop + this.tabBarHeight;
		const y = snapshot.viewportY;
		if (y < tabTop || y >= tabBottom) {
			return false;
		}
		const x = snapshot.viewportX;
		for (let index = 0; index < this.tabs.length; index += 1) {
			const tab = this.tabs[index];
			if (!tab.closable) {
				continue;
			}
			const bounds = this.tabButtonBounds.get(tab.id);
			if (!bounds) {
				continue;
			}
			if (this.pointInRect(x, y, bounds)) {
				this.closeTab(tab.id);
				return true;
			}
		}
		return false;
	}

	private handlePointerWheel(): void {
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		if (!playerInput) {
			return;
		}
		const wheelAction = playerInput.getActionState('pointer_wheel');
		if (wheelAction.consumed === true) {
			return;
		}
		const delta = typeof wheelAction.value === 'number' ? wheelAction.value : 0;
		if (!Number.isFinite(delta) || delta === 0) {
			return;
		}
		const magnitude = Math.abs(delta);
		const steps = Math.max(1, Math.round(magnitude / WHEEL_SCROLL_STEP));
		const direction = delta > 0 ? 1 : -1;
		const pointer = this.lastPointerSnapshot;
		const keyboard = this.getKeyboard();
		const shiftDown = this.isModifierPressed(keyboard, 'ShiftLeft') || this.isModifierPressed(keyboard, 'ShiftRight');
		if (this.hoverTooltip) {
			let canScrollTooltip = false;
			if (!pointer) {
				canScrollTooltip = true;
			} else if (pointer.valid && pointer.insideViewport) {
				if (this.isPointInHoverTooltip(pointer.viewportX, pointer.viewportY) || this.pointerHitsHoverTarget(pointer, this.hoverTooltip)) {
					canScrollTooltip = true;
				}
			}
			if (canScrollTooltip && this.adjustHoverTooltipScroll(direction * steps)) {
				playerInput.consumeAction('pointer_wheel');
				return;
			}
		}
		const panelBounds = this.getResourcePanelBounds();
		const pointerInPanel = this.resourcePanelVisible
			&& panelBounds !== null
			&& pointer
			&& pointer.valid
			&& pointer.insideViewport
			&& this.pointInRect(pointer.viewportX, pointer.viewportY, panelBounds);
		if (pointerInPanel) {
			if (shiftDown) {
				const horizontalPixels = direction * steps * this.charAdvance * 4;
				this.scrollResourceBrowserHorizontal(horizontalPixels);
				this.resourceBrowserEnsureSelectionVisible();
			} else {
				this.scrollResourceBrowser(direction * steps);
			}
			playerInput.consumeAction('pointer_wheel');
			return;
		}
		if (this.isResourceViewActive()) {
			this.scrollResourceViewer(direction * steps);
			playerInput.consumeAction('pointer_wheel');
			return;
		}
		if (this.isCodeTabActive() && pointer) {
			const bounds = this.getCodeAreaBounds();
			if (!pointer.valid || !pointer.insideViewport || pointer.viewportY < bounds.codeTop || pointer.viewportY >= bounds.codeBottom || pointer.viewportX < bounds.codeLeft || pointer.viewportX >= bounds.codeRight) {
				playerInput.consumeAction('pointer_wheel');
				return;
			}
		}
		this.scrollRows(direction * steps);
		this.cursorRevealSuspended = true;
		playerInput.consumeAction('pointer_wheel');
	}

	private handleTopBarButtonPress(button: TopBarButtonId): void {
		if (button === 'resources') {
			this.toggleResourcePanel();
			return;
		}
		if (button === 'save') {
			if (!this.dirty) {
				return;
			}
			void this.save();
			return;
		}
		this.activateCodeTab();
		if (this.dirty) {
			this.openActionPrompt(button);
			return;
		}
		const success = this.performAction(button);
		if (!success) {
			return;
		}
	}

	private openActionPrompt(action: PendingActionPrompt['action']): void {
		this.activateCodeTab();
		this.pendingActionPrompt = { action };
		this.actionPromptButtons.saveAndContinue = null;
		this.actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
		this.actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
	}

	private async handleActionPromptSelection(choice: 'save-continue' | 'continue' | 'cancel'): Promise<void> {
		if (!this.pendingActionPrompt) {
			return;
		}
		if (choice === 'cancel') {
			this.resetActionPromptState();
			return;
		}
		if (choice === 'save-continue') {
			const saved = await this.attemptPromptSave(this.pendingActionPrompt.action);
			if (!saved) {
				return;
			}
		}
		const success = this.executePendingAction();
		if (success) {
			this.resetActionPromptState();
		}
	}

	private async attemptPromptSave(action: PendingActionPrompt['action']): Promise<boolean> {
		if (action === 'close') {
			await this.save();
			return this.dirty === false;
		}
		await this.save();
		return this.dirty === false;
	}

	private executePendingAction(): boolean {
		const prompt = this.pendingActionPrompt;
		if (!prompt) {
			return false;
		}
		return this.performAction(prompt.action);
	}

	private performAction(action: PendingActionPrompt['action']): boolean {
		if (action === 'resume') {
			return this.performResume();
		}
		if (action === 'reboot') {
			return this.performReboot();
		}
		if (action === 'close') {
			this.deactivate();
			return true;
		}
		return false;
	}

	private performResume(): boolean {
		const runtime = this.getConsoleRuntime();
		if (!runtime) {
			this.showMessage('Console runtime unavailable.', COLOR_STATUS_ERROR, 4.0);
			return false;
		}
		let snapshot: unknown = null;
		try {
			snapshot = runtime.getState();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(`Failed to capture runtime state: ${message}`, COLOR_STATUS_ERROR, 4.0);
			return false;
		}
		const sanitizedSnapshot = this.prepareRuntimeSnapshotForResume(snapshot);
		if (!sanitizedSnapshot) {
			this.showMessage('Runtime state unavailable.', COLOR_STATUS_ERROR, 4.0);
			return false;
		}
		const targetGeneration = this.saveGeneration;
		const shouldUpdateGeneration = this.hasPendingRuntimeReload();
		this.deactivate();
		this.scheduleRuntimeTask(() => {
			runtime.setState(sanitizedSnapshot);
			if (shouldUpdateGeneration) {
				this.appliedGeneration = targetGeneration;
			}
			$.paused = false;
		}, (error) => {
			this.handleRuntimeTaskError(error, 'Failed to resume game');
		});
		return true;
	}

	private performReboot(): boolean {
		const runtime = this.getConsoleRuntime();
		if (!runtime) {
			this.showMessage('Console runtime unavailable.', COLOR_STATUS_ERROR, 4.0);
			return false;
		}
		const requiresReload = this.hasPendingRuntimeReload();
		const savedSource = requiresReload ? this.getMainProgramSourceForReload() : null;
		const targetGeneration = this.saveGeneration;
		this.deactivate();
		this.scheduleRuntimeTask(async () => {
			if (requiresReload && savedSource !== null) {
				await runtime.reloadLuaProgram(savedSource);
			} else {
				runtime.boot();
			}
			this.appliedGeneration = targetGeneration;
			$.paused = false;
		}, (error) => {
			this.handleRuntimeTaskError(error, 'Failed to reboot game');
		});
		return true;
	}

	private indentSelectionOrLine(): void {
		const range = this.getLineRangeForMovement();
		this.adjustIndentationRange(range.startRow, range.endRow, 'increase');
	}

	private unindentSelectionOrLine(): void {
		const range = this.getLineRangeForMovement();
		this.adjustIndentationRange(range.startRow, range.endRow, 'decrease');
	}

	private adjustIndentationRange(startRow: number, endRow: number, direction: 'increase' | 'decrease'): void {
		if (startRow < 0 || endRow < startRow || this.lines.length === 0) {
			return;
		}
		if (direction === 'decrease') {
			let canDeindent = false;
			for (let row = startRow; row <= endRow; row++) {
				const indentMatch = this.lines[row].match(/^[\t ]+/);
				if (indentMatch && indentMatch[0].length > 0) {
					canDeindent = true;
					break;
				}
			}
			if (!canDeindent) {
				return;
			}
		}
		const undoKey = direction === 'increase' ? 'indent-lines' : 'unindent-lines';
		this.prepareUndo(undoKey, false);
		let changed = false;
		for (let row = startRow; row <= endRow; row++) {
			const line = this.lines[row];
			if (direction === 'increase') {
				this.lines[row] = '\t' + line;
				this.invalidateLine(row);
				if (this.cursorRow === row) {
					this.cursorColumn += 1;
				}
				if (this.selectionAnchor && this.selectionAnchor.row === row) {
					this.selectionAnchor.column += 1;
				}
				changed = true;
				continue;
			}
			const indentMatch = line.match(/^[\t ]+/);
			if (!indentMatch) {
				continue;
			}
			const indent = indentMatch[0];
			if (indent.length === 0) {
				continue;
			}
			const removal = indent.charAt(0) === '\t' ? 1 : Math.min(TAB_SPACES, indent.length);
			if (removal <= 0) {
				continue;
			}
			this.lines[row] = line.slice(removal);
			this.invalidateLine(row);
			if (this.cursorRow === row) {
				this.cursorColumn = Math.max(0, this.cursorColumn - removal);
			}
			if (this.selectionAnchor && this.selectionAnchor.row === row) {
				this.selectionAnchor.column = Math.max(0, this.selectionAnchor.column - removal);
			}
			changed = true;
		}
		if (!changed) {
			return;
		}
		this.clampCursorColumn();
		if (this.selectionAnchor) {
			if (this.selectionAnchor.row < 0 || this.selectionAnchor.row >= this.lines.length) {
				this.selectionAnchor = null;
			} else {
				const anchorLineLength = this.lines[this.selectionAnchor.row].length;
				if (this.selectionAnchor.column > anchorLineLength) {
					this.selectionAnchor.column = anchorLineLength;
				}
			}
		}
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private toggleLineComments(): void {
		const range = this.getLineRangeForMovement();
		if (range.startRow < 0 || range.endRow < range.startRow) {
			return;
		}
		let allCommented = true;
		for (let row = range.startRow; row <= range.endRow; row++) {
			const line = this.lines[row];
			const commentIndex = this.firstNonWhitespaceIndex(line);
			if (commentIndex >= line.length) {
				allCommented = false;
				break;
			}
			if (!line.startsWith('--', commentIndex)) {
				allCommented = false;
				break;
			}
		}
		if (allCommented) {
			this.removeLineComments(range);
		} else {
			this.addLineComments(range);
		}
	}

	private addLineComments(range?: { startRow: number; endRow: number }): void {
		const target = range ?? this.getLineRangeForMovement();
		if (target.startRow < 0 || target.endRow < target.startRow) {
			return;
		}
		this.prepareUndo('comment-lines', false);
		let changed = false;
		for (let row = target.startRow; row <= target.endRow; row++) {
			const originalLine = this.lines[row];
			const insertIndex = this.firstNonWhitespaceIndex(originalLine);
			const hasContent = insertIndex < originalLine.length;
			let insertion = '--';
			if (hasContent) {
				const nextChar = originalLine.charAt(insertIndex);
				if (nextChar !== ' ' && nextChar !== '\t') {
					insertion = '-- ';
				}
			}
			const updatedLine = originalLine.slice(0, insertIndex) + insertion + originalLine.slice(insertIndex);
			this.lines[row] = updatedLine;
			this.invalidateLine(row);
			this.shiftPositionsForInsertion(row, insertIndex, insertion.length);
			changed = true;
		}
		if (!changed) {
			return;
		}
		this.clampCursorColumn();
		this.selectionAnchor = this.clampSelectionPosition(this.selectionAnchor);
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private removeLineComments(range?: { startRow: number; endRow: number }): void {
		const target = range ?? this.getLineRangeForMovement();
		if (target.startRow < 0 || target.endRow < target.startRow) {
			return;
		}
		this.prepareUndo('uncomment-lines', false);
		let changed = false;
		for (let row = target.startRow; row <= target.endRow; row++) {
			const originalLine = this.lines[row];
			const commentIndex = this.firstNonWhitespaceIndex(originalLine);
			if (commentIndex >= originalLine.length) {
				continue;
			}
			if (!originalLine.startsWith('--', commentIndex)) {
				continue;
			}
			let removal = 2;
			if (commentIndex + 2 < originalLine.length) {
				const trailing = originalLine.charAt(commentIndex + 2);
				if (trailing === ' ') {
					removal = 3;
				}
			}
			const updatedLine = originalLine.slice(0, commentIndex) + originalLine.slice(commentIndex + removal);
			this.lines[row] = updatedLine;
			this.invalidateLine(row);
			this.shiftPositionsForRemoval(row, commentIndex, removal);
			changed = true;
		}
		if (!changed) {
			return;
		}
		this.clampCursorColumn();
		this.selectionAnchor = this.clampSelectionPosition(this.selectionAnchor);
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private firstNonWhitespaceIndex(value: string): number {
		for (let index = 0; index < value.length; index++) {
			const ch = value.charAt(index);
			if (ch !== ' ' && ch !== '\t') {
				return index;
			}
		}
		return value.length;
	}

	private shiftPositionsForInsertion(row: number, column: number, length: number): void {
		if (length <= 0) {
			return;
		}
		if (this.cursorRow === row && this.cursorColumn >= column) {
			this.cursorColumn += length;
		}
		if (this.selectionAnchor && this.selectionAnchor.row === row && this.selectionAnchor.column >= column) {
			this.selectionAnchor.column += length;
		}
	}

	private shiftPositionsForRemoval(row: number, column: number, length: number): void {
		if (length <= 0) {
			return;
		}
		if (this.cursorRow === row && this.cursorColumn > column) {
			if (this.cursorColumn <= column + length) {
				this.cursorColumn = column;
			} else {
				this.cursorColumn -= length;
			}
		}
		if (this.selectionAnchor && this.selectionAnchor.row === row && this.selectionAnchor.column > column) {
			if (this.selectionAnchor.column <= column + length) {
				this.selectionAnchor.column = column;
			} else {
				this.selectionAnchor.column -= length;
			}
		}
	}

	private revealCursor(): void {
		this.cursorRevealSuspended = false;
		this.ensureCursorVisible();
	}

	private readPointerSnapshot(): PointerSnapshot | null {
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		if (!playerInput) {
			return null;
		}
		const primaryAction = playerInput.getActionState('pointer_primary');
		const primaryPressed = primaryAction.pressed === true && primaryAction.consumed !== true;

		const positionAction = playerInput.getActionState('pointer_position');
		const coords = positionAction.value2d;
		if (!coords) {
			return {
				viewportX: 0,
				viewportY: 0,
				insideViewport: false,
				valid: false,
				primaryPressed,
			};
		}
		const mapped = this.mapScreenPointToViewport(coords[0], coords[1]);
		return {
			viewportX: mapped.x,
			viewportY: mapped.y,
			insideViewport: mapped.inside,
			valid: mapped.valid,
			primaryPressed,
		};
	}

	private mapScreenPointToViewport(screenX: number, screenY: number): { x: number; y: number; inside: boolean; valid: boolean } {
		const view = $.view;
		if (!view) {
			return { x: 0, y: 0, inside: false, valid: false };
		}
		const rect = view.surface.measureDisplay();
		const width = rect.width;
		const height = rect.height;
		if (width <= 0 || height <= 0) {
			return { x: 0, y: 0, inside: false, valid: false };
		}
		const relativeX = screenX - rect.left;
		const relativeY = screenY - rect.top;
		const inside = relativeX >= 0 && relativeX < width && relativeY >= 0 && relativeY < height;
		const viewportX = (relativeX / width) * this.viewportWidth;
		const viewportY = (relativeY / height) * this.viewportHeight;
		return { x: viewportX, y: viewportY, inside, valid: true };
	}

	private getCodeAreaBounds(): { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; gutterLeft: number; gutterRight: number; textLeft: number; } {
		const codeTop = this.codeViewportTop();
		const codeBottom = this.viewportHeight - this.bottomMargin;
		const codeLeft = this.resourcePanelVisible ? this.getResourcePanelWidth() : 0;
		const codeRight = this.viewportWidth;
		const gutterLeft = codeLeft;
		const gutterRight = gutterLeft + this.gutterWidth;
		const textLeft = gutterRight + 2;
		return { codeTop, codeBottom, codeLeft, codeRight, gutterLeft, gutterRight, textLeft };
	}

	private resolvePointerRow(viewportY: number): number {
		const bounds = this.getCodeAreaBounds();
		const relativeY = viewportY - bounds.codeTop;
		const lineOffset = Math.floor(relativeY / this.lineHeight);
		let row = this.scrollRow + lineOffset;
		if (row < 0) {
			row = 0;
		}
		const lastRow = this.lines.length - 1;
		if (row > lastRow) {
			row = lastRow;
		}
		if (row < 0) {
			row = 0;
		}
		return row;
	}

	private resolvePointerColumn(row: number, viewportX: number): number {
		const bounds = this.getCodeAreaBounds();
		const textLeft = bounds.textLeft;
		const line = this.lines[row] ?? '';
		if (line.length === 0) {
			return 0;
		}
		const entry = this.getCachedHighlight(row);
		const highlight = entry.hi;
		const effectiveStartColumn = Math.min(this.scrollColumn, line.length);
		const startDisplay = this.columnToDisplay(highlight, effectiveStartColumn);
		const offset = viewportX - textLeft;
		if (offset <= 0) {
			return effectiveStartColumn;
		}
		const baseAdvance = entry.advancePrefix[startDisplay] ?? 0;
		const target = baseAdvance + offset;
		const lower = this.lowerBound(entry.advancePrefix, target, startDisplay + 1, entry.advancePrefix.length);
		let displayIndex = lower - 1;
		if (displayIndex < startDisplay) {
			displayIndex = startDisplay;
		}
		if (displayIndex >= highlight.chars.length) {
			return line.length;
		}
		const left = entry.advancePrefix[displayIndex];
		const right = entry.advancePrefix[displayIndex + 1];
		const midpoint = left + (right - left) * 0.5;
		let column = entry.displayToColumn[displayIndex];
		if (column === undefined) {
			column = line.length;
		}
		if (target >= midpoint) {
			column += 1;
		}
		if (column > line.length) {
			column = line.length;
		}
		if (column < effectiveStartColumn) {
			column = effectiveStartColumn;
		}
		return column;
	}

	private handlePointerAutoScroll(viewportX: number, viewportY: number): void {
		if (!this.pointerSelecting) {
			return;
		}
		const bounds = this.getCodeAreaBounds();
		if (viewportY < bounds.codeTop) {
			if (this.scrollRow > 0) {
				this.scrollRow -= 1;
			}
		}
		else if (viewportY >= bounds.codeBottom) {
			const lastRow = this.lines.length - 1;
			if (this.scrollRow < lastRow) {
				this.scrollRow += 1;
			}
		}
		const maxScrollColumn = this.computeMaximumScrollColumn();
		if (viewportX < bounds.gutterLeft) {
			return;
		}
		if (viewportX < bounds.textLeft) {
			if (this.scrollColumn > 0) {
				this.scrollColumn -= 1;
			}
		}
		else if (viewportX >= bounds.codeRight) {
			if (this.scrollColumn < maxScrollColumn) {
				this.scrollColumn += 1;
			}
		}
		if (this.scrollRow < 0) {
			this.scrollRow = 0;
		}
		if (this.scrollColumn < 0) {
			this.scrollColumn = 0;
		}
		const maxScrollRow = Math.max(0, this.lines.length - this.visibleRowCount());
		if (this.scrollRow > maxScrollRow) {
			this.scrollRow = maxScrollRow;
		}
		if (this.scrollColumn > maxScrollColumn) {
			this.scrollColumn = maxScrollColumn;
		}
	}

	private registerPointerClick(row: number, column: number): boolean {
		const now = $.platform.clock.now();
		const interval = now - this.lastPointerClickTimeMs;
		const sameRow = row === this.lastPointerClickRow;
		const columnDelta = Math.abs(column - this.lastPointerClickColumn);
		const doubleClick = this.lastPointerClickTimeMs > 0
			&& interval <= DOUBLE_CLICK_MAX_INTERVAL_MS
			&& sameRow
			&& columnDelta <= 2;
		this.lastPointerClickTimeMs = now;
		this.lastPointerClickRow = row;
		this.lastPointerClickColumn = column;
		return doubleClick;
	}

	private resetPointerClickTracking(): void {
		this.lastPointerClickTimeMs = 0;
		this.lastPointerClickRow = -1;
		this.lastPointerClickColumn = -1;
	}

	private scrollRows(deltaRows: number): void {
		if (deltaRows === 0) {
			return;
		}
		const maxScrollRow = Math.max(0, this.lines.length - this.visibleRowCount());
		let targetRow = this.scrollRow + deltaRows;
		if (targetRow < 0) {
			targetRow = 0;
		}
		else if (targetRow > maxScrollRow) {
			targetRow = maxScrollRow;
		}
		this.scrollRow = targetRow;
	}

	private maximumLineLength(): number {
		let maxLength = 0;
		for (let i = 0; i < this.lines.length; i += 1) {
			const length = this.lines[i].length;
			if (length > maxLength) {
				maxLength = length;
			}
		}
		return maxLength;
	}

	private computeMaximumScrollColumn(): number {
		const maxLength = this.maximumLineLength();
		const visible = this.visibleColumnCount();
		const limit = maxLength - visible;
		if (limit <= 0) {
			return 0;
		}
		return limit;
	}

	private setCursorPosition(row: number, column: number): void {
		let targetRow = row;
		if (targetRow < 0) {
			targetRow = 0;
		}
		const lastRow = this.lines.length - 1;
		if (targetRow > lastRow) {
			targetRow = lastRow >= 0 ? lastRow : 0;
		}
		let targetColumn = column;
		if (targetColumn < 0) {
			targetColumn = 0;
		}
		const lineLength = this.lines[targetRow].length;
		if (targetColumn > lineLength) {
			targetColumn = lineLength;
		}
		this.cursorRow = targetRow;
		this.cursorColumn = targetColumn;
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
	}

	private moveCursorVertical(delta: number): void {
		this.cursorRow += delta;
		if (this.cursorRow < 0) {
			this.cursorRow = 0;
		}
		if (this.cursorRow >= this.lines.length) {
			this.cursorRow = this.lines.length - 1;
		}
		const lineLength = this.currentLine().length;
		this.cursorColumn = clamp(Math.floor(this.desiredColumn), 0, lineLength);
		this.resetBlink();
		this.revealCursor();
	}

	private moveCursorHorizontal(delta: number): void {
		if (delta < 0) {
			if (this.cursorColumn > 0) {
				this.cursorColumn -= 1;
			} else if (this.cursorRow > 0) {
				this.cursorRow -= 1;
				this.cursorColumn = this.currentLine().length;
			}
		}
		else if (delta > 0) {
			const line = this.currentLine();
			if (this.cursorColumn < line.length) {
				this.cursorColumn += 1;
			} else if (this.cursorRow < this.lines.length - 1) {
				this.cursorRow += 1;
				this.cursorColumn = 0;
			}
		}
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private moveWordLeft(): void {
		const destination = this.findWordLeft(this.cursorRow, this.cursorColumn);
		this.cursorRow = destination.row;
		this.cursorColumn = destination.column;
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
	}

	private findWordLeft(row: number, column: number): { row: number; column: number } {
		if (this.lines.length === 0) {
			return { row: 0, column: 0 };
		}
		let currentRow = row;
		let currentColumn = column;
		let step = this.stepLeft(currentRow, currentColumn);
		if (!step) {
			return { row: 0, column: 0 };
		}
		currentRow = step.row;
		currentColumn = step.column;
		let currentChar = this.charAt(currentRow, currentColumn);
		while (this.isWhitespace(currentChar)) {
			const previous = this.stepLeft(currentRow, currentColumn);
			if (!previous) {
				return { row: currentRow, column: currentColumn };
			}
			currentRow = previous.row;
			currentColumn = previous.column;
			currentChar = this.charAt(currentRow, currentColumn);
		}
		const word = this.isWordChar(currentChar);
		while (true) {
			const previous = this.stepLeft(currentRow, currentColumn);
			if (!previous) {
				break;
			}
			const previousChar = this.charAt(previous.row, previous.column);
			if (this.isWhitespace(previousChar) || this.isWordChar(previousChar) !== word) {
				break;
			}
			currentRow = previous.row;
			currentColumn = previous.column;
		}
		return { row: currentRow, column: currentColumn };
	}

	private findWordRight(row: number, column: number): { row: number; column: number } {
		let currentRow = row;
		let currentColumn = column;
		let step = this.stepRight(currentRow, currentColumn);
		if (!step) {
			const lastRow = this.lines.length - 1;
			return { row: lastRow, column: this.lines[lastRow].length };
		}
		currentRow = step.row;
		currentColumn = step.column;
		let currentChar = this.charAt(currentRow, currentColumn);
		while (this.isWhitespace(currentChar)) {
			const next = this.stepRight(currentRow, currentColumn);
			if (!next) {
				const lastRow = this.lines.length - 1;
				return { row: lastRow, column: this.lines[lastRow].length };
			}
			currentRow = next.row;
			currentColumn = next.column;
			currentChar = this.charAt(currentRow, currentColumn);
		}
		const word = this.isWordChar(currentChar);
		while (true) {
			const next = this.stepRight(currentRow, currentColumn);
			if (!next) {
				const lastRow = this.lines.length - 1;
				currentRow = lastRow;
				currentColumn = this.lines[lastRow].length;
				break;
			}
			const nextChar = this.charAt(next.row, next.column);
			if (this.isWhitespace(nextChar) || this.isWordChar(nextChar) !== word) {
				currentRow = next.row;
				currentColumn = next.column;
				break;
			}
			currentRow = next.row;
			currentColumn = next.column;
		}
		while (this.isWhitespace(this.charAt(currentRow, currentColumn))) {
			const next = this.stepRight(currentRow, currentColumn);
			if (!next) {
				const lastRow = this.lines.length - 1;
				currentRow = lastRow;
				currentColumn = this.lines[lastRow].length;
				break;
			}
			currentRow = next.row;
			currentColumn = next.column;
		}
		return { row: currentRow, column: currentColumn };
	}

	private moveWordRight(): void {
		const destination = this.findWordRight(this.cursorRow, this.cursorColumn);
		this.cursorRow = destination.row;
		this.cursorColumn = destination.column;
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
	}

	private handleCharacterInput(keyboard: KeyboardInput, shiftDown: boolean): void {
		for (let i = 0; i < CHARACTER_CODES.length; i++) {
			const code = CHARACTER_CODES[i];
			if (!this.isKeyTyped(keyboard, code)) {
				continue;
			}
			const entry = CHARACTER_MAP[code];
			const value = shiftDown ? entry.shift : entry.normal;
			this.insertText(value);
			this.consumeKey(keyboard, code);
		}
	}

	private resetKeyPressGuards(): void {
		this.keyPressRecords.clear();
	}

	private createInlineField(): InlineTextField {
		return {
			text: '',
			cursor: 0,
			selectionAnchor: null,
			desiredColumn: 0,
			pointerSelecting: false,
			lastPointerClickTimeMs: 0,
			lastPointerClickColumn: -1,
		};
	}

	private inlineFieldClampCursor(field: InlineTextField): void {
		if (field.cursor < 0) {
			field.cursor = 0;
		}
		const length = field.text.length;
		if (field.cursor > length) {
			field.cursor = length;
		}
	}

	private inlineFieldSelectionRange(field: InlineTextField): { start: number; end: number } | null {
		const anchor = field.selectionAnchor;
		if (anchor === null) {
			return null;
		}
		const cursor = field.cursor;
		if (anchor === cursor) {
			return null;
		}
		if (anchor < cursor) {
			return { start: Math.max(0, anchor), end: Math.min(field.text.length, cursor) };
		}
		return { start: Math.max(0, cursor), end: Math.min(field.text.length, anchor) };
	}

	private inlineFieldClampSelectionAnchor(field: InlineTextField): void {
		if (field.selectionAnchor === null) {
			return;
		}
		const length = field.text.length;
		if (field.selectionAnchor < 0) {
			field.selectionAnchor = 0;
			return;
		}
		if (field.selectionAnchor > length) {
			field.selectionAnchor = length;
		}
	}

	private inlineFieldDeleteSelection(field: InlineTextField): boolean {
		const range = this.inlineFieldSelectionRange(field);
		if (!range) {
			return false;
		}
		const text = field.text;
		field.text = text.slice(0, range.start) + text.slice(range.end);
		field.cursor = range.start;
		field.selectionAnchor = null;
		field.desiredColumn = field.cursor;
		return true;
	}

	private inlineFieldSelectionLength(field: InlineTextField): number {
		const range = this.inlineFieldSelectionRange(field);
		if (!range) {
			return 0;
		}
		return range.end - range.start;
	}

	private inlineFieldInsert(field: InlineTextField, value: string): boolean {
		if (value.length === 0) {
			return false;
		}
		this.inlineFieldDeleteSelection(field);
		const text = field.text;
		const before = text.slice(0, field.cursor);
		const after = text.slice(field.cursor);
		field.text = before + value + after;
		field.cursor += value.length;
		field.desiredColumn = field.cursor;
		return true;
	}

	private inlineFieldBackspace(field: InlineTextField): boolean {
		if (this.inlineFieldDeleteSelection(field)) {
			return true;
		}
		if (field.cursor === 0) {
			return false;
		}
		const text = field.text;
		field.text = text.slice(0, field.cursor - 1) + text.slice(field.cursor);
		field.cursor -= 1;
		field.desiredColumn = field.cursor;
		return true;
	}

	private inlineFieldDeleteForward(field: InlineTextField): boolean {
		if (this.inlineFieldDeleteSelection(field)) {
			return true;
		}
		if (field.cursor >= field.text.length) {
			return false;
		}
		const text = field.text;
		field.text = text.slice(0, field.cursor) + text.slice(field.cursor + 1);
		field.desiredColumn = field.cursor;
		return true;
	}

	private inlineFieldDeleteWordBackward(field: InlineTextField): boolean {
		if (this.inlineFieldDeleteSelection(field)) {
			return true;
		}
		if (field.cursor === 0) {
			return false;
		}
		const text = field.text;
		let index = field.cursor;
		while (index > 0 && this.isWhitespace(text.charAt(index - 1))) {
			index -= 1;
		}
		while (index > 0 && !this.isWhitespace(text.charAt(index - 1)) && !this.isWordChar(text.charAt(index - 1))) {
			index -= 1;
		}
		while (index > 0 && this.isWordChar(text.charAt(index - 1))) {
			index -= 1;
		}
		if (index === field.cursor) {
			return false;
		}
		field.text = text.slice(0, index) + text.slice(field.cursor);
		field.cursor = index;
		field.desiredColumn = field.cursor;
		field.selectionAnchor = null;
		return true;
	}

	private inlineFieldDeleteWordForward(field: InlineTextField): boolean {
		if (this.inlineFieldDeleteSelection(field)) {
			return true;
		}
		const length = field.text.length;
		if (field.cursor >= length) {
			return false;
		}
		const text = field.text;
		let index = field.cursor;
		while (index < length && this.isWhitespace(text.charAt(index))) {
			index += 1;
		}
		while (index < length && !this.isWhitespace(text.charAt(index)) && !this.isWordChar(text.charAt(index))) {
			index += 1;
		}
		while (index < length && this.isWordChar(text.charAt(index))) {
			index += 1;
		}
		if (index === field.cursor) {
			return false;
		}
		field.text = text.slice(0, field.cursor) + text.slice(index);
		field.desiredColumn = field.cursor;
		field.selectionAnchor = null;
		return true;
	}

	private inlineFieldMoveCursor(field: InlineTextField, column: number, extendSelection: boolean): void {
		const clamped = Math.max(0, Math.min(field.text.length, column));
		if (extendSelection) {
			if (field.selectionAnchor === null) {
				field.selectionAnchor = field.cursor;
			}
		} else {
			field.selectionAnchor = null;
		}
		field.cursor = clamped;
		field.desiredColumn = clamped;
	}

	private inlineFieldMoveCursorRelative(field: InlineTextField, delta: number, extendSelection: boolean): void {
		this.inlineFieldMoveCursor(field, field.cursor + delta, extendSelection);
	}

	private inlineFieldMoveWordLeft(field: InlineTextField, extendSelection: boolean): void {
		if (field.cursor === 0) {
			if (!extendSelection) {
				field.selectionAnchor = null;
			}
			return;
		}
		const text = field.text;
		let index = field.cursor;
		while (index > 0 && this.isWhitespace(text.charAt(index - 1))) {
			index -= 1;
		}
		while (index > 0 && !this.isWhitespace(text.charAt(index - 1)) && !this.isWordChar(text.charAt(index - 1))) {
			index -= 1;
		}
		while (index > 0 && this.isWordChar(text.charAt(index - 1))) {
			index -= 1;
		}
		this.inlineFieldMoveCursor(field, index, extendSelection);
	}

	private inlineFieldMoveWordRight(field: InlineTextField, extendSelection: boolean): void {
		const length = field.text.length;
		if (field.cursor >= length) {
			if (!extendSelection) {
				field.selectionAnchor = null;
			}
			return;
		}
		const text = field.text;
		let index = field.cursor;
		while (index < length && this.isWhitespace(text.charAt(index))) {
			index += 1;
		}
		while (index < length && !this.isWhitespace(text.charAt(index)) && !this.isWordChar(text.charAt(index))) {
			index += 1;
		}
		while (index < length && this.isWordChar(text.charAt(index))) {
			index += 1;
		}
		this.inlineFieldMoveCursor(field, index, extendSelection);
	}

	private inlineFieldMoveToStart(field: InlineTextField, extendSelection: boolean): void {
		this.inlineFieldMoveCursor(field, 0, extendSelection);
	}

	private inlineFieldMoveToEnd(field: InlineTextField, extendSelection: boolean): void {
		this.inlineFieldMoveCursor(field, field.text.length, extendSelection);
	}

	private inlineFieldSelectAll(field: InlineTextField): void {
		field.selectionAnchor = 0;
		field.cursor = field.text.length;
		field.desiredColumn = field.cursor;
	}

	private inlineFieldGetSelectedText(field: InlineTextField): string | null {
		const range = this.inlineFieldSelectionRange(field);
		if (!range) {
			return null;
		}
		return field.text.slice(range.start, range.end);
	}

	private inlineFieldSelectWordAt(field: InlineTextField, column: number): void {
		const text = field.text;
		if (text.length === 0) {
			field.selectionAnchor = null;
			field.cursor = 0;
			field.desiredColumn = 0;
			return;
		}
		let index = column;
		if (index >= text.length) {
			index = text.length - 1;
		}
		if (index < 0) {
			index = 0;
		}
		const ch = text.charAt(index);
		let start = index;
		let end = index + 1;
		if (this.isWordChar(ch)) {
			while (start > 0 && this.isWordChar(text.charAt(start - 1))) {
				start -= 1;
			}
			while (end < text.length && this.isWordChar(text.charAt(end))) {
				end += 1;
			}
		} else if (this.isWhitespace(ch)) {
			while (start > 0 && this.isWhitespace(text.charAt(start - 1))) {
				start -= 1;
			}
			while (end < text.length && this.isWhitespace(text.charAt(end))) {
				end += 1;
			}
		} else {
			while (start > 0) {
				const previous = text.charAt(start - 1);
				if (this.isWordChar(previous) || this.isWhitespace(previous)) {
					break;
				}
				start -= 1;
			}
			while (end < text.length) {
				const next = text.charAt(end);
				if (this.isWordChar(next) || this.isWhitespace(next)) {
					break;
				}
				end += 1;
			}
		}
		field.selectionAnchor = start;
		field.cursor = end;
		field.desiredColumn = field.cursor;
	}

	private inlineFieldMeasureRange(field: InlineTextField, start: number, end: number): number {
		const clampedStart = Math.max(0, Math.min(start, field.text.length));
		const clampedEnd = Math.max(clampedStart, Math.min(end, field.text.length));
		if (clampedEnd <= clampedStart) {
			return 0;
		}
		const slice = field.text.slice(clampedStart, clampedEnd);
		return this.measureText(slice);
	}

	private inlineFieldResolveColumn(field: InlineTextField, textLeft: number, pointerX: number): number {
		const relative = pointerX - textLeft;
		if (relative <= 0) {
			return 0;
		}
		let advance = 0;
		const length = field.text.length;
		for (let index = 0; index < length; index += 1) {
			const ch = field.text.charAt(index);
			const width = ch === '\t' ? this.spaceAdvance * TAB_SPACES : this.font.advance(ch);
			const midpoint = advance + width * 0.5;
			if (relative < midpoint) {
				return index;
			}
			advance += width;
			if (relative < advance) {
				return index + 1;
			}
		}
		return length;
	}

	private inlineFieldCaretX(field: InlineTextField, textLeft: number): number {
		if (field.cursor <= 0) {
			return textLeft;
		}
		const slice = field.text.slice(0, field.cursor);
		return textLeft + this.measureText(slice);
	}

	private inlineFieldRegisterPointerClick(field: InlineTextField, column: number): boolean {
		const now = $.platform.clock.now();
		const interval = now - field.lastPointerClickTimeMs;
		const sameColumn = column === field.lastPointerClickColumn;
		const isDouble = field.lastPointerClickTimeMs > 0
			&& interval <= DOUBLE_CLICK_MAX_INTERVAL_MS
			&& sameColumn;
		field.lastPointerClickTimeMs = now;
		field.lastPointerClickColumn = column;
		return isDouble;
	}

	private setInlineFieldText(field: InlineTextField, value: string, moveCursorToEnd: boolean): void {
		field.text = value;
		if (moveCursorToEnd) {
			field.cursor = value.length;
		} else {
			if (field.cursor > value.length) {
				field.cursor = value.length;
			}
			if (field.cursor < 0) {
				field.cursor = 0;
			}
		}
		field.selectionAnchor = null;
		field.desiredColumn = field.cursor;
		field.pointerSelecting = false;
		field.lastPointerClickTimeMs = 0;
		field.lastPointerClickColumn = -1;
	}

	private applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
		this.searchQuery = value;
		this.setInlineFieldText(this.searchField, value, moveCursorToEnd);
	}

	private applySymbolSearchFieldText(value: string, moveCursorToEnd: boolean): void {
		this.symbolSearchQuery = value;
		this.setInlineFieldText(this.symbolSearchField, value, moveCursorToEnd);
	}

	private applyLineJumpFieldText(value: string, moveCursorToEnd: boolean): void {
		this.lineJumpValue = value;
		this.setInlineFieldText(this.lineJumpField, value, moveCursorToEnd);
	}

	private applyCreateResourceFieldText(value: string, moveCursorToEnd: boolean): void {
		this.createResourcePath = value;
		this.setInlineFieldText(this.createResourceField, value, moveCursorToEnd);
	}

	private handleInlineFieldEditing(field: InlineTextField, keyboard: KeyboardInput, options: InlineInputOptions): boolean {
		const { ctrlDown, metaDown, shiftDown, altDown, deltaSeconds, allowSpace } = options;
		const characterFilter = options.characterFilter;
		const maxLength = options.maxLength !== undefined ? options.maxLength : null;
		const useCtrl = ctrlDown || metaDown;
		const initialText = field.text;
		const initialCursor = field.cursor;
		const initialAnchor = field.selectionAnchor;

		if (useCtrl && this.isKeyJustPressed(keyboard, 'KeyA')) {
			this.consumeKey(keyboard, 'KeyA');
			this.inlineFieldSelectAll(field);
		}

		if (useCtrl && this.isKeyJustPressed(keyboard, 'KeyC')) {
			const selected = this.inlineFieldGetSelectedText(field);
			const payload = selected && selected.length > 0 ? selected : field.text;
			if (payload.length > 0) {
				void this.writeClipboard(payload, 'Copied to editor clipboard');
			}
			this.consumeKey(keyboard, 'KeyC');
		}

		if (useCtrl && this.isKeyJustPressed(keyboard, 'KeyX')) {
			const selected = this.inlineFieldGetSelectedText(field);
			let payload = selected;
			if (!payload || payload.length === 0) {
				payload = field.text;
				if (payload.length > 0) {
					this.inlineFieldSelectAll(field);
				}
			}
			if (payload && payload.length > 0) {
				void this.writeClipboard(payload, 'Cut to editor clipboard');
				this.inlineFieldDeleteSelection(field);
			}
			this.consumeKey(keyboard, 'KeyX');
		}

		if (useCtrl && this.isKeyJustPressed(keyboard, 'KeyV')) {
			const clipboard = ConsoleCartEditor.customClipboard;
			if (clipboard && clipboard.length > 0) {
				const normalized = clipboard.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
				const merged = normalized.split('\n').join('');
				if (merged.length > 0) {
					const filtered = characterFilter ? merged.split('').filter(characterFilter).join('') : merged;
					if (filtered.length > 0) {
						let insertion = filtered;
						if (maxLength !== null) {
							const remaining = Math.max(0, maxLength - (field.text.length - this.inlineFieldSelectionLength(field)));
							if (remaining <= 0) {
								insertion = '';
							} else if (insertion.length > remaining) {
								insertion = insertion.slice(0, remaining);
							}
						}
						if (insertion.length > 0) {
							this.inlineFieldInsert(field, insertion);
						}
					}
				}
			} else {
				this.showMessage('Editor clipboard is empty', COLOR_STATUS_WARNING, 1.5);
			}
			this.consumeKey(keyboard, 'KeyV');
		}

		if (this.shouldFireRepeat(keyboard, 'Backspace', deltaSeconds)) {
			this.consumeKey(keyboard, 'Backspace');
			if (useCtrl) {
				this.inlineFieldDeleteWordBackward(field);
			} else {
				this.inlineFieldBackspace(field);
			}
		}

		if (this.shouldFireRepeat(keyboard, 'Delete', deltaSeconds)) {
			this.consumeKey(keyboard, 'Delete');
			if (useCtrl) {
				this.inlineFieldDeleteWordForward(field);
			} else {
				this.inlineFieldDeleteForward(field);
			}
		}

		if (this.shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) {
			this.consumeKey(keyboard, 'ArrowLeft');
			if (useCtrl) {
				this.inlineFieldMoveWordLeft(field, shiftDown);
			} else {
				this.inlineFieldMoveCursorRelative(field, -1, shiftDown);
			}
		}

		if (this.shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) {
			this.consumeKey(keyboard, 'ArrowRight');
			if (useCtrl) {
				this.inlineFieldMoveWordRight(field, shiftDown);
			} else {
				this.inlineFieldMoveCursorRelative(field, 1, shiftDown);
			}
		}

		if (this.shouldFireRepeat(keyboard, 'Home', deltaSeconds)) {
			this.consumeKey(keyboard, 'Home');
			this.inlineFieldMoveToStart(field, shiftDown);
		}

		if (this.shouldFireRepeat(keyboard, 'End', deltaSeconds)) {
			this.consumeKey(keyboard, 'End');
			this.inlineFieldMoveToEnd(field, shiftDown);
		}

		if (allowSpace && !useCtrl && !metaDown && !altDown && this.shouldFireRepeat(keyboard, 'Space', deltaSeconds)) {
			this.consumeKey(keyboard, 'Space');
			const remaining = maxLength !== null
				? Math.max(0, maxLength - (field.text.length - this.inlineFieldSelectionLength(field)))
				: undefined;
			if (remaining === undefined || remaining > 0) {
				this.inlineFieldInsert(field, ' ');
			}
		}

		if (!altDown) {
			for (let i = 0; i < CHARACTER_CODES.length; i += 1) {
				const code = CHARACTER_CODES[i];
				if (!this.isKeyTyped(keyboard, code)) {
					continue;
				}
				const entry = CHARACTER_MAP[code];
				const value = shiftDown ? entry.shift : entry.normal;
				if (value.length === 0) {
					this.consumeKey(keyboard, code);
					continue;
				}
				if (characterFilter && !characterFilter(value)) {
					this.consumeKey(keyboard, code);
					continue;
				}
				if (maxLength !== null) {
					const available = maxLength - (field.text.length - this.inlineFieldSelectionLength(field));
					if (available <= 0) {
						this.consumeKey(keyboard, code);
						continue;
					}
				}
				this.inlineFieldInsert(field, value);
				this.consumeKey(keyboard, code);
			}
		}

		this.inlineFieldClampCursor(field);
		this.inlineFieldClampSelectionAnchor(field);
		const textChanged = field.text !== initialText;
		if (!textChanged && field.cursor === initialCursor && field.selectionAnchor === initialAnchor) {
			return false;
		}
		return textChanged;
	}

	private handleInlineFieldPointer(field: InlineTextField, textLeft: number, pointerX: number, justPressed: boolean, pointerPressed: boolean): void {
		const column = this.inlineFieldResolveColumn(field, textLeft, pointerX);
		if (justPressed) {
			const isDouble = this.inlineFieldRegisterPointerClick(field, column);
			if (isDouble) {
				this.inlineFieldSelectWordAt(field, column);
				field.pointerSelecting = false;
			} else {
				field.selectionAnchor = column;
				field.cursor = column;
				field.desiredColumn = column;
				field.pointerSelecting = true;
			}
			this.inlineFieldClampCursor(field);
			this.inlineFieldClampSelectionAnchor(field);
			this.resetBlink();
			return;
		}
		if (!pointerPressed) {
			field.pointerSelecting = false;
			return;
		}
		if (field.pointerSelecting) {
			this.inlineFieldMoveCursor(field, column, true);
			this.inlineFieldClampCursor(field);
			this.inlineFieldClampSelectionAnchor(field);
		}
	}

	private shouldAcceptKeyPress(code: string, state: ButtonState): boolean {
		if (state.pressed !== true) {
			this.keyPressRecords.delete(code);
			return false;
		}
		const pressId = typeof state.pressId === 'number' ? state.pressId : null;
		const existing = this.keyPressRecords.get(code);
		if (pressId !== null) {
			if (existing && existing.lastPressId === pressId) {
				return false;
			}
			this.keyPressRecords.set(code, { lastPressId: pressId });
			return true;
		}
		if (state.justpressed !== true) {
			return false;
		}
		if (existing && existing.lastPressId === null) {
			return false;
		}
		this.keyPressRecords.set(code, { lastPressId: null });
		return true;
	}

	private consumeKey(keyboard: KeyboardInput, code: string): void {
		keyboard.consumeButton(code);
	}

	private isKeyPressed(keyboard: KeyboardInput, code: string): boolean {
		const state = this.getButtonState(keyboard, code);
		return state ? state.pressed === true : false;
	}

	private updateDesiredColumn(): void {
		this.desiredColumn = this.cursorColumn;
	}

	private isKeyTyped(keyboard: KeyboardInput, code: string): boolean {
		const state = this.getButtonState(keyboard, code);
		if (!state) {
			return false;
		}
		return this.shouldAcceptKeyPress(code, state);
	}

	private insertTab(): void {
		this.insertText('\t');
	}

	private insertText(text: string): void {
		if (text.length === 0) {
			return;
		}
		const coalesce = text.length === 1;
		this.prepareUndo('insert-text', coalesce);
		if (this.deleteSelectionIfPresent()) {
			// Selection replaced; proceed to insert at new caret.
		}
		const line = this.currentLine();
		const before = line.slice(0, this.cursorColumn);
		const after = line.slice(this.cursorColumn);
		this.lines[this.cursorRow] = before + text + after;
		this.invalidateLine(this.cursorRow);
		this.cursorColumn += text.length;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.clearSelection();
		this.revealCursor();
	}

	private insertLineBreak(): void {
		this.prepareUndo('insert-line-break', false);
		this.deleteSelectionIfPresent();
		const line = this.currentLine();
		const before = line.slice(0, this.cursorColumn);
		const after = line.slice(this.cursorColumn);
		this.lines[this.cursorRow] = before;
		const indentation = this.extractIndentation(before);
		const newLine = indentation + after;
		this.lines.splice(this.cursorRow + 1, 0, newLine);
		this.invalidateAllHighlights();
		this.cursorRow += 1;
		this.cursorColumn = indentation.length;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.clearSelection();
		this.revealCursor();
	}

	private extractIndentation(value: string): string {
		let result = '';
		for (let i = 0; i < value.length; i++) {
			const ch = value.charAt(i);
			if (ch === ' ' || ch === '\t') {
				result += ch;
			} else {
				break;
			}
		}
		return result;
	}

	private backspace(): void {
		if (!this.hasSelection() && this.cursorColumn === 0 && this.cursorRow === 0) {
			return;
		}
		this.prepareUndo('backspace', true);
		if (this.deleteSelectionIfPresent()) {
			return;
		}
		if (this.cursorColumn > 0) {
			const line = this.currentLine();
			const before = line.slice(0, this.cursorColumn - 1);
			const after = line.slice(this.cursorColumn);
			this.lines[this.cursorRow] = before + after;
			this.invalidateLine(this.cursorRow);
			this.cursorColumn -= 1;
			this.markTextMutated();
			this.resetBlink();
			this.updateDesiredColumn();
			this.revealCursor();
			return;
		}
		if (this.cursorRow === 0) {
			return;
		}
		const previousLine = this.lines[this.cursorRow - 1];
		const current = this.currentLine();
		this.lines[this.cursorRow - 1] = previousLine + current;
		this.lines.splice(this.cursorRow, 1);
		this.invalidateAllHighlights();
		this.cursorRow -= 1;
		this.cursorColumn = previousLine.length;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private deleteForward(): void {
		const line = this.currentLine();
		if (!this.hasSelection() && this.cursorColumn >= line.length && this.cursorRow >= this.lines.length - 1) {
			return;
		}
		this.prepareUndo('delete-forward', true);
		if (this.deleteSelectionIfPresent()) {
			return;
		}
		const updatedLine = this.currentLine();
		if (this.cursorColumn < updatedLine.length) {
			const before = updatedLine.slice(0, this.cursorColumn);
			const after = updatedLine.slice(this.cursorColumn + 1);
			this.lines[this.cursorRow] = before + after;
			this.invalidateLine(this.cursorRow);
			this.markTextMutated();
			this.updateDesiredColumn();
			this.revealCursor();
			return;
		}
		if (this.cursorRow >= this.lines.length - 1) {
			return;
		}
		const nextLine = this.lines[this.cursorRow + 1];
		this.lines[this.cursorRow] = updatedLine + nextLine;
		this.lines.splice(this.cursorRow + 1, 1);
		this.invalidateAllHighlights();
		this.markTextMutated();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private deleteWordBackward(): void {
		this.prepareUndo('delete-word-backward', false);
		if (this.deleteSelectionIfPresent()) {
			return;
		}
		if (this.cursorRow === 0 && this.cursorColumn === 0) {
			return;
		}
		const target = this.findWordLeft(this.cursorRow, this.cursorColumn);
		if (target.row === this.cursorRow && target.column === this.cursorColumn) {
			return;
		}
		this.selectionAnchor = { row: target.row, column: target.column };
		this.replaceSelectionWith('');
	}

	private async save(): Promise<void> {
		const context = this.getActiveCodeTabContext();
		if (!context) {
			return;
		}
		const source = this.lines.join('\n');
		try {
			await context.save(source);
			this.dirty = false;
			this.saveGeneration = this.saveGeneration + 1;
			context.lastSavedSource = source;
			context.saveGeneration = this.saveGeneration;
			const isEntryContext = this.entryTabId !== null && context.id === this.entryTabId;
			if (isEntryContext) {
				this.lastSavedSource = source;
			}
			context.snapshot = this.captureSnapshot();
			this.updateActiveContextDirtyFlag();
			const message = isEntryContext ? 'Lua cart saved (restart pending)' : `${context.title} saved (restart pending)`;
			this.showMessage(message, COLOR_STATUS_SUCCESS, 2.5);
		} catch (error) {
			if (this.tryShowLuaErrorOverlay(error)) {
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(message, COLOR_STATUS_ERROR, 4.0);
		}
	}

	private showMessage(text: string, color: number, durationSeconds: number): void {
		this.message.text = text;
		this.message.color = color;
		this.message.timer = durationSeconds;
		this.message.visible = true;
	}

	private updateMessage(deltaSeconds: number): void {
		if (!this.message.visible) {
			return;
		}
		this.message.timer -= deltaSeconds;
		if (this.message.timer <= 0) {
			this.message.visible = false;
		}
	}

	private updateRuntimeErrorOverlay(deltaSeconds: number): void {
		const overlay = this.runtimeErrorOverlay;
		if (!overlay) {
			return;
		}
		if (!Number.isFinite(overlay.timer)) {
			return;
		}
		overlay.timer -= deltaSeconds;
		if (overlay.timer <= 0) {
			this.setActiveRuntimeErrorOverlay(null);
		}
	}

	private stepLeft(row: number, column: number): { row: number; column: number } | null {
		if (column > 0) {
			return { row, column: column - 1 };
		}
		if (row > 0) {
			return { row: row - 1, column: this.lines[row - 1].length };
		}
		return null;
	}

	private stepRight(row: number, column: number): { row: number; column: number } | null {
		const length = this.lines[row].length;
		if (column < length) {
			return { row, column: column + 1 };
		}
		if (row < this.lines.length - 1) {
			return { row: row + 1, column: 0 };
		}
		return null;
	}

	private charAt(row: number, column: number): string {
		if (row < 0 || row >= this.lines.length) {
			return '';
		}
		const line = this.lines[row];
		if (column < 0 || column >= line.length) {
			return '';
		}
		return line.charAt(column);
	}

	private isWhitespace(ch: string): boolean {
		return ch === '' || ch === ' ' || ch === '\t';
	}

	private isWordChar(ch: string): boolean {
		if (!ch) return false;
		const code = ch.charCodeAt(0);
		return (code >= 48 && code <= 57)
			|| (code >= 65 && code <= 90)
			|| (code >= 97 && code <= 122)
			|| ch === '_';
	}

	private hasSelection(): boolean {
		return this.getSelectionRange() !== null;
	}

	private ensureSelectionAnchor(anchor: Position): void {
		if (!this.selectionAnchor) {
			this.selectionAnchor = { row: anchor.row, column: anchor.column };
		}
	}

	private clearSelection(): void {
		this.selectionAnchor = null;
	}

	private comparePositions(a: Position, b: Position): number {
		if (a.row !== b.row) {
			return a.row - b.row;
		}
		return a.column - b.column;
	}

	private getSelectionRange(): { start: Position; end: Position } | null {
		const anchor = this.selectionAnchor;
		if (!anchor) {
			return null;
		}
		const cursor: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (anchor.row === cursor.row && anchor.column === cursor.column) {
			return null;
		}
		if (this.comparePositions(cursor, anchor) < 0) {
			return { start: cursor, end: anchor };
		}
		return { start: anchor, end: cursor };
	}

	private collapseSelectionTo(target: 'start' | 'end'): void {
		const range = this.getSelectionRange();
		if (!range) {
			return;
		}
		const destination = target === 'start' ? range.start : range.end;
		this.cursorRow = destination.row;
		this.cursorColumn = destination.column;
		this.selectionAnchor = null;
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
	}

	private collapseSelectionOnNavigation(keyboard: KeyboardInput): boolean {
		if (!this.hasSelection()) {
			return false;
		}
		if (this.isKeyJustPressed(keyboard, 'ArrowLeft')) {
			this.consumeKey(keyboard, 'ArrowLeft');
			this.collapseSelectionTo('start');
			this.breakUndoSequence();
			return true;
		}
		if (this.isKeyJustPressed(keyboard, 'ArrowUp')) {
			this.consumeKey(keyboard, 'ArrowUp');
			this.collapseSelectionTo('start');
			this.breakUndoSequence();
			return true;
		}
		if (this.isKeyJustPressed(keyboard, 'ArrowRight')) {
			this.consumeKey(keyboard, 'ArrowRight');
			this.collapseSelectionTo('end');
			this.breakUndoSequence();
			return true;
		}
		if (this.isKeyJustPressed(keyboard, 'ArrowDown')) {
			this.consumeKey(keyboard, 'ArrowDown');
			this.collapseSelectionTo('end');
			this.breakUndoSequence();
			return true;
		}
		return false;
	}

	private deleteSelectionIfPresent(): boolean {
		if (!this.hasSelection()) {
			return false;
		}
		this.replaceSelectionWith('');
		return true;
	}

	private replaceSelectionWith(text: string): void {
		const range = this.getSelectionRange();
		if (!range) {
			return;
		}
		const { start, end } = range;
		const startLine = this.lines[start.row];
		const endLine = this.lines[end.row];
		const leading = startLine.slice(0, start.column);
		const trailing = endLine.slice(end.column);
		const fragments = text.split('\n');
		if (fragments.length === 1) {
			const combined = leading + fragments[0] + trailing;
			this.lines.splice(start.row, end.row - start.row + 1, combined);
			this.cursorRow = start.row;
			this.cursorColumn = leading.length + fragments[0].length;
		}
		else {
			const firstLine = leading + fragments[0];
			const lastFragment = fragments[fragments.length - 1];
			const lastLine = lastFragment + trailing;
			const middle = fragments.slice(1, -1);
			this.lines.splice(start.row, end.row - start.row + 1, firstLine, ...middle, lastLine);
			this.cursorRow = start.row + fragments.length - 1;
			this.cursorColumn = lastFragment.length;
		}
		this.invalidateAllHighlights();
		this.selectionAnchor = null;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private selectWordAtPosition(row: number, column: number): void {
		if (row < 0 || row >= this.lines.length) {
			return;
		}
		const line = this.lines[row];
		if (line.length === 0) {
			this.selectionAnchor = null;
			this.cursorRow = row;
			this.cursorColumn = 0;
			this.updateDesiredColumn();
			this.resetBlink();
			this.revealCursor();
			return;
		}
		let index = column;
		if (index >= line.length) {
			index = line.length - 1;
		}
		if (index < 0) {
			index = 0;
		}
		let start = index;
		let end = index + 1;
		const current = line.charAt(index);
		if (this.isWordChar(current)) {
			while (start > 0 && this.isWordChar(line.charAt(start - 1))) {
				start -= 1;
			}
			while (end < line.length && this.isWordChar(line.charAt(end))) {
				end += 1;
			}
		} else if (this.isWhitespace(current)) {
			while (start > 0 && this.isWhitespace(line.charAt(start - 1))) {
				start -= 1;
			}
			while (end < line.length && this.isWhitespace(line.charAt(end))) {
				end += 1;
			}
		} else {
			while (start > 0) {
				const previous = line.charAt(start - 1);
				if (this.isWordChar(previous) || this.isWhitespace(previous)) {
					break;
				}
				start -= 1;
			}
			while (end < line.length) {
				const next = line.charAt(end);
				if (this.isWordChar(next) || this.isWhitespace(next)) {
					break;
				}
				end += 1;
			}
		}
		if (end < start) {
			end = start;
		}
		this.selectionAnchor = { row, column: start };
		this.cursorRow = row;
		this.cursorColumn = end;
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
	}

	private getSelectionText(): string | null {
		const range = this.getSelectionRange();
		if (!range) {
			return null;
		}
		const { start, end } = range;
		if (start.row === end.row) {
			return this.lines[start.row].slice(start.column, end.column);
		}
		const parts: string[] = [];
		parts.push(this.lines[start.row].slice(start.column));
		for (let row = start.row + 1; row < end.row; row++) {
			parts.push(this.lines[row]);
		}
		parts.push(this.lines[end.row].slice(0, end.column));
		return parts.join('\n');
	}

	private async copySelectionToClipboard(): Promise<void> {
		const text = this.getSelectionText();
		if (text === null) {
			this.showMessage('Nothing selected to copy', COLOR_STATUS_WARNING, 1.5);
			return;
		}
		await this.writeClipboard(text, 'Copied selection to clipboard');
	}

	private async cutSelectionToClipboard(): Promise<void> {
		const text = this.getSelectionText();
		if (text === null) {
			this.showMessage('Nothing selected to cut', COLOR_STATUS_WARNING, 1.5);
			return;
		}
		this.prepareUndo('cut', false);
		await this.writeClipboard(text, 'Cut selection to clipboard');
		this.replaceSelectionWith('');
	}

	private async cutLineToClipboard(): Promise<void> {
		if (this.lines.length === 0) {
			this.showMessage('Nothing selected to cut', COLOR_STATUS_WARNING, 1.5);
			return;
		}
		const currentLine = this.currentLine();
		const isLastLine = this.cursorRow >= this.lines.length - 1;
		const text = isLastLine ? currentLine : currentLine + '\n';
		this.prepareUndo('cut-line', false);
		await this.writeClipboard(text, 'Cut line to clipboard');
		if (this.lines.length === 1) {
			this.lines[0] = '';
			this.cursorColumn = 0;
		} else {
			this.lines.splice(this.cursorRow, 1);
			if (this.cursorRow >= this.lines.length) {
				this.cursorRow = this.lines.length - 1;
			}
			const newLength = this.lines[this.cursorRow].length;
			if (this.cursorColumn > newLength) {
				this.cursorColumn = newLength;
			}
		}
		this.invalidateAllHighlights();
		this.selectionAnchor = null;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private pasteFromClipboard(): void {
		const text = ConsoleCartEditor.customClipboard;
		if (text === null || text.length === 0) {
			this.showMessage('Editor clipboard is empty', COLOR_STATUS_WARNING, 1.5);
			return;
		}
		this.prepareUndo('paste', false);
		this.deleteSelectionIfPresent();
		this.insertClipboardText(text);
		this.showMessage('Pasted from editor clipboard', COLOR_STATUS_SUCCESS, 1.5);
	}

	private async writeClipboard(text: string, successMessage: string): Promise<void> {
		ConsoleCartEditor.customClipboard = text;
		const clipboard = this.getClipboardService();
		if (!clipboard.isSupported()) {
			const message = successMessage + ' (Editor clipboard only)';
			this.showMessage(message, COLOR_STATUS_SUCCESS, 1.5);
			return;
		}
		try {
			await clipboard.writeText(text);
			this.showMessage(successMessage, COLOR_STATUS_SUCCESS, 1.5);
		}
		catch (error) {
			this.showMessage('System clipboard write failed. Editor clipboard updated.', COLOR_STATUS_WARNING, 3.5);
		}
	}

	private insertClipboardText(text: string): void {
		const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const fragments = normalized.split('\n');
		const currentLine = this.currentLine();
		const before = currentLine.slice(0, this.cursorColumn);
		const after = currentLine.slice(this.cursorColumn);
		if (fragments.length === 1) {
			const fragment = fragments[0];
			this.lines[this.cursorRow] = before + fragment + after;
			this.invalidateLine(this.cursorRow);
			this.cursorColumn = before.length + fragment.length;
		} else {
			const firstLine = before + fragments[0];
			const lastIndex = fragments.length - 1;
			const lastFragment = fragments[lastIndex];
			const newLines: string[] = [];
			newLines.push(firstLine);
			for (let i = 1; i < lastIndex; i++) {
				newLines.push(fragments[i]);
			}
			newLines.push(lastFragment + after);
			const insertionRow = this.cursorRow;
			this.lines.splice(insertionRow, 1, ...newLines);
			this.invalidateAllHighlights();
			this.cursorRow = insertionRow + lastIndex;
			this.cursorColumn = lastFragment.length;
		}
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.clearSelection();
		this.revealCursor();
	}

	private captureSnapshot(): EditorSnapshot {
		const linesCopy = this.lines.slice();
		let selectionCopy: Position | null = null;
		if (this.selectionAnchor) {
			selectionCopy = { row: this.selectionAnchor.row, column: this.selectionAnchor.column };
		}
		return {
			lines: linesCopy,
			cursorRow: this.cursorRow,
			cursorColumn: this.cursorColumn,
			scrollRow: this.scrollRow,
			scrollColumn: this.scrollColumn,
			selectionAnchor: selectionCopy,
			dirty: this.dirty,
		};
	}

	private restoreSnapshot(snapshot: EditorSnapshot, preserveSelection: boolean = false): void {
		const preservedSelection = preserveSelection && this.selectionAnchor
			? { row: this.selectionAnchor.row, column: this.selectionAnchor.column }
			: null;
		this.lines = snapshot.lines.slice();
		this.invalidateAllHighlights();
		this.cursorRow = snapshot.cursorRow;
		this.cursorColumn = snapshot.cursorColumn;
		this.scrollRow = snapshot.scrollRow;
		this.scrollColumn = snapshot.scrollColumn;
		if (!preserveSelection) {
			if (snapshot.selectionAnchor) {
				this.selectionAnchor = { row: snapshot.selectionAnchor.row, column: snapshot.selectionAnchor.column };
			} else {
				this.selectionAnchor = null;
			}
		} else {
			this.selectionAnchor = this.clampSelectionPosition(preservedSelection);
		}
		this.dirty = snapshot.dirty;
		this.bumpTextVersion();
		this.updateDesiredColumn();
		this.resetBlink();
		this.cursorRevealSuspended = false;
		this.updateActiveContextDirtyFlag();
		this.ensureCursorVisible();
	}

	private prepareUndo(key: string, allowMerge: boolean): void {
		const now = Date.now();
		const shouldMerge = allowMerge
			&& this.lastHistoryKey === key
			&& now - this.lastHistoryTimestamp <= UNDO_COALESCE_INTERVAL_MS;
		if (shouldMerge) {
			this.lastHistoryTimestamp = now;
			return;
		}
		const snapshot = this.captureSnapshot();
		if (this.undoStack.length >= UNDO_HISTORY_LIMIT) {
			this.undoStack.shift();
		}
		this.undoStack.push(snapshot);
		this.redoStack.length = 0;
		this.lastHistoryTimestamp = now;
		if (allowMerge) {
			this.lastHistoryKey = key;
		} else {
			this.lastHistoryKey = null;
		}
	}

	private undo(): void {
		if (this.undoStack.length === 0) {
			return;
		}
		const snapshot = this.undoStack.pop();
		if (!snapshot) {
			return;
		}
		const current = this.captureSnapshot();
		if (this.redoStack.length >= UNDO_HISTORY_LIMIT) {
			this.redoStack.shift();
		}
		this.redoStack.push(current);
		this.restoreSnapshot(snapshot, true);
		this.breakUndoSequence();
	}

	private redo(): void {
		if (this.redoStack.length === 0) {
			return;
		}
		const snapshot = this.redoStack.pop();
		if (!snapshot) {
			return;
		}
		const current = this.captureSnapshot();
		if (this.undoStack.length >= UNDO_HISTORY_LIMIT) {
			this.undoStack.shift();
		}
		this.undoStack.push(current);
		this.restoreSnapshot(snapshot, true);
		this.breakUndoSequence();
	}

	private breakUndoSequence(): void {
		this.lastHistoryKey = null;
		this.lastHistoryTimestamp = 0;
	}

	private moveSelectionLines(delta: number): void {
		if (delta === 0) return;
		const range = this.getLineRangeForMovement();
		if (delta < 0 && range.startRow === 0) return;
		if (delta > 0 && range.endRow >= this.lines.length - 1) return;
		this.prepareUndo('move-lines', false);
		const count = range.endRow - range.startRow + 1;
		const block = this.lines.splice(range.startRow, count);
		const targetIndex = range.startRow + delta;
		this.lines.splice(targetIndex, 0, ...block);
		this.invalidateAllHighlights();
		this.cursorRow += delta;
		if (this.selectionAnchor) {
			this.selectionAnchor = { row: this.selectionAnchor.row + delta, column: this.selectionAnchor.column };
		}
		this.clampCursorColumn();
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private getLineRangeForMovement(): { startRow: number; endRow: number } {
		const range = this.getSelectionRange();
		if (!range) {
			return { startRow: this.cursorRow, endRow: this.cursorRow };
		}
		let endRow = range.end.row;
		if (range.end.column === 0 && endRow > range.start.row) {
			endRow -= 1;
		}
		return { startRow: range.start.row, endRow };
	}

	private drawTopBar(api: BmsxConsoleApi): void {
		const primaryBarHeight = this.headerHeight;
		api.rectfill(0, 0, this.viewportWidth, primaryBarHeight, COLOR_TOP_BAR);

		const buttonTop = 1;
		const buttonHeight = this.lineHeight + HEADER_BUTTON_PADDING_Y * 2;
		let buttonX = 4;
		const buttonEntries: Array<{ id: TopBarButtonId; label: string; disabled: boolean; active?: boolean }> = [
			{ id: 'resume', label: 'RESUME', disabled: false },
			{ id: 'reboot', label: 'REBOOT', disabled: false },
			{ id: 'save', label: 'SAVE', disabled: !this.dirty },
			{ id: 'resources', label: 'FILES', disabled: false, active: this.resourcePanelVisible },
		];
		for (let i = 0; i < buttonEntries.length; i++) {
			const entry = buttonEntries[i];
			const textWidth = this.measureText(entry.label);
			const buttonWidth = textWidth + HEADER_BUTTON_PADDING_X * 2;
			const right = buttonX + buttonWidth;
			const bottom = buttonTop + buttonHeight;
			const bounds: RectBounds = { left: buttonX, top: buttonTop, right, bottom };
			this.topBarButtonBounds[entry.id] = bounds;
			const fillColor = entry.active
				? COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND
				: (entry.disabled ? COLOR_HEADER_BUTTON_DISABLED_BACKGROUND : COLOR_HEADER_BUTTON_BACKGROUND);
			const textColor = entry.active
				? COLOR_HEADER_BUTTON_ACTIVE_TEXT
				: (entry.disabled ? COLOR_HEADER_BUTTON_TEXT_DISABLED : COLOR_HEADER_BUTTON_TEXT);
			api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, fillColor);
			api.rect(bounds.left, bounds.top, bounds.right, bounds.bottom, COLOR_HEADER_BUTTON_BORDER);
			this.drawText(api, entry.label, bounds.left + HEADER_BUTTON_PADDING_X, bounds.top + HEADER_BUTTON_PADDING_Y, textColor);
			buttonX = right + HEADER_BUTTON_SPACING;
		}

		const titleY = primaryBarHeight + 1;
		const title = this.metadata.title.toUpperCase();
		const versionSuffix = this.dirty ? '*' : '';
		const version = `v${this.metadata.version}${versionSuffix}`;
		this.drawText(api, title, 4, titleY, COLOR_TOP_BAR_TEXT);
		this.drawText(api, version, this.viewportWidth - this.measureText(version) - 4, titleY, COLOR_TOP_BAR_TEXT);
	}

	private drawCreateResourceBar(api: BmsxConsoleApi): void {
		const height = this.getCreateResourceBarHeight();
		if (height <= 0) {
			return;
		}
		const barTop = this.headerHeight + this.tabBarHeight;
		const barBottom = barTop + height;
		api.rectfill(0, barTop, this.viewportWidth, barBottom, COLOR_CREATE_RESOURCE_BACKGROUND);
		api.rectfill(0, barTop, this.viewportWidth, barTop + 1, COLOR_CREATE_RESOURCE_OUTLINE);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, COLOR_CREATE_RESOURCE_OUTLINE);

		const label = 'NEW FILE:';
		const labelX = 4;
		const labelY = barTop + CREATE_RESOURCE_BAR_MARGIN_Y;
		this.drawText(api, label, labelX, labelY, COLOR_CREATE_RESOURCE_TEXT);

		const field = this.createResourceField;
		const pathX = labelX + this.measureText(label + ' ');
		let displayPath = field.text;
		let pathColor = COLOR_CREATE_RESOURCE_TEXT;
		if (displayPath.length === 0 && !this.createResourceActive) {
			displayPath = 'ENTER LUA PATH';
			pathColor = COLOR_CREATE_RESOURCE_PLACEHOLDER;
		}

		const selection = this.inlineFieldSelectionRange(field);
		if (selection && field.text.length > 0) {
			const selectionLeft = pathX + this.inlineFieldMeasureRange(field, 0, selection.start);
			const selectionWidth = this.inlineFieldMeasureRange(field, selection.start, selection.end);
			if (selectionWidth > 0) {
				api.rectfillColor(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + this.lineHeight, SELECTION_OVERLAY);
			}
		}

		this.drawText(api, displayPath, pathX, labelY, pathColor);

		const caretBaseX = this.inlineFieldCaretX(field, pathX);
		const caretLeft = Math.floor(caretBaseX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretBaseX + this.charAdvance));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + this.lineHeight;
		this.drawCaretShape(api, caretLeft, caretTop, caretRight, caretBottom, this.createResourceActive);

		if (this.createResourceWorking) {
			const status = 'CREATING...';
			const statusWidth = this.measureText(status);
			const statusX = Math.max(pathX + this.measureText(displayPath) + this.spaceAdvance, this.viewportWidth - statusWidth - 4);
			this.drawText(api, status, statusX, labelY, COLOR_CREATE_RESOURCE_TEXT);
		} else if (this.createResourceError && this.createResourceError.length > 0) {
			this.drawCreateResourceErrorDialog(api, this.createResourceError);
		}
	}

	private drawSearchBar(api: BmsxConsoleApi): void {
		const height = this.getSearchBarHeight();
		if (height <= 0) {
			return;
		}
		const baseTop = this.headerHeight + this.tabBarHeight + this.getCreateResourceBarHeight();
		const barTop = baseTop;
		const barBottom = barTop + height;
		api.rectfill(0, barTop, this.viewportWidth, barBottom, COLOR_SEARCH_BACKGROUND);
		api.rectfill(0, barTop, this.viewportWidth, barTop + 1, COLOR_SEARCH_OUTLINE);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, COLOR_SEARCH_OUTLINE);

		const field = this.searchField;
		const label = 'SEARCH:';
		const labelX = 4;
		const labelY = barTop + SEARCH_BAR_MARGIN_Y;
		this.drawText(api, label, labelX, labelY, COLOR_SEARCH_TEXT);

		let queryText = field.text;
		let queryColor = COLOR_SEARCH_TEXT;
		if (queryText.length === 0 && !this.searchActive) {
			queryText = 'TYPE TO SEARCH';
			queryColor = COLOR_SEARCH_PLACEHOLDER;
		}
		const queryX = labelX + this.measureText(label + ' ');

		const selection = this.inlineFieldSelectionRange(field);
		if (selection && field.text.length > 0) {
			const selectionLeft = queryX + this.inlineFieldMeasureRange(field, 0, selection.start);
			const selectionWidth = this.inlineFieldMeasureRange(field, selection.start, selection.end);
			if (selectionWidth > 0) {
				api.rectfillColor(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + this.lineHeight, SELECTION_OVERLAY);
			}
		}

		this.drawText(api, queryText, queryX, labelY, queryColor);

		const caretX = this.inlineFieldCaretX(field, queryX);
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + this.charAdvance));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + this.lineHeight;
		this.drawCaretShape(api, caretLeft, caretTop, caretRight, caretBottom, this.searchActive);

		if (this.searchQuery.length > 0) {
			const total = this.searchMatches.length;
			const current = this.searchCurrentIndex >= 0 ? this.searchCurrentIndex + 1 : 0;
			const infoText = total === 0 ? '0/0' : `${current}/${total}`;
			const infoColor = total === 0 ? COLOR_STATUS_WARNING : COLOR_SEARCH_TEXT;
			const infoWidth = this.measureText(infoText);
			this.drawText(api, infoText, this.viewportWidth - infoWidth - 4, labelY, infoColor);
		}
	}

	private drawSymbolSearchBar(api: BmsxConsoleApi): void {
		const height = this.getSymbolSearchBarHeight();
		if (height <= 0) {
			return;
		}
		const baseTop = this.headerHeight + this.tabBarHeight + this.getCreateResourceBarHeight() + this.getSearchBarHeight();
		const barTop = baseTop;
		const barBottom = barTop + height;
		api.rectfill(0, barTop, this.viewportWidth, barBottom, COLOR_SYMBOL_SEARCH_BACKGROUND);
		api.rectfill(0, barTop, this.viewportWidth, barTop + 1, COLOR_SYMBOL_SEARCH_OUTLINE);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, COLOR_SYMBOL_SEARCH_OUTLINE);

		const field = this.symbolSearchField;
		const label = 'SYMBOL @:';
		const labelX = 4;
		const labelY = barTop + SYMBOL_SEARCH_BAR_MARGIN_Y;
		this.drawText(api, label, labelX, labelY, COLOR_SYMBOL_SEARCH_TEXT);

		let queryText = field.text;
		let queryColor = COLOR_SYMBOL_SEARCH_TEXT;
		if (queryText.length === 0 && !this.symbolSearchActive) {
			queryText = 'TYPE TO FILTER';
			queryColor = COLOR_SYMBOL_SEARCH_PLACEHOLDER;
		}
		const queryX = labelX + this.measureText(label + ' ');

		const selection = this.inlineFieldSelectionRange(field);
		if (selection && field.text.length > 0) {
			const selectionLeft = queryX + this.inlineFieldMeasureRange(field, 0, selection.start);
			const selectionWidth = this.inlineFieldMeasureRange(field, selection.start, selection.end);
			if (selectionWidth > 0) {
				api.rectfillColor(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + this.lineHeight, SELECTION_OVERLAY);
			}
		}

		this.drawText(api, queryText, queryX, labelY, queryColor);

		const caretX = this.inlineFieldCaretX(field, queryX);
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + this.charAdvance));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + this.lineHeight;
		this.drawCaretShape(api, caretLeft, caretTop, caretRight, caretBottom, this.symbolSearchActive);

		const resultCount = this.symbolSearchVisibleResultCount();
		if (resultCount <= 0) {
			return;
		}
		const baseHeight = this.lineHeight + SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
		const separatorTop = barTop + baseHeight;
		api.rectfill(0, separatorTop, this.viewportWidth, separatorTop + SYMBOL_SEARCH_RESULT_SPACING, COLOR_SYMBOL_SEARCH_OUTLINE);
		const resultsTop = separatorTop + SYMBOL_SEARCH_RESULT_SPACING;
		for (let i = 0; i < resultCount; i += 1) {
			const matchIndex = this.symbolSearchDisplayOffset + i;
			const match = this.symbolSearchMatches[matchIndex];
			const rowTop = resultsTop + i * this.lineHeight;
			const rowBottom = rowTop + this.lineHeight;
			const isSelected = matchIndex === this.symbolSearchSelectionIndex;
			const isHover = matchIndex === this.symbolSearchHoverIndex;
			if (isSelected) {
				api.rectfillColor(0, rowTop, this.viewportWidth, rowBottom, HIGHLIGHT_OVERLAY);
			} else if (isHover) {
				api.rectfillColor(0, rowTop, this.viewportWidth, rowBottom, SELECTION_OVERLAY);
			}
			let textX = SYMBOL_SEARCH_RESULT_PADDING_X;
			const kindText = match.entry.kindLabel;
			if (kindText.length > 0) {
				this.drawText(api, kindText, textX, rowTop, COLOR_SYMBOL_SEARCH_KIND);
				textX += this.measureText(kindText + ' ');
			}
			this.drawText(api, match.entry.displayName, textX, rowTop, COLOR_SYMBOL_SEARCH_TEXT);
			const lineText = `:${match.entry.line}`;
			const lineWidth = this.measureText(lineText);
			let rightX = this.viewportWidth - lineWidth - SYMBOL_SEARCH_RESULT_PADDING_X;
			this.drawText(api, lineText, rightX, rowTop, COLOR_SYMBOL_SEARCH_TEXT);
			if (match.entry.sourceLabel) {
				const sourceWidth = this.measureText(match.entry.sourceLabel);
				const sourceX = Math.max(textX, rightX - this.spaceAdvance - sourceWidth);
				this.drawText(api, match.entry.sourceLabel, sourceX, rowTop, COLOR_SYMBOL_SEARCH_KIND);
				rightX = sourceX;
			}
		}
	}

	private drawLineJumpBar(api: BmsxConsoleApi): void {
		const height = this.getLineJumpBarHeight();
		if (height <= 0) {
			return;
		}
		const baseTop = this.headerHeight + this.tabBarHeight + this.getCreateResourceBarHeight();
		const barTop = baseTop + this.getSearchBarHeight();
		const barBottom = barTop + height;
		api.rectfill(0, barTop, this.viewportWidth, barBottom, COLOR_LINE_JUMP_BACKGROUND);
		api.rectfill(0, barTop, this.viewportWidth, barTop + 1, COLOR_LINE_JUMP_OUTLINE);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, COLOR_LINE_JUMP_OUTLINE);

		const label = 'LINE #:';
		const labelX = 4;
		const labelY = barTop + LINE_JUMP_BAR_MARGIN_Y;
		this.drawText(api, label, labelX, labelY, COLOR_LINE_JUMP_TEXT);

		const field = this.lineJumpField;
		let valueText = field.text;
		let valueColor = COLOR_LINE_JUMP_TEXT;
		if (valueText.length === 0 && !this.lineJumpActive) {
			valueText = 'ENTER LINE NUMBER';
			valueColor = COLOR_LINE_JUMP_PLACEHOLDER;
		}
		const valueX = labelX + this.measureText(label + ' ');

		const selection = this.inlineFieldSelectionRange(field);
		if (selection && field.text.length > 0) {
			const selectionLeft = valueX + this.inlineFieldMeasureRange(field, 0, selection.start);
			const selectionWidth = this.inlineFieldMeasureRange(field, selection.start, selection.end);
			if (selectionWidth > 0) {
				api.rectfillColor(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + this.lineHeight, SELECTION_OVERLAY);
			}
		}

		this.drawText(api, valueText, valueX, labelY, valueColor);

		const caretX = this.inlineFieldCaretX(field, valueX);
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + this.charAdvance));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + this.lineHeight;
		this.drawCaretShape(api, caretLeft, caretTop, caretRight, caretBottom, this.lineJumpActive);
	}

	private drawCreateResourceErrorDialog(api: BmsxConsoleApi, message: string): void {
		const maxDialogWidth = Math.min(this.viewportWidth - 16, 360);
		const wrapWidth = Math.max(this.charAdvance, maxDialogWidth - (ERROR_OVERLAY_PADDING_X * 2 + 12));
		const segments = message.split(/\r?\n/);
		const lines: string[] = [];
		for (let i = 0; i < segments.length; i += 1) {
			const segment = segments[i].trim();
			const wrapped = this.wrapRuntimeErrorLine(segment.length === 0 ? '' : segment, wrapWidth);
			for (let j = 0; j < wrapped.length; j += 1) {
				lines.push(wrapped[j]);
			}
		}
		if (lines.length === 0) {
			lines.push('');
		}
		let contentWidth = 0;
		for (let i = 0; i < lines.length; i += 1) {
			contentWidth = Math.max(contentWidth, this.measureText(lines[i]));
		}
		const dialogWidth = Math.min(this.viewportWidth - 16, Math.max(180, contentWidth + ERROR_OVERLAY_PADDING_X * 2 + 12));
		const dialogHeight = Math.min(this.viewportHeight - 16, lines.length * this.lineHeight + ERROR_OVERLAY_PADDING_Y * 2 + 16);
		const left = Math.max(8, Math.floor((this.viewportWidth - dialogWidth) / 2));
		const top = Math.max(8, Math.floor((this.viewportHeight - dialogHeight) / 2));
		const right = left + dialogWidth;
		const bottom = top + dialogHeight;
		api.rectfill(left, top, right, bottom, COLOR_STATUS_BACKGROUND);
		api.rect(left, top, right, bottom, COLOR_CREATE_RESOURCE_ERROR);
		let textY = top + ERROR_OVERLAY_PADDING_Y + 6;
		for (let i = 0; i < lines.length; i += 1) {
			const textX = left + ERROR_OVERLAY_PADDING_X + 6;
			this.drawText(api, lines[i], textX, textY, COLOR_STATUS_TEXT);
			textY += this.lineHeight;
		}
	}

	private simplifyRuntimeErrorMessage(message: string): string {
		return message.replace(/^\[BmsxConsoleRuntime\]\s*/, '');
	}

	private codeViewportTop(): number {
		return this.topMargin
			+ this.getCreateResourceBarHeight()
			+ this.getSearchBarHeight()
			+ this.getSymbolSearchBarHeight()
			+ this.getLineJumpBarHeight();
	}

	private getCreateResourceBarHeight(): number {
		if (!this.isCreateResourceVisible()) {
			return 0;
		}
		return this.lineHeight + CREATE_RESOURCE_BAR_MARGIN_Y * 2;
	}

	private isCreateResourceVisible(): boolean {
		return this.createResourceVisible;
	}

	private getSearchBarHeight(): number {
		if (!this.isSearchVisible()) {
			return 0;
		}
		return this.lineHeight + SEARCH_BAR_MARGIN_Y * 2;
	}

	private isSearchVisible(): boolean {
		return this.searchVisible;
	}

	private getSymbolSearchBarHeight(): number {
		if (!this.isSymbolSearchVisible()) {
			return 0;
		}
		const baseHeight = this.lineHeight + SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
		const visible = this.symbolSearchVisibleResultCount();
		if (visible <= 0) {
			return baseHeight;
		}
		return baseHeight + SYMBOL_SEARCH_RESULT_SPACING + visible * this.lineHeight;
	}

	private isSymbolSearchVisible(): boolean {
		return this.symbolSearchVisible;
	}

	private getLineJumpBarHeight(): number {
		if (!this.isLineJumpVisible()) {
			return 0;
		}
		return this.lineHeight + LINE_JUMP_BAR_MARGIN_Y * 2;
	}

	private isLineJumpVisible(): boolean {
		return this.lineJumpVisible;
	}

	private getCreateResourceBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getCreateResourceBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = this.headerHeight + this.tabBarHeight;
		return {
			top,
			bottom: top + height,
			left: 0,
			right: this.viewportWidth,
		};
	}

	private getSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getSearchBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = this.headerHeight + this.tabBarHeight + this.getCreateResourceBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: this.viewportWidth,
		};
	}

	private getLineJumpBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getLineJumpBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = this.headerHeight + this.tabBarHeight + this.getCreateResourceBarHeight() + this.getSearchBarHeight() + this.getSymbolSearchBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: this.viewportWidth,
		};
	}

	private getSymbolSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getSymbolSearchBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = this.headerHeight + this.tabBarHeight + this.getCreateResourceBarHeight() + this.getSearchBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: this.viewportWidth,
		};
	}

	private drawCodeArea(api: BmsxConsoleApi): void {
		const bounds = this.getCodeAreaBounds();
		const gutterOffset = bounds.textLeft - bounds.codeLeft;
		const advance = this.warnNonMonospace ? this.spaceAdvance : this.charAdvance;

		let horizontalVisible = this.codeHorizontalScrollbarVisible;
		let verticalVisible = this.codeVerticalScrollbarVisible;
		let rowCapacity = 1;
		let columnCapacity = 1;
		for (let i = 0; i < 3; i += 1) {
			const availableHeight = Math.max(0, (bounds.codeBottom - bounds.codeTop) - (horizontalVisible ? SCROLLBAR_WIDTH : 0));
			rowCapacity = Math.max(1, Math.floor(availableHeight / this.lineHeight));
			verticalVisible = this.lines.length > rowCapacity;
			const availableWidth = Math.max(0, (bounds.codeRight - bounds.codeLeft) - (verticalVisible ? SCROLLBAR_WIDTH : 0) - gutterOffset);
			columnCapacity = Math.max(1, Math.floor(availableWidth / advance));
			const maxLength = this.maximumLineLength();
			horizontalVisible = maxLength > columnCapacity;
		}

		this.codeVerticalScrollbarVisible = verticalVisible;
		this.codeHorizontalScrollbarVisible = horizontalVisible;
		this.cachedVisibleRowCount = rowCapacity;
		this.cachedVisibleColumnCount = columnCapacity;

		const contentRight = bounds.codeRight - (verticalVisible ? SCROLLBAR_WIDTH : 0);
		const contentBottom = bounds.codeBottom - (horizontalVisible ? SCROLLBAR_WIDTH : 0);

		api.rectfill(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, COLOR_CODE_BACKGROUND);
		if (bounds.gutterRight > bounds.gutterLeft) {
			api.rectfill(bounds.gutterLeft, bounds.codeTop, bounds.gutterRight, contentBottom, COLOR_GUTTER_BACKGROUND);
		}

		const activeGotoHighlight = this.gotoHoverHighlight;
		const gotoRow = activeGotoHighlight ? activeGotoHighlight.row : -1;
		let cursorEntry: CachedHighlight | null = null;
		let cursorSliceStart = 0;
		const sliceWidth = columnCapacity + 2;

		for (let i = 0; i < rowCapacity; i++) {
			const lineIndex = this.scrollRow + i;
			const rowY = bounds.codeTop + i * this.lineHeight;
			if (rowY >= contentBottom) {
				break;
			}
			if (lineIndex === this.cursorRow) {
				api.rectfillColor(bounds.gutterRight, rowY, contentRight, rowY + this.lineHeight, HIGHLIGHT_OVERLAY);
			}

			if (lineIndex < this.lines.length) {
				const entry = this.getCachedHighlight(lineIndex);
				const highlight = entry.hi;
				const slice = this.sliceHighlightedLine(highlight, this.scrollColumn, sliceWidth);
				this.drawSearchHighlightsForRow(api, lineIndex, entry, bounds.textLeft, rowY, slice.startDisplay, slice.endDisplay);
				const selectionSlice = this.computeSelectionSlice(lineIndex, highlight, slice.startDisplay, slice.endDisplay);
				if (selectionSlice) {
					const selectionStartX = bounds.textLeft + this.measureRangeFast(entry, slice.startDisplay, selectionSlice.startDisplay);
					const selectionEndX = bounds.textLeft + this.measureRangeFast(entry, slice.startDisplay, selectionSlice.endDisplay);
					const clampedLeft = clamp(selectionStartX, bounds.textLeft, contentRight);
					const clampedRight = clamp(selectionEndX, clampedLeft, contentRight);
					if (clampedRight > clampedLeft) {
						api.rectfillColor(clampedLeft, rowY, clampedRight, rowY + this.lineHeight, SELECTION_OVERLAY);
					}
				}
				this.drawColoredText(api, slice.text, slice.colors, bounds.textLeft, rowY);
				if (activeGotoHighlight && gotoRow === lineIndex) {
					const startDisplayFull = this.columnToDisplay(highlight, activeGotoHighlight.startColumn);
					const endDisplayFull = this.columnToDisplay(highlight, activeGotoHighlight.endColumn);
					const clampedStartDisplay = clamp(startDisplayFull, slice.startDisplay, slice.endDisplay);
					const clampedEndDisplay = clamp(endDisplayFull, clampedStartDisplay, slice.endDisplay);
					if (clampedEndDisplay > clampedStartDisplay) {
						const underlineStartX = bounds.textLeft + this.measureRangeFast(entry, slice.startDisplay, clampedStartDisplay);
						const underlineEndX = bounds.textLeft + this.measureRangeFast(entry, slice.startDisplay, clampedEndDisplay);
						let drawLeft = Math.floor(underlineStartX);
						let drawRight = Math.ceil(underlineEndX);
						if (drawRight <= drawLeft) {
							drawRight = drawLeft + Math.max(1, Math.floor(this.charAdvance));
						}
						if (drawRight > drawLeft) {
							const underlineY = Math.min(contentBottom - 1, rowY + this.lineHeight - 1);
							if (underlineY >= rowY && underlineY < contentBottom) {
								api.rectfill(drawLeft, underlineY, drawRight, underlineY + 1, COLOR_GOTO_UNDERLINE);
							}
						}
					}
				}
				if (lineIndex === this.cursorRow) {
					cursorEntry = entry;
					cursorSliceStart = slice.startDisplay;
				}
			} else {
				this.drawColoredText(api, '~', [COLOR_CODE_DIM], bounds.textLeft, rowY);
			}
		}

		const verticalTrack: RectBounds = {
			left: contentRight,
			top: bounds.codeTop,
			right: contentRight + SCROLLBAR_WIDTH,
			bottom: contentBottom,
		};
		const codeVerticalScrollbar = this.scrollbars.codeVertical;
		codeVerticalScrollbar.layout(verticalTrack, this.lines.length, rowCapacity, this.scrollRow);

		const maxColumns = columnCapacity + this.computeMaximumScrollColumn();
		const horizontalTrack: RectBounds = {
			left: bounds.codeLeft,
			top: contentBottom,
			right: contentRight,
			bottom: contentBottom + SCROLLBAR_WIDTH,
		};
		const codeHorizontalScrollbar = this.scrollbars.codeHorizontal;
		codeHorizontalScrollbar.layout(horizontalTrack, maxColumns, columnCapacity, this.scrollColumn);
		this.scrollColumn = clamp(Math.round(codeHorizontalScrollbar.getScroll()), 0, this.computeMaximumScrollColumn());

		this.drawRuntimeErrorOverlay(api, bounds.codeTop, contentRight, bounds.textLeft);
		this.drawHoverTooltip(api, bounds.codeTop, contentBottom, bounds.textLeft);

		if (this.cursorVisible && cursorEntry) {
			this.drawCursor(api, bounds.textLeft, bounds.codeTop, cursorEntry, cursorSliceStart);
		}
		if (codeVerticalScrollbar.isVisible()) {
			codeVerticalScrollbar.draw(api, SCROLLBAR_TRACK_COLOR, SCROLLBAR_THUMB_COLOR);
			this.codeVerticalScrollbarVisible = true;
		} else {
			this.codeVerticalScrollbarVisible = false;
		}
		if (codeHorizontalScrollbar.isVisible()) {
			codeHorizontalScrollbar.draw(api, SCROLLBAR_TRACK_COLOR, SCROLLBAR_THUMB_COLOR);
			this.codeHorizontalScrollbarVisible = true;
		} else {
			this.codeHorizontalScrollbarVisible = false;
		}
	}

	private drawRuntimeErrorOverlay(api: BmsxConsoleApi, codeTop: number, codeRight: number, textLeft: number): void {
		const overlay = this.runtimeErrorOverlay;
		if (!overlay) {
			return;
		}
		const visibleRows = this.visibleRowCount();
		const relativeRow = overlay.row - this.scrollRow;
		if (relativeRow < 0 || relativeRow >= visibleRows) {
			return;
		}
		const entry = this.getCachedHighlight(overlay.row);
		const highlight = entry.hi;
		const slice = this.sliceHighlightedLine(highlight, this.scrollColumn, this.visibleColumnCount() + 4);
		const anchorDisplay = this.columnToDisplay(highlight, overlay.column);
		const clampedAnchorDisplay = Math.max(slice.startDisplay, Math.min(anchorDisplay, slice.endDisplay));
		const anchorX = textLeft + this.measureRangeFast(entry, slice.startDisplay, clampedAnchorDisplay);
		const rowTop = codeTop + relativeRow * this.lineHeight;
		const lines = overlay.lines.length > 0 ? overlay.lines : ['Runtime error'];
		let maxLineWidth = 0;
		for (let i = 0; i < lines.length; i++) {
			const width = this.measureText(lines[i]);
			if (width > maxLineWidth) {
				maxLineWidth = width;
			}
		}
		const bubbleWidth = maxLineWidth + ERROR_OVERLAY_PADDING_X * 2;
		const bubbleHeight = lines.length * this.lineHeight + ERROR_OVERLAY_PADDING_Y * 2;
		let bubbleLeft = anchorX + ERROR_OVERLAY_CONNECTOR_OFFSET;
		if (bubbleLeft + bubbleWidth > codeRight - 1) {
			bubbleLeft = Math.max(textLeft, codeRight - 1 - bubbleWidth);
		}
		const availableBottom = this.viewportHeight - this.bottomMargin;
		const belowTop = rowTop + this.lineHeight + 2;
		let bubbleTop = belowTop;
		if (bubbleTop + bubbleHeight > availableBottom) {
			let aboveTop = rowTop - bubbleHeight - 2;
			if (aboveTop < codeTop) {
				aboveTop = Math.max(codeTop, availableBottom - bubbleHeight);
			}
			bubbleTop = aboveTop;
		}
		if (bubbleTop + bubbleHeight > availableBottom) {
			bubbleTop = Math.max(codeTop, availableBottom - bubbleHeight);
		}
		if (bubbleTop < codeTop) {
			bubbleTop = codeTop;
		}
		const placedBelow = bubbleTop >= belowTop - 1;
		const bubbleRight = bubbleLeft + bubbleWidth;
		const bubbleBottom = bubbleTop + bubbleHeight;
		api.rectfillColor(bubbleLeft, bubbleTop, bubbleRight, bubbleBottom, ERROR_OVERLAY_BACKGROUND);
		for (let i = 0; i < lines.length; i++) {
			const lineY = bubbleTop + ERROR_OVERLAY_PADDING_Y + i * this.lineHeight;
			this.drawText(api, lines[i], bubbleLeft + ERROR_OVERLAY_PADDING_X, lineY, COLOR_STATUS_ERROR);
		}
		const connectorLeft = Math.max(textLeft, anchorX);
		const connectorRight = Math.min(bubbleLeft, connectorLeft + 3);
		if (connectorRight > connectorLeft) {
			if (placedBelow) {
				const connectorStartY = rowTop + this.lineHeight;
				if (bubbleTop > connectorStartY) {
					api.rectfillColor(connectorLeft, connectorStartY, connectorRight, bubbleTop, ERROR_OVERLAY_BACKGROUND);
				}
			} else {
				if (bubbleBottom < rowTop) {
					api.rectfillColor(connectorLeft, bubbleBottom, connectorRight, rowTop, ERROR_OVERLAY_BACKGROUND);
				}
			}
		}
	}

	private isCodeTabActive(): boolean {
		return this.getActiveTabKind() === 'lua_editor';
	}

	private isResourceViewActive(): boolean {
		return this.getActiveTabKind() === 'resource_view';
	}

	private setActiveTab(tabId: string): void {
		const tab = this.tabs.find(candidate => candidate.id === tabId);
		if (!tab) {
			return;
		}
		this.closeSymbolSearch(true);
		const previousKind = this.getActiveTabKind();
		if (previousKind === 'lua_editor') {
			this.storeActiveCodeTabContext();
		}
		if (this.activeTabId === tabId) {
			if (tab.kind === 'resource_view') {
				this.enterResourceViewer(tab);
				this.runtimeErrorOverlay = null;
			} else if (tab.kind === 'lua_editor') {
				this.activateCodeEditorTab(tab.id);
			}
			return;
		}
		this.activeTabId = tabId;
		if (tab.kind === 'resource_view') {
			this.enterResourceViewer(tab);
			this.runtimeErrorOverlay = null;
			return;
		}
		if (tab.kind === 'lua_editor') {
			this.activateCodeEditorTab(tab.id);
		}
	}

	private toggleResourcePanel(): void {
		if (this.resourcePanelVisible) {
			this.hideResourcePanel();
			return;
		}
		this.showResourcePanel();
	}

	private showResourcePanel(): void {
		const desiredRatio = this.resourcePanelWidthRatio ?? this.defaultResourcePanelRatio();
		const clampedRatio = this.clampResourcePanelRatio(desiredRatio);
		const widthPx = this.computePanelPixelWidth(clampedRatio);
		if (clampedRatio <= 0 || widthPx <= 0) {
			this.showMessage('Viewport too small for resource panel.', COLOR_STATUS_WARNING, 3.0);
			return;
		}
		this.resourcePanelWidthRatio = clampedRatio;
		this.resourcePanelVisible = true;
		this.resourcePanelResizing = false;
		this.resourcePanelFocused = true;
		this.refreshResourcePanelContents();
	}

	private hideResourcePanel(): void {
		if (!this.resourcePanelVisible) {
			return;
		}
		this.resourcePanelVisible = false;
		this.resourcePanelFocused = false;
		this.resourcePanelResizing = false;
		this.resetResourcePanelState();
	}

	private activateCodeTab(): void {
		const codeTab = this.tabs.find(candidate => candidate.kind === 'lua_editor');
		if (codeTab) {
			this.setActiveTab(codeTab.id);
			return;
		}
		if (this.entryTabId) {
			let context = this.codeTabContexts.get(this.entryTabId);
			if (!context) {
				context = this.createEntryTabContext();
				if (!context) {
					return;
				}
				this.entryTabId = context.id;
				this.codeTabContexts.set(context.id, context);
			}
			let entryTab = this.tabs.find(candidate => candidate.id === context.id);
			if (!entryTab) {
				entryTab = {
					id: context.id,
					kind: 'lua_editor',
					title: context.title,
					closable: true,
					dirty: context.dirty,
					resource: undefined,
				};
				this.tabs.unshift(entryTab);
			}
			this.setActiveTab(context.id);
		}
	}

	private openLuaCodeTab(descriptor: ConsoleResourceDescriptor): void {
		const tabId: EditorTabId = `lua:${descriptor.assetId}`;
		let tab = this.tabs.find(candidate => candidate.id === tabId);
		if (!this.codeTabContexts.has(tabId)) {
			const context = this.createLuaCodeTabContext(descriptor);
			this.codeTabContexts.set(tabId, context);
		}
		const context = this.codeTabContexts.get(tabId) ?? null;
		if (!tab) {
			const dirty = context ? context.dirty : false;
			tab = {
				id: tabId,
				kind: 'lua_editor',
				title: this.computeResourceTabTitle(descriptor),
				closable: true,
				dirty,
				resource: undefined,
			};
			this.tabs.push(tab);
		} else {
			tab.title = this.computeResourceTabTitle(descriptor);
			if (context) {
				tab.dirty = context.dirty;
			}
		}
		this.setActiveTab(tabId);
	}

	private openResourceViewerTab(descriptor: ConsoleResourceDescriptor): void {
		const tabId: EditorTabId = `resource:${descriptor.assetId}`;
		let tab = this.tabs.find(candidate => candidate.id === tabId);
		const state = this.buildResourceViewerState(descriptor);
		this.resourceViewerClampScroll(state);
		if (tab) {
			tab.title = state.title;
			tab.resource = state;
			tab.dirty = false;
			this.setActiveTab(tabId);
			return;
		}
		tab = {
			id: tabId,
			kind: 'resource_view',
			title: state.title,
			closable: true,
			dirty: false,
			resource: state,
		};
		this.tabs.push(tab);
		this.setActiveTab(tabId);
	}

	private closeTab(tabId: string): void {
		const index = this.tabs.findIndex(tab => tab.id === tabId);
		if (index === -1) {
			return;
		}
		const tab = this.tabs[index];
		if (!tab.closable) {
			return;
		}
		this.tabs.splice(index, 1);
		if (tab.kind === 'lua_editor') {
			this.codeTabContexts.delete(tab.id);
			if (this.activeCodeTabContextId === tab.id) {
				this.activeCodeTabContextId = null;
			}
		}
		if (this.activeTabId === tabId) {
			const fallback = this.tabs[index - 1] ?? this.tabs[0];
			if (fallback) {
				this.setActiveTab(fallback.id);
			} else {
				this.activeTabId = null;
				this.activeCodeTabContextId = null;
				this.resetEditorContent();
			}
		}
	}

	private resetEditorContent(): void {
		this.lines = [''];
		this.cursorRow = 0;
		this.cursorColumn = 0;
		this.scrollRow = 0;
		this.scrollColumn = 0;
		this.selectionAnchor = null;
		this.lastSavedSource = '';
		this.invalidateAllHighlights();
		this.bumpTextVersion();
		this.dirty = false;
		this.updateActiveContextDirtyFlag();
		this.syncRuntimeErrorOverlayFromContext(null);
		this.updateDesiredColumn();
		this.resetBlink();
		this.ensureCursorVisible();
	}

	private resetResourcePanelState(): void {
		this.resourceBrowserItems = [];
		this.resourceBrowserScroll = 0;
		this.resourceBrowserSelectionIndex = -1;
		this.resourceBrowserHoverIndex = -1;
		this.resourceBrowserHorizontalScroll = 0;
		this.resourceBrowserMaxLineWidth = 0;
		this.pendingResourceSelectionAssetId = null;
		this.resourcePanelResizing = false;
	}

	private refreshResourcePanelContents(): void {
		this.resourceBrowserHoverIndex = -1;
		const previousDescriptor = this.getSelectedResourceDescriptor();
		const previousAssetId = previousDescriptor ? previousDescriptor.assetId : null;
		const previousIndex = this.resourceBrowserSelectionIndex;
		const previousScroll = this.resourceBrowserScroll;
		let descriptors: ConsoleResourceDescriptor[];
		try {
			descriptors = this.listResourcesFn();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showWarningBanner(`Failed to enumerate resources: ${message}`);
			this.resourceBrowserItems = [{
				line: `<failed to load resources: ${message}>`,
				contentStartColumn: 0,
				descriptor: null,
			}];
			this.resourceBrowserScroll = 0;
			this.resourceBrowserSelectionIndex = 0;
			this.pendingResourceSelectionAssetId = null;
			return;
		}
		const augmented = descriptors.slice();
		const rompack = $.rompack;
		if (rompack && rompack.img) {
			const atlasKeys = Object.keys(rompack.img).filter(key => key === '_atlas' || key.startsWith('atlas'));
			for (const key of atlasKeys) {
				if (augmented.some(entry => entry.assetId === key)) {
					continue;
				}
				augmented.push({ path: `atlas/${key}`, type: 'atlas', assetId: key });
			}
		}
		this.resourceBrowserItems = this.buildResourceBrowserItems(augmented);
		this.updateResourceBrowserMetrics();
		const targetAssetId = this.pendingResourceSelectionAssetId ?? previousAssetId;
		let selectionIndex = -1;
		if (targetAssetId) {
			const resolved = this.findResourcePanelIndexByAssetId(targetAssetId);
			if (resolved !== -1) {
				selectionIndex = resolved;
				if (this.pendingResourceSelectionAssetId === targetAssetId) {
					this.pendingResourceSelectionAssetId = null;
				}
			}
		}
		if (selectionIndex === -1 && previousIndex >= 0 && previousIndex < this.resourceBrowserItems.length) {
			selectionIndex = previousIndex;
		}
		if (selectionIndex === -1 && this.resourceBrowserItems.length > 0) {
			selectionIndex = 0;
		}
		this.resourceBrowserSelectionIndex = selectionIndex;
		this.updateResourceBrowserMetrics();
		if (selectionIndex < 0) {
			this.resourceBrowserScroll = 0;
			this.resourceBrowserHorizontalScroll = 0;
			return;
		}
		const capacity = this.resourcePanelLineCapacity();
		if (capacity <= 0) {
			this.resourceBrowserScroll = 0;
			this.clampResourceBrowserHorizontalScroll();
			return;
		}
		const maxScroll = Math.max(0, this.resourceBrowserItems.length - capacity);
		this.resourceBrowserScroll = clamp(previousScroll, 0, maxScroll);
		this.resourceBrowserEnsureSelectionVisible();
		this.applyPendingResourceSelection();
	}

	private enterResourceViewer(tab: EditorTabDescriptor): void {
		this.closeSearch(false);
		this.closeLineJump(false);
		this.cursorRevealSuspended = false;
		tab.dirty = false;
		this.resourceBrowserHoverIndex = -1;
		if (!tab.resource) {
			return;
		}
		this.resourceViewerClampScroll(tab.resource);
	}

	private buildResourceBrowserItems(entries: ConsoleResourceDescriptor[]): ResourceBrowserItem[] {
		const items: ResourceBrowserItem[] = [];
		if (!entries || entries.length === 0) {
			items.push({
				line: '<no resources>',
				contentStartColumn: 0,
				descriptor: null,
			});
			return items;
		}
		type ResourceTreeDirectory = {
			name: string;
			children: Map<string, ResourceTreeDirectory>;
			files: ResourceTreeFile[];
		};
		type ResourceTreeFile = {
			name: string;
			descriptor: ConsoleResourceDescriptor;
		};
		const root: ResourceTreeDirectory = { name: '.', children: new Map(), files: [] };
		for (const entry of entries) {
			const normalized = entry.path.replace(/\\\\/g, '/');
			const parts = normalized.split('/').filter(part => part.length > 0 && part !== '.');
			if (parts.length === 0) {
				root.files.push({ name: entry.path || entry.assetId, descriptor: entry });
				continue;
			}
			let current = root;
			for (let index = 0; index < parts.length; index++) {
				const part = parts[index];
				const isLeaf = index === parts.length - 1;
				if (isLeaf) {
					current.files.push({ name: part, descriptor: entry });
				} else {
					let child = current.children.get(part);
					if (!child) {
						child = { name: part, children: new Map(), files: [] };
						current.children.set(part, child);
					}
					current = child;
				}
			}
		}
		items.push({ line: './', contentStartColumn: 0, descriptor: null });
		const traverse = (directory: ResourceTreeDirectory, prefix: string) => {
			const childDirs = Array.from(directory.children.values()).sort((a, b) => a.name.localeCompare(b.name));
			const files = directory.files.slice().sort((a, b) => a.name.localeCompare(b.name));
			const combined: Array<{ kind: 'dir'; node: ResourceTreeDirectory } | { kind: 'file'; node: ResourceTreeFile }> = [];
			for (const dir of childDirs) {
				combined.push({ kind: 'dir', node: dir });
			}
			for (const file of files) {
				combined.push({ kind: 'file', node: file });
			}
			for (let index = 0; index < combined.length; index++) {
				const entry = combined[index];
				const isLast = index === combined.length - 1;
				const connector = prefix.length === 0 ? (isLast ? '`-- ' : '|-- ') : (isLast ? '`-- ' : '|-- ');
				const linePrefix = prefix + connector;
				const nextPrefix = prefix + (isLast ? '    ' : '|   ');
				if (entry.kind === 'dir') {
					const line = `${linePrefix}${entry.node.name}/`;
					items.push({
						line,
						contentStartColumn: linePrefix.length,
						descriptor: null,
					});
					traverse(entry.node, nextPrefix);
				} else {
					const descriptor = entry.node.descriptor;
					const line = `${linePrefix}${entry.node.name}`;
					items.push({
						line,
						contentStartColumn: linePrefix.length,
						descriptor,
					});
				}
			}
		};
		traverse(root, '');
		return items;
	}

	private updateResourceBrowserMetrics(): void {
		let maxWidth = 0;
		for (const item of this.resourceBrowserItems) {
			const indent = item.line.slice(0, item.contentStartColumn);
			const content = item.line.slice(item.contentStartColumn);
			const width = this.measureText(indent) + this.measureText(content);
			if (width > maxWidth) {
				maxWidth = width;
			}
		}
		this.resourceBrowserMaxLineWidth = maxWidth;
		this.clampResourceBrowserHorizontalScroll();
	}

	private selectResourceInPanel(descriptor: ConsoleResourceDescriptor): void {
		if (!descriptor.assetId || descriptor.assetId.length === 0) {
			return;
		}
		this.pendingResourceSelectionAssetId = descriptor.assetId;
		if (!this.resourcePanelVisible) {
			return;
		}
		this.applyPendingResourceSelection();
	}

	private applyPendingResourceSelection(): void {
		if (!this.resourcePanelVisible) {
			return;
		}
		const assetId = this.pendingResourceSelectionAssetId;
		if (!assetId) {
			return;
		}
		const index = this.findResourcePanelIndexByAssetId(assetId);
		if (index === -1) {
			return;
		}
		this.resourceBrowserSelectionIndex = index;
		this.resourceBrowserEnsureSelectionVisible();
		this.pendingResourceSelectionAssetId = null;
	}

	private findResourcePanelIndexByAssetId(assetId: string): number {
		for (let i = 0; i < this.resourceBrowserItems.length; i++) {
			const descriptor = this.resourceBrowserItems[i].descriptor;
			if (descriptor && descriptor.assetId === assetId) {
				return i;
			}
		}
		return -1;
	}

	private getSelectedResourceDescriptor(): ConsoleResourceDescriptor | null {
		if (this.resourceBrowserSelectionIndex < 0 || this.resourceBrowserSelectionIndex >= this.resourceBrowserItems.length) {
			return null;
		}
		const item = this.resourceBrowserItems[this.resourceBrowserSelectionIndex];
		return item.descriptor ?? null;
	}

	private computeResourceBrowserMaxHorizontalScroll(): number {
		const bounds = this.getResourcePanelBounds();
		if (!bounds) {
			return 0;
		}
		const contentLeft = bounds.left + RESOURCE_PANEL_PADDING_X;
		const capacity = this.resourcePanelLineCapacity();
		const needsScrollbar = this.resourceBrowserItems.length > capacity;
		const availableRight = needsScrollbar ? bounds.right - 1 - SCROLLBAR_WIDTH : bounds.right - 1;
		const availableWidth = Math.max(0, availableRight - contentLeft);
		if (availableWidth <= 0) {
			return 0;
		}
		const maxScroll = this.resourceBrowserMaxLineWidth - availableWidth;
		return maxScroll > 0 ? maxScroll : 0;
	}

	private clampResourceBrowserHorizontalScroll(): void {
		const maxScroll = this.computeResourceBrowserMaxHorizontalScroll();
		const current = Number.isFinite(this.resourceBrowserHorizontalScroll) ? this.resourceBrowserHorizontalScroll : 0;
		this.resourceBrowserHorizontalScroll = clamp(current, 0, maxScroll);
	}

	private createEntryTabContext(): CodeTabContext | null {
		const assetId = (typeof this.primaryAssetId === 'string' && this.primaryAssetId.length > 0)
			? this.primaryAssetId
			: null;
		const descriptor = assetId ? this.findResourceDescriptorByAssetId(assetId) : null;
		const resolvedAssetId = descriptor ? descriptor.assetId : (assetId ?? '__entry__');
		const tabId: string = `lua:${resolvedAssetId}`;
		const title = descriptor
			? this.computeResourceTabTitle(descriptor)
			: (assetId ?? this.metadata.title ?? 'ENTRY').toUpperCase();
		const load = descriptor
			? () => this.loadLuaResourceFn(descriptor.assetId)
			: () => this.loadSourceFn();
		const save = descriptor
			? (source: string) => this.saveLuaResourceFn(descriptor.assetId, source)
			: (source: string) => this.saveSourceFn(source);
		return {
			id: tabId,
			title,
			descriptor: descriptor ?? null,
			load,
			save,
			snapshot: null,
			lastSavedSource: '',
			saveGeneration: 0,
			appliedGeneration: 0,
			dirty: false,
			runtimeErrorOverlay: null,
		};
	}

	private createLuaCodeTabContext(descriptor: ConsoleResourceDescriptor): CodeTabContext {
		const title = this.computeResourceTabTitle(descriptor);
		return {
			id: `lua:${descriptor.assetId}`,
			title,
			descriptor,
			load: () => this.loadLuaResourceFn(descriptor.assetId),
			save: (source: string) => this.saveLuaResourceFn(descriptor.assetId, source),
			snapshot: null,
			lastSavedSource: '',
			saveGeneration: 0,
			appliedGeneration: 0,
			dirty: false,
			runtimeErrorOverlay: null,
		};
	}

	private getActiveCodeTabContext(): CodeTabContext | null {
		if (!this.activeCodeTabContextId) {
			return null;
		}
		return this.codeTabContexts.get(this.activeCodeTabContextId) ?? null;
	}

	private storeActiveCodeTabContext(): void {
		const context = this.getActiveCodeTabContext();
		if (!context) {
			return;
		}
		context.snapshot = this.captureSnapshot();
		if (this.entryTabId && context.id === this.entryTabId) {
			context.lastSavedSource = this.lastSavedSource;
		}
		context.saveGeneration = this.saveGeneration;
		context.appliedGeneration = this.appliedGeneration;
		context.dirty = this.dirty;
		context.runtimeErrorOverlay = this.runtimeErrorOverlay;
		this.setTabDirty(context.id, context.dirty);
	}

	private activateCodeEditorTab(tabId: string | null): void {
		if (!tabId) {
			return;
		}
		let context = this.codeTabContexts.get(tabId);
		if (!context) {
			if (this.entryTabId && tabId === this.entryTabId) {
				const recreated = this.createEntryTabContext();
				if (!recreated || recreated.id !== tabId) {
					return;
				}
				context = recreated;
				this.entryTabId = context.id;
				this.codeTabContexts.set(tabId, context);
			} else {
				return;
			}
		}
		this.activeCodeTabContextId = tabId;
		const isEntry = this.entryTabId !== null && context.id === this.entryTabId;
		if (context.snapshot) {
			this.restoreSnapshot(context.snapshot);
			this.saveGeneration = context.saveGeneration;
			this.appliedGeneration = context.appliedGeneration;
			if (isEntry) {
				this.lastSavedSource = context.lastSavedSource;
			}
			context.dirty = this.dirty;
			this.setTabDirty(context.id, context.dirty);
			this.syncRuntimeErrorOverlayFromContext(context);
			this.invalidateAllHighlights();
			this.updateDesiredColumn();
			this.ensureCursorVisible();
			return;
		}
		const source = context.load();
		context.lastSavedSource = source;
		this.lines = this.splitLines(source);
		if (this.lines.length === 0) {
			this.lines.push('');
		}
		this.invalidateAllHighlights();
		this.cursorRow = 0;
		this.cursorColumn = 0;
		this.scrollRow = 0;
		this.scrollColumn = 0;
		this.selectionAnchor = null;
		this.dirty = false;
		context.dirty = false;
		context.runtimeErrorOverlay = null;
		this.saveGeneration = context.saveGeneration;
		this.appliedGeneration = context.appliedGeneration;
		if (isEntry) {
			this.lastSavedSource = context.lastSavedSource;
		}
		this.setTabDirty(context.id, context.dirty);
		this.syncRuntimeErrorOverlayFromContext(context);
		this.updateDesiredColumn();
		this.resetBlink();
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
	}

	private getMainProgramSourceForReload(): string {
		const entryId = this.entryTabId;
		if (!entryId) {
			return this.loadSourceFn();
		}
		const context = this.codeTabContexts.get(entryId);
		if (!context) {
			return this.loadSourceFn();
		}
		if (context.id === this.activeCodeTabContextId) {
			return this.lines.join('\n');
		}
		if (context.snapshot) {
			return context.snapshot.lines.join('\n');
		}
		if (context.lastSavedSource.length > 0) {
			return context.lastSavedSource;
		}
		return context.load();
	}

	private buildResourceViewerState(descriptor: ConsoleResourceDescriptor): ResourceViewerState {
		const title = this.computeResourceTabTitle(descriptor);
		const lines: string[] = [
			`Path: ${descriptor.path || '<unknown>'}`,
			`Type: ${descriptor.type}`,
			`Asset ID: ${descriptor.assetId}`,
		];
		const state: ResourceViewerState = {
			descriptor,
			lines,
			error: null,
			title,
			scroll: 0,
		};
		let error: string | null = null;
		const rompack = $.rompack;
		if (!rompack) {
			error = 'Rompack unavailable.';
		} else {
			lines.push('');
			switch (descriptor.type) {
				case 'lua': {
					const source = rompack.lua?.[descriptor.assetId];
					if (typeof source === 'string') {
						this.appendResourceViewerLines(lines, ['-- Lua Source --', '']);
						this.appendResourceViewerLines(lines, source.split(/\r?\n/));
					} else {
						error = `Lua source '${descriptor.assetId}' unavailable.`;
					}
					break;
				}
				case 'code': {
					const dataEntry = rompack.data?.[descriptor.assetId];
					if (typeof dataEntry === 'string') {
						this.appendResourceViewerLines(lines, ['-- Code --', '']);
						this.appendResourceViewerLines(lines, dataEntry.split(/\r?\n/));
					} else if (dataEntry !== undefined) {
						const json = this.safeJsonStringify(dataEntry);
						this.appendResourceViewerLines(lines, ['-- Code --', '']);
						this.appendResourceViewerLines(lines, json.split(/\r?\n/));
					} else if (typeof rompack.code === 'string') {
						this.appendResourceViewerLines(lines, ['-- Game Code --', '']);
						this.appendResourceViewerLines(lines, rompack.code.split(/\r?\n/));
					} else {
						error = `Code asset '${descriptor.assetId}' unavailable.`;
					}
					break;
				}
				case 'data':
				case 'rommanifest': {
					const data = rompack.data?.[descriptor.assetId];
					if (data !== undefined) {
						const json = this.safeJsonStringify(data);
						this.appendResourceViewerLines(lines, ['-- Data --', '']);
						this.appendResourceViewerLines(lines, json.split(/\r?\n/));
					} else {
						error = `Data asset '${descriptor.assetId}' not found.`;
					}
					break;
				}
				case 'image':
				case 'atlas':
				case 'romlabel': {
					const image = rompack.img?.[descriptor.assetId];
					if (!image) {
						error = `Image asset '${descriptor.assetId}' not found.`;
						break;
					}
					const meta = image.imgmeta ?? {};
					const width = (meta as { width?: number }).width;
					const height = (meta as { height?: number }).height;
					const atlasId = (meta as { atlasid?: number }).atlasid;
					const atlassed = (meta as { atlassed?: boolean }).atlassed;
					if (Number.isFinite(width) && Number.isFinite(height)) {
						state.image = {
							assetId: descriptor.assetId,
							width: Math.max(1, Math.floor(width as number)),
							height: Math.max(1, Math.floor(height as number)),
							atlassed: Boolean(atlassed),
							atlasId: atlasId,
						};
					}
					this.appendResourceViewerLines(lines, ['-- Image Metadata --']);
					if (Number.isFinite(width) && Number.isFinite(height)) {
						this.appendResourceViewerLines(lines, [`Dimensions: ${width}x${height}`]);
					}
					if (typeof atlassed === 'boolean') {
						this.appendResourceViewerLines(lines, [`Atlassed: ${atlassed ? 'yes' : 'no'}`]);
					}
					if (atlasId !== undefined) {
						this.appendResourceViewerLines(lines, [`Atlas ID: ${atlasId}`]);
					}
					for (const [key, value] of Object.entries(meta)) {
						if (['width', 'height', 'atlassed', 'atlasid'].includes(key)) {
							continue;
						}
						this.appendResourceViewerLines(lines, [`${key}: ${this.describeMetadataValue(value)}`]);
					}
					break;
				}
				case 'audio': {
					const audio = rompack.audio?.[descriptor.assetId];
					if (!audio) {
						error = `Audio asset '${descriptor.assetId}' not found.`;
						break;
					}
					const meta = audio.audiometa ?? {};
					this.appendResourceViewerLines(lines, ['-- Audio Metadata --']);
					const bufferSize = (audio.buffer as { byteLength?: number } | undefined)?.byteLength;
					if (typeof bufferSize === 'number') {
						this.appendResourceViewerLines(lines, [`Buffer Size: ${bufferSize} bytes`]);
					}
					for (const [key, value] of Object.entries(meta)) {
						this.appendResourceViewerLines(lines, [`${key}: ${this.describeMetadataValue(value)}`]);
					}
					break;
				}
				case 'model': {
					const model = rompack.model?.[descriptor.assetId];
					if (!model) {
						error = `Model asset '${descriptor.assetId}' not found.`;
						break;
					}
					const keys = Object.keys(model);
					this.appendResourceViewerLines(lines, ['-- Model Metadata --', `Keys: ${keys.join(', ')}`]);
					break;
				}
				case 'fsm': {
					const fsm = rompack.fsm?.[descriptor.assetId];
					if (fsm) {
						const json = this.safeJsonStringify(fsm);
						this.appendResourceViewerLines(lines, ['-- FSM --', '']);
						this.appendResourceViewerLines(lines, json.split(/\r?\n/));
						break;
					}
					const source = rompack.lua?.[descriptor.assetId];
					if (typeof source === 'string') {
						this.appendResourceViewerLines(lines, ['-- FSM Source --', '']);
						this.appendResourceViewerLines(lines, source.split(/\r?\n/));
						break;
					}
					error = `FSM '${descriptor.assetId}' not found.`;
					break;
				}
				case 'aem': {
					const events = rompack.audioevents?.[descriptor.assetId];
					if (!events) {
						error = `Audio event map '${descriptor.assetId}' not found.`;
						break;
					}
					const json = this.safeJsonStringify(events);
					this.appendResourceViewerLines(lines, ['-- Audio Events --', '']);
					this.appendResourceViewerLines(lines, json.split(/\r?\n/));
					break;
				}
				default: {
					this.appendResourceViewerLines(lines, ['<no preview available for this asset type>']);
					break;
				}
			}
		}
		if (error) {
			lines.push('');
			lines.push(`Error: ${error}`);
		}
		if (lines.length === 0) {
			lines.push('<empty>');
		}
		this.trimResourceViewerLines(lines);
		state.error = error;
		return state;
	}

	private computeResourceTabTitle(descriptor: ConsoleResourceDescriptor): string {
		const normalized = descriptor.path.replace(/\\/g, '/');
		const parts = normalized.split('/').filter(part => part.length > 0);
		if (parts.length > 0) {
			return parts[parts.length - 1];
		}
		if (descriptor.assetId && descriptor.assetId.length > 0) {
			return descriptor.assetId;
		}
		return descriptor.type.toUpperCase();
	}

	private appendResourceViewerLines(target: string[], additions: Iterable<string>): void {
		for (const entry of additions) {
			if (target.length >= RESOURCE_VIEWER_MAX_LINES - 1) {
				if (target.length === RESOURCE_VIEWER_MAX_LINES - 1) {
					target.push('<content truncated>');
				}
				return;
			}
			target.push(entry);
		}
	}

	private trimResourceViewerLines(lines: string[]): void {
		if (lines.length > RESOURCE_VIEWER_MAX_LINES) {
			lines.length = RESOURCE_VIEWER_MAX_LINES - 1;
			lines.push('<content truncated>');
		}
	}

	private safeJsonStringify(value: unknown, space = 2): string {
		return JSON.stringify(value, (_key, val) => {
			if (typeof val === 'bigint') {
				return Number(val);
			}
			return val;
		}, space);
	}

	private describeMetadataValue(value: unknown): string {
		if (value === null || value === undefined) {
			return '<none>';
		}
		if (typeof value === 'string') {
			return value;
		}
		if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value);
		}
		if (Array.isArray(value)) {
			const preview = value.slice(0, 4).map(entry => this.describeMetadataValue(entry)).join(', ');
			return `[${preview}${value.length > 4 ? ', …' : ''}]`;
		}
		if (typeof value === 'object') {
			const keys = Object.keys(value as Record<string, unknown>);
			return `{${keys.join(', ')}}`;
		}
		return String(value);
	}

	private getViewportMetrics(): ViewportMetrics {
		const platform = $.platform;
		if (!platform) {
			throw new Error('[ConsoleCartEditor] Platform services unavailable while resolving viewport metrics.');
		}
		const host = platform.gameviewHost;
		if (!host || typeof host.getCapability !== 'function') {
			throw new Error('[ConsoleCartEditor] Game view host unavailable while resolving viewport metrics.');
		}
		const provider = host.getCapability('viewport-metrics');
		if (!provider) {
			throw new Error('[ConsoleCartEditor] Viewport metrics capability unavailable on the current platform.');
		}
		const metrics = provider.getViewportMetrics();
		if (!metrics) {
			throw new Error('[ConsoleCartEditor] Viewport metrics provider returned no data.');
		}
		const { windowInner, screen } = metrics;
		if (!windowInner || !Number.isFinite(windowInner.width) || windowInner.width <= 0) {
			throw new Error('[ConsoleCartEditor] Viewport metrics reported an invalid inner window width.');
		}
		if (!screen || !Number.isFinite(screen.width) || screen.width <= 0) {
			throw new Error('[ConsoleCartEditor] Viewport metrics reported an invalid screen width.');
		}
		return metrics;
	}

	private computePanelRatioBounds(): { min: number; max: number } {
		const minRatio = RESOURCE_PANEL_MIN_RATIO;
		const minEditorRatio = RESOURCE_PANEL_MIN_EDITOR_RATIO;
		const availableForPanel = Math.max(0, 1 - minEditorRatio);
		const maxRatio = Math.max(minRatio, Math.min(RESOURCE_PANEL_MAX_RATIO, availableForPanel));
		return { min: minRatio, max: maxRatio };
	}

	private clampResourcePanelRatio(ratio: number | null): number {
		const bounds = this.computePanelRatioBounds();
		let resolved = ratio ?? this.defaultResourcePanelRatio();
		if (!Number.isFinite(resolved)) {
			resolved = RESOURCE_PANEL_DEFAULT_RATIO;
		}
		if (resolved < bounds.min) {
			resolved = bounds.min;
		}
		if (resolved > bounds.max) {
			resolved = bounds.max;
		}
		return resolved;
	}

	private defaultResourcePanelRatio(): number {
		const metrics = this.getViewportMetrics();
		const viewportWidth = metrics.windowInner.width;
		const screenWidth = metrics.screen.width;
		const relative = Math.min(1, viewportWidth / screenWidth);
		const responsiveness = 1 - relative;
		const ratio = RESOURCE_PANEL_DEFAULT_RATIO + responsiveness * (RESOURCE_PANEL_MAX_RATIO - RESOURCE_PANEL_DEFAULT_RATIO) * 0.6;
		const bounds = this.computePanelRatioBounds();
		return Math.max(bounds.min, Math.min(bounds.max, ratio));
	}

	private computePanelPixelWidth(ratio: number): number {
		if (!Number.isFinite(ratio) || ratio <= 0 || this.viewportWidth <= 0) {
			return 0;
		}
		return Math.floor(this.viewportWidth * ratio);
	}

	private getResourcePanelWidth(): number {
		if (!this.resourcePanelVisible) {
			return 0;
		}
		const ratio = this.clampResourcePanelRatio(this.resourcePanelWidthRatio ?? this.defaultResourcePanelRatio());
		const width = this.computePanelPixelWidth(ratio);
		if (width <= 0) {
			return 0;
		}
		this.resourcePanelWidthRatio = ratio;
		return width;
	}

	private getResourcePanelBounds(): RectBounds | null {
		if (!this.resourcePanelVisible) {
			return null;
		}
		const width = this.getResourcePanelWidth();
		if (width <= 0) {
			return null;
		}
		const top = this.codeViewportTop();
		const bottom = this.viewportHeight - this.bottomMargin;
		if (bottom <= top) {
			return null;
		}
		return { left: 0, top, right: width, bottom };
	}

	private isPointerOverResourcePanelDivider(x: number, y: number): boolean {
		if (!this.resourcePanelVisible) {
			return false;
		}
		const bounds = this.getResourcePanelBounds();
		if (!bounds) {
			return false;
		}
		const margin = RESOURCE_PANEL_DIVIDER_DRAG_MARGIN;
		const left = bounds.right - margin;
		const right = bounds.right + margin;
		return y >= bounds.top && y <= bounds.bottom && x >= left && x <= right;
	}

	private resourcePanelLineCapacity(): number {
		const bounds = this.getResourcePanelBounds();
		const overlayTop = bounds ? bounds.top : this.codeViewportTop();
		const overlayBottom = bounds ? bounds.bottom : (this.viewportHeight - this.bottomMargin);
		let contentHeight = Math.max(0, overlayBottom - overlayTop);
		let initialCapacity = Math.max(1, Math.floor(contentHeight / this.lineHeight));
		if (bounds) {
			const needsVerticalScrollbar = this.resourceBrowserItems.length > initialCapacity;
			const contentLeft = bounds.left + RESOURCE_PANEL_PADDING_X;
			const dividerLeft = bounds.right - 1;
			const availableRight = needsVerticalScrollbar ? dividerLeft - SCROLLBAR_WIDTH : dividerLeft;
			const availableWidth = Math.max(0, availableRight - contentLeft);
			const needsHorizontalScrollbar = this.resourceBrowserMaxLineWidth > availableWidth;
			if (needsHorizontalScrollbar) {
				contentHeight = Math.max(0, contentHeight - SCROLLBAR_WIDTH);
				initialCapacity = Math.max(1, Math.floor(contentHeight / this.lineHeight));
			}
		}
		return initialCapacity;
	}

	private scrollResourceBrowser(amount: number): void {
		if (!this.resourcePanelVisible) {
			return;
		}
		const capacity = this.resourcePanelLineCapacity();
		if (capacity <= 0) {
			this.resourceBrowserScroll = 0;
			return;
		}
		const itemCount = this.resourceBrowserItems.length;
		const maxScroll = Math.max(0, itemCount - capacity);
		const next = clamp(this.resourceBrowserScroll + amount, 0, maxScroll);
		if (next === this.resourceBrowserScroll) {
			return;
		}
		this.resourceBrowserScroll = next;
		this.resourceBrowserEnsureSelectionVisible();
		this.clampResourceBrowserHorizontalScroll();
	}

	private scrollResourceBrowserHorizontal(amount: number): void {
		if (!this.resourcePanelVisible) {
			return;
		}
		if (!Number.isFinite(amount) || amount === 0) {
			return;
		}
		const maxScroll = this.computeResourceBrowserMaxHorizontalScroll();
		if (maxScroll <= 0) {
			this.resourceBrowserHorizontalScroll = 0;
			return;
		}
		const next = clamp(this.resourceBrowserHorizontalScroll + amount, 0, maxScroll);
		if (next === this.resourceBrowserHorizontalScroll) {
			return;
		}
		this.resourceBrowserHorizontalScroll = next;
		this.clampResourceBrowserHorizontalScroll();
	}

	private resourceBrowserEnsureSelectionVisible(): void {
		if (!this.resourcePanelVisible) {
			return;
		}
		const index = this.resourceBrowserSelectionIndex;
		if (index < 0) {
			return;
		}
		const capacity = this.resourcePanelLineCapacity();
		if (capacity <= 0) {
			this.resourceBrowserScroll = 0;
			this.clampResourceBrowserHorizontalScroll();
			return;
		}
		const maxScroll = Math.max(0, this.resourceBrowserItems.length - capacity);
		if (index < this.resourceBrowserScroll) {
			this.resourceBrowserScroll = index;
			this.ensureResourceBrowserSelectionHorizontal(index);
			return;
		}
		const overflow = index - (this.resourceBrowserScroll + capacity - 1);
		if (overflow > 0) {
			this.resourceBrowserScroll = Math.min(this.resourceBrowserScroll + overflow, maxScroll);
		}
		this.ensureResourceBrowserSelectionHorizontal(index);
	}

	private ensureResourceBrowserSelectionHorizontal(index: number): void {
		const bounds = this.getResourcePanelBounds();
		if (!bounds) {
			this.resourceBrowserHorizontalScroll = 0;
			return;
		}
		const item = this.resourceBrowserItems[index];
		if (!item) {
			return;
		}
		const capacity = this.resourcePanelLineCapacity();
		const needsScrollbar = this.resourceBrowserItems.length > capacity;
		const contentLeft = bounds.left + RESOURCE_PANEL_PADDING_X;
		const dividerLeft = bounds.right - 1;
		const availableRight = Math.max(contentLeft, needsScrollbar ? dividerLeft - SCROLLBAR_WIDTH : dividerLeft);
		const availableWidth = Math.max(0, availableRight - contentLeft);
		if (availableWidth <= 0) {
			this.resourceBrowserHorizontalScroll = 0;
			return;
		}
		const indentText = item.line.slice(0, item.contentStartColumn);
		const contentText = item.line.slice(item.contentStartColumn);
		const indentWidth = this.measureText(indentText);
		const contentWidth = this.measureText(contentText);
		const textStart = 0;
		const textEnd = indentWidth + contentWidth;
		let nextScroll = this.resourceBrowserHorizontalScroll;
		const margin = this.charAdvance * 2;
		if (textStart - nextScroll < 0) {
			nextScroll = Math.max(0, textStart - margin);
		}
		if (textEnd - nextScroll > availableWidth) {
			nextScroll = textEnd - availableWidth + margin;
		}
		if (nextScroll < 0 || !Number.isFinite(nextScroll)) {
			nextScroll = 0;
		}
		const maxScroll = this.computeResourceBrowserMaxHorizontalScroll();
		if (nextScroll > maxScroll) {
			nextScroll = maxScroll;
		}
		this.resourceBrowserHorizontalScroll = nextScroll;
	}

	private resourceViewerImageLayout(viewer: ResourceViewerState): { left: number; top: number; width: number; height: number; bottom: number; scale: number } | null {
		const info = viewer.image;
		if (!info) {
			return null;
		}
		const width = Math.max(1, info.width);
		const height = Math.max(1, info.height);
		const bounds = this.getCodeAreaBounds();
		const totalHeight = Math.max(0, bounds.codeBottom - bounds.codeTop);
		if (totalHeight <= 0) {
			return null;
		}
		const paddingX = RESOURCE_PANEL_PADDING_X;
		const contentTop = bounds.codeTop + 2;
		const availableWidth = Math.max(1, bounds.codeRight - bounds.codeLeft - paddingX * 2);
		const estimatedTextLines = Math.max(3, Math.min(8, viewer.lines.length + (viewer.error ? 1 : 0)));
		const reservedTextHeight = Math.min(totalHeight * 0.45, this.lineHeight * estimatedTextLines);
		const maxImageHeight = Math.max(this.lineHeight * 2, totalHeight - reservedTextHeight);
		let scale = Math.min(availableWidth / width, maxImageHeight / height);
		if (!Number.isFinite(scale) || scale <= 0) {
			scale = Math.min(availableWidth / width, totalHeight / height);
			if (!Number.isFinite(scale) || scale <= 0) {
				return null;
			}
		}
		const drawWidth = width * scale;
		const drawHeight = height * scale;
		const leftMargin = bounds.codeLeft + paddingX;
		const centeredOffset = Math.max(0, Math.floor((availableWidth - drawWidth) * 0.5));
		const left = leftMargin + centeredOffset;
		const top = contentTop;
		const bottom = top + drawHeight;
		return { left, top, width: drawWidth, height: drawHeight, bottom, scale };
	}

	private resourceViewerTextCapacity(viewer: ResourceViewerState): number {
		const bounds = this.getCodeAreaBounds();
		const contentTop = bounds.codeTop + 2;
		const layout = this.resourceViewerImageLayout(viewer);
		let textTop = contentTop;
		if (layout) {
			textTop = Math.floor(layout.bottom + this.lineHeight);
		}
		if (textTop >= bounds.codeBottom) {
			return 0;
		}
		const availableHeight = Math.max(0, bounds.codeBottom - textTop);
		return Math.max(0, Math.floor(availableHeight / this.lineHeight));
	}

	private resourceViewerClampScroll(viewer: ResourceViewerState): void {
		const capacity = this.resourceViewerTextCapacity(viewer);
		if (capacity <= 0) {
			viewer.scroll = 0;
			return;
		}
		const maxScroll = Math.max(0, viewer.lines.length - capacity);
		if (!Number.isFinite(viewer.scroll) || viewer.scroll < 0) {
			viewer.scroll = 0;
			return;
		}
		if (viewer.scroll > maxScroll) {
			viewer.scroll = maxScroll;
		}
	}

	private resourceBrowserMoveSelection(delta: number): void {
		if (!this.resourcePanelVisible) {
			return;
		}
		const count = this.resourceBrowserItems.length;
		if (count === 0) {
			this.resourceBrowserSelectionIndex = -1;
			return;
		}
		let next: number;
		if (delta === Number.NEGATIVE_INFINITY) {
			next = 0;
		} else if (delta === Number.POSITIVE_INFINITY) {
			next = count - 1;
		} else {
			const current = this.resourceBrowserSelectionIndex >= 0 ? this.resourceBrowserSelectionIndex : 0;
			const step = Math.trunc(delta);
			next = current + step;
		}
		next = clamp(next, 0, count - 1);
		if (next === this.resourceBrowserSelectionIndex) {
			return;
		}
		this.resourceBrowserSelectionIndex = next;
		this.resourceBrowserHoverIndex = -1;
		this.resourceBrowserEnsureSelectionVisible();
	}

	private scrollResourceViewer(amount: number): void {
		const viewer = this.getActiveResourceViewer();
		if (!viewer) {
			return;
		}
		const capacity = this.resourceViewerTextCapacity(viewer);
		if (capacity <= 0) {
			viewer.scroll = 0;
			return;
		}
		const maxScroll = Math.max(0, viewer.lines.length - capacity);
		viewer.scroll = clamp(viewer.scroll + amount, 0, maxScroll);
		this.resourceViewerClampScroll(viewer);
	}

	private resourceBrowserIndexAtPosition(x: number, y: number): number {
		const bounds = this.getResourcePanelBounds();
		if (!bounds) {
			return -1;
		}
		if (x < bounds.left || x >= bounds.right) {
			return -1;
		}
		const contentTop = bounds.top + 2;
		const relativeY = y - contentTop;
		if (relativeY < 0) {
			return -1;
		}
		const index = this.resourceBrowserScroll + Math.floor(relativeY / this.lineHeight);
		if (index < 0 || index >= this.resourceBrowserItems.length) {
			return -1;
		}
		return index;
	}

	private openSelectedResourceItem(): void {
		if (this.resourceBrowserSelectionIndex < 0 || this.resourceBrowserSelectionIndex >= this.resourceBrowserItems.length) {
			return;
		}
		const item = this.resourceBrowserItems[this.resourceBrowserSelectionIndex];
		if (!item.descriptor) {
			return;
		}
		this.openResourceDescriptor(item.descriptor);
	}

	private handleResourceBrowserKeyboard(keyboard: KeyboardInput, deltaSeconds: number): void {
		if (!this.resourcePanelVisible) {
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'Escape')) {
			this.consumeKey(keyboard, 'Escape');
			this.hideResourcePanel();
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'Tab')) {
			this.consumeKey(keyboard, 'Tab');
			this.resourcePanelFocused = false;
			this.activateCodeTab();
			return;
		}
		if (this.resourceBrowserItems.length === 0) {
			return;
		}
		const horizontalStep = this.charAdvance * 4;
		const horizontalMoves: Array<{ key: string; predicate: boolean; delta: number }> = [
			{ key: 'ArrowLeft', predicate: this.isKeyJustPressed(keyboard, 'ArrowLeft') || this.shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds), delta: -horizontalStep },
			{ key: 'ArrowRight', predicate: this.isKeyJustPressed(keyboard, 'ArrowRight') || this.shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds), delta: horizontalStep },
		];
		for (const entry of horizontalMoves) {
			if (entry.predicate) {
				this.consumeKey(keyboard, entry.key);
				this.scrollResourceBrowserHorizontal(entry.delta);
				this.resourceBrowserEnsureSelectionVisible();
				return;
			}
		}
		if (this.isKeyJustPressed(keyboard, 'Enter')) {
			this.consumeKey(keyboard, 'Enter');
			this.openSelectedResourceItem();
			return;
		}
		const moves: Array<{ code: string; action: () => void }> = [
			{
				code: 'ArrowUp',
				action: () => this.resourceBrowserMoveSelection(-1),
			},
			{
				code: 'ArrowDown',
				action: () => this.resourceBrowserMoveSelection(1),
			},
			{
				code: 'PageUp',
				action: () => this.resourceBrowserMoveSelection(-this.resourcePanelLineCapacity()),
			},
			{
				code: 'PageDown',
				action: () => this.resourceBrowserMoveSelection(this.resourcePanelLineCapacity()),
			},
			{
				code: 'Home',
				action: () => this.resourceBrowserMoveSelection(Number.NEGATIVE_INFINITY),
			},
			{
				code: 'End',
				action: () => this.resourceBrowserMoveSelection(Number.POSITIVE_INFINITY),
			},
		];
		for (const entry of moves) {
			const triggered = this.isKeyJustPressed(keyboard, entry.code) || this.shouldFireRepeat(keyboard, entry.code, deltaSeconds);
			if (triggered) {
				this.consumeKey(keyboard, entry.code);
				entry.action();
				return;
			}
		}
	}

	private handleResourceViewerInput(keyboard: KeyboardInput, deltaSeconds: number): void {
		const viewer = this.getActiveResourceViewer();
		if (!viewer) {
			return;
		}
		const capacity = this.resourceViewerTextCapacity(viewer);
		const page = Math.max(1, capacity);
		const moves: Array<{ code: string; delta: number }> = [
			{ code: 'ArrowUp', delta: -1 },
			{ code: 'ArrowDown', delta: 1 },
			{ code: 'PageUp', delta: -page },
			{ code: 'PageDown', delta: page },
			{ code: 'Home', delta: Number.NEGATIVE_INFINITY },
			{ code: 'End', delta: Number.POSITIVE_INFINITY },
		];
		for (const entry of moves) {
			const triggered = this.isKeyJustPressed(keyboard, entry.code) || this.shouldFireRepeat(keyboard, entry.code, deltaSeconds);
			if (!triggered) {
				continue;
			}
			this.consumeKey(keyboard, entry.code);
			if (entry.delta === Number.NEGATIVE_INFINITY) {
				viewer.scroll = 0;
			} else if (entry.delta === Number.POSITIVE_INFINITY) {
				viewer.scroll = Math.max(0, viewer.lines.length - capacity);
			} else {
				this.scrollResourceViewer(entry.delta);
			}
			this.resourceViewerClampScroll(viewer);
			return;
		}
	}

	private drawResourcePanel(api: BmsxConsoleApi): void {
		if (!this.resourcePanelVisible) {
			return;
		}
		const bounds = this.getResourcePanelBounds();
		if (!bounds) {
			return;
		}
		const contentLeft = bounds.left + RESOURCE_PANEL_PADDING_X;
		const dividerLeft = bounds.right - 1;
		const capacity = this.resourcePanelLineCapacity();
		const itemCount = this.resourceBrowserItems.length;

		const maxVerticalScroll = Math.max(0, itemCount - capacity);
		this.resourceBrowserScroll = clamp(this.resourceBrowserScroll, 0, maxVerticalScroll);
		this.clampResourceBrowserHorizontalScroll();

		const verticalTrack: RectBounds = {
			left: dividerLeft - SCROLLBAR_WIDTH,
			top: bounds.top,
			right: dividerLeft,
			bottom: bounds.bottom,
		};
		const verticalScrollbar = this.scrollbars.resourceVertical;
		verticalScrollbar.layout(verticalTrack, itemCount, capacity, this.resourceBrowserScroll);
		this.resourceBrowserScroll = Math.round(verticalScrollbar.getScroll());
		const verticalVisible = verticalScrollbar.isVisible();
		const contentRight = verticalVisible ? verticalTrack.left : bounds.right;

		const availableWidth = Math.max(0, contentRight - contentLeft);
		const horizontalTrack: RectBounds = {
			left: contentLeft,
			top: bounds.bottom - SCROLLBAR_WIDTH,
			right: contentRight,
			bottom: bounds.bottom,
		};
		const horizontalScrollbar = this.scrollbars.resourceHorizontal;
		horizontalScrollbar.layout(horizontalTrack, Math.max(this.resourceBrowserMaxLineWidth, availableWidth), availableWidth, this.resourceBrowserHorizontalScroll);
		const horizontalVisible = horizontalScrollbar.isVisible();
		const effectiveBottom = horizontalVisible ? horizontalTrack.top : bounds.bottom;

		this.resourceBrowserHorizontalScroll = horizontalScrollbar.getScroll();

		api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, COLOR_CODE_BACKGROUND);

		const contentTop = bounds.top + 2;
		const scrollStart = Math.floor(this.resourceBrowserScroll);
		const scrollEnd = Math.min(itemCount, scrollStart + capacity);
		const highlightIndex = this.resourceBrowserHoverIndex >= 0 ? this.resourceBrowserHoverIndex : this.resourceBrowserSelectionIndex;
		const panelActive = this.resourcePanelFocused;
		const scrollX = this.resourceBrowserHorizontalScroll;

		for (let itemIndex = scrollStart, drawIndex = 0; itemIndex < scrollEnd; itemIndex += 1, drawIndex += 1) {
			const item = this.resourceBrowserItems[itemIndex];
			const y = contentTop + drawIndex * this.lineHeight;
			if (y >= effectiveBottom) {
				break;
			}
			const indentText = item.line.slice(0, item.contentStartColumn);
			const contentText = item.line.slice(item.contentStartColumn);
			const indentX = contentLeft - scrollX;
			if (indentText.length > 0) {
				this.drawText(api, indentText, indentX, y, COLOR_STATUS_TEXT);
			}
			const indentWidth = this.measureText(indentText);
			const contentX = indentX + indentWidth;
			const isHighlighted = itemIndex === highlightIndex;
			if (isHighlighted) {
				const highlightWidth = this.measureText(contentText);
				const caretLeft = Math.floor(contentX);
				const caretRight = Math.max(caretLeft + 1, Math.floor(contentX + highlightWidth));
				const visibleLeft = clamp(caretLeft, contentLeft, contentRight);
				const visibleRight = clamp(caretRight, visibleLeft, contentRight);
				const caretTop = Math.floor(y);
				const caretBottom = caretTop + this.lineHeight;
				if (panelActive) {
					if (visibleRight > visibleLeft) {
						api.rectfillColor(visibleLeft, caretTop, visibleRight, caretBottom, CARET_COLOR);
					}
					const invertedColor = this.invertColorIndex(COLOR_STATUS_TEXT);
					const colors = new Array<number>(contentText.length).fill(invertedColor);
					if (contentText.length > 0) {
						this.drawColoredText(api, contentText, colors, contentX, y);
					}
				} else if (visibleRight > visibleLeft) {
					this.drawRectOutlineColor(api, visibleLeft, caretTop, visibleRight, caretBottom, CARET_COLOR);
				}
			}
			if (!isHighlighted || contentText.length === 0 || !panelActive) {
				this.drawText(api, contentText, contentX, y, COLOR_STATUS_TEXT);
			}
		}

		if (verticalScrollbar.isVisible()) {
			verticalScrollbar.draw(api, SCROLLBAR_TRACK_COLOR, SCROLLBAR_THUMB_COLOR);
		}
		if (horizontalScrollbar.isVisible()) {
			horizontalScrollbar.draw(api, SCROLLBAR_TRACK_COLOR, SCROLLBAR_THUMB_COLOR);
		}
		if (dividerLeft >= bounds.left && dividerLeft < bounds.right) {
			api.rectfill(dividerLeft, bounds.top, bounds.right, bounds.bottom, RESOURCE_PANEL_DIVIDER_COLOR);
		}
	}

	private drawResourceViewer(api: BmsxConsoleApi): void {
		const viewer = this.getActiveResourceViewer();
		if (!viewer) {
			return;
		}
		this.resourceViewerClampScroll(viewer);
		const bounds = this.getCodeAreaBounds();
		const contentLeft = bounds.codeLeft + RESOURCE_PANEL_PADDING_X;
		const capacity = this.resourceViewerTextCapacity(viewer);
		const totalLines = viewer.lines.length;
		const verticalScrollbar = this.scrollbars.viewerVertical;
		const verticalTrack: RectBounds = {
			left: bounds.codeRight - SCROLLBAR_WIDTH,
			top: bounds.codeTop,
			right: bounds.codeRight,
			bottom: bounds.codeBottom,
		};
		verticalScrollbar.layout(verticalTrack, totalLines, Math.max(1, capacity), viewer.scroll);
		const verticalVisible = verticalScrollbar.isVisible();
		viewer.scroll = clamp(verticalScrollbar.getScroll(), 0, Math.max(0, totalLines - capacity));

		api.rectfill(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, COLOR_CODE_BACKGROUND);

		const contentTop = bounds.codeTop + 2;
		const layout = this.resourceViewerImageLayout(viewer);
		let textTop = contentTop;
		if (layout) {
			api.spr(viewer.image!.assetId, layout.left, layout.top, { scale: layout.scale });
			textTop = Math.floor(layout.bottom + this.lineHeight);
		}
		if (capacity <= 0) {
			if (viewer.lines.length > 0) {
				const line = viewer.lines[Math.min(viewer.lines.length - 1, Math.max(0, Math.floor(viewer.scroll)))] ?? '';
				const fallbackY = Math.min(textTop, bounds.codeBottom - this.lineHeight);
				this.drawText(api, line, contentLeft, fallbackY, COLOR_STATUS_TEXT);
			} else {
				this.drawText(api, '<empty>', contentLeft, textTop, COLOR_STATUS_TEXT);
			}
			if (verticalVisible) {
				verticalScrollbar.draw(api, SCROLLBAR_TRACK_COLOR, SCROLLBAR_THUMB_COLOR);
			}
			return;
		}
		const maxScroll = Math.max(0, totalLines - capacity);
		viewer.scroll = clamp(viewer.scroll, 0, maxScroll);
		const end = Math.min(totalLines, Math.floor(viewer.scroll) + capacity);
		if (viewer.lines.length === 0) {
			this.drawText(api, '<empty>', contentLeft, textTop, COLOR_STATUS_TEXT);
		} else {
			for (let lineIndex = Math.floor(viewer.scroll), drawIndex = 0; lineIndex < end; lineIndex += 1, drawIndex += 1) {
				const line = viewer.lines[lineIndex] ?? '';
				const y = textTop + drawIndex * this.lineHeight;
				if (y >= bounds.codeBottom) {
					break;
				}
				this.drawText(api, line, contentLeft, y, COLOR_STATUS_TEXT);
			}
		}
		if (verticalVisible) {
			verticalScrollbar.draw(api, SCROLLBAR_TRACK_COLOR, SCROLLBAR_THUMB_COLOR);
		}
	}

	private drawSearchHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
		if (this.searchMatches.length === 0 || this.searchQuery.length === 0) {
			return;
		}
		const highlight = entry.hi;
		for (let i = 0; i < this.searchMatches.length; i++) {
			const match = this.searchMatches[i];
			if (match.row !== rowIndex) {
				continue;
			}
			const startDisplay = this.columnToDisplay(highlight, match.start);
			const endDisplay = this.columnToDisplay(highlight, match.end);
			const visibleStart = Math.max(sliceStartDisplay, startDisplay);
			const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
			if (visibleEnd <= visibleStart) {
				continue;
			}
			const startX = originX + this.measureRangeFast(entry, sliceStartDisplay, visibleStart);
			const endX = originX + this.measureRangeFast(entry, sliceStartDisplay, visibleEnd);
			const overlay = i === this.searchCurrentIndex ? SEARCH_MATCH_ACTIVE_OVERLAY : SEARCH_MATCH_OVERLAY;
			api.rectfillColor(startX, originY, endX, originY + this.lineHeight, overlay);
		}
	}

	private drawCursor(api: BmsxConsoleApi, textX: number, codeTop: number, entry: CachedHighlight, sliceStartDisplay: number): void {
		const relativeRow = this.cursorRow - this.scrollRow;
		if (relativeRow < 0 || relativeRow >= this.visibleRowCount()) {
			return;
		}
		const line = this.currentLine();
		const highlight = entry.hi;
		const columnToDisplay = highlight.columnToDisplay;
		const clampedColumn = Math.min(this.cursorColumn, columnToDisplay.length - 1);
		const cursorDisplayIndex = columnToDisplay[clampedColumn];
		const cursorX = textX + this.measureRangeFast(entry, sliceStartDisplay, cursorDisplayIndex);
		const cursorY = codeTop + relativeRow * this.lineHeight;
		let baseChar = ' ';
		let baseColor = COLOR_CODE_TEXT;
		let cursorWidth = this.charAdvance;
		if (cursorDisplayIndex < highlight.chars.length) {
			baseChar = highlight.chars[cursorDisplayIndex];
			baseColor = highlight.colors[cursorDisplayIndex];
			const widthValue = entry.advancePrefix[cursorDisplayIndex + 1] - entry.advancePrefix[cursorDisplayIndex];
			cursorWidth = widthValue > 0 ? widthValue : this.font.advance(baseChar);
		}
		const originalChar = line.charAt(this.cursorColumn);
		if (originalChar === '\t') {
			cursorWidth = this.spaceAdvance * TAB_SPACES;
		}
		const caretLeft = Math.floor(Math.max(textX, cursorX - 1));
		const caretRight = Math.max(caretLeft + 1, Math.floor(cursorX + cursorWidth));
		const caretTop = Math.floor(cursorY);
		const caretBottom = caretTop + this.lineHeight;
		if (this.searchActive || this.lineJumpActive || this.resourcePanelFocused || this.createResourceActive) {
			const innerLeft = caretLeft + 1;
			const innerRight = caretRight - 1;
			const innerTop = caretTop + 1;
			const innerBottom = caretBottom - 1;
			if (innerRight > innerLeft && innerBottom > innerTop) {
				api.rectfill(innerLeft, innerTop, innerRight, innerBottom, COLOR_CODE_BACKGROUND);
			}
			this.drawRectOutlineColor(api, caretLeft, caretTop, caretRight, caretBottom, CARET_COLOR);
			this.drawColoredText(api, baseChar, [baseColor], cursorX, cursorY);
		} else {
			api.rectfillColor(caretLeft, caretTop, caretRight, caretBottom, CARET_COLOR);
			const inverted = this.invertColorIndex(baseColor);
			this.drawColoredText(api, baseChar, [inverted], cursorX, cursorY);
		}
	}

	private sliceHighlightedLine(highlight: HighlightLine, columnStart: number, columnCount: number): { text: string; colors: number[]; startDisplay: number; endDisplay: number } {
		if (highlight.chars.length === 0) {
			return { text: '', colors: [], startDisplay: 0, endDisplay: 0 };
		}
		const columnToDisplay = highlight.columnToDisplay;
		const clampedStart = Math.min(columnStart, columnToDisplay.length - 1);
		const clampedEndColumn = Math.min(columnStart + columnCount, columnToDisplay.length - 1);
		const startDisplay = columnToDisplay[clampedStart];
		const endDisplay = columnToDisplay[clampedEndColumn];
		const sliceChars = highlight.chars.slice(startDisplay, endDisplay);
		const sliceColors = highlight.colors.slice(startDisplay, endDisplay);
		return {
			text: sliceChars.join(''),
			colors: sliceColors,
			startDisplay,
			endDisplay,
		};
	}

	private drawColoredText(api: BmsxConsoleApi, text: string, colors: number[], originX: number, originY: number): void {
		let cursorX = Math.floor(originX);
		const cursorY = Math.floor(originY);
		let index = 0;
		while (index < text.length) {
			const colorIndex = colors[index] ?? COLOR_CODE_TEXT;
			let end = index + 1;
			while (end < text.length) {
				const nextColor = colors[end] ?? COLOR_CODE_TEXT;
				if (nextColor !== colorIndex) {
					break;
				}
				end++;
			}
			const segment = text.slice(index, end);
			if (segment.length > 0) {
				api.print(segment, cursorX, cursorY, colorIndex);
				cursorX += this.font.measure(segment);
			}
			index = end;
		}
	}

	private getCachedHighlight(row: number): CachedHighlight {
		const source = this.lines[row] ?? '';
		const cached = this.highlightCache.get(row);
		if (cached && cached.src === source) {
			return cached;
		}
		const highlight = this.highlightLine(source);
		const displayToColumn = new Array<number>(highlight.chars.length + 1).fill(0);
		for (let column = 0; column < source.length; column++) {
			const startDisplay = highlight.columnToDisplay[column];
			const endDisplay = highlight.columnToDisplay[column + 1];
			for (let display = startDisplay; display < endDisplay; display++) {
				displayToColumn[display] = column;
			}
		}
		displayToColumn[highlight.chars.length] = source.length;
		const advancePrefix: number[] = new Array(highlight.chars.length + 1);
		advancePrefix[0] = 0;
		for (let i = 0; i < highlight.chars.length; i++) {
			advancePrefix[i + 1] = advancePrefix[i] + this.font.advance(highlight.chars[i]);
		}
		const entry: CachedHighlight = {
			src: source,
			hi: highlight,
			displayToColumn,
			advancePrefix,
		};
		this.highlightCache.set(row, entry);
		while (this.highlightCache.size > this.maxHighlightCache) {
			const firstKey = this.highlightCache.keys().next().value as number | undefined;
			if (firstKey === undefined) {
				break;
			}
			this.highlightCache.delete(firstKey);
		}
		return entry;
	}

	private invalidateLine(row: number): void {
		this.highlightCache.delete(row);
	}

	private invalidateAllHighlights(): void {
		this.highlightCache.clear();
	}

	private measureRangeFast(entry: CachedHighlight, startDisplay: number, endDisplay: number): number {
		const length = entry.hi.chars.length;
		if (length === 0) {
			return 0;
		}
		const clampedStart = clamp(startDisplay, 0, length);
		const clampedEnd = clamp(endDisplay, clampedStart, length);
		return entry.advancePrefix[clampedEnd] - entry.advancePrefix[clampedStart];
	}

	private lowerBound(values: number[], target: number, lo = 0, hi = values.length): number {
		let left = lo;
		let right = hi;
		while (left < right) {
			const mid = (left + right) >>> 1;
			if (values[mid] < target) {
				left = mid + 1;
			} else {
				right = mid;
			}
		}
		return left;
	}

	private bumpTextVersion(): void {
		this.textVersion += 1;
	}

	private markTextMutated(): void {
		this.dirty = true;
		this.bumpTextVersion();
		this.updateActiveContextDirtyFlag();
	}

	private drawCaretShape(api: BmsxConsoleApi, left: number, top: number, right: number, bottom: number, active: boolean): void {
		if (!this.cursorVisible) {
			return;
		}
		if (active) {
			api.rectfillColor(left, top, right, bottom, CARET_COLOR);
			return;
		}
		this.drawRectOutlineColor(api, left, top, right, bottom, CARET_COLOR);
	}

	private drawRectOutlineColor(api: BmsxConsoleApi, left: number, top: number, right: number, bottom: number, color: { r: number; g: number; b: number; a: number }): void {
		if (right <= left || bottom <= top) {
			return;
		}
		api.rectfillColor(left, top, right, top + 1, color);
		api.rectfillColor(left, bottom - 1, right, bottom, color);
		api.rectfillColor(left, top, left + 1, bottom, color);
		api.rectfillColor(right - 1, top, right, bottom, color);
	}

	private computeSelectionSlice(lineIndex: number, highlight: HighlightLine, sliceStart: number, sliceEnd: number): { startDisplay: number; endDisplay: number } | null {
		const range = this.getSelectionRange();
		if (!range) {
			return null;
		}
		const { start, end } = range;
		if (lineIndex < start.row || lineIndex > end.row) {
			return null;
		}
		let selectionStartColumn = lineIndex === start.row ? start.column : 0;
		let selectionEndColumn = lineIndex === end.row ? end.column : this.lines[lineIndex].length;
		if (lineIndex === end.row && end.column === 0 && end.row > start.row) {
			selectionEndColumn = 0;
		}
		if (selectionStartColumn === selectionEndColumn) {
			return null;
		}
		const startDisplay = this.columnToDisplay(highlight, selectionStartColumn);
		const endDisplay = this.columnToDisplay(highlight, selectionEndColumn);
		const visibleStart = Math.max(sliceStart, startDisplay);
		const visibleEnd = Math.min(sliceEnd, endDisplay);
		if (visibleEnd <= visibleStart) {
			return null;
		}
		return { startDisplay: visibleStart, endDisplay: visibleEnd };
	}

	private drawStatusBar(api: BmsxConsoleApi): void {
		const statusTop = this.viewportHeight - this.bottomMargin;
		const statusBottom = this.viewportHeight;
		api.rectfill(0, statusTop, this.viewportWidth, statusBottom, COLOR_STATUS_BACKGROUND);

		if (this.resourcePanelVisible) {
			const totalEntries = this.resourceBrowserItems.length;
			const fileInfo = `FILES ${totalEntries}`;
			const hint = 'SCROLL WHEEL/ARROWS';
			this.drawText(api, fileInfo, 4, statusTop + 2, COLOR_STATUS_TEXT);
			this.drawText(api, hint, this.viewportWidth - this.measureText(hint) - 4, statusTop + 2, COLOR_STATUS_TEXT);
		} else if (this.isResourceViewActive()) {
			const viewer = this.getActiveResourceViewer();
			const info = viewer ? `${viewer.descriptor.type.toUpperCase()} ${viewer.descriptor.assetId}` : 'RESOURCE';
			const detail = viewer ? viewer.descriptor.path : '';
			this.drawText(api, info, 4, statusTop + 2, COLOR_STATUS_TEXT);
			if (detail.length > 0) {
				this.drawText(api, detail, this.viewportWidth - this.measureText(detail) - 4, statusTop + 2, COLOR_STATUS_TEXT);
			}
		} else {
			const lineInfo = `LINE ${this.cursorRow + 1}/${this.lines.length} COL ${this.cursorColumn + 1}`;
			const filenameInfo = `${this.metadata.title || 'UNTITLED'}.lua`;
			this.drawText(api, lineInfo, 4, statusTop + 2, COLOR_STATUS_TEXT);
			this.drawText(api, filenameInfo, this.viewportWidth - this.measureText(filenameInfo) - 4, statusTop + 2, COLOR_STATUS_TEXT);
		}

		if (this.message.visible) {
			const msgX = Math.max(4, Math.floor((this.viewportWidth - this.measureText(this.message.text)) / 2));
			this.drawText(api, this.message.text, msgX, statusTop + this.lineHeight + 1, this.message.color);
		}
	}

	private drawActionPromptOverlay(api: BmsxConsoleApi): void {
		const prompt = this.pendingActionPrompt;
		if (!prompt) {
			return;
		}
		api.rectfillColor(0, 0, this.viewportWidth, this.viewportHeight, ACTION_OVERLAY_COLOR);

		let messageLines: string[];
		let primaryLabel: string;
		let secondaryLabel: string;
		switch (prompt.action) {
			case 'resume':
				messageLines = [
					'UNSAVED CHANGES DETECTED.',
					'SAVE BEFORE RESUME TO APPLY CODE UPDATES?',
				];
				primaryLabel = 'SAVE & RESUME';
				secondaryLabel = 'RESUME WITHOUT SAVING';
				break;
			case 'reboot':
				messageLines = [
					'UNSAVED CHANGES DETECTED.',
					'SAVE BEFORE REBOOT TO APPLY CODE UPDATES?',
				];
				primaryLabel = 'SAVE & REBOOT';
				secondaryLabel = 'REBOOT WITHOUT SAVING';
				break;
			case 'close':
			default:
				messageLines = [
					'UNSAVED CHANGES DETECTED.',
					'SAVE BEFORE HIDING THE EDITOR?',
				];
				primaryLabel = 'SAVE & HIDE';
				secondaryLabel = 'HIDE WITHOUT SAVING';
				break;
		}
		let maxMessageWidth = 0;
		for (let i = 0; i < messageLines.length; i++) {
			const width = this.measureText(messageLines[i]);
			if (width > maxMessageWidth) {
				maxMessageWidth = width;
			}
		}
		const cancelLabel = 'CANCEL';
		const primaryWidth = this.measureText(primaryLabel) + HEADER_BUTTON_PADDING_X * 2;
		const secondaryWidth = this.measureText(secondaryLabel) + HEADER_BUTTON_PADDING_X * 2;
		const cancelWidth = this.measureText(cancelLabel) + HEADER_BUTTON_PADDING_X * 2;
		const buttonSpacing = HEADER_BUTTON_SPACING;
		const buttonRowWidth = primaryWidth + secondaryWidth + cancelWidth + buttonSpacing * 2;
		const paddingX = 12;
		const paddingY = 12;
		const buttonHeight = this.lineHeight + HEADER_BUTTON_PADDING_Y * 2;
		const messageSpacing = this.lineHeight + 2;
		const dialogWidth = Math.max(maxMessageWidth + paddingX * 2, buttonRowWidth + paddingX * 2);
		const dialogHeight = paddingY * 2 + messageLines.length * messageSpacing + 6 + buttonHeight;
		const left = Math.max(4, Math.floor((this.viewportWidth - dialogWidth) / 2));
		const top = Math.max(4, Math.floor((this.viewportHeight - dialogHeight) / 2));
		const right = left + dialogWidth;
		const bottom = top + dialogHeight;

		api.rectfill(left, top, right, bottom, ACTION_DIALOG_BACKGROUND_COLOR);
		api.rect(left, top, right, bottom, ACTION_DIALOG_BORDER_COLOR);

		let textY = top + paddingY;
		const textX = left + paddingX;
		for (let i = 0; i < messageLines.length; i++) {
			this.drawText(api, messageLines[i], textX, textY, ACTION_DIALOG_TEXT_COLOR);
			textY += messageSpacing;
		}

		const buttonY = bottom - paddingY - buttonHeight;
		let buttonX = left + paddingX;
		const saveBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + primaryWidth, bottom: buttonY + buttonHeight };
		api.rectfill(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, ACTION_BUTTON_BACKGROUND);
		api.rect(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, ACTION_DIALOG_BORDER_COLOR);
		this.drawText(api, primaryLabel, saveBounds.left + HEADER_BUTTON_PADDING_X, saveBounds.top + HEADER_BUTTON_PADDING_Y, ACTION_BUTTON_TEXT);
		this.actionPromptButtons.saveAndContinue = saveBounds;
		buttonX = saveBounds.right + buttonSpacing;

		const continueBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + secondaryWidth, bottom: buttonY + buttonHeight };
		api.rectfill(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, ACTION_BUTTON_BACKGROUND);
		api.rect(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, ACTION_DIALOG_BORDER_COLOR);
		this.drawText(api, secondaryLabel, continueBounds.left + HEADER_BUTTON_PADDING_X, continueBounds.top + HEADER_BUTTON_PADDING_Y, ACTION_BUTTON_TEXT);
		this.actionPromptButtons.continue = continueBounds;
		buttonX = continueBounds.right + buttonSpacing;

		const cancelBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + cancelWidth, bottom: buttonY + buttonHeight };
		api.rectfill(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, COLOR_HEADER_BUTTON_DISABLED_BACKGROUND);
		api.rect(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, ACTION_DIALOG_BORDER_COLOR);
		this.drawText(api, cancelLabel, cancelBounds.left + HEADER_BUTTON_PADDING_X, cancelBounds.top + HEADER_BUTTON_PADDING_Y, COLOR_HEADER_BUTTON_TEXT);
		this.actionPromptButtons.cancel = cancelBounds;
	}

	private highlightLine(line: string): HighlightLine {
		const length = line.length;
		const columnColors: number[] = new Array(length).fill(COLOR_CODE_TEXT);
		let i = 0;
		while (i < length) {
			const ch = line.charAt(i);
			if (line.startsWith('--[[', i)) {
				const closeIndex = line.indexOf(']]', i + 4);
				const end = closeIndex !== -1 ? closeIndex + 2 : length;
				for (let j = i; j < end; j++) {
					columnColors[j] = COLOR_COMMENT;
				}
				i = end;
				continue;
			}
			const longStringMatch = line.slice(i).match(/^\[=*\[/);
			if (longStringMatch) {
				const equalsCount = longStringMatch[0].length - 2;
				const terminator = ']' + '='.repeat(equalsCount) + ']';
				const closeIndex = line.indexOf(terminator, i + longStringMatch[0].length);
				const end = closeIndex !== -1 ? closeIndex + terminator.length : length;
				for (let j = i; j < end; j++) {
					columnColors[j] = COLOR_STRING;
				}
				i = end;
				continue;
			}
			if (ch === '"' || ch === '\'') {
				const delimiter = ch;
				columnColors[i] = COLOR_STRING;
				i += 1;
				while (i < length) {
					columnColors[i] = COLOR_STRING;
					const current = line.charAt(i);
					if (current === '\\' && i + 1 < length) {
						columnColors[i + 1] = COLOR_STRING;
						i += 2;
						continue;
					}
					if (current === delimiter) {
						i += 1;
						break;
					}
					i += 1;
				}
				continue;
			}
			if (line.startsWith('--', i)) {
				for (let j = i; j < length; j++) columnColors[j] = COLOR_COMMENT;
				break;
			}
			if (i + 2 <= length && line.slice(i, i + 3) === '...') {
				columnColors[i] = COLOR_OPERATOR;
				columnColors[i + 1] = COLOR_OPERATOR;
				columnColors[i + 2] = COLOR_OPERATOR;
				i += 3;
				continue;
			}
			if (i + 1 < length) {
				const pair = line.slice(i, i + 2);
				if (pair === '==' || pair === '~=' || pair === '<=' || pair === '>=' || pair === '..') {
					columnColors[i] = COLOR_OPERATOR;
					columnColors[i + 1] = COLOR_OPERATOR;
					i += 2;
					continue;
				}
			}
			if (this.isNumberStart(line, i)) {
				const end = this.readNumber(line, i);
				for (let j = i; j < end; j++) columnColors[j] = COLOR_NUMBER;
				i = end;
				continue;
			}
			if (this.isIdentifierStart(ch)) {
				const end = this.readIdentifier(line, i);
				const word = line.slice(i, end);
				const color = ConsoleCartEditor.KEYWORDS.has(word.toLowerCase()) ? COLOR_KEYWORD : COLOR_CODE_TEXT;
				if (color !== COLOR_CODE_TEXT) {
					for (let j = i; j < end; j++) columnColors[j] = color;
				}
				i = end;
				continue;
			}
			if (this.isOperatorChar(ch)) {
				columnColors[i] = COLOR_OPERATOR;
			}
			i += 1;
		}

		const chars: string[] = [];
		const colors: number[] = [];
		const columnToDisplay: number[] = [];
		for (let column = 0; column < length; column++) {
			columnToDisplay.push(chars.length);
			const ch = line.charAt(column);
			const color = columnColors[column];
			if (ch === '\t') {
				for (let j = 0; j < TAB_SPACES; j++) {
					chars.push(' ');
					colors.push(color);
				}
			}
			else {
				chars.push(ch);
				colors.push(color);
			}
		}
		columnToDisplay.push(chars.length);
		return { chars, colors, columnToDisplay };
	}

	private columnToDisplay(highlight: HighlightLine, column: number): number {
		if (column <= 0) {
			return 0;
		}
		if (column >= highlight.columnToDisplay.length) {
			return highlight.chars.length;
		}
		return highlight.columnToDisplay[column];
	}

	private isNumberStart(line: string, index: number): boolean {
		const ch = line.charAt(index);
		if (ch >= '0' && ch <= '9') {
			return true;
		}
		if (ch === '.' && index + 1 < line.length) {
			const next = line.charAt(index + 1);
			return next >= '0' && next <= '9';
		}
		return false;
	}

	private readNumber(line: string, start: number): number {
		let index = start;
		const length = line.length;
		if (line.startsWith('0x', index) || line.startsWith('0X', index)) {
			index += 2;
			while (index < length && this.isHexDigit(line.charAt(index))) index += 1;
			return index;
		}
		while (index < length && this.isDigit(line.charAt(index))) index += 1;
		if (index < length && line.charAt(index) === '.') {
			index += 1;
			while (index < length && this.isDigit(line.charAt(index))) index += 1;
		}
		if (index < length && (line.charAt(index) === 'e' || line.charAt(index) === 'E')) {
			index += 1;
			if (index < length && (line.charAt(index) === '+' || line.charAt(index) === '-')) {
				index += 1;
			}
			while (index < length && this.isDigit(line.charAt(index))) index += 1;
		}
		return index;
	}

	private readIdentifier(line: string, start: number): number {
		let index = start;
		while (index < line.length && this.isIdentifierPart(line.charAt(index))) {
			index += 1;
		}
		return index;
	}

	private isIdentifierStart(ch: string): boolean {
		return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
	}

	private isIdentifierPart(ch: string): boolean {
		return this.isIdentifierStart(ch) || this.isDigit(ch);
	}

	private isDigit(ch: string): boolean {
		return ch >= '0' && ch <= '9';
	}

	private isHexDigit(ch: string): boolean {
		return (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'F') || (ch >= 'a' && ch <= 'f');
	}

	private isOperatorChar(ch: string): boolean {
		return '+-*/%<>=#(){}[]:,.;'.includes(ch);
	}

	private invertColorIndex(colorIndex: number): number {
		const color = Msx1Colors[colorIndex];
		if (!color) {
			return COLOR_CODE_TEXT;
		}
		const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
		return luminance > 0.5 ? 0 : 15;
	}

	private resetActionPromptState(): void {
		this.pendingActionPrompt = null;
		this.actionPromptButtons.saveAndContinue = null;
		this.actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
		this.actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
	}

	private pointInRect(x: number, y: number, rect: RectBounds | null): boolean {
		if (!rect) {
			return false;
		}
		return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
	}

	private hasPendingRuntimeReload(): boolean {
		return this.saveGeneration > this.appliedGeneration;
	}

	private getConsoleRuntime(): ConsoleRuntimeBridge | null {
		const registry = $.registry;
		if (!registry) {
			return null;
		}
		const instance = registry.get('bmsx_console_runtime') as unknown;
		if (!instance || typeof instance !== 'object') {
			return null;
		}
		const runtime = instance as ConsoleRuntimeBridge;
		if (typeof runtime.getState !== 'function') {
			return null;
		}
		if (typeof runtime.setState !== 'function') {
			return null;
		}
		if (typeof runtime.boot !== 'function') {
			return null;
		}
		if (typeof runtime.reloadLuaProgram !== 'function') {
			return null;
		}
		return runtime;
	}

	private prepareRuntimeSnapshotForResume(snapshot: unknown): Record<string, unknown> | null {
		if (!snapshot || typeof snapshot !== 'object') {
			return null;
		}
		const base = snapshot as Record<string, unknown>;
		const sanitized: Record<string, unknown> = { ...base };
		if (sanitized.luaRuntimeFailed === true) {
			sanitized.luaRuntimeFailed = false;
		} else {
			sanitized.luaRuntimeFailed = sanitized.luaRuntimeFailed ?? false;
		}
		return sanitized;
	}

	private scheduleRuntimeTask(task: () => void | Promise<void>, onError: (error: unknown) => void): void {
		const invoke = (fn: () => void): void => {
			if (typeof queueMicrotask === 'function') {
				queueMicrotask(fn);
				return;
			}
			void Promise.resolve().then(fn);
		};
		invoke(() => {
			try {
				const result = task();
				if (result && typeof (result as Promise<void>).then === 'function') {
					(result as Promise<void>).catch(onError);
				}
			} catch (error) {
				onError(error);
			}
		});
	}

	private handleRuntimeTaskError(error: unknown, fallbackMessage: string): void {
		const message = error instanceof Error ? error.message : String(error);
		$.paused = true;
		this.activate();
		this.showMessage(`${fallbackMessage}: ${message}`, COLOR_STATUS_ERROR, 4.0);
	}

	private drawText(api: BmsxConsoleApi, text: string, originX: number, originY: number, color: number): void {
		const baseX = Math.floor(originX);
		let cursorY = Math.floor(originY);
		const lines = text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const expanded = this.expandTabs(lines[i]);
			if (expanded.length > 0) {
				api.print(expanded, baseX, cursorY, color);
			}
			if (i < lines.length - 1) {
				cursorY += this.lineHeight;
			}
		}
	}

	private expandTabs(source: string): string {
		if (source.indexOf('\t') === -1) {
			return source;
		}
		let result = '';
		for (let i = 0; i < source.length; i++) {
			const ch = source.charAt(i);
			if (ch === '\t') {
				for (let j = 0; j < TAB_SPACES; j++) {
					result += ' ';
				}
			} else {
				result += ch;
			}
		}
		return result;
	}

	private measureText(text: string): number {
		let width = 0;
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (ch === '\t') {
				width += this.spaceAdvance * TAB_SPACES;
				continue;
			}
			if (ch === '\n') {
				continue;
			}
			width += this.font.advance(ch);
		}
		return width;
	}

	private assertMonospace(): void {
		const sample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-*/%<>=#(){}[]:,.;\'"`~!@^&|\\?_ ';
		const reference = this.font.advance('M');
		for (let i = 0; i < sample.length; i++) {
			const candidate = this.font.advance(sample.charAt(i));
			if (candidate !== reference) {
				this.warnNonMonospace = true;
				break;
			}
		}
	}

	private centerCursorVertically(): void {
		const rows = this.visibleRowCount();
		const maxScroll = Math.max(0, this.lines.length - rows);
		if (rows <= 1) {
			this.scrollRow = clamp(this.cursorRow, 0, maxScroll);
			return;
		}
		let target = this.cursorRow - Math.floor(rows / 2);
		if (target < 0) {
			target = 0;
		}
		if (target > maxScroll) {
			target = maxScroll;
		}
		this.scrollRow = target;
	}

	private ensureCursorVisible(): void {
		this.clampCursorRow();
		this.clampCursorColumn();

		const rows = this.visibleRowCount();
		if (this.cursorRow < this.scrollRow) {
			this.scrollRow = this.cursorRow;
		}
		const maxScrollRow = this.cursorRow - rows + 1;
		if (maxScrollRow > this.scrollRow) {
			this.scrollRow = maxScrollRow;
		}
		if (this.scrollRow < 0) {
			this.scrollRow = 0;
		}

		const columns = this.visibleColumnCount();
		if (this.cursorColumn < this.scrollColumn) {
			this.scrollColumn = this.cursorColumn;
		}
		const maxScrollColumn = this.cursorColumn - columns + 1;
		if (maxScrollColumn > this.scrollColumn) {
			this.scrollColumn = maxScrollColumn;
		}
		if (this.scrollColumn < 0) {
			this.scrollColumn = 0;
		}
		const lineLength = this.currentLine().length;
		const maxColumn = lineLength - columns;
		if (maxColumn < 0) {
			this.scrollColumn = 0;
		} else if (this.scrollColumn > maxColumn) {
			this.scrollColumn = maxColumn;
		}
	}

	private visibleRowCount(): number {
		return this.cachedVisibleRowCount > 0 ? this.cachedVisibleRowCount : 1;
	}

	private visibleColumnCount(): number {
		return this.cachedVisibleColumnCount > 0 ? this.cachedVisibleColumnCount : 1;
	}

	private currentLine(): string {
		if (this.cursorRow < 0 || this.cursorRow >= this.lines.length) {
			return '';
		}
		return this.lines[this.cursorRow];
	}

	private clampCursorRow(): void {
		if (this.cursorRow < 0) {
			this.cursorRow = 0;
		}
		if (this.cursorRow >= this.lines.length) {
			this.cursorRow = this.lines.length - 1;
		}
	}

	private clampCursorColumn(): void {
		const line = this.currentLine();
		if (this.cursorColumn < 0) {
			this.cursorColumn = 0;
			return;
		}
		const length = line.length;
		if (this.cursorColumn > length) {
			this.cursorColumn = length;
		}
	}

	private clampSelectionPosition(position: Position | null): Position | null {
		if (!position || this.lines.length === 0) {
			return null;
		}
		let row = position.row;
		if (row < 0) {
			row = 0;
		} else if (row >= this.lines.length) {
			row = this.lines.length - 1;
		}
		const line = this.lines[row] ?? '';
		let column = position.column;
		if (column < 0) {
			column = 0;
		} else if (column > line.length) {
			column = line.length;
		}
		return { row, column };
	}

	private resetBlink(): void {
		this.blinkTimer = 0;
		this.cursorVisible = true;
	}

	private getButtonState(_keyboard: KeyboardInput, code: string): ButtonState | null {
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		if (!playerInput) {
			return null;
		}
		return playerInput.getButtonState(code, 'keyboard');
	}

	private isKeyJustPressed(keyboard: KeyboardInput, code: string): boolean {
		const state = this.getButtonState(keyboard, code);
		if (!state) {
			return false;
		}
		return this.shouldAcceptKeyPress(code, state);
	}

	private isModifierPressed(keyboard: KeyboardInput, code: string): boolean {
		const state = this.getButtonState(keyboard, code);
		if (!state) {
			return false;
		}
		return state.pressed === true;
	}

	private shouldFireRepeat(keyboard: KeyboardInput, code: string, deltaSeconds: number): boolean {
		const state = this.getButtonState(keyboard, code);
		if (!state || state.pressed !== true) {
			this.repeatState.delete(code);
			this.keyPressRecords.delete(code);
			return false;
		}
		let entry = this.repeatState.get(code);
		if (!entry) {
			entry = { cooldown: INITIAL_REPEAT_DELAY };
			this.repeatState.set(code, entry);
		}
		if (this.shouldAcceptKeyPress(code, state)) {
			entry.cooldown = INITIAL_REPEAT_DELAY;
			return true;
		}
		entry.cooldown -= deltaSeconds;
		if (entry.cooldown <= 0) {
			entry.cooldown = REPEAT_INTERVAL;
			return true;
		}
		this.repeatState.set(code, entry);
		return false;
	}

	private applyInputOverrides(active: boolean): void {
		const input = $.input;
		input.setDebugHotkeysPaused(active);
		for (let i = 0; i < this.captureKeys.length; i++) {
			input.setKeyboardCapture(this.captureKeys[i], active);
		}
	}

	// @ts-ignore
	private countCharacters(): number {
		let total = 0;
		for (let i = 0; i < this.lines.length; i++) {
			total += this.lines[i].length;
		}
		return total;
	}

	private getClipboardService(): ClipboardService {
		return $.platform.clipboard;
	}

}
