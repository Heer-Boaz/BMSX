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
	ConsoleLuaMemberCompletion,
	ConsoleLuaMemberCompletionRequest,
	ConsoleLuaResourceCreationRequest,
	ConsoleLuaSymbolEntry,
	ConsoleResourceDescriptor,
} from '../types.ts';
import { ConsoleEditorFont } from '../editor_font';
import { DEFAULT_CONSOLE_FONT_VARIANT, type ConsoleFontVariant } from '../font';
import { drawEditorColoredText, drawEditorText } from './text_renderer';
import { Msx1Colors } from '../../systems/msx.ts';
import { SpriteComponent } from '../../component/sprite_component';
import { renderCodeArea } from './render_code_area';
import { clamp } from '../../utils/utils';
import { CHARACTER_CODES } from './character_map';
import * as constants from './constants';
// Intellisense data is handled by CompletionController
import { CompletionController } from './completion_controller';
import { ProblemsPanelController } from './problems_panel';
import { computeAggregatedEditorDiagnostics, type DiagnosticContextInput, type DiagnosticProviders } from './diagnostics';
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
import { renderErrorOverlayText } from './render_error_overlay';
import {
	cloneRuntimeErrorDetails,
	rebuildRuntimeErrorOverlayView
} from './runtime_error_overlay_model';
import {
	computeRuntimeErrorOverlayLayout,
	drawRuntimeErrorOverlay as drawRuntimeErrorOverlayBubble,
	evaluateRuntimeErrorOverlayClick,
	findRuntimeErrorOverlayLineAtPosition,
	type RuntimeErrorOverlayLayoutHost,
	type RuntimeErrorOverlayDrawOptions
} from './runtime_error_overlay_view';
// Resource panel rendering is handled via ResourcePanelController
import { ResourcePanelController } from './resource_panel_controller';
import { InputController } from './input_controller';
import { ConsoleCartEditorTextOps } from './console_cart_editor_textops';
import { ConsoleCodeLayout } from './code_layout';
import { LuaSemanticWorkspace } from './semantic_workspace.ts';
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
	RepeatEntry,
	ResourceBrowserItem,
	ResourceCatalogEntry,
	ResourceSearchResult,
	ResourceViewerState,
	RuntimeErrorOverlay,
	RuntimeErrorDetails,
	RuntimeErrorStackFrame,
	ScrollbarKind,
	SearchMatch,
	GlobalSearchMatch,
	SymbolCatalogEntry,
	SymbolSearchResult,
	TabDragState,
	TopBarButtonId,
	VisualLineSegment,
	LuaCompletionItem,
} from './types';
import type { RectBounds } from '../../rompack/rompack.ts';
import type { TimerHandle } from '../../platform/platform';
import { ReferenceState, resolveReferenceLookup, type ReferenceMatchInfo } from './reference_navigation.ts';
import {
	buildReferenceCatalogForExpression as buildProjectReferenceCatalog,
	computeSourceLabel,
	resolveDefinitionLocationForExpression,
	type ProjectReferenceEnvironment,
	filterReferenceCatalog,
	type ReferenceCatalogEntry,
	type ReferenceSymbolEntry,
} from './reference_sources';

type NavigationHistoryEntry = {
	contextId: string;
	assetId: string | null;
	chunkName: string | null;
	path: string | null;
	row: number;
	column: number;
};
import { RenameController, type RenameCommitPayload, type RenameCommitResult } from './rename_controller';
import { planRenameLineEdits } from './rename_apply';
import { CrossFileRenameManager, type CrossFileRenameDependencies } from './rename_cross_file';
import {
	consumeKey as consumeKeyboardKey,
	getKeyboardButtonState,
	isKeyJustPressed as isKeyJustPressedGlobal,
	isKeyTyped as isKeyTypedGlobal,
	isModifierPressed as isModifierPressedGlobal,
	shouldAcceptKeyPress as shouldAcceptKeyPressGlobal,
} from './input_helpers';
import type { LuaDefinitionInfo, LuaSourceRange } from '../../lua/ast.ts';

export type ConsoleEditorShortcutContext = {
	ctrlDown: boolean;
	shiftDown: boolean;
	altDown: boolean;
	metaDown: boolean;
	inlineFieldFocused: boolean;
	resourcePanelFocused: boolean;
	codeTabActive: boolean;
};

type DiagnosticsCacheEntry = {
	contextId: string;
	chunkName: string | null;
	diagnostics: EditorDiagnostic[];
};

type BackgroundTask = () => boolean;

type SearchComputationJob = {
	query: string;
	version: number;
	nextRow: number;
	matches: SearchMatch[];
	firstMatchAfterCursor: number;
	cursorRow: number;
	cursorColumn: number;
};

type GlobalSearchJob = {
	query: string;
	descriptors: ConsoleResourceDescriptor[];
	descriptorIndex: number;
	currentLines: string[] | null;
	nextRow: number;
	matches: GlobalSearchMatch[];
	limitHit: boolean;
};

const EDITOR_TOGGLE_KEY = 'F1';
const ESCAPE_KEY = 'Escape';
const EDITOR_TOGGLE_GAMEPAD_BUTTONS: readonly BGamepadButton[] = ['select', 'start'];
const GLOBAL_SEARCH_RESULT_LIMIT = constants.SEARCH_MAX_RESULTS * 4;

