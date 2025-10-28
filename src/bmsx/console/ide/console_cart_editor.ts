import { $ } from '../../core/game';
import type { KeyboardInput } from '../../input/keyboardinput';
import type { BGamepadButton } from '../../input/inputtypes';
import type { ViewportMetrics } from '../../platform/platform';
import { BmsxConsoleApi } from '../api';
import type {
	BmsxConsoleMetadata,
	ConsoleLuaBuiltinDescriptor,
	ConsoleLuaDefinitionLocation,
	ConsoleLuaHoverRequest,
	ConsoleLuaHoverResult,
	ConsoleLuaResourceCreationRequest,
	ConsoleLuaSymbolEntry,
	ConsoleResourceDescriptor,
} from '../types';
import { ConsoleEditorFont } from '../editor_font';
import { DEFAULT_CONSOLE_FONT_VARIANT, getConsoleFontPreset, type ConsoleFontVariant } from '../font';
import { drawEditorColoredText, drawEditorText } from './text_renderer';
import { Msx1Colors } from 'bmsx';
import { renderCodeArea } from './render_code_area';
import { clamp } from '../../utils/utils';
import { CHARACTER_CODES } from './character_map';
import * as constants from './constants';
// Intellisense data is handled by CompletionController
import { CompletionController } from './completion_controller';
import { ProblemsPanelController } from './problems_panel';
import { computeAggregatedEditorDiagnostics, type DiagnosticContextInput } from './diagnostics';
import { isIdentifierChar, isIdentifierStartChar } from './text_utils';
import type { InlineFieldEditingHandlers, InlineFieldMetrics } from './inline_text_field';
import {
	applyInlineFieldEditing,
	applyInlineFieldPointer,
	caretX as inlineFieldCaretX,
	createInlineTextField,
	measureRange as inlineFieldMeasureRange,
	selectionRange as inlineFieldSelectionRange,
	setFieldText,
} from './inline_text_field';
import { buildHoverContentLines as buildHoverContentLinesExternal } from './hover_content';
import { isLuaCommentContext, measureTextGeneric, truncateTextToWidth as truncateTextToWidthExternal } from './text_utils_local';
import { ConsoleScrollbar, ScrollbarController } from './scrollbar';
import { renderTopBar } from './render_top_bar';
import { renderTabBar } from './render_tab_bar';
import { renderStatusBar } from './render_status_bar';
import { renderCreateResourceBar, renderSearchBar, renderResourceSearchBar, renderSymbolSearchBar, renderRenameBar, renderLineJumpBar } from './render_inline_bars';
import {
	computeErrorOverlayBounds,
	renderErrorOverlay,
	renderErrorOverlayText,
	type ErrorOverlayRenderConfig
} from './render_error_overlay';
// Resource panel rendering is handled via ResourcePanelController
import { ResourcePanelController } from './resource_panel_controller';
import { InputController } from './input_controller';
import { ConsoleCartEditorTextOps } from './console_cart_editor_textops';
import { ConsoleCodeLayout } from './code_layout';
import { buildRuntimeErrorLines as buildRuntimeErrorLinesUtil, computeRuntimeErrorOverlayMaxWidth, wrapRuntimeErrorLine as wrapRuntimeErrorLineUtil } from './runtime_error_utils';
import type {
	CachedHighlight,
	CodeHoverTooltip,
	CodeTabContext,
	ConsoleEditorOptions,
	ConsoleEditorSerializedState,
	ConsoleRuntimeBridge,
	CrtOptionsSnapshot,
	CursorScreenInfo,
	EditorResolutionMode,
	EditorSnapshot,
	EditorTabDescriptor,
	EditorTabId,
	EditorTabKind,
	EditContext,
	EditorDiagnostic,
	HighlightLine,
	InlineInputOptions,
	InlineTextField,
	MessageState,
	PendingActionPrompt,
	PointerSnapshot,
	Position,
	RectBounds,
	RepeatEntry,
	ResourceBrowserItem,
	ResourceCatalogEntry,
	ResourceSearchResult,
	ResourceViewerState,
	RuntimeErrorOverlay,
	ScrollbarKind,
	SearchMatch,
	SymbolCatalogEntry,
	SymbolSearchResult,
	TabDragState,
	TopBarButtonId,
	VisualLineSegment,
} from './types';
import { ReferenceState, resolveReferenceLookup, type ReferenceMatchInfo } from './reference_navigation';
import { filterReferenceCatalog, findExpressionMatches, definitionKeyFromDefinition, type ReferenceCatalogEntry, type ReferenceSymbolEntry } from './reference_symbol_search';
import {
	buildReferenceCatalogForExpression as buildProjectReferenceCatalog,
	computeSourceLabel,
	resolveDefinitionKeyForExpression,
	type ProjectReferenceEnvironment,
} from './reference_sources';
import { RenameController, type RenameCommitPayload, type RenameCommitResult } from './rename_controller';
import { planRenameLineEdits } from './rename_apply';
import {
	consumeKey as consumeKeyboardKey,
	getKeyboardButtonState,
	isKeyJustPressed as isKeyJustPressedGlobal,
	isKeyTyped as isKeyTypedGlobal,
	isModifierPressed as isModifierPressedGlobal,
	shouldAcceptKeyPress as shouldAcceptKeyPressGlobal,
} from './input_helpers';

const EDITOR_TOGGLE_KEY = 'Escape';
const EDITOR_TOGGLE_GAMEPAD_BUTTONS: readonly BGamepadButton[] = ['select', 'start'];

// Intellisense data is handled by CompletionController

export class ConsoleCartEditor extends ConsoleCartEditorTextOps {
	protected readonly playerIndex: number;
	private readonly metadata: BmsxConsoleMetadata;
	private readonly fontVariant: ConsoleFontVariant;
	private readonly loadSourceFn: () => string;
	private readonly saveSourceFn: (source: string) => Promise<void>;
	private readonly loadLuaResourceFn: (assetId: string) => string;
	private readonly saveLuaResourceFn: (assetId: string, source: string) => Promise<void>;
	private readonly createLuaResourceFn: (request: ConsoleLuaResourceCreationRequest) => Promise<ConsoleResourceDescriptor>;
	private readonly listResourcesFn: () => ConsoleResourceDescriptor[];
	private readonly inspectLuaExpressionFn: (request: ConsoleLuaHoverRequest) => ConsoleLuaHoverResult | null;
	private readonly listLuaSymbolsFn: (assetId: string | null, chunkName: string | null) => ConsoleLuaSymbolEntry[];
	private readonly listGlobalLuaSymbolsFn: () => ConsoleLuaSymbolEntry[];
	private readonly listBuiltinLuaFunctionsFn: () => ConsoleLuaBuiltinDescriptor[];
	private readonly primaryAssetId: string | null;
	private hoverTooltip: CodeHoverTooltip | null = null;
	private lastPointerSnapshot: PointerSnapshot | null = null;
	private lastInspectorResult: ConsoleLuaHoverResult | null = null;
	private inspectorRequestFailed = false;
	private gotoHoverHighlight: { row: number; startColumn: number; endColumn: number; expression: string } | null = null;
	private viewportWidth: number;
	private viewportHeight: number;
	private readonly font: ConsoleEditorFont;
	private readonly lineHeight: number;
	private readonly charAdvance: number;
	private readonly spaceAdvance: number;
	private readonly gutterWidth: number;
	private readonly headerHeight: number;
	private readonly tabBarHeight: number;
	private tabBarRowCount = 1;
	private readonly baseBottomMargin: number;
	private readonly repeatState: Map<string, RepeatEntry> = new Map();
	private readonly message: MessageState = { text: '', color: constants.COLOR_STATUS_TEXT, timer: 0, visible: false };
	private deferredMessageDuration: number | null = null;
	private runtimeErrorOverlay: RuntimeErrorOverlay | null = null;
	private executionStopRow: number | null = null;
	private readonly problemsPanel: ProblemsPanelController;
	private problemsPanelResizing = false;
	private diagnostics: EditorDiagnostic[] = [];
	private diagnosticsByRow: Map<number, EditorDiagnostic[]> = new Map();
	private diagnosticsDirty = true;
	private readonly codeTabContexts: Map<string, CodeTabContext> = new Map();
	private activeCodeTabContextId: string | null = null;
	private entryTabId: string | null = null;
	private readonly captureKeys: string[] = [...new Set([
		EDITOR_TOGGLE_KEY,
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
		'F12',
		'NumpadDivide',
		...CHARACTER_CODES,
	])];

	private static readonly EMPTY_DIAGNOSTICS: EditorDiagnostic[] = [];
	private static customClipboard: string | null = null;

	private readonly topBarButtonBounds: Record<TopBarButtonId, RectBounds> = {
		resume: { left: 0, top: 0, right: 0, bottom: 0 },
		reboot: { left: 0, top: 0, right: 0, bottom: 0 },
		save: { left: 0, top: 0, right: 0, bottom: 0 },
		resources: { left: 0, top: 0, right: 0, bottom: 0 },
		problems: { left: 0, top: 0, right: 0, bottom: 0 },
		filter: { left: 0, top: 0, right: 0, bottom: 0 },
		resolution: { left: 0, top: 0, right: 0, bottom: 0 },
		wrap: { left: 0, top: 0, right: 0, bottom: 0 },
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
	private blinkTimer = 0;
	private cursorVisible = true;
	private warnNonMonospace = false;
	private pointerSelecting = false;
	private pointerPrimaryWasPressed = false;
	private pointerAuxWasPressed = false;
	private readonly searchField: InlineTextField;
	private readonly symbolSearchField: InlineTextField;
	private readonly resourceSearchField: InlineTextField;
	private readonly lineJumpField: InlineTextField;
	private readonly createResourceField: InlineTextField;
	private readonly inlineFieldMetricsRef: InlineFieldMetrics;
	private readonly scrollbars: Record<ScrollbarKind, ConsoleScrollbar>;
	private readonly scrollbarController: ScrollbarController;
	private readonly input: InputController;
	private toggleInputLatch = false;
	private lastPointerClickTimeMs = 0;
	private lastPointerClickRow = -1;
	private lastPointerClickColumn = -1;
	private tabHoverId: string | null = null;
	private tabDragState: TabDragState | null = null;
	private crtOptionsSnapshot: CrtOptionsSnapshot | null = null;
	private resolutionMode: EditorResolutionMode = 'viewport';
	private readonly tabDirtyMarkerAssetId: string;
	private tabDirtyMarkerWidth: number | null = null;
	private tabDirtyMarkerHeight: number | null = null;
	protected cursorRevealSuspended = false;
	private searchActive = false;
	private searchVisible = false;
	private searchQuery = '';
	private symbolSearchQuery = '';
	private resourceSearchQuery = '';
	// Completion session state is fully handled by CompletionController
	private pendingEditContext: EditContext | null = null;
	private cursorScreenInfo: CursorScreenInfo | null = null;
	// parameter hints managed by completion controller
	private lineJumpActive = false;
	private symbolSearchActive = false;
	private symbolSearchVisible = false;
	private symbolSearchGlobal = false;
	private symbolSearchMode: 'symbols' | 'references' = 'symbols';
	private resourceSearchActive = false;
	private resourceSearchVisible = false;
	private lineJumpVisible = false;
	private lineJumpValue = '';
	private createResourceActive = false;
	private createResourceVisible = false;
	private createResourcePath = '';
	private createResourceError: string | null = null;
	private createResourceWorking = false;
	private lastCreateResourceDirectory: string | null = null;
	// completion session auto-trigger handled by completion controller
	private symbolCatalog: SymbolCatalogEntry[] = [];
	private referenceCatalog: ReferenceCatalogEntry[] = [];
	private symbolCatalogContext: { scope: 'local' | 'global'; assetId: string | null; chunkName: string | null } | null = null;
	private symbolSearchMatches: SymbolSearchResult[] = [];
	private symbolSearchSelectionIndex = -1;
	private symbolSearchDisplayOffset = 0;
	private symbolSearchHoverIndex = -1;
	private resourceCatalog: ResourceCatalogEntry[] = [];
	private resourceSearchMatches: ResourceSearchResult[] = [];
	private resourceSearchSelectionIndex = -1;
	private resourceSearchDisplayOffset = 0;
	private resourceSearchHoverIndex = -1;
	private searchMatches: SearchMatch[] = [];
	private searchCurrentIndex = -1;
	private readonly referenceState: ReferenceState = new ReferenceState();
	private textVersion = 0;
	private lastSearchVersion = 0;
	private saveGeneration = 0;
	private appliedGeneration = 0;
	private lastSavedSource = '';
	private tabs: EditorTabDescriptor[] = [];
	private activeTabId: string | null = null;
	private resourceBrowserItems: ResourceBrowserItem[] = [];
	private resourceBrowserSelectionIndex = -1;
	// removed legacy hover field; hover state is owned by ResourcePanelController
	private resourcePanelVisible = false;
	private resourcePanelFocused = false;
	private resourcePanelResourceCount = 0;
	private pendingResourceSelectionAssetId: string | null = null;
	private resourcePanelWidthRatio: number | null = null;
	private resourcePanelResizing = false;
	// max line width computed by ResourcePanelController
	private readonly resourcePanel: ResourcePanelController;
	private readonly renameController: RenameController;
	private readonly layout: ConsoleCodeLayout;
	private codeVerticalScrollbarVisible = false;
	private codeHorizontalScrollbarVisible = false;
	private cachedVisibleRowCount = 1;
	private cachedVisibleColumnCount = 1;
	private dimCrtInEditor: boolean = false; // Default value; can be changed via settings
	protected wordWrapEnabled = true;
	private lastPointerRowResolution: { visualIndex: number; segment: VisualLineSegment | null } | null = null;
	private readonly completion: CompletionController;

	constructor(options: ConsoleEditorOptions) {
		super();
		this.playerIndex = options.playerIndex;
		this.metadata = options.metadata;
		this.fontVariant = options.fontVariant ?? DEFAULT_CONSOLE_FONT_VARIANT;
		this.loadSourceFn = options.loadSource;
		this.saveSourceFn = options.saveSource;
		this.listResourcesFn = options.listResources;
		this.loadLuaResourceFn = options.loadLuaResource;
	this.saveLuaResourceFn = options.saveLuaResource;
	this.createLuaResourceFn = options.createLuaResource;
	this.inspectLuaExpressionFn = options.inspectLuaExpression;
	this.listLuaSymbolsFn = options.listLuaSymbols;
	this.listGlobalLuaSymbolsFn = options.listGlobalLuaSymbols;
	this.listBuiltinLuaFunctionsFn = options.listBuiltinLuaFunctions;
	this.primaryAssetId = options.primaryAssetId;
		if ($.debug) {
			this.listResourcesFn();
		}
		this.viewportWidth = options.viewport.width;
		this.viewportHeight = options.viewport.height;
		this.font = new ConsoleEditorFont(this.fontVariant);
		this.tabDirtyMarkerAssetId = getConsoleFontPreset(this.fontVariant).tabDirtyMarkerAssetId;
		this.searchField = createInlineTextField();
		this.symbolSearchField = createInlineTextField();
		this.resourceSearchField = createInlineTextField();
		this.lineJumpField = createInlineTextField();
		this.createResourceField = createInlineTextField();
		this.applySearchFieldText(this.searchQuery, true);
		this.applySymbolSearchFieldText(this.symbolSearchQuery, true);
		this.applyResourceSearchFieldText(this.resourceSearchQuery, true);
		this.applyLineJumpFieldText(this.lineJumpValue, true);
		this.applyCreateResourceFieldText(this.createResourcePath, true);
		this.lineHeight = this.font.lineHeight();
		this.charAdvance = this.font.advance('M');
		this.spaceAdvance = this.font.advance(' ');
		this.layout = new ConsoleCodeLayout(this.font);
		this.inlineFieldMetricsRef = {
			measureText: (text: string) => this.measureText(text),
			advanceChar: (ch: string) => this.font.advance(ch),
			spaceAdvance: this.spaceAdvance,
			tabSpaces: constants.TAB_SPACES,
		};
		this.gutterWidth = 2;
		const primaryBarHeight = this.lineHeight + 4;
		this.headerHeight = primaryBarHeight;
		this.tabBarHeight = this.lineHeight + 3;
		this.baseBottomMargin = this.lineHeight + 6;
		this.scrollbars = {
			codeVertical: new ConsoleScrollbar('codeVertical', 'vertical'),
			codeHorizontal: new ConsoleScrollbar('codeHorizontal', 'horizontal'),
			resourceVertical: new ConsoleScrollbar('resourceVertical', 'vertical'),
			resourceHorizontal: new ConsoleScrollbar('resourceHorizontal', 'horizontal'),
			viewerVertical: new ConsoleScrollbar('viewerVertical', 'vertical'),
		};
		this.scrollbarController = new ScrollbarController(this.scrollbars as any);
			// Initialize resource panel controller
		this.resourcePanel = new ResourcePanelController({
			getViewportWidth: () => this.viewportWidth,
			getViewportHeight: () => this.viewportHeight,
			getBottomMargin: () => this.bottomMargin,
			codeViewportTop: () => this.codeViewportTop(),
			lineHeight: this.lineHeight,
			charAdvance: this.charAdvance,
			measureText: (t) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, this.font, t, x, y, c),
			drawColoredText: (a, t, colors, x, y) => drawEditorColoredText(a, this.font, t, colors, x, y, constants.COLOR_CODE_TEXT),
				drawRectOutlineColor: (a, l, t, r, b, col) => this.drawRectOutlineColor(a, l, t, r, b, col),
				playerIndex: this.playerIndex,
				listResources: () => this.listResourcesStrict(),
				openLuaCodeTab: (d) => this.openLuaCodeTab(d),
				openResourceViewerTab: (d) => this.openResourceViewerTab(d),
				focusEditorFromResourcePanel: () => this.focusEditorFromResourcePanel(),
				showMessage: (text, color, duration) => this.showMessage(text, color, duration),
			}, { resourceVertical: this.scrollbars.resourceVertical, resourceHorizontal: this.scrollbars.resourceHorizontal });
		// Initialize completion/intellisense controller
		this.completion = new CompletionController({
			getPlayerIndex: () => this.playerIndex,
			isCodeTabActive: () => this.isCodeTabActive(),
			getLines: () => this.lines,
			getCursorRow: () => this.cursorRow,
			getCursorColumn: () => this.cursorColumn,
			setCursorPosition: (row, column) => { this.cursorRow = row; this.cursorColumn = column; },
			setSelectionAnchor: (row, column) => { this.selectionAnchor = { row, column }; },
			replaceSelectionWith: (text) => this.replaceSelectionWith(text),
			updateDesiredColumn: () => this.updateDesiredColumn(),
			resetBlink: () => this.resetBlink(),
			revealCursor: () => this.revealCursor(),
			measureText: (text) => this.measureText(text),
			drawText: (api, text, x, y, color) => drawEditorText(api, this.font, text, x, y, color),
			getCursorScreenInfo: () => this.cursorScreenInfo,
			getLineHeight: () => this.lineHeight,
			getSpaceAdvance: () => this.spaceAdvance,
			getActiveCodeTabContext: () => this.getActiveCodeTabContext(),
			resolveHoverAssetId: (ctx) => this.resolveHoverAssetId(ctx as any),
			resolveHoverChunkName: (ctx) => this.resolveHoverChunkName(ctx as any),
			listLuaSymbols: (assetId, chunk) => this.listLuaSymbolsFn(assetId, chunk),
			listGlobalLuaSymbols: () => this.listGlobalLuaSymbolsFn(),
			listBuiltinLuaFunctions: () => this.listBuiltinLuaFunctionsFn(),
			charAt: (r, c) => this.charAt(r, c),
			getTextVersion: () => this.textVersion,
			shouldFireRepeat: (kb, code, dt) => this.input.shouldRepeatPublic(kb, code, dt),
		});
		this.completion.setEnterCommitsEnabled(false);
		// Initialize input controller
		this.input = new InputController({
			getPlayerIndex: () => this.playerIndex,
			isCodeTabActive: () => this.isCodeTabActive(),
			getLines: () => this.lines,
			setLines: (lines) => { this.lines = lines; this.markDiagnosticsDirty(); },
			getCursorRow: () => this.cursorRow,
			getCursorColumn: () => this.cursorColumn,
			setCursorPosition: (row, column) => { this.cursorRow = row; this.cursorColumn = column; },
			setSelectionAnchor: (row, column) => { this.selectionAnchor = { row, column }; },
			getSelection: () => this.getSelectionRange(),
			clearSelection: () => { this.selectionAnchor = null; },
			updateDesiredColumn: () => this.updateDesiredColumn(),
			resetBlink: () => this.resetBlink(),
			revealCursor: () => this.revealCursor(),
			ensureCursorVisible: () => this.ensureCursorVisible(),
			recordPreMutationSnapshot: (key) => this.recordSnapshotPre(key),
			pushPostMutationSnapshot: (key) => this.recordSnapshotPost(key),
			deleteSelection: () => this.deleteSelection(),
			deleteCharLeft: () => this.deleteCharLeft(),
			deleteCharRight: () => this.deleteCharRight(),
			deleteActiveLines: () => this.deleteActiveLines(),
			deleteWordBackward: () => this.deleteWordBackward(),
			insertNewline: () => this.insertNewline(),
			insertText: (text) => this.insertText(text),
			moveCursorLeft: (byWord, select) => this.moveCursorLeft(byWord, select),
			moveCursorRight: (byWord, select) => this.moveCursorRight(byWord, select),
			moveCursorUp: (select) => this.moveCursorUp(select),
			moveCursorDown: (select) => this.moveCursorDown(select),
			moveCursorHome: (select) => this.moveCursorHome(select),
			moveCursorEnd: (select) => this.moveCursorEnd(select),
			pageDown: (select) => this.pageDown(select),
			pageUp: (select) => this.pageUp(select),
			moveSelectionLines: (delta) => this.moveSelectionLines(delta),
			indentSelectionOrLine: () => this.indentSelectionOrLine(),
			unindentSelectionOrLine: () => this.unindentSelectionOrLine(),
		});
        this.problemsPanel = new ProblemsPanelController({
            lineHeight: this.lineHeight,
            measureText: (text) => this.measureText(text),
			drawText: (api, text, x, y, color) => drawEditorText(api, this.font, text, x, y, color),
			drawRectOutlineColor: (api, l, t, r, b, col) => this.drawRectOutlineColor(api, l, t, r, b, col),
			truncateTextToWidth: (text, maxWidth) => this.truncateTextToWidth(text, maxWidth),
			gotoDiagnostic: (diagnostic) => this.gotoDiagnostic(diagnostic),
        });
		this.renameController = new RenameController({
			processFieldEdit: (field, keyboard, options) => this.processInlineFieldEditing(field, keyboard, options),
			shouldFireRepeat: (keyboard, code, deltaSeconds) => this.shouldFireRepeat(keyboard, code, deltaSeconds),
			undo: () => this.undo(),
			redo: () => this.redo(),
			showMessage: (text, color, duration) => this.showMessage(text, color, duration),
			commitRename: (payload) => this.commitRename(payload),
			onRenameSessionClosed: () => this.focusEditorFromRename(),
		}, this.referenceState, this.playerIndex);
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
	this.applyResolutionModeToRuntime();
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
		this.ensureVisualLines();
		const visualIndex = this.positionToVisualIndex(tooltip.row, tooltip.startColumn);
		const relativeRow = visualIndex - this.scrollRow;
		if (relativeRow < 0 || relativeRow >= visibleRows) {
			tooltip.bubbleBounds = null;
			return;
		}
		const rowTop = codeTop + relativeRow * this.lineHeight;
		const segment = this.visualIndexToSegment(visualIndex);
		if (!segment) {
			tooltip.bubbleBounds = null;
			return;
		}
		const entry = this.getCachedHighlight(segment.row);
		const highlight = entry.hi;
		let columnStart = this.wordWrapEnabled ? segment.startColumn : this.scrollColumn;
		if (this.wordWrapEnabled) {
			if (columnStart < segment.startColumn || columnStart > segment.endColumn) {
				columnStart = segment.startColumn;
			}
		}
		const columnCount = this.wordWrapEnabled
			? Math.max(0, segment.endColumn - columnStart)
			: this.visibleColumnCount() + 8;
		const slice = this.sliceHighlightedLine(highlight, columnStart, columnCount);
		const sliceStartDisplay = slice.startDisplay;
		const sliceEndLimit = this.wordWrapEnabled ? this.columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
		const sliceEndDisplay = this.wordWrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
		const startDisplay = this.columnToDisplay(highlight, tooltip.startColumn);
		const endDisplay = this.columnToDisplay(highlight, tooltip.endColumn);
		const clampedStartDisplay = clamp(startDisplay, sliceStartDisplay, sliceEndDisplay);
		const clampedEndDisplay = clamp(endDisplay, clampedStartDisplay, sliceEndDisplay);
		const expressionStartX = textLeft + this.measureRangeFast(entry, sliceStartDisplay, clampedStartDisplay);
		const expressionEndX = textLeft + this.measureRangeFast(entry, sliceStartDisplay, clampedEndDisplay);
		const maxVisible = Math.max(1, Math.min(constants.HOVER_TOOLTIP_MAX_VISIBLE_LINES, content.length));
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
		const bubbleWidth = maxLineWidth + constants.HOVER_TOOLTIP_PADDING_X * 2;
		const bubbleHeight = visibleLines.length * this.lineHeight + constants.HOVER_TOOLTIP_PADDING_Y * 2;
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
		api.rectfill_color(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, constants.HOVER_TOOLTIP_BACKGROUND);
		api.rect(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, constants.HOVER_TOOLTIP_BORDER);
		for (let i = 0; i < visibleLines.length; i += 1) {
			const lineY = bubbleTop + constants.HOVER_TOOLTIP_PADDING_Y + i * this.lineHeight;
			drawEditorText(api, this.font, visibleLines[i], bubbleLeft + constants.HOVER_TOOLTIP_PADDING_X, lineY, constants.COLOR_STATUS_TEXT);
		}
		tooltip.bubbleBounds = { left: bubbleLeft, top: bubbleTop, right: bubbleLeft + bubbleWidth, bottom: bubbleTop + bubbleHeight };
	}

