import type { color } from '../render/shared/render_types';
import { Msx1Colors } from '../systems/msx';
import { EditorFont } from './editor_font';
import type { FontVariant } from './font';
import { invalidateLuaCommentContextFromRow, wrapOverlayLine, applyCaseOutsideStrings } from './ide/text_utils';
import {
	createInlineTextField,
	applyInlineFieldEditing,
	setFieldText,
	selectionRange,
	deleteSelection,
	insertValue,
	getFieldText,
	getCursorOffset,
	setCursorFromOffset,
	selectionAnchorOffset,
	setSelectionAnchorFromOffset,
} from './ide/inline_text_field';
import type { InlineInputOptions, TextField, CursorScreenInfo, CompletionContext, EditContext, LuaCompletionItem } from './ide/types';
import { COLOR_COMPLETION_BACKGROUND, COLOR_COMPLETION_BORDER, COLOR_COMPLETION_HIGHLIGHT, COLOR_COMPLETION_HIGHLIGHT_TEXT, COLOR_COMPLETION_PREVIEW_TEXT, COLOR_COMPLETION_TEXT, TAB_SPACES } from './ide/constants';
import { RenderFacade } from './render_facade';
import { renderInlineCaret, type CaretDrawOps } from './ide/render/render_caret';
import {
	isKeyJustPressed as isKeyJustPressed,
	isCtrlDown,
	isShiftDown,
	isMetaDown,
	isAltDown
} from './ide/ide_input';
import { CompletionController } from './ide/completion_controller';
import { collectLuaModuleAliases, listLuaObjectMembers, resolveSnapshotExpression, describeLuaValueForInspector } from './ide/intellisense';
import { consumeIdeKey, shouldRepeatKeyFromPlayer } from './ide/ide_input';
import type { Viewport } from '../rompack/rompack';
import { Runtime } from './runtime';
import * as runtimeLuaPipeline from './runtime_lua_pipeline';
import { TerminalCommandDispatcher as TerminalCommandDispatcher } from './terminal_commands';
import { extractErrorMessage } from '../lua/luavalue';
import { valueToString } from './lua_globals';
import type { Value } from './cpu';
import { LuaMemberCompletionRequest, SymbolEntry } from './types';
import type { MutableTextPosition, TextBuffer } from './ide/text/text_buffer';
import { clamp } from '../utils/clamp';

type TerminalOutputKind =
	| 'prompt'
	| 'stdout'
	| 'stdout_saved'
	| 'stdout_dirty'
	| 'stdout_saved_dirty'
	| 'stderr'
	| 'system';

type TerminalOutputEntry = {
	text: string;
	color: number;
};

type TerminalSymbolPanelMode = 'browse' | 'complete';

type TerminalSymbolQueryContext = {
	prefix: string;
	replaceStart: number;
	replaceEnd: number;
};

type TerminalSymbolPanelState = {
	mode: TerminalSymbolPanelMode;
	entries: SymbolEntry[];
	filtered: SymbolEntry[];
	filter: string;
	selectionIndex: number;
	displayRowOffset: number;
	queryStart: number;
	queryEnd: number;
	originalText: string;
	originalCursor: number;
};

type TerminalSymbolGridLayout = {
	columns: number;
	rows: number;
	cellWidth: number;
	gap: number;
	visibleRows: number;
	paddingX: number;
	paddingY: number;
};

type TerminalCompletionPanelState = {
	entries: LuaCompletionItem[];
	filtered: LuaCompletionItem[];
	filter: string;
	selectionIndex: number;
	displayRowOffset: number;
	context: CompletionContext;
	originalText: string;
	originalCursor: number;
};

class InlineFieldTextBuffer implements TextBuffer {
	public constructor(
		private readonly getLines: () => readonly string[],
		private readonly getVersion: () => number,
	) { }

	public get version(): number {
		return this.getVersion();
	}

	public get length(): number {
		const lines = this.getLines();
		if (lines.length === 0) {
			return 0;
		}
		let total = 0;
		for (let row = 0; row < lines.length; row += 1) {
			total += lines[row].length;
		}
		return total + (lines.length - 1);
	}

	public charCodeAt(offset: number): number {
		let remaining = offset;
		const lines = this.getLines();
		for (let row = 0; row < lines.length; row += 1) {
			const line = lines[row];
			if (remaining < line.length) {
				return line.charCodeAt(remaining);
			}
			if (remaining === line.length) {
				if (row < lines.length - 1) {
					return 10;
				}
				return NaN;
			}
			remaining -= line.length + 1;
		}
		return NaN;
	}

	public insert(): void {
		throw new Error('[InlineFieldTextBuffer] insert not supported');
	}

	public delete(): void {
		throw new Error('[InlineFieldTextBuffer] delete not supported');
	}

	public replace(): void {
		throw new Error('[InlineFieldTextBuffer] replace not supported');
	}

	public getLineCount(): number {
		return this.getLines().length;
	}

	public getLineStartOffset(row: number): number {
		const lines = this.getLines();
		let offset = 0;
		for (let index = 0; index < row; index += 1) {
			offset += lines[index].length + 1;
		}
		return offset;
	}

	public getLineEndOffset(row: number): number {
		return this.getLineStartOffset(row) + this.getLineContent(row).length;
	}

		public getLineContent(row: number): string {
			return this.getLines()[row] ?? '';
		}

		public getLineSignature(row: number): number {
			const line = this.getLineContent(row);
			let hash = 2166136261;
			for (let i = 0; i < line.length; i += 1) {
				hash = Math.imul(hash ^ line.charCodeAt(i), 16777619) >>> 0;
			}
			return hash;
		}

		public offsetAt(row: number, column: number): number {
			return this.getLineStartOffset(row) + column;
		}

	public positionAt(offset: number, out: MutableTextPosition): void {
		let remaining = offset;
		const lines = this.getLines();
		for (let row = 0; row < lines.length; row += 1) {
			const lineLength = lines[row].length;
			if (remaining <= lineLength) {
				out.row = row;
				out.column = remaining;
				return;
			}
			remaining -= lineLength + 1;
		}
		out.row = lines.length - 1;
		out.column = lines[lines.length - 1].length;
	}

	public getTextRange(start: number, end: number): string {
		return this.getText().slice(start, end);
	}

	public getText(): string {
		return this.getLines().join('\n');
	}
}

const MAX_OUTPUT_ENTRIES = 512;
const MAX_HISTORY_ENTRIES = 256;
const PAGER_FALLBACK_CONTENT_WIDTH = 320;
const PAGER_FALLBACK_PAGE_LINES = 20;
// const PROMPT_GAP = 4;
const PADDING_X = 0;
const PADDING_Y = 0;
const CHARACTER_TILE_ALPHA = 1.0;
const CURSOR_BLINK_PERIOD = 0.5;
const SYMBOL_PANEL_MIN_CELL_WIDTH = 12;
const SYMBOL_PANEL_COLUMN_GAP = 2;
const SYMBOL_PANEL_PADDING_X = 1;
const SYMBOL_PANEL_PADDING_Y = 1;

const OUTPUT_COLORS: Record<TerminalOutputKind, number> = {
	prompt: 15,
	stdout: 15,
	stdout_saved: 2,
	stdout_dirty: 5,
	stdout_saved_dirty: 13,
	stderr: 9,
	system: 11,
};

export class TerminalMode {
	public font: EditorFont;
	private readonly uppercaseDisplayOverride: boolean;
	private readonly maxEntries: number;
	private readonly characterBackgroundColor = { r: 0, g: 0, b: 0, a: CHARACTER_TILE_ALPHA } as color;
	private readonly caretColor = Msx1Colors[15];
	private readonly selectionColor = Msx1Colors[11];
	private readonly field: TextField = createInlineTextField();
	private readonly output: TerminalOutputEntry[] = [];
	private readonly history: string[] = [];
	private historyIndex: number = null;
	private readonly terminalPath = '<terminal>';
	private readonly completionContextToken = { path: this.terminalPath };
	private readonly completion: CompletionController;
	private readonly buffer: TextBuffer;
	private blinkTimer = 0;
	private caretVisible = true;
	private active = false;
	private textVersion = 0;
	private readonly terminalCommands: TerminalCommandDispatcher;
	private symbolPanel: TerminalSymbolPanelState = null;
	private symbolPanelLayout: TerminalSymbolGridLayout = null;
	private completionPanel: TerminalCompletionPanelState = null;
	private completionPanelLayout: TerminalSymbolGridLayout = null;
	private pagerSessionActive = false;
	private pagerActive = false;
	private pagerQueue: TerminalOutputEntry[] = [];
	private pagerLinesRemaining = 0;
	private pagerViewOffsetLines = 0;
	private lastSurfaceWidth = 0;
	private lastSurfaceHeight = 0;

	private fieldText(): string {
		return getFieldText(this.field);
	}

	private cursorOffset(): number {
		return getCursorOffset(this.field);
	}

	private setCursorOffset(offset: number): void {
		setCursorFromOffset(this.field, offset);
	}

	private anchorOffset(): number {
		return selectionAnchorOffset(this.field);
	}

