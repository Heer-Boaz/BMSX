import { $ } from '../core/game';
import type { color } from '../render/shared/render_types';
import { Msx1Colors } from '../systems/msx';
import { ConsoleEditorFont } from './editor_font';
import type { ConsoleFontVariant } from './font';
import type { PlayerInput } from '../input/playerinput';
import type { KeyboardInput } from '../input/keyboardinput';
import { wrapRuntimeErrorLine } from './ide/runtime_error_utils';
import {
	createInlineTextField,
	applyInlineFieldEditing,
	type InlineFieldEditingHandlers,
	setFieldText,
	selectionRange,
	deleteSelection,
	insertValue,
} from './ide/inline_text_field';
import type { InlineInputOptions, InlineTextField, CursorScreenInfo, EditContext, LuaCompletionItem } from './ide/types';
import { INITIAL_REPEAT_DELAY, REPEAT_INTERVAL, TAB_SPACES } from './ide/constants';
import { EditorConsoleRenderBackend } from './render_backend';
import { renderInlineCaret, type CaretDrawOps } from './ide/render_caret';
import { ide_state } from './ide/ide_state';
import {
	isKeyJustPressed as isKeyJustPressedGlobal,
	isKeyTyped as isKeyTypedGlobal,
	shouldAcceptKeyPress as shouldAcceptKeyPressGlobal,
	clearKeyPressRecord,
} from './ide/input_helpers';
import { CompletionController, type CompletionRenderApi } from './ide/completion_controller';
import { collectLuaModuleAliases } from './ide/intellisense';
import type {
	ConsoleLuaBuiltinDescriptor,
	ConsoleLuaMemberCompletion,
	ConsoleLuaMemberCompletionRequest,
	ConsoleLuaSymbolEntry,
} from './types';
import { consumeIdeKey, getIdeKeyState } from './ide/player_input_adapter';
import type { asset_id } from '../rompack/rompack';

type ConsoleOutputKind = 'prompt' | 'stdout' | 'stderr' | 'system';

type ConsoleOutputEntry = {
	text: string;
	kind: ConsoleOutputKind;
};

type ConsoleModeOptions = {
	playerIndex: number;
	fontVariant?: ConsoleFontVariant;
	caseInsensitive?: boolean;
	maxEntries?: number;
	listLuaSymbols: (asset_id: string | null, chunkName: string | null) => ConsoleLuaSymbolEntry[];
	listGlobalLuaSymbols: () => ConsoleLuaSymbolEntry[];
	listLuaModuleSymbols: (moduleName: string) => ConsoleLuaSymbolEntry[];
	listBuiltinLuaFunctions: () => ConsoleLuaBuiltinDescriptor[];
	listLuaObjectMembers: (request: ConsoleLuaMemberCompletionRequest) => ConsoleLuaMemberCompletion[];
};

type CompletionMemberRequest = {
	objectName: string;
	operator: '.' | ':';
	prefix: string;
	asset_id: asset_id | null;
	chunkName: string | null;
};

type Viewport = { width: number; height: number };

const MAX_OUTPUT_ENTRIES = 512;
const MAX_HISTORY_ENTRIES = 256;
const PROMPT_TEXT = '> ';
// const PROMPT_GAP = 4;
const PADDING_X = 10;
const PADDING_Y = 10;
const PANEL_BACKGROUND_ALPHA = 0.72;
const CHARACTER_TILE_ALPHA = 1.0;
const CURSOR_BLINK_PERIOD = 0.8;
const ENABLE_PANEL_BACKDROP = false;

const OUTPUT_COLORS: Record<ConsoleOutputKind, number> = {
	prompt: 15,
	stdout: 15,
	stderr: 9,
	system: 11,
};

function cloneColor(source: color, alphaOverride?: number): color {
	return {
		r: source.r,
		g: source.g,
		b: source.b,
		a: typeof alphaOverride === 'number' ? alphaOverride : source.a ?? 1,
	};
}

function resolvePaletteColor(index: number, alpha?: number): color {
	const base = Msx1Colors[index] ?? Msx1Colors[15];
	return cloneColor(base, alpha ?? base.a ?? 1);
}