	public showWarningBanner(text: string, durationSeconds = 4.0): void {
		this.showMessage(text, constants.COLOR_STATUS_WARNING, durationSeconds);
		if (!this.active) {
			this.message.timer = Number.POSITIVE_INFINITY;
			this.deferredMessageDuration = durationSeconds;
		} else {
			this.deferredMessageDuration = null;
		}
	}

	public showRuntimeErrorInChunk(chunkName: string | null, line: number | null, column: number | null, message: string, hint?: { assetId: string | null; path?: string | null }): void {
		this.focusChunkSource(chunkName, hint);
		const overlayMessage = chunkName && chunkName.length > 0 ? `${chunkName}: ${message}` : message;
		this.showRuntimeError(line, column, overlayMessage);
	}

	public showRuntimeError(line: number | null, column: number | null, message: string): void {
		if (!this.active) {
			this.activate();
		}
		const hasLocation = typeof line === 'number' && Number.isFinite(line) && line >= 1;
		const processedLine = hasLocation ? Math.max(1, Math.floor(line!)) : null;
		const processedColumn = typeof column === 'number' && Number.isFinite(column) ? Math.floor(column!) - 1 : null;
		let targetRow = this.cursorRow;
		if (processedLine !== null) {
			targetRow = clamp(processedLine - 1, 0, this.lines.length - 1);
			this.cursorRow = targetRow;
		}
		const currentLine = this.lines[targetRow] ?? '';
		let targetColumn = this.cursorColumn;
		if (processedColumn !== null) {
			targetColumn = clamp(processedColumn, 0, currentLine.length);
			this.cursorColumn = targetColumn;
		}
		this.clampCursorColumn();
		targetColumn = this.cursorColumn;
		this.selectionAnchor = null;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.scrollbarController.cancel();
		this.cursorRevealSuspended = false;
		this.centerCursorVertically();
		this.updateDesiredColumn();
		this.revealCursor();
		this.resetBlink();
		const normalizedMessage = (message?.length > 0) ? message.trim() : 'Runtime error';
		const overlayMessage = processedLine !== null ? `Line ${processedLine}:${normalizedMessage}` : normalizedMessage;
		const overlayLines = this.buildRuntimeErrorLines(overlayMessage);
		const overlay: RuntimeErrorOverlay = {
			row: targetRow,
			column: targetColumn,
			lines: overlayLines,
			timer: Number.POSITIVE_INFINITY,
		};
		this.setActiveRuntimeErrorOverlay(overlay);
		this.setExecutionStopHighlight(processedLine !== null ? targetRow : null);
		const statusLine = overlayLines.length > 0 ? overlayLines[0] : 'Runtime error';
		this.showMessage(statusLine, constants.COLOR_STATUS_ERROR, 8.0);
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

	// resourceDescriptorMatchesFilter removed; controller owns filtering

	private openResourceDescriptor(descriptor: ConsoleResourceDescriptor): void {
		this.selectResourceInPanel(descriptor);
		if (descriptor.type === 'atlas') {
			this.showMessage('Atlas resources cannot be previewed in the console editor.', constants.COLOR_STATUS_WARNING, 3.2);
			this.focusEditorFromResourcePanel();
			return;
		}
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

	private setExecutionStopHighlight(row: number | null): void {
		const context = this.getActiveCodeTabContext();
		if (!context) {
			this.executionStopRow = null;
			return;
		}
		let nextRow = row;
		if (nextRow !== null) {
			const maxRow = Math.max(0, this.lines.length - 1);
			nextRow = clamp(nextRow, 0, maxRow);
		}
		context.executionStopRow = nextRow;
		this.executionStopRow = nextRow;
	}

	private clearExecutionStopHighlights(): void {
		this.executionStopRow = null;
		for (const context of this.codeTabContexts.values()) {
			context.executionStopRow = null;
		}
	}

	private syncRuntimeErrorOverlayFromContext(context: CodeTabContext | null): void {
		this.runtimeErrorOverlay = context ? context.runtimeErrorOverlay ?? null : null;
		this.executionStopRow = context ? context.executionStopRow ?? null : null;
	}

	private buildRuntimeErrorLines(message: string): string[] {
		const maxWidth = computeRuntimeErrorOverlayMaxWidth(this.viewportWidth, this.charAdvance, this.gutterWidth);
		return buildRuntimeErrorLinesUtil(message, maxWidth, (text) => this.measureText(text));
	}

	private getTabBarTotalHeight(): number {
		return this.tabBarHeight * Math.max(1, this.tabBarRowCount);
	}

	private get topMargin(): number {
		return this.headerHeight + this.getTabBarTotalHeight() + 2;
	}

	private statusAreaHeight(): number {
		if (!this.message.visible) {
			return this.baseBottomMargin;
		}
		const segments = this.getStatusMessageLines();
		const lineCount = Math.max(1, segments.length);
		return this.baseBottomMargin + lineCount * this.lineHeight + 4;
	}

	private get bottomMargin(): number {
		return this.statusAreaHeight() + this.getVisibleProblemsPanelHeight();
	}

	private getVisibleProblemsPanelHeight(): number {
		if (!this.problemsPanel.isVisible()) {
			return 0;
		}
		const planned = this.problemsPanel.getVisibleHeight();
		if (planned <= 0) {
			return 0;
		}
		const statusHeight = this.statusAreaHeight();
		const maxAvailable = Math.max(0, this.viewportHeight - statusHeight - (this.headerHeight + this.getTabBarTotalHeight()));
		if (maxAvailable <= 0) {
			return 0;
		}
		return Math.min(planned, maxAvailable);
	}

	private getStatusMessageLines(): string[] {
		if (!this.message.visible) {
			return [];
		}
		const sanitized = this.message.text.length > 0
			? this.message.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
			: '';
		const rawLines = sanitized.length > 0 ? sanitized.split('\n') : [''];
		const maxWidth = Math.max(this.viewportWidth - 8, this.charAdvance);
	const lines: string[] = [];
	for (let i = 0; i < rawLines.length; i += 1) {
		const wrapped = wrapRuntimeErrorLineUtil(rawLines[i], maxWidth, (text) => this.measureText(text));
			for (let j = 0; j < wrapped.length; j += 1) {
				lines.push(wrapped[j]);
			}
		}
		return lines.length > 0 ? lines : [''];
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
				this.showMessage(messageText, constants.COLOR_STATUS_ERROR, 4.0);
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

	private safeInspectLuaExpression(request: ConsoleLuaHoverRequest): ConsoleLuaHoverResult | null {
		this.inspectorRequestFailed = false;
		try {
			return this.inspectLuaExpressionFn(request);
		} catch (error) {
			this.inspectorRequestFailed = true;
			const handled = this.tryShowLuaErrorOverlay(error);
			if (!handled) {
				const message = error instanceof Error ? error.message : String(error);
				this.showMessage(message, constants.COLOR_STATUS_ERROR, 3.2);
			}
			return null;
		}
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
		this.completion.processPending(deltaSeconds);
		if (this.searchQuery.length === 0) {
			this.lastSearchVersion = this.textVersion;
		} else if (this.searchActive && this.textVersion !== this.lastSearchVersion) {
			this.updateSearchMatches();
			this.lastSearchVersion = this.textVersion;
		}
		if (this.diagnosticsDirty) {
			this.recomputeDiagnostics();
		}
		if (this.isCodeTabActive() && !this.cursorRevealSuspended) {
			this.ensureCursorVisible();
		}
	}

    private recomputeDiagnostics(): void {
        this.diagnosticsDirty = false;

        const activeId = this.activeCodeTabContextId ?? null;
        const inputs: DiagnosticContextInput[] = [];
        for (const context of this.codeTabContexts.values()) {
            const assetId = this.resolveHoverAssetId(context);
            const chunkName = this.resolveHoverChunkName(context);
            let source = '';
            if (activeId && context.id === activeId) source = this.lines.join('\n');
            else {
                try { source = this.getSourceForChunk(assetId, chunkName); } catch { source = ''; }
            }
            inputs.push({ id: context.id, title: context.title, descriptor: context.descriptor, assetId, chunkName, source });
        }
        const diagnostics = computeAggregatedEditorDiagnostics(inputs, {
            listLocalSymbols: (assetId, chunk) => { try { return this.listLuaSymbolsFn(assetId, chunk); } catch { return []; } },
            listGlobalSymbols: () => { try { return this.listGlobalLuaSymbolsFn(); } catch { return []; } },
            listBuiltins: () => { try { return this.listBuiltinLuaFunctionsFn(); } catch { return []; } },
        });

        this.diagnosticsByRow.clear();
        if (activeId) {
            for (let i = 0; i < diagnostics.length; i += 1) {
                const d = diagnostics[i];
                if (d.contextId !== activeId) continue;
                let bucket = this.diagnosticsByRow.get(d.row);
                if (!bucket) { bucket = []; this.diagnosticsByRow.set(d.row, bucket); }
                bucket.push(d);
            }
        }
        this.diagnostics = diagnostics;
        this.problemsPanel.setDiagnostics(this.diagnostics);
    }

	private getDiagnosticsForRow(row: number): readonly EditorDiagnostic[] {
		const bucket = this.diagnosticsByRow.get(row);
		return bucket ?? ConsoleCartEditor.EMPTY_DIAGNOSTICS;
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
		const frameColor = Msx1Colors[constants.COLOR_FRAME];
		api.rectfill_color(0, 0, this.viewportWidth, this.viewportHeight, { r: frameColor.r, g: frameColor.g, b: frameColor.b, a: frameColor.a });
		this.drawTopBar(api);
		this.tabBarRowCount = renderTabBar(api, {
			viewportWidth: this.viewportWidth,
			headerHeight: this.headerHeight,
			rowHeight: this.tabBarHeight,
			lineHeight: this.lineHeight,
			tabs: this.tabs,
			activeTabId: this.activeTabId,
			tabHoverId: this.tabHoverId,
			measureText: (text: string) => this.measureText(text),
			drawText: (api2, text, x, y, color) => drawEditorText(api2, this.font, text, x, y, color),
			getDirtyMarkerMetrics: () => this.getTabDirtyMarkerMetrics(),
			tabDirtyMarkerAssetId: this.tabDirtyMarkerAssetId,
			tabButtonBounds: this.tabButtonBounds,
			tabCloseButtonBounds: this.tabCloseButtonBounds,
		});
		this.drawResourcePanel(api);
		if (this.isResourceViewActive()) {
			this.drawResourceViewer(api);
		} else {
			this.drawCreateResourceBar(api);
			this.drawSearchBar(api);
			this.drawResourceSearchBar(api);
			this.drawSymbolSearchBar(api);
			this.drawRenameBar(api);
			this.drawLineJumpBar(api);
			this.drawCodeArea(api);
		}
		this.drawProblemsPanel(api);
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

	private refreshViewportDimensions(force = false): void {
		const view = $.view;
		if (!view) {
			throw new Error('[ConsoleCartEditor] Game view unavailable during editor frame.');
		}
		const renderSize = this.resolutionMode === 'offscreen' ? view.offscreenCanvasSize : view.viewportSize;
		if (!Number.isFinite(renderSize.x) || !Number.isFinite(renderSize.y) || renderSize.x <= 0 || renderSize.y <= 0) {
			throw new Error('[ConsoleCartEditor] Invalid render dimensions.');
		}
		const width = renderSize.x;
		const height = renderSize.y;
		if (!force && width === this.viewportWidth && height === this.viewportHeight) {
			return;
		}
		this.viewportWidth = width;
		this.viewportHeight = height;
		this.invalidateVisualLines();
		if (this.resourcePanelWidthRatio !== null) {
			this.resourcePanelWidthRatio = this.clampResourcePanelRatio(this.resourcePanelWidthRatio);
			if (this.resourcePanelVisible && this.computePanelPixelWidth(this.resourcePanelWidthRatio) <= 0) {
				this.hideResourcePanel();
			}
		}
		if (this.resourcePanelVisible) {
			this.resourceBrowserEnsureSelectionVisible();
		}
	}

	private initializeTabs(entryContext: CodeTabContext | null = null): void {
		this.tabs = [];
		this.tabHoverId = null;
		this.tabDragState = null;
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
		this.input.applyOverrides(false, this.captureKeys);
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
			this.input.applyOverrides(true, this.captureKeys);
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
		this.clearExecutionStopHighlights();
		this.storeActiveCodeTabContext();
		this.input.applyOverrides(false, this.captureKeys);
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
		const toggleKeyState = getKeyboardButtonState(this.playerIndex, EDITOR_TOGGLE_KEY);
		const selectButton = EDITOR_TOGGLE_GAMEPAD_BUTTONS[0];
		const startButton = EDITOR_TOGGLE_GAMEPAD_BUTTONS[1];
		const playerInput = $.input.getPlayerInput(this.playerIndex);
		const selectState = playerInput ? playerInput.getButtonState(selectButton, 'gamepad') : null;
		const startState = playerInput ? playerInput.getButtonState(startButton, 'gamepad') : null;
		const keyboardPressed = toggleKeyState ? toggleKeyState.pressed === true : false;
		const selectPressed = selectState ? selectState.pressed === true : false;
		const startPressed = startState ? startState.pressed === true : false;
		const gamepadPressed = selectPressed && startPressed;
		if (!keyboardPressed && !gamepadPressed) {
			this.toggleInputLatch = false;
			return false;
		}
		if (this.toggleInputLatch) {
			return false;
		}
		const keyboardAccepted = toggleKeyState ? shouldAcceptKeyPressGlobal(EDITOR_TOGGLE_KEY, toggleKeyState) : false;
		let gamepadAccepted = false;
		if (gamepadPressed) {
			const selectAccepted = selectState ? shouldAcceptKeyPressGlobal(selectButton, selectState) : false;
			const startAccepted = startState ? shouldAcceptKeyPressGlobal(startButton, startState) : false;
			gamepadAccepted = selectAccepted || startAccepted;
		}
		if (!keyboardAccepted && !gamepadAccepted) {
			return false;
		}
		this.toggleInputLatch = true;
		if (keyboardAccepted) {
			consumeKeyboardKey(keyboard, EDITOR_TOGGLE_KEY);
		}
		if (gamepadAccepted && playerInput && playerInput.inputHandlers['gamepad']) {
			const handler = playerInput.inputHandlers['gamepad'];
			handler.consumeButton(selectButton);
			handler.consumeButton(startButton);
		}
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
		if (this.symbolSearchActive || this.symbolSearchVisible) {
			this.closeSymbolSearch(false);
			return true;
		}
		if (this.resourceSearchActive || this.resourceSearchVisible) {
			this.closeResourceSearch(false);
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
		this.input.applyOverrides(true, this.captureKeys);
		this.applyResolutionModeToRuntime();
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
		if (this.dimCrtInEditor) {
			this.applyEditorCrtDimming();
		}
	}

	private applyEditorCrtDimming(): void {
		const view = $.view;
		const [bleedR, bleedG, bleedB] = view.colorBleed;
		const [glowR, glowG, glowB] = view.glowColor;
		this.crtOptionsSnapshot = {
			noiseIntensity: view.noiseIntensity,
			colorBleed: [bleedR, bleedG, bleedB] as [number, number, number],
			blurIntensity: view.blurIntensity,
			glowColor: [glowR, glowG, glowB] as [number, number, number],
		};
		let snapshot = this.crtOptionsSnapshot;
		view.noiseIntensity = snapshot.noiseIntensity * 0.5;
		view.colorBleed = [
			snapshot.colorBleed[0] * 0.5,
			snapshot.colorBleed[1] * 0.5,
			snapshot.colorBleed[2] * 0.5,
		] as [number, number, number];
		view.blurIntensity = snapshot.blurIntensity * 0.5;
		view.glowColor = [
			snapshot.glowColor[0] * 0.5,
			snapshot.glowColor[1] * 0.5,
			snapshot.glowColor[2] * 0.5,
		] as [number, number, number];
	}

	private restoreCrtOptions(): void {
		const snapshot = this.crtOptionsSnapshot;
		if (!snapshot) {
			throw new Error('[ConsoleCartEditor] CRT options snapshot unavailable during restore.');
		}
		this.crtOptionsSnapshot = null;
		const view = $.view;
		view.noiseIntensity = snapshot.noiseIntensity;
		view.colorBleed = [snapshot.colorBleed[0], snapshot.colorBleed[1], snapshot.colorBleed[2]] as [number, number, number];
		view.blurIntensity = snapshot.blurIntensity;
		view.glowColor = [snapshot.glowColor[0], snapshot.glowColor[1], snapshot.glowColor[2]] as [number, number, number];
	}

	private deactivate(): void {
	this.storeActiveCodeTabContext();
	this.active = false;
	if (this.dimCrtInEditor) {
		this.restoreCrtOptions();
	}
	this.completion.closeSession();
	this.repeatState.clear();
		this.resetKeyPressGuards();
		this.input.applyOverrides(false, this.captureKeys);
		this.selectionAnchor = null;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.pointerAuxWasPressed = false;
		this.tabDragState = null;
		this.clearGotoHoverHighlight();
		this.scrollbarController.cancel();
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
		if (this.blinkTimer >= constants.CURSOR_BLINK_INTERVAL) {
			this.blinkTimer -= constants.CURSOR_BLINK_INTERVAL;
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
		if (isKeyJustPressedGlobal(this.playerIndex, 'Escape')) {
			consumeKeyboardKey(keyboard, 'Escape');
			this.resetActionPromptState();
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			consumeKeyboardKey(keyboard, 'Enter');
			void this.handleActionPromptSelection('save-continue');
		}
	}

	private handleEditorInput(keyboard: KeyboardInput, deltaSeconds: number): void {
		if (this.resourcePanelVisible && this.resourcePanelFocused) {
			this.resourcePanel.handleKeyboard(keyboard, deltaSeconds);
			const st = this.resourcePanel.getStateForRender();
			this.resourcePanelFocused = st.focused;
			return;
		}
		if (this.isResourceViewActive()) {
			this.handleResourceViewerInput(keyboard, deltaSeconds);
			return;
		}
		const ctrlDown = isModifierPressedGlobal(this.playerIndex, 'ControlLeft') || isModifierPressedGlobal(this.playerIndex, 'ControlRight');
		const shiftDown = isModifierPressedGlobal(this.playerIndex, 'ShiftLeft') || isModifierPressedGlobal(this.playerIndex, 'ShiftRight');
		const metaDown = isModifierPressedGlobal(this.playerIndex, 'MetaLeft') || isModifierPressedGlobal(this.playerIndex, 'MetaRight');
		const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');

		if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyO')) {
			consumeKeyboardKey(keyboard, 'KeyO');
			this.openSymbolSearch();
			return;
		}
		if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyR')) {
			consumeKeyboardKey(keyboard, 'KeyR');
			this.toggleResolutionMode();
			return;
		}
		if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyL')) {
			consumeKeyboardKey(keyboard, 'KeyL');
			this.toggleResourcePanelFilterMode();
			return;
		}
		if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(this.playerIndex, 'Comma')) {
			consumeKeyboardKey(keyboard, 'Comma');
			this.openResourceSearch();
			return;
		}
		if ((ctrlDown || metaDown) && !altDown && !shiftDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyE')) {
			consumeKeyboardKey(keyboard, 'KeyE');
			this.openResourceSearch();
			return;
		}
		if ((ctrlDown && altDown) && isKeyJustPressedGlobal(this.playerIndex, 'Comma')) {
			consumeKeyboardKey(keyboard, 'Comma');
			this.openSymbolSearch();
			return;
		}
		if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(this.playerIndex, 'KeyB')) {
			consumeKeyboardKey(keyboard, 'KeyB');
			this.toggleResourcePanel();
			return;
		}
        if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyM')) {
            consumeKeyboardKey(keyboard, 'KeyM');
            this.toggleProblemsPanel();
            if (this.problemsPanel.isVisible()) {
                this.markDiagnosticsDirty();
            } else {
                this.focusEditorFromProblemsPanel();
            }
            return;
        }
		if (!ctrlDown && !metaDown && altDown && isKeyJustPressedGlobal(this.playerIndex, 'Comma')) {
			consumeKeyboardKey(keyboard, 'Comma');
			this.openGlobalSymbolSearch();
			return;
		}

		if (this.createResourceActive) {
			this.handleCreateResourceInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
			return;
		}

		if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(this.playerIndex, 'KeyN')) {
			consumeKeyboardKey(keyboard, 'KeyN');
			this.openCreateResourcePrompt();
			return;
		}