	private setSelectionAnchor(offset: number): void {
		setSelectionAnchorFromOffset(this.field, offset);
	}
	private cachedLines: string[] = [''];
	private cachedLinesVersion = -1;
	private promptPrefix = '> ';
	private cursorScreenInfo: CursorScreenInfo = null;
	private currentRenderer: RenderFacade = null;
	constructor(private readonly runtime: Runtime) {
		this.terminalCommands = new TerminalCommandDispatcher(this.runtime);
		this.setPromptPrefix(this.terminalCommands.getPrompt());

		this.font = new EditorFont(runtime.activeIdeFontVariant);
		this.uppercaseDisplayOverride = false;
		this.maxEntries = MAX_OUTPUT_ENTRIES;
		const terminal = this;
		this.buffer = new InlineFieldTextBuffer(() => this.getLinesSnapshot(), () => this.textVersion);
		this.completion = new CompletionController({
			isCodeTabActive: () => this.active,
			getBuffer: () => this.buffer,
			getCursorRow: () => this.getCursorPosition().row,
			getCursorColumn: () => this.getCursorPosition().column,
			setCursorPosition: (row, column) => { this.setCursorFromPosition(row, column); },
			setSelectionAnchor: (row, column) => { this.setSelectionAnchorFromPosition(row, column); },
			replaceSelectionWith: (text) => { this.replaceSelectionWithText(text); },
			updateDesiredColumn: () => { this.field.desiredColumn = this.field.cursorColumn; },
			resetBlink: () => { this.resetBlink(); },
			revealCursor: () => { },
			characterAdvance: (char) => this.font.advance(char),
			get lineHeight(): number { return terminal.font.lineHeight; },
			measureText: (text) => this.measureDisplayText(text, this.useUppercaseDisplay()),
			drawText: (text, x, y, color) => {
				const uppercaseDisplay = terminal.useUppercaseDisplay();
				const display = terminal.toDisplayText(text, uppercaseDisplay).replace(/\t/g, ' '.repeat(TAB_SPACES));
				terminal.currentRenderer.glyphs({ glyphs: display, x, y, z: 0, color: Msx1Colors[color], font: terminal.font.renderFont() });
			},
			fillRect: (left, top, right, bottom, color) => {
				terminal.currentRenderer.rect({
					kind: 'fill',
					area: { left, top, right, bottom },
					color: Msx1Colors[color],
				});
			},
			strokeRect: (left, top, right, bottom, color) => {
				terminal.currentRenderer.rect({
					kind: 'rect',
					area: { left, top, right, bottom },
					color: Msx1Colors[color],
				});
			},
			getCursorScreenInfo: () => this.cursorScreenInfo,
			getActiveCodeTabContext: () => (this.active ? this.completionContextToken : null),
			resolveHoverPath: () => this.terminalPath,
			getSemanticDefinitions: () => null,
			getLuaModuleAliases: () => this.buildTerminalModuleAliases(),
			getMemberCompletionItems: (request) => this.buildMemberCompletionItems(request),
			charAt: (row, column) => this.charAt(row, column),
			getTextVersion: () => this.textVersion,
			shouldFireRepeat: (code) => this.shouldRepeatKey(code),
			shouldAutoTriggerCompletions: () => true,
			shouldShowParameterHints: () => false,
		});
		this.completion.enterCommitsCompletion = true;
	}

	public activate(): void {
		this.active = true;
		this.resetInputField('');
		this.historyIndex = null;
		this.completion.closeSession();
		this.symbolPanel = null;
		this.symbolPanelLayout = null;
		this.completionPanel = null;
		this.completionPanelLayout = null;
		this.resetPagerState();
		this.blinkTimer = 0;
		this.caretVisible = true;
	}

	public deactivate(): void {
		this.active = false;
		this.symbolPanel = null;
		this.symbolPanelLayout = null;
		this.completionPanel = null;
		this.completionPanelLayout = null;
		this.resetPagerState();
	}

	public setFontVariant(variant: FontVariant): void {
		this.font = new EditorFont(variant);
		this.cachedLinesVersion = -1;
		this.resetBlink();
	}

	public get isActive(): boolean {
		return this.active;
	}

	public clearOutput(): void {
		this.output.length = 0;
		this.resetPagerState();
	}

	public setPromptPrefix(prefix: string): void {
		this.promptPrefix = prefix;
	}

	public appendPromptEcho(command: string): void {
		this.appendEntry({ color: 15, text: `${this.promptPrefix}${command}` });
	}

	public appendStdout(text: string, color: number = 15): void {
		this.appendEntry({ color, text });
	}

	public appendStderr(text: string): void {
		this.appendEntry({ color: 6, text });
	}

	public appendError(error: Error): void {
		const stackText = typeof error.stack === 'string' && error.stack.length > 0
			? error.stack
			: (error.message ?? String(error));
		const lines = stackText.split('\n');
		for (let index = 0; index < lines.length; index += 1) {
			this.appendStderr(lines[index]);
		}
	}

	public appendSystem(text: string): void {
		this.appendEntry({ color: 14, text });
	}

	public update(deltaSeconds: number): void {
		if (!this.active) {
			return;
		}
		this.blinkTimer += deltaSeconds; // TODO: REPLACE WITH TIMELINE!!
		if (this.blinkTimer >= CURSOR_BLINK_PERIOD) {
			this.blinkTimer -= CURSOR_BLINK_PERIOD;
		}
		this.caretVisible = this.blinkTimer < CURSOR_BLINK_PERIOD * 0.5;
		this.completion.processPending(deltaSeconds);
	}

	public async handleInput() {
		if (!this.active) {
			return null;
		}
		if (this.pagerActive) {
			if (this.handlePagerInput()) {
				this.resetBlink();
			}
			return null;
		}
		if (this.symbolPanel) {
			if (this.handleSymbolPanelKeybindings()) {
				this.resetBlink();
				return null;
			}
		} else if (this.completionPanel) {
			if (this.handleCompletionPanelKeybindings()) {
				this.resetBlink();
				return null;
			}
		} else {
			if (this.handleInlineCompletionAccept()) {
				this.resetBlink();
				return null;
			}
			if (this.handleCompletionPanelTrigger()) {
				this.resetBlink();
				return null;
			}
			if (this.handleCtrlTabTrigger()) {
				this.resetBlink();
				return null;
			}
		}
		const options: InlineInputOptions = { allowSpace: true };
		const historyHandled = this.handleHistoryNavigation();
		if (historyHandled) {
			this.resetBlink();
		}
		const previousText = this.fieldText();
		const previousCursor = this.cursorOffset();
		const previousAnchor = this.anchorOffset();
		const textChanged = applyInlineFieldEditing(this.field, options);
		if (textChanged) {
			const editContext = this.buildEditContext(previousText, this.fieldText());
			this.handleTextMutation(previousText, editContext);
		} else if (previousCursor !== this.cursorOffset() || previousAnchor !== this.anchorOffset()) {
			if (this.completionPanel) {
				this.refreshCompletionPanelFilter();
			} else if (this.symbolPanel) {
				this.refreshSymbolPanelFilter();
			} else {
				this.completion.onCursorMoved();
			}
		}
		const submit = this.trySubmitCommand();
		if (submit !== null) {
			this.completion.closeSession();
			if (this.symbolPanel) {
				this.closeSymbolPanel(false);
			}
			if (this.completionPanel) {
				this.closeCompletionPanel(false);
			}
			await this.handleTerminalCommand(submit);
		}
	}

	private async handleTerminalCommand(rawCommand: string): Promise<void> {
		const input = rawCommand ?? '';
		this.setPromptPrefix(this.terminalCommands.getPrompt());
		this.appendPromptEcho(input);
		const trimmed = input.trim();
		if (trimmed.length > 0) {
			this.recordHistory(trimmed);
		}
		if (trimmed.length === 0) {
			return;
		}
		this.beginPagerSession();
		try {
			if (await this.terminalCommands.handle(trimmed)) {
				return;
			}
		} catch (error) {
			this.appendStderr(extractErrorMessage(error));
			return;
		} finally {
			this.pagerSessionActive = false;
		}
		this.executeTerminalCommand(trimmed);
	}

	private static readonly SIMPLE_CHAIN = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;

	private executeTerminalCommand(command: string): void {
		const source = this.prepareTerminalChunk(command);
		if (source.length === 0) {
			return;
		}
		if (this.runtime.faultSnapshot && source.startsWith('return ')) {
			const expr = source.slice(7).trim();
			if (TerminalMode.SIMPLE_CHAIN.test(expr)) {
				const resolved = resolveSnapshotExpression(expr);
				if (resolved !== null) {
					const { lines } = describeLuaValueForInspector(resolved);
					for (let i = 0; i < lines.length; i += 1) {
						this.appendStdout(lines[i]);
					}
					return;
				}
			}
		}
		try {
			const results: Value[] = runtimeLuaPipeline.runConsoleChunk(this.runtime, source);
			if (results.length > 0) {
				const summary = results.map(value => valueToString(value)).join('\t');
				this.appendStdout(summary);
			}
		}
		catch (error) {
			this.appendStderr(extractErrorMessage(error));
		}
	}

	private prepareTerminalChunk(command: string): string {
		const trimmed = command.trim();
		if (trimmed.length === 0) {
			return '';
		}
		if (trimmed.startsWith('?')) {
			const expression = trimmed.slice(1).trim();
			return expression.length === 0 ? '' : `return ${expression}`;
		}
		if (trimmed.startsWith('=')) {
			const expression = trimmed.slice(1).trim();
			return expression.length === 0 ? '' : `return ${expression}`;
		}
		return trimmed;
	}

	public openSymbolBrowser(): void {
		const entries = this.buildSymbolCatalog();
		const filtered = entries.slice();
		this.openSymbolPanel('browse', entries, filtered, null);
	}

	private handleInlineCompletionAccept(): boolean {
		if (!isKeyJustPressed('ArrowRight')) {
			return false;
		}
		const { ctrlDown, altDown, metaDown } = { ctrlDown: isCtrlDown(), altDown: isAltDown(), metaDown: isMetaDown() };
		if (ctrlDown || altDown || metaDown) {
			return false;
		}
		const accepted = this.completion.tryAcceptSelectedCompletion();
		if (!accepted) {
			return false;
		}
		consumeIdeKey('ArrowRight');
		return true;
	}

