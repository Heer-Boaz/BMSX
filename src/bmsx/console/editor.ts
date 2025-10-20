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

type RepeatEntry = {
	cooldown: number;
};

export type ConsoleEditorOptions = {
	playerIndex: number;
	viewport: ConsoleViewport;
	metadata: BmsxConsoleMetadata;
	loadSource: () => string;
	reloadSource: (source: string) => void;
};

type Position = { row: number; column: number };

type MessageState = {
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

type SearchMatch = {
	row: number;
	start: number;
	end: number;
};

type EditorSnapshot = {
	lines: string[];
	cursorRow: number;
	cursorColumn: number;
	scrollRow: number;
	scrollColumn: number;
	selectionAnchor: Position | null;
	dirty: boolean;
};

type PointerSnapshot = {
	viewportX: number;
	viewportY: number;
	insideViewport: boolean;
	valid: boolean;
	primaryPressed: boolean;
};

const TAB_SPACES = 2;
const INITIAL_REPEAT_DELAY = 0.28;
const REPEAT_INTERVAL = 0.05;
const CURSOR_BLINK_INTERVAL = 0.45;
const UNDO_HISTORY_LIMIT = 512;
const UNDO_COALESCE_INTERVAL_MS = 550;
const WHEEL_SCROLL_STEP = 40;

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
const LINE_JUMP_BAR_MARGIN_Y = SEARCH_BAR_MARGIN_Y;

export class ConsoleCartEditor {
	private readonly playerIndex: number;
	private readonly metadata: BmsxConsoleMetadata;
	private readonly loadSourceFn: () => string;
	private readonly reloadSourceFn: (source: string) => void;
	private readonly viewportWidth: number;
	private readonly viewportHeight: number;
	private readonly font: ConsoleEditorFont;
	private readonly lineHeight: number;
	private readonly charAdvance: number;
	private readonly spaceAdvance: number;
	private readonly gutterWidth: number;
	private readonly headerHeight: number;
	private readonly topMargin: number;
	private readonly bottomMargin: number;
	private readonly repeatState: Map<string, RepeatEntry> = new Map();
	private readonly message: MessageState = { text: '', color: COLOR_STATUS_TEXT, timer: 0, visible: false };
	private readonly captureKeys: string[] = [
		'ArrowUp',
		'ArrowDown',
		'ArrowLeft',
		'ArrowRight',
		'Backspace',
		'Delete',
		'Enter',
		'End',
		'Home',
		'KeyS',
		'KeyY',
		'KeyZ',
		'PageDown',
		'PageUp',
		'KeyF',
		'KeyL',
		'F3',
		'Space',
		'Tab',
	];

	private static readonly KEYWORDS = new Set([
		'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
	]);
	private static customClipboard: string | null = null;

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

	constructor(options: ConsoleEditorOptions) {
		this.playerIndex = options.playerIndex;
		this.metadata = options.metadata;
		this.loadSourceFn = options.loadSource;
		this.reloadSourceFn = options.reloadSource;
		this.viewportWidth = options.viewport.width;
		this.viewportHeight = options.viewport.height;
		this.font = new ConsoleEditorFont();
		this.lineHeight = this.font.lineHeight();
		this.charAdvance = this.font.getGlyph('M').advance;
		this.spaceAdvance = this.font.getGlyph(' ').advance;
		this.gutterWidth = 2;
		const primaryBarHeight = this.lineHeight + 4;
		this.headerHeight = primaryBarHeight;
		this.topMargin = this.headerHeight + 2;
		this.bottomMargin = this.lineHeight + 6;
		this.desiredColumn = this.cursorColumn;
	}

	public isActive(): boolean {
		return this.active;
	}

	public update(deltaSeconds: number): void {
		const keyboard = this.getKeyboard();
		if (!keyboard) {
			return;
		}
		this.updateMessage(deltaSeconds);
		if (this.handleToggleRequest(keyboard)) {
			return;
		}
		if (!this.active) {
			return;
		}
		this.updateBlink(deltaSeconds);
		this.handlePointerWheel();
		this.handlePointerInput(deltaSeconds);
		this.handleEditorInput(keyboard, deltaSeconds);
		if (!this.cursorRevealSuspended) {
			this.ensureCursorVisible();
		}
	}

	public draw(api: BmsxConsoleApi): void {
		if (!this.active) {
			return;
		}
		api.cls(COLOR_FRAME);
		this.drawTopBar(api);
		this.drawSearchBar(api);
		this.drawLineJumpBar(api);
		this.drawCodeArea(api);
		this.drawStatusBar(api);
	}

	public shutdown(): void {
		this.applyInputOverrides(false);
		this.active = false;
		this.repeatState.clear();
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.cursorRevealSuspended = false;
		this.searchActive = false;
		this.searchVisible = false;
		this.lineJumpActive = false;
		this.lineJumpVisible = false;
		this.lineJumpValue = '';
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
		this.lines = this.splitLines(source);
		if (this.lines.length === 0) {
			this.lines.push('');
		}
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
		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyZ')) {
			this.consumeKey(keyboard, 'KeyZ');
			if (shiftDown) {
				this.redo();
			} else {
				this.undo();
			}
			return;
		}
		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyY')) {
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
		if (ctrlDown || metaDown || altDown) {
			return;
		}
		this.handleEditingKeys(keyboard, deltaSeconds, shiftDown);
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
		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyZ')) {
			this.consumeKey(keyboard, 'KeyZ');
			if (shiftDown) {
				this.redo();
			} else {
				this.undo();
			}
			return;
		}
		if ((ctrlDown || metaDown) && this.isKeyJustPressed(keyboard, 'KeyY')) {
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
		const codes = Object.keys(CHARACTER_MAP);
		for (let i = 0; i < codes.length; i++) {
			const code = codes[i];
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
		if (altDown) {
			if (this.isKeyJustPressed(keyboard, 'ArrowUp')) {
				this.consumeKey(keyboard, 'ArrowUp');
				this.moveSelectionLines(-1);
				return;
			}
			if (this.isKeyJustPressed(keyboard, 'ArrowDown')) {
				this.consumeKey(keyboard, 'ArrowDown');
				this.moveSelectionLines(1);
				return;
			}
		}

		const previousPosition: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (shiftDown) {
			this.ensureSelectionAnchor(previousPosition);
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

		if (this.isKeyJustPressed(keyboard, 'Home')) {
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
		if (this.isKeyJustPressed(keyboard, 'End')) {
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
		if (this.isKeyJustPressed(keyboard, 'PageUp')) {
			const rows = this.visibleRowCount();
			this.cursorRow = Math.max(0, this.cursorRow - rows);
			const lineLength = this.currentLine().length;
			const targetColumn = Math.max(0, Math.min(lineLength, Math.floor(this.desiredColumn)));
			this.cursorColumn = targetColumn;
			this.resetBlink();
			this.consumeKey(keyboard, 'PageUp');
			moved = true;
		}
		if (this.isKeyJustPressed(keyboard, 'PageDown')) {
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
			this.unindentCurrentLine();
			this.consumeKey(keyboard, 'Tab');
		}
	}

	private handleEditingKeys(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean): void {
		if (this.shouldFireRepeat(keyboard, 'Backspace', deltaSeconds)) {
			this.backspace();
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
		this.dirty = true;
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
		const line = this.lines[row];
		if (line.length === 0) {
			return 0;
		}
		const effectiveStartColumn = this.scrollColumn < line.length ? this.scrollColumn : line.length;
		const highlight = this.highlightLine(line);
		const startDisplay = this.columnToDisplay(highlight, effectiveStartColumn);
		let displayIndex = startDisplay;
		let accumulated = 0;
		const offset = viewportX - textLeft;
		if (offset <= 0) {
			return effectiveStartColumn;
		}
		for (let column = effectiveStartColumn; column < line.length; column++) {
			const nextDisplay = this.columnToDisplay(highlight, column + 1);
			let columnWidth = 0;
			for (let i = displayIndex; i < nextDisplay; i++) {
				const glyph = this.font.getGlyph(highlight.chars[i]);
				columnWidth += glyph.advance;
			}
			if (columnWidth > 0) {
				const boundary = accumulated + columnWidth;
				if (offset < boundary) {
					const midpoint = accumulated + columnWidth * 0.5;
					if (offset < midpoint) {
						return column;
					}
					return column + 1;
				}
			}
			accumulated += columnWidth;
			displayIndex = nextDisplay;
		}
		return line.length;
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
	let row = this.cursorRow;
	let column = this.cursorColumn;
	let step = this.stepLeft(row, column);
	if (!step) {
		this.cursorRow = 0;
		this.cursorColumn = 0;
		this.updateDesiredColumn();
		this.resetBlink();
		return;
	}
	row = step.row;
	column = step.column;
	let currentChar = this.charAt(row, column);
	while (this.isWhitespace(currentChar)) {
		const previous = this.stepLeft(row, column);
		if (!previous) {
			this.cursorRow = row;
			this.cursorColumn = column;
			this.updateDesiredColumn();
			this.resetBlink();
			return;
		}
		row = previous.row;
		column = previous.column;
		currentChar = this.charAt(row, column);
	}
	const word = this.isWordChar(currentChar);
	while (true) {
		const previous = this.stepLeft(row, column);
		if (!previous) {
			break;
		}
		const previousChar = this.charAt(previous.row, previous.column);
		if (this.isWhitespace(previousChar)) {
			break;
		}
		if (this.isWordChar(previousChar) !== word) {
			break;
		}
		row = previous.row;
		column = previous.column;
	}
	this.cursorRow = row;
	this.cursorColumn = column;
	this.updateDesiredColumn();
	this.resetBlink();
	this.revealCursor();
}

private moveWordRight(): void {
	let row = this.cursorRow;
	let column = this.cursorColumn;
	let step = this.stepRight(row, column);
	if (!step) {
		this.cursorRow = this.lines.length - 1;
		this.cursorColumn = this.lines[this.lines.length - 1].length;
		this.updateDesiredColumn();
		this.resetBlink();
		return;
	}
	row = step.row;
	column = step.column;
	let currentChar = this.charAt(row, column);
	while (this.isWhitespace(currentChar)) {
		const next = this.stepRight(row, column);
		if (!next) {
			row = this.lines.length - 1;
			column = this.lines[row].length;
			this.cursorRow = row;
			this.cursorColumn = column;
			this.updateDesiredColumn();
			this.resetBlink();
			return;
		}
		row = next.row;
		column = next.column;
		currentChar = this.charAt(row, column);
	}
	const word = this.isWordChar(currentChar);
	while (true) {
		const next = this.stepRight(row, column);
		if (!next) {
			row = this.lines.length - 1;
			column = this.lines[row].length;
			break;
		}
		const nextChar = this.charAt(next.row, next.column);
		if (this.isWhitespace(nextChar)) {
			row = next.row;
			column = next.column;
			break;
		}
		if (this.isWordChar(nextChar) !== word) {
			row = next.row;
			column = next.column;
			break;
		}
		row = next.row;
		column = next.column;
	}
	while (this.isWhitespace(this.charAt(row, column))) {
		const next = this.stepRight(row, column);
		if (!next) {
			row = this.lines.length - 1;
			column = this.lines[row].length;
			break;
		}
		row = next.row;
		column = next.column;
	}
	this.cursorRow = row;
	this.cursorColumn = column;
	this.updateDesiredColumn();
	this.resetBlink();
	this.revealCursor();
}

	private handleCharacterInput(keyboard: KeyboardInput, shiftDown: boolean): void {
		const codes = Object.keys(CHARACTER_MAP);
		for (let i = 0; i < codes.length; i++) {
			const code = codes[i];
			if (!this.isKeyTyped(keyboard, code)) {
				continue;
			}
			const entry = CHARACTER_MAP[code];
			const value = shiftDown ? entry.shift : entry.normal;
			this.insertText(value);
			this.consumeKey(keyboard, code);
		}
	}

private consumeKey(keyboard: KeyboardInput, code: string): void {
	keyboard.consumeButton(code);
}

private updateDesiredColumn(): void {
	this.desiredColumn = this.cursorColumn;
}

private isKeyTyped(keyboard: KeyboardInput, code: string): boolean {
	const state = this.getButtonState(keyboard, code);
	return !!state && state.justpressed === true;
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
		this.cursorColumn += text.length;
		this.dirty = true;
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
		this.cursorRow += 1;
		this.cursorColumn = indentation.length;
		this.dirty = true;
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
			this.cursorColumn -= 1;
			this.dirty = true;
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
		this.cursorRow -= 1;
		this.cursorColumn = previousLine.length;
		this.dirty = true;
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
			this.dirty = true;
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
		this.dirty = true;
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private unindentCurrentLine(): void {
		const line = this.currentLine();
		const indentMatch = line.match(/^[\t ]+/);
		if (!indentMatch) {
			return;
		}
		const indent = indentMatch[0];
		const first = indent.charAt(0);
		let removeCount = 0;
		if (first === '\t') {
			removeCount = 1;
		}
		else {
			removeCount = Math.min(TAB_SPACES, indent.length);
		}
		if (removeCount === 0) {
			return;
		}
		this.prepareUndo('unindent', false);
		const remainingIndent = indent.slice(removeCount);
		const rest = line.slice(indent.length);
		this.lines[this.cursorRow] = remainingIndent + rest;
		const delta = removeCount;
		this.cursorColumn = Math.max(0, this.cursorColumn - delta);
		this.dirty = true;
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private save(): void {
		const source = this.lines.join('\n');
		try {
			this.reloadSourceFn(source);
			this.dirty = false;
			this.showMessage('Lua cart reloaded', COLOR_STATUS_SUCCESS, 2.5);
		} catch (error) {
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
	this.selectionAnchor = null;
	this.dirty = true;
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
			this.cursorRow = insertionRow + lastIndex;
			this.cursorColumn = lastFragment.length;
		}
		this.dirty = true;
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

	private restoreSnapshot(snapshot: EditorSnapshot): void {
		this.lines = snapshot.lines.slice();
		this.cursorRow = snapshot.cursorRow;
		this.cursorColumn = snapshot.cursorColumn;
		this.scrollRow = snapshot.scrollRow;
		this.scrollColumn = snapshot.scrollColumn;
		if (snapshot.selectionAnchor) {
			this.selectionAnchor = { row: snapshot.selectionAnchor.row, column: snapshot.selectionAnchor.column };
		} else {
			this.selectionAnchor = null;
		}
		this.dirty = snapshot.dirty;
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
		this.restoreSnapshot(snapshot);
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
		this.restoreSnapshot(snapshot);
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
		this.cursorRow += delta;
		if (this.selectionAnchor) {
			this.selectionAnchor = { row: this.selectionAnchor.row + delta, column: this.selectionAnchor.column };
		}
		this.clampCursorColumn();
		this.dirty = true;
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

		this.drawText(api, 'O  +  []', 4, 2, COLOR_TOP_BAR_TEXT);

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
		const caretWidth = this.charAdvance;
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

		api.rectfill(0, codeTop, this.viewportWidth, codeBottom, COLOR_CODE_BACKGROUND);
		if (gutterRight > 0) {
			api.rectfill(0, codeTop, gutterRight, codeBottom, COLOR_GUTTER_BACKGROUND);
		}

		const rowCount = this.visibleRowCount();
		const columnCount = this.visibleColumnCount();
		let cursorHighlight: HighlightLine | null = null;
		let cursorSliceStart = 0;

		for (let i = 0; i < rowCount; i++) {
			const lineIndex = this.scrollRow + i;
			const rowY = codeTop + i * this.lineHeight;
			if (lineIndex === this.cursorRow) {
				api.rectfillColor(gutterRight, rowY, this.viewportWidth, rowY + this.lineHeight, HIGHLIGHT_OVERLAY);
			}

			if (lineIndex < this.lines.length) {
				const line = this.lines[lineIndex];
				const highlight = this.highlightLine(line);
				const slice = this.sliceHighlightedLine(highlight, this.scrollColumn, columnCount + 2);
				this.drawSearchHighlightsForRow(api, lineIndex, highlight, gutterRight + 2, rowY, slice.startDisplay, slice.endDisplay);
				const selectionSlice = this.computeSelectionSlice(lineIndex, highlight, slice.startDisplay, slice.endDisplay);
				if (selectionSlice) {
					const selectionStartX = gutterRight + 2 + this.measureHighlightRange(highlight, slice.startDisplay, selectionSlice.startDisplay);
					const selectionEndX = gutterRight + 2 + this.measureHighlightRange(highlight, slice.startDisplay, selectionSlice.endDisplay);
					api.rectfillColor(selectionStartX, rowY, selectionEndX, rowY + this.lineHeight, SELECTION_OVERLAY);
				}
				this.drawColoredText(api, slice.text, slice.colors, gutterRight + 2, rowY);
				if (lineIndex === this.cursorRow) {
					cursorHighlight = highlight;
					cursorSliceStart = slice.startDisplay;
				}
			} else {
				this.drawColoredText(api, '~', [COLOR_CODE_DIM], gutterRight + 2, rowY);
			}
		}

		if (this.cursorVisible && cursorHighlight) {
			this.drawCursor(api, gutterRight + 2, codeTop, cursorHighlight, cursorSliceStart);
		}
	}

	private drawSearchHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, highlight: HighlightLine, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
		if (this.searchMatches.length === 0 || this.searchQuery.length === 0) {
			return;
		}
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
			const startX = originX + this.measureHighlightRange(highlight, sliceStartDisplay, visibleStart);
			const endX = originX + this.measureHighlightRange(highlight, sliceStartDisplay, visibleEnd);
			const overlay = i === this.searchCurrentIndex ? SEARCH_MATCH_ACTIVE_OVERLAY : SEARCH_MATCH_OVERLAY;
			api.rectfillColor(startX, originY, endX, originY + this.lineHeight, overlay);
		}
	}

private drawCursor(api: BmsxConsoleApi, textX: number, codeTop: number, highlight: HighlightLine, sliceStartDisplay: number): void {
	const relativeRow = this.cursorRow - this.scrollRow;
	if (relativeRow < 0 || relativeRow >= this.visibleRowCount()) {
		return;
	}
	const line = this.currentLine();
	const columnToDisplay = highlight.columnToDisplay;
	const clampedColumn = Math.min(this.cursorColumn, columnToDisplay.length - 1);
	const cursorDisplayIndex = columnToDisplay[clampedColumn];
	const cursorX = textX + this.measureHighlightRange(highlight, sliceStartDisplay, cursorDisplayIndex);
	const cursorY = codeTop + relativeRow * this.lineHeight;
	let baseChar = ' ';
	let baseColor = COLOR_CODE_TEXT;
	let cursorWidth = this.charAdvance;
	if (cursorDisplayIndex < highlight.chars.length) {
		baseChar = highlight.chars[cursorDisplayIndex];
		baseColor = highlight.colors[cursorDisplayIndex];
		cursorWidth = this.font.getGlyph(baseChar).advance;
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
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			const color = colors[i] ?? COLOR_CODE_TEXT;
			const glyph = this.font.getGlyph(ch);
			for (let s = 0; s < glyph.segments.length; s++) {
				const segment = glyph.segments[s];
				const x0 = cursorX + segment.x;
				const x1 = x0 + segment.length;
				const y0 = cursorY + segment.y;
				api.rectfill(x0, y0, x1, y0 + 1, color);
			}
			cursorX += glyph.advance;
		}
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

	private measureHighlightRange(highlight: HighlightLine, startDisplay: number, endDisplay: number): number {
		let width = 0;
		const boundedEnd = Math.min(endDisplay, highlight.chars.length);
		for (let i = startDisplay; i < boundedEnd; i++) {
			const ch = highlight.chars[i];
			width += this.font.getGlyph(ch).advance;
		}
		return width;
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

	private highlightLine(line: string): HighlightLine {
		const length = line.length;
		const columnColors: number[] = new Array(length).fill(COLOR_CODE_TEXT);
		let i = 0;
		while (i < length) {
			const ch = line.charAt(i);
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

	private invertColorIndex(color: number): number {
		if (color === 0) return COLOR_CODE_TEXT;
		return 0;
	}

	private drawText(api: BmsxConsoleApi, text: string, originX: number, originY: number, color: number): void {
		let cursorX = Math.floor(originX);
		let cursorY = Math.floor(originY);
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (ch === '\n') {
				cursorX = Math.floor(originX);
				cursorY += this.lineHeight;
				continue;
			}
			if (ch === '\t') {
				cursorX += this.spaceAdvance * TAB_SPACES;
				continue;
			}
			const glyph = this.font.getGlyph(ch);
			for (let s = 0; s < glyph.segments.length; s++) {
				const segment = glyph.segments[s];
				const x0 = cursorX + segment.x;
				const x1 = x0 + segment.length;
				const y0 = cursorY + segment.y;
				api.rectfill(x0, y0, x1, y0 + 1, color);
			}
			cursorX += glyph.advance;
		}
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
			width += this.font.getGlyph(ch).advance;
		}
		return width;
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
		const columns = Math.floor(available / this.charAdvance);
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
		return state.justpressed === true;
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
		if (!state || !state.pressed) {
			this.repeatState.delete(code);
			return false;
		}
		let entry = this.repeatState.get(code);
		if (!entry) {
			entry = { cooldown: INITIAL_REPEAT_DELAY };
			this.repeatState.set(code, entry);
			if (state.justpressed) {
				return true;
			}
			return false;
		}
		if (state.justpressed) {
			entry.cooldown = INITIAL_REPEAT_DELAY;
			this.repeatState.set(code, entry);
			return true;
		}
		entry.cooldown -= deltaSeconds;
		if (entry.cooldown <= 0) {
			entry.cooldown = REPEAT_INTERVAL;
			this.repeatState.set(code, entry);
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