		if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(this.playerIndex, 'KeyF')) {
			consumeKeyboardKey(keyboard, 'KeyF');
			this.openSearch(true);
			return;
		}
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(this.playerIndex, 'Tab')) {
		consumeKeyboardKey(keyboard, 'Tab');
		this.cycleTab(shiftDown ? -1 : 1);
		return;
	}
	const inlineFieldFocused = this.searchActive
		|| this.symbolSearchActive
		|| this.resourceSearchActive
		|| this.lineJumpActive
		|| this.createResourceActive
		|| this.renameController.isActive();
	if (!inlineFieldFocused && isKeyJustPressedGlobal(this.playerIndex, 'F12')) {
		consumeKeyboardKey(keyboard, 'F12');
		if (shiftDown) {
			this.gotoReferencesAtCursor();
		} else {
			this.openReferenceSearchPopup();
		}
		return;
	}
	if (!inlineFieldFocused && this.isCodeTabActive() && isKeyJustPressedGlobal(this.playerIndex, 'F2')) {
		consumeKeyboardKey(keyboard, 'F2');
		this.openRenamePrompt();
		return;
	}
		if ((ctrlDown || metaDown)
			&& !inlineFieldFocused
			&& !this.resourcePanelFocused
			&& this.isCodeTabActive()
			&& isKeyJustPressedGlobal(this.playerIndex, 'KeyA')) {
			consumeKeyboardKey(keyboard, 'KeyA');
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
		if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(this.playerIndex, 'KeyL')) {
			consumeKeyboardKey(keyboard, 'KeyL');
			this.openLineJump();
			return;
		}
		if (this.renameController.isActive()) {
			this.renameController.handleInput(keyboard, deltaSeconds, { ctrlDown, metaDown, shiftDown, altDown });
			return;
		}
		if (this.resourceSearchActive) {
			this.handleResourceSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
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
        if (this.problemsPanel.isVisible() && this.problemsPanel.isFocused()) {
            let handled = false;
            if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
                consumeKeyboardKey(keyboard, 'ArrowUp');
                handled = this.problemsPanel.handleKeyboardCommand('up');
            } else if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
                consumeKeyboardKey(keyboard, 'ArrowDown');
                handled = this.problemsPanel.handleKeyboardCommand('down');
            } else if (this.shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
                consumeKeyboardKey(keyboard, 'PageUp');
                handled = this.problemsPanel.handleKeyboardCommand('page-up');
            } else if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
                consumeKeyboardKey(keyboard, 'PageDown');
                handled = this.problemsPanel.handleKeyboardCommand('page-down');
            } else if (this.shouldFireRepeat(keyboard, 'Home', deltaSeconds)) {
                consumeKeyboardKey(keyboard, 'Home');
                handled = this.problemsPanel.handleKeyboardCommand('home');
            } else if (this.shouldFireRepeat(keyboard, 'End', deltaSeconds)) {
                consumeKeyboardKey(keyboard, 'End');
                handled = this.problemsPanel.handleKeyboardCommand('end');
            } else if (isKeyJustPressedGlobal(this.playerIndex, 'Enter') || isKeyJustPressedGlobal(this.playerIndex, 'NumpadEnter')) {
                if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) consumeKeyboardKey(keyboard, 'Enter'); else consumeKeyboardKey(keyboard, 'NumpadEnter');
                handled = this.problemsPanel.handleKeyboardCommand('activate');
            } else if (isKeyJustPressedGlobal(this.playerIndex, 'Escape')) {
                consumeKeyboardKey(keyboard, 'Escape');
                this.hideProblemsPanel();
                this.focusEditorFromProblemsPanel();
                return;
            }
            // Always swallow caret movement while problems panel is focused
            if (this.shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) consumeKeyboardKey(keyboard, 'ArrowLeft');
            if (this.shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) consumeKeyboardKey(keyboard, 'ArrowRight');
            if (handled) return; else return;
        }
		if (this.searchQuery.length > 0 && isKeyJustPressedGlobal(this.playerIndex, 'F3')) {
			consumeKeyboardKey(keyboard, 'F3');
			if (shiftDown) {
				this.jumpToPreviousMatch();
			} else {
				this.jumpToNextMatch();
			}
			return;
		}
		if ((ctrlDown || metaDown) && this.shouldFireRepeat(keyboard, 'KeyZ', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'KeyZ');
			if (shiftDown) {
				this.redo();
			} else {
				this.undo();
			}
			return;
		}
		if ((ctrlDown || metaDown) && this.shouldFireRepeat(keyboard, 'KeyY', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'KeyY');
			this.redo();
			return;
		}
		if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(this.playerIndex, 'KeyW')) {
			consumeKeyboardKey(keyboard, 'KeyW');
			this.closeActiveTab();
			return;
		}
		if (ctrlDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyS')) {
			consumeKeyboardKey(keyboard, 'KeyS');
			void this.save();
			return;
		}
		if (ctrlDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyC')) {
			consumeKeyboardKey(keyboard, 'KeyC');
			void this.copySelectionToClipboard();
			return;
		}
		if (ctrlDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyX')) {
			consumeKeyboardKey(keyboard, 'KeyX');
			if (this.hasSelection()) {
				void this.cutSelectionToClipboard();
			} else {
				void this.cutLineToClipboard();
			}
			return;
		}
		if (ctrlDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyV')) {
			consumeKeyboardKey(keyboard, 'KeyV');
			this.pasteFromClipboard();
			return;
		}
		if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(this.playerIndex, 'Slash')) {
			consumeKeyboardKey(keyboard, 'Slash');
			this.toggleLineComments();
			return;
		}
		if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(this.playerIndex, 'NumpadDivide')) {
			consumeKeyboardKey(keyboard, 'NumpadDivide');
			this.toggleLineComments();
			return;
		}
		if (ctrlDown && isKeyJustPressedGlobal(this.playerIndex, 'BracketRight')) {
			consumeKeyboardKey(keyboard, 'BracketRight');
			this.indentSelectionOrLine();
			return;
		}
	if (ctrlDown && isKeyJustPressedGlobal(this.playerIndex, 'BracketLeft')) {
		consumeKeyboardKey(keyboard, 'BracketLeft');
		this.unindentSelectionOrLine();
		return;
	}
		// Manual completion open/close handled by CompletionController via handleCompletionKeybindings
	if (this.handleCompletionKeybindings(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown, metaDown)) {
		return;
	}
		this.input.handleEditorInput(keyboard, deltaSeconds);
	if (ctrlDown || metaDown || altDown) {
		return;
	}
		// Remaining character input after controller handled modifiers is no-op here
	}

	private handleCreateResourceInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');
		if (isKeyJustPressedGlobal(this.playerIndex, 'Escape')) {
			consumeKeyboardKey(keyboard, 'Escape');
			this.cancelCreateResourcePrompt();
			return;
		}
		if (!this.createResourceWorking && isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			consumeKeyboardKey(keyboard, 'Enter');
			void this.confirmCreateResourcePrompt();
			return;
		}
		if (this.createResourceWorking) {
			return;
		}
		const textChanged = this.processInlineFieldEditing(this.createResourceField, keyboard, {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			deltaSeconds,
			allowSpace: true,
			characterFilter: (value: string): boolean => this.isValidCreateResourceCharacter(value),
			maxLength: constants.CREATE_RESOURCE_MAX_PATH_LENGTH,
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
	this.renameController.cancel();
	let defaultPath = this.createResourcePath.length === 0
			? this.determineCreateResourceDefaultPath()
			: this.createResourcePath;
		if (defaultPath.length > constants.CREATE_RESOURCE_MAX_PATH_LENGTH) {
			defaultPath = defaultPath.slice(defaultPath.length - constants.CREATE_RESOURCE_MAX_PATH_LENGTH);
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
			this.showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
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
			this.showMessage(`Created ${descriptor.path} (asset ${descriptor.assetId})`, constants.COLOR_STATUS_SUCCESS, 2.5);
			this.closeCreateResourcePrompt(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const simplified = this.simplifyRuntimeErrorMessage(message);
			this.createResourceError = simplified;
			this.showMessage(`Failed to create resource: ${simplified}`, constants.COLOR_STATUS_WARNING, 4.0);
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
				return constants.DEFAULT_NEW_FSM_RESOURCE_CONTENT;
			}
			return constants.DEFAULT_NEW_FSM_RESOURCE_CONTENT.replace('new_fsm', blueprintId);
		}
		return constants.DEFAULT_NEW_LUA_RESOURCE_CONTENT;
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
		const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');
		if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(this.playerIndex, 'KeyF')) {
			consumeKeyboardKey(keyboard, 'KeyF');
			this.openSearch(false);
			return;
		}
		if ((ctrlDown || metaDown) && this.shouldFireRepeat(keyboard, 'KeyZ', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'KeyZ');
			if (shiftDown) {
				this.redo();
			} else {
				this.undo();
			}
			return;
		}
		if ((ctrlDown || metaDown) && this.shouldFireRepeat(keyboard, 'KeyY', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'KeyY');
			this.redo();
			return;
		}
		if (ctrlDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyS')) {
			consumeKeyboardKey(keyboard, 'KeyS');
			void this.save();
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			consumeKeyboardKey(keyboard, 'Enter');
			if (shiftDown) {
				this.jumpToPreviousMatch();
			} else {
				this.jumpToNextMatch();
			}
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'F3')) {
			consumeKeyboardKey(keyboard, 'F3');
			if (shiftDown) {
				this.jumpToPreviousMatch();
			} else {
				this.jumpToNextMatch();
			}
			return;
		}

		const textChanged = this.processInlineFieldEditing(this.searchField, keyboard, {
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
		if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(this.playerIndex, 'KeyL')) {
			consumeKeyboardKey(keyboard, 'KeyL');
			this.openLineJump();
			return;
		}
		const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');
		if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			consumeKeyboardKey(keyboard, 'Enter');
			this.applyLineJump();
			return;
		}
		if (!shiftDown && isKeyJustPressedGlobal(this.playerIndex, 'NumpadEnter')) {
			consumeKeyboardKey(keyboard, 'NumpadEnter');
			this.applyLineJump();
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Escape')) {
			consumeKeyboardKey(keyboard, 'Escape');
			this.closeLineJump(false);
			return;
		}

		const digitFilter = (value: string): boolean => value >= '0' && value <= '9';
		const textChanged = this.processInlineFieldEditing(this.lineJumpField, keyboard, {
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
		this.clearReferenceHighlights();
		this.closeSymbolSearch(false);
		this.closeResourceSearch(false);
		this.closeLineJump(false);
		this.renameController.cancel();
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

	private openResourceSearch(initialQuery: string = ''): void {
	this.clearReferenceHighlights();
	this.closeSearch(false);
	this.closeLineJump(false);
	this.closeSymbolSearch(false);
	this.renameController.cancel();
	this.resourceSearchVisible = true;
		this.resourceSearchActive = true;
		this.applyResourceSearchFieldText(initialQuery, true);
		this.refreshResourceCatalog();
		this.updateResourceSearchMatches();
		this.resourceSearchHoverIndex = -1;
		this.resetBlink();
	}

	private closeResourceSearch(clearQuery: boolean): void {
		if (clearQuery) {
			this.applyResourceSearchFieldText('', true);
		}
		this.resourceSearchActive = false;
		this.resourceSearchVisible = false;
		this.resourceSearchMatches = [];
		this.resourceSearchSelectionIndex = -1;
		this.resourceSearchDisplayOffset = 0;
		this.resourceSearchHoverIndex = -1;
		this.resourceSearchField.selectionAnchor = null;
		this.resourceSearchField.pointerSelecting = false;
		this.resetBlink();
	}

	private focusEditorFromResourceSearch(): void {
		if (!this.resourceSearchActive && !this.resourceSearchVisible) {
			return;
		}
		this.resourceSearchActive = false;
		if (this.resourceSearchQuery.length === 0) {
			this.resourceSearchVisible = false;
			this.resourceSearchMatches = [];
			this.resourceSearchSelectionIndex = -1;
			this.resourceSearchDisplayOffset = 0;
		}
		this.resourceSearchField.selectionAnchor = null;
		this.resourceSearchField.pointerSelecting = false;
		this.resetBlink();
	}

	private openSymbolSearch(initialQuery: string = ''): void {
		this.clearReferenceHighlights();
		this.closeSearch(false);
		this.closeLineJump(false);
		this.closeResourceSearch(false);
		this.renameController.cancel();
		this.symbolSearchMode = 'symbols';
		this.referenceCatalog = [];
		this.symbolSearchGlobal = false;
		this.symbolSearchVisible = true;
		this.symbolSearchActive = true;
		this.applySymbolSearchFieldText(initialQuery, true);
		this.refreshSymbolCatalog(true);
		this.updateSymbolSearchMatches();
		this.symbolSearchHoverIndex = -1;
		this.resetBlink();
	}

	private openGlobalSymbolSearch(initialQuery: string = ''): void {
		this.clearReferenceHighlights();
		this.closeSearch(false);
		this.closeLineJump(false);
		this.closeResourceSearch(false);
		this.renameController.cancel();
		this.symbolSearchMode = 'symbols';
		this.referenceCatalog = [];
		this.symbolSearchGlobal = true;
		this.symbolSearchVisible = true;
		this.symbolSearchActive = true;
		this.applySymbolSearchFieldText(initialQuery, true);
		this.refreshSymbolCatalog(true);
		this.updateSymbolSearchMatches();
		this.symbolSearchHoverIndex = -1;
		this.resetBlink();
	}

	private openReferenceSearchPopup(): void {
		const context = this.getActiveCodeTabContext();
		if (this.symbolSearchVisible || this.symbolSearchActive) {
			this.closeSymbolSearch(false);
		}
		this.renameController.cancel();
		const result = resolveReferenceLookup({
			layout: this.layout,
			lines: this.lines,
			textVersion: this.textVersion,
			cursorRow: this.cursorRow,
			cursorColumn: this.cursorColumn,
			extractExpression: (row, column) => this.extractHoverExpression(row, column),
		});
		if (result.kind === 'error') {
			this.showMessage(result.message, constants.COLOR_STATUS_WARNING, result.duration);
			return;
		}
		const { info, initialIndex } = result;
		this.referenceState.apply(info, initialIndex);
		this.referenceCatalog = this.buildReferenceCatalogForExpression(info, context);
		if (this.referenceCatalog.length === 0) {
			this.showMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
			return;
		}
		this.symbolSearchMode = 'references';
			this.symbolSearchGlobal = true;
			this.symbolSearchVisible = true;
			this.symbolSearchActive = true;
			this.applySymbolSearchFieldText('', true);
			this.symbolSearchQuery = '';
			this.updateReferenceSearchMatches();
			this.symbolSearchHoverIndex = -1;
			this.ensureSymbolSearchSelectionVisible();
			this.resetBlink();
		this.showReferenceStatusMessage();
	}

	private openRenamePrompt(): void {
		if (!this.isCodeTabActive()) {
			return;
		}
		this.closeSearch(false);
		this.closeLineJump(false);
		this.closeResourceSearch(false);
		this.closeSymbolSearch(false);
		this.createResourceActive = false;
		const started = this.renameController.begin({
			layout: this.layout,
			lines: this.lines,
			textVersion: this.textVersion,
			cursorRow: this.cursorRow,
			cursorColumn: this.cursorColumn,
			extractExpression: (row, column) => this.extractHoverExpression(row, column),
		});
		if (started) {
			this.cursorVisible = true;
			this.resetBlink();
		}
	}

	private commitRename(payload: RenameCommitPayload): RenameCommitResult {
		const edits = planRenameLineEdits(this.lines, payload.matches, payload.newName);
		if (edits.length === 0) {
			return { updatedMatches: 0 };
		}
		this.prepareUndo('rename', false);
		this.recordEditContext('replace', payload.newName);
		for (let index = 0; index < edits.length; index += 1) {
			const edit = edits[index];
			this.lines[edit.row] = edit.text;
			this.invalidateLine(edit.row);
		}
		this.markTextMutated();
		const activeIndex = clamp(payload.activeIndex, 0, payload.matches.length - 1);
		const match = payload.matches[activeIndex];
		const line = this.lines[match.row] ?? '';
		const startColumn = clamp(match.start, 0, line.length);
		const endColumn = clamp(startColumn + payload.newName.length, startColumn, line.length);
		this.cursorRow = match.row;
		this.cursorColumn = startColumn;
		this.selectionAnchor = { row: match.row, column: endColumn };
		this.updateDesiredColumn();
		this.resetBlink();
		this.cursorRevealSuspended = false;
		this.ensureCursorVisible();
		return { updatedMatches: payload.matches.length };
	}

	private closeSymbolSearch(clearQuery: boolean): void {
		if (clearQuery) {
			this.applySymbolSearchFieldText('', true);
		}
		this.symbolSearchActive = false;
		this.symbolSearchVisible = false;
		this.symbolSearchGlobal = false;
		this.symbolSearchMode = 'symbols';
		this.referenceCatalog = [];
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

	private focusEditorFromRename(): void {
		this.cursorRevealSuspended = false;
		this.resetBlink();
		this.revealCursor();
		this.cursorVisible = true;
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
			this.showMessage(`Failed to list symbols: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
			return;
		}
		this.symbolCatalogContext = { scope, assetId, chunkName };
		const catalogEntries = entries.map((entry) => {
			const display = entry.path && entry.path.length > 0 ? entry.path : entry.name;
			const sourceLabel = scope === 'global' ? this.symbolSourceLabel(entry) : null;
			const combinedKey = sourceLabel
				? `${display} ${sourceLabel}`.toLowerCase()
				: display.toLowerCase();
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
		this.symbolCatalog = catalogEntries;
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
		const path = entry.location.path ?? entry.location.assetId ?? null;
		if (!path) {
			return null;
		}
		return computeSourceLabel(path, entry.location.chunkName ?? '<console>');
	}

	private buildReferenceCatalogForExpression(info: ReferenceMatchInfo, context: CodeTabContext | null): ReferenceCatalogEntry[] {
		const descriptor = context?.descriptor ?? null;
		const normalizedPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
		const assetId = descriptor?.assetId ?? this.primaryAssetId ?? null;
		const chunkName = this.resolveHoverChunkName(context) ?? normalizedPath ?? assetId ?? '<console>';
		const environment: ProjectReferenceEnvironment = {
			activeContext: this.getActiveCodeTabContext(),
			activeLines: this.lines,
			codeTabContexts: Array.from(this.codeTabContexts.values()),
			listResources: () => this.listResourcesStrict(),
			loadLuaResource: (resourceId: string) => this.loadLuaResourceFn(resourceId),
		};
		const sourceLabelPath = descriptor?.path ?? descriptor?.assetId ?? null;
		return buildProjectReferenceCatalog({
			info,
			lines: this.lines,
			normalizedPath,
			chunkName,
			assetId,
			environment,
			sourceLabelPath,
		});
	}

	private updateSymbolSearchMatches(): void {
		if (this.symbolSearchMode === 'references') {
			this.updateReferenceSearchMatches();
			return;
		}
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

	private updateReferenceSearchMatches(): void {
		const { matches, selectionIndex, displayOffset } = filterReferenceCatalog({
			catalog: this.referenceCatalog,
			query: this.symbolSearchQuery,
			state: this.referenceState,
			pageSize: this.symbolSearchPageSize(),
		});
		this.symbolSearchMatches = matches;
		this.symbolSearchSelectionIndex = selectionIndex;
		this.symbolSearchDisplayOffset = displayOffset;
		this.symbolSearchHoverIndex = -1;
	}




	private isSymbolSearchCompactMode(): boolean {
		return this.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
	}

	private symbolSearchEntryHeight(): number {
		if (this.symbolSearchMode === 'references') {
			return this.lineHeight * 2;
		}
		return (this.symbolSearchGlobal && this.isSymbolSearchCompactMode()) ? this.lineHeight * 2 : this.lineHeight;
	}

	private symbolSearchVisibleResultCount(): number {
		if (!this.symbolSearchVisible) {
			return 0;
		}
		const remaining = Math.max(0, this.symbolSearchMatches.length - this.symbolSearchDisplayOffset);
		const maxResults = this.symbolSearchPageSize();
		return Math.min(remaining, maxResults);
	}

	private symbolSearchPageSize(): number {
		if (this.symbolSearchMode === 'references') {
			return constants.REFERENCE_SEARCH_MAX_RESULTS;
		}
		if (!this.symbolSearchGlobal) {
			return constants.SYMBOL_SEARCH_MAX_RESULTS;
		}
		return this.isSymbolSearchCompactMode() ? constants.SYMBOL_SEARCH_COMPACT_MAX_RESULTS : constants.SYMBOL_SEARCH_MAX_RESULTS;
	}

	private getActiveSymbolSearchMatch(): SymbolSearchResult | null {
		if (!this.symbolSearchVisible || this.symbolSearchMatches.length === 0) {
			return null;
		}
		let index = this.symbolSearchHoverIndex;
		if (index < 0 || index >= this.symbolSearchMatches.length) {
			index = this.symbolSearchSelectionIndex;
		}
		if (index < 0 || index >= this.symbolSearchMatches.length) {
			return null;
		}
		return this.symbolSearchMatches[index];
	}

	private ensureSymbolSearchSelectionVisible(): void {
		if (this.symbolSearchSelectionIndex < 0) {
			this.symbolSearchDisplayOffset = 0;
			return;
		}
		const maxVisible = this.symbolSearchPageSize();
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
			this.showMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		const match = this.symbolSearchMatches[index];
		if (this.symbolSearchMode === 'references') {
			const referenceEntry = match.entry as ReferenceCatalogEntry;
			const symbol = referenceEntry.symbol as ReferenceSymbolEntry;
			const entryIndex = this.referenceCatalog.indexOf(referenceEntry);
			const expressionLabel = this.referenceState.getExpression() ?? symbol.name;
			this.closeSymbolSearch(true);
			this.referenceState.clear();
			this.navigateToLuaDefinition(symbol.location);
			const total = this.referenceCatalog.length;
			if (entryIndex >= 0 && total > 0) {
				this.showMessage(`Reference ${entryIndex + 1}/${total} for ${expressionLabel}`, constants.COLOR_STATUS_SUCCESS, 1.6);
			} else {
				this.showMessage('Jumped to reference', constants.COLOR_STATUS_SUCCESS, 1.6);
			}
			return;
		}
		this.closeSymbolSearch(true);
		const location = match.entry.symbol.location;
		setTimeout(() => {
			this.navigateToLuaDefinition(location);
		}, 0);
	}

	private handleSymbolSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');
		if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			consumeKeyboardKey(keyboard, 'Enter');
			if (shiftDown) {
				this.moveSymbolSearchSelection(-1);
				return;
			}
			if (this.symbolSearchSelectionIndex >= 0) {
				this.applySymbolSearchSelection(this.symbolSearchSelectionIndex);
			} else {
				this.showMessage('No symbol selected', constants.COLOR_STATUS_WARNING, 1.5);
			}
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Escape')) {
			consumeKeyboardKey(keyboard, 'Escape');
			this.closeSymbolSearch(true);
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowUp');
			this.moveSymbolSearchSelection(-1);
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowDown');
			this.moveSymbolSearchSelection(1);
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageUp');
			this.moveSymbolSearchSelection(-this.symbolSearchPageSize());
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageDown');
			this.moveSymbolSearchSelection(this.symbolSearchPageSize());
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Home')) {
			consumeKeyboardKey(keyboard, 'Home');
			this.symbolSearchSelectionIndex = this.symbolSearchMatches.length > 0 ? 0 : -1;
			this.ensureSymbolSearchSelectionVisible();
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'End')) {
			consumeKeyboardKey(keyboard, 'End');
			this.symbolSearchSelectionIndex = this.symbolSearchMatches.length > 0 ? this.symbolSearchMatches.length - 1 : -1;
			this.ensureSymbolSearchSelectionVisible();
			return;
		}
		const textChanged = this.processInlineFieldEditing(this.symbolSearchField, keyboard, {
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

	private refreshResourceCatalog(): void {
		let descriptors: ConsoleResourceDescriptor[];
		try {
			descriptors = this.listResourcesStrict();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.resourceCatalog = [];
			this.resourceSearchMatches = [];
			this.resourceSearchSelectionIndex = -1;
			this.resourceSearchDisplayOffset = 0;
			this.resourceSearchHoverIndex = -1;
			this.showMessage(`Failed to list resources: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
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
		descriptors = augmented;
		const entries: ResourceCatalogEntry[] = descriptors.map((descriptor) => {
			const normalizedPath = descriptor.path.replace(/\\/g, '/');
			const displayPathSource = normalizedPath.length > 0 ? normalizedPath : (descriptor.assetId ?? '');
			const displayPath = displayPathSource.length > 0 ? displayPathSource : '<unnamed>';
			const typeLabel = descriptor.type ? descriptor.type.toUpperCase() : '';
			const assetLabel = descriptor.assetId && descriptor.assetId !== displayPath ? descriptor.assetId : null;
			const searchKeyParts = [displayPath, descriptor.assetId ?? '', descriptor.type ?? ''];
			const searchKey = searchKeyParts
				.filter(part => part.length > 0)
				.map(part => part.toLowerCase())
				.join(' ');
			return {
				descriptor,
				displayPath,
				searchKey,
				typeLabel,
				assetLabel,
			};
		});
		entries.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
		this.resourceCatalog = entries;
	}

	private updateResourceSearchMatches(): void {
		this.resourceSearchMatches = [];
		this.resourceSearchSelectionIndex = -1;
		this.resourceSearchDisplayOffset = 0;
		this.resourceSearchHoverIndex = -1;
		if (this.resourceCatalog.length === 0) {
			return;
		}
		const query = this.resourceSearchQuery.trim().toLowerCase();
		if (query.length === 0) {
			this.resourceSearchMatches = this.resourceCatalog.map(entry => ({ entry, matchIndex: 0 }));
			this.resourceSearchSelectionIndex = -1;
			return;
		}
		const tokens = query.split(/\s+/).filter(token => token.length > 0);
		const matches: ResourceSearchResult[] = [];
		for (const entry of this.resourceCatalog) {
			let bestIndex = Number.POSITIVE_INFINITY;
			let valid = true;
			for (const token of tokens) {
				const idx = entry.searchKey.indexOf(token);
				if (idx === -1) {
					valid = false;
					break;
				}
				if (idx < bestIndex) {
					bestIndex = idx;
				}
			}
			if (!valid) {
				continue;
			}
			if (!Number.isFinite(bestIndex)) {
				bestIndex = 0;
			}
			matches.push({ entry, matchIndex: bestIndex });
		}
		if (matches.length === 0) {
			this.resourceSearchMatches = [];
			return;
		}
		matches.sort((a, b) => {
			if (a.matchIndex !== b.matchIndex) {
				return a.matchIndex - b.matchIndex;
			}
			if (a.entry.displayPath.length !== b.entry.displayPath.length) {
				return a.entry.displayPath.length - b.entry.displayPath.length;
			}
			return a.entry.displayPath.localeCompare(b.entry.displayPath);
		});
		this.resourceSearchMatches = matches;
		this.resourceSearchSelectionIndex = matches.length > 0 ? 0 : -1;
	}

	private isResourceSearchCompactMode(): boolean {
		return this.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
	}

	private resourceSearchEntryHeight(): number {
		return this.isResourceSearchCompactMode() ? this.lineHeight * 2 : this.lineHeight;
	}

	private resourceSearchWindowCapacity(): number {
		return this.resourceSearchVisible ? this.resourceSearchPageSize() : 0;
	}

	private resourceSearchPageSize(): number {
		return this.isResourceSearchCompactMode() ? constants.QUICK_OPEN_COMPACT_MAX_RESULTS : constants.QUICK_OPEN_MAX_RESULTS;
	}

	private resourceSearchVisibleResultCount(): number {
		if (!this.resourceSearchVisible) {
			return 0;
		}
		const remaining = Math.max(0, this.resourceSearchMatches.length - this.resourceSearchDisplayOffset);
		const capacity = this.resourceSearchWindowCapacity();
		if (capacity <= 0) {
			return remaining;
		}
		return Math.min(remaining, capacity);
	}

	private ensureResourceSearchSelectionVisible(): void {
		if (this.resourceSearchSelectionIndex < 0) {
			this.resourceSearchDisplayOffset = 0;
			return;
		}
		const windowSize = Math.max(1, this.resourceSearchWindowCapacity());
		if (this.resourceSearchSelectionIndex < this.resourceSearchDisplayOffset) {
			this.resourceSearchDisplayOffset = this.resourceSearchSelectionIndex;
		}
		if (this.resourceSearchSelectionIndex >= this.resourceSearchDisplayOffset + windowSize) {
			this.resourceSearchDisplayOffset = this.resourceSearchSelectionIndex - windowSize + 1;
		}
		if (this.resourceSearchDisplayOffset < 0) {
			this.resourceSearchDisplayOffset = 0;
		}
		const maxOffset = Math.max(0, this.resourceSearchMatches.length - windowSize);
		if (this.resourceSearchDisplayOffset > maxOffset) {
			this.resourceSearchDisplayOffset = maxOffset;
		}
	}

	private moveResourceSearchSelection(delta: number): void {
		if (this.resourceSearchMatches.length === 0) {
			return;
		}
		let next = this.resourceSearchSelectionIndex;
		if (next === -1) {
			next = delta > 0 ? 0 : this.resourceSearchMatches.length - 1;
		} else {
			next = clamp(next + delta, 0, this.resourceSearchMatches.length - 1);
		}
		if (next === this.resourceSearchSelectionIndex) {
			return;
		}
		this.resourceSearchSelectionIndex = next;
		this.ensureResourceSearchSelectionVisible();
		this.resetBlink();
	}

	private applyResourceSearchSelection(index: number): void {
		if (index < 0 || index >= this.resourceSearchMatches.length) {
			this.showMessage('Resource not found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		const match = this.resourceSearchMatches[index];
		this.closeResourceSearch(true);
		setTimeout(() => {
			this.openResourceDescriptor(match.entry.descriptor);
		}, 0);
	}

	private handleResourceSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');
		if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			consumeKeyboardKey(keyboard, 'Enter');
			if (shiftDown) {
				this.moveResourceSearchSelection(-1);
				return;
			}
			if (this.resourceSearchSelectionIndex >= 0) {
				this.applyResourceSearchSelection(this.resourceSearchSelectionIndex);
				return;
			} else {
				const trimmed = this.resourceSearchQuery.trim();
				if (trimmed.length === 0) {
					this.closeResourceSearch(true);
					this.focusEditorFromResourceSearch();
				} else {
					this.showMessage('No resource selected', constants.COLOR_STATUS_WARNING, 1.5);
				}
			}
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Escape')) {
			consumeKeyboardKey(keyboard, 'Escape');
			this.closeResourceSearch(true);
			this.focusEditorFromResourceSearch();
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowUp');
			this.moveResourceSearchSelection(-1);
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowDown');
			this.moveResourceSearchSelection(1);
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageUp');
			this.moveResourceSearchSelection(-this.resourceSearchWindowCapacity());
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageDown');
			this.moveResourceSearchSelection(this.resourceSearchWindowCapacity());
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Home')) {
			consumeKeyboardKey(keyboard, 'Home');
			this.resourceSearchSelectionIndex = this.resourceSearchMatches.length > 0 ? 0 : -1;
			this.ensureResourceSearchSelectionVisible();
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'End')) {
			consumeKeyboardKey(keyboard, 'End');
			this.resourceSearchSelectionIndex = this.resourceSearchMatches.length > 0 ? this.resourceSearchMatches.length - 1 : -1;
			this.ensureResourceSearchSelectionVisible();
			return;
		}
		const textChanged = this.processInlineFieldEditing(this.resourceSearchField, keyboard, {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			deltaSeconds,
			allowSpace: true,
			characterFilter: undefined,
			maxLength: null,
		});
		this.resourceSearchQuery = this.resourceSearchField.text;
		if (textChanged) {
			if (this.resourceSearchQuery.startsWith('@')) {
				const query = this.resourceSearchQuery.slice(1).trimStart();
				this.closeResourceSearch(true);
				this.openSymbolSearch(query);
				return;
			}
			if (this.resourceSearchQuery.startsWith('#')) {
				const query = this.resourceSearchQuery.slice(1).trimStart();
				this.closeResourceSearch(true);
				this.openGlobalSymbolSearch(query);
				return;
			}
			if (this.resourceSearchQuery.startsWith(':')) {
				const query = this.resourceSearchQuery.slice(1).trimStart();
				this.closeResourceSearch(true);
				this.openLineJump();
				if (query.length > 0) {
					this.applyLineJumpFieldText(query, true);
					this.lineJumpValue = query;
				}
				return;
			}
			this.updateResourceSearchMatches();
		}
	}

	private openLineJump(): void {
	this.clearReferenceHighlights();
	this.closeSymbolSearch(false);
	this.closeResourceSearch(false);
	this.closeSearch(false);
	this.renameController.cancel();
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

	private focusEditorFromProblemsPanel(): void {
		this.problemsPanel.setFocused(false);
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
			this.showMessage('Enter a line number', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		const target = Number.parseInt(this.lineJumpValue, 10);
		if (!Number.isFinite(target) || target < 1 || target > this.lines.length) {
			const limit = this.lines.length <= 0 ? 1 : this.lines.length;
			this.showMessage(`Line must be between 1 and ${limit}`, constants.COLOR_STATUS_WARNING, 1.8);
			return;
		}
		this.setCursorPosition(target - 1, 0);
		this.clearSelection();
		this.breakUndoSequence();
		this.closeLineJump(true);
		this.showMessage(`Jumped to line ${target}`, constants.COLOR_STATUS_SUCCESS, 1.5);
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

	private gotoDiagnostic(diagnostic: EditorDiagnostic): void {
		// Switch to the originating tab if provided
		if (diagnostic.contextId && diagnostic.contextId.length > 0 && diagnostic.contextId !== this.activeCodeTabContextId) {
			this.setActiveTab(diagnostic.contextId);
		}
		if (!this.isCodeTabActive()) {
			this.activateCodeTab();
		}
		if (!this.isCodeTabActive()) {
			return;
		}
		const targetRow = clamp(diagnostic.row, 0, Math.max(0, this.lines.length - 1));
		const line = this.lines[targetRow] ?? '';
		const targetColumn = clamp(diagnostic.startColumn, 0, line.length);
		this.setCursorPosition(targetRow, targetColumn);
		this.clearSelection();
		this.cursorRevealSuspended = false;
		this.ensureCursorVisible();
	}

	private jumpToNextMatch(): void {
		if (this.searchMatches.length === 0) {
			this.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
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
			this.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
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

	private gotoReferencesAtCursor(): boolean {
		if (!this.isCodeTabActive()) {
			return false;
		}
		const context = this.getActiveCodeTabContext();
		const lookup = resolveReferenceLookup({
			layout: this.layout,
			lines: this.lines,
			textVersion: this.textVersion,
			cursorRow: this.cursorRow,
			cursorColumn: this.cursorColumn,
			extractExpression: (row: number, column: number) => this.extractHoverExpression(row, column),
		});
		let info: ReferenceMatchInfo | null = null;
		let initialIndex = 0;
		if (lookup.kind === 'error') {
			const fallback = this.tryResolveGlobalReferenceAtCursor(context);
			if (!fallback) {
				this.showMessage(lookup.message, constants.COLOR_STATUS_WARNING, lookup.duration);
				this.referenceState.clear();
				return false;
			}
			info = fallback.info;
			initialIndex = fallback.initialIndex;
		} else {
			info = lookup.info;
			initialIndex = lookup.initialIndex;
		}
		if (!info) {
			this.referenceState.clear();
			return false;
		}
		if (this.referenceState.hasSameQuery(info)) {
			const nextIndex = this.referenceState.advance(1);
			if (nextIndex === -1) {
				return false;
			}
			const match = this.referenceState.getCurrentMatch();
			if (!match) {
				return false;
			}
			if (this.symbolSearchMode === 'references' && this.symbolSearchVisible) {
				this.symbolSearchSelectionIndex = nextIndex;
				this.ensureSymbolSearchSelectionVisible();
			}
			this.applyReferenceSelection(match);
			this.showReferenceStatusMessage();
			return true;
		}
	this.referenceState.apply(info, initialIndex);
	this.referenceCatalog = this.buildReferenceCatalogForExpression(info, context);
	if (this.referenceCatalog.length === 0) {
		this.showMessage('No references found in this document', constants.COLOR_STATUS_WARNING, 1.6);
		this.referenceState.clear();
		return false;
	}
	if (this.symbolSearchMode === 'references' && this.symbolSearchVisible) {
		this.updateReferenceSearchMatches();
		this.ensureSymbolSearchSelectionVisible();
	}
	const currentMatch = this.referenceState.getCurrentMatch();
	if (!currentMatch) {
		this.showMessage('No references found in this document', constants.COLOR_STATUS_WARNING, 1.6);
		this.referenceState.clear();
		return false;
	}
		this.applyReferenceSelection(currentMatch);
		this.showReferenceStatusMessage();
		return true;
	}

	private tryResolveGlobalReferenceAtCursor(context: CodeTabContext | null): { info: ReferenceMatchInfo; initialIndex: number } | null {
		const identifier = this.extractHoverExpression(this.cursorRow, this.cursorColumn);
		if (!identifier) {
			return null;
		}
		const matches = findExpressionMatches(identifier.expression, this.lines);
		if (matches.length === 0) {
			return null;
		}
		const namePath = identifier.expression.split('.').filter(part => part.length > 0);
		if (namePath.length === 0) {
			return null;
		}
		matches.sort((a, b) => {
			if (a.row !== b.row) {
				return a.row - b.row;
			}
			return a.start - b.start;
		});
		let initialIndex = -1;
		for (let index = 0; index < matches.length; index += 1) {
			const match = matches[index];
			if (match.row === this.cursorRow && this.cursorColumn >= match.start && this.cursorColumn < match.end) {
				initialIndex = index;
				break;
			}
		}
		if (initialIndex === -1) {
			initialIndex = 0;
		}
		const descriptor = context?.descriptor ?? null;
		const normalizedPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
		const assetId = descriptor?.assetId ?? this.primaryAssetId ?? null;
		const chunkName = this.resolveHoverChunkName(context) ?? normalizedPath ?? assetId ?? '<console>';
		const environment: ProjectReferenceEnvironment = {
			activeContext: context,
			activeLines: this.lines,
			codeTabContexts: Array.from(this.codeTabContexts.values()),
			listResources: () => this.listResourcesStrict(),
			loadLuaResource: (resourceId: string) => this.loadLuaResourceFn(resourceId),
		};
		const definitionKey = resolveDefinitionKeyForExpression({
			expression: identifier.expression,
			environment,
			currentChunkName: chunkName,
			currentPath: normalizedPath,
		});
		if (!definitionKey) {
			return null;
		}
		const model = this.layout.getSemanticModel(this.lines, this.textVersion);
		const filteredMatches: typeof matches = [];
		for (let index = 0; index < matches.length; index += 1) {
			const match = matches[index];
			let keep = true;
			if (model) {
				const row = match.row + 1;
				const column = match.start + 1;
				const definition = model.lookupIdentifier(row, column, namePath);
				if (definition && definitionKeyFromDefinition(definition) !== definitionKey) {
					keep = false;
				}
			}
			if (keep) {
				filteredMatches.push(match);
			}
		}
		if (filteredMatches.length === 0) {
			return null;
		}
		const initialMatch = filteredMatches[Math.min(initialIndex, filteredMatches.length - 1)];
		initialIndex = filteredMatches.indexOf(initialMatch);
		if (initialIndex < 0) {
			initialIndex = 0;
		}
		const info: ReferenceMatchInfo = {
			matches: filteredMatches,
			expression: identifier.expression,
			definitionKey,
			documentVersion: this.textVersion,
		};
		return { info, initialIndex };
	}

	private applyReferenceSelection(match: SearchMatch): void {
		const line = this.lines[match.row] ?? '';
		const startColumn = clamp(match.start, 0, line.length);
		const endColumn = clamp(match.end, startColumn, line.length);
		this.cursorRow = match.row;
		this.cursorColumn = startColumn;
		this.selectionAnchor = { row: match.row, column: endColumn };
		this.updateDesiredColumn();
		this.resetBlink();
		this.cursorRevealSuspended = false;
		this.ensureCursorVisible();
	}

	private showReferenceStatusMessage(): void {
		const matches = this.referenceState.getMatches();
		const activeIndex = this.referenceState.getActiveIndex();
		if (matches.length === 0 || activeIndex < 0) {
			return;
		}
		const label = this.referenceState.getExpression() ?? '';
		this.showMessage(`Reference ${activeIndex + 1}/${matches.length} for ${label}`, constants.COLOR_STATUS_SUCCESS, 1.6);
	}

	private handlePointerInput(_deltaSeconds: number): void {
		const ctrlDown = isModifierPressedGlobal(this.playerIndex, 'ControlLeft') || isModifierPressedGlobal(this.playerIndex, 'ControlRight');
		const metaDown = isModifierPressedGlobal(this.playerIndex, 'MetaLeft') || isModifierPressedGlobal(this.playerIndex, 'MetaRight');
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
		this.scrollbarController.cancel();
		this.lastPointerRowResolution = null;
		this.clearHoverTooltip();
		this.clearGotoHoverHighlight();
		return;
	}
	if (!snapshot.valid) {
		this.scrollbarController.cancel();
		this.clearGotoHoverHighlight();
		this.lastPointerRowResolution = null;
	} else if (this.scrollbarController.hasActiveDrag() && !snapshot.primaryPressed) {
			this.scrollbarController.cancel();
		} else if (this.scrollbarController.hasActiveDrag() && snapshot.primaryPressed) {
			if (this.scrollbarController.update(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, (k, s) => this.applyScrollbarScroll(k, s))) {
				this.pointerSelecting = false;
				this.clearHoverTooltip();
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				return;
			}
		}
		if (!snapshot.primaryPressed) {
			this.searchField.pointerSelecting = false;
			this.symbolSearchField.pointerSelecting = false;
			this.resourceSearchField.pointerSelecting = false;
			this.lineJumpField.pointerSelecting = false;
			this.createResourceField.pointerSelecting = false;
			this.symbolSearchHoverIndex = -1;
			this.resourceSearchHoverIndex = -1;
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
		if (this.tabDragState) {
			if (!snapshot.primaryPressed) {
				this.endTabDrag();
				this.pointerSelecting = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearGotoHoverHighlight();
				this.clearHoverTooltip();
				return;
			}
			if (snapshot.valid) {
				this.updateTabDrag(snapshot.viewportX, snapshot.viewportY);
			}
			this.pointerSelecting = false;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearGotoHoverHighlight();
			this.clearHoverTooltip();
			return;
		}
		if (justPressed && this.scrollbarController.begin(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, this.bottomMargin, (k, s) => this.applyScrollbarScroll(k, s))) {
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
				const ok = this.resourcePanel.setRatioFromViewportX(snapshot.viewportX, this.viewportWidth);
				if (!ok) {
					this.hideResourcePanel();
				} else {
					this.invalidateVisualLines();
					/* hscroll handled inside controller */
				}
				this.resourcePanelFocused = true;
				this.pointerSelecting = false;
				this.resetPointerClickTracking();
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			}
			this.clearGotoHoverHighlight();
			return;
		}
		if (this.problemsPanelResizing) {
			if (!snapshot.primaryPressed) {
				this.problemsPanelResizing = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			} else {
				this.setProblemsPanelHeightFromViewportY(snapshot.viewportY);
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
				this.resetPointerClickTracking();
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			}
			this.clearGotoHoverHighlight();
			return;
		}
		if (justPressed && this.problemsPanel.isVisible() && this.isPointerOverProblemsPanelDivider(snapshot.viewportX, snapshot.viewportY)) {
			this.problemsPanelResizing = true;
			this.pointerSelecting = false;
			this.resetPointerClickTracking();
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearGotoHoverHighlight();
			return;
		}
		const tabTop = this.headerHeight;
		const tabBottom = tabTop + this.getTabBarTotalHeight();
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
		const panelBounds = this.resourcePanel.getBounds();
		const pointerInPanel = this.resourcePanelVisible
			&& panelBounds !== null
			&& this.pointInRect(snapshot.viewportX, snapshot.viewportY, panelBounds);
		if (pointerInPanel) {
			this.resourcePanel.setFocused(true);
			this.resetPointerClickTracking();
			this.clearHoverTooltip();
			const margin = Math.max(4, this.lineHeight);
			if (snapshot.viewportY < panelBounds.top + margin) {
				this.resourcePanel.scrollBy(-1);
			} else if (snapshot.viewportY >= panelBounds.bottom - margin) {
				this.resourcePanel.scrollBy(1);
			}
			const hoverIndex = this.resourcePanel.indexAtPosition(snapshot.viewportX, snapshot.viewportY);
			this.resourcePanel.setHoverIndex(hoverIndex);
			if (hoverIndex >= 0) {
				if (hoverIndex !== this.resourceBrowserSelectionIndex) {
					this.resourcePanel.setSelectionIndex(hoverIndex);
				}
				if (justPressed) {
					this.resourcePanel.openSelected();
					this.resourcePanel.setFocused(false);
				}
			}
			if (!snapshot.primaryPressed && hoverIndex === -1) {
				this.resourcePanel.setHoverIndex(-1);
			}
			this.pointerSelecting = false;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearGotoHoverHighlight();
			const s = this.resourcePanel.getStateForRender();
			this.resourcePanelFocused = s.focused;
			this.resourceBrowserSelectionIndex = s.selectionIndex;
			return;
		}
		if (justPressed && !pointerInPanel) {
			this.resourcePanel.setFocused(false);
		}
		if (this.resourcePanelVisible && !snapshot.primaryPressed) {
			this.resourcePanel.setHoverIndex(-1);
		}
		const problemsBounds = this.getProblemsPanelBounds();
		if (this.problemsPanel.isVisible() && problemsBounds) {
			const insideProblems = this.pointInRect(snapshot.viewportX, snapshot.viewportY, problemsBounds);
			if (insideProblems) {
				if (this.problemsPanel.handlePointer(snapshot, justPressed, justReleased, problemsBounds)) {
					this.pointerSelecting = false;
					this.pointerPrimaryWasPressed = snapshot.primaryPressed;
					this.resetPointerClickTracking();
					this.clearHoverTooltip();
					this.clearGotoHoverHighlight();
					return;
				}
			} else if (justPressed) {
				this.problemsPanel.setFocused(false);
			}
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
				this.processInlineFieldPointer(this.createResourceField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
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
		const resourceSearchBounds = this.getResourceSearchBarBounds();
		if (this.resourceSearchVisible && resourceSearchBounds) {
			const insideResourceSearch = this.pointInRect(snapshot.viewportX, snapshot.viewportY, resourceSearchBounds);
			if (insideResourceSearch) {
				const baseHeight = this.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
				const fieldBottom = resourceSearchBounds.top + baseHeight;
				const resultsStart = fieldBottom + constants.QUICK_OPEN_RESULT_SPACING;
				if (snapshot.viewportY < fieldBottom) {
					if (justPressed) {
						this.closeLineJump(false);
						this.closeSearch(false);
						this.closeSymbolSearch(false);
						this.resourceSearchVisible = true;
						this.resourceSearchActive = true;
						this.resourcePanelFocused = false;
						this.cursorVisible = true;
						this.resetBlink();
					}
					const label = 'FILE :';
					const labelX = 4;
					const textLeft = labelX + this.measureText(label + ' ');
					this.processInlineFieldPointer(this.resourceSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
					this.pointerSelecting = false;
					this.pointerPrimaryWasPressed = snapshot.primaryPressed;
					this.clearHoverTooltip();
					this.clearGotoHoverHighlight();
					return;
				}
				const rowHeight = this.resourceSearchEntryHeight();
				const visibleCount = this.resourceSearchVisibleResultCount();
				let hoverIndex = -1;
				if (snapshot.viewportY >= resultsStart) {
					const relative = snapshot.viewportY - resultsStart;
					const indexWithin = Math.floor(relative / rowHeight);
					if (indexWithin >= 0 && indexWithin < visibleCount) {
						hoverIndex = this.resourceSearchDisplayOffset + indexWithin;
					}
				}
				this.resourceSearchHoverIndex = hoverIndex;
				if (hoverIndex >= 0 && justPressed) {
					if (hoverIndex !== this.resourceSearchSelectionIndex) {
						this.resourceSearchSelectionIndex = hoverIndex;
						this.ensureResourceSearchSelectionVisible();
					}
					this.applyResourceSearchSelection(hoverIndex);
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
				this.resourceSearchActive = false;
			}
			this.resourceSearchHoverIndex = -1;
		}
		const symbolBounds = this.getSymbolSearchBarBounds();
		if (this.symbolSearchVisible && symbolBounds) {
			const insideSymbol = this.pointInRect(snapshot.viewportX, snapshot.viewportY, symbolBounds);
			if (insideSymbol) {
				const baseHeight = this.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
				const fieldBottom = symbolBounds.top + baseHeight;
				const resultsStart = fieldBottom + constants.SYMBOL_SEARCH_RESULT_SPACING;
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
					const label = this.symbolSearchGlobal ? 'SYMBOL #:' : 'SYMBOL @:';
					const labelX = 4;
					const textLeft = labelX + this.measureText(label + ' ');
					this.processInlineFieldPointer(this.symbolSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
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
					const entryHeight = this.symbolSearchEntryHeight();
					const indexWithin = entryHeight > 0 ? Math.floor(relative / entryHeight) : -1;
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

		const renameBounds = this.getRenameBarBounds();
		if (this.isRenameVisible() && renameBounds) {
			const insideRename = this.pointInRect(snapshot.viewportX, snapshot.viewportY, renameBounds);
			if (insideRename) {
				if (justPressed) {
					this.resourcePanelFocused = false;
					this.cursorVisible = true;
					this.resetBlink();
				}
				const label = 'RENAME:';
				const labelX = 4;
				const textLeft = labelX + this.measureText(label + ' ');
				this.processInlineFieldPointer(this.renameController.getField(), textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				this.pointerSelecting = false;
				this.pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearHoverTooltip();
				this.clearGotoHoverHighlight();
				return;
			}
			if (justPressed) {
				this.renameController.cancel();
			}
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
				this.processInlineFieldPointer(this.lineJumpField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
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
				this.processInlineFieldPointer(this.searchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
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
			this.clearReferenceHighlights();
			this.resourcePanelFocused = false;
			this.focusEditorFromLineJump();
			this.focusEditorFromSearch();
			this.focusEditorFromResourceSearch();
			this.focusEditorFromSymbolSearch();
			this.completion.closeSession();
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
			const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');
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
		const tabBottom = tabTop + this.getTabBarTotalHeight();
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
		const inspection = this.safeInspectLuaExpression(request);
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
		return buildHoverContentLinesExternal(result);
	}

	private clearHoverTooltip(): void {
		this.hoverTooltip = null;
		this.lastInspectorResult = null;
	}

	// Scrollbar drag is handled via this.scrollbarController

	private applyScrollbarScroll(kind: ScrollbarKind, scroll: number): void {
		if (Number.isNaN(scroll)) {
			return;
		}
		switch (kind) {
			case 'codeVertical': {
				this.ensureVisualLines();
				const rowCount = Math.max(1, this.cachedVisibleRowCount);
				const maxScroll = Math.max(0, this.getVisualLineCount() - rowCount);
				this.scrollRow = clamp(Math.round(scroll), 0, maxScroll);
				this.cursorRevealSuspended = true;
				break;
			}
			case 'codeHorizontal': {
				if (this.wordWrapEnabled) {
					this.scrollColumn = 0;
					break;
				}
				const maxScroll = this.computeMaximumScrollColumn();
				this.scrollColumn = clamp(Math.round(scroll), 0, maxScroll);
				this.cursorRevealSuspended = true;
				break;
			}
			case 'resourceVertical': {
				this.resourcePanel.setScroll(scroll);
				this.resourcePanel.setFocused(true);
				const s = this.resourcePanel.getStateForRender();
				this.resourcePanelFocused = s.focused;
				break;
			}
			case 'resourceHorizontal': {
				this.resourcePanel.setHScroll(scroll);
				this.resourcePanel.setFocused(true);
				const s = this.resourcePanel.getStateForRender();
				this.resourcePanelFocused = s.focused;
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
			const maxVisible = Math.max(1, Math.min(constants.HOVER_TOOLTIP_MAX_VISIBLE_LINES, totalLines));
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

	private resolveSemanticDefinitionLocation(
		context: CodeTabContext | null,
		expression: string,
		usageRow: number,
		usageColumn: number,
		assetId: string | null,
		chunkName: string | null,
	): ConsoleLuaDefinitionLocation | null {
		if (!expression) {
			return null;
		}
		const namePath = expression.split('.');
		if (namePath.length === 0) {
			return null;
		}
		const model = this.layout.getSemanticModel(this.lines, this.textVersion);
		if (!model) {
			return null;
		}
		const definition = model.lookupIdentifier(usageRow, usageColumn, namePath);
		if (!definition) {
			return null;
		}
		const descriptor = context?.descriptor ?? null;
		const descriptorPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
		const descriptorAssetId = descriptor?.assetId ?? null;
		const resolvedAssetId = descriptorAssetId ?? assetId ?? this.primaryAssetId ?? null;
		const resolvedChunk = chunkName
			?? descriptorPath
			?? descriptorAssetId
			?? assetId
			?? this.primaryAssetId
			?? '<console>';
		const location: ConsoleLuaDefinitionLocation = {
			chunkName: resolvedChunk,
			assetId: resolvedAssetId,
			range: {
				startLine: definition.definition.start.line,
				startColumn: definition.definition.start.column,
				endLine: definition.definition.end.line,
				endColumn: definition.definition.end.column,
			},
		};
		if (descriptorPath) {
			location.path = descriptorPath;
		} else if (resolvedChunk && resolvedChunk !== '<console>') {
			location.path = resolvedChunk;
		}
		return location;
	}

	private extractHoverExpression(row: number, column: number): { expression: string; startColumn: number; endColumn: number } | null {
		if (row < 0 || row >= this.lines.length) {
			return null;
		}
		const line = this.lines[row] ?? '';
		const safeColumn = Math.min(Math.max(column, 0), Math.max(0, line.length));
		if (isLuaCommentContext(this.lines, row, safeColumn)) {
			return null;
		}
		if (line.length === 0) {
			return null;
		}
		const clampedColumn = Math.min(Math.max(column, 0), Math.max(0, line.length - 1));
		let probe = clampedColumn;
		if (!isIdentifierChar(line.charCodeAt(probe))) {
			if (line.charCodeAt(probe) === 46 && probe > 0) {
				probe -= 1;
			}
			else if (probe > 0 && isIdentifierChar(line.charCodeAt(probe - 1))) {
				probe -= 1;
			}
			else {
				return null;
			}
		}
		let expressionStart = probe;
		while (expressionStart > 0 && isIdentifierChar(line.charCodeAt(expressionStart - 1))) {
			expressionStart -= 1;
		}
		if (!isIdentifierStartChar(line.charCodeAt(expressionStart))) {
			return null;
		}
		let expressionEnd = probe + 1;
		while (expressionEnd < line.length && isIdentifierChar(line.charCodeAt(expressionEnd))) {
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
			while (segmentStart >= 0 && isIdentifierChar(line.charCodeAt(segmentStart))) {
				segmentStart -= 1;
			}
			segmentStart += 1;
			if (segmentStart >= dotIndex) {
				break;
			}
			if (!isIdentifierStartChar(line.charCodeAt(segmentStart))) {
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
			if (!isIdentifierStartChar(line.charCodeAt(identifierStart))) {
				break;
			}
			let identifierEnd = identifierStart + 1;
			while (identifierEnd < line.length && isIdentifierChar(line.charCodeAt(identifierEnd))) {
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
		const inspection = this.safeInspectLuaExpression({
			assetId,
			expression: token.expression,
			chunkName,
			row: row + 1,
			column: token.startColumn + 1,
		});
		let definition = inspection?.definition ?? null;
		if (!definition) {
			definition = this.resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, assetId, chunkName);
		}
		if (!definition) {
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

	private clearReferenceHighlights(): void {
		this.referenceState.clear();
	}

	private tryGotoDefinitionAt(row: number, column: number): boolean {
		const context = this.getActiveCodeTabContext();
		const assetId = this.resolveHoverAssetId(context);
		const token = this.extractHoverExpression(row, column);
		if (!token) {
			this.showMessage('Definition not found', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		const chunkName = this.resolveHoverChunkName(context);
		const inspection = this.safeInspectLuaExpression({
			assetId,
			expression: token.expression,
			chunkName,
			row: row + 1,
			column: token.startColumn + 1,
		});
		let definition = inspection?.definition ?? null;
		if (!definition) {
			definition = this.resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, assetId, chunkName);
		}
		if (!definition) {
			if (!this.inspectorRequestFailed) {
				this.showMessage(`Definition not found for ${token.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
			}
			return false;
		}
		this.navigateToLuaDefinition(definition);
		return true;
	}

	private navigateToLuaDefinition(definition: ConsoleLuaDefinitionLocation): void {
		this.clearReferenceHighlights();
		const hint: { assetId: string | null; path?: string | null } = { assetId: definition.assetId };
		if (definition.path !== undefined) {
			hint.path = definition.path;
		}
		let targetContextId: string | null = null;
		try {
			this.focusChunkSource(definition.chunkName, hint);
			const context = this.findCodeTabContext(definition.assetId ?? null, definition.chunkName ?? null);
			if (context) {
				targetContextId = context.id;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(`Failed to open definition: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
			return;
		}
		if (targetContextId) {
			this.setActiveTab(targetContextId);
		} else {
			this.activateCodeTab();
		}
		this.applyDefinitionSelection(definition.range);
		this.cursorRevealSuspended = false;
		this.clearHoverTooltip();
		this.clearGotoHoverHighlight();
		this.showMessage('Jumped to definition', constants.COLOR_STATUS_SUCCESS, 1.6);
	}

	private applyDefinitionSelection(range: ConsoleLuaDefinitionLocation['range']): void {
		const lastRowIndex = Math.max(0, this.lines.length - 1);
		const startRow = clamp(range.startLine - 1, 0, lastRowIndex);
		const startLine = this.lines[startRow] ?? '';
		const startColumn = clamp(range.startColumn - 1, 0, startLine.length);
		this.cursorRow = startRow;
		this.cursorColumn = startColumn;
		this.selectionAnchor = null;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.pointerAuxWasPressed = false;
		this.updateDesiredColumn();
		this.resetBlink();
		this.cursorRevealSuspended = false;
		this.ensureCursorVisible();
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
		if (this.pointInRect(x, y, this.topBarButtonBounds.problems)) {
			this.handleTopBarButtonPress('problems');
			return true;
		}
		if (this.resourcePanelVisible && this.pointInRect(x, y, this.topBarButtonBounds.filter)) {
			this.handleTopBarButtonPress('filter');
			return true;
		}
		if (this.pointInRect(x, y, this.topBarButtonBounds.wrap)) {
			this.handleTopBarButtonPress('wrap');
			return true;
		}
		if (this.pointInRect(x, y, this.topBarButtonBounds.resolution)) {
			this.handleTopBarButtonPress('resolution');
			return true;
		}
		return false;
	}

	private handleTabBarPointer(snapshot: PointerSnapshot): boolean {
		const tabTop = this.headerHeight;
		const tabBottom = tabTop + this.getTabBarTotalHeight();
		const y = snapshot.viewportY;
		if (y < tabTop || y >= tabBottom) {
			return false;
		}
		const x = snapshot.viewportX;
		for (let index = 0; index < this.tabs.length; index += 1) {
			const tab = this.tabs[index];
			const closeBounds = this.tabCloseButtonBounds.get(tab.id);
			if (closeBounds && this.pointInRect(x, y, closeBounds)) {
				this.endTabDrag();
				this.closeTab(tab.id);
				this.tabHoverId = null;
				return true;
			}
			const tabBounds = this.tabButtonBounds.get(tab.id);
			if (tabBounds && this.pointInRect(x, y, tabBounds)) {
				this.beginTabDrag(tab.id, x);
				this.setActiveTab(tab.id);
				return true;
			}
		}
		return false;
	}

	private handleTabBarMiddleClick(snapshot: PointerSnapshot): boolean {
		const tabTop = this.headerHeight;
		const tabBottom = tabTop + this.getTabBarTotalHeight();
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
		const steps = Math.max(1, Math.round(magnitude / constants.WHEEL_SCROLL_STEP));
		const direction = delta > 0 ? 1 : -1;
		const pointer = this.lastPointerSnapshot;
		const shiftDown = isModifierPressedGlobal(this.playerIndex, 'ShiftLeft') || isModifierPressedGlobal(this.playerIndex, 'ShiftRight');
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
		if (this.resourceSearchVisible) {
			const bounds = this.getResourceSearchBarBounds();
			const pointerInQuickOpen = bounds !== null
				&& pointer
				&& pointer.valid
				&& pointer.insideViewport
				&& this.pointInRect(pointer.viewportX, pointer.viewportY, bounds);
			if (pointerInQuickOpen || this.resourceSearchActive) {
				this.moveResourceSearchSelection(direction * steps);
				playerInput.consumeAction('pointer_wheel');
				return;
			}
		}
		const panelBounds = this.resourcePanel.getBounds();
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
		if (this.problemsPanel.isVisible()) {
			const bounds = this.getProblemsPanelBounds();
			if (bounds) {
				let allowScroll = false;
				if (!pointer) {
					allowScroll = this.problemsPanel.isFocused();
				} else if (pointer.valid && pointer.insideViewport && this.pointInRect(pointer.viewportX, pointer.viewportY, bounds)) {
					allowScroll = true;
				}
				const stepsAbs = Math.max(1, Math.round(Math.abs(steps)));
				if (this.problemsPanel.isFocused()) {
					// Match quick-open/symbol behavior: focused wheel moves selection
					for (let i = 0; i < stepsAbs; i += 1) {
						void this.problemsPanel.handleKeyboardCommand(direction > 0 ? 'down' : 'up');
					}
					playerInput.consumeAction('pointer_wheel');
					return;
				}
				if (allowScroll && this.problemsPanel.handlePointerWheel(direction, stepsAbs)) {
					playerInput.consumeAction('pointer_wheel');
					return;
				}
			}
		}
		if (this.completion.handlePointerWheel(direction, steps, pointer && pointer.valid && pointer.insideViewport ? { x: pointer.viewportX, y: pointer.viewportY } : null)) {
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
		switch (button) {
			case 'problems':
				this.toggleProblemsPanel();
				return;
			case 'filter':
				this.toggleResourcePanelFilterMode();
				return;
			case 'wrap':
				this.toggleWordWrap();
				return;
			case 'resolution':
				this.toggleResolutionMode();
				return;
			case 'resources':
				this.toggleResourcePanel();
				return;
			case 'save':
				if (this.dirty) {
					void this.save();
				}
				return;
			case 'resume':
			case 'reboot':
				this.activateCodeTab();
				if (this.dirty) {
					this.openActionPrompt(button);
					return;
				}
				this.performAction(button);
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
			this.showMessage('Console runtime unavailable.', constants.COLOR_STATUS_ERROR, 4.0);
			return false;
		}
		if (!runtime.isLuaRuntimeFailed() && !this.hasPendingRuntimeReload()) {
			this.clearExecutionStopHighlights();
			this.deactivate();
			$.paused = false;
			return true;
		}
		let snapshot: unknown = null;
		try {
			snapshot = runtime.getState();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(`Failed to capture runtime state: ${message}`, constants.COLOR_STATUS_ERROR, 4.0);
			return false;
		}
		const sanitizedSnapshot = this.prepareRuntimeSnapshotForResume(snapshot);
		if (!sanitizedSnapshot) {
			this.showMessage('Runtime state unavailable.', constants.COLOR_STATUS_ERROR, 4.0);
			return false;
		}
		const targetGeneration = this.saveGeneration;
		const shouldUpdateGeneration = this.hasPendingRuntimeReload();
		this.clearExecutionStopHighlights();
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
			this.showMessage('Console runtime unavailable.', constants.COLOR_STATUS_ERROR, 4.0);
			return false;
		}
		const requiresReload = this.hasPendingRuntimeReload();
		const savedSource = requiresReload ? this.getMainProgramSourceForReload() : null;
		const targetGeneration = this.saveGeneration;
		this.clearExecutionStopHighlights();
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

	// Indentation adjustments delegated to base class implementation.


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

	protected revealCursor(): void {
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
		this.ensureVisualLines();
		const bounds = this.getCodeAreaBounds();
		const relativeY = viewportY - bounds.codeTop;
		const lineOffset = Math.floor(relativeY / this.lineHeight);
		let visualIndex = this.scrollRow + lineOffset;
		const visualCount = this.getVisualLineCount();
		if (visualIndex < 0) {
			visualIndex = 0;
		}
		if (visualCount > 0 && visualIndex > visualCount - 1) {
			visualIndex = visualCount - 1;
		}
		const segment = this.visualIndexToSegment(visualIndex);
		if (!segment) {
			this.lastPointerRowResolution = null;
			return clamp(visualIndex, 0, Math.max(0, this.lines.length - 1));
		}
		this.lastPointerRowResolution = { visualIndex, segment };
		return segment.row;
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
		let segmentStartColumn = this.scrollColumn;
		let segmentEndColumn = line.length;
		const resolvedSegment = this.lastPointerRowResolution?.segment;
		if (this.wordWrapEnabled && resolvedSegment && resolvedSegment.row === row) {
			segmentStartColumn = resolvedSegment.startColumn;
			segmentEndColumn = resolvedSegment.endColumn;
		}
		if (this.wordWrapEnabled) {
			if (segmentStartColumn < 0) {
				segmentStartColumn = 0;
			}
			if (segmentEndColumn < segmentStartColumn) {
				segmentEndColumn = segmentStartColumn;
			}
		} else {
			segmentStartColumn = Math.min(segmentStartColumn, line.length);
			segmentEndColumn = line.length;
		}
		const effectiveStartColumn = clamp(segmentStartColumn, 0, line.length);
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
			return this.wordWrapEnabled ? Math.min(segmentEndColumn, line.length) : line.length;
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
		if (this.wordWrapEnabled) {
			if (column > segmentEndColumn) {
				column = segmentEndColumn;
			}
			if (column < segmentStartColumn) {
				column = segmentStartColumn;
			}
		} else if (column > line.length) {
			column = line.length;
		}
		if (column < 0) {
			column = 0;
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
		this.ensureVisualLines();
		if (viewportY < bounds.codeTop) {
			if (this.scrollRow > 0) {
				this.scrollRow -= 1;
			}
		}
		else if (viewportY >= bounds.codeBottom) {
			const lastRow = this.getVisualLineCount() - 1;
			if (this.scrollRow < lastRow) {
				this.scrollRow += 1;
			}
		}
	const maxScrollColumn = this.computeMaximumScrollColumn();
		if (viewportX < bounds.gutterLeft) {
			return;
		}
	if (!this.wordWrapEnabled) {
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
	}
		if (this.scrollRow < 0) {
			this.scrollRow = 0;
		}
	if (this.scrollColumn < 0) {
		this.scrollColumn = 0;
	}
	if (this.wordWrapEnabled) {
		this.scrollColumn = 0;
	}
	const maxScrollRow = Math.max(0, this.getVisualLineCount() - this.visibleRowCount());
	if (this.scrollRow > maxScrollRow) {
		this.scrollRow = maxScrollRow;
	}
	if (!this.wordWrapEnabled && this.scrollColumn > maxScrollColumn) {
		this.scrollColumn = maxScrollColumn;
	}
	}

	private registerPointerClick(row: number, column: number): boolean {
		const now = $.platform.clock.now();
		const interval = now - this.lastPointerClickTimeMs;
		const sameRow = row === this.lastPointerClickRow;
		const columnDelta = Math.abs(column - this.lastPointerClickColumn);
		const doubleClick = this.lastPointerClickTimeMs > 0
			&& interval <= constants.DOUBLE_CLICK_MAX_INTERVAL_MS
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
		this.ensureVisualLines();
		const maxScrollRow = Math.max(0, this.getVisualLineCount() - this.visibleRowCount());
		const targetRow = clamp(this.scrollRow + deltaRows, 0, maxScrollRow);
		this.scrollRow = targetRow;
	}

	// Cursor movement handled in ConsoleCartEditorTextOps base class.

	// Word navigation implemented in base class.

	// === InputController host wrappers ===
	// Snapshot helpers used by controllers to bracket mutations
	private recordSnapshotPre(key: string): void {
		// Use non-coalesced snapshot to ensure distinct undo step
		this.prepareUndo(key, false);
	}

	private recordSnapshotPost(_key: string): void {
		// Break coalescing to avoid merging unrelated edits
		this.breakUndoSequence();
	}

	private deleteCharLeft(): void {
		this.backspace();
	}

	private deleteCharRight(): void {
		this.deleteForward();
	}

	private insertNewline(): void {
		this.insertLineBreak();
	}

	// cursor/grid manipulation now resides in ConsoleCartEditorTextOps base class.

	private applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
		this.searchQuery = value;
		setFieldText(this.searchField, value, moveCursorToEnd);
	}

	private applySymbolSearchFieldText(value: string, moveCursorToEnd: boolean): void {
		this.symbolSearchQuery = value;
		setFieldText(this.symbolSearchField, value, moveCursorToEnd);
	}

	private applyResourceSearchFieldText(value: string, moveCursorToEnd: boolean): void {
		this.resourceSearchQuery = value;
		setFieldText(this.resourceSearchField, value, moveCursorToEnd);
	}

	private applyLineJumpFieldText(value: string, moveCursorToEnd: boolean): void {
		this.lineJumpValue = value;
		setFieldText(this.lineJumpField, value, moveCursorToEnd);
	}

	private applyCreateResourceFieldText(value: string, moveCursorToEnd: boolean): void {
		this.createResourcePath = value;
		setFieldText(this.createResourceField, value, moveCursorToEnd);
	}

	private inlineFieldMetrics(): InlineFieldMetrics {
		return this.inlineFieldMetricsRef;
	}

	private createInlineFieldEditingHandlers(keyboard: KeyboardInput): InlineFieldEditingHandlers {
		return {
			isKeyJustPressed: (code) => isKeyJustPressedGlobal(this.playerIndex, code),
			isKeyTyped: (code) => isKeyTypedGlobal(this.playerIndex, code),
			shouldFireRepeat: (code, deltaSeconds) => this.input.shouldRepeatPublic(keyboard, code, deltaSeconds),
			consumeKey: (code) => consumeKeyboardKey(keyboard, code),
			readClipboard: () => ConsoleCartEditor.customClipboard,
			writeClipboard: (payload, action) => {
				const message = action === 'copy'
					? 'Copied to editor clipboard'
					: 'Cut to editor clipboard';
				void this.writeClipboard(payload, message);
			},
			onClipboardEmpty: () => {
				this.showMessage('Editor clipboard is empty', constants.COLOR_STATUS_WARNING, 1.5);
			},
		};
	}

	private processInlineFieldEditing(field: InlineTextField, keyboard: KeyboardInput, options: InlineInputOptions): boolean {
		return applyInlineFieldEditing(field, options, this.createInlineFieldEditingHandlers(keyboard));
	}

	private processInlineFieldPointer(field: InlineTextField, textLeft: number, pointerX: number, justPressed: boolean, pointerPressed: boolean): void {
		const result = applyInlineFieldPointer(field, {
			metrics: this.inlineFieldMetrics(),
			textLeft,
			pointerX,
			justPressed,
			pointerPressed,
			now: () => $.platform.clock.now(),
			doubleClickInterval: constants.DOUBLE_CLICK_MAX_INTERVAL_MS,
		});
		if (result.requestBlinkReset) {
			this.resetBlink();
		}
	}

	protected updateDesiredColumn(): void {
		this.desiredColumn = this.cursorColumn;
		this.desiredDisplayOffset = 0;
		if (this.cursorRow < 0 || this.cursorRow >= this.lines.length) {
			return;
		}
		const entry = this.getCachedHighlight(this.cursorRow);
		const highlight = entry.hi;
		const cursorDisplay = this.columnToDisplay(highlight, this.cursorColumn);
		let segmentStartColumn = 0;
		if (this.wordWrapEnabled) {
			this.ensureVisualLines();
			const override = this.getCursorVisualOverride(this.cursorRow, this.cursorColumn);
			if (override) {
				segmentStartColumn = override.segmentStartColumn;
			} else {
				const visualIndex = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
				const segment = this.visualIndexToSegment(visualIndex);
				if (segment) {
					segmentStartColumn = segment.startColumn;
				}
			}
		}
		const segmentDisplayStart = this.columnToDisplay(highlight, segmentStartColumn);
		this.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
		if (this.desiredDisplayOffset < 0) {
			this.desiredDisplayOffset = 0;
		}
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
			this.showMessage(message, constants.COLOR_STATUS_SUCCESS, 2.5);
		} catch (error) {
			if (this.tryShowLuaErrorOverlay(error)) {
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
		}
	}

	protected showMessage(text: string, color: number, durationSeconds: number): void {
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

	private async copySelectionToClipboard(): Promise<void> {
		const text = this.getSelectionText();
		if (text === null) {
			this.showMessage('Nothing selected to copy', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		await this.writeClipboard(text, 'Copied selection to clipboard');
	}

	private async cutSelectionToClipboard(): Promise<void> {
		const text = this.getSelectionText();
		if (text === null) {
			this.showMessage('Nothing selected to cut', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		this.prepareUndo('cut', false);
		await this.writeClipboard(text, 'Cut selection to clipboard');
		this.replaceSelectionWith('');
	}

	private async cutLineToClipboard(): Promise<void> {
		if (this.lines.length === 0) {
			this.showMessage('Nothing selected to cut', constants.COLOR_STATUS_WARNING, 1.5);
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
			this.showMessage('Editor clipboard is empty', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		this.prepareUndo('paste', false);
		this.deleteSelectionIfPresent();
		this.insertClipboardText(text);
		this.showMessage('Pasted from editor clipboard', constants.COLOR_STATUS_SUCCESS, 1.5);
	}

	private async writeClipboard(text: string, successMessage: string): Promise<void> {
		ConsoleCartEditor.customClipboard = text;
		const clipboard = $.platform.clipboard;
		if (!clipboard.isSupported()) {
			const message = successMessage + ' (Editor clipboard only)';
			this.showMessage(message, constants.COLOR_STATUS_SUCCESS, 1.5);
			return;
		}
		try {
			await clipboard.writeText(text);
			this.showMessage(successMessage, constants.COLOR_STATUS_SUCCESS, 1.5);
		}
		catch (error) {
			this.showMessage('System clipboard write failed. Editor clipboard updated.', constants.COLOR_STATUS_WARNING, 3.5);
		}
	}

	protected captureSnapshot(): EditorSnapshot {
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

	protected restoreSnapshot(snapshot: EditorSnapshot, preserveSelection: boolean = false): void {
		const preservedSelection = preserveSelection && this.selectionAnchor
			? { row: this.selectionAnchor.row, column: this.selectionAnchor.column }
			: null;
		this.lines = snapshot.lines.slice();
		this.invalidateVisualLines();
		this.invalidateAllHighlights();
		this.markDiagnosticsDirty();
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

	private drawTopBar(api: BmsxConsoleApi): void {
	const host = {
		viewportWidth: this.viewportWidth,
		headerHeight: this.headerHeight,
		lineHeight: this.lineHeight,
		measureText: (text: string) => this.measureText(text),
		drawText: (api2: BmsxConsoleApi, text: string, x: number, y: number, color: number) => drawEditorText(api2, this.font, text, x, y, color),
			wordWrapEnabled: this.wordWrapEnabled,
			resolutionMode: this.resolutionMode,
			metadata: this.metadata,
			dirty: this.dirty,
			resourcePanelVisible: this.resourcePanelVisible,
			resourcePanelFilterMode: this.resourcePanel.getFilterMode(),
			problemsPanelVisible: this.problemsPanel.isVisible(),
			topBarButtonBounds: this.topBarButtonBounds,
		};
		renderTopBar(api, host);
	}

	private drawCreateResourceBar(api: BmsxConsoleApi): void {
	const host = {
		viewportWidth: this.viewportWidth,
		headerHeight: this.headerHeight,
		tabBarHeight: this.getTabBarTotalHeight(),
		lineHeight: this.lineHeight,
		spaceAdvance: this.spaceAdvance,
		charAdvance: this.charAdvance,
		measureText: (t: string) => this.measureText(t),
		drawText: (api2: BmsxConsoleApi, t: string, x: number, y: number, c: number) => drawEditorText(api2, this.font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: this.createResourceActive,
			createResourceVisible: this.createResourceVisible,
			createResourceField: this.createResourceField,
			createResourceWorking: this.createResourceWorking,
			createResourceError: this.createResourceError,
			drawCreateResourceErrorDialog: (api4: BmsxConsoleApi, err: string) => this.drawCreateResourceErrorDialog(api4, err),
			getCreateResourceBarHeight: () => this.getCreateResourceBarHeight(),
			getSearchBarHeight: () => this.getSearchBarHeight(),
			getResourceSearchBarHeight: () => this.getResourceSearchBarHeight(),
			getSymbolSearchBarHeight: () => this.getSymbolSearchBarHeight(),
			getRenameBarHeight: () => this.getRenameBarHeight(),
			getLineJumpBarHeight: () => this.getLineJumpBarHeight(),
			drawInlineCaret: (
				api3: BmsxConsoleApi,
				field: InlineTextField,
				l: number,
				t: number,
				r: number,
				b: number,
				baseX: number,
				active: boolean,
				caretColor: { r: number; g: number; b: number; a: number },
				textColor: number,
			) => this.drawInlineCaret(api3, field, l, t, r, b, baseX, active, caretColor, textColor),
			inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
			inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
			inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
			blockActiveCarets: (this.problemsPanel.isVisible() && this.problemsPanel.isFocused()),
		};
			renderCreateResourceBar(api, host);
	}

	private drawSearchBar(api: BmsxConsoleApi): void {
		const host: import('./render_inline_bars').InlineBarsHost = {
			viewportWidth: this.viewportWidth,
			headerHeight: this.headerHeight,
			tabBarHeight: this.getTabBarTotalHeight(),
			lineHeight: this.lineHeight,
			spaceAdvance: this.spaceAdvance,
			charAdvance: this.charAdvance,
			measureText: (t: string) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, this.font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: this.createResourceActive,
			createResourceVisible: this.createResourceVisible,
			createResourceField: this.createResourceField,
			createResourceWorking: this.createResourceWorking,
			createResourceError: this.createResourceError,
			drawCreateResourceErrorDialog: (a, m) => this.drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => this.getCreateResourceBarHeight(),
		getSearchBarHeight: () => this.getSearchBarHeight(),
		getResourceSearchBarHeight: () => this.getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => this.getSymbolSearchBarHeight(),
		getRenameBarHeight: () => this.getRenameBarHeight(),
		getLineJumpBarHeight: () => this.getLineJumpBarHeight(),
			drawInlineCaret: (
				a: BmsxConsoleApi,
				f: InlineTextField,
				l: number,
				t: number,
				r: number,
				b: number,
				bx: number,
				ac: boolean,
				cc: { r: number; g: number; b: number; a: number },
				tc: number,
			) => this.drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
			inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
			inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
			inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
			blockActiveCarets: (this.problemsPanel.isVisible() && this.problemsPanel.isFocused()),
			searchActive: this.searchActive,
			searchField: this.searchField,
			searchQuery: this.searchQuery,
			searchMatchesCount: this.searchMatches.length,
			searchCurrentIndex: this.searchCurrentIndex,
		};
		renderSearchBar(api, host);
	}

	private drawResourceSearchBar(api: BmsxConsoleApi): void {
		const host: import('./render_inline_bars').InlineBarsHost = {
			viewportWidth: this.viewportWidth,
			headerHeight: this.headerHeight,
			tabBarHeight: this.getTabBarTotalHeight(),
			lineHeight: this.lineHeight,
			spaceAdvance: this.spaceAdvance,
			charAdvance: this.charAdvance,
			measureText: (t: string) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, this.font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: this.createResourceActive,
			createResourceVisible: this.createResourceVisible,
			createResourceField: this.createResourceField,
			createResourceWorking: this.createResourceWorking,
			createResourceError: this.createResourceError,
			drawCreateResourceErrorDialog: (a, m) => this.drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => this.getCreateResourceBarHeight(),
		getSearchBarHeight: () => this.getSearchBarHeight(),
		getResourceSearchBarHeight: () => this.getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => this.getSymbolSearchBarHeight(),
		getRenameBarHeight: () => this.getRenameBarHeight(),
		getLineJumpBarHeight: () => this.getLineJumpBarHeight(),
			drawInlineCaret: (
				a: BmsxConsoleApi,
				f: InlineTextField,
				l: number,
				t: number,
				r: number,
				b: number,
				bx: number,
				ac: boolean,
				cc: { r: number; g: number; b: number; a: number },
				tc: number,
			) => this.drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
			inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
			inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
			inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
			blockActiveCarets: (this.problemsPanel.isVisible() && this.problemsPanel.isFocused()),
			resourceSearchActive: this.resourceSearchActive,
			resourceSearchField: this.resourceSearchField,
			resourceSearchVisibleResultCount: () => this.resourceSearchVisibleResultCount(),
			resourceSearchEntryHeight: () => this.resourceSearchEntryHeight(),
			isResourceSearchCompactMode: () => this.isResourceSearchCompactMode(),
			resourceSearchMatches: this.resourceSearchMatches,
			resourceSearchSelectionIndex: this.resourceSearchSelectionIndex,
			resourceSearchHoverIndex: this.resourceSearchHoverIndex,
			resourceSearchDisplayOffset: this.resourceSearchDisplayOffset,
		};
		renderResourceSearchBar(api, host);
	}

	private drawSymbolSearchBar(api: BmsxConsoleApi): void {
		const host: import('./render_inline_bars').InlineBarsHost = {
			viewportWidth: this.viewportWidth,
			headerHeight: this.headerHeight,
			tabBarHeight: this.getTabBarTotalHeight(),
			lineHeight: this.lineHeight,
			spaceAdvance: this.spaceAdvance,
			charAdvance: this.charAdvance,
			measureText: (t: string) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, this.font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: this.createResourceActive,
			createResourceVisible: this.createResourceVisible,
			createResourceField: this.createResourceField,
			createResourceWorking: this.createResourceWorking,
			createResourceError: this.createResourceError,
			drawCreateResourceErrorDialog: (a, m) => this.drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => this.getCreateResourceBarHeight(),
		getSearchBarHeight: () => this.getSearchBarHeight(),
		getResourceSearchBarHeight: () => this.getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => this.getSymbolSearchBarHeight(),
		getRenameBarHeight: () => this.getRenameBarHeight(),
		getLineJumpBarHeight: () => this.getLineJumpBarHeight(),
			drawInlineCaret: (
				a: BmsxConsoleApi,
				f: InlineTextField,
				l: number,
				t: number,
				r: number,
				b: number,
				bx: number,
				ac: boolean,
				cc: { r: number; g: number; b: number; a: number },
				tc: number,
			) => this.drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
			inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
			inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
			inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
			blockActiveCarets: (this.problemsPanel.isVisible() && this.problemsPanel.isFocused()),
			symbolSearchGlobal: this.symbolSearchGlobal,
			symbolSearchActive: this.symbolSearchActive,
			symbolSearchMode: this.symbolSearchMode,
			symbolSearchField: this.symbolSearchField,
			symbolSearchVisibleResultCount: () => this.symbolSearchVisibleResultCount(),
			symbolSearchEntryHeight: () => this.symbolSearchEntryHeight(),
			isSymbolSearchCompactMode: () => this.isSymbolSearchCompactMode(),
			symbolSearchMatches: this.symbolSearchMatches,
			symbolSearchSelectionIndex: this.symbolSearchSelectionIndex,
			symbolSearchHoverIndex: this.symbolSearchHoverIndex,
			symbolSearchDisplayOffset: this.symbolSearchDisplayOffset,
		};
		renderSymbolSearchBar(api, host);
	}

	private drawRenameBar(api: BmsxConsoleApi): void {
		const host: import('./render_inline_bars').InlineBarsHost = {
			viewportWidth: this.viewportWidth,
			headerHeight: this.headerHeight,
			tabBarHeight: this.getTabBarTotalHeight(),
			lineHeight: this.lineHeight,
			spaceAdvance: this.spaceAdvance,
			charAdvance: this.charAdvance,
			measureText: (t: string) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, this.font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: this.createResourceActive,
			createResourceVisible: this.createResourceVisible,
			createResourceField: this.createResourceField,
			createResourceWorking: this.createResourceWorking,
			createResourceError: this.createResourceError,
			drawCreateResourceErrorDialog: (a, m) => this.drawCreateResourceErrorDialog(a, m),
			getCreateResourceBarHeight: () => this.getCreateResourceBarHeight(),
			getSearchBarHeight: () => this.getSearchBarHeight(),
			getResourceSearchBarHeight: () => this.getResourceSearchBarHeight(),
			getSymbolSearchBarHeight: () => this.getSymbolSearchBarHeight(),
			getRenameBarHeight: () => this.getRenameBarHeight(),
			getLineJumpBarHeight: () => this.getLineJumpBarHeight(),
			drawInlineCaret: (
				a: BmsxConsoleApi,
				f: InlineTextField,
				l: number,
				t: number,
				r: number,
				b: number,
				bx: number,
				ac: boolean,
				cc: { r: number; g: number; b: number; a: number },
				tc: number,
			) => this.drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
			inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
			inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
			inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
			blockActiveCarets: (this.problemsPanel.isVisible() && this.problemsPanel.isFocused()),
			renameActive: this.renameController.isActive(),
			renameField: this.renameController.getField(),
			renameMatchCount: this.renameController.getMatchCount(),
			renameExpression: this.renameController.getExpressionLabel(),
			renameOriginalName: this.renameController.getOriginalName(),
		};
		renderRenameBar(api, host);
	}

	private drawLineJumpBar(api: BmsxConsoleApi): void {
		const host: import('./render_inline_bars').InlineBarsHost = {
			viewportWidth: this.viewportWidth,
			headerHeight: this.headerHeight,
			tabBarHeight: this.getTabBarTotalHeight(),
			lineHeight: this.lineHeight,
			spaceAdvance: this.spaceAdvance,
			charAdvance: this.charAdvance,
			measureText: (t: string) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, this.font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: this.createResourceActive,
			createResourceVisible: this.createResourceVisible,
			createResourceField: this.createResourceField,
			createResourceWorking: this.createResourceWorking,
			createResourceError: this.createResourceError,
			drawCreateResourceErrorDialog: (a, m) => this.drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => this.getCreateResourceBarHeight(),
		getSearchBarHeight: () => this.getSearchBarHeight(),
		getResourceSearchBarHeight: () => this.getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => this.getSymbolSearchBarHeight(),
		getRenameBarHeight: () => this.getRenameBarHeight(),
		getLineJumpBarHeight: () => this.getLineJumpBarHeight(),
			drawInlineCaret: (
				a: BmsxConsoleApi,
				f: InlineTextField,
				l: number,
				t: number,
				r: number,
				b: number,
				bx: number,
				ac: boolean,
				cc: { r: number; g: number; b: number; a: number },
				tc: number,
			) => this.drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
			inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
			inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
			inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
			blockActiveCarets: (this.problemsPanel.isVisible() && this.problemsPanel.isFocused()),
			lineJumpActive: this.lineJumpActive,
			lineJumpField: this.lineJumpField,
		};
		renderLineJumpBar(api, host);
	}

	private drawCreateResourceErrorDialog(api: BmsxConsoleApi, message: string): void {
		const maxDialogWidth = Math.min(this.viewportWidth - 16, 360);
		const wrapWidth = Math.max(this.charAdvance, maxDialogWidth - (constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
		const segments = message.split(/\r?\n/);
		const lines: string[] = [];
		for (let i = 0; i < segments.length; i += 1) {
			const segment = segments[i].trim();
			const wrapped = wrapRuntimeErrorLineUtil(segment.length === 0 ? '' : segment, wrapWidth, (text) => this.measureText(text));
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
		const dialogWidth = Math.min(this.viewportWidth - 16, Math.max(180, contentWidth + constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
		const dialogHeight = Math.min(this.viewportHeight - 16, lines.length * this.lineHeight + constants.ERROR_OVERLAY_PADDING_Y * 2 + 16);
		const left = Math.max(8, Math.floor((this.viewportWidth - dialogWidth) / 2));
		const top = Math.max(8, Math.floor((this.viewportHeight - dialogHeight) / 2));
		const right = left + dialogWidth;
		const bottom = top + dialogHeight;
		api.rectfill(left, top, right, bottom, constants.COLOR_STATUS_BACKGROUND);
		api.rect(left, top, right, bottom, constants.COLOR_CREATE_RESOURCE_ERROR);
	const dialogPaddingX = constants.ERROR_OVERLAY_PADDING_X + 6;
	const dialogPaddingY = constants.ERROR_OVERLAY_PADDING_Y + 6;
	renderErrorOverlayText(
		api,
		this.font,
		lines,
		left + dialogPaddingX,
		top + dialogPaddingY,
		this.lineHeight,
		constants.COLOR_STATUS_TEXT
	);
	}

	private simplifyRuntimeErrorMessage(message: string): string {
		return message.replace(/^\[BmsxConsoleRuntime\]\s*/, '');
	}

	private codeViewportTop(): number {
	return this.topMargin
		+ this.getCreateResourceBarHeight()
		+ this.getSearchBarHeight()
		+ this.getResourceSearchBarHeight()
		+ this.getSymbolSearchBarHeight()
		+ this.getRenameBarHeight()
		+ this.getLineJumpBarHeight();
}

	private getCreateResourceBarHeight(): number {
		if (!this.isCreateResourceVisible()) {
			return 0;
		}
		return this.lineHeight + constants.CREATE_RESOURCE_BAR_MARGIN_Y * 2;
	}

	private isCreateResourceVisible(): boolean {
		return this.createResourceVisible;
	}

	private getSearchBarHeight(): number {
		if (!this.isSearchVisible()) {
			return 0;
		}
		return this.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	}

	private isSearchVisible(): boolean {
		return this.searchVisible;
	}

	private getResourceSearchBarHeight(): number {
		if (!this.isResourceSearchVisible()) {
			return 0;
		}
		const baseHeight = this.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
		const visible = this.resourceSearchVisibleResultCount();
		if (visible <= 0) {
			return baseHeight;
		}
		return baseHeight + constants.QUICK_OPEN_RESULT_SPACING + visible * this.resourceSearchEntryHeight();
	}

	private isResourceSearchVisible(): boolean {
		return this.resourceSearchVisible;
	}

	private getSymbolSearchBarHeight(): number {
	if (!this.isSymbolSearchVisible()) {
		return 0;
	}
	const baseHeight = this.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	const visible = this.symbolSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SYMBOL_SEARCH_RESULT_SPACING + visible * this.symbolSearchEntryHeight();
}

	private isSymbolSearchVisible(): boolean {
		return this.symbolSearchVisible;
	}

	private getRenameBarHeight(): number {
		if (!this.isRenameVisible()) {
			return 0;
		}
		return this.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	}

	private isRenameVisible(): boolean {
		return this.renameController.isVisible();
	}

	private getLineJumpBarHeight(): number {
		if (!this.isLineJumpVisible()) {
			return 0;
		}
		return this.lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2;
	}

	private isLineJumpVisible(): boolean {
		return this.lineJumpVisible;
	}

	private getCreateResourceBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getCreateResourceBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = this.headerHeight + this.getTabBarTotalHeight();
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
		const top = this.headerHeight + this.getTabBarTotalHeight() + this.getCreateResourceBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: this.viewportWidth,
		};
	}

	private getResourceSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getResourceSearchBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = this.headerHeight + this.getTabBarTotalHeight() + this.getCreateResourceBarHeight() + this.getSearchBarHeight();
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
	const top = this.headerHeight + this.getTabBarTotalHeight()
		+ this.getCreateResourceBarHeight()
		+ this.getSearchBarHeight()
		+ this.getResourceSearchBarHeight()
		+ this.getSymbolSearchBarHeight()
		+ this.getRenameBarHeight();
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
		const top = this.headerHeight + this.getTabBarTotalHeight()
			+ this.getCreateResourceBarHeight()
			+ this.getSearchBarHeight()
			+ this.getResourceSearchBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: this.viewportWidth,
		};
	}

	private getRenameBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getRenameBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = this.headerHeight + this.getTabBarTotalHeight()
			+ this.getCreateResourceBarHeight()
			+ this.getSearchBarHeight()
			+ this.getResourceSearchBarHeight()
			+ this.getSymbolSearchBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: this.viewportWidth,
		};
	}

	private drawCodeArea(api: BmsxConsoleApi): void {
		const host: import('./render_code_area').CodeAreaHost = {
			// Geometry and metrics
			lineHeight: this.lineHeight,
			spaceAdvance: this.spaceAdvance,
			charAdvance: this.charAdvance,
			warnNonMonospace: this.warnNonMonospace,
			// Editor state
			wordWrapEnabled: this.wordWrapEnabled,
			codeHorizontalScrollbarVisible: this.codeHorizontalScrollbarVisible,
			codeVerticalScrollbarVisible: this.codeVerticalScrollbarVisible,
			cachedVisibleRowCount: this.cachedVisibleRowCount,
			cachedVisibleColumnCount: this.cachedVisibleColumnCount,
			scrollRow: this.scrollRow,
			scrollColumn: this.scrollColumn,
			cursorRow: this.cursorRow,
			cursorColumn: this.cursorColumn,
			cursorVisible: this.cursorVisible,
			cursorScreenInfo: this.cursorScreenInfo,
			gotoHoverHighlight: this.gotoHoverHighlight,
			executionStopRow: this.executionStopRow,
			lines: this.lines,
			// Helpers
			ensureVisualLines: () => this.ensureVisualLines(),
			getCodeAreaBounds: () => this.getCodeAreaBounds(),
			maximumLineLength: () => this.maximumLineLength(),
			getVisualLineCount: () => this.getVisualLineCount(),
			positionToVisualIndex: (r: number, c: number) => this.positionToVisualIndex(r, c),
			visualIndexToSegment: (v: number) => this.visualIndexToSegment(v),
			getCachedHighlight: (r: number) => this.getCachedHighlight(r),
			sliceHighlightedLine: (hi, start, count) => this.sliceHighlightedLine(hi, start, count),
			columnToDisplay: (hi, c) => this.columnToDisplay(hi, c),
			drawColoredText: (a, t, cols, x, y) => drawEditorColoredText(a, this.font, t, cols, x, y, constants.COLOR_CODE_TEXT),
			drawReferenceHighlightsForRow: (a, ri, e, ox, oy, s, ed) => this.drawReferenceHighlightsForRow(a, ri, e, ox, oy, s, ed),
			drawSearchHighlightsForRow: (a, ri, e, ox, oy, s, ed) => this.drawSearchHighlightsForRow(a, ri, e, ox, oy, s, ed),
			computeSelectionSlice: (ri, hi, s, e) => this.computeSelectionSlice(ri, hi, s, e),
			measureRangeFast: (entry, from, to) => this.measureRangeFast(entry, from, to),
			getDiagnosticsForRow: (row) => this.getDiagnosticsForRow(row),
			scrollbars: {
				codeVertical: this.scrollbars.codeVertical,
				codeHorizontal: this.scrollbars.codeHorizontal,
			},
			computeMaximumScrollColumn: () => this.computeMaximumScrollColumn(),
			// Overlays
			drawRuntimeErrorOverlay: (a, ct, cr, tl) => this.drawRuntimeErrorOverlay(a, ct, cr, tl),
			drawHoverTooltip: (a, ct, cb, tl) => this.drawHoverTooltip(a, ct, cb, tl),
			drawCursor: (a, info, tx) => this.drawCursor(a, info, tx),
			computeCursorScreenInfo: (entry, tl, rt, ssd) => this.computeCursorScreenInfo(entry, tl, rt, ssd),
			drawCompletionPopup: (a, b) => this.completion.drawCompletionPopup(a, b),
			drawParameterHintOverlay: (a, b) => this.completion.drawParameterHintOverlay(a, b),
		};
		renderCodeArea(api, host);
		// write back mutable state possibly changed by renderer
		this.wordWrapEnabled = host.wordWrapEnabled;
		this.codeHorizontalScrollbarVisible = host.codeHorizontalScrollbarVisible;
		this.codeVerticalScrollbarVisible = host.codeVerticalScrollbarVisible;
		this.cachedVisibleRowCount = host.cachedVisibleRowCount;
		this.cachedVisibleColumnCount = host.cachedVisibleColumnCount;
		this.scrollRow = host.scrollRow;
		this.scrollColumn = host.scrollColumn;
		this.cursorScreenInfo = host.cursorScreenInfo;
	}

private drawRuntimeErrorOverlay(api: BmsxConsoleApi, codeTop: number, codeRight: number, textLeft: number): void {
		const overlay = this.runtimeErrorOverlay;
		if (!overlay) {
			return;
		}
		this.ensureVisualLines();
		const visualIndex = this.positionToVisualIndex(overlay.row, overlay.column);
		const visibleRows = this.visibleRowCount();
		const relativeRow = visualIndex - this.scrollRow;
		if (relativeRow < 0 || relativeRow >= visibleRows) {
			return;
		}
		const segment = this.visualIndexToSegment(visualIndex);
		if (!segment) {
			return;
		}
		const entry = this.getCachedHighlight(segment.row);
		const highlight = entry.hi;
		let columnStart = this.wordWrapEnabled ? segment.startColumn : this.scrollColumn;
		if (this.wordWrapEnabled) {
			if (columnStart < segment.startColumn || columnStart > segment.endColumn) {
				columnStart = segment.startColumn;
			}
		}
		const columnCount = this.wordWrapEnabled
			? Math.max(0, segment.endColumn - columnStart)
			: this.visibleColumnCount() + 4;
		const slice = this.sliceHighlightedLine(highlight, columnStart, columnCount);
		const sliceStartDisplay = slice.startDisplay;
		const sliceEndLimit = this.wordWrapEnabled ? this.columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
		const sliceEndDisplay = this.wordWrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
		const anchorDisplay = this.columnToDisplay(highlight, overlay.column);
		const clampedAnchorDisplay = clamp(anchorDisplay, sliceStartDisplay, sliceEndDisplay);
		const anchorX = textLeft + this.measureRangeFast(entry, sliceStartDisplay, clampedAnchorDisplay);
		const rowTop = codeTop + relativeRow * this.lineHeight;
		const lines = overlay.lines.length > 0 ? overlay.lines : ['Runtime error'];
		const availableBottom = this.viewportHeight - this.bottomMargin;
		const belowTop = rowTop + this.lineHeight + 2;
		const bubbleBounds = computeErrorOverlayBounds(
			anchorX,
			rowTop,
			lines,
			(text) => this.measureText(text),
			{
				left: textLeft,
				top: codeTop,
				right: codeRight,
				bottom: availableBottom
			},
			this.lineHeight
		);

		const placedBelow = bubbleBounds.top >= belowTop - 1;
		const connectorLeft = Math.max(textLeft, anchorX);
		const connectorRight = Math.min(bubbleBounds.left, connectorLeft + 3);

		let connector: ErrorOverlayRenderConfig['connector'] = undefined;
		if (connectorRight > connectorLeft) {
			if (placedBelow) {
				const connectorStartY = rowTop + this.lineHeight;
				if (bubbleBounds.top > connectorStartY) {
					connector = {
						left: connectorLeft,
						right: connectorRight,
						startY: connectorStartY,
						endY: bubbleBounds.top
					};
				}
			} else if (bubbleBounds.bottom < rowTop) {
				connector = {
					left: connectorLeft,
					right: connectorRight,
					startY: bubbleBounds.bottom,
					endY: rowTop
				};
			}
		}

		renderErrorOverlay(api, lines, this.font, this.lineHeight, {
			bounds: bubbleBounds,
			background: constants.ERROR_OVERLAY_BACKGROUND,
			textColor: constants.ERROR_OVERLAY_TEXT_COLOR,
			paddingX: constants.ERROR_OVERLAY_PADDING_X,
			paddingY: constants.ERROR_OVERLAY_PADDING_Y,
			connector
		});
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
		// Keep editor/controller visibility in sync by delegating to controller
		this.resourcePanel.togglePanel();
	}

	private toggleProblemsPanel(): void {
		if (this.problemsPanel.isVisible()) {
			this.hideProblemsPanel();
			return;
		}
		this.showProblemsPanel();
	}

	private showProblemsPanel(): void {
		this.problemsPanel.show();
		this.markDiagnosticsDirty();
	}

	private hideProblemsPanel(): void {
		this.problemsPanel.hide();
		this.focusEditorFromProblemsPanel();
	}

	private toggleResourcePanelFilterMode(): void {
		// Controller owns filter state and messaging
		this.resourcePanel.toggleFilterMode();
	}

	private toggleResolutionMode(): void {
		this.resolutionMode = this.resolutionMode === 'offscreen' ? 'viewport' : 'offscreen';
		this.refreshViewportDimensions(true);
		this.ensureCursorVisible();
		this.cursorRevealSuspended = false;
		this.applyResolutionModeToRuntime();
		const modeLabel = this.resolutionMode === 'offscreen' ? 'OFFSCREEN' : 'NATIVE';
		this.showMessage(`Editor resolution: ${modeLabel}`, constants.COLOR_STATUS_TEXT, 2.5);
	}

	private toggleWordWrap(): void {
		this.ensureVisualLines();
		const previousWrap = this.wordWrapEnabled;
		const visualLineCount = this.getVisualLineCount();
		const previousTopIndex = clamp(this.scrollRow, 0, visualLineCount > 0 ? visualLineCount - 1 : 0);
		const previousTopSegment = this.visualIndexToSegment(previousTopIndex);
		const anchorRow = previousTopSegment ? previousTopSegment.row : this.cursorRow;
		const anchorColumnForWrap = previousTopSegment ? previousTopSegment.startColumn : 0;
		const anchorColumnForUnwrap = previousTopSegment
			? (previousWrap ? previousTopSegment.startColumn : this.scrollColumn)
			: this.scrollColumn;
		const previousCursorRow = this.cursorRow;
		const previousCursorColumn = this.cursorColumn;
		const previousDesiredColumn = this.desiredColumn;

		this.wordWrapEnabled = !previousWrap;
		this.cursorRevealSuspended = false;
		this.invalidateVisualLines();
		this.ensureVisualLines();

		this.cursorRow = clamp(previousCursorRow, 0, this.lines.length > 0 ? this.lines.length - 1 : 0);
		const currentLine = this.lines[this.cursorRow] ?? '';
		this.cursorColumn = clamp(previousCursorColumn, 0, currentLine.length);
		this.desiredColumn = previousDesiredColumn;

		if (this.wordWrapEnabled) {
			this.scrollColumn = 0;
			const anchorVisualIndex = this.positionToVisualIndex(anchorRow, anchorColumnForWrap);
			this.scrollRow = clamp(anchorVisualIndex, 0, Math.max(0, this.getVisualLineCount() - this.visibleRowCount()));
		} else {
			this.scrollColumn = clamp(anchorColumnForUnwrap, 0, this.computeMaximumScrollColumn());
			const anchorVisualIndex = this.positionToVisualIndex(anchorRow, this.scrollColumn);
		this.scrollRow = clamp(anchorVisualIndex, 0, Math.max(0, this.getVisualLineCount() - this.visibleRowCount()));
		}
		this.lastPointerRowResolution = null;
		this.ensureCursorVisible();
		this.updateDesiredColumn();
		const message = this.wordWrapEnabled ? 'Word wrap enabled' : 'Word wrap disabled';
		this.showMessage(message, constants.COLOR_STATUS_TEXT, 2.5);
	}

	private applyResolutionModeToRuntime(): void {
		const runtime = this.getConsoleRuntime();
		if (!runtime) {
			return;
		}
		runtime.setEditorOverlayResolution(this.resolutionMode);
	}

	// showResourcePanel removed; controller handles visibility via toggle/show()

	private hideResourcePanel(): void {
		// Forward to controller; it resets its internal state
		this.resourcePanel.hide();
		this.resourcePanelFocused = false;
		this.resourcePanelResizing = false;
		this.resetResourcePanelState();
		this.invalidateVisualLines();
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

	private closeActiveTab(): void {
		if (!this.activeTabId) {
			return;
		}
		this.closeTab(this.activeTabId);
	}

	private closeTab(tabId: string): void {
		const index = this.tabs.findIndex(tab => tab.id === tabId);
		if (index === -1) {
			return;
		}
		if (this.tabDragState && this.tabDragState.tabId === tabId) {
			this.endTabDrag();
		}
		const tab = this.tabs[index];
		if (!tab.closable) {
			return;
		}
		const wasActiveContext = tab.kind === 'lua_editor' && this.activeCodeTabContextId === tab.id;
		if (wasActiveContext) {
			this.storeActiveCodeTabContext();
		}
		this.tabs.splice(index, 1);
		if (tab.kind === 'lua_editor') {
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

	private cycleTab(direction: number): void {
		if (this.tabs.length <= 1 || direction === 0) {
			return;
		}
		const count = this.tabs.length;
		let currentIndex = this.tabs.findIndex(tab => tab.id === this.activeTabId);
		if (currentIndex === -1) {
			const fallbackIndex = direction > 0 ? 0 : count - 1;
			const fallback = this.tabs[fallbackIndex];
			if (fallback) {
				this.setActiveTab(fallback.id);
			}
			return;
		}
		let nextIndex = currentIndex + direction;
		nextIndex = ((nextIndex % count) + count) % count;
		if (nextIndex === currentIndex) {
			return;
		}
		const target = this.tabs[nextIndex];
		this.setActiveTab(target.id);
	}

	private measureTabWidth(tab: EditorTabDescriptor): number {
		const textWidth = this.measureText(tab.title);
		let indicatorWidth = 0;
		if (tab.closable) {
			indicatorWidth = this.measureText(constants.TAB_CLOSE_BUTTON_SYMBOL) + constants.TAB_CLOSE_BUTTON_PADDING_X * 2;
		} else if (tab.dirty) {
			const metrics = this.getTabDirtyMarkerMetrics();
			indicatorWidth = metrics.width + constants.TAB_DIRTY_MARKER_SPACING;
		}
		return textWidth + constants.TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
	}

	private computeTabLayout(): Array<{ id: string; left: number; right: number; width: number; center: number; rowIndex: number }> {
		const layout: Array<{ id: string; left: number; right: number; width: number; center: number; rowIndex: number }> = [];
		for (let index = 0; index < this.tabs.length; index += 1) {
			const tab = this.tabs[index];
			const bounds = this.tabButtonBounds.get(tab.id) ?? null;
			if (bounds) {
				const left = bounds.left;
				const right = bounds.right;
				const width = Math.max(0, right - left);
				const rowIndex = Math.max(0, Math.floor((bounds.top - this.headerHeight) / this.tabBarHeight));
				layout.push({
					id: tab.id,
					left,
					right,
					width,
					center: (left + right) * 0.5,
					rowIndex,
				});
				continue;
			}
			const width = this.measureTabWidth(tab);
			const previous = layout.length > 0 ? layout[layout.length - 1] : null;
			const left = previous ? previous.right + constants.TAB_BUTTON_SPACING : 4;
			const right = left + width;
			layout.push({
				id: tab.id,
				left,
				right,
				width,
				center: (left + right) * 0.5,
				rowIndex: previous ? previous.rowIndex : 0,
			});
		}
		return layout;
	}

	private beginTabDrag(tabId: string, pointerX: number): void {
		if (this.tabs.length <= 1) {
			this.tabDragState = null;
			return;
		}
		const bounds = this.tabButtonBounds.get(tabId) ?? null;
		const pointerOffset = bounds ? pointerX - bounds.left : 0;
		this.tabDragState = {
			tabId,
			pointerOffset,
			startX: pointerX,
			hasDragged: false,
		};
	}

	private updateTabDrag(pointerX: number, pointerY: number): void {
		const state = this.tabDragState;
		if (!state) {
			return;
		}
		const distance = Math.abs(pointerX - state.startX);
		if (!state.hasDragged && distance < constants.TAB_DRAG_ACTIVATION_THRESHOLD) {
			return;
		}
		if (!state.hasDragged) {
			state.hasDragged = true;
			this.resetPointerClickTracking();
		}
		const layout = this.computeTabLayout();
		const currentIndex = layout.findIndex(item => item.id === state.tabId);
		if (currentIndex === -1) {
			return;
		}
		const dragged = layout[currentIndex];
		const pointerLeft = pointerX - state.pointerOffset;
		const pointerCenter = pointerLeft + Math.max(dragged.width, 1) * 0.5;
		const totalTabHeight = this.getTabBarTotalHeight();
		const withinTabBar = pointerY >= this.headerHeight && pointerY < this.headerHeight + totalTabHeight;
		const maxRowIndex = Math.max(0, this.tabBarRowCount - 1);
		const pointerRow = withinTabBar
			? clamp(Math.floor((pointerY - this.headerHeight) / this.tabBarHeight), 0, maxRowIndex)
			: dragged.rowIndex;
		const rowStride = this.viewportWidth + constants.TAB_BUTTON_SPACING * 4;
		const pointerValue = pointerRow * rowStride + pointerCenter;
		let desiredIndex = currentIndex;
		for (let i = 0; i < layout.length; i += 1) {
			const item = layout[i];
			const itemValue = item.rowIndex * rowStride + item.center;
			if (pointerValue > itemValue) {
				desiredIndex = i + 1;
			}
		}
		if (desiredIndex > currentIndex) {
			desiredIndex -= 1;
		}
		if (desiredIndex === currentIndex) {
			return;
		}
		const tabIndex = this.tabs.findIndex(entry => entry.id === state.tabId);
		if (tabIndex === -1) {
			return;
		}
		const removed = this.tabs.splice(tabIndex, 1);
		const tab = removed[0];
		if (!tab) {
			return;
		}
		const targetIndex = clamp(desiredIndex, 0, this.tabs.length);
		this.tabs.splice(targetIndex, 0, tab);
	}

	private endTabDrag(): void {
		if (!this.tabDragState) {
			return;
		}
		this.tabDragState = null;
	}

	private resetEditorContent(): void {
		this.lines = [''];
		this.invalidateVisualLines();
		this.markDiagnosticsDirty();
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
		this.resourceBrowserSelectionIndex = -1;
		// max line width handled by controller
		this.pendingResourceSelectionAssetId = null;
		this.resourcePanelResizing = false;
	}

	private refreshResourcePanelContents(): void {
		// New path owned by ResourcePanelController
		this.resourcePanel.refresh();
		const s = this.resourcePanel.getStateForRender();
		this.resourcePanelResourceCount = s.items.length;
		this.resourceBrowserItems = s.items;
		this.resourceBrowserSelectionIndex = s.selectionIndex;
	}

	private enterResourceViewer(tab: EditorTabDescriptor): void {
		this.closeSearch(false);
		this.closeLineJump(false);
		this.cursorRevealSuspended = false;
		tab.dirty = false;
		// hover state handled by controller; no-op here
		if (!tab.resource) {
			return;
		}
		this.resourceViewerClampScroll(tab.resource);
	}

	// buildResourceBrowserItems removed; ResourcePanelController owns item tree construction

// updateResourceBrowserMetrics removed; controller computes metrics

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

	// getSelectedResourceDescriptor removed; controller + local state provide selection

// computeResourceBrowserMaxHorizontalScroll removed; use controller.computeMaxHScroll()

	// clampResourceBrowserHorizontalScroll removed; use controller.clampHScroll()

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
			executionStopRow: null,
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
			executionStopRow: null,
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
		context.executionStopRow = this.executionStopRow;
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
			this.invalidateVisualLines();
		this.markDiagnosticsDirty();
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
		context.executionStopRow = null;
		this.executionStopRow = null;
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
			if (target.length >= constants.RESOURCE_VIEWER_MAX_LINES - 1) {
				if (target.length === constants.RESOURCE_VIEWER_MAX_LINES - 1) {
					target.push('<content truncated>');
				}
				return;
			}
			target.push(entry);
		}
	}

	private trimResourceViewerLines(lines: string[]): void {
		if (lines.length > constants.RESOURCE_VIEWER_MAX_LINES) {
			lines.length = constants.RESOURCE_VIEWER_MAX_LINES - 1;
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
		const minRatio = constants.RESOURCE_PANEL_MIN_RATIO;
		const minEditorRatio = constants.RESOURCE_PANEL_MIN_EDITOR_RATIO;
		const availableForPanel = Math.max(0, 1 - minEditorRatio);
		const maxRatio = Math.max(minRatio, Math.min(constants.RESOURCE_PANEL_MAX_RATIO, availableForPanel));
		return { min: minRatio, max: maxRatio };
	}

	private clampResourcePanelRatio(ratio: number | null): number {
		const bounds = this.computePanelRatioBounds();
		let resolved = ratio ?? this.defaultResourcePanelRatio();
		if (!Number.isFinite(resolved)) {
			resolved = constants.RESOURCE_PANEL_DEFAULT_RATIO;
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
		const ratio = constants.RESOURCE_PANEL_DEFAULT_RATIO + responsiveness * (constants.RESOURCE_PANEL_MAX_RATIO - constants.RESOURCE_PANEL_DEFAULT_RATIO) * 0.6;
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
		if (!this.resourcePanelVisible) return 0;
		const bounds = this.resourcePanel.getBounds();
		return bounds ? Math.max(0, bounds.right - bounds.left) : 0;
	}

// getResourcePanelBounds removed; use this.resourcePanel.getBounds()

	private isPointerOverResourcePanelDivider(x: number, y: number): boolean {
		if (!this.resourcePanelVisible) {
			return false;
		}
		const bounds = this.resourcePanel.getBounds();
		if (!bounds) {
			return false;
		}
		const margin = constants.RESOURCE_PANEL_DIVIDER_DRAG_MARGIN;
		const left = bounds.right - margin;
		const right = bounds.right + margin;
		return y >= bounds.top && y <= bounds.bottom && x >= left && x <= right;
	}

// resourcePanelLineCapacity removed; use this.resourcePanel.lineCapacity()

	private scrollResourceBrowser(amount: number): void {
		if (!this.resourcePanelVisible) return;
		this.resourcePanel.scrollBy(amount);
		// controller owns scroll; no local mirror required
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
			const paddingX = constants.RESOURCE_PANEL_PADDING_X;
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

	// Bridge wrappers to the ResourcePanelController (temporary during migration)
	private resourceBrowserEnsureSelectionVisible(): void {
		if (!this.resourcePanelVisible) return;
		this.resourcePanel.ensureSelectionVisiblePublic();
		// controller owns scroll; no local mirror required
	}

	private scrollResourceBrowserHorizontal(delta: number): void {
		if (!this.resourcePanelVisible) return;
		const s = this.resourcePanel.getStateForRender();
		this.resourcePanel.setHScroll(s.hscroll + delta);
	}

// moved to ResourcePanelController

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

// moved to ResourcePanelController


	private handleResourceViewerInput(keyboard: KeyboardInput, deltaSeconds: number): void {
		const viewer = this.getActiveResourceViewer();
		if (!viewer) {
			return;
		}
		const ctrlDown = isModifierPressedGlobal(this.playerIndex, 'ControlLeft') || isModifierPressedGlobal(this.playerIndex, 'ControlRight');
		const metaDown = isModifierPressedGlobal(this.playerIndex, 'MetaLeft') || isModifierPressedGlobal(this.playerIndex, 'MetaRight');
		const shiftDown = isModifierPressedGlobal(this.playerIndex, 'ShiftLeft') || isModifierPressedGlobal(this.playerIndex, 'ShiftRight');
		if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyR')) {
			consumeKeyboardKey(keyboard, 'KeyR');
			this.toggleResolutionMode();
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
			const triggered = isKeyJustPressedGlobal(this.playerIndex, entry.code) || this.shouldFireRepeat(keyboard, entry.code, deltaSeconds);
			if (!triggered) {
				continue;
			}
			consumeKeyboardKey(keyboard, entry.code);
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
		// Delegate full drawing to controller and then mirror back minimal state used elsewhere
		this.resourcePanel.draw(api);
		const s = this.resourcePanel.getStateForRender();
		this.resourcePanelVisible = s.visible;
		this.resourceBrowserItems = s.items;
		this.resourcePanelFocused = s.focused;
		this.resourceBrowserSelectionIndex = s.selectionIndex;
		this.resourcePanelResourceCount = s.items.length;
		// max line width handled by controller
	}

	private drawResourceViewer(api: BmsxConsoleApi): void {
		const viewer = this.getActiveResourceViewer();
		if (!viewer) {
			return;
		}
		this.resourceViewerClampScroll(viewer);
		const bounds = this.getCodeAreaBounds();
		const contentLeft = bounds.codeLeft + constants.RESOURCE_PANEL_PADDING_X;
		const capacity = this.resourceViewerTextCapacity(viewer);
		const totalLines = viewer.lines.length;
		const verticalScrollbar = this.scrollbars.viewerVertical;
		const verticalTrack: RectBounds = {
			left: bounds.codeRight - constants.SCROLLBAR_WIDTH,
			top: bounds.codeTop,
			right: bounds.codeRight,
			bottom: bounds.codeBottom,
		};
		verticalScrollbar.layout(verticalTrack, totalLines, Math.max(1, capacity), viewer.scroll);
		const verticalVisible = verticalScrollbar.isVisible();
		viewer.scroll = clamp(verticalScrollbar.getScroll(), 0, Math.max(0, totalLines - capacity));

		api.rectfill(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, constants.COLOR_RESOURCE_VIEWER_BACKGROUND);

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
			drawEditorText(api, this.font, line, contentLeft, fallbackY, constants.COLOR_RESOURCE_VIEWER_TEXT);
		} else {
			drawEditorText(api, this.font, '<empty>', contentLeft, textTop, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
			if (verticalVisible) {
				verticalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
			}
			return;
		}
		const maxScroll = Math.max(0, totalLines - capacity);
		viewer.scroll = clamp(viewer.scroll, 0, maxScroll);
		const end = Math.min(totalLines, Math.floor(viewer.scroll) + capacity);
	if (viewer.lines.length === 0) {
	drawEditorText(api, this.font, '<empty>', contentLeft, textTop, constants.COLOR_RESOURCE_VIEWER_TEXT);
	} else {
		for (let lineIndex = Math.floor(viewer.scroll), drawIndex = 0; lineIndex < end; lineIndex += 1, drawIndex += 1) {
			const line = viewer.lines[lineIndex] ?? '';
			const y = textTop + drawIndex * this.lineHeight;
			if (y >= bounds.codeBottom) {
				break;
			}
			drawEditorText(api, this.font, line, contentLeft, y, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
		}
		if (verticalVisible) {
			verticalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
		}
	}

	private drawReferenceHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
		const matches = this.referenceState.getMatches();
		if (matches.length === 0) {
			return;
		}
		const activeIndex = this.referenceState.getActiveIndex();
		const highlight = entry.hi;
		for (let i = 0; i < matches.length; i += 1) {
			const match = matches[i];
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
			const overlay = i === activeIndex ? constants.REFERENCES_MATCH_ACTIVE_OVERLAY : constants.REFERENCES_MATCH_OVERLAY;
			api.rectfill_color(startX, originY, endX, originY + this.lineHeight, overlay);
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
			const overlay = i === this.searchCurrentIndex ? constants.SEARCH_MATCH_ACTIVE_OVERLAY : constants.SEARCH_MATCH_OVERLAY;
			api.rectfill_color(startX, originY, endX, originY + this.lineHeight, overlay);
		}
	}

private computeCursorScreenInfo(entry: CachedHighlight, textLeft: number, rowTop: number, sliceStartDisplay: number): CursorScreenInfo {
	const highlight = entry.hi;
	const columnToDisplay = highlight.columnToDisplay;
	const clampedColumn = columnToDisplay.length > 0
		? clamp(this.cursorColumn, 0, columnToDisplay.length - 1)
		: 0;
	const cursorDisplayIndex = columnToDisplay.length > 0 ? columnToDisplay[clampedColumn] : 0;
	const limitedDisplayIndex = Math.max(sliceStartDisplay, cursorDisplayIndex);
	const cursorX = textLeft + this.measureRangeFast(entry, sliceStartDisplay, limitedDisplayIndex);
	let cursorWidth = this.charAdvance;
	let baseChar = ' ';
	let baseColor = constants.COLOR_CODE_TEXT;
	if (cursorDisplayIndex < highlight.chars.length) {
		baseChar = highlight.chars[cursorDisplayIndex];
		baseColor = highlight.colors[cursorDisplayIndex];
		const widthIndex = cursorDisplayIndex + 1;
		if (widthIndex < entry.advancePrefix.length) {
			const widthValue = entry.advancePrefix[widthIndex] - entry.advancePrefix[cursorDisplayIndex];
			if (widthValue > 0) {
				cursorWidth = widthValue;
			} else {
				cursorWidth = this.font.advance(baseChar);
			}
		}
	}
	const currentChar = this.currentLine().charAt(this.cursorColumn);
	if (currentChar === '\t') {
		cursorWidth = this.spaceAdvance * constants.TAB_SPACES;
	}
	return {
		row: this.cursorRow,
		column: this.cursorColumn,
		x: cursorX,
		y: rowTop,
		width: cursorWidth,
		height: this.lineHeight,
		baseChar,
		baseColor,
	};
}

private drawCursor(api: BmsxConsoleApi, info: CursorScreenInfo, textX: number): void {
	const cursorX = info.x;
	const cursorY = info.y;
	const caretLeft = Math.floor(Math.max(textX, cursorX - 1));
	const caretRight = Math.max(caretLeft + 1, Math.floor(cursorX + info.width));
	const caretTop = Math.floor(cursorY);
	const caretBottom = caretTop + info.height;
	const problemsPanelHasFocus = this.problemsPanel.isVisible() && this.problemsPanel.isFocused();
	if (this.searchActive || this.lineJumpActive || this.resourcePanelFocused || this.createResourceActive || problemsPanelHasFocus) {
		const innerLeft = caretLeft + 1;
		const innerRight = caretRight - 1;
		const innerTop = caretTop + 1;
		const innerBottom = caretBottom - 1;
		if (innerRight > innerLeft && innerBottom > innerTop) {
			api.rectfill(innerLeft, innerTop, innerRight, innerBottom, constants.COLOR_CODE_BACKGROUND);
		}
		this.drawRectOutlineColor(api, caretLeft, caretTop, caretRight, caretBottom, constants.CARET_COLOR);
		drawEditorColoredText(api, this.font, info.baseChar, [info.baseColor], cursorX, cursorY, info.baseColor);
	} else {
		api.rectfill_color(caretLeft, caretTop, caretRight, caretBottom, constants.CARET_COLOR);
		const caretPaletteIndex = this.resolvePaletteIndex(constants.CARET_COLOR);
		const caretInverseColor = caretPaletteIndex !== null
			? this.invertColorIndex(caretPaletteIndex)
			: this.invertColorIndex(info.baseColor);
		drawEditorColoredText(api, this.font, info.baseChar, [caretInverseColor], cursorX, cursorY, caretInverseColor);
	}
}

// Removed local completion popup and parameter hint drawers; delegated to CompletionController

	private sliceHighlightedLine(highlight: HighlightLine, columnStart: number, columnCount: number): { text: string; colors: number[]; startDisplay: number; endDisplay: number } {
		return this.layout.sliceHighlightedLine(highlight, columnStart, columnCount);
	}

	private getCachedHighlight(row: number): CachedHighlight {
		return this.layout.getCachedHighlight(this.lines, row, this.textVersion);
	}

	protected invalidateLine(row: number): void {
		this.layout.invalidateHighlight(row);
	}

	protected invalidateAllHighlights(): void {
		this.layout.invalidateAllHighlights();
	}

	private measureRangeFast(entry: CachedHighlight, startDisplay: number, endDisplay: number): number {
		return this.layout.measureRangeFast(entry, startDisplay, endDisplay);
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

	protected markDiagnosticsDirty(): void {
		this.diagnosticsDirty = true;
	}

	protected markTextMutated(): void {
		this.dirty = true;
		this.markDiagnosticsDirty();
		this.bumpTextVersion();
		this.clearReferenceHighlights();
		this.updateActiveContextDirtyFlag();
		this.invalidateVisualLines();
		this.handlePostEditMutation();
	}

	protected recordEditContext(kind: 'insert' | 'delete' | 'replace', text: string): void {
		this.pendingEditContext = { kind, text };
	}

	private handlePostEditMutation(): void {
		const editContext = this.pendingEditContext;
		this.pendingEditContext = null;
		this.completion.updateAfterEdit(editContext);
	}

private handleCompletionKeybindings(
	keyboard: KeyboardInput,
	deltaSeconds: number,
	shiftDown: boolean,
	ctrlDown: boolean,
	altDown: boolean,
	metaDown: boolean,
): boolean {
	return this.completion.handleKeybindings(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown, metaDown);
}

	protected onCursorMoved(): void {
		this.completion.onCursorMoved();
	}

	private invalidateVisualLines(): void {
		this.layout.markVisualLinesDirty();
	}

	protected ensureVisualLines(): void {
		this.scrollRow = this.layout.ensureVisualLines({
			lines: this.lines,
			wordWrapEnabled: this.wordWrapEnabled,
			scrollRow: this.scrollRow,
			documentVersion: this.textVersion,
			computeWrapWidth: () => this.computeWrapWidth(),
		});
		if (this.scrollRow < 0) {
			this.scrollRow = 0;
		}
	}

	private computeWrapWidth(): number {
		const resourceWidth = this.resourcePanelVisible ? this.getResourcePanelWidth() : 0;
		const gutterSpace = this.gutterWidth + 2;
		const verticalScrollbarSpace = 0;
		const available = this.viewportWidth - resourceWidth - gutterSpace - verticalScrollbarSpace;
		return Math.max(this.charAdvance, available - 2);
	}

	protected getVisualLineCount(): number {
		this.ensureVisualLines();
		return this.layout.getVisualLineCount();
	}

	protected visualIndexToSegment(index: number): VisualLineSegment | null {
		this.ensureVisualLines();
		return this.layout.visualIndexToSegment(index);
	}

	protected positionToVisualIndex(row: number, column: number): number {
		this.ensureVisualLines();
		const override = this.getCursorVisualOverride(row, column);
		if (override) {
			return override.visualIndex;
		}
		return this.layout.positionToVisualIndex(this.lines, row, column);
	}

	protected setCursorFromVisualIndex(visualIndex: number, desiredColumnHint?: number, desiredOffsetHint?: number): void {
		this.ensureVisualLines();
		this.clearCursorVisualOverride();
		const visualLines = this.layout.getVisualLines();
		if (visualLines.length === 0) {
			this.cursorRow = 0;
			this.cursorColumn = 0;
			this.updateDesiredColumn();
			return;
		}
		const clampedIndex = clamp(visualIndex, 0, visualLines.length - 1);
		const segment = visualLines[clampedIndex];
		if (!segment) {
			return;
		}
		const entry = this.getCachedHighlight(segment.row);
		const highlight = entry.hi;
		const line = this.lines[segment.row] ?? '';
		const hasDesiredHint = desiredColumnHint !== undefined;
		const hasOffsetHint = desiredOffsetHint !== undefined;
		let targetColumn = hasDesiredHint ? desiredColumnHint! : this.cursorColumn;
		if (this.wordWrapEnabled) {
			const segmentEndColumn = Math.max(segment.endColumn, segment.startColumn);
			const segmentDisplayStart = this.columnToDisplay(highlight, segment.startColumn);
			const segmentDisplayEnd = this.columnToDisplay(highlight, segmentEndColumn);
			const segmentWidth = Math.max(0, segmentDisplayEnd - segmentDisplayStart);
			if (hasOffsetHint) {
				const clampedOffset = clamp(Math.round(desiredOffsetHint!), 0, segmentWidth);
				const targetDisplay = clamp(segmentDisplayStart + clampedOffset, segmentDisplayStart, segmentDisplayEnd);
				let columnFromOffset = entry.displayToColumn[targetDisplay];
				if (columnFromOffset === undefined) {
					columnFromOffset = this.lines[segment.row].length;
				}
				targetColumn = clamp(columnFromOffset, segment.startColumn, segmentEndColumn);
			} else {
				targetColumn = clamp(Math.round(targetColumn), segment.startColumn, segmentEndColumn);
				if (targetColumn > line.length) {
					targetColumn = line.length;
				}
			}
		} else {
			targetColumn = clamp(Math.round(targetColumn), 0, line.length);
		}
		this.cursorRow = segment.row;
		this.cursorColumn = clamp(targetColumn, 0, line.length);
		const cursorDisplay = this.columnToDisplay(highlight, this.cursorColumn);
		if (this.wordWrapEnabled) {
			const hasNextSegmentSameRow = (clampedIndex + 1 < visualLines.length)
				&& visualLines[clampedIndex + 1].row === segment.row;
			const segmentEnd = Math.max(segment.endColumn, segment.startColumn);
			if (this.cursorColumn < segment.startColumn) {
				this.cursorColumn = segment.startColumn;
			}
			if (segmentEnd >= segment.startColumn && this.cursorColumn > segmentEnd) {
				this.cursorColumn = Math.min(segmentEnd, line.length);
			}
			if (hasNextSegmentSameRow && this.cursorColumn >= segmentEnd) {
				this.cursorColumn = Math.max(segment.startColumn, segmentEnd - 1);
			}
			const segmentDisplayStart = this.columnToDisplay(highlight, segment.startColumn);
			this.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
		} else {
			this.desiredDisplayOffset = cursorDisplay;
		}
		if (hasDesiredHint) {
			this.desiredColumn = Math.max(0, desiredColumnHint!);
		} else {
			this.desiredColumn = this.cursorColumn;
		}
		if (this.desiredDisplayOffset < 0) {
			this.desiredDisplayOffset = 0;
		}
	}


	private drawInlineCaret(
		api: BmsxConsoleApi,
		field: InlineTextField,
		left: number,
		top: number,
		right: number,
		bottom: number,
		cursorX: number,
		active: boolean,
		caretColor: { r: number; g: number; b: number; a: number } = constants.CARET_COLOR,
		baseTextColor: number = constants.COLOR_STATUS_TEXT,
	): void {
		if (!this.cursorVisible) {
			return;
		}
		if (active) {
			api.rectfill_color(left, top, right, bottom, caretColor);
			const caretIndex = this.resolvePaletteIndex(caretColor);
			const inverseColor = caretIndex !== null
				? this.invertColorIndex(caretIndex)
				: this.invertColorIndex(baseTextColor);
		const glyph = field.cursor < field.text.length ? field.text.charAt(field.cursor) : ' ';
		drawEditorText(api, this.font, glyph.length > 0 ? glyph : ' ', cursorX, top, inverseColor);
		return;
	}
		this.drawRectOutlineColor(api, left, top, right, bottom, caretColor);
	}

	private drawRectOutlineColor(api: BmsxConsoleApi, left: number, top: number, right: number, bottom: number, color: { r: number; g: number; b: number; a: number }): void {
		if (right <= left || bottom <= top) {
			return;
		}
		api.rectfill_color(left, top, right, top + 1, color);
		api.rectfill_color(left, bottom - 1, right, bottom, color);
		api.rectfill_color(left, top, left + 1, bottom, color);
		api.rectfill_color(right - 1, top, right, bottom, color);
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
	const host = {
		viewportWidth: this.viewportWidth,
		viewportHeight: this.viewportHeight,
		bottomMargin: this.statusAreaHeight(),
		lineHeight: this.lineHeight,
		measureText: (text: string) => this.measureText(text),
		drawText: (api2: BmsxConsoleApi, text: string, x: number, y: number, color: number) => drawEditorText(api2, this.font, text, x, y, color),
            truncateTextToWidth: (text: string, maxWidth: number) => this.truncateTextToWidth(text, maxWidth),
            message: this.message,
            getStatusMessageLines: () => this.getStatusMessageLines(),
            symbolSearchVisible: this.symbolSearchVisible,
            getActiveSymbolSearchMatch: () => this.getActiveSymbolSearchMatch(),
            resourcePanelVisible: this.resourcePanelVisible,
            resourcePanelFilterMode: this.resourcePanel.getFilterMode(),
            resourcePanelResourceCount: this.resourcePanelResourceCount,
            isResourceViewActive: () => this.isResourceViewActive(),
            getActiveResourceViewer: () => this.getActiveResourceViewer(),
            metadata: this.metadata,
            statusLeftInfo: this.buildStatusLeftInfo(),
            problemsPanelFocused: this.problemsPanel.isVisible() && this.problemsPanel.isFocused(),
        };
        renderStatusBar(api, host);
    }

    private buildStatusLeftInfo(): string {
        if (this.problemsPanel.isVisible()) {
            if (this.problemsPanel.isFocused()) {
            const sel = this.problemsPanel.getSelectedDiagnostic();
            if (sel) {
                const file = sel.sourceLabel ?? (sel.chunkName ?? '');
                const parts: string[] = [];
                parts.push(`Ln ${sel.row + 1}, Col ${sel.startColumn + 1}`);
                if (file.length > 0) parts.push(file);
                return parts.join(' • ');
            }
            }
            // When Problems panel is visible but not focused or no selection, don't render default editor position
            return '';
        }
        return `LINE ${this.cursorRow + 1}/${this.lines.length} COL ${this.cursorColumn + 1}`;
    }

	private drawProblemsPanel(api: BmsxConsoleApi): void {
		const bounds = this.getProblemsPanelBounds();
		if (!bounds) {
			return;
		}
		this.problemsPanel.draw(api, bounds);
	}

	private getProblemsPanelBounds(): RectBounds | null {
		const panelHeight = this.getVisibleProblemsPanelHeight();
		if (panelHeight <= 0) {
			return null;
		}
		const statusHeight = this.statusAreaHeight();
		const bottom = this.viewportHeight - statusHeight;
		const top = bottom - panelHeight;
		if (bottom <= top) {
			return null;
		}
		return { left: 0, top, right: this.viewportWidth, bottom };
	}

	private isPointerOverProblemsPanelDivider(x: number, y: number): boolean {
		const bounds = this.getProblemsPanelBounds();
		if (!bounds) {
			return false;
		}
		const margin = constants.PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN;
		const dividerTop = bounds.top;
		return y >= dividerTop - margin && y <= dividerTop + margin && x >= bounds.left && x <= bounds.right;
	}

	private setProblemsPanelHeightFromViewportY(viewportY: number): void {
		const statusHeight = this.statusAreaHeight();
		const bottom = this.viewportHeight - statusHeight;
		const minTop = this.headerHeight + this.getTabBarTotalHeight() + 1;
		const headerH = this.lineHeight + constants.PROBLEMS_PANEL_HEADER_PADDING_Y * 2;
		const minContent = Math.max(1, constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS) * this.lineHeight;
		const minHeight = headerH + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2 + minContent;
		const maxTop = Math.max(minTop, bottom - minHeight);
		const top = clamp(viewportY, minTop, maxTop);
		const height = clamp(bottom - top, minHeight, Math.max(minHeight, bottom - minTop));
		this.problemsPanel.setFixedHeightPx(height);
	}

	private drawActionPromptOverlay(api: BmsxConsoleApi): void {
		const prompt = this.pendingActionPrompt;
		if (!prompt) {
			return;
		}
		api.rectfill_color(0, 0, this.viewportWidth, this.viewportHeight, constants.ACTION_OVERLAY_COLOR);

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
		const primaryWidth = this.measureText(primaryLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
		const secondaryWidth = this.measureText(secondaryLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
		const cancelWidth = this.measureText(cancelLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
		const buttonSpacing = constants.HEADER_BUTTON_SPACING;
		const buttonRowWidth = primaryWidth + secondaryWidth + cancelWidth + buttonSpacing * 2;
		const paddingX = 12;
		const paddingY = 12;
		const buttonHeight = this.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
		const messageSpacing = this.lineHeight + 2;
		const dialogWidth = Math.max(maxMessageWidth + paddingX * 2, buttonRowWidth + paddingX * 2);
		const dialogHeight = paddingY * 2 + messageLines.length * messageSpacing + 6 + buttonHeight;
		const left = Math.max(4, Math.floor((this.viewportWidth - dialogWidth) / 2));
		const top = Math.max(4, Math.floor((this.viewportHeight - dialogHeight) / 2));
		const right = left + dialogWidth;
		const bottom = top + dialogHeight;

		api.rectfill(left, top, right, bottom, constants.ACTION_DIALOG_BACKGROUND_COLOR);
		api.rect(left, top, right, bottom, constants.ACTION_DIALOG_BORDER_COLOR);

		let textY = top + paddingY;
		const textX = left + paddingX;
	for (let i = 0; i < messageLines.length; i++) {
		drawEditorText(api, this.font, messageLines[i], textX, textY, constants.ACTION_DIALOG_TEXT_COLOR);
		textY += messageSpacing;
	}

		const buttonY = bottom - paddingY - buttonHeight;
		let buttonX = left + paddingX;
		const saveBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + primaryWidth, bottom: buttonY + buttonHeight };
		api.rectfill(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, constants.ACTION_BUTTON_BACKGROUND);
		api.rect(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(api, this.font, primaryLabel, saveBounds.left + constants.HEADER_BUTTON_PADDING_X, saveBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.ACTION_BUTTON_TEXT);
		this.actionPromptButtons.saveAndContinue = saveBounds;
		buttonX = saveBounds.right + buttonSpacing;

		const continueBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + secondaryWidth, bottom: buttonY + buttonHeight };
		api.rectfill(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, constants.ACTION_BUTTON_BACKGROUND);
		api.rect(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(api, this.font, secondaryLabel, continueBounds.left + constants.HEADER_BUTTON_PADDING_X, continueBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.ACTION_BUTTON_TEXT);
		this.actionPromptButtons.continue = continueBounds;
		buttonX = continueBounds.right + buttonSpacing;

		const cancelBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + cancelWidth, bottom: buttonY + buttonHeight };
		api.rectfill(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND);
		api.rect(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
	drawEditorText(api, this.font, cancelLabel, cancelBounds.left + constants.HEADER_BUTTON_PADDING_X, cancelBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.COLOR_HEADER_BUTTON_TEXT);
		this.actionPromptButtons.cancel = cancelBounds;
	}

	private columnToDisplay(highlight: HighlightLine, column: number): number {
		return this.layout.columnToDisplay(highlight, column);
	}

	private resolvePaletteIndex(color: { r: number; g: number; b: number; a: number }): number | null {
		const index = Msx1Colors.indexOf(color);
		return index === -1 ? null : index;
	}

	private invertColorIndex(colorIndex: number): number {
		const color = Msx1Colors[colorIndex];
		if (!color) {
			return constants.COLOR_CODE_TEXT;
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
		if (typeof runtime.isLuaRuntimeFailed !== 'function') {
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
		this.showMessage(`${fallbackMessage}: ${message}`, constants.COLOR_STATUS_ERROR, 4.0);
	}

	private truncateTextToWidth(text: string, maxWidth: number): string {
		return truncateTextToWidthExternal(text, maxWidth, (ch) => this.font.advance(ch), this.spaceAdvance);
	}

	private measureText(text: string): number {
		return measureTextGeneric(text, (ch) => this.font.advance(ch), this.spaceAdvance);
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
		this.ensureVisualLines();
		const rows = this.visibleRowCount();
		const totalVisual = this.getVisualLineCount();
		const cursorVisualIndex = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
		const maxScroll = Math.max(0, totalVisual - rows);
		if (rows <= 1) {
			this.scrollRow = clamp(cursorVisualIndex, 0, maxScroll);
			return;
		}
		let target = cursorVisualIndex - Math.floor(rows / 2);
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

		this.ensureVisualLines();
		const rows = this.visibleRowCount();
		const totalVisual = this.getVisualLineCount();
		const cursorVisualIndex = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);

		if (cursorVisualIndex < this.scrollRow) {
			this.scrollRow = cursorVisualIndex;
		}
		if (cursorVisualIndex >= this.scrollRow + rows) {
			this.scrollRow = cursorVisualIndex - rows + 1;
		}
		const maxScrollRow = Math.max(0, totalVisual - rows);
		this.scrollRow = clamp(this.scrollRow, 0, maxScrollRow);

		if (this.wordWrapEnabled) {
			this.scrollColumn = 0;
			return;
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

	protected visibleRowCount(): number {
		return this.cachedVisibleRowCount > 0 ? this.cachedVisibleRowCount : 1;
	}

	protected visibleColumnCount(): number {
		return this.cachedVisibleColumnCount > 0 ? this.cachedVisibleColumnCount : 1;
	}

	protected resetBlink(): void {
		this.blinkTimer = 0;
		this.cursorVisible = true;
	}

	private shouldFireRepeat(keyboard: KeyboardInput, code: string, deltaSeconds: number): boolean {
		return this.input.shouldRepeatPublic(keyboard, code, deltaSeconds);
	}

// Input overrides moved to InputController
}