	private handleCompletionPanelTrigger(): boolean {
		if (!isKeyJustPressed('Tab')) {
			return false;
		}
		const { ctrlDown, altDown, metaDown } = { ctrlDown: isCtrlDown(), altDown: isAltDown(), metaDown: isMetaDown() };
		if (ctrlDown || altDown || metaDown) {
			return false;
		}
		consumeIdeKey('Tab');
		const snapshot = this.completion.listCompletionCandidates();
		if (!snapshot) {
			return true;
		}
		if (snapshot.filteredItems.length === 0) {
			return true;
		}
		this.openCompletionPanel(snapshot.context, snapshot.items, snapshot.filteredItems);
		return true;
	}

	private handleCtrlTabTrigger(): boolean {
		if (!isKeyJustPressed('Tab')) {
			return false;
		}
		const { ctrlDown, altDown, metaDown } = { ctrlDown: isCtrlDown(), altDown: isAltDown(), metaDown: isMetaDown() };
		if (!ctrlDown || altDown || metaDown) {
			return false;
		}
		consumeIdeKey('Tab');
		const completionSnapshot = this.completion.listCompletionCandidates();
		if (completionSnapshot && completionSnapshot.context.kind === 'member' && completionSnapshot.filteredItems.length > 0) {
			this.openCompletionPanel(completionSnapshot.context, completionSnapshot.items, completionSnapshot.filteredItems);
			return true;
		}
		const symbolContext = this.resolveSymbolCompletionContext();
		const entries = this.buildSymbolCatalog();
		const filtered = this.filterSymbolEntries(entries, symbolContext.prefix);
		if (filtered.length === 0) {
			return true;
		}
		if (filtered.length === 1) {
			this.applySymbolCompletion(symbolContext, filtered[0].name);
			return true;
		}
		this.openSymbolPanel('complete', entries, filtered, symbolContext);
		return true;
	}

	private handleSymbolPanelKeybindings(): boolean {
		const panel = this.symbolPanel;
		if (!panel) {
			return false;
		}
		if (isKeyJustPressed('Escape')) {
			consumeIdeKey('Escape');
			this.closeSymbolPanel(true);
			return true;
		}
		if (isKeyJustPressed('Tab')) {
			consumeIdeKey('Tab');
			const shiftDown = isShiftDown();
			this.moveSymbolSelectionRow(shiftDown ? -1 : 1);
			return true;
		}
		const enterPressed = isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter');
		if (enterPressed) {
			consumeIdeKey('Enter');
			consumeIdeKey('NumpadEnter');
			if (panel.mode === 'complete') {
				this.acceptSymbolPanelSelection();
			} else {
				this.closeSymbolPanel(false);
			}
			return true;
		}
		const { ctrlDown, altDown, metaDown } = { ctrlDown: isCtrlDown(), altDown: isAltDown(), metaDown: isMetaDown() };
		if (ctrlDown || altDown || metaDown) {
			return false;
		}
		if (this.shouldRepeatKey('ArrowDown')) {
			consumeIdeKey('ArrowDown');
			this.moveSymbolSelectionRow(1);
			return true;
		}
		if (this.shouldRepeatKey('ArrowUp')) {
			consumeIdeKey('ArrowUp');
			this.moveSymbolSelectionRow(-1);
			return true;
		}
		if (this.shouldRepeatKey('ArrowRight')) {
			consumeIdeKey('ArrowRight');
			this.moveSymbolSelectionColumn(1);
			return true;
		}
		if (this.shouldRepeatKey('ArrowLeft')) {
			consumeIdeKey('ArrowLeft');
			this.moveSymbolSelectionColumn(-1);
			return true;
		}
		if (this.shouldRepeatKey('PageDown')) {
			consumeIdeKey('PageDown');
			this.moveSymbolSelectionPage(1);
			return true;
		}
		if (this.shouldRepeatKey('PageUp')) {
			consumeIdeKey('PageUp');
			this.moveSymbolSelectionPage(-1);
			return true;
		}
		return false;
	}

	private resolveSymbolCompletionContext(): TerminalSymbolQueryContext {
		const text = this.fieldText();
		const cursor = this.cursorOffset();
		const bounds = this.findSymbolCompletionBounds(text, cursor);
		return {
			prefix: text.slice(bounds.start, cursor),
			replaceStart: bounds.start,
			replaceEnd: bounds.end,
		};
	}

	private findSymbolCompletionBounds(text: string, cursor: number): { start: number; end: number } {
		let start = cursor;
		while (start > 0 && !this.isSymbolCompletionBoundary(text.charAt(start - 1))) {
			start -= 1;
		}
		let end = cursor;
		while (end < text.length && !this.isSymbolCompletionBoundary(text.charAt(end))) {
			end += 1;
		}
		return { start, end };
	}

	private isSymbolCompletionBoundary(ch: string): boolean {
		return !this.isSymbolQueryChar(ch);
	}

	private isSymbolQueryChar(ch: string): boolean {
		const code = ch.charCodeAt(0);
		if (code >= 48 && code <= 57) {
			return true;
		}
		if (code >= 65 && code <= 90) {
			return true;
		}
		if (code >= 97 && code <= 122) {
			return true;
		}
		return ch === '_' || ch === '.' || ch === ':';
	}

	private openSymbolPanel(
		mode: TerminalSymbolPanelMode,
		entries: SymbolEntry[],
		filtered: SymbolEntry[],
		query: TerminalSymbolQueryContext | null,
	): void {
		const selectionIndex = filtered.length > 0 ? 0 : -1;
		this.completionPanel = null;
		this.completionPanelLayout = null;
		this.symbolPanel = {
			mode,
			entries,
			filtered,
			filter: query ? query.prefix : '',
			selectionIndex,
			displayRowOffset: 0,
			queryStart: query ? query.replaceStart : 0,
			queryEnd: query ? query.replaceEnd : 0,
			originalText: this.fieldText(),
			originalCursor: this.cursorOffset(),
		};
		this.symbolPanelLayout = null;
		this.completion.closeSession();
	}

	private closeSymbolPanel(restoreInput: boolean): void {
		const panel = this.symbolPanel;
		if (!panel) {
			return;
		}
		this.symbolPanel = null;
		this.symbolPanelLayout = null;
		if (restoreInput) {
			const previous = this.fieldText();
			setFieldText(this.field, panel.originalText, false);
			this.setCursorOffset(panel.originalCursor);
			this.onExternalFieldMutation(previous, panel.originalText);
		}
	}

	private openCompletionPanel(context: CompletionContext, entries: LuaCompletionItem[], filtered: LuaCompletionItem[]): void {
		const selectionIndex = filtered.length > 0 ? 0 : -1;
		this.symbolPanel = null;
		this.symbolPanelLayout = null;
		this.completionPanel = {
			entries,
			filtered,
			filter: context.prefix,
			selectionIndex,
			displayRowOffset: 0,
			context,
			originalText: this.fieldText(),
			originalCursor: this.cursorOffset(),
		};
		this.completionPanelLayout = null;
		this.completion.closeSession();
	}

	private closeCompletionPanel(restoreInput: boolean): void {
		const panel = this.completionPanel;
		if (!panel) {
			return;
		}
		this.completionPanel = null;
		this.completionPanelLayout = null;
		if (restoreInput) {
			const previous = this.fieldText();
			setFieldText(this.field, panel.originalText, false);
			this.setCursorOffset(panel.originalCursor);
			this.onExternalFieldMutation(previous, panel.originalText);
		}
	}

	private acceptCompletionPanelSelection(): void {
		const panel = this.completionPanel;
		if (!panel) {
			return;
		}
		if (panel.selectionIndex < 0 || panel.selectionIndex >= panel.filtered.length) {
			this.closeCompletionPanel(false);
			return;
		}
		const item = panel.filtered[panel.selectionIndex];
		const context = panel.context;
		this.closeCompletionPanel(false);
		this.completion.applyCompletionItem(context, item);
	}

	private resolveCompletionSelectionIndex(items: LuaCompletionItem[], preferredLabel: string): number {
		if (items.length === 0) {
			return -1;
		}
		if (preferredLabel) {
			for (let index = 0; index < items.length; index += 1) {
				if (items[index].label === preferredLabel) {
					return index;
				}
			}
		}
		return 0;
	}

	private refreshCompletionPanelFilter(): void {
		const panel = this.completionPanel;
		if (!panel) {
			return;
		}
		const previousLabel = panel.selectionIndex >= 0 && panel.selectionIndex < panel.filtered.length
			? panel.filtered[panel.selectionIndex].label
			: null;
		const snapshot = this.completion.listCompletionCandidates();
		if (!snapshot) {
			this.closeCompletionPanel(false);
			return;
		}
		panel.entries = snapshot.items;
		panel.filtered = snapshot.filteredItems;
		panel.filter = snapshot.context.prefix;
		panel.context = snapshot.context;
		panel.selectionIndex = panel.filtered.length > 0
			? this.resolveCompletionSelectionIndex(panel.filtered, previousLabel)
			: -1;
		panel.displayRowOffset = 0;
	}

