import { $ } from '../core/game';
import type { KeyboardInput } from '../input/keyboardinput';
import type { ButtonState } from '../input/inputtypes';
import type { BmsxConsoleApi } from './api';
import type { BmsxConsoleMetadata, ConsoleViewport } from './types';
import { ConsoleEditorFont } from './editor_font';

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

const TAB_SPACES = 2;
const INITIAL_REPEAT_DELAY = 0.28;
const REPEAT_INTERVAL = 0.05;
const CURSOR_BLINK_INTERVAL = 0.45;

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
const COLOR_CURSOR = 7;
const HIGHLIGHT_OVERLAY = { r: 1, g: 0.6, b: 0.2, a: 0.35 };
const COLOR_STATUS_BACKGROUND = 8;
const COLOR_STATUS_TEXT = 15;
const COLOR_STATUS_WARNING = 9;
const COLOR_STATUS_SUCCESS = 10;

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
		'PageDown',
		'PageUp',
		'Space',
		'Tab',
	];

	private static readonly KEYWORDS = new Set([
		'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
	]);

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
		this.handleEditorInput(keyboard, deltaSeconds);
		this.ensureCursorVisible();
	}

	public draw(api: BmsxConsoleApi): void {
		if (!this.active) {
			return;
		}
		api.cls(COLOR_FRAME);
		this.drawTopBar(api);
		this.drawCodeArea(api);
		this.drawStatusBar(api);
	}

	public shutdown(): void {
		this.applyInputOverrides(false);
		this.active = false;
		this.repeatState.clear();
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
	this.repeatState.clear();
	this.updateDesiredColumn();
	}

	private deactivate(): void {
		this.active = false;
		this.repeatState.clear();
		this.applyInputOverrides(false);
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
		const altDown = this.isModifierPressed(keyboard, 'AltLeft') || this.isModifierPressed(keyboard, 'AltRight');

		if (ctrlDown && this.isKeyJustPressed(keyboard, 'KeyS')) {
			this.consumeKey(keyboard, 'KeyS');
			this.save();
			return;
		}

		this.handleNavigationKeys(keyboard, deltaSeconds, shiftDown, ctrlDown);
		if (ctrlDown || altDown) {
			return;
		}
		this.handleEditingKeys(keyboard, deltaSeconds, shiftDown);
		this.handleCharacterInput(keyboard, shiftDown);
		if (this.isKeyJustPressed(keyboard, 'Space')) {
			this.insertText(' ');
			this.consumeKey(keyboard, 'Space');
		}
	}

	private handleNavigationKeys(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean): void {
		if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
			this.moveCursorVertical(-1);
			this.consumeKey(keyboard, 'ArrowUp');
		}
		if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
			this.moveCursorVertical(1);
			this.consumeKey(keyboard, 'ArrowDown');
		}
		if (ctrlDown) {
			if (this.shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) {
				this.moveWordLeft();
				this.consumeKey(keyboard, 'ArrowLeft');
			}
			if (this.shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) {
				this.moveWordRight();
				this.consumeKey(keyboard, 'ArrowRight');
			}
		}
		else {
			if (this.shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) {
				this.moveCursorHorizontal(-1);
				this.consumeKey(keyboard, 'ArrowLeft');
			}
			if (this.shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) {
				this.moveCursorHorizontal(1);
				this.consumeKey(keyboard, 'ArrowRight');
			}
		}
		if (this.isKeyJustPressed(keyboard, 'Home')) {
			this.cursorColumn = 0;
			this.updateDesiredColumn();
			this.resetBlink();
			this.consumeKey(keyboard, 'Home');
		}
		if (this.isKeyJustPressed(keyboard, 'End')) {
			this.cursorColumn = this.currentLine().length;
			this.updateDesiredColumn();
			this.resetBlink();
			this.consumeKey(keyboard, 'End');
		}
		if (this.isKeyJustPressed(keyboard, 'PageUp')) {
			const rows = this.visibleRowCount();
			this.cursorRow = Math.max(0, this.cursorRow - rows);
			const lineLength = this.currentLine().length;
			const targetColumn = Math.max(0, Math.min(lineLength, Math.floor(this.desiredColumn)));
			this.cursorColumn = targetColumn;
			this.resetBlink();
			this.consumeKey(keyboard, 'PageUp');
		}
		if (this.isKeyJustPressed(keyboard, 'PageDown')) {
			const rows = this.visibleRowCount();
			this.cursorRow = Math.min(this.lines.length - 1, this.cursorRow + rows);
			const lineLength = this.currentLine().length;
			const targetColumn = Math.max(0, Math.min(lineLength, Math.floor(this.desiredColumn)));
			this.cursorColumn = targetColumn;
			this.resetBlink();
			this.consumeKey(keyboard, 'PageDown');
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
		const line = this.currentLine();
		const before = line.slice(0, this.cursorColumn);
		const after = line.slice(this.cursorColumn);
	this.lines[this.cursorRow] = before + text + after;
	this.cursorColumn += text.length;
	this.dirty = true;
	this.resetBlink();
	this.updateDesiredColumn();
}

	private insertLineBreak(): void {
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
		if (this.cursorColumn > 0) {
			const line = this.currentLine();
			const before = line.slice(0, this.cursorColumn - 1);
			const after = line.slice(this.cursorColumn);
			this.lines[this.cursorRow] = before + after;
			this.cursorColumn -= 1;
			this.dirty = true;
			this.resetBlink();
			this.updateDesiredColumn();
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
	}

	private deleteForward(): void {
		const line = this.currentLine();
		if (this.cursorColumn < line.length) {
			const before = line.slice(0, this.cursorColumn);
			const after = line.slice(this.cursorColumn + 1);
			this.lines[this.cursorRow] = before + after;
			this.dirty = true;
			this.updateDesiredColumn();
			return;
		}
		if (this.cursorRow >= this.lines.length - 1) {
			return;
		}
		const nextLine = this.lines[this.cursorRow + 1];
		this.lines[this.cursorRow] = line + nextLine;
		this.lines.splice(this.cursorRow + 1, 1);
		this.dirty = true;
		this.updateDesiredColumn();
	}

	private unindentCurrentLine(): void {
		const line = this.currentLine();
		let newColumn = this.cursorColumn;
		let removed = false;
		while (newColumn > 0) {
			const ch = line.charAt(newColumn - 1);
			if (ch === '\t') {
				newColumn -= 1;
				removed = true;
				break;
			}
			if (ch === ' ') {
				let spacesRemoved = 0;
				while (spacesRemoved < TAB_SPACES && newColumn > 0 && line.charAt(newColumn - 1) === ' ') {
					newColumn -= 1;
					spacesRemoved += 1;
					removed = true;
				}
				break;
			}
			break;
		}
		if (!removed) {
			return;
		}
		const before = line.slice(0, newColumn);
		const after = line.slice(this.cursorColumn);
		this.lines[this.cursorRow] = before + after;
		this.cursorColumn = newColumn;
		this.dirty = true;
		this.resetBlink();
		this.updateDesiredColumn();
	}

	private save(): void {
		const source = this.lines.join('\n');
		try {
			this.reloadSourceFn(source);
			this.dirty = false;
			this.showMessage('Lua cart reloaded.', COLOR_STATUS_SUCCESS, 2.5);
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

	private drawCodeArea(api: BmsxConsoleApi): void {
		const codeTop = this.topMargin;
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

	private drawCursor(api: BmsxConsoleApi, textX: number, codeTop: number, highlight: HighlightLine, sliceStartDisplay: number): void {
		const relativeRow = this.cursorRow - this.scrollRow;
		if (relativeRow < 0 || relativeRow >= this.visibleRowCount()) {
			return;
		}
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
		api.rectfill(cursorX, cursorY, cursorX + cursorWidth, cursorY + this.lineHeight, COLOR_CURSOR);
		this.drawColoredText(api, baseChar, [baseColor], cursorX, cursorY);
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

	private measureHighlightRange(highlight: HighlightLine, startDisplay: number, endDisplay: number): number {
		let width = 0;
		const boundedEnd = Math.min(endDisplay, highlight.chars.length);
		for (let i = startDisplay; i < boundedEnd; i++) {
			const ch = highlight.chars[i];
			width += this.font.getGlyph(ch).advance;
		}
		return width;
	}

	private drawStatusBar(api: BmsxConsoleApi): void {
		const statusTop = this.viewportHeight - this.bottomMargin;
		const statusBottom = this.viewportHeight;
		api.rectfill(0, statusTop, this.viewportWidth, statusBottom, COLOR_STATUS_BACKGROUND);

		const lineInfo = `LINE ${this.cursorRow + 1}/${this.lines.length}`;
		const charInfo = `${this.countCharacters()}/8192`;
		this.drawText(api, lineInfo, 4, statusTop + 2, COLOR_STATUS_TEXT);
		this.drawText(api, charInfo, this.viewportWidth - this.measureText(charInfo) - 4, statusTop + 2, COLOR_STATUS_TEXT);

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
		const available = this.viewportHeight - this.topMargin - this.bottomMargin;
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

	private getButtonState(keyboard: KeyboardInput, code: string): ButtonState | null {
		const state = keyboard.gamepadButtonStates[code];
		return state ?? null;
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

	private countCharacters(): number {
		let total = 0;
		for (let i = 0; i < this.lines.length; i++) {
			total += this.lines[i].length;
		}
		return total;
	}
}