export class ConsoleMode {
	private readonly font: ConsoleEditorFont;
	private readonly caseInsensitive: boolean;
	private readonly maxEntries: number;
	private readonly playerIndex: number;
	private readonly listLuaSymbolsFn: (asset_id: string | null, chunkName: string | null) => ConsoleLuaSymbolEntry[];
	private readonly listGlobalLuaSymbolsFn: () => ConsoleLuaSymbolEntry[];
	private readonly listLuaModuleSymbolsFn: (moduleName: string) => ConsoleLuaSymbolEntry[];
	private readonly listBuiltinLuaFunctionsFn: () => ConsoleLuaBuiltinDescriptor[];
	private readonly listLuaObjectMembersFn: (request: ConsoleLuaMemberCompletionRequest) => ConsoleLuaMemberCompletion[];
	private readonly panelBackgroundColor = resolvePaletteColor(0, PANEL_BACKGROUND_ALPHA);
	private readonly characterBackgroundColor = { r: 0, g: 0, b: 0, a: CHARACTER_TILE_ALPHA } as color;
	private readonly caretColor = resolvePaletteColor(15);
	private readonly selectionColor = resolvePaletteColor(11, 0.55);
	private showBackdrop = ENABLE_PANEL_BACKDROP;
	private readonly field: InlineTextField = createInlineTextField();
	private readonly output: ConsoleOutputEntry[] = [];
	private readonly history: string[] = [];
	private historyIndex: number | null = null;
	private readonly editingRepeatState = new Map<string, number>();
	private readonly historyRepeatState = new Map<string, number>();
	private readonly completionRepeatState = new Map<string, number>();
	private readonly consoleChunkName = '<console>';
	private readonly completionContextToken = { chunk: this.consoleChunkName };
	private readonly completion: CompletionController;
	private blinkTimer = 0;
	private caretVisible = true;
	private active = false;
	private textVersion = 0;
	private cachedLines: string[] = [''];
	private cachedLinesVersion = -1;
	private cursorScreenInfo: CursorScreenInfo | null = null;
	private activeCompletionRenderer: EditorConsoleRenderBackend | null = null;

	constructor(options: ConsoleModeOptions) {
		this.font = new ConsoleEditorFont(options.fontVariant);
		this.caseInsensitive = options.caseInsensitive ?? true;
		this.maxEntries = options.maxEntries ?? MAX_OUTPUT_ENTRIES;
		this.playerIndex = options.playerIndex;
		this.listLuaSymbolsFn = options.listLuaSymbols;
		this.listGlobalLuaSymbolsFn = options.listGlobalLuaSymbols;
		this.listLuaModuleSymbolsFn = options.listLuaModuleSymbols;
		this.listBuiltinLuaFunctionsFn = options.listBuiltinLuaFunctions;
		this.listLuaObjectMembersFn = options.listLuaObjectMembers;
		this.completion = new CompletionController({
			getPlayerIndex: () => this.playerIndex,
			isCodeTabActive: () => this.active,
			getLines: () => this.getLinesSnapshot(),
			getCursorRow: () => this.getCursorPosition().row,
			getCursorColumn: () => this.getCursorPosition().column,
			setCursorPosition: (row, column) => { this.setCursorFromPosition(row, column); },
			setSelectionAnchor: (row, column) => { this.setSelectionAnchorFromPosition(row, column); },
			replaceSelectionWith: (text) => { this.replaceSelectionWithText(text); },
			updateDesiredColumn: () => { this.field.desiredColumn = this.field.cursor; },
			resetBlink: () => { this.resetBlink(); },
			revealCursor: () => {},
			measureText: (text) => this.measureRawText(text),
			drawText: (api, text, x, y, color) => { this.drawCompletionText(api, text, x, y, color); },
			getCursorScreenInfo: () => this.cursorScreenInfo,
			getLineHeight: () => this.font.lineHeight(),
			getSpaceAdvance: () => this.font.advance(' '),
			getActiveCodeTabContext: () => (this.active ? this.completionContextToken : null),
			resolveHoverasset_id: () => null,
			resolveHoverChunkName: () => this.consoleChunkName,
			listLuaSymbols: (asset_id, chunkName) => this.listLuaSymbolsFn(asset_id, chunkName),
			listGlobalLuaSymbols: () => this.listGlobalLuaSymbolsFn(),
			listLuaModuleSymbols: (moduleName) => this.listLuaModuleSymbolsFn(moduleName),
			listBuiltinLuaFunctions: () => this.listBuiltinLuaFunctionsFn(),
			getSemanticDefinitions: () => null,
			getLuaModuleAliases: () => this.buildConsoleModuleAliases(),
			getMemberCompletionItems: (request) => this.buildMemberCompletionItems(request),
			charAt: (row, column) => this.charAt(row, column),
			getTextVersion: () => this.textVersion,
			shouldFireRepeat: (_keyboard, code, deltaSeconds) => this.shouldRepeatKey(code, deltaSeconds, this.completionRepeatState),
		});
		this.completion.setEnterCommitsEnabled(true);
	}

	public setBackdropVisibility(enabled: boolean): void {
		this.showBackdrop = enabled;
	}