	private handleCompletionPanelKeybindings(): boolean {
		const panel = this.completionPanel;
		if (!panel) {
			return false;
		}
		if (isKeyJustPressed('Escape')) {
			consumeIdeKey('Escape');
			this.closeCompletionPanel(false);
			return true;
		}
		if (isKeyJustPressed('Tab')) {
			consumeIdeKey('Tab');
			const shiftDown = isShiftDown();
			this.moveCompletionSelectionRow(shiftDown ? -1 : 1);
			return true;
		}
		const enterPressed = isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter');
		if (enterPressed) {
			consumeIdeKey('Enter');
			consumeIdeKey('NumpadEnter');
			this.acceptCompletionPanelSelection();
			return true;
		}
		const { ctrlDown, altDown, metaDown } = { ctrlDown: isCtrlDown(), altDown: isAltDown(), metaDown: isMetaDown() };
		if (ctrlDown || altDown || metaDown) {
			return false;
		}
		if (this.shouldRepeatKey('ArrowDown')) {
			consumeIdeKey('ArrowDown');
			this.moveCompletionSelectionRow(1);
			return true;
		}
		if (this.shouldRepeatKey('ArrowUp')) {
			consumeIdeKey('ArrowUp');
			this.moveCompletionSelectionRow(-1);
			return true;
		}
		if (this.shouldRepeatKey('ArrowRight')) {
			consumeIdeKey('ArrowRight');
			this.moveCompletionSelectionColumn(1);
			return true;
		}
		if (this.shouldRepeatKey('ArrowLeft')) {
			consumeIdeKey('ArrowLeft');
			this.moveCompletionSelectionColumn(-1);
			return true;
		}
		if (this.shouldRepeatKey('PageDown')) {
			consumeIdeKey('PageDown');
			this.moveCompletionSelectionPage(1);
			return true;
		}
		if (this.shouldRepeatKey('PageUp')) {
			consumeIdeKey('PageUp');
			this.moveCompletionSelectionPage(-1);
			return true;
		}
		return false;
	}

	private acceptSymbolPanelSelection(): void {
		const panel = this.symbolPanel;
		if (!panel) {
			return;
		}
		if (panel.selectionIndex < 0 || panel.selectionIndex >= panel.filtered.length) {
			this.closeSymbolPanel(false);
			return;
		}
		const entry = panel.filtered[panel.selectionIndex];
		if (panel.mode === 'complete') {
			const context: TerminalSymbolQueryContext = {
				prefix: panel.filter,
				replaceStart: panel.queryStart,
				replaceEnd: panel.queryEnd,
			};
			this.closeSymbolPanel(false);
			this.applySymbolCompletion(context, entry.name);
			return;
		}
		this.closeSymbolPanel(false);
	}

	private refreshSymbolPanelFilter(): void {
		const panel = this.symbolPanel;
		if (!panel) {
			return;
		}
		const previousName = panel.selectionIndex >= 0 && panel.selectionIndex < panel.filtered.length
			? panel.filtered[panel.selectionIndex].name
			: null;
		let filter = panel.filter;
		if (panel.mode === 'complete') {
			const context = this.resolveSymbolCompletionContext();
			panel.queryStart = context.replaceStart;
			panel.queryEnd = context.replaceEnd;
			filter = context.prefix;
		} else {
			filter = this.fieldText().trim();
		}
		panel.filter = filter;
		panel.filtered = this.filterSymbolEntries(panel.entries, filter);
		panel.selectionIndex = this.resolveSymbolSelectionIndex(panel.filtered, previousName);
		panel.displayRowOffset = 0;
	}

	private buildSymbolCatalog(): SymbolEntry[] {
		const entries = runtimeLuaPipeline.listSymbols(this.runtime);
		return this.sortSymbolEntries(entries);
	}

	private sortSymbolEntries(entries: SymbolEntry[]): SymbolEntry[] {
		const kindOrder: Record<SymbolEntry['kind'], number> = {
			function: 0,
			table: 1,
			constant: 2,
		};
		const indexed = entries.map((entry, index) => ({
			entry,
			index,
			normalized: entry.name.toLowerCase(),
		}));
		indexed.sort((a, b) => {
			const kindDelta = kindOrder[a.entry.kind] - kindOrder[b.entry.kind];
			if (kindDelta !== 0) {
				return kindDelta;
			}
			if (a.normalized < b.normalized) {
				return -1;
			}
			if (a.normalized > b.normalized) {
				return 1;
			}
			if (a.entry.name < b.entry.name) {
				return -1;
			}
			if (a.entry.name > b.entry.name) {
				return 1;
			}
			return a.index - b.index;
		});
		return indexed.map(item => item.entry);
	}

