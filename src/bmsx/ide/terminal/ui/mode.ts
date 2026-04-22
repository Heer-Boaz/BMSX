import type { color } from '../../../render/shared/submissions';
import { BmsxColors } from '../../../machine/devices/vdp/vdp';
import { EditorFont } from '../../editor/ui/view/font';
import type { FontVariant } from '../../../render/shared/bmsx_font';
import { applyCaseOutsideStrings, invalidateLuaCommentContextFromRow } from '../../common/text';
import { drawEditorText } from '../../editor/render/text_renderer';
import { drawCompletionPopupWithRenderer, drawParameterHintOverlayWithRenderer } from '../../editor/render/completion';
import {
	createInlineTextField,
	applyInlineFieldEditing,
	clearSelection,
	setFieldText,
	deleteSelection,
	insertValue,
	getCursorOffset,
	setCursorPosition,
	setCursorFromOffset,
	selectionAnchorOffset,
	setSelectionAnchorPosition,
} from '../../editor/ui/inline_text_field';
import type { InlineInputOptions, TextField, CursorScreenInfo, EditContext } from '../../common/models';
import * as constants from '../../common/constants';
import { OverlayRenderer } from '../../runtime/overlay_renderer';
import {
	isKeyJustPressed as isKeyJustPressed,
	isCtrlDown,
	isMetaDown,
	isAltDown
} from '../../editor/input/keyboard/key_input';
import { resolveSnapshotExpression, describeLuaValueForInspector } from '../../editor/contrib/intellisense/engine';
import { consumeIdeKey, shouldRepeatKeyFromPlayer } from '../../editor/input/keyboard/key_input';
import { CompletionController } from '../../editor/contrib/suggest/completion_controller';
import type { ModuleAliasEntry } from '../../editor/contrib/intellisense/semantic_model';
import type { Viewport } from '../../../rompack/format';
import { Runtime } from '../../../machine/runtime/runtime';
import * as luaPipeline from '../../runtime/lua_pipeline';
import { TerminalCommandDispatcher as TerminalCommandDispatcher } from './commands';
import { extractErrorMessage } from '../../../lua/value';
import { valueToString } from '../../../machine/firmware/globals';
import type { Value } from '../../../machine/cpu/cpu';
import {
	truncatePanelLabel,
	type TerminalPanelGridLayout,
} from '../completion_panel/model';
import { drawTerminalGridPanel } from '../completion_panel/renderer';
import { TerminalSuggestController } from './suggest_controller';
import { TerminalSuggestModel } from '../common/suggest_model';
import type { MutableTextPosition, TextBuffer } from '../../editor/text/text_buffer';
import { clamp } from '../../../common/clamp';
import { COLOR_COMPLETION_PREVIEW_TEXT, TAB_SPACES } from '../../common/constants';
import { advancePhaseBlink, resetBlinkState } from '../../editor/ui/view/caret/blink';
import { measureWrappedInlineSegmentDecoration, resolveInlineFieldSelectionState } from '../../editor/ui/inline_field_view';

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