	public activate(): void {
		this.active = true;
		this.resetInputField('');
		this.historyIndex = null;
		this.editingRepeatState.clear();
		this.historyRepeatState.clear();
		this.completion.closeSession();
		this.blinkTimer = 0;
		this.caretVisible = true;
	}

	public deactivate(): void {
		this.active = false;
		this.editingRepeatState.clear();
		this.historyRepeatState.clear();
		this.completion.closeSession();
	}

	public get isActive(): boolean {
		return this.active;
	}

	public clearOutput(): void {
		this.output.length = 0;
	}

	public appendPromptEcho(command: string): void {
		this.appendEntry({ kind: 'prompt', text: `${PROMPT_TEXT}${command}` });
	}

	public appendStdout(text: string): void {
		this.appendEntry({ kind: 'stdout', text });
	}

	public appendStderr(text: string): void {
		this.appendEntry({ kind: 'stderr', text });
	}

	public appendSystemMessage(text: string): void {
		this.appendEntry({ kind: 'system', text });
	}

	private resolveKeyboardInput(playerInput: PlayerInput): KeyboardInput {
		const handler = playerInput.inputHandlers['keyboard'];
		if (!handler) {
			throw new Error('[ConsoleMode] Keyboard handler unavailable.');
		}
		return handler as KeyboardInput;
	}

	public update(deltaSeconds: number): void {
		if (!this.active) {
			return;
		}
		this.blinkTimer += deltaSeconds;
		if (this.blinkTimer >= CURSOR_BLINK_PERIOD) {
			this.blinkTimer -= CURSOR_BLINK_PERIOD;
		}
		this.caretVisible = this.blinkTimer < CURSOR_BLINK_PERIOD * 0.5;
		this.completion.processPending(deltaSeconds);
	}

	public handleInput(playerInput: PlayerInput, deltaSeconds: number): string | null {
		if (!this.active) {
			return null;
		}
		const modifiers = this.resolveModifiers(playerInput);
		const keyboard = this.resolveKeyboardInput(playerInput);
		if (this.completion.handleKeybindings(
			keyboard,
			deltaSeconds,
			modifiers.shift,
			modifiers.ctrl,
			modifiers.alt,
			modifiers.meta,
		)) {
			this.resetBlink();
			return null;
		}
		const options: InlineInputOptions = {
			ctrlDown: modifiers.ctrl,
			metaDown: modifiers.meta,
			shiftDown: modifiers.shift,
			altDown: modifiers.alt,
			deltaSeconds,
			allowSpace: true,
		};
		const handlers = this.createInlineHandlers();
		const historyHandled = this.handleHistoryNavigation(deltaSeconds, modifiers);
		if (historyHandled) {
			this.resetBlink();
		}
		const previousText = this.field.text;
		const previousCursor = this.field.cursor;
		const previousAnchor = this.field.selectionAnchor;
		const textChanged = applyInlineFieldEditing(this.field, options, handlers);
		if (textChanged) {
			const editContext = this.buildEditContext(previousText, this.field.text);
			this.handleTextMutation(previousText, editContext);
		} else if (previousCursor !== this.field.cursor || previousAnchor !== this.field.selectionAnchor) {
			this.completion.onCursorMoved();
		}
		const submit = this.trySubmitCommand(playerInput);
		if (submit !== null) {
			this.completion.closeSession();
		}
		return submit;
	}

