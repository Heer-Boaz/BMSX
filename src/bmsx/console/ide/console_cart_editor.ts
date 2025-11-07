import { $ } from '../../core/game';
import type { KeyboardInput } from '../../input/keyboardinput';
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
import { isIdentifierChar, isIdentifierStartChar, isWhitespace, isWordChar } from './text_utils';
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
import { ConsoleCodeLayout } from './code_layout';
import { LuaSemanticWorkspace } from './semantic_workspace.ts';
import { buildRuntimeErrorLines as buildRuntimeErrorLinesUtil, computeRuntimeErrorOverlayMaxWidth, wrapRuntimeErrorLine as wrapRuntimeErrorLineUtil } from './runtime_error_utils';
import type {
	CachedHighlight,
	CodeHoverTooltip,
	CodeTabContext,
	ConsoleEditorOptions,
	ConsoleEditorSerializedState,
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
	ConsoleEditorShortcutContext,
	CustomKeybindingHandler,
	DiagnosticsCacheEntry,
	GlobalSearchJob,
	SearchComputationJob,
} from './types';
import type { RectBounds } from '../../rompack/rompack.ts';
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
import { createMessageController } from './console_cart_editor_messages';
import { clearBackgroundTasks, enqueueBackgroundTask } from './console_cart_editor_background';

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
	resetKeyPressRecords,
	shouldAcceptKeyPress as shouldAcceptKeyPressGlobal,
} from './input_helpers';
import type { LuaDefinitionInfo, LuaSourceRange } from '../../lua/ast.ts';
import { resolveIndentAwareHome, resolveSegmentEnd } from './caret_navigation.ts';
import type { BmsxConsoleRuntime } from '../../console.ts';
import { EDITOR_TOGGLE_KEY, ESCAPE_KEY, EDITOR_TOGGLE_GAMEPAD_BUTTONS, GLOBAL_SEARCH_RESULT_LIMIT } from './constants';
import { formatLuaDocument } from './lua_formatter.ts';
import { caretNavigation, drawCursor, drawInlineCaret, updateBlink } from './caret.ts';

export let playerIndex: number;
export let lines: string[] = [''];
export let cursorRow = 0;
export let cursorColumn = 0;
export let scrollRow = 0;
export let scrollColumn = 0;
export let dirty = false;
export let desiredColumn = 0;
export let desiredDisplayOffset = 0;
export let selectionAnchor: Position | null = null;
export let undoStack: EditorSnapshot[] = [];
export let redoStack: EditorSnapshot[] = [];
export let lastHistoryKey: string | null = null;
export let lastHistoryTimestamp = 0;
export let metadata: BmsxConsoleMetadata;
export let fontVariant: ConsoleFontVariant;
export let loadSourceFn: () => string;
export let saveSourceFn: (source: string) => Promise<void>;
export let loadLuaResourceFn: (assetId: string) => string;
export let saveLuaResourceFn: (assetId: string, source: string) => Promise<void>;
export let createLuaResourceFn: (request: ConsoleLuaResourceCreationRequest) => Promise<ConsoleResourceDescriptor>;
export let listResourcesFn: () => ConsoleResourceDescriptor[];
export let inspectLuaExpressionFn: (request: ConsoleLuaHoverRequest) => ConsoleLuaHoverResult | null;
export let listLuaObjectMembersFn: (request: ConsoleLuaMemberCompletionRequest) => ConsoleLuaMemberCompletion[];
export let listLuaModuleSymbolsFn: (moduleName: string) => ConsoleLuaSymbolEntry[];
export let listLuaSymbolsFn: (assetId: string | null, chunkName: string | null) => ConsoleLuaSymbolEntry[];
export let listGlobalLuaSymbolsFn: () => ConsoleLuaSymbolEntry[];
export let listBuiltinLuaFunctionsFn: () => ConsoleLuaBuiltinDescriptor[];
export let primaryAssetId: string | null;
export let builtinIdentifierCache: { key: string; set: ReadonlySet<string> } | null = null;
export let hoverTooltip: CodeHoverTooltip | null = null;
export let lastPointerSnapshot: PointerSnapshot | null = null;
export let lastInspectorResult: ConsoleLuaHoverResult | null = null;
export let inspectorRequestFailed = false;
export let gotoHoverHighlight: { row: number; startColumn: number; endColumn: number; expression: string } | null = null;
export let viewportWidth: number;
export let viewportHeight: number;
export let font: ConsoleEditorFont;
export let lineHeight: number;
export let charAdvance: number;
export let spaceAdvance: number;
export let gutterWidth: number;
export let headerHeight: number;
export let tabBarHeight: number;
export let tabBarRowCount = 1;
export let baseBottomMargin: number;
export const repeatState: Map<string, RepeatEntry> = new Map();
export let deferredMessageDuration: number | null = null;
export let runtimeErrorOverlay: RuntimeErrorOverlay | null = null;
export let executionStopRow: number | null = null;
export let clockNow: () => number;
export let problemsPanel: ProblemsPanelController;
export let problemsPanelResizing = false;
export let diagnostics: EditorDiagnostic[] = [];
export let diagnosticsByRow: Map<number, EditorDiagnostic[]> = new Map();
export let diagnosticsDirty = true;
export const diagnosticsDebounceMs = 200;
export let diagnosticsCache: Map<string, DiagnosticsCacheEntry> = new Map();
export let dirtyDiagnosticContexts: Set<string> = new Set();
export let diagnosticsDueAtMs: number | null = null;
export let diagnosticsComputationScheduled = false;
export const codeTabContexts: Map<string, CodeTabContext> = new Map();
export let activeCodeTabContextId: string | null = null;
export let entryTabId: string | null = null;
export const captureKeys: string[] = [...new Set([
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
export const topBarButtonBounds: Record<TopBarButtonId, RectBounds> = {
	resume: { left: 0, top: 0, right: 0, bottom: 0 },
	reboot: { left: 0, top: 0, right: 0, bottom: 0 },
	save: { left: 0, top: 0, right: 0, bottom: 0 },
	resources: { left: 0, top: 0, right: 0, bottom: 0 },
	problems: { left: 0, top: 0, right: 0, bottom: 0 },
	filter: { left: 0, top: 0, right: 0, bottom: 0 },
	resolution: { left: 0, top: 0, right: 0, bottom: 0 },
	wrap: { left: 0, top: 0, right: 0, bottom: 0 },
};
export const tabButtonBounds: Map<string, RectBounds> = new Map();
export const tabCloseButtonBounds: Map<string, RectBounds> = new Map();
export let resourceViewerSpriteId: string | null = null;
export let resourceViewerSpriteAsset: string | null = null;
export let resourceViewerSpriteScale = 1;
export const actionPromptButtons: { saveAndContinue: RectBounds | null; continue: RectBounds; cancel: RectBounds } = {
	saveAndContinue: null,
	continue: { left: 0, top: 0, right: 0, bottom: 0 },
	cancel: { left: 0, top: 0, right: 0, bottom: 0 },
};
export let pendingActionPrompt: PendingActionPrompt | null = null;
export let active = false;
const messageController = createMessageController({
	isActive: () => active,
	getDeferredDuration: () => deferredMessageDuration,
	setDeferredDuration: (value) => { deferredMessageDuration = value; },
});
export const message = messageController.message;
export const showMessage = messageController.showMessage;
export const updateMessage = messageController.updateMessage;
export const showWarningBanner = messageController.showWarningBanner;
export let blinkTimer = 0;
export let cursorVisible = true;
export let warnNonMonospace = false;
export let pointerSelecting = false;
export let pointerPrimaryWasPressed = false;
export let pointerAuxWasPressed = false;
export let searchField: InlineTextField;
export let symbolSearchField: InlineTextField;
export let resourceSearchField: InlineTextField;
export let lineJumpField: InlineTextField;
export let createResourceField: InlineTextField;
export let inlineFieldMetricsRef: InlineFieldMetrics;
export let scrollbars: Record<ScrollbarKind, ConsoleScrollbar>;
export let scrollbarController: ScrollbarController;
export let input: InputController;
export let toggleInputLatch = false;
export let windowFocused = true;
export let pendingWindowFocused = true;
export let disposeVisibilityListener: (() => void) | null = null;
export let disposeWindowEventListeners: (() => void) | null = null;
export let lastPointerClickTimeMs = 0;
export let lastPointerClickRow = -1;
export let lastPointerClickColumn = -1;
export let tabHoverId: string | null = null;
export let tabDragState: TabDragState | null = null;
export let crtOptionsSnapshot: CrtOptionsSnapshot | null = null;
export let resolutionMode: EditorResolutionMode = 'viewport';
export let cursorRevealSuspended = false;
export let searchActive = false;
export let searchVisible = false;
export let searchQuery = '';
export let symbolSearchQuery = '';
export let resourceSearchQuery = '';
export let pendingEditContext: EditContext | null = null;
export let cursorScreenInfo: CursorScreenInfo | null = null;
export let lineJumpActive = false;
export let symbolSearchActive = false;
export let symbolSearchVisible = false;
export let symbolSearchGlobal = false;
export let symbolSearchMode: 'symbols' | 'references' = 'symbols';
export let resourceSearchActive = false;
export let resourceSearchVisible = false;
export let lineJumpVisible = false;
export let lineJumpValue = '';
export let createResourceActive = false;
export let createResourceVisible = false;
export let createResourcePath = '';
export let createResourceError: string | null = null;
export let createResourceWorking = false;
export let lastCreateResourceDirectory: string | null = null;
export let symbolCatalog: SymbolCatalogEntry[] = [];
export let referenceCatalog: ReferenceCatalogEntry[] = [];
export let symbolCatalogContext: { scope: 'local' | 'global'; assetId: string | null; chunkName: string | null } | null = null;
export let symbolSearchMatches: SymbolSearchResult[] = [];
export let symbolSearchSelectionIndex = -1;
export let symbolSearchDisplayOffset = 0;
export let symbolSearchHoverIndex = -1;
export let resourceCatalog: ResourceCatalogEntry[] = [];
export let resourceSearchMatches: ResourceSearchResult[] = [];
export let resourceSearchSelectionIndex = -1;
export let resourceSearchDisplayOffset = 0;
export let resourceSearchHoverIndex = -1;
export let searchMatches: SearchMatch[] = [];
export let searchCurrentIndex = -1;
export let searchJob: SearchComputationJob | null = null;
export let searchDisplayOffset = 0;
export let searchHoverIndex = -1;
export let searchScope: 'local' | 'global' = 'local';
export let globalSearchMatches: GlobalSearchMatch[] = [];
export let globalSearchJob: GlobalSearchJob | null = null;
export let diagnosticsTaskPending = false;
export let lastReportedSemanticError: string | null = null;
export const referenceState: ReferenceState = new ReferenceState();
export let textVersion = 0;
export let saveGeneration = 0;
export let appliedGeneration = 0;
export let lastSavedSource = '';
export let tabs: EditorTabDescriptor[] = [];
export let activeTabId: string | null = null;
export let resourceBrowserItems: ResourceBrowserItem[] = [];
export let resourceBrowserSelectionIndex = -1;
export let resourcePanelVisible = false;
export let resourcePanelFocused = false;
export let resourcePanelResourceCount = 0;
export let pendingResourceSelectionAssetId: string | null = null;
export let resourcePanelWidthRatio: number | null = null;
export let resourcePanelResizing = false;
export let resourcePanel: ResourcePanelController;
export let renameController: RenameController;
export let semanticWorkspace: LuaSemanticWorkspace = new LuaSemanticWorkspace();
export let layout: ConsoleCodeLayout;
export let codeVerticalScrollbarVisible = false;
export let codeHorizontalScrollbarVisible = false;
export let cachedVisibleRowCount = 1;
export let cachedVisibleColumnCount = 1;
export let dimCrtInEditor: boolean = false; // Default value; can be changed via settings
export let wordWrapEnabled = true;
export let lastPointerRowResolution: { visualIndex: number; segment: VisualLineSegment | null } | null = null;
export let completion: CompletionController;
export const NAVIGATION_HISTORY_LIMIT = 64;
export const navigationHistory = {
	back: [] as NavigationHistoryEntry[],
	forward: [] as NavigationHistoryEntry[],
	current: null as NavigationHistoryEntry | null,
};
export let navigationCaptureSuspended = false;

export const EMPTY_DIAGNOSTICS: EditorDiagnostic[] = [];
export let customClipboard: string | null = null;

export function clearCursorVisualOverride(): void {
	caretNavigation.clear();
}

export function setCursorVisualOverride(row: number, column: number, visualIndex: number, segmentStartColumn: number): void {
	caretNavigation.capture(row, column, visualIndex, segmentStartColumn);
}

export function getCursorVisualOverride(row: number, column: number): { visualIndex: number; segmentStartColumn: number } | null {
	return caretNavigation.peek(row, column);
}

export function invalidateLineRange(startRow: number, endRow: number): void {
	if (lines.length === 0) {
		return;
	}
	let from = Math.min(startRow, endRow);
	let to = Math.max(startRow, endRow);
	const lastRow = lines.length - 1;
	from = clamp(from, 0, lastRow);
	to = clamp(to, 0, lastRow);
	for (let row = from; row <= to; row += 1) {
		invalidateLine(row);
	}
}

export function maximumLineLength(): number {
	let maxLength = 0;
	for (let i = 0; i < lines.length; i += 1) {
		const length = lines[i].length;
		if (length > maxLength) {
			maxLength = length;
		}
	}
	return maxLength;
}

export function computeMaximumScrollColumn(): number {
	const maxLength = maximumLineLength();
	const visible = visibleColumnCount();
	const limit = maxLength - visible;
	if (limit <= 0) {
		return 0;
	}
	return limit;
}

export function setCursorPosition(row: number, column: number): void {
	caretNavigation.clear();
	let targetRow = row;
	if (targetRow < 0) {
		targetRow = 0;
	}
	const lastRow = lines.length - 1;
	if (targetRow > lastRow) {
		targetRow = lastRow >= 0 ? lastRow : 0;
	}
	let targetColumn = column;
	if (targetColumn < 0) {
		targetColumn = 0;
	}
	const lineLength = lines[targetRow]?.length ?? 0;
	if (targetColumn > lineLength) {
		targetColumn = lineLength;
	}
	cursorRow = targetRow;
	cursorColumn = targetColumn;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	onCursorMoved();
}

export function moveCursorVertical(delta: number): void {
	caretNavigation.clear();
	ensureVisualLines();
	const visualCount = getVisualLineCount();
	if (visualCount === 0) {
		return;
	}
	const currentIndex = positionToVisualIndex(cursorRow, cursorColumn);
	const targetIndex = clamp(currentIndex + delta, 0, visualCount - 1);
	const desired = desiredColumn;
	const desiredDisplay = desiredDisplayOffset;
	setCursorFromVisualIndex(targetIndex, desired, desiredDisplay);
	resetBlink();
	revealCursor();
	onCursorMoved();
}

export function moveCursorHorizontal(delta: number): void {
	if (delta === 0) {
		return;
	}
	caretNavigation.clear();
	ensureVisualLines();
	const visualCount = getVisualLineCount();
	if (visualCount === 0) {
		return;
	}
	const visualIndex = positionToVisualIndex(cursorRow, cursorColumn);
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		return;
	}
	const line = lines[segment.row] ?? '';
	if (delta < 0) {
		if (cursorColumn > segment.startColumn) {
			cursorColumn -= 1;
		} else {
			let moved = false;
			if (wordWrapEnabled && visualIndex > 0) {
				const prevSegment = visualIndexToSegment(visualIndex - 1);
				if (prevSegment && prevSegment.row === segment.row) {
					cursorRow = prevSegment.row;
					const prevLine = lines[prevSegment.row] ?? '';
					const prevEnd = Math.max(prevSegment.endColumn, prevSegment.startColumn);
					const hasMoreBefore = prevEnd > prevSegment.startColumn;
					const targetColumn = hasMoreBefore && prevEnd < prevLine.length
						? Math.max(prevSegment.startColumn, prevEnd - 1)
						: Math.min(prevEnd, prevLine.length);
					cursorColumn = clamp(targetColumn, 0, prevLine.length);
					moved = true;
				}
			}
			if (!moved && segment.row > 0) {
				cursorRow = segment.row - 1;
				cursorColumn = lines[cursorRow].length;
			}
		}
	} else {
		if (cursorColumn < segment.endColumn && cursorColumn < line.length) {
			cursorColumn += 1;
		} else {
			let moved = false;
			if (wordWrapEnabled && visualIndex < visualCount - 1) {
				const nextSegment = visualIndexToSegment(visualIndex + 1);
				if (nextSegment && nextSegment.row === segment.row) {
					cursorRow = nextSegment.row;
					cursorColumn = nextSegment.startColumn;
					moved = true;
				}
			}
			if (!moved && segment.row < lines.length - 1) {
				cursorRow = segment.row + 1;
				cursorColumn = 0;
			}
		}
	}
	cursorColumn = clamp(cursorColumn, 0, lines[cursorRow]?.length ?? 0);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	onCursorMoved();
}

export function moveWordLeft(): void {
	clearCursorVisualOverride();
	const destination = findWordLeft(cursorRow, cursorColumn);
	cursorRow = destination.row;
	cursorColumn = destination.column;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	onCursorMoved();
}

export function moveWordRight(): void {
	clearCursorVisualOverride();
	const destination = findWordRight(cursorRow, cursorColumn);
	cursorRow = destination.row;
	cursorColumn = destination.column;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	onCursorMoved();
}

export function findWordLeft(row: number, column: number): { row: number; column: number } {
	let currentRow = row;
	let currentColumn = column;
	let step = stepLeft(currentRow, currentColumn);
	if (!step) {
		return { row: 0, column: 0 };
	}
	currentRow = step.row;
	currentColumn = step.column;
	let currentChar = charAt(currentRow, currentColumn);
	while (isWhitespace(currentChar)) {
		const previous = stepLeft(currentRow, currentColumn);
		if (!previous) {
			return { row: 0, column: 0 };
		}
		currentRow = previous.row;
		currentColumn = previous.column;
		currentChar = charAt(currentRow, currentColumn);
	}
	const word = isWordChar(currentChar);
	while (true) {
		const previous = stepLeft(currentRow, currentColumn);
		if (!previous) {
			currentRow = 0;
			currentColumn = 0;
			break;
		}
		const previousChar = charAt(previous.row, previous.column);
		if (isWhitespace(previousChar) || isWordChar(previousChar) !== word) {
			break;
		}
		currentRow = previous.row;
		currentColumn = previous.column;
	}
	return { row: currentRow, column: currentColumn };
}

export function findWordRight(row: number, column: number): { row: number; column: number } {
	let currentRow = row;
	let currentColumn = column;
	let step = stepRight(currentRow, currentColumn);
	if (!step) {
		const lastRow = lines.length - 1;
		return { row: lastRow, column: lines[lastRow].length };
	}
	currentRow = step.row;
	currentColumn = step.column;
	let currentChar = charAt(currentRow, currentColumn);
	while (isWhitespace(currentChar)) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const lastRow = lines.length - 1;
			return { row: lastRow, column: lines[lastRow].length };
		}
		currentRow = next.row;
		currentColumn = next.column;
		currentChar = charAt(currentRow, currentColumn);
	}
	const word = isWordChar(currentChar);
	while (true) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const lastRow = lines.length - 1;
			currentRow = lastRow;
			currentColumn = lines[lastRow].length;
			break;
		}
		const nextChar = charAt(next.row, next.column);
		if (isWhitespace(nextChar) || isWordChar(nextChar) !== word) {
			currentRow = next.row;
			currentColumn = next.column;
			break;
		}
		currentRow = next.row;
		currentColumn = next.column;
	}
	while (isWhitespace(charAt(currentRow, currentColumn))) {
		const next = stepRight(currentRow, currentColumn);
		if (!next) {
			const lastRow = lines.length - 1;
			currentRow = lastRow;
			currentColumn = lines[lastRow].length;
			break;
		}
		currentRow = next.row;
		currentColumn = next.column;
	}
	return { row: currentRow, column: currentColumn };
}