class InlineFieldTextBuffer implements TextBuffer {
	public constructor(
		private readonly getLines: () => readonly string[],
		private readonly getTextValue: () => string,
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
		return this.getTextValue();
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
	private readonly uppercaseDisplayOverride = true;
	private readonly maxEntries: number;
	private readonly characterBackgroundColor = { r: 0, g: 0, b: 0, a: CHARACTER_TILE_ALPHA } as color;
	private readonly caretColor = BmsxColors[15];
	private readonly selectionColor = BmsxColors[11];
	private readonly field: TextField = createInlineTextField();
	private readonly output: TerminalOutputEntry[] = [];
	private readonly history: string[] = [];
	private historyIndex: number = null;
	private readonly completion: CompletionController;
	private readonly suggestModel: TerminalSuggestModel;
	private readonly suggestController: TerminalSuggestController;
	private readonly buffer: TextBuffer;
	private readonly blink = { blinkTimer: 0, cursorVisible: true };
	private active = false;
	private textVersion = 0;
	private readonly terminalCommands: TerminalCommandDispatcher;
	private pagerSessionActive = false;
	private pagerActive = false;
	private pagerQueue: TerminalOutputEntry[] = [];
	private pagerLinesRemaining = 0;
	private pagerViewOffsetLines = 0;
	private lastSurfaceWidth = 0;
	private lastSurfaceHeight = 0;

	private cachedLines: string[] = [''];
	private cachedLinesVersion = -1;
	private promptPrefix = '> ';
	private cursorScreenInfo: CursorScreenInfo = null;
	private readonly cursorScreenInfoScratch: CursorScreenInfo = { row: 0, column: 0, x: 0, y: 0, width: 0, height: 0, baseChar: ' ', baseColor: 0 };
	private currentRenderer: OverlayRenderer = null;
	constructor(private readonly runtime: Runtime) {
		this.terminalCommands = new TerminalCommandDispatcher(this.runtime);
		this.setPromptPrefix(this.terminalCommands.getPrompt());

		this.font = new EditorFont(runtime.activeIdeFontVariant);
		this.maxEntries = MAX_OUTPUT_ENTRIES;
		this.buffer = new InlineFieldTextBuffer(() => this.getLinesSnapshot(), () => this.field.text, () => this.textVersion);
		const owner = this;
		this.completion = new class extends CompletionController {
			private readonly cursorScratch = { row: 0, column: 0 };
			private readonly clampScratch = { row: 0, column: 0 };

			protected override isCompletionContextActive(): boolean {
				return owner.active && !owner.suggestModel.hasOpenPanel;
			}

			protected override isCompletionReady(): boolean {
				return this.isCompletionContextActive();
			}

			protected override shouldAutoTrigger(): boolean {
				return this.isCompletionContextActive();
			}

			protected override getBuffer() {
				return owner.buffer;
			}

			protected override getTextVersion(): number {
				return owner.textVersion;
			}

			protected override getActivePath(): string {
				return '<terminal>';
			}

			protected override getSemanticDefinitions() {
				return [];
			}

			protected override getModuleAliases(_path: string): Map<string, ModuleAliasEntry> {
				return new Map<string, ModuleAliasEntry>();
			}

			protected override getCursorPosition(): { row: number; column: number } {
				this.cursorScratch.row = owner.field.cursorRow;
				this.cursorScratch.column = owner.field.cursorColumn;
				return this.cursorScratch;
			}

			protected override setCursorPosition(row: number, column: number): void {
				setCursorPosition(owner.field, row, column);
				owner.completion.onCursorMoved();
			}

			protected override setSelectionAnchor(row: number, column: number): void {
				setSelectionAnchorPosition(owner.field, row, column);
				owner.completion.onCursorMoved();
			}

			protected override getCharAt(row: number, column: number): string {
				const lines = owner.getLinesSnapshot();
				if (row < 0 || row >= lines.length) {
					return '';
				}
				const line = lines[row];
				if (column < 0 || column >= line.length) {
					return '';
				}
				return line.charAt(column);
			}

			protected override prepareUndoRecord(): void {
				// Terminal inline field does not use IDE undo stack.
			}

			protected override replaceSelection(text: string): void {
				const previous = owner.field.text;
				deleteSelection(owner.field);
				if (text.length > 0) {
					insertValue(owner.field, text);
				}
				const context = text.length > 0
					? { kind: 'insert', text } as EditContext
					: owner.buildEditContext(previous, owner.field.text);
				owner.handleTextMutation(previous, context);
			}

			protected override clampBufferPosition(row: number, column: number): { row: number; column: number } {
				const lines = owner.getLinesSnapshot();
				const clampedRow = clamp(row, 0, Math.max(0, lines.length - 1));
				const lineLength = lines[clampedRow]?.length ?? 0;
				this.clampScratch.row = clampedRow;
				this.clampScratch.column = clamp(column, 0, lineLength);
				return this.clampScratch;
			}

			protected override afterCompletionApplied(): void {
				owner.resetBlink();
				if (owner.cursorScreenInfo) {
					owner.cursorScreenInfo.baseColor = OUTPUT_COLORS.stdout;
				}
			}

			protected override clearSelectionAnchor(): void {
				clearSelection(owner.field);
			}
		}();
		this.completion.enterCommitsCompletion = true;
		this.suggestModel = new TerminalSuggestModel({
			getInputText: () => this.field.text,
			getCursorOffset: () => getCursorOffset(this.field),
			restoreInput: (text, cursor) => this.restoreInputState(text, cursor),
			replaceInputRange: (start, end, value) => this.replaceInputRange(start, end, value),
			listCompletionCandidates: () => this.completion.listCompletionCandidates(),
			closeCompletionSession: () => this.completion.closeSession(),
			applyCompletionItem: (context, item) => this.completion.applyCompletionItem(context, item),
			buildSymbolCatalog: () => luaPipeline.listSymbols(this.runtime),
		});
		this.suggestController = new TerminalSuggestController({
			completion: this.completion,
			model: this.suggestModel,
			shouldRepeatKey: code => this.shouldRepeatKey(code),
		});
	}

	public activate(): void {
		this.active = true;
		this.resetInputField('');
		this.historyIndex = null;
		this.completion.closeSession();
		this.suggestModel.clear();
		this.resetPagerState();
		this.blink.blinkTimer = 0;
		this.blink.cursorVisible = true;
	}

	public deactivate(): void {
		this.active = false;
		this.suggestModel.clear();
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

	public appendStdoutLines(lines: string[], color: number = 15): void {
		for (let index = 0; index < lines.length; index += 1) {
			this.appendStdout(lines[index], color);
		}
	}

	public appendStderr(text: string): void {
		this.appendEntry({ color: 6, text });
	}

	public appendError(error: Error): void {
		const stackText = typeof error.stack === 'string' && error.stack.length > 0
			? error.stack
			: (error.message ?? String(error));
		// disable-next-line newline_normalization_pattern -- terminal errors are appended one stack/message line at a time.
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
		advancePhaseBlink(this.blink, deltaSeconds, CURSOR_BLINK_PERIOD);
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
		if (this.suggestController.handleInput()) {
			this.resetBlink();
			return null;
		}
		const options: InlineInputOptions = { allowSpace: true };
		const historyHandled = this.handleHistoryNavigation();
		if (historyHandled) {
			this.resetBlink();
		}
		const previousText = this.field.text;
		const previousCursor = getCursorOffset(this.field);
		const previousAnchor = selectionAnchorOffset(this.field);
		const textChanged = applyInlineFieldEditing(this.field, options);
		if (textChanged) {
			const editContext = this.buildEditContext(previousText, this.field.text);
			this.handleTextMutation(previousText, editContext);
		} else if (previousCursor !== getCursorOffset(this.field) || previousAnchor !== selectionAnchorOffset(this.field)) {
			if (!this.suggestModel.refreshOpenPanelFilter()) {
				this.completion.onCursorMoved();
			}
		}
		const submit = this.trySubmitCommand();
		if (submit !== null) {
			this.completion.closeSession();
			this.suggestModel.clear();
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
		else {
			this.historyIndex = null;
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
			const results: Value[] = luaPipeline.runConsoleChunk(this.runtime, source);
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
		this.suggestModel.openSymbolBrowser();
	}

	private restoreInputState(text: string, cursor: number): void {
		const previous = this.field.text;
		setFieldText(this.field, text, false);
		setCursorFromOffset(this.field, cursor);
		this.onExternalFieldMutation(previous, text);
	}

	private replaceInputRange(start: number, end: number, value: string): void {
		const previous = this.field.text;
		const next = previous.slice(0, start) + value + previous.slice(end);
		setFieldText(this.field, next, false);
		setCursorFromOffset(this.field, start + value.length);
		this.onExternalFieldMutation(previous, next);
	}

	private drawSymbolPanel(params: { contentWidth: number; lineHeight: number; panelLayout: TerminalPanelGridLayout | null; panelTop: number; uppercaseDisplay: boolean; }): void {
		const panel = this.suggestModel.symbolPanelState;
		const layout = params.panelLayout ?? this.suggestModel.symbolPanelGridLayout;
		if (!panel || !layout) {
			return;
		}
		this.suggestModel.ensureSymbolPanelSelectionVisible(layout);
		const charWidth = this.font.advance(' ');
		drawTerminalGridPanel({
			renderer: this.currentRenderer,
			contentWidth: params.contentWidth,
			lineHeight: params.lineHeight,
			charWidth,
			panelTop: params.panelTop,
			layout,
			entriesCount: panel.filtered.length,
			getLabel: (index) => truncatePanelLabel(panel.filtered[index].name, layout.cellWidth),
			filter: panel.filter,
			selectionIndex: panel.selectionIndex,
			displayRowOffset: panel.displayRowOffset,
			emptyMessageNoFilter: 'No symbols',
			emptyMessageWithFilter: 'No matches',
			paddingX: PADDING_X,
			backgroundColor: BmsxColors[constants.COLOR_COMPLETION_BACKGROUND],
			borderColor: BmsxColors[constants.COLOR_COMPLETION_BORDER],
			highlightColor: BmsxColors[constants.COLOR_COMPLETION_HIGHLIGHT],
			textColor: BmsxColors[constants.COLOR_COMPLETION_TEXT],
			highlightTextColor: BmsxColors[constants.COLOR_COMPLETION_HIGHLIGHT_TEXT],
			drawText: (text, x, y, color) => this.drawGlyphRun(this.currentRenderer, text, x, y, color, params.uppercaseDisplay),
		});
	}

	private drawCompletionPanel(params: { contentWidth: number; lineHeight: number; panelLayout: TerminalPanelGridLayout | null; panelTop: number; uppercaseDisplay: boolean; }): void {
		const panel = this.suggestModel.completionPanelState;
		const layout = params.panelLayout ?? this.suggestModel.completionPanelGridLayout;
		if (!panel || !layout) {
			return;
		}
		this.suggestModel.ensureCompletionPanelSelectionVisible(layout);
		const charWidth = this.font.advance(' ');
		drawTerminalGridPanel({
			renderer: this.currentRenderer,
			contentWidth: params.contentWidth,
			lineHeight: params.lineHeight,
			charWidth,
			panelTop: params.panelTop,
			layout,
			entriesCount: panel.filtered.length,
			getLabel: (index) => truncatePanelLabel(panel.filtered[index].label, layout.cellWidth),
			filter: panel.filter,
			selectionIndex: panel.selectionIndex,
			displayRowOffset: panel.displayRowOffset,
			emptyMessageNoFilter: 'No completions',
			emptyMessageWithFilter: 'No matches',
			paddingX: PADDING_X,
			backgroundColor: BmsxColors[constants.COLOR_COMPLETION_BACKGROUND],
			borderColor: BmsxColors[constants.COLOR_COMPLETION_BORDER],
			highlightColor: BmsxColors[constants.COLOR_COMPLETION_HIGHLIGHT],
			textColor: BmsxColors[constants.COLOR_COMPLETION_TEXT],
			highlightTextColor: BmsxColors[constants.COLOR_COMPLETION_HIGHLIGHT_TEXT],
			drawText: (text, x, y, color) => this.drawGlyphRun(this.currentRenderer, text, x, y, color, params.uppercaseDisplay),
		});
	}

	public draw(renderer: OverlayRenderer, surface: Viewport): void {
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
			const displayInput = this.toDisplayText(this.field.text);
			const inputWrap = this.wrapDisplayWithFirstWidth(displayInput, firstLineMax, otherLineMax, uppercaseDisplay);

			// space available for output lines above the input area
			const availableHeight = surface.height - PADDING_Y * 2 - (inputWrap.segments.length * lineHeight);
			const baseMaxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
			let panelLayout: TerminalPanelGridLayout = null;
			let panelRows = 0;
			if (this.suggestModel.completionPanelState) {
				const charWidth = this.font.advance(' ');
				const maxColumns = Math.max(1, Math.floor(contentWidth / charWidth));
				panelLayout = this.suggestModel.updateCompletionPanelLayout(
					maxColumns,
					baseMaxLines,
					SYMBOL_PANEL_MIN_CELL_WIDTH,
					SYMBOL_PANEL_COLUMN_GAP,
					SYMBOL_PANEL_PADDING_X,
					SYMBOL_PANEL_PADDING_Y,
				);
			} else if (this.suggestModel.symbolPanelState) {
				const charWidth = this.font.advance(' ');
				const maxColumns = Math.max(1, Math.floor(contentWidth / charWidth));
				panelLayout = this.suggestModel.updateSymbolPanelLayout(
					maxColumns,
					baseMaxLines,
					SYMBOL_PANEL_MIN_CELL_WIDTH,
					SYMBOL_PANEL_COLUMN_GAP,
					SYMBOL_PANEL_PADDING_X,
					SYMBOL_PANEL_PADDING_Y,
				);
			}
			if (panelLayout) {
				panelRows = panelLayout.visibleRows + panelLayout.paddingY * 2;
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
				this.drawGlyphRun(renderer, line.text, PADDING_X, y, BmsxColors[color], uppercaseDisplay);
				y += lineHeight;
			}

			// compute where input block starts (positioned right after visible output lines,
			// so the input moves upward as output fills the viewport — terminal-like behavior)
			const panelTop = PADDING_Y + visibleLines.length * lineHeight;
			const inputStartY = panelTop + panelRows * lineHeight;
			if (this.suggestModel.completionPanelState) {
				this.drawCompletionPanel({
					contentWidth,
					lineHeight,
					panelLayout,
					panelTop,
					uppercaseDisplay,
				});
			} else if (this.suggestModel.symbolPanelState) {
				this.drawSymbolPanel({
					contentWidth,
					lineHeight,
					panelLayout,
					panelTop,
					uppercaseDisplay,
				});
			}

			// draw prompt at the first input line then draw wrapped input lines (first segment after prompt)
			const promptColor = BmsxColors[OUTPUT_COLORS.prompt];
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
		if (this.suggestModel.hasOpenPanel) {
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
		resetBlinkState(this.blink);
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
		const normalized = this.toDisplayText(text);
		const limit = Math.max(8, maxWidth);
		const uppercaseDisplay = this.useUppercaseDisplay();
		const measure = (value: string): number => this.measureDisplayText(value, uppercaseDisplay);
		const segments: string[] = [];
		let segmentStart = 0;
		let lastBreak = -1;
		for (let index = 0; index < normalized.length; index += 1) {
			const ch = normalized.charAt(index);
			if (ch === ' ' || ch === '\t') {
				lastBreak = index;
			}
			const candidateWidth = measure(normalized.slice(segmentStart, index + 1));
			if (candidateWidth <= limit) {
				continue;
			}
			if (lastBreak >= segmentStart) {
				segments.push(normalized.slice(segmentStart, lastBreak));
				segmentStart = lastBreak + 1;
				lastBreak = -1;
				index = segmentStart - 1;
				continue;
			}
			if (index == segmentStart) {
				segments.push(normalized.charAt(index));
				segmentStart = index + 1;
			} else {
				segments.push(normalized.slice(segmentStart, index));
				segmentStart = index;
			}
			lastBreak = -1;
		}
		if (segmentStart < normalized.length) {
			segments.push(normalized.slice(segmentStart));
		}
		return segments.length > 0 ? segments : [''];
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
		const displayInput = this.toDisplayText(this.field.text);
		const inputWrap = this.wrapDisplayWithFirstWidth(displayInput, firstLineMax, otherLineMax, uppercaseDisplay);
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

	private drawPagerOverlay(renderer: OverlayRenderer, surface: Viewport, lineHeight: number, uppercaseDisplay: boolean): void {
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
		this.drawGlyphRun(renderer, text, PADDING_X, y, BmsxColors[OUTPUT_COLORS.system], uppercaseDisplay);
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
		const context = previousText !== null ? this.buildEditContext(previousText, this.field.text) : editContext;
		this.textVersion += 1;
		this.cachedLinesVersion = -1;
		invalidateLuaCommentContextFromRow(this.buffer, 0);
		if (!this.suggestModel.refreshOpenPanelFilter()) {
			this.completion.updateAfterEdit(context);
		}
	}

	private onExternalFieldMutation(previous: string, next: string): void {
		if (previous === next) {
			return;
		}
		this.handleTextMutation(previous, null);
	}

	private drawCompletionOverlays(surface: Viewport, promptWidth: number): void {
		if (this.suggestModel.hasOpenPanel) {
			return;
		}
		const bounds = {
			codeTop: PADDING_Y,
			codeBottom: surface.height - PADDING_Y,
			codeLeft: PADDING_X,
			codeRight: surface.width - PADDING_X,
			textLeft: PADDING_X + promptWidth,
		};
		const uppercaseDisplay = this.useUppercaseDisplay();
		const measure = (text: string): number => this.measureDisplayText(text, uppercaseDisplay);
		const draw = (text: string, x: number, y: number, color: number): void => {
			drawEditorText(this.font, this.toRenderedGlyphText(text, uppercaseDisplay), x, y, undefined, color);
		};
		this.completion.popupBounds = drawCompletionPopupWithRenderer(this.completion.session, this.cursorScreenInfo, this.font.lineHeight, bounds, measure, draw, this.completion.popupBoundsScratch);
		drawParameterHintOverlayWithRenderer(this.completion.hint, this.cursorScreenInfo, this.font.lineHeight, bounds, measure, draw);
	}

	// New helper: wraps display text with a smaller first-line width (after prompt) and full width for following lines.
	private wrapDisplayWithFirstWidth(text: string, firstWidth: number, otherWidth: number, uppercaseDisplay: boolean): { segments: string[]; starts: number[] } {
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
			const adv = ch === '\t' ? this.font.advance(' ') * constants.TAB_SPACES : this.measureDisplayText(ch, uppercaseDisplay);
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
	private drawMultilineInput(renderer: OverlayRenderer, baseX: number, baseY: number, promptWidth: number, wrap: { segments: string[]; starts: number[] }): void {
		const inputColor = BmsxColors[OUTPUT_COLORS.stdout];
		const selectionState = resolveInlineFieldSelectionState(this.field);
		const uppercaseDisplay = this.useUppercaseDisplay();
		const displayText = this.toDisplayText(this.field.text);
		const inlinePreview = selectionState.hasSelection ? null : this.completion.getInlineCompletionPreview();
		let nextCursorInfo: CursorScreenInfo = null;
		const cursorRow = this.field.cursorRow;
		const cursorColumn = this.field.cursorColumn;
		const segmentCount = wrap.segments.length;
		const measureText = (text: string): number => this.measureDisplayText(text, uppercaseDisplay);
		const measureTextRange = (text: string, start: number, end: number): number => this.measureDisplayTextRange(text, start, end, uppercaseDisplay);

		for (let si = 0; si < segmentCount; si += 1) {
			const seg = wrap.segments[si];
			const segStart = wrap.starts[si];
			const segLen = seg.length;
			const segmentDecoration = measureWrappedInlineSegmentDecoration(
				displayText,
				selectionState,
				segStart,
				segLen,
				si,
				segmentCount,
				baseX,
				baseY,
				promptWidth,
				this.font.lineHeight,
				measureText,
				measureTextRange,
			);
			const x = segmentDecoration.x;
			const y = segmentDecoration.y;
			const shouldRenderInlineGhost = segmentDecoration.caretInSegment
				&& inlinePreview !== null
				&& inlinePreview.row === cursorRow
				&& inlinePreview.column === cursorColumn;
			if (shouldRenderInlineGhost) {
				const prefixText = seg.slice(0, segmentDecoration.caretLocalIndex);
				const suffixText = seg.slice(segmentDecoration.caretLocalIndex);
				const ghostWidth = this.measureDisplayText(inlinePreview.suffix, uppercaseDisplay);
				const prefixWidth = segmentDecoration.caretBaseX - x;

				// draw glyph backgrounds before overlays/text so selection remains visible
				this.drawGlyphBackgrounds(renderer, prefixText, x, y, uppercaseDisplay);
				this.drawGlyphBackgrounds(renderer, inlinePreview.suffix, x + prefixWidth, y, uppercaseDisplay);
				this.drawGlyphBackgrounds(renderer, suffixText, x + prefixWidth + ghostWidth, y, uppercaseDisplay);

				// draw glyph runs (ghost inserted at caret)
				this.drawGlyphRun(renderer, prefixText, x, y, inputColor, uppercaseDisplay);
				this.drawGlyphRun(renderer, inlinePreview.suffix, x + prefixWidth, y, BmsxColors[COLOR_COMPLETION_PREVIEW_TEXT], uppercaseDisplay);
				this.drawGlyphRun(renderer, suffixText, x + prefixWidth + ghostWidth, y, inputColor, uppercaseDisplay);
			} else {
				// draw glyph backgrounds before overlays/text so selection remains visible
				this.drawGlyphBackgrounds(renderer, seg, x, y, uppercaseDisplay);

				// draw selection background for this segment if selection overlaps
				if (segmentDecoration.hasSelection && segmentDecoration.selectionWidth > 0) {
					renderer.rect({
						kind: 'fill',
						area: {
							left: segmentDecoration.selectionLeft,
							top: y,
							right: segmentDecoration.selectionLeft + segmentDecoration.selectionWidth,
							bottom: y + this.font.lineHeight,
						},
						color: this.selectionColor,
					});
				}

				// draw the glyph run for this segment
				this.drawGlyphRun(renderer, seg, x, y, inputColor, uppercaseDisplay);
			}
			if (segmentDecoration.caretInSegment) {
				const nextChar = segmentDecoration.caretChar;
				const left = segmentDecoration.caretLeft;
				const topY = y;
				const right = left + Math.max(1, Math.floor(segmentDecoration.caretWidth));
				const bottom = topY + this.font.lineHeight;
				nextCursorInfo = this.cursorScreenInfo ?? this.cursorScreenInfoScratch;
				nextCursorInfo.row = cursorRow;
				nextCursorInfo.column = cursorColumn;
				nextCursorInfo.x = left;
				nextCursorInfo.y = topY;
				nextCursorInfo.width = Math.max(1, Math.floor(segmentDecoration.caretWidth));
				nextCursorInfo.height = this.font.lineHeight;
				nextCursorInfo.baseChar = nextChar;
				nextCursorInfo.baseColor = OUTPUT_COLORS.stdout;
				if (this.blink.cursorVisible) {
					const renderFont = this.font.renderFont();
					renderer.rect({
						kind: 'fill',
						area: { left, top: topY, right, bottom },
						color: this.caretColor,
					});
					renderer.glyphs({ glyphs: nextChar, x: left, y: topY, z: 0, color: this.characterBackgroundColor, font: renderFont });
				}
			}
		}

		if (nextCursorInfo) {
			this.cursorScreenInfo = nextCursorInfo;
		}
	}

	private drawGlyphBackgrounds(renderer: OverlayRenderer, text: string, originX: number, originY: number, uppercase: boolean): void {
		const width = this.measureDisplayText(text, uppercase);
		if (width <= 0) {
			return;
		}
		renderer.rect({
			kind: 'fill',
			area: {
				left: originX,
				top: originY,
				right: originX + width,
				bottom: originY + this.font.lineHeight,
			},
			color: this.characterBackgroundColor,
		});
	}

	private drawGlyphRun(renderer: OverlayRenderer, text: string, originX: number, originY: number, tint: color, uppercase: boolean): void {
		const display = this.toRenderedGlyphText(text, uppercase);
		if (!/[^\s]/.test(display)) {
			return;
		}
		renderer.glyphs({ glyphs: display, x: originX, y: originY, z: 0, color: tint, font: this.font.renderFont() });
	}

	private toDisplayText(value: string): string {
		return value;
	}

	private toRenderedGlyphText(value: string, uppercase: boolean): string {
		const expanded = this.toDisplayText(value).replace(/\t/g, ' '.repeat(TAB_SPACES));
		return uppercase ? applyCaseOutsideStrings(expanded, (ch) => ch.toUpperCase()) : expanded;
	}

	private measureDisplayText(value: string, uppercase: boolean): number {
		if (!value) {
			return 0;
		}
		return this.font.measure(this.toRenderedGlyphText(value, uppercase));
	}

	private measureDisplayTextRange(value: string, start: number, end: number, uppercase: boolean): number {
		if (start >= end) {
			return 0;
		}
		let width = 0;
		let inString = false;
		let quote = '';
		let escapeNext = false;
		for (let index = 0; index < end; index += 1) {
			const ch = value.charAt(index);
			let measured = ch;
			if (inString) {
				if (escapeNext) {
					escapeNext = false;
				} else if (ch === '\\') {
					escapeNext = true;
				} else if (ch === quote) {
					inString = false;
					quote = '';
				}
			} else if (ch === '"' || ch === '\'' || ch === '`') {
				inString = true;
				quote = ch;
			} else if (uppercase) {
				measured = ch.toUpperCase();
			}
			if (index >= start) {
				width += measured === '\t'
					? this.font.advance(' ') * TAB_SPACES
					: this.font.advance(measured);
			}
		}
		return width;
	}

	private useUppercaseDisplay(): boolean {
		return this.font.variant === 'tiny' || this.uppercaseDisplayOverride;
	}
}