	public draw(renderer: EditorConsoleRenderBackend, surface: Viewport): void {
		if (!this.active) {
			return;
		}
		const lineHeight = this.font.lineHeight();
		const contentWidth = Math.max(0, surface.width - PADDING_X * 2);

		// compute prompt layout and wrapped input segments
		const promptWidth = this.measureDisplayText(PROMPT_TEXT);
		const firstLineMax = Math.max(8, contentWidth - promptWidth);
		const otherLineMax = Math.max(8, contentWidth);
		const displayInput = this.toDisplayText(this.field.text);
		const inputWrap = this.wrapDisplayWithFirstWidth(displayInput, firstLineMax, otherLineMax);

		// space available for output lines above the input area
		const availableHeight = surface.height - PADDING_Y * 2 - (inputWrap.segments.length * lineHeight);
		const maxContentLines = Math.max(1, Math.floor(availableHeight / lineHeight));

		// build and clamp output lines
		const wrappedLines = this.buildWrappedLines(contentWidth, maxContentLines);
		const visibleStart = Math.max(0, wrappedLines.length - maxContentLines);
		const visibleLines = wrappedLines.slice(visibleStart);

		// draw backdrop sized to visible content + input area
		if (this.showBackdrop) {
			const panelHeight = visibleLines.length * lineHeight + inputWrap.segments.length * lineHeight;
			this.drawBackdrop(renderer, surface.width, panelHeight);
		}

		// draw visible output lines starting at top padding
		let y = PADDING_Y;
		for (const line of visibleLines) {
			const color = resolvePaletteColor(OUTPUT_COLORS[line.kind]);
			this.drawGlyphBackgrounds(renderer, line.text, PADDING_X, y);
			this.drawGlyphRun(renderer, line.text, PADDING_X, y, color);
			y += lineHeight;
		}

		// compute where input block starts (positioned right after visible output lines,
		// so the input moves upward as output fills the viewport — terminal-like behavior)
		const inputStartY = PADDING_Y + visibleLines.length * lineHeight;

		// draw prompt at the first input line then draw wrapped input lines (first segment after prompt)
		const promptColor = resolvePaletteColor(OUTPUT_COLORS.prompt);
		this.drawGlyphBackgrounds(renderer, PROMPT_TEXT, PADDING_X, inputStartY);
		this.drawGlyphRun(renderer, PROMPT_TEXT, PADDING_X, inputStartY, promptColor);

		// draw multi-line input (handles selection and caret)
		this.drawMultilineInput(renderer, PADDING_X, inputStartY, promptWidth, inputWrap);
		this.drawCompletionOverlays(renderer, surface, promptWidth);
	}

	public recordHistory(command: string): void {
		if (!command || command.trim().length === 0) {
			this.historyIndex = null;
			return;
		}
		this.history.push(command);
		if (this.history.length > MAX_HISTORY_ENTRIES) {
			this.history.shift();
		}
		this.historyIndex = null;
	}

	private appendEntry(entry: ConsoleOutputEntry): void {
		this.output.push(entry);
		if (this.output.length > this.maxEntries) {
			this.output.splice(0, this.output.length - this.maxEntries);
		}
	}

	private resolveModifiers(input: PlayerInput): { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean } {
		return input.getModifiersState();
	}

	private createInlineHandlers(): InlineFieldEditingHandlers {
		return {
			isKeyJustPressed: (code: string) => isKeyJustPressedGlobal(code),
			isKeyTyped: (code: string) => isKeyTypedGlobal(code),
			shouldFireRepeat: (code: string, deltaSeconds: number) => this.shouldRepeatKey(code, deltaSeconds, this.editingRepeatState),
			consumeKey: (code: string) => consumeIdeKey(code),
			readClipboard: () => ide_state.customClipboard,
			writeClipboard: (payload: string) => { this.writeClipboard(payload); },
			onClipboardEmpty: () => { console.warn('[BmsxConsoleMode] Clipboard is empty'); },
		};
	}

	private handleHistoryNavigation(deltaSeconds: number, modifiers: { ctrl: boolean; alt: boolean; meta: boolean }): boolean {
		if (modifiers.ctrl || modifiers.alt || modifiers.meta) {
			return false;
		}
		if (this.history.length === 0) {
			return false;
		}
		if (this.shouldRepeatKey('ArrowUp', deltaSeconds, this.historyRepeatState)) {
			this.recallHistory(-1);
			consumeIdeKey('ArrowUp');
			return true;
		}
		if (this.shouldRepeatKey('ArrowDown', deltaSeconds, this.historyRepeatState)) {
			this.recallHistory(1);
			consumeIdeKey('ArrowDown');
			return true;
		}
		return false;
	}

	private recallHistory(direction: -1 | 1): void {
		if (this.history.length === 0) {
			return;
		}
		if (this.historyIndex === null) {
			this.historyIndex = this.history.length;
		}
		this.historyIndex = Math.min(this.history.length, Math.max(0, this.historyIndex + direction));
		if (this.historyIndex === this.history.length) {
			this.resetInputField('');
			return;
		}
		const entry = this.history[this.historyIndex];
		this.resetInputField(entry);
	}

	private trySubmitCommand(playerInput: PlayerInput): string | null {
		const playerIndex = playerInput.playerIndex;
		const enterPressed = isKeyJustPressedGlobal('Enter') || isKeyJustPressedGlobal('NumpadEnter');
		if (!enterPressed) {
			return null;
		}
		consumeIdeKey('Enter', playerIndex);
		consumeIdeKey('NumpadEnter', playerIndex);
		const command = this.field.text.trimEnd();
		if (command.length === 0) {
			this.resetBlink();
			return null;
		}
		this.resetInputField('');
		this.resetBlink();
		return command;
	}

	private resetInputField(value: string): void {
		const previous = this.field.text;
		setFieldText(this.field, value, true);
		this.onExternalFieldMutation(previous, value);
	}

