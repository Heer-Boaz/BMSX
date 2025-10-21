import { $ } from '../core/game';
import type { KeyboardInput } from '../input/keyboardinput';
import type { ButtonState } from '../input/inputtypes';
import type { ClipboardService } from '../platform/platform';
import type { BmsxConsoleApi } from './api';
import type { BmsxConsoleMetadata, ConsoleViewport } from './types';
import { ConsoleEditorFont } from './editor_font';
import { Msx1Colors } from '../systems/msx';

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
	saveSource: (source: string) => void;
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

type PendingActionPrompt = {
	action: 'resume' | 'reboot';
};

type ConsoleRuntimeBridge = {
	getState(): unknown;
	setState(state: unknown): void;
	boot(): void;
	reloadLuaProgram(source: string): void;
};

export type ConsoleEditorSerializedState = {
	active: boolean;
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
	lastPressedAtMs: number;
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
const KEY_GUARD_MIN_MS = 24;
const KEY_GUARD_MAX_MS = 120;

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
const LINE_JUMP_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;
const HEADER_BUTTON_PADDING_X = 5;
const HEADER_BUTTON_PADDING_Y = 1;
const HEADER_BUTTON_SPACING = 4;
const COLOR_HEADER_BUTTON_BACKGROUND = COLOR_STATUS_BACKGROUND;
const COLOR_HEADER_BUTTON_BORDER = COLOR_TOP_BAR_TEXT;
const COLOR_HEADER_BUTTON_DISABLED_BACKGROUND = COLOR_GUTTER_BACKGROUND;
const COLOR_HEADER_BUTTON_TEXT = COLOR_TOP_BAR_TEXT;
const COLOR_HEADER_BUTTON_TEXT_DISABLED = COLOR_CODE_DIM;
const ACTION_OVERLAY_COLOR = { r: 0, g: 0, b: 0, a: 0.65 };
const ACTION_DIALOG_BACKGROUND_COLOR = COLOR_SEARCH_BACKGROUND;
const ACTION_DIALOG_BORDER_COLOR = COLOR_SEARCH_OUTLINE;
const ACTION_DIALOG_TEXT_COLOR = COLOR_SEARCH_TEXT;
const ACTION_BUTTON_BACKGROUND = COLOR_STATUS_BACKGROUND;
const ACTION_BUTTON_TEXT = COLOR_STATUS_TEXT;

export class ConsoleCartEditor {
	private readonly playerIndex: number;
	private readonly metadata: BmsxConsoleMetadata;
	private readonly loadSourceFn: () => string;
	private readonly saveSourceFn: (source: string) => void;
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
	private readonly topMargin: number;
	private readonly bottomMargin: number;
	private readonly repeatState: Map<string, RepeatEntry> = new Map();
	private readonly keyPressRecords: Map<string, KeyPressRecord> = new Map();
	private readonly message: MessageState = { text: '', color: COLOR_STATUS_TEXT, timer: 0, visible: false };
	private runtimeErrorOverlay: RuntimeErrorOverlay | null = null;
	private readonly captureKeys: string[] = [
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
		'KeyA',
		'KeyC',
		'KeyX',
		'KeyV',
		'KeyS',
		'KeyY',
		'KeyZ',
		'KeyF',
		'KeyL',
		'BracketLeft',
		'BracketRight',
		'F3',
	];

	private static readonly KEYWORDS = new Set([
		'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
	]);
	private static customClipboard: string | null = null;

	private readonly topBarButtonBounds: Record<'resume' | 'reboot' | 'save', RectBounds> = {
		resume: { left: 0, top: 0, right: 0, bottom: 0 },
		reboot: { left: 0, top: 0, right: 0, bottom: 0 },
		save: { left: 0, top: 0, right: 0, bottom: 0 },
	};
	private readonly actionPromptButtons: { saveAndContinue: RectBounds | null; continue: RectBounds; cancel: RectBounds } = {
		saveAndContinue: null,
		continue: { left: 0, top: 0, right: 0, bottom: 0 },
		cancel: { left: 0, top: 0, right: 0, bottom: 0 },
	};
	private pendingActionPrompt: PendingActionPrompt | null = null;
	private active = false;
	private lastDeltaMilliseconds = KEY_GUARD_MIN_MS;
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
	private cursorRevealSuspended = false;
	private searchActive = false;
	private searchVisible = false;
	private searchQuery = '';
	private lineJumpActive = false;
	private lineJumpVisible = false;
	private lineJumpValue = '';
	private searchMatches: SearchMatch[] = [];
	private searchCurrentIndex = -1;
	private textVersion = 0;
	private lastSearchVersion = 0;
	private saveGeneration = 0;
	private appliedGeneration = 0;
	private lastSavedSource = '';

	constructor(options: ConsoleEditorOptions) {
		this.playerIndex = options.playerIndex;
		this.metadata = options.metadata;
		this.loadSourceFn = options.loadSource;
		this.saveSourceFn = options.saveSource;
		this.viewportWidth = options.viewport.width;
		this.viewportHeight = options.viewport.height;
		this.font = new ConsoleEditorFont();
		this.lineHeight = this.font.lineHeight();
		this.charAdvance = this.font.advance('M');
		this.spaceAdvance = this.font.advance(' ');
		this.gutterWidth = 2;
		const primaryBarHeight = this.lineHeight + 4;
		this.headerHeight = primaryBarHeight;
		this.topMargin = this.headerHeight + 2;
		this.bottomMargin = this.lineHeight + 6;
		this.desiredColumn = this.cursorColumn;
		this.assertMonospace();
		try {
			this.lastSavedSource = this.loadSource();
		} catch {
			this.lastSavedSource = '';
		}
	}

	public isActive(): boolean {
		return this.active;
	}

	public showRuntimeError(line: number, column: number, message: string): void {
		if (!this.active) {
			this.activate();
		}
		const hasLocation = Number.isFinite(line) && line >= 1;
		const processedLine = hasLocation ? Math.max(1, Math.floor(line)) : null;
		const baseColumn = Number.isFinite(column) ? Math.max(0, Math.floor(column) - 1) : null;
		let targetRow = this.cursorRow;
		if (processedLine !== null) {
			targetRow = Math.max(0, Math.min(this.lines.length - 1, processedLine - 1));
			this.cursorRow = targetRow;
		}
		const currentLine = this.lines[targetRow] ?? '';
		let targetColumn = this.cursorColumn;
		if (baseColumn !== null) {
			targetColumn = Math.max(0, Math.min(currentLine.length, baseColumn));
			this.cursorColumn = targetColumn;
		}
		this.clampCursorColumn();
		targetColumn = this.cursorColumn;
		this.selectionAnchor = null;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.cursorRevealSuspended = false;
		this.centerCursorVertically();
		this.updateDesiredColumn();
		this.revealCursor();
		this.resetBlink();
		const normalizedMessage = (message && message.length > 0) ? message.trim() : 'Runtime error';
		const overlayMessage = processedLine !== null ? `Line ${processedLine}: ${normalizedMessage}` : normalizedMessage;
		const overlayLines = this.buildRuntimeErrorLines(overlayMessage);
		this.runtimeErrorOverlay = {
			row: targetRow,
			column: targetColumn,
			lines: overlayLines,
			timer: Number.POSITIVE_INFINITY,
		};
		const statusLine = overlayLines.length > 0 ? overlayLines[0] : 'Runtime error';
		this.showMessage(statusLine, COLOR_STATUS_WARNING, 8.0);
	}

	public clearRuntimeErrorOverlay(): void {
		this.runtimeErrorOverlay = null;
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
		if (!error || typeof error !== 'object') {
			return false;
		}
		const candidate = error as { line?: unknown; column?: unknown; chunkName?: unknown; message?: unknown };
		const lineValue = typeof candidate.line === 'number' && Number.isFinite(candidate.line) ? Math.floor(candidate.line) : null;
		const columnValue = typeof candidate.column === 'number' && Number.isFinite(candidate.column) ? Math.floor(candidate.column) : null;
		const chunkName = typeof candidate.chunkName === 'string' && candidate.chunkName.length > 0 ? candidate.chunkName : null;
		const messageText = typeof candidate.message === 'string' && candidate.message.length > 0 ? candidate.message : null;
		if (lineValue === null && columnValue === null && messageText === null) {
			return false;
		}
		const safeLine = lineValue !== null && lineValue > 0 ? lineValue : 1;
		const safeColumn = columnValue !== null && columnValue > 0 ? columnValue : 1;
		const baseMessage = messageText ?? 'Lua error';
		const overlayMessage = chunkName ? `${chunkName}: ${baseMessage}` : baseMessage;
		this.showRuntimeError(safeLine, safeColumn, overlayMessage);
		return true;
	}

	public update(deltaSeconds: number): void {
		this.refreshViewportDimensions();
		this.updateGuardWindowFromDelta(deltaSeconds);
		const keyboard = this.getKeyboard();
		if (!keyboard) {
			return;
		}
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
		} else if (this.textVersion !== this.lastSearchVersion) {
			this.updateSearchMatches();
			this.lastSearchVersion = this.textVersion;
		}
		if (!this.cursorRevealSuspended) {
			this.ensureCursorVisible();
		}
}

	public draw(api: BmsxConsoleApi): void {
		this.refreshViewportDimensions();
		if (!this.active) {
			return;
		}
		const frameColor = Msx1Colors[COLOR_FRAME];
		api.rectfillColor(0, 0, this.viewportWidth, this.viewportHeight, { r: frameColor.r, g: frameColor.g, b: frameColor.b, a: frameColor.a });
		this.drawTopBar(api);
		this.drawSearchBar(api);
		this.drawLineJumpBar(api);
		this.drawCodeArea(api);
		this.drawStatusBar(api);
		if (this.pendingActionPrompt) {
			this.drawActionPromptOverlay(api);
		}
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
	}

	public serializeState(): ConsoleEditorSerializedState {
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

	public restoreState(state: ConsoleEditorSerializedState): void {
		if (!state) return;
		this.applyInputOverrides(false);
		this.active = state.active;
		if (this.active) {
			this.applyInputOverrides(true);
		}
		this.restoreSnapshot(state.snapshot);
		this.searchQuery = state.searchQuery;
		this.searchMatches = state.searchMatches.map(match => ({ row: match.row, start: match.start, end: match.end }));
		this.searchCurrentIndex = state.searchCurrentIndex;
		this.searchActive = state.searchActive;
		this.searchVisible = state.searchVisible;
		this.lineJumpValue = state.lineJumpValue;
		this.lineJumpActive = state.lineJumpActive;
		this.lineJumpVisible = state.lineJumpVisible;
		this.message.text = state.message.text;
		this.message.color = state.message.color;
		this.message.timer = state.message.timer;
		this.message.visible = state.message.visible;
		this.runtimeErrorOverlay = state.runtimeErrorOverlay
			? {
				row: state.runtimeErrorOverlay.row,
				column: state.runtimeErrorOverlay.column,
				lines: state.runtimeErrorOverlay.lines.slice(),
				timer: state.runtimeErrorOverlay.timer,
			}
			: null;
		this.lastSearchVersion = this.textVersion;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.cursorRevealSuspended = false;
		this.repeatState.clear();
		this.resetKeyPressGuards();
		this.breakUndoSequence();
		this.saveGeneration = Number.isFinite(state.saveGeneration) ? Math.max(0, Math.floor(state.saveGeneration)) : 0;
		this.appliedGeneration = Number.isFinite(state.appliedGeneration) ? Math.max(0, Math.floor(state.appliedGeneration)) : 0;
		this.resetActionPromptState();
		try {
			this.lastSavedSource = this.loadSource();
		} catch {
			this.lastSavedSource = '';
		}
	}

	public shutdown(): void {
		this.applyInputOverrides(false);
		this.active = false;
		this.repeatState.clear();
		this.resetKeyPressGuards();
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.cursorRevealSuspended = false;
		this.searchActive = false;
		this.searchVisible = false;
		this.lineJumpActive = false;
		this.lineJumpVisible = false;
		this.lineJumpValue = '';
		this.resetActionPromptState();
	}

	private getKeyboard(): KeyboardInput | null {
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		if (!playerInput) {
			return null;
		}
		const handler = playerInput.inputHandlers['keyboard'];
		if (!handler) {
			return null;
		}
		const candidate = handler as KeyboardInput;
		if (typeof (candidate as { keydown?: unknown }).keydown === 'function') {
			return candidate;
		}
		return null;
	}

	private handleToggleRequest(keyboard: KeyboardInput): boolean {
		if (this.isKeyJustPressed(keyboard, 'Escape')) {
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
			if (this.lineJumpActive || this.lineJumpVisible) {
				this.closeLineJump(false);
				return true;
			}
			if (this.searchActive || this.searchVisible) {
				this.closeSearch(false);
				return true;
			}
			if (this.active) {
				this.deactivate();
			} else {
				this.activate();
			}
			return true;
		}
		return false;
	}

	private activate(): void {
		this.applyInputOverrides(true);
		const source = this.loadSource();
		this.lastSavedSource = source;
		this.lines = this.splitLines(source);
		if (this.lines.length === 0) {
			this.lines.push('');
		}
		this.invalidateAllHighlights();
		this.bumpTextVersion();
		this.cursorRow = 0;
		this.cursorColumn = 0;
		this.scrollRow = 0;
		this.scrollColumn = 0;
		this.dirty = false;
		this.cursorVisible = true;
		this.blinkTimer = 0;
		this.active = true;
		this.message.visible = false;
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
		this.runtimeErrorOverlay = null;
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
	}

	private deactivate(): void {
		this.active = false;
		this.repeatState.clear();
		this.resetKeyPressGuards();
		this.applyInputOverrides(false);
		this.selectionAnchor = null;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
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
	}

	private updateBlink(deltaSeconds: number): void {
		this.blinkTimer += deltaSeconds;
		if (this.blinkTimer >= CURSOR_BLINK_INTERVAL) {
			this.blinkTimer -= CURSOR_BLINK_INTERVAL;
			this.cursorVisible = !this.cursorVisible;
		}
	}

	private loadSource(): string {
		return this.loadSourceFn();
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
			this.handleActionPromptSelection('save-continue');
		}
	}

	private handleEditorInput(keyboard: KeyboardInput, deltaSeconds: number): void {
		const ctrlDown = this.isModifierPressed(keyboard, 'ControlLeft') || this.isModifierPressed(keyboard, 'ControlRight');
		const shiftDown = this.isModifierPressed(keyboard, 'ShiftLeft') || this.isModifierPressed(keyboard, 'ShiftRight');
		const metaDown = this.isModifierPressed(keyboard, 'MetaLeft') || this.isModifierPressed(keyboard, 'MetaRight');
		const altDown = this.isModifierPressed(keyboard, 'AltLeft') || this.isModifierPressed(keyboard, 'AltRight');

		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyF')) {
			this.consumeKey(keyboard, 'KeyF');
			this.openSearch(true);
			return;
		}
		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyA')) {
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
			this.save();
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
			this.save();
			return;
		}
		if (ctrlDown && this.isKeyJustPressed(keyboard, 'KeyC')) {
			this.consumeKey(keyboard, 'KeyC');
			void this.copySelectionToClipboard();
			return;
		}
		if (ctrlDown && this.isKeyJustPressed(keyboard, 'KeyX')) {
			this.consumeKey(keyboard, 'KeyX');
			void this.cutSelectionToClipboard();
			return;
		}
		if (ctrlDown && this.isKeyJustPressed(keyboard, 'KeyV')) {
			this.consumeKey(keyboard, 'KeyV');
			this.pasteIntoSearch();
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
		if (ctrlDown || metaDown || altDown) {
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'Backspace', deltaSeconds)) {
			this.consumeKey(keyboard, 'Backspace');
			if (this.searchQuery.length > 0) {
				this.removeSearchCharacter();
			}
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'Delete', deltaSeconds)) {
			this.consumeKey(keyboard, 'Delete');
			if (this.searchQuery.length > 0) {
				this.removeSearchCharacter();
			}
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'Space', deltaSeconds)) {
			this.consumeKey(keyboard, 'Space');
			this.appendToSearchQuery(' ');
			return;
		}
		for (let i = 0; i < CHARACTER_CODES.length; i++) {
			const code = CHARACTER_CODES[i];
			if (!this.isKeyTyped(keyboard, code)) {
				continue;
			}
			const entry = CHARACTER_MAP[code];
			const value = shiftDown ? entry.shift : entry.normal;
			this.appendToSearchQuery(value);
			this.consumeKey(keyboard, code);
			return;
		}
	}

	private handleLineJumpInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyL')) {
			this.consumeKey(keyboard, 'KeyL');
			this.openLineJump();
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'Enter')) {
			this.consumeKey(keyboard, 'Enter');
			this.applyLineJump();
			return;
		}
		if (this.isKeyJustPressed(keyboard, 'Escape')) {
			this.consumeKey(keyboard, 'Escape');
			this.closeLineJump(false);
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'Backspace', deltaSeconds)) {
			this.consumeKey(keyboard, 'Backspace');
			this.removeLineJumpDigit();
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'Delete', deltaSeconds)) {
			this.consumeKey(keyboard, 'Delete');
			this.removeLineJumpDigit();
			return;
		}
		if (ctrlDown || metaDown) {
			return;
		}
		for (let digit = 0; digit <= 9; digit++) {
			const code = `Digit${digit}`;
			if (!this.isKeyTyped(keyboard, code)) {
				continue;
			}
			this.appendLineJumpDigit(String(digit));
			this.consumeKey(keyboard, code);
			return;
		}
		for (let digit = 0; digit <= 9; digit++) {
			const code = `Numpad${digit}`;
			if (!this.isKeyTyped(keyboard, code)) {
				continue;
			}
			this.appendLineJumpDigit(String(digit));
			this.consumeKey(keyboard, code);
			return;
		}
		if (!shiftDown && this.isKeyJustPressed(keyboard, 'NumpadEnter')) {
			this.consumeKey(keyboard, 'NumpadEnter');
			this.applyLineJump();
		}
	}

	private openSearch(useSelection: boolean): void {
		this.closeLineJump(false);
		this.searchVisible = true;
		this.searchActive = true;
		let appliedSelection = false;
		if (useSelection) {
			const range = this.getSelectionRange();
			const selected = this.getSelectionText();
			if (range && selected !== null && selected.length > 0 && selected.indexOf('\n') === -1) {
				if (this.searchQuery !== selected) {
					this.searchQuery = selected;
				}
				this.cursorRow = range.start.row;
				this.cursorColumn = range.start.column;
				appliedSelection = true;
			}
		}
		if (!appliedSelection && this.searchQuery.length === 0) {
			this.searchCurrentIndex = -1;
		}
		this.onSearchQueryChanged();
		this.resetBlink();
	}

	private closeSearch(clearQuery: boolean): void {
		this.searchActive = false;
		this.searchVisible = false;
		if (clearQuery) {
			this.searchQuery = '';
			this.searchMatches = [];
			this.searchCurrentIndex = -1;
			this.selectionAnchor = null;
		}
		this.resetBlink();
	}

	private focusEditorFromSearch(): void {
		if (!this.searchActive) {
			return;
		}
		this.searchActive = false;
		this.resetBlink();
	}

	private openLineJump(): void {
		this.closeSearch(false);
		this.lineJumpVisible = true;
		this.lineJumpActive = true;
		this.lineJumpValue = '';
		this.resetBlink();
	}

	private closeLineJump(clearValue: boolean): void {
		this.lineJumpActive = false;
		this.lineJumpVisible = false;
		if (clearValue) {
			this.lineJumpValue = '';
		}
		this.resetBlink();
	}

	private focusEditorFromLineJump(): void {
		if (!this.lineJumpActive && !this.lineJumpVisible) {
			return;
		}
		this.lineJumpActive = false;
		this.lineJumpVisible = false;
		this.resetBlink();
	}

	private appendLineJumpDigit(digit: string): void {
		if (digit.length !== 1 || digit < '0' || digit > '9') {
			return;
		}
		if (this.lineJumpValue.length >= 6) {
			return;
		}
		if (this.lineJumpValue === '0') {
			this.lineJumpValue = digit;
			return;
		}
		this.lineJumpValue += digit;
	}

	private removeLineJumpDigit(): void {
		if (this.lineJumpValue.length === 0) {
			return;
		}
		this.lineJumpValue = this.lineJumpValue.slice(0, -1);
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

	private appendToSearchQuery(value: string): void {
		if (value.length === 0) {
			return;
		}
		this.searchQuery += value;
		this.onSearchQueryChanged();
	}

	private removeSearchCharacter(): void {
		if (this.searchQuery.length === 0) {
			return;
		}
		this.searchQuery = this.searchQuery.slice(0, -1);
		this.onSearchQueryChanged();
	}

	private pasteIntoSearch(): void {
		const source = ConsoleCartEditor.customClipboard;
		if (source === null || source.length === 0) {
			this.showMessage('Editor clipboard is empty', COLOR_STATUS_WARNING, 1.5);
			return;
		}
		const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const merged = normalized.split('\n').join(' ');
		if (merged.length === 0) {
			return;
		}
		this.searchQuery += merged;
		this.onSearchQueryChanged();
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
			const targetColumn = Math.max(0, Math.min(lineLength, Math.floor(this.desiredColumn)));
			this.cursorColumn = targetColumn;
			this.resetBlink();
			this.consumeKey(keyboard, 'PageUp');
			moved = true;
		}
		if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			const rows = this.visibleRowCount();
			this.cursorRow = Math.min(this.lines.length - 1, this.cursorRow + rows);
			const lineLength = this.currentLine().length;
			const targetColumn = Math.max(0, Math.min(lineLength, Math.floor(this.desiredColumn)));
			this.cursorColumn = targetColumn;
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
		const snapshot = this.readPointerSnapshot();
		if (!snapshot) {
			this.pointerPrimaryWasPressed = false;
			return;
		}
		const wasPressed = this.pointerPrimaryWasPressed;
		const justPressed = snapshot.primaryPressed && !wasPressed;
		const justReleased = !snapshot.primaryPressed && wasPressed;
		if (justReleased || (!snapshot.primaryPressed && this.pointerSelecting)) {
			this.pointerSelecting = false;
		}
		if (!snapshot.valid) {
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			return;
		}
		if (this.pendingActionPrompt) {
			if (justPressed) {
				this.handleActionPromptPointer(snapshot);
			}
			this.pointerSelecting = false;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			return;
		}
		if (justPressed && snapshot.viewportY >= 0 && snapshot.viewportY < this.headerHeight) {
			if (this.handleTopBarPointer(snapshot)) {
				this.pointerSelecting = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				return;
			}
		}
		const lineJumpBounds = this.getLineJumpBarBounds();
		if (justPressed && lineJumpBounds && snapshot.viewportY >= lineJumpBounds.top && snapshot.viewportY < lineJumpBounds.bottom) {
			this.closeSearch(false);
			this.lineJumpVisible = true;
			this.lineJumpActive = true;
			this.resetBlink();
			this.pointerSelecting = false;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			return;
		}
		const searchBounds = this.getSearchBarBounds();
		if (justPressed && searchBounds && snapshot.viewportY >= searchBounds.top && snapshot.viewportY < searchBounds.bottom) {
			this.closeLineJump(false);
			this.searchVisible = true;
			this.searchActive = true;
			this.resetBlink();
			this.pointerSelecting = false;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			return;
		}

		const bounds = this.getCodeAreaBounds();
		const insideVertical = snapshot.viewportY >= bounds.codeTop && snapshot.viewportY < bounds.codeBottom;
		if (justPressed && insideVertical) {
			this.focusEditorFromLineJump();
			this.focusEditorFromSearch();
			const targetRow = this.resolvePointerRow(snapshot.viewportY);
			const targetColumn = this.resolvePointerColumn(targetRow, snapshot.viewportX);
			this.selectionAnchor = { row: targetRow, column: targetColumn };
			this.setCursorPosition(targetRow, targetColumn);
			this.pointerSelecting = true;
		}
		if (this.pointerSelecting && snapshot.primaryPressed) {
			this.handlePointerAutoScroll(snapshot.viewportX, snapshot.viewportY);
			const targetRow = this.resolvePointerRow(snapshot.viewportY);
			const targetColumn = this.resolvePointerColumn(targetRow, snapshot.viewportX);
			if (!this.selectionAnchor) {
				this.selectionAnchor = { row: targetRow, column: targetColumn };
			}
			this.setCursorPosition(targetRow, targetColumn);
		}
		this.pointerPrimaryWasPressed = snapshot.primaryPressed;
	}

	private handleActionPromptPointer(snapshot: PointerSnapshot): void {
		if (!this.pendingActionPrompt) {
			return;
		}
		const x = snapshot.viewportX;
		const y = snapshot.viewportY;
		const saveBounds = this.actionPromptButtons.saveAndContinue;
		if (saveBounds && this.pointInRect(x, y, saveBounds)) {
			this.handleActionPromptSelection('save-continue');
			return;
		}
		if (this.pointInRect(x, y, this.actionPromptButtons.continue)) {
			this.handleActionPromptSelection('continue');
			return;
		}
		if (this.pointInRect(x, y, this.actionPromptButtons.cancel)) {
			this.handleActionPromptSelection('cancel');
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
		this.scrollRows(direction * steps);
		this.cursorRevealSuspended = true;
		playerInput.consumeAction('pointer_wheel');
	}

	private handleTopBarButtonPress(button: 'resume' | 'reboot' | 'save'): void {
		if (button === 'save') {
			if (!this.dirty) {
				return;
			}
			this.save();
			return;
		}
		if (this.dirty) {
			this.openActionPrompt(button);
			return;
		}
		const success = this.performAction(button);
		if (!success) {
			return;
		}
	}

	private openActionPrompt(action: 'resume' | 'reboot'): void {
		this.pendingActionPrompt = { action };
		this.actionPromptButtons.saveAndContinue = null;
		this.actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
		this.actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
	}

	private handleActionPromptSelection(choice: 'save-continue' | 'continue' | 'cancel'): void {
		if (!this.pendingActionPrompt) {
			return;
		}
		if (choice === 'cancel') {
			this.resetActionPromptState();
			return;
		}
		if (choice === 'save-continue') {
			if (!this.attemptPromptSave()) {
				return;
			}
		}
		const success = this.executePendingAction();
		if (success) {
			this.resetActionPromptState();
		}
	}

	private attemptPromptSave(): boolean {
		this.save();
		return this.dirty === false;
	}

	private executePendingAction(): boolean {
		const prompt = this.pendingActionPrompt;
		if (!prompt) {
			return false;
		}
		return this.performAction(prompt.action);
	}

	private performAction(action: 'resume' | 'reboot'): boolean {
		if (action === 'resume') {
			return this.performResume();
		}
		return this.performReboot();
	}

	private performResume(): boolean {
		const runtime = this.getConsoleRuntime();
		if (!runtime) {
			this.showMessage('Console runtime unavailable.', COLOR_STATUS_WARNING, 4.0);
			return false;
		}
		let snapshot: unknown = null;
		try {
			snapshot = runtime.getState();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(`Failed to capture runtime state: ${message}`, COLOR_STATUS_WARNING, 4.0);
			return false;
		}
		const sanitizedSnapshot = this.prepareRuntimeSnapshotForResume(snapshot);
		if (!sanitizedSnapshot) {
			this.showMessage('Runtime state unavailable.', COLOR_STATUS_WARNING, 4.0);
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
			this.showMessage('Console runtime unavailable.', COLOR_STATUS_WARNING, 4.0);
			return false;
		}
		const requiresReload = this.hasPendingRuntimeReload();
		const savedSource = requiresReload ? (this.lastSavedSource.length > 0 ? this.lastSavedSource : this.lines.join('\n')) : null;
		const targetGeneration = this.saveGeneration;
		this.deactivate();
		this.scheduleRuntimeTask(() => {
			if (requiresReload && savedSource !== null) {
				runtime.reloadLuaProgram(savedSource);
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

	private getCodeAreaBounds(): { codeTop: number; codeBottom: number; codeRight: number; textLeft: number; } {
		const codeTop = this.codeViewportTop();
		const codeBottom = this.viewportHeight - this.bottomMargin;
		const codeRight = this.viewportWidth;
		const textLeft = this.gutterWidth + 2;
		return { codeTop, codeBottom, codeRight, textLeft };
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

	private computeMaximumScrollColumn(): number {
		let maxLength = 0;
		for (let i = 0; i < this.lines.length; i++) {
			const length = this.lines[i].length;
			if (length > maxLength) {
				maxLength = length;
			}
		}
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
	const targetColumn = Math.max(0, Math.min(lineLength, Math.floor(this.desiredColumn)));
	this.cursorColumn = targetColumn;
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
		this.lastDeltaMilliseconds = KEY_GUARD_MIN_MS;
	}

	private updateGuardWindowFromDelta(deltaSeconds: number): void {
		if (deltaSeconds <= 0) {
			return;
		}
		const deltaMs = deltaSeconds * 1000;
		const clamped = Math.max(KEY_GUARD_MIN_MS, Math.min(KEY_GUARD_MAX_MS, deltaMs));
		this.lastDeltaMilliseconds = clamped;
	}

	private keyBounceGuardMs(): number {
		if (!Number.isFinite(this.lastDeltaMilliseconds)) {
			return KEY_GUARD_MIN_MS;
		}
		if (this.lastDeltaMilliseconds < KEY_GUARD_MIN_MS) {
			return KEY_GUARD_MIN_MS;
		}
		if (this.lastDeltaMilliseconds > KEY_GUARD_MAX_MS) {
			return KEY_GUARD_MAX_MS;
		}
		return this.lastDeltaMilliseconds;
	}

	private resolvePressedAtMs(_state: ButtonState): number {
		return $.platform.clock.now();
	}

	private shouldAcceptJustPressed(code: string, state: ButtonState): boolean {
		if (state.justpressed !== true || state.consumed === true) {
			return false;
		}
		const pressId = typeof state.pressId === 'number' ? state.pressId : null;
		const pressedAt = this.resolvePressedAtMs(state);
		const existing = this.keyPressRecords.get(code);
		if (existing) {
			if (pressId !== null && existing.lastPressId === pressId) {
				return false;
			}
			const delta = pressedAt - existing.lastPressedAtMs;
			if (Number.isFinite(delta) && delta <= this.keyBounceGuardMs()) {
				this.keyPressRecords.set(code, { lastPressId: pressId, lastPressedAtMs: pressedAt });
				return false;
			}
		}
		this.keyPressRecords.set(code, { lastPressId: pressId, lastPressedAtMs: pressedAt });
		return true;
	}

private consumeKey(keyboard: KeyboardInput, code: string): void {
	keyboard.consumeButton(code);
}

private updateDesiredColumn(): void {
	this.desiredColumn = this.cursorColumn;
}

private isKeyTyped(keyboard: KeyboardInput, code: string): boolean {
	const state = this.getButtonState(keyboard, code);
	if (!state) {
		return false;
	}
	return this.shouldAcceptJustPressed(code, state);
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

	private save(): void {
		const source = this.lines.join('\n');
		try {
			this.saveSourceFn(source);
			this.dirty = false;
			this.saveGeneration = this.saveGeneration + 1;
			this.lastSavedSource = source;
			this.showMessage('Lua cart saved (restart pending)', COLOR_STATUS_SUCCESS, 2.5);
		} catch (error) {
			if (this.tryShowLuaErrorOverlay(error)) {
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(message, COLOR_STATUS_WARNING, 4.0);
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
			this.runtimeErrorOverlay = null;
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
		const primaryBarHeight = this.lineHeight + 3;
		api.rectfill(0, 0, this.viewportWidth, primaryBarHeight, COLOR_TOP_BAR);

		const buttonTop = 1;
		const buttonHeight = this.lineHeight + HEADER_BUTTON_PADDING_Y * 2;
		let buttonX = 4;
		const buttonEntries: Array<{ id: 'resume' | 'reboot' | 'save'; label: string; disabled: boolean }> = [
			{ id: 'resume', label: 'RESUME', disabled: false },
			{ id: 'reboot', label: 'REBOOT', disabled: false },
			{ id: 'save', label: 'SAVE', disabled: !this.dirty },
		];
		for (let i = 0; i < buttonEntries.length; i++) {
			const entry = buttonEntries[i];
			const textWidth = this.measureText(entry.label);
			const buttonWidth = textWidth + HEADER_BUTTON_PADDING_X * 2;
			const right = buttonX + buttonWidth;
			const bottom = buttonTop + buttonHeight;
			const bounds: RectBounds = { left: buttonX, top: buttonTop, right, bottom };
			this.topBarButtonBounds[entry.id] = bounds;
			const fillColor = entry.disabled ? COLOR_HEADER_BUTTON_DISABLED_BACKGROUND : COLOR_HEADER_BUTTON_BACKGROUND;
			const textColor = entry.disabled ? COLOR_HEADER_BUTTON_TEXT_DISABLED : COLOR_HEADER_BUTTON_TEXT;
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

	private drawSearchBar(api: BmsxConsoleApi): void {
		const height = this.getSearchBarHeight();
		if (height <= 0) {
			return;
		}
		const barTop = this.headerHeight;
		const barBottom = barTop + height;
		api.rectfill(0, barTop, this.viewportWidth, barBottom, COLOR_SEARCH_BACKGROUND);
		api.rectfill(0, barTop, this.viewportWidth, barTop + 1, COLOR_SEARCH_OUTLINE);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, COLOR_SEARCH_OUTLINE);

		const label = 'SEARCH:';
		const labelX = 4;
		const labelY = barTop + SEARCH_BAR_MARGIN_Y;
		this.drawText(api, label, labelX, labelY, COLOR_SEARCH_TEXT);

		let queryText = this.searchQuery;
		let queryColor = COLOR_SEARCH_TEXT;
		if (queryText.length === 0 && !this.searchActive) {
			queryText = 'TYPE TO SEARCH';
			queryColor = COLOR_SEARCH_PLACEHOLDER;
		}
		const queryX = labelX + this.measureText(label + ' ');
		this.drawText(api, queryText, queryX, labelY, queryColor);

		const caretX = queryX + this.measureText(this.searchQuery);
		const caretGlyphSource = this.searchQuery.length > 0 ? this.searchQuery.charAt(this.searchQuery.length - 1) : ' ';
		const caretAdvance = this.font.advance(caretGlyphSource);
		const caretWidth = caretAdvance > 0 ? caretAdvance : this.charAdvance;
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + caretWidth));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + this.lineHeight;
		if (this.cursorVisible) {
			if (this.searchActive) {
				api.rectfillColor(caretLeft, caretTop, caretRight, caretBottom, CARET_COLOR);
			} else {
				this.drawRectOutlineColor(api, caretLeft, caretTop, caretRight, caretBottom, CARET_COLOR);
			}
		}

		if (this.searchQuery.length > 0) {
			const total = this.searchMatches.length;
			const current = this.searchCurrentIndex >= 0 ? this.searchCurrentIndex + 1 : 0;
			const infoText = total === 0 ? '0/0' : `${current}/${total}`;
			const infoColor = total === 0 ? COLOR_STATUS_WARNING : COLOR_SEARCH_TEXT;
			const infoWidth = this.measureText(infoText);
			this.drawText(api, infoText, this.viewportWidth - infoWidth - 4, labelY, infoColor);
		}
	}

	private drawLineJumpBar(api: BmsxConsoleApi): void {
		const height = this.getLineJumpBarHeight();
		if (height <= 0) {
			return;
		}
		const offset = this.getSearchBarHeight();
		const barTop = this.headerHeight + offset;
		const barBottom = barTop + height;
		api.rectfill(0, barTop, this.viewportWidth, barBottom, COLOR_LINE_JUMP_BACKGROUND);
		api.rectfill(0, barTop, this.viewportWidth, barTop + 1, COLOR_LINE_JUMP_OUTLINE);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, COLOR_LINE_JUMP_OUTLINE);

		const label = 'LINE #:';
		const labelX = 4;
		const labelY = barTop + LINE_JUMP_BAR_MARGIN_Y;
		this.drawText(api, label, labelX, labelY, COLOR_LINE_JUMP_TEXT);

		let valueText = this.lineJumpValue;
		let valueColor = COLOR_LINE_JUMP_TEXT;
		if (valueText.length === 0 && !this.lineJumpActive) {
			valueText = 'ENTER LINE NUMBER';
			valueColor = COLOR_LINE_JUMP_PLACEHOLDER;
		}
		const valueX = labelX + this.measureText(label + ' ');
		this.drawText(api, valueText, valueX, labelY, valueColor);

		const caretX = valueX + this.measureText(this.lineJumpValue);
		const caretWidth = this.charAdvance;
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + caretWidth));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + this.lineHeight;
		if (this.cursorVisible) {
			if (this.lineJumpActive) {
				api.rectfillColor(caretLeft, caretTop, caretRight, caretBottom, CARET_COLOR);
			} else {
				this.drawRectOutlineColor(api, caretLeft, caretTop, caretRight, caretBottom, CARET_COLOR);
			}
		}
	}

	private codeViewportTop(): number {
		return this.topMargin + this.getSearchBarHeight() + this.getLineJumpBarHeight();
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

	private getLineJumpBarHeight(): number {
		if (!this.isLineJumpVisible()) {
			return 0;
		}
		return this.lineHeight + LINE_JUMP_BAR_MARGIN_Y * 2;
	}

	private isLineJumpVisible(): boolean {
		return this.lineJumpVisible;
	}

	private getSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getSearchBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = this.headerHeight;
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
		const top = this.headerHeight + this.getSearchBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: this.viewportWidth,
		};
	}

	private drawCodeArea(api: BmsxConsoleApi): void {
		const codeTop = this.codeViewportTop();
		const codeBottom = this.viewportHeight - this.bottomMargin;
		const gutterRight = this.gutterWidth;
		const textLeft = gutterRight + 2;

		api.rectfill(0, codeTop, this.viewportWidth, codeBottom, COLOR_CODE_BACKGROUND);
		if (gutterRight > 0) {
			api.rectfill(0, codeTop, gutterRight, codeBottom, COLOR_GUTTER_BACKGROUND);
		}

		const rowCount = this.visibleRowCount();
		const columnCount = this.visibleColumnCount();
		let cursorEntry: CachedHighlight | null = null;
		let cursorSliceStart = 0;

		for (let i = 0; i < rowCount; i++) {
			const lineIndex = this.scrollRow + i;
			const rowY = codeTop + i * this.lineHeight;
			if (lineIndex === this.cursorRow) {
				api.rectfillColor(gutterRight, rowY, this.viewportWidth, rowY + this.lineHeight, HIGHLIGHT_OVERLAY);
			}

		if (lineIndex < this.lines.length) {
			const entry = this.getCachedHighlight(lineIndex);
				const highlight = entry.hi;
				const slice = this.sliceHighlightedLine(highlight, this.scrollColumn, columnCount + 2);
				this.drawSearchHighlightsForRow(api, lineIndex, entry, textLeft, rowY, slice.startDisplay, slice.endDisplay);
				const selectionSlice = this.computeSelectionSlice(lineIndex, highlight, slice.startDisplay, slice.endDisplay);
				if (selectionSlice) {
					const selectionStartX = textLeft + this.measureRangeFast(entry, slice.startDisplay, selectionSlice.startDisplay);
					const selectionEndX = textLeft + this.measureRangeFast(entry, slice.startDisplay, selectionSlice.endDisplay);
					api.rectfillColor(selectionStartX, rowY, selectionEndX, rowY + this.lineHeight, SELECTION_OVERLAY);
				}
				this.drawColoredText(api, slice.text, slice.colors, textLeft, rowY);
				if (lineIndex === this.cursorRow) {
					cursorEntry = entry;
					cursorSliceStart = slice.startDisplay;
				}
			} else {
				this.drawColoredText(api, '~', [COLOR_CODE_DIM], textLeft, rowY);
			}
		}

		this.drawRuntimeErrorOverlay(api, codeTop, textLeft);

		if (this.cursorVisible && cursorEntry) {
			this.drawCursor(api, textLeft, codeTop, cursorEntry, cursorSliceStart);
		}
	}

	private drawRuntimeErrorOverlay(api: BmsxConsoleApi, codeTop: number, textLeft: number): void {
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
		if (bubbleLeft + bubbleWidth > this.viewportWidth - 1) {
			bubbleLeft = Math.max(textLeft, this.viewportWidth - 1 - bubbleWidth);
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
			this.drawText(api, lines[i], bubbleLeft + ERROR_OVERLAY_PADDING_X, lineY, COLOR_STATUS_WARNING);
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
		if (this.searchActive || this.lineJumpActive) {
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
		const clampedStart = Math.max(0, Math.min(startDisplay, length));
		const clampedEnd = Math.max(clampedStart, Math.min(endDisplay, length));
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

		const lineInfo = `LINE ${this.cursorRow + 1}/${this.lines.length} COL ${this.cursorColumn + 1}`;
		const filenameInfo = `${this.metadata.title || 'UNTITLED'}.lua`;
		this.drawText(api, lineInfo, 4, statusTop + 2, COLOR_STATUS_TEXT);
		this.drawText(api, filenameInfo, this.viewportWidth - this.measureText(filenameInfo) - 4, statusTop + 2, COLOR_STATUS_TEXT);

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

		const actionLabel = prompt.action === 'resume' ? 'RESUME' : 'REBOOT';
		const messageLines = [
			'UNSAVED CHANGES DETECTED.',
			`SAVE BEFORE ${actionLabel} TO APPLY CODE UPDATES?`,
		];
		let maxMessageWidth = 0;
		for (let i = 0; i < messageLines.length; i++) {
			const width = this.measureText(messageLines[i]);
			if (width > maxMessageWidth) {
				maxMessageWidth = width;
			}
		}
		const primaryLabel = prompt.action === 'resume' ? 'SAVE & RESUME' : 'SAVE & REBOOT';
		const secondaryLabel = prompt.action === 'resume' ? 'RESUME WITHOUT SAVING' : 'REBOOT WITHOUT SAVING';
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

	private scheduleRuntimeTask(task: () => void, onError: (error: unknown) => void): void {
		const invoke = (fn: () => void): void => {
			if (typeof queueMicrotask === 'function') {
				queueMicrotask(fn);
				return;
			}
			void Promise.resolve().then(fn);
		};
		invoke(() => {
			try {
				task();
			} catch (error) {
				onError(error);
			}
		});
	}

	private handleRuntimeTaskError(error: unknown, fallbackMessage: string): void {
		const message = error instanceof Error ? error.message : String(error);
		$.paused = true;
		this.activate();
		this.showMessage(`${fallbackMessage}: ${message}`, COLOR_STATUS_WARNING, 4.0);
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
			this.scrollRow = Math.max(0, Math.min(this.cursorRow, maxScroll));
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
		const available = this.viewportHeight - this.codeViewportTop() - this.bottomMargin;
		if (available <= 0) {
			return 1;
		}
		const rows = Math.floor(available / this.lineHeight);
		return rows > 0 ? rows : 1;
	}

	private visibleColumnCount(): number {
		const available = this.viewportWidth - (this.gutterWidth + 2);
		if (available <= 0) {
			return 1;
		}
		const advance = this.warnNonMonospace ? this.spaceAdvance : this.charAdvance;
		const columns = Math.floor(available / advance);
		return columns > 0 ? columns : 1;
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
		return this.shouldAcceptJustPressed(code, state);
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
			return false;
		}
		let entry = this.repeatState.get(code);
		if (!entry) {
			entry = { cooldown: INITIAL_REPEAT_DELAY };
			this.repeatState.set(code, entry);
		}
		if (state.justpressed) {
			if (!this.shouldAcceptJustPressed(code, state)) {
				return false;
			}
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