export function moveCursorLeft(byWord: boolean, select: boolean): void {
	const previous: Position = { row: cursorRow, column: cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else if (hasSelection()) {
		collapseSelectionTo('start');
		breakUndoSequence();
		return;
	}
	if (byWord) {
		moveWordLeft();
	} else {
		moveCursorHorizontal(-1);
	}
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

export function moveCursorRight(byWord: boolean, select: boolean): void {
	const previous: Position = { row: cursorRow, column: cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else if (hasSelection()) {
		collapseSelectionTo('end');
		breakUndoSequence();
		return;
	}
	if (byWord) {
		moveWordRight();
	} else {
		moveCursorHorizontal(1);
	}
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

export function moveCursorUp(select: boolean): void {
	const previous: Position = { row: cursorRow, column: cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else if (hasSelection()) {
		collapseSelectionTo('start');
		breakUndoSequence();
		return;
	}
	moveCursorVertical(-1);
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

export function moveCursorDown(select: boolean): void {
	const previous: Position = { row: cursorRow, column: cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else if (hasSelection()) {
		collapseSelectionTo('end');
		breakUndoSequence();
		return;
	}
	moveCursorVertical(1);
	if (!select) {
		clearSelection();
	}
	breakUndoSequence();
	revealCursor();
}

export function moveCursorHome(select: boolean): void {
	const previousOverride = getCursorVisualOverride(cursorRow, cursorColumn);
	clearCursorVisualOverride();
	const previous: Position = { row: cursorRow, column: cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const ctrlDown = isModifierPressedGlobal(playerIndex, 'ControlLeft') || isModifierPressedGlobal(playerIndex, 'ControlRight');
	if (ctrlDown) {
		cursorRow = 0;
		cursorColumn = 0;
	} else {
		ensureVisualLines();
		const visualIndex = previousOverride?.visualIndex ?? positionToVisualIndex(cursorRow, cursorColumn);
		const segment = visualIndexToSegment(visualIndex);
		if (segment) {
			cursorRow = segment.row;
			const line = lines[segment.row] ?? '';
			cursorColumn = resolveIndentAwareHome(line, segment, cursorColumn);
			setCursorVisualOverride(segment.row, cursorColumn, visualIndex, segment.startColumn);
		} else {
			cursorColumn = 0;
		}
	}
	updateDesiredColumn();
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

export function moveCursorEnd(select: boolean): void {
	const previousOverride = getCursorVisualOverride(cursorRow, cursorColumn);
	clearCursorVisualOverride();
	const previous: Position = { row: cursorRow, column: cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const ctrlDown = isModifierPressedGlobal(playerIndex, 'ControlLeft') || isModifierPressedGlobal(playerIndex, 'ControlRight');
	if (ctrlDown) {
		const lastRow = lines.length - 1;
		if (lastRow < 0) {
			cursorRow = 0;
			cursorColumn = 0;
		} else {
			cursorRow = lastRow;
			cursorColumn = lines[lastRow].length;
		}
	} else {
		ensureVisualLines();
		const visualIndex = previousOverride?.visualIndex ?? positionToVisualIndex(cursorRow, cursorColumn);
		const segment = visualIndexToSegment(visualIndex);
		if (segment) {
			cursorRow = segment.row;
			const line = lines[segment.row] ?? '';
			cursorColumn = resolveSegmentEnd(line, segment);
			setCursorVisualOverride(segment.row, cursorColumn, visualIndex, segment.startColumn);
		} else {
			cursorColumn = currentLine().length;
		}
	}
	updateDesiredColumn();
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

export function pageUp(select: boolean): void {
	const previous: Position = { row: cursorRow, column: cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const rows = visibleRowCount();
	ensureVisualLines();
	const visualCount = getVisualLineCount();
	const currentVisual = positionToVisualIndex(cursorRow, cursorColumn);
	const targetVisual = clamp(currentVisual - rows, 0, Math.max(0, visualCount - 1));
	setCursorFromVisualIndex(targetVisual, desiredColumn, desiredDisplayOffset);
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

export function pageDown(select: boolean): void {
	const previous: Position = { row: cursorRow, column: cursorColumn };
	if (select) {
		ensureSelectionAnchor(previous);
	} else {
		clearSelection();
	}
	const rows = visibleRowCount();
	ensureVisualLines();
	const visualCount = getVisualLineCount();
	const currentVisual = positionToVisualIndex(cursorRow, cursorColumn);
	const targetVisual = clamp(currentVisual + rows, 0, Math.max(0, visualCount - 1));
	setCursorFromVisualIndex(targetVisual, desiredColumn, desiredDisplayOffset);
	resetBlink();
	breakUndoSequence();
	revealCursor();
}

export function resetKeyPressGuards(): void {
	resetKeyPressRecords();
}

export function insertText(text: string): void {
	if (text.length === 0) {
		return;
	}
	const coalesce = text.length === 1;
	prepareUndo('insert-text', coalesce);
	if (deleteSelectionIfPresent()) {
		// Selection replaced.
	}
	const line = currentLine();
	const before = line.slice(0, cursorColumn);
	const after = line.slice(cursorColumn);
	lines[cursorRow] = before + text + after;
	invalidateLine(cursorRow);
	recordEditContext('insert', text);
	cursorColumn += text.length;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	clearSelection();
	revealCursor();
}

export function insertLineBreak(): void {
	const sourceRow = cursorRow;
	prepareUndo('insert-line-break', false);
	deleteSelectionIfPresent();
	const line = currentLine();
	const before = line.slice(0, cursorColumn);
	const after = line.slice(cursorColumn);
	lines[sourceRow] = before;
	const indentation = extractIndentation(before);
	const newLine = indentation + after;
	lines.splice(sourceRow + 1, 0, newLine);
	invalidateLineRange(sourceRow, sourceRow + 1);
	invalidateHighlightsFromRow(sourceRow);
	cursorRow = sourceRow + 1;
	cursorColumn = indentation.length;
	recordEditContext('insert', '\n');
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	clearSelection();
	revealCursor();
}

export function extractIndentation(value: string): string {
	let result = '';
	for (let i = 0; i < value.length; i += 1) {
		const ch = value.charAt(i);
		if (ch === ' ' || ch === '\t') {
			result += ch;
		} else {
			break;
		}
	}
	return result;
}

export function backspace(): void {
	if (!hasSelection() && cursorColumn === 0 && cursorRow === 0) {
		return;
	}
	prepareUndo('backspace', true);
	if (deleteSelectionIfPresent()) {
		return;
	}
	if (cursorColumn > 0) {
		const line = currentLine();
		const removedChar = line.charAt(cursorColumn - 1);
		const before = line.slice(0, cursorColumn - 1);
		const after = line.slice(cursorColumn);
		lines[cursorRow] = before + after;
		invalidateLine(cursorRow);
		cursorColumn -= 1;
		recordEditContext('delete', removedChar);
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	if (cursorRow === 0) {
		return;
	}
	const mergedRow = cursorRow - 1;
	const previousLine = lines[mergedRow];
	const currentLineValue = currentLine();
	recordEditContext('delete', '\n');
	lines[mergedRow] = previousLine + currentLineValue;
	lines.splice(cursorRow, 1);
	invalidateLine(mergedRow);
	invalidateHighlightsFromRow(mergedRow);
	cursorRow = mergedRow;
	cursorColumn = previousLine.length;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function deleteForward(): void {
	if (!hasSelection() && cursorColumn >= currentLine().length && cursorRow >= lines.length - 1) {
		return;
	}
	prepareUndo('delete-forward', true);
	if (deleteSelectionIfPresent()) {
		return;
	}
	const line = currentLine();
	if (cursorColumn < line.length) {
		const removedChar = line.charAt(cursorColumn);
		const before = line.slice(0, cursorColumn);
		const after = line.slice(cursorColumn + 1);
		lines[cursorRow] = before + after;
		invalidateLine(cursorRow);
		recordEditContext('delete', removedChar);
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	if (cursorRow >= lines.length - 1) {
		return;
	}
	const nextLine = lines[cursorRow + 1];
	const updatedLine = line + nextLine;
	lines[cursorRow] = updatedLine;
	lines.splice(cursorRow + 1, 1);
	invalidateLine(cursorRow);
	invalidateHighlightsFromRow(cursorRow);
	recordEditContext('delete', '\n');
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function deleteWordBackward(): void {
	if (!hasSelection() && cursorColumn === 0 && cursorRow === 0) {
		return;
	}
	prepareUndo('delete-word-backward', false);
	if (deleteSelectionIfPresent()) {
		return;
	}
	const target = findWordLeft(cursorRow, cursorColumn);
	if (target.row === cursorRow && target.column === cursorColumn) {
		backspace();
		return;
	}
	const startRow = target.row;
	const startColumn = target.column;
	const endRow = cursorRow;
	const endColumn = cursorColumn;
	if (startRow === endRow) {
		const line = lines[startRow];
		const removed = line.slice(startColumn, endColumn);
		lines[startRow] = line.slice(0, startColumn) + line.slice(endColumn);
		cursorColumn = startColumn;
		invalidateLine(startRow);
		recordEditContext('delete', removed);
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	const firstLine = lines[startRow];
	const lastLine = lines[endRow];
	const removedParts: string[] = [];
	removedParts.push(firstLine.slice(startColumn));
	for (let row = startRow + 1; row < endRow; row += 1) {
		removedParts.push(lines[row]);
	}
	removedParts.push(lastLine.slice(0, endColumn));
	lines[startRow] = firstLine.slice(0, startColumn) + lastLine.slice(endColumn);
	lines.splice(startRow + 1, endRow - startRow);
	cursorRow = startRow;
	cursorColumn = startColumn;
	invalidateLine(startRow);
	invalidateHighlightsFromRow(startRow);
	recordEditContext('delete', removedParts.join('\n'));
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function deleteWordForward(): void {
	if (!hasSelection() && cursorRow >= lines.length - 1 && cursorColumn >= currentLine().length) {
		return;
	}
	prepareUndo('delete-word-forward', false);
	if (deleteSelectionIfPresent()) {
		return;
	}
	const destination = findWordRight(cursorRow, cursorColumn);
	if (destination.row === cursorRow && destination.column === cursorColumn) {
		deleteForward();
		return;
	}
	const startRow = cursorRow;
	const startColumn = cursorColumn;
	const endRow = destination.row;
	const endColumn = destination.column;
	if (startRow === endRow) {
		const line = lines[startRow];
		const removed = line.slice(startColumn, endColumn);
		lines[startRow] = line.slice(0, startColumn) + line.slice(endColumn);
		invalidateLine(startRow);
		recordEditContext('delete', removed);
	} else {
		const firstLine = lines[startRow];
		const lastLine = lines[endRow];
		const removedParts: string[] = [];
		removedParts.push(firstLine.slice(startColumn));
		for (let row = startRow + 1; row < endRow; row += 1) {
			removedParts.push(lines[row]);
		}
		removedParts.push(lastLine.slice(0, endColumn));
		lines[startRow] = firstLine.slice(0, startColumn) + lastLine.slice(endColumn);
		lines.splice(startRow + 1, endRow - startRow);
		invalidateLine(startRow);
		invalidateHighlightsFromRow(startRow);
		recordEditContext('delete', removedParts.join('\n'));
	}
	cursorRow = startRow;
	cursorColumn = startColumn;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function deleteActiveLines(): void {
	if (lines.length === 0) {
		return;
	}
	prepareUndo('delete-active-lines', false);
	const range = getSelectionRange();
	if (!range) {
		const removedRow = cursorRow;
		lines.splice(removedRow, 1);
		if (lines.length === 0) {
			lines = [''];
			cursorRow = 0;
			cursorColumn = 0;
		} else if (cursorRow >= lines.length) {
			cursorRow = lines.length - 1;
			cursorColumn = lines[cursorRow].length;
		} else {
			const line = lines[cursorRow];
			cursorColumn = Math.min(cursorColumn, line.length);
		}
		invalidateLine(cursorRow);
		invalidateHighlightsFromRow(Math.min(removedRow, lines.length - 1));
		recordEditContext('delete', '\n');
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	const { start, end } = range;
	const deletionStart = start.row;
	let deletionEnd = end.row;
	if (end.column === 0 && end.row > start.row) {
		deletionEnd -= 1;
	}
	const count = deletionEnd - deletionStart + 1;
	const deletedLines = lines.slice(deletionStart, deletionStart + count);
	lines.splice(deletionStart, count);
	if (lines.length === 0) {
		lines = [''];
	}
	cursorRow = clamp(deletionStart, 0, lines.length - 1);
	cursorColumn = 0;
	selectionAnchor = null;
	invalidateLine(cursorRow);
	invalidateHighlightsFromRow(deletionStart);
	recordEditContext('delete', deletedLines.join('\n'));
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function moveSelectionLines(delta: number): void {
	if (delta === 0) {
		return;
	}
	const range = getLineRangeForMovement();
	if (delta < 0 && range.startRow === 0) {
		return;
	}
	if (delta > 0 && range.endRow >= lines.length - 1) {
		return;
	}
	prepareUndo('move-lines', false);
	const count = range.endRow - range.startRow + 1;
	const block = lines.splice(range.startRow, count);
	const targetIndex = range.startRow + delta;
	lines.splice(targetIndex, 0, ...block);
	const affectedStart = Math.max(0, Math.min(range.startRow, targetIndex));
	const affectedEnd = Math.min(lines.length - 1, Math.max(range.endRow, targetIndex + count - 1));
	if (affectedStart <= affectedEnd) {
		for (let row = affectedStart; row <= affectedEnd; row += 1) {
			invalidateLine(row);
		}
	}
	invalidateHighlightsFromRow(affectedStart);
	cursorRow += delta;
	if (selectionAnchor) {
		selectionAnchor = { row: selectionAnchor.row + delta, column: selectionAnchor.column };
	}
	clampCursorColumn();
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function getLineRangeForMovement(): { startRow: number; endRow: number } {
	const range = getSelectionRange();
	if (!range) {
		return { startRow: cursorRow, endRow: cursorRow };
	}
	let endRow = range.end.row;
	if (range.end.column === 0 && endRow > range.start.row) {
		endRow -= 1;
	}
	return { startRow: range.start.row, endRow };
}

export function indentSelectionOrLine(): void {
	prepareUndo('indent', false);
	const range = getSelectionRange();
	if (!range) {
		const line = currentLine();
		lines[cursorRow] = '\t' + line;
		cursorColumn += 1;
		invalidateLine(cursorRow);
		recordEditContext('insert', '\t');
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	for (let row = range.start.row; row <= range.end.row; row += 1) {
		lines[row] = '\t' + lines[row];
		invalidateLine(row);
	}
	if (selectionAnchor) {
		selectionAnchor = { row: selectionAnchor.row, column: selectionAnchor.column + 1 };
	}
	cursorColumn += 1;
	recordEditContext('insert', '\t');
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function unindentSelectionOrLine(): void {
	prepareUndo('unindent', false);
	const range = getSelectionRange();
	if (!range) {
		const line = currentLine();
		const indentation = countLeadingIndent(line);
		if (indentation === 0) {
			return;
		}
		const remove = Math.min(indentation, 1);
		lines[cursorRow] = line.slice(remove);
		cursorColumn = Math.max(0, cursorColumn - remove);
		invalidateLine(cursorRow);
		recordEditContext('delete', line.slice(0, remove));
		markTextMutated();
		resetBlink();
		updateDesiredColumn();
		revealCursor();
		return;
	}
	for (let row = range.start.row; row <= range.end.row; row += 1) {
		const line = lines[row];
		const indentation = countLeadingIndent(line);
		if (indentation > 0) {
			lines[row] = line.slice(1);
			invalidateLine(row);
		}
	}
	if (selectionAnchor) {
		selectionAnchor = { row: selectionAnchor.row, column: Math.max(0, selectionAnchor.column - 1) };
	}
	cursorColumn = Math.max(0, cursorColumn - 1);
	recordEditContext('delete', '\t');
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function countLeadingIndent(line: string): number {
	let count = 0;
	while (count < line.length) {
		const ch = line.charAt(count);
		if (ch === '\t' || ch === ' ') {
			count += 1;
		} else {
			break;
		}
	}
	return count;
}

export function deleteSelection(): void {
	if (!hasSelection()) {
		return;
	}
	prepareUndo('delete-selection', false);
	replaceSelectionWith('');
}

export function deleteSelectionIfPresent(): boolean {
	if (!hasSelection()) {
		return false;
	}
	replaceSelectionWith('');
	return true;
}

export function replaceSelectionWith(text: string): void {
	const range = getSelectionRange();
	if (!range) {
		return;
	}
	recordEditContext(text.length === 0 ? 'delete' : 'replace', text);
	const { start, end } = range;
	const startLine = lines[start.row];
	const endLine = lines[end.row];
	const leading = startLine.slice(0, start.column);
	const trailing = endLine.slice(end.column);
	const fragments = text.split('\n');
	if (fragments.length === 1) {
		const combined = leading + fragments[0] + trailing;
		lines.splice(start.row, end.row - start.row + 1, combined);
		cursorRow = start.row;
		cursorColumn = leading.length + fragments[0].length;
	} else {
		const firstLine = leading + fragments[0];
		const lastFragment = fragments[fragments.length - 1];
		const lastLine = lastFragment + trailing;
		const middle = fragments.slice(1, -1);
		lines.splice(start.row, end.row - start.row + 1, firstLine, ...middle, lastLine);
		cursorRow = start.row + fragments.length - 1;
		cursorColumn = lastFragment.length;
	}
	invalidateLineRange(start.row, start.row + fragments.length - 1);
	invalidateHighlightsFromRow(start.row);
	selectionAnchor = null;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function selectWordAtPosition(row: number, column: number): void {
	if (row < 0 || row >= lines.length) {
		return;
	}
	const line = lines[row];
	if (line.length === 0) {
		selectionAnchor = null;
		cursorRow = row;
		cursorColumn = 0;
		updateDesiredColumn();
		resetBlink();
		revealCursor();
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
	selectionAnchor = { row, column: start };
	cursorRow = row;
	cursorColumn = end;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
}

export function getSelectionText(): string | null {
	const range = getSelectionRange();
	if (!range) {
		return null;
	}
	const { start, end } = range;
	if (start.row === end.row) {
		return lines[start.row].slice(start.column, end.column);
	}
	const parts: string[] = [];
	parts.push(lines[start.row].slice(start.column));
	for (let row = start.row + 1; row < end.row; row += 1) {
		parts.push(lines[row]);
	}
	parts.push(lines[end.row].slice(0, end.column));
	return parts.join('\n');
}

export function insertClipboardText(text: string): void {
	const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const fragments = normalized.split('\n');
	const currentLineValue = currentLine();
	const before = currentLineValue.slice(0, cursorColumn);
	const after = currentLineValue.slice(cursorColumn);
	if (fragments.length === 1) {
		const fragment = fragments[0];
		lines[cursorRow] = before + fragment + after;
		invalidateLine(cursorRow);
		cursorColumn = before.length + fragment.length;
		recordEditContext('insert', fragment);
	} else {
		const firstLine = before + fragments[0];
		const lastIndex = fragments.length - 1;
		const lastFragment = fragments[lastIndex];
		const newLines: string[] = [];
		newLines.push(firstLine);
		for (let i = 1; i < lastIndex; i += 1) {
			newLines.push(fragments[i]);
		}
		newLines.push(lastFragment + after);
		const insertionRow = cursorRow;
		lines.splice(insertionRow, 1, ...newLines);
		invalidateLineRange(insertionRow, insertionRow + newLines.length - 1);
		invalidateHighlightsFromRow(insertionRow);
		cursorRow = insertionRow + lastIndex;
		cursorColumn = lastFragment.length;
		recordEditContext('insert', normalized);
	}
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function ensureSelectionAnchor(anchor: Position): void {
	if (!selectionAnchor) {
		selectionAnchor = { row: anchor.row, column: anchor.column };
	}
}

export function setSelectionAnchorPosition(position: Position | null): void {
	if (!position) {
		selectionAnchor = null;
		return;
	}
	selectionAnchor = { row: position.row, column: position.column };
}

export function clearSelection(): void {
	selectionAnchor = null;
}

export function hasSelection(): boolean {
	return getSelectionRange() !== null;
}

export function comparePositions(a: Position, b: Position): number {
	if (a.row !== b.row) {
		return a.row - b.row;
	}
	return a.column - b.column;
}

export function getSelectionRange(): { start: Position; end: Position } | null {
	const anchor = selectionAnchor;
	if (!anchor) {
		return null;
	}
	const cursor: Position = { row: cursorRow, column: cursorColumn };
	if (anchor.row === cursor.row && anchor.column === cursor.column) {
		return null;
	}
	if (comparePositions(cursor, anchor) < 0) {
		return { start: cursor, end: anchor };
	}
	return { start: anchor, end: cursor };
}

export function collapseSelectionTo(target: 'start' | 'end'): void {
	const range = getSelectionRange();
	if (!range) {
		return;
	}
	const destination = target === 'start' ? range.start : range.end;
	cursorRow = destination.row;
	cursorColumn = destination.column;
	selectionAnchor = null;
	updateDesiredColumn();
	resetBlink();
	revealCursor();
}

export function stepLeft(row: number, column: number): { row: number; column: number } | null {
	if (column > 0) {
		return { row, column: column - 1 };
	}
	if (row > 0) {
		return { row: row - 1, column: lines[row - 1].length };
	}
	return null;
}

export function stepRight(row: number, column: number): { row: number; column: number } | null {
	const length = lines[row].length;
	if (column < length) {
		return { row, column: column + 1 };
	}
	if (row < lines.length - 1) {
		return { row: row + 1, column: 0 };
	}
	return null;
}

export function charAt(row: number, column: number): string {
	if (row < 0 || row >= lines.length) {
		return '';
	}
	const line = lines[row];
	if (column < 0 || column >= line.length) {
		return '';
	}
	return line.charAt(column);
}

export function currentLine(): string {
	if (cursorRow < 0 || cursorRow >= lines.length) {
		return '';
	}
	return lines[cursorRow];
}

export function clampCursorRow(): void {
	if (cursorRow < 0) {
		cursorRow = 0;
	} else if (cursorRow >= lines.length) {
		cursorRow = lines.length - 1;
	}
}

export function clampCursorColumn(): void {
	const line = currentLine();
	if (cursorColumn < 0) {
		cursorColumn = 0;
		return;
	}
	const length = line.length;
	if (cursorColumn > length) {
		cursorColumn = length;
	}
}

export function clampSelectionPosition(position: Position | null): Position | null {
	if (!position || lines.length === 0) {
		return null;
	}
	let row = position.row;
	if (row < 0) {
		row = 0;
	} else if (row >= lines.length) {
		row = lines.length - 1;
	}
	const line = lines[row] ?? '';
	let column = position.column;
	if (column < 0) {
		column = 0;
	} else if (column > line.length) {
		column = line.length;
	}
	return { row, column };
}

export function prepareUndo(key: string, allowMerge: boolean): void {
	const now = Date.now();
	const shouldMerge = allowMerge
		&& lastHistoryKey === key
		&& now - lastHistoryTimestamp <= constants.UNDO_COALESCE_INTERVAL_MS;
	if (shouldMerge) {
		lastHistoryTimestamp = now;
		return;
	}
	const snapshot = captureSnapshot();
	if (undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		undoStack.shift();
	}
	undoStack.push(snapshot);
	redoStack.length = 0;
	lastHistoryTimestamp = now;
	if (allowMerge) {
		lastHistoryKey = key;
	} else {
		lastHistoryKey = null;
	}
}

export function undo(): void {
	if (undoStack.length === 0) {
		return;
	}
	const snapshot = undoStack.pop();
	if (!snapshot) {
		return;
	}
	const current = captureSnapshot();
	if (redoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		redoStack.shift();
	}
	redoStack.push(current);
	restoreSnapshot(snapshot, true);
	breakUndoSequence();
}

export function redo(): void {
	if (redoStack.length === 0) {
		return;
	}
	const snapshot = redoStack.pop();
	if (!snapshot) {
		return;
	}
	const current = captureSnapshot();
	if (undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		undoStack.shift();
	}
	undoStack.push(current);
	restoreSnapshot(snapshot, true);
	breakUndoSequence();
}

export function breakUndoSequence(): void {
	lastHistoryKey = null;
	lastHistoryTimestamp = 0;
}

export function extractIdentifierAt(row: number, column: number): string | null {
	if (row < 0 || row >= lines.length) {
		return null;
	}
	const line = lines[row];
	if (column < 0 || column > line.length) {
		return null;
	}
	let start = column;
	let end = column;
	while (start > 0) {
		const previous = line.charCodeAt(start - 1);
		if (!isIdentifierChar(previous)) {
			break;
		}
		start -= 1;
	}
	while (end < line.length) {
		const next = line.charCodeAt(end);
		if (!isIdentifierChar(next)) {
			break;
		}
		end += 1;
	}
	const identifier = line.slice(start, end);
	if (!identifier || !isIdentifierStartChar(identifier.charCodeAt(0))) {
		return null;
	}
	return identifier;
}

export function clampScrollRow(): void {
	ensureVisualLines();
	const rows = visibleRowCount();
	const totalVisual = getVisualLineCount();
	const cursorVisualIndex = positionToVisualIndex(cursorRow, cursorColumn);
	if (cursorVisualIndex < scrollRow) {
		scrollRow = cursorVisualIndex;
	}
	if (cursorVisualIndex >= scrollRow + rows) {
		scrollRow = cursorVisualIndex - rows + 1;
	}
	const maxScrollRow = Math.max(0, totalVisual - rows);
	scrollRow = clamp(scrollRow, 0, maxScrollRow);
}

export function clampScrollColumn(): void {
	if (wordWrapEnabled) {
		scrollColumn = 0;
		return;
	}
	const columns = visibleColumnCount();
	if (cursorColumn < scrollColumn) {
		scrollColumn = cursorColumn;
	}
	const maxScrollColumn = cursorColumn - columns + 1;
	if (maxScrollColumn > scrollColumn) {
		scrollColumn = maxScrollColumn;
	}
	if (scrollColumn < 0) {
		scrollColumn = 0;
	}
	const lineLength = currentLine().length;
	const maxColumn = lineLength - columns;
	if (maxColumn < 0) {
		scrollColumn = 0;
	} else if (scrollColumn > maxColumn) {
		scrollColumn = maxColumn;
	}
}

function activeSearchMatchCount(): number {
	return searchScope === 'global' ? globalSearchMatches.length : searchMatches.length;
}

function searchPageSize(): number {
	return constants.SEARCH_MAX_RESULTS;
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

export function installPlatformVisibilityListener(): void {
	disposeVisibilityListener?.();
	disposeVisibilityListener = $.platform.lifecycle.onVisibilityChange((visible) => {
		requestWindowFocusState(!!visible, true);
	});
}

export function installWindowEventListeners(): void {
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
		requestWindowFocusState(false, true);
	}));
	disposers.push(windowEvents.subscribe('focus', () => {
		requestWindowFocusState(true, true);
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

export function resetInputFocusState(keyboard: KeyboardInput | null): void {
	if (keyboard) {
		keyboard.reset();
	}
	input.resetRepeats();
	resetKeyPressGuards();
	repeatState.clear();
	toggleInputLatch = false;
}

export function requestWindowFocusState(hasFocus: boolean, immediate: boolean): void {
	pendingWindowFocused = hasFocus;
	if (immediate) {
		flushWindowFocusState();
	}
}

export function flushWindowFocusState(keyboard?: KeyboardInput): void {
	if (pendingWindowFocused === windowFocused) {
		return;
	}
	windowFocused = pendingWindowFocused;
	const effectiveKeyboard = keyboard ?? getKeyboard();
	resetInputFocusState(effectiveKeyboard);
}

export function scheduleNextFrame(task: () => void): void {
	if (typeof queueMicrotask === 'function') {
		queueMicrotask(task);
		return;
	}
	void Promise.resolve().then(task);
}

export function drawHoverTooltip(api: BmsxConsoleApi, codeTop: number, codeBottom: number, textLeft: number): void {
	const tooltip = hoverTooltip;
	if (!tooltip) {
		return;
	}
	const content = tooltip.contentLines;
	if (!content || content.length === 0) {
		tooltip.bubbleBounds = null;
		return;
	}
	const visibleRows = visibleRowCount();
	ensureVisualLines();
	const visualIndex = positionToVisualIndex(tooltip.row, tooltip.startColumn);
	const relativeRow = visualIndex - scrollRow;
	if (relativeRow < 0 || relativeRow >= visibleRows) {
		tooltip.bubbleBounds = null;
		return;
	}
	const rowTop = codeTop + relativeRow * lineHeight;
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		tooltip.bubbleBounds = null;
		return;
	}
	const entry = getCachedHighlight(segment.row);
	const highlight = entry.hi;
	let columnStart = wordWrapEnabled ? segment.startColumn : scrollColumn;
	if (wordWrapEnabled) {
		if (columnStart < segment.startColumn || columnStart > segment.endColumn) {
			columnStart = segment.startColumn;
		}
	}
	const columnCount = wordWrapEnabled
		? Math.max(0, segment.endColumn - columnStart)
		: visibleColumnCount() + 8;
	const slice = sliceHighlightedLine(highlight, columnStart, columnCount);
	const sliceStartDisplay = slice.startDisplay;
	const sliceEndLimit = wordWrapEnabled ? columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
	const sliceEndDisplay = wordWrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
	const startDisplay = columnToDisplay(highlight, tooltip.startColumn);
	const endDisplay = columnToDisplay(highlight, tooltip.endColumn);
	const clampedStartDisplay = clamp(startDisplay, sliceStartDisplay, sliceEndDisplay);
	const clampedEndDisplay = clamp(endDisplay, clampedStartDisplay, sliceEndDisplay);
	const expressionStartX = textLeft + measureRangeFast(entry, sliceStartDisplay, clampedStartDisplay);
	const expressionEndX = textLeft + measureRangeFast(entry, sliceStartDisplay, clampedEndDisplay);
	const maxVisible = Math.max(1, Math.min(constants.HOVER_TOOLTIP_MAX_VISIBLE_LINES, content.length));
	const maxOffset = Math.max(0, content.length - maxVisible);
	tooltip.scrollOffset = clamp(tooltip.scrollOffset, 0, maxOffset);
	const visibleCount = Math.max(1, Math.min(maxVisible, content.length - tooltip.scrollOffset));
	tooltip.visibleLineCount = visibleCount;
	const visibleLines = content.slice(tooltip.scrollOffset, tooltip.scrollOffset + visibleCount);
	let maxLineWidth = 0;
	for (const line of visibleLines) {
		const width = measureText(line);
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

export function showRuntimeErrorInChunk(
	chunkName: string | null,
	line: number | null,
	column: number | null,
	message: string,
	hint?: { assetId: string | null; path?: string | null },
	details?: RuntimeErrorDetails | null
): void {
	focusChunkSource(chunkName, hint);
	const overlayMessage = chunkName && chunkName.length > 0 ? `${chunkName}: ${message}` : message;
	showRuntimeError(line, column, overlayMessage, details ?? null);
}

export function showRuntimeError(line: number | null, column: number | null, message: string, details?: RuntimeErrorDetails | null): void {
	if (!active) {
		activate();
	}
	const hasLocation = typeof line === 'number' && Number.isFinite(line) && line >= 1;
	const processedLine = hasLocation ? Math.max(1, Math.floor(line!)) : null;
	const processedColumn = typeof column === 'number' && Number.isFinite(column) ? Math.floor(column!) - 1 : null;
	let targetRow = cursorRow;
	if (processedLine !== null) {
		targetRow = clamp(processedLine - 1, 0, lines.length - 1);
		cursorRow = targetRow;
	}
	const currentLine = lines[targetRow] ?? '';
	let targetColumn = cursorColumn;
	if (processedColumn !== null) {
		targetColumn = clamp(processedColumn, 0, currentLine.length);
		cursorColumn = targetColumn;
	}
	clampCursorColumn();
	targetColumn = cursorColumn;
	selectionAnchor = null;
	pointerSelecting = false;
	pointerPrimaryWasPressed = false;
	scrollbarController.cancel();
	cursorRevealSuspended = false;
	centerCursorVertically();
	updateDesiredColumn();
	revealCursor();
	resetBlink();
	const normalizedMessage = message && message.length > 0 ? message.trim() : 'Runtime error';
	const overlayMessage = processedLine !== null ? `Line ${processedLine}:${normalizedMessage}` : normalizedMessage;
	const messageLines = buildRuntimeErrorLines(overlayMessage);
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
	setActiveRuntimeErrorOverlay(overlay);
	setExecutionStopHighlight(processedLine !== null ? targetRow : null);
	const statusLine = overlay.lines.length > 0 ? overlay.lines[0] : 'Runtime error';
	showMessage(statusLine, constants.COLOR_STATUS_ERROR, 8.0);
}

export function focusChunkSource(chunkName: string | null, hint?: { assetId: string | null; path?: string | null }): void {
	if (!active) {
		activate();
	}
	closeSymbolSearch(true);
	if (hint && typeof hint.assetId === 'string' && hint.assetId.length > 0) {
		const preferredPath = (typeof hint.path === 'string' && hint.path.length > 0) ? hint.path : null;
		focusResourceByAsset(hint.assetId, preferredPath);
		return;
	}
	if (hint && hint.assetId === null) {
		activateCodeTab();
		return;
	}
	const normalizedChunk = normalizeChunkName(chunkName);
	const descriptor = findResourceDescriptorForChunk(normalizedChunk);
	openResourceDescriptor(descriptor);
}

export function focusResourceByAsset(assetId: string, preferredPath?: string | null): void {
	if (typeof assetId !== 'string' || assetId.length === 0) {
		throw new Error('[ConsoleCartEditor] Invalid asset id for runtime error highlight.');
	}
	const descriptors = listResourcesStrict();
	const match = descriptors.find(entry => entry.assetId === assetId);
	const normalizedPreferred = normalizeResourcePath(preferredPath);
	if (match) {
		const effectivePath = normalizedPreferred ? normalizedPreferred : match.path;
		openResourceDescriptor({ ...match, path: effectivePath });
		return;
	}
	if (!normalizedPreferred) {
		throw new Error(`[ConsoleCartEditor] No resource found for asset '${assetId}'.`);
	}
	openResourceDescriptor({ path: normalizedPreferred, type: 'lua', assetId });
}

export function normalizeChunkName(name: string | null): string {
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

export function normalizeResourcePath(path?: string | null): string | undefined {
	if (path === null || path === undefined) {
		return undefined;
	}
	const normalized = path.replace(/\\/g, '/');
	return normalized.length > 0 ? normalized : undefined;
}

export function findCodeTabContext(assetId: string | null, chunkName: string | null): CodeTabContext | null {
	const normalizedChunk = normalizeChunkReference(chunkName);
	for (const context of codeTabContexts.values()) {
		const descriptor = context.descriptor;
		if (assetId && descriptor && descriptor.assetId === assetId) {
			return context;
		}
		if (!assetId && normalizedChunk && descriptor) {
			const descriptorPath = normalizeChunkReference(descriptor.path);
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
	const entryPath = normalizeChunkReference(entryDescriptor.path);
	if (entryPath && entryPath === normalizedChunk) {
		return entryContext;
	}
	return null;
}

export function normalizeChunkReference(reference: string | null): string | null {
	if (!reference) {
		return null;
	}
	let normalized = reference;
	if (normalized.startsWith('@')) {
		normalized = normalized.slice(1);
	}
	return normalized.replace(/\\/g, '/');
}

export function resolveResourceDescriptorForSource(assetId: string | null, chunkName: string | null): ConsoleResourceDescriptor | null {
	if (typeof assetId === 'string' && assetId.length > 0) {
		const byAsset = findResourceDescriptorByAssetId(assetId);
		if (byAsset) {
			return byAsset;
		}
	}
	const normalizedChunk = normalizeChunkReference(chunkName);
	if (!normalizedChunk) {
		return null;
	}
	try {
		return findResourceDescriptorForChunk(normalizedChunk);
	} catch {
		return null;
	}
}


export function listResourcesStrict(): ConsoleResourceDescriptor[] {
	const descriptors = listResourcesFn();
	if (!Array.isArray(descriptors)) {
		throw new Error('[ConsoleCartEditor] Resource enumeration returned an invalid result.');
	}
	return descriptors;
}

export function findResourceDescriptorByAssetId(assetId: string): ConsoleResourceDescriptor | null {
	const descriptors = listResourcesStrict();
	const match = descriptors.find(entry => entry.assetId === assetId);
	return match ?? null;
}

export function findResourceDescriptorForChunk(chunkPath: string): ConsoleResourceDescriptor {
	const descriptors = listResourcesStrict();
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

export function openResourceDescriptor(descriptor: ConsoleResourceDescriptor): void {
	selectResourceInPanel(descriptor);
	if (descriptor.type === 'atlas') {
		showMessage('Atlas resources cannot be previewed in the console editor.', constants.COLOR_STATUS_WARNING, 3.2);
		focusEditorFromResourcePanel();
		return;
	}
	if (descriptor.type === 'lua') {
		openLuaCodeTab(descriptor);
	} else {
		openResourceViewerTab(descriptor);
	}
	focusEditorFromResourcePanel();
}

export function clearRuntimeErrorOverlay(): void {
	setActiveRuntimeErrorOverlay(null);
}

// Clear overlays and stop highlights across all open code tabs, not just the
// currently active one. Useful when resuming after a runtime error where the
// editor may have switched tabs to the faulting chunk.
export function clearAllRuntimeErrorOverlays(): void {
	runtimeErrorOverlay = null;
	for (const context of codeTabContexts.values()) {
		context.runtimeErrorOverlay = null;
	}
	clearExecutionStopHighlights();
}

export function setActiveRuntimeErrorOverlay(overlay: RuntimeErrorOverlay | null): void {
	runtimeErrorOverlay = overlay;
	const context = getActiveCodeTabContext();
	if (context) {
		context.runtimeErrorOverlay = overlay;
	}
}

export function setExecutionStopHighlight(row: number | null): void {
	const context = getActiveCodeTabContext();
	if (!context) {
		executionStopRow = null;
		return;
	}
	let nextRow = row;
	if (nextRow !== null) {
		const maxRow = Math.max(0, lines.length - 1);
		nextRow = clamp(nextRow, 0, maxRow);
	}
	context.executionStopRow = nextRow;
	executionStopRow = nextRow;
}

export function clearExecutionStopHighlights(): void {
	executionStopRow = null;
	for (const context of codeTabContexts.values()) {
		context.executionStopRow = null;
	}
}

export function syncRuntimeErrorOverlayFromContext(context: CodeTabContext | null): void {
	runtimeErrorOverlay = context ? context.runtimeErrorOverlay ?? null : null;
	executionStopRow = context ? context.executionStopRow ?? null : null;
}

export function getBuiltinIdentifierSet(): ReadonlySet<string> {
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

export function buildRuntimeErrorLines(message: string): string[] {
	const maxWidth = computeRuntimeErrorOverlayMaxWidth(viewportWidth, charAdvance, gutterWidth);
	return buildRuntimeErrorLinesUtil(message, maxWidth, (text) => measureText(text));
}

export function getTabBarTotalHeight(): number {
	return tabBarHeight * Math.max(1, tabBarRowCount);
}

export function topMargin(): number {
	return headerHeight + getTabBarTotalHeight() + 2;
}

export function statusAreaHeight(): number {
	if (!message.visible) {
		return baseBottomMargin;
	}
	const segments = getStatusMessageLines();
	const lineCount = Math.max(1, segments.length);
	return baseBottomMargin + lineCount * lineHeight + 4;
}

export function bottomMargin(): number {
	return statusAreaHeight() + getVisibleProblemsPanelHeight();
}

export function getVisibleProblemsPanelHeight(): number {
	if (!problemsPanel.isVisible()) {
		return 0;
	}
	const planned = problemsPanel.getVisibleHeight();
	if (planned <= 0) {
		return 0;
	}
	const statusHeight = statusAreaHeight();
	const maxAvailable = Math.max(0, viewportHeight - statusHeight - (headerHeight + getTabBarTotalHeight()));
	if (maxAvailable <= 0) {
		return 0;
	}
	return Math.min(planned, maxAvailable);
}

export function getStatusMessageLines(): string[] {
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
		const wrapped = wrapRuntimeErrorLineUtil(rawLines[i], maxWidth, (text) => measureText(text));
		for (let j = 0; j < wrapped.length; j += 1) {
			lines.push(wrapped[j]);
		}
	}
	return lines.length > 0 ? lines : [''];
}

export function tryShowLuaErrorOverlay(error: unknown): boolean {
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
			showMessage(messageText, constants.COLOR_STATUS_ERROR, 4.0);
			return true;
		}
		return false;
	}
	const safeLine = hasLine ? Math.max(1, Math.floor(rawLine!)) : 0;
	const safeColumn = hasColumn ? Math.max(1, Math.floor(rawColumn!)) : 0;
	const baseMessage = messageText ?? 'Lua error';
	showRuntimeErrorInChunk(chunkName, safeLine, safeColumn, baseMessage);
	return true;
}

export function safeInspectLuaExpression(request: ConsoleLuaHoverRequest): ConsoleLuaHoverResult | null {
	inspectorRequestFailed = false;
	try {
		return inspectLuaExpressionFn(request);
	} catch (error) {
		inspectorRequestFailed = true;
		const handled = tryShowLuaErrorOverlay(error);
		if (!handled) {
			const message = error instanceof Error ? error.message : String(error);
			showMessage(message, constants.COLOR_STATUS_ERROR, 3.2);
		}
		return null;
	}
}

export function update(deltaSeconds: number): void {
	refreshViewportDimensions();
	const keyboard = getKeyboard();
	flushWindowFocusState(keyboard);
	updateMessage(deltaSeconds);
	updateRuntimeErrorOverlay(deltaSeconds);
	if (handleToggleRequest(keyboard)) {
		return;
	}
	if (!active) {
		return;
	}
	updateBlink(deltaSeconds);
	handlePointerWheel();
	handlePointerInput(deltaSeconds);
	if (pendingActionPrompt) {
		handleActionPromptInput(keyboard);
		return;
	}
	handleEditorInput(keyboard, deltaSeconds);
	completion.processPending(deltaSeconds);
	const semanticError = layout.getLastSemanticError();
	if (semanticError && semanticError !== lastReportedSemanticError) {
		showMessage(semanticError, constants.COLOR_STATUS_ERROR, 4.0);
		lastReportedSemanticError = semanticError;
	} else if (!semanticError && lastReportedSemanticError !== null) {
		lastReportedSemanticError = null;
	}
	if (diagnosticsDirty) {
		processDiagnosticsQueue(clockNow());
	}
	if (isCodeTabActive() && !cursorRevealSuspended) {
		ensureCursorVisible();
	}
}

export function processDiagnosticsQueue(now: number): void {
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
	scheduleDiagnosticsComputation();
}

export function scheduleDiagnosticsComputation(): void {
	if (diagnosticsComputationScheduled) {
		return;
	}
	diagnosticsComputationScheduled = true;
	scheduleNextFrame(() => {
		diagnosticsComputationScheduled = false;
		executeDiagnosticsComputation();
	});
}

export function executeDiagnosticsComputation(): void {
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
		scheduleDiagnosticsComputation();
		return;
	}
	if (now < diagnosticsDueAtMs) {
		scheduleDiagnosticsComputation();
		return;
	}
	const batch = collectDiagnosticsBatch();
	if (batch.length === 0) {
		diagnosticsDirty = false;
		diagnosticsDueAtMs = null;
		return;
	}
	enqueueDiagnosticsJob(batch);
}

export function enqueueDiagnosticsJob(contextIds: readonly string[]): void {
	if (contextIds.length === 0) {
		return;
	}
	diagnosticsTaskPending = true;
	const batch = [...contextIds];
	enqueueBackgroundTask(() => {
		runDiagnosticsForContexts(batch);
		diagnosticsTaskPending = false;
		if (dirtyDiagnosticContexts.size === 0) {
			diagnosticsDirty = false;
			diagnosticsDueAtMs = null;
		} else {
			const now = clockNow();
			diagnosticsDueAtMs = now + diagnosticsDebounceMs;
			scheduleDiagnosticsComputation();
		}
		return false;
	});
}

export function collectDiagnosticsBatch(): string[] {
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

export function runDiagnosticsForContexts(contextIds: readonly string[]): void {
	if (contextIds.length === 0) {
		return;
	}
	const providers = createDiagnosticProviders();
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
		const assetId = resolveHoverAssetId(context);
		const chunkName = resolveHoverChunkName(context);
		let source = '';
		if (activeId && contextId === activeId) {
			source = lines.join('\n');
		} else {
			try {
				source = getSourceForChunk(assetId, chunkName);
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
		updateDiagnosticsAggregates();
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
	updateDiagnosticsAggregates();
}

export function createDiagnosticProviders(): DiagnosticProviders {
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

export function updateDiagnosticsAggregates(): void {
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
	refreshActiveDiagnostics();
	problemsPanel.setDiagnostics(diagnostics);
}

export function refreshActiveDiagnostics(): void {
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

export function markDiagnosticsDirtyForChunk(chunkName: string): void {
	const context = findContextByChunk(chunkName);
	if (!context) {
		return;
	}
	markDiagnosticsDirty(context.id);
}

export function getActiveSemanticDefinitions(): readonly LuaDefinitionInfo[] | null {
	const context = getActiveCodeTabContext();
	const chunkName = resolveHoverChunkName(context) ?? '<console>';
	return layout.getSemanticDefinitions(lines, textVersion, chunkName);
}

export function getLuaModuleAliases(chunkName: string | null): Map<string, string> {
	const activeContext = getActiveCodeTabContext();
	const targetChunk = chunkName ?? resolveHoverChunkName(activeContext) ?? '<console>';
	layout.getSemanticDefinitions(lines, textVersion, targetChunk);
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

export function findContextByChunk(chunkName: string): CodeTabContext | null {
	const normalized = normalizeChunkReference(chunkName) ?? chunkName;
	for (const context of codeTabContexts.values()) {
		const descriptor = context.descriptor;
		if (descriptor) {
			const descriptorPath = normalizeChunkReference(descriptor.path);
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

export function getDiagnosticsForRow(row: number): readonly EditorDiagnostic[] {
	const bucket = diagnosticsByRow.get(row);
	return bucket ?? EMPTY_DIAGNOSTICS;
}

export function isActive(): boolean {
	return active;
}

export function draw(api: BmsxConsoleApi): void {
	refreshViewportDimensions();
	if (!active) {
		return;
	}
	codeVerticalScrollbarVisible = false;
	codeHorizontalScrollbarVisible = false;
	const frameColor = Msx1Colors[constants.COLOR_FRAME];
	api.rectfill_color(0, 0, viewportWidth, viewportHeight, { r: frameColor.r, g: frameColor.g, b: frameColor.b, a: frameColor.a });
	drawTopBar(api);
	tabBarRowCount = renderTabBar(api, {
		viewportWidth: viewportWidth,
		headerHeight: headerHeight,
		rowHeight: tabBarHeight,
		lineHeight: lineHeight,
		tabs: tabs,
		activeTabId: activeTabId,
		tabHoverId: tabHoverId,
		measureText: (text: string) => measureText(text),
		drawText: (api2, text, x, y, color) => drawEditorText(api2, font, text, x, y, color),
		getDirtyMarkerMetrics: () => getTabDirtyMarkerMetrics(),
		tabButtonBounds: tabButtonBounds,
		tabCloseButtonBounds: tabCloseButtonBounds,
	});
	drawResourcePanel(api);
	if (isResourceViewActive()) {
		drawResourceViewer(api);
	} else {
		hideResourceViewerSprite(api);
		drawCreateResourceBar(api);
		drawSearchBar(api);
		drawResourceSearchBar(api);
		drawSymbolSearchBar(api);
		drawRenameBar(api);
		drawLineJumpBar(api);
		drawCodeArea(api);
	}
	drawProblemsPanel(api);
	drawStatusBar(api);
	if (pendingActionPrompt) {
		drawActionPromptOverlay(api);
	}
}

export function getSourceForChunk(assetId: string | null, chunkName: string | null): string {
	const context = findCodeTabContext(assetId, chunkName);
	if (context) {
		if (context.id === activeCodeTabContextId) {
			return lines.join('\n');
		}
		if (context.snapshot) {
			return context.snapshot.lines.join('\n');
		}
		if (context.lastSavedSource.length > 0) {
			return context.lastSavedSource;
		}
		return context.load();
	}
	const descriptor = resolveResourceDescriptorForSource(assetId, chunkName);
	if (descriptor) {
		return loadLuaResourceFn(descriptor.assetId);
	}
	throw new Error(`[ConsoleCartEditor] Unable to locate source for asset '${assetId ?? '<null>'}' and chunk '${chunkName ?? '<null>'}'.`);
}

export function getTabDirtyMarkerMetrics(): { width: number; height: number } {
	return { width: 4, height: 4 };
}

export function refreshViewportDimensions(force = false): void {
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
	invalidateVisualLines();
	if (resourcePanelWidthRatio !== null) {
		resourcePanelWidthRatio = clampResourcePanelRatio(resourcePanelWidthRatio);
		if (resourcePanelVisible && computePanelPixelWidth(resourcePanelWidthRatio) <= 0) {
			hideResourcePanel();
		}
	}
	if (resourcePanelVisible) {
		resourceBrowserEnsureSelectionVisible();
	}
}

export function initializeTabs(entryContext: CodeTabContext | null = null): void {
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

export function setTabDirty(tabId: string, dirty: boolean): void {
	const tab = tabs.find(candidate => candidate.id === tabId);
	if (!tab) {
		return;
	}
	tab.dirty = dirty;
}

export function updateActiveContextDirtyFlag(): void {
	const context = getActiveCodeTabContext();
	if (!context) {
		return;
	}
	context.dirty = dirty;
	setTabDirty(context.id, context.dirty);
}

export function getActiveTabKind(): EditorTabKind {
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

export function getActiveResourceViewer(): ResourceViewerState | null {
	const tab = tabs.find(candidate => candidate.id === activeTabId);
	if (!tab) {
		return null;
	}
	if (tab.kind !== 'resource_view' || !tab.resource) {
		return null;
	}
	return tab.resource;
}

export function serializeState(): ConsoleEditorSerializedState { // NOTE: UNUSED AS WE DON'T SAVE EDITOR STATE ANYMORE
	const snapshot = captureSnapshot();
	const messageSnapshot: MessageState = {
		text: message.text,
		color: message.color,
		timer: message.timer,
		visible: message.visible,
	};
	return {
		active: active,
		activeTab: getActiveTabKind(),
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

export function restoreState(state: ConsoleEditorSerializedState): void { // NOTE: UNUSED AS WE DON'T SAVE EDITOR STATE ANYMORE
	if (!state) return;
	input.applyOverrides(false, captureKeys);
	$.input.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
	codeTabContexts.clear();
	const entryContext = createEntryTabContext();
	if (entryContext) {
		entryTabId = entryContext.id;
		codeTabContexts.set(entryContext.id, entryContext);
		activeCodeTabContextId = entryContext.id;
	}
	else {
		activeCodeTabContextId = null;
	}
	initializeTabs(entryContext);
	resetResourcePanelState();
	hideResourcePanel();
	active = state.active;
	const restoredKind = state.activeTab ?? 'lua_editor';
	if (restoredKind === 'resource_view') {
		const activeResourceTab = tabs.find(tab => tab.kind === 'resource_view');
		if (activeResourceTab) {
			setActiveTab(activeResourceTab.id);
		}
	} else {
		activateCodeTab();
	}
	if (active) {
		input.applyOverrides(true, captureKeys);
	}
	restoreSnapshot(state.snapshot);
	applySearchFieldText(state.searchQuery, true);
	searchScope = 'local';
	searchDisplayOffset = 0;
	searchHoverIndex = -1;
	globalSearchMatches = [];
	searchMatches = state.searchMatches.map(match => ({ row: match.row, start: match.start, end: match.end }));
	searchCurrentIndex = state.searchCurrentIndex;
	searchActive = state.searchActive;
	searchVisible = state.searchVisible;
	applyLineJumpFieldText(state.lineJumpValue, true);
	lineJumpActive = state.lineJumpActive;
	lineJumpVisible = state.lineJumpVisible;
	message.text = state.message.text;
	message.color = state.message.color;
	message.timer = state.message.timer;
	message.visible = state.message.visible;
	setActiveRuntimeErrorOverlay(null);
	pointerSelecting = false;
	pointerPrimaryWasPressed = false;
	clearGotoHoverHighlight();
	cursorRevealSuspended = false;
	repeatState.clear();
	resetKeyPressGuards();
	breakUndoSequence();
	saveGeneration = Number.isFinite(state.saveGeneration) ? Math.max(0, Math.floor(state.saveGeneration)) : 0;
	appliedGeneration = Number.isFinite(state.appliedGeneration) ? Math.max(0, Math.floor(state.appliedGeneration)) : 0;
	resetActionPromptState();
	const activeContext = getActiveCodeTabContext();
	const entryContextRef = entryTabId ? codeTabContexts.get(entryTabId) ?? null : null;
	if (activeContext) {
		activeContext.lastSavedSource = lines.join('\n');
		activeContext.dirty = dirty;
		setTabDirty(activeContext.id, activeContext.dirty);
	}
	if (entryContextRef) {
		if (activeContext && activeContext.id === entryContextRef.id) {
			entryContextRef.lastSavedSource = lines.join('\n');
		}
		lastSavedSource = entryContextRef.lastSavedSource;
	} else {
		lastSavedSource = '';
	}
}

export function shutdown(): void {
	clearExecutionStopHighlights();
	storeActiveCodeTabContext();
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
	resetKeyPressGuards();
	pointerSelecting = false;
	pointerPrimaryWasPressed = false;
	pointerAuxWasPressed = false;
	clearGotoHoverHighlight();
	cursorRevealSuspended = false;
	searchActive = false;
	searchVisible = false;
	cancelSearchJob();
	cancelGlobalSearchJob();
	searchMatches = [];
	globalSearchMatches = [];
	searchDisplayOffset = 0;
	searchHoverIndex = -1;
	searchScope = 'local';
	searchCurrentIndex = -1;
	applySearchFieldText('', true);
	lineJumpActive = false;
	lineJumpVisible = false;
	applyLineJumpFieldText('', true);
	createResourceActive = false;
	createResourceVisible = false;
	applyCreateResourceFieldText('', true);
	createResourceError = null;
	createResourceWorking = false;
	resetActionPromptState();
	hideResourcePanel();
	activateCodeTab();
}

export function getKeyboard(): KeyboardInput {
	const playerInput = $.input.getPlayerInput(playerIndex);
	if (!playerInput) {
		throw new Error(`[ConsoleCartEditor] Player input ${playerIndex} unavailable.`);
	}
	const handler = playerInput.inputHandlers['keyboard'];
	if (!handler) {
		throw new Error(`[ConsoleCartEditor] Keyboard handler missing for player ${playerIndex}.`);
	}
	const candidate = handler as KeyboardInput;
	if (typeof candidate.keydown !== 'function') {
		throw new Error(`[ConsoleCartEditor] Keyboard handler for player ${playerIndex} is invalid.`);
	}
	return candidate;
}

export function handleToggleRequest(keyboard: KeyboardInput): boolean {
	const escapeState = getKeyboardButtonState(playerIndex, ESCAPE_KEY);
	if (escapeState && escapeState.pressed === true) {
		if (shouldAcceptKeyPressGlobal(ESCAPE_KEY, escapeState)) {
			const handled = handleEscapeKey();
			if (handled) {
				consumeKeyboardKey(keyboard, ESCAPE_KEY);
				return true;
			}
		}
	}

	const toggleKeyState = getKeyboardButtonState(playerIndex, EDITOR_TOGGLE_KEY);
	const selectButton = EDITOR_TOGGLE_GAMEPAD_BUTTONS[0];
	const startButton = EDITOR_TOGGLE_GAMEPAD_BUTTONS[1];
	const playerInput = $.input.getPlayerInput(playerIndex);
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
	const intercepted = handleEscapeKey();
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
		if (dirty) {
			openActionPrompt('close');
		} else {
			deactivate();
		}
	} else {
		activate();
	}
	return true;
}

export function handleEscapeKey(): boolean {
	if (pendingActionPrompt) {
		resetActionPromptState();
		return true;
	}
	if (runtimeErrorOverlay) {
		clearRuntimeErrorOverlay();
		message.visible = false;
		return true;
	}
	if (createResourceVisible) {
		closeCreateResourcePrompt(true);
		return true;
	}
	if (symbolSearchActive || symbolSearchVisible) {
		closeSymbolSearch(false);
		return true;
	}
	if (resourceSearchActive || resourceSearchVisible) {
		closeResourceSearch(false);
		return true;
	}
	if (lineJumpActive || lineJumpVisible) {
		closeLineJump(false);
		return true;
	}
	if (searchActive || searchVisible) {
		closeSearch(false, true);
		return true;
	}
	return false;
}

export function activate(): void {
	if (!disposeVisibilityListener) {
		installPlatformVisibilityListener();
	}
	if (!disposeWindowEventListeners) {
		installWindowEventListeners();
	}
	input.applyOverrides(true, captureKeys);
	applyResolutionModeToRuntime();
	if (activeCodeTabContextId) {
		const existingTab = tabs.find(candidate => candidate.id === activeCodeTabContextId);
		if (existingTab) {
			setActiveTab(activeCodeTabContextId);
		} else {
			activateCodeTab();
		}
	} else {
		activateCodeTab();
	}
	bumpTextVersion();
	cursorVisible = true;
	blinkTimer = 0;
	active = true;
	pointerSelecting = false;
	pointerPrimaryWasPressed = false;
	cursorRevealSuspended = false;
	repeatState.clear();
	resetKeyPressGuards();
	updateDesiredColumn();
	selectionAnchor = null;
	undoStack = [];
	redoStack = [];
	lastHistoryKey = null;
	lastHistoryTimestamp = 0;
	searchActive = false;
	searchVisible = false;
	lineJumpActive = false;
	lineJumpVisible = false;
	lineJumpValue = '';
	syncRuntimeErrorOverlayFromContext(getActiveCodeTabContext());
	resetActionPromptState();
	cancelSearchJob();
	cancelGlobalSearchJob();
	globalSearchMatches = [];
	searchDisplayOffset = 0;
	searchHoverIndex = -1;
	searchScope = 'local';
	if (searchQuery.length === 0) {
		searchMatches = [];
		searchCurrentIndex = -1;
	} else {
		startSearchJob();
	}
	ensureCursorVisible();
	if (message.visible && !Number.isFinite(message.timer) && deferredMessageDuration !== null) {
		message.timer = deferredMessageDuration;
	}
	deferredMessageDuration = null;
	if (dimCrtInEditor) {
		applyEditorCrtDimming();
	}
}

export function applyEditorCrtDimming(): void {
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

export function restoreCrtOptions(): void {
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

export function deactivate(): void {
	storeActiveCodeTabContext();
	active = false;
	if (dimCrtInEditor) {
		restoreCrtOptions();
	}
	completion.closeSession();
	repeatState.clear();
	resetKeyPressGuards();
	input.applyOverrides(false, captureKeys);
	$.input.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
	selectionAnchor = null;
	pointerSelecting = false;
	pointerPrimaryWasPressed = false;
	pointerAuxWasPressed = false;
	tabDragState = null;
	clearGotoHoverHighlight();
	scrollbarController.cancel();
	cursorRevealSuspended = false;
	undoStack = [];
	redoStack = [];
	lastHistoryKey = null;
	lastHistoryTimestamp = 0;
	searchActive = false;
	searchVisible = false;
	lineJumpActive = false;
	lineJumpVisible = false;
	runtimeErrorOverlay = null;
	resetActionPromptState();
	closeCreateResourcePrompt(false);
	hideResourcePanel();
	cancelSearchJob();
	cancelGlobalSearchJob();
	globalSearchMatches = [];
	searchDisplayOffset = 0;
	searchHoverIndex = -1;
	searchScope = 'local';
	clearBackgroundTasks();
	diagnosticsTaskPending = false;
	lastReportedSemanticError = null;
}

export function splitLines(source: string): string[] {
	return source.split(/\r?\n/);
}

export function handleActionPromptInput(keyboard: KeyboardInput): void {
	if (!pendingActionPrompt) {
		return;
	}
	if (isKeyJustPressedGlobal(playerIndex, 'Escape')) {
		consumeKeyboardKey(keyboard, 'Escape');
		resetActionPromptState();
		return;
	}
	if (isKeyJustPressedGlobal(playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		void handleActionPromptSelection('save-continue');
	}
}

export function handleEditorInput(keyboard: KeyboardInput, deltaSeconds: number): void {
	if (resourcePanelVisible && resourcePanelFocused) {
		resourcePanel.handleKeyboard(keyboard, deltaSeconds);
		const st = resourcePanel.getStateForRender();
		resourcePanelFocused = st.focused;
		return;
	}
	if (isResourceViewActive()) {
		handleResourceViewerInput(keyboard, deltaSeconds);
		return;
	}
	const ctrlDown = isModifierPressedGlobal(playerIndex, 'ControlLeft') || isModifierPressedGlobal(playerIndex, 'ControlRight');
	const shiftDown = isModifierPressedGlobal(playerIndex, 'ShiftLeft') || isModifierPressedGlobal(playerIndex, 'ShiftRight');
	const metaDown = isModifierPressedGlobal(playerIndex, 'MetaLeft') || isModifierPressedGlobal(playerIndex, 'MetaRight');
	const altDown = isModifierPressedGlobal(playerIndex, 'AltLeft') || isModifierPressedGlobal(playerIndex, 'AltRight');

	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(playerIndex, 'KeyO')) {
		consumeKeyboardKey(keyboard, 'KeyO');
		openSymbolSearch();
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(playerIndex, 'KeyR')) {
		consumeKeyboardKey(keyboard, 'KeyR');
		toggleResolutionMode();
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(playerIndex, 'KeyL')) {
		consumeKeyboardKey(keyboard, 'KeyL');
		toggleResourcePanelFilterMode();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(playerIndex, 'Comma')) {
		consumeKeyboardKey(keyboard, 'Comma');
		openResourceSearch();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && !shiftDown && isKeyJustPressedGlobal(playerIndex, 'KeyE')) {
		consumeKeyboardKey(keyboard, 'KeyE');
		openResourceSearch();
		return;
	}
	if ((ctrlDown && altDown) && isKeyJustPressedGlobal(playerIndex, 'Comma')) {
		consumeKeyboardKey(keyboard, 'Comma');
		openSymbolSearch();
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(playerIndex, 'KeyB')) {
		consumeKeyboardKey(keyboard, 'KeyB');
		toggleResourcePanel();
		return;
	}
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(playerIndex, 'KeyM')) {
		consumeKeyboardKey(keyboard, 'KeyM');
		toggleProblemsPanel();
		if (problemsPanel.isVisible()) {
			markDiagnosticsDirty();
		} else {
			focusEditorFromProblemsPanel();
		}
		return;
	}
	if (!ctrlDown && !metaDown && altDown && isKeyJustPressedGlobal(playerIndex, 'Comma')) {
		consumeKeyboardKey(keyboard, 'Comma');
		openGlobalSymbolSearch();
		return;
	}

	if (createResourceActive) {
		handleCreateResourceInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return;
	}

	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(playerIndex, 'KeyN')) {
		consumeKeyboardKey(keyboard, 'KeyN');
		openCreateResourcePrompt();
		return;
	}

	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressedGlobal(playerIndex, 'KeyF')) {
		consumeKeyboardKey(keyboard, 'KeyF');
		openSearch(true, 'global');
		return;
	}
	if ((ctrlDown || metaDown) && !shiftDown && !altDown && isKeyJustPressedGlobal(playerIndex, 'KeyF')) {
		consumeKeyboardKey(keyboard, 'KeyF');
		openSearch(true, 'local');
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(playerIndex, 'Tab')) {
		consumeKeyboardKey(keyboard, 'Tab');
		cycleTab(shiftDown ? -1 : 1);
		return;
	}
	const inlineFieldFocused = searchActive
		|| symbolSearchActive
		|| resourceSearchActive
		|| lineJumpActive
		|| createResourceActive
		|| renameController.isActive();
	if (handleCustomKeybinding(keyboard, deltaSeconds, {
		ctrlDown,
		metaDown,
		shiftDown,
		altDown,
		inlineFieldFocused,
		resourcePanelFocused: resourcePanelFocused,
		codeTabActive: isCodeTabActive(),
	})) {
		return;
	}
	if (!inlineFieldFocused && isKeyJustPressedGlobal(playerIndex, 'F12')) {
		consumeKeyboardKey(keyboard, 'F12');
		if (shiftDown) {
			return;
		}
		openReferenceSearchPopup();
		return;
	}
	if (!inlineFieldFocused && isCodeTabActive() && isKeyJustPressedGlobal(playerIndex, 'F2')) {
		consumeKeyboardKey(keyboard, 'F2');
		openRenamePrompt();
		return;
	}
	if ((ctrlDown || metaDown)
		&& !inlineFieldFocused
		&& !resourcePanelFocused
		&& isCodeTabActive()
		&& isKeyJustPressedGlobal(playerIndex, 'KeyA')) {
		consumeKeyboardKey(keyboard, 'KeyA');
		selectionAnchor = { row: 0, column: 0 };
		const lastRowIndex = lines.length > 0 ? lines.length - 1 : 0;
		const lastColumn = lines.length > 0 ? lines[lastRowIndex].length : 0;
		cursorRow = lastRowIndex;
		cursorColumn = lastColumn;
		updateDesiredColumn();
		resetBlink();
		revealCursor();
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(playerIndex, 'KeyL')) {
		consumeKeyboardKey(keyboard, 'KeyL');
		openLineJump();
		return;
	}
	if (renameController.isActive()) {
		renameController.handleInput(keyboard, deltaSeconds, { ctrlDown, metaDown, shiftDown, altDown });
		return;
	}
	if (resourceSearchActive) {
		handleResourceSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return;
	}
	if (symbolSearchActive) {
		handleSymbolSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return;
	}
	if (lineJumpActive) {
		handleLineJumpInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return;
	}
	if (searchActive) {
		handleSearchInput(keyboard, deltaSeconds, shiftDown, ctrlDown, metaDown);
		return;
	}
	if (problemsPanel.isVisible() && problemsPanel.isFocused()) {
		let handled = false;
		if (shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowUp');
			handled = problemsPanel.handleKeyboardCommand('up');
		} else if (shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowDown');
			handled = problemsPanel.handleKeyboardCommand('down');
		} else if (shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageUp');
			handled = problemsPanel.handleKeyboardCommand('page-up');
		} else if (shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageDown');
			handled = problemsPanel.handleKeyboardCommand('page-down');
		} else if (shouldFireRepeat(keyboard, 'Home', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'Home');
			handled = problemsPanel.handleKeyboardCommand('home');
		} else if (shouldFireRepeat(keyboard, 'End', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'End');
			handled = problemsPanel.handleKeyboardCommand('end');
		} else if (isKeyJustPressedGlobal(playerIndex, 'Enter') || isKeyJustPressedGlobal(playerIndex, 'NumpadEnter')) {
			if (isKeyJustPressedGlobal(playerIndex, 'Enter')) consumeKeyboardKey(keyboard, 'Enter'); else consumeKeyboardKey(keyboard, 'NumpadEnter');
			handled = problemsPanel.handleKeyboardCommand('activate');
		} else if (isKeyJustPressedGlobal(playerIndex, 'Escape')) {
			consumeKeyboardKey(keyboard, 'Escape');
			hideProblemsPanel();
			focusEditorFromProblemsPanel();
			return;
		}
		// Always swallow caret movement while problems panel is focused
		if (shouldFireRepeat(keyboard, 'ArrowLeft', deltaSeconds)) consumeKeyboardKey(keyboard, 'ArrowLeft');
		if (shouldFireRepeat(keyboard, 'ArrowRight', deltaSeconds)) consumeKeyboardKey(keyboard, 'ArrowRight');
		if (handled) return; else return;
	}
	if (searchQuery.length > 0 && isKeyJustPressedGlobal(playerIndex, 'F3')) {
		consumeKeyboardKey(keyboard, 'F3');
		if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if ((ctrlDown || metaDown) && shouldFireRepeat(keyboard, 'KeyZ', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'KeyZ');
		if (shiftDown) {
			redo();
		} else {
			undo();
		}
		return;
	}
	if ((ctrlDown || metaDown) && shouldFireRepeat(keyboard, 'KeyY', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'KeyY');
		redo();
		return;
	}
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(playerIndex, 'KeyW')) {
		consumeKeyboardKey(keyboard, 'KeyW');
		closeActiveTab();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(playerIndex, 'KeyS')) {
		consumeKeyboardKey(keyboard, 'KeyS');
		void save();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(playerIndex, 'KeyC')) {
		consumeKeyboardKey(keyboard, 'KeyC');
		void copySelectionToClipboard();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(playerIndex, 'KeyX')) {
		consumeKeyboardKey(keyboard, 'KeyX');
		if (hasSelection()) {
			void cutSelectionToClipboard();
		} else {
			void cutLineToClipboard();
		}
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(playerIndex, 'KeyV')) {
		consumeKeyboardKey(keyboard, 'KeyV');
		pasteFromClipboard();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(playerIndex, 'Slash')) {
		consumeKeyboardKey(keyboard, 'Slash');
		toggleLineComments();
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(playerIndex, 'NumpadDivide')) {
		consumeKeyboardKey(keyboard, 'NumpadDivide');
		toggleLineComments();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(playerIndex, 'BracketRight')) {
		consumeKeyboardKey(keyboard, 'BracketRight');
		indentSelectionOrLine();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(playerIndex, 'BracketLeft')) {
		consumeKeyboardKey(keyboard, 'BracketLeft');
		unindentSelectionOrLine();
		return;
	}
	// Manual completion open/close handled by CompletionController via handleCompletionKeybindings
	if (handleCompletionKeybindings(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown, metaDown)) {
		return;
	}
	input.handleEditorInput(keyboard, deltaSeconds);
	if (ctrlDown || metaDown || altDown) {
		return;
	}
	// Remaining character input after controller handled modifiers is no-op here
}

let customKeybindingHandler: CustomKeybindingHandler | null = null;

export function handleCustomKeybinding(
	keyboard: KeyboardInput,
	deltaSeconds: number,
	context: ConsoleEditorShortcutContext,
): boolean {
	if (customKeybindingHandler) {
		return customKeybindingHandler(keyboard, deltaSeconds, context);
	}
	return false;
}

export function handleCreateResourceInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
	const altDown = isModifierPressedGlobal(playerIndex, 'AltLeft') || isModifierPressedGlobal(playerIndex, 'AltRight');
	if (isKeyJustPressedGlobal(playerIndex, 'Escape')) {
		consumeKeyboardKey(keyboard, 'Escape');
		cancelCreateResourcePrompt();
		return;
	}
	if (!createResourceWorking && isKeyJustPressedGlobal(playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		void confirmCreateResourcePrompt();
		return;
	}
	if (createResourceWorking) {
		return;
	}
	const textChanged = processInlineFieldEditing(createResourceField, keyboard, {
		ctrlDown,
		metaDown,
		shiftDown,
		altDown,
		deltaSeconds,
		allowSpace: true,
		characterFilter: (value: string): boolean => isValidCreateResourceCharacter(value),
		maxLength: constants.CREATE_RESOURCE_MAX_PATH_LENGTH,
	});
	if (textChanged) {
		createResourceError = null;
		resetBlink();
	}
	createResourcePath = createResourceField.text;
}

export function openCreateResourcePrompt(): void {
	if (createResourceWorking) {
		return;
	}
	resourcePanelFocused = false;
	renameController.cancel();
	let defaultPath = createResourcePath.length === 0
		? determineCreateResourceDefaultPath()
		: createResourcePath;
	if (defaultPath.length > constants.CREATE_RESOURCE_MAX_PATH_LENGTH) {
		defaultPath = defaultPath.slice(defaultPath.length - constants.CREATE_RESOURCE_MAX_PATH_LENGTH);
	}
	applyCreateResourceFieldText(defaultPath, true);
	createResourceVisible = true;
	createResourceActive = true;
	createResourceError = null;
	cursorVisible = true;
	resetBlink();
}

export function closeCreateResourcePrompt(focusEditor: boolean): void {
	createResourceActive = false;
	createResourceVisible = false;
	createResourceWorking = false;
	if (focusEditor) {
		focusEditorFromSearch();
		focusEditorFromLineJump();
	}
	applyCreateResourceFieldText('', true);
	createResourceError = null;
	resetBlink();
}

export function cancelCreateResourcePrompt(): void {
	closeCreateResourcePrompt(true);
}

export async function confirmCreateResourcePrompt(): Promise<void> {
	if (createResourceWorking) {
		return;
	}
	let normalizedPath: string;
	let assetId: string;
	let directory: string;
	try {
		const result = normalizeCreateResourceRequest(createResourcePath);
		normalizedPath = result.path;
		assetId = result.assetId;
		directory = result.directory;
		applyCreateResourceFieldText(normalizedPath, true);
		createResourceError = null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		createResourceError = message;
		showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
		resetBlink();
		return;
	}
	createResourceWorking = true;
	resetBlink();
	const contents = buildDefaultResourceContents(normalizedPath, assetId);
	try {
		const descriptor = await createLuaResourceFn({ path: normalizedPath, assetId, contents });
		lastCreateResourceDirectory = directory;
		pendingResourceSelectionAssetId = descriptor.assetId;
		if (resourcePanelVisible) {
			refreshResourcePanelContents();
		}
		openLuaCodeTab(descriptor);
		showMessage(`Created ${descriptor.path} (asset ${descriptor.assetId})`, constants.COLOR_STATUS_SUCCESS, 2.5);
		closeCreateResourcePrompt(false);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const simplified = simplifyRuntimeErrorMessage(message);
		createResourceError = simplified;
		showMessage(`Failed to create resource: ${simplified}`, constants.COLOR_STATUS_WARNING, 4.0);
	} finally {
		createResourceWorking = false;
		resetBlink();
	}
}

export function isValidCreateResourceCharacter(value: string): boolean {
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

export function normalizeCreateResourceRequest(rawPath: string): { path: string; assetId: string; directory: string } {
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
	return { path: candidate, assetId: baseName, directory: ensureDirectorySuffix(directory) };
}

export function determineCreateResourceDefaultPath(): string {
	if (lastCreateResourceDirectory && lastCreateResourceDirectory.length > 0) {
		return lastCreateResourceDirectory;
	}
	const activeContext = getActiveCodeTabContext();
	if (activeContext && activeContext.descriptor && typeof activeContext.descriptor.path === 'string' && activeContext.descriptor.path.length > 0) {
		return ensureDirectorySuffix(activeContext.descriptor.path);
	}
	let descriptors: ConsoleResourceDescriptor[] = [];
	try {
		descriptors = listResourcesFn();
	} catch (error) {
		descriptors = [];
	}
	const firstLua = descriptors.find(entry => entry.type === 'lua' && typeof entry.path === 'string' && entry.path.length > 0);
	if (firstLua && typeof firstLua.path === 'string') {
		return ensureDirectorySuffix(firstLua.path);
	}
	return './';
}

export function ensureDirectorySuffix(path: string): string {
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

export function buildDefaultResourceContents(_path: string, _assetId: string): string {
	return constants.DEFAULT_NEW_LUA_RESOURCE_CONTENT;
}

export function handleSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
	const altDown = isModifierPressedGlobal(playerIndex, 'AltLeft') || isModifierPressedGlobal(playerIndex, 'AltRight');
	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressedGlobal(playerIndex, 'KeyF')) {
		consumeKeyboardKey(keyboard, 'KeyF');
		openSearch(false, 'global');
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressedGlobal(playerIndex, 'KeyF')) {
		consumeKeyboardKey(keyboard, 'KeyF');
		openSearch(false, 'local');
		return;
	}
	if ((ctrlDown || metaDown) && shouldFireRepeat(keyboard, 'KeyZ', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'KeyZ');
		if (shiftDown) {
			redo();
		} else {
			undo();
		}
		return;
	}
	if ((ctrlDown || metaDown) && shouldFireRepeat(keyboard, 'KeyY', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'KeyY');
		redo();
		return;
	}
	if (ctrlDown && isKeyJustPressedGlobal(playerIndex, 'KeyS')) {
		consumeKeyboardKey(keyboard, 'KeyS');
		void save();
		return;
	}
	const hasResults = activeSearchMatchCount() > 0;
	const previewLocal = searchScope === 'local';
	if (isKeyJustPressedGlobal(playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		if (hasResults) {
			if (shiftDown) {
				moveSearchSelection(-1, { wrap: true, preview: previewLocal });
			} else if (searchCurrentIndex === -1) {
				searchCurrentIndex = 0;
			} else {
				moveSearchSelection(1, { wrap: true, preview: previewLocal });
			}
			applySearchSelection(searchCurrentIndex);
		} else if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if (isKeyJustPressedGlobal(playerIndex, 'F3')) {
		consumeKeyboardKey(keyboard, 'F3');
		if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if (hasResults) {
		if (shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowUp');
			moveSearchSelection(-1, { preview: previewLocal });
			return;
		}
		if (shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'ArrowDown');
			moveSearchSelection(1, { preview: previewLocal });
			return;
		}
		if (shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageUp');
			moveSearchSelection(-searchPageSize(), { preview: previewLocal });
			return;
		}
		if (shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
			consumeKeyboardKey(keyboard, 'PageDown');
			moveSearchSelection(searchPageSize(), { preview: previewLocal });
			return;
		}
		if (isKeyJustPressedGlobal(playerIndex, 'Home')) {
			consumeKeyboardKey(keyboard, 'Home');
			searchCurrentIndex = hasResults ? 0 : -1;
			ensureSearchSelectionVisible();
			if (previewLocal) {
				applySearchSelection(searchCurrentIndex, { preview: true });
			}
			return;
		}
		if (isKeyJustPressedGlobal(playerIndex, 'End')) {
			consumeKeyboardKey(keyboard, 'End');
			const lastIndex = hasResults ? activeSearchMatchCount() - 1 : -1;
			searchCurrentIndex = lastIndex;
			ensureSearchSelectionVisible();
			if (previewLocal) {
				applySearchSelection(searchCurrentIndex, { preview: true });
			}
			return;
		}
	}

	const textChanged = processInlineFieldEditing(searchField, keyboard, {
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
		onSearchQueryChanged();
	}
}

export function handleLineJumpInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
	if ((ctrlDown || metaDown) && isKeyJustPressedGlobal(playerIndex, 'KeyL')) {
		consumeKeyboardKey(keyboard, 'KeyL');
		openLineJump();
		return;
	}
	const altDown = isModifierPressedGlobal(playerIndex, 'AltLeft') || isModifierPressedGlobal(playerIndex, 'AltRight');
	if (isKeyJustPressedGlobal(playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		applyLineJump();
		return;
	}
	if (!shiftDown && isKeyJustPressedGlobal(playerIndex, 'NumpadEnter')) {
		consumeKeyboardKey(keyboard, 'NumpadEnter');
		applyLineJump();
		return;
	}
	if (isKeyJustPressedGlobal(playerIndex, 'Escape')) {
		consumeKeyboardKey(keyboard, 'Escape');
		closeLineJump(false);
		return;
	}

	const digitFilter = (value: string): boolean => value >= '0' && value <= '9';
	const textChanged = processInlineFieldEditing(lineJumpField, keyboard, {
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

export function openSearch(useSelection: boolean, scope: 'local' | 'global' = 'local'): void {
	clearReferenceHighlights();
	closeSymbolSearch(false);
	closeResourceSearch(false);
	closeLineJump(false);
	renameController.cancel();
	searchScope = scope;
	searchDisplayOffset = 0;
	searchHoverIndex = -1;
	if (scope === 'global') {
		cancelSearchJob();
		searchMatches = [];
		globalSearchMatches = [];
	} else {
		cancelGlobalSearchJob();
		globalSearchMatches = [];
	}
	searchVisible = true;
	searchActive = true;
	applySearchFieldText(searchQuery, true);
	let appliedSelection = false;
	if (useSelection) {
		const range = getSelectionRange();
		const selected = getSelectionText();
		if (range && selected !== null && selected.length > 0 && selected.indexOf('\n') === -1) {
			applySearchFieldText(selected, true);
			cursorRow = range.start.row;
			cursorColumn = range.start.column;
			appliedSelection = true;
		}
	}
	if (!appliedSelection && searchField.text.length === 0) {
		searchCurrentIndex = -1;
	}
	searchQuery = searchField.text;
	onSearchQueryChanged();
	resetBlink();
}

export function closeSearch(clearQuery: boolean, forceHide = false): void {
	searchActive = false;
	searchHoverIndex = -1;
	searchDisplayOffset = 0;
	if (clearQuery) {
		applySearchFieldText('', true);
	}
	searchQuery = searchField.text;
	const shouldHide = forceHide || clearQuery || searchQuery.length === 0;
	if (shouldHide) {
		searchVisible = false;
		searchScope = 'local';
		searchMatches = [];
		globalSearchMatches = [];
		searchCurrentIndex = -1;
		cancelSearchJob();
		cancelGlobalSearchJob();
	} else {
		if (searchScope !== 'local') {
			searchScope = 'local';
			cancelGlobalSearchJob();
			globalSearchMatches = [];
		}
		searchMatches = [];
		searchCurrentIndex = -1;
		searchVisible = true;
		onSearchQueryChanged();
	}
	selectionAnchor = null;
	resetBlink();
}

export function focusEditorFromSearch(): void {
	if (!searchActive && !searchVisible) {
		return;
	}
	searchActive = false;
	searchScope = 'local';
	searchDisplayOffset = 0;
	searchHoverIndex = -1;
	cancelGlobalSearchJob();
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
	selectionAnchor = null;
	searchField.selectionAnchor = null;
	searchField.pointerSelecting = false;
	cancelSearchJob();
	cancelGlobalSearchJob();
	resetBlink();
}

export function openResourceSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeSymbolSearch(false);
	renameController.cancel();
	resourceSearchVisible = true;
	resourceSearchActive = true;
	applyResourceSearchFieldText(initialQuery, true);
	refreshResourceCatalog();
	updateResourceSearchMatches();
	resourceSearchHoverIndex = -1;
	resetBlink();
}

export function closeResourceSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applyResourceSearchFieldText('', true);
	}
	resourceSearchActive = false;
	resourceSearchVisible = false;
	resourceSearchMatches = [];
	resourceSearchSelectionIndex = -1;
	resourceSearchDisplayOffset = 0;
	resourceSearchHoverIndex = -1;
	resourceSearchField.selectionAnchor = null;
	resourceSearchField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromResourceSearch(): void {
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
	resetBlink();
}

export function openSymbolSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	renameController.cancel();
	symbolSearchMode = 'symbols';
	referenceCatalog = [];
	symbolSearchGlobal = false;
	symbolSearchVisible = true;
	symbolSearchActive = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	symbolSearchHoverIndex = -1;
	resetBlink();
}

export function openGlobalSymbolSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	renameController.cancel();
	symbolSearchMode = 'symbols';
	referenceCatalog = [];
	symbolSearchGlobal = true;
	symbolSearchVisible = true;
	symbolSearchActive = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	symbolSearchHoverIndex = -1;
	resetBlink();
}

export function openReferenceSearchPopup(): void {
	const context = getActiveCodeTabContext();
	if (symbolSearchVisible || symbolSearchActive) {
		closeSymbolSearch(false);
	}
	renameController.cancel();
	const referenceContext = buildProjectReferenceContext(context);
	const result = resolveReferenceLookup({
		layout: layout,
		workspace: semanticWorkspace,
		lines: lines,
		textVersion: textVersion,
		cursorRow: cursorRow,
		cursorColumn: cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		chunkName: referenceContext.chunkName,
	});
	if (result.kind === 'error') {
		showMessage(result.message, constants.COLOR_STATUS_WARNING, result.duration);
		return;
	}
	const { info, initialIndex } = result;
	referenceState.apply(info, initialIndex);
	referenceCatalog = buildReferenceCatalogForExpression(info, context);
	if (referenceCatalog.length === 0) {
		showMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
		return;
	}
	symbolSearchMode = 'references';
	symbolSearchGlobal = true;
	symbolSearchVisible = true;
	symbolSearchActive = true;
	applySymbolSearchFieldText('', true);
	symbolSearchQuery = '';
	updateReferenceSearchMatches();
	symbolSearchHoverIndex = -1;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
	showReferenceStatusMessage();
}

export function openRenamePrompt(): void {
	if (!isCodeTabActive()) {
		return;
	}
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	closeSymbolSearch(false);
	createResourceActive = false;
	const context = getActiveCodeTabContext();
	const referenceContext = buildProjectReferenceContext(context);
	const started = renameController.begin({
		layout: layout,
		workspace: semanticWorkspace,
		lines: lines,
		textVersion: textVersion,
		cursorRow: cursorRow,
		cursorColumn: cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		chunkName: referenceContext.chunkName,
	});
	if (started) {
		cursorVisible = true;
		resetBlink();
	}
}

export function commitRename(payload: RenameCommitPayload): RenameCommitResult {
	const { matches, newName, activeIndex, info } = payload;
	const activeContext = getActiveCodeTabContext();
	const referenceContext = buildProjectReferenceContext(activeContext);
	const activeChunkName = referenceContext.chunkName;
	const normalizedActiveChunk = normalizeChunkReference(activeChunkName) ?? activeChunkName;
	const renameManager = new CrossFileRenameManager(getCrossFileRenameDependencies(), semanticWorkspace);
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
		const edits = planRenameLineEdits(lines, sortedMatches, newName);
		if (edits.length > 0) {
			prepareUndo('rename', false);
			recordEditContext('replace', newName);
			for (let index = 0; index < edits.length; index += 1) {
				const edit = edits[index];
				lines[edit.row] = edit.text;
				invalidateLine(edit.row);
			}
			markTextMutated();
			activeEditsApplied = true;
		}
		const clampedIndex = clamp(activeIndex, 0, sortedMatches.length - 1);
		const match = sortedMatches[clampedIndex];
		const line = lines[match.row] ?? '';
		const startColumn = clamp(match.start, 0, line.length);
		const endColumn = clamp(startColumn + newName.length, startColumn, line.length);
		cursorRow = match.row;
		cursorColumn = startColumn;
		selectionAnchor = { row: match.row, column: endColumn };
		updateDesiredColumn();
		resetBlink();
		cursorRevealSuspended = false;
		ensureCursorVisible();
		updatedTotal += sortedMatches.length;
	}
	if (activeEditsApplied) {
		semanticWorkspace.updateFile(activeChunkName, lines.join('\n'));
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
		const normalized = normalizeChunkReference(chunk) ?? chunk;
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
			markDiagnosticsDirtyForChunk(bucket.chunkName);
		}
	}
	return { updatedMatches: updatedTotal };
}

export function getCrossFileRenameDependencies(): CrossFileRenameDependencies {
	return {
		normalizeChunkReference: (reference: string | null) => normalizeChunkReference(reference),
		findResourceDescriptorForChunk: (chunk: string) => findResourceDescriptorForChunk(chunk),
		createLuaCodeTabContext: (descriptor: ConsoleResourceDescriptor) => createLuaCodeTabContext(descriptor),
		createEntryTabContext: () => createEntryTabContext(),
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
		splitLines: (source: string) => splitLines(source),
		setTabDirty: (tabId: string, dirty: boolean) => setTabDirty(tabId, dirty),
	};
}

export function closeSymbolSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applySymbolSearchFieldText('', true);
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
	resetBlink();
}

export function focusEditorFromSymbolSearch(): void {
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
	resetBlink();
}

export function focusEditorFromRename(): void {
	cursorRevealSuspended = false;
	resetBlink();
	revealCursor();
	cursorVisible = true;
}

export function refreshSymbolCatalog(force: boolean): void {
	const scope: 'local' | 'global' = symbolSearchGlobal ? 'global' : 'local';
	let assetId: string | null = null;
	let chunkName: string | null = null;
	if (scope === 'local') {
		const context = getActiveCodeTabContext();
		assetId = resolveHoverAssetId(context);
		chunkName = resolveHoverChunkName(context);
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
		showMessage(`Failed to list symbols: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
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
		const sourceLabel = scope === 'global' ? symbolSourceLabel(entry) : null;
		const combinedKey = sourceLabel
			? `${display} ${sourceLabel}`.toLowerCase()
			: display.toLowerCase();
		return {
			symbol: entry,
			displayName: display,
			searchKey: combinedKey,
			line: entry.location.range.startLine,
			kindLabel: symbolKindLabel(entry.kind),
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

export function symbolPriority(kind: ConsoleLuaSymbolEntry['kind']): number {
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

export function symbolKindLabel(kind: ConsoleLuaSymbolEntry['kind']): string {
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

export function symbolSourceLabel(entry: ConsoleLuaSymbolEntry): string | null {
	const path = entry.location.path ?? entry.location.assetId ?? null;
	if (!path) {
		return null;
	}
	return computeSourceLabel(path, entry.location.chunkName ?? '<console>');
}

export function buildReferenceCatalogForExpression(info: ReferenceMatchInfo, context: CodeTabContext | null): ReferenceCatalogEntry[] {
	const descriptor = context?.descriptor ?? null;
	const normalizedPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
	const assetId = descriptor?.assetId ?? primaryAssetId ?? null;
	const chunkName = resolveHoverChunkName(context) ?? normalizedPath ?? assetId ?? '<console>';
	const environment: ProjectReferenceEnvironment = {
		activeContext: getActiveCodeTabContext(),
		activeLines: lines,
		codeTabContexts: Array.from(codeTabContexts.values()),
		listResources: () => listResourcesStrict(),
		loadLuaResource: (resourceId: string) => loadLuaResourceFn(resourceId),
	};
	const sourceLabelPath = descriptor?.path ?? descriptor?.assetId ?? null;
	return buildProjectReferenceCatalog({
		workspace: semanticWorkspace,
		info,
		lines: lines,
		chunkName,
		assetId,
		environment,
		sourceLabelPath,
	});
}

export function updateSymbolSearchMatches(): void {
	if (symbolSearchMode === 'references') {
		updateReferenceSearchMatches();
		return;
	}
	refreshSymbolCatalog(false);
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
		const aPriority = symbolPriority(a.entry.symbol.kind);
		const bPriority = symbolPriority(b.entry.symbol.kind);
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

export function updateReferenceSearchMatches(): void {
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

export function getActiveSymbolSearchMatch(): SymbolSearchResult | null {
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

export function ensureSymbolSearchSelectionVisible(): void {
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

export function moveSymbolSearchSelection(delta: number): void {
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
	ensureSymbolSearchSelectionVisible();
	resetBlink();
}

export function applySymbolSearchSelection(index: number): void {
	if (index < 0 || index >= symbolSearchMatches.length) {
		showMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = symbolSearchMatches[index];
	if (symbolSearchMode === 'references') {
		const referenceEntry = match.entry as ReferenceCatalogEntry;
		const symbol = referenceEntry.symbol as ReferenceSymbolEntry;
		const entryIndex = referenceCatalog.indexOf(referenceEntry);
		const expressionLabel = referenceState.getExpression() ?? symbol.name;
		closeSymbolSearch(true);
		referenceState.clear();
		navigateToLuaDefinition(symbol.location);
		const total = referenceCatalog.length;
		if (entryIndex >= 0 && total > 0) {
			showMessage(`Reference ${entryIndex + 1}/${total} for ${expressionLabel}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		} else {
			showMessage('Jumped to reference', constants.COLOR_STATUS_SUCCESS, 1.6);
		}
		return;
	}
	const location = match.entry.symbol.location;
	closeSymbolSearch(true);
	scheduleNextFrame(() => {
		navigateToLuaDefinition(location);
	});
}

export function handleSymbolSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
	const altDown = isModifierPressedGlobal(playerIndex, 'AltLeft') || isModifierPressedGlobal(playerIndex, 'AltRight');
	if (isKeyJustPressedGlobal(playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		if (shiftDown) {
			moveSymbolSearchSelection(-1);
			return;
		}
		if (symbolSearchSelectionIndex >= 0) {
			applySymbolSearchSelection(symbolSearchSelectionIndex);
		} else {
			showMessage('No symbol selected', constants.COLOR_STATUS_WARNING, 1.5);
		}
		return;
	}
	if (isKeyJustPressedGlobal(playerIndex, 'Escape')) {
		consumeKeyboardKey(keyboard, 'Escape');
		closeSymbolSearch(true);
		return;
	}
	if (shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowUp');
		moveSymbolSearchSelection(-1);
		return;
	}
	if (shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowDown');
		moveSymbolSearchSelection(1);
		return;
	}
	if (shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageUp');
		moveSymbolSearchSelection(-symbolSearchPageSize());
		return;
	}
	if (shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageDown');
		moveSymbolSearchSelection(symbolSearchPageSize());
		return;
	}
	if (isKeyJustPressedGlobal(playerIndex, 'Home')) {
		consumeKeyboardKey(keyboard, 'Home');
		symbolSearchSelectionIndex = symbolSearchMatches.length > 0 ? 0 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressedGlobal(playerIndex, 'End')) {
		consumeKeyboardKey(keyboard, 'End');
		symbolSearchSelectionIndex = symbolSearchMatches.length > 0 ? symbolSearchMatches.length - 1 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	const textChanged = processInlineFieldEditing(symbolSearchField, keyboard, {
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
		updateSymbolSearchMatches();
	}
}

export function refreshResourceCatalog(): void {
	let descriptors: ConsoleResourceDescriptor[];
	try {
		descriptors = listResourcesStrict();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		resourceCatalog = [];
		resourceSearchMatches = [];
		resourceSearchSelectionIndex = -1;
		resourceSearchDisplayOffset = 0;
		resourceSearchHoverIndex = -1;
		showMessage(`Failed to list resources: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
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

export function updateResourceSearchMatches(): void {
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

export function ensureResourceSearchSelectionVisible(): void {
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

export function moveResourceSearchSelection(delta: number): void {
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
	ensureResourceSearchSelectionVisible();
	resetBlink();
}

export function applyResourceSearchSelection(index: number): void {
	if (index < 0 || index >= resourceSearchMatches.length) {
		showMessage('Resource not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = resourceSearchMatches[index];
	closeResourceSearch(true);
	scheduleNextFrame(() => {
		openResourceDescriptor(match.entry.descriptor);
	});
}

export function handleResourceSearchInput(keyboard: KeyboardInput, deltaSeconds: number, shiftDown: boolean, ctrlDown: boolean, metaDown: boolean): void {
	const altDown = isModifierPressedGlobal(playerIndex, 'AltLeft') || isModifierPressedGlobal(playerIndex, 'AltRight');
	if (isKeyJustPressedGlobal(playerIndex, 'Enter')) {
		consumeKeyboardKey(keyboard, 'Enter');
		if (shiftDown) {
			moveResourceSearchSelection(-1);
			return;
		}
		if (resourceSearchSelectionIndex >= 0) {
			applyResourceSearchSelection(resourceSearchSelectionIndex);
			return;
		} else {
			const trimmed = resourceSearchQuery.trim();
			if (trimmed.length === 0) {
				closeResourceSearch(true);
				focusEditorFromResourceSearch();
			} else {
				showMessage('No resource selected', constants.COLOR_STATUS_WARNING, 1.5);
			}
		}
		return;
	}
	if (isKeyJustPressedGlobal(playerIndex, 'Escape')) {
		consumeKeyboardKey(keyboard, 'Escape');
		closeResourceSearch(true);
		focusEditorFromResourceSearch();
		return;
	}
	if (shouldFireRepeat(keyboard, 'ArrowUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowUp');
		moveResourceSearchSelection(-1);
		return;
	}
	if (shouldFireRepeat(keyboard, 'ArrowDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'ArrowDown');
		moveResourceSearchSelection(1);
		return;
	}
	if (shouldFireRepeat(keyboard, 'PageUp', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageUp');
		moveResourceSearchSelection(-resourceSearchWindowCapacity());
		return;
	}
	if (shouldFireRepeat(keyboard, 'PageDown', deltaSeconds)) {
		consumeKeyboardKey(keyboard, 'PageDown');
		moveResourceSearchSelection(resourceSearchWindowCapacity());
		return;
	}
	if (isKeyJustPressedGlobal(playerIndex, 'Home')) {
		consumeKeyboardKey(keyboard, 'Home');
		resourceSearchSelectionIndex = resourceSearchMatches.length > 0 ? 0 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressedGlobal(playerIndex, 'End')) {
		consumeKeyboardKey(keyboard, 'End');
		resourceSearchSelectionIndex = resourceSearchMatches.length > 0 ? resourceSearchMatches.length - 1 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	const textChanged = processInlineFieldEditing(resourceSearchField, keyboard, {
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
			closeResourceSearch(true);
			openSymbolSearch(query);
			return;
		}
		if (resourceSearchQuery.startsWith('#')) {
			const query = resourceSearchQuery.slice(1).trimStart();
			closeResourceSearch(true);
			openGlobalSymbolSearch(query);
			return;
		}
		if (resourceSearchQuery.startsWith(':')) {
			const query = resourceSearchQuery.slice(1).trimStart();
			closeResourceSearch(true);
			openLineJump();
			if (query.length > 0) {
				applyLineJumpFieldText(query, true);
				lineJumpValue = query;
			}
			return;
		}
		updateResourceSearchMatches();
	}
}

export function openLineJump(): void {
	clearReferenceHighlights();
	closeSymbolSearch(false);
	closeResourceSearch(false);
	closeSearch(false, true);
	renameController.cancel();
	lineJumpVisible = true;
	lineJumpActive = true;
	applyLineJumpFieldText('', true);
	resetBlink();
}

export function closeLineJump(clearValue: boolean): void {
	lineJumpActive = false;
	lineJumpVisible = false;
	if (clearValue) {
		applyLineJumpFieldText('', true);
	}
	lineJumpField.selectionAnchor = null;
	lineJumpField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromLineJump(): void {
	if (!lineJumpActive && !lineJumpVisible) {
		return;
	}
	lineJumpActive = false;
	lineJumpVisible = false;
	lineJumpField.selectionAnchor = null;
	lineJumpField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromProblemsPanel(): void {
	problemsPanel.setFocused(false);
	resetBlink();
}

export function focusEditorFromResourcePanel(): void {
	if (!resourcePanelFocused) {
		return;
	}
	resourcePanelFocused = false;
	resetBlink();
}

export function applyLineJump(): void {
	if (lineJumpValue.length === 0) {
		showMessage('Enter a line number', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const target = Number.parseInt(lineJumpValue, 10);
	if (!Number.isFinite(target) || target < 1 || target > lines.length) {
		const limit = lines.length <= 0 ? 1 : lines.length;
		showMessage(`Line must be between 1 and ${limit}`, constants.COLOR_STATUS_WARNING, 1.8);
		return;
	}
	setCursorPosition(target - 1, 0);
	clearSelection();
	breakUndoSequence();
	closeLineJump(true);
	showMessage(`Jumped to line ${target}`, constants.COLOR_STATUS_SUCCESS, 1.5);
}

export function onSearchQueryChanged(): void {
	if (searchScope === 'global') {
		onGlobalSearchQueryChanged();
		return;
	}
	if (searchQuery.length === 0) {
		cancelSearchJob();
		searchMatches = [];
		searchCurrentIndex = -1;
		selectionAnchor = null;
		searchDisplayOffset = 0;
		return;
	}
	startSearchJob();
}

export function onGlobalSearchQueryChanged(): void {
	searchDisplayOffset = 0;
	searchHoverIndex = -1;
	searchCurrentIndex = -1;
	if (searchQuery.length === 0) {
		cancelGlobalSearchJob();
		globalSearchMatches = [];
		return;
	}
	startGlobalSearchJob();
}

export function focusSearchResult(index: number): void {
	if (index < 0 || index >= searchMatches.length) {
		return;
	}
	const match = searchMatches[index];
	cursorRow = match.row;
	cursorColumn = match.start;
	selectionAnchor = { row: match.row, column: match.end };
	updateDesiredColumn();
	resetBlink();
	revealCursor();
}

export function gotoDiagnostic(diagnostic: EditorDiagnostic): void {
	const navigationCheckpoint = beginNavigationCapture();
	// Switch to the originating tab if provided
	if (diagnostic.contextId && diagnostic.contextId.length > 0 && diagnostic.contextId !== activeCodeTabContextId) {
		setActiveTab(diagnostic.contextId);
	}
	if (!isCodeTabActive()) {
		activateCodeTab();
	}
	if (!isCodeTabActive()) {
		return;
	}
	const targetRow = clamp(diagnostic.row, 0, Math.max(0, lines.length - 1));
	const line = lines[targetRow] ?? '';
	const targetColumn = clamp(diagnostic.startColumn, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	clearSelection();
	cursorRevealSuspended = false;
	ensureCursorVisible();
	completeNavigation(navigationCheckpoint);
}

export function jumpToNextMatch(): void {
	if (searchScope === 'global') {
		if (activeSearchMatchCount() === 0) {
			showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		moveSearchSelection(1, { wrap: true });
		applySearchSelection(searchCurrentIndex);
		return;
	}
	ensureSearchJobCompleted();
	if (searchMatches.length === 0) {
		showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
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
	focusSearchResult(searchCurrentIndex);
}

export function jumpToPreviousMatch(): void {
	if (searchScope === 'global') {
		if (activeSearchMatchCount() === 0) {
			showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
			return;
		}
		moveSearchSelection(-1, { wrap: true });
		applySearchSelection(searchCurrentIndex);
		return;
	}
	ensureSearchJobCompleted();
	if (searchMatches.length === 0) {
		showMessage('No matches found', constants.COLOR_STATUS_WARNING, 1.5);
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
	focusSearchResult(searchCurrentIndex);
}

export function startSearchJob(): void {
	cancelSearchJob();
	searchDisplayOffset = 0;
	searchHoverIndex = -1;
	const normalized = searchQuery.toLowerCase();
	const job: SearchComputationJob = {
		query: normalized,
		version: textVersion,
		nextRow: 0,
		matches: [],
		firstMatchAfterCursor: -1,
		cursorRow: cursorRow,
		cursorColumn: cursorColumn,
	};
	searchJob = job;
	searchMatches = [];
	searchCurrentIndex = -1;
	selectionAnchor = null;
	enqueueBackgroundTask(() => runSearchJobSlice(job));
}

export function runSearchJobSlice(job: SearchComputationJob): boolean {
	if (searchJob !== job) {
		return false;
	}
	if (job.query.length === 0 || job.version !== textVersion || searchQuery.length === 0) {
		searchJob = null;
		return false;
	}
	const rowsPerSlice = 200;
	let processed = 0;
	while (job.nextRow < lines.length && processed < rowsPerSlice) {
		const row = job.nextRow;
		job.nextRow += 1;
		processed += 1;
		collectSearchMatchesForRow(job, row);
	}
	if (job.nextRow >= lines.length) {
		completeSearchJob(job);
		return false;
	}
	return true;
}

export function collectSearchMatchesForRow(job: SearchComputationJob, row: number): void {
	const line = lines[row];
	if (!line || line.length === 0) {
		return;
	}
	forEachMatchInLine(line, job.query, (start, end) => {
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

export function forEachMatchInLine(line: string, needle: string, cb: (start: number, end: number) => void): void {
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

export function completeSearchJob(job: SearchComputationJob): void {
	if (searchJob !== job) {
		return;
	}
	searchJob = null;
	searchMatches = job.matches;
	if (job.matches.length === 0) {
		searchCurrentIndex = -1;
		selectionAnchor = null;
		searchDisplayOffset = 0;
	} else {
		const index = job.firstMatchAfterCursor >= 0 ? job.firstMatchAfterCursor : 0;
		searchCurrentIndex = clamp(index, 0, job.matches.length - 1);
		ensureSearchSelectionVisible();
		focusSearchResult(searchCurrentIndex);
	}
}

export function cancelSearchJob(): void {
	searchJob = null;
}

export function ensureSearchJobCompleted(): void {
	const job = searchJob;
	if (!job) {
		return;
	}
	while (searchJob === job && runSearchJobSlice(job)) {
		// Continue processing synchronously until the job completes.
	}
}

export function startGlobalSearchJob(): void {
	cancelGlobalSearchJob();
	const normalized = searchQuery.toLowerCase();
	if (normalized.length === 0) {
		globalSearchMatches = [];
		return;
	}
	let descriptors: ConsoleResourceDescriptor[] = [];
	try {
		descriptors = listResourcesStrict().filter(entry => entry.type === 'lua');
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
	enqueueBackgroundTask(() => runGlobalSearchJobSlice(job));
}

export function runGlobalSearchJobSlice(job: GlobalSearchJob): boolean {
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
			job.currentLines = loadDescriptorLines(descriptor);
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
			forEachMatchInLine(line, job.query, (start, end) => {
				if (job.limitHit) {
					return;
				}
				const descriptor = job.descriptors[job.descriptorIndex];
				const match: GlobalSearchMatch = {
					descriptor,
					pathLabel: describeDescriptor(descriptor),
					row,
					start,
					end,
					snippet: buildSearchSnippet(line, start, end),
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
		completeGlobalSearchJob(job);
		return false;
	}
	return true;
}

export function completeGlobalSearchJob(job: GlobalSearchJob): void {
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
	ensureSearchSelectionVisible();
}

export function cancelGlobalSearchJob(): void {
	globalSearchJob = null;
}

export function loadDescriptorLines(descriptor: ConsoleResourceDescriptor): string[] | null {
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

export function describeDescriptor(descriptor: ConsoleResourceDescriptor): string {
	if (descriptor.path && descriptor.path.length > 0) {
		return descriptor.path.replace(/\\/g, '/');
	}
	if (descriptor.assetId && descriptor.assetId.length > 0) {
		return descriptor.assetId;
	}
	return '<resource>';
}

export function buildSearchSnippet(line: string, start: number, end: number): string {
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

export function getVisibleSearchResultEntries(): Array<{ primary: string; secondary?: string | null; detail?: string | null }> {
	const stats = computeSearchPageStats();
	if (stats.visible <= 0) {
		return [];
	}
	const results: Array<{ primary: string; secondary?: string | null; detail?: string | null }> = [];
	for (let i = 0; i < stats.visible; i += 1) {
		const entry = buildSearchResultEntry(stats.offset + i);
		if (entry) {
			results.push(entry);
		}
	}
	return results;
}

export function ensureSearchSelectionVisible(): void {
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

export function computeSearchPageStats(): { total: number; offset: number; visible: number } {
	const total = isSearchVisible() ? activeSearchMatchCount() : 0;
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

export function buildSearchResultEntry(index: number): { primary: string; secondary?: string | null; detail?: string | null } | null {
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
	const lineText = lines[match.row] ?? '';
	return {
		primary: `Line ${match.row + 1}`,
		secondary: buildSearchSnippet(lineText, match.start, match.end),
		detail: null,
	};
}

export function moveSearchSelection(delta: number, options?: { wrap?: boolean; preview?: boolean }): void {
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
			applySearchSelection(next, { preview: true });
		}
		return;
	}
	searchCurrentIndex = next;
	ensureSearchSelectionVisible();
	if (options?.preview) {
		applySearchSelection(next, { preview: true });
	}
}

export function applySearchSelection(index: number, options?: { preview?: boolean }): void {
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
		focusGlobalSearchResult(targetIndex, options?.preview === true);
	} else {
		focusSearchResult(targetIndex);
	}
}

export function focusGlobalSearchResult(index: number, previewOnly: boolean = false): void {
	const match = globalSearchMatches[index];
	if (!match) {
		if (!previewOnly) {
			showMessage('Search result unavailable', constants.COLOR_STATUS_WARNING, 1.5);
		}
		return;
	}
	if (previewOnly) {
		return;
	}
	if (match.descriptor) {
		openLuaCodeTab(match.descriptor);
	} else {
		activateCodeTab();
	}
	scheduleNextFrame(() => {
		const row = clamp(match.row, 0, Math.max(0, lines.length - 1));
		const line = lines[row] ?? '';
		const endColumn = Math.min(match.end, line.length);
		cursorRow = row;
		cursorColumn = clamp(match.start, 0, line.length);
		selectionAnchor = { row, column: endColumn };
		ensureCursorVisible();
		resetBlink();
	});
}

export function showReferenceStatusMessage(): void {
	const matches = referenceState.getMatches();
	const activeIndex = referenceState.getActiveIndex();
	if (matches.length === 0 || activeIndex < 0) {
		return;
	}
	const label = referenceState.getExpression() ?? '';
	showMessage(`Reference ${activeIndex + 1}/${matches.length} for ${label}`, constants.COLOR_STATUS_SUCCESS, 1.6);
}

export function handlePointerInput(_deltaSeconds: number): void {
	const ctrlDown = isModifierPressedGlobal(playerIndex, 'ControlLeft') || isModifierPressedGlobal(playerIndex, 'ControlRight');
	const metaDown = isModifierPressedGlobal(playerIndex, 'MetaLeft') || isModifierPressedGlobal(playerIndex, 'MetaRight');
	const gotoModifierActive = ctrlDown || metaDown;
	if (!gotoModifierActive) {
		clearGotoHoverHighlight();
	}
	const activeContext = getActiveCodeTabContext();
	const snapshot = readPointerSnapshot();
	updateTabHoverState(snapshot);
	lastPointerSnapshot = snapshot && snapshot.valid ? snapshot : null;
	if (!snapshot) {
		pointerPrimaryWasPressed = false;
		scrollbarController.cancel();
		lastPointerRowResolution = null;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (!snapshot.valid) {
		scrollbarController.cancel();
		clearGotoHoverHighlight();
		lastPointerRowResolution = null;
	} else if (scrollbarController.hasActiveDrag() && !snapshot.primaryPressed) {
		scrollbarController.cancel();
	} else if (scrollbarController.hasActiveDrag() && snapshot.primaryPressed) {
		if (scrollbarController.update(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, (k, s) => applyScrollbarScroll(k, s))) {
			pointerSelecting = false;
			clearHoverTooltip();
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
	const playerInput = $.input.getPlayerInput(playerIndex);
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
			endTabDrag();
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearGotoHoverHighlight();
			clearHoverTooltip();
			return;
		}
		if (snapshot.valid) {
			updateTabDrag(snapshot.viewportX, snapshot.viewportY);
		}
		pointerSelecting = false;
		pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		clearHoverTooltip();
		return;
	}
	if (justPressed && scrollbarController.begin(snapshot.viewportX, snapshot.viewportY, snapshot.primaryPressed, bottomMargin(), (k, s) => applyScrollbarScroll(k, s))) {
		pointerSelecting = false;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		pointerPrimaryWasPressed = snapshot.primaryPressed;
		return;
	}
	if (resourcePanelResizing && !snapshot.valid) {
		resourcePanelResizing = false;
		pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	if (!snapshot.valid) {
		pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (resourcePanelResizing) {
		if (!snapshot.primaryPressed) {
			resourcePanelResizing = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
		} else {
			const ok = resourcePanel.setRatioFromViewportX(snapshot.viewportX, viewportWidth);
			if (!ok) {
				hideResourcePanel();
			} else {
				invalidateVisualLines();
				/* hscroll handled inside controller */
			}
			resourcePanelFocused = true;
			pointerSelecting = false;
			resetPointerClickTracking();
			pointerPrimaryWasPressed = snapshot.primaryPressed;
		}
		clearGotoHoverHighlight();
		return;
	}
	if (problemsPanelResizing) {
		if (!snapshot.primaryPressed) {
			problemsPanelResizing = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
		} else {
			setProblemsPanelHeightFromViewportY(snapshot.viewportY);
			pointerSelecting = false;
			resetPointerClickTracking();
			pointerPrimaryWasPressed = snapshot.primaryPressed;
		}
		clearGotoHoverHighlight();
		return;
	}
	if (justPressed && snapshot.viewportY >= 0 && snapshot.viewportY < headerHeight) {
		if (handleTopBarPointer(snapshot)) {
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			clearGotoHoverHighlight();
			return;
		}
	}
	if (resourcePanelVisible && justPressed && isPointerOverResourcePanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		if (getResourcePanelWidth() > 0) {
			resourcePanelResizing = true;
			resourcePanelFocused = true;
			pointerSelecting = false;
			resetPointerClickTracking();
			pointerPrimaryWasPressed = snapshot.primaryPressed;
		}
		clearGotoHoverHighlight();
		return;
	}
	if (justPressed && problemsPanel.isVisible() && isPointerOverProblemsPanelDivider(snapshot.viewportX, snapshot.viewportY)) {
		problemsPanelResizing = true;
		pointerSelecting = false;
		resetPointerClickTracking();
		pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearGotoHoverHighlight();
		return;
	}
	const tabTop = headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	if (pointerAuxJustPressed && handleTabBarMiddleClick(snapshot)) {
		if (playerInput) {
			playerInput.consumeAction('pointer_aux');
		}
		pointerSelecting = false;
		pointerPrimaryWasPressed = snapshot.primaryPressed;
		resetPointerClickTracking();
		clearGotoHoverHighlight();
		return;
	}
	if (justPressed && snapshot.viewportY >= tabTop && snapshot.viewportY < tabBottom) {
		if (handleTabBarPointer(snapshot)) {
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			clearGotoHoverHighlight();
			return;
		}
	}
	const panelBounds = resourcePanel.getBounds();
	const pointerInPanel = resourcePanelVisible
		&& panelBounds !== null
		&& pointInRect(snapshot.viewportX, snapshot.viewportY, panelBounds);
	if (pointerInPanel) {
		resourcePanel.setFocused(true);
		resetPointerClickTracking();
		clearHoverTooltip();
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
		clearGotoHoverHighlight();
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
	const problemsBounds = getProblemsPanelBounds();
	if (problemsPanel.isVisible() && problemsBounds) {
		const insideProblems = pointInRect(snapshot.viewportX, snapshot.viewportY, problemsBounds);
		if (insideProblems) {
			if (problemsPanel.handlePointer(snapshot, justPressed, justReleased, problemsBounds)) {
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				resetPointerClickTracking();
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
		} else if (justPressed) {
			problemsPanel.setFocused(false);
		}
	}
	if (isResourceViewActive()) {
		resetPointerClickTracking();
		pointerSelecting = false;
		pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	if (pendingActionPrompt) {
		resetPointerClickTracking();
		if (justPressed) {
			handleActionPromptPointer(snapshot);
		}
		pointerSelecting = false;
		pointerPrimaryWasPressed = snapshot.primaryPressed;
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return;
	}
	const createResourceBounds = getCreateResourceBarBounds();
	if (createResourceVisible && createResourceBounds) {
		const insideCreateBar = pointInRect(snapshot.viewportX, snapshot.viewportY, createResourceBounds);
		if (insideCreateBar) {
			if (justPressed) {
				createResourceActive = true;
				cursorVisible = true;
				resetBlink();
				resourcePanelFocused = false;
			}
			const label = 'NEW FILE:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(createResourceField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			createResourceActive = false;
		}
	}
	const resourceSearchBounds = getResourceSearchBarBounds();
	if (resourceSearchVisible && resourceSearchBounds) {
		const insideResourceSearch = pointInRect(snapshot.viewportX, snapshot.viewportY, resourceSearchBounds);
		if (insideResourceSearch) {
			const baseHeight = lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
			const fieldBottom = resourceSearchBounds.top + baseHeight;
			const resultsStart = fieldBottom + constants.QUICK_OPEN_RESULT_SPACING;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					closeSearch(false, true);
					closeSymbolSearch(false);
					resourceSearchVisible = true;
					resourceSearchActive = true;
					resourcePanelFocused = false;
					cursorVisible = true;
					resetBlink();
				}
				const label = 'FILE :';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(resourceSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
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
					ensureResourceSearchSelectionVisible();
				}
				applyResourceSearchSelection(hoverIndex);
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			resourceSearchActive = false;
		}
		resourceSearchHoverIndex = -1;
	}
	const symbolBounds = getSymbolSearchBarBounds();
	if (symbolSearchVisible && symbolBounds) {
		const insideSymbol = pointInRect(snapshot.viewportX, snapshot.viewportY, symbolBounds);
		if (insideSymbol) {
			const baseHeight = lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
			const fieldBottom = symbolBounds.top + baseHeight;
			const resultsStart = fieldBottom + constants.SYMBOL_SEARCH_RESULT_SPACING;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					closeSearch(false, true);
					symbolSearchVisible = true;
					symbolSearchActive = true;
					resourcePanelFocused = false;
					cursorVisible = true;
					resetBlink();
				}
				const label = symbolSearchGlobal ? 'SYMBOL #:' : 'SYMBOL @:';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(symbolSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
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
					ensureSymbolSearchSelectionVisible();
				}
				applySymbolSearchSelection(hoverIndex);
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			symbolSearchActive = false;
		}
		symbolSearchHoverIndex = -1;
	}

	const renameBounds = getRenameBarBounds();
	if (isRenameVisible() && renameBounds) {
		const insideRename = pointInRect(snapshot.viewportX, snapshot.viewportY, renameBounds);
		if (insideRename) {
			if (justPressed) {
				resourcePanelFocused = false;
				cursorVisible = true;
				resetBlink();
			}
			const label = 'RENAME:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(renameController.getField(), textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			renameController.cancel();
		}
	}

	const lineJumpBounds = getLineJumpBarBounds();
	if (lineJumpVisible && lineJumpBounds) {
		const insideLineJump = pointInRect(snapshot.viewportX, snapshot.viewportY, lineJumpBounds);
		if (insideLineJump) {
			if (justPressed) {
				closeSearch(false, true);
				lineJumpActive = true;
				resetBlink();
			}
			const label = 'LINE #:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(lineJumpField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return;
		}
		if (justPressed) {
			lineJumpActive = false;
		}
	}
	const searchBounds = getSearchBarBounds();
	if (searchVisible && searchBounds) {
		const insideSearch = pointInRect(snapshot.viewportX, snapshot.viewportY, searchBounds);
		const baseHeight = lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
		const fieldBottom = searchBounds.top + baseHeight;
		const visibleResults = searchVisibleResultCount();
		if (insideSearch) {
			searchHoverIndex = -1;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					searchVisible = true;
					searchActive = true;
					resourcePanelFocused = false;
					cursorVisible = true;
					resetBlink();
				}
				const label = searchScope === 'global' ? 'SEARCH ALL:' : 'SEARCH:';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(searchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
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
						ensureSearchSelectionVisible();
						if (searchScope === 'local') {
							applySearchSelection(hoverIndex, { preview: true });
						}
					}
					applySearchSelection(hoverIndex);
					pointerSelecting = false;
					pointerPrimaryWasPressed = snapshot.primaryPressed;
					clearHoverTooltip();
					clearGotoHoverHighlight();
					return;
				}
				pointerSelecting = false;
				pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return;
			}
		} else if (justPressed) {
			searchActive = false;
			searchHoverIndex = -1;
		}
	} else {
		searchHoverIndex = -1;
	}

	const bounds = getCodeAreaBounds();
	if (processRuntimeErrorOverlayPointer(snapshot, justPressed, bounds.codeTop, bounds.codeRight, bounds.textLeft)) {
		// Keep primary pressed state in sync when overlay handles the event
		pointerPrimaryWasPressed = snapshot.primaryPressed;
		return;
	}
	const insideCodeArea = snapshot.viewportY >= bounds.codeTop
		&& snapshot.viewportY < bounds.codeBottom
		&& snapshot.viewportX >= bounds.codeLeft
		&& snapshot.viewportX < bounds.codeRight;
	if (justPressed && insideCodeArea) {
		clearReferenceHighlights();
		resourcePanelFocused = false;
		focusEditorFromLineJump();
		focusEditorFromSearch();
		focusEditorFromResourceSearch();
		focusEditorFromSymbolSearch();
		completion.closeSession();
		const targetRow = resolvePointerRow(snapshot.viewportY);
		const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
		if (gotoModifierActive && tryGotoDefinitionAt(targetRow, targetColumn)) {
			pointerSelecting = false;
			pointerPrimaryWasPressed = snapshot.primaryPressed;
			resetPointerClickTracking();
			return;
		}
		const doubleClick = registerPointerClick(targetRow, targetColumn);
		if (doubleClick) {
			selectWordAtPosition(targetRow, targetColumn);
			pointerSelecting = false;
		} else {
			selectionAnchor = { row: targetRow, column: targetColumn };
			setCursorPosition(targetRow, targetColumn);
			pointerSelecting = true;
		}
	}
	if (pointerSelecting && snapshot.primaryPressed) {
		clearGotoHoverHighlight();
		handlePointerAutoScroll(snapshot.viewportX, snapshot.viewportY);
		const targetRow = resolvePointerRow(snapshot.viewportY);
		const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
		if (!selectionAnchor) {
			selectionAnchor = { row: targetRow, column: targetColumn };
		}
		setCursorPosition(targetRow, targetColumn);
	}
	if (isCodeTabActive() && !snapshot.primaryPressed && !pointerSelecting && insideCodeArea && gotoModifierActive) {
		const hoverRow = resolvePointerRow(snapshot.viewportY);
		const hoverColumn = resolvePointerColumn(hoverRow, snapshot.viewportX);
		refreshGotoHoverHighlight(hoverRow, hoverColumn, activeContext);
	} else if (!gotoModifierActive || !insideCodeArea || snapshot.primaryPressed || pointerSelecting || !isCodeTabActive()) {
		clearGotoHoverHighlight();
	}
	if (isCodeTabActive()) {
		const altDown = isModifierPressedGlobal(playerIndex, 'AltLeft') || isModifierPressedGlobal(playerIndex, 'AltRight');
		if (!snapshot.primaryPressed && !pointerSelecting && insideCodeArea && altDown) {
			updateHoverTooltip(snapshot);
		} else {
			clearHoverTooltip();
		}
	} else {
		clearHoverTooltip();
	}
	pointerPrimaryWasPressed = snapshot.primaryPressed;
}

export function updateTabHoverState(snapshot: PointerSnapshot | null): void {
	if (!snapshot || !snapshot.valid || !snapshot.insideViewport) {
		tabHoverId = null;
		return;
	}
	const tabTop = headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		tabHoverId = null;
		return;
	}
	const x = snapshot.viewportX;
	let hovered: string | null = null;
	for (const [tabId, bounds] of tabButtonBounds) {
		if (pointInRect(x, y, bounds)) {
			hovered = tabId;
			break;
		}
	}
	tabHoverId = hovered;
}

export function updateHoverTooltip(snapshot: PointerSnapshot): void {
	const context = getActiveCodeTabContext();
	const assetId = resolveHoverAssetId(context);
	const row = resolvePointerRow(snapshot.viewportY);
	const column = resolvePointerColumn(row, snapshot.viewportX);
	const token = extractHoverExpression(row, column);
	if (!token) {
		clearHoverTooltip();
		return;
	}
	const chunkName = resolveHoverChunkName(context);
	const request: ConsoleLuaHoverRequest = {
		assetId,
		expression: token.expression,
		chunkName,
		row: row + 1,
		column: token.startColumn + 1,
	};
	const inspection = safeInspectLuaExpression(request);
	const previousInspection = lastInspectorResult;
	lastInspectorResult = inspection;
	if (!inspection) {
		clearHoverTooltip();
		return;
	}
	if (inspection.isFunction && (inspection.isLocalFunction || inspection.isBuiltin)) {
		clearHoverTooltip();
		return;
	}
	const contentLines = buildHoverContentLines(inspection);
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

export function buildHoverContentLines(result: ConsoleLuaHoverResult): string[] {
	return buildHoverContentLinesExternal(result);
}

export function clearHoverTooltip(): void {
	hoverTooltip = null;
	lastInspectorResult = null;
}

// Scrollbar drag is handled via scrollbarController

export function applyScrollbarScroll(kind: ScrollbarKind, scroll: number): void {
	if (Number.isNaN(scroll)) {
		return;
	}
	switch (kind) {
		case 'codeVertical': {
			ensureVisualLines();
			const rowCount = Math.max(1, cachedVisibleRowCount);
			const maxScroll = Math.max(0, getVisualLineCount() - rowCount);
			scrollRow = clamp(Math.round(scroll), 0, maxScroll);
			cursorRevealSuspended = true;
			break;
		}
		case 'codeHorizontal': {
			if (wordWrapEnabled) {
				scrollColumn = 0;
				break;
			}
			const maxScroll = computeMaximumScrollColumn();
			scrollColumn = clamp(Math.round(scroll), 0, maxScroll);
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
			const viewer = getActiveResourceViewer();
			if (!viewer) {
				break;
			}
			const capacity = resourceViewerTextCapacity(viewer);
			const maxScroll = Math.max(0, viewer.lines.length - capacity);
			viewer.scroll = clamp(Math.round(scroll), 0, maxScroll);
			break;
		}
	}
}

export function adjustHoverTooltipScroll(stepCount: number): boolean {
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

export function isPointInHoverTooltip(x: number, y: number): boolean {
	const tooltip = hoverTooltip;
	if (!tooltip || !tooltip.bubbleBounds) {
		return false;
	}
	return pointInRect(x, y, tooltip.bubbleBounds);
}

export function pointerHitsHoverTarget(snapshot: PointerSnapshot, tooltip: CodeHoverTooltip): boolean {
	if (!snapshot.valid || !snapshot.insideViewport) {
		return false;
	}
	const bounds = getCodeAreaBounds();
	if (snapshot.viewportY < bounds.codeTop || snapshot.viewportY >= bounds.codeBottom) {
		return false;
	}
	const row = resolvePointerRow(snapshot.viewportY);
	if (row !== tooltip.row) {
		return false;
	}
	const column = resolvePointerColumn(row, snapshot.viewportX);
	return column >= tooltip.startColumn && column <= tooltip.endColumn;
}

export function resolveHoverAssetId(context: CodeTabContext | null): string | null {
	if (context && context.descriptor) {
		return context.descriptor.assetId;
	}
	return primaryAssetId;
}

export function resolveHoverChunkName(context: CodeTabContext | null): string | null {
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

export function buildProjectReferenceContext(context: CodeTabContext | null): {
	environment: ProjectReferenceEnvironment;
	chunkName: string;
	normalizedPath: string | null;
	assetId: string | null;
} {
	const descriptor = context?.descriptor ?? null;
	const normalizedPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
	const descriptorAssetId = descriptor?.assetId ?? null;
	const resolvedAssetId = descriptorAssetId ?? primaryAssetId ?? null;
	const resolvedChunk = resolveHoverChunkName(context)
		?? normalizedPath
		?? descriptorAssetId
		?? resolvedAssetId
		?? '<console>';
	const environment: ProjectReferenceEnvironment = {
		activeContext: context,
		activeLines: lines,
		codeTabContexts: Array.from(codeTabContexts.values()),
		listResources: () => listResourcesStrict(),
		loadLuaResource: (resourceId: string) => loadLuaResourceFn(resourceId),
	};
	return {
		environment,
		chunkName: resolvedChunk,
		normalizedPath,
		assetId: resolvedAssetId,
	};
}

export function resolveSemanticDefinitionLocation(
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
	const activeContext = getActiveCodeTabContext();
	const hoverChunkName = resolveHoverChunkName(activeContext);
	const modelChunkName = chunkName ?? hoverChunkName ?? '<console>';
	const model = layout.getSemanticModel(lines, textVersion, modelChunkName);
	if (!model) {
		return null;
	}
	let definition = model.lookupIdentifier(usageRow, usageColumn, namePath);
	if (!definition) {
		definition = findDefinitionAtPosition(model.definitions, usageRow, usageColumn, namePath);
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

export function findDefinitionAtPosition(
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

export function extractHoverExpression(row: number, column: number): { expression: string; startColumn: number; endColumn: number } | null {
	if (row < 0 || row >= lines.length) {
		return null;
	}
	const line = lines[row] ?? '';
	const safeColumn = Math.min(Math.max(column, 0), Math.max(0, line.length));
	if (isLuaCommentContext(lines, row, safeColumn)) {
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

export function refreshGotoHoverHighlight(row: number, column: number, context: CodeTabContext | null): void {
	const token = extractHoverExpression(row, column);
	if (!token) {
		clearGotoHoverHighlight();
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
	const assetId = resolveHoverAssetId(context);
	const chunkName = resolveHoverChunkName(context);
	let definition = resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, assetId, chunkName);
	if (!definition) {
		const inspection = safeInspectLuaExpression({
			assetId,
			expression: token.expression,
			chunkName,
			row: row + 1,
			column: token.startColumn + 1,
		});
		definition = inspection?.definition ?? null;
	}
	if (!definition) {
		clearGotoHoverHighlight();
		return;
	}
	gotoHoverHighlight = {
		row,
		startColumn: token.startColumn,
		endColumn: token.endColumn,
		expression: token.expression,
	};
}

export function clearGotoHoverHighlight(): void {
	gotoHoverHighlight = null;
}

export function clearReferenceHighlights(): void {
	referenceState.clear();
}

export function tryGotoDefinitionAt(row: number, column: number): boolean {
	const context = getActiveCodeTabContext();
	const descriptor = context?.descriptor ?? null;
	const normalizedPath = descriptor?.path ? descriptor.path.replace(/\\/g, '/') : null;
	const assetId = resolveHoverAssetId(context);
	const token = extractHoverExpression(row, column);
	if (!token) {
		showMessage('Definition not found', constants.COLOR_STATUS_WARNING, 1.6);
		return false;
	}
	const chunkName = resolveHoverChunkName(context);
	let definition = resolveSemanticDefinitionLocation(context, token.expression, row + 1, token.startColumn + 1, assetId, chunkName);
	if (!definition) {
		const inspection = safeInspectLuaExpression({
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
			activeLines: lines,
			codeTabContexts: Array.from(codeTabContexts.values()),
			listResources: () => listResourcesStrict(),
			loadLuaResource: (resourceId: string) => loadLuaResourceFn(resourceId),
		};
		const projectDefinition = resolveDefinitionLocationForExpression({
			expression: token.expression,
			environment,
			workspace: semanticWorkspace,
			currentChunkName: resolvedChunkName,
			currentLines: lines,
			currentAssetId: assetId,
			sourceLabelPath: normalizedPath ?? descriptor?.assetId ?? null,
		});
		if (projectDefinition) {
			navigateToLuaDefinition(projectDefinition);
			return true;
		}
		if (!inspectorRequestFailed) {
			showMessage(`Definition not found for ${token.expression}`, constants.COLOR_STATUS_WARNING, 1.8);
		}
		return false;
	}
	navigateToLuaDefinition(definition);
	return true;
}

export function navigateToLuaDefinition(definition: ConsoleLuaDefinitionLocation): void {
	const navigationCheckpoint = beginNavigationCapture();
	clearReferenceHighlights();
	const hint: { assetId: string | null; path?: string | null } = { assetId: definition.assetId };
	if (definition.path !== undefined) {
		hint.path = definition.path;
	}
	let targetContextId: string | null = null;
	try {
		focusChunkSource(definition.chunkName, hint);
		const context = findCodeTabContext(definition.assetId ?? null, definition.chunkName ?? null);
		if (context) {
			targetContextId = context.id;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showMessage(`Failed to open definition: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
		return;
	}
	if (targetContextId) {
		setActiveTab(targetContextId);
	} else {
		activateCodeTab();
	}
	applyDefinitionSelection(definition.range);
	cursorRevealSuspended = false;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	completeNavigation(navigationCheckpoint);
	showMessage('Jumped to definition', constants.COLOR_STATUS_SUCCESS, 1.6);
}

export function applyDefinitionSelection(range: ConsoleLuaDefinitionLocation['range']): void {
	const lastRowIndex = Math.max(0, lines.length - 1);
	const startRow = clamp(range.startLine - 1, 0, lastRowIndex);
	const startLine = lines[startRow] ?? '';
	const startColumn = clamp(range.startColumn - 1, 0, startLine.length);
	cursorRow = startRow;
	cursorColumn = startColumn;
	selectionAnchor = null;
	pointerSelecting = false;
	pointerPrimaryWasPressed = false;
	pointerAuxWasPressed = false;
	updateDesiredColumn();
	resetBlink();
	cursorRevealSuspended = false;
	ensureCursorVisible();
}

export function beginNavigationCapture(): NavigationHistoryEntry | null {
	if (navigationCaptureSuspended) {
		return null;
	}
	if (!navigationHistory.current) {
		navigationHistory.current = createNavigationEntry();
	}
	const current = navigationHistory.current;
	return current ? cloneNavigationEntry(current) : null;
}

export function completeNavigation(previous: NavigationHistoryEntry | null): void {
	if (navigationCaptureSuspended) {
		return;
	}
	const next = createNavigationEntry();
	if (previous && (!next || !areNavigationEntriesEqual(previous, next))) {
		const backStack = navigationHistory.back;
		const lastBack = backStack[backStack.length - 1] ?? null;
		if (!lastBack || !areNavigationEntriesEqual(lastBack, previous)) {
			pushNavigationEntry(backStack, previous);
		}
		navigationHistory.forward.length = 0;
	} else if (previous && next && areNavigationEntriesEqual(previous, next)) {
		// Same location; do not mutate stacks.
	} else if (previous === null && next) {
		navigationHistory.forward.length = 0;
	}
	navigationHistory.current = next;
}

export function pushNavigationEntry(stack: NavigationHistoryEntry[], entry: NavigationHistoryEntry): void {
	stack.push(entry);
	const overflow = stack.length - NAVIGATION_HISTORY_LIMIT;
	if (overflow > 0) {
		stack.splice(0, overflow);
	}
}

export function areNavigationEntriesEqual(a: NavigationHistoryEntry, b: NavigationHistoryEntry): boolean {
	return a.contextId === b.contextId
		&& a.assetId === b.assetId
		&& a.chunkName === b.chunkName
		&& a.path === b.path
		&& a.row === b.row
		&& a.column === b.column;
}

export function cloneNavigationEntry(entry: NavigationHistoryEntry): NavigationHistoryEntry {
	return { ...entry };
}

export function createNavigationEntry(): NavigationHistoryEntry | null {
	if (!isCodeTabActive()) {
		return null;
	}
	const context = getActiveCodeTabContext();
	if (!context) {
		return null;
	}
	const assetId = resolveHoverAssetId(context);
	const chunkName = resolveHoverChunkName(context);
	const path = context.descriptor?.path ?? null;
	const maxRowIndex = lines.length > 0 ? lines.length - 1 : 0;
	const row = clamp(cursorRow, 0, maxRowIndex);
	const line = lines[row] ?? '';
	const column = clamp(cursorColumn, 0, line.length);
	return {
		contextId: context.id,
		assetId,
		chunkName,
		path,
		row,
		column,
	};
}

export function withNavigationCaptureSuspended<T>(operation: () => T): T {
	const previous = navigationCaptureSuspended;
	navigationCaptureSuspended = true;
	try {
		return operation();
	} finally {
		navigationCaptureSuspended = previous;
	}
}

export function applyNavigationEntry(entry: NavigationHistoryEntry): void {
	const existingContext = codeTabContexts.get(entry.contextId) ?? null;
	if (existingContext) {
		setActiveTab(entry.contextId);
	} else {
		const hint: { assetId: string | null; path?: string | null } = { assetId: entry.assetId };
		if (entry.path) {
			hint.path = entry.path;
		}
		focusChunkSource(entry.chunkName, hint);
		if (entry.contextId) {
			setActiveTab(entry.contextId);
		}
	}
	if (!isCodeTabActive()) {
		activateCodeTab();
	}
	if (!isCodeTabActive()) {
		return;
	}
	const maxRowIndex = lines.length > 0 ? lines.length - 1 : 0;
	const targetRow = clamp(entry.row, 0, maxRowIndex);
	const line = lines[targetRow] ?? '';
	const targetColumn = clamp(entry.column, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	clearSelection();
	cursorRevealSuspended = false;
	ensureCursorVisible();
}

export function goBackwardInNavigationHistory(): void {
	if (navigationHistory.back.length === 0) {
		return;
	}
	const currentEntry = createNavigationEntry();
	if (currentEntry) {
		const forwardStack = navigationHistory.forward;
		const lastForward = forwardStack[forwardStack.length - 1] ?? null;
		if (!lastForward || !areNavigationEntriesEqual(lastForward, currentEntry)) {
			pushNavigationEntry(forwardStack, currentEntry);
		}
	} else {
		navigationHistory.forward.length = 0;
	}
	const target = navigationHistory.back.pop()!;
	withNavigationCaptureSuspended(() => {
		applyNavigationEntry(target);
	});
	navigationHistory.current = createNavigationEntry();
}

export function goForwardInNavigationHistory(): void {
	if (navigationHistory.forward.length === 0) {
		return;
	}
	const currentEntry = createNavigationEntry();
	if (currentEntry) {
		const backStack = navigationHistory.back;
		const lastBack = backStack[backStack.length - 1] ?? null;
		if (!lastBack || !areNavigationEntriesEqual(lastBack, currentEntry)) {
			pushNavigationEntry(backStack, currentEntry);
		}
	}
	const target = navigationHistory.forward.pop()!;
	withNavigationCaptureSuspended(() => {
		applyNavigationEntry(target);
	});
	navigationHistory.current = createNavigationEntry();
}

export function handleActionPromptPointer(snapshot: PointerSnapshot): void {
	if (!pendingActionPrompt) {
		return;
	}
	const x = snapshot.viewportX;
	const y = snapshot.viewportY;
	const saveBounds = actionPromptButtons.saveAndContinue;
	if (saveBounds && pointInRect(x, y, saveBounds)) {
		void handleActionPromptSelection('save-continue');
		return;
	}
	if (pointInRect(x, y, actionPromptButtons.continue)) {
		void handleActionPromptSelection('continue');
		return;
	}
	if (pointInRect(x, y, actionPromptButtons.cancel)) {
		void handleActionPromptSelection('cancel');
	}
}

export function handleTopBarPointer(snapshot: PointerSnapshot): boolean {
	const y = snapshot.viewportY;
	if (y < 0 || y >= headerHeight) {
		return false;
	}
	const x = snapshot.viewportX;
	if (pointInRect(x, y, topBarButtonBounds.resume)) {
		handleTopBarButtonPress('resume');
		return true;
	}
	if (pointInRect(x, y, topBarButtonBounds.reboot)) {
		handleTopBarButtonPress('reboot');
		return true;
	}
	if (dirty && pointInRect(x, y, topBarButtonBounds.save)) {
		handleTopBarButtonPress('save');
		return true;
	}
	if (pointInRect(x, y, topBarButtonBounds.resources)) {
		handleTopBarButtonPress('resources');
		return true;
	}
	if (pointInRect(x, y, topBarButtonBounds.problems)) {
		handleTopBarButtonPress('problems');
		return true;
	}
	if (resourcePanelVisible && pointInRect(x, y, topBarButtonBounds.filter)) {
		handleTopBarButtonPress('filter');
		return true;
	}
	if (pointInRect(x, y, topBarButtonBounds.wrap)) {
		handleTopBarButtonPress('wrap');
		return true;
	}
	if (pointInRect(x, y, topBarButtonBounds.resolution)) {
		handleTopBarButtonPress('resolution');
		return true;
	}
	return false;
}

export function handleTabBarPointer(snapshot: PointerSnapshot): boolean {
	const tabTop = headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
	const y = snapshot.viewportY;
	if (y < tabTop || y >= tabBottom) {
		return false;
	}
	const x = snapshot.viewportX;
	for (let index = 0; index < tabs.length; index += 1) {
		const tab = tabs[index];
		const closeBounds = tabCloseButtonBounds.get(tab.id);
		if (closeBounds && pointInRect(x, y, closeBounds)) {
			endTabDrag();
			closeTab(tab.id);
			tabHoverId = null;
			return true;
		}
		const tabBounds = tabButtonBounds.get(tab.id);
		if (tabBounds && pointInRect(x, y, tabBounds)) {
			beginTabDrag(tab.id, x);
			setActiveTab(tab.id);
			return true;
		}
	}
	return false;
}

export function handleTabBarMiddleClick(snapshot: PointerSnapshot): boolean {
	const tabTop = headerHeight;
	const tabBottom = tabTop + getTabBarTotalHeight();
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
		if (pointInRect(x, y, bounds)) {
			closeTab(tab.id);
			return true;
		}
	}
	return false;
}

export function handlePointerWheel(): void {
	const playerInput = $.input.getPlayerInput(playerIndex);
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
	const shiftDown = isModifierPressedGlobal(playerIndex, 'ShiftLeft') || isModifierPressedGlobal(playerIndex, 'ShiftRight');
	if (hoverTooltip) {
		let canScrollTooltip = false;
		if (!pointer) {
			canScrollTooltip = true;
		} else if (pointer.valid && pointer.insideViewport) {
			if (isPointInHoverTooltip(pointer.viewportX, pointer.viewportY) || pointerHitsHoverTarget(pointer, hoverTooltip)) {
				canScrollTooltip = true;
			}
		}
		if (canScrollTooltip && adjustHoverTooltipScroll(direction * steps)) {
			playerInput.consumeAction('pointer_wheel');
			return;
		}
	}
	if (resourceSearchVisible) {
		const bounds = getResourceSearchBarBounds();
		const pointerInQuickOpen = bounds !== null
			&& pointer
			&& pointer.valid
			&& pointer.insideViewport
			&& pointInRect(pointer.viewportX, pointer.viewportY, bounds);
		if (pointerInQuickOpen || resourceSearchActive) {
			moveResourceSearchSelection(direction * steps);
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
		&& pointInRect(pointer.viewportX, pointer.viewportY, panelBounds);
	if (pointerInPanel) {
		if (shiftDown) {
			const horizontalPixels = direction * steps * charAdvance * 4;
			scrollResourceBrowserHorizontal(horizontalPixels);
			resourceBrowserEnsureSelectionVisible();
		} else {
			scrollResourceBrowser(direction * steps);
		}
		playerInput.consumeAction('pointer_wheel');
		return;
	}
	if (problemsPanel.isVisible()) {
		const bounds = getProblemsPanelBounds();
		if (bounds) {
			let allowScroll = false;
			if (!pointer) {
				allowScroll = problemsPanel.isFocused();
			} else if (pointer.valid && pointer.insideViewport && pointInRect(pointer.viewportX, pointer.viewportY, bounds)) {
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
	if (isResourceViewActive()) {
		scrollResourceViewer(direction * steps);
		playerInput.consumeAction('pointer_wheel');
		return;
	}
	if (isCodeTabActive() && pointer) {
		const bounds = getCodeAreaBounds();
		if (!pointer.valid || !pointer.insideViewport || pointer.viewportY < bounds.codeTop || pointer.viewportY >= bounds.codeBottom || pointer.viewportX < bounds.codeLeft || pointer.viewportX >= bounds.codeRight) {
			playerInput.consumeAction('pointer_wheel');
			return;
		}
	}
	scrollRows(direction * steps);
	cursorRevealSuspended = true;
	playerInput.consumeAction('pointer_wheel');
}

export function handleTopBarButtonPress(button: TopBarButtonId): void {
	switch (button) {
		case 'problems':
			toggleProblemsPanel();
			return;
		case 'filter':
			toggleResourcePanelFilterMode();
			return;
		case 'wrap':
			toggleWordWrap();
			return;
		case 'resolution':
			toggleResolutionMode();
			return;
		case 'resources':
			toggleResourcePanel();
			return;
		case 'save':
			if (dirty) {
				void save();
			}
			return;
		case 'resume':
		case 'reboot':
			activateCodeTab();
			if (dirty) {
				openActionPrompt(button);
				return;
			}
			performAction(button);
			return;
	}
}

export function openActionPrompt(action: PendingActionPrompt['action']): void {
	activateCodeTab();
	pendingActionPrompt = { action };
	actionPromptButtons.saveAndContinue = null;
	actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
	actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
	pointerSelecting = false;
	pointerPrimaryWasPressed = false;
}

export async function handleActionPromptSelection(choice: 'save-continue' | 'continue' | 'cancel'): Promise<void> {
	if (!pendingActionPrompt) {
		return;
	}
	if (choice === 'cancel') {
		resetActionPromptState();
		return;
	}
	if (choice === 'save-continue') {
		const saved = await attemptPromptSave(pendingActionPrompt.action);
		if (!saved) {
			return;
		}
	}
	const success = executePendingAction();
	if (success) {
		resetActionPromptState();
	}
}

export async function attemptPromptSave(action: PendingActionPrompt['action']): Promise<boolean> {
	if (action === 'close') {
		await save();
		return dirty === false;
	}
	await save();
	return dirty === false;
}

export function executePendingAction(): boolean {
	const prompt = pendingActionPrompt;
	if (!prompt) {
		return false;
	}
	return performAction(prompt.action);
}

export function performAction(action: PendingActionPrompt['action']): boolean {
	if (action === 'resume') {
		return performResume();
	}
	if (action === 'reboot') {
		return performReboot();
	}
	if (action === 'close') {
		deactivate();
		return true;
	}
	return false;
}

export function performResume(): boolean {
	const runtime = getConsoleRuntime();
	if (!runtime) {
		showMessage('Console runtime unavailable.', constants.COLOR_STATUS_ERROR, 4.0);
		return false;
	}
	if (!runtime.isLuaRuntimeFailed() && !hasPendingRuntimeReload()) {
		clearExecutionStopHighlights();
		deactivate();
		$.paused = false;
		return true;
	}
	let snapshot: unknown = null;
	try {
		snapshot = runtime.getState();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showMessage(`Failed to capture runtime state: ${message}`, constants.COLOR_STATUS_ERROR, 4.0);
		return false;
	}
	const sanitizedSnapshot = prepareRuntimeSnapshotForResume(snapshot);
	if (!sanitizedSnapshot) {
		showMessage('Runtime state unavailable.', constants.COLOR_STATUS_ERROR, 4.0);
		return false;
	}
	const targetGeneration = saveGeneration;
	const shouldUpdateGeneration = hasPendingRuntimeReload();
	clearExecutionStopHighlights();
	deactivate();
	scheduleRuntimeTask(() => {
		runtime.resumeFromSnapshot(sanitizedSnapshot);
		if (shouldUpdateGeneration) {
			appliedGeneration = targetGeneration;
		}
		$.paused = false;
	}, (error) => {
		handleRuntimeTaskError(error, 'Failed to resume game');
	});
	return true;
}

export function performReboot(): boolean {
	const runtime = getConsoleRuntime();
	if (!runtime) {
		showMessage('Console runtime unavailable.', constants.COLOR_STATUS_ERROR, 4.0);
		return false;
	}
	const requiresReload = hasPendingRuntimeReload();
	const savedSource = requiresReload ? getMainProgramSourceForReload() : null;
	const targetGeneration = saveGeneration;
	clearExecutionStopHighlights();
	deactivate();
	scheduleRuntimeTask(async () => {
		if (requiresReload && savedSource !== null) {
			await runtime.reloadLuaProgram(savedSource);
		}
		runtime.boot('editor:reboot');
		appliedGeneration = targetGeneration;
		$.paused = false;
	}, (error) => {
		handleRuntimeTaskError(error, 'Failed to reboot game');
	});
	return true;
}

// Indentation adjustments delegated to base class implementation.


export function toggleLineComments(): void {
	const range = getLineRangeForMovement();
	if (range.startRow < 0 || range.endRow < range.startRow) {
		return;
	}
	let allCommented = true;
	for (let row = range.startRow; row <= range.endRow; row++) {
		const line = lines[row];
		const commentIndex = firstNonWhitespaceIndex(line);
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
		removeLineComments(range);
	} else {
		addLineComments(range);
	}
}

export function addLineComments(range?: { startRow: number; endRow: number }): void {
	const target = range ?? getLineRangeForMovement();
	if (target.startRow < 0 || target.endRow < target.startRow) {
		return;
	}
	prepareUndo('comment-lines', false);
	let changed = false;
	for (let row = target.startRow; row <= target.endRow; row++) {
		const originalLine = lines[row];
		const insertIndex = firstNonWhitespaceIndex(originalLine);
		const hasContent = insertIndex < originalLine.length;
		let insertion = '--';
		if (hasContent) {
			const nextChar = originalLine.charAt(insertIndex);
			if (nextChar !== ' ' && nextChar !== '\t') {
				insertion = '-- ';
			}
		}
		const updatedLine = originalLine.slice(0, insertIndex) + insertion + originalLine.slice(insertIndex);
		lines[row] = updatedLine;
		invalidateLine(row);
		shiftPositionsForInsertion(row, insertIndex, insertion.length);
		changed = true;
	}
	if (!changed) {
		return;
	}
	clampCursorColumn();
	selectionAnchor = clampSelectionPosition(selectionAnchor);
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function removeLineComments(range?: { startRow: number; endRow: number }): void {
	const target = range ?? getLineRangeForMovement();
	if (target.startRow < 0 || target.endRow < target.startRow) {
		return;
	}
	prepareUndo('uncomment-lines', false);
	let changed = false;
	for (let row = target.startRow; row <= target.endRow; row++) {
		const originalLine = lines[row];
		const commentIndex = firstNonWhitespaceIndex(originalLine);
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
		lines[row] = updatedLine;
		invalidateLine(row);
		shiftPositionsForRemoval(row, commentIndex, removal);
		changed = true;
	}
	if (!changed) {
		return;
	}
	clampCursorColumn();
	selectionAnchor = clampSelectionPosition(selectionAnchor);
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function firstNonWhitespaceIndex(value: string): number {
	for (let index = 0; index < value.length; index++) {
		const ch = value.charAt(index);
		if (ch !== ' ' && ch !== '\t') {
			return index;
		}
	}
	return value.length;
}

export function shiftPositionsForInsertion(row: number, column: number, length: number): void {
	if (length <= 0) {
		return;
	}
	if (cursorRow === row && cursorColumn >= column) {
		cursorColumn += length;
	}
	if (selectionAnchor && selectionAnchor.row === row && selectionAnchor.column >= column) {
		selectionAnchor.column += length;
	}
}

export function shiftPositionsForRemoval(row: number, column: number, length: number): void {
	if (length <= 0) {
		return;
	}
	if (cursorRow === row && cursorColumn > column) {
		if (cursorColumn <= column + length) {
			cursorColumn = column;
		} else {
			cursorColumn -= length;
		}
	}
	if (selectionAnchor && selectionAnchor.row === row && selectionAnchor.column > column) {
		if (selectionAnchor.column <= column + length) {
			selectionAnchor.column = column;
		} else {
			selectionAnchor.column -= length;
		}
	}
}

export function revealCursor(): void {
	cursorRevealSuspended = false;
	ensureCursorVisible();
}

export function readPointerSnapshot(): PointerSnapshot | null {
	const playerInput = $.input.getPlayerInput(playerIndex);
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
	const mapped = mapScreenPointToViewport(coords[0], coords[1]);
	return {
		viewportX: mapped.x,
		viewportY: mapped.y,
		insideViewport: mapped.inside,
		valid: mapped.valid,
		primaryPressed,
	};
}

export function mapScreenPointToViewport(screenX: number, screenY: number): { x: number; y: number; inside: boolean; valid: boolean } {
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

export function getCodeAreaBounds(): { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; gutterLeft: number; gutterRight: number; textLeft: number; } {
	const codeTop = codeViewportTop();
	const codeBottom = viewportHeight - bottomMargin();
	const codeLeft = resourcePanelVisible ? getResourcePanelWidth() : 0;
	const codeRight = viewportWidth;
	const gutterLeft = codeLeft;
	const gutterRight = gutterLeft + gutterWidth;
	const textLeft = gutterRight + 2;
	return { codeTop, codeBottom, codeLeft, codeRight, gutterLeft, gutterRight, textLeft };
}

export function resolvePointerRow(viewportY: number): number {
	ensureVisualLines();
	const bounds = getCodeAreaBounds();
	const relativeY = viewportY - bounds.codeTop;
	const lineOffset = Math.floor(relativeY / lineHeight);
	let visualIndex = scrollRow + lineOffset;
	const visualCount = getVisualLineCount();
	if (visualIndex < 0) {
		visualIndex = 0;
	}
	if (visualCount > 0 && visualIndex > visualCount - 1) {
		visualIndex = visualCount - 1;
	}
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		lastPointerRowResolution = null;
		return clamp(visualIndex, 0, Math.max(0, lines.length - 1));
	}
	lastPointerRowResolution = { visualIndex, segment };
	return segment.row;
}

export function resolvePointerColumn(row: number, viewportX: number): number {
	const bounds = getCodeAreaBounds();
	const textLeft = bounds.textLeft;
	const line = lines[row] ?? '';
	if (line.length === 0) {
		return 0;
	}
	const entry = getCachedHighlight(row);
	const highlight = entry.hi;
	let segmentStartColumn = scrollColumn;
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
	const startDisplay = columnToDisplay(highlight, effectiveStartColumn);
	const offset = viewportX - textLeft;
	if (offset <= 0) {
		return effectiveStartColumn;
	}
	const baseAdvance = entry.advancePrefix[startDisplay] ?? 0;
	const target = baseAdvance + offset;
	const lower = lowerBound(entry.advancePrefix, target, startDisplay + 1, entry.advancePrefix.length);
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

export function handlePointerAutoScroll(viewportX: number, viewportY: number): void {
	if (!pointerSelecting) {
		return;
	}
	const bounds = getCodeAreaBounds();
	ensureVisualLines();
	if (viewportY < bounds.codeTop) {
		if (scrollRow > 0) {
			scrollRow -= 1;
		}
	}
	else if (viewportY >= bounds.codeBottom) {
		const lastRow = getVisualLineCount() - 1;
		if (scrollRow < lastRow) {
			scrollRow += 1;
		}
	}
	const maxScrollColumn = computeMaximumScrollColumn();
	if (viewportX < bounds.gutterLeft) {
		return;
	}
	if (!wordWrapEnabled) {
		if (viewportX < bounds.textLeft) {
			if (scrollColumn > 0) {
				scrollColumn -= 1;
			}
		}
		else if (viewportX >= bounds.codeRight) {
			if (scrollColumn < maxScrollColumn) {
				scrollColumn += 1;
			}
		}
	}
	if (scrollRow < 0) {
		scrollRow = 0;
	}
	if (scrollColumn < 0) {
		scrollColumn = 0;
	}
	if (wordWrapEnabled) {
		scrollColumn = 0;
	}
	const maxScrollRow = Math.max(0, getVisualLineCount() - visibleRowCount());
	if (scrollRow > maxScrollRow) {
		scrollRow = maxScrollRow;
	}
	if (!wordWrapEnabled && scrollColumn > maxScrollColumn) {
		scrollColumn = maxScrollColumn;
	}
}

export function registerPointerClick(row: number, column: number): boolean {
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

export function resetPointerClickTracking(): void {
	lastPointerClickTimeMs = 0;
	lastPointerClickRow = -1;
	lastPointerClickColumn = -1;
}

export function scrollRows(deltaRows: number): void {
	if (deltaRows === 0) {
		return;
	}
	ensureVisualLines();
	const maxScrollRow = Math.max(0, getVisualLineCount() - visibleRowCount());
	const targetRow = clamp(scrollRow + deltaRows, 0, maxScrollRow);
	scrollRow = targetRow;
}

// Cursor movement handled in ConsoleCartEditorTextOps base class.

// Word navigation implemented in base class.

// === InputController host wrappers ===
// Snapshot helpers used by controllers to bracket mutations
export function recordSnapshotPre(key: string): void {
	// Use non-coalesced snapshot to ensure distinct undo step
	prepareUndo(key, false);
}

export function recordSnapshotPost(_key: string): void {
	// Break coalescing to avoid merging unrelated edits
	breakUndoSequence();
}

export function deleteCharLeft(): void {
	backspace();
}

export function deleteCharRight(): void {
	deleteForward();
}

export function insertNewline(): void {
	insertLineBreak();
}

// cursor/grid manipulation now resides in ConsoleCartEditorTextOps base class.

export function applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
	searchQuery = value;
	setFieldText(searchField, value, moveCursorToEnd);
}

export function applySymbolSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	symbolSearchQuery = value;
	setFieldText(symbolSearchField, value, moveCursorToEnd);
}

export function applyResourceSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	resourceSearchQuery = value;
	setFieldText(resourceSearchField, value, moveCursorToEnd);
}

export function applyLineJumpFieldText(value: string, moveCursorToEnd: boolean): void {
	lineJumpValue = value;
	setFieldText(lineJumpField, value, moveCursorToEnd);
}

export function applyCreateResourceFieldText(value: string, moveCursorToEnd: boolean): void {
	createResourcePath = value;
	setFieldText(createResourceField, value, moveCursorToEnd);
}

export function inlineFieldMetrics(): InlineFieldMetrics {
	return inlineFieldMetricsRef;
}

export function createInlineFieldEditingHandlers(keyboard: KeyboardInput): InlineFieldEditingHandlers {
	return {
		isKeyJustPressed: (code) => isKeyJustPressedGlobal(playerIndex, code),
		isKeyTyped: (code) => isKeyTypedGlobal(playerIndex, code),
		shouldFireRepeat: (code, deltaSeconds) => input.shouldRepeatPublic(keyboard, code, deltaSeconds),
		consumeKey: (code) => consumeKeyboardKey(keyboard, code),
		readClipboard: () => customClipboard,
		writeClipboard: (payload, action) => {
			const message = action === 'copy'
				? 'Copied to editor clipboard'
				: 'Cut to editor clipboard';
			void writeClipboard(payload, message);
		},
		onClipboardEmpty: () => {
			showMessage('Editor clipboard is empty', constants.COLOR_STATUS_WARNING, 1.5);
		},
	};
}

export function processInlineFieldEditing(field: InlineTextField, keyboard: KeyboardInput, options: InlineInputOptions): boolean {
	return applyInlineFieldEditing(field, options, createInlineFieldEditingHandlers(keyboard));
}

export function processInlineFieldPointer(field: InlineTextField, textLeft: number, pointerX: number, justPressed: boolean, pointerPressed: boolean): void {
	const result = applyInlineFieldPointer(field, {
		metrics: inlineFieldMetrics(),
		textLeft,
		pointerX,
		justPressed,
		pointerPressed,
		now: () => $.platform.clock.now(),
		doubleClickInterval: constants.DOUBLE_CLICK_MAX_INTERVAL_MS,
	});
	if (result.requestBlinkReset) {
		resetBlink();
	}
}

export function updateDesiredColumn(): void {
	desiredColumn = cursorColumn;
	desiredDisplayOffset = 0;
	if (cursorRow < 0 || cursorRow >= lines.length) {
		return;
	}
	const entry = getCachedHighlight(cursorRow);
	const highlight = entry.hi;
	const cursorDisplay = columnToDisplay(highlight, cursorColumn);
	let segmentStartColumn = 0;
	if (wordWrapEnabled) {
		ensureVisualLines();
		const override = getCursorVisualOverride(cursorRow, cursorColumn);
		if (override) {
			segmentStartColumn = override.segmentStartColumn;
		} else {
			const visualIndex = positionToVisualIndex(cursorRow, cursorColumn);
			const segment = visualIndexToSegment(visualIndex);
			if (segment) {
				segmentStartColumn = segment.startColumn;
			}
		}
	}
	const segmentDisplayStart = columnToDisplay(highlight, segmentStartColumn);
	desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	if (desiredDisplayOffset < 0) {
		desiredDisplayOffset = 0;
	}
}

export async function save(): Promise<void> {
	const context = getActiveCodeTabContext();
	if (!context) {
		return;
	}
	const source = lines.join('\n');
	try {
		await context.save(source);
		dirty = false;
		saveGeneration = saveGeneration + 1;
		context.lastSavedSource = source;
		context.saveGeneration = saveGeneration;
		const isEntryContext = entryTabId !== null && context.id === entryTabId;
		if (isEntryContext) {
			lastSavedSource = source;
		}
		context.snapshot = captureSnapshot();
		updateActiveContextDirtyFlag();
		const message = isEntryContext ? 'Lua cart saved (restart pending)' : `${context.title} saved (restart pending)`;
		showMessage(message, constants.COLOR_STATUS_SUCCESS, 2.5);
	} catch (error) {
		if (tryShowLuaErrorOverlay(error)) {
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
	}
}

export function updateRuntimeErrorOverlay(deltaSeconds: number): void {
	const overlay = runtimeErrorOverlay;
	if (!overlay) {
		return;
	}
	if (!Number.isFinite(overlay.timer)) {
		return;
	}
	overlay.timer -= deltaSeconds;
	if (overlay.timer <= 0) {
		setActiveRuntimeErrorOverlay(null);
	}
}

export async function copySelectionToClipboard(): Promise<void> {
	const text = getSelectionText();
	if (text === null) {
		showMessage('Nothing selected to copy', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	await writeClipboard(text, 'Copied selection to clipboard');
}

export async function cutSelectionToClipboard(): Promise<void> {
	const text = getSelectionText();
	if (text === null) {
		showMessage('Nothing selected to cut', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	prepareUndo('cut', false);
	await writeClipboard(text, 'Cut selection to clipboard');
	replaceSelectionWith('');
}

export async function cutLineToClipboard(): Promise<void> {
	if (lines.length === 0) {
		showMessage('Nothing selected to cut', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const currentLineValue = currentLine();
	const isLastLine = cursorRow >= lines.length - 1;
	const text = isLastLine ? currentLineValue : currentLineValue + '\n';
	prepareUndo('cut-line', false);
	await writeClipboard(text, 'Cut line to clipboard');
	if (lines.length === 1) {
		lines[0] = '';
		cursorColumn = 0;
	} else {
		const removedRow = cursorRow;
		lines.splice(cursorRow, 1);
		if (cursorRow >= lines.length) {
			cursorRow = lines.length - 1;
		}
		const newLength = lines[cursorRow].length;
		if (cursorColumn > newLength) {
			cursorColumn = newLength;
		}
		invalidateHighlightsFromRow(Math.min(removedRow, lines.length - 1));
	}
	invalidateLine(cursorRow);
	selectionAnchor = null;
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function pasteFromClipboard(): void {
	const text = customClipboard;
	if (text === null || text.length === 0) {
		showMessage('Editor clipboard is empty', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	prepareUndo('paste', false);
	deleteSelectionIfPresent();
	insertClipboardText(text);
	showMessage('Pasted from editor clipboard', constants.COLOR_STATUS_SUCCESS, 1.5);
}

export async function writeClipboard(text: string, successMessage: string): Promise<void> {
	customClipboard = text;
	const clipboard = $.platform.clipboard;
	if (!clipboard.isSupported()) {
		const message = successMessage + ' (Editor clipboard only)';
		showMessage(message, constants.COLOR_STATUS_SUCCESS, 1.5);
		return;
	}
	try {
		await clipboard.writeText(text);
		showMessage(successMessage, constants.COLOR_STATUS_SUCCESS, 1.5);
	}
	catch (error) {
		showMessage('System clipboard write failed. Editor clipboard updated.', constants.COLOR_STATUS_WARNING, 3.5);
	}
}

export function captureSnapshot(): EditorSnapshot {
	const linesCopy = lines.slice();
	let selectionCopy: Position | null = null;
	if (selectionAnchor) {
		selectionCopy = { row: selectionAnchor.row, column: selectionAnchor.column };
	}
	return {
		lines: linesCopy,
		cursorRow: cursorRow,
		cursorColumn: cursorColumn,
		scrollRow: scrollRow,
		scrollColumn: scrollColumn,
		selectionAnchor: selectionCopy,
		dirty: dirty,
	};
}

export function restoreSnapshot(snapshot: EditorSnapshot, preserveSelection: boolean = false): void {
	const preservedSelection = preserveSelection && selectionAnchor
		? { row: selectionAnchor.row, column: selectionAnchor.column }
		: null;
	lines = snapshot.lines.slice();
	invalidateVisualLines();
	invalidateAllHighlights();
	markDiagnosticsDirty();
	cursorRow = snapshot.cursorRow;
	cursorColumn = snapshot.cursorColumn;
	scrollRow = snapshot.scrollRow;
	scrollColumn = snapshot.scrollColumn;
	if (!preserveSelection) {
		if (snapshot.selectionAnchor) {
			selectionAnchor = { row: snapshot.selectionAnchor.row, column: snapshot.selectionAnchor.column };
		} else {
			selectionAnchor = null;
		}
	} else {
		selectionAnchor = clampSelectionPosition(preservedSelection);
	}
	dirty = snapshot.dirty;
	bumpTextVersion();
	updateDesiredColumn();
	resetBlink();
	cursorRevealSuspended = false;
	updateActiveContextDirtyFlag();
	ensureCursorVisible();
	requestSemanticRefresh();
}

export function drawTopBar(api: BmsxConsoleApi): void {
	const host = {
		viewportWidth: viewportWidth,
		headerHeight: headerHeight,
		lineHeight: lineHeight,
		measureText: (text: string) => measureText(text),
		drawText: (api2: BmsxConsoleApi, text: string, x: number, y: number, color: number) => drawEditorText(api2, font, text, x, y, color),
		wordWrapEnabled: wordWrapEnabled,
		resolutionMode: resolutionMode,
		metadata: metadata,
		dirty: dirty,
		resourcePanelVisible: resourcePanelVisible,
		resourcePanelFilterMode: resourcePanel.getFilterMode(),
		problemsPanelVisible: problemsPanel.isVisible(),
		topBarButtonBounds: topBarButtonBounds,
	};
	renderTopBar(api, host);
}

export function drawCreateResourceBar(api: BmsxConsoleApi): void {
	const host = {
		viewportWidth: viewportWidth,
		headerHeight: headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: lineHeight,
		spaceAdvance: spaceAdvance,
		charAdvance: charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (api2: BmsxConsoleApi, t: string, x: number, y: number, c: number) => drawEditorText(api2, font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: createResourceActive,
		createResourceVisible: createResourceVisible,
		createResourceField: createResourceField,
		createResourceWorking: createResourceWorking,
		createResourceError: createResourceError,
		drawCreateResourceErrorDialog: (api4: BmsxConsoleApi, err: string) => drawCreateResourceErrorDialog(api4, err),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
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
		) => drawInlineCaret(api3, field, l, t, r, b, baseX, active, caretColor, textColor),
		inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
		inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
		inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
		blockActiveCarets: (problemsPanel.isVisible() && problemsPanel.isFocused()),
	};
	renderCreateResourceBar(api, host);
}

export function drawSearchBar(api: BmsxConsoleApi): void {
	const host: import('./render_inline_bars').InlineBarsHost = {
		viewportWidth: viewportWidth,
		headerHeight: headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: lineHeight,
		spaceAdvance: spaceAdvance,
		charAdvance: charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: createResourceActive,
		createResourceVisible: createResourceVisible,
		createResourceField: createResourceField,
		createResourceWorking: createResourceWorking,
		createResourceError: createResourceError,
		drawCreateResourceErrorDialog: (a, m) => drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
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
		) => drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
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
		searchResultEntries: getVisibleSearchResultEntries(),
		searchResultEntriesBaseOffset: searchDisplayOffset,
		searchSelectionIndex: searchCurrentIndex,
		searchHoverIndex: searchHoverIndex,
		searchDisplayOffset: searchDisplayOffset,
	};
	renderSearchBar(api, host);
}

export function drawResourceSearchBar(api: BmsxConsoleApi): void {
	const host: import('./render_inline_bars').InlineBarsHost = {
		viewportWidth: viewportWidth,
		headerHeight: headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: lineHeight,
		spaceAdvance: spaceAdvance,
		charAdvance: charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: createResourceActive,
		createResourceVisible: createResourceVisible,
		createResourceField: createResourceField,
		createResourceWorking: createResourceWorking,
		createResourceError: createResourceError,
		drawCreateResourceErrorDialog: (a, m) => drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
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
		) => drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
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

export function drawSymbolSearchBar(api: BmsxConsoleApi): void {
	const host: import('./render_inline_bars').InlineBarsHost = {
		viewportWidth: viewportWidth,
		headerHeight: headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: lineHeight,
		spaceAdvance: spaceAdvance,
		charAdvance: charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: createResourceActive,
		createResourceVisible: createResourceVisible,
		createResourceField: createResourceField,
		createResourceWorking: createResourceWorking,
		createResourceError: createResourceError,
		drawCreateResourceErrorDialog: (a, m) => drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
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
		) => drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
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

export function drawRenameBar(api: BmsxConsoleApi): void {
	const host: import('./render_inline_bars').InlineBarsHost = {
		viewportWidth: viewportWidth,
		headerHeight: headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: lineHeight,
		spaceAdvance: spaceAdvance,
		charAdvance: charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: createResourceActive,
		createResourceVisible: createResourceVisible,
		createResourceField: createResourceField,
		createResourceWorking: createResourceWorking,
		createResourceError: createResourceError,
		drawCreateResourceErrorDialog: (a, m) => drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
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
		) => drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
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

export function drawLineJumpBar(api: BmsxConsoleApi): void {
	const host: import('./render_inline_bars').InlineBarsHost = {
		viewportWidth: viewportWidth,
		headerHeight: headerHeight,
		tabBarHeight: getTabBarTotalHeight(),
		lineHeight: lineHeight,
		spaceAdvance: spaceAdvance,
		charAdvance: charAdvance,
		measureText: (t: string) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
		inlineFieldMetrics: () => inlineFieldMetrics(),
		createResourceActive: createResourceActive,
		createResourceVisible: createResourceVisible,
		createResourceField: createResourceField,
		createResourceWorking: createResourceWorking,
		createResourceError: createResourceError,
		drawCreateResourceErrorDialog: (a, m) => drawCreateResourceErrorDialog(a, m),
		getCreateResourceBarHeight: () => getCreateResourceBarHeight(),
		getSearchBarHeight: () => getSearchBarHeight(),
		getResourceSearchBarHeight: () => getResourceSearchBarHeight(),
		getSymbolSearchBarHeight: () => getSymbolSearchBarHeight(),
		getRenameBarHeight: () => getRenameBarHeight(),
		getLineJumpBarHeight: () => getLineJumpBarHeight(),
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
		) => drawInlineCaret(a, f, l, t, r, b, bx, ac, cc, tc),
		inlineFieldSelectionRange: (f: InlineTextField) => inlineFieldSelectionRange(f),
		inlineFieldMeasureRange: (f: InlineTextField, m: InlineFieldMetrics, s: number, e: number) => inlineFieldMeasureRange(f, m, s, e),
		inlineFieldCaretX: (f: InlineTextField, ox: number, m: (tx: string) => number) => inlineFieldCaretX(f, ox, m),
		blockActiveCarets: (problemsPanel.isVisible() && problemsPanel.isFocused()),
		lineJumpActive: lineJumpActive,
		lineJumpField: lineJumpField,
	};
	renderLineJumpBar(api, host);
}

export function drawCreateResourceErrorDialog(api: BmsxConsoleApi, message: string): void {
	const maxDialogWidth = Math.min(viewportWidth - 16, 360);
	const wrapWidth = Math.max(charAdvance, maxDialogWidth - (constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
	const segments = message.split(/\r?\n/);
	const lines: string[] = [];
	for (let i = 0; i < segments.length; i += 1) {
		const segment = segments[i].trim();
		const wrapped = wrapRuntimeErrorLineUtil(segment.length === 0 ? '' : segment, wrapWidth, (text) => measureText(text));
		for (let j = 0; j < wrapped.length; j += 1) {
			lines.push(wrapped[j]);
		}
	}
	if (lines.length === 0) {
		lines.push('');
	}
	let contentWidth = 0;
	for (let i = 0; i < lines.length; i += 1) {
		contentWidth = Math.max(contentWidth, measureText(lines[i]));
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

export function simplifyRuntimeErrorMessage(message: string): string {
	return message.replace(/^\[BmsxConsoleRuntime\]\s*/, '');
}

export function codeViewportTop(): number {
	return topMargin()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight()
		+ getRenameBarHeight()
		+ getLineJumpBarHeight();
}

export function getCreateResourceBarHeight(): number {
	if (!isCreateResourceVisible()) {
		return 0;
	}
	return lineHeight + constants.CREATE_RESOURCE_BAR_MARGIN_Y * 2;
}

export function isCreateResourceVisible(): boolean {
	return createResourceVisible;
}

export function getSearchBarHeight(): number {
	if (!isSearchVisible()) {
		return 0;
	}
	const baseHeight = lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const visible = searchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SEARCH_RESULT_SPACING + visible * searchResultEntryHeight();
}

export function isSearchVisible(): boolean {
	return searchVisible;
}

export function getResourceSearchBarHeight(): number {
	if (!isResourceSearchVisible()) {
		return 0;
	}
	const baseHeight = lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	const visible = resourceSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.QUICK_OPEN_RESULT_SPACING + visible * resourceSearchEntryHeight();
}

export function isResourceSearchVisible(): boolean {
	return resourceSearchVisible;
}

export function getSymbolSearchBarHeight(): number {
	if (!isSymbolSearchVisible()) {
		return 0;
	}
	const baseHeight = lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	const visible = symbolSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SYMBOL_SEARCH_RESULT_SPACING + visible * symbolSearchEntryHeight();
}

export function isSymbolSearchVisible(): boolean {
	return symbolSearchVisible;
}

export function getRenameBarHeight(): number {
	if (!isRenameVisible()) {
		return 0;
	}
	return lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
}

export function isRenameVisible(): boolean {
	return renameController.isVisible();
}

export function getLineJumpBarHeight(): number {
	if (!isLineJumpVisible()) {
		return 0;
	}
	return lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2;
}

export function isLineJumpVisible(): boolean {
	return lineJumpVisible;
}

export function getCreateResourceBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getCreateResourceBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = headerHeight + getTabBarTotalHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: viewportWidth,
	};
}

export function getSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = headerHeight + getTabBarTotalHeight() + getCreateResourceBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: viewportWidth,
	};
}

export function getResourceSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getResourceSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = headerHeight + getTabBarTotalHeight() + getCreateResourceBarHeight() + getSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: viewportWidth,
	};
}

export function getLineJumpBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getLineJumpBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight()
		+ getRenameBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: viewportWidth,
	};
}

export function getSymbolSearchBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getSymbolSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: viewportWidth,
	};
}

export function getRenameBarBounds(): { top: number; bottom: number; left: number; right: number } | null {
	const height = getRenameBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: viewportWidth,
	};
}

export function drawCodeArea(api: BmsxConsoleApi): void {
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
		scrollRow: scrollRow,
		scrollColumn: scrollColumn,
		cursorRow: cursorRow,
		cursorColumn: cursorColumn,
		cursorVisible: cursorVisible,
		cursorScreenInfo: cursorScreenInfo,
		gotoHoverHighlight: gotoHoverHighlight,
		executionStopRow: executionStopRow,
		lines: lines,
		// Helpers
		ensureVisualLines: () => ensureVisualLines(),
		getCodeAreaBounds: () => getCodeAreaBounds(),
		maximumLineLength: () => maximumLineLength(),
		getVisualLineCount: () => getVisualLineCount(),
		positionToVisualIndex: (r: number, c: number) => positionToVisualIndex(r, c),
		visualIndexToSegment: (v: number) => visualIndexToSegment(v),
		getCachedHighlight: (r: number) => getCachedHighlight(r),
		sliceHighlightedLine: (hi, start, count) => sliceHighlightedLine(hi, start, count),
		columnToDisplay: (hi, c) => columnToDisplay(hi, c),
		drawColoredText: (a, t, cols, x, y) => drawEditorColoredText(a, font, t, cols, x, y, constants.COLOR_CODE_TEXT),
		drawReferenceHighlightsForRow: (a, ri, e, ox, oy, s, ed) => drawReferenceHighlightsForRow(a, ri, e, ox, oy, s, ed),
		drawSearchHighlightsForRow: (a, ri, e, ox, oy, s, ed) => drawSearchHighlightsForRow(a, ri, e, ox, oy, s, ed),
		computeSelectionSlice: (ri, hi, s, e) => computeSelectionSlice(ri, hi, s, e),
		measureRangeFast: (entry, from, to) => measureRangeFast(entry, from, to),
		getDiagnosticsForRow: (row) => getDiagnosticsForRow(row),
		scrollbars: {
			codeVertical: scrollbars.codeVertical,
			codeHorizontal: scrollbars.codeHorizontal,
		},
		computeMaximumScrollColumn: () => computeMaximumScrollColumn(),
		// Overlays
		drawRuntimeErrorOverlay: (a, ct, cr, tl) => drawRuntimeErrorOverlay(a, ct, cr, tl),
		drawHoverTooltip: (a, ct, cb, tl) => drawHoverTooltip(a, ct, cb, tl),
		drawCursor: (a, info, tx) => drawCursor(a, info, tx),
		computeCursorScreenInfo: (entry, tl, rt, ssd) => computeCursorScreenInfo(entry, tl, rt, ssd),
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
	scrollRow = host.scrollRow;
	scrollColumn = host.scrollColumn;
	cursorScreenInfo = host.cursorScreenInfo;
}

export function drawRuntimeErrorOverlay(api: BmsxConsoleApi, codeTop: number, codeRight: number, textLeft: number): void {
	const overlay = runtimeErrorOverlay;
	if (!overlay) {
		return;
	}
	const layoutHost = createRuntimeErrorOverlayLayoutHost();
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

export function processRuntimeErrorOverlayPointer(snapshot: PointerSnapshot, justPressed: boolean, codeTop: number, codeRight: number, textLeft: number): boolean {
	const overlay = runtimeErrorOverlay;
	if (!overlay) {
		return false;
	}
	const layoutHost = createRuntimeErrorOverlayLayoutHost();
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
	const insideBubble = pointInRect(snapshot.viewportX, snapshot.viewportY, layout.bounds);
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
	resetPointerClickTracking();
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
			navigateToRuntimeErrorFrameTarget(clickResult.frame);
			return true;
		}
		case 'noop':
		default: {
			return true;
		}
	}
	return true;
}

export function createRuntimeErrorOverlayLayoutHost(): RuntimeErrorOverlayLayoutHost {
	return {
		ensureVisualLines: () => ensureVisualLines(),
		positionToVisualIndex: (row: number, column: number) => positionToVisualIndex(row, column),
		visibleRowCount: () => visibleRowCount(),
		scrollRow: scrollRow,
		visualIndexToSegment: (visualIndex: number) => visualIndexToSegment(visualIndex),
		getCachedHighlight: (rowIndex: number) => getCachedHighlight(rowIndex),
		wordWrapEnabled: wordWrapEnabled,
		scrollColumn: scrollColumn,
		visibleColumnCount: () => visibleColumnCount(),
		sliceHighlightedLine: (highlight, columnStart, columnCount) => sliceHighlightedLine(highlight, columnStart, columnCount),
		columnToDisplay: (highlight, column) => columnToDisplay(highlight, column),
		measureRangeFast: (entry, fromDisplay, toDisplay) => measureRangeFast(entry, fromDisplay, toDisplay),
		lineHeight: lineHeight,
		viewportHeight: viewportHeight,
		bottomMargin: bottomMargin(),
		measureText: (text: string) => measureText(text),
	};
}

export function navigateToRuntimeErrorFrameTarget(frame: RuntimeErrorStackFrame): void {
	if (frame.origin !== 'lua') {
		return;
	}
	const source = frame.source ?? '';
	if (source.length === 0) {
		showMessage('Runtime frame is missing a chunk reference.', constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	let normalizedChunk: string;
	try {
		normalizedChunk = normalizeChunkName(source);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showMessage(`Unable to resolve runtime chunk name: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	const frameAssetId = typeof frame.chunkAssetId === 'string' && frame.chunkAssetId.length > 0 ? frame.chunkAssetId : null;
	const framePath = typeof frame.chunkPath === 'string' && frame.chunkPath.length > 0 ? frame.chunkPath : null;
	let descriptor: ConsoleResourceDescriptor | null = null;
	if (!frameAssetId || !framePath) {
		try {
			descriptor = findResourceDescriptorForChunk(normalizedChunk);
		} catch {
			descriptor = null;
		}
	}
	const chunkHintAssetId = frameAssetId ?? descriptor?.assetId ?? null;
	const chunkHintPath = framePath ?? descriptor?.path ?? undefined;
	try {
		const hint = chunkHintAssetId !== null ? { assetId: chunkHintAssetId, path: chunkHintPath } : (descriptor ? { assetId: descriptor.assetId, path: descriptor.path } : undefined);
		focusChunkSource(normalizedChunk, hint);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showMessage(`Failed to open runtime chunk: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	const activeContext = getActiveCodeTabContext();
	if (!activeContext) {
		showMessage('Unable to activate editor context for runtime frame.', constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	const lastRowIndex = Math.max(0, lines.length - 1);
	let targetRow: number | null = null;
	if (typeof frame.line === 'number' && frame.line > 0) {
		targetRow = clamp(frame.line - 1, 0, lastRowIndex);
	}
	if (targetRow === null && frame.functionName) {
		targetRow = findFunctionDefinitionRowInActiveFile(frame.functionName);
	}
	if (targetRow === null) {
		targetRow = 0;
	}
	const targetLine = lines[targetRow] ?? '';
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
	selectionAnchor = null;
	pointerSelecting = false;
	resetPointerClickTracking();
	setCursorPosition(targetRow, targetColumn);
	cursorRevealSuspended = false;
	centerCursorVertically();
	ensureCursorVisible();
	showMessage('Navigated to call site', constants.COLOR_STATUS_SUCCESS, 1.6);
}

export function findFunctionDefinitionRowInActiveFile(functionName: string): number | null {
	if (typeof functionName !== 'string' || functionName.length === 0) {
		return null;
	}
	const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const patterns = [
		new RegExp(`^\\s*function\\s+${escaped}\\b`),
		new RegExp(`^\\s*local\\s+function\\s+${escaped}\\b`),
		new RegExp(`\\b${escaped}\\s*=\\s*function\\b`),
	];
	for (let row = 0; row < lines.length; row += 1) {
		const line = lines[row];
		for (let index = 0; index < patterns.length; index += 1) {
			if (patterns[index].test(line)) {
				return row;
			}
		}
	}
	return null;
}

export function isCodeTabActive(): boolean {
	return getActiveTabKind() === 'lua_editor';
}

export function isResourceViewActive(): boolean {
	return getActiveTabKind() === 'resource_view';
}

export function setActiveTab(tabId: string): void {
	const tab = tabs.find(candidate => candidate.id === tabId);
	if (!tab) {
		return;
	}
	const navigationCheckpoint = tab.kind === 'lua_editor' && tabId !== activeTabId
		? beginNavigationCapture()
		: null;
	closeSymbolSearch(true);
	const previousKind = getActiveTabKind();
	if (previousKind === 'lua_editor') {
		storeActiveCodeTabContext();
	}
	if (activeTabId === tabId) {
		if (tab.kind === 'resource_view') {
			enterResourceViewer(tab);
			runtimeErrorOverlay = null;
		} else if (tab.kind === 'lua_editor') {
			activateCodeEditorTab(tab.id);
			if (navigationCheckpoint) {
				completeNavigation(navigationCheckpoint);
			}
		}
		return;
	}
	activeTabId = tabId;
	if (tab.kind === 'resource_view') {
		enterResourceViewer(tab);
		runtimeErrorOverlay = null;
		return;
	}
	if (tab.kind === 'lua_editor') {
		activateCodeEditorTab(tab.id);
		if (navigationCheckpoint) {
			completeNavigation(navigationCheckpoint);
		}
	}
}

export function toggleResourcePanel(): void {
	// Keep editor/controller visibility in sync by delegating to controller
	resourcePanel.togglePanel();
}

export function toggleProblemsPanel(): void {
	if (problemsPanel.isVisible()) {
		hideProblemsPanel();
		return;
	}
	showProblemsPanel();
}

export function showProblemsPanel(): void {
	problemsPanel.show();
	markDiagnosticsDirty();
}

export function hideProblemsPanel(): void {
	problemsPanel.hide();
	focusEditorFromProblemsPanel();
}

export function toggleResourcePanelFilterMode(): void {
	// Controller owns filter state and messaging
	resourcePanel.toggleFilterMode();
}

export function toggleResolutionMode(): void {
	resolutionMode = resolutionMode === 'offscreen' ? 'viewport' : 'offscreen';
	refreshViewportDimensions(true);
	ensureCursorVisible();
	cursorRevealSuspended = false;
	applyResolutionModeToRuntime();
	const modeLabel = resolutionMode === 'offscreen' ? 'OFFSCREEN' : 'NATIVE';
	showMessage(`Editor resolution: ${modeLabel}`, constants.COLOR_STATUS_TEXT, 2.5);
}

export function toggleWordWrap(): void {
	ensureVisualLines();
	const previousWrap = wordWrapEnabled;
	const visualLineCount = getVisualLineCount();
	const previousTopIndex = clamp(scrollRow, 0, visualLineCount > 0 ? visualLineCount - 1 : 0);
	const previousTopSegment = visualIndexToSegment(previousTopIndex);
	const anchorRow = previousTopSegment ? previousTopSegment.row : cursorRow;
	const anchorColumnForWrap = previousTopSegment ? previousTopSegment.startColumn : 0;
	const anchorColumnForUnwrap = previousTopSegment
		? (previousWrap ? previousTopSegment.startColumn : scrollColumn)
		: scrollColumn;
	const previousCursorRow = cursorRow;
	const previousCursorColumn = cursorColumn;
	const previousDesiredColumn = desiredColumn;

	wordWrapEnabled = !previousWrap;
	cursorRevealSuspended = false;
	invalidateVisualLines();
	ensureVisualLines();

	cursorRow = clamp(previousCursorRow, 0, lines.length > 0 ? lines.length - 1 : 0);
	const currentLine = lines[cursorRow] ?? '';
	cursorColumn = clamp(previousCursorColumn, 0, currentLine.length);
	desiredColumn = previousDesiredColumn;

	if (wordWrapEnabled) {
		scrollColumn = 0;
		const anchorVisualIndex = positionToVisualIndex(anchorRow, anchorColumnForWrap);
		scrollRow = clamp(anchorVisualIndex, 0, Math.max(0, getVisualLineCount() - visibleRowCount()));
	} else {
		scrollColumn = clamp(anchorColumnForUnwrap, 0, computeMaximumScrollColumn());
		const anchorVisualIndex = positionToVisualIndex(anchorRow, scrollColumn);
		scrollRow = clamp(anchorVisualIndex, 0, Math.max(0, getVisualLineCount() - visibleRowCount()));
	}
	lastPointerRowResolution = null;
	ensureCursorVisible();
	updateDesiredColumn();
	const message = wordWrapEnabled ? 'Word wrap enabled' : 'Word wrap disabled';
	showMessage(message, constants.COLOR_STATUS_TEXT, 2.5);
}

export function applyResolutionModeToRuntime(): void {
	const runtime = getConsoleRuntime();
	if (!runtime) {
		return;
	}
	runtime.setEditorOverlayResolution(resolutionMode);
}

// showResourcePanel removed; controller handles visibility via toggle/show()

export function hideResourcePanel(): void {
	// Forward to controller; it resets its internal state
	resourcePanel.hide();
	resourcePanelFocused = false;
	resourcePanelResizing = false;
	resetResourcePanelState();
	invalidateVisualLines();
}

export function activateCodeTab(): void {
	const codeTab = tabs.find(candidate => candidate.kind === 'lua_editor');
	if (codeTab) {
		setActiveTab(codeTab.id);
		return;
	}
	if (entryTabId) {
		let context = codeTabContexts.get(entryTabId);
		if (!context) {
			context = createEntryTabContext();
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
		setActiveTab(context.id);
	}
}

export function openLuaCodeTab(descriptor: ConsoleResourceDescriptor): void {
	const navigationCheckpoint = beginNavigationCapture();
	const tabId: EditorTabId = `lua:${descriptor.assetId}`;
	let tab = tabs.find(candidate => candidate.id === tabId);
	if (!codeTabContexts.has(tabId)) {
		const context = createLuaCodeTabContext(descriptor);
		codeTabContexts.set(tabId, context);
	}
	const context = codeTabContexts.get(tabId) ?? null;
	if (!tab) {
		const dirty = context ? context.dirty : false;
		tab = {
			id: tabId,
			kind: 'lua_editor',
			title: computeResourceTabTitle(descriptor),
			closable: true,
			dirty,
			resource: undefined,
		};
		tabs.push(tab);
	} else {
		tab.title = computeResourceTabTitle(descriptor);
		if (context) {
			tab.dirty = context.dirty;
		}
	}
	setActiveTab(tabId);
	completeNavigation(navigationCheckpoint);
}

export function openResourceViewerTab(descriptor: ConsoleResourceDescriptor): void {
	const tabId: EditorTabId = `resource:${descriptor.assetId}`;
	let tab = tabs.find(candidate => candidate.id === tabId);
	const state = buildResourceViewerState(descriptor);
	resourceViewerClampScroll(state);
	if (tab) {
		tab.title = state.title;
		tab.resource = state;
		tab.dirty = false;
		setActiveTab(tabId);
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
	setActiveTab(tabId);
}

export function closeActiveTab(): void {
	if (!activeTabId) {
		return;
	}
	closeTab(activeTabId);
}

export function closeTab(tabId: string): void {
	const index = tabs.findIndex(tab => tab.id === tabId);
	if (index === -1) {
		return;
	}
	if (tabDragState && tabDragState.tabId === tabId) {
		endTabDrag();
	}
	const tab = tabs[index];
	if (!tab.closable) {
		return;
	}
	const wasActiveContext = tab.kind === 'lua_editor' && activeCodeTabContextId === tab.id;
	if (wasActiveContext) {
		storeActiveCodeTabContext();
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
			setActiveTab(fallback.id);
		} else {
			activeTabId = null;
			activeCodeTabContextId = null;
			resetEditorContent();
		}
	}
}

export function cycleTab(direction: number): void {
	if (tabs.length <= 1 || direction === 0) {
		return;
	}
	const count = tabs.length;
	let currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
	if (currentIndex === -1) {
		const fallbackIndex = direction > 0 ? 0 : count - 1;
		const fallback = tabs[fallbackIndex];
		if (fallback) {
			setActiveTab(fallback.id);
		}
		return;
	}
	let nextIndex = currentIndex + direction;
	nextIndex = ((nextIndex % count) + count) % count;
	if (nextIndex === currentIndex) {
		return;
	}
	const target = tabs[nextIndex];
	setActiveTab(target.id);
}

export function measureTabWidth(tab: EditorTabDescriptor): number {
	const textWidth = measureText(tab.title);
	let indicatorWidth = 0;
	if (tab.closable) {
		indicatorWidth = measureText(constants.TAB_CLOSE_BUTTON_SYMBOL) + constants.TAB_CLOSE_BUTTON_PADDING_X * 2;
	} else if (tab.dirty) {
		const metrics = getTabDirtyMarkerMetrics();
		indicatorWidth = metrics.width + constants.TAB_DIRTY_MARKER_SPACING;
	}
	return textWidth + constants.TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
}

export function computeTabLayout(): Array<{ id: string; left: number; right: number; width: number; center: number; rowIndex: number }> {
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
		const width = measureTabWidth(tab);
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

export function beginTabDrag(tabId: string, pointerX: number): void {
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

export function updateTabDrag(pointerX: number, pointerY: number): void {
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
		resetPointerClickTracking();
	}
	const layout = computeTabLayout();
	const currentIndex = layout.findIndex(item => item.id === state.tabId);
	if (currentIndex === -1) {
		return;
	}
	const dragged = layout[currentIndex];
	const pointerLeft = pointerX - state.pointerOffset;
	const pointerCenter = pointerLeft + Math.max(dragged.width, 1) * 0.5;
	const totalTabHeight = getTabBarTotalHeight();
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

export function endTabDrag(): void {
	if (!tabDragState) {
		return;
	}
	tabDragState = null;
}

export function resetEditorContent(): void {
	lines = [''];
	invalidateVisualLines();
	markDiagnosticsDirty();
	cursorRow = 0;
	cursorColumn = 0;
	scrollRow = 0;
	scrollColumn = 0;
	selectionAnchor = null;
	lastSavedSource = '';
	invalidateAllHighlights();
	bumpTextVersion();
	dirty = false;
	updateActiveContextDirtyFlag();
	syncRuntimeErrorOverlayFromContext(null);
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
	requestSemanticRefresh();
}

export function resetResourcePanelState(): void {
	resourceBrowserItems = [];
	resourceBrowserSelectionIndex = -1;
	// max line width handled by controller
	pendingResourceSelectionAssetId = null;
	resourcePanelResizing = false;
}

export function refreshResourcePanelContents(): void {
	// New path owned by ResourcePanelController
	resourcePanel.refresh();
	const s = resourcePanel.getStateForRender();
	resourcePanelResourceCount = s.items.length;
	resourceBrowserItems = s.items;
	resourceBrowserSelectionIndex = s.selectionIndex;
}

export function enterResourceViewer(tab: EditorTabDescriptor): void {
	closeSearch(false, true);
	closeLineJump(false);
	cursorRevealSuspended = false;
	tab.dirty = false;
	// hover state handled by controller; no-op here
	if (!tab.resource) {
		return;
	}
	resourceViewerClampScroll(tab.resource);
}

// buildResourceBrowserItems removed; ResourcePanelController owns item tree construction

// updateResourceBrowserMetrics removed; controller computes metrics

export function selectResourceInPanel(descriptor: ConsoleResourceDescriptor): void {
	if (!descriptor.assetId || descriptor.assetId.length === 0) {
		return;
	}
	pendingResourceSelectionAssetId = descriptor.assetId;
	if (!resourcePanelVisible) {
		return;
	}
	applyPendingResourceSelection();
}

export function applyPendingResourceSelection(): void {
	if (!resourcePanelVisible) {
		return;
	}
	const assetId = pendingResourceSelectionAssetId;
	if (!assetId) {
		return;
	}
	const index = findResourcePanelIndexByAssetId(assetId);
	if (index === -1) {
		return;
	}
	resourceBrowserSelectionIndex = index;
	resourceBrowserEnsureSelectionVisible();
	pendingResourceSelectionAssetId = null;
}

export function findResourcePanelIndexByAssetId(assetId: string): number {
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

export function createEntryTabContext(): CodeTabContext | null {
	const assetId = (typeof primaryAssetId === 'string' && primaryAssetId.length > 0)
		? primaryAssetId
		: null;
	const descriptor = assetId ? findResourceDescriptorByAssetId(assetId) : null;
	const resolvedAssetId = descriptor ? descriptor.assetId : (assetId ?? '__entry__');
	const tabId: string = `lua:${resolvedAssetId}`;
	const title = descriptor
		? computeResourceTabTitle(descriptor)
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

export function createLuaCodeTabContext(descriptor: ConsoleResourceDescriptor): CodeTabContext {
	const title = computeResourceTabTitle(descriptor);
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

export function getActiveCodeTabContext(): CodeTabContext | null {
	if (!activeCodeTabContextId) {
		return null;
	}
	return codeTabContexts.get(activeCodeTabContextId) ?? null;
}

export function storeActiveCodeTabContext(): void {
	const context = getActiveCodeTabContext();
	if (!context) {
		return;
	}
	context.snapshot = captureSnapshot();
	if (entryTabId && context.id === entryTabId) {
		context.lastSavedSource = lastSavedSource;
	}
	context.saveGeneration = saveGeneration;
	context.appliedGeneration = appliedGeneration;
	context.dirty = dirty;
	context.runtimeErrorOverlay = runtimeErrorOverlay;
	context.executionStopRow = executionStopRow;
	setTabDirty(context.id, context.dirty);
}

export function activateCodeEditorTab(tabId: string | null): void {
	if (!tabId) {
		return;
	}
	let context = codeTabContexts.get(tabId);
	if (!context) {
		if (entryTabId && tabId === entryTabId) {
			const recreated = createEntryTabContext();
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
		restoreSnapshot(context.snapshot);
		saveGeneration = context.saveGeneration;
		appliedGeneration = context.appliedGeneration;
		if (isEntry) {
			lastSavedSource = context.lastSavedSource;
		}
		context.dirty = dirty;
		setTabDirty(context.id, context.dirty);
		syncRuntimeErrorOverlayFromContext(context);
		invalidateAllHighlights();
		updateDesiredColumn();
		ensureCursorVisible();
		refreshActiveDiagnostics();
		const chunkNameSnapshot = resolveHoverChunkName(context) ?? '<console>';
		layout.forceSemanticUpdate(lines, textVersion, chunkNameSnapshot);
		return;
	}
	const source = context.load();
	context.lastSavedSource = source;
	lines = splitLines(source);
	invalidateVisualLines();
	markDiagnosticsDirty();
	if (lines.length === 0) {
		lines.push('');
	}
	invalidateAllHighlights();
	cursorRow = 0;
	cursorColumn = 0;
	scrollRow = 0;
	scrollColumn = 0;
	selectionAnchor = null;
	dirty = false;
	context.dirty = false;
	context.runtimeErrorOverlay = null;
	context.executionStopRow = null;
	executionStopRow = null;
	saveGeneration = context.saveGeneration;
	appliedGeneration = context.appliedGeneration;
	if (isEntry) {
		lastSavedSource = context.lastSavedSource;
	}
	setTabDirty(context.id, context.dirty);
	syncRuntimeErrorOverlayFromContext(context);
	bumpTextVersion();
	const chunkName = resolveHoverChunkName(context) ?? '<console>';
	layout.forceSemanticUpdate(lines, textVersion, chunkName);
	updateDesiredColumn();
	resetBlink();
	pointerSelecting = false;
	pointerPrimaryWasPressed = false;
	refreshActiveDiagnostics();
}

export function getMainProgramSourceForReload(): string {
	const entryId = entryTabId;
	if (!entryId) {
		return loadSourceFn();
	}
	const context = codeTabContexts.get(entryId);
	if (!context) {
		return loadSourceFn();
	}
	if (context.id === activeCodeTabContextId) {
		return lines.join('\n');
	}
	if (context.snapshot) {
		return context.snapshot.lines.join('\n');
	}
	if (context.lastSavedSource.length > 0) {
		return context.lastSavedSource;
	}
	return context.load();
}

export function buildResourceViewerState(descriptor: ConsoleResourceDescriptor): ResourceViewerState {
	const title = computeResourceTabTitle(descriptor);
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
					appendResourceViewerLines(lines, ['-- Lua Source --', '']);
					appendResourceViewerLines(lines, source.split(/\r?\n/));
				} else {
					error = `Lua source '${descriptor.assetId}' unavailable.`;
				}
				break;
			}
			case 'code': {
				const dataEntry = rompack.data?.[descriptor.assetId];
				if (typeof dataEntry === 'string') {
					appendResourceViewerLines(lines, ['-- Code --', '']);
					appendResourceViewerLines(lines, dataEntry.split(/\r?\n/));
				} else if (dataEntry !== undefined) {
					const json = safeJsonStringify(dataEntry);
					appendResourceViewerLines(lines, ['-- Code --', '']);
					appendResourceViewerLines(lines, json.split(/\r?\n/));
				} else if (typeof rompack.code === 'string') {
					appendResourceViewerLines(lines, ['-- Game Code --', '']);
					appendResourceViewerLines(lines, rompack.code.split(/\r?\n/));
				} else {
					error = `Code asset '${descriptor.assetId}' unavailable.`;
				}
				break;
			}
			case 'data':
			case 'rommanifest': {
				const data = rompack.data?.[descriptor.assetId];
				if (data !== undefined) {
					const json = safeJsonStringify(data);
					appendResourceViewerLines(lines, ['-- Data --', '']);
					appendResourceViewerLines(lines, json.split(/\r?\n/));
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
				appendResourceViewerLines(lines, ['-- Image Metadata --']);
				if (Number.isFinite(width) && Number.isFinite(height)) {
					appendResourceViewerLines(lines, [`Dimensions: ${width}x${height}`]);
				}
				if (typeof atlassed === 'boolean') {
					appendResourceViewerLines(lines, [`Atlassed: ${atlassed ? 'yes' : 'no'}`]);
				}
				if (atlasId !== undefined) {
					appendResourceViewerLines(lines, [`Atlas ID: ${atlasId}`]);
				}
				for (const [key, value] of Object.entries(meta)) {
					if (['width', 'height', 'atlassed', 'atlasid'].includes(key)) {
						continue;
					}
					appendResourceViewerLines(lines, [`${key}: ${describeMetadataValue(value)}`]);
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
				appendResourceViewerLines(lines, ['-- Audio Metadata --']);
				const bufferSize = (audio.buffer as { byteLength?: number } | undefined)?.byteLength;
				if (typeof bufferSize === 'number') {
					appendResourceViewerLines(lines, [`Buffer Size: ${bufferSize} bytes`]);
				}
				for (const [key, value] of Object.entries(meta)) {
					appendResourceViewerLines(lines, [`${key}: ${describeMetadataValue(value)}`]);
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
				appendResourceViewerLines(lines, ['-- Model Metadata --', `Keys: ${keys.join(', ')}`]);
				break;
			}
			case 'aem': {
				const events = rompack.audioevents?.[descriptor.assetId];
				if (!events) {
					error = `Audio event map '${descriptor.assetId}' not found.`;
					break;
				}
				const json = safeJsonStringify(events);
				appendResourceViewerLines(lines, ['-- Audio Events --', '']);
				appendResourceViewerLines(lines, json.split(/\r?\n/));
				break;
			}
			default: {
				appendResourceViewerLines(lines, ['<no preview available for this asset type>']);
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
	trimResourceViewerLines(lines);
	state.error = error;
	return state;
}

export function computeResourceTabTitle(descriptor: ConsoleResourceDescriptor): string {
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

export function appendResourceViewerLines(target: string[], additions: Iterable<string>): void {
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

export function trimResourceViewerLines(lines: string[]): void {
	if (lines.length > constants.RESOURCE_VIEWER_MAX_LINES) {
		lines.length = constants.RESOURCE_VIEWER_MAX_LINES - 1;
		lines.push('<content truncated>');
	}
}

export function safeJsonStringify(value: unknown, space = 2): string {
	return JSON.stringify(value, (_key, val) => {
		if (typeof val === 'bigint') {
			return Number(val);
		}
		return val;
	}, space);
}

export function describeMetadataValue(value: unknown): string {
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
		const preview = value.slice(0, 4).map(entry => describeMetadataValue(entry)).join(', ');
		return `[${preview}${value.length > 4 ? ', …' : ''}]`;
	}
	if (typeof value === 'object') {
		const keys = Object.keys(value as Record<string, unknown>);
		return `{${keys.join(', ')}}`;
	}
	return String(value);
}

export function getViewportMetrics(): ViewportMetrics {
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

export function computePanelRatioBounds(): { min: number; max: number } {
	const minRatio = constants.RESOURCE_PANEL_MIN_RATIO;
	const minEditorRatio = constants.RESOURCE_PANEL_MIN_EDITOR_RATIO;
	const availableForPanel = Math.max(0, 1 - minEditorRatio);
	const maxRatio = Math.max(minRatio, Math.min(constants.RESOURCE_PANEL_MAX_RATIO, availableForPanel));
	return { min: minRatio, max: maxRatio };
}

export function clampResourcePanelRatio(ratio: number | null): number {
	const bounds = computePanelRatioBounds();
	let resolved = ratio ?? defaultResourcePanelRatio();
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

export function defaultResourcePanelRatio(): number {
	const metrics = getViewportMetrics();
	const viewportWidth = metrics.windowInner.width;
	const screenWidth = metrics.screen.width;
	const relative = Math.min(1, viewportWidth / screenWidth);
	const responsiveness = 1 - relative;
	const ratio = constants.RESOURCE_PANEL_DEFAULT_RATIO + responsiveness * (constants.RESOURCE_PANEL_MAX_RATIO - constants.RESOURCE_PANEL_DEFAULT_RATIO) * 0.6;
	const bounds = computePanelRatioBounds();
	return Math.max(bounds.min, Math.min(bounds.max, ratio));
}

export function computePanelPixelWidth(ratio: number): number {
	if (!Number.isFinite(ratio) || ratio <= 0 || viewportWidth <= 0) {
		return 0;
	}
	return Math.floor(viewportWidth * ratio);
}

export function getResourcePanelWidth(): number {
	if (!resourcePanelVisible) return 0;
	const bounds = resourcePanel.getBounds();
	return bounds ? Math.max(0, bounds.right - bounds.left) : 0;
}

// getResourcePanelBounds removed; use resourcePanel.getBounds()

export function isPointerOverResourcePanelDivider(x: number, y: number): boolean {
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

export function scrollResourceBrowser(amount: number): void {
	if (!resourcePanelVisible) return;
	resourcePanel.scrollBy(amount);
	// controller owns scroll; no local mirror required
}

export function resourceViewerImageLayout(viewer: ResourceViewerState): { left: number; top: number; width: number; height: number; bottom: number; scale: number } | null {
	const info = viewer.image;
	if (!info) {
		return null;
	}
	const width = Math.max(1, info.width);
	const height = Math.max(1, info.height);
	const bounds = getCodeAreaBounds();
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

export function resourceViewerTextCapacity(viewer: ResourceViewerState): number {
	const bounds = getCodeAreaBounds();
	const contentTop = bounds.codeTop + 2;
	const layout = resourceViewerImageLayout(viewer);
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

export function ensureResourceViewerSprite(api: BmsxConsoleApi, assetId: string, layout: { left: number; top: number; scale: number }): void {
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

export function hideResourceViewerSprite(api: BmsxConsoleApi): void {
	if (!resourceViewerSpriteId) {
		return;
	}
	const object = api.world_object(resourceViewerSpriteId);
	if (object) {
		object.visible = false;
	}
}

export function resourceViewerClampScroll(viewer: ResourceViewerState): void {
	const capacity = resourceViewerTextCapacity(viewer);
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
export function resourceBrowserEnsureSelectionVisible(): void {
	if (!resourcePanelVisible) return;
	resourcePanel.ensureSelectionVisiblePublic();
	// controller owns scroll; no local mirror required
}

export function scrollResourceBrowserHorizontal(delta: number): void {
	if (!resourcePanelVisible) return;
	const s = resourcePanel.getStateForRender();
	resourcePanel.setHScroll(s.hscroll + delta);
}

// moved to ResourcePanelController

export function scrollResourceViewer(amount: number): void {
	const viewer = getActiveResourceViewer();
	if (!viewer) {
		return;
	}
	const capacity = resourceViewerTextCapacity(viewer);
	if (capacity <= 0) {
		viewer.scroll = 0;
		return;
	}
	const maxScroll = Math.max(0, viewer.lines.length - capacity);
	viewer.scroll = clamp(viewer.scroll + amount, 0, maxScroll);
	resourceViewerClampScroll(viewer);
}

// moved to ResourcePanelController


export function handleResourceViewerInput(keyboard: KeyboardInput, deltaSeconds: number): void {
	const viewer = getActiveResourceViewer();
	if (!viewer) {
		return;
	}
	const ctrlDown = isModifierPressedGlobal(playerIndex, 'ControlLeft') || isModifierPressedGlobal(playerIndex, 'ControlRight');
	const metaDown = isModifierPressedGlobal(playerIndex, 'MetaLeft') || isModifierPressedGlobal(playerIndex, 'MetaRight');
	const shiftDown = isModifierPressedGlobal(playerIndex, 'ShiftLeft') || isModifierPressedGlobal(playerIndex, 'ShiftRight');
	if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressedGlobal(playerIndex, 'KeyR')) {
		consumeKeyboardKey(keyboard, 'KeyR');
		toggleResolutionMode();
		return;
	}
	const capacity = resourceViewerTextCapacity(viewer);
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
		const triggered = isKeyJustPressedGlobal(playerIndex, entry.code) || shouldFireRepeat(keyboard, entry.code, deltaSeconds);
		if (!triggered) {
			continue;
		}
		consumeKeyboardKey(keyboard, entry.code);
		if (entry.delta === Number.NEGATIVE_INFINITY) {
			viewer.scroll = 0;
		} else if (entry.delta === Number.POSITIVE_INFINITY) {
			viewer.scroll = Math.max(0, viewer.lines.length - capacity);
		} else {
			scrollResourceViewer(entry.delta);
		}
		resourceViewerClampScroll(viewer);
		return;
	}
}

export function drawResourcePanel(api: BmsxConsoleApi): void {
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

export function drawResourceViewer(api: BmsxConsoleApi): void {
	const viewer = getActiveResourceViewer();
	if (!viewer) {
		return;
	}
	resourceViewerClampScroll(viewer);
	const bounds = getCodeAreaBounds();
	const contentLeft = bounds.codeLeft + constants.RESOURCE_PANEL_PADDING_X;
	const capacity = resourceViewerTextCapacity(viewer);
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
	const layout = resourceViewerImageLayout(viewer);
	let textTop = contentTop;
	if (layout && viewer.image) {
		ensureResourceViewerSprite(api, viewer.image.assetId, { left: layout.left, top: layout.top, scale: layout.scale });
		textTop = Math.floor(layout.bottom + lineHeight);
	} else {
		hideResourceViewerSprite(api);
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

export function drawReferenceHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
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
		const startDisplay = columnToDisplay(highlight, match.start);
		const endDisplay = columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + measureRangeFast(entry, sliceStartDisplay, visibleStart);
		const endX = originX + measureRangeFast(entry, sliceStartDisplay, visibleEnd);
		const overlay = i === activeIndex ? constants.REFERENCES_MATCH_ACTIVE_OVERLAY : constants.REFERENCES_MATCH_OVERLAY;
		api.rectfill_color(startX, originY, endX, originY + lineHeight, overlay);
	}
}

export function drawSearchHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
	if (searchScope !== 'local' || searchMatches.length === 0 || searchQuery.length === 0) {
		return;
	}
	const highlight = entry.hi;
	for (let i = 0; i < searchMatches.length; i++) {
		const match = searchMatches[i];
		if (match.row !== rowIndex) {
			continue;
		}
		const startDisplay = columnToDisplay(highlight, match.start);
		const endDisplay = columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + measureRangeFast(entry, sliceStartDisplay, visibleStart);
		const endX = originX + measureRangeFast(entry, sliceStartDisplay, visibleEnd);
		const overlay = i === searchCurrentIndex ? constants.SEARCH_MATCH_ACTIVE_OVERLAY : constants.SEARCH_MATCH_OVERLAY;
		api.rectfill_color(startX, originY, endX, originY + lineHeight, overlay);
	}
}

export function computeCursorScreenInfo(entry: CachedHighlight, textLeft: number, rowTop: number, sliceStartDisplay: number): CursorScreenInfo {
	const highlight = entry.hi;
	const columnToDisplay = highlight.columnToDisplay;
	const clampedColumn = columnToDisplay.length > 0
		? clamp(cursorColumn, 0, columnToDisplay.length - 1)
		: 0;
	const cursorDisplayIndex = columnToDisplay.length > 0 ? columnToDisplay[clampedColumn] : 0;
	const limitedDisplayIndex = Math.max(sliceStartDisplay, cursorDisplayIndex);
	const cursorX = textLeft + measureRangeFast(entry, sliceStartDisplay, limitedDisplayIndex);
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
	const currentChar = currentLine().charAt(cursorColumn);
	if (currentChar === '\t') {
		cursorWidth = spaceAdvance * constants.TAB_SPACES;
	}
	return {
		row: cursorRow,
		column: cursorColumn,
		x: cursorX,
		y: rowTop,
		width: cursorWidth,
		height: lineHeight,
		baseChar,
		baseColor,
	};
}

export function sliceHighlightedLine(highlight: HighlightLine, columnStart: number, columnCount: number): { text: string; colors: number[]; startDisplay: number; endDisplay: number } {
	return layout.sliceHighlightedLine(highlight, columnStart, columnCount);
}

export function getCachedHighlight(row: number): CachedHighlight {
	const activeContext = getActiveCodeTabContext();
	const chunkName = resolveHoverChunkName(activeContext) ?? '<console>';
	return layout.getCachedHighlight(lines, row, textVersion, chunkName);
}

export function invalidateLine(row: number): void {
	layout.invalidateHighlight(row);
}

export function invalidateAllHighlights(): void {
	layout.invalidateAllHighlights();
}

export function invalidateHighlightsFromRow(startRow: number): void {
	layout.invalidateHighlightsFrom(Math.max(0, startRow));
}

export function measureRangeFast(entry: CachedHighlight, startDisplay: number, endDisplay: number): number {
	return layout.measureRangeFast(entry, startDisplay, endDisplay);
}

export function requestSemanticRefresh(context?: CodeTabContext | null): void {
	const activeContext = context ?? getActiveCodeTabContext();
	const chunkName = resolveHoverChunkName(activeContext) ?? '<console>';
	layout.requestSemanticUpdate(lines, textVersion, chunkName);
}

export function lowerBound(values: number[], target: number, lo = 0, hi = values.length): number {
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

export function bumpTextVersion(): void {
	textVersion += 1;
}

export function markDiagnosticsDirty(contextId?: string): void {
	const targetId = contextId ?? activeCodeTabContextId;
	if (!targetId) {
		return;
	}
	diagnosticsDirty = true;
	dirtyDiagnosticContexts.add(targetId);
	diagnosticsDueAtMs = clockNow() + diagnosticsDebounceMs;
}

export function markTextMutated(): void {
	dirty = true;
	markDiagnosticsDirty();
	bumpTextVersion();
	clearReferenceHighlights();
	updateActiveContextDirtyFlag();
	invalidateVisualLines();
	requestSemanticRefresh();
	handlePostEditMutation();
	if (searchQuery.length > 0) {
		startSearchJob();
	}
}

export function recordEditContext(kind: 'insert' | 'delete' | 'replace', text: string): void {
	pendingEditContext = { kind, text };
}

export function handlePostEditMutation(): void {
	const editContext = pendingEditContext;
	pendingEditContext = null;
	completion.updateAfterEdit(editContext);
}

export function handleCompletionKeybindings(
	keyboard: KeyboardInput,
	deltaSeconds: number,
	shiftDown: boolean,
	ctrlDown: boolean,
	altDown: boolean,
	metaDown: boolean,
): boolean {
	return completion.handleKeybindings(keyboard, deltaSeconds, shiftDown, ctrlDown, altDown, metaDown);
}

export function onCursorMoved(): void {
	completion.onCursorMoved();
}

export function invalidateVisualLines(): void {
	layout.markVisualLinesDirty();
}

export function ensureVisualLines(): void {
	const activeContext = getActiveCodeTabContext();
	const chunkName = resolveHoverChunkName(activeContext) ?? '<console>';
	scrollRow = layout.ensureVisualLines({
		lines: lines,
		wordWrapEnabled: wordWrapEnabled,
		scrollRow: scrollRow,
		documentVersion: textVersion,
		chunkName,
		computeWrapWidth: () => computeWrapWidth(),
		estimatedVisibleRowCount: Math.max(1, cachedVisibleRowCount),
	});
	if (scrollRow < 0) {
		scrollRow = 0;
	}
}

export function computeWrapWidth(): number {
	const resourceWidth = resourcePanelVisible ? getResourcePanelWidth() : 0;
	const gutterSpace = gutterWidth + 2;
	const verticalScrollbarSpace = 0;
	const available = viewportWidth - resourceWidth - gutterSpace - verticalScrollbarSpace;
	return Math.max(charAdvance, available - 2);
}

export function getVisualLineCount(): number {
	ensureVisualLines();
	return layout.getVisualLineCount();
}

export function visualIndexToSegment(index: number): VisualLineSegment | null {
	ensureVisualLines();
	return layout.visualIndexToSegment(index);
}

export function positionToVisualIndex(row: number, column: number): number {
	ensureVisualLines();
	const override = getCursorVisualOverride(row, column);
	if (override) {
		return override.visualIndex;
	}
	return layout.positionToVisualIndex(lines, row, column);
}

export function setCursorFromVisualIndex(visualIndex: number, desiredColumnHint?: number, desiredOffsetHint?: number): void {
	ensureVisualLines();
	clearCursorVisualOverride();
	const visualLines = layout.getVisualLines();
	if (visualLines.length === 0) {
		cursorRow = 0;
		cursorColumn = 0;
		updateDesiredColumn();
		return;
	}
	const clampedIndex = clamp(visualIndex, 0, visualLines.length - 1);
	const segment = visualLines[clampedIndex];
	if (!segment) {
		return;
	}
	const entry = getCachedHighlight(segment.row);
	const highlight = entry.hi;
	const line = lines[segment.row] ?? '';
	const hasDesiredHint = desiredColumnHint !== undefined;
	const hasOffsetHint = desiredOffsetHint !== undefined;
	let targetColumn = hasDesiredHint ? desiredColumnHint! : cursorColumn;
	if (wordWrapEnabled) {
		const segmentEndColumn = Math.max(segment.endColumn, segment.startColumn);
		const segmentDisplayStart = columnToDisplay(highlight, segment.startColumn);
		const segmentDisplayEnd = columnToDisplay(highlight, segmentEndColumn);
		const segmentWidth = Math.max(0, segmentDisplayEnd - segmentDisplayStart);
		if (hasOffsetHint) {
			const clampedOffset = clamp(Math.round(desiredOffsetHint!), 0, segmentWidth);
			const targetDisplay = clamp(segmentDisplayStart + clampedOffset, segmentDisplayStart, segmentDisplayEnd);
			let columnFromOffset = entry.displayToColumn[targetDisplay];
			if (columnFromOffset === undefined) {
				columnFromOffset = lines[segment.row].length;
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
	cursorRow = segment.row;
	cursorColumn = clamp(targetColumn, 0, line.length);
	const cursorDisplay = columnToDisplay(highlight, cursorColumn);
	if (wordWrapEnabled) {
		const hasNextSegmentSameRow = (clampedIndex + 1 < visualLines.length)
			&& visualLines[clampedIndex + 1].row === segment.row;
		const segmentEnd = Math.max(segment.endColumn, segment.startColumn);
		if (cursorColumn < segment.startColumn) {
			cursorColumn = segment.startColumn;
		}
		if (segmentEnd >= segment.startColumn && cursorColumn > segmentEnd) {
			cursorColumn = Math.min(segmentEnd, line.length);
		}
		if (hasNextSegmentSameRow && cursorColumn >= segmentEnd) {
			cursorColumn = Math.max(segment.startColumn, segmentEnd - 1);
		}
		const segmentDisplayStart = columnToDisplay(highlight, segment.startColumn);
		desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	} else {
		desiredDisplayOffset = cursorDisplay;
	}
	if (hasDesiredHint) {
		desiredColumn = Math.max(0, desiredColumnHint!);
	} else {
		desiredColumn = cursorColumn;
	}
	if (desiredDisplayOffset < 0) {
		desiredDisplayOffset = 0;
	}
}


export function drawRectOutlineColor(api: BmsxConsoleApi, left: number, top: number, right: number, bottom: number, color: { r: number; g: number; b: number; a: number }): void {
	if (right <= left || bottom <= top) {
		return;
	}
	api.rectfill_color(left, top, right, top + 1, color);
	api.rectfill_color(left, bottom - 1, right, bottom, color);
	api.rectfill_color(left, top, left + 1, bottom, color);
	api.rectfill_color(right - 1, top, right, bottom, color);
}

export function computeSelectionSlice(lineIndex: number, highlight: HighlightLine, sliceStart: number, sliceEnd: number): { startDisplay: number; endDisplay: number } | null {
	const range = getSelectionRange();
	if (!range) {
		return null;
	}
	const { start, end } = range;
	if (lineIndex < start.row || lineIndex > end.row) {
		return null;
	}
	let selectionStartColumn = lineIndex === start.row ? start.column : 0;
	let selectionEndColumn = lineIndex === end.row ? end.column : lines[lineIndex].length;
	if (lineIndex === end.row && end.column === 0 && end.row > start.row) {
		selectionEndColumn = 0;
	}
	if (selectionStartColumn === selectionEndColumn) {
		return null;
	}
	const startDisplay = columnToDisplay(highlight, selectionStartColumn);
	const endDisplay = columnToDisplay(highlight, selectionEndColumn);
	const visibleStart = Math.max(sliceStart, startDisplay);
	const visibleEnd = Math.min(sliceEnd, endDisplay);
	if (visibleEnd <= visibleStart) {
		return null;
	}
	return { startDisplay: visibleStart, endDisplay: visibleEnd };
}

export function drawStatusBar(api: BmsxConsoleApi): void {
	const host = {
		viewportWidth: viewportWidth,
		viewportHeight: viewportHeight,
		bottomMargin: statusAreaHeight(),
		lineHeight: lineHeight,
		measureText: (text: string) => measureText(text),
		drawText: (api2: BmsxConsoleApi, text: string, x: number, y: number, color: number) => drawEditorText(api2, font, text, x, y, color),
		truncateTextToWidth: (text: string, maxWidth: number) => truncateTextToWidth(text, maxWidth),
		message: message,
		getStatusMessageLines: () => getStatusMessageLines(),
		symbolSearchVisible: symbolSearchVisible,
		getActiveSymbolSearchMatch: () => getActiveSymbolSearchMatch(),
		resourcePanelVisible: resourcePanelVisible,
		resourcePanelFilterMode: resourcePanel.getFilterMode(),
		resourcePanelResourceCount: resourcePanelResourceCount,
		isResourceViewActive: () => isResourceViewActive(),
		getActiveResourceViewer: () => getActiveResourceViewer(),
		metadata: metadata,
		statusLeftInfo: buildStatusLeftInfo(),
		problemsPanelFocused: problemsPanel.isVisible() && problemsPanel.isFocused(),
	};
	renderStatusBar(api, host);
}

export function buildStatusLeftInfo(): string {
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
	return `LINE ${cursorRow + 1}/${lines.length} COL ${cursorColumn + 1}`;
}

export function drawProblemsPanel(api: BmsxConsoleApi): void {
	const bounds = getProblemsPanelBounds();
	if (!bounds) {
		return;
	}
	problemsPanel.draw(api, bounds);
}

export function getProblemsPanelBounds(): RectBounds | null {
	const panelHeight = getVisibleProblemsPanelHeight();
	if (panelHeight <= 0) {
		return null;
	}
	const statusHeight = statusAreaHeight();
	const bottom = viewportHeight - statusHeight;
	const top = bottom - panelHeight;
	if (bottom <= top) {
		return null;
	}
	return { left: 0, top, right: viewportWidth, bottom };
}

export function isPointerOverProblemsPanelDivider(x: number, y: number): boolean {
	const bounds = getProblemsPanelBounds();
	if (!bounds) {
		return false;
	}
	const margin = constants.PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN;
	const dividerTop = bounds.top;
	return y >= dividerTop - margin && y <= dividerTop + margin && x >= bounds.left && x <= bounds.right;
}

export function setProblemsPanelHeightFromViewportY(viewportY: number): void {
	const statusHeight = statusAreaHeight();
	const bottom = viewportHeight - statusHeight;
	const minTop = headerHeight + getTabBarTotalHeight() + 1;
	const headerH = lineHeight + constants.PROBLEMS_PANEL_HEADER_PADDING_Y * 2;
	const minContent = Math.max(1, constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS) * lineHeight;
	const minHeight = headerH + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2 + minContent;
	const maxTop = Math.max(minTop, bottom - minHeight);
	const top = clamp(viewportY, minTop, maxTop);
	const height = clamp(bottom - top, minHeight, Math.max(minHeight, bottom - minTop));
	problemsPanel.setFixedHeightPx(height);
}

export function drawActionPromptOverlay(api: BmsxConsoleApi): void {
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
		const width = measureText(messageLines[i]);
		if (width > maxMessageWidth) {
			maxMessageWidth = width;
		}
	}
	const cancelLabel = 'CANCEL';
	const primaryWidth = measureText(primaryLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
	const secondaryWidth = measureText(secondaryLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
	const cancelWidth = measureText(cancelLabel) + constants.HEADER_BUTTON_PADDING_X * 2;
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

export function columnToDisplay(highlight: HighlightLine, column: number): number {
	return layout.columnToDisplay(highlight, column);
}

export function resolvePaletteIndex(color: { r: number; g: number; b: number; a: number }): number | null {
	const index = Msx1Colors.indexOf(color);
	return index === -1 ? null : index;
}

export function invertColorIndex(colorIndex: number): number {
	const color = Msx1Colors[colorIndex];
	if (!color) {
		return constants.COLOR_CODE_TEXT;
	}
	const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
	return luminance > 0.5 ? 0 : 15;
}

export function resetActionPromptState(): void {
	pendingActionPrompt = null;
	actionPromptButtons.saveAndContinue = null;
	actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
	actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
}

export function pointInRect(x: number, y: number, rect: RectBounds | null): boolean {
	if (!rect) {
		return false;
	}
	return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

export function hasPendingRuntimeReload(): boolean {
	return saveGeneration > appliedGeneration;
}

export function getConsoleRuntime(): BmsxConsoleRuntime | null {
	return $.get('bmsx_console_runtime');
}

export function prepareRuntimeSnapshotForResume(snapshot: unknown): Record<string, unknown> | null {
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

export function scheduleRuntimeTask(task: () => void | Promise<void>, onError: (error: unknown) => void): void {
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

export function handleRuntimeTaskError(error: unknown, fallbackMessage: string): void {
	const message = error instanceof Error ? error.message : String(error);
	$.paused = true;
	activate();
	showMessage(`${fallbackMessage}: ${message}`, constants.COLOR_STATUS_ERROR, 4.0);
}

export function truncateTextToWidth(text: string, maxWidth: number): string {
	return truncateTextToWidthExternal(text, maxWidth, (ch) => font.advance(ch), spaceAdvance);
}

export function measureText(text: string): number {
	return measureTextGeneric(text, (ch) => font.advance(ch), spaceAdvance);
}

export function assertMonospace(): void {
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

export function centerCursorVertically(): void {
	ensureVisualLines();
	const rows = visibleRowCount();
	const totalVisual = getVisualLineCount();
	const cursorVisualIndex = positionToVisualIndex(cursorRow, cursorColumn);
	const maxScroll = Math.max(0, totalVisual - rows);
	if (rows <= 1) {
		scrollRow = clamp(cursorVisualIndex, 0, maxScroll);
		return;
	}
	let target = cursorVisualIndex - Math.floor(rows / 2);
	if (target < 0) {
		target = 0;
	}
	if (target > maxScroll) {
		target = maxScroll;
	}
	scrollRow = target;
}

export function ensureCursorVisible(): void {
	clampCursorRow();
	clampCursorColumn();

	ensureVisualLines();
	const rows = visibleRowCount();
	const totalVisual = getVisualLineCount();
	const cursorVisualIndex = positionToVisualIndex(cursorRow, cursorColumn);

	if (cursorVisualIndex < scrollRow) {
		scrollRow = cursorVisualIndex;
	}
	if (cursorVisualIndex >= scrollRow + rows) {
		scrollRow = cursorVisualIndex - rows + 1;
	}
	const maxScrollRow = Math.max(0, totalVisual - rows);
	scrollRow = clamp(scrollRow, 0, maxScrollRow);

	if (wordWrapEnabled) {
		scrollColumn = 0;
		return;
	}

	const columns = visibleColumnCount();
	if (cursorColumn < scrollColumn) {
		scrollColumn = cursorColumn;
	}
	const maxScrollColumn = cursorColumn - columns + 1;
	if (maxScrollColumn > scrollColumn) {
		scrollColumn = maxScrollColumn;
	}
	if (scrollColumn < 0) {
		scrollColumn = 0;
	}
	const lineLength = currentLine().length;
	const maxColumn = lineLength - columns;
	if (maxColumn < 0) {
		scrollColumn = 0;
	} else if (scrollColumn > maxColumn) {
		scrollColumn = maxColumn;
	}
}

export function buildMemberCompletionItems(request: {
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

export function visibleRowCount(): number {
	return cachedVisibleRowCount > 0 ? cachedVisibleRowCount : 1;
}

export function visibleColumnCount(): number {
	return cachedVisibleColumnCount > 0 ? cachedVisibleColumnCount : 1;
}

export function resetBlink(): void {
	blinkTimer = 0;
	cursorVisible = true;
}

export function shouldFireRepeat(keyboard: KeyboardInput, code: string, deltaSeconds: number): boolean {
	return input.shouldRepeatPublic(keyboard, code, deltaSeconds);
}


export type ConsoleCartEditor = {
	activate: typeof activate;
	deactivate: typeof deactivate;
	isActive: typeof isActive;
	update: typeof update;
	draw: typeof draw;
	shutdown: typeof shutdown;
	showWarningBanner: typeof showWarningBanner;
	showRuntimeErrorInChunk: typeof showRuntimeErrorInChunk;
	showRuntimeError: typeof showRuntimeError;
	clearRuntimeErrorOverlay: typeof clearRuntimeErrorOverlay;
	clearAllRuntimeErrorOverlays: typeof clearAllRuntimeErrorOverlays;
	getSourceForChunk: typeof getSourceForChunk;
};

const editorFacade: ConsoleCartEditor = {
	activate,
	deactivate,
	isActive,
	update,
	draw,
	shutdown,
	showWarningBanner,
	showRuntimeErrorInChunk,
	showRuntimeError,
	clearRuntimeErrorOverlay,
	clearAllRuntimeErrorOverlays,
	getSourceForChunk,
};

export function handleCodeFormattingShortcut(
	keyboard: KeyboardInput,
	_deltaSeconds: number,
	context: ConsoleEditorShortcutContext): boolean {
	if (!context.codeTabActive || context.inlineFieldFocused || context.resourcePanelFocused) {
		return false;
	}
	if (!context.altDown || context.shiftDown || (!context.ctrlDown && !context.metaDown)) {
		return false;
	}
	if (!isKeyJustPressedGlobal(playerIndex, 'KeyF')) {
		return false;
	}
	consumeKeyboardKey(keyboard, 'KeyF');
	applyDocumentFormatting();
	return true;
}
function applyDocumentFormatting(): void {
	const originalLines = [...lines];
	const originalSource = originalLines.join('\\n');
	try {
		const formatted = formatLuaDocument(originalSource);
		if (formatted === originalSource) {
			showMessage('Document already formatted', constants.COLOR_STATUS_TEXT, 1.5);
			return;
		}
		const cursorOffset = computeDocumentOffset(originalLines, cursorRow, cursorColumn);
		prepareUndo('format-document', false);
		if (lines.length === 0) {
			setSelectionAnchorPosition({ row: 0, column: 0 });
			setCursorPosition(0, 0);
		} else {
			const lastRow = lines.length - 1;
			setSelectionAnchorPosition({ row: 0, column: 0 });
			setCursorPosition(lastRow, lines[lastRow].length);
		}
		replaceSelectionWith(formatted);
		const updatedLines = [...lines];
		const target = resolveOffsetPosition(updatedLines, cursorOffset);
		setCursorPosition(target.row, target.column);
		clearSelection();
		markDiagnosticsDirty();
		showMessage('Document formatted', constants.COLOR_STATUS_SUCCESS, 1.6);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showMessage(`Formatting failed: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
	}
}
function computeDocumentOffset(lines: readonly string[], row: number, column: number): number {
	let offset = 0;
	for (let index = 0; index < row; index += 1) {
		offset += lines[index].length + 1;
	}
	return offset + column;
}
function resolveOffsetPosition(lines: readonly string[], offset: number): { row: number; column: number; } {
	let remaining = offset;
	for (let row = 0; row < lines.length; row += 1) {
		const lineLength = lines[row].length;
		if (remaining <= lineLength) {
			return { row, column: remaining };
		}
		remaining -= lineLength + 1;
	}
	if (lines.length === 0) {
		return { row: 0, column: 0 };
	}
	const lastRow = lines.length - 1;
	return { row: lastRow, column: lines[lastRow].length };
}

export function createConsoleCartEditor(options: ConsoleEditorOptions): ConsoleCartEditor {
	customKeybindingHandler = (keyboard, deltaSeconds, context) =>
		handleCodeFormattingShortcut(keyboard, deltaSeconds, context);
	initializeConsoleCartEditor(options);
	return editorFacade;
}

function initializeConsoleCartEditor(options: ConsoleEditorOptions): void {
	playerIndex = options.playerIndex;
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
	applySearchFieldText(searchQuery, true);
	applySymbolSearchFieldText(symbolSearchQuery, true);
	applyResourceSearchFieldText(resourceSearchQuery, true);
	applyLineJumpFieldText(lineJumpValue, true);
	applyCreateResourceFieldText(createResourcePath, true);
	lineHeight = font.lineHeight();
	charAdvance = font.advance('M');
	spaceAdvance = font.advance(' ');
	layout = new ConsoleCodeLayout(font, semanticWorkspace, {
		clockNow: clockNow,
		getBuiltinIdentifiers: () => getBuiltinIdentifierSet(),
	});
	inlineFieldMetricsRef = {
		measureText: (text: string) => measureText(text),
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
	resourcePanel = new ResourcePanelController({
		getViewportWidth: () => viewportWidth,
		getViewportHeight: () => viewportHeight,
		getBottomMargin: () => bottomMargin(),
		codeViewportTop: () => codeViewportTop(),
		lineHeight: lineHeight,
		charAdvance: charAdvance,
		measureText: (t) => measureText(t),
		drawText: (a, t, x, y, c) => drawEditorText(a, font, t, x, y, c),
		drawColoredText: (a, t, colors, x, y) => drawEditorColoredText(a, font, t, colors, x, y, constants.COLOR_CODE_TEXT),
		drawRectOutlineColor: (a, l, t, r, b, col) => drawRectOutlineColor(a, l, t, r, b, col),
		playerIndex: playerIndex,
		listResources: () => listResourcesStrict(),
		openLuaCodeTab: (d) => openLuaCodeTab(d),
		openResourceViewerTab: (d) => openResourceViewerTab(d),
		focusEditorFromResourcePanel: () => focusEditorFromResourcePanel(),
		showMessage: (text, color, duration) => showMessage(text, color, duration),
	}, { resourceVertical: scrollbars.resourceVertical, resourceHorizontal: scrollbars.resourceHorizontal });
	completion = new CompletionController({
		getPlayerIndex: () => playerIndex,
		isCodeTabActive: () => isCodeTabActive(),
		getLines: () => lines,
		getCursorRow: () => cursorRow,
		getCursorColumn: () => cursorColumn,
		setCursorPosition: (row, column) => { cursorRow = row; cursorColumn = column; },
		setSelectionAnchor: (row, column) => { selectionAnchor = { row, column }; },
		replaceSelectionWith: (text) => replaceSelectionWith(text),
		updateDesiredColumn: () => updateDesiredColumn(),
		resetBlink: () => resetBlink(),
		revealCursor: () => revealCursor(),
		measureText: (text) => measureText(text),
		drawText: (api, text, x, y, color) => drawEditorText(api, font, text, x, y, color),
		getCursorScreenInfo: () => cursorScreenInfo,
		getLineHeight: () => lineHeight,
		getSpaceAdvance: () => spaceAdvance,
		getActiveCodeTabContext: () => getActiveCodeTabContext(),
		resolveHoverAssetId: (ctx) => resolveHoverAssetId(ctx as any),
		resolveHoverChunkName: (ctx) => resolveHoverChunkName(ctx as any),
		listLuaSymbols: (assetId, chunk) => listLuaSymbolsFn(assetId, chunk),
		listGlobalLuaSymbols: () => listGlobalLuaSymbolsFn(),
		listLuaModuleSymbols: (moduleName) => listLuaModuleSymbolsFn(moduleName),
		listBuiltinLuaFunctions: () => listBuiltinLuaFunctionsFn(),
		getSemanticDefinitions: () => getActiveSemanticDefinitions(),
		getLuaModuleAliases: (chunkName) => getLuaModuleAliases(chunkName),
		getMemberCompletionItems: (request) => buildMemberCompletionItems(request),
		charAt: (r, c) => charAt(r, c),
		getTextVersion: () => textVersion,
		shouldFireRepeat: (kb, code, dt) => input.shouldRepeatPublic(kb, code, dt),
	});
	completion.setEnterCommitsEnabled(false);
	input = new InputController({
		getPlayerIndex: () => playerIndex,
		isCodeTabActive: () => isCodeTabActive(),
		getLines: () => lines,
		setLines: (lines) => { lines = lines; markDiagnosticsDirty(); },
		getCursorRow: () => cursorRow,
		getCursorColumn: () => cursorColumn,
		setCursorPosition: (row, column) => { cursorRow = row; cursorColumn = column; },
		setSelectionAnchor: (row, column) => { selectionAnchor = { row, column }; },
		getSelection: () => getSelectionRange(),
		clearSelection: () => { selectionAnchor = null; },
		updateDesiredColumn: () => updateDesiredColumn(),
		resetBlink: () => resetBlink(),
		revealCursor: () => revealCursor(),
		ensureCursorVisible: () => ensureCursorVisible(),
		recordPreMutationSnapshot: (key) => recordSnapshotPre(key),
		pushPostMutationSnapshot: (key) => recordSnapshotPost(key),
		deleteSelection: () => deleteSelection(),
		deleteCharLeft: () => deleteCharLeft(),
		deleteCharRight: () => deleteCharRight(),
		deleteActiveLines: () => deleteActiveLines(),
		deleteWordBackward: () => deleteWordBackward(),
		deleteWordForward: () => deleteWordForward(),
		insertNewline: () => insertNewline(),
		insertText: (text) => insertText(text),
		moveCursorLeft: (byWord, select) => moveCursorLeft(byWord, select),
		moveCursorRight: (byWord, select) => moveCursorRight(byWord, select),
		moveCursorUp: (select) => moveCursorUp(select),
		moveCursorDown: (select) => moveCursorDown(select),
		moveCursorHome: (select) => moveCursorHome(select),
		moveCursorEnd: (select) => moveCursorEnd(select),
		pageDown: (select) => pageDown(select),
		pageUp: (select) => pageUp(select),
		moveSelectionLines: (delta) => moveSelectionLines(delta),
		indentSelectionOrLine: () => indentSelectionOrLine(),
		unindentSelectionOrLine: () => unindentSelectionOrLine(),
		navigateBackward: () => goBackwardInNavigationHistory(),
		navigateForward: () => goForwardInNavigationHistory(),
	});
	problemsPanel = new ProblemsPanelController({
		lineHeight: lineHeight,
		measureText: (text) => measureText(text),
		drawText: (api, text, x, y, color) => drawEditorText(api, font, text, x, y, color),
		drawRectOutlineColor: (api, l, t, r, b, col) => drawRectOutlineColor(api, l, t, r, b, col),
		truncateTextToWidth: (text, maxWidth) => truncateTextToWidth(text, maxWidth),
		gotoDiagnostic: (diagnostic) => gotoDiagnostic(diagnostic),
	});
	problemsPanel.setDiagnostics(diagnostics);
	renameController = new RenameController({
		processFieldEdit: (field, keyboard, options) => processInlineFieldEditing(field, keyboard, options),
		shouldFireRepeat: (keyboard, code, deltaSeconds) => shouldFireRepeat(keyboard, code, deltaSeconds),
		undo: () => undo(),
		redo: () => redo(),
		showMessage: (text, color, duration) => showMessage(text, color, duration),
		commitRename: (payload) => commitRename(payload),
		onRenameSessionClosed: () => focusEditorFromRename(),
	}, referenceState, playerIndex);
	codeVerticalScrollbarVisible = false;
	codeHorizontalScrollbarVisible = false;
	cachedVisibleRowCount = 1;
	cachedVisibleColumnCount = 1;
	const entryContext = createEntryTabContext();
	if (entryContext) {
		entryTabId = entryContext.id;
		codeTabContexts.set(entryContext.id, entryContext);
	}
	initializeTabs(entryContext);
	resetResourcePanelState();
	if (entryContext) {
		activateCodeEditorTab(entryContext.id);
	}
	desiredColumn = cursorColumn;
	assertMonospace();
	const initialContext = entryContext ? codeTabContexts.get(entryContext.id) ?? null : null;
	lastSavedSource = initialContext ? initialContext.lastSavedSource : '';
	$.input.setKeyboardCapture(EDITOR_TOGGLE_KEY, true);
	applyResolutionModeToRuntime();
	pendingWindowFocused = windowFocused;
	installPlatformVisibilityListener();
	installWindowEventListeners();
	navigationHistory.current = createNavigationEntry();
}