	private resetBlink(): void {
		this.blinkTimer = 0;
		this.caretVisible = true;
	}

	private buildWrappedLines(maxWidth: number, maxLines: number): Array<{ text: string; kind: ConsoleOutputKind }> {
		const lines: Array<{ text: string; kind: ConsoleOutputKind }> = [];
		for (let i = 0; i < this.output.length; i += 1) {
			const entry = this.output[i];
			const segments = this.wrapText(entry.text, maxWidth);
			for (let j = 0; j < segments.length; j += 1) {
				lines.push({ text: segments[j], kind: entry.kind });
			}
		}
		if (lines.length > maxLines) {
			return lines.slice(lines.length - maxLines);
		}
		return lines;
	}

	private wrapText(text: string, maxWidth: number): string[] {
		if (text.length === 0) {
			return [''];
		}
		const normalized = this.toDisplayText(text);
		return wrapRuntimeErrorLine(normalized, Math.max(8, maxWidth), (value) => this.measureDisplayText(value));
	}

	private writeClipboard(payload: string): void {
		ide_state.customClipboard = payload;
		void $.platform.clipboard.writeText(payload).catch(() => { console.warn('[BmsxConsoleMode] Failed to write to clipboard'); });
	}

	private shouldRepeatKey(code: string, deltaSeconds: number, state: Map<string, number>): boolean {
		const buttonState = getIdeKeyState(code);
		if (!buttonState || buttonState.pressed !== true) {
			state.delete(code);
			clearKeyPressRecord(code);
			return false;
		}
		let cooldown = state.get(code);
		if (cooldown === undefined) {
			cooldown = INITIAL_REPEAT_DELAY;
			state.set(code, cooldown);
		}
		if (shouldAcceptKeyPressGlobal(code, buttonState)) {
			state.set(code, INITIAL_REPEAT_DELAY);
			return true;
		}
		const nextCooldown = cooldown - deltaSeconds;
		if (nextCooldown <= 0) {
			state.set(code, REPEAT_INTERVAL);
			return true;
		}
		state.set(code, nextCooldown);
		return false;
	}

	private getLinesSnapshot(): string[] {
		if (this.cachedLinesVersion !== this.textVersion) {
			this.cachedLines = this.field.text.split('\n');
			this.cachedLinesVersion = this.textVersion;
		}
		if (this.cachedLines.length === 0) {
			this.cachedLines = [''];
		}
		return this.cachedLines;
	}

	private getCursorPosition(): { row: number; column: number } {
		const lines = this.getLinesSnapshot();
		let remaining = this.field.cursor;
		for (let row = 0; row < lines.length; row += 1) {
			const line = lines[row];
			if (remaining <= line.length) {
				return { row, column: remaining };
			}
			remaining -= line.length + 1;
		}
		const lastRow = Math.max(0, lines.length - 1);
		return { row: lastRow, column: lines[lastRow]?.length ?? 0 };
	}

	private positionToIndex(row: number, column: number): number {
		const lines = this.getLinesSnapshot();
		let index = 0;
		for (let current = 0; current < row && current < lines.length; current += 1) {
			index += lines[current].length + 1;
		}
		const targetRow = Math.min(row, lines.length - 1);
		const rowText = lines[targetRow] ?? '';
		const clampedColumn = Math.max(0, Math.min(column, rowText.length));
		return index + clampedColumn;
	}

	private setCursorFromPosition(row: number, column: number): void {
		const index = this.positionToIndex(row, column);
		this.field.cursor = index;
		this.field.desiredColumn = index;
		this.field.selectionAnchor = null;
		this.completion.onCursorMoved();
	}

	private setSelectionAnchorFromPosition(row: number, column: number): void {
		this.field.selectionAnchor = this.positionToIndex(row, column);
		this.completion.onCursorMoved();
	}

	private replaceSelectionWithText(text: string): void {
		const previous = this.field.text;
		deleteSelection(this.field);
		if (text.length > 0) {
			insertValue(this.field, text);
		}
		const context = text.length > 0 ? { kind: 'insert', text } as EditContext : this.buildEditContext(previous, this.field.text);
		this.handleTextMutation(previous, context);
	}

