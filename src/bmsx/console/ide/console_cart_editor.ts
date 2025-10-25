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
import { Msx1Colors } from '../../systems/msx';
import { clamp } from '../../utils/utils';
import { CHARACTER_CODES, CHARACTER_MAP } from './character_map';
import * as constants from './constants';
import { getApiCompletionData, getKeywordCompletions, KEYWORDS } from './intellisense';
import { isWhitespace, isWordChar, isIdentifierChar, isIdentifierStartChar } from './text_utils';
import type { InlineFieldMetrics } from './inline_text_field';
import {
	caretX as inlineFieldCaretX,
	createInlineTextField,
	clampCursor as inlineFieldClampCursor,
	clampSelectionAnchor as inlineFieldClampSelectionAnchor,
	deleteForward as inlineFieldDeleteForward,
	deleteSelection as inlineFieldDeleteSelection,
	deleteWordBackward as inlineFieldDeleteWordBackward,
	deleteWordForward as inlineFieldDeleteWordForward,
	insertValue as inlineFieldInsert,
	measureRange as inlineFieldMeasureRange,
	moveCursor as inlineFieldMoveCursor,
	moveCursorRelative as inlineFieldMoveCursorRelative,
	moveToEnd as inlineFieldMoveToEnd,
	moveToStart as inlineFieldMoveToStart,
	moveWordLeft as inlineFieldMoveWordLeft,
	moveWordRight as inlineFieldMoveWordRight,
	registerPointerClick as inlineFieldRegisterPointerClick,
	resolveColumn as inlineFieldResolveColumn,
	selectAll as inlineFieldSelectAll,
	selectedText as inlineFieldGetSelectedText,
	selectWordAt as inlineFieldSelectWordAt,
	selectionLength as inlineFieldSelectionLength,
	selectionRange as inlineFieldSelectionRange,
	setFieldText,
	backspace as inlineFieldBackspace,
} from './inline_text_field';
import { ConsoleScrollbar } from './scrollbar';
import type {
	CachedHighlight,
	CodeHoverTooltip,
	CodeTabContext,
	CompletionCacheEntry,
	CompletionContext,
	CompletionSession,
	CompletionTrigger,
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
	HighlightLine,
	InlineInputOptions,
	InlineTextField,
	LuaCompletionItem,
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
	ParameterHintState,
} from './types';
import {
	consumeKey as consumeKeyboardKey,
	getKeyboardButtonState,
	isKeyJustPressed as isKeyJustPressedGlobal,
	isKeyPressed as isKeyPressedGlobal,
	isKeyTyped as isKeyTypedGlobal,
	isModifierPressed as isModifierPressedGlobal,
	resetKeyPressRecords,
	shouldAcceptKeyPress as shouldAcceptKeyPressGlobal,
	clearKeyPressRecord,
} from './input_helpers';

const EDITOR_TOGGLE_KEY = 'Escape';
const EDITOR_TOGGLE_GAMEPAD_BUTTONS: readonly BGamepadButton[] = ['select', 'start'];