	private filterSymbolEntries(entries: SymbolEntry[], prefix: string): SymbolEntry[] {
		if (prefix.length === 0) {
			return entries.slice();
		}
		const needle = prefix.toLowerCase();
		const needleSegments = this.splitSymbolQuerySegments(needle);
		const filtered: SymbolEntry[] = [];
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const nameLower = entry.name.toLowerCase();
			if (nameLower.startsWith(needle)) {
				filtered.push(entry);
				continue;
			}
			if (this.matchesSymbolSegmentChain(nameLower, needleSegments)) {
				filtered.push(entry);
				continue;
			}
			if (this.matchesAnySymbolSegment(nameLower, needleSegments)) {
				filtered.push(entry);
			}
		}
		return filtered;
	}

	private splitSymbolQuerySegments(value: string): string[] {
		const rawSegments = value.split(/[.:]/);
		const segments: string[] = [];
		for (let index = 0; index < rawSegments.length; index += 1) {
			const segment = rawSegments[index];
			if (segment.length > 0) {
				segments.push(segment);
			}
		}
		return segments;
	}

	private matchesSymbolSegmentChain(nameLower: string, needleSegments: string[]): boolean {
		if (needleSegments.length <= 1) {
			return false;
		}
		const nameSegments = this.splitSymbolQuerySegments(nameLower);
		if (needleSegments.length > nameSegments.length) {
			return false;
		}
		for (let index = 0; index < needleSegments.length; index += 1) {
			if (!nameSegments[index].startsWith(needleSegments[index])) {
				return false;
			}
		}
		return true;
	}

	private matchesAnySymbolSegment(nameLower: string, needleSegments: string[]): boolean {
		if (needleSegments.length === 0) {
			return false;
		}
		const tailNeedle = needleSegments[needleSegments.length - 1];
		if (tailNeedle.length === 0) {
			return false;
		}
		const nameSegments = this.splitSymbolQuerySegments(nameLower);
		for (let index = 0; index < nameSegments.length; index += 1) {
			const segment = nameSegments[index];
			if (segment.startsWith(tailNeedle) || segment.includes(tailNeedle)) {
				return true;
			}
		}
		return false;
	}

	private resolveSymbolSelectionIndex(entries: SymbolEntry[], preferredName: string): number {
		if (entries.length === 0) {
			return -1;
		}
		if (preferredName) {
			for (let index = 0; index < entries.length; index += 1) {
				if (entries[index].name === preferredName) {
					return index;
				}
			}
		}
		return 0;
	}

	private replaceInputRange(start: number, end: number, value: string): void {
		const previous = this.fieldText();
		const next = previous.slice(0, start) + value + previous.slice(end);
		setFieldText(this.field, next, false);
		this.setCursorOffset(start + value.length);
		this.onExternalFieldMutation(previous, next);
	}

	private applySymbolCompletion(context: TerminalSymbolQueryContext, name: string): void {
		this.replaceInputRange(context.replaceStart, context.replaceEnd, name);
		this.resetBlink();
	}

	private drawSymbolPanel(params: { contentWidth: number; lineHeight: number; panelLayout: TerminalSymbolGridLayout; panelTop: number; uppercaseDisplay: boolean; }): void {
		const panel = this.symbolPanel;
		if (!panel) {
			this.symbolPanelLayout = null;
			return;
		}
		const { contentWidth, lineHeight, panelLayout, panelTop, uppercaseDisplay } = params;
		const layout = panelLayout ?? this.symbolPanelLayout;
		if (!layout) {
			return;
		}
		this.ensureSymbolPanelSelectionVisible(layout);

		const panelRows = layout.visibleRows + layout.paddingY * 2;
		const panelLeft = PADDING_X;
		const panelRight = panelLeft + contentWidth;
		const panelBottom = panelTop + panelRows * lineHeight;
		this.currentRenderer.rect({
			kind: 'fill',
			area: { left: panelLeft, top: panelTop, right: panelRight, bottom: panelBottom },
			color: Msx1Colors[COLOR_COMPLETION_BACKGROUND],
		});
		this.currentRenderer.rect({
			kind: 'rect',
			area: { left: panelLeft, top: panelTop, right: panelRight, bottom: panelBottom },
			color: Msx1Colors[COLOR_COMPLETION_BORDER],
		});

		const charWidth = this.font.advance(' ');
		const gridStartX = panelLeft + layout.paddingX * charWidth;
		const gridStartY = panelTop + layout.paddingY * lineHeight;
		const cellWidthPx = layout.cellWidth * charWidth;
		const gapWidthPx = layout.gap * charWidth;
		const strideX = cellWidthPx + gapWidthPx;
		const textColor = Msx1Colors[COLOR_COMPLETION_TEXT];

		if (panel.filtered.length === 0) {
			const message = panel.filter.length > 0 ? 'No matches' : 'No symbols';
			this.drawGlyphRun(this.currentRenderer, message, gridStartX, gridStartY, textColor, uppercaseDisplay);
			return;
		}

		const startRow = panel.displayRowOffset;
		const endRow = Math.min(layout.rows, startRow + layout.visibleRows);
		for (let row = startRow; row < endRow; row += 1) {
			const drawRow = row - startRow;
			const cellY = gridStartY + drawRow * lineHeight;
			for (let col = 0; col < layout.columns; col += 1) {
				const index = row + col * layout.rows;
				if (index >= panel.filtered.length) {
					continue;
				}
				const entry = panel.filtered[index];
				const label = this.truncateSymbolName(entry.name, layout.cellWidth);
				const cellX = gridStartX + col * strideX;
				const isSelected = index === panel.selectionIndex;
				if (isSelected) {
					this.currentRenderer.rect({
						kind: 'fill',
						area: {
							left: cellX - 1,
							top: cellY - 1,
							right: cellX + cellWidthPx + 1,
							bottom: cellY + lineHeight + 1,
						},
						color: Msx1Colors[COLOR_COMPLETION_HIGHLIGHT],
					});
				}
				const color = isSelected ? Msx1Colors[COLOR_COMPLETION_HIGHLIGHT_TEXT] : textColor;
				this.drawGlyphRun(this.currentRenderer, label, cellX, cellY, color, uppercaseDisplay);
			}
		}
	}

	private drawCompletionPanel(params: { contentWidth: number; lineHeight: number; panelLayout: TerminalSymbolGridLayout; panelTop: number; uppercaseDisplay: boolean; }): void {
		const panel = this.completionPanel;
		if (!panel) {
			this.completionPanelLayout = null;
			return;
		}
		const { contentWidth, lineHeight, panelLayout, panelTop, uppercaseDisplay } = params;
		const layout = panelLayout ?? this.completionPanelLayout;
		if (!layout) {
			return;
		}
		this.ensureCompletionPanelSelectionVisible(layout);

		const panelRows = layout.visibleRows + layout.paddingY * 2;
		const panelLeft = PADDING_X;
		const panelRight = panelLeft + contentWidth;
		const panelBottom = panelTop + panelRows * lineHeight;
		this.currentRenderer.rect({
			kind: 'fill',
			area: { left: panelLeft, top: panelTop, right: panelRight, bottom: panelBottom },
			color: Msx1Colors[COLOR_COMPLETION_BACKGROUND],
		});
		this.currentRenderer.rect({
			kind: 'rect',
			area: { left: panelLeft, top: panelTop, right: panelRight, bottom: panelBottom },
			color: Msx1Colors[COLOR_COMPLETION_BORDER],
		});

		const charWidth = this.font.advance(' ');
		const gridStartX = panelLeft + layout.paddingX * charWidth;
		const gridStartY = panelTop + layout.paddingY * lineHeight;
		const cellWidthPx = layout.cellWidth * charWidth;
		const gapWidthPx = layout.gap * charWidth;
		const strideX = cellWidthPx + gapWidthPx;
		const textColor = Msx1Colors[COLOR_COMPLETION_TEXT];

		if (panel.filtered.length === 0) {
			const message = panel.filter.length > 0 ? 'No matches' : 'No completions';
			this.drawGlyphRun(this.currentRenderer, message, gridStartX, gridStartY, textColor, uppercaseDisplay);
			return;
		}

		const startRow = panel.displayRowOffset;
		const endRow = Math.min(layout.rows, startRow + layout.visibleRows);
		for (let row = startRow; row < endRow; row += 1) {
			const drawRow = row - startRow;
			const cellY = gridStartY + drawRow * lineHeight;
			for (let col = 0; col < layout.columns; col += 1) {
				const index = row + col * layout.rows;
				if (index >= panel.filtered.length) {
					continue;
				}
				const entry = panel.filtered[index];
				const label = this.truncateSymbolName(entry.label, layout.cellWidth);
				const cellX = gridStartX + col * strideX;
				const isSelected = index === panel.selectionIndex;
				if (isSelected) {
					this.currentRenderer.rect({
						kind: 'fill',
						area: {
							left: cellX - 1,
							top: cellY - 1,
							right: cellX + cellWidthPx + 1,
							bottom: cellY + lineHeight + 1,
						},
						color: Msx1Colors[COLOR_COMPLETION_HIGHLIGHT],
					});
				}
				const color = isSelected ? Msx1Colors[COLOR_COMPLETION_HIGHLIGHT_TEXT] : textColor;
				this.drawGlyphRun(this.currentRenderer, label, cellX, cellY, color, uppercaseDisplay);
			}
		}
	}

	private computeSymbolGridLayout(total: number, maxColumns: number, maxRows: number, maxLabelLength: number): TerminalSymbolGridLayout {
		const paddingX = clamp(SYMBOL_PANEL_PADDING_X, 0, Math.max(0, Math.floor((maxColumns - 1) / 2)));
		const paddingY = clamp(SYMBOL_PANEL_PADDING_Y, 0, Math.max(0, Math.floor((maxRows - 1) / 2)));
		const gap = SYMBOL_PANEL_COLUMN_GAP;
		const availableColumns = Math.max(1, maxColumns - paddingX * 2);
		const availableRows = Math.max(1, maxRows - paddingY * 2);
		const fullCell = clamp(Math.max(1, maxLabelLength), 1, availableColumns);
		const maxByFull = Math.max(1, Math.floor((availableColumns + gap) / (fullCell + gap)));
		let columns = Math.max(1, total > 0 ? Math.min(total, maxByFull) : 1);
		let cellWidth = Math.max(1, Math.floor((availableColumns - gap * (columns - 1)) / columns));
		if (columns < 2 && total > 1) {
			const compactCell = clamp(SYMBOL_PANEL_MIN_CELL_WIDTH, 1, availableColumns);
			const maxByCompact = Math.max(1, Math.floor((availableColumns + gap) / (compactCell + gap)));
			if (maxByCompact > columns) {
				columns = Math.min(total, maxByCompact);
				cellWidth = Math.max(1, Math.floor((availableColumns - gap * (columns - 1)) / columns));
			}
		}
		const rows = Math.max(1, Math.ceil(total / columns));
		const visibleRows = Math.max(1, Math.min(rows, availableRows));
		return {
			columns,
			rows,
			cellWidth,
			gap,
			visibleRows,
			paddingX,
			paddingY,
		};
	}

	private measureSymbolMaxLabelLength(entries: SymbolEntry[]): number {
		let maxLength = 0;
		for (let index = 0; index < entries.length; index += 1) {
			const length = entries[index].name.length;
			if (length > maxLength) {
				maxLength = length;
			}
		}
		return maxLength;
	}

	private resolveSymbolLayoutForNavigation(): TerminalSymbolGridLayout {
		if (this.symbolPanelLayout) {
			return this.symbolPanelLayout;
		}
		const panel = this.symbolPanel;
		if (!panel) {
			return null;
		}
		const rows = Math.max(1, panel.filtered.length);
		return {
			columns: 1,
			rows,
			cellWidth: SYMBOL_PANEL_MIN_CELL_WIDTH,
			gap: SYMBOL_PANEL_COLUMN_GAP,
			visibleRows: rows,
			paddingX: 0,
			paddingY: 0,
		};
	}

	private ensureSymbolPanelSelectionVisible(layout: TerminalSymbolGridLayout): void {
		const panel = this.symbolPanel;
		if (!panel || panel.filtered.length === 0 || panel.selectionIndex < 0) {
			if (panel) {
				panel.displayRowOffset = 0;
			}
			return;
		}
		const row = panel.selectionIndex % layout.rows;
		const maxOffset = Math.max(0, layout.rows - layout.visibleRows);
		let offset = clamp(panel.displayRowOffset, 0, maxOffset);
		if (row < offset) {
			offset = row;
		}
		if (row >= offset + layout.visibleRows) {
			offset = row - layout.visibleRows + 1;
		}
		panel.displayRowOffset = clamp(offset, 0, maxOffset);
	}

	private moveSymbolSelectionRow(delta: number): void {
		const panel = this.symbolPanel;
		const layout = this.resolveSymbolLayoutForNavigation();
		if (!layout) {
			return;
		}
		const total = panel.filtered.length;
		if (total === 0) {
			panel.selectionIndex = -1;
			return;
		}
		const current = panel.selectionIndex < 0 ? 0 : panel.selectionIndex;
		const next = clamp(current + delta, 0, total - 1);
		panel.selectionIndex = next;
		this.ensureSymbolPanelSelectionVisible(layout);
	}

	private moveSymbolSelectionColumn(delta: number): void {
		const panel = this.symbolPanel;
		const layout = this.resolveSymbolLayoutForNavigation();
		if (!layout) {
			return;
		}
		const total = panel.filtered.length;
		if (total === 0) {
			panel.selectionIndex = -1;
			return;
		}
		const current = panel.selectionIndex < 0 ? 0 : panel.selectionIndex;
		const rows = layout.rows;
		const columns = layout.columns;
		const row = current % rows;
		const col = Math.floor(current / rows);
		const nextCol = clamp(col + delta, 0, Math.max(0, columns - 1));
		const columnStart = nextCol * rows;
		const columnEnd = Math.min(total - 1, columnStart + rows - 1);
		const next = clamp(columnStart + row, columnStart, columnEnd);
		panel.selectionIndex = next;
		this.ensureSymbolPanelSelectionVisible(layout);
	}

	private moveSymbolSelectionPage(delta: number): void {
		const panel = this.symbolPanel;
		const layout = this.resolveSymbolLayoutForNavigation();
		if (!layout) {
			return;
		}
		const total = panel.filtered.length;
		if (total === 0) {
			panel.selectionIndex = -1;
			return;
		}
		const current = panel.selectionIndex < 0 ? 0 : panel.selectionIndex;
		const step = Math.max(1, layout.visibleRows);
		const next = clamp(current + step * delta, 0, total - 1);
		panel.selectionIndex = next;
		this.ensureSymbolPanelSelectionVisible(layout);
	}

	private measureCompletionMaxLabelLength(items: LuaCompletionItem[]): number {
		let maxLength = 0;
		for (let index = 0; index < items.length; index += 1) {
			const length = items[index].label.length;
			if (length > maxLength) {
				maxLength = length;
			}
		}
		return maxLength;
	}

	private resolveCompletionLayoutForNavigation(): TerminalSymbolGridLayout {
		if (this.completionPanelLayout) {
			return this.completionPanelLayout;
		}
		const panel = this.completionPanel;
		if (!panel) {
			return null;
		}
		const rows = Math.max(1, panel.filtered.length);
		return {
			columns: 1,
			rows,
			cellWidth: SYMBOL_PANEL_MIN_CELL_WIDTH,
			gap: SYMBOL_PANEL_COLUMN_GAP,
			visibleRows: rows,
			paddingX: 0,
			paddingY: 0,
		};
	}

	private ensureCompletionPanelSelectionVisible(layout: TerminalSymbolGridLayout): void {
		const panel = this.completionPanel;
		if (!panel || panel.filtered.length === 0 || panel.selectionIndex < 0) {
			if (panel) {
				panel.displayRowOffset = 0;
			}
			return;
		}
		const row = panel.selectionIndex % layout.rows;
		const maxOffset = Math.max(0, layout.rows - layout.visibleRows);
		let offset = clamp(panel.displayRowOffset, 0, maxOffset);
		if (row < offset) {
			offset = row;
		}
		if (row >= offset + layout.visibleRows) {
			offset = row - layout.visibleRows + 1;
		}
		panel.displayRowOffset = clamp(offset, 0, maxOffset);
	}

	private moveCompletionSelectionRow(delta: number): void {
		const panel = this.completionPanel;
		const layout = this.resolveCompletionLayoutForNavigation();
		if (!layout) {
			return;
		}
		const total = panel.filtered.length;
		if (total === 0) {
			panel.selectionIndex = -1;
			return;
		}
		const current = panel.selectionIndex < 0 ? 0 : panel.selectionIndex;
		const next = clamp(current + delta, 0, total - 1);
		panel.selectionIndex = next;
		this.ensureCompletionPanelSelectionVisible(layout);
	}

	private moveCompletionSelectionColumn(delta: number): void {
		const panel = this.completionPanel;
		const layout = this.resolveCompletionLayoutForNavigation();
		if (!layout) {
			return;
		}
		const total = panel.filtered.length;
		if (total === 0) {
			panel.selectionIndex = -1;
			return;
		}
		const current = panel.selectionIndex < 0 ? 0 : panel.selectionIndex;
		const rows = layout.rows;
		const columns = layout.columns;
		const row = current % rows;
		const col = Math.floor(current / rows);
		const nextCol = clamp(col + delta, 0, Math.max(0, columns - 1));
		const columnStart = nextCol * rows;
		const columnEnd = Math.min(total - 1, columnStart + rows - 1);
		const next = clamp(columnStart + row, columnStart, columnEnd);
		panel.selectionIndex = next;
		this.ensureCompletionPanelSelectionVisible(layout);
	}

	private moveCompletionSelectionPage(delta: number): void {
		const panel = this.completionPanel;
		const layout = this.resolveCompletionLayoutForNavigation();
		if (!layout) {
			return;
		}
		const total = panel.filtered.length;
		if (total === 0) {
			panel.selectionIndex = -1;
			return;
		}
		const current = panel.selectionIndex < 0 ? 0 : panel.selectionIndex;
		const step = Math.max(1, layout.visibleRows);
		const next = clamp(current + step * delta, 0, total - 1);
		panel.selectionIndex = next;
		this.ensureCompletionPanelSelectionVisible(layout);
	}

	private truncateSymbolName(name: string, cellWidth: number): string {
		if (name.length <= cellWidth) {
			return name;
		}
		if (cellWidth <= 3) {
			return name.slice(0, cellWidth);
		}
		return `${name.slice(0, cellWidth - 3)}...`;
	}

	public draw(renderer: RenderFacade, surface: Viewport): void {
		this.currentRenderer = renderer;
		this.lastSurfaceWidth = surface.width;
		this.lastSurfaceHeight = surface.height;
		try {
			const lineHeight = this.font.lineHeight;
			const contentWidth = Math.max(0, surface.width - PADDING_X * 2);

			// compute prompt layout and wrapped input segments
			const uppercaseDisplay = this.useUppercaseDisplay();
			const promptWidth = this.measureDisplayText(this.promptPrefix, uppercaseDisplay);
			const firstLineMax = Math.max(8, contentWidth - promptWidth);
			const otherLineMax = Math.max(8, contentWidth);
			const displayInput = this.toDisplayText(this.fieldText(), uppercaseDisplay);
			const inputWrap = this.wrapDisplayWithFirstWidth(displayInput, firstLineMax, otherLineMax);

			// space available for output lines above the input area
			const availableHeight = surface.height - PADDING_Y * 2 - (inputWrap.segments.length * lineHeight);
			const baseMaxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
			let panelLayout: TerminalSymbolGridLayout = null;
			let panelRows = 0;
			if (this.completionPanel) {
				const charWidth = this.font.advance(' ');
				const maxColumns = Math.max(1, Math.floor(contentWidth / charWidth));
				const maxLabelLength = this.measureCompletionMaxLabelLength(this.completionPanel.filtered);
				panelLayout = this.computeSymbolGridLayout(this.completionPanel.filtered.length, maxColumns, baseMaxLines, maxLabelLength);
				panelRows = panelLayout.visibleRows + panelLayout.paddingY * 2;
				this.completionPanelLayout = panelLayout;
			} else if (this.symbolPanel) {
				const charWidth = this.font.advance(' ');
				const maxColumns = Math.max(1, Math.floor(contentWidth / charWidth));
				const maxLabelLength = this.measureSymbolMaxLabelLength(this.symbolPanel.filtered);
				panelLayout = this.computeSymbolGridLayout(this.symbolPanel.filtered.length, maxColumns, baseMaxLines, maxLabelLength);
				panelRows = panelLayout.visibleRows + panelLayout.paddingY * 2;
				this.symbolPanelLayout = panelLayout;
			}
			const maxContentLines = Math.max(0, baseMaxLines - panelRows);

			// build and clamp output lines
			const wrappedLines = this.buildWrappedLines(contentWidth, Number.MAX_SAFE_INTEGER);
			const maxOffset = Math.max(0, wrappedLines.length - maxContentLines);
			this.pagerViewOffsetLines = clamp(this.pagerViewOffsetLines, 0, maxOffset);
			const end = Math.max(0, wrappedLines.length - this.pagerViewOffsetLines);
			const visibleStart = Math.max(0, end - maxContentLines);
			const visibleLines = wrappedLines.slice(visibleStart, end);

			// draw visible output lines starting at top padding
			let y = PADDING_Y;
			for (const line of visibleLines) {
				const color = line.color;
				this.drawGlyphBackgrounds(renderer, line.text, PADDING_X, y, uppercaseDisplay);
				this.drawGlyphRun(renderer, line.text, PADDING_X, y, Msx1Colors[color], uppercaseDisplay);
				y += lineHeight;
			}

			// compute where input block starts (positioned right after visible output lines,
			// so the input moves upward as output fills the viewport — terminal-like behavior)
			const panelTop = PADDING_Y + visibleLines.length * lineHeight;
			const inputStartY = panelTop + panelRows * lineHeight;
			if (this.completionPanel) {
				this.drawCompletionPanel({
					contentWidth,
					lineHeight,
					panelLayout,
					panelTop,
					uppercaseDisplay,
				});
			} else {
				this.drawSymbolPanel({
					contentWidth,
					lineHeight,
					panelLayout,
					panelTop,
					uppercaseDisplay,
				});
			}

			// draw prompt at the first input line then draw wrapped input lines (first segment after prompt)
			const promptColor = Msx1Colors[OUTPUT_COLORS.prompt];
			this.drawGlyphBackgrounds(renderer, this.promptPrefix, PADDING_X, inputStartY, uppercaseDisplay);
			this.drawGlyphRun(renderer, this.promptPrefix, PADDING_X, inputStartY, promptColor, uppercaseDisplay);

			// draw multi-line input (handles selection and caret)
			this.drawMultilineInput(renderer, PADDING_X, inputStartY, promptWidth, inputWrap);
			this.drawCompletionOverlays(surface, promptWidth);
			this.drawPagerOverlay(renderer, surface, lineHeight, uppercaseDisplay);
		} finally {
			this.currentRenderer = null;
		}
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

	private appendEntry(entry: TerminalOutputEntry): void {
		const pagedLines = this.expandEntryForPaging(entry);
		if (this.pagerActive || this.pagerSessionActive) {
			for (let index = 0; index < pagedLines.length; index += 1) {
				this.appendWithPaging(pagedLines[index]);
			}
			return;
		}
		for (let index = 0; index < pagedLines.length; index += 1) {
			this.pushOutputEntry(pagedLines[index]);
		}
	}

	private handleHistoryNavigation(): boolean {
		if (this.symbolPanel || this.completionPanel) {
			return false;
		}
		const { ctrlDown, altDown, metaDown } = { ctrlDown: isCtrlDown(), altDown: isAltDown(), metaDown: isMetaDown() };
		if (ctrlDown || altDown || metaDown) {
			return false;
		}
		if (this.history.length === 0) {
			return false;
		}
		if (this.shouldRepeatKey('ArrowUp')) {
			this.recallHistory(-1);
			consumeIdeKey('ArrowUp');
			return true;
		}
		if (this.shouldRepeatKey('ArrowDown')) {
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

	private trySubmitCommand(): string {
		const enterPressed = isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter');
		if (!enterPressed) {
			return null;
		}
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		const command = this.fieldText().trimEnd();
		if (command.length === 0) {
			this.resetBlink();
			return null;
		}
		this.resetInputField('');
		this.resetBlink();
		return command;
	}

	private resetInputField(value: string): void {
		const previous = this.fieldText();
		setFieldText(this.field, value, true);
		this.onExternalFieldMutation(previous, value);
	}

	private resetBlink(): void {
		this.blinkTimer = 0;
		this.caretVisible = true;
	}

	private buildWrappedLines(maxWidth: number, maxLines: number): Array<{ text: string; color: number }> {
		if (maxLines <= 0) {
			return [];
		}
		const lines: Array<{ text: string; color: number }> = [];
		for (let i = 0; i < this.output.length; i += 1) {
			const entry = this.output[i];
			const segments = this.wrapText(entry.text, maxWidth);
			for (let j = 0; j < segments.length; j += 1) {
				lines.push({ text: segments[j], color: entry.color });
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
		const uppercaseDisplay = this.useUppercaseDisplay();
		const normalized = this.toDisplayText(text, uppercaseDisplay);
		return wrapOverlayLine(normalized, Math.max(8, maxWidth));
	}

	private shouldRepeatKey(code: string): boolean {
		return shouldRepeatKeyFromPlayer(code);
	}

	private beginPagerSession(): void {
		this.pagerSessionActive = true;
		this.pagerLinesRemaining = this.computePageLineCapacity();
	}

	private resetPagerState(): void {
		this.pagerSessionActive = false;
		this.pagerActive = false;
		this.pagerQueue.length = 0;
		this.pagerLinesRemaining = 0;
		this.pagerViewOffsetLines = 0;
	}

	private appendWithPaging(entry: TerminalOutputEntry): void {
		if (this.pagerActive || this.pagerLinesRemaining <= 0) {
			this.pagerQueue.push(entry);
			this.pagerActive = true;
			return;
		}
		this.pushOutputEntry(entry);
		this.pagerLinesRemaining -= 1;
	}

	private pushOutputEntry(entry: TerminalOutputEntry): void {
		this.output.push(entry);
		if (this.output.length > this.maxEntries) {
			this.output.splice(0, this.output.length - this.maxEntries);
		}
		this.pagerViewOffsetLines = 0;
	}

	private expandEntryForPaging(entry: TerminalOutputEntry): TerminalOutputEntry[] {
		const width = this.getPagingContentWidth();
		const segments = this.wrapText(entry.text, width);
		const lines: TerminalOutputEntry[] = [];
		for (let index = 0; index < segments.length; index += 1) {
			lines.push({ color: entry.color, text: segments[index] });
		}
		return lines;
	}

	private getPagingContentWidth(): number {
		const width = this.lastSurfaceWidth > 0
			? Math.max(8, this.lastSurfaceWidth - PADDING_X * 2)
			: PAGER_FALLBACK_CONTENT_WIDTH;
		return width;
	}

	private computePageLineCapacity(): number {
		const lineHeight = this.font.lineHeight;
		const surfaceHeight = this.lastSurfaceHeight > 0
			? this.lastSurfaceHeight
			: lineHeight * (PAGER_FALLBACK_PAGE_LINES + 2);
		const contentWidth = this.getPagingContentWidth();
		const uppercaseDisplay = this.useUppercaseDisplay();
		const promptWidth = this.measureDisplayText(this.promptPrefix, uppercaseDisplay);
		const firstLineMax = Math.max(8, contentWidth - promptWidth);
		const otherLineMax = Math.max(8, contentWidth);
		const displayInput = this.toDisplayText(this.fieldText(), uppercaseDisplay);
		const inputWrap = this.wrapDisplayWithFirstWidth(displayInput, firstLineMax, otherLineMax);
		const availableHeight = surfaceHeight - PADDING_Y * 2 - (inputWrap.segments.length * lineHeight);
		const baseMaxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
		return Math.max(1, baseMaxLines - 1);
	}

	private handlePagerInput(): boolean {
		if (isKeyJustPressed('Escape') || isKeyJustPressed('KeyQ')) {
			consumeIdeKey('Escape');
			consumeIdeKey('KeyQ');
			this.pagerQueue.length = 0;
			this.pagerActive = false;
			this.pagerLinesRemaining = 0;
			this.pagerViewOffsetLines = 0;
			return true;
		}
		if (this.shouldRepeatKey('ArrowUp')) {
			consumeIdeKey('ArrowUp');
			this.scrollPagerView(1);
			return true;
		}
		if (this.shouldRepeatKey('PageUp')) {
			consumeIdeKey('PageUp');
			this.scrollPagerView(this.computePageLineCapacity());
			return true;
		}
		if (this.shouldRepeatKey('ArrowDown')) {
			consumeIdeKey('ArrowDown');
			if (this.pagerViewOffsetLines > 0) {
				this.scrollPagerView(-1);
				return true;
			}
			this.flushPagerQueue(1);
			return true;
		}
		if (this.shouldRepeatKey('PageDown')) {
			consumeIdeKey('PageDown');
			if (this.pagerViewOffsetLines > 0) {
				this.scrollPagerView(-this.computePageLineCapacity());
				return true;
			}
			this.flushPagerQueue(this.computePageLineCapacity());
			return true;
		}
		if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
			consumeIdeKey('Enter');
			consumeIdeKey('NumpadEnter');
			if (this.pagerViewOffsetLines > 0) {
				this.scrollPagerView(-1);
				return true;
			}
			this.flushPagerQueue(1);
			return true;
		}
		if (isKeyJustPressed('Space')) {
			consumeIdeKey('Space');
			if (this.pagerViewOffsetLines > 0) {
				this.scrollPagerView(-this.computePageLineCapacity());
				return true;
			}
			this.flushPagerQueue(this.computePageLineCapacity());
			return true;
		}
		return false;
	}

	private flushPagerQueue(lines: number): void {
		const count = Math.max(1, lines);
		for (let index = 0; index < count && this.pagerQueue.length > 0; index += 1) {
			const entry = this.pagerQueue.shift()!;
			this.pushOutputEntry(entry);
		}
		if (this.pagerQueue.length === 0) {
			this.pagerActive = false;
			this.pagerLinesRemaining = 0;
			this.pagerViewOffsetLines = 0;
			return;
		}
		this.pagerActive = true;
		this.pagerLinesRemaining = 0;
		this.pagerViewOffsetLines = 0;
	}

	private scrollPagerView(deltaLines: number): void {
		const maxOffset = this.getPagerMaxOffsetLines();
		this.pagerViewOffsetLines = clamp(this.pagerViewOffsetLines + deltaLines, 0, maxOffset);
	}

	private getPagerMaxOffsetLines(): number {
		const contentWidth = this.getPagingContentWidth();
		const wrappedLines = this.buildWrappedLines(contentWidth, Number.MAX_SAFE_INTEGER);
		const pageLines = this.computePageLineCapacity();
		return Math.max(0, wrappedLines.length - pageLines);
	}

	private drawPagerOverlay(renderer: RenderFacade, surface: Viewport, lineHeight: number, uppercaseDisplay: boolean): void {
		if (!this.pagerActive) {
			return;
		}
		const prompts = this.pagerViewOffsetLines > 0
			? [
				'-- MORE -- [UP/DN scroll] [SPACE/PGDN down page] [Q quit]',
				'-- MORE -- [UP/DN] [SPACE/PGDN] [Q]',
				'-- MORE -- [UP/DN] [Q]',
				'-- MORE --',
			]
			: [
				'-- MORE -- [ENTER: line] [SPACE: page] [UP/PGUP back] [Q: quit]',
				'-- MORE -- [ENTER] [SPACE] [UP/PGUP] [Q]',
				'-- MORE -- [ENTER/SPACE] [Q]',
				'-- MORE --',
			];
		const maxTextWidth = Math.max(8, surface.width - PADDING_X * 2);
		let text = prompts[prompts.length - 1];
		for (let index = 0; index < prompts.length; index += 1) {
			if (this.measureDisplayText(prompts[index], uppercaseDisplay) <= maxTextWidth) {
				text = prompts[index];
				break;
			}
		}
		const y = Math.max(PADDING_Y, surface.height - PADDING_Y - lineHeight);
		renderer.rect({
			kind: 'fill',
			area: {
				left: PADDING_X,
				top: y,
				right: Math.max(PADDING_X, surface.width - PADDING_X),
				bottom: y + lineHeight,
			},
			color: this.characterBackgroundColor,
		});
		this.drawGlyphBackgrounds(renderer, text, PADDING_X, y, uppercaseDisplay);
		this.drawGlyphRun(renderer, text, PADDING_X, y, Msx1Colors[OUTPUT_COLORS.system], uppercaseDisplay);
	}

	private getLinesSnapshot(): string[] {
		if (this.cachedLinesVersion !== this.textVersion) {
			this.cachedLines = this.field.lines.slice();
			this.cachedLinesVersion = this.textVersion;
		}
		if (this.cachedLines.length === 0) {
			this.cachedLines = [''];
		}
		return this.cachedLines;
	}

	private getCursorPosition(): { row: number; column: number } {
		return { row: this.field.cursorRow, column: this.field.cursorColumn };
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
		this.setCursorOffset(index);
		this.field.selectionAnchor = null;
		this.completion.onCursorMoved();
	}

	private setSelectionAnchorFromPosition(row: number, column: number): void {
		const index = this.positionToIndex(row, column);
		this.setSelectionAnchor(index);
		this.completion.onCursorMoved();
	}

	private replaceSelectionWithText(text: string): void {
		const previous = this.fieldText();
		deleteSelection(this.field);
		if (text.length > 0) {
			insertValue(this.field, text);
		}
		const context = text.length > 0 ? { kind: 'insert', text } as EditContext : this.buildEditContext(previous, this.fieldText());
		this.handleTextMutation(previous, context);
	}

	private buildEditContext(previous: string, next: string): EditContext {
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

	private handleTextMutation(previousText: string, editContext: EditContext): void {
		if (this.runtime.canonicalization !== 'none') {
			const before = this.fieldText();
			const normalized = this.normalizeInputCase(before);
			if (normalized !== before) {
				const offset = this.cursorOffset();
				setFieldText(this.field, normalized, false);
				this.setCursorOffset(Math.min(offset, getFieldText(this.field).length));
			}
		}
		const context = previousText !== null ? this.buildEditContext(previousText, this.fieldText()) : editContext;
		this.textVersion += 1;
		this.cachedLinesVersion = -1;
		invalidateLuaCommentContextFromRow(this.buffer, 0);
		if (this.completionPanel) {
			this.refreshCompletionPanelFilter();
		} else if (this.symbolPanel) {
			this.refreshSymbolPanelFilter();
		} else {
			this.completion.updateAfterEdit(context);
		}
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

	private normalizeInputCase(text: string): string {
		if (this.runtime.canonicalization === 'none') {
			return text;
		}

		const transform = this.runtime.canonicalization === 'upper'
			? (ch: string) => ch.toUpperCase()
			: (ch: string) => ch.toLowerCase();
		return applyCaseOutsideStrings(text, transform);
	}

	private drawCompletionOverlays(surface: Viewport, promptWidth: number): void {
		if (this.symbolPanel || this.completionPanel) {
			return;
		}
		const bounds = {
			codeTop: PADDING_Y,
			codeBottom: surface.height - PADDING_Y,
			codeLeft: PADDING_X,
			codeRight: surface.width - PADDING_X,
			textLeft: PADDING_X + promptWidth,
		};
		this.completion.drawCompletionPopup(bounds);
		this.completion.drawParameterHintOverlay(bounds);
	}

	private buildTerminalModuleAliases(): Map<string, string> {
		if (this.fieldText().trim().length === 0) {
			return new Map();
		}
		return collectLuaModuleAliases({ source: this.fieldText(), path: this.terminalPath });
	}

	private buildMemberCompletionItems(request: LuaMemberCompletionRequest): LuaCompletionItem[] {
		if (request.objectName.length === 0) {
			return [];
		}
		const response = listLuaObjectMembers({
			path: request.path,
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
				detail: entry.detail,
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
	private drawMultilineInput(renderer: RenderFacade, baseX: number, baseY: number, promptWidth: number, wrap: { segments: string[]; starts: number[] }): void {
		const inputColor = Msx1Colors[OUTPUT_COLORS.stdout];
		const sel = selectionRange(this.field);
		const cursorIndex = this.cursorOffset();
		const uppercaseDisplay = this.useUppercaseDisplay();
		const displayText = this.toDisplayText(this.fieldText(), uppercaseDisplay);
		const inlinePreview = sel ? null : this.completion.getInlineCompletionPreview();
		let nextCursorInfo: CursorScreenInfo = null;
		const cursorPosition = this.getCursorPosition();

		for (let si = 0; si < wrap.segments.length; si += 1) {
			const seg = wrap.segments[si];
			const segStart = wrap.starts[si];
			const segLen = seg.length;
			const y = baseY + si * this.font.lineHeight;
			let x = baseX;
			// first segment is placed after the prompt
			if (si === 0) {
				x += promptWidth;
			}

			// caret rendering: use shared caret style from console_cart_editor
			const segEnd = segStart + segLen;
			const isLastSegment = si === wrap.segments.length - 1;
			const caretInSeg = cursorIndex >= segStart && (cursorIndex < segEnd || (isLastSegment && cursorIndex === segEnd));
			const shouldRenderInlineGhost = caretInSeg
				&& inlinePreview !== null
				&& inlinePreview.row === cursorPosition.row
				&& inlinePreview.column === cursorPosition.column;
			if (shouldRenderInlineGhost) {
				const localIndex = cursorIndex - segStart;
				const prefixText = seg.slice(0, localIndex);
				const suffixText = seg.slice(localIndex);
				const ghostWidth = this.measureDisplayText(inlinePreview.suffix, uppercaseDisplay);
				const prefixWidth = this.measureDisplayText(prefixText, uppercaseDisplay);

				// draw glyph backgrounds before overlays/text so selection remains visible
				this.drawGlyphBackgrounds(renderer, prefixText, x, y, uppercaseDisplay);
				this.drawGlyphBackgrounds(renderer, inlinePreview.suffix, x + prefixWidth, y, uppercaseDisplay);
				this.drawGlyphBackgrounds(renderer, suffixText, x + prefixWidth + ghostWidth, y, uppercaseDisplay);

				// draw glyph runs (ghost inserted at caret)
				this.drawGlyphRun(renderer, prefixText, x, y, inputColor, uppercaseDisplay);
				this.drawGlyphRun(renderer, inlinePreview.suffix, x + prefixWidth, y, Msx1Colors[COLOR_COMPLETION_PREVIEW_TEXT], uppercaseDisplay);
				this.drawGlyphRun(renderer, suffixText, x + prefixWidth + ghostWidth, y, inputColor, uppercaseDisplay);
			} else {
				// draw glyph backgrounds before overlays/text so selection remains visible
				this.drawGlyphBackgrounds(renderer, seg, x, y, uppercaseDisplay);

				// draw selection background for this segment if selection overlaps
				if (sel) {
					const selStart = Math.max(sel.start, segStart);
					const selEnd = Math.min(sel.end, segStart + segLen);
					if (selStart < selEnd) {
						const before = displayText.slice(segStart, selStart);
						const selected = displayText.slice(selStart, selEnd);
						const startWidth = this.measureDisplayText(before, uppercaseDisplay);
						const selWidth = this.measureDisplayText(selected, uppercaseDisplay);
						renderer.rect({
							kind: 'fill',
							area: {
								left: x + startWidth,
								top: y,
								right: x + startWidth + selWidth,
								bottom: y + this.font.lineHeight,
							},
							color: this.selectionColor,
						});
					}
				}

				// draw the glyph run for this segment
				this.drawGlyphRun(renderer, seg, x, y, inputColor, uppercaseDisplay);
			}
			if (caretInSeg) {
				const local = displayText.slice(segStart, cursorIndex);
				const caretOffset = this.measureDisplayText(local, uppercaseDisplay);
				const nextChar = cursorIndex < displayText.length ? displayText.charAt(cursorIndex) : ' ';
				const caretWidth = this.font.advance(nextChar);
				const left = Math.floor(x + caretOffset);
				const topY = y;
				const right = left + Math.max(1, Math.floor(caretWidth));
				const bottom = topY + this.font.lineHeight;
				nextCursorInfo = {
					row: cursorPosition.row,
					column: cursorPosition.column,
					x: left,
					y: topY,
					width: Math.max(1, Math.floor(caretWidth)),
					height: this.font.lineHeight,
					baseChar: nextChar,
					baseColor: OUTPUT_COLORS.stdout,
				};
				if (this.caretVisible) {
					const renderFont = this.font.renderFont();
					const ops: CaretDrawOps = {
						fillRect: (x0, y0, x1, y1, color) => renderer.rect({
							kind: 'fill',
							area: { left: x0, top: y0, right: x1, bottom: y1 },
							color,
						}),
						strokeRect: (x0, y0, x1, y1, color) => renderer.rect({
							kind: 'rect',
							area: { left: x0, top: y0, right: x1, bottom: y1 },
							color,
						}),
						drawGlyph: (text, gx, gy, color) => renderer.glyphs({ glyphs: text, x: gx, y: gy, z: 0, color, font: renderFont }),
					};
					renderInlineCaret(ops, left, topY, right, bottom, left, true, this.caretColor, nextChar, this.characterBackgroundColor);
				}
			}
		}

		if (nextCursorInfo) {
			this.cursorScreenInfo = nextCursorInfo;
		}
	}

	private drawGlyphBackgrounds(renderer: RenderFacade, text: string, originX: number, originY: number, uppercase: boolean): void {
		const display = this.toDisplayText(text, uppercase);
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
			renderer.rect({
				kind: 'fill',
				area: {
					left: cursorX,
					top: originY,
					right: cursorX + advance,
					bottom: originY + this.font.lineHeight,
				},
				color: this.characterBackgroundColor,
			});
			cursorX += advance;
		}
	}

	private drawGlyphRun(renderer: RenderFacade, text: string, originX: number, originY: number, tint: color, uppercase: boolean): void {
		const renderFont = this.font.renderFont();
		const display = this.toDisplayText(text, uppercase);
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
				renderer.glyphs({ glyphs: ch, x: cursorX, y: originY, z: 0, color: tint, font: renderFont });
			}
			cursorX += advance;
		}
	}

	private toDisplayText(value: string, uppercase: boolean): string {
		if (uppercase && this.runtime.canonicalization !== 'none') {
			return applyCaseOutsideStrings(value, (ch) => ch.toUpperCase());
		}
		return value;
	}

	private measureDisplayText(value: string, uppercase: boolean): number {
		if (!value) {
			return 0;
		}
		// Match renderer/tab handling: expand tabs to TAB_SPACES spaces before measuring
		const display = this.toDisplayText(value, uppercase).replace(/\t/g, ' '.repeat(TAB_SPACES));
		return this.font.measure(display);
	}

	private useUppercaseDisplay(): boolean {
		return this.font.variant === 'tiny' || this.uppercaseDisplayOverride;
	}
}