	private buildEditContext(previous: string, next: string): EditContext | null {
		if (previous === next) {
			return null;
		}
		let start = 0;
		while (start < previous.length && start < next.length && previous.charAt(start) === next.charAt(start)) {
			start += 1;
		}
		let endPrev = previous.length;
		let endNext = next.length;
		while (endPrev > start && endNext > start && previous.charAt(endPrev - 1) === next.charAt(endNext - 1)) {
			endPrev -= 1;
			endNext -= 1;
		}
		if (next.length >= previous.length) {
			const inserted = next.slice(start, endNext);
			return inserted.length > 0 ? { kind: 'insert', text: inserted } : null;
		}
		const deleted = previous.slice(start, endPrev);
		return deleted.length > 0 ? { kind: 'delete', text: deleted } : null;
	}

	private handleTextMutation(previousText: string | null, editContext: EditContext | null): void {
		if (this.caseInsensitive) {
			const normalized = this.normalizeInputCase(this.field.text);
			if (normalized !== this.field.text) {
				this.field.text = normalized;
			}
		}
		const context = previousText !== null ? this.buildEditContext(previousText, this.field.text) : editContext;
		this.textVersion += 1;
		this.cachedLinesVersion = -1;
		this.completion.updateAfterEdit(context);
		this.completion.onCursorMoved();
	}

	private onExternalFieldMutation(previous: string, next: string): void {
		if (previous === next) {
			return;
		}
		this.handleTextMutation(previous, null);
	}

	private charAt(row: number, column: number): string {
		const lines = this.getLinesSnapshot();
		if (row < 0 || row >= lines.length) {
			return '';
		}
		const line = lines[row];
		if (column < 0 || column >= line.length) {
			return '';
		}
		return line.charAt(column);
	}

	private measureRawText(text: string): number {
		if (!text) {
			return 0;
		}
		const normalized = this.caseInsensitive && this.font.getVariant() === 'tiny' ? text.toUpperCase() : text;
		return this.font.measure(normalized);
	}

	private normalizeInputCase(text: string): string {
		if (!this.caseInsensitive) {
			return text;
		}
		let inString = false;
		let quote: string | null = null;
		let escapeNext = false;
		let needsNormalization = false;
		for (let i = 0; i < text.length; i += 1) {
			const ch = text.charAt(i);
			if (inString) {
				if (escapeNext) {
					escapeNext = false;
					continue;
				}
				if (ch === '\\') {
					escapeNext = true;
					continue;
				}
				if (ch === quote) {
					inString = false;
					quote = null;
				}
				continue;
			}
			if (ch === '"' || ch === '\'') {
				inString = true;
				quote = ch;
				continue;
			}
			if (ch !== ch.toLowerCase()) {
				needsNormalization = true;
				break;
			}
		}
		if (!needsNormalization) {
			return text;
		}
		let result = '';
		inString = false;
		quote = null;
		escapeNext = false;
		for (let i = 0; i < text.length; i += 1) {
			const ch = text.charAt(i);
			if (inString) {
				result += ch;
				if (escapeNext) {
					escapeNext = false;
					continue;
				}
				if (ch === '\\') {
					escapeNext = true;
					continue;
				}
				if (ch === quote) {
					inString = false;
					quote = null;
				}
				continue;
			}
			if (ch === '"' || ch === '\'') {
				inString = true;
				quote = ch;
				result += ch;
				continue;
			}
			result += ch.toLowerCase();
		}
		return result;
	}

	private drawCompletionText(_api: CompletionRenderApi, text: string, x: number, y: number, colorIndex: number): void {
		const renderer = this.activeCompletionRenderer;
		if (!renderer) {
			return;
		}
		const renderFont = this.font.getRenderFont();
		renderer.drawText({ kind: 'print', text, x, y, color: resolvePaletteColor(colorIndex) }, renderFont);
	}

	private createCompletionRenderApi(renderer: EditorConsoleRenderBackend): CompletionRenderApi {
		return {
			rect: (x0, y0, x1, y1, colorIndex) => renderer.drawRect({
				kind: 'rect',
				x0,
				y0,
				x1,
				y1,
				color: resolvePaletteColor(colorIndex),
			}),
			rectfill: (x0, y0, x1, y1, colorIndex) => renderer.drawRect({
				kind: 'fill',
				x0,
				y0,
				x1,
				y1,
				color: resolvePaletteColor(colorIndex),
			}),
		};
	}

	private drawCompletionOverlays(renderer: EditorConsoleRenderBackend, surface: Viewport, promptWidth: number): void {
		this.activeCompletionRenderer = renderer;
		const api = this.createCompletionRenderApi(renderer);
		const bounds = {
			codeTop: PADDING_Y,
			codeBottom: surface.height - PADDING_Y,
			codeLeft: PADDING_X,
			codeRight: surface.width - PADDING_X,
			textLeft: PADDING_X + promptWidth,
		};
		this.completion.drawCompletionPopup(api, bounds);
		this.completion.drawParameterHintOverlay(api, bounds);
		this.activeCompletionRenderer = null;
	}