const keywordCompletions = getKeywordCompletions();
const apiCompletionData = getApiCompletionData();

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
	private readonly highlightCache: Map<number, CachedHighlight> = new Map();
	private readonly maxHighlightCache = 2048;
	private readonly gutterWidth: number;
	private readonly headerHeight: number;
	private readonly tabBarHeight: number;
	private readonly topMargin: number;
	private readonly baseBottomMargin: number;
	private readonly repeatState: Map<string, RepeatEntry> = new Map();
	private readonly message: MessageState = { text: '', color: constants.COLOR_STATUS_TEXT, timer: 0, visible: false };
	private deferredMessageDuration: number | null = null;
	private runtimeErrorOverlay: RuntimeErrorOverlay | null = null;
	private executionStopRow: number | null = null;
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
		'NumpadDivide',
		...CHARACTER_CODES,
	])];

	private static customClipboard: string | null = null;

	private readonly topBarButtonBounds: Record<TopBarButtonId, RectBounds> = {
		resume: { left: 0, top: 0, right: 0, bottom: 0 },
		reboot: { left: 0, top: 0, right: 0, bottom: 0 },
		save: { left: 0, top: 0, right: 0, bottom: 0 },
		resources: { left: 0, top: 0, right: 0, bottom: 0 },
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
	private lines: string[] = [''];
	private cursorRow = 0;
	private cursorColumn = 0;
	private scrollRow = 0;
	private scrollColumn = 0;
	private dirty = false;
	private blinkTimer = 0;
	private cursorVisible = true;
	private desiredColumn = 0;
	private desiredDisplayOffset = 0;
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
	private readonly resourceSearchField: InlineTextField;
	private readonly lineJumpField: InlineTextField;
	private readonly createResourceField: InlineTextField;
	private readonly inlineFieldMetricsRef: InlineFieldMetrics;
	private readonly scrollbars: Record<ScrollbarKind, ConsoleScrollbar>;
	private activeScrollbarDrag: { kind: ScrollbarKind; pointerOffset: number } | null = null;
	private toggleInputLatch = false;
	private lastPointerClickTimeMs = 0;
	private lastPointerClickRow = -1;
	private lastPointerClickColumn = -1;
	private tabHoverId: string | null = null;
	private tabDragState: TabDragState | null = null;
	private crtOptionsSnapshot: CrtOptionsSnapshot | null = null;
	private resolutionMode: EditorResolutionMode = 'viewport';
	private readonly tabDirtyMarkerAssetId = 'msx_6b_font_ctrl_bel';
	private tabDirtyMarkerWidth: number | null = null;
	private tabDirtyMarkerHeight: number | null = null;
	private cursorRevealSuspended = false;
	private searchActive = false;
	private searchVisible = false;
	private searchQuery = '';
	private symbolSearchQuery = '';
	private resourceSearchQuery = '';
	private completionSession: CompletionSession | null = null;
	private readonly localCompletionCache: Map<string, CompletionCacheEntry> = new Map();
	private cachedGlobalCompletionItems: LuaCompletionItem[] | null = null;
	private pendingEditContext: EditContext | null = null;
	private cursorScreenInfo: CursorScreenInfo | null = null;
	private parameterHint: ParameterHintState | null = null;
	private builtinDescriptors: ConsoleLuaBuiltinDescriptor[] | null = null;
	private readonly builtinDescriptorMap: Map<string, ConsoleLuaBuiltinDescriptor> = new Map();
	private lineJumpActive = false;
	private symbolSearchActive = false;
	private symbolSearchVisible = false;
	private symbolSearchGlobal = false;
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
	private pendingCompletionRequest: { context: CompletionContext; trigger: CompletionTrigger; elapsed: number } | null = null;
	private suppressNextAutoCompletion = false;
	private symbolCatalog: SymbolCatalogEntry[] = [];
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
	private resourcePanelFilterMode: 'lua_only' | 'all' = 'lua_only';
	private resourcePanelResourceCount = 0;
	private pendingResourceSelectionAssetId: string | null = null;
	private resourcePanelWidthRatio: number | null = null;
	private resourcePanelResizing = false;
	private resourceBrowserHorizontalScroll = 0;
	private resourceBrowserMaxLineWidth = 0;
	private codeVerticalScrollbarVisible = false;
	private codeHorizontalScrollbarVisible = false;
	private cachedVisibleRowCount = 1;
	private cachedVisibleColumnCount = 1;
	private dimCrtInEditor: boolean = false; // Default value; can be changed via settings
	private wordWrapEnabled = true;
	private visualLines: VisualLineSegment[] = [];
	private rowToFirstVisualLine: number[] = [];
	private visualLinesDirty = true;
	private lastPointerRowResolution: { visualIndex: number; segment: VisualLineSegment | null } | null = null;

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
	this.listBuiltinLuaFunctionsFn = options.listBuiltinLuaFunctions;
	this.primaryAssetId = options.primaryAssetId;
		if ($.debug) {
			this.listResourcesFn();
		}
		this.viewportWidth = options.viewport.width;
		this.viewportHeight = options.viewport.height;
		this.font = new ConsoleEditorFont();
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
		this.topMargin = this.headerHeight + this.tabBarHeight + 2;
		this.baseBottomMargin = this.lineHeight + 6;
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
		api.rectfillColor(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, constants.HOVER_TOOLTIP_BACKGROUND);
		api.rect(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, constants.HOVER_TOOLTIP_BORDER);
		for (let i = 0; i < visibleLines.length; i += 1) {
			const lineY = bubbleTop + constants.HOVER_TOOLTIP_PADDING_Y + i * this.lineHeight;
			this.drawText(api, visibleLines[i], bubbleLeft + constants.HOVER_TOOLTIP_PADDING_X, lineY, constants.COLOR_STATUS_TEXT);
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
		this.setExecutionStopHighlight(targetRow);
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

	private resourceDescriptorMatchesFilter(descriptor: ConsoleResourceDescriptor): boolean {
		if (this.resourcePanelFilterMode === 'all') {
			return true;
		}
		if (descriptor.type === 'lua') {
			return true;
		}
		const path = descriptor.path;
		if (typeof path === 'string' && path.length > 0) {
			if (path.toLowerCase().endsWith('.lua')) {
				return true;
			}
		}
		const assetId = descriptor.assetId;
		if (typeof assetId === 'string' && assetId.length > 0) {
			if (assetId.toLowerCase().endsWith('.lua')) {
				return true;
			}
		}
		return false;
	}

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

	private adjustExecutionStopHighlightAfterDeletion(startRow: number, endRow: number): void {
		const existingRow = this.executionStopRow;
		if (existingRow === null) {
			return;
		}
		if (existingRow < startRow) {
			return;
		}
		if (existingRow <= endRow) {
			this.setExecutionStopHighlight(null);
			return;
		}
		const shift = endRow - startRow + 1;
		this.setExecutionStopHighlight(existingRow - shift);
	}

	private syncRuntimeErrorOverlayFromContext(context: CodeTabContext | null): void {
		this.runtimeErrorOverlay = context ? context.runtimeErrorOverlay ?? null : null;
		this.executionStopRow = context ? context.executionStopRow ?? null : null;
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
		const horizontalMargin = this.gutterWidth + constants.ERROR_OVERLAY_CONNECTOR_OFFSET + constants.ERROR_OVERLAY_PADDING_X * 2 + 2;
		const available = this.viewportWidth - horizontalMargin;
		if (available <= this.charAdvance) {
			return this.charAdvance;
		}
		return available;
	}

	private get bottomMargin(): number {
		if (!this.message.visible) {
			return this.baseBottomMargin;
		}
		const segments = this.getStatusMessageLines();
		const lineCount = Math.max(1, segments.length);
		return this.baseBottomMargin + lineCount * this.lineHeight + 4;
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
			const wrapped = this.wrapRuntimeErrorLine(rawLines[i], maxWidth);
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
		this.processPendingCompletion(deltaSeconds);
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
		const frameColor = Msx1Colors[constants.COLOR_FRAME];
		api.rectfillColor(0, 0, this.viewportWidth, this.viewportHeight, { r: frameColor.r, g: frameColor.g, b: frameColor.b, a: frameColor.a });
		this.drawTopBar(api);
		this.drawTabBar(api);
		this.drawResourcePanel(api);
		if (this.isResourceViewActive()) {
			this.drawResourceViewer(api);
		} else {
			this.drawCreateResourceBar(api);
			this.drawSearchBar(api);
			this.drawResourceSearchBar(api);
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
		api.rectfill(0, barTop, this.viewportWidth, barBottom, constants.COLOR_TAB_BAR_BACKGROUND);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, constants.COLOR_TAB_BORDER);
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
				closeWidth = this.measureText(constants.TAB_CLOSE_BUTTON_SYMBOL) + constants.TAB_CLOSE_BUTTON_PADDING_X * 2;
			}
			let indicatorWidth = 0;
			if (tab.closable) {
				indicatorWidth = closeWidth;
			} else if (markerMetrics) {
				indicatorWidth = markerMetrics.width + constants.TAB_DIRTY_MARKER_SPACING;
			}
			const tabWidth = textWidth + constants.TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
			const left = tabX;
			const right = left + tabWidth;
			const top = barTop + 1;
			const bottom = barBottom - 1;
			const bounds: RectBounds = { left, top, right, bottom };
			this.tabButtonBounds.set(tab.id, bounds);
			const active = this.activeTabId === tab.id;
			const fillColor = active ? constants.COLOR_TAB_ACTIVE_BACKGROUND : constants.COLOR_TAB_INACTIVE_BACKGROUND;
			const textColor = active ? constants.COLOR_TAB_ACTIVE_TEXT : constants.COLOR_TAB_INACTIVE_TEXT;
			api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, fillColor);
			api.rect(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_TAB_BORDER);
			const textY = bounds.top + constants.TAB_BUTTON_PADDING_Y;
			const showCloseButton = tab.closable && hovered;
			const indicatorLeft = bounds.right - indicatorWidth;
			const textX = bounds.left + constants.TAB_BUTTON_PADDING_X;
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
					const closeX = closeBounds.left + constants.TAB_CLOSE_BUTTON_PADDING_X;
					const closeY = closeBounds.top + constants.TAB_CLOSE_BUTTON_PADDING_Y;
					this.drawText(api, constants.TAB_CLOSE_BUTTON_SYMBOL, closeX, closeY, textColor);
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
					const spacing = Math.max(0, constants.TAB_DIRTY_MARKER_SPACING);
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
			tabX = right + constants.TAB_BUTTON_SPACING;
		}
		const remainingTop = barBottom - 1;
		if (tabX < this.viewportWidth) {
			api.rectfill(tabX, remainingTop, this.viewportWidth, barBottom, constants.COLOR_TAB_BAR_BACKGROUND);
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
			this.updateResourceBrowserMetrics();
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
		this.clearExecutionStopHighlights();
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
		this.applyInputOverrides(true);
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
	this.closeCompletionSession();
	this.repeatState.clear();
		this.resetKeyPressGuards();
		this.applyInputOverrides(false);
		this.selectionAnchor = null;
		this.pointerSelecting = false;
		this.pointerPrimaryWasPressed = false;
		this.pointerAuxWasPressed = false;
		this.tabDragState = null;
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
			this.handleResourceBrowserKeyboard(keyboard, deltaSeconds);
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
		const inlineFieldFocused = this.searchActive || this.symbolSearchActive || this.resourceSearchActive || this.lineJumpActive || this.createResourceActive;
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
	if ((ctrlDown || metaDown) && !altDown && this.completionSession === null && this.isCodeTabActive() && isKeyJustPressedGlobal(this.playerIndex, 'Space')) {
		consumeKeyboardKey(keyboard, 'Space');
		const context = this.analyzeCompletionContext();
		if (context) {
			this.openCompletionSessionFromContext(context, 'manual');
		} else {
			this.closeCompletionSession();
		}
		return;
	}
	if (this.handleCompletionKeybindings(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown, metaDown)) {
		return;
	}
	this.handleNavigationKeys(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown);
	this.handleEditingKeys(keyboard, deltaSeconds, shiftDown, ctrlDown);
	if (ctrlDown || metaDown || altDown) {
		return;
	}
		this.handleCharacterInput(keyboard, shiftDown);
		if (isKeyJustPressedGlobal(this.playerIndex, 'Space')) {
			this.insertText(' ');
			consumeKeyboardKey(keyboard, 'Space');
		}
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
		const textChanged = this.handleInlineFieldEditing(this.createResourceField, keyboard, {
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
		this.closeResourceSearch(false);
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

	private openResourceSearch(initialQuery: string = ''): void {
		this.closeSearch(false);
		this.closeLineJump(false);
		this.closeSymbolSearch(false);
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
		this.closeSearch(false);
		this.closeLineJump(false);
		this.closeResourceSearch(false);
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
		this.closeSearch(false);
		this.closeLineJump(false);
		this.closeResourceSearch(false);
		this.symbolSearchGlobal = true;
		this.symbolSearchVisible = true;
		this.symbolSearchActive = true;
		this.applySymbolSearchFieldText(initialQuery, true);
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

	private isSymbolSearchCompactMode(): boolean {
		return this.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
	}

	private symbolSearchEntryHeight(): number {
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
		const textChanged = this.handleInlineFieldEditing(this.resourceSearchField, keyboard, {
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
		this.closeSymbolSearch(false);
		this.closeResourceSearch(false);
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

	private handleNavigationKeys(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, altDown: boolean): void {
		const previousPosition: Position = { row: this.cursorRow, column: this.cursorColumn };
		if (shiftDown) {
			this.ensureSelectionAnchor(previousPosition);
		}

		if (altDown) {
			let movedAlt = false;
			if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'ArrowUp');
				this.moveSelectionLines(-1);
				movedAlt = true;
			}
			if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
				consumeKeyboardKey(keyboard, 'ArrowDown');
				this.moveSelectionLines(1);
				movedAlt = true;
			}
			if (movedAlt) {
				return;
			}
			if (isKeyPressedGlobal(this.playerIndex, 'ArrowUp') || isKeyPressedGlobal(this.playerIndex, 'ArrowDown')) {
				return;
			}
		}

		if (!shiftDown && this.collapseSelectionOnNavigation(keyboard)) {
			return;
		}

		let moved = false;

		if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
			this.moveCursorVertical(-1);
			consumeKeyboardKey(keyboard, 'ArrowUp');
			moved = true;
		}
		if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
			this.moveCursorVertical(1);
			consumeKeyboardKey(keyboard, 'ArrowDown');
			moved = true;
		}
		if (ctrlDown) {
			if (this.shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) {
				this.moveWordLeft();
				consumeKeyboardKey(keyboard, 'ArrowLeft');
				moved = true;
			}
			if (this.shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) {
				this.moveWordRight();
				consumeKeyboardKey(keyboard, 'ArrowRight');
				moved = true;
			}
		}
		else {
			if (this.shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) {
				this.moveCursorHorizontal(-1);
				consumeKeyboardKey(keyboard, 'ArrowLeft');
				moved = true;
			}
			if (this.shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) {
				this.moveCursorHorizontal(1);
				consumeKeyboardKey(keyboard, 'ArrowRight');
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
			consumeKeyboardKey(keyboard, 'Home');
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
			consumeKeyboardKey(keyboard, 'End');
			moved = true;
		}
		if (this.shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
			const rows = this.visibleRowCount();
			this.ensureVisualLines();
			const visualCount = this.getVisualLineCount();
			const currentVisual = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
			const targetVisual = clamp(currentVisual - rows, 0, Math.max(0, visualCount - 1));
			this.setCursorFromVisualIndex(targetVisual, this.desiredColumn, this.desiredDisplayOffset);
			this.resetBlink();
			consumeKeyboardKey(keyboard, 'PageUp');
			moved = true;
		}
		if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			const rows = this.visibleRowCount();
			this.ensureVisualLines();
			const visualCount = this.getVisualLineCount();
			const currentVisual = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
			const targetVisual = clamp(currentVisual + rows, 0, Math.max(0, visualCount - 1));
			this.setCursorFromVisualIndex(targetVisual, this.desiredColumn, this.desiredDisplayOffset);
			this.resetBlink();
			consumeKeyboardKey(keyboard, 'PageDown');
			moved = true;
		}

		if (!shiftDown && moved) {
			this.clearSelection();
		}
		if (moved) {
			this.breakUndoSequence();
			this.revealCursor();
		}

		if (shiftDown && isKeyJustPressedGlobal(this.playerIndex, 'Tab')) {
			this.unindentSelectionOrLine();
			consumeKeyboardKey(keyboard, 'Tab');
		}
	}

	private handleEditingKeys(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean): void {
		if (this.shouldFireRepeat(keyboard, 'Backspace', deltaSeconds)) {
			if (ctrlDown) {
				this.deleteWordBackward();
			} else {
				this.backspace();
			}
			consumeKeyboardKey(keyboard, 'Backspace');
		}
		if (this.shouldFireRepeat(keyboard, 'Delete', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'Delete');
			if (shiftDown && !ctrlDown) {
				this.deleteActiveLines();
			} else {
				this.deleteForward();
			}
		}
		if (!shiftDown && isKeyJustPressedGlobal(this.playerIndex, 'Tab')) {
			this.insertTab();
			consumeKeyboardKey(keyboard, 'Tab');
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			this.insertLineBreak();
			consumeKeyboardKey(keyboard, 'Enter');
		}
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
		this.activeScrollbarDrag = null;
		this.lastPointerRowResolution = null;
		this.clearHoverTooltip();
		this.clearGotoHoverHighlight();
		return;
	}
	if (!snapshot.valid) {
		this.activeScrollbarDrag = null;
		this.clearGotoHoverHighlight();
		this.lastPointerRowResolution = null;
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
				this.updateTabDrag(snapshot.viewportX);
			}
			this.pointerSelecting = false;
			this.pointerPrimaryWasPressed = snapshot.primaryPressed;
			this.clearGotoHoverHighlight();
			this.clearHoverTooltip();
			return;
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
					this.invalidateVisualLines();
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
					this.handleInlineFieldPointer(this.resourceSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
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
			this.focusEditorFromResourceSearch();
			this.focusEditorFromSymbolSearch();
			this.closeCompletionSession();
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
		if (text.length <= constants.HOVER_TOOLTIP_MAX_LINE_LENGTH) {
			return text;
		}
		return text.slice(0, constants.HOVER_TOOLTIP_MAX_LINE_LENGTH - 3) + '...';
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
		if (!inspection) {
			if (!this.inspectorRequestFailed) {
				this.showMessage(`Definition not found for ${token.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
			}
			return false;
		}
		if (!inspection.definition) {
			this.showMessage(`Definition not found for ${token.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
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
		switch (button) {
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
			const removal = indent.charAt(0) === '\t' ? 1 : Math.min(constants.TAB_SPACES, indent.length);
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
		this.onCursorMoved();
	}

	private moveCursorVertical(delta: number): void {
		this.ensureVisualLines();
		const visualCount = this.getVisualLineCount();
		if (visualCount === 0) {
			return;
		}
		const currentIndex = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
		const targetIndex = clamp(currentIndex + delta, 0, visualCount - 1);
		const desired = this.desiredColumn;
		const desiredDisplay = this.desiredDisplayOffset;
		this.setCursorFromVisualIndex(targetIndex, desired, desiredDisplay);
		this.resetBlink();
		this.revealCursor();
		this.onCursorMoved();
	}

	private moveCursorHorizontal(delta: number): void {
		if (delta === 0) {
			return;
		}
		this.ensureVisualLines();
		const visualCount = this.getVisualLineCount();
		if (visualCount === 0) {
			return;
		}
		const visualIndex = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
		const segment = this.visualIndexToSegment(visualIndex);
		if (!segment) {
			return;
		}
		const line = this.lines[segment.row] ?? '';
		if (delta < 0) {
			if (this.cursorColumn > segment.startColumn) {
				this.cursorColumn -= 1;
			} else {
				let moved = false;
				if (this.wordWrapEnabled && visualIndex > 0) {
					const prevSegment = this.visualIndexToSegment(visualIndex - 1);
					if (prevSegment && prevSegment.row === segment.row) {
						this.cursorRow = prevSegment.row;
						const prevLine = this.lines[prevSegment.row] ?? '';
						const prevEnd = Math.max(prevSegment.endColumn, prevSegment.startColumn);
						const hasMoreBefore = prevEnd > prevSegment.startColumn;
						const targetColumn = hasMoreBefore && prevEnd < prevLine.length
							? Math.max(prevSegment.startColumn, prevEnd - 1)
							: Math.min(prevEnd, prevLine.length);
						this.cursorColumn = clamp(targetColumn, 0, prevLine.length);
						moved = true;
					}
				}
				if (!moved) {
					if (segment.row > 0) {
						this.cursorRow = segment.row - 1;
						this.cursorColumn = this.lines[this.cursorRow].length;
					}
				}
			}
		} else { // delta > 0
			if (this.cursorColumn < segment.endColumn && this.cursorColumn < line.length) {
				this.cursorColumn += 1;
			} else {
				let moved = false;
				if (this.wordWrapEnabled && visualIndex < visualCount - 1) {
					const nextSegment = this.visualIndexToSegment(visualIndex + 1);
					if (nextSegment && nextSegment.row === segment.row) {
						this.cursorRow = nextSegment.row;
						const nextLine = this.lines[nextSegment.row] ?? '';
						this.cursorColumn = clamp(nextSegment.startColumn, 0, nextLine.length);
						moved = true;
					}
				}
				if (!moved) {
					if (segment.row < this.lines.length - 1) {
						this.cursorRow = segment.row + 1;
						this.cursorColumn = 0;
					}
				}
			}
		}
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
		this.onCursorMoved();
	}

	private moveWordLeft(): void {
		const destination = this.findWordLeft(this.cursorRow, this.cursorColumn);
		this.cursorRow = destination.row;
		this.cursorColumn = destination.column;
		this.updateDesiredColumn();
		this.resetBlink();
		this.revealCursor();
		this.onCursorMoved();
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
		while (isWhitespace(currentChar)) {
			const previous = this.stepLeft(currentRow, currentColumn);
			if (!previous) {
				return { row: currentRow, column: currentColumn };
			}
			currentRow = previous.row;
			currentColumn = previous.column;
			currentChar = this.charAt(currentRow, currentColumn);
		}
		const word = isWordChar(currentChar);
		while (true) {
			const previous = this.stepLeft(currentRow, currentColumn);
			if (!previous) {
				break;
			}
			const previousChar = this.charAt(previous.row, previous.column);
			if (isWhitespace(previousChar) || isWordChar(previousChar) !== word) {
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
		while (isWhitespace(currentChar)) {
			const next = this.stepRight(currentRow, currentColumn);
			if (!next) {
				const lastRow = this.lines.length - 1;
				return { row: lastRow, column: this.lines[lastRow].length };
			}
			currentRow = next.row;
			currentColumn = next.column;
			currentChar = this.charAt(currentRow, currentColumn);
		}
		const word = isWordChar(currentChar);
		while (true) {
			const next = this.stepRight(currentRow, currentColumn);
			if (!next) {
				const lastRow = this.lines.length - 1;
				currentRow = lastRow;
				currentColumn = this.lines[lastRow].length;
				break;
			}
			const nextChar = this.charAt(next.row, next.column);
			if (isWhitespace(nextChar) || isWordChar(nextChar) !== word) {
				currentRow = next.row;
				currentColumn = next.column;
				break;
			}
			currentRow = next.row;
			currentColumn = next.column;
		}
		while (isWhitespace(this.charAt(currentRow, currentColumn))) {
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
		this.onCursorMoved();
	}

	private handleCharacterInput(keyboard: KeyboardInput, shiftDown: boolean): void {
		for (let i = 0; i < CHARACTER_CODES.length; i++) {
			const code = CHARACTER_CODES[i];
			if (!isKeyTypedGlobal(this.playerIndex, code)) {
				continue;
			}
			const entry = CHARACTER_MAP[code];
			const value = shiftDown ? entry.shift : entry.normal;
			this.insertText(value);
			consumeKeyboardKey(keyboard, code);
		}
	}

	private resetKeyPressGuards(): void {
		resetKeyPressRecords();
	}

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

	private handleInlineFieldEditing(field: InlineTextField, keyboard: KeyboardInput, options: InlineInputOptions): boolean {
		const { ctrlDown, metaDown, shiftDown, altDown, deltaSeconds, allowSpace } = options;
		const characterFilter = options.characterFilter;
		const maxLength = options.maxLength !== undefined ? options.maxLength : null;
		const useCtrl = ctrlDown || metaDown;
		const initialText = field.text;
		const initialCursor = field.cursor;
		const initialAnchor = field.selectionAnchor;

		if (useCtrl && isKeyJustPressedGlobal(this.playerIndex, 'KeyA')) {
			consumeKeyboardKey(keyboard, 'KeyA');
			inlineFieldSelectAll(field);
		}

		if (useCtrl && isKeyJustPressedGlobal(this.playerIndex, 'KeyC')) {
			const selected = inlineFieldGetSelectedText(field);
			const payload = selected && selected.length > 0 ? selected : field.text;
			if (payload.length > 0) {
				void this.writeClipboard(payload, 'Copied to editor clipboard');
			}
			consumeKeyboardKey(keyboard, 'KeyC');
		}

		if (useCtrl && isKeyJustPressedGlobal(this.playerIndex, 'KeyX')) {
			const selected = inlineFieldGetSelectedText(field);
			let payload = selected;
			if (!payload || payload.length === 0) {
				payload = field.text;
				if (payload.length > 0) {
					inlineFieldSelectAll(field);
				}
			}
			if (payload && payload.length > 0) {
				void this.writeClipboard(payload, 'Cut to editor clipboard');
				inlineFieldDeleteSelection(field);
			}
			consumeKeyboardKey(keyboard, 'KeyX');
		}

		if (useCtrl && isKeyJustPressedGlobal(this.playerIndex, 'KeyV')) {
			const clipboard = ConsoleCartEditor.customClipboard;
			if (clipboard && clipboard.length > 0) {
				const normalized = clipboard.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
				const merged = normalized.split('\n').join('');
				if (merged.length > 0) {
					const filtered = characterFilter ? merged.split('').filter(characterFilter).join('') : merged;
					if (filtered.length > 0) {
						let insertion = filtered;
						if (maxLength !== null) {
							const remaining = Math.max(0, maxLength - (field.text.length - inlineFieldSelectionLength(field)));
							if (remaining <= 0) {
								insertion = '';
							} else if (insertion.length > remaining) {
								insertion = insertion.slice(0, remaining);
							}
						}
						if (insertion.length > 0) {
							inlineFieldInsert(field, insertion);
						}
					}
				}
			} else {
				this.showMessage('Editor clipboard is empty', constants.COLOR_STATUS_WARNING, 1.5);
			}
			consumeKeyboardKey(keyboard, 'KeyV');
		}

		if (this.shouldFireRepeat(keyboard, 'Backspace', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'Backspace');
			if (useCtrl) {
				inlineFieldDeleteWordBackward(field);
			} else {
				inlineFieldBackspace(field);
			}
		}

		if (this.shouldFireRepeat(keyboard, 'Delete', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'Delete');
			if (useCtrl) {
				inlineFieldDeleteWordForward(field);
			} else {
				inlineFieldDeleteForward(field);
			}
		}

		if (this.shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowLeft');
			if (useCtrl) {
				inlineFieldMoveWordLeft(field, shiftDown);
			} else {
				inlineFieldMoveCursorRelative(field, -1, shiftDown);
			}
		}

		if (this.shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowRight');
			if (useCtrl) {
				inlineFieldMoveWordRight(field, shiftDown);
			} else {
				inlineFieldMoveCursorRelative(field, 1, shiftDown);
			}
		}

		if (this.shouldFireRepeat(keyboard, 'Home', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'Home');
			inlineFieldMoveToStart(field, shiftDown);
		}

		if (this.shouldFireRepeat(keyboard, 'End', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'End');
			inlineFieldMoveToEnd(field, shiftDown);
		}

		if (allowSpace && !useCtrl && !metaDown && !altDown && this.shouldFireRepeat(keyboard, 'Space', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'Space');
			const remaining = maxLength !== null
				? Math.max(0, maxLength - (field.text.length - inlineFieldSelectionLength(field)))
				: undefined;
			if (remaining === undefined || remaining > 0) {
				inlineFieldInsert(field, ' ');
			}
		}

		if (!altDown) {
			for (let i = 0; i < CHARACTER_CODES.length; i += 1) {
				const code = CHARACTER_CODES[i];
				if (!isKeyTypedGlobal(this.playerIndex, code)) {
					continue;
				}
				const entry = CHARACTER_MAP[code];
				const value = shiftDown ? entry.shift : entry.normal;
				if (value.length === 0) {
					consumeKeyboardKey(keyboard, code);
					continue;
				}
				if (characterFilter && !characterFilter(value)) {
					consumeKeyboardKey(keyboard, code);
					continue;
				}
				if (maxLength !== null) {
					const available = maxLength - (field.text.length - inlineFieldSelectionLength(field));
					if (available <= 0) {
						consumeKeyboardKey(keyboard, code);
						continue;
					}
				}
				inlineFieldInsert(field, value);
				consumeKeyboardKey(keyboard, code);
			}
		}

		inlineFieldClampCursor(field);
		inlineFieldClampSelectionAnchor(field);
		const textChanged = field.text !== initialText;
		if (!textChanged && field.cursor === initialCursor && field.selectionAnchor === initialAnchor) {
			return false;
		}
		return textChanged;
	}

	private handleInlineFieldPointer(field: InlineTextField, textLeft: number, pointerX: number, justPressed: boolean, pointerPressed: boolean): void {
		const column = inlineFieldResolveColumn(field, this.inlineFieldMetrics(), textLeft, pointerX);
		if (justPressed) {
			const isDouble = inlineFieldRegisterPointerClick(field, column, () => $.platform.clock.now(), constants.DOUBLE_CLICK_MAX_INTERVAL_MS);
			if (isDouble) {
				inlineFieldSelectWordAt(field, column);
				field.pointerSelecting = false;
			} else {
				field.selectionAnchor = column;
				field.cursor = column;
				field.desiredColumn = column;
				field.pointerSelecting = true;
			}
			inlineFieldClampCursor(field);
			inlineFieldClampSelectionAnchor(field);
			this.resetBlink();
			return;
		}
		if (!pointerPressed) {
			field.pointerSelecting = false;
			return;
		}
		if (field.pointerSelecting) {
			inlineFieldMoveCursor(field, column, true);
			inlineFieldClampCursor(field);
			inlineFieldClampSelectionAnchor(field);
		}
	}

	private updateDesiredColumn(): void {
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
			const visualIndex = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
			const segment = this.visualIndexToSegment(visualIndex);
			if (segment) {
				segmentStartColumn = segment.startColumn;
			}
		}
		const segmentDisplayStart = this.columnToDisplay(highlight, segmentStartColumn);
		this.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
		if (this.desiredDisplayOffset < 0) {
			this.desiredDisplayOffset = 0;
		}
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
		this.recordEditContext('insert', text);
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
		this.recordEditContext('insert', '\n');
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
			const removedChar = line.charAt(this.cursorColumn - 1);
			const before = line.slice(0, this.cursorColumn - 1);
			const after = line.slice(this.cursorColumn);
			this.lines[this.cursorRow] = before + after;
			this.invalidateLine(this.cursorRow);
			this.cursorColumn -= 1;
			this.recordEditContext('delete', removedChar);
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
		this.recordEditContext('delete', '\n');
		this.cursorRow -= 1;
		this.cursorColumn = previousLine.length;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.revealCursor();
	}

	private deleteActiveLines(): void {
		if (this.lines.length === 0) {
			return;
		}
		const range = this.getLineRangeForMovement();
		const maxRowIndex = this.lines.length - 1;
		const startRow = clamp(range.startRow, 0, maxRowIndex);
		const endRow = clamp(range.endRow, startRow, maxRowIndex);
		const deleteCount = endRow - startRow + 1;
		if (deleteCount <= 0) {
			return;
		}
		this.prepareUndo('delete-active-lines', false);
		this.lines.splice(startRow, deleteCount);
		if (this.lines.length === 0) {
			this.lines.push('');
		}
		this.adjustExecutionStopHighlightAfterDeletion(startRow, endRow);
		this.invalidateAllHighlights();
		this.cursorRow = Math.min(startRow, this.lines.length - 1);
		this.cursorColumn = 0;
		this.selectionAnchor = null;
		this.markTextMutated();
		this.resetBlink();
		this.updateDesiredColumn();
		this.ensureCursorVisible();
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
			const removedChar = updatedLine.charAt(this.cursorColumn);
			this.lines[this.cursorRow] = before + after;
			this.invalidateLine(this.cursorRow);
			this.recordEditContext('delete', removedChar);
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
		this.recordEditContext('delete', '\n');
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
			this.showMessage(message, constants.COLOR_STATUS_SUCCESS, 2.5);
		} catch (error) {
			if (this.tryShowLuaErrorOverlay(error)) {
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			this.showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
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
		if (isKeyJustPressedGlobal(this.playerIndex, 'ArrowLeft')) {
			consumeKeyboardKey(keyboard, 'ArrowLeft');
			this.collapseSelectionTo('start');
			this.breakUndoSequence();
			return true;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'ArrowUp')) {
			consumeKeyboardKey(keyboard, 'ArrowUp');
			this.collapseSelectionTo('start');
			this.breakUndoSequence();
			return true;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'ArrowRight')) {
			consumeKeyboardKey(keyboard, 'ArrowRight');
			this.collapseSelectionTo('end');
			this.breakUndoSequence();
			return true;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'ArrowDown')) {
			consumeKeyboardKey(keyboard, 'ArrowDown');
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
		this.recordEditContext(text.length === 0 ? 'delete' : 'replace', text);
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
		if (isWordChar(current)) {
			while (start > 0 && isWordChar(line.charAt(start - 1))) {
				start -= 1;
			}
			while (end < line.length && isWordChar(line.charAt(end))) {
				end += 1;
			}
		} else if (isWhitespace(current)) {
			while (start > 0 && isWhitespace(line.charAt(start - 1))) {
				start -= 1;
			}
			while (end < line.length && isWhitespace(line.charAt(end))) {
				end += 1;
			}
		} else {
			while (start > 0) {
				const previous = line.charAt(start - 1);
				if (isWordChar(previous) || isWhitespace(previous)) {
					break;
				}
				start -= 1;
			}
			while (end < line.length) {
				const next = line.charAt(end);
				if (isWordChar(next) || isWhitespace(next)) {
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
			this.recordEditContext('insert', fragment);
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
			this.recordEditContext('insert', normalized);
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
		this.invalidateVisualLines();
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
			&& now - this.lastHistoryTimestamp <= constants.UNDO_COALESCE_INTERVAL_MS;
		if (shouldMerge) {
			this.lastHistoryTimestamp = now;
			return;
		}
		const snapshot = this.captureSnapshot();
		if (this.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
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
		if (this.redoStack.length >= constants.UNDO_HISTORY_LIMIT) {
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
		if (this.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
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
		api.rectfill(0, 0, this.viewportWidth, primaryBarHeight, constants.COLOR_TOP_BAR);

		const buttonTop = 1;
		const buttonHeight = this.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
		const iconButtonSize = buttonHeight;
		const resolutionRight = this.viewportWidth - 4;
		const resolutionLeft = resolutionRight - iconButtonSize;
		const resolutionBottom = buttonTop + buttonHeight;
		const wrapRight = resolutionLeft - constants.HEADER_BUTTON_SPACING;
		const wrapLeft = wrapRight - iconButtonSize;
		this.topBarButtonBounds.resolution = { left: resolutionLeft, top: buttonTop, right: resolutionRight, bottom: resolutionBottom };
		this.topBarButtonBounds.wrap = { left: wrapLeft, top: buttonTop, right: wrapRight, bottom: resolutionBottom };
		this.topBarButtonBounds.resume = { left: 0, top: 0, right: 0, bottom: 0 };
		this.topBarButtonBounds.reboot = { left: 0, top: 0, right: 0, bottom: 0 };
		this.topBarButtonBounds.save = { left: 0, top: 0, right: 0, bottom: 0 };
		this.topBarButtonBounds.resources = { left: 0, top: 0, right: 0, bottom: 0 };
		this.topBarButtonBounds.filter = { left: 0, top: 0, right: 0, bottom: 0 };
		let buttonX = 4;
		const buttonEntries: Array<{ id: TopBarButtonId; label: string; disabled: boolean; active?: boolean }> = [
			{ id: 'resume', label: 'RESUME', disabled: false },
			{ id: 'reboot', label: 'REBOOT', disabled: false },
			{ id: 'save', label: 'SAVE', disabled: !this.dirty },
			{ id: 'resources', label: 'FILES', disabled: false, active: this.resourcePanelVisible },
		];
		if (this.resourcePanelVisible) {
			const filterLabel = this.resourcePanelFilterMode === 'lua_only' ? 'LUA' : 'ALL';
			buttonEntries.push({
				id: 'filter',
				label: filterLabel,
				disabled: false,
				active: this.resourcePanelFilterMode === 'lua_only',
			});
		}
		const availableRight = wrapLeft - constants.HEADER_BUTTON_SPACING;
		for (let i = 0; i < buttonEntries.length; i++) {
			const entry = buttonEntries[i];
			const textWidth = this.measureText(entry.label);
			const buttonWidth = textWidth + constants.HEADER_BUTTON_PADDING_X * 2;
			const right = buttonX + buttonWidth;
			if (right > availableRight) {
				this.topBarButtonBounds[entry.id] = { left: 0, top: 0, right: 0, bottom: 0 };
				break;
			}
			const bottom = buttonTop + buttonHeight;
			const bounds: RectBounds = { left: buttonX, top: buttonTop, right, bottom };
			this.topBarButtonBounds[entry.id] = bounds;
			const fillColor = entry.active
				? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND
				: (entry.disabled ? constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND);
			const textColor = entry.active
				? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT
				: (entry.disabled ? constants.COLOR_HEADER_BUTTON_TEXT_DISABLED : constants.COLOR_HEADER_BUTTON_TEXT);
			api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, fillColor);
			api.rect(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_HEADER_BUTTON_BORDER);
			this.drawText(api, entry.label, bounds.left + constants.HEADER_BUTTON_PADDING_X, bounds.top + constants.HEADER_BUTTON_PADDING_Y, textColor);
			buttonX = right + constants.HEADER_BUTTON_SPACING;
		}

		const wrapActive = this.wordWrapEnabled;
		const wrapFill = wrapActive ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND;
		const wrapTextColor = wrapActive ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT;
		const wrapBounds = this.topBarButtonBounds.wrap;
		api.rectfill(wrapBounds.left, wrapBounds.top, wrapBounds.right, wrapBounds.bottom, wrapFill);
		api.rect(wrapBounds.left, wrapBounds.top, wrapBounds.right, wrapBounds.bottom, constants.COLOR_HEADER_BUTTON_BORDER);
		const wrapLabel = 'w';
		const wrapLabelWidth = this.measureText(wrapLabel);
		const wrapLabelX = wrapBounds.left + Math.max(1, Math.floor((iconButtonSize - wrapLabelWidth) / 2));
		const wrapLabelY = wrapBounds.top + constants.HEADER_BUTTON_PADDING_Y;
		this.drawText(api, wrapLabel, wrapLabelX, wrapLabelY, wrapTextColor);

		const resolutionActive = this.resolutionMode === 'viewport';
		const resolutionFill = resolutionActive ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND;
		const resolutionTextColor = resolutionActive ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT;
		api.rectfill(resolutionLeft, buttonTop, resolutionRight, resolutionBottom, resolutionFill);
		api.rect(resolutionLeft, buttonTop, resolutionRight, resolutionBottom, constants.COLOR_HEADER_BUTTON_BORDER);
		const iconPadding = Math.max(2, Math.floor(constants.HEADER_BUTTON_PADDING_X * 0.75));

		const frameX = resolutionLeft + iconPadding;
		const frameY = buttonTop + iconPadding;
		const frameSize = iconButtonSize - iconPadding * 2;
		api.rectfill(frameX, frameY, frameX + frameSize, frameY + frameSize, resolutionTextColor);
		const innerMargin = Math.max(1, Math.floor(frameSize / 4));
		api.rectfill(
			frameX + innerMargin,
			frameY + innerMargin,
			frameX + frameSize - innerMargin,
			frameY + frameSize - innerMargin,
			constants.COLOR_TOP_BAR,
		);
		const indicatorY = frameY + frameSize - innerMargin - 1;
		const indicatorHeight = Math.max(1, Math.floor(frameSize / 5));
		if (this.resolutionMode === 'viewport') {
			api.rectfill(frameX + innerMargin, indicatorY, frameX + frameSize - innerMargin, indicatorY + indicatorHeight, resolutionTextColor);
		} else {
			const segmentWidth = Math.max(1, Math.floor((frameSize - innerMargin * 2) / 2));
			api.rectfill(frameX + innerMargin, indicatorY, frameX + innerMargin + segmentWidth, indicatorY + indicatorHeight, resolutionTextColor);
			api.rectfill(frameX + frameSize - innerMargin - segmentWidth, indicatorY, frameX + frameSize - innerMargin, indicatorY + indicatorHeight, resolutionTextColor);
		}
		const resolutionLabel = 'R';
		const resolutionLabelX = resolutionLeft + Math.max(1, Math.floor((iconButtonSize - this.measureText(resolutionLabel)) / 2));
		const resolutionLabelY = buttonTop + constants.HEADER_BUTTON_PADDING_Y;
		this.drawText(api, resolutionLabel, resolutionLabelX, resolutionLabelY, resolutionTextColor);

		this.drawText(api, this.metadata.title.toUpperCase(), 4, primaryBarHeight + 1, constants.COLOR_TOP_BAR_TEXT);
		const versionSuffix = this.dirty ? '*' : '';
		const version = `v${this.metadata.version}${versionSuffix}`;
		this.drawText(api, version, this.viewportWidth - this.measureText(version) - 4, primaryBarHeight + 1, constants.COLOR_TOP_BAR_TEXT);
	}

	private drawCreateResourceBar(api: BmsxConsoleApi): void {
		const height = this.getCreateResourceBarHeight();
		if (height <= 0) {
			return;
		}
		const barTop = this.headerHeight + this.tabBarHeight;
		const barBottom = barTop + height;
		api.rectfill(0, barTop, this.viewportWidth, barBottom, constants.COLOR_CREATE_RESOURCE_BACKGROUND);
		api.rectfill(0, barTop, this.viewportWidth, barTop + 1, constants.COLOR_CREATE_RESOURCE_OUTLINE);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, constants.COLOR_CREATE_RESOURCE_OUTLINE);

		const label = 'NEW FILE:';
		const labelX = 4;
		const labelY = barTop + constants.CREATE_RESOURCE_BAR_MARGIN_Y;
		this.drawText(api, label, labelX, labelY, constants.COLOR_CREATE_RESOURCE_TEXT);

		const field = this.createResourceField;
		const pathX = labelX + this.measureText(label + ' ');
		let displayPath = field.text;
		let pathColor = constants.COLOR_CREATE_RESOURCE_TEXT;
		if (displayPath.length === 0 && !this.createResourceActive) {
			displayPath = 'ENTER LUA PATH';
			pathColor = constants.COLOR_CREATE_RESOURCE_PLACEHOLDER;
		}

		const selection = inlineFieldSelectionRange(field);
		if (selection && field.text.length > 0) {
			const selectionLeft = pathX + inlineFieldMeasureRange(field, this.inlineFieldMetrics(), 0, selection.start);
			const selectionWidth = inlineFieldMeasureRange(field, this.inlineFieldMetrics(), selection.start, selection.end);
			if (selectionWidth > 0) {
				api.rectfillColor(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + this.lineHeight, constants.SELECTION_OVERLAY);
			}
		}

		this.drawText(api, displayPath, pathX, labelY, pathColor);

		const caretBaseX = inlineFieldCaretX(field, pathX, this.measureText.bind(this));
		const caretLeft = Math.floor(caretBaseX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretBaseX + this.charAdvance));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + this.lineHeight;
		this.drawInlineCaret(api, this.createResourceField, caretLeft, caretTop, caretRight, caretBottom, caretBaseX, this.createResourceActive, constants.INLINE_CARET_COLOR, pathColor);

		if (this.createResourceWorking) {
			const status = 'CREATING...';
			const statusWidth = this.measureText(status);
			const statusX = Math.max(pathX + this.measureText(displayPath) + this.spaceAdvance, this.viewportWidth - statusWidth - 4);
			this.drawText(api, status, statusX, labelY, constants.COLOR_CREATE_RESOURCE_TEXT);
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
		api.rectfill(0, barTop, this.viewportWidth, barBottom, constants.COLOR_SEARCH_BACKGROUND);
		api.rectfill(0, barTop, this.viewportWidth, barTop + 1, constants.COLOR_SEARCH_OUTLINE);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, constants.COLOR_SEARCH_OUTLINE);

		const field = this.searchField;
		const label = 'SEARCH:';
		const labelX = 4;
		const labelY = barTop + constants.SEARCH_BAR_MARGIN_Y;
		this.drawText(api, label, labelX, labelY, constants.COLOR_SEARCH_TEXT);

		let queryText = field.text;
		let queryColor = constants.COLOR_SEARCH_TEXT;
		if (queryText.length === 0 && !this.searchActive) {
			queryText = 'TYPE TO SEARCH';
			queryColor = constants.COLOR_SEARCH_PLACEHOLDER;
		}
		const queryX = labelX + this.measureText(label + ' ');

		const selection = inlineFieldSelectionRange(field);
		if (selection && field.text.length > 0) {
			const selectionLeft = queryX + inlineFieldMeasureRange(field, this.inlineFieldMetrics(), 0, selection.start);
			const selectionWidth = inlineFieldMeasureRange(field, this.inlineFieldMetrics(), selection.start, selection.end);
			if (selectionWidth > 0) {
				api.rectfillColor(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + this.lineHeight, constants.SELECTION_OVERLAY);
			}
		}

		this.drawText(api, queryText, queryX, labelY, queryColor);

		const caretX = inlineFieldCaretX(field, queryX, this.measureText.bind(this));
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + this.charAdvance));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + this.lineHeight;
		this.drawInlineCaret(api, this.searchField, caretLeft, caretTop, caretRight, caretBottom, caretX, this.searchActive, constants.INLINE_CARET_COLOR, queryColor);

		if (this.searchQuery.length > 0) {
			const total = this.searchMatches.length;
			const current = this.searchCurrentIndex >= 0 ? this.searchCurrentIndex + 1 : 0;
			const infoText = total === 0 ? '0/0' : `${current}/${total}`;
			const infoColor = total === 0 ? constants.COLOR_STATUS_WARNING : constants.COLOR_SEARCH_TEXT;
			const infoWidth = this.measureText(infoText);
			this.drawText(api, infoText, this.viewportWidth - infoWidth - 4, labelY, infoColor);
		}
	}

	private drawResourceSearchBar(api: BmsxConsoleApi): void {
		const height = this.getResourceSearchBarHeight();
		if (height <= 0) {
			return;
		}
		const baseTop = this.headerHeight + this.tabBarHeight + this.getCreateResourceBarHeight() + this.getSearchBarHeight();
		const barTop = baseTop;
		const barBottom = barTop + height;
		api.rectfill(0, barTop, this.viewportWidth, barBottom, constants.COLOR_QUICK_OPEN_BACKGROUND);
		api.rectfill(0, barTop, this.viewportWidth, barTop + 1, constants.COLOR_QUICK_OPEN_OUTLINE);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, constants.COLOR_QUICK_OPEN_OUTLINE);

		const field = this.resourceSearchField;
		const label = 'FILE :';
		const labelX = 4;
		const labelY = barTop + constants.QUICK_OPEN_BAR_MARGIN_Y;
		this.drawText(api, label, labelX, labelY, constants.COLOR_QUICK_OPEN_TEXT);

		let queryText = field.text;
		let queryColor = constants.COLOR_QUICK_OPEN_TEXT;
		if (queryText.length === 0 && !this.resourceSearchActive) {
			queryText = 'TYPE TO FILTER (@/# PREFIX)';
			queryColor = constants.COLOR_QUICK_OPEN_PLACEHOLDER;
		}
		const queryX = labelX + this.measureText(label + ' ');

		const selection = inlineFieldSelectionRange(field);
		if (selection && field.text.length > 0) {
			const selectionLeft = queryX + inlineFieldMeasureRange(field, this.inlineFieldMetrics(), 0, selection.start);
			const selectionWidth = inlineFieldMeasureRange(field, this.inlineFieldMetrics(), selection.start, selection.end);
			if (selectionWidth > 0) {
				api.rectfillColor(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + this.lineHeight, constants.SELECTION_OVERLAY);
			}
		}

		this.drawText(api, queryText, queryX, labelY, queryColor);

		const caretX = inlineFieldCaretX(field, queryX, this.measureText.bind(this));
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + this.charAdvance));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + this.lineHeight;
		this.drawInlineCaret(api, this.resourceSearchField, caretLeft, caretTop, caretRight, caretBottom, caretX, this.resourceSearchActive, constants.INLINE_CARET_COLOR, queryColor);

		const resultCount = this.resourceSearchVisibleResultCount();
		if (resultCount <= 0) {
			return;
		}
		const baseHeight = this.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
		const separatorTop = barTop + baseHeight;
		api.rectfill(0, separatorTop, this.viewportWidth, separatorTop + constants.QUICK_OPEN_RESULT_SPACING, constants.COLOR_QUICK_OPEN_OUTLINE);
		const resultsTop = separatorTop + constants.QUICK_OPEN_RESULT_SPACING;
		const rowHeight = this.resourceSearchEntryHeight();
		const compactMode = this.isResourceSearchCompactMode();
		for (let i = 0; i < resultCount; i += 1) {
			const matchIndex = this.resourceSearchDisplayOffset + i;
			const match = this.resourceSearchMatches[matchIndex];
			const rowTop = resultsTop + i * rowHeight;
			const rowBottom = rowTop + rowHeight;
			const isSelected = matchIndex === this.resourceSearchSelectionIndex;
			const isHover = matchIndex === this.resourceSearchHoverIndex;
			if (isSelected) {
				api.rectfillColor(0, rowTop, this.viewportWidth, rowBottom, constants.HIGHLIGHT_OVERLAY);
			} else if (isHover) {
				api.rectfillColor(0, rowTop, this.viewportWidth, rowBottom, constants.SELECTION_OVERLAY);
			}
			let textX = constants.QUICK_OPEN_RESULT_PADDING_X;
			const kindText = match.entry.typeLabel;
			const descriptorAssetId = match.entry.descriptor.assetId ?? '';
			const detail = match.entry.assetLabel ?? (descriptorAssetId !== match.entry.displayPath ? descriptorAssetId : '');
			if (kindText.length > 0) {
				this.drawText(api, kindText, textX, rowTop, constants.COLOR_QUICK_OPEN_KIND);
				textX += this.measureText(kindText + ' ');
			}
			this.drawText(api, match.entry.displayPath, textX, rowTop, constants.COLOR_QUICK_OPEN_TEXT);
			if (compactMode) {
				const secondaryY = rowTop + this.lineHeight;
				if (detail.length > 0) {
					this.drawText(api, detail, constants.QUICK_OPEN_RESULT_PADDING_X, secondaryY, constants.COLOR_QUICK_OPEN_KIND);
				}
			} else if (detail.length > 0) {
				const detailWidth = this.measureText(detail);
				const detailX = this.viewportWidth - detailWidth - constants.QUICK_OPEN_RESULT_PADDING_X;
				this.drawText(api, detail, detailX, rowTop, constants.COLOR_QUICK_OPEN_KIND);
			}
		}
	}

	private drawSymbolSearchBar(api: BmsxConsoleApi): void {
		const height = this.getSymbolSearchBarHeight();
		if (height <= 0) {
			return;
		}
		const baseTop = this.headerHeight + this.tabBarHeight + this.getCreateResourceBarHeight() + this.getSearchBarHeight() + this.getResourceSearchBarHeight();
		const barTop = baseTop;
		const barBottom = barTop + height;
		api.rectfill(0, barTop, this.viewportWidth, barBottom, constants.COLOR_SYMBOL_SEARCH_BACKGROUND);
		api.rectfill(0, barTop, this.viewportWidth, barTop + 1, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, constants.COLOR_SYMBOL_SEARCH_OUTLINE);

		const field = this.symbolSearchField;
		const label = this.symbolSearchGlobal ? 'SYMBOL #:' : 'SYMBOL @:';
		const labelX = 4;
		const labelY = barTop + constants.SYMBOL_SEARCH_BAR_MARGIN_Y;
		this.drawText(api, label, labelX, labelY, constants.COLOR_SYMBOL_SEARCH_TEXT);

		let queryText = field.text;
		let queryColor = constants.COLOR_SYMBOL_SEARCH_TEXT;
		if (queryText.length === 0 && !this.symbolSearchActive) {
			queryText = 'TYPE TO FILTER';
			queryColor = constants.COLOR_SYMBOL_SEARCH_PLACEHOLDER;
		}
		const queryX = labelX + this.measureText(label + ' ');

		const selection = inlineFieldSelectionRange(field);
		if (selection && field.text.length > 0) {
			const selectionLeft = queryX + inlineFieldMeasureRange(field, this.inlineFieldMetrics(), 0, selection.start);
			const selectionWidth = inlineFieldMeasureRange(field, this.inlineFieldMetrics(), selection.start, selection.end);
			if (selectionWidth > 0) {
				api.rectfillColor(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + this.lineHeight, constants.SELECTION_OVERLAY);
			}
		}

		this.drawText(api, queryText, queryX, labelY, queryColor);

		const caretX = inlineFieldCaretX(field, queryX, this.measureText.bind(this));
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + this.charAdvance));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + this.lineHeight;
		this.drawInlineCaret(api, this.symbolSearchField, caretLeft, caretTop, caretRight, caretBottom, caretX, this.symbolSearchActive, constants.INLINE_CARET_COLOR, queryColor);

		const resultCount = this.symbolSearchVisibleResultCount();
		if (resultCount <= 0) {
			return;
		}
		const baseHeight = this.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
		const separatorTop = barTop + baseHeight;
		api.rectfill(0, separatorTop, this.viewportWidth, separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING, constants.COLOR_SYMBOL_SEARCH_OUTLINE);
		const resultsTop = separatorTop + constants.SYMBOL_SEARCH_RESULT_SPACING;
	const entryHeight = this.symbolSearchEntryHeight();
	const compactMode = this.symbolSearchGlobal && this.isSymbolSearchCompactMode();
		for (let i = 0; i < resultCount; i += 1) {
			const matchIndex = this.symbolSearchDisplayOffset + i;
			const match = this.symbolSearchMatches[matchIndex];
			const rowTop = resultsTop + i * entryHeight;
			const rowBottom = rowTop + entryHeight;
			const isSelected = matchIndex === this.symbolSearchSelectionIndex;
			const isHover = matchIndex === this.symbolSearchHoverIndex;
			if (isSelected) {
				api.rectfillColor(0, rowTop, this.viewportWidth, rowBottom, constants.HIGHLIGHT_OVERLAY);
			} else if (isHover) {
				api.rectfillColor(0, rowTop, this.viewportWidth, rowBottom, constants.SELECTION_OVERLAY);
			}
			let textX = constants.SYMBOL_SEARCH_RESULT_PADDING_X;
			const kindText = match.entry.kindLabel;
			const lineText = `:${match.entry.line}`;
			const lineWidth = this.measureText(lineText);
			if (compactMode) {
				if (kindText.length > 0) {
					this.drawText(api, kindText, textX, rowTop, constants.COLOR_SYMBOL_SEARCH_KIND);
					textX += this.measureText(kindText + ' ');
				}
				this.drawText(api, match.entry.displayName, textX, rowTop, constants.COLOR_SYMBOL_SEARCH_TEXT);
				const secondaryY = rowTop + this.lineHeight;
				const lineX = this.viewportWidth - lineWidth - constants.SYMBOL_SEARCH_RESULT_PADDING_X;
				this.drawText(api, lineText, lineX, secondaryY, constants.COLOR_SYMBOL_SEARCH_TEXT);
				if (match.entry.sourceLabel) {
					this.drawText(api, match.entry.sourceLabel, constants.SYMBOL_SEARCH_RESULT_PADDING_X, secondaryY, constants.COLOR_SYMBOL_SEARCH_KIND);
				}
			} else {
				if (kindText.length > 0) {
					this.drawText(api, kindText, textX, rowTop, constants.COLOR_SYMBOL_SEARCH_KIND);
					textX += this.measureText(kindText + ' ');
				}
				this.drawText(api, match.entry.displayName, textX, rowTop, constants.COLOR_SYMBOL_SEARCH_TEXT);
				const lineX = this.viewportWidth - lineWidth - constants.SYMBOL_SEARCH_RESULT_PADDING_X;
				this.drawText(api, lineText, lineX, rowTop, constants.COLOR_SYMBOL_SEARCH_TEXT);
				if (match.entry.sourceLabel) {
					const sourceWidth = this.measureText(match.entry.sourceLabel);
					const sourceX = Math.max(textX, lineX - this.spaceAdvance - sourceWidth);
					this.drawText(api, match.entry.sourceLabel, sourceX, rowTop, constants.COLOR_SYMBOL_SEARCH_KIND);
				}
			}
		}
	}

	private drawLineJumpBar(api: BmsxConsoleApi): void {
		const height = this.getLineJumpBarHeight();
		if (height <= 0) {
			return;
		}
		const barTop = this.headerHeight + this.tabBarHeight
			+ this.getCreateResourceBarHeight()
			+ this.getSearchBarHeight()
			+ this.getResourceSearchBarHeight()
			+ this.getSymbolSearchBarHeight();
		const barBottom = barTop + height;
		api.rectfill(0, barTop, this.viewportWidth, barBottom, constants.COLOR_LINE_JUMP_BACKGROUND);
		api.rectfill(0, barTop, this.viewportWidth, barTop + 1, constants.COLOR_LINE_JUMP_OUTLINE);
		api.rectfill(0, barBottom - 1, this.viewportWidth, barBottom, constants.COLOR_LINE_JUMP_OUTLINE);

		const label = 'LINE #:';
		const labelX = 4;
		const labelY = barTop + constants.LINE_JUMP_BAR_MARGIN_Y;
		this.drawText(api, label, labelX, labelY, constants.COLOR_LINE_JUMP_TEXT);

		const field = this.lineJumpField;
		let valueText = field.text;
		let valueColor = constants.COLOR_LINE_JUMP_TEXT;
		if (valueText.length === 0 && !this.lineJumpActive) {
			valueText = 'ENTER LINE NUMBER';
			valueColor = constants.COLOR_LINE_JUMP_PLACEHOLDER;
		}
		const valueX = labelX + this.measureText(label + ' ');

		const selection = inlineFieldSelectionRange(field);
		if (selection && field.text.length > 0) {
			const selectionLeft = valueX + inlineFieldMeasureRange(field, this.inlineFieldMetrics(), 0, selection.start);
			const selectionWidth = inlineFieldMeasureRange(field, this.inlineFieldMetrics(), selection.start, selection.end);
			if (selectionWidth > 0) {
				api.rectfillColor(selectionLeft, labelY, selectionLeft + selectionWidth, labelY + this.lineHeight, constants.SELECTION_OVERLAY);
			}
		}

		this.drawText(api, valueText, valueX, labelY, valueColor);

		const caretX = inlineFieldCaretX(field, valueX, this.measureText.bind(this));
		const caretLeft = Math.floor(caretX);
		const caretRight = Math.max(caretLeft + 1, Math.floor(caretX + this.charAdvance));
		const caretTop = Math.floor(labelY);
		const caretBottom = caretTop + this.lineHeight;
		this.drawInlineCaret(api, this.lineJumpField, caretLeft, caretTop, caretRight, caretBottom, caretX, this.lineJumpActive, constants.INLINE_CARET_COLOR, valueColor);
	}

	private drawCreateResourceErrorDialog(api: BmsxConsoleApi, message: string): void {
		const maxDialogWidth = Math.min(this.viewportWidth - 16, 360);
		const wrapWidth = Math.max(this.charAdvance, maxDialogWidth - (constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
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
		const dialogWidth = Math.min(this.viewportWidth - 16, Math.max(180, contentWidth + constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
		const dialogHeight = Math.min(this.viewportHeight - 16, lines.length * this.lineHeight + constants.ERROR_OVERLAY_PADDING_Y * 2 + 16);
		const left = Math.max(8, Math.floor((this.viewportWidth - dialogWidth) / 2));
		const top = Math.max(8, Math.floor((this.viewportHeight - dialogHeight) / 2));
		const right = left + dialogWidth;
		const bottom = top + dialogHeight;
		api.rectfill(left, top, right, bottom, constants.COLOR_STATUS_BACKGROUND);
		api.rect(left, top, right, bottom, constants.COLOR_CREATE_RESOURCE_ERROR);
		let textY = top + constants.ERROR_OVERLAY_PADDING_Y + 6;
		for (let i = 0; i < lines.length; i += 1) {
			const textX = left + constants.ERROR_OVERLAY_PADDING_X + 6;
			this.drawText(api, lines[i], textX, textY, constants.COLOR_STATUS_TEXT);
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
			+ this.getResourceSearchBarHeight()
			+ this.getSymbolSearchBarHeight()
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

	private getResourceSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getResourceSearchBarHeight();
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

	private getLineJumpBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getLineJumpBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = this.headerHeight + this.tabBarHeight
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

	private getSymbolSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
		const height = this.getSymbolSearchBarHeight();
		if (height <= 0) {
			return null;
		}
		const top = this.headerHeight + this.tabBarHeight
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

	private drawCodeArea(api: BmsxConsoleApi): void {
		this.ensureVisualLines();
		const bounds = this.getCodeAreaBounds();
		const gutterOffset = bounds.textLeft - bounds.codeLeft;
		const advance = this.warnNonMonospace ? this.spaceAdvance : this.charAdvance;
		const wrapEnabled = this.wordWrapEnabled;

		let horizontalVisible = !wrapEnabled && this.codeHorizontalScrollbarVisible;
		let verticalVisible = this.codeVerticalScrollbarVisible;
		let rowCapacity = 1;
		let columnCapacity = 1;
		const visualCount = this.getVisualLineCount();

		for (let i = 0; i < 3; i += 1) {
			const availableHeight = Math.max(0, (bounds.codeBottom - bounds.codeTop) - (horizontalVisible ? constants.SCROLLBAR_WIDTH : 0));
			rowCapacity = Math.max(1, Math.floor(availableHeight / this.lineHeight));
			verticalVisible = visualCount > rowCapacity;
			const availableWidth = Math.max(0, (bounds.codeRight - bounds.codeLeft) - (verticalVisible ? constants.SCROLLBAR_WIDTH : 0) - gutterOffset);
			columnCapacity = Math.max(1, Math.floor(availableWidth / advance));
			if (wrapEnabled) {
				horizontalVisible = false;
			} else {
				horizontalVisible = this.maximumLineLength() > columnCapacity;
			}
		}

		this.codeVerticalScrollbarVisible = verticalVisible;
		this.codeHorizontalScrollbarVisible = !wrapEnabled && horizontalVisible;
		this.cachedVisibleRowCount = rowCapacity;
		this.cachedVisibleColumnCount = columnCapacity;

		const contentRight = bounds.codeRight - (this.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0);
		const contentBottom = bounds.codeBottom - (this.codeHorizontalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0);

		api.rectfill(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, constants.COLOR_CODE_BACKGROUND);
		if (bounds.gutterRight > bounds.gutterLeft) {
			api.rectfill(bounds.gutterLeft, bounds.codeTop, bounds.gutterRight, contentBottom, constants.COLOR_GUTTER_BACKGROUND);
		}

		const activeGotoHighlight = this.gotoHoverHighlight;
		const gotoVisualIndex = activeGotoHighlight
			? this.positionToVisualIndex(activeGotoHighlight.row, activeGotoHighlight.startColumn)
			: null;
		const cursorVisualIndex = this.positionToVisualIndex(this.cursorRow, this.cursorColumn);
	let cursorEntry: CachedHighlight | null = null;
	let cursorInfo: CursorScreenInfo | null = null;
		const sliceWidth = columnCapacity + 2;

		for (let i = 0; i < rowCapacity; i += 1) {
			const visualIndex = this.scrollRow + i;
			const rowY = bounds.codeTop + i * this.lineHeight;
			if (rowY >= contentBottom) {
				break;
			}
			if (visualIndex >= visualCount) {
				this.drawColoredText(api, '~', [constants.COLOR_CODE_DIM], bounds.textLeft, rowY);
				continue;
			}
			const segment = this.visualIndexToSegment(visualIndex);
			if (!segment) {
				this.drawColoredText(api, '~', [constants.COLOR_CODE_DIM], bounds.textLeft, rowY);
				continue;
			}
			const lineIndex = segment.row;
			const entry = this.getCachedHighlight(lineIndex);
			const isExecutionStopRow = this.executionStopRow !== null && lineIndex === this.executionStopRow;
			const isCursorLine = lineIndex === this.cursorRow;
			if (isExecutionStopRow) {
				api.rectfillColor(bounds.gutterRight, rowY, contentRight, rowY + this.lineHeight, constants.EXECUTION_STOP_OVERLAY);
			} else if (isCursorLine) {
				api.rectfillColor(bounds.gutterRight, rowY, contentRight, rowY + this.lineHeight, constants.HIGHLIGHT_OVERLAY);
			}
			const highlight = entry.hi;
			let columnStart = wrapEnabled ? segment.startColumn : this.scrollColumn;
			if (wrapEnabled) {
				if (columnStart < segment.startColumn || columnStart > segment.endColumn) {
					columnStart = segment.startColumn;
				}
			}
			const maxColumn = wrapEnabled ? segment.endColumn : this.lines[lineIndex].length;
			const columnCount = wrapEnabled ? Math.max(0, maxColumn - columnStart) : sliceWidth;
			const slice = this.sliceHighlightedLine(highlight, columnStart, columnCount);
			const sliceStartDisplay = slice.startDisplay;
			const sliceEndLimit = wrapEnabled ? this.columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
			const sliceEndDisplay = wrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
			this.drawSearchHighlightsForRow(api, lineIndex, entry, bounds.textLeft, rowY, sliceStartDisplay, sliceEndDisplay);
			const selectionSlice = this.computeSelectionSlice(lineIndex, highlight, sliceStartDisplay, sliceEndDisplay);
			if (selectionSlice) {
				const selectionStartX = bounds.textLeft + this.measureRangeFast(entry, sliceStartDisplay, selectionSlice.startDisplay);
				const selectionEndX = bounds.textLeft + this.measureRangeFast(entry, sliceStartDisplay, selectionSlice.endDisplay);
				const clampedLeft = clamp(selectionStartX, bounds.textLeft, contentRight);
				const clampedRight = clamp(selectionEndX, clampedLeft, contentRight);
				if (clampedRight > clampedLeft) {
					api.rectfillColor(clampedLeft, rowY, clampedRight, rowY + this.lineHeight, constants.SELECTION_OVERLAY);
				}
			}
			this.drawColoredText(api, slice.text, slice.colors, bounds.textLeft, rowY);
			if (activeGotoHighlight && gotoVisualIndex !== null && visualIndex === gotoVisualIndex && activeGotoHighlight.row === lineIndex) {
				const startDisplayFull = this.columnToDisplay(highlight, activeGotoHighlight.startColumn);
				const endDisplayFull = this.columnToDisplay(highlight, activeGotoHighlight.endColumn);
				const clampedStartDisplay = clamp(startDisplayFull, sliceStartDisplay, sliceEndDisplay);
				const clampedEndDisplay = clamp(endDisplayFull, clampedStartDisplay, sliceEndDisplay);
				if (clampedEndDisplay > clampedStartDisplay) {
					const underlineStartX = bounds.textLeft + this.measureRangeFast(entry, sliceStartDisplay, clampedStartDisplay);
					const underlineEndX = bounds.textLeft + this.measureRangeFast(entry, sliceStartDisplay, clampedEndDisplay);
					let drawLeft = Math.floor(underlineStartX);
					let drawRight = Math.ceil(underlineEndX);
					if (drawRight <= drawLeft) {
						drawRight = drawLeft + Math.max(1, Math.floor(this.charAdvance));
					}
					if (drawRight > drawLeft) {
						const underlineY = Math.min(contentBottom - 1, rowY + this.lineHeight - 1);
						if (underlineY >= rowY && underlineY < contentBottom) {
							api.rectfill(drawLeft, underlineY, drawRight, underlineY + 1, constants.COLOR_GOTO_UNDERLINE);
						}
					}
				}
			}
		if (visualIndex === cursorVisualIndex) {
			cursorEntry = entry;
			cursorInfo = this.computeCursorScreenInfo(entry, bounds.textLeft, rowY, sliceStartDisplay);
		}
	}

	this.cursorScreenInfo = cursorInfo;

	const verticalTrack: RectBounds = {
		left: contentRight,
		top: bounds.codeTop,
		right: contentRight + constants.SCROLLBAR_WIDTH,
		bottom: contentBottom,
	};
	this.scrollbars.codeVertical.layout(verticalTrack, Math.max(visualCount, 1), rowCapacity, this.scrollRow);
	this.scrollRow = clamp(Math.round(this.scrollbars.codeVertical.getScroll()), 0, Math.max(0, visualCount - rowCapacity));
	this.codeVerticalScrollbarVisible = this.scrollbars.codeVertical.isVisible();

	if (!wrapEnabled) {
		const horizontalTrack: RectBounds = {
			left: bounds.codeLeft,
			top: contentBottom,
			right: contentRight,
			bottom: contentBottom + constants.SCROLLBAR_WIDTH,
		};
		const maxColumns = columnCapacity + this.computeMaximumScrollColumn();
		this.scrollbars.codeHorizontal.layout(horizontalTrack, maxColumns, columnCapacity, this.scrollColumn);
		this.scrollColumn = clamp(Math.round(this.scrollbars.codeHorizontal.getScroll()), 0, this.computeMaximumScrollColumn());
		this.codeHorizontalScrollbarVisible = this.scrollbars.codeHorizontal.isVisible();
	} else {
		this.scrollColumn = 0;
		this.codeHorizontalScrollbarVisible = false;
	}

	this.drawRuntimeErrorOverlay(api, bounds.codeTop, contentRight, bounds.textLeft);
	this.drawHoverTooltip(api, bounds.codeTop, contentBottom, bounds.textLeft);

	if (this.cursorVisible && cursorEntry && cursorInfo) {
		this.drawCursor(api, cursorInfo, bounds.textLeft);
	}
	this.drawCompletionPopup(api, bounds);
	this.drawParameterHintOverlay(api, bounds);
	if (this.codeVerticalScrollbarVisible) {
		this.scrollbars.codeVertical.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (this.codeHorizontalScrollbarVisible) {
		this.scrollbars.codeHorizontal.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
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
		let maxLineWidth = 0;
		for (let i = 0; i < lines.length; i += 1) {
			const width = this.measureText(lines[i]);
			if (width > maxLineWidth) {
				maxLineWidth = width;
			}
		}
		const bubbleWidth = maxLineWidth + constants.ERROR_OVERLAY_PADDING_X * 2;
		const bubbleHeight = lines.length * this.lineHeight + constants.ERROR_OVERLAY_PADDING_Y * 2;
		let bubbleLeft = anchorX + constants.ERROR_OVERLAY_CONNECTOR_OFFSET;
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
		api.rectfillColor(bubbleLeft, bubbleTop, bubbleRight, bubbleBottom, constants.ERROR_OVERLAY_BACKGROUND);
		for (let i = 0; i < lines.length; i += 1) {
			const lineY = bubbleTop + constants.ERROR_OVERLAY_PADDING_Y + i * this.lineHeight;
			this.drawText(api, lines[i], bubbleLeft + constants.ERROR_OVERLAY_PADDING_X, lineY, constants.COLOR_STATUS_ERROR);
		}
		const connectorLeft = Math.max(textLeft, anchorX);
		const connectorRight = Math.min(bubbleLeft, connectorLeft + 3);
		if (connectorRight > connectorLeft) {
			if (placedBelow) {
				const connectorStartY = rowTop + this.lineHeight;
				if (bubbleTop > connectorStartY) {
					api.rectfillColor(connectorLeft, connectorStartY, connectorRight, bubbleTop, constants.ERROR_OVERLAY_BACKGROUND);
				}
			} else {
				if (bubbleBottom < rowTop) {
					api.rectfillColor(connectorLeft, bubbleBottom, connectorRight, rowTop, constants.ERROR_OVERLAY_BACKGROUND);
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

	private toggleResourcePanelFilterMode(): void {
		this.resourcePanelFilterMode = this.resourcePanelFilterMode === 'lua_only' ? 'all' : 'lua_only';
		if (this.resourcePanelVisible) {
			this.refreshResourcePanelContents();
		}
		const modeLabel = this.resourcePanelFilterMode === 'lua_only' ? 'Lua resources' : 'all resources';
		this.showMessage(`Files panel: showing ${modeLabel}`, constants.COLOR_STATUS_TEXT, 2.5);
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
		const previousTopIndex = clamp(this.scrollRow, 0, this.visualLines.length > 0 ? this.visualLines.length - 1 : 0);
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

	private showResourcePanel(): void {
		const desiredRatio = this.resourcePanelWidthRatio ?? this.defaultResourcePanelRatio();
		const clampedRatio = this.clampResourcePanelRatio(desiredRatio);
		const widthPx = this.computePanelPixelWidth(clampedRatio);
		if (clampedRatio <= 0 || widthPx <= 0) {
			this.showMessage('Viewport too small for resource panel.', constants.COLOR_STATUS_WARNING, 3.0);
			return;
		}
		this.resourcePanelWidthRatio = clampedRatio;
		this.resourcePanelVisible = true;
		this.resourcePanelResizing = false;
		this.resourcePanelFocused = true;
		this.refreshResourcePanelContents();
		this.invalidateVisualLines();
	}

	private hideResourcePanel(): void {
		if (!this.resourcePanelVisible) {
			return;
		}
		this.resourcePanelVisible = false;
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

	private computeTabLayout(): Array<{ id: string; left: number; right: number; width: number }> {
		const layout: Array<{ id: string; left: number; right: number; width: number }> = [];
		let cursor = 4;
		for (let index = 0; index < this.tabs.length; index += 1) {
			const tab = this.tabs[index];
			const width = this.measureTabWidth(tab);
			const left = cursor;
			const right = left + width;
			layout.push({ id: tab.id, left, right, width });
			cursor = right + constants.TAB_BUTTON_SPACING;
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

	private updateTabDrag(pointerX: number): void {
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
		const pointerCenter = pointerLeft + dragged.width * 0.5;
		let desiredIndex = 0;
		for (let i = 0; i < layout.length; i += 1) {
			const item = layout[i];
			const center = (item.left + item.right) * 0.5;
			if (pointerCenter > center) {
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
			this.resourcePanelResourceCount = 0;
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
		const filteredDescriptors: ConsoleResourceDescriptor[] = [];
		for (let index = 0; index < augmented.length; index += 1) {
			const descriptor = augmented[index];
			if (this.resourceDescriptorMatchesFilter(descriptor)) {
				filteredDescriptors.push(descriptor);
			}
		}
		this.resourcePanelResourceCount = filteredDescriptors.length;
		this.resourceBrowserItems = this.buildResourceBrowserItems(filteredDescriptors);
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
			const placeholder = this.resourcePanelFilterMode === 'lua_only' ? '<no lua resources>' : '<no resources>';
			items.push({
				line: placeholder,
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
		const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
		const capacity = this.resourcePanelLineCapacity();
		const needsScrollbar = this.resourceBrowserItems.length > capacity;
		const availableRight = needsScrollbar ? bounds.right - 1 - constants.SCROLLBAR_WIDTH : bounds.right - 1;
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
		const margin = constants.RESOURCE_PANEL_DIVIDER_DRAG_MARGIN;
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
			const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
			const dividerLeft = bounds.right - 1;
			const availableRight = needsVerticalScrollbar ? dividerLeft - constants.SCROLLBAR_WIDTH : dividerLeft;
			const availableWidth = Math.max(0, availableRight - contentLeft);
			const needsHorizontalScrollbar = this.resourceBrowserMaxLineWidth > availableWidth;
			if (needsHorizontalScrollbar) {
				contentHeight = Math.max(0, contentHeight - constants.SCROLLBAR_WIDTH);
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
		const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
		const dividerLeft = bounds.right - 1;
		const availableRight = Math.max(contentLeft, needsScrollbar ? dividerLeft - constants.SCROLLBAR_WIDTH : dividerLeft);
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
		const ctrlDown = isModifierPressedGlobal(this.playerIndex, 'ControlLeft') || isModifierPressedGlobal(this.playerIndex, 'ControlRight');
		const metaDown = isModifierPressedGlobal(this.playerIndex, 'MetaLeft') || isModifierPressedGlobal(this.playerIndex, 'MetaRight');
		const shiftDown = isModifierPressedGlobal(this.playerIndex, 'ShiftLeft') || isModifierPressedGlobal(this.playerIndex, 'ShiftRight');
		if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(this.playerIndex, 'KeyR')) {
			consumeKeyboardKey(keyboard, 'KeyR');
			this.toggleResolutionMode();
			return;
		}
		if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(this.playerIndex, 'KeyB')) {
			consumeKeyboardKey(keyboard, 'KeyB');
			this.toggleResourcePanel();
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Escape')) {
			consumeKeyboardKey(keyboard, 'Escape');
			this.hideResourcePanel();
			return;
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Tab')) {
			consumeKeyboardKey(keyboard, 'Tab');
			this.resourcePanelFocused = false;
			this.activateCodeTab();
			return;
		}
		if (this.resourceBrowserItems.length === 0) {
			return;
		}
		const horizontalStep = this.charAdvance * 4;
		const horizontalMoves: Array<{ key: string; predicate: boolean; delta: number }> = [
			{ key: 'ArrowLeft', predicate: isKeyJustPressedGlobal(this.playerIndex, 'ArrowLeft') || this.shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds), delta: -horizontalStep },
			{ key: 'ArrowRight', predicate: isKeyJustPressedGlobal(this.playerIndex, 'ArrowRight') || this.shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds), delta: horizontalStep },
		];
		for (const entry of horizontalMoves) {
			if (entry.predicate) {
				consumeKeyboardKey(keyboard, entry.key);
				this.scrollResourceBrowserHorizontal(entry.delta);
				this.resourceBrowserEnsureSelectionVisible();
				return;
			}
		}
		if (isKeyJustPressedGlobal(this.playerIndex, 'Enter')) {
			consumeKeyboardKey(keyboard, 'Enter');
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
			const triggered = isKeyJustPressedGlobal(this.playerIndex, entry.code) || this.shouldFireRepeat(keyboard, entry.code, deltaSeconds);
			if (triggered) {
				consumeKeyboardKey(keyboard, entry.code);
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
		if (!this.resourcePanelVisible) {
			return;
		}
		const bounds = this.getResourcePanelBounds();
		if (!bounds) {
			return;
		}
		const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
		const dividerLeft = bounds.right - 1;
		const capacity = this.resourcePanelLineCapacity();
		const itemCount = this.resourceBrowserItems.length;

		const maxVerticalScroll = Math.max(0, itemCount - capacity);
		this.resourceBrowserScroll = clamp(this.resourceBrowserScroll, 0, maxVerticalScroll);
		this.clampResourceBrowserHorizontalScroll();

		const verticalTrack: RectBounds = {
			left: dividerLeft - constants.SCROLLBAR_WIDTH,
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
			top: bounds.bottom - constants.SCROLLBAR_WIDTH,
			right: contentRight,
			bottom: bounds.bottom,
		};
		const horizontalScrollbar = this.scrollbars.resourceHorizontal;
		horizontalScrollbar.layout(horizontalTrack, Math.max(this.resourceBrowserMaxLineWidth, availableWidth), availableWidth, this.resourceBrowserHorizontalScroll);
		const horizontalVisible = horizontalScrollbar.isVisible();
		const effectiveBottom = horizontalVisible ? horizontalTrack.top : bounds.bottom;

		this.resourceBrowserHorizontalScroll = horizontalScrollbar.getScroll();

		api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_RESOURCE_PANEL_BACKGROUND);

		const contentTop = bounds.top + 2;
		const scrollStart = Math.floor(this.resourceBrowserScroll);
		const scrollEnd = Math.min(itemCount, scrollStart + capacity);
		const highlightIndex = this.resourceBrowserHoverIndex >= 0 ? this.resourceBrowserHoverIndex : this.resourceBrowserSelectionIndex;
		const panelActive = this.resourcePanelFocused;
		const scrollX = this.resourceBrowserHorizontalScroll;
		const highlightColor = Msx1Colors[constants.COLOR_RESOURCE_PANEL_HIGHLIGHT];

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
				this.drawText(api, indentText, indentX, y, constants.COLOR_RESOURCE_PANEL_TEXT);
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
						api.rectfillColor(visibleLeft, caretTop, visibleRight, caretBottom, highlightColor);
					}
					const colors = new Array<number>(contentText.length).fill(constants.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT);
					if (contentText.length > 0) {
						this.drawColoredText(api, contentText, colors, contentX, y);
					}
				} else if (visibleRight > visibleLeft) {
					this.drawRectOutlineColor(api, visibleLeft, caretTop, visibleRight, caretBottom, highlightColor);
				}
			}
			if (!isHighlighted || contentText.length === 0 || !panelActive) {
				this.drawText(api, contentText, contentX, y, constants.COLOR_RESOURCE_PANEL_TEXT);
			}
		}

		if (verticalScrollbar.isVisible()) {
			verticalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
		}
		if (horizontalScrollbar.isVisible()) {
			horizontalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
		}
		if (dividerLeft >= bounds.left && dividerLeft < bounds.right) {
			api.rectfill(dividerLeft, bounds.top, bounds.right, bounds.bottom, constants.RESOURCE_PANEL_DIVIDER_COLOR);
		}
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
				this.drawText(api, line, contentLeft, fallbackY, constants.COLOR_RESOURCE_VIEWER_TEXT);
			} else {
				this.drawText(api, '<empty>', contentLeft, textTop, constants.COLOR_RESOURCE_VIEWER_TEXT);
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
			this.drawText(api, '<empty>', contentLeft, textTop, constants.COLOR_RESOURCE_VIEWER_TEXT);
		} else {
			for (let lineIndex = Math.floor(viewer.scroll), drawIndex = 0; lineIndex < end; lineIndex += 1, drawIndex += 1) {
				const line = viewer.lines[lineIndex] ?? '';
				const y = textTop + drawIndex * this.lineHeight;
				if (y >= bounds.codeBottom) {
					break;
				}
				this.drawText(api, line, contentLeft, y, constants.COLOR_RESOURCE_VIEWER_TEXT);
			}
		}
		if (verticalVisible) {
			verticalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
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
			api.rectfillColor(startX, originY, endX, originY + this.lineHeight, overlay);
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
	if (this.searchActive || this.lineJumpActive || this.resourcePanelFocused || this.createResourceActive) {
		const innerLeft = caretLeft + 1;
		const innerRight = caretRight - 1;
		const innerTop = caretTop + 1;
		const innerBottom = caretBottom - 1;
		if (innerRight > innerLeft && innerBottom > innerTop) {
			api.rectfill(innerLeft, innerTop, innerRight, innerBottom, constants.COLOR_CODE_BACKGROUND);
		}
		this.drawRectOutlineColor(api, caretLeft, caretTop, caretRight, caretBottom, constants.CARET_COLOR);
		this.drawColoredText(api, info.baseChar, [info.baseColor], cursorX, cursorY);
	} else {
		api.rectfillColor(caretLeft, caretTop, caretRight, caretBottom, constants.CARET_COLOR);
		const caretPaletteIndex = this.resolvePaletteIndex(constants.CARET_COLOR);
		const caretInverseColor = caretPaletteIndex !== null
			? this.invertColorIndex(caretPaletteIndex)
			: this.invertColorIndex(info.baseColor);
		this.drawColoredText(api, info.baseChar, [caretInverseColor], cursorX, cursorY);
	}
}

private drawCompletionPopup(api: BmsxConsoleApi, bounds: { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; textLeft: number }): void {
	const session = this.completionSession;
	const cursorInfo = this.cursorScreenInfo;
	if (!session || !cursorInfo) {
		return;
	}
	if (session.filteredItems.length === 0) {
		return;
	}
	const startIndex = session.displayOffset;
	const endIndex = Math.min(session.filteredItems.length, startIndex + session.maxVisibleItems);
	const visibleCount = endIndex - startIndex;
	if (visibleCount <= 0) {
		return;
	}
	let maxLineWidth = constants.COMPLETION_POPUP_MIN_WIDTH;
	const detailSpacing = this.spaceAdvance;
	for (let i = startIndex; i < endIndex; i += 1) {
		const item = session.filteredItems[i];
		const labelWidth = this.measureText(item.label);
		const detailText = item.detail ?? '';
		const detailWidth = detailText.length > 0 ? this.measureText(detailText) : 0;
		const totalWidth = detailWidth > 0
			? labelWidth + detailSpacing + detailWidth
			: labelWidth;
		if (totalWidth > maxLineWidth) {
			maxLineWidth = totalWidth;
		}
	}
	const popupWidth = Math.max(constants.COMPLETION_POPUP_MIN_WIDTH, Math.floor(maxLineWidth + constants.COMPLETION_POPUP_PADDING_X * 2));
	const popupHeight = Math.floor(constants.COMPLETION_POPUP_PADDING_Y * 2 + visibleCount * this.lineHeight + Math.max(0, visibleCount - 1) * constants.COMPLETION_POPUP_ITEM_SPACING);
	let popupLeft = Math.floor(cursorInfo.x);
	if (popupLeft + popupWidth > bounds.codeRight) {
		popupLeft = bounds.codeRight - popupWidth;
	}
	if (popupLeft < bounds.textLeft) {
		popupLeft = bounds.textLeft;
	}
	let popupTop = Math.floor(cursorInfo.y + cursorInfo.height + 2);
	if (popupTop + popupHeight > bounds.codeBottom) {
		popupTop = Math.floor(cursorInfo.y - popupHeight - 2);
	}
	if (popupTop < bounds.codeTop) {
		popupTop = bounds.codeTop;
		if (popupTop + popupHeight > bounds.codeBottom) {
			popupTop = Math.max(bounds.codeTop, bounds.codeBottom - popupHeight);
		}
	}
	const popupRight = popupLeft + popupWidth;
	const popupBottom = popupTop + popupHeight;
	api.rectfill(popupLeft, popupTop, popupRight, popupBottom, constants.COLOR_COMPLETION_BACKGROUND);
	api.rect(popupLeft, popupTop, popupRight, popupBottom, constants.COLOR_COMPLETION_BORDER);
	for (let drawIndex = 0; drawIndex < visibleCount; drawIndex += 1) {
		const itemIndex = startIndex + drawIndex;
		const item = session.filteredItems[itemIndex];
		const lineTop = popupTop + constants.COMPLETION_POPUP_PADDING_Y + drawIndex * (this.lineHeight + constants.COMPLETION_POPUP_ITEM_SPACING);
		const isSelected = itemIndex === session.selectionIndex;
		const labelColor = isSelected ? constants.COLOR_COMPLETION_HIGHLIGHT_TEXT : constants.COLOR_COMPLETION_TEXT;
		const detailColor = isSelected ? constants.COLOR_COMPLETION_HIGHLIGHT_TEXT : constants.COLOR_COMPLETION_DETAIL;
		if (isSelected) {
			const highlightTop = lineTop - 1;
			const highlightBottom = highlightTop + this.lineHeight + 2;
			api.rectfill(popupLeft + 1, highlightTop, popupRight - 1, highlightBottom, constants.COLOR_COMPLETION_HIGHLIGHT);
		}
		let textX = popupLeft + constants.COMPLETION_POPUP_PADDING_X;
		const labelWidth = this.measureText(item.label);
		this.drawText(api, item.label, textX, lineTop, labelColor);
		textX += labelWidth + detailSpacing;
		const detailText = item.detail ?? '';
		if (detailText.length > 0) {
			this.drawText(api, detailText, textX, lineTop, detailColor);
		}
	}
}

private drawParameterHintOverlay(api: BmsxConsoleApi, bounds: { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; textLeft: number }): void {
	const hint = this.parameterHint;
	const cursorInfo = this.cursorScreenInfo;
	if (!hint || !cursorInfo) {
		return;
	}
	const params = hint.params;
	const baseColor = constants.COLOR_PARAMETER_HINT_TEXT;
	const segments: Array<{ text: string; color: number }> = [];
	segments.push({ text: `api.${hint.methodName}(`, color: baseColor });
	for (let i = 0; i < params.length; i += 1) {
		if (i > 0) {
			segments.push({ text: ', ', color: baseColor });
		}
		const color = i === hint.argumentIndex ? constants.COLOR_PARAMETER_HINT_ACTIVE : baseColor;
		segments.push({ text: params[i], color });
	}
	segments.push({ text: ')', color: baseColor });
	let textWidth = 0;
	for (let i = 0; i < segments.length; i += 1) {
		const part = segments[i];
		if (part.text.length === 0) {
			continue;
		}
		textWidth += this.measureText(part.text);
	}
	const popupWidth = Math.floor(textWidth + constants.PARAMETER_HINT_PADDING_X * 2);
	const popupHeight = Math.floor(this.lineHeight + constants.PARAMETER_HINT_PADDING_Y * 2);
	let popupLeft = Math.floor(cursorInfo.x);
	if (popupLeft + popupWidth > bounds.codeRight) {
		popupLeft = bounds.codeRight - popupWidth;
	}
	if (popupLeft < bounds.textLeft) {
		popupLeft = bounds.textLeft;
	}
	let popupTop = Math.floor(cursorInfo.y - popupHeight - 2);
	if (popupTop < bounds.codeTop) {
		popupTop = Math.floor(cursorInfo.y + cursorInfo.height + 2);
		if (popupTop + popupHeight > bounds.codeBottom) {
			popupTop = Math.max(bounds.codeTop, bounds.codeBottom - popupHeight);
		}
	}
	const popupRight = popupLeft + popupWidth;
	const popupBottom = popupTop + popupHeight;
	api.rectfill(popupLeft, popupTop, popupRight, popupBottom, constants.COLOR_PARAMETER_HINT_BACKGROUND);
	api.rect(popupLeft, popupTop, popupRight, popupBottom, constants.COLOR_PARAMETER_HINT_BORDER);
	let textX = popupLeft + constants.PARAMETER_HINT_PADDING_X;
	const textY = popupTop + constants.PARAMETER_HINT_PADDING_Y;
	for (let i = 0; i < segments.length; i += 1) {
		const part = segments[i];
		if (part.text.length === 0) {
			continue;
		}
		this.drawText(api, part.text, textX, textY, part.color);
		textX += this.measureText(part.text);
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
			const colorIndex = colors[index] ?? constants.COLOR_CODE_TEXT;
			let end = index + 1;
			while (end < text.length) {
				const nextColor = colors[end] ?? constants.COLOR_CODE_TEXT;
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
		this.invalidateVisualLines();
		this.handlePostEditMutation();
	}

	private recordEditContext(kind: 'insert' | 'delete' | 'replace', text: string): void {
		this.pendingEditContext = { kind, text };
	}

	private handlePostEditMutation(): void {
		const editContext = this.pendingEditContext;
		this.pendingEditContext = null;
		this.invalidateLocalCompletionCacheForActiveContext();
		this.cachedGlobalCompletionItems = null;
		if (this.suppressNextAutoCompletion) {
			this.suppressNextAutoCompletion = false;
			this.cancelPendingCompletion();
			this.refreshParameterHint();
			return;
		}
		this.updateCompletionSessionAfterMutation(editContext);
		this.refreshParameterHint();
	}

	private invalidateLocalCompletionCacheForActiveContext(): void {
		const key = this.activeCompletionCacheKey();
		if (!key) {
			return;
		}
		this.localCompletionCache.delete(key);
	}

	private activeCompletionCacheKey(): string | null {
		const context = this.getActiveCodeTabContext();
		const assetId = this.resolveHoverAssetId(context);
		const chunkName = this.resolveHoverChunkName(context);
		if (!assetId && !chunkName) {
			return null;
		}
		const safeAssetId = assetId ?? '';
		const safeChunk = chunkName ?? '';
		return `${safeAssetId}|${safeChunk}`;
	}

	private refreshParameterHint(): void {
		const info = this.resolveParameterHintContext();
		this.parameterHint = info;
	}

	private resolveParameterHintContext(): ParameterHintState | null {
		if (!this.isCodeTabActive()) {
			return null;
		}
		if (this.lines.length === 0) {
			return null;
		}
		const safeRow = clamp(this.cursorRow, 0, this.lines.length - 1);
		const line = this.lines[safeRow];
		if (line.length === 0) {
			return null;
		}
		const safeColumn = clamp(this.cursorColumn, 0, line.length);
		let depth = 0;
		let lastOpen = -1;
		for (let index = 0; index < safeColumn; index += 1) {
			const ch = line.charAt(index);
			if (ch === '(') {
				depth += 1;
				lastOpen = index;
			} else if (ch === ')') {
				if (depth > 0) {
					depth -= 1;
					if (depth === 0) {
						lastOpen = -1;
					}
				}
			}
		}
		if (depth <= 0 || lastOpen < 0) {
			return null;
		}
		const prefix = line.slice(0, lastOpen);
		let scan = prefix.length - 1;
		while (scan >= 0 && isWhitespace(prefix.charAt(scan))) {
			scan -= 1;
		}
		if (scan < 0) {
			return null;
		}
		let nameEnd = scan + 1;
		while (scan >= 0 && isWordChar(prefix.charAt(scan))) {
			scan -= 1;
		}
		const methodName = prefix.slice(scan + 1, nameEnd);
		if (methodName.length === 0) {
			return null;
		}
		const inner = line.slice(lastOpen + 1, safeColumn);
		let argumentIndex = 0;
		let nested = 0;
		for (let i = 0; i < inner.length; i += 1) {
			const ch = inner.charAt(i);
			if (ch === '(') {
				nested += 1;
			} else if (ch === ')') {
				if (nested > 0) {
					nested -= 1;
				}
			} else if (ch === ',' && nested === 0) {
				argumentIndex += 1;
			}
		}
		let operatorIndex = scan;
		while (operatorIndex >= 0 && isWhitespace(prefix.charAt(operatorIndex))) {
			operatorIndex -= 1;
		}
		let objectName: string | null = null;
		if (operatorIndex >= 0) {
			const candidateOperator = prefix.charAt(operatorIndex);
			if (candidateOperator === '.' || candidateOperator === ':') {
				let objectEnd = operatorIndex;
				let objectIndex = objectEnd - 1;
				while (objectIndex >= 0 && isWhitespace(prefix.charAt(objectIndex))) {
					objectIndex -= 1;
				}
				if (objectIndex >= 0) {
					let objectStart = objectIndex;
					while (objectStart >= 0 && isWordChar(prefix.charAt(objectStart))) {
						objectStart -= 1;
					}
					objectName = prefix.slice(objectStart + 1, objectIndex + 1);
				}
			}
		}
		if (objectName && objectName.toLowerCase() === 'api') {
			const apiMeta = apiCompletionData.signatures.get(methodName);
			if (apiMeta) {
				const params = apiMeta.params.slice();
				return {
					methodName,
					params,
					signatureLabel: apiMeta.signature,
					anchorRow: safeRow,
					anchorColumn: lastOpen,
					argumentIndex: Math.min(argumentIndex, Math.max(0, params.length - 1)),
				};
			}
		}
		const builtin = this.findBuiltinDescriptor(objectName, methodName);
		if (builtin) {
			const params = Array.isArray(builtin.params) ? builtin.params.slice() : [];
			return {
				methodName: builtin.name,
				params,
				signatureLabel: builtin.signature,
				anchorRow: safeRow,
				anchorColumn: lastOpen,
				argumentIndex: Math.min(argumentIndex, Math.max(0, params.length - 1)),
			};
		}
		return null;
 	}

	private analyzeCompletionContext(): CompletionContext | null {
		if (!this.isCodeTabActive()) {
			return null;
		}
		if (this.lines.length === 0) {
			return null;
		}
		const row = clamp(this.cursorRow, 0, this.lines.length - 1);
		const line = this.lines[row];
		const column = clamp(this.cursorColumn, 0, line.length);
		let start = column;
		while (start > 0 && isWordChar(line.charAt(start - 1))) {
			start -= 1;
		}
		const prefix = line.slice(start, column);
		const replaceFromColumn = start;
		const replaceToColumn = column;
		let probe = start - 1;
		while (probe >= 0 && isWhitespace(line.charAt(probe))) {
			probe -= 1;
		}
		if (probe >= 0) {
			const operator = line.charAt(probe);
			if (operator === '.' || operator === ':') {
				let objectEnd = probe;
				let objectProbe = objectEnd - 1;
				while (objectProbe >= 0 && isWhitespace(line.charAt(objectProbe))) {
					objectProbe -= 1;
				}
				if (objectProbe < 0) {
					return null;
				}
				let objectStart = objectProbe;
				while (objectStart >= 0 && isWordChar(line.charAt(objectStart))) {
					objectStart -= 1;
				}
				const objectName = line.slice(objectStart + 1, objectProbe + 1);
				if (objectName.length === 0) {
					return null;
				}
				return {
					kind: 'member',
					objectName,
					operator: operator as '.' | ':',
					prefix,
					row,
					replaceFromColumn,
					replaceToColumn,
				};
			}
		}
		return {
			kind: 'global',
			prefix,
			row,
			replaceFromColumn,
			replaceToColumn,
		};
	}

	private collectCompletionItems(context: CompletionContext): LuaCompletionItem[] {
		if (context.kind === 'member') {
			if (context.objectName.toLowerCase() === 'api') {
				return apiCompletionData.items.slice();
			}
			return [];
		}
		const registry = new Map<string, LuaCompletionItem>();
		const register = (item: LuaCompletionItem): void => {
			if (!registry.has(item.sortKey)) {
				registry.set(item.sortKey, item);
			}
		};
		const keywordItems = keywordCompletions;
		for (let i = 0; i < keywordItems.length; i += 1) {
			register(keywordItems[i]);
		}
		const localItems = this.getLocalCompletionItems();
		for (let i = 0; i < localItems.length; i += 1) {
			register(localItems[i]);
		}
		const globalItems = this.getGlobalCompletionItems();
		for (let i = 0; i < globalItems.length; i += 1) {
			register(globalItems[i]);
		}
		const builtinItems = this.getBuiltinCompletionItems();
		for (let i = 0; i < builtinItems.length; i += 1) {
			register(builtinItems[i]);
		}
		const combined = Array.from(registry.values());
		combined.sort((a, b) => a.label.localeCompare(b.label));
		return combined;
	}

	private getLocalCompletionItems(): LuaCompletionItem[] {
		const key = this.activeCompletionCacheKey();
		if (!key) {
			return [];
		}
		const cached = this.localCompletionCache.get(key);
		if (cached && cached.version === this.textVersion) {
			return cached.items;
		}
		const context = this.getActiveCodeTabContext();
		const assetId = this.resolveHoverAssetId(context);
		const chunkName = this.resolveHoverChunkName(context);
		let entries: ConsoleLuaSymbolEntry[] = [];
		try {
			entries = this.listLuaSymbolsFn(assetId, chunkName);
		} catch {
			this.localCompletionCache.delete(key);
			return [];
		}
		const items = this.buildSymbolCompletionItems(entries, 'local');
		this.localCompletionCache.set(key, { version: this.textVersion, items });
		return items;
	}

	private getGlobalCompletionItems(): LuaCompletionItem[] {
		if (this.cachedGlobalCompletionItems) {
			return this.cachedGlobalCompletionItems;
		}
		let entries: ConsoleLuaSymbolEntry[] = [];
		try {
			entries = this.listGlobalLuaSymbolsFn();
		} catch {
			this.cachedGlobalCompletionItems = [];
			return this.cachedGlobalCompletionItems;
		}
		const items = this.buildSymbolCompletionItems(entries, 'global');
		const apiItem: LuaCompletionItem = {
			label: 'api',
			insertText: 'api',
			sortKey: 'global:api',
			kind: 'global',
			detail: 'Console API root',
		};
		items.push(apiItem);
		items.sort((a, b) => a.label.localeCompare(b.label));
		this.cachedGlobalCompletionItems = items;
		return items;
	}

	private getBuiltinCompletionItems(): LuaCompletionItem[] {
		this.ensureBuiltinDescriptorCache();
		const items: LuaCompletionItem[] = [];
		for (const descriptor of this.builtinDescriptorMap.values()) {
			const label = descriptor.name;
			const params = Array.isArray(descriptor.params) ? descriptor.params.slice() : [];
			const detail = descriptor.signature && descriptor.signature.length > 0
				? descriptor.signature
				: 'Lua builtin';
			items.push({
				label,
				insertText: label,
				sortKey: `builtin:${label.toLowerCase()}`,
				kind: 'builtin',
				detail,
				parameters: params,
			});
		}
		items.sort((a, b) => a.label.localeCompare(b.label));
		return items;
	}

	private buildSymbolCompletionItems(entries: ConsoleLuaSymbolEntry[], scope: 'local' | 'global'): LuaCompletionItem[] {
		if (entries.length === 0) {
			return [];
		}
		const items: LuaCompletionItem[] = [];
		for (let i = 0; i < entries.length; i += 1) {
			const entry = entries[i];
			const origin = (() => {
				if (entry.location.path && entry.location.path.length > 0) {
					return entry.location.path;
				}
				if (entry.location.assetId && entry.location.assetId.length > 0) {
					return entry.location.assetId;
				}
				if (entry.location.chunkName && entry.location.chunkName.length > 0) {
					return entry.location.chunkName;
				}
				return '';
			})();
			const kindLabel = this.formatSymbolKind(entry.kind);
			const detail = origin.length > 0 ? `${kindLabel} • ${origin}` : kindLabel;
			const sortKey = `${scope}:${origin}:${entry.path}:${entry.name}:${entry.kind}`;
			items.push({
				label: entry.name,
				insertText: entry.name,
				sortKey,
				kind: scope,
				detail,
			});
		}
		items.sort((a, b) => a.label.localeCompare(b.label));
		return items;
	}

	private formatSymbolKind(kind: ConsoleLuaSymbolEntry['kind']): string {
		switch (kind) {
			case 'function':
				return 'function';
			case 'variable':
				return 'variable';
			case 'parameter':
				return 'parameter';
			case 'table_field':
				return 'table field';
			case 'assignment':
				return 'assignment';
			default:
				return kind;
		}
	}

	private ensureBuiltinDescriptorCache(force = false): void {
		if (!force && this.builtinDescriptors !== null) {
			return;
		}
		let descriptors: ConsoleLuaBuiltinDescriptor[];
		try {
			descriptors = this.listBuiltinLuaFunctionsFn();
		} catch {
			descriptors = [];
		}
		if (!Array.isArray(descriptors)) {
			descriptors = [];
		}
		this.builtinDescriptors = descriptors;
		this.builtinDescriptorMap.clear();
		const registerDescriptor = (descriptor: ConsoleLuaBuiltinDescriptor): void => {
			if (!descriptor || typeof descriptor.name !== 'string') {
				return;
			}
			const normalized = descriptor.name.trim();
			if (normalized.length === 0) {
				return;
			}
			const params = Array.isArray(descriptor.params) ? descriptor.params.slice() : [];
			const signature = descriptor.signature && descriptor.signature.length > 0
				? descriptor.signature
				: normalized;
			const entry: ConsoleLuaBuiltinDescriptor = {
				name: normalized,
				params,
				signature,
			};
			this.builtinDescriptorMap.set(normalized.toLowerCase(), entry);
		};
		for (let i = 0; i < descriptors.length; i += 1) {
			registerDescriptor(descriptors[i]);
		}
	}

	private findBuiltinDescriptor(objectName: string | null, methodName: string): ConsoleLuaBuiltinDescriptor | null {
		this.ensureBuiltinDescriptorCache();
		const methodKey = methodName.toLowerCase();
		if (objectName) {
			const compositeKey = `${objectName.toLowerCase()}.${methodKey}`;
			const composite = this.builtinDescriptorMap.get(compositeKey);
			if (composite) {
				return {
					name: composite.name,
					params: composite.params.slice(),
					signature: composite.signature,
				};
			}
		}
		const direct = this.builtinDescriptorMap.get(methodKey);
		if (direct) {
			return {
				name: direct.name,
				params: direct.params.slice(),
				signature: direct.signature,
			};
		}
		return null;
	}

	private determineAutoCompletionTrigger(context: CompletionContext, edit: EditContext): CompletionTrigger | null {
		if (!edit || edit.kind === 'delete') {
			return null;
		}
		if (edit.text.length === 0) {
			return null;
		}
		const lastChar = edit.text.charAt(edit.text.length - 1);
		if (context.kind === 'member') {
			if (lastChar === '.' || lastChar === ':') {
				return 'punctuation';
			}
			if (isWordChar(lastChar)) {
				return 'typing';
			}
			return null;
		}
		// Global context
		if (!isWordChar(lastChar)) {
			return null;
		}
		if (context.prefix.length === 0) {
			return null;
		}
		return 'typing';
	}

	private updateCompletionSessionAfterMutation(edit: EditContext | null): void {
		if (!this.isCodeTabActive()) {
			this.closeCompletionSession();
			return;
		}
		const analyzed = this.analyzeCompletionContext();
		if (this.completionSession) {
			this.cancelPendingCompletion();
			if (!analyzed) {
				this.closeCompletionSession();
				return;
			}
			const previousChar = this.charAt(this.cursorRow, this.cursorColumn - 1);
			if (analyzed.prefix.length === 0 && previousChar !== '.' && previousChar !== ':' && !isWordChar(previousChar)) {
				this.closeCompletionSession();
				return;
			}
			this.refreshCompletionSessionFromContext(analyzed);
			return;
		}
		if (!edit || !analyzed) {
			this.cancelPendingCompletion();
			return;
		}
		const trigger = this.determineAutoCompletionTrigger(analyzed, edit);
		if (!trigger) {
			this.cancelPendingCompletion();
			return;
		}
		this.pendingCompletionRequest = {
			context: analyzed,
			trigger,
			elapsed: 0,
		};
	}

	private openCompletionSessionFromContext(context: CompletionContext, _trigger: CompletionTrigger): void {
		this.cancelPendingCompletion();
		const items = this.collectCompletionItems(context);
		if (items.length === 0) {
			this.completionSession = null;
			return;
		}
		const session: CompletionSession = {
			context: context.kind === 'member'
				? {
					kind: 'member',
					objectName: context.objectName,
					operator: context.operator,
					prefix: context.prefix,
					row: context.row,
					replaceFromColumn: context.replaceFromColumn,
					replaceToColumn: context.replaceToColumn,
				}
				: {
					kind: 'global',
					prefix: context.prefix,
					row: context.row,
					replaceFromColumn: context.replaceFromColumn,
					replaceToColumn: context.replaceToColumn,
				},
			items,
			filteredItems: [],
			selectionIndex: -1,
			displayOffset: 0,
			anchorRow: this.cursorRow,
			anchorColumn: this.cursorColumn,
			maxVisibleItems: constants.COMPLETION_POPUP_MAX_VISIBLE,
		};
		this.completionSession = session;
		this.applyCompletionFilter(session);
	}

	private refreshCompletionSessionFromContext(context: CompletionContext): void {
		const session = this.completionSession;
		if (!session) {
			return;
		}
		const items = this.collectCompletionItems(context);
		if (items.length === 0) {
			this.closeCompletionSession();
			return;
		}
		if (context.kind === 'member') {
			session.context = {
				kind: 'member',
				objectName: context.objectName,
				operator: context.operator,
				prefix: context.prefix,
				row: context.row,
				replaceFromColumn: context.replaceFromColumn,
				replaceToColumn: context.replaceToColumn,
			};
		} else {
			session.context = {
				kind: 'global',
				prefix: context.prefix,
				row: context.row,
				replaceFromColumn: context.replaceFromColumn,
				replaceToColumn: context.replaceToColumn,
			};
		}
		session.items = items;
		session.anchorRow = this.cursorRow;
		session.anchorColumn = this.cursorColumn;
		this.applyCompletionFilter(session);
	}

	private applyCompletionFilter(session: CompletionSession): void {
		const prefix = session.context.prefix;
		const filtered = this.filterCompletionItems(session.items, prefix);
		if (filtered.length === 0) {
			session.filteredItems = [];
			session.selectionIndex = -1;
			session.displayOffset = 0;
			this.closeCompletionSession();
			return;
		}
		session.filteredItems = filtered;
		if (session.selectionIndex < 0 || session.selectionIndex >= session.filteredItems.length) {
			session.selectionIndex = 0;
		}
		this.ensureCompletionSelectionVisible(session);
	}

	private filterCompletionItems(items: LuaCompletionItem[], prefix: string): LuaCompletionItem[] {
		const lower = prefix.toLowerCase();
		const matches: Array<{ item: LuaCompletionItem; score: number; exact: boolean }> = [];
		for (let i = 0; i < items.length; i += 1) {
			const item = items[i];
			const labelLower = item.label.toLowerCase();
			let score: number | null = null;
			let exact = false;
			if (labelLower.startsWith(lower)) {
				score = 0;
				exact = labelLower === lower;
			} else if (lower.length > 0) {
				const index = labelLower.indexOf(lower);
				if (index !== -1) {
					score = index + 10;
				}
			}
			if (score === null) {
				continue;
			}
			matches.push({ item, score, exact });
		}
		if (lower.length === 0) {
			return items.slice();
		}
		if (matches.length === 0) {
			return [];
		}
		matches.sort((a, b) => {
			if (a.exact !== b.exact) {
				return a.exact ? -1 : 1;
			}
			if (a.score !== b.score) {
				return a.score - b.score;
			}
			return a.item.label.localeCompare(b.item.label);
		});
		const filtered: LuaCompletionItem[] = [];
		for (let i = 0; i < matches.length; i += 1) {
			filtered.push(matches[i].item);
		}
		return filtered;
	}

	private closeCompletionSession(): void {
		this.completionSession = null;
		this.cancelPendingCompletion();
	}

	private cancelPendingCompletion(): void {
		this.pendingCompletionRequest = null;
	}

private moveCompletionSelection(delta: number): void {
	const session = this.completionSession;
	if (!session) {
		return;
	}
	const total = session.filteredItems.length;
	if (total === 0) {
		return;
	}
	let index = session.selectionIndex;
	if (index < 0) {
		index = delta > 0 ? 0 : total - 1;
	} else {
		index += delta;
		index = ((index % total) + total) % total;
	}
	session.selectionIndex = index;
	this.ensureCompletionSelectionVisible(session);
}

	private ensureCompletionSelectionVisible(session: CompletionSession): void {
		if (session.selectionIndex < 0) {
			session.displayOffset = 0;
			return;
		}
	const visible = session.maxVisibleItems;
	let offset = session.displayOffset;
	if (session.selectionIndex < offset) {
		offset = session.selectionIndex;
	}
	const upperBound = offset + visible - 1;
	if (session.selectionIndex > upperBound) {
		offset = session.selectionIndex - visible + 1;
	}
	if (offset < 0) {
		offset = 0;
	}
	const maxOffset = Math.max(0, session.filteredItems.length - visible);
	if (offset > maxOffset) {
		offset = maxOffset;
	}
	session.displayOffset = offset;
}

	private completionContextsCompatible(expected: CompletionContext, actual: CompletionContext): boolean {
		if (expected.kind !== actual.kind) {
			return false;
		}
		if (expected.kind === 'member' && actual.kind === 'member') {
			if (expected.operator !== actual.operator) {
				return false;
			}
			if (expected.objectName.toLowerCase() !== actual.objectName.toLowerCase()) {
				return false;
			}
		}
		return true;
	}

	private processPendingCompletion(deltaSeconds: number): void {
		const pending = this.pendingCompletionRequest;
		if (!pending) {
			return;
		}
		if (!this.isCodeTabActive()) {
			this.cancelPendingCompletion();
			return;
		}
		if (this.completionSession) {
			this.cancelPendingCompletion();
			return;
		}
		pending.elapsed += deltaSeconds;
		if (pending.elapsed < constants.COMPLETION_AUTO_TRIGGER_DELAY_SECONDS) {
			return;
		}
		const analyzed = this.analyzeCompletionContext();
		if (!analyzed) {
			this.cancelPendingCompletion();
			return;
		}
		if (!this.completionContextsCompatible(pending.context, analyzed)) {
			this.cancelPendingCompletion();
			return;
		}
		if (pending.trigger === 'typing' && analyzed.kind === 'global' && analyzed.prefix.length === 0) {
			this.cancelPendingCompletion();
			return;
		}
		this.openCompletionSessionFromContext(analyzed, pending.trigger);
		this.pendingCompletionRequest = null;
	}

private acceptSelectedCompletion(): void {
	const session = this.completionSession;
	if (!session) {
		return;
	}
	if (session.filteredItems.length === 0) {
		this.closeCompletionSession();
		return;
	}
	let index = session.selectionIndex;
	if (index < 0 || index >= session.filteredItems.length) {
		index = 0;
	}
	const item = session.filteredItems[index];
	const addParentheses = item.kind === 'api_method';
	const freshContext = this.analyzeCompletionContext();
	const effectiveContext = freshContext && this.completionContextsCompatible(session.context, freshContext)
		? freshContext
		: session.context;
	this.applyCompletionItemForContext(effectiveContext, item, addParentheses);
	this.closeCompletionSession();
}

private applyCompletionItemForContext(context: CompletionContext, item: LuaCompletionItem, addParentheses: boolean): void {
	const row = clamp(context.row, 0, Math.max(0, this.lines.length - 1));
	const line = this.lines[row] ?? '';
	const replaceStart = clamp(context.replaceFromColumn, 0, line.length);
	const replaceEnd = clamp(context.replaceToColumn, replaceStart, line.length);
	this.cursorRow = row;
	this.cursorColumn = replaceEnd;
	this.selectionAnchor = { row, column: replaceStart };
	this.suppressNextAutoCompletion = true;
	let insertion = item.insertText;
	if (addParentheses) {
		insertion = `${item.insertText}()`;
	}
	this.replaceSelectionWith(insertion);
	if (addParentheses) {
		this.cursorRow = row;
		this.cursorColumn = replaceStart + item.insertText.length + 1;
	} else {
		this.cursorRow = row;
		this.cursorColumn = replaceStart + insertion.length;
	}
	this.updateDesiredColumn();
	this.resetBlink();
	this.revealCursor();
}

private handleCompletionKeybindings(
	keyboard: KeyboardInput,
	deltaSeconds: number,
	shiftDown: boolean,
	ctrlDown: boolean,
	altDown: boolean,
	metaDown: boolean,
): boolean {
	const session = this.completionSession;
	if (!session) {
		return false;
	}
	if (isKeyJustPressedGlobal(this.playerIndex, 'Escape')) {
		consumeKeyboardKey(keyboard, 'Escape');
		this.closeCompletionSession();
		return true;
	}
	let handled = false;
	if (this.shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowDown');
		this.moveCompletionSelection(1);
		handled = true;
	}
	if (this.shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowUp');
		this.moveCompletionSelection(-1);
		handled = true;
	}
	if (this.shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageDown');
		this.moveCompletionSelection(session.maxVisibleItems);
		handled = true;
	}
	if (this.shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageUp');
		this.moveCompletionSelection(-session.maxVisibleItems);
		handled = true;
	}
	if (ctrlDown || metaDown) {
		if (this.shouldFireRepeat(keyboard, 'Home', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'Home');
			if (session.filteredItems.length > 0) {
				session.selectionIndex = 0;
				this.ensureCompletionSelectionVisible(session);
			}
			handled = true;
		}
		if (this.shouldFireRepeat(keyboard, 'End', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'End');
			if (session.filteredItems.length > 0) {
				session.selectionIndex = session.filteredItems.length - 1;
				this.ensureCompletionSelectionVisible(session);
			}
			handled = true;
		}
	}
	if (handled) {
		return true;
	}
	const enterPressed = isKeyJustPressedGlobal(this.playerIndex, 'Enter');
	const numpadEnterPressed = isKeyJustPressedGlobal(this.playerIndex, 'NumpadEnter');
	if (enterPressed || numpadEnterPressed) {
		if (enterPressed) {
			consumeKeyboardKey(keyboard, 'Enter');
		} else {
			consumeKeyboardKey(keyboard, 'NumpadEnter');
		}
		this.acceptSelectedCompletion();
		return true;
	}
	if (isKeyJustPressedGlobal(this.playerIndex, 'Tab')) {
		consumeKeyboardKey(keyboard, 'Tab');
		if (shiftDown) {
			this.moveCompletionSelection(-1);
		} else {
			this.acceptSelectedCompletion();
		}
		return true;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(this.playerIndex, 'Space')) {
		consumeKeyboardKey(keyboard, 'Space');
		const context = this.analyzeCompletionContext();
		if (context) {
			this.openCompletionSessionFromContext(context, 'manual');
		} else {
			this.closeCompletionSession();
		}
		return true;
	}
	return false;
}

	private onCursorMoved(): void {
		this.cancelPendingCompletion();
		if (this.completionSession) {
			const context = this.analyzeCompletionContext();
			if (!context) {
				this.closeCompletionSession();
			} else {
				this.refreshCompletionSessionFromContext(context);
			}
		}
		this.refreshParameterHint();
	}

	private invalidateVisualLines(): void {
		this.visualLinesDirty = true;
	}

	private ensureVisualLines(): void {
		if (!this.visualLinesDirty) {
			return;
		}
		this.rebuildVisualLines();
	}

	private rebuildVisualLines(): void {
		const wrapEnabled = this.wordWrapEnabled;
		const lineCount = this.lines.length;
		if (lineCount === 0) {
			this.visualLines = [{
				row: 0,
				startColumn: 0,
				endColumn: 0,
			}];
			this.rowToFirstVisualLine = [0];
			this.visualLinesDirty = false;
			this.scrollRow = 0;
			return;
		}
		const segments: VisualLineSegment[] = [];
		const rowIndexLookup: number[] = new Array(lineCount).fill(-1);
		const wrapWidth = wrapEnabled ? this.computeWrapWidth() : Number.POSITIVE_INFINITY;
		for (let row = 0; row < lineCount; row += 1) {
			const line = this.lines[row];
			const entry = this.getCachedHighlight(row);
			const lineLength = line.length;
			if (rowIndexLookup[row] === -1) {
				rowIndexLookup[row] = segments.length;
			}
			if (lineLength === 0) {
				segments.push({ row, startColumn: 0, endColumn: 0 });
				continue;
			}
			let column = 0;
			while (column < lineLength) {
				const nextBreak = wrapEnabled
					? this.findWrapBreak(row, entry, column, wrapWidth)
					: lineLength;
				const endColumn = Math.max(column + 1, Math.min(lineLength, nextBreak));
				segments.push({ row, startColumn: column, endColumn });
				column = endColumn;
			}
		}
		if (segments.length === 0) {
			segments.push({ row: 0, startColumn: 0, endColumn: 0 });
		}
		this.visualLines = segments;
		this.rowToFirstVisualLine = rowIndexLookup;
		this.visualLinesDirty = false;
		const maxScrollRow = Math.max(0, this.visualLines.length - 1);
		if (this.scrollRow > maxScrollRow) {
			this.scrollRow = maxScrollRow;
		}
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

	private findWrapBreak(row: number, entry: CachedHighlight, startColumn: number, wrapWidth: number): number {
		const line = this.lines[row];
		const lineLength = line.length;
		if (wrapWidth === Number.POSITIVE_INFINITY) {
			return lineLength;
		}
		let column = startColumn + 1;
		let lastBreak = startColumn;
		let lastBreakEnd = startColumn + 1;
		while (column <= lineLength) {
			const width = this.measureColumns(entry, startColumn, column);
			if (width > wrapWidth) {
				if (lastBreak > startColumn) {
					return lastBreakEnd;
				}
				return column - 1;
			}
			if (column < lineLength) {
				const ch = line.charAt(column);
				if (ch === ' ' || ch === '\t' || ch === '-') {
					lastBreak = column;
					let skip = column + 1;
					while (skip < lineLength && line.charAt(skip) === ' ') {
						skip += 1;
					}
					lastBreakEnd = skip;
				}
			}
			column += 1;
		}
		return lineLength;
	}

	private measureColumns(entry: CachedHighlight, startColumn: number, endColumn: number): number {
		const highlight = entry.hi;
		const startDisplay = this.columnToDisplay(highlight, startColumn);
		const endDisplay = this.columnToDisplay(highlight, endColumn);
		return this.measureRangeFast(entry, startDisplay, endDisplay);
	}

	private getVisualLineCount(): number {
		this.ensureVisualLines();
		return this.visualLines.length;
	}

	private visualIndexToSegment(index: number): VisualLineSegment | null {
		this.ensureVisualLines();
		if (index < 0 || index >= this.visualLines.length) {
			return null;
		}
		return this.visualLines[index];
	}

	private positionToVisualIndex(row: number, column: number): number {
		this.ensureVisualLines();
		if (this.visualLines.length === 0) {
			return 0;
		}
		const safeRow = clamp(row, 0, this.lines.length - 1);
		const baseIndex = this.rowToFirstVisualLine[safeRow];
		if (!Number.isFinite(baseIndex) || baseIndex === undefined || baseIndex === -1) {
			return 0;
		}
		let index = baseIndex;
		while (index < this.visualLines.length) {
			const segment = this.visualLines[index];
			if (segment.row !== safeRow) {
				break;
			}
			if (column < segment.endColumn || segment.startColumn === segment.endColumn) {
				return index;
			}
			index += 1;
		}
		return Math.min(this.visualLines.length - 1, index - 1);
	}

	private setCursorFromVisualIndex(visualIndex: number, desiredColumnHint?: number, desiredOffsetHint?: number): void {
		this.ensureVisualLines();
		if (this.visualLines.length === 0) {
			this.cursorRow = 0;
			this.cursorColumn = 0;
			this.updateDesiredColumn();
			return;
		}
		const clampedIndex = clamp(visualIndex, 0, this.visualLines.length - 1);
		const segment = this.visualLines[clampedIndex];
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
			const hasNextSegmentSameRow = (clampedIndex + 1 < this.visualLines.length)
				&& this.visualLines[clampedIndex + 1].row === segment.row;
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
			api.rectfillColor(left, top, right, bottom, caretColor);
			const caretIndex = this.resolvePaletteIndex(caretColor);
			const inverseColor = caretIndex !== null
				? this.invertColorIndex(caretIndex)
				: this.invertColorIndex(baseTextColor);
			const glyph = field.cursor < field.text.length ? field.text.charAt(field.cursor) : ' ';
			this.drawText(api, glyph.length > 0 ? glyph : ' ', cursorX, top, inverseColor);
			return;
		}
		this.drawRectOutlineColor(api, left, top, right, bottom, caretColor);
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
		api.rectfill(0, statusTop, this.viewportWidth, statusBottom, constants.COLOR_STATUS_BACKGROUND);

		if (this.message.visible) {
			const lines = this.getStatusMessageLines();
			let textY = statusTop + 2;
			const textX = 4;
			for (let i = 0; i < lines.length; i += 1) {
				this.drawText(api, lines[i], textX, textY, constants.COLOR_STATUS_ALERT);
				textY += this.lineHeight;
			}
			return;
		}

		if (this.symbolSearchVisible) {
			const match = this.getActiveSymbolSearchMatch();
			if (!match) {
				return;
			}
			const locationPath = match.entry.symbol.location.path;
			if (!locationPath || locationPath.length === 0) {
				throw new Error('[ConsoleCartEditor] Symbol location path unavailable.');
			}
			const pathText = this.truncateTextToWidth(locationPath, Math.max(0, this.viewportWidth - 8));
			this.drawText(api, pathText, 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
			return;
		}

		if (this.resourcePanelVisible) {
			const filterLabel = this.resourcePanelFilterMode === 'lua_only' ? 'LUA' : 'ALL';
			const fileInfo = `FILES ${this.resourcePanelResourceCount} (${filterLabel})`;
			const hint = 'CTRL+SHIFT+L TOGGLE FILTER';
			this.drawText(api, fileInfo, 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
			this.drawText(api, hint, this.viewportWidth - this.measureText(hint) - 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
		} else if (this.isResourceViewActive()) {
			const viewer = this.getActiveResourceViewer();
			const info = viewer ? `${viewer.descriptor.type.toUpperCase()} ${viewer.descriptor.assetId}` : 'RESOURCE';
			const detail = viewer ? viewer.descriptor.path : '';
			this.drawText(api, info, 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
			if (detail.length > 0) {
				this.drawText(api, detail, this.viewportWidth - this.measureText(detail) - 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
			}
		} else {
			const lineInfo = `LINE ${this.cursorRow + 1}/${this.lines.length} COL ${this.cursorColumn + 1}`;
			const filenameInfo = `${this.metadata.title || 'UNTITLED'}.lua`;
			this.drawText(api, lineInfo, 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
			this.drawText(api, filenameInfo, this.viewportWidth - this.measureText(filenameInfo) - 4, statusTop + 2, constants.COLOR_STATUS_TEXT);
		}
	}

	private drawActionPromptOverlay(api: BmsxConsoleApi): void {
		const prompt = this.pendingActionPrompt;
		if (!prompt) {
			return;
		}
		api.rectfillColor(0, 0, this.viewportWidth, this.viewportHeight, constants.ACTION_OVERLAY_COLOR);

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
			this.drawText(api, messageLines[i], textX, textY, constants.ACTION_DIALOG_TEXT_COLOR);
			textY += messageSpacing;
		}

		const buttonY = bottom - paddingY - buttonHeight;
		let buttonX = left + paddingX;
		const saveBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + primaryWidth, bottom: buttonY + buttonHeight };
		api.rectfill(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, constants.ACTION_BUTTON_BACKGROUND);
		api.rect(saveBounds.left, saveBounds.top, saveBounds.right, saveBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
		this.drawText(api, primaryLabel, saveBounds.left + constants.HEADER_BUTTON_PADDING_X, saveBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.ACTION_BUTTON_TEXT);
		this.actionPromptButtons.saveAndContinue = saveBounds;
		buttonX = saveBounds.right + buttonSpacing;

		const continueBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + secondaryWidth, bottom: buttonY + buttonHeight };
		api.rectfill(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, constants.ACTION_BUTTON_BACKGROUND);
		api.rect(continueBounds.left, continueBounds.top, continueBounds.right, continueBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
		this.drawText(api, secondaryLabel, continueBounds.left + constants.HEADER_BUTTON_PADDING_X, continueBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.ACTION_BUTTON_TEXT);
		this.actionPromptButtons.continue = continueBounds;
		buttonX = continueBounds.right + buttonSpacing;

		const cancelBounds: RectBounds = { left: buttonX, top: buttonY, right: buttonX + cancelWidth, bottom: buttonY + buttonHeight };
		api.rectfill(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND);
		api.rect(cancelBounds.left, cancelBounds.top, cancelBounds.right, cancelBounds.bottom, constants.ACTION_DIALOG_BORDER_COLOR);
		this.drawText(api, cancelLabel, cancelBounds.left + constants.HEADER_BUTTON_PADDING_X, cancelBounds.top + constants.HEADER_BUTTON_PADDING_Y, constants.COLOR_HEADER_BUTTON_TEXT);
		this.actionPromptButtons.cancel = cancelBounds;
	}

	private highlightLine(line: string): HighlightLine {
		const length = line.length;
		const columnColors: number[] = new Array(length).fill(constants.COLOR_CODE_TEXT);
		let i = 0;
		while (i < length) {
			const ch = line.charAt(i);
			if (line.startsWith('--[[', i)) {
				const closeIndex = line.indexOf(']]', i + 4);
				const end = closeIndex !== -1 ? closeIndex + 2 : length;
				for (let j = i; j < end; j++) {
					columnColors[j] = constants.COLOR_COMMENT;
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
					columnColors[j] = constants.COLOR_STRING;
				}
				i = end;
				continue;
			}
			if (ch === '"' || ch === '\'') {
				const delimiter = ch;
				columnColors[i] = constants.COLOR_STRING;
				i += 1;
				while (i < length) {
					columnColors[i] = constants.COLOR_STRING;
					const current = line.charAt(i);
					if (current === '\\' && i + 1 < length) {
						columnColors[i + 1] = constants.COLOR_STRING;
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
				for (let j = i; j < length; j++) columnColors[j] = constants.COLOR_COMMENT;
				break;
			}
			if (i + 2 <= length && line.slice(i, i + 3) === '...') {
				columnColors[i] = constants.COLOR_OPERATOR;
				columnColors[i + 1] = constants.COLOR_OPERATOR;
				columnColors[i + 2] = constants.COLOR_OPERATOR;
				i += 3;
				continue;
			}
			if (i + 1 < length) {
				const pair = line.slice(i, i + 2);
				if (pair === '==' || pair === '~=' || pair === '<=' || pair === '>=' || pair === '..') {
					columnColors[i] = constants.COLOR_OPERATOR;
					columnColors[i + 1] = constants.COLOR_OPERATOR;
					i += 2;
					continue;
				}
			}
			if (this.isNumberStart(line, i)) {
				const end = this.readNumber(line, i);
				for (let j = i; j < end; j++) columnColors[j] = constants.COLOR_NUMBER;
				i = end;
				continue;
			}
			if (this.isIdentifierStart(ch)) {
				const end = this.readIdentifier(line, i);
				const word = line.slice(i, end);
				const color = KEYWORDS.has(word.toLowerCase()) ? constants.COLOR_KEYWORD : constants.COLOR_CODE_TEXT;
				if (color !== constants.COLOR_CODE_TEXT) {
					for (let j = i; j < end; j++) columnColors[j] = color;
				}
				i = end;
				continue;
			}
			if (this.isOperatorChar(ch)) {
				columnColors[i] = constants.COLOR_OPERATOR;
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
				for (let j = 0; j < constants.TAB_SPACES; j++) {
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
				for (let j = 0; j < constants.TAB_SPACES; j++) {
					result += ' ';
				}
			} else {
				result += ch;
			}
		}
		return result;
	}

	private truncateTextToWidth(text: string, maxWidth: number): string {
		if (maxWidth <= 0) {
			return '';
		}
		if (this.measureText(text) <= maxWidth) {
			return text;
		}
		const ellipsis = '...';
		const ellipsisWidth = this.measureText(ellipsis);
		if (ellipsisWidth > maxWidth) {
			return '';
		}
		let low = 0;
		let high = text.length;
		let best = '';
		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			const candidate = text.slice(0, mid) + ellipsis;
			if (this.measureText(candidate) <= maxWidth) {
				best = candidate;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		return best;
	}

	private measureText(text: string): number {
		let width = 0;
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (ch === '\t') {
				width += this.spaceAdvance * constants.TAB_SPACES;
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

	private shouldFireRepeat(_keyboard: KeyboardInput, code: string, deltaSeconds: number): boolean {
		const state = getKeyboardButtonState(this.playerIndex, code);
		if (!state || state.pressed !== true) {
			this.repeatState.delete(code);
			clearKeyPressRecord(code);
			return false;
		}
		let entry = this.repeatState.get(code);
		if (!entry) {
			entry = { cooldown: constants.INITIAL_REPEAT_DELAY };
			this.repeatState.set(code, entry);
		}
		if (shouldAcceptKeyPressGlobal(code, state)) {
			entry.cooldown = constants.INITIAL_REPEAT_DELAY;
			return true;
		}
		entry.cooldown -= deltaSeconds;
		if (entry.cooldown <= 0) {
			entry.cooldown = constants.REPEAT_INTERVAL;
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
}