// Intellisense data is handled by CompletionController
let metadata: BmsxConsoleMetadata;
let fontVariant: ConsoleFontVariant;
let loadSourceFn: () => string;
let saveSourceFn: (source: string) => Promise<void>;
let loadLuaResourceFn: (assetId: string) => string;
let saveLuaResourceFn: (assetId: string, source: string) => Promise<void>;
let createLuaResourceFn: (request: ConsoleLuaResourceCreationRequest) => Promise<ConsoleResourceDescriptor>;
let listResourcesFn: () => ConsoleResourceDescriptor[];
let inspectLuaExpressionFn: (request: ConsoleLuaHoverRequest) => ConsoleLuaHoverResult | null;
let listLuaObjectMembersFn: (request: ConsoleLuaMemberCompletionRequest) => ConsoleLuaMemberCompletion[];
let listLuaModuleSymbolsFn: (moduleName: string) => ConsoleLuaSymbolEntry[];
let listLuaSymbolsFn: (assetId: string | null, chunkName: string | null) => ConsoleLuaSymbolEntry[];
let listGlobalLuaSymbolsFn: () => ConsoleLuaSymbolEntry[];
let listBuiltinLuaFunctionsFn: () => ConsoleLuaBuiltinDescriptor[];
let primaryAssetId: string | null;
let builtinIdentifierCache: { key: string; set: ReadonlySet<string> } | null = null;
let hoverTooltip: CodeHoverTooltip | null = null;
let lastPointerSnapshot: PointerSnapshot | null = null;
let lastInspectorResult: ConsoleLuaHoverResult | null = null;
let inspectorRequestFailed = false;
let gotoHoverHighlight: { row: number; startColumn: number; endColumn: number; expression: string } | null = null;
let viewportWidth: number;
let viewportHeight: number;
let font: ConsoleEditorFont;
let lineHeight: number;
let charAdvance: number;
let spaceAdvance: number;
let gutterWidth: number;
let headerHeight: number;
let tabBarHeight: number;
let tabBarRowCount = 1;
let baseBottomMargin: number;
const repeatState: Map<string, RepeatEntry> = new Map();
const message: MessageState = { text: '', color: constants.COLOR_STATUS_TEXT, timer: 0, visible: false };
let deferredMessageDuration: number | null = null;
let runtimeErrorOverlay: RuntimeErrorOverlay | null = null;
let executionStopRow: number | null = null;
let clockNow: () => number;
let problemsPanel: ProblemsPanelController;
let problemsPanelResizing = false;
let diagnostics: EditorDiagnostic[] = [];
let diagnosticsByRow: Map<number, EditorDiagnostic[]> = new Map();
let diagnosticsDirty = true;
const diagnosticsDebounceMs = 200;
let diagnosticsCache: Map<string, DiagnosticsCacheEntry> = new Map();
let dirtyDiagnosticContexts: Set<string> = new Set();
let diagnosticsDueAtMs: number | null = null;
let diagnosticsComputationScheduled = false;
const codeTabContexts: Map<string, CodeTabContext> = new Map();
let activeCodeTabContextId: string | null = null;
let entryTabId: string | null = null;
const captureKeys: string[] = [...new Set([
	EDITOR_TOGGLE_KEY,
	ESCAPE_KEY,
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
const topBarButtonBounds: Record<TopBarButtonId, RectBounds> = {
	resume: { left: 0, top: 0, right: 0, bottom: 0 },
	reboot: { left: 0, top: 0, right: 0, bottom: 0 },
	save: { left: 0, top: 0, right: 0, bottom: 0 },
	resources: { left: 0, top: 0, right: 0, bottom: 0 },
	problems: { left: 0, top: 0, right: 0, bottom: 0 },
	filter: { left: 0, top: 0, right: 0, bottom: 0 },
	resolution: { left: 0, top: 0, right: 0, bottom: 0 },
	wrap: { left: 0, top: 0, right: 0, bottom: 0 },
};
const tabButtonBounds: Map<string, RectBounds> = new Map();
const tabCloseButtonBounds: Map<string, RectBounds> = new Map();
let resourceViewerSpriteId: string | null = null;
let resourceViewerSpriteAsset: string | null = null;
let resourceViewerSpriteScale = 1;
const actionPromptButtons: { saveAndContinue: RectBounds | null; continue: RectBounds; cancel: RectBounds } = {
	saveAndContinue: null,
	continue: { left: 0, top: 0, right: 0, bottom: 0 },
	cancel: { left: 0, top: 0, right: 0, bottom: 0 },
};
let pendingActionPrompt: PendingActionPrompt | null = null;
let active = false;
let blinkTimer = 0;
let cursorVisible = true;
let warnNonMonospace = false;
let pointerSelecting = false;
let pointerPrimaryWasPressed = false;
let pointerAuxWasPressed = false;
let searchField: InlineTextField;
let symbolSearchField: InlineTextField;
let resourceSearchField: InlineTextField;
let lineJumpField: InlineTextField;
let createResourceField: InlineTextField;
let inlineFieldMetricsRef: InlineFieldMetrics;
let scrollbars: Record<ScrollbarKind, ConsoleScrollbar>;
let scrollbarController: ScrollbarController;
let input: InputController;
let toggleInputLatch = false;
let windowFocused = true;
let pendingWindowFocused = true;
let disposeVisibilityListener: (() => void) | null = null;
let disposeWindowEventListeners: (() => void) | null = null;
let lastPointerClickTimeMs = 0;
let lastPointerClickRow = -1;
let lastPointerClickColumn = -1;
let tabHoverId: string | null = null;
let tabDragState: TabDragState | null = null;
let crtOptionsSnapshot: CrtOptionsSnapshot | null = null;
let resolutionMode: EditorResolutionMode = 'viewport';
let cursorRevealSuspended = false;
let searchActive = false;
let searchVisible = false;
let searchQuery = '';
let symbolSearchQuery = '';
let resourceSearchQuery = '';
// Completion session state is fully handled by CompletionController
let pendingEditContext: EditContext | null = null;
let cursorScreenInfo: CursorScreenInfo | null = null;
// parameter hints managed by completion controller
let lineJumpActive = false;
let symbolSearchActive = false;
let symbolSearchVisible = false;
let symbolSearchGlobal = false;
let symbolSearchMode: 'symbols' | 'references' = 'symbols';
let resourceSearchActive = false;
let resourceSearchVisible = false;
let lineJumpVisible = false;
let lineJumpValue = '';
let createResourceActive = false;
let createResourceVisible = false;
let createResourcePath = '';
let createResourceError: string | null = null;
let createResourceWorking = false;
let lastCreateResourceDirectory: string | null = null;
// completion session auto-trigger handled by completion controller
let symbolCatalog: SymbolCatalogEntry[] = [];
let referenceCatalog: ReferenceCatalogEntry[] = [];
let symbolCatalogContext: { scope: 'local' | 'global'; assetId: string | null; chunkName: string | null } | null = null;
let symbolSearchMatches: SymbolSearchResult[] = [];
let symbolSearchSelectionIndex = -1;
let symbolSearchDisplayOffset = 0;
let symbolSearchHoverIndex = -1;
let resourceCatalog: ResourceCatalogEntry[] = [];
let resourceSearchMatches: ResourceSearchResult[] = [];
let resourceSearchSelectionIndex = -1;
let resourceSearchDisplayOffset = 0;
let resourceSearchHoverIndex = -1;
let searchMatches: SearchMatch[] = [];
let searchCurrentIndex = -1;
let searchJob: SearchComputationJob | null = null;
let searchDisplayOffset = 0;
let searchHoverIndex = -1;
let searchScope: 'local' | 'global' = 'local';
let globalSearchMatches: GlobalSearchMatch[] = [];
let globalSearchJob: GlobalSearchJob | null = null;
const backgroundTasks: Array<() => boolean> = [];
let backgroundTaskHandle: TimerHandle | null = null;
const backgroundTaskBudgetMs = 2.0;
let diagnosticsTaskPending = false;
let lastReportedSemanticError: string | null = null;
const referenceState: ReferenceState = new ReferenceState();
let textVersion = 0;
let saveGeneration = 0;
let appliedGeneration = 0;
let lastSavedSource = '';
let tabs: EditorTabDescriptor[] = [];
let activeTabId: string | null = null;
let resourceBrowserItems: ResourceBrowserItem[] = [];
let resourceBrowserSelectionIndex = -1;
// removed legacy hover field; hover state is owned by ResourcePanelController
let resourcePanelVisible = false;
let resourcePanelFocused = false;
let resourcePanelResourceCount = 0;
let pendingResourceSelectionAssetId: string | null = null;
let resourcePanelWidthRatio: number | null = null;
let resourcePanelResizing = false;
// max line width computed by ResourcePanelController
let resourcePanel: ResourcePanelController;
let renameController: RenameController;
let semanticWorkspace: LuaSemanticWorkspace = new LuaSemanticWorkspace();
let layout: ConsoleCodeLayout;
let codeVerticalScrollbarVisible = false;
let codeHorizontalScrollbarVisible = false;
let cachedVisibleRowCount = 1;
let cachedVisibleColumnCount = 1;
let dimCrtInEditor: boolean = false; // Default value; can be changed via settings
let wordWrapEnabled = true;
let lastPointerRowResolution: { visualIndex: number; segment: VisualLineSegment | null } | null = null;
let completion: CompletionController;
const NAVIGATION_HISTORY_LIMIT = 64;
const navigationHistory = {
	back: [] as NavigationHistoryEntry[],
	forward: [] as NavigationHistoryEntry[],
	current: null as NavigationHistoryEntry | null,
};
let navigationCaptureSuspended = false;

const EMPTY_DIAGNOSTICS: EditorDiagnostic[] = [];
let customClipboard: string | null = null;

function activeSearchMatchCount(): number {
	return searchScope === 'global' ? globalSearchMatches.length : searchMatches.length;
}

function searchPageSize(): number {
	return constants.SEARCH_MAX_RESULTS;
}

function computeSearchPageStats(): { total: number; offset: number; visible: number } {
	const total = searchVisible ? activeSearchMatchCount() : 0;
	if (total <= 0) {
		searchDisplayOffset = 0;
		return { total: 0, offset: 0, visible: 0 };
	}
	const pageSize = searchPageSize();
	const maxOffset = Math.max(0, total - 1);
	searchDisplayOffset = clamp(searchDisplayOffset, 0, maxOffset);
	const remaining = total - searchDisplayOffset;
	const visible = Math.min(pageSize, remaining);
	return { total, offset: searchDisplayOffset, visible };
}

function searchVisibleResultCount(): number {
	return computeSearchPageStats().visible;
}

function searchResultEntryHeight(): number {
	return lineHeight * 2;
}

function isResourceSearchCompactMode(): boolean {
	return viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

function resourceSearchEntryHeight(): number {
	return isResourceSearchCompactMode() ? lineHeight * 2 : lineHeight;
}

function resourceSearchPageSize(): number {
	return isResourceSearchCompactMode() ? constants.QUICK_OPEN_COMPACT_MAX_RESULTS : constants.QUICK_OPEN_MAX_RESULTS;
}

function resourceSearchWindowCapacity(): number {
	return resourceSearchVisible ? resourceSearchPageSize() : 0;
}

function resourceSearchVisibleResultCount(): number {
	if (!resourceSearchVisible) {
		return 0;
	}
	const remaining = Math.max(0, resourceSearchMatches.length - resourceSearchDisplayOffset);
	const capacity = resourceSearchWindowCapacity();
	if (capacity <= 0) {
		return remaining;
	}
	return Math.min(remaining, capacity);
}

function isSymbolSearchCompactMode(): boolean {
	return viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

function symbolSearchEntryHeight(): number {
	if (symbolSearchMode === 'references') {
		return lineHeight * 2;
	}
	return symbolSearchGlobal && isSymbolSearchCompactMode() ? lineHeight * 2 : lineHeight;
}

function symbolSearchPageSize(): number {
	if (symbolSearchMode === 'references') {
		return constants.REFERENCE_SEARCH_MAX_RESULTS;
	}
	if (!symbolSearchGlobal) {
		return constants.SYMBOL_SEARCH_MAX_RESULTS;
	}
	return isSymbolSearchCompactMode() ? constants.SYMBOL_SEARCH_COMPACT_MAX_RESULTS : constants.SYMBOL_SEARCH_MAX_RESULTS;
}

function symbolSearchVisibleResultCount(): number {
	if (!symbolSearchVisible) {
		return 0;
	}
	const remaining = Math.max(0, symbolSearchMatches.length - symbolSearchDisplayOffset);
	const maxResults = symbolSearchPageSize();
	return Math.min(remaining, maxResults);
}

function symbolCatalogDedupKey(entry: ConsoleLuaSymbolEntry): string {
	const { location, kind, name } = entry;
	const chunkName = location.chunkName ?? '';
	const normalizedPath = location.path ? location.path.replace(/\\/g, '/') : '';
	const assetId = location.assetId ?? '';
	const locationKey = normalizedPath.length > 0
		? normalizedPath
		: (assetId.length > 0 ? assetId : chunkName);
	const startLine = location.range.startLine;
	const startColumn = location.range.startColumn;
	const endLine = location.range.endLine;
	const endColumn = location.range.endColumn;
	return `${kind}|${name}|${locationKey}|${startLine}:${startColumn}|${endLine}:${endColumn}`;
}

export class ConsoleCartEditor extends ConsoleCartEditorTextOps {
	protected readonly playerIndex: number;

	constructor(options: ConsoleEditorOptions) {
		super();
		this.playerIndex = options.playerIndex;
		metadata = options.metadata;
		fontVariant = options.fontVariant ?? DEFAULT_CONSOLE_FONT_VARIANT;
		loadSourceFn = options.loadSource;
		saveSourceFn = options.saveSource;
		listResourcesFn = options.listResources;
		loadLuaResourceFn = options.loadLuaResource;
		saveLuaResourceFn = options.saveLuaResource;
		createLuaResourceFn = options.createLuaResource;
		inspectLuaExpressionFn = options.inspectLuaExpression;
		listLuaObjectMembersFn = options.listLuaObjectMembers;
		listLuaModuleSymbolsFn = options.listLuaModuleSymbols;
		listLuaSymbolsFn = options.listLuaSymbols;
		listGlobalLuaSymbolsFn = options.listGlobalLuaSymbols;
		listBuiltinLuaFunctionsFn = options.listBuiltinLuaFunctions;
		primaryAssetId = options.primaryAssetId;
		if ($.debug) {
			listResourcesFn();
		}
		viewportWidth = options.viewport.width;
		viewportHeight = options.viewport.height;
		font = new ConsoleEditorFont(fontVariant);
		clockNow = $.platform.clock.now;
		searchField = createInlineTextField();
		symbolSearchField = createInlineTextField();
		resourceSearchField = createInlineTextField();
		lineJumpField = createInlineTextField();
		createResourceField = createInlineTextField();
		this.applySearchFieldText(searchQuery, true);
		this.applySymbolSearchFieldText(symbolSearchQuery, true);
		this.applyResourceSearchFieldText(resourceSearchQuery, true);
		this.applyLineJumpFieldText(lineJumpValue, true);
		this.applyCreateResourceFieldText(createResourcePath, true);
		lineHeight = font.lineHeight();
		charAdvance = font.advance('M');
		spaceAdvance = font.advance(' ');
		layout = new ConsoleCodeLayout(font, semanticWorkspace, {
			clockNow: clockNow,
			getBuiltinIdentifiers: () => this.getBuiltinIdentifierSet(),
		});
		inlineFieldMetricsRef = {
			measureText: (text: string) => this.measureText(text),
			advanceChar: (ch: string) => font.advance(ch),
			spaceAdvance: spaceAdvance,
			tabSpaces: constants.TAB_SPACES,
		};
		gutterWidth = 2;
		const primaryBarHeight = lineHeight + 4;
		headerHeight = primaryBarHeight;
		tabBarHeight = lineHeight + 3;
		baseBottomMargin = lineHeight + 6;
		scrollbars = {
			codeVertical: new ConsoleScrollbar('codeVertical', 'vertical'),
			codeHorizontal: new ConsoleScrollbar('codeHorizontal', 'horizontal'),
			resourceVertical: new ConsoleScrollbar('resourceVertical', 'vertical'),
			resourceHorizontal: new ConsoleScrollbar('resourceHorizontal', 'horizontal'),
			viewerVertical: new ConsoleScrollbar('viewerVertical', 'vertical'),
		};
		scrollbarController = new ScrollbarController(scrollbars as any);
		// Initialize resource panel controller
		resourcePanel = new ResourcePanelController({
			getViewportWidth: () => viewportWidth,
			getViewportHeight: () => viewportHeight,
			getBottomMargin: () => this.bottomMargin,
			codeViewportTop: () => this.codeViewportTop(),
			lineHeight: lineHeight,
			charAdvance: charAdvance,
			measureText: (t) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
			drawColoredText: (a, t, colors, x, y) => drawEditorColoredText(a, font, t, colors, x, y, constants.COLOR_CODE_TEXT),
			drawRectOutlineColor: (a, l, t, r, b, col) => this.drawRectOutlineColor(a, l, t, r, b, col),
			playerIndex: this.playerIndex,
			listResources: () => this.listResourcesStrict(),
			openLuaCodeTab: (d) => this.openLuaCodeTab(d),
			openResourceViewerTab: (d) => this.openResourceViewerTab(d),
			focusEditorFromResourcePanel: () => this.focusEditorFromResourcePanel(),
			showMessage: (text, color, duration) => this.showMessage(text, color, duration),
		}, { resourceVertical: scrollbars.resourceVertical, resourceHorizontal: scrollbars.resourceHorizontal });
		// Initialize completion/intellisense controller
		completion = new CompletionController({
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
			drawText: (api, text, x, y, color) => drawEditorText(api, font, text, x, y, color),
			getCursorScreenInfo: () => cursorScreenInfo,
			getLineHeight: () => lineHeight,
			getSpaceAdvance: () => spaceAdvance,
			getActiveCodeTabContext: () => this.getActiveCodeTabContext(),
			resolveHoverAssetId: (ctx) => this.resolveHoverAssetId(ctx as any),
			resolveHoverChunkName: (ctx) => this.resolveHoverChunkName(ctx as any),
			listLuaSymbols: (assetId, chunk) => listLuaSymbolsFn(assetId, chunk),
			listGlobalLuaSymbols: () => listGlobalLuaSymbolsFn(),
			listLuaModuleSymbols: (moduleName) => listLuaModuleSymbolsFn(moduleName),
			listBuiltinLuaFunctions: () => listBuiltinLuaFunctionsFn(),
			getSemanticDefinitions: () => this.getActiveSemanticDefinitions(),
			getLuaModuleAliases: (chunkName) => this.getLuaModuleAliases(chunkName),
			getMemberCompletionItems: (request) => this.buildMemberCompletionItems(request),
			charAt: (r, c) => this.charAt(r, c),
			getTextVersion: () => textVersion,
			shouldFireRepeat: (kb, code, dt) => input.shouldRepeatPublic(kb, code, dt),
		});
		completion.setEnterCommitsEnabled(false);
		// Initialize input controller
		input = new InputController({
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
			deleteWordForward: () => this.deleteWordForward(),
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
			navigateBackward: () => this.goBackwardInNavigationHistory(),
			navigateForward: () => this.goForwardInNavigationHistory(),
		});
		problemsPanel = new ProblemsPanelController({
			lineHeight: lineHeight,
			measureText: (text) => this.measureText(text),
			drawText: (api, text, x, y, color) => drawEditorText(api, font, text, x, y, color),
			drawRectOutlineColor: (api, l, t, r, b, col) => this.drawRectOutlineColor(api, l, t, r, b, col),
			truncateTextToWidth: (text, maxWidth) => this.truncateTextToWidth(text, maxWidth),
			gotoDiagnostic: (diagnostic) => this.gotoDiagnostic(diagnostic),
		});
		problemsPanel.setDiagnostics(diagnostics);
		renameController = new RenameController({
			processFieldEdit: (field, keyboard, options) => this.processInlineFieldEditing(field, keyboard, options),
			shouldFireRepeat: (keyboard, code, deltaSeconds) => this.shouldFireRepeat(keyboard, code, deltaSeconds),
			undo: () => this.undo(),
			redo: () => this.redo(),
			showMessage: (text, color, duration) => this.showMessage(text, color, duration),
			commitRename: (payload) => this.commitRename(payload),
			onRenameSessionClosed: () => this.focusEditorFromRename(),
		}, referenceState, this.playerIndex);
		codeVerticalScrollbarVisible = false;
		codeHorizontalScrollbarVisible = false;
		cachedVisibleRowCount = 1;
		cachedVisibleColumnCount = 1;
		const entryContext = this.createEntryTabContext();
		if (entryContext) {
			entryTabId = entryContext.id;
			codeTabContexts.set(entryContext.id, entryContext);
		}
		this.initializeTabs(entryContext);
		this.resetResourcePanelState();
		if (entryContext) {
			this.activateCodeEditorTab(entryContext.id);
		}
		this.desiredColumn = this.cursorColumn;
		this.assertMonospace();
		const initialContext = entryContext ? codeTabContexts.get(entryContext.id) ?? null : null;
		lastSavedSource = initialContext ? initialContext.lastSavedSource : '';
		$.input.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
		this.applyResolutionModeToRuntime();
		pendingWindowFocused = windowFocused;
		this.installPlatformVisibilityListener();
		this.installWindowEventListeners();
		navigationHistory.current = this.createNavigationEntry();
	}

	protected get wordWrapEnabled(): boolean {
		return wordWrapEnabled;
	}

	protected set wordWrapEnabled(value: boolean) {
		wordWrapEnabled = value;
	}

	protected get cursorRevealSuspended(): boolean {
		return cursorRevealSuspended;
	}

	protected set cursorRevealSuspended(value: boolean) {
		cursorRevealSuspended = value;
	}

	public installPlatformVisibilityListener(): void {
		disposeVisibilityListener?.();
		disposeVisibilityListener = $.platform.lifecycle.onVisibilityChange((visible) => {
			this.requestWindowFocusState(!!visible, true);
		});
	}

	public installWindowEventListeners(): void {
		disposeWindowEventListeners?.();
		const host = $.platform.gameviewHost;
		if (!host) {
			throw new Error('[ConsoleCartEditor] Platform game view host unavailable while installing window listeners.');
		}
		const windowEvents = host.getCapability('window-events');
		if (!windowEvents) {
			throw new Error('[ConsoleCartEditor] Platform window-events capability not exposed.');
		}
		const disposers: (() => void)[] = [];
		disposers.push(windowEvents.subscribe('blur', () => {
			this.requestWindowFocusState(false, true);
		}));
		disposers.push(windowEvents.subscribe('focus', () => {
			this.requestWindowFocusState(true, true);
		}));
		disposeWindowEventListeners = () => {
			for (let i = 0; i < disposers.length; i++) {
				try {
					disposers[i]();
				} catch {
					// Ignore disposer failures; best-effort cleanup.
				}
			}
		};
	}

	public resetInputFocusState(keyboard: KeyboardInput | null): void {
		if (keyboard) {
			keyboard.reset();
		}
		input.resetRepeats();
		this.resetKeyPressGuards();
		repeatState.clear();
		toggleInputLatch = false;
	}

	public requestWindowFocusState(hasFocus: boolean, immediate: boolean): void {
		pendingWindowFocused = hasFocus;
		if (immediate) {
			this.flushWindowFocusState();
		}
	}

	public flushWindowFocusState(keyboard?: KeyboardInput): void {
		if (pendingWindowFocused === windowFocused) {
			return;
		}
		windowFocused = pendingWindowFocused;
		const effectiveKeyboard = keyboard ?? this.getKeyboard();
		this.resetInputFocusState(effectiveKeyboard);
	}

	public scheduleNextFrame(task: () => void): void {
		if (typeof queueMicrotask === 'function') {
			queueMicrotask(task);
			return;
		}
		void Promise.resolve().then(task);
	}

	public enqueueBackgroundTask(task: BackgroundTask): void {
		backgroundTasks.push(task);
		if (backgroundTaskHandle === null) {
			backgroundTaskHandle = $.platform.clock.scheduleOnce!(0, () => this.runBackgroundTasks());
		}
	}

	public runBackgroundTasks(): void {
		backgroundTaskHandle = null;
		if (backgroundTasks.length === 0) {
			return;
		}
		const clock = $.platform.clock;
		const deadline = clock.now() + backgroundTaskBudgetMs;
		const iterationsLimit = backgroundTasks.length * 2;
		let iterations = 0;
		while (backgroundTasks.length > 0) {
			const task = backgroundTasks.shift()!;
			const keep = task();
			if (keep) {
				backgroundTasks.push(task);
			}
			iterations += 1;
			if (clock.now() >= deadline || iterations >= iterationsLimit) {
				break;
			}
		}
		if (backgroundTasks.length > 0 && backgroundTaskHandle === null) {
			backgroundTaskHandle = $.platform.clock.scheduleOnce!(0, () => this.runBackgroundTasks());
		}
	}

	public drawHoverTooltip(api: BmsxConsoleApi, codeTop: number, codeBottom: number, textLeft: number): void {
		const tooltip = hoverTooltip;
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
		const rowTop = codeTop + relativeRow * lineHeight;
		const segment = this.visualIndexToSegment(visualIndex);
		if (!segment) {
			tooltip.bubbleBounds = null;
			return;
		}
		const entry = this.getCachedHighlight(segment.row);
		const highlight = entry.hi;
		let columnStart = wordWrapEnabled ? segment.startColumn : this.scrollColumn;
		if (wordWrapEnabled) {
			if (columnStart < segment.startColumn || columnStart > segment.endColumn) {
				columnStart = segment.startColumn;
			}
		}
		const columnCount = wordWrapEnabled
			? Math.max(0, segment.endColumn - columnStart)
			: this.visibleColumnCount() + 8;
		const slice = this.sliceHighlightedLine(highlight, columnStart, columnCount);
		const sliceStartDisplay = slice.startDisplay;
		const sliceEndLimit = wordWrapEnabled ? this.columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
		const sliceEndDisplay = wordWrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
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
		const bubbleHeight = visibleLines.length * lineHeight + constants.HOVER_TOOLTIP_PADDING_Y * 2;
		const viewportRight = viewportWidth - 1;
		let bubbleLeft = expressionEndX + spaceAdvance;
		if (bubbleLeft + bubbleWidth > viewportRight) {
			bubbleLeft = viewportRight - bubbleWidth;
		}
		if (bubbleLeft <= expressionEndX) {
			const leftCandidate = expressionStartX - bubbleWidth - spaceAdvance;
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
			const lineY = bubbleTop + constants.HOVER_TOOLTIP_PADDING_Y + i * lineHeight;
			drawEditorText(api, font, visibleLines[i], bubbleLeft + constants.HOVER_TOOLTIP_PADDING_X, lineY, constants.COLOR_STATUS_TEXT);
		}
		tooltip.bubbleBounds = { left: bubbleLeft, top: bubbleTop, right: bubbleLeft + bubbleWidth, bottom: bubbleTop + bubbleHeight };
	}

	public showWarningBanner(text: string, durationSeconds = 4.0): void {
		this.showMessage(text, constants.COLOR_STATUS_WARNING, durationSeconds);
		if (!active) {
			message.timer = Number.POSITIVE_INFINITY;
			deferredMessageDuration = durationSeconds;
		} else {
			deferredMessageDuration = null;
		}
	}

	public showRuntimeErrorInChunk(
		chunkName: string | null,
		line: number | null,
		column: number | null,
		message: string,
		hint?: { assetId: string | null; path?: string | null },
		details?: RuntimeErrorDetails | null
	): void {
		this.focusChunkSource(chunkName, hint);
		const overlayMessage = chunkName && chunkName.length > 0 ? `${chunkName}: ${message}` : message;
		this.showRuntimeError(line, column, overlayMessage, details ?? null);
	}

	public showRuntimeError(line: number | null, column: number | null, message: string, details?: RuntimeErrorDetails | null): void {
		if (!active) {
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
		pointerSelecting = false;
		pointerPrimaryWasPressed = false;
		scrollbarController.cancel();
		cursorRevealSuspended = false;
		this.centerCursorVertically();
		this.updateDesiredColumn();
		this.revealCursor();
		this.resetBlink();
		const normalizedMessage = message && message.length > 0 ? message.trim() : 'Runtime error';
		const overlayMessage = processedLine !== null ? `Line ${processedLine}:${normalizedMessage}` : normalizedMessage;
		const messageLines = this.buildRuntimeErrorLines(overlayMessage);
		const overlayDetails = cloneRuntimeErrorDetails(details ?? null);
		const overlay: RuntimeErrorOverlay = {
			row: targetRow,
			column: targetColumn,
			lines: [],
			timer: Number.POSITIVE_INFINITY,
			messageLines,
			lineDescriptors: [],
			layout: null,
			details: overlayDetails,
			expanded: false,
			hovered: false,
			hoverLine: -1,
		};
		rebuildRuntimeErrorOverlayView(overlay);
		this.setActiveRuntimeErrorOverlay(overlay);
		this.setExecutionStopHighlight(processedLine !== null ? targetRow : null);
		const statusLine = overlay.lines.length > 0 ? overlay.lines[0] : 'Runtime error';
		this.showMessage(statusLine, constants.COLOR_STATUS_ERROR, 8.0);
	}

	public focusChunkSource(chunkName: string | null, hint?: { assetId: string | null; path?: string | null }): void {
		if (!active) {
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

	public focusResourceByAsset(assetId: string, preferredPath?: string | null): void {
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

	public normalizeChunkName(name: string | null): string {
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

	public normalizeResourcePath(path?: string | null): string | undefined {
		if (path === null || path === undefined) {
			return undefined;
		}
		const normalized = path.replace(/\\/g, '/');
		return normalized.length > 0 ? normalized : undefined;
	}

	public findCodeTabContext(assetId: string | null, chunkName: string | null): CodeTabContext | null {
		const normalizedChunk = this.normalizeChunkReference(chunkName);
		for (const context of codeTabContexts.values()) {
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
		if (!entryTabId) {
			return null;
		}
		const entryContext = codeTabContexts.get(entryTabId) ?? null;
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

	public normalizeChunkReference(reference: string | null): string | null {
		if (!reference) {
			return null;
		}
		let normalized = reference;
		if (normalized.startsWith('@')) {
			normalized = normalized.slice(1);
		}
		return normalized.replace(/\\/g, '/');
	}

	public resolveResourceDescriptorForSource(assetId: string | null, chunkName: string | null): ConsoleResourceDescriptor | null {
		if (typeof assetId === 'string' && assetId.length > 0) {
			const byAsset = this.findResourceDescriptorByAssetId(assetId);
			if (byAsset) {
				return byAsset;
			}
		}
		const normalizedChunk = this.normalizeChunkReference(chunkName);
		if (!normalizedChunk) {
			return null;
		}
		try {
			return this.findResourceDescriptorForChunk(normalizedChunk);
		} catch {
			return null;
		}
	}


	public listResourcesStrict(): ConsoleResourceDescriptor[] {
		const descriptors = listResourcesFn();
		if (!Array.isArray(descriptors)) {
			throw new Error('[ConsoleCartEditor] Resource enumeration returned an invalid result.');
		}
		return descriptors;
	}

	public findResourceDescriptorByAssetId(assetId: string): ConsoleResourceDescriptor | null {
		const descriptors = this.listResourcesStrict();
		const match = descriptors.find(entry => entry.assetId === assetId);
		return match ?? null;
	}

	public findResourceDescriptorForChunk(chunkPath: string): ConsoleResourceDescriptor {
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

	public openResourceDescriptor(descriptor: ConsoleResourceDescriptor): void {
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

	// Clear overlays and stop highlights across all open code tabs, not just the
	// currently active one. Useful when resuming after a runtime error where the
	// editor may have switched tabs to the faulting chunk.
	public clearAllRuntimeErrorOverlays(): void {
		runtimeErrorOverlay = null;
		for (const context of codeTabContexts.values()) {
			context.runtimeErrorOverlay = null;
		}
		this.clearExecutionStopHighlights();
	}

	public setActiveRuntimeErrorOverlay(overlay: RuntimeErrorOverlay | null): void {
		runtimeErrorOverlay = overlay;
		const context = this.getActiveCodeTabContext();
		if (context) {
			context.runtimeErrorOverlay = overlay;
		}
	}

	public setExecutionStopHighlight(row: number | null): void {
		const context = this.getActiveCodeTabContext();
		if (!context) {
			executionStopRow = null;
			return;
		}
		let nextRow = row;
		if (nextRow !== null) {
			const maxRow = Math.max(0, this.lines.length - 1);
			nextRow = clamp(nextRow, 0, maxRow);
		}
		context.executionStopRow = nextRow;
		executionStopRow = nextRow;
	}

	public clearExecutionStopHighlights(): void {
		executionStopRow = null;
		for (const context of codeTabContexts.values()) {
			context.executionStopRow = null;
		}
	}

	public syncRuntimeErrorOverlayFromContext(context: CodeTabContext | null): void {
		runtimeErrorOverlay = context ? context.runtimeErrorOverlay ?? null : null;
		executionStopRow = context ? context.executionStopRow ?? null : null;
	}

	public getBuiltinIdentifierSet(): ReadonlySet<string> {
		try {
			const descriptors = listBuiltinLuaFunctionsFn();
			const names: string[] = [];
			for (let index = 0; index < descriptors.length; index += 1) {
				const descriptor = descriptors[index];
				if (!descriptor || typeof descriptor.name !== 'string') {
					continue;
				}
				const trimmed = descriptor.name.trim();
				if (trimmed.length === 0) {
					continue;
				}
				names.push(trimmed);
			}
			names.sort((a, b) => a.localeCompare(b));
			const key = names.join('\u0000');
			const cached = builtinIdentifierCache;
			if (cached && cached.key === key) {
				return cached.set;
			}
			const set = new Set<string>();
			for (let i = 0; i < names.length; i += 1) {
				const name = names[i];
				set.add(name);
				set.add(name.toLowerCase());
			}
			const entry = { key, set };
			builtinIdentifierCache = entry;
			return entry.set;
		} catch (error) {
			if (builtinIdentifierCache) {
				return builtinIdentifierCache.set;
			}
			const fallback = new Set<string>();
			builtinIdentifierCache = { key: '', set: fallback };
			return fallback;
		}
	}

	public buildRuntimeErrorLines(message: string): string[] {
		const maxWidth = computeRuntimeErrorOverlayMaxWidth(viewportWidth, charAdvance, gutterWidth);
		return buildRuntimeErrorLinesUtil(message, maxWidth, (text) => this.measureText(text));
	}

	public getTabBarTotalHeight(): number {
		return tabBarHeight * Math.max(1, tabBarRowCount);
	}

	public get topMargin(): number {
		return headerHeight + this.getTabBarTotalHeight() + 2;
	}

	public statusAreaHeight(): number {
		if (!message.visible) {
			return baseBottomMargin;
		}
		const segments = this.getStatusMessageLines();
		const lineCount = Math.max(1, segments.length);
		return baseBottomMargin + lineCount * lineHeight + 4;
	}

	public get bottomMargin(): number {
		return this.statusAreaHeight() + this.getVisibleProblemsPanelHeight();
	}

	public getVisibleProblemsPanelHeight(): number {
		if (!problemsPanel.isVisible()) {
			return 0;
		}
		const planned = problemsPanel.getVisibleHeight();
		if (planned <= 0) {
			return 0;
		}
		const statusHeight = this.statusAreaHeight();
		const maxAvailable = Math.max(0, viewportHeight - statusHeight - (headerHeight + this.getTabBarTotalHeight()));
		if (maxAvailable <= 0) {
			return 0;
		}
		return Math.min(planned, maxAvailable);
	}

	public getStatusMessageLines(): string[] {
		if (!message.visible) {
			return [];
		}
		const sanitized = message.text.length > 0
			? message.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
			: '';
		const rawLines = sanitized.length > 0 ? sanitized.split('\n') : [''];
		const maxWidth = Math.max(viewportWidth - 8, charAdvance);
		const lines: string[] = [];
		for (let i = 0; i < rawLines.length; i += 1) {
			const wrapped = wrapRuntimeErrorLineUtil(rawLines[i], maxWidth, (text) => this.measureText(text));
			for (let j = 0; j < wrapped.length; j += 1) {
				lines.push(wrapped[j]);
			}
		}
		return lines.length > 0 ? lines : [''];
	}

	public tryShowLuaErrorOverlay(error: unknown): boolean {
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

	public safeInspectLuaExpression(request: ConsoleLuaHoverRequest): ConsoleLuaHoverResult | null {
		inspectorRequestFailed = false;
		try {
			return inspectLuaExpressionFn(request);
		} catch (error) {
			inspectorRequestFailed = true;
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
		this.flushWindowFocusState(keyboard);
		this.updateMessage(deltaSeconds);
		this.updateRuntimeErrorOverlay(deltaSeconds);
		if (this.handleToggleRequest(keyboard)) {
			return;
		}
		if (!active) {
			return;
		}
		this.updateBlink(deltaSeconds);
		this.handlePointerWheel();
		this.handlePointerInput(deltaSeconds);
		if (pendingActionPrompt) {
			this.handleActionPromptInput(keyboard);
			return;
		}
		this.handleEditorInput(keyboard, deltaSeconds);
		completion.processPending(deltaSeconds);
		const semanticError = layout.getLastSemanticError();
		if (semanticError && semanticError !== lastReportedSemanticError) {
			this.showMessage(semanticError, constants.COLOR_STATUS_ERROR, 4.0);
			lastReportedSemanticError = semanticError;
		} else if (!semanticError && lastReportedSemanticError !== null) {
			lastReportedSemanticError = null;
		}
		if (diagnosticsDirty) {
			this.processDiagnosticsQueue(clockNow());
		}
		if (this.isCodeTabActive() && !cursorRevealSuspended) {
			this.ensureCursorVisible();
		}
	}

	public processDiagnosticsQueue(now: number): void {
		if (!diagnosticsDirty) {
			return;
		}
		if (dirtyDiagnosticContexts.size === 0) {
			diagnosticsDirty = false;
			diagnosticsDueAtMs = null;
			return;
		}
		if (diagnosticsDueAtMs === null) {
			diagnosticsDueAtMs = now + diagnosticsDebounceMs;
			return;
		}
		if (now < diagnosticsDueAtMs) {
			return;
		}
		this.scheduleDiagnosticsComputation();
	}

	public scheduleDiagnosticsComputation(): void {
		if (diagnosticsComputationScheduled) {
			return;
		}
		diagnosticsComputationScheduled = true;
		this.scheduleNextFrame(() => {
			diagnosticsComputationScheduled = false;
			this.executeDiagnosticsComputation();
		});
	}

	public executeDiagnosticsComputation(): void {
		if (!diagnosticsDirty) {
			diagnosticsDueAtMs = null;
			return;
		}
		if (dirtyDiagnosticContexts.size === 0) {
			diagnosticsDirty = false;
			diagnosticsDueAtMs = null;
			return;
		}
		if (diagnosticsTaskPending) {
			return;
		}
		const now = clockNow();
		if (diagnosticsDueAtMs === null) {
			diagnosticsDueAtMs = now + diagnosticsDebounceMs;
			this.scheduleDiagnosticsComputation();
			return;
		}
		if (now < diagnosticsDueAtMs) {
			this.scheduleDiagnosticsComputation();
			return;
		}
		const batch = this.collectDiagnosticsBatch();
		if (batch.length === 0) {
			diagnosticsDirty = false;
			diagnosticsDueAtMs = null;
			return;
		}
		this.enqueueDiagnosticsJob(batch);
	}

	public enqueueDiagnosticsJob(contextIds: readonly string[]): void {
		if (contextIds.length === 0) {
			return;
		}
		diagnosticsTaskPending = true;
		const batch = [...contextIds];
		this.enqueueBackgroundTask(() => {
			this.runDiagnosticsForContexts(batch);
			diagnosticsTaskPending = false;
			if (dirtyDiagnosticContexts.size === 0) {
				diagnosticsDirty = false;
				diagnosticsDueAtMs = null;
			} else {
				const now = clockNow();
				diagnosticsDueAtMs = now + diagnosticsDebounceMs;
				this.scheduleDiagnosticsComputation();
			}
			return false;
		});
	}

	public collectDiagnosticsBatch(): string[] {
		const batch: string[] = [];
		const activeId = activeCodeTabContextId;
		if (activeId && dirtyDiagnosticContexts.has(activeId)) {
			batch.push(activeId);
		}
		if (batch.length === 0) {
			const iterator = dirtyDiagnosticContexts.values().next();
			if (!iterator.done) {
				batch.push(iterator.value);
			}
		}
		return batch;
	}

	public runDiagnosticsForContexts(contextIds: readonly string[]): void {
		if (contextIds.length === 0) {
			return;
		}
		const providers = this.createDiagnosticProviders();
		const activeId = activeCodeTabContextId;
		const inputs: DiagnosticContextInput[] = [];
		const metadata: Array<{ id: string; chunkName: string | null }> = [];
		for (let index = 0; index < contextIds.length; index += 1) {
			const contextId = contextIds[index];
			const context = codeTabContexts.get(contextId);
			if (!context) {
				diagnosticsCache.delete(contextId);
				dirtyDiagnosticContexts.delete(contextId);
				continue;
			}
			const assetId = this.resolveHoverAssetId(context);
			const chunkName = this.resolveHoverChunkName(context);
			let source = '';
			if (activeId && contextId === activeId) {
				source = this.lines.join('\n');
			} else {
				try {
					source = this.getSourceForChunk(assetId, chunkName);
				} catch {
					source = '';
				}
			}
			if (source.length === 0) {
				diagnosticsCache.delete(contextId);
				dirtyDiagnosticContexts.delete(contextId);
				continue;
			}
			inputs.push({
				id: context.id,
				title: context.title,
				descriptor: context.descriptor,
				assetId,
				chunkName,
				source,
			});
			metadata.push({ id: context.id, chunkName });
		}
		if (inputs.length === 0) {
			this.updateDiagnosticsAggregates();
			return;
		}
		const diagnostics = computeAggregatedEditorDiagnostics(inputs, providers);
		const byContext = new Map<string, EditorDiagnostic[]>();
		for (let index = 0; index < diagnostics.length; index += 1) {
			const diag = diagnostics[index];
			const key = diag.contextId ?? '';
			let bucket = byContext.get(key);
			if (!bucket) {
				bucket = [];
				byContext.set(key, bucket);
			}
			bucket.push(diag);
		}
		for (let index = 0; index < metadata.length; index += 1) {
			const meta = metadata[index];
			const diagList = byContext.get(meta.id) ?? [];
			diagnosticsCache.set(meta.id, {
				contextId: meta.id,
				chunkName: meta.chunkName,
				diagnostics: diagList,
			});
			dirtyDiagnosticContexts.delete(meta.id);
		}
		this.updateDiagnosticsAggregates();
	}

	public createDiagnosticProviders(): DiagnosticProviders {
		return {
			listLocalSymbols: (assetId, chunk) => {
				try {
					return listLuaSymbolsFn(assetId, chunk);
				} catch {
					return [];
				}
			},
			listGlobalSymbols: () => {
				try {
					return listGlobalLuaSymbolsFn();
				} catch {
					return [];
				}
			},
			listBuiltins: () => {
				try {
					return listBuiltinLuaFunctionsFn();
				} catch {
					return [];
				}
			},
		};
	}

	public updateDiagnosticsAggregates(): void {
		const aggregate: EditorDiagnostic[] = [];
		for (const context of codeTabContexts.values()) {
			const entry = diagnosticsCache.get(context.id);
			if (entry) {
				for (let index = 0; index < entry.diagnostics.length; index += 1) {
					aggregate.push(entry.diagnostics[index]);
				}
			}
		}
		for (const [contextId, entry] of diagnosticsCache) {
			if (codeTabContexts.has(contextId)) {
				continue;
			}
			for (let index = 0; index < entry.diagnostics.length; index += 1) {
				aggregate.push(entry.diagnostics[index]);
			}
		}
		diagnostics = aggregate;
		this.refreshActiveDiagnostics();
		problemsPanel.setDiagnostics(diagnostics);
	}

	public refreshActiveDiagnostics(): void {
		diagnosticsByRow.clear();
		const activeId = activeCodeTabContextId;
		if (!activeId) {
			return;
		}
		const entry = diagnosticsCache.get(activeId);
		if (!entry) {
			return;
		}
		for (let index = 0; index < entry.diagnostics.length; index += 1) {
			const diag = entry.diagnostics[index];
			let bucket = diagnosticsByRow.get(diag.row);
			if (!bucket) {
				bucket = [];
				diagnosticsByRow.set(diag.row, bucket);
			}
			bucket.push(diag);
		}
	}

	public markDiagnosticsDirtyForChunk(chunkName: string): void {
		const context = this.findContextByChunk(chunkName);
		if (!context) {
			return;
		}
		this.markDiagnosticsDirty(context.id);
	}

	public getActiveSemanticDefinitions(): readonly LuaDefinitionInfo[] | null {
		const context = this.getActiveCodeTabContext();
		const chunkName = this.resolveHoverChunkName(context) ?? '<console>';
		return layout.getSemanticDefinitions(this.lines, textVersion, chunkName);
	}

	public getLuaModuleAliases(chunkName: string | null): Map<string, string> {
		const activeContext = this.getActiveCodeTabContext();
		const targetChunk = chunkName ?? this.resolveHoverChunkName(activeContext) ?? '<console>';
		layout.getSemanticDefinitions(this.lines, textVersion, targetChunk);
		const data = semanticWorkspace.getFileData(targetChunk);
		if (!data || data.moduleAliases.length === 0) {
			return new Map();
		}
		const aliases = new Map<string, string>();
		for (let index = 0; index < data.moduleAliases.length; index += 1) {
			const entry = data.moduleAliases[index];
			aliases.set(entry.alias, entry.module);
		}
		return aliases;
	}

	public findContextByChunk(chunkName: string): CodeTabContext | null {
		const normalized = this.normalizeChunkReference(chunkName) ?? chunkName;
		for (const context of codeTabContexts.values()) {
			const descriptor = context.descriptor;
			if (descriptor) {
				const descriptorPath = this.normalizeChunkReference(descriptor.path);
				if ((descriptorPath && descriptorPath === normalized)
					|| descriptor.assetId === chunkName
					|| descriptor.assetId === normalized) {
					return context;
				}
				continue;
			}
			const aliases: string[] = [];
			if (primaryAssetId) {
				aliases.push(primaryAssetId);
			}
			aliases.push('__entry__', '<console>');
			for (let index = 0; index < aliases.length; index += 1) {
				const alias = aliases[index];
				if (alias === chunkName || alias === normalized) {
					return context;
				}
			}
		}
		return null;
	}

	public getDiagnosticsForRow(row: number): readonly EditorDiagnostic[] {
		const bucket = diagnosticsByRow.get(row);
		return bucket ?? EMPTY_DIAGNOSTICS;
	}

	public isActive(): boolean {
		return active;
	}

	public draw(api: BmsxConsoleApi): void {
		this.refreshViewportDimensions();
		if (!active) {
			return;
		}
		codeVerticalScrollbarVisible = false;
		codeHorizontalScrollbarVisible = false;
		const frameColor = Msx1Colors[constants.COLOR_FRAME];
		api.rectfill_color(0, 0, viewportWidth, viewportHeight, { r: frameColor.r, g: frameColor.g, b: frameColor.b, a: frameColor.a });
		this.drawTopBar(api);
		tabBarRowCount = renderTabBar(api, {
			viewportWidth: viewportWidth,
			headerHeight: headerHeight,
			rowHeight: tabBarHeight,
			lineHeight: lineHeight,
			tabs: tabs,
			activeTabId: activeTabId,
			tabHoverId: tabHoverId,
			measureText: (text: string) => this.measureText(text),
			drawText: (api2, text, x, y, color) => drawEditorText(api2, font, text, x, y, color),
			getDirtyMarkerMetrics: () => this.getTabDirtyMarkerMetrics(),
			tabButtonBounds: tabButtonBounds,
			tabCloseButtonBounds: tabCloseButtonBounds,
		});
		this.drawResourcePanel(api);
		if (this.isResourceViewActive()) {
			this.drawResourceViewer(api);
		} else {
			this.hideResourceViewerSprite(api);
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
		if (pendingActionPrompt) {
			this.drawActionPromptOverlay(api);
		}
	}

	public getSourceForChunk(assetId: string | null, chunkName: string | null): string {
		const context = this.findCodeTabContext(assetId, chunkName);
		if (context) {
			if (context.id === activeCodeTabContextId) {
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
		const descriptor = this.resolveResourceDescriptorForSource(assetId, chunkName);
		if (descriptor) {
			return loadLuaResourceFn(descriptor.assetId);
		}
		throw new Error(`[ConsoleCartEditor] Unable to locate source for asset '${assetId ?? '<null>'}' and chunk '${chunkName ?? '<null>'}'.`);
	}

	public getTabDirtyMarkerMetrics(): { width: number; height: number } {
		return { width: 4, height: 4 };
	}

	public refreshViewportDimensions(force = false): void {
		const view = $.view;
		if (!view) {
			throw new Error('[ConsoleCartEditor] Game view unavailable during editor frame.');
		}
		const renderSize = resolutionMode === 'offscreen' ? view.offscreenCanvasSize : view.viewportSize;
		if (!Number.isFinite(renderSize.x) || !Number.isFinite(renderSize.y) || renderSize.x <= 0 || renderSize.y <= 0) {
			throw new Error('[ConsoleCartEditor] Invalid render dimensions.');
		}
		const width = renderSize.x;
		const height = renderSize.y;
		if (!force && width === viewportWidth && height === viewportHeight) {
			return;
		}
		viewportWidth = width;
		viewportHeight = height;
		this.invalidateVisualLines();
		if (resourcePanelWidthRatio !== null) {
			resourcePanelWidthRatio = this.clampResourcePanelRatio(resourcePanelWidthRatio);
			if (resourcePanelVisible && this.computePanelPixelWidth(resourcePanelWidthRatio) <= 0) {
				this.hideResourcePanel();
			}
		}
		if (resourcePanelVisible) {
			this.resourceBrowserEnsureSelectionVisible();
		}
	}

	public initializeTabs(entryContext: CodeTabContext | null = null): void {
		tabs = [];
		tabHoverId = null;
		tabDragState = null;
		tabButtonBounds.clear();
		tabCloseButtonBounds.clear();
		if (entryContext) {
			tabs.push({
				id: entryContext.id,
				kind: 'lua_editor',
				title: entryContext.title,
				closable: true,
				dirty: entryContext.dirty,
			});
			activeTabId = entryContext.id;
			activeCodeTabContextId = entryContext.id;
			return;
		}
		activeTabId = null;
		activeCodeTabContextId = null;
	}

	public setTabDirty(tabId: string, dirty: boolean): void {
		const tab = tabs.find(candidate => candidate.id === tabId);
		if (!tab) {
			return;
		}
		tab.dirty = dirty;
	}

	public updateActiveContextDirtyFlag(): void {
		const context = this.getActiveCodeTabContext();
		if (!context) {
			return;
		}
		context.dirty = this.dirty;
		this.setTabDirty(context.id, context.dirty);
	}

	public getActiveTabKind(): EditorTabKind {
		if (!activeTabId) {
			return 'lua_editor';
		}
		const active = tabs.find(tab => tab.id === activeTabId);
		if (active) {
			return active.kind;
		}
		if (tabs.length > 0) {
			const first = tabs[0];
			activeTabId = first.id;
			return first.kind;
		}
		activeTabId = null;
		return 'lua_editor';
	}

	public getActiveResourceViewer(): ResourceViewerState | null {
		const tab = tabs.find(candidate => candidate.id === activeTabId);
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
		const messageSnapshot: MessageState = {
			text: message.text,
			color: message.color,
			timer: message.timer,
			visible: message.visible,
		};
		return {
			active: active,
			activeTab: this.getActiveTabKind(),
			snapshot,
			searchQuery: searchQuery,
			searchMatches: searchMatches.map(match => ({ row: match.row, start: match.start, end: match.end })),
			searchCurrentIndex: searchCurrentIndex,
			searchActive: searchActive,
			searchVisible: searchVisible,
			lineJumpValue: lineJumpValue,
			lineJumpActive: lineJumpActive,
			lineJumpVisible: lineJumpVisible,
			message: messageSnapshot,
			runtimeErrorOverlay: null,
			saveGeneration: saveGeneration,
			appliedGeneration: appliedGeneration,
		};
	}

	public restoreState(state: ConsoleEditorSerializedState): void { // NOTE: UNUSED AS WE DON'T SAVE EDITOR STATE ANYMORE
		if (!state) return;
		input.applyOverrides(false, captureKeys);
		$.input.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
		codeTabContexts.clear();
		const entryContext = this.createEntryTabContext();
		if (entryContext) {
			entryTabId = entryContext.id;
			codeTabContexts.set(entryContext.id, entryContext);
			activeCodeTabContextId = entryContext.id;
		}
		else {
			activeCodeTabContextId = null;
		}
		this.initializeTabs(entryContext);
		this.resetResourcePanelState();
		this.hideResourcePanel();
		active = state.active;
		const restoredKind = state.activeTab ?? 'lua_editor';
		if (restoredKind === 'resource_view') {
			const activeResourceTab = tabs.find(tab => tab.kind === 'resource_view');
			if (activeResourceTab) {
				this.setActiveTab(activeResourceTab.id);
			}
		} else {
			this.activateCodeTab();
		}
		if (active) {
			input.applyOverrides(true, captureKeys);
		}
		this.restoreSnapshot(state.snapshot);
		this.applySearchFieldText(state.searchQuery, true);
		searchScope = 'local';
		searchDisplayOffset = 0;
		searchHoverIndex = -1;
		globalSearchMatches = [];
		searchMatches = state.searchMatches.map(match => ({ row: match.row, start: match.start, end: match.end }));
		searchCurrentIndex = state.searchCurrentIndex;
		searchActive = state.searchActive;
		searchVisible = state.searchVisible;
		this.applyLineJumpFieldText(state.lineJumpValue, true);
		lineJumpActive = state.lineJumpActive;
		lineJumpVisible = state.lineJumpVisible;
		message.text = state.message.text;
		message.color = state.message.color;
		message.timer = state.message.timer;
		message.visible = state.message.visible;
		this.setActiveRuntimeErrorOverlay(null);
		pointerSelecting = false;
		pointerPrimaryWasPressed = false;
		this.clearGotoHoverHighlight();
		cursorRevealSuspended = false;
		repeatState.clear();
		this.resetKeyPressGuards();
		this.breakUndoSequence();
		saveGeneration = Number.isFinite(state.saveGeneration) ? Math.max(0, Math.floor(state.saveGeneration)) : 0;
		appliedGeneration = Number.isFinite(state.appliedGeneration) ? Math.max(0, Math.floor(state.appliedGeneration)) : 0;
		this.resetActionPromptState();
		const activeContext = this.getActiveCodeTabContext();
		const entryContextRef = entryTabId ? codeTabContexts.get(entryTabId) ?? null : null;
		if (activeContext) {
			activeContext.lastSavedSource = this.lines.join('\n');
			activeContext.dirty = this.dirty;
			this.setTabDirty(activeContext.id, activeContext.dirty);
		}
		if (entryContextRef) {
			if (activeContext && activeContext.id === entryContextRef.id) {
				entryContextRef.lastSavedSource = this.lines.join('\n');
			}
			lastSavedSource = entryContextRef.lastSavedSource;
		} else {
			lastSavedSource = '';
		}
	}

	public shutdown(): void {
		this.clearExecutionStopHighlights();
		this.storeActiveCodeTabContext();
		input.applyOverrides(false, captureKeys);
		active = false;
		if (disposeVisibilityListener) {
			disposeVisibilityListener();
			disposeVisibilityListener = null;
		}
		if (disposeWindowEventListeners) {
			disposeWindowEventListeners();
			disposeWindowEventListeners = null;
		}
		windowFocused = true;
		pendingWindowFocused = true;
		repeatState.clear();
		this.resetKeyPressGuards();
		pointerSelecting = false;
		pointerPrimaryWasPressed = false;
		pointerAuxWasPressed = false;
		this.clearGotoHoverHighlight();
		cursorRevealSuspended = false;
		searchActive = false;
		searchVisible = false;
		this.cancelSearchJob();
		this.cancelGlobalSearchJob();
		searchMatches = [];
		globalSearchMatches = [];
		searchDisplayOffset = 0;
		searchHoverIndex = -1;
		searchScope = 'local';
		searchCurrentIndex = -1;
		this.applySearchFieldText('', true);
		lineJumpActive = false;
		lineJumpVisible = false;
		this.applyLineJumpFieldText('', true);
		createResourceActive = false;
		createResourceVisible = false;
		this.applyCreateResourceFieldText('', true);
		createResourceError = null;
		createResourceWorking = false;
		this.resetActionPromptState();
		this.hideResourcePanel();
		this.activateCodeTab();
	}

	public getKeyboard(): KeyboardInput {
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

	public handleToggleRequest(keyboard: KeyboardInput): boolean {
		const escapeState = getKeyboardButtonState(this.playerIndex, ESCAPE_KEY);
		if (escapeState && escapeState.pressed === true) {
			if (shouldAcceptKeyPressGlobal(ESCAPE_KEY, escapeState)) {
				const handled = this.handleEscapeKey();
				if (handled) {
					consumeKeyboardKey(keyboard, ESCAPE_KEY);
					return true;
				}
			}
		}

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
			toggleInputLatch = false;
			return false;
		}
		if (toggleInputLatch) {
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
		toggleInputLatch = true;
		const intercepted = this.handleEscapeKey();
		if (keyboardAccepted) {
			consumeKeyboardKey(keyboard, EDITOR_TOGGLE_KEY);
		}
		if (gamepadAccepted && playerInput && playerInput.inputHandlers['gamepad']) {
			const handler = playerInput.inputHandlers['gamepad'];
			handler.consumeButton(selectButton);
			handler.consumeButton(startButton);
		}
		if (intercepted) {
			return true;
		}
		if (active) {
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

	public handleEscapeKey(): boolean {
		if (pendingActionPrompt) {
			this.resetActionPromptState();
			return true;
		}
		if (runtimeErrorOverlay) {
			this.clearRuntimeErrorOverlay();
			message.visible = false;
			return true;
		}
		if (createResourceVisible) {
			this.closeCreateResourcePrompt(true);
			return true;
		}
		if (symbolSearchActive || symbolSearchVisible) {
			this.closeSymbolSearch(false);
			return true;
		}
		if (resourceSearchActive || resourceSearchVisible) {
			this.closeResourceSearch(false);
			return true;
		}
		if (lineJumpActive || lineJumpVisible) {
			this.closeLineJump(false);
			return true;
		}
		if (searchActive || searchVisible) {
			this.closeSearch(false, true);
			return true;
		}
		return false;
	}

	public activate(): void {
		if (!disposeVisibilityListener) {
			this.installPlatformVisibilityListener();
		}
		if (!disposeWindowEventListeners) {
			this.installWindowEventListeners();
		}
		input.applyOverrides(true, captureKeys);
		this.applyResolutionModeToRuntime();
		if (activeCodeTabContextId) {
			const existingTab = tabs.find(candidate => candidate.id === activeCodeTabContextId);
			if (existingTab) {
				this.setActiveTab(activeCodeTabContextId);
			} else {
				this.activateCodeTab();
			}
		} else {
			this.activateCodeTab();
		}
		this.bumpTextVersion();
		cursorVisible = true;
		blinkTimer = 0;
		active = true;
		pointerSelecting = false;
		pointerPrimaryWasPressed = false;
		cursorRevealSuspended = false;
		repeatState.clear();
		this.resetKeyPressGuards();
		this.updateDesiredColumn();
		this.selectionAnchor = null;
		this.undoStack = [];
		this.redoStack = [];
		this.lastHistoryKey = null;
		this.lastHistoryTimestamp = 0;
		searchActive = false;
		searchVisible = false;
		lineJumpActive = false;
		lineJumpVisible = false;
		lineJumpValue = '';
		this.syncRuntimeErrorOverlayFromContext(this.getActiveCodeTabContext());
		this.resetActionPromptState();
		this.cancelSearchJob();
		this.cancelGlobalSearchJob();
		globalSearchMatches = [];
		searchDisplayOffset = 0;
		searchHoverIndex = -1;
		searchScope = 'local';
		if (searchQuery.length === 0) {
			searchMatches = [];
			searchCurrentIndex = -1;
		} else {
			this.startSearchJob();
		}
		this.ensureCursorVisible();
		if (message.visible && !Number.isFinite(message.timer) && deferredMessageDuration !== null) {
			message.timer = deferredMessageDuration;
		}
		deferredMessageDuration = null;
		if (dimCrtInEditor) {
			this.applyEditorCrtDimming();
		}
	}

	public applyEditorCrtDimming(): void {
		const view = $.view;
		const [bleedR, bleedG, bleedB] = view.colorBleed;
		const [glowR, glowG, glowB] = view.glowColor;
		crtOptionsSnapshot = {
			noiseIntensity: view.noiseIntensity,
			colorBleed: [bleedR, bleedG, bleedB] as [number, number, number],
			blurIntensity: view.blurIntensity,
			glowColor: [glowR, glowG, glowB] as [number, number, number],
		};
		let snapshot = crtOptionsSnapshot;
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

	public restoreCrtOptions(): void {
		const snapshot = crtOptionsSnapshot;
		if (!snapshot) {
			throw new Error('[ConsoleCartEditor] CRT options snapshot unavailable during restore.');
		}
		crtOptionsSnapshot = null;
		const view = $.view;
		view.noiseIntensity = snapshot.noiseIntensity;
		view.colorBleed = [snapshot.colorBleed[0], snapshot.colorBleed[1], snapshot.colorBleed[2]] as [number, number, number];
		view.blurIntensity = snapshot.blurIntensity;
		view.glowColor = [snapshot.glowColor[0], snapshot.glowColor[1], snapshot.glowColor[2]] as [number, number, number];
	}

	public deactivate(): void {
		this.storeActiveCodeTabContext();
		active = false;
		if (dimCrtInEditor) {
			this.restoreCrtOptions();
		}
		completion.closeSession();
		repeatState.clear();
		this.resetKeyPressGuards();
		input.applyOverrides(false, captureKeys);
		$.input.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
		this.selectionAnchor = null;
		pointerSelecting = false;
		pointerPrimaryWasPressed = false;
		pointerAuxWasPressed = false;
		tabDragState = null;
		this.clearGotoHoverHighlight();
		scrollbarController.cancel();
		cursorRevealSuspended = false;
		this.undoStack = [];
		this.redoStack = [];
		this.lastHistoryKey = null;
		this.lastHistoryTimestamp = 0;
		searchActive = false;
		searchVisible = false;
		lineJumpActive = false;
		lineJumpVisible = false;
		runtimeErrorOverlay = null;
		this.resetActionPromptState();
		this.closeCreateResourcePrompt(false);
		this.hideResourcePanel();
		this.cancelSearchJob();
		this.cancelGlobalSearchJob();
		globalSearchMatches = [];
		searchDisplayOffset = 0;
		searchHoverIndex = -1;
		searchScope = 'local';
		backgroundTasks.length = 0;
		if (backgroundTaskHandle) {
			backgroundTaskHandle.cancel();
			backgroundTaskHandle = null;
		}
		diagnosticsTaskPending = false;
		lastReportedSemanticError = null;
	}

	public updateBlink(deltaSeconds: number): void {
		blinkTimer += deltaSeconds;
		if (blinkTimer >= constants.CURSOR_BLINK_INTERVAL) {
			blinkTimer -= constants.CURSOR_BLINK_INTERVAL;
			cursorVisible = !cursorVisible;
		}
	}

	public splitLines(source: string): string[] {
		return source.split(/\r?\n/);
	}

	public handleActionPromptInput(keyboard: KeyboardInput): void {
		if (!pendingActionPrompt) {
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

	public handleEditorInput(keyboard: KeyboardInput, deltaSeconds: number): void {
		if (resourcePanelVisible && resourcePanelFocused) {
			resourcePanel.handleKeyboard(keyboard, deltaSeconds);
			const st = resourcePanel.getStateForRender();
			resourcePanelFocused = st.focused;
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
			if (problemsPanel.isVisible()) {
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

		if (createResourceActive) {
			this.handleCreateResourceInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
			return;
		}

		if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(this.playerIndex, 'KeyN')) {
			consumeKeyboardKey(keyboard, 'KeyN');
			this.openCreateResourcePrompt();
			return;
		}

		if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyF')) {
			consumeKeyboardKey(keyboard, 'KeyF');
			this.openSearch(true, 'global');
			return;
		}
		if ((ctrlDown || metaDown) && !shiftDown && !altDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyF')) {
			consumeKeyboardKey(keyboard, 'KeyF');
			this.openSearch(true, 'local');
			return;
		}
		if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(this.playerIndex, 'Tab')) {
			consumeKeyboardKey(keyboard, 'Tab');
			this.cycleTab(shiftDown ? -1 : 1);
			return;
		}
		const inlineFieldFocused = searchActive
			|| symbolSearchActive
			|| resourceSearchActive
			|| lineJumpActive
			|| createResourceActive
			|| renameController.isActive();
		if (this.handleCustomKeybinding(keyboard, deltaSeconds, {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			inlineFieldFocused,
			resourcePanelFocused: resourcePanelFocused,
			codeTabActive: this.isCodeTabActive(),
		})) {
			return;
		}
		if (!inlineFieldFocused && isKeyJustPressedGlobal(this.playerIndex, 'F12')) {
			consumeKeyboardKey(keyboard, 'F12');
			if (shiftDown) {
				return;
			}
			this.openReferenceSearchPopup();
			return;
		}
		if (!inlineFieldFocused && this.isCodeTabActive() && isKeyJustPressedGlobal(this.playerIndex, 'F2')) {
			consumeKeyboardKey(keyboard, 'F2');
			this.openRenamePrompt();
			return;
		}
		if ((ctrlDown || metaDown)
			&& !inlineFieldFocused
			&& !resourcePanelFocused
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
		if (renameController.isActive()) {
			renameController.handleInput(keyboard, deltaSeconds, { ctrlDown, metaDown, shiftDown, altDown });
			return;
		}
		if (resourceSearchActive) {
			this.handleResourceSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
			return;
		}
		if (symbolSearchActive) {
			this.handleSymbolSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
			return;
		}
		if (lineJumpActive) {
			this.handleLineJumpInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
			return;
		}
		if (searchActive) {
			this.handleSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
			return;
		}
		if (problemsPanel.isVisible() && problemsPanel.isFocused()) {
			let handled = false;
			if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'ArrowUp');
				handled = problemsPanel.handleKeyboardCommand('up');
			} else if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'ArrowDown');
				handled = problemsPanel.handleKeyboardCommand('down');
			} else if (this.shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'PageUp');
				handled = problemsPanel.handleKeyboardCommand('page-up');
			} else if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'PageDown');
				handled = problemsPanel.handleKeyboardCommand('page-down');
			} else if (this.shouldFireRepeat(keyboard, 'Home', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'Home');
				handled = problemsPanel.handleKeyboardCommand('home');
			} else if (this.shouldFireRepeat(keyboard, 'End', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'End');
				handled = problemsPanel.handleKeyboardCommand('end');
			} else if (isKeyJustPressedGlobal(this.playerIndex, 'Enter') || isKeyJustPressedGlobal(this.playerIndex, 'NumpadEnter')) {
				if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) consumeKeyboardKey(keyboard, 'Enter'); else consumeKeyboardKey(keyboard, 'NumpadEnter');
				handled = problemsPanel.handleKeyboardCommand('activate');
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
		if (searchQuery.length > 0 && isKeyJustPressedGlobal(this.playerIndex, 'F3')) {
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
		input.handleEditorInput(keyboard, deltaSeconds);
		if (ctrlDown || metaDown || altDown) {
			return;
		}
		// Remaining character input after controller handled modifiers is no-op here
	}

	protected handleCustomKeybinding(
		_keyboard: KeyboardInput,
		_deltaSeconds: number,
		_context: ConsoleEditorShortcutContext,
	): boolean {
		return false;
	}

	public handleCreateResourceInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');
		if (isKeyJustPressedGlobal(this.playerIndex, 'Escape')) {
			consumeKeyboardKey(keyboard, 'Escape');
			this.cancelCreateResourcePrompt();
			return;
		}
		if (!createResourceWorking && isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			consumeKeyboardKey(keyboard, 'Enter');
			void this.confirmCreateResourcePrompt();
			return;
		}
		if (createResourceWorking) {
			return;
		}
		const textChanged = this.processInlineFieldEditing(createResourceField, keyboard, {
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
			createResourceError = null;
			this.resetBlink();
		}
		createResourcePath = createResourceField.text;
	}

	public openCreateResourcePrompt(): void {
		if (createResourceWorking) {
			return;
		}
		resourcePanelFocused = false;
		renameController.cancel();
		let defaultPath = createResourcePath.length === 0
			? this.determineCreateResourceDefaultPath()
			: createResourcePath;
		if (defaultPath.length > constants.CREATE_RESOURCE_MAX_PATH_LENGTH) {
			defaultPath = defaultPath.slice(defaultPath.length - constants.CREATE_RESOURCE_MAX_PATH_LENGTH);
		}
		this.applyCreateResourceFieldText(defaultPath, true);
		createResourceVisible = true;
		createResourceActive = true;
		createResourceError = null;
		cursorVisible = true;
		this.resetBlink();
	}

	public closeCreateResourcePrompt(focusEditor: boolean): void {
		createResourceActive = false;
		createResourceVisible = false;
		createResourceWorking = false;
		if (focusEditor) {
			this.focusEditorFromSearch();
			this.focusEditorFromLineJump();
		}
		this.applyCreateResourceFieldText('', true);
		createResourceError = null;
		this.resetBlink();
	}

	public cancelCreateResourcePrompt(): void {
		this.closeCreateResourcePrompt(true);
	}

	public async confirmCreateResourcePrompt(): Promise<void> {
		if (createResourceWorking) {
			return;
		}
		let normalizedPath: string;
		let assetId: string;
		let directory: string;
		try {
			const result = this.normalizeCreateResourceRequest(createResourcePath);
			normalizedPath = result.path;
			assetId = result.assetId;
			directory = result.directory;
			this.applyCreateResourceFieldText(normalizedPath, true);
			createResourceError = null;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			createResourceError = message;
			this.showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
			this.resetBlink();
			return;
		}
		createResourceWorking = true;
		this.resetBlink();
		const contents = this.buildDefaultResourceContents(normalizedPath, assetId);
		try {
			const descriptor = await createLuaResourceFn({ path: normalizedPath, assetId, contents });
			lastCreateResourceDirectory = directory;
			pendingResourceSelectionAssetId = descriptor.assetId;
			if (resourcePanelVisible) {
				this.refreshResourcePanelContents();
			}
			this.openLuaCodeTab(descriptor);
			this.showMessage(`Created ${descriptor.path} (asset ${descriptor.assetId})`, constants.COLOR_STATUS_SUCCESS, 2.5);
			this.closeCreateResourcePrompt(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const simplified = this.simplifyRuntimeErrorMessage(message);
			createResourceError = simplified;
			this.showMessage(`Failed to create resource: ${simplified}`, constants.COLOR_STATUS_WARNING, 4.0);
		} finally {
			createResourceWorking = false;
			this.resetBlink();
		}
	}

	public isValidCreateResourceCharacter(value: string): boolean {
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

	public normalizeCreateResourceRequest(rawPath: string): { path: string; assetId: string; directory: string } {
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

	public determineCreateResourceDefaultPath(): string {
		if (lastCreateResourceDirectory && lastCreateResourceDirectory.length > 0) {
			return lastCreateResourceDirectory;
		}
		const activeContext = this.getActiveCodeTabContext();
		if (activeContext && activeContext.descriptor && typeof activeContext.descriptor.path === 'string' && activeContext.descriptor.path.length > 0) {
			return this.ensureDirectorySuffix(activeContext.descriptor.path);
		}
		let descriptors: ConsoleResourceDescriptor[] = [];
		try {
			descriptors = listResourcesFn();
		} catch (error) {
			descriptors = [];
		}
		const firstLua = descriptors.find(entry => entry.type === 'lua' && typeof entry.path === 'string' && entry.path.length > 0);
		if (firstLua && typeof firstLua.path === 'string') {
			return this.ensureDirectorySuffix(firstLua.path);
		}
		return './';
	}

	public ensureDirectorySuffix(path: string): string {
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

	public buildDefaultResourceContents(_path: string, _assetId: string): string {
		return constants.DEFAULT_NEW_LUA_RESOURCE_CONTENT;
	}

	public handleSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');
		if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyF')) {
			consumeKeyboardKey(keyboard, 'KeyF');
			this.openSearch(false, 'global');
			return;
		}
		if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyF')) {
			consumeKeyboardKey(keyboard, 'KeyF');
			this.openSearch(false, 'local');
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
		const hasResults = activeSearchMatchCount() > 0;
		const previewLocal = searchScope === 'local';
		if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			consumeKeyboardKey(keyboard, 'Enter');
			if (hasResults) {
				if (shiftDown) {
					this.moveSearchSelection(-1, { wrap: true, preview: previewLocal });
				} else if (searchCurrentIndex === -1) {
					searchCurrentIndex = 0;
				} else {
					this.moveSearchSelection(1, { wrap: true, preview: previewLocal });
				}
				this.applySearchSelection(searchCurrentIndex);
			} else if (shiftDown) {
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
		if (hasResults) {
			if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'ArrowUp');
				this.moveSearchSelection(-1, { preview: previewLocal });
				return;
			}
			if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'ArrowDown');
				this.moveSearchSelection(1, { preview: previewLocal });
				return;
			}
			if (this.shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'PageUp');
				this.moveSearchSelection(-searchPageSize(), { preview: previewLocal });
				return;
			}
			if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'PageDown');
				this.moveSearchSelection(searchPageSize(), { preview: previewLocal });
				return;
			}
			if (isKeyJustPressedGlobal(this.playerIndex, 'Home')) {
				consumeKeyboardKey(keyboard, 'Home');
				searchCurrentIndex = hasResults ? 0 : -1;
				this.ensureSearchSelectionVisible();
				if (previewLocal) {
					this.applySearchSelection(searchCurrentIndex, { preview: true });
				}
				return;
			}
			if (isKeyJustPressedGlobal(this.playerIndex, 'End')) {
				consumeKeyboardKey(keyboard, 'End');
				const lastIndex = hasResults ? activeSearchMatchCount() - 1 : -1;
				searchCurrentIndex = lastIndex;
				this.ensureSearchSelectionVisible();
				if (previewLocal) {
					this.applySearchSelection(searchCurrentIndex, { preview: true });
				}
				return;
			}
		}

		const textChanged = this.processInlineFieldEditing(searchField, keyboard, {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			deltaSeconds,
			allowSpace: true,
			characterFilter: undefined,
			maxLength: null,
		});

		searchQuery = searchField.text;
		if (textChanged) {
			this.onSearchQueryChanged();
		}
	}

	public handleLineJumpInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
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
		const textChanged = this.processInlineFieldEditing(lineJumpField, keyboard, {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			deltaSeconds,
			allowSpace: false,
			characterFilter: digitFilter,
			maxLength: 6,
		});
		lineJumpValue = lineJumpField.text;
		if (textChanged) {
			// keep value in sync; no additional processing required
		}
	}

	public openSearch(useSelection: boolean, scope: 'local' | 'global' = 'local'): void {
		this.clearReferenceHighlights();
		this.closeSymbolSearch(false);
		this.closeResourceSearch(false);
		this.closeLineJump(false);
		renameController.cancel();
		searchScope = scope;
		searchDisplayOffset = 0;
		searchHoverIndex = -1;
		if (scope === 'global') {
			this.cancelSearchJob();
			searchMatches = [];
			globalSearchMatches = [];
		} else {
			this.cancelGlobalSearchJob();
			globalSearchMatches = [];
		}
		searchVisible = true;
		searchActive = true;
		this.applySearchFieldText(searchQuery, true);
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
		if (!appliedSelection && searchField.text.length === 0) {
			searchCurrentIndex = -1;
		}
		searchQuery = searchField.text;
		this.onSearchQueryChanged();
		this.resetBlink();
	}

	public closeSearch(clearQuery: boolean, forceHide = false): void {
		searchActive = false;
		searchHoverIndex = -1;
		searchDisplayOffset = 0;
		if (clearQuery) {
			this.applySearchFieldText('', true);
		}
		searchQuery = searchField.text;
		const shouldHide = forceHide || clearQuery || searchQuery.length === 0;
		if (shouldHide) {
			searchVisible = false;
			searchScope = 'local';
			searchMatches = [];
			globalSearchMatches = [];
			searchCurrentIndex = -1;
			this.cancelSearchJob();
			this.cancelGlobalSearchJob();
		} else {
			if (searchScope !== 'local') {
				searchScope = 'local';
				this.cancelGlobalSearchJob();
				globalSearchMatches = [];
			}
			searchMatches = [];
			searchCurrentIndex = -1;
			searchVisible = true;
			this.onSearchQueryChanged();
		}
		this.selectionAnchor = null;
		this.resetBlink();
	}

	public focusEditorFromSearch(): void {
		if (!searchActive && !searchVisible) {
			return;
		}
		searchActive = false;
		searchScope = 'local';
		searchDisplayOffset = 0;
		searchHoverIndex = -1;
		this.cancelGlobalSearchJob();
		if (searchQuery.length === 0) {
			searchVisible = false;
			searchMatches = [];
			globalSearchMatches = [];
			searchCurrentIndex = -1;
		} else {
			searchMatches = [];
			globalSearchMatches = [];
			searchCurrentIndex = -1;
		}
		this.selectionAnchor = null;
		searchField.selectionAnchor = null;
		searchField.pointerSelecting = false;
		this.cancelSearchJob();
		this.cancelGlobalSearchJob();
		this.resetBlink();
	}

	public openResourceSearch(initialQuery: string = ''): void {
		this.clearReferenceHighlights();
		this.closeSearch(false, true);
		this.closeLineJump(false);
		this.closeSymbolSearch(false);
		renameController.cancel();
		resourceSearchVisible = true;
		resourceSearchActive = true;
		this.applyResourceSearchFieldText(initialQuery, true);
		this.refreshResourceCatalog();
		this.updateResourceSearchMatches();
		resourceSearchHoverIndex = -1;
		this.resetBlink();
	}

	public closeResourceSearch(clearQuery: boolean): void {
		if (clearQuery) {
			this.applyResourceSearchFieldText('', true);
		}
		resourceSearchActive = false;
		resourceSearchVisible = false;
		resourceSearchMatches = [];
		resourceSearchSelectionIndex = -1;
		resourceSearchDisplayOffset = 0;
		resourceSearchHoverIndex = -1;
		resourceSearchField.selectionAnchor = null;
		resourceSearchField.pointerSelecting = false;
		this.resetBlink();
	}

	public focusEditorFromResourceSearch(): void {
		if (!resourceSearchActive && !resourceSearchVisible) {
			return;
		}
		resourceSearchActive = false;
		if (resourceSearchQuery.length === 0) {
			resourceSearchVisible = false;
			resourceSearchMatches = [];
			resourceSearchSelectionIndex = -1;
			resourceSearchDisplayOffset = 0;
		}
		resourceSearchField.selectionAnchor = null;
		resourceSearchField.pointerSelecting = false;
		this.resetBlink();
	}

	public openSymbolSearch(initialQuery: string = ''): void {
		this.clearReferenceHighlights();
		this.closeSearch(false, true);
		this.closeLineJump(false);
		this.closeResourceSearch(false);
		renameController.cancel();
		symbolSearchMode = 'symbols';
		referenceCatalog = [];
		symbolSearchGlobal = false;
		symbolSearchVisible = true;
		symbolSearchActive = true;
		this.applySymbolSearchFieldText(initialQuery, true);
		this.refreshSymbolCatalog(true);
		this.updateSymbolSearchMatches();
		symbolSearchHoverIndex = -1;
		this.resetBlink();
	}

	public openGlobalSymbolSearch(initialQuery: string = ''): void {
		this.clearReferenceHighlights();
		this.closeSearch(false, true);
		this.closeLineJump(false);
		this.closeResourceSearch(false);
		renameController.cancel();
		symbolSearchMode = 'symbols';
		referenceCatalog = [];
		symbolSearchGlobal = true;
		symbolSearchVisible = true;
		symbolSearchActive = true;
		this.applySymbolSearchFieldText(initialQuery, true);
		this.refreshSymbolCatalog(true);
		this.updateSymbolSearchMatches();
		symbolSearchHoverIndex = -1;
		this.resetBlink();
	}

	public openReferenceSearchPopup(): void {
		const context = this.getActiveCodeTabContext();
		if (symbolSearchVisible || symbolSearchActive) {
			this.closeSymbolSearch(false);
		}
		renameController.cancel();
		const referenceContext = this.buildProjectReferenceContext(context);
		const result = resolveReferenceLookup({
			layout: layout,
			workspace: semanticWorkspace,
			lines: this.lines,
			textVersion: textVersion,
			cursorRow: this.cursorRow,
			cursorColumn: this.cursorColumn,
			extractExpression: (row, column) => this.extractHoverExpression(row, column),
			chunkName: referenceContext.chunkName,
		});
		if (result.kind === 'error') {
			this.showMessage(result.message, constants.COLOR_STATUS_WARNING, result.duration);
			return;
		}
		const { info, initialIndex } = result;
		referenceState.apply(info, initialIndex);
		referenceCatalog = this.buildReferenceCatalogForExpression(info, context);
		if (referenceCatalog.length === 0) {
			this.showMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
			return;
		}
		symbolSearchMode = 'references';
		symbolSearchGlobal = true;
		symbolSearchVisible = true;
		symbolSearchActive = true;
		this.applySymbolSearchFieldText('', true);
		symbolSearchQuery = '';
		this.updateReferenceSearchMatches();
		symbolSearchHoverIndex = -1;
		this.ensureSymbolSearchSelectionVisible();
		this.resetBlink();
		this.showReferenceStatusMessage();
	}

	public openRenamePrompt(): void {
		if (!this.isCodeTabActive()) {
			return;
		}
		this.closeSearch(false, true);
		this.closeLineJump(false);
		this.closeResourceSearch(false);
		this.closeSymbolSearch(false);
		createResourceActive = false;
		const context = this.getActiveCodeTabContext();
		const referenceContext = this.buildProjectReferenceContext(context);
		const started = renameController.begin({
			layout: layout,
			workspace: semanticWorkspace,
			lines: this.lines,
			textVersion: textVersion,
			cursorRow: this.cursorRow,
			cursorColumn: this.cursorColumn,
			extractExpression: (row, column) => this.extractHoverExpression(row, column),
			chunkName: referenceContext.chunkName,
		});
		if (started) {
			cursorVisible = true;
			this.resetBlink();
		}
	}

	public commitRename(payload: RenameCommitPayload): RenameCommitResult {
		const { matches, newName, activeIndex, info } = payload;
		const activeContext = this.getActiveCodeTabContext();
		const referenceContext = this.buildProjectReferenceContext(activeContext);
		const activeChunkName = referenceContext.chunkName;
		const normalizedActiveChunk = this.normalizeChunkReference(activeChunkName) ?? activeChunkName;
		const renameManager = new CrossFileRenameManager(this.getCrossFileRenameDependencies(), semanticWorkspace);
		const sortedMatches = matches.slice();
		sortedMatches.sort((a, b) => {
			if (a.row !== b.row) {
				return a.row - b.row;
			}
			return a.start - b.start;
		});
		let updatedTotal = 0;
		let activeEditsApplied = false;
		if (sortedMatches.length > 0) {
			const edits = planRenameLineEdits(this.lines, sortedMatches, newName);
			if (edits.length > 0) {
				this.prepareUndo('rename', false);
				this.recordEditContext('replace', newName);
				for (let index = 0; index < edits.length; index += 1) {
					const edit = edits[index];
					this.lines[edit.row] = edit.text;
					this.invalidateLine(edit.row);
				}
				this.markTextMutated();
				activeEditsApplied = true;
			}
			const clampedIndex = clamp(activeIndex, 0, sortedMatches.length - 1);
			const match = sortedMatches[clampedIndex];
			const line = this.lines[match.row] ?? '';
			const startColumn = clamp(match.start, 0, line.length);
			const endColumn = clamp(startColumn + newName.length, startColumn, line.length);
			this.cursorRow = match.row;
			this.cursorColumn = startColumn;
			this.selectionAnchor = { row: match.row, column: endColumn };
			this.updateDesiredColumn();
			this.resetBlink();
			cursorRevealSuspended = false;
			this.ensureCursorVisible();
			updatedTotal += sortedMatches.length;
		}
		if (activeEditsApplied) {
			semanticWorkspace.updateFile(activeChunkName, this.lines.join('\n'));
		}
		const decl = info.definitionKey ? semanticWorkspace.getDecl(info.definitionKey) : null;
		const references = info.definitionKey ? semanticWorkspace.getReferences(info.definitionKey) : [];
		type RangeBucket = { chunkName: string; ranges: LuaSourceRange[]; seen: Set<string> };
		const rangeMap = new Map<string, RangeBucket>();
		const addRange = (range: LuaSourceRange | null | undefined): void => {
			if (!range || !range.start || !range.end) {
				return;
			}
			const chunk = range.chunkName ?? activeChunkName;
			const normalized = this.normalizeChunkReference(chunk) ?? chunk;
			let bucket = rangeMap.get(normalized);
			if (!bucket) {
				bucket = { chunkName: chunk, ranges: [], seen: new Set<string>() };
				rangeMap.set(normalized, bucket);
			}
			const key = `${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;
			if (bucket.seen.has(key)) {
				return;
			}
			bucket.seen.add(key);
			bucket.ranges.push(range);
		};
		if (decl) {
			addRange(decl.range);
		}
		for (let index = 0; index < references.length; index += 1) {
			addRange(references[index].range);
		}
		if (normalizedActiveChunk) {
			rangeMap.delete(normalizedActiveChunk);
		}
		for (const bucket of rangeMap.values()) {
			const replacements = renameManager.applyRenameToChunk(bucket.chunkName, bucket.ranges, newName, normalizedActiveChunk);
			updatedTotal += replacements;
			if (replacements > 0) {
				this.markDiagnosticsDirtyForChunk(bucket.chunkName);
			}
		}
		return { updatedMatches: updatedTotal };
	}

	public getCrossFileRenameDependencies(): CrossFileRenameDependencies {
		return {
			normalizeChunkReference: (reference: string | null) => this.normalizeChunkReference(reference),
			findResourceDescriptorForChunk: (chunk: string) => this.findResourceDescriptorForChunk(chunk),
			createLuaCodeTabContext: (descriptor: ConsoleResourceDescriptor) => this.createLuaCodeTabContext(descriptor),
			createEntryTabContext: () => this.createEntryTabContext(),
			getEntryTabId: () => entryTabId,
			setEntryTabId: (id: string | null) => {
				entryTabId = id;
			},
			getPrimaryAssetId: () => primaryAssetId,
			getCodeTabContext: (id: string) => codeTabContexts.get(id) ?? null,
			setCodeTabContext: (context: CodeTabContext) => {
				codeTabContexts.set(context.id, context);
			},
			listCodeTabContexts: () => codeTabContexts.values(),
			splitLines: (source: string) => this.splitLines(source),
			setTabDirty: (tabId: string, dirty: boolean) => this.setTabDirty(tabId, dirty),
		};
	}

	public closeSymbolSearch(clearQuery: boolean): void {
		if (clearQuery) {
			this.applySymbolSearchFieldText('', true);
		}
		symbolSearchActive = false;
		symbolSearchVisible = false;
		symbolSearchGlobal = false;
		symbolSearchMode = 'symbols';
		referenceCatalog = [];
		symbolSearchMatches = [];
		symbolSearchSelectionIndex = -1;
		symbolSearchDisplayOffset = 0;
		symbolSearchHoverIndex = -1;
		symbolSearchField.selectionAnchor = null;
		symbolSearchField.pointerSelecting = false;
		this.resetBlink();
	}

	public focusEditorFromSymbolSearch(): void {
		if (!symbolSearchActive && !symbolSearchVisible) {
			return;
		}
		symbolSearchActive = false;
		if (symbolSearchQuery.length === 0) {
			symbolSearchVisible = false;
			symbolSearchMatches = [];
			symbolSearchSelectionIndex = -1;
			symbolSearchDisplayOffset = 0;
		}
		symbolSearchField.selectionAnchor = null;
		symbolSearchField.pointerSelecting = false;
		this.resetBlink();
	}

	public focusEditorFromRename(): void {
		cursorRevealSuspended = false;
		this.resetBlink();
		this.revealCursor();
		cursorVisible = true;
	}

	public refreshSymbolCatalog(force: boolean): void {
		const scope: 'local' | 'global' = symbolSearchGlobal ? 'global' : 'local';
		let assetId: string | null = null;
		let chunkName: string | null = null;
		if (scope === 'local') {
			const context = this.getActiveCodeTabContext();
			assetId = this.resolveHoverAssetId(context);
			chunkName = this.resolveHoverChunkName(context);
		}
		const existing = symbolCatalogContext;
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
				entries = listGlobalLuaSymbolsFn();
			} else {
				entries = listLuaSymbolsFn(assetId, chunkName);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			symbolCatalog = [];
			symbolSearchMatches = [];
			symbolSearchSelectionIndex = -1;
			symbolSearchDisplayOffset = 0;
			symbolSearchHoverIndex = -1;
			this.showMessage(`Failed to list symbols: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
			return;
		}
		symbolCatalogContext = { scope, assetId, chunkName };
		const deduped: ConsoleLuaSymbolEntry[] = [];
		const seen = new Set<string>();
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const key = symbolCatalogDedupKey(entry);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			deduped.push(entry);
		}
		entries = deduped;
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
		symbolCatalog = catalogEntries;
	}

	public symbolPriority(kind: ConsoleLuaSymbolEntry['kind']): number {
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

	public symbolKindLabel(kind: ConsoleLuaSymbolEntry['kind']): string {
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

	public symbolSourceLabel(entry: ConsoleLuaSymbolEntry): string | null {
		const path = entry.location.path ?? entry.location.assetId ?? null;
		if (!path) {
			return null;
		}
		return computeSourceLabel(path, entry.location.chunkName ?? '<console>');
	}

	public buildReferenceCatalogForExpression(info: ReferenceMatchInfo, context: CodeTabContext | null): ReferenceCatalogEntry[] {
		const descriptor = context?.descriptor ?? null;
		const normalizedPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
		const assetId = descriptor?.assetId ?? primaryAssetId ?? null;
		const chunkName = this.resolveHoverChunkName(context) ?? normalizedPath ?? assetId ?? '<console>';
		const environment: ProjectReferenceEnvironment = {
			activeContext: this.getActiveCodeTabContext(),
			activeLines: this.lines,
			codeTabContexts: Array.from(codeTabContexts.values()),
			listResources: () => this.listResourcesStrict(),
			loadLuaResource: (resourceId: string) => loadLuaResourceFn(resourceId),
		};
		const sourceLabelPath = descriptor?.path ?? descriptor?.assetId ?? null;
		return buildProjectReferenceCatalog({
			workspace: semanticWorkspace,
			info,
			lines: this.lines,
			chunkName,
			assetId,
			environment,
			sourceLabelPath,
		});
	}

	public updateSymbolSearchMatches(): void {
		if (symbolSearchMode === 'references') {
			this.updateReferenceSearchMatches();
			return;
		}
		this.refreshSymbolCatalog(false);
		symbolSearchMatches = [];
		symbolSearchSelectionIndex = -1;
		symbolSearchDisplayOffset = 0;
		symbolSearchHoverIndex = -1;
		if (symbolCatalog.length === 0) {
			return;
		}
		const query = symbolSearchQuery.trim().toLowerCase();
		if (query.length === 0) {
			symbolSearchMatches = symbolCatalog.map(entry => ({ entry, matchIndex: 0 }));
			if (symbolSearchMatches.length > 0) {
				symbolSearchSelectionIndex = 0;
			}
			return;
		}
		const matches: SymbolSearchResult[] = [];
		for (const entry of symbolCatalog) {
			const idx = entry.searchKey.indexOf(query);
			if (idx === -1) {
				continue;
			}
			matches.push({ entry, matchIndex: idx });
		}
		if (matches.length === 0) {
			symbolSearchMatches = [];
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
		symbolSearchMatches = matches;
		symbolSearchSelectionIndex = 0;
		symbolSearchDisplayOffset = 0;
	}

	public updateReferenceSearchMatches(): void {
		const { matches, selectionIndex, displayOffset } = filterReferenceCatalog({
			catalog: referenceCatalog,
			query: symbolSearchQuery,
			state: referenceState,
			pageSize: symbolSearchPageSize(),
		});
		symbolSearchMatches = matches;
		symbolSearchSelectionIndex = selectionIndex;
		symbolSearchDisplayOffset = displayOffset;
		symbolSearchHoverIndex = -1;
	}

	public getActiveSymbolSearchMatch(): SymbolSearchResult | null {
		if (!symbolSearchVisible || symbolSearchMatches.length === 0) {
			return null;
		}
		let index = symbolSearchHoverIndex;
		if (index < 0 || index >= symbolSearchMatches.length) {
			index = symbolSearchSelectionIndex;
		}
		if (index < 0 || index >= symbolSearchMatches.length) {
			return null;
		}
		return symbolSearchMatches[index];
	}

	public ensureSymbolSearchSelectionVisible(): void {
		if (symbolSearchSelectionIndex < 0) {
			symbolSearchDisplayOffset = 0;
			return;
		}
		const maxVisible = symbolSearchPageSize();
		if (symbolSearchSelectionIndex < symbolSearchDisplayOffset) {
			symbolSearchDisplayOffset = symbolSearchSelectionIndex;
		}
		if (symbolSearchSelectionIndex >= symbolSearchDisplayOffset + maxVisible) {
			symbolSearchDisplayOffset = symbolSearchSelectionIndex - maxVisible + 1;
		}
		if (symbolSearchDisplayOffset < 0) {
			symbolSearchDisplayOffset = 0;
		}
		const maxOffset = Math.max(0, symbolSearchMatches.length - maxVisible);
		if (symbolSearchDisplayOffset > maxOffset) {
			symbolSearchDisplayOffset = maxOffset;
		}
	}

	public moveSymbolSearchSelection(delta: number): void {
		if (symbolSearchMatches.length === 0) {
			return;
		}
		let next = symbolSearchSelectionIndex;
		if (next === -1) {
			next = delta > 0 ? 0 : symbolSearchMatches.length - 1;
		} else {
			next = clamp(next + delta, 0, symbolSearchMatches.length - 1);
		}
		if (next === symbolSearchSelectionIndex) {
			return;
		}
		symbolSearchSelectionIndex = next;
		this.ensureSymbolSearchSelectionVisible();
		this.resetBlink();
	}

	public applySymbolSearchSelection(index: number): void {
		if (index < 0 || index >= symbolSearchMatches.length) {
			this.showMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		const match = symbolSearchMatches[index];
		if (symbolSearchMode === 'references') {
			const referenceEntry = match.entry as ReferenceCatalogEntry;
			const symbol = referenceEntry.symbol as ReferenceSymbolEntry;
			const entryIndex = referenceCatalog.indexOf(referenceEntry);
			const expressionLabel = referenceState.getExpression() ?? symbol.name;
			this.closeSymbolSearch(true);
			referenceState.clear();
			this.navigateToLuaDefinition(symbol.location);
			const total = referenceCatalog.length;
			if (entryIndex >= 0 && total > 0) {
				this.showMessage(`Reference ${entryIndex + 1}/${total} for ${expressionLabel}`, constants.COLOR_STATUS_SUCCESS, 1.6);
			} else {
				this.showMessage('Jumped to reference', constants.COLOR_STATUS_SUCCESS, 1.6);
			}
			return;
		}
		const location = match.entry.symbol.location;
		this.closeSymbolSearch(true);
		this.scheduleNextFrame(() => {
			this.navigateToLuaDefinition(location);
		});
	}

	public handleSymbolSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');
		if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			consumeKeyboardKey(keyboard, 'Enter');
			if (shiftDown) {
				this.moveSymbolSearchSelection(-1);
				return;
			}
			if (symbolSearchSelectionIndex >= 0) {
				this.applySymbolSearchSelection(symbolSearchSelectionIndex);
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
			this.moveSymbolSearchSelection(-symbolSearchPageSize());
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageDown');
			this.moveSymbolSearchSelection(symbolSearchPageSize());
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Home')) {
			consumeKeyboardKey(keyboard, 'Home');
			symbolSearchSelectionIndex = symbolSearchMatches.length > 0 ? 0 : -1;
			this.ensureSymbolSearchSelectionVisible();
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'End')) {
			consumeKeyboardKey(keyboard, 'End');
			symbolSearchSelectionIndex = symbolSearchMatches.length > 0 ? symbolSearchMatches.length - 1 : -1;
			this.ensureSymbolSearchSelectionVisible();
			return;
		}
		const textChanged = this.processInlineFieldEditing(symbolSearchField, keyboard, {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			deltaSeconds,
			allowSpace: true,
			characterFilter: undefined,
			maxLength: null,
		});
		symbolSearchQuery = symbolSearchField.text;
		if (textChanged) {
			this.updateSymbolSearchMatches();
		}
	}

	public refreshResourceCatalog(): void {
		let descriptors: ConsoleResourceDescriptor[];
		try {
			descriptors = this.listResourcesStrict();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			resourceCatalog = [];
			resourceSearchMatches = [];
			resourceSearchSelectionIndex = -1;
			resourceSearchDisplayOffset = 0;
			resourceSearchHoverIndex = -1;
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
		resourceCatalog = entries;
	}

	public updateResourceSearchMatches(): void {
		resourceSearchMatches = [];
		resourceSearchSelectionIndex = -1;
		resourceSearchDisplayOffset = 0;
		resourceSearchHoverIndex = -1;
		if (resourceCatalog.length === 0) {
			return;
		}
		const query = resourceSearchQuery.trim().toLowerCase();
		if (query.length === 0) {
			resourceSearchMatches = resourceCatalog.map(entry => ({ entry, matchIndex: 0 }));
			resourceSearchSelectionIndex = -1;
			return;
		}
		const tokens = query.split(/\s+/).filter(token => token.length > 0);
		const matches: ResourceSearchResult[] = [];
		for (const entry of resourceCatalog) {
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
			resourceSearchMatches = [];
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
		resourceSearchMatches = matches;
		resourceSearchSelectionIndex = matches.length > 0 ? 0 : -1;
	}

	public ensureResourceSearchSelectionVisible(): void {
		if (resourceSearchSelectionIndex < 0) {
			resourceSearchDisplayOffset = 0;
			return;
		}
		const windowSize = Math.max(1, resourceSearchWindowCapacity());
		if (resourceSearchSelectionIndex < resourceSearchDisplayOffset) {
			resourceSearchDisplayOffset = resourceSearchSelectionIndex;
		}
		if (resourceSearchSelectionIndex >= resourceSearchDisplayOffset + windowSize) {
			resourceSearchDisplayOffset = resourceSearchSelectionIndex - windowSize + 1;
		}
		if (resourceSearchDisplayOffset < 0) {
			resourceSearchDisplayOffset = 0;
		}
		const maxOffset = Math.max(0, resourceSearchMatches.length - windowSize);
		if (resourceSearchDisplayOffset > maxOffset) {
			resourceSearchDisplayOffset = maxOffset;
		}
	}

	public moveResourceSearchSelection(delta: number): void {
		if (resourceSearchMatches.length === 0) {
			return;
		}
		let next = resourceSearchSelectionIndex;
		if (next === -1) {
			next = delta > 0 ? 0 : resourceSearchMatches.length - 1;
		} else {
			next = clamp(next + delta, 0, resourceSearchMatches.length - 1);
		}
		if (next === resourceSearchSelectionIndex) {
			return;
		}
		resourceSearchSelectionIndex = next;
		this.ensureResourceSearchSelectionVisible();
		this.resetBlink();
	}

	public applyResourceSearchSelection(index: number): void {
		if (index < 0 || index >= resourceSearchMatches.length) {
			this.showMessage('Resource not found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		const match = resourceSearchMatches[index];
		this.closeResourceSearch(true);
		this.scheduleNextFrame(() => {
			this.openResourceDescriptor(match.entry.descriptor);
		});
	}

	public handleResourceSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
		const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');
		if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			consumeKeyboardKey(keyboard, 'Enter');
			if (shiftDown) {
				this.moveResourceSearchSelection(-1);
				return;
			}
			if (resourceSearchSelectionIndex >= 0) {
				this.applyResourceSearchSelection(resourceSearchSelectionIndex);
				return;
			} else {
				const trimmed = resourceSearchQuery.trim();
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
			this.moveResourceSearchSelection(-resourceSearchWindowCapacity());
			return;
		}
		if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageDown');
			this.moveResourceSearchSelection(resourceSearchWindowCapacity());
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Home')) {
			consumeKeyboardKey(keyboard, 'Home');
			resourceSearchSelectionIndex = resourceSearchMatches.length > 0 ? 0 : -1;
			this.ensureResourceSearchSelectionVisible();
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'End')) {
			consumeKeyboardKey(keyboard, 'End');
			resourceSearchSelectionIndex = resourceSearchMatches.length > 0 ? resourceSearchMatches.length - 1 : -1;
			this.ensureResourceSearchSelectionVisible();
			return;
		}
		const textChanged = this.processInlineFieldEditing(resourceSearchField, keyboard, {
			ctrlDown,
			metaDown,
			shiftDown,
			altDown,
			deltaSeconds,
			allowSpace: true,
			characterFilter: undefined,
			maxLength: null,
		});
		resourceSearchQuery = resourceSearchField.text;
		if (textChanged) {
			if (resourceSearchQuery.startsWith('@')) {
				const query = resourceSearchQuery.slice(1).trimStart();
				this.closeResourceSearch(true);
				this.openSymbolSearch(query);
				return;
			}
			if (resourceSearchQuery.startsWith('#')) {
				const query = resourceSearchQuery.slice(1).trimStart();
				this.closeResourceSearch(true);
				this.openGlobalSymbolSearch(query);
				return;
			}
			if (resourceSearchQuery.startsWith(':')) {
				const query = resourceSearchQuery.slice(1).trimStart();
				this.closeResourceSearch(true);
				this.openLineJump();
				if (query.length > 0) {
					this.applyLineJumpFieldText(query, true);
					lineJumpValue = query;
				}
				return;
			}
			this.updateResourceSearchMatches();
		}
	}

	public openLineJump(): void {
		this.clearReferenceHighlights();
		this.closeSymbolSearch(false);
		this.closeResourceSearch(false);
		this.closeSearch(false, true);
		renameController.cancel();
		lineJumpVisible = true;
		lineJumpActive = true;
		this.applyLineJumpFieldText('', true);
		this.resetBlink();
	}

	public closeLineJump(clearValue: boolean): void {
		lineJumpActive = false;
		lineJumpVisible = false;
		if (clearValue) {
			this.applyLineJumpFieldText('', true);
		}
		lineJumpField.selectionAnchor = null;
		lineJumpField.pointerSelecting = false;
		this.resetBlink();
	}

	public focusEditorFromLineJump(): void {
		if (!lineJumpActive && !lineJumpVisible) {
			return;
		}
		lineJumpActive = false;
		lineJumpVisible = false;
		lineJumpField.selectionAnchor = null;
		lineJumpField.pointerSelecting = false;
		this.resetBlink();
	}

	public focusEditorFromProblemsPanel(): void {
		problemsPanel.setFocused(false);
		this.resetBlink();
	}

	public focusEditorFromResourcePanel(): void {
		if (!resourcePanelFocused) {
			return;
		}
		resourcePanelFocused = false;
		this.resetBlink();
	}

	public applyLineJump(): void {
		if (lineJumpValue.length === 0) {
			this.showMessage('Enter a line number', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		const target = Number.parseInt(lineJumpValue, 10);
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

	public onSearchQueryChanged(): void {
		if (searchScope === 'global') {
			this.onGlobalSearchQueryChanged();
			return;
		}
		if (searchQuery.length === 0) {
			this.cancelSearchJob();
			searchMatches = [];
			searchCurrentIndex = -1;
			this.selectionAnchor = null;
			searchDisplayOffset = 0;
			return;
		}
		this.startSearchJob();
	}

	public onGlobalSearchQueryChanged(): void {
		searchDisplayOffset = 0;
		searchHoverIndex = -1;
		searchCurrentIndex = -1;
		if (searchQuery.length === 0) {
			this.cancelGlobalSearchJob();
			globalSearchMatches = [];
			return;
		}
		this.startGlobalSearchJob();
	}

	public focusSearchResult(index: number): void {
		if (index < 0 || index >= searchMatches.length) {
			return;
		}
		const match = searchMatches[index];
		this.cursorRow = match.row;
		this.cursorColumn = match.start;
		this.selectionAnchor = { row: match.row, column: match.end };
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
	}

	public gotoDiagnostic(diagnostic: EditorDiagnostic): void {
		const navigationCheckpoint = this.beginNavigationCapture();
		// Switch to the originating tab if provided
		if (diagnostic.contextId && diagnostic.contextId.length > 0 && diagnostic.contextId !== activeCodeTabContextId) {
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
		cursorRevealSuspended = false;
		this.ensureCursorVisible();
		this.completeNavigation(navigationCheckpoint);
	}

	public jumpToNextMatch(): void {
		if (searchScope === 'global') {
			if (activeSearchMatchCount() === 0) {
				this.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
				return;
			}
			this.moveSearchSelection(1, { wrap: true });
			this.applySearchSelection(searchCurrentIndex);
			return;
		}
		this.ensureSearchJobCompleted();
		if (searchMatches.length === 0) {
			this.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		if (searchCurrentIndex < 0) {
			searchCurrentIndex = 0;
		} else {
			searchCurrentIndex += 1;
			if (searchCurrentIndex >= searchMatches.length) {
				searchCurrentIndex = 0;
			}
		}
		this.focusSearchResult(searchCurrentIndex);
	}

	public jumpToPreviousMatch(): void {
		if (searchScope === 'global') {
			if (activeSearchMatchCount() === 0) {
				this.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
				return;
			}
			this.moveSearchSelection(-1, { wrap: true });
			this.applySearchSelection(searchCurrentIndex);
			return;
		}
		this.ensureSearchJobCompleted();
		if (searchMatches.length === 0) {
			this.showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		if (searchCurrentIndex < 0) {
			searchCurrentIndex = searchMatches.length - 1;
		} else {
			searchCurrentIndex -= 1;
			if (searchCurrentIndex < 0) {
				searchCurrentIndex = searchMatches.length - 1;
			}
		}
		this.focusSearchResult(searchCurrentIndex);
	}

	public startSearchJob(): void {
		this.cancelSearchJob();
		searchDisplayOffset = 0;
		searchHoverIndex = -1;
		const normalized = searchQuery.toLowerCase();
		const job: SearchComputationJob = {
			query: normalized,
			version: textVersion,
			nextRow: 0,
			matches: [],
			firstMatchAfterCursor: -1,
			cursorRow: this.cursorRow,
			cursorColumn: this.cursorColumn,
		};
		searchJob = job;
		searchMatches = [];
		searchCurrentIndex = -1;
		this.selectionAnchor = null;
		this.enqueueBackgroundTask(() => this.runSearchJobSlice(job));
	}

	public runSearchJobSlice(job: SearchComputationJob): boolean {
		if (searchJob !== job) {
			return false;
		}
		if (job.query.length === 0 || job.version !== textVersion || searchQuery.length === 0) {
			searchJob = null;
			return false;
		}
		const rowsPerSlice = 200;
		let processed = 0;
		while (job.nextRow < this.lines.length && processed < rowsPerSlice) {
			const row = job.nextRow;
			job.nextRow += 1;
			processed += 1;
			this.collectSearchMatchesForRow(job, row);
		}
		if (job.nextRow >= this.lines.length) {
			this.completeSearchJob(job);
			return false;
		}
		return true;
	}

	public collectSearchMatchesForRow(job: SearchComputationJob, row: number): void {
		const line = this.lines[row];
		if (!line || line.length === 0) {
			return;
		}
		this.forEachMatchInLine(line, job.query, (start, end) => {
			const match: SearchMatch = { row, start, end };
			job.matches.push(match);
			const matchIndex = job.matches.length - 1;
			if (job.firstMatchAfterCursor === -1) {
				if (row > job.cursorRow || (row === job.cursorRow && start >= job.cursorColumn)) {
					job.firstMatchAfterCursor = matchIndex;
				}
			}
		});
	}

	public forEachMatchInLine(line: string, needle: string, cb: (start: number, end: number) => void): void {
		if (!line || needle.length === 0 || line.length === 0) {
			return;
		}
		const lower = line.toLowerCase();
		const query = needle.toLowerCase();
		if (lower.length < query.length) {
			return;
		}
		let startIndex = 0;
		while (startIndex <= lower.length - query.length) {
			const index = lower.indexOf(query, startIndex);
			if (index === -1) {
				break;
			}
			cb(index, index + query.length);
			startIndex = index + query.length;
		}
	}

	public completeSearchJob(job: SearchComputationJob): void {
		if (searchJob !== job) {
			return;
		}
		searchJob = null;
		searchMatches = job.matches;
		if (job.matches.length === 0) {
			searchCurrentIndex = -1;
			this.selectionAnchor = null;
			searchDisplayOffset = 0;
		} else {
			const index = job.firstMatchAfterCursor >= 0 ? job.firstMatchAfterCursor : 0;
			searchCurrentIndex = clamp(index, 0, job.matches.length - 1);
			this.ensureSearchSelectionVisible();
			this.focusSearchResult(searchCurrentIndex);
		}
	}

	public cancelSearchJob(): void {
		searchJob = null;
	}

	public ensureSearchJobCompleted(): void {
		const job = searchJob;
		if (!job) {
			return;
		}
		while (searchJob === job && this.runSearchJobSlice(job)) {
			// Continue processing synchronously until the job completes.
		}
	}

	public startGlobalSearchJob(): void {
		this.cancelGlobalSearchJob();
		const normalized = searchQuery.toLowerCase();
		if (normalized.length === 0) {
			globalSearchMatches = [];
			return;
		}
		let descriptors: ConsoleResourceDescriptor[] = [];
		try {
			descriptors = this.listResourcesStrict().filter(entry => entry.type === 'lua');
		} catch {
			descriptors = [];
		}
		const job: GlobalSearchJob = {
			query: normalized,
			descriptors,
			descriptorIndex: 0,
			currentLines: null,
			nextRow: 0,
			matches: [],
			limitHit: false,
		};
		globalSearchJob = job;
		globalSearchMatches = [];
		searchCurrentIndex = -1;
		searchDisplayOffset = 0;
		searchHoverIndex = -1;
		this.enqueueBackgroundTask(() => this.runGlobalSearchJobSlice(job));
	}

	public runGlobalSearchJobSlice(job: GlobalSearchJob): boolean {
		if (globalSearchJob !== job) {
			return false;
		}
		if (job.query.length === 0) {
			globalSearchJob = null;
			return false;
		}
		const rowsPerSlice = 200;
		let processed = 0;
		while (job.descriptorIndex < job.descriptors.length && processed < rowsPerSlice && !job.limitHit) {
			if (!job.currentLines) {
				const descriptor = job.descriptors[job.descriptorIndex];
				job.currentLines = this.loadDescriptorLines(descriptor);
				job.nextRow = 0;
				if (!job.currentLines) {
					job.descriptorIndex += 1;
					continue;
				}
			}
			const lines = job.currentLines;
			if (!lines) {
				job.descriptorIndex += 1;
				job.currentLines = null;
				continue;
			}
			while (job.nextRow < lines.length && processed < rowsPerSlice && !job.limitHit) {
				const row = job.nextRow;
				job.nextRow += 1;
				processed += 1;
				const line = lines[row] ?? '';
				this.forEachMatchInLine(line, job.query, (start, end) => {
					if (job.limitHit) {
						return;
					}
					const descriptor = job.descriptors[job.descriptorIndex];
					const match: GlobalSearchMatch = {
						descriptor,
						pathLabel: this.describeDescriptor(descriptor),
						row,
						start,
						end,
						snippet: this.buildSearchSnippet(line, start, end),
						assetId: descriptor.assetId ?? null,
						chunkName: descriptor.path ?? null,
					};
					job.matches.push(match);
					if (job.matches.length >= GLOBAL_SEARCH_RESULT_LIMIT) {
						job.limitHit = true;
					}
				});
			}
			if (job.nextRow >= lines.length) {
				job.currentLines = null;
				job.nextRow = 0;
				job.descriptorIndex += 1;
			}
		}
		if (job.limitHit || job.descriptorIndex >= job.descriptors.length) {
			this.completeGlobalSearchJob(job);
			return false;
		}
		return true;
	}

	public completeGlobalSearchJob(job: GlobalSearchJob): void {
		if (globalSearchJob !== job) {
			return;
		}
		globalSearchJob = null;
		globalSearchMatches = job.matches;
		if (globalSearchMatches.length === 0) {
			searchCurrentIndex = -1;
			searchDisplayOffset = 0;
			return;
		}
		if (searchCurrentIndex < 0 || searchCurrentIndex >= globalSearchMatches.length) {
			searchCurrentIndex = 0;
		}
		this.ensureSearchSelectionVisible();
	}

	public cancelGlobalSearchJob(): void {
		globalSearchJob = null;
	}

	public loadDescriptorLines(descriptor: ConsoleResourceDescriptor): string[] | null {
		try {
			const assetId = descriptor.assetId;
			if (!assetId) {
				return null;
			}
			const source = loadLuaResourceFn(assetId);
			if (typeof source !== 'string') {
				return null;
			}
			return source.split(/\r?\n/);
		} catch {
			return null;
		}
	}

	public describeDescriptor(descriptor: ConsoleResourceDescriptor): string {
		if (descriptor.path && descriptor.path.length > 0) {
			return descriptor.path.replace(/\\/g, '/');
		}
		if (descriptor.assetId && descriptor.assetId.length > 0) {
			return descriptor.assetId;
		}
		return '<resource>';
	}

	public buildSearchSnippet(line: string, start: number, end: number): string {
		if (!line || line.length === 0) {
			return '<blank>';
		}
		const padding = 32;
		const sliceStart = Math.max(0, start - padding);
		const sliceEnd = Math.min(line.length, end + padding);
		let snippet = line.slice(sliceStart, sliceEnd).trim();
		if (sliceStart > 0) {
			snippet = `…${snippet}`;
		}
		if (sliceEnd < line.length) {
			snippet = `${snippet}…`;
		}
		return snippet;
	}

	public getVisibleSearchResultEntries(): Array<{ primary: string; secondary?: string | null; detail?: string | null }> {
		const stats = this.computeSearchPageStats();
		if (stats.visible <= 0) {
			return [];
		}
		const results: Array<{ primary: string; secondary?: string | null; detail?: string | null }> = [];
		for (let i = 0; i < stats.visible; i += 1) {
			const entry = this.buildSearchResultEntry(stats.offset + i);
			if (entry) {
				results.push(entry);
			}
		}
		return results;
	}

	public ensureSearchSelectionVisible(): void {
		const total = activeSearchMatchCount();
		if (total === 0) {
			searchDisplayOffset = 0;
			return;
		}
		if (searchCurrentIndex < 0) {
			searchCurrentIndex = 0;
		}
		const pageSize = searchPageSize();
		if (searchCurrentIndex < searchDisplayOffset) {
			searchDisplayOffset = searchCurrentIndex;
		} else if (searchCurrentIndex >= searchDisplayOffset + pageSize) {
			searchDisplayOffset = searchCurrentIndex - pageSize + 1;
		}
		const maxOffset = Math.max(0, total - pageSize);
		searchDisplayOffset = clamp(searchDisplayOffset, 0, maxOffset);
	}

	public computeSearchPageStats(): { total: number; offset: number; visible: number } {
		const total = this.isSearchVisible() ? activeSearchMatchCount() : 0;
		if (total <= 0) {
			searchDisplayOffset = 0;
			return { total: 0, offset: 0, visible: 0 };
		}
		const pageSize = searchPageSize();
		const maxOffset = Math.max(0, total - 1);
		searchDisplayOffset = clamp(searchDisplayOffset, 0, maxOffset);
		const remaining = total - searchDisplayOffset;
		const visible = Math.min(pageSize, remaining);
		return { total, offset: searchDisplayOffset, visible };
	}

	public buildSearchResultEntry(index: number): { primary: string; secondary?: string | null; detail?: string | null } | null {
		if (searchScope === 'global') {
			const match = globalSearchMatches[index];
			if (!match) {
				return null;
			}
			return {
				primary: match.pathLabel,
				secondary: match.snippet,
				detail: `:${match.row + 1}`,
			};
		}
		const match = searchMatches[index];
		if (!match) {
			return null;
		}
		const lineText = this.lines[match.row] ?? '';
		return {
			primary: `Line ${match.row + 1}`,
			secondary: this.buildSearchSnippet(lineText, match.start, match.end),
			detail: null,
		};
	}

	public moveSearchSelection(delta: number, options?: { wrap?: boolean; preview?: boolean }): void {
		const total = activeSearchMatchCount();
		if (total === 0) {
			return;
		}
		let next = searchCurrentIndex;
		if (next === -1) {
			next = delta > 0 ? 0 : total - 1;
		} else {
			next += delta;
		}
		if (options?.wrap) {
			next = ((next % total) + total) % total;
		} else {
			next = clamp(next, 0, total - 1);
		}
		if (next === searchCurrentIndex) {
			if (options?.preview) {
				this.applySearchSelection(next, { preview: true });
			}
			return;
		}
		searchCurrentIndex = next;
		this.ensureSearchSelectionVisible();
		if (options?.preview) {
			this.applySearchSelection(next, { preview: true });
		}
	}

	public applySearchSelection(index: number, options?: { preview?: boolean }): void {
		const total = activeSearchMatchCount();
		if (total === 0) {
			return;
		}
		let targetIndex = index;
		if (targetIndex < 0 || targetIndex >= total) {
			targetIndex = clamp(targetIndex, 0, total - 1);
			searchCurrentIndex = targetIndex;
		}
		searchCurrentIndex = targetIndex;
		if (searchScope === 'global') {
			if (options?.preview) {
				return;
			}
			this.focusGlobalSearchResult(targetIndex, options?.preview === true);
		} else {
			this.focusSearchResult(targetIndex);
		}
	}

	public focusGlobalSearchResult(index: number, previewOnly: boolean = false): void {
		const match = globalSearchMatches[index];
		if (!match) {
			if (!previewOnly) {
				this.showMessage('Search result unavailable', constants.COLOR_STATUS_WARNING, 1.5);
			}
			return;
		}
		if (previewOnly) {
			return;
		}
		if (match.descriptor) {
			this.openLuaCodeTab(match.descriptor);
		} else {
			this.activateCodeTab();
		}
		this.scheduleNextFrame(() => {
			const row = clamp(match.row, 0, Math.max(0, this.lines.length - 1));
			const line = this.lines[row] ?? '';
			const endColumn = Math.min(match.end, line.length);
			this.cursorRow = row;
			this.cursorColumn = clamp(match.start, 0, line.length);
			this.selectionAnchor = { row, column: endColumn };
			this.ensureCursorVisible();
			this.resetBlink();
		});
	}

	public showReferenceStatusMessage(): void {
		const matches = referenceState.getMatches();
		const activeIndex = referenceState.getActiveIndex();
		if (matches.length === 0 || activeIndex < 0) {
			return;
		}
		const label = referenceState.getExpression() ?? '';
		this.showMessage(`Reference ${activeIndex + 1}/${matches.length} for ${label}`, constants.COLOR_STATUS_SUCCESS, 1.6);
	}

	public handlePointerInput(_deltaSeconds: number): void {
		const ctrlDown = isModifierPressedGlobal(this.playerIndex, 'ControlLeft') || isModifierPressedGlobal(this.playerIndex, 'ControlRight');
		const metaDown = isModifierPressedGlobal(this.playerIndex, 'MetaLeft') || isModifierPressedGlobal(this.playerIndex, 'MetaRight');
		const gotoModifierActive = ctrlDown || metaDown;
		if (!gotoModifierActive) {
			this.clearGotoHoverHighlight();
		}
		const activeContext = this.getActiveCodeTabContext();
		const snapshot = this.readPointerSnapshot();
		this.updateTabHoverState(snapshot);
		lastPointerSnapshot = snapshot && snapshot.valid ? snapshot : null;
		if (!snapshot) {
			pointerPrimaryWasPressed = false;
			scrollbarController.cancel();
			lastPointerRowResolution = null;
			this.clearHoverTooltip();
			this.clearGotoHoverHighlight();
			return;
		}
		if (!snapshot.valid) {
			scrollbarController.cancel();
			this.clearGotoHoverHighlight();
			lastPointerRowResolution = null;
		} else if (scrollbarController.hasActiveDrag() && !snapshot.primaryPressed) {
			scrollbarController.cancel();
		} else if (scrollbarController.hasActiveDrag() && snapshot.primaryPressed) {
			if (scrollbarController.update(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, (k, s) => this.applyScrollbarScroll(k, s))) {
				pointerSelecting = false;
				this.clearHoverTooltip();
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				return;
			}
		}
		if (!snapshot.primaryPressed) {
			searchField.pointerSelecting = false;
			symbolSearchField.pointerSelecting = false;
			resourceSearchField.pointerSelecting = false;
			lineJumpField.pointerSelecting = false;
			createResourceField.pointerSelecting = false;
			symbolSearchHoverIndex = -1;
			resourceSearchHoverIndex = -1;
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
				pointerAuxJustPressed = !pointerAuxWasPressed;
			}
		}
		pointerAuxWasPressed = pointerAuxPressed;
		const wasPressed = pointerPrimaryWasPressed;
		const justPressed = snapshot.primaryPressed && !wasPressed;
		const justReleased = !snapshot.primaryPressed && wasPressed;
		if (justReleased || (!snapshot.primaryPressed && pointerSelecting)) {
			pointerSelecting = false;
		}
		if (tabDragState) {
			if (!snapshot.primaryPressed) {
				this.endTabDrag();
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearGotoHoverHighlight();
				this.clearHoverTooltip();
				return;
			}
			if (snapshot.valid) {
				this.updateTabDrag(snapshot.viewportX, snapshot.viewportY);
			}
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearGotoHoverHighlight();
			this.clearHoverTooltip();
			return;
		}
		if (justPressed && scrollbarController.begin(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, this.bottomMargin, (k, s) => this.applyScrollbarScroll(k, s))) {
			pointerSelecting = false;
			this.clearHoverTooltip();
			this.clearGotoHoverHighlight();
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			return;
		}
		if (resourcePanelResizing && !snapshot.valid) {
			resourcePanelResizing = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearGotoHoverHighlight();
			return;
		}
		if (!snapshot.valid) {
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearHoverTooltip();
			this.clearGotoHoverHighlight();
			return;
		}
		if (resourcePanelResizing) {
			if (!snapshot.primaryPressed) {
				resourcePanelResizing = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
			} else {
				const ok = resourcePanel.setRatioFromViewportX(snapshot.viewportX, viewportWidth);
				if (!ok) {
					this.hideResourcePanel();
				} else {
					this.invalidateVisualLines();
					/* hscroll handled inside controller */
				}
				resourcePanelFocused = true;
				pointerSelecting = false;
				this.resetPointerClickTracking();
				pointerPrimaryWasPressed = snapshot.primaryPressed;
			}
			this.clearGotoHoverHighlight();
			return;
		}
		if (problemsPanelResizing) {
			if (!snapshot.primaryPressed) {
				problemsPanelResizing = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
			} else {
				this.setProblemsPanelHeightFromViewportY(snapshot.viewportY);
				pointerSelecting = false;
				this.resetPointerClickTracking();
				pointerPrimaryWasPressed = snapshot.primaryPressed;
			}
			this.clearGotoHoverHighlight();
			return;
		}
		if (justPressed && snapshot.viewportY >= 0 && snapshot.viewportY < headerHeight) {
			if (this.handleTopBarPointer(snapshot)) {
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.resetPointerClickTracking();
				this.clearGotoHoverHighlight();
				return;
			}
		}
		if (resourcePanelVisible && justPressed && this.isPointerOverResourcePanelDivider(snapshot.viewportX, snapshot.viewportY)) {
			if (this.getResourcePanelWidth() > 0) {
				resourcePanelResizing = true;
				resourcePanelFocused = true;
				pointerSelecting = false;
				this.resetPointerClickTracking();
				pointerPrimaryWasPressed = snapshot.primaryPressed;
			}
			this.clearGotoHoverHighlight();
			return;
		}
		if (justPressed && problemsPanel.isVisible() && this.isPointerOverProblemsPanelDivider(snapshot.viewportX, snapshot.viewportY)) {
			problemsPanelResizing = true;
			pointerSelecting = false;
			this.resetPointerClickTracking();
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearGotoHoverHighlight();
			return;
		}
		const tabTop = headerHeight;
		const tabBottom = tabTop + this.getTabBarTotalHeight();
		if (pointerAuxJustPressed && this.handleTabBarMiddleClick(snapshot)) {
			if (playerInput) {
				playerInput.consumeAction('pointer_aux');
			}
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.resetPointerClickTracking();
			this.clearGotoHoverHighlight();
			return;
		}
		if (justPressed && snapshot.viewportY >= tabTop && snapshot.viewportY < tabBottom) {
			if (this.handleTabBarPointer(snapshot)) {
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.resetPointerClickTracking();
				this.clearGotoHoverHighlight();
				return;
			}
		}
		const panelBounds = resourcePanel.getBounds();
		const pointerInPanel = resourcePanelVisible
			&& panelBounds !== null
			&& this.pointInRect(snapshot.viewportX, snapshot.viewportY, panelBounds);
		if (pointerInPanel) {
			resourcePanel.setFocused(true);
			this.resetPointerClickTracking();
			this.clearHoverTooltip();
			const margin = Math.max(4, lineHeight);
			if (snapshot.viewportY < panelBounds.top + margin) {
				resourcePanel.scrollBy(-1);
			} else if (snapshot.viewportY >= panelBounds.bottom - margin) {
				resourcePanel.scrollBy(1);
			}
			const hoverIndex = resourcePanel.indexAtPosition(snapshot.viewportX, snapshot.viewportY);
			resourcePanel.setHoverIndex(hoverIndex);
			if (hoverIndex >= 0) {
				if (hoverIndex !== resourceBrowserSelectionIndex) {
					resourcePanel.setSelectionIndex(hoverIndex);
				}
				if (justPressed) {
					resourcePanel.openSelected();
					resourcePanel.setFocused(false);
				}
			}
			if (!snapshot.primaryPressed && hoverIndex === -1) {
				resourcePanel.setHoverIndex(-1);
			}
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearGotoHoverHighlight();
			const s = resourcePanel.getStateForRender();
			resourcePanelFocused = s.focused;
			resourceBrowserSelectionIndex = s.selectionIndex;
			return;
		}
		if (justPressed && !pointerInPanel) {
			resourcePanel.setFocused(false);
		}
		if (resourcePanelVisible && !snapshot.primaryPressed) {
			resourcePanel.setHoverIndex(-1);
		}
		const problemsBounds = this.getProblemsPanelBounds();
		if (problemsPanel.isVisible() && problemsBounds) {
			const insideProblems = this.pointInRect(snapshot.viewportX, snapshot.viewportY, problemsBounds);
			if (insideProblems) {
				if (problemsPanel.handlePointer(snapshot, justPressed, justReleased, problemsBounds)) {
					pointerSelecting = false;
					pointerPrimaryWasPressed = snapshot.primaryPressed;
					this.resetPointerClickTracking();
					this.clearHoverTooltip();
					this.clearGotoHoverHighlight();
					return;
				}
			} else if (justPressed) {
				problemsPanel.setFocused(false);
			}
		}
		if (this.isResourceViewActive()) {
			this.resetPointerClickTracking();
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearHoverTooltip();
			this.clearGotoHoverHighlight();
			return;
		}
		if (pendingActionPrompt) {
			this.resetPointerClickTracking();
			if (justPressed) {
				this.handleActionPromptPointer(snapshot);
			}
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearHoverTooltip();
			this.clearGotoHoverHighlight();
			return;
		}
		const createResourceBounds = this.getCreateResourceBarBounds();
		if (createResourceVisible && createResourceBounds) {
			const insideCreateBar = this.pointInRect(snapshot.viewportX, snapshot.viewportY, createResourceBounds);
			if (insideCreateBar) {
				if (justPressed) {
					createResourceActive = true;
					cursorVisible = true;
					this.resetBlink();
					resourcePanelFocused = false;
				}
				const label = 'NEW FILE:';
				const labelX = 4;
				const textLeft = labelX + this.measureText(label + ' ');
				this.processInlineFieldPointer(createResourceField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearHoverTooltip();
				this.clearGotoHoverHighlight();
				return;
			}
			if (justPressed) {
				createResourceActive = false;
			}
		}
		const resourceSearchBounds = this.getResourceSearchBarBounds();
		if (resourceSearchVisible && resourceSearchBounds) {
			const insideResourceSearch = this.pointInRect(snapshot.viewportX, snapshot.viewportY, resourceSearchBounds);
			if (insideResourceSearch) {
				const baseHeight = lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
				const fieldBottom = resourceSearchBounds.top + baseHeight;
				const resultsStart = fieldBottom + constants.QUICK_OPEN_RESULT_SPACING;
				if (snapshot.viewportY < fieldBottom) {
					if (justPressed) {
						this.closeLineJump(false);
						this.closeSearch(false, true);
						this.closeSymbolSearch(false);
						resourceSearchVisible = true;
						resourceSearchActive = true;
						resourcePanelFocused = false;
						cursorVisible = true;
						this.resetBlink();
					}
					const label = 'FILE :';
					const labelX = 4;
					const textLeft = labelX + this.measureText(label + ' ');
					this.processInlineFieldPointer(resourceSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
					pointerSelecting = false;
					pointerPrimaryWasPressed = snapshot.primaryPressed;
					this.clearHoverTooltip();
					this.clearGotoHoverHighlight();
					return;
				}
				const rowHeight = resourceSearchEntryHeight();
				const visibleCount = resourceSearchVisibleResultCount();
				let hoverIndex = -1;
				if (snapshot.viewportY >= resultsStart) {
					const relative = snapshot.viewportY - resultsStart;
					const indexWithin = Math.floor(relative / rowHeight);
					if (indexWithin >= 0 && indexWithin < visibleCount) {
						hoverIndex = resourceSearchDisplayOffset + indexWithin;
					}
				}
				resourceSearchHoverIndex = hoverIndex;
				if (hoverIndex >= 0 && justPressed) {
					if (hoverIndex !== resourceSearchSelectionIndex) {
						resourceSearchSelectionIndex = hoverIndex;
						this.ensureResourceSearchSelectionVisible();
					}
					this.applyResourceSearchSelection(hoverIndex);
					pointerSelecting = false;
					pointerPrimaryWasPressed = snapshot.primaryPressed;
					this.clearHoverTooltip();
					this.clearGotoHoverHighlight();
					return;
				}
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearHoverTooltip();
				this.clearGotoHoverHighlight();
				return;
			}
			if (justPressed) {
				resourceSearchActive = false;
			}
			resourceSearchHoverIndex = -1;
		}
		const symbolBounds = this.getSymbolSearchBarBounds();
		if (symbolSearchVisible && symbolBounds) {
			const insideSymbol = this.pointInRect(snapshot.viewportX, snapshot.viewportY, symbolBounds);
			if (insideSymbol) {
				const baseHeight = lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
				const fieldBottom = symbolBounds.top + baseHeight;
				const resultsStart = fieldBottom + constants.SYMBOL_SEARCH_RESULT_SPACING;
				if (snapshot.viewportY < fieldBottom) {
					if (justPressed) {
						this.closeLineJump(false);
						this.closeSearch(false, true);
						symbolSearchVisible = true;
						symbolSearchActive = true;
						resourcePanelFocused = false;
						cursorVisible = true;
						this.resetBlink();
					}
					const label = symbolSearchGlobal ? 'SYMBOL #:' : 'SYMBOL @:';
					const labelX = 4;
					const textLeft = labelX + this.measureText(label + ' ');
					this.processInlineFieldPointer(symbolSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
					pointerSelecting = false;
					pointerPrimaryWasPressed = snapshot.primaryPressed;
					this.clearHoverTooltip();
					this.clearGotoHoverHighlight();
					return;
				}
				const visibleCount = symbolSearchVisibleResultCount();
				let hoverIndex = -1;
				if (snapshot.viewportY >= resultsStart) {
					const relative = snapshot.viewportY - resultsStart;
					const entryHeight = symbolSearchEntryHeight();
					const indexWithin = entryHeight > 0 ? Math.floor(relative / entryHeight) : -1;
					if (indexWithin >= 0 && indexWithin < visibleCount) {
						hoverIndex = symbolSearchDisplayOffset + indexWithin;
					}
				}
				symbolSearchHoverIndex = hoverIndex;
				if (hoverIndex >= 0 && justPressed) {
					if (hoverIndex !== symbolSearchSelectionIndex) {
						symbolSearchSelectionIndex = hoverIndex;
						this.ensureSymbolSearchSelectionVisible();
					}
					this.applySymbolSearchSelection(hoverIndex);
					pointerSelecting = false;
					pointerPrimaryWasPressed = snapshot.primaryPressed;
					this.clearHoverTooltip();
					this.clearGotoHoverHighlight();
					return;
				}
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearHoverTooltip();
				this.clearGotoHoverHighlight();
				return;
			}
			if (justPressed) {
				symbolSearchActive = false;
			}
			symbolSearchHoverIndex = -1;
		}

		const renameBounds = this.getRenameBarBounds();
		if (this.isRenameVisible() && renameBounds) {
			const insideRename = this.pointInRect(snapshot.viewportX, snapshot.viewportY, renameBounds);
			if (insideRename) {
				if (justPressed) {
					resourcePanelFocused = false;
					cursorVisible = true;
					this.resetBlink();
				}
				const label = 'RENAME:';
				const labelX = 4;
				const textLeft = labelX + this.measureText(label + ' ');
				this.processInlineFieldPointer(renameController.getField(), textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearHoverTooltip();
				this.clearGotoHoverHighlight();
				return;
			}
			if (justPressed) {
				renameController.cancel();
			}
		}

		const lineJumpBounds = this.getLineJumpBarBounds();
		if (lineJumpVisible && lineJumpBounds) {
			const insideLineJump = this.pointInRect(snapshot.viewportX, snapshot.viewportY, lineJumpBounds);
			if (insideLineJump) {
				if (justPressed) {
					this.closeSearch(false, true);
					lineJumpActive = true;
					this.resetBlink();
				}
				const label = 'LINE #:';
				const labelX = 4;
				const textLeft = labelX + this.measureText(label + ' ');
				this.processInlineFieldPointer(lineJumpField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.clearHoverTooltip();
				this.clearGotoHoverHighlight();
				return;
			}
			if (justPressed) {
				lineJumpActive = false;
			}
		}
		const searchBounds = this.getSearchBarBounds();
		if (searchVisible && searchBounds) {
			const insideSearch = this.pointInRect(snapshot.viewportX, snapshot.viewportY, searchBounds);
			const baseHeight = lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
			const fieldBottom = searchBounds.top + baseHeight;
			const visibleResults = searchVisibleResultCount();
			if (insideSearch) {
				searchHoverIndex = -1;
				if (snapshot.viewportY < fieldBottom) {
					if (justPressed) {
						this.closeLineJump(false);
						searchVisible = true;
						searchActive = true;
						resourcePanelFocused = false;
						cursorVisible = true;
						this.resetBlink();
					}
					const label = searchScope === 'global' ? 'SEARCH ALL:' : 'SEARCH:';
					const labelX = 4;
					const textLeft = labelX + this.measureText(label + ' ');
					this.processInlineFieldPointer(searchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
					pointerSelecting = false;
					pointerPrimaryWasPressed = snapshot.primaryPressed;
					this.clearHoverTooltip();
					this.clearGotoHoverHighlight();
					return;
				}
				if (visibleResults > 0) {
					const resultsStart = fieldBottom + constants.SEARCH_RESULT_SPACING;
					const rowHeight = searchResultEntryHeight();
					let hoverIndex = -1;
					if (snapshot.viewportY >= resultsStart) {
						const relative = snapshot.viewportY - resultsStart;
						const indexWithin = Math.floor(relative / rowHeight);
						if (indexWithin >= 0 && indexWithin < visibleResults) {
							hoverIndex = searchDisplayOffset + indexWithin;
						}
					}
					searchHoverIndex = hoverIndex;
					if (hoverIndex >= 0 && justPressed) {
						if (hoverIndex !== searchCurrentIndex) {
							searchCurrentIndex = hoverIndex;
							this.ensureSearchSelectionVisible();
							if (searchScope === 'local') {
								this.applySearchSelection(hoverIndex, { preview: true });
							}
						}
						this.applySearchSelection(hoverIndex);
						pointerSelecting = false;
						pointerPrimaryWasPressed = snapshot.primaryPressed;
						this.clearHoverTooltip();
						this.clearGotoHoverHighlight();
						return;
					}
					pointerSelecting = false;
					pointerPrimaryWasPressed = snapshot.primaryPressed;
					this.clearHoverTooltip();
					this.clearGotoHoverHighlight();
					return;
				}
			} else if (justPressed) {
				searchActive = false;
				searchHoverIndex = -1;
			}
		} else {
			searchHoverIndex = -1;
		}

		const bounds = this.getCodeAreaBounds();
		if (this.processRuntimeErrorOverlayPointer(snapshot, justPressed, bounds.codeTop, bounds.codeRight, bounds.textLeft)) {
			// Keep primary pressed state in sync when overlay handles the event
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			return;
		}
		const insideCodeArea = snapshot.viewportY >= bounds.codeTop
			&& snapshot.viewportY < bounds.codeBottom
			&& snapshot.viewportX >= bounds.codeLeft
			&& snapshot.viewportX < bounds.codeRight;
		if (justPressed && insideCodeArea) {
			this.clearReferenceHighlights();
			resourcePanelFocused = false;
			this.focusEditorFromLineJump();
			this.focusEditorFromSearch();
			this.focusEditorFromResourceSearch();
			this.focusEditorFromSymbolSearch();
			completion.closeSession();
			const targetRow = this.resolvePointerRow(snapshot.viewportY);
			const targetColumn = this.resolvePointerColumn(targetRow, snapshot.viewportX);
			if (gotoModifierActive && this.tryGotoDefinitionAt(targetRow, targetColumn)) {
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				this.resetPointerClickTracking();
				return;
			}
			const doubleClick = this.registerPointerClick(targetRow, targetColumn);
			if (doubleClick) {
				this.selectWordAtPosition(targetRow, targetColumn);
				pointerSelecting = false;
			} else {
				this.selectionAnchor = { row: targetRow, column: targetColumn };
				this.setCursorPosition(targetRow, targetColumn);
				pointerSelecting = true;
			}
		}
		if (pointerSelecting && snapshot.primaryPressed) {
			this.clearGotoHoverHighlight();
			this.handlePointerAutoScroll(snapshot.viewportX, snapshot.viewportY);
			const targetRow = this.resolvePointerRow(snapshot.viewportY);
			const targetColumn = this.resolvePointerColumn(targetRow, snapshot.viewportX);
			if (!this.selectionAnchor) {
				this.selectionAnchor = { row: targetRow, column: targetColumn };
			}
			this.setCursorPosition(targetRow, targetColumn);
		}
		if (this.isCodeTabActive() && !snapshot.primaryPressed && !pointerSelecting && insideCodeArea && gotoModifierActive) {
			const hoverRow = this.resolvePointerRow(snapshot.viewportY);
			const hoverColumn = this.resolvePointerColumn(hoverRow, snapshot.viewportX);
			this.refreshGotoHoverHighlight(hoverRow, hoverColumn, activeContext);
		} else if (!gotoModifierActive || !insideCodeArea || snapshot.primaryPressed || pointerSelecting || !this.isCodeTabActive()) {
			this.clearGotoHoverHighlight();
		}
		if (this.isCodeTabActive()) {
			const altDown = isModifierPressedGlobal(this.playerIndex, 'AltLeft') || isModifierPressedGlobal(this.playerIndex, 'AltRight');
			if (!snapshot.primaryPressed && !pointerSelecting && insideCodeArea && altDown) {
				this.updateHoverTooltip(snapshot);
			} else {
				this.clearHoverTooltip();
			}
		} else {
			this.clearHoverTooltip();
		}
		pointerPrimaryWasPressed = snapshot.primaryPressed;
	}

	public updateTabHoverState(snapshot: PointerSnapshot | null): void {
		if (!snapshot || !snapshot.valid || !snapshot.insideViewport) {
			tabHoverId = null;
			return;
		}
		const tabTop = headerHeight;
		const tabBottom = tabTop + this.getTabBarTotalHeight();
		const y = snapshot.viewportY;
		if (y < tabTop || y >= tabBottom) {
			tabHoverId = null;
			return;
		}
		const x = snapshot.viewportX;
		let hovered: string | null = null;
		for (const [tabId, bounds] of tabButtonBounds) {
			if (this.pointInRect(x, y, bounds)) {
				hovered = tabId;
				break;
			}
		}
		tabHoverId = hovered;
	}

	public updateHoverTooltip(snapshot: PointerSnapshot): void {
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
		const previousInspection = lastInspectorResult;
		lastInspectorResult = inspection;
		if (!inspection) {
			this.clearHoverTooltip();
			return;
		}
		if (inspection.isFunction && (inspection.isLocalFunction || inspection.isBuiltin)) {
			this.clearHoverTooltip();
			return;
		}
		const contentLines = this.buildHoverContentLines(inspection);
		const existing = hoverTooltip;
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
		hoverTooltip = {
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

	public buildHoverContentLines(result: ConsoleLuaHoverResult): string[] {
		return buildHoverContentLinesExternal(result);
	}

	public clearHoverTooltip(): void {
		hoverTooltip = null;
		lastInspectorResult = null;
	}

	// Scrollbar drag is handled via scrollbarController

	public applyScrollbarScroll(kind: ScrollbarKind, scroll: number): void {
		if (Number.isNaN(scroll)) {
			return;
		}
		switch (kind) {
			case 'codeVertical': {
				this.ensureVisualLines();
				const rowCount = Math.max(1, cachedVisibleRowCount);
				const maxScroll = Math.max(0, this.getVisualLineCount() - rowCount);
				this.scrollRow = clamp(Math.round(scroll), 0, maxScroll);
				cursorRevealSuspended = true;
				break;
			}
			case 'codeHorizontal': {
				if (wordWrapEnabled) {
					this.scrollColumn = 0;
					break;
				}
				const maxScroll = this.computeMaximumScrollColumn();
				this.scrollColumn = clamp(Math.round(scroll), 0, maxScroll);
				cursorRevealSuspended = true;
				break;
			}
			case 'resourceVertical': {
				resourcePanel.setScroll(scroll);
				resourcePanel.setFocused(true);
				const s = resourcePanel.getStateForRender();
				resourcePanelFocused = s.focused;
				break;
			}
			case 'resourceHorizontal': {
				resourcePanel.setHScroll(scroll);
				resourcePanel.setFocused(true);
				const s = resourcePanel.getStateForRender();
				resourcePanelFocused = s.focused;
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

	public adjustHoverTooltipScroll(stepCount: number): boolean {
		if (!hoverTooltip) {
			return false;
		}
		if (stepCount === 0) {
			return false;
		}
		const tooltip = hoverTooltip;
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

	public isPointInHoverTooltip(x: number, y: number): boolean {
		const tooltip = hoverTooltip;
		if (!tooltip || !tooltip.bubbleBounds) {
			return false;
		}
		return this.pointInRect(x, y, tooltip.bubbleBounds);
	}

	public pointerHitsHoverTarget(snapshot: PointerSnapshot, tooltip: CodeHoverTooltip): boolean {
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

	public resolveHoverAssetId(context: CodeTabContext | null): string | null {
		if (context && context.descriptor) {
			return context.descriptor.assetId;
		}
		return primaryAssetId;
	}

	public resolveHoverChunkName(context: CodeTabContext | null): string | null {
		if (context && context.descriptor) {
			if (context.descriptor.path && context.descriptor.path.length > 0) {
				return context.descriptor.path;
			}
			if (context.descriptor.assetId && context.descriptor.assetId.length > 0) {
				return context.descriptor.assetId;
			}
		}
		if (primaryAssetId) {
			return primaryAssetId;
		}
		return null;
	}

	public buildProjectReferenceContext(context: CodeTabContext | null): {
		environment: ProjectReferenceEnvironment;
		chunkName: string;
		normalizedPath: string | null;
		assetId: string | null;
	} {
		const descriptor = context?.descriptor ?? null;
		const normalizedPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
		const descriptorAssetId = descriptor?.assetId ?? null;
		const resolvedAssetId = descriptorAssetId ?? primaryAssetId ?? null;
		const resolvedChunk = this.resolveHoverChunkName(context)
			?? normalizedPath
			?? descriptorAssetId
			?? resolvedAssetId
			?? '<console>';
		const environment: ProjectReferenceEnvironment = {
			activeContext: context,
			activeLines: this.lines,
			codeTabContexts: Array.from(codeTabContexts.values()),
			listResources: () => this.listResourcesStrict(),
			loadLuaResource: (resourceId: string) => loadLuaResourceFn(resourceId),
		};
		return {
			environment,
			chunkName: resolvedChunk,
			normalizedPath,
			assetId: resolvedAssetId,
		};
	}

	public resolveSemanticDefinitionLocation(
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
		const activeContext = this.getActiveCodeTabContext();
		const hoverChunkName = this.resolveHoverChunkName(activeContext);
		const modelChunkName = chunkName ?? hoverChunkName ?? '<console>';
		const model = layout.getSemanticModel(this.lines, textVersion, modelChunkName);
		if (!model) {
			return null;
		}
		let definition = model.lookupIdentifier(usageRow, usageColumn, namePath);
		if (!definition) {
			definition = this.findDefinitionAtPosition(model.definitions, usageRow, usageColumn, namePath);
		}
		if (!definition) {
			return null;
		}
		const descriptor = context?.descriptor ?? null;
		const descriptorPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
		const descriptorAssetId = descriptor?.assetId ?? null;
		const resolvedAssetId = descriptorAssetId ?? assetId ?? primaryAssetId ?? null;
		const resolvedChunk = chunkName
			?? descriptorPath
			?? descriptorAssetId
			?? assetId
			?? primaryAssetId
			?? hoverChunkName
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

	public findDefinitionAtPosition(
		definitions: readonly LuaDefinitionInfo[],
		row: number,
		column: number,
		namePath: readonly string[],
	): LuaDefinitionInfo | null {
		for (let index = 0; index < definitions.length; index += 1) {
			const candidate = definitions[index];
			if (candidate.namePath.length !== namePath.length) {
				continue;
			}
			let matches = true;
			for (let i = 0; i < namePath.length; i += 1) {
				if (candidate.namePath[i] !== namePath[i]) {
					matches = false;
					break;
				}
			}
			if (!matches) {
				continue;
			}
			const range = candidate.definition;
			if (row !== range.start.line) {
				continue;
			}
			if (column < range.start.column || column > range.end.column) {
				continue;
			}
			return candidate;
		}
		return null;
	}

	public extractHoverExpression(row: number, column: number): { expression: string; startColumn: number; endColumn: number } | null {
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

	public refreshGotoHoverHighlight(row: number, column: number, context: CodeTabContext | null): void {
		const token = this.extractHoverExpression(row, column);
		if (!token) {
			this.clearGotoHoverHighlight();
			return;
		}
		const existing = gotoHoverHighlight;
		if (existing
			&& existing.row === row
			&& column >= existing.startColumn
			&& column <= existing.endColumn
			&& existing.expression === token.expression) {
			return;
		}
		const assetId = this.resolveHoverAssetId(context);
		const chunkName = this.resolveHoverChunkName(context);
		let definition = this.resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, assetId, chunkName);
		if (!definition) {
			const inspection = this.safeInspectLuaExpression({
				assetId,
				expression: token.expression,
				chunkName,
				row: row + 1,
				column: token.startColumn + 1,
			});
			definition = inspection?.definition ?? null;
		}
		if (!definition) {
			this.clearGotoHoverHighlight();
			return;
		}
		gotoHoverHighlight = {
			row,
			startColumn: token.startColumn,
			endColumn: token.endColumn,
			expression: token.expression,
		};
	}

	public clearGotoHoverHighlight(): void {
		gotoHoverHighlight = null;
	}

	public clearReferenceHighlights(): void {
		referenceState.clear();
	}

	public tryGotoDefinitionAt(row: number, column: number): boolean {
		const context = this.getActiveCodeTabContext();
		const descriptor = context?.descriptor ?? null;
		const normalizedPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
		const assetId = this.resolveHoverAssetId(context);
		const token = this.extractHoverExpression(row, column);
		if (!token) {
			this.showMessage('Definition not found', constants.COLOR_STATUS_WARNING, 1.6);
			return false;
		}
		const chunkName = this.resolveHoverChunkName(context);
		let definition = this.resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, assetId, chunkName);
		if (!definition) {
			const inspection = this.safeInspectLuaExpression({
				assetId,
				expression: token.expression,
				chunkName,
				row: row + 1,
				column: token.startColumn + 1,
			});
			definition = inspection?.definition ?? null;
		}
		if (!definition) {
			const resolvedChunkName = chunkName
				?? normalizedPath
				?? descriptor?.assetId
				?? assetId
				?? primaryAssetId
				?? '<console>';
			const environment: ProjectReferenceEnvironment = {
				activeContext: context,
				activeLines: this.lines,
				codeTabContexts: Array.from(codeTabContexts.values()),
				listResources: () => this.listResourcesStrict(),
				loadLuaResource: (resourceId: string) => loadLuaResourceFn(resourceId),
			};
			const projectDefinition = resolveDefinitionLocationForExpression({
				expression: token.expression,
				environment,
				workspace: semanticWorkspace,
				currentChunkName: resolvedChunkName,
				currentLines: this.lines,
				currentAssetId: assetId,
				sourceLabelPath: normalizedPath ?? descriptor?.assetId ?? null,
			});
			if (projectDefinition) {
				this.navigateToLuaDefinition(projectDefinition);
				return true;
			}
			if (!inspectorRequestFailed) {
				this.showMessage(`Definition not found for ${token.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
			}
			return false;
		}
		this.navigateToLuaDefinition(definition);
		return true;
	}

	public navigateToLuaDefinition(definition: ConsoleLuaDefinitionLocation): void {
		const navigationCheckpoint = this.beginNavigationCapture();
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
		cursorRevealSuspended = false;
		this.clearHoverTooltip();
		this.clearGotoHoverHighlight();
		this.completeNavigation(navigationCheckpoint);
		this.showMessage('Jumped to definition', constants.COLOR_STATUS_SUCCESS, 1.6);
	}

	public applyDefinitionSelection(range: ConsoleLuaDefinitionLocation['range']): void {
		const lastRowIndex = Math.max(0, this.lines.length - 1);
		const startRow = clamp(range.startLine - 1, 0, lastRowIndex);
		const startLine = this.lines[startRow] ?? '';
		const startColumn = clamp(range.startColumn - 1, 0, startLine.length);
		this.cursorRow = startRow;
		this.cursorColumn = startColumn;
		this.selectionAnchor = null;
		pointerSelecting = false;
		pointerPrimaryWasPressed = false;
		pointerAuxWasPressed = false;
		this.updateDesiredColumn();
		this.resetBlink();
		cursorRevealSuspended = false;
		this.ensureCursorVisible();
	}

	public beginNavigationCapture(): NavigationHistoryEntry | null {
		if (navigationCaptureSuspended) {
			return null;
		}
		if (!navigationHistory.current) {
			navigationHistory.current = this.createNavigationEntry();
		}
		const current = navigationHistory.current;
		return current ? this.cloneNavigationEntry(current) : null;
	}

	public completeNavigation(previous: NavigationHistoryEntry | null): void {
		if (navigationCaptureSuspended) {
			return;
		}
		const next = this.createNavigationEntry();
		if (previous && (!next || !this.areNavigationEntriesEqual(previous, next))) {
			const backStack = navigationHistory.back;
			const lastBack = backStack[backStack.length - 1] ?? null;
			if (!lastBack || !this.areNavigationEntriesEqual(lastBack, previous)) {
				this.pushNavigationEntry(backStack, previous);
			}
			navigationHistory.forward.length = 0;
		} else if (previous && next && this.areNavigationEntriesEqual(previous, next)) {
			// Same location; do not mutate stacks.
		} else if (previous === null && next) {
			navigationHistory.forward.length = 0;
		}
		navigationHistory.current = next;
	}

	public pushNavigationEntry(stack: NavigationHistoryEntry[], entry: NavigationHistoryEntry): void {
		stack.push(entry);
		const overflow = stack.length - NAVIGATION_HISTORY_LIMIT;
		if (overflow > 0) {
			stack.splice(0, overflow);
		}
	}

	public areNavigationEntriesEqual(a: NavigationHistoryEntry, b: NavigationHistoryEntry): boolean {
		return a.contextId === b.contextId
			&& a.assetId === b.assetId
			&& a.chunkName === b.chunkName
			&& a.path === b.path
			&& a.row === b.row
			&& a.column === b.column;
	}

	public cloneNavigationEntry(entry: NavigationHistoryEntry): NavigationHistoryEntry {
		return { ...entry };
	}

	public createNavigationEntry(): NavigationHistoryEntry | null {
		if (!this.isCodeTabActive()) {
			return null;
		}
		const context = this.getActiveCodeTabContext();
		if (!context) {
			return null;
		}
		const assetId = this.resolveHoverAssetId(context);
		const chunkName = this.resolveHoverChunkName(context);
		const path = context.descriptor?.path ?? null;
		const maxRowIndex = this.lines.length > 0 ? this.lines.length - 1 : 0;
		const row = clamp(this.cursorRow, 0, maxRowIndex);
		const line = this.lines[row] ?? '';
		const column = clamp(this.cursorColumn, 0, line.length);
		return {
			contextId: context.id,
			assetId,
			chunkName,
			path,
			row,
			column,
		};
	}

	public withNavigationCaptureSuspended<T>(operation: () => T): T {
		const previous = navigationCaptureSuspended;
		navigationCaptureSuspended = true;
		try {
			return operation();
		} finally {
			navigationCaptureSuspended = previous;
		}
	}

	public applyNavigationEntry(entry: NavigationHistoryEntry): void {
		const existingContext = codeTabContexts.get(entry.contextId) ?? null;
		if (existingContext) {
			this.setActiveTab(entry.contextId);
		} else {
			const hint: { assetId: string | null; path?: string | null } = { assetId: entry.assetId };
			if (entry.path) {
				hint.path = entry.path;
			}
			this.focusChunkSource(entry.chunkName, hint);
			if (entry.contextId) {
				this.setActiveTab(entry.contextId);
			}
		}
		if (!this.isCodeTabActive()) {
			this.activateCodeTab();
		}
		if (!this.isCodeTabActive()) {
			return;
		}
		const maxRowIndex = this.lines.length > 0 ? this.lines.length - 1 : 0;
		const targetRow = clamp(entry.row, 0, maxRowIndex);
		const line = this.lines[targetRow] ?? '';
		const targetColumn = clamp(entry.column, 0, line.length);
		this.setCursorPosition(targetRow, targetColumn);
		this.clearSelection();
		cursorRevealSuspended = false;
		this.ensureCursorVisible();
	}

	public goBackwardInNavigationHistory(): void {
		if (navigationHistory.back.length === 0) {
			return;
		}
		const currentEntry = this.createNavigationEntry();
		if (currentEntry) {
			const forwardStack = navigationHistory.forward;
			const lastForward = forwardStack[forwardStack.length - 1] ?? null;
			if (!lastForward || !this.areNavigationEntriesEqual(lastForward, currentEntry)) {
				this.pushNavigationEntry(forwardStack, currentEntry);
			}
		} else {
			navigationHistory.forward.length = 0;
		}
		const target = navigationHistory.back.pop()!;
		this.withNavigationCaptureSuspended(() => {
			this.applyNavigationEntry(target);
		});
		navigationHistory.current = this.createNavigationEntry();
	}

	public goForwardInNavigationHistory(): void {
		if (navigationHistory.forward.length === 0) {
			return;
		}
		const currentEntry = this.createNavigationEntry();
		if (currentEntry) {
			const backStack = navigationHistory.back;
			const lastBack = backStack[backStack.length - 1] ?? null;
			if (!lastBack || !this.areNavigationEntriesEqual(lastBack, currentEntry)) {
				this.pushNavigationEntry(backStack, currentEntry);
			}
		}
		const target = navigationHistory.forward.pop()!;
		this.withNavigationCaptureSuspended(() => {
			this.applyNavigationEntry(target);
		});
		navigationHistory.current = this.createNavigationEntry();
	}

	public handleActionPromptPointer(snapshot: PointerSnapshot): void {
		if (!pendingActionPrompt) {
			return;
		}
		const x = snapshot.viewportX;
		const y = snapshot.viewportY;
		const saveBounds = actionPromptButtons.saveAndContinue;
		if (saveBounds && this.pointInRect(x, y, saveBounds)) {
			void this.handleActionPromptSelection('save-continue');
			return;
		}
		if (this.pointInRect(x, y, actionPromptButtons.continue)) {
			void this.handleActionPromptSelection('continue');
			return;
		}
		if (this.pointInRect(x, y, actionPromptButtons.cancel)) {
			void this.handleActionPromptSelection('cancel');
		}
	}

	public handleTopBarPointer(snapshot: PointerSnapshot): boolean {
		const y = snapshot.viewportY;
		if (y < 0 || y >= headerHeight) {
			return false;
		}
		const x = snapshot.viewportX;
		if (this.pointInRect(x, y, topBarButtonBounds.resume)) {
			this.handleTopBarButtonPress('resume');
			return true;
		}
		if (this.pointInRect(x, y, topBarButtonBounds.reboot)) {
			this.handleTopBarButtonPress('reboot');
			return true;
		}
		if (this.dirty && this.pointInRect(x, y, topBarButtonBounds.save)) {
			this.handleTopBarButtonPress('save');
			return true;
		}
		if (this.pointInRect(x, y, topBarButtonBounds.resources)) {
			this.handleTopBarButtonPress('resources');
			return true;
		}
		if (this.pointInRect(x, y, topBarButtonBounds.problems)) {
			this.handleTopBarButtonPress('problems');
			return true;
		}
		if (resourcePanelVisible && this.pointInRect(x, y, topBarButtonBounds.filter)) {
			this.handleTopBarButtonPress('filter');
			return true;
		}
		if (this.pointInRect(x, y, topBarButtonBounds.wrap)) {
			this.handleTopBarButtonPress('wrap');
			return true;
		}
		if (this.pointInRect(x, y, topBarButtonBounds.resolution)) {
			this.handleTopBarButtonPress('resolution');
			return true;
		}
		return false;
	}

	public handleTabBarPointer(snapshot: PointerSnapshot): boolean {
		const tabTop = headerHeight;
		const tabBottom = tabTop + this.getTabBarTotalHeight();
		const y = snapshot.viewportY;
		if (y < tabTop || y >= tabBottom) {
			return false;
		}
		const x = snapshot.viewportX;
		for (let index = 0; index < tabs.length; index += 1) {
			const tab = tabs[index];
			const closeBounds = tabCloseButtonBounds.get(tab.id);
			if (closeBounds && this.pointInRect(x, y, closeBounds)) {
				this.endTabDrag();
				this.closeTab(tab.id);
				tabHoverId = null;
				return true;
			}
			const tabBounds = tabButtonBounds.get(tab.id);
			if (tabBounds && this.pointInRect(x, y, tabBounds)) {
				this.beginTabDrag(tab.id, x);
				this.setActiveTab(tab.id);
				return true;
			}
		}
		return false;
	}

	public handleTabBarMiddleClick(snapshot: PointerSnapshot): boolean {
		const tabTop = headerHeight;
		const tabBottom = tabTop + this.getTabBarTotalHeight();
		const y = snapshot.viewportY;
		if (y < tabTop || y >= tabBottom) {
			return false;
		}
		const x = snapshot.viewportX;
		for (let index = 0; index < tabs.length; index += 1) {
			const tab = tabs[index];
			if (!tab.closable) {
				continue;
			}
			const bounds = tabButtonBounds.get(tab.id);
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

	public handlePointerWheel(): void {
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
		const pointer = lastPointerSnapshot;
		const shiftDown = isModifierPressedGlobal(this.playerIndex, 'ShiftLeft') || isModifierPressedGlobal(this.playerIndex, 'ShiftRight');
		if (hoverTooltip) {
			let canScrollTooltip = false;
			if (!pointer) {
				canScrollTooltip = true;
			} else if (pointer.valid && pointer.insideViewport) {
				if (this.isPointInHoverTooltip(pointer.viewportX, pointer.viewportY) || this.pointerHitsHoverTarget(pointer, hoverTooltip)) {
					canScrollTooltip = true;
				}
			}
			if (canScrollTooltip && this.adjustHoverTooltipScroll(direction * steps)) {
				playerInput.consumeAction('pointer_wheel');
				return;
			}
		}
		if (resourceSearchVisible) {
			const bounds = this.getResourceSearchBarBounds();
			const pointerInQuickOpen = bounds !== null
				&& pointer
				&& pointer.valid
				&& pointer.insideViewport
				&& this.pointInRect(pointer.viewportX, pointer.viewportY, bounds);
			if (pointerInQuickOpen || resourceSearchActive) {
				this.moveResourceSearchSelection(direction * steps);
				playerInput.consumeAction('pointer_wheel');
				return;
			}
		}
		const panelBounds = resourcePanel.getBounds();
		const pointerInPanel = resourcePanelVisible
			&& panelBounds !== null
			&& pointer
			&& pointer.valid
			&& pointer.insideViewport
			&& this.pointInRect(pointer.viewportX, pointer.viewportY, panelBounds);
		if (pointerInPanel) {
			if (shiftDown) {
				const horizontalPixels = direction * steps * charAdvance * 4;
				this.scrollResourceBrowserHorizontal(horizontalPixels);
				this.resourceBrowserEnsureSelectionVisible();
			} else {
				this.scrollResourceBrowser(direction * steps);
			}
			playerInput.consumeAction('pointer_wheel');
			return;
		}
		if (problemsPanel.isVisible()) {
			const bounds = this.getProblemsPanelBounds();
			if (bounds) {
				let allowScroll = false;
				if (!pointer) {
					allowScroll = problemsPanel.isFocused();
				} else if (pointer.valid && pointer.insideViewport && this.pointInRect(pointer.viewportX, pointer.viewportY, bounds)) {
					allowScroll = true;
				}
				const stepsAbs = Math.max(1, Math.round(Math.abs(steps)));
				if (problemsPanel.isFocused()) {
					// Match quick-open/symbol behavior: focused wheel moves selection
					for (let i = 0; i < stepsAbs; i += 1) {
						void problemsPanel.handleKeyboardCommand(direction > 0 ? 'down' : 'up');
					}
					playerInput.consumeAction('pointer_wheel');
					return;
				}
				if (allowScroll && problemsPanel.handlePointerWheel(direction, stepsAbs)) {
					playerInput.consumeAction('pointer_wheel');
					return;
				}
			}
		}
		if (completion.handlePointerWheel(direction, steps, pointer && pointer.valid && pointer.insideViewport ? { x: pointer.viewportX, y: pointer.viewportY } : null)) {
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
		cursorRevealSuspended = true;
		playerInput.consumeAction('pointer_wheel');
	}

	public handleTopBarButtonPress(button: TopBarButtonId): void {
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

	public openActionPrompt(action: PendingActionPrompt['action']): void {
		this.activateCodeTab();
		pendingActionPrompt = { action };
		actionPromptButtons.saveAndContinue = null;
		actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
		actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
		pointerSelecting = false;
		pointerPrimaryWasPressed = false;
	}

	public async handleActionPromptSelection(choice: 'save-continue' | 'continue' | 'cancel'): Promise<void> {
		if (!pendingActionPrompt) {
			return;
		}
		if (choice === 'cancel') {
			this.resetActionPromptState();
			return;
		}
		if (choice === 'save-continue') {
			const saved = await this.attemptPromptSave(pendingActionPrompt.action);
			if (!saved) {
				return;
			}
		}
		const success = this.executePendingAction();
		if (success) {
			this.resetActionPromptState();
		}
	}

	public async attemptPromptSave(action: PendingActionPrompt['action']): Promise<boolean> {
		if (action === 'close') {
			await this.save();
			return this.dirty === false;
		}
		await this.save();
		return this.dirty === false;
	}

	public executePendingAction(): boolean {
		const prompt = pendingActionPrompt;
		if (!prompt) {
			return false;
		}
		return this.performAction(prompt.action);
	}

	public performAction(action: PendingActionPrompt['action']): boolean {
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

	public performResume(): boolean {
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
		const targetGeneration = saveGeneration;
		const shouldUpdateGeneration = this.hasPendingRuntimeReload();
		this.clearExecutionStopHighlights();
		this.deactivate();
		this.scheduleRuntimeTask(() => {
			runtime.resumeFromSnapshot(sanitizedSnapshot);
			if (shouldUpdateGeneration) {
				appliedGeneration = targetGeneration;
			}
			$.paused = false;
		}, (error) => {
			this.handleRuntimeTaskError(error, 'Failed to resume game');
		});
		return true;
	}

	public performReboot(): boolean {
		const runtime = this.getConsoleRuntime();
		if (!runtime) {
			this.showMessage('Console runtime unavailable.', constants.COLOR_STATUS_ERROR, 4.0);
			return false;
		}
		const requiresReload = this.hasPendingRuntimeReload();
		const savedSource = requiresReload ? this.getMainProgramSourceForReload() : null;
		const targetGeneration = saveGeneration;
		this.clearExecutionStopHighlights();
		this.deactivate();
		this.scheduleRuntimeTask(async () => {
			if (requiresReload && savedSource !== null) {
				await runtime.reloadLuaProgram(savedSource);
			}
			runtime.boot('editor:reboot');
			appliedGeneration = targetGeneration;
			$.paused = false;
		}, (error) => {
			this.handleRuntimeTaskError(error, 'Failed to reboot game');
		});
		return true;
	}

	// Indentation adjustments delegated to base class implementation.


	public toggleLineComments(): void {
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

	public addLineComments(range?: { startRow: number; endRow: number }): void {
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

	public removeLineComments(range?: { startRow: number; endRow: number }): void {
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

	public firstNonWhitespaceIndex(value: string): number {
		for (let index = 0; index < value.length; index++) {
			const ch = value.charAt(index);
			if (ch !== ' ' && ch !== '\t') {
				return index;
			}
		}
		return value.length;
	}

	public shiftPositionsForInsertion(row: number, column: number, length: number): void {
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

	public shiftPositionsForRemoval(row: number, column: number, length: number): void {
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
		cursorRevealSuspended = false;
		this.ensureCursorVisible();
	}

	public readPointerSnapshot(): PointerSnapshot | null {
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

	public mapScreenPointToViewport(screenX: number, screenY: number): { x: number; y: number; inside: boolean; valid: boolean } {
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
		const viewportX = (relativeX / width) * viewportWidth;
		const viewportY = (relativeY / height) * viewportHeight;
		return { x: viewportX, y: viewportY, inside, valid: true };
	}

	public getCodeAreaBounds(): { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; gutterLeft: number; gutterRight: number; textLeft: number; } {
		const codeTop = this.codeViewportTop();
		const codeBottom = viewportHeight - this.bottomMargin;
		const codeLeft = resourcePanelVisible ? this.getResourcePanelWidth() : 0;
		const codeRight = viewportWidth;
		const gutterLeft = codeLeft;
		const gutterRight = gutterLeft + gutterWidth;
		const textLeft = gutterRight + 2;
		return { codeTop, codeBottom, codeLeft, codeRight, gutterLeft, gutterRight, textLeft };
	}

	public resolvePointerRow(viewportY: number): number {
		this.ensureVisualLines();
		const bounds = this.getCodeAreaBounds();
		const relativeY = viewportY - bounds.codeTop;
		const lineOffset = Math.floor(relativeY / lineHeight);
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
			lastPointerRowResolution = null;
			return clamp(visualIndex, 0, Math.max(0, this.lines.length - 1));
		}
		lastPointerRowResolution = { visualIndex, segment };
		return segment.row;
	}

	public resolvePointerColumn(row: number, viewportX: number): number {
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
		const resolvedSegment = lastPointerRowResolution?.segment;
		if (wordWrapEnabled && resolvedSegment && resolvedSegment.row === row) {
			segmentStartColumn = resolvedSegment.startColumn;
			segmentEndColumn = resolvedSegment.endColumn;
		}
		if (wordWrapEnabled) {
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
			return wordWrapEnabled ? Math.min(segmentEndColumn, line.length) : line.length;
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
		if (wordWrapEnabled) {
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

	public handlePointerAutoScroll(viewportX: number, viewportY: number): void {
		if (!pointerSelecting) {
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
		if (!wordWrapEnabled) {
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
		if (wordWrapEnabled) {
			this.scrollColumn = 0;
		}
		const maxScrollRow = Math.max(0, this.getVisualLineCount() - this.visibleRowCount());
		if (this.scrollRow > maxScrollRow) {
			this.scrollRow = maxScrollRow;
		}
		if (!wordWrapEnabled && this.scrollColumn > maxScrollColumn) {
			this.scrollColumn = maxScrollColumn;
		}
	}

	public registerPointerClick(row: number, column: number): boolean {
		const now = $.platform.clock.now();
		const interval = now - lastPointerClickTimeMs;
		const sameRow = row === lastPointerClickRow;
		const columnDelta = Math.abs(column - lastPointerClickColumn);
		const doubleClick = lastPointerClickTimeMs > 0
			&& interval <= constants.DOUBLE_CLICK_MAX_INTERVAL_MS
			&& sameRow
			&& columnDelta <= 2;
		lastPointerClickTimeMs = now;
		lastPointerClickRow = row;
		lastPointerClickColumn = column;
		return doubleClick;
	}

	public resetPointerClickTracking(): void {
		lastPointerClickTimeMs = 0;
		lastPointerClickRow = -1;
		lastPointerClickColumn = -1;
	}

	public scrollRows(deltaRows: number): void {
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
	public recordSnapshotPre(key: string): void {
		// Use non-coalesced snapshot to ensure distinct undo step
		this.prepareUndo(key, false);
	}

	public recordSnapshotPost(_key: string): void {
		// Break coalescing to avoid merging unrelated edits
		this.breakUndoSequence();
	}

	public deleteCharLeft(): void {
		this.backspace();
	}

	public deleteCharRight(): void {
		this.deleteForward();
	}

	public insertNewline(): void {
		this.insertLineBreak();
	}

	// cursor/grid manipulation now resides in ConsoleCartEditorTextOps base class.

	public applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
		searchQuery = value;
		setFieldText(searchField, value, moveCursorToEnd);
	}

	public applySymbolSearchFieldText(value: string, moveCursorToEnd: boolean): void {
		symbolSearchQuery = value;
		setFieldText(symbolSearchField, value, moveCursorToEnd);
	}

	public applyResourceSearchFieldText(value: string, moveCursorToEnd: boolean): void {
		resourceSearchQuery = value;
		setFieldText(resourceSearchField, value, moveCursorToEnd);
	}

	public applyLineJumpFieldText(value: string, moveCursorToEnd: boolean): void {
		lineJumpValue = value;
		setFieldText(lineJumpField, value, moveCursorToEnd);
	}

	public applyCreateResourceFieldText(value: string, moveCursorToEnd: boolean): void {
		createResourcePath = value;
		setFieldText(createResourceField, value, moveCursorToEnd);
	}

	public inlineFieldMetrics(): InlineFieldMetrics {
		return inlineFieldMetricsRef;
	}

	public createInlineFieldEditingHandlers(keyboard: KeyboardInput): InlineFieldEditingHandlers {
		return {
			isKeyJustPressed: (code) => isKeyJustPressedGlobal(this.playerIndex, code),
			isKeyTyped: (code) => isKeyTypedGlobal(this.playerIndex, code),
			shouldFireRepeat: (code, deltaSeconds) => input.shouldRepeatPublic(keyboard, code, deltaSeconds),
			consumeKey: (code) => consumeKeyboardKey(keyboard, code),
			readClipboard: () => customClipboard,
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

	public processInlineFieldEditing(field: InlineTextField, keyboard: KeyboardInput, options: InlineInputOptions): boolean {
		return applyInlineFieldEditing(field, options, this.createInlineFieldEditingHandlers(keyboard));
	}

	public processInlineFieldPointer(field: InlineTextField, textLeft: number, pointerX: number, justPressed: boolean, pointerPressed: boolean): void {
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
		if (wordWrapEnabled) {
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

	public async save(): Promise<void> {
		const context = this.getActiveCodeTabContext();
		if (!context) {
			return;
		}
		const source = this.lines.join('\n');
		try {
			await context.save(source);
			this.dirty = false;
			saveGeneration = saveGeneration + 1;
			context.lastSavedSource = source;
			context.saveGeneration = saveGeneration;
			const isEntryContext = entryTabId !== null && context.id === entryTabId;
			if (isEntryContext) {
				lastSavedSource = source;
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
		message.text = text;
		message.color = color;
		message.timer = durationSeconds;
		message.visible = true;
	}

	public updateMessage(deltaSeconds: number): void {
		if (!message.visible) {
			return;
		}
		message.timer -= deltaSeconds;
		if (message.timer <= 0) {
			message.visible = false;
		}
	}

	public updateRuntimeErrorOverlay(deltaSeconds: number): void {
		const overlay = runtimeErrorOverlay;
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

	public async copySelectionToClipboard(): Promise<void> {
		const text = this.getSelectionText();
		if (text === null) {
			this.showMessage('Nothing selected to copy', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		await this.writeClipboard(text, 'Copied selection to clipboard');
	}

	public async cutSelectionToClipboard(): Promise<void> {
		const text = this.getSelectionText();
		if (text === null) {
			this.showMessage('Nothing selected to cut', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		this.prepareUndo('cut', false);
		await this.writeClipboard(text, 'Cut selection to clipboard');
		this.replaceSelectionWith('');
	}

	public async cutLineToClipboard(): Promise<void> {
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
			const removedRow = this.cursorRow;
			this.lines.splice(this.cursorRow, 1);
			if (this.cursorRow >= this.lines.length) {
				this.cursorRow = this.lines.length - 1;
			}
			const newLength = this.lines[this.cursorRow].length;
			if (this.cursorColumn > newLength) {
				this.cursorColumn = newLength;
			}
			this.invalidateHighlightsFromRow(Math.min(removedRow, this.lines.length - 1));
		}
		this.invalidateLine(this.cursorRow);
		this.selectionAnchor = null;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	public pasteFromClipboard(): void {
		const text = customClipboard;
		if (text === null || text.length === 0) {
			this.showMessage('Editor clipboard is empty', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		this.prepareUndo('paste', false);
		this.deleteSelectionIfPresent();
		this.insertClipboardText(text);
		this.showMessage('Pasted from editor clipboard', constants.COLOR_STATUS_SUCCESS, 1.5);
	}

	public async writeClipboard(text: string, successMessage: string): Promise<void> {
		customClipboard = text;
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
		cursorRevealSuspended = false;
		this.updateActiveContextDirtyFlag();
		this.ensureCursorVisible();
		this.requestSemanticRefresh();
	}

	public drawTopBar(api: BmsxConsoleApi): void {
		const host = {
			viewportWidth: viewportWidth,
			headerHeight: headerHeight,
			lineHeight: lineHeight,
			measureText: (text: string) => this.measureText(text),
			drawText: (api2: BmsxConsoleApi, text: string, x: number, y: number, color: number) => drawEditorText(api2, font, text, x, y, color),
			wordWrapEnabled: wordWrapEnabled,
			resolutionMode: resolutionMode,
			metadata: metadata,
			dirty: this.dirty,
			resourcePanelVisible: resourcePanelVisible,
			resourcePanelFilterMode: resourcePanel.getFilterMode(),
			problemsPanelVisible: problemsPanel.isVisible(),
			topBarButtonBounds: topBarButtonBounds,
		};
		renderTopBar(api, host);
	}

	public drawCreateResourceBar(api: BmsxConsoleApi): void {
		const host = {
			viewportWidth: viewportWidth,
			headerHeight: headerHeight,
			tabBarHeight: this.getTabBarTotalHeight(),
			lineHeight: lineHeight,
			spaceAdvance: spaceAdvance,
			charAdvance: charAdvance,
			measureText: (t: string) => this.measureText(t),
			drawText: (api2: BmsxConsoleApi, t: string, x: number, y: number, c: number) => drawEditorText(api2, font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: createResourceActive,
			createResourceVisible: createResourceVisible,
			createResourceField: createResourceField,
			createResourceWorking: createResourceWorking,
			createResourceError: createResourceError,
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
			blockActiveCarets: (problemsPanel.isVisible() && problemsPanel.isFocused()),
		};
		renderCreateResourceBar(api, host);
	}

	public drawSearchBar(api: BmsxConsoleApi): void {
		const host: import('./render_inline_bars').InlineBarsHost = {
			viewportWidth: viewportWidth,
			headerHeight: headerHeight,
			tabBarHeight: this.getTabBarTotalHeight(),
			lineHeight: lineHeight,
			spaceAdvance: spaceAdvance,
			charAdvance: charAdvance,
			measureText: (t: string) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: createResourceActive,
			createResourceVisible: createResourceVisible,
			createResourceField: createResourceField,
			createResourceWorking: createResourceWorking,
			createResourceError: createResourceError,
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
			blockActiveCarets: (problemsPanel.isVisible() && problemsPanel.isFocused()),
			searchActive: searchActive,
			searchField: searchField,
			searchQuery: searchQuery,
			searchMatchesCount: activeSearchMatchCount(),
			searchCurrentIndex: searchCurrentIndex,
			searchScope: searchScope,
			searchWorking: searchScope === 'global' ? globalSearchJob !== null : searchJob !== null,
			searchVisibleResultCount: () => searchVisibleResultCount(),
			searchResultEntryHeight: () => searchResultEntryHeight(),
			searchResultEntries: this.getVisibleSearchResultEntries(),
			searchResultEntriesBaseOffset: searchDisplayOffset,
			searchSelectionIndex: searchCurrentIndex,
			searchHoverIndex: searchHoverIndex,
			searchDisplayOffset: searchDisplayOffset,
		};
		renderSearchBar(api, host);
	}

	public drawResourceSearchBar(api: BmsxConsoleApi): void {
		const host: import('./render_inline_bars').InlineBarsHost = {
			viewportWidth: viewportWidth,
			headerHeight: headerHeight,
			tabBarHeight: this.getTabBarTotalHeight(),
			lineHeight: lineHeight,
			spaceAdvance: spaceAdvance,
			charAdvance: charAdvance,
			measureText: (t: string) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: createResourceActive,
			createResourceVisible: createResourceVisible,
			createResourceField: createResourceField,
			createResourceWorking: createResourceWorking,
			createResourceError: createResourceError,
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
			blockActiveCarets: (problemsPanel.isVisible() && problemsPanel.isFocused()),
			resourceSearchActive: resourceSearchActive,
			resourceSearchField: resourceSearchField,
			resourceSearchVisibleResultCount: () => resourceSearchVisibleResultCount(),
			resourceSearchEntryHeight: () => resourceSearchEntryHeight(),
			isResourceSearchCompactMode: () => isResourceSearchCompactMode(),
			resourceSearchMatches: resourceSearchMatches,
			resourceSearchSelectionIndex: resourceSearchSelectionIndex,
			resourceSearchHoverIndex: resourceSearchHoverIndex,
			resourceSearchDisplayOffset: resourceSearchDisplayOffset,
		};
		renderResourceSearchBar(api, host);
	}

	public drawSymbolSearchBar(api: BmsxConsoleApi): void {
		const host: import('./render_inline_bars').InlineBarsHost = {
			viewportWidth: viewportWidth,
			headerHeight: headerHeight,
			tabBarHeight: this.getTabBarTotalHeight(),
			lineHeight: lineHeight,
			spaceAdvance: spaceAdvance,
			charAdvance: charAdvance,
			measureText: (t: string) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: createResourceActive,
			createResourceVisible: createResourceVisible,
			createResourceField: createResourceField,
			createResourceWorking: createResourceWorking,
			createResourceError: createResourceError,
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
			blockActiveCarets: (problemsPanel.isVisible() && problemsPanel.isFocused()),
			symbolSearchGlobal: symbolSearchGlobal,
			symbolSearchActive: symbolSearchActive,
			symbolSearchMode: symbolSearchMode,
			symbolSearchField: symbolSearchField,
			symbolSearchVisibleResultCount: () => symbolSearchVisibleResultCount(),
			symbolSearchEntryHeight: () => symbolSearchEntryHeight(),
			isSymbolSearchCompactMode: () => isSymbolSearchCompactMode(),
			symbolSearchMatches: symbolSearchMatches,
			symbolSearchSelectionIndex: symbolSearchSelectionIndex,
			symbolSearchHoverIndex: symbolSearchHoverIndex,
			symbolSearchDisplayOffset: symbolSearchDisplayOffset,
		};
		renderSymbolSearchBar(api, host);
	}

	public drawRenameBar(api: BmsxConsoleApi): void {
		const host: import('./render_inline_bars').InlineBarsHost = {
			viewportWidth: viewportWidth,
			headerHeight: headerHeight,
			tabBarHeight: this.getTabBarTotalHeight(),
			lineHeight: lineHeight,
			spaceAdvance: spaceAdvance,
			charAdvance: charAdvance,
			measureText: (t: string) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: createResourceActive,
			createResourceVisible: createResourceVisible,
			createResourceField: createResourceField,
			createResourceWorking: createResourceWorking,
			createResourceError: createResourceError,
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
			blockActiveCarets: (problemsPanel.isVisible() && problemsPanel.isFocused()),
			renameActive: renameController.isActive(),
			renameField: renameController.getField(),
			renameMatchCount: renameController.getMatchCount(),
			renameExpression: renameController.getExpressionLabel(),
			renameOriginalName: renameController.getOriginalName(),
		};
		renderRenameBar(api, host);
	}

	public drawLineJumpBar(api: BmsxConsoleApi): void {
		const host: import('./render_inline_bars').InlineBarsHost = {
			viewportWidth: viewportWidth,
			headerHeight: headerHeight,
			tabBarHeight: this.getTabBarTotalHeight(),
			lineHeight: lineHeight,
			spaceAdvance: spaceAdvance,
			charAdvance: charAdvance,
			measureText: (t: string) => this.measureText(t),
			drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
			inlineFieldMetrics: () => this.inlineFieldMetrics(),
			createResourceActive: createResourceActive,
			createResourceVisible: createResourceVisible,
			createResourceField: createResourceField,
			createResourceWorking: createResourceWorking,
			createResourceError: createResourceError,
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
			blockActiveCarets: (problemsPanel.isVisible() && problemsPanel.isFocused()),
			lineJumpActive: lineJumpActive,
			lineJumpField: lineJumpField,
		};
		renderLineJumpBar(api, host);
	}

	public drawCreateResourceErrorDialog(api: BmsxConsoleApi, message: string): void {
		const maxDialogWidth = Math.min(viewportWidth - 16, 360);
		const wrapWidth = Math.max(charAdvance, maxDialogWidth - (constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
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
		const dialogWidth = Math.min(viewportWidth - 16, Math.max(180, contentWidth + constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
		const dialogHeight = Math.min(viewportHeight - 16, lines.length * lineHeight + constants.ERROR_OVERLAY_PADDING_Y * 2 + 16);
		const left = Math.max(8, Math.floor((viewportWidth - dialogWidth) / 2));
		const top = Math.max(8, Math.floor((viewportHeight - dialogHeight) / 2));
		const right = left + dialogWidth;
		const bottom = top + dialogHeight;
		api.rectfill(left, top, right, bottom, constants.COLOR_STATUS_BACKGROUND);
		api.rect(left, top, right, bottom, constants.COLOR_CREATE_RESOURCE_ERROR);
		const dialogPaddingX = constants.ERROR_OVERLAY_PADDING_X + 6;
		const dialogPaddingY = constants.ERROR_OVERLAY_PADDING_Y + 6;
		renderErrorOverlayText(
			api,
			font,
			lines,
			left + dialogPaddingX,
			top + dialogPaddingY,
			lineHeight,
			constants.COLOR_STATUS_TEXT
		);
	}

	public simplifyRuntimeErrorMessage(message: string): string {
		return message.replace(/^\[BmsxConsoleRuntime\]\s*/, '');
	}

	public codeViewportTop(): number {
		return this.topMargin
			+ this.getCreateResourceBarHeight()
			+ this.getSearchBarHeight()
			+ this.getResourceSearchBarHeight()
			+ this.getSymbolSearchBarHeight()
			+ this.getRenameBarHeight()
			+ this.getLineJumpBarHeight();
	}

	public getCreateResourceBarHeight(): number {
		if (!this.isCreateResourceVisible()) {
			return 0;
		}
		return lineHeight + constants.CREATE_RESOURCE_BAR_MARGIN_Y * 2;
	}

	public isCreateResourceVisible(): boolean {
		return createResourceVisible;
	}

	public getSearchBarHeight(): number {
		if (!this.isSearchVisible()) {
			return 0;
		}
		const baseHeight = lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
		const visible = searchVisibleResultCount();
		if (visible <= 0) {
			return baseHeight;
		}
		return baseHeight + constants.SEARCH_RESULT_SPACING + visible * searchResultEntryHeight();
	}

	public isSearchVisible(): boolean {
		return searchVisible;
	}

	public getResourceSearchBarHeight(): number {
		if (!this.isResourceSearchVisible()) {
			return 0;
		}
		const baseHeight = lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
		const visible = resourceSearchVisibleResultCount();
		if (visible <= 0) {
			return baseHeight;
		}
		return baseHeight + constants.QUICK_OPEN_RESULT_SPACING + visible * resourceSearchEntryHeight();
	}

	public isResourceSearchVisible(): boolean {
		return resourceSearchVisible;
	}

	public getSymbolSearchBarHeight(): number {
		if (!this.isSymbolSearchVisible()) {
			return 0;
		}
		const baseHeight = lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
		const visible = symbolSearchVisibleResultCount();
		if (visible <= 0) {
			return baseHeight;
		}
		return baseHeight + constants.SYMBOL_SEARCH_RESULT_SPACING + visible * symbolSearchEntryHeight();
	}

	public isSymbolSearchVisible(): boolean {
		return symbolSearchVisible;
	}

	public getRenameBarHeight(): number {
		if (!this.isRenameVisible()) {
			return 0;
		}
		return lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	}

	public isRenameVisible(): boolean {
		return renameController.isVisible();
	}

	public getLineJumpBarHeight(): number {
		if (!this.isLineJumpVisible()) {
			return 0;
		}
		return lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2;
	}

	public isLineJumpVisible(): boolean {
		return lineJumpVisible;
	}

	public getCreateResourceBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getCreateResourceBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = headerHeight + this.getTabBarTotalHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: viewportWidth,
		};
	}

	public getSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getSearchBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = headerHeight + this.getTabBarTotalHeight() + this.getCreateResourceBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: viewportWidth,
		};
	}

	public getResourceSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getResourceSearchBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = headerHeight + this.getTabBarTotalHeight() + this.getCreateResourceBarHeight() + this.getSearchBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: viewportWidth,
		};
	}

	public getLineJumpBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getLineJumpBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = headerHeight + this.getTabBarTotalHeight()
			+ this.getCreateResourceBarHeight()
			+ this.getSearchBarHeight()
			+ this.getResourceSearchBarHeight()
			+ this.getSymbolSearchBarHeight()
			+ this.getRenameBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: viewportWidth,
		};
	}

	public getSymbolSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getSymbolSearchBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = headerHeight + this.getTabBarTotalHeight()
			+ this.getCreateResourceBarHeight()
			+ this.getSearchBarHeight()
			+ this.getResourceSearchBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: viewportWidth,
		};
	}

	public getRenameBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getRenameBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = headerHeight + this.getTabBarTotalHeight()
			+ this.getCreateResourceBarHeight()
			+ this.getSearchBarHeight()
			+ this.getResourceSearchBarHeight()
			+ this.getSymbolSearchBarHeight();
		return {
			top,
			bottom: top + height,
			left: 0,
			right: viewportWidth,
		};
	}

	public drawCodeArea(api: BmsxConsoleApi): void {
		const host: import('./render_code_area').CodeAreaHost = {
			// Geometry and metrics
			lineHeight: lineHeight,
			spaceAdvance: spaceAdvance,
			charAdvance: charAdvance,
			warnNonMonospace: warnNonMonospace,
			// Editor state
			wordWrapEnabled: wordWrapEnabled,
			codeHorizontalScrollbarVisible: codeHorizontalScrollbarVisible,
			codeVerticalScrollbarVisible: codeVerticalScrollbarVisible,
			cachedVisibleRowCount: cachedVisibleRowCount,
			cachedVisibleColumnCount: cachedVisibleColumnCount,
			scrollRow: this.scrollRow,
			scrollColumn: this.scrollColumn,
			cursorRow: this.cursorRow,
			cursorColumn: this.cursorColumn,
			cursorVisible: cursorVisible,
			cursorScreenInfo: cursorScreenInfo,
			gotoHoverHighlight: gotoHoverHighlight,
			executionStopRow: executionStopRow,
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
			drawColoredText: (a, t, cols, x, y) => drawEditorColoredText(a, font, t, cols, x, y, constants.COLOR_CODE_TEXT),
			drawReferenceHighlightsForRow: (a, ri, e, ox, oy, s, ed) => this.drawReferenceHighlightsForRow(a, ri, e, ox, oy, s, ed),
			drawSearchHighlightsForRow: (a, ri, e, ox, oy, s, ed) => this.drawSearchHighlightsForRow(a, ri, e, ox, oy, s, ed),
			computeSelectionSlice: (ri, hi, s, e) => this.computeSelectionSlice(ri, hi, s, e),
			measureRangeFast: (entry, from, to) => this.measureRangeFast(entry, from, to),
			getDiagnosticsForRow: (row) => this.getDiagnosticsForRow(row),
			scrollbars: {
				codeVertical: scrollbars.codeVertical,
				codeHorizontal: scrollbars.codeHorizontal,
			},
			computeMaximumScrollColumn: () => this.computeMaximumScrollColumn(),
			// Overlays
			drawRuntimeErrorOverlay: (a, ct, cr, tl) => this.drawRuntimeErrorOverlay(a, ct, cr, tl),
			drawHoverTooltip: (a, ct, cb, tl) => this.drawHoverTooltip(a, ct, cb, tl),
			drawCursor: (a, info, tx) => this.drawCursor(a, info, tx),
			computeCursorScreenInfo: (entry, tl, rt, ssd) => this.computeCursorScreenInfo(entry, tl, rt, ssd),
			drawCompletionPopup: (a, b) => completion.drawCompletionPopup(a, b),
			drawParameterHintOverlay: (a, b) => completion.drawParameterHintOverlay(a, b),
		};
		renderCodeArea(api, host);
		// write back mutable state possibly changed by renderer
		wordWrapEnabled = host.wordWrapEnabled;
		codeHorizontalScrollbarVisible = host.codeHorizontalScrollbarVisible;
		codeVerticalScrollbarVisible = host.codeVerticalScrollbarVisible;
		cachedVisibleRowCount = host.cachedVisibleRowCount;
		cachedVisibleColumnCount = host.cachedVisibleColumnCount;
		this.scrollRow = host.scrollRow;
		this.scrollColumn = host.scrollColumn;
		cursorScreenInfo = host.cursorScreenInfo;
	}

	public drawRuntimeErrorOverlay(api: BmsxConsoleApi, codeTop: number, codeRight: number, textLeft: number): void {
		const overlay = runtimeErrorOverlay;
		if (!overlay) {
			return;
		}
		const layoutHost = this.createRuntimeErrorOverlayLayoutHost();
		const layout = computeRuntimeErrorOverlayLayout(
			layoutHost,
			overlay,
			codeTop,
			codeRight,
			textLeft,
			constants.ERROR_OVERLAY_PADDING_X,
			constants.ERROR_OVERLAY_PADDING_Y,
			computeRuntimeErrorOverlayMaxWidth(viewportWidth, charAdvance, gutterWidth)
		);
		if (!layout) {
			return;
		}
		const highlightLines: number[] = [];
		if (overlay.hovered && overlay.hoverLine >= 0 && overlay.hoverLine < overlay.lineDescriptors.length) {
			const descriptor = overlay.lineDescriptors[overlay.hoverLine];
			if (descriptor && descriptor.role === 'frame') {
				const mapping = (layout as any).displayLineMap as number[] | undefined;
				if (Array.isArray(mapping) && mapping.length > 0) {
					for (let i = 0; i < mapping.length; i += 1) {
						if (mapping[i] === overlay.hoverLine) highlightLines.push(i);
					}
				} else {
					highlightLines.push(overlay.hoverLine);
				}
			}
		}
		const drawOptions: RuntimeErrorOverlayDrawOptions = {
			textColor: constants.ERROR_OVERLAY_TEXT_COLOR,
			paddingX: constants.ERROR_OVERLAY_PADDING_X,
			paddingY: constants.ERROR_OVERLAY_PADDING_Y,
			backgroundColor: overlay.hovered ? constants.ERROR_OVERLAY_BACKGROUND_HOVER : constants.ERROR_OVERLAY_BACKGROUND,
			highlightColor: constants.ERROR_OVERLAY_LINE_HOVER,
			highlightLines: highlightLines.length > 0 ? highlightLines : null,
		};
		drawRuntimeErrorOverlayBubble(api, font, overlay, layout, lineHeight, drawOptions);
	}

	public processRuntimeErrorOverlayPointer(snapshot: PointerSnapshot, justPressed: boolean, codeTop: number, codeRight: number, textLeft: number): boolean {
		const overlay = runtimeErrorOverlay;
		if (!overlay) {
			return false;
		}
		const layoutHost = this.createRuntimeErrorOverlayLayoutHost();
		const layout = computeRuntimeErrorOverlayLayout(
			layoutHost,
			overlay,
			codeTop,
			codeRight,
			textLeft,
			constants.ERROR_OVERLAY_PADDING_X,
			constants.ERROR_OVERLAY_PADDING_Y,
			computeRuntimeErrorOverlayMaxWidth(viewportWidth, charAdvance, gutterWidth)
		);
		if (!layout) {
			overlay.hovered = false;
			overlay.hoverLine = -1;
			return false;
		}
		if (!snapshot.valid || !snapshot.insideViewport) {
			overlay.hovered = false;
			overlay.hoverLine = -1;
			return false;
		}
		const insideBubble = this.pointInRect(snapshot.viewportX, snapshot.viewportY, layout.bounds);
		if (!insideBubble) {
			overlay.hovered = false;
			overlay.hoverLine = -1;
			if (justPressed && overlay.expanded) {
				overlay.expanded = false;
				rebuildRuntimeErrorOverlayView(overlay);
			}
			return false;
		}
		overlay.hovered = true;
		overlay.hoverLine = findRuntimeErrorOverlayLineAtPosition(overlay, snapshot.viewportX, snapshot.viewportY);
		if (!justPressed) {
			return true;
		}
		pointerSelecting = false;
		pointerPrimaryWasPressed = snapshot.primaryPressed;
		this.resetPointerClickTracking();
		const clickResult = evaluateRuntimeErrorOverlayClick(overlay, overlay.hoverLine);
		switch (clickResult.kind) {
			case 'expand': {
				overlay.expanded = true;
				rebuildRuntimeErrorOverlayView(overlay);
				return true;
			}
			case 'collapse': {
				overlay.expanded = false;
				rebuildRuntimeErrorOverlayView(overlay);
				return true;
			}
			case 'navigate': {
				overlay.expanded = false;
				rebuildRuntimeErrorOverlayView(overlay);
				this.navigateToRuntimeErrorFrameTarget(clickResult.frame);
				return true;
			}
			case 'noop':
			default: {
				return true;
			}
		}
		return true;
	}

	public createRuntimeErrorOverlayLayoutHost(): RuntimeErrorOverlayLayoutHost {
		return {
			ensureVisualLines: () => this.ensureVisualLines(),
			positionToVisualIndex: (row: number, column: number) => this.positionToVisualIndex(row, column),
			visibleRowCount: () => this.visibleRowCount(),
			scrollRow: this.scrollRow,
			visualIndexToSegment: (visualIndex: number) => this.visualIndexToSegment(visualIndex),
			getCachedHighlight: (rowIndex: number) => this.getCachedHighlight(rowIndex),
			wordWrapEnabled: wordWrapEnabled,
			scrollColumn: this.scrollColumn,
			visibleColumnCount: () => this.visibleColumnCount(),
			sliceHighlightedLine: (highlight, columnStart, columnCount) => this.sliceHighlightedLine(highlight, columnStart, columnCount),
			columnToDisplay: (highlight, column) => this.columnToDisplay(highlight, column),
			measureRangeFast: (entry, fromDisplay, toDisplay) => this.measureRangeFast(entry, fromDisplay, toDisplay),
			lineHeight: lineHeight,
			viewportHeight: viewportHeight,
			bottomMargin: this.bottomMargin,
			measureText: (text: string) => this.measureText(text),
		};
	}

	public navigateToRuntimeErrorFrameTarget(frame: RuntimeErrorStackFrame): void {
		if (frame.origin !== 'lua') {
			return;
		}
		const source = frame.source ?? '';
		if (source.length === 0) {
			this.showMessage('Runtime frame is missing a chunk reference.', constants.COLOR_STATUS_ERROR, 3.0);
			return;
		}
		let normalizedChunk: string;
		try {
			normalizedChunk = this.normalizeChunkName(source);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(`Unable to resolve runtime chunk name: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
			return;
		}
		const frameAssetId = typeof frame.chunkAssetId === 'string' && frame.chunkAssetId.length > 0 ? frame.chunkAssetId : null;
		const framePath = typeof frame.chunkPath === 'string' && frame.chunkPath.length > 0 ? frame.chunkPath : null;
		let descriptor: ConsoleResourceDescriptor | null = null;
		if (!frameAssetId || !framePath) {
			try {
				descriptor = this.findResourceDescriptorForChunk(normalizedChunk);
			} catch {
				descriptor = null;
			}
		}
		const chunkHintAssetId = frameAssetId ?? descriptor?.assetId ?? null;
		const chunkHintPath = framePath ?? descriptor?.path ?? undefined;
		try {
			const hint = chunkHintAssetId !== null ? { assetId: chunkHintAssetId, path: chunkHintPath } : (descriptor ? { assetId: descriptor.assetId, path: descriptor.path } : undefined);
			this.focusChunkSource(normalizedChunk, hint);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(`Failed to open runtime chunk: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
			return;
		}
		const activeContext = this.getActiveCodeTabContext();
		if (!activeContext) {
			this.showMessage('Unable to activate editor context for runtime frame.', constants.COLOR_STATUS_ERROR, 3.0);
			return;
		}
		const lastRowIndex = Math.max(0, this.lines.length - 1);
		let targetRow: number | null = null;
		if (typeof frame.line === 'number' && frame.line > 0) {
			targetRow = clamp(frame.line - 1, 0, lastRowIndex);
		}
		if (targetRow === null && frame.functionName) {
			targetRow = this.findFunctionDefinitionRowInActiveFile(frame.functionName);
		}
		if (targetRow === null) {
			targetRow = 0;
		}
		const targetLine = this.lines[targetRow] ?? '';
		let targetColumn = 0;
		if (typeof frame.column === 'number' && frame.column > 0) {
			targetColumn = clamp(frame.column - 1, 0, targetLine.length);
		}
		if (targetColumn === 0 && frame.functionName && frame.functionName.length > 0) {
			const nameIndex = targetLine.indexOf(frame.functionName);
			if (nameIndex >= 0) {
				targetColumn = nameIndex;
			}
		}
		this.selectionAnchor = null;
		pointerSelecting = false;
		this.resetPointerClickTracking();
		this.setCursorPosition(targetRow, targetColumn);
		cursorRevealSuspended = false;
		this.centerCursorVertically();
		this.ensureCursorVisible();
		this.showMessage('Navigated to call site', constants.COLOR_STATUS_SUCCESS, 1.6);
	}

	public findFunctionDefinitionRowInActiveFile(functionName: string): number | null {
		if (typeof functionName !== 'string' || functionName.length === 0) {
			return null;
		}
		const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const patterns = [
			new RegExp(`^\\s*function\\s+${escaped}\\b`),
			new RegExp(`^\\s*local\\s+function\\s+${escaped}\\b`),
			new RegExp(`\\b${escaped}\\s*=\\s*function\\b`),
		];
		for (let row = 0; row < this.lines.length; row += 1) {
			const line = this.lines[row];
			for (let index = 0; index < patterns.length; index += 1) {
				if (patterns[index].test(line)) {
					return row;
				}
			}
		}
		return null;
	}

	public isCodeTabActive(): boolean {
		return this.getActiveTabKind() === 'lua_editor';
	}

	public isResourceViewActive(): boolean {
		return this.getActiveTabKind() === 'resource_view';
	}

	public setActiveTab(tabId: string): void {
		const tab = tabs.find(candidate => candidate.id === tabId);
		if (!tab) {
			return;
		}
		const navigationCheckpoint = tab.kind === 'lua_editor' && tabId !== activeTabId
			? this.beginNavigationCapture()
			: null;
		this.closeSymbolSearch(true);
		const previousKind = this.getActiveTabKind();
		if (previousKind === 'lua_editor') {
			this.storeActiveCodeTabContext();
		}
		if (activeTabId === tabId) {
			if (tab.kind === 'resource_view') {
				this.enterResourceViewer(tab);
				runtimeErrorOverlay = null;
			} else if (tab.kind === 'lua_editor') {
				this.activateCodeEditorTab(tab.id);
				if (navigationCheckpoint) {
					this.completeNavigation(navigationCheckpoint);
				}
			}
			return;
		}
		activeTabId = tabId;
		if (tab.kind === 'resource_view') {
			this.enterResourceViewer(tab);
			runtimeErrorOverlay = null;
			return;
		}
		if (tab.kind === 'lua_editor') {
			this.activateCodeEditorTab(tab.id);
			if (navigationCheckpoint) {
				this.completeNavigation(navigationCheckpoint);
			}
		}
	}

	public toggleResourcePanel(): void {
		// Keep editor/controller visibility in sync by delegating to controller
		resourcePanel.togglePanel();
	}

	public toggleProblemsPanel(): void {
		if (problemsPanel.isVisible()) {
			this.hideProblemsPanel();
			return;
		}
		this.showProblemsPanel();
	}

	public showProblemsPanel(): void {
		problemsPanel.show();
		this.markDiagnosticsDirty();
	}

	public hideProblemsPanel(): void {
		problemsPanel.hide();
		this.focusEditorFromProblemsPanel();
	}

	public toggleResourcePanelFilterMode(): void {
		// Controller owns filter state and messaging
		resourcePanel.toggleFilterMode();
	}

	public toggleResolutionMode(): void {
		resolutionMode = resolutionMode === 'offscreen' ? 'viewport' : 'offscreen';
		this.refreshViewportDimensions(true);
		this.ensureCursorVisible();
		cursorRevealSuspended = false;
		this.applyResolutionModeToRuntime();
		const modeLabel = resolutionMode === 'offscreen' ? 'OFFSCREEN' : 'NATIVE';
		this.showMessage(`Editor resolution: ${modeLabel}`, constants.COLOR_STATUS_TEXT, 2.5);
	}

	public toggleWordWrap(): void {
		this.ensureVisualLines();
		const previousWrap = wordWrapEnabled;
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

		wordWrapEnabled = !previousWrap;
		cursorRevealSuspended = false;
		this.invalidateVisualLines();
		this.ensureVisualLines();

		this.cursorRow = clamp(previousCursorRow, 0, this.lines.length > 0 ? this.lines.length - 1 : 0);
		const currentLine = this.lines[this.cursorRow] ?? '';
		this.cursorColumn = clamp(previousCursorColumn, 0, currentLine.length);
		this.desiredColumn = previousDesiredColumn;

		if (wordWrapEnabled) {
			this.scrollColumn = 0;
			const anchorVisualIndex = this.positionToVisualIndex(anchorRow, anchorColumnForWrap);
			this.scrollRow = clamp(anchorVisualIndex, 0, Math.max(0, this.getVisualLineCount() - this.visibleRowCount()));
		} else {
			this.scrollColumn = clamp(anchorColumnForUnwrap, 0, this.computeMaximumScrollColumn());
			const anchorVisualIndex = this.positionToVisualIndex(anchorRow, this.scrollColumn);
			this.scrollRow = clamp(anchorVisualIndex, 0, Math.max(0, this.getVisualLineCount() - this.visibleRowCount()));
		}
		lastPointerRowResolution = null;
		this.ensureCursorVisible();
		this.updateDesiredColumn();
		const message = wordWrapEnabled ? 'Word wrap enabled' : 'Word wrap disabled';
		this.showMessage(message, constants.COLOR_STATUS_TEXT, 2.5);
	}

	public applyResolutionModeToRuntime(): void {
		const runtime = this.getConsoleRuntime();
		if (!runtime) {
			return;
		}
		runtime.setEditorOverlayResolution(resolutionMode);
	}

	// showResourcePanel removed; controller handles visibility via toggle/show()

	public hideResourcePanel(): void {
		// Forward to controller; it resets its internal state
		resourcePanel.hide();
		resourcePanelFocused = false;
		resourcePanelResizing = false;
		this.resetResourcePanelState();
		this.invalidateVisualLines();
	}

	public activateCodeTab(): void {
		const codeTab = tabs.find(candidate => candidate.kind === 'lua_editor');
		if (codeTab) {
			this.setActiveTab(codeTab.id);
			return;
		}
		if (entryTabId) {
			let context = codeTabContexts.get(entryTabId);
			if (!context) {
				context = this.createEntryTabContext();
				if (!context) {
					return;
				}
				entryTabId = context.id;
				codeTabContexts.set(context.id, context);
			}
			let entryTab = tabs.find(candidate => candidate.id === context.id);
			if (!entryTab) {
				entryTab = {
					id: context.id,
					kind: 'lua_editor',
					title: context.title,
					closable: true,
					dirty: context.dirty,
					resource: undefined,
				};
				tabs.unshift(entryTab);
			}
			this.setActiveTab(context.id);
		}
	}

	public openLuaCodeTab(descriptor: ConsoleResourceDescriptor): void {
		const navigationCheckpoint = this.beginNavigationCapture();
		const tabId: EditorTabId = `lua:${descriptor.assetId}`;
		let tab = tabs.find(candidate => candidate.id === tabId);
		if (!codeTabContexts.has(tabId)) {
			const context = this.createLuaCodeTabContext(descriptor);
			codeTabContexts.set(tabId, context);
		}
		const context = codeTabContexts.get(tabId) ?? null;
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
			tabs.push(tab);
		} else {
			tab.title = this.computeResourceTabTitle(descriptor);
			if (context) {
				tab.dirty = context.dirty;
			}
		}
		this.setActiveTab(tabId);
		this.completeNavigation(navigationCheckpoint);
	}

	public openResourceViewerTab(descriptor: ConsoleResourceDescriptor): void {
		const tabId: EditorTabId = `resource:${descriptor.assetId}`;
		let tab = tabs.find(candidate => candidate.id === tabId);
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
		tabs.push(tab);
		this.setActiveTab(tabId);
	}

	public closeActiveTab(): void {
		if (!activeTabId) {
			return;
		}
		this.closeTab(activeTabId);
	}

	public closeTab(tabId: string): void {
		const index = tabs.findIndex(tab => tab.id === tabId);
		if (index === -1) {
			return;
		}
		if (tabDragState && tabDragState.tabId === tabId) {
			this.endTabDrag();
		}
		const tab = tabs[index];
		if (!tab.closable) {
			return;
		}
		const wasActiveContext = tab.kind === 'lua_editor' && activeCodeTabContextId === tab.id;
		if (wasActiveContext) {
			this.storeActiveCodeTabContext();
		}
		tabs.splice(index, 1);
		if (tab.kind === 'lua_editor') {
			if (activeCodeTabContextId === tab.id) {
				activeCodeTabContextId = null;
			}
			dirtyDiagnosticContexts.delete(tab.id);
			diagnosticsCache.delete(tab.id);
		}
		if (activeTabId === tabId) {
			const fallback = tabs[index - 1] ?? tabs[0];
			if (fallback) {
				this.setActiveTab(fallback.id);
			} else {
				activeTabId = null;
				activeCodeTabContextId = null;
				this.resetEditorContent();
			}
		}
	}

	public cycleTab(direction: number): void {
		if (tabs.length <= 1 || direction === 0) {
			return;
		}
		const count = tabs.length;
		let currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
		if (currentIndex === -1) {
			const fallbackIndex = direction > 0 ? 0 : count - 1;
			const fallback = tabs[fallbackIndex];
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
		const target = tabs[nextIndex];
		this.setActiveTab(target.id);
	}

	public measureTabWidth(tab: EditorTabDescriptor): number {
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

	public computeTabLayout(): Array<{ id: string; left: number; right: number; width: number; center: number; rowIndex: number }> {
		const layout: Array<{ id: string; left: number; right: number; width: number; center: number; rowIndex: number }> = [];
		for (let index = 0; index < tabs.length; index += 1) {
			const tab = tabs[index];
			const bounds = tabButtonBounds.get(tab.id) ?? null;
			if (bounds) {
				const left = bounds.left;
				const right = bounds.right;
				const width = Math.max(0, right - left);
				const rowIndex = Math.max(0, Math.floor((bounds.top - headerHeight) / tabBarHeight));
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

	public beginTabDrag(tabId: string, pointerX: number): void {
		if (tabs.length <= 1) {
			tabDragState = null;
			return;
		}
		const bounds = tabButtonBounds.get(tabId) ?? null;
		const pointerOffset = bounds ? pointerX - bounds.left : 0;
		tabDragState = {
			tabId,
			pointerOffset,
			startX: pointerX,
			hasDragged: false,
		};
	}

	public updateTabDrag(pointerX: number, pointerY: number): void {
		const state = tabDragState;
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
		const withinTabBar = pointerY >= headerHeight && pointerY < headerHeight + totalTabHeight;
		const maxRowIndex = Math.max(0, tabBarRowCount - 1);
		const pointerRow = withinTabBar
			? clamp(Math.floor((pointerY - headerHeight) / tabBarHeight), 0, maxRowIndex)
			: dragged.rowIndex;
		const rowStride = viewportWidth + constants.TAB_BUTTON_SPACING * 4;
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
		const tabIndex = tabs.findIndex(entry => entry.id === state.tabId);
		if (tabIndex === -1) {
			return;
		}
		const removed = tabs.splice(tabIndex, 1);
		const tab = removed[0];
		if (!tab) {
			return;
		}
		const targetIndex = clamp(desiredIndex, 0, tabs.length);
		tabs.splice(targetIndex, 0, tab);
	}

	public endTabDrag(): void {
		if (!tabDragState) {
			return;
		}
		tabDragState = null;
	}

	public resetEditorContent(): void {
		this.lines = [''];
		this.invalidateVisualLines();
		this.markDiagnosticsDirty();
		this.cursorRow = 0;
		this.cursorColumn = 0;
		this.scrollRow = 0;
		this.scrollColumn = 0;
		this.selectionAnchor = null;
		lastSavedSource = '';
		this.invalidateAllHighlights();
		this.bumpTextVersion();
		this.dirty = false;
		this.updateActiveContextDirtyFlag();
		this.syncRuntimeErrorOverlayFromContext(null);
		this.updateDesiredColumn();
		this.resetBlink();
		this.ensureCursorVisible();
		this.requestSemanticRefresh();
	}

	public resetResourcePanelState(): void {
		resourceBrowserItems = [];
		resourceBrowserSelectionIndex = -1;
		// max line width handled by controller
		pendingResourceSelectionAssetId = null;
		resourcePanelResizing = false;
	}

	public refreshResourcePanelContents(): void {
		// New path owned by ResourcePanelController
		resourcePanel.refresh();
		const s = resourcePanel.getStateForRender();
		resourcePanelResourceCount = s.items.length;
		resourceBrowserItems = s.items;
		resourceBrowserSelectionIndex = s.selectionIndex;
	}

	public enterResourceViewer(tab: EditorTabDescriptor): void {
		this.closeSearch(false, true);
		this.closeLineJump(false);
		cursorRevealSuspended = false;
		tab.dirty = false;
		// hover state handled by controller; no-op here
		if (!tab.resource) {
			return;
		}
		this.resourceViewerClampScroll(tab.resource);
	}

	// buildResourceBrowserItems removed; ResourcePanelController owns item tree construction

	// updateResourceBrowserMetrics removed; controller computes metrics

	public selectResourceInPanel(descriptor: ConsoleResourceDescriptor): void {
		if (!descriptor.assetId || descriptor.assetId.length === 0) {
			return;
		}
		pendingResourceSelectionAssetId = descriptor.assetId;
		if (!resourcePanelVisible) {
			return;
		}
		this.applyPendingResourceSelection();
	}

	public applyPendingResourceSelection(): void {
		if (!resourcePanelVisible) {
			return;
		}
		const assetId = pendingResourceSelectionAssetId;
		if (!assetId) {
			return;
		}
		const index = this.findResourcePanelIndexByAssetId(assetId);
		if (index === -1) {
			return;
		}
		resourceBrowserSelectionIndex = index;
		this.resourceBrowserEnsureSelectionVisible();
		pendingResourceSelectionAssetId = null;
	}

	public findResourcePanelIndexByAssetId(assetId: string): number {
		for (let i = 0; i < resourceBrowserItems.length; i++) {
			const descriptor = resourceBrowserItems[i].descriptor;
			if (descriptor && descriptor.assetId === assetId) {
				return i;
			}
		}
		return -1;
	}

	// getSelectedResourceDescriptor removed; controller + local state provide selection

	// computeResourceBrowserMaxHorizontalScroll removed; use controller.computeMaxHScroll()

	// clampResourceBrowserHorizontalScroll removed; use controller.clampHScroll()

	public createEntryTabContext(): CodeTabContext | null {
		const assetId = (typeof primaryAssetId === 'string' && primaryAssetId.length > 0)
			? primaryAssetId
			: null;
		const descriptor = assetId ? this.findResourceDescriptorByAssetId(assetId) : null;
		const resolvedAssetId = descriptor ? descriptor.assetId : (assetId ?? '__entry__');
		const tabId: string = `lua:${resolvedAssetId}`;
		const title = descriptor
			? this.computeResourceTabTitle(descriptor)
			: (assetId ?? metadata.title ?? 'ENTRY').toUpperCase();
		const load = descriptor
			? () => loadLuaResourceFn(descriptor.assetId)
			: () => loadSourceFn();
		const save = descriptor
			? (source: string) => saveLuaResourceFn(descriptor.assetId, source)
			: (source: string) => saveSourceFn(source);
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

	public createLuaCodeTabContext(descriptor: ConsoleResourceDescriptor): CodeTabContext {
		const title = this.computeResourceTabTitle(descriptor);
		return {
			id: `lua:${descriptor.assetId}`,
			title,
			descriptor,
			load: () => loadLuaResourceFn(descriptor.assetId),
			save: (source: string) => saveLuaResourceFn(descriptor.assetId, source),
			snapshot: null,
			lastSavedSource: '',
			saveGeneration: 0,
			appliedGeneration: 0,
			dirty: false,
			runtimeErrorOverlay: null,
			executionStopRow: null,
		};
	}

	public getActiveCodeTabContext(): CodeTabContext | null {
		if (!activeCodeTabContextId) {
			return null;
		}
		return codeTabContexts.get(activeCodeTabContextId) ?? null;
	}

	public storeActiveCodeTabContext(): void {
		const context = this.getActiveCodeTabContext();
		if (!context) {
			return;
		}
		context.snapshot = this.captureSnapshot();
		if (entryTabId && context.id === entryTabId) {
			context.lastSavedSource = lastSavedSource;
		}
		context.saveGeneration = saveGeneration;
		context.appliedGeneration = appliedGeneration;
		context.dirty = this.dirty;
		context.runtimeErrorOverlay = runtimeErrorOverlay;
		context.executionStopRow = executionStopRow;
		this.setTabDirty(context.id, context.dirty);
	}

	public activateCodeEditorTab(tabId: string | null): void {
		if (!tabId) {
			return;
		}
		let context = codeTabContexts.get(tabId);
		if (!context) {
			if (entryTabId && tabId === entryTabId) {
				const recreated = this.createEntryTabContext();
				if (!recreated || recreated.id !== tabId) {
					return;
				}
				context = recreated;
				entryTabId = context.id;
				codeTabContexts.set(tabId, context);
			} else {
				return;
			}
		}
		activeCodeTabContextId = tabId;
		const isEntry = entryTabId !== null && context.id === entryTabId;
		if (context.snapshot) {
			this.restoreSnapshot(context.snapshot);
			saveGeneration = context.saveGeneration;
			appliedGeneration = context.appliedGeneration;
			if (isEntry) {
				lastSavedSource = context.lastSavedSource;
			}
			context.dirty = this.dirty;
			this.setTabDirty(context.id, context.dirty);
			this.syncRuntimeErrorOverlayFromContext(context);
			this.invalidateAllHighlights();
			this.updateDesiredColumn();
			this.ensureCursorVisible();
			this.refreshActiveDiagnostics();
			const chunkNameSnapshot = this.resolveHoverChunkName(context) ?? '<console>';
			layout.forceSemanticUpdate(this.lines, textVersion, chunkNameSnapshot);
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
		executionStopRow = null;
		saveGeneration = context.saveGeneration;
		appliedGeneration = context.appliedGeneration;
		if (isEntry) {
			lastSavedSource = context.lastSavedSource;
		}
		this.setTabDirty(context.id, context.dirty);
		this.syncRuntimeErrorOverlayFromContext(context);
		this.bumpTextVersion();
		const chunkName = this.resolveHoverChunkName(context) ?? '<console>';
		layout.forceSemanticUpdate(this.lines, textVersion, chunkName);
		this.updateDesiredColumn();
		this.resetBlink();
		pointerSelecting = false;
		pointerPrimaryWasPressed = false;
		this.refreshActiveDiagnostics();
	}

	public getMainProgramSourceForReload(): string {
		const entryId = entryTabId;
		if (!entryId) {
			return loadSourceFn();
		}
		const context = codeTabContexts.get(entryId);
		if (!context) {
			return loadSourceFn();
		}
		if (context.id === activeCodeTabContextId) {
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

	public buildResourceViewerState(descriptor: ConsoleResourceDescriptor): ResourceViewerState {
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

	public computeResourceTabTitle(descriptor: ConsoleResourceDescriptor): string {
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

	public appendResourceViewerLines(target: string[], additions: Iterable<string>): void {
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

	public trimResourceViewerLines(lines: string[]): void {
		if (lines.length > constants.RESOURCE_VIEWER_MAX_LINES) {
			lines.length = constants.RESOURCE_VIEWER_MAX_LINES - 1;
			lines.push('<content truncated>');
		}
	}

	public safeJsonStringify(value: unknown, space = 2): string {
		return JSON.stringify(value, (_key, val) => {
			if (typeof val === 'bigint') {
				return Number(val);
			}
			return val;
		}, space);
	}

	public describeMetadataValue(value: unknown): string {
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

	public getViewportMetrics(): ViewportMetrics {
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

	public computePanelRatioBounds(): { min: number; max: number } {
		const minRatio = constants.RESOURCE_PANEL_MIN_RATIO;
		const minEditorRatio = constants.RESOURCE_PANEL_MIN_EDITOR_RATIO;
		const availableForPanel = Math.max(0, 1 - minEditorRatio);
		const maxRatio = Math.max(minRatio, Math.min(constants.RESOURCE_PANEL_MAX_RATIO, availableForPanel));
		return { min: minRatio, max: maxRatio };
	}

	public clampResourcePanelRatio(ratio: number | null): number {
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

	public defaultResourcePanelRatio(): number {
		const metrics = this.getViewportMetrics();
		const viewportWidth = metrics.windowInner.width;
		const screenWidth = metrics.screen.width;
		const relative = Math.min(1, viewportWidth / screenWidth);
		const responsiveness = 1 - relative;
		const ratio = constants.RESOURCE_PANEL_DEFAULT_RATIO + responsiveness * (constants.RESOURCE_PANEL_MAX_RATIO - constants.RESOURCE_PANEL_DEFAULT_RATIO) * 0.6;
		const bounds = this.computePanelRatioBounds();
		return Math.max(bounds.min, Math.min(bounds.max, ratio));
	}

	public computePanelPixelWidth(ratio: number): number {
		if (!Number.isFinite(ratio) || ratio <= 0 || viewportWidth <= 0) {
			return 0;
		}
		return Math.floor(viewportWidth * ratio);
	}

	public getResourcePanelWidth(): number {
		if (!resourcePanelVisible) return 0;
		const bounds = resourcePanel.getBounds();
		return bounds ? Math.max(0, bounds.right - bounds.left) : 0;
	}

	// getResourcePanelBounds removed; use resourcePanel.getBounds()

	public isPointerOverResourcePanelDivider(x: number, y: number): boolean {
		if (!resourcePanelVisible) {
			return false;
		}
		const bounds = resourcePanel.getBounds();
		if (!bounds) {
			return false;
		}
		const margin = constants.RESOURCE_PANEL_DIVIDER_DRAG_MARGIN;
		const left = bounds.right - margin;
		const right = bounds.right + margin;
		return y >= bounds.top && y <= bounds.bottom && x >= left && x <= right;
	}

	// resourcePanelLineCapacity removed; use resourcePanel.lineCapacity()

	public scrollResourceBrowser(amount: number): void {
		if (!resourcePanelVisible) return;
		resourcePanel.scrollBy(amount);
		// controller owns scroll; no local mirror required
	}

	public resourceViewerImageLayout(viewer: ResourceViewerState): { left: number; top: number; width: number; height: number; bottom: number; scale: number } | null {
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
		const reservedTextHeight = Math.min(totalHeight * 0.45, lineHeight * estimatedTextLines);
		const maxImageHeight = Math.max(lineHeight * 2, totalHeight - reservedTextHeight);
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

	public resourceViewerTextCapacity(viewer: ResourceViewerState): number {
		const bounds = this.getCodeAreaBounds();
		const contentTop = bounds.codeTop + 2;
		const layout = this.resourceViewerImageLayout(viewer);
		let textTop = contentTop;
		if (layout) {
			textTop = Math.floor(layout.bottom + lineHeight);
		}
		if (textTop >= bounds.codeBottom) {
			return 0;
		}
		const availableHeight = Math.max(0, bounds.codeBottom - textTop);
		return Math.max(0, Math.floor(availableHeight / lineHeight));
	}

	public ensureResourceViewerSprite(api: BmsxConsoleApi, assetId: string, layout: { left: number; top: number; scale: number }): void {
		if (!resourceViewerSpriteId) {
			resourceViewerSpriteId = 'console_resource_viewer_sprite';
		}
		const spriteId = resourceViewerSpriteId;
		let object = api.world_object(spriteId);
		if (!object) {
			api.spawn_world_object('WorldObject', {
				id: spriteId,
				position: { x: layout.left, y: layout.top, z: 0 },
				components: [
					{
						class: 'SpriteComponent',
						options: {
							id_local: 'viewer_sprite',
							imgid: assetId,
							layer: 'ui',
						},
					},
				],
			});
			object = api.world_object(spriteId);
		}
		if (!object) {
			return;
		}
		const sprite = object.getComponentByLocalId(SpriteComponent, 'viewer_sprite');
		if (!sprite) {
			return;
		}
		if (resourceViewerSpriteAsset !== assetId) {
			sprite.imgid = assetId;
			resourceViewerSpriteAsset = assetId;
		}
		if (resourceViewerSpriteScale !== layout.scale) {
			sprite.scale.x = layout.scale;
			sprite.scale.y = layout.scale;
			resourceViewerSpriteScale = layout.scale;
		}
		object.x = layout.left;
		object.y = layout.top;
		object.visible = true;
	}

	public hideResourceViewerSprite(api: BmsxConsoleApi): void {
		if (!resourceViewerSpriteId) {
			return;
		}
		const object = api.world_object(resourceViewerSpriteId);
		if (object) {
			object.visible = false;
		}
	}

	public resourceViewerClampScroll(viewer: ResourceViewerState): void {
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
	public resourceBrowserEnsureSelectionVisible(): void {
		if (!resourcePanelVisible) return;
		resourcePanel.ensureSelectionVisiblePublic();
		// controller owns scroll; no local mirror required
	}

	public scrollResourceBrowserHorizontal(delta: number): void {
		if (!resourcePanelVisible) return;
		const s = resourcePanel.getStateForRender();
		resourcePanel.setHScroll(s.hscroll + delta);
	}

	// moved to ResourcePanelController

	public scrollResourceViewer(amount: number): void {
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


	public handleResourceViewerInput(keyboard: KeyboardInput, deltaSeconds: number): void {
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

	public drawResourcePanel(api: BmsxConsoleApi): void {
		// Delegate full drawing to controller and then mirror back minimal state used elsewhere
		resourcePanel.draw(api);
		const s = resourcePanel.getStateForRender();
		resourcePanelVisible = s.visible;
		resourceBrowserItems = s.items;
		resourcePanelFocused = s.focused;
		resourceBrowserSelectionIndex = s.selectionIndex;
		resourcePanelResourceCount = s.items.length;
		// max line width handled by controller
	}

	public drawResourceViewer(api: BmsxConsoleApi): void {
		const viewer = this.getActiveResourceViewer();
		if (!viewer) {
			return;
		}
		this.resourceViewerClampScroll(viewer);
		const bounds = this.getCodeAreaBounds();
		const contentLeft = bounds.codeLeft + constants.RESOURCE_PANEL_PADDING_X;
		const capacity = this.resourceViewerTextCapacity(viewer);
		const totalLines = viewer.lines.length;
		const verticalScrollbar = scrollbars.viewerVertical;
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
		if (layout && viewer.image) {
			this.ensureResourceViewerSprite(api, viewer.image.assetId, { left: layout.left, top: layout.top, scale: layout.scale });
			textTop = Math.floor(layout.bottom + lineHeight);
		} else {
			this.hideResourceViewerSprite(api);
		}
		if (capacity <= 0) {
			if (viewer.lines.length > 0) {
				const line = viewer.lines[Math.min(viewer.lines.length - 1, Math.max(0, Math.floor(viewer.scroll)))] ?? '';
				const fallbackY = Math.min(textTop, bounds.codeBottom - lineHeight);
				drawEditorText(api, font, line, contentLeft, fallbackY, constants.COLOR_RESOURCE_VIEWER_TEXT);
			} else {
				drawEditorText(api, font, '<empty>', contentLeft, textTop, constants.COLOR_RESOURCE_VIEWER_TEXT);
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
			drawEditorText(api, font, '<empty>', contentLeft, textTop, constants.COLOR_RESOURCE_VIEWER_TEXT);
		} else {
			for (let lineIndex = Math.floor(viewer.scroll), drawIndex = 0; lineIndex < end; lineIndex += 1, drawIndex += 1) {
				const line = viewer.lines[lineIndex] ?? '';
				const y = textTop + drawIndex * lineHeight;
				if (y >= bounds.codeBottom) {
					break;
				}
				drawEditorText(api, font, line, contentLeft, y, constants.COLOR_RESOURCE_VIEWER_TEXT);
			}
		}
		if (verticalVisible) {
			verticalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
		}
	}

	public drawReferenceHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
		const matches = referenceState.getMatches();
		if (matches.length === 0) {
			return;
		}
		const activeIndex = referenceState.getActiveIndex();
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
			api.rectfill_color(startX, originY, endX, originY + lineHeight, overlay);
		}
	}

	public drawSearchHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
		if (searchScope !== 'local' || searchMatches.length === 0 || searchQuery.length === 0) {
			return;
		}
		const highlight = entry.hi;
		for (let i = 0; i < searchMatches.length; i++) {
			const match = searchMatches[i];
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
			const overlay = i === searchCurrentIndex ? constants.SEARCH_MATCH_ACTIVE_OVERLAY : constants.SEARCH_MATCH_OVERLAY;
			api.rectfill_color(startX, originY, endX, originY + lineHeight, overlay);
		}
	}

	public computeCursorScreenInfo(entry: CachedHighlight, textLeft: number, rowTop: number, sliceStartDisplay: number): CursorScreenInfo {
		const highlight = entry.hi;
		const columnToDisplay = highlight.columnToDisplay;
		const clampedColumn = columnToDisplay.length > 0
			? clamp(this.cursorColumn, 0, columnToDisplay.length - 1)
			: 0;
		const cursorDisplayIndex = columnToDisplay.length > 0 ? columnToDisplay[clampedColumn] : 0;
		const limitedDisplayIndex = Math.max(sliceStartDisplay, cursorDisplayIndex);
		const cursorX = textLeft + this.measureRangeFast(entry, sliceStartDisplay, limitedDisplayIndex);
		let cursorWidth = charAdvance;
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
					cursorWidth = font.advance(baseChar);
				}
			}
		}
		const currentChar = this.currentLine().charAt(this.cursorColumn);
		if (currentChar === '\t') {
			cursorWidth = spaceAdvance * constants.TAB_SPACES;
		}
		return {
			row: this.cursorRow,
			column: this.cursorColumn,
			x: cursorX,
			y: rowTop,
			width: cursorWidth,
			height: lineHeight,
			baseChar,
			baseColor,
		};
	}

	public drawCursor(api: BmsxConsoleApi, info: CursorScreenInfo, textX: number): void {
		const cursorX = info.x;
		const cursorY = info.y;
		const caretLeft = Math.floor(Math.max(textX, cursorX - 1));
		const caretRight = Math.max(caretLeft + 1, Math.floor(cursorX + info.width));
		const caretTop = Math.floor(cursorY);
		const caretBottom = caretTop + info.height;
		const problemsPanelHasFocus = problemsPanel.isVisible() && problemsPanel.isFocused();
		if (searchActive || lineJumpActive || resourcePanelFocused || createResourceActive || problemsPanelHasFocus) {
			const innerLeft = caretLeft + 1;
			const innerRight = caretRight - 1;
			const innerTop = caretTop + 1;
			const innerBottom = caretBottom - 1;
			if (innerRight > innerLeft && innerBottom > innerTop) {
				api.rectfill(innerLeft, innerTop, innerRight, innerBottom, constants.COLOR_CODE_BACKGROUND);
			}
			this.drawRectOutlineColor(api, caretLeft, caretTop, caretRight, caretBottom, constants.CARET_COLOR);
			drawEditorColoredText(api, font, info.baseChar, [info.baseColor], cursorX, cursorY, info.baseColor);
		} else {
			api.rectfill_color(caretLeft, caretTop, caretRight, caretBottom, constants.CARET_COLOR);
			const caretPaletteIndex = this.resolvePaletteIndex(constants.CARET_COLOR);
			const caretInverseColor = caretPaletteIndex !== null
				? this.invertColorIndex(caretPaletteIndex)
				: this.invertColorIndex(info.baseColor);
			drawEditorColoredText(api, font, info.baseChar, [caretInverseColor], cursorX, cursorY, caretInverseColor);
		}
	}

	// Removed local completion popup and parameter hint drawers; delegated to CompletionController

	public sliceHighlightedLine(highlight: HighlightLine, columnStart: number, columnCount: number): { text: string; colors: number[]; startDisplay: number; endDisplay: number } {
		return layout.sliceHighlightedLine(highlight, columnStart, columnCount);
	}

	public getCachedHighlight(row: number): CachedHighlight {
		const activeContext = this.getActiveCodeTabContext();
		const chunkName = this.resolveHoverChunkName(activeContext) ?? '<console>';
		return layout.getCachedHighlight(this.lines, row, textVersion, chunkName);
	}

	protected invalidateLine(row: number): void {
		layout.invalidateHighlight(row);
	}

	protected invalidateAllHighlights(): void {
		layout.invalidateAllHighlights();
	}

	protected invalidateHighlightsFromRow(startRow: number): void {
		layout.invalidateHighlightsFrom(Math.max(0, startRow));
	}

	public measureRangeFast(entry: CachedHighlight, startDisplay: number, endDisplay: number): number {
		return layout.measureRangeFast(entry, startDisplay, endDisplay);
	}

	public requestSemanticRefresh(context?: CodeTabContext | null): void {
		const activeContext = context ?? this.getActiveCodeTabContext();
		const chunkName = this.resolveHoverChunkName(activeContext) ?? '<console>';
		layout.requestSemanticUpdate(this.lines, textVersion, chunkName);
	}

	public lowerBound(values: number[], target: number, lo = 0, hi = values.length): number {
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

	public bumpTextVersion(): void {
		textVersion += 1;
	}

	protected markDiagnosticsDirty(contextId?: string): void {
		const targetId = contextId ?? activeCodeTabContextId;
		if (!targetId) {
			return;
		}
		diagnosticsDirty = true;
		dirtyDiagnosticContexts.add(targetId);
		diagnosticsDueAtMs = clockNow() + diagnosticsDebounceMs;
	}

	protected markTextMutated(): void {
		this.dirty = true;
		this.markDiagnosticsDirty();
		this.bumpTextVersion();
		this.clearReferenceHighlights();
		this.updateActiveContextDirtyFlag();
		this.invalidateVisualLines();
		this.requestSemanticRefresh();
		this.handlePostEditMutation();
		if (searchQuery.length > 0) {
			this.startSearchJob();
		}
	}

	protected recordEditContext(kind: 'insert' | 'delete' | 'replace', text: string): void {
		pendingEditContext = { kind, text };
	}

	public handlePostEditMutation(): void {
		const editContext = pendingEditContext;
		pendingEditContext = null;
		completion.updateAfterEdit(editContext);
	}

	public handleCompletionKeybindings(
		keyboard: KeyboardInput,
		deltaSeconds: number,
		shiftDown: boolean,
		ctrlDown: boolean,
		altDown: boolean,
		metaDown: boolean,
	): boolean {
		return completion.handleKeybindings(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown, metaDown);
	}

	protected onCursorMoved(): void {
		completion.onCursorMoved();
	}

	public invalidateVisualLines(): void {
		layout.markVisualLinesDirty();
	}

	protected ensureVisualLines(): void {
		const activeContext = this.getActiveCodeTabContext();
		const chunkName = this.resolveHoverChunkName(activeContext) ?? '<console>';
		this.scrollRow = layout.ensureVisualLines({
			lines: this.lines,
			wordWrapEnabled: wordWrapEnabled,
			scrollRow: this.scrollRow,
			documentVersion: textVersion,
			chunkName,
			computeWrapWidth: () => this.computeWrapWidth(),
			estimatedVisibleRowCount: Math.max(1, cachedVisibleRowCount),
		});
		if (this.scrollRow < 0) {
			this.scrollRow = 0;
		}
	}

	public computeWrapWidth(): number {
		const resourceWidth = resourcePanelVisible ? this.getResourcePanelWidth() : 0;
		const gutterSpace = gutterWidth + 2;
		const verticalScrollbarSpace = 0;
		const available = viewportWidth - resourceWidth - gutterSpace - verticalScrollbarSpace;
		return Math.max(charAdvance, available - 2);
	}

	protected getVisualLineCount(): number {
		this.ensureVisualLines();
		return layout.getVisualLineCount();
	}

	protected visualIndexToSegment(index: number): VisualLineSegment | null {
		this.ensureVisualLines();
		return layout.visualIndexToSegment(index);
	}

	protected positionToVisualIndex(row: number, column: number): number {
		this.ensureVisualLines();
		const override = this.getCursorVisualOverride(row, column);
		if (override) {
			return override.visualIndex;
		}
		return layout.positionToVisualIndex(this.lines, row, column);
	}

	protected setCursorFromVisualIndex(visualIndex: number, desiredColumnHint?: number, desiredOffsetHint?: number): void {
		this.ensureVisualLines();
		this.clearCursorVisualOverride();
		const visualLines = layout.getVisualLines();
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
		if (wordWrapEnabled) {
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
		if (wordWrapEnabled) {
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


	public drawInlineCaret(
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
		if (!cursorVisible) {
			return;
		}
		if (active) {
			api.rectfill_color(left, top, right, bottom, caretColor);
			const caretIndex = this.resolvePaletteIndex(caretColor);
			const inverseColor = caretIndex !== null
				? this.invertColorIndex(caretIndex)
				: this.invertColorIndex(baseTextColor);
			const glyph = field.cursor < field.text.length ? field.text.charAt(field.cursor) : ' ';
			drawEditorText(api, font, glyph.length > 0 ? glyph : ' ', cursorX, top, inverseColor);
			return;
		}
		this.drawRectOutlineColor(api, left, top, right, bottom, caretColor);
	}

	public drawRectOutlineColor(api: BmsxConsoleApi, left: number, top: number, right: number, bottom: number, color: { r: number; g: number; b: number; a: number }): void {
		if (right <= left || bottom <= top) {
			return;
		}
		api.rectfill_color(left, top, right, top + 1, color);
		api.rectfill_color(left, bottom - 1, right, bottom, color);
		api.rectfill_color(left, top, left + 1, bottom, color);
		api.rectfill_color(right - 1, top, right, bottom, color);
	}

	public computeSelectionSlice(lineIndex: number, highlight: HighlightLine, sliceStart: number, sliceEnd: number): { startDisplay: number; endDisplay: number } | null {
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

	public drawStatusBar(api: BmsxConsoleApi): void {
		const host = {
			viewportWidth: viewportWidth,
			viewportHeight: viewportHeight,
			bottomMargin: this.statusAreaHeight(),
			lineHeight: lineHeight,
			measureText: (text: string) => this.measureText(text),
			drawText: (api2: BmsxConsoleApi, text: string, x: number, y: number, color: number) => drawEditorText(api2, font, text, x, y, color),
			truncateTextToWidth: (text: string, maxWidth: number) => this.truncateTextToWidth(text, maxWidth),
			message: message,
			getStatusMessageLines: () => this.getStatusMessageLines(),
			symbolSearchVisible: symbolSearchVisible,
			getActiveSymbolSearchMatch: () => this.getActiveSymbolSearchMatch(),
			resourcePanelVisible: resourcePanelVisible,
			resourcePanelFilterMode: resourcePanel.getFilterMode(),
			resourcePanelResourceCount: resourcePanelResourceCount,
			isResourceViewActive: () => this.isResourceViewActive(),
			getActiveResourceViewer: () => this.getActiveResourceViewer(),
			metadata: metadata,
			statusLeftInfo: this.buildStatusLeftInfo(),
			problemsPanelFocused: problemsPanel.isVisible() && problemsPanel.isFocused(),
		};
		renderStatusBar(api, host);
	}

	public buildStatusLeftInfo(): string {
		if (problemsPanel.isVisible()) {
			if (problemsPanel.isFocused()) {
				const sel = problemsPanel.getSelectedDiagnostic();
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

	public drawProblemsPanel(api: BmsxConsoleApi): void {
		const bounds = this.getProblemsPanelBounds();
		if (!bounds) {
			return;
		}
		problemsPanel.draw(api, bounds);
	}

	public getProblemsPanelBounds(): RectBounds | null {
		const panelHeight = this.getVisibleProblemsPanelHeight();
		if (panelHeight <= 0) {
			return null;
		}
		const statusHeight = this.statusAreaHeight();
		const bottom = viewportHeight - statusHeight;
		const top = bottom - panelHeight;
		if (bottom <= top) {
			return null;
		}
		return { left: 0, top, right: viewportWidth, bottom };
	}

	public isPointerOverProblemsPanelDivider(x: number, y: number): boolean {
		const bounds = this.getProblemsPanelBounds();
		if (!bounds) {
			return false;
		}
		const margin = constants.PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN;
		const dividerTop = bounds.top;
		return y >= dividerTop - margin && y <= dividerTop + margin && x >= bounds.left && x <= bounds.right;
	}

	public setProblemsPanelHeightFromViewportY(viewportY: number): void {
		const statusHeight = this.statusAreaHeight();
		const bottom = viewportHeight - statusHeight;
		const minTop = headerHeight + this.getTabBarTotalHeight() + 1;
		const headerH = lineHeight + constants.PROBLEMS_PANEL_HEADER_PADDING_Y * 2;
		const minContent = Math.max(1, constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS) * lineHeight;
		const minHeight = headerH + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2 + minContent;
		const maxTop = Math.max(minTop, bottom - minHeight);
		const top = clamp(viewportY, minTop, maxTop);
		const height = clamp(bottom - top, minHeight, Math.max(minHeight, bottom - minTop));
		problemsPanel.setFixedHeightPx(height);
	}

	public drawActionPromptOverlay(api: BmsxConsoleApi): void {
		const prompt = pendingActionPrompt;
		if (!prompt) {
			return;
		}
		api.rectfill_color(0, 0, viewportWidth, viewportHeight, constants.ACTION_OVERLAY_COLOR);

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
		const buttonHeight = lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
		const messageSpacing = lineHeight + 2;
		const dialogWidth = Math.max(maxMessageWidth + paddingX * 2, buttonRowWidth + paddingX * 2);
		const dialogHeight = paddingY * 2 + messageLines.length * messageSpacing + 6 + buttonHeight;
		const left = Math.max(4, Math.floor((viewportWidth - dialogWidth) / 2));
		const top = Math.max(4, Math.floor((viewportHeight - dialogHeight) / 2));
		const right = left + dialogWidth;
		const bottom = top + dialogHeight;

		api.rectfill(left, top, right, bottom, constants.ACTION_DIALOG_BACKGROUND_COLOR);
		api.rect(left, top, right, bottom, constants.ACTION_DIALOG_BORDER_COLOR);

		let textY = top + paddingY;
		const textX = left + paddingX;
		for (let i = 0; i < messageLines.length; i++) {
			drawEditorText(api, font, messageLines[i], textX, textY, constants.ACTION_DIALOG_TEXT_COLOR);
			textY += messageSpacing;
		}

		const buttonY = bottom - paddingY - buttonHeight;
		let buttonX = left + paddingX;
		const saveBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + primaryWidth, bottom: buttonY + buttonHeight };
		api.rectfill(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, constants.ACTION_BUTTON_BACKGROUND);
		api.rect(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
		drawEditorText(api, font, primaryLabel, saveBounds.left + constants.HEADER_BUTTON_PADDING_X, saveBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.ACTION_BUTTON_TEXT);
		actionPromptButtons.saveAndContinue = saveBounds;
		buttonX = saveBounds.right + buttonSpacing;

		const continueBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + secondaryWidth, bottom: buttonY + buttonHeight };
		api.rectfill(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, constants.ACTION_BUTTON_BACKGROUND);
		api.rect(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
		drawEditorText(api, font, secondaryLabel, continueBounds.left + constants.HEADER_BUTTON_PADDING_X, continueBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.ACTION_BUTTON_TEXT);
		actionPromptButtons.continue = continueBounds;
		buttonX = continueBounds.right + buttonSpacing;

		const cancelBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + cancelWidth, bottom: buttonY + buttonHeight };
		api.rectfill(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND);
		api.rect(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
		drawEditorText(api, font, cancelLabel, cancelBounds.left + constants.HEADER_BUTTON_PADDING_X, cancelBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.COLOR_HEADER_BUTTON_TEXT);
		actionPromptButtons.cancel = cancelBounds;
	}

	public columnToDisplay(highlight: HighlightLine, column: number): number {
		return layout.columnToDisplay(highlight, column);
	}

	public resolvePaletteIndex(color: { r: number; g: number; b: number; a: number }): number | null {
		const index = Msx1Colors.indexOf(color);
		return index === -1 ? null : index;
	}

	public invertColorIndex(colorIndex: number): number {
		const color = Msx1Colors[colorIndex];
		if (!color) {
			return constants.COLOR_CODE_TEXT;
		}
		const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
		return luminance > 0.5 ? 0 : 15;
	}

	public resetActionPromptState(): void {
		pendingActionPrompt = null;
		actionPromptButtons.saveAndContinue = null;
		actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
		actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
	}

	public pointInRect(x: number, y: number, rect: RectBounds | null): boolean {
		if (!rect) {
			return false;
		}
		return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
	}

	public hasPendingRuntimeReload(): boolean {
		return saveGeneration > appliedGeneration;
	}

	public getConsoleRuntime(): ConsoleRuntimeBridge | null {
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
		if (typeof runtime.resumeFromSnapshot !== 'function') {
			return null;
		}
		if (typeof runtime.isLuaRuntimeFailed !== 'function') {
			return null;
		}
		return runtime;
	}

	public prepareRuntimeSnapshotForResume(snapshot: unknown): Record<string, unknown> | null {
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

	public scheduleRuntimeTask(task: () => void | Promise<void>, onError: (error: unknown) => void): void {
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

	public handleRuntimeTaskError(error: unknown, fallbackMessage: string): void {
		const message = error instanceof Error ? error.message : String(error);
		$.paused = true;
		this.activate();
		this.showMessage(`${fallbackMessage}: ${message}`, constants.COLOR_STATUS_ERROR, 4.0);
	}

	public truncateTextToWidth(text: string, maxWidth: number): string {
		return truncateTextToWidthExternal(text, maxWidth, (ch) => font.advance(ch), spaceAdvance);
	}

	public measureText(text: string): number {
		return measureTextGeneric(text, (ch) => font.advance(ch), spaceAdvance);
	}

	public assertMonospace(): void {
		const sample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-*/%<>=#(){}[]:,.;\'"`~!@^&|\\?_ ';
		const reference = font.advance('M');
		for (let i = 0; i < sample.length; i++) {
			const candidate = font.advance(sample.charAt(i));
			if (candidate !== reference) {
				warnNonMonospace = true;
				break;
			}
		}
	}

	public centerCursorVertically(): void {
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

	public ensureCursorVisible(): void {
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

		if (wordWrapEnabled) {
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

	public buildMemberCompletionItems(request: {
		objectName: string;
		operator: '.' | ':';
		prefix: string;
		assetId: string | null;
		chunkName: string | null;
	}): LuaCompletionItem[] {
		if (request.objectName.length === 0) {
			return [];
		}
		const response = listLuaObjectMembersFn({
			assetId: request.assetId ?? null,
			chunkName: request.chunkName ?? null,
			expression: request.objectName,
			operator: request.operator,
		});
		if (response.length === 0) {
			return [];
		}
		const items: LuaCompletionItem[] = [];
		for (let index = 0; index < response.length; index += 1) {
			const entry = response[index];
			if (!entry || !entry.name || entry.name.length === 0) {
				continue;
			}
			const kind = entry.kind === 'method' ? 'native_method' : 'native_property';
			const parameters = entry.parameters && entry.parameters.length > 0 ? entry.parameters.slice() : undefined;
			const detail = entry.detail ?? null;
			items.push({
				label: entry.name,
				insertText: entry.name,
				sortKey: `${kind}:${entry.name.toLowerCase()}`,
				kind,
				detail,
				parameters,
			});
		}
		items.sort((a, b) => a.label.localeCompare(b.label));
		return items;
	}

	protected visibleRowCount(): number {
		return cachedVisibleRowCount > 0 ? cachedVisibleRowCount : 1;
	}

	protected visibleColumnCount(): number {
		return cachedVisibleColumnCount > 0 ? cachedVisibleColumnCount : 1;
	}

	protected resetBlink(): void {
		blinkTimer = 0;
		cursorVisible = true;
	}

	public shouldFireRepeat(keyboard: KeyboardInput, code: string, deltaSeconds: number): boolean {
		return input.shouldRepeatPublic(keyboard, code, deltaSeconds);
	}

	// Input overrides moved to InputController
}