	private buildConsoleModuleAliases(): Map<string, string> {
		if (this.field.text.trim().length === 0) {
			return new Map();
		}
		return collectLuaModuleAliases({ source: this.field.text, chunkName: this.consoleChunkName });
	}

	private buildMemberCompletionItems(request: CompletionMemberRequest): LuaCompletionItem[] {
		if (request.objectName.length === 0) {
			return [];
		}
		const response = this.listLuaObjectMembersFn({
			asset_id: request.asset_id,
			chunkName: request.chunkName,
			expression: request.objectName,
			operator: request.operator,
		});
		if (response.length === 0) {
			return [];
		}
		const items: LuaCompletionItem[] = [];
		for (let index = 0; index < response.length; index += 1) {
			const entry = response[index];
			if (!entry || entry.name.length === 0) {
				continue;
			}
			const kind = entry.kind === 'method' ? 'native_method' : 'native_property';
			const parameters = entry.parameters.length > 0 ? entry.parameters.slice() : undefined;
			items.push({
				label: entry.name,
				insertText: entry.name,
				sortKey: `${kind}:${entry.name.toLowerCase()}`,
				kind,
				detail: entry.detail ?? null,
				parameters,
			});
		}
		items.sort((a, b) => a.label.localeCompare(b.label));
		return items;
	}

	// New helper: wraps display text with a smaller first-line width (after prompt) and full width for following lines.
	private wrapDisplayWithFirstWidth(text: string, firstWidth: number, otherWidth: number): { segments: string[]; starts: number[] } {
		const segments: string[] = [];
		const starts: number[] = [];
		let current = '';
		let currentWidth = 0;
		let widthLimit = firstWidth;
		let segStart = 0;

		for (let i = 0; i < text.length; i += 1) {
			const ch = text.charAt(i);
			// treat newline as explicit break
			if (ch === '\n') {
				segments.push(current);
				starts.push(segStart);
				current = '';
				currentWidth = 0;
				segStart = i + 1;
				widthLimit = otherWidth;
				continue;
			}
			const adv = ch === '\t' ? this.font.advance(' ') * TAB_SPACES : this.font.advance(ch);
			if (currentWidth + adv > widthLimit) {
				if (current.length > 0) {
					segments.push(current);
					starts.push(segStart);
					current = ch;
					currentWidth = adv;
					segStart = i;
				} else {
					segments.push(ch);
					starts.push(i);
					current = '';
					currentWidth = 0;
					segStart = i + 1;
				}
				widthLimit = otherWidth;
				continue;
			}
			current += ch;
			currentWidth += adv;
		}
		if (current.length > 0 || text.endsWith('\n')) {
			segments.push(current);
			starts.push(segStart);
		}
		// ensure at least one segment
		if (segments.length === 0) {
			segments.push('');
			starts.push(0);
		}
		return { segments, starts };
	}

	// Replace single-line drawInputField with multi-line aware renderer
	private drawMultilineInput(renderer: EditorConsoleRenderBackend, baseX: number, baseY: number, promptWidth: number, wrap: { segments: string[]; starts: number[] }): void {
		const inputColor = resolvePaletteColor(OUTPUT_COLORS.stdout);
		const sel = selectionRange(this.field);
		const cursorIndex = this.field.cursor;
		const displayText = this.toDisplayText(this.field.text);
		let nextCursorInfo: CursorScreenInfo | null = null;
		const cursorPosition = this.getCursorPosition();

		for (let si = 0; si < wrap.segments.length; si += 1) {
			const seg = wrap.segments[si];
			const segStart = wrap.starts[si];
			const segLen = seg.length;
			const y = baseY + si * this.font.lineHeight();
			let x = baseX;
			// first segment is placed after the prompt
			if (si === 0) {
				x += promptWidth;
			}

			// draw glyph backgrounds before overlays/text so selection remains visible
			this.drawGlyphBackgrounds(renderer, seg, x, y);

			// draw selection background for this segment if selection overlaps
			if (sel) {
				const selStart = Math.max(sel.start, segStart);
				const selEnd = Math.min(sel.end, segStart + segLen);
				if (selStart < selEnd) {
					const before = displayText.slice(segStart, selStart);
					const selected = displayText.slice(selStart, selEnd);
					const startWidth = this.measureDisplayText(before);
					const selWidth = this.measureDisplayText(selected);
					renderer.drawRect({
						kind: 'fill',
						x0: x + startWidth,
						y0: y,
						x1: x + startWidth + selWidth,
						y1: y + this.font.lineHeight(),
						color: this.selectionColor,
					});
				}
			}

			// draw the glyph run for this segment
			this.drawGlyphRun(renderer, seg, x, y, inputColor);

			// caret rendering: use shared caret style from console_cart_editor
			const segEnd = segStart + segLen;
			const isLastSegment = si === wrap.segments.length - 1;
			const caretInSeg = cursorIndex >= segStart && (cursorIndex < segEnd || (isLastSegment && cursorIndex === segEnd));
			if (caretInSeg) {
				const local = displayText.slice(segStart, cursorIndex);
				const caretOffset = this.measureDisplayText(local);
				const nextChar = cursorIndex < displayText.length ? displayText.charAt(cursorIndex) : ' ';
				const caretWidth = this.font.advance(nextChar);
				const left = Math.floor(x + caretOffset);
				const topY = y;
				const right = left + Math.max(1, Math.floor(caretWidth));
				const bottom = topY + this.font.lineHeight();
				nextCursorInfo = {
					row: cursorPosition.row,
					column: cursorPosition.column,
					x: left,
					y: topY,
					width: Math.max(1, Math.floor(caretWidth)),
					height: this.font.lineHeight(),
					baseChar: nextChar,
					baseColor: OUTPUT_COLORS.stdout,
				};
				if (this.caretVisible) {
					const renderFont = this.font.getRenderFont();
					const ops: CaretDrawOps = {
						fillRect: (x0, y0, x1, y1, color) => renderer.drawRect({ kind: 'fill', x0, y0, x1, y1, color }),
						strokeRect: (x0, y0, x1, y1, color) => renderer.drawRect({ kind: 'rect', x0, y0, x1, y1, color }),
						drawGlyph: (text, gx, gy, color) => renderer.drawText({ kind: 'print', text, x: gx, y: gy, color }, renderFont),
					};
					renderInlineCaret(ops, left, topY, right, bottom, left, true, this.caretColor, nextChar, this.characterBackgroundColor);
				}
			}
		}

		if (nextCursorInfo) {
			this.cursorScreenInfo = nextCursorInfo;
		}
	}

	private drawGlyphBackgrounds(renderer: EditorConsoleRenderBackend, text: string, originX: number, originY: number): void {
		const display = this.toDisplayText(text);
		let cursorX = originX;
		for (let i = 0; i < display.length; i += 1) {
			const ch = display.charAt(i);
			if (ch === '\t') {
				cursorX += this.font.advance(' ') * TAB_SPACES;
				continue;
			}
			if (ch === '\n') {
				continue;
			}
			const advance = this.font.advance(ch);
			renderer.drawRect({
				kind: 'fill',
				x0: cursorX,
				y0: originY,
				x1: cursorX + advance,
				y1: originY + this.font.lineHeight(),
				color: this.characterBackgroundColor,
			});
			cursorX += advance;
		}
	}

	private drawGlyphRun(renderer: EditorConsoleRenderBackend, text: string, originX: number, originY: number, tint: color): void {
		const renderFont = this.font.getRenderFont();
		const display = this.toDisplayText(text);
		let cursorX = originX;
		for (let i = 0; i < display.length; i += 1) {
			const ch = display.charAt(i);
			if (ch === '\t') {
				cursorX += this.font.advance(' ') * TAB_SPACES;
				continue;
			}
			if (ch === '\n') {
				continue;
			}
			const advance = this.font.advance(ch);
			if (ch !== ' ') {
				renderer.drawText({ kind: 'print', text: ch, x: cursorX, y: originY, color: tint }, renderFont);
			}
			cursorX += advance;
		}
	}

	private drawBackdrop(renderer: EditorConsoleRenderBackend, surfaceWidth: number, contentHeight: number): void {
		const padding = 6;
		const x0 = Math.max(0, PADDING_X - padding);
		const x1 = Math.max(x0 + 1, surfaceWidth - PADDING_X + padding);
		const y0 = Math.max(0, PADDING_Y - padding);
		const y1 = Math.max(y0 + 1, y0 + contentHeight + padding * 2);
		renderer.drawRect({
			kind: 'fill',
			x0,
			y0,
			x1,
			y1,
			color: this.panelBackgroundColor,
		});
	}

	private toDisplayText(value: string): string {
		if (this.caseInsensitive && this.font.getVariant() === 'tiny') {
			return value.toUpperCase();
		}
		return value;
	}

	private measureDisplayText(value: string): number {
		if (!value) {
			return 0;
		}
		// Match renderer/tab handling: expand tabs to TAB_SPACES spaces before measuring
		const display = this.toDisplayText(value).replace(/\t/g, ' '.repeat(TAB_SPACES));
		return this.font.measure(display);
	}
}
