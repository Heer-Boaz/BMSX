import { $ } from '../../core/game';
import { scheduleMicrotask, type TimerHandle } from '../../platform/platform';
import type {
	VMLuaDefinitionLocation,
	VMLuaHoverRequest,
	VMLuaHoverResult,
	VMLuaSymbolEntry,
	VMResourceDescriptor,
} from '../types';
import { VMEditorFont } from '../editor_font';
import { VMFontVariant } from '../font';
import { drawEditorText } from './text_renderer';
import { Msx1Colors } from '../../systems/msx';
import { EventEmitter, type ListenerSet } from '../../core/eventemitter';
import { Registry } from '../../core/registry';
import { SpriteComponent } from '../../component/sprite_component';
import { renderCodeArea } from './render/render_code_area';
import { clamp } from '../../utils/clamp';
import { CompletionController } from './completion_controller';
import { drawProblemsPanel, ProblemsPanelController } from './problems_panel';
import { computeAggregatedEditorDiagnostics, markDiagnosticsDirty, type DiagnosticContextInput, type DiagnosticProviders } from './diagnostics';
import {
	createEntryTabContext,
	createLuaCodeTabContext,
	getActiveCodeTabContext,
	storeActiveCodeTabContext,
	activateCodeEditorTab,
	initializeTabs,
	setTabDirty,
	updateActiveContextDirtyFlag,
	isCodeTabActive,
	isEditableCodeTab,
	isResourceViewActive,
	setActiveTab,
	activateCodeTab,
	closeTab,
	computeResourceTabTitle,
	findCodeTabContext,
} from './editor_tabs';

import { assertMonospace, bumpTextVersion, capturePreMutationSource, ensureVisualLines, getVisualLineCount, invalidateLuaCommentContextFromRow, markTextMutated, measureText, normalizeEndingsAndSplitLines, positionToVisualIndex, visibleColumnCount, visibleRowCount, visualIndexToSegment, wrapOverlayLine } from './text_utils';
import {
	applyInlineFieldEditing,
	applyInlineFieldPointer,
	createInlineTextField,
	getFieldText,
	setFieldText,
	updateBlink,
} from './inline_text_field';
import { buildMemberCompletionItems, clearGotoHoverHighlight, clearReferenceHighlights, describeMetadataValue, extractHoverExpression, inspectLuaExpression, intellisenseUiReady, listGlobalLuaSymbols, listLuaBuiltinFunctions, listLuaSymbols, navigateToLuaDefinition, requestSemanticRefresh, resolveHoverAssetId, resolveHoverChunkName, safeJsonStringify, shouldAutoTriggerCompletions } from './intellisense';
import { VMScrollbar, ScrollbarController } from './scrollbar';
import { renderTopBar, renderTopBarDropdown } from './render/render_top_bar';
import { renderTabBar } from './render/render_tab_bar';
import { renderStatusBar } from './render/render_status_bar';
// Resource panel rendering is handled via ResourcePanelController
import { ResourcePanelController } from './resource_panel_controller';
import { handleActionPromptInput, handleEditorInput, handlePointerWheel, handleTextEditorPointerInput, InputController, isKeyJustPressed, resourceViewerClampScroll, shouldRepeatKeyFromPlayer, toggleThemeMode } from './ide_input';
import { consumeIdeKey } from './ide_input';
import { VMCodeLayout } from './code_layout';
import { getTextSnapshot, splitText } from './source_text';
import { EditorUndoRecord, TextUndoOp } from './editor_undo';
import { PieceTreeBuffer } from './piece_tree_buffer';
import type {
	CodeHoverTooltip,
	CodeTabContext,
	EditorSnapshot,
	EditorTabDescriptor,
	EditorTabId,
	EditorDiagnostic,
	TextField,
	PendingActionPrompt,
	PointerSnapshot,
	Position,
	ResourceCatalogEntry,
	ResourceSearchResult,
	ResourceViewerState,
	RuntimeErrorOverlay,
	SymbolSearchResult,
	DebugPanelKind,
} from './types';
import { resolveReferenceLookup, type ReferenceMatchInfo } from './code_reference';
import {
	buildReferenceCatalogForExpression as buildProjectReferenceCatalog,
	type ProjectReferenceEnvironment,
	filterReferenceCatalog,
	type ReferenceCatalogEntry,
	type ReferenceSymbolEntry,
} from './code_reference';
import { clearBackgroundTasks, enqueueBackgroundTask, scheduleIdeOnce, scheduleRuntimeTask } from './background_tasks';

import { RenameController, type RenameCommitPayload, type RenameCommitResult } from './rename_controller';
import { CrossFileRenameManager, type CrossFileRenameDependencies } from './rename_controller';
import type { LuaDefinitionInfo, LuaSourceRange } from '../../lua/lua_ast';
// Search logic moved to editor_search
import { closeSearch, focusEditorFromSearch, computeSearchPageStats, startSearchJob, cancelGlobalSearchJob } from './editor_search';
import * as constants from './constants';
import { ide_state, type NavigationHistoryEntry, captureKeys, EMPTY_DIAGNOSTICS, NAVIGATION_HISTORY_LIMIT, diagnosticsDebounceMs, caretNavigation } from './ide_state';
import { initializeDebuggerUiState } from './ide_debugger';
import { clampCursorColumn, ensureCursorVisible, revealCursor, setCursorPosition } from './caret';
import {
	runWorkspaceAutosaveTick,
	initializeWorkspaceStorage,
	stopWorkspaceAutosaveLoop,
	clearWorkspaceDirtyBuffers,
	buildDirtyFilePath,
} from './workspace_storage';
import { clearWorkspaceCachedSources, getWorkspaceCachedSource, setWorkspaceCachedSources } from '../workspace_cache';
import { applyWorkspaceOverridesToCart, createLuaResource, listResources, saveLuaResourceSource } from '../workspace';

import * as TextEditing from './text_editing_and_selection';
import { resetBlink } from './render/render_caret';
import { api, BmsxVMRuntime } from '../vm_runtime';
import { drawResourcePanel, drawResourceViewer } from './render/render_resource_panel';
import { drawCreateResourceBar } from './render/render_input_bars';
import { drawActionPromptOverlay } from './render/render_prompt';
import { drawLineJumpBar, drawRenameBar, drawSearchBar, drawSymbolSearchBar } from './render/render_input_bars';
import { renderResourceSearchBar } from './render/render_inline_bars';
import { rewrapRuntimeErrorOverlays } from './text_utils';
import { renderFaultOverlay, renderRuntimeFaultOverlay, showRuntimeError, showRuntimeErrorInChunk } from './render/render_error_overlay';
import { point_in_rect } from '../../utils/rect_operations';
import { lower_bound } from '../../utils/lower_bound';
import { updateRuntimeErrorOverlay } from './runtime_error_overlay';
import { LuaSemanticWorkspace, refreshSymbolCatalog, symbolPriority } from './semantic_model';
import { extractErrorMessage } from '../../lua/luavalue';
import { Viewport } from '../../rompack/rompack';

export const editorFacade = {
	activate,
	deactivate,
	get isActive(): boolean { return ide_state.active; },
	get exists(): boolean { return ide_state.initialized; },
	tickInput,
	update,
	draw,
	shutdown,
	updateViewport,
	setFontVariant,
	showWarningBanner: ide_state.showWarningBanner,
	showRuntimeErrorInChunk,
	showRuntimeError,
	clearRuntimeErrorOverlay,
	clearAllRuntimeErrorOverlays,
	getSourceForChunk,
	clearWorkspaceDirtyBuffers,
	renderFaultOverlay,
	renderRuntimeFaultOverlay,
};

export type VMCartEditor = typeof editorFacade;

export function createVMCartEditor(viewport: Viewport): VMCartEditor {
	initializeVMCartEditor(viewport);
	return editorFacade;
}

export function initializeVMCartEditor(viewport: Viewport): void {
	initializeDebuggerUiState();
	const runtime = BmsxVMRuntime.instance;
	ide_state.playerIndex = runtime.playerIndex;
	ide_state.fontVariant = runtime.activeIdeFontVariant;
	constants.setIdeThemeVariant(constants.DEFAULT_THEME);
	ide_state.themeVariant = constants.getActiveIdeThemeVariant();
	ide_state.canonicalization = $.rompack.canonicalization;
	ide_state.caseInsensitive = ide_state.canonicalization !== 'none';
	ide_state.preMutationSource = null;
	applyViewportSize(viewport);
	ide_state.clockNow = $.platform.clock.now;
	ide_state.semanticWorkspace = new LuaSemanticWorkspace();
	setFontVariant(ide_state.fontVariant);
	ide_state.searchField = createInlineTextField();
	ide_state.symbolSearchField = createInlineTextField();
	ide_state.resourceSearchField = createInlineTextField();
	ide_state.lineJumpField = createInlineTextField();
	ide_state.createResourceField = createInlineTextField();
	initializeWorkspaceStorage($.rompack.project_root_path);
	applySearchFieldText(ide_state.searchQuery, true);
	applySymbolSearchFieldText(ide_state.symbolSearchQuery, true);
	applyResourceSearchFieldText(ide_state.resourceSearchQuery, true);
	applyLineJumpFieldText(ide_state.lineJumpValue, true);
	applyCreateResourceFieldText(ide_state.createResourcePath, true);
	ide_state.scrollbars = {
		codeVertical: new VMScrollbar('codeVertical', 'vertical'),
		codeHorizontal: new VMScrollbar('codeHorizontal', 'horizontal'),
		resourceVertical: new VMScrollbar('resourceVertical', 'vertical'),
		resourceHorizontal: new VMScrollbar('resourceHorizontal', 'horizontal'),
		viewerVertical: new VMScrollbar('viewerVertical', 'vertical'),
	};
	ide_state.scrollbarController = new ScrollbarController(ide_state.scrollbars);
	ide_state.resourcePanel = new ResourcePanelController({ resourceVertical: ide_state.scrollbars.resourceVertical, resourceHorizontal: ide_state.scrollbars.resourceHorizontal });
	ide_state.completion = new CompletionController({
		isCodeTabActive: () => isCodeTabActive(),
		getBuffer: () => ide_state.buffer,
		getCursorRow: () => ide_state.cursorRow,
		getCursorColumn: () => ide_state.cursorColumn,
		setCursorPosition: (row, column) => { ide_state.cursorRow = row; ide_state.cursorColumn = column; },
		setSelectionAnchor: (row, column) => { ide_state.selectionAnchor = { row, column }; },
		replaceSelectionWith: (text) => TextEditing.replaceSelectionWith(text),
		updateDesiredColumn: () => updateDesiredColumn(),
		resetBlink: () => resetBlink(),
		revealCursor: () => revealCursor(),
		measureText: (text) => measureText(text),
		drawText: (text, x, y, color) => drawEditorText(ide_state.font, text, x, y, undefined, color),
		fillRect: (left, top, right, bottom, color) => api.rectfill(left, top, right, bottom, undefined, color),
		strokeRect: (left, top, right, bottom, color) => api.rect(left, top, right, bottom, undefined, color),
		getCursorScreenInfo: () => ide_state.cursorScreenInfo,
		characterAdvance: (char) => ide_state.font.advance(char),
		get lineHeight(): number { return ide_state.font.lineHeight; },
		getActiveCodeTabContext: () => getActiveCodeTabContext(),
		resolveHoverChunkName: (ctx) => resolveHoverChunkName(ctx as CodeTabContext),
		getSemanticDefinitions: () => getActiveSemanticDefinitions(),
		getLuaModuleAliases: (chunkName) => getLuaModuleAliases(chunkName),
		getMemberCompletionItems: (request) => buildMemberCompletionItems(request),
		charAt: (r, c) => TextEditing.charAt(r, c),
		getTextVersion: () => ide_state.textVersion,
		shouldFireRepeat: (code) => shouldRepeatKeyFromPlayer(code),
		shouldAutoTriggerCompletions: () => shouldAutoTriggerCompletions(),
		shouldShowParameterHints: () => intellisenseUiReady(),
	});
	ide_state.completion.enterCommitsCompletion = false;
	ide_state.input = new InputController();
	ide_state.problemsPanel = new ProblemsPanelController();
	ide_state.problemsPanel.setDiagnostics(ide_state.diagnostics);
	ide_state.renameController = new RenameController({
		processFieldEdit: (field, options) => applyInlineFieldEditing(field, options),
		shouldFireRepeat: (code) => shouldRepeatKeyFromPlayer(code),
		undo: () => undo(),
		redo: () => redo(),
		showMessage: (text, color, duration) => ide_state.showMessage(text, color, duration),
		commitRename: (payload) => commitRename(payload),
		onRenameSessionClosed: () => focusEditorFromRename(),
	}, ide_state.referenceState);
	ide_state.codeVerticalScrollbarVisible = false;
	ide_state.codeHorizontalScrollbarVisible = false;
	ide_state.cachedVisibleRowCount = 1;
	ide_state.cachedVisibleColumnCount = 1;
	const entryContext = createEntryTabContext();
	if (entryContext) {
		ide_state.codeTabContexts.set(entryContext.id, entryContext);
	}
	initializeTabs(entryContext);
	resetResourcePanelState();
	if (entryContext) {
		activateCodeEditorTab(entryContext.id);
	}
	ide_state.desiredColumn = ide_state.cursorColumn;
	assertMonospace();
	const initialContext = entryContext ? ide_state.codeTabContexts.get(entryContext.id) : null;
	ide_state.lastSavedSource = initialContext ? initialContext.lastSavedSource : '';
	ide_state.navigationHistory.current = createNavigationEntry();
	ide_state.initialized = true;
}

export function getSourceForChunk(chunkName: string): string {
	const asset = $.cart.chunk2lua[chunkName];
	if (!asset) {
		return '';
	}
	const context = findCodeTabContext(chunkName);
	if (context) {
		if (context.id === ide_state.activeCodeTabContextId) {
			return getTextSnapshot(ide_state.buffer);
		}
		if (context.buffer) {
			return getTextSnapshot(context.buffer);
		}
		if (context.lastSavedSource.length > 0) {
			return context.lastSavedSource;
		}
	}
	const dirtyPath = (() => {
		try {
			return buildDirtyFilePath(asset.normalized_source_path);
		} catch {
			return null;
		}
	})();
	const cached = getWorkspaceCachedSource(asset.normalized_source_path) ?? (dirtyPath ? getWorkspaceCachedSource(dirtyPath) : null);
	if (typeof cached === 'string') {
		return cached;
	}
	return asset.src;
}

export function invalidateLineRange(startRow: number, endRow: number): void {
	let from = Math.min(startRow, endRow);
	let to = Math.max(startRow, endRow);
	const lastRow = ide_state.buffer.getLineCount() - 1;
	from = clamp(from, 0, lastRow);
	to = clamp(to, 0, lastRow);
	for (let row = from; row <= to; row += 1) {
		ide_state.layout.invalidateLine(row);
	}
}

export function maximumLineLength(): number {
	if (!ide_state.maxLineLengthDirty) {
		return ide_state.maxLineLength;
	}
	let maxLength = 0;
	let maxRow = 0;
	const lineCount = ide_state.buffer.getLineCount();
	for (let i = 0; i < lineCount; i += 1) {
		const length = ide_state.buffer.getLineEndOffset(i) - ide_state.buffer.getLineStartOffset(i);
		if (length > maxLength) {
			maxLength = length;
			maxRow = i;
		}
	}
	ide_state.maxLineLength = maxLength;
	ide_state.maxLineLengthRow = maxRow;
	ide_state.maxLineLengthDirty = false;
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

export function getLineRangeForMovement(): { startRow: number; endRow: number } {
	const range = TextEditing.getSelectionRange();
	if (!range) {
		return { startRow: ide_state.cursorRow, endRow: ide_state.cursorRow };
	}
	let endRow = range.end.row;
	if (range.end.column === 0 && endRow > range.start.row) {
		endRow -= 1;
	}
	return { startRow: range.start.row, endRow };
}

export function currentLine(): string {
	if (ide_state.cursorRow < 0 || ide_state.cursorRow >= ide_state.buffer.getLineCount()) {
		return '';
	}
	return ide_state.buffer.getLineContent(ide_state.cursorRow);
}

export function clampSelectionPosition(position: Position): Position {
	if (!position) {
		return null;
	}
	let row = position.row;
	if (row < 0) {
		row = 0;
	} else if (row >= ide_state.buffer.getLineCount()) {
		row = ide_state.buffer.getLineCount() - 1;
	}
	const lineLength = ide_state.buffer.getLineEndOffset(row) - ide_state.buffer.getLineStartOffset(row);
	let column = position.column;
	if (column < 0) {
		column = 0;
	} else if (column > lineLength) {
		column = lineLength;
	}
	return { row, column };
}

export function prepareUndo(key: string, allowMerge: boolean): void {
	if (ide_state.activeContextReadOnly) {
		return;
	}
	capturePreMutationSource();
	const now = $.platform.clock.now();
	const shouldMerge = allowMerge
		&& ide_state.lastHistoryKey === key
		&& now - ide_state.lastHistoryTimestamp <= constants.UNDO_COALESCE_INTERVAL_MS;
	if (shouldMerge) {
		ide_state.lastHistoryTimestamp = now;
		return;
	}

	const record = new EditorUndoRecord();
	const anchor = ide_state.selectionAnchor;
	record.setBeforeState(
		ide_state.cursorRow,
		ide_state.cursorColumn,
		ide_state.scrollRow,
		ide_state.scrollColumn,
		anchor ? anchor.row : 0,
		anchor ? anchor.column : 0,
		anchor !== null,
	);
	record.setAfterState(
		ide_state.cursorRow,
		ide_state.cursorColumn,
		ide_state.scrollRow,
		ide_state.scrollColumn,
		anchor ? anchor.row : 0,
		anchor ? anchor.column : 0,
		anchor !== null,
	);

	const buffer = activePieceBuffer();
	if (ide_state.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		const dropped = ide_state.undoStack.shift();
		if (dropped) {
			releaseUndoRecord(buffer, dropped);
		}
	}
	ide_state.undoStack.push(record);

	clearRedoStack(buffer);
	ide_state.lastHistoryTimestamp = now;
	if (allowMerge) {
		ide_state.lastHistoryKey = key;
	} else {
		ide_state.lastHistoryKey = null;
	}
}

function activePieceBuffer(): PieceTreeBuffer {
	return ide_state.buffer as PieceTreeBuffer;
}

function releaseUndoRecord(buffer: PieceTreeBuffer, record: EditorUndoRecord): void {
	const ops = record.ops;
	for (let index = 0; index < ops.length; index += 1) {
		const op = ops[index];
		if (op.deletedRoot) {
			buffer.releaseDetachedSubtree(op.deletedRoot);
			op.deletedRoot = null;
		}
		if (op.insertedRoot) {
			buffer.releaseDetachedSubtree(op.insertedRoot);
			op.insertedRoot = null;
		}
	}
}

function clearRedoStack(buffer: PieceTreeBuffer): void {
	const redoStack = ide_state.redoStack;
	for (let index = 0; index < redoStack.length; index += 1) {
		releaseUndoRecord(buffer, redoStack[index]);
	}
	redoStack.length = 0;
}

const tmpEditStartPosition = { row: 0, column: 0 };

export function applyUndoableReplace(offset: number, deleteLength: number, insertText: string): void {
	if (deleteLength === 0 && insertText.length === 0) {
		return;
	}
	const record = ide_state.undoStack[ide_state.undoStack.length - 1];
	const buffer = activePieceBuffer();
	const op = new TextUndoOp();
	buffer.positionAt(offset, tmpEditStartPosition);
	const startRow = tmpEditStartPosition.row;

	if (deleteLength === 0 && insertText.length > 0) {
		buffer.insert(offset, insertText);
		op.setInsert(offset, insertText.length);
	} else if (deleteLength > 0 && insertText.length === 0) {
		const deletedRoot = buffer.deleteToSubtree(offset, deleteLength);
		op.setDelete(offset, deleteLength, deletedRoot);
	} else {
		const deletedRoot = buffer.replaceToSubtree(offset, deleteLength, insertText);
		op.setReplace(offset, deleteLength, deletedRoot, insertText.length);
	}
	invalidateLuaCommentContextFromRow(buffer, startRow);

	record.ops.push(op);
}

export function undo(): void {
	if (ide_state.activeContextReadOnly) {
		notifyReadOnlyEdit();
		return;
	}
	if (ide_state.undoStack.length === 0) {
		return;
	}
	const record = ide_state.undoStack.pop();
	const buffer = activePieceBuffer();
	const ops = record.ops;
	for (let index = ops.length - 1; index >= 0; index -= 1) {
		const op = ops[index];
		switch (op.kind) {
			case 'insert': {
				op.insertedRoot = buffer.deleteToSubtree(op.offset, op.insertedLen);
				break;
			}
			case 'delete': {
				buffer.insertSubtree(op.offset, op.deletedRoot);
				op.deletedRoot = null;
				break;
			}
			case 'replace': {
				op.insertedRoot = buffer.deleteToSubtree(op.offset, op.insertedLen);
				buffer.insertSubtree(op.offset, op.deletedRoot);
				op.deletedRoot = null;
				break;
			}
		}
	}
	invalidateLuaCommentContextFromRow(buffer, 0);

	if (ide_state.redoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		const dropped = ide_state.redoStack.shift();
		if (dropped) {
			releaseUndoRecord(buffer, dropped);
		}
	}
	ide_state.redoStack.push(record);

	ide_state.cursorRow = record.beforeCursorRow;
	ide_state.cursorColumn = record.beforeCursorColumn;
	ide_state.scrollRow = record.beforeScrollRow;
	ide_state.scrollColumn = record.beforeScrollColumn;
	ide_state.selectionAnchor = record.beforeHasSelectionAnchor
		? { row: record.beforeSelectionAnchorRow, column: record.beforeSelectionAnchorColumn }
		: null;
	ide_state.textVersion = ide_state.buffer.version;
	ide_state.maxLineLengthDirty = true;
	ide_state.layout.markVisualLinesDirty();
	ide_state.layout.invalidateHighlightsFromRow(0);
	ide_state.cursorRevealSuspended = false;
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
	requestSemanticRefresh();

	ide_state.dirty = ide_state.undoStack.length !== ide_state.savePointDepth;
	updateActiveContextDirtyFlag();
	ide_state.saveGeneration = ide_state.saveGeneration + 1;
	const context = getActiveCodeTabContext();
	if (context) {
		context.saveGeneration = ide_state.saveGeneration;
		context.textVersion = ide_state.textVersion;
	}
	breakUndoSequence();
}

export function redo(): void {
	if (ide_state.activeContextReadOnly) {
		notifyReadOnlyEdit();
		return;
	}
	if (ide_state.redoStack.length === 0) {
		return;
	}
	const record = ide_state.redoStack.pop();
	const buffer = activePieceBuffer();
	const ops = record.ops;
	for (let index = 0; index < ops.length; index += 1) {
		const op = ops[index];
		switch (op.kind) {
			case 'insert': {
				buffer.insertSubtree(op.offset, op.insertedRoot);
				op.insertedRoot = null;
				break;
			}
			case 'delete': {
				op.deletedRoot = buffer.deleteToSubtree(op.offset, op.deletedLen);
				break;
			}
			case 'replace': {
				op.deletedRoot = buffer.deleteToSubtree(op.offset, op.deletedLen);
				buffer.insertSubtree(op.offset, op.insertedRoot);
				op.insertedRoot = null;
				break;
			}
		}
	}
	invalidateLuaCommentContextFromRow(buffer, 0);

	if (ide_state.undoStack.length >= constants.UNDO_HISTORY_LIMIT) {
		const dropped = ide_state.undoStack.shift();
		if (dropped) {
			releaseUndoRecord(buffer, dropped);
		}
	}
	ide_state.undoStack.push(record);

	ide_state.cursorRow = record.afterCursorRow;
	ide_state.cursorColumn = record.afterCursorColumn;
	ide_state.scrollRow = record.afterScrollRow;
	ide_state.scrollColumn = record.afterScrollColumn;
	ide_state.selectionAnchor = record.afterHasSelectionAnchor
		? { row: record.afterSelectionAnchorRow, column: record.afterSelectionAnchorColumn }
		: null;
	ide_state.textVersion = ide_state.buffer.version;
	ide_state.maxLineLengthDirty = true;
	ide_state.layout.markVisualLinesDirty();
	ide_state.layout.invalidateHighlightsFromRow(0);
	ide_state.cursorRevealSuspended = false;
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
	requestSemanticRefresh();

	ide_state.dirty = ide_state.undoStack.length !== ide_state.savePointDepth;
	updateActiveContextDirtyFlag();
	ide_state.saveGeneration = ide_state.saveGeneration + 1;
	const context = getActiveCodeTabContext();
	if (context) {
		context.saveGeneration = ide_state.saveGeneration;
		context.textVersion = ide_state.textVersion;
	}
	breakUndoSequence();
}

export function breakUndoSequence(): void {
	ide_state.lastHistoryKey = null;
	ide_state.lastHistoryTimestamp = 0;
}

export function searchVisibleResultCount(): number {
	return computeSearchPageStats().visible;
}

export function searchResultEntryHeight(): number {
	return ide_state.lineHeight * 2;
}

export function isResourceSearchCompactMode(): boolean {
	return ide_state.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

export function resourceSearchEntryHeight(): number {
	return isResourceSearchCompactMode() ? ide_state.lineHeight * 2 : ide_state.lineHeight;
}

export function resourceSearchPageSize(): number {
	return isResourceSearchCompactMode() ? constants.QUICK_OPEN_COMPACT_MAX_RESULTS : constants.QUICK_OPEN_MAX_RESULTS;
}

export function resourceSearchWindowCapacity(): number {
	return ide_state.resourceSearchVisible ? resourceSearchPageSize() : 0;
}

export function resourceSearchVisibleResultCount(): number {
	if (!ide_state.resourceSearchVisible) {
		return 0;
	}
	const remaining = Math.max(0, ide_state.resourceSearchMatches.length - ide_state.resourceSearchDisplayOffset);
	const capacity = resourceSearchWindowCapacity();
	if (capacity <= 0) {
		return remaining;
	}
	return Math.min(remaining, capacity);
}

export function isSymbolSearchCompactMode(): boolean {
	return ide_state.viewportWidth <= constants.SYMBOL_SEARCH_COMPACT_WIDTH;
}

export function symbolSearchEntryHeight(): number {
	if (ide_state.symbolSearchMode === 'references') {
		return ide_state.lineHeight * 2;
	}
	return ide_state.symbolSearchGlobal && isSymbolSearchCompactMode() ? ide_state.lineHeight * 2 : ide_state.lineHeight;
}

export function symbolSearchPageSize(): number {
	if (ide_state.symbolSearchMode === 'references') {
		return constants.REFERENCE_SEARCH_MAX_RESULTS;
	}
	if (!ide_state.symbolSearchGlobal) {
		return constants.SYMBOL_SEARCH_MAX_RESULTS;
	}
	return isSymbolSearchCompactMode() ? constants.SYMBOL_SEARCH_COMPACT_MAX_RESULTS : constants.SYMBOL_SEARCH_MAX_RESULTS;
}

export function symbolSearchVisibleResultCount(): number {
	if (!ide_state.symbolSearchVisible) {
		return 0;
	}
	const remaining = Math.max(0, ide_state.symbolSearchMatches.length - ide_state.symbolSearchDisplayOffset);
	const maxResults = symbolSearchPageSize();
	return Math.min(remaining, maxResults);
}

export function symbolCatalogDedupKey(entry: VMLuaSymbolEntry): string {
	const { location, kind, name } = entry;
	const chunkName = location.chunkName ?? '';
	const normalizedPath = location.path ?? '';
	const locationKey = normalizedPath.length > 0
		? normalizedPath
		: (chunkName.length > 0 ? chunkName : '');
	const startLine = location.range.startLine;
	const startColumn = location.range.startColumn;
	const endLine = location.range.endLine;
	const endColumn = location.range.endColumn;
	return `${kind}|${name}|${locationKey}|${startLine}:${startColumn}|${endLine}:${endColumn}`;
}

export function drawHoverTooltip(codeTop: number, codeBottom: number, textLeft: number): void {
	const tooltip = ide_state.hoverTooltip;
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
	const relativeRow = visualIndex - ide_state.scrollRow;
	if (relativeRow < 0 || relativeRow >= visibleRows) {
		tooltip.bubbleBounds = null;
		return;
	}
	const rowTop = codeTop + relativeRow * ide_state.lineHeight;
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		tooltip.bubbleBounds = null;
		return;
	}
	const entry = ide_state.layout.getCachedHighlight(ide_state.buffer, segment.row);
	const highlight = entry.hi;
	let columnStart = ide_state.wordWrapEnabled ? segment.startColumn : ide_state.scrollColumn;
	if (ide_state.wordWrapEnabled) {
		if (columnStart < segment.startColumn || columnStart > segment.endColumn) {
			columnStart = segment.startColumn;
		}
	}
	const columnCount = ide_state.wordWrapEnabled
		? Math.max(0, segment.endColumn - columnStart)
		: visibleColumnCount() + 8;
	const slice = ide_state.layout.sliceHighlightedLine(highlight, columnStart, columnCount);
	const sliceStartDisplay = slice.startDisplay;
	const sliceEndLimit = ide_state.wordWrapEnabled ? ide_state.layout.columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
	const sliceEndDisplay = ide_state.wordWrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
	const startDisplay = ide_state.layout.columnToDisplay(highlight, tooltip.startColumn);
	const endDisplay = ide_state.layout.columnToDisplay(highlight, tooltip.endColumn);
	const clampedStartDisplay = clamp(startDisplay, sliceStartDisplay, sliceEndDisplay);
	const clampedEndDisplay = clamp(endDisplay, clampedStartDisplay, sliceEndDisplay);
	const expressionStartX = textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, clampedStartDisplay);
	const expressionEndX = textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, clampedEndDisplay);
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
	const bubbleHeight = visibleLines.length * ide_state.lineHeight + constants.HOVER_TOOLTIP_PADDING_Y * 2;
	const viewportRight = ide_state.viewportWidth - 1;
	let bubbleLeft = expressionEndX + ide_state.spaceAdvance;
	if (bubbleLeft + bubbleWidth > viewportRight) {
		bubbleLeft = viewportRight - bubbleWidth;
	}
	if (bubbleLeft <= expressionEndX) {
		const leftCandidate = expressionStartX - bubbleWidth - ide_state.spaceAdvance;
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
	api.rectfill_color(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, undefined, constants.HOVER_TOOLTIP_BACKGROUND);
	api.rect(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, undefined, constants.HOVER_TOOLTIP_BORDER);
	for (let i = 0; i < visibleLines.length; i += 1) {
		const lineY = bubbleTop + constants.HOVER_TOOLTIP_PADDING_Y + i * ide_state.lineHeight;
		drawEditorText(ide_state.font, visibleLines[i], bubbleLeft + constants.HOVER_TOOLTIP_PADDING_X, lineY, undefined, constants.COLOR_STATUS_TEXT);
	}
	tooltip.bubbleBounds = { left: bubbleLeft, top: bubbleTop, right: bubbleLeft + bubbleWidth, bottom: bubbleTop + bubbleHeight };
}

export function focusChunkSource(chunkName: string): void {
	if (!ide_state.active) {
		activate();
	}
	closeSymbolSearch(true);
	closeResourceSearch(true);
	closeLineJump(true);
	closeSearch(true);
	if (!chunkName) {
		return;
	}
	const descriptor = findResourceDescriptorForChunk(chunkName);
	if (!descriptor) {
		return;
	}
	openResourceDescriptor(descriptor);
}

export function listResourcesStrict(): VMResourceDescriptor[] {
	const descriptors = listResources();
	if (!Array.isArray(descriptors)) {
		throw new Error('[VMCartEditor] Resource enumeration returned an invalid result.');
	}
	return descriptors;
}

export function openResourceDescriptor(descriptor: VMResourceDescriptor): void {
	selectResourceInPanel(descriptor);
	if (descriptor.type === 'atlas') {
		ide_state.showMessage('Atlas resources cannot be previewed in the IDE.', constants.COLOR_STATUS_WARNING, 3.2);
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

// Clear overlays and stop highlights across all open code ide_state.tabs, not just the
// currently ide_state.active one. Useful when resuming after a runtime error where the
// editor may have switched ide_state.tabs to the faulting chunk.
export function clearAllRuntimeErrorOverlays(): void {
	ide_state.runtimeErrorOverlay = null;
	for (const context of ide_state.codeTabContexts.values()) {
		context.runtimeErrorOverlay = null;
	}
	clearExecutionStopHighlights();
}

export function setActiveRuntimeErrorOverlay(overlay: RuntimeErrorOverlay): void {
	if (overlay && overlay.hidden === undefined) {
		overlay.hidden = false;
	}
	ide_state.runtimeErrorOverlay = overlay;
	const context = getActiveCodeTabContext();
	if (context) {
		context.runtimeErrorOverlay = overlay;
	}
}

export function setExecutionStopHighlight(row: number): void {
	const context = getActiveCodeTabContext();
	if (!context) {
		ide_state.executionStopRow = null;
		return;
	}
	let nextRow = row;
	if (nextRow !== null) {
		const maxRow = Math.max(0, ide_state.buffer.getLineCount() - 1);
		nextRow = clamp(nextRow, 0, maxRow);
	}
	context.executionStopRow = nextRow;
	ide_state.executionStopRow = nextRow;
}

export function clearExecutionStopHighlights(): void {
	ide_state.executionStopRow = null;
	for (const context of ide_state.codeTabContexts.values()) {
		context.executionStopRow = null;
	}
}

export function syncRuntimeErrorOverlayFromContext(context: CodeTabContext): void {
	ide_state.runtimeErrorOverlay = context ? context.runtimeErrorOverlay : null;
	ide_state.executionStopRow = context ? context.executionStopRow : null;
}

let builtinIdentifierEpoch = 0;

export function getBuiltinIdentifiersSnapshot(): { epoch: number; ids: ReadonlySet<string> } {
	const cached = ide_state.builtinIdentifierCache;
	if (cached && cached.caseInsensitive === ide_state.caseInsensitive && cached.canonicalization === ide_state.canonicalization) {
		return cached;
	}
	const descriptors = listLuaBuiltinFunctions();
	const names: string[] = [];
	for (let index = 0; index < descriptors.length; index += 1) {
		names.push(descriptors[index].name);
	}
	names.sort((a, b) => a.localeCompare(b));
	const canonicalize = ide_state.caseInsensitive
		? (ide_state.canonicalization === 'upper'
			? (value: string) => value.toUpperCase()
			: (value: string) => value.toLowerCase())
		: (value: string) => value;
	const ids = new Set<string>();
	for (let i = 0; i < names.length; i += 1) {
		const name = names[i];
		const canonical = canonicalize(name);
		ids.add(canonical);
		ids.add(name);
	}
	builtinIdentifierEpoch += 1;
	const entry = {
		epoch: builtinIdentifierEpoch,
		ids,
		canonicalization: ide_state.canonicalization,
		caseInsensitive: ide_state.caseInsensitive,
	};
	ide_state.builtinIdentifierCache = entry;
	return entry;
}

export function getBuiltinIdentifierSet(): ReadonlySet<string> {
	return getBuiltinIdentifiersSnapshot().ids;
}

export function getTabBarTotalHeight(): number {
	return ide_state.tabBarHeight * Math.max(1, ide_state.tabBarRowCount);
}

export function topMargin(): number {
	return ide_state.headerHeight + getTabBarTotalHeight() + 2;
}

export function statusAreaHeight(): number {
	if (!ide_state.message.visible) {
		return ide_state.baseBottomMargin;
	}
	const segments = getStatusMessageLines();
	const lineCount = Math.max(1, segments.length);
	return ide_state.baseBottomMargin + lineCount * ide_state.lineHeight + 4;
}

export function bottomMargin(): number {
	return statusAreaHeight() + getVisibleProblemsPanelHeight();
}

export function getVisibleProblemsPanelHeight(): number {
	if (!ide_state.problemsPanel?.isVisible) {
		return 0;
	}
	const planned = ide_state.problemsPanel.visibleHeight;
	if (planned <= 0) {
		return 0;
	}
	const statusHeight = statusAreaHeight();
	const maxAvailable = Math.max(0, ide_state.viewportHeight - statusHeight - (ide_state.headerHeight + getTabBarTotalHeight()));
	if (maxAvailable <= 0) {
		return 0;
	}
	return Math.min(planned, maxAvailable);
}

export function getStatusMessageLines(): string[] {
	if (!ide_state.message.visible) {
		return [];
	}
	const rawLines = normalizeEndingsAndSplitLines(ide_state.message.text);
	const maxWidth = Math.max(ide_state.viewportWidth - 8, ide_state.charAdvance);
	const localLines: string[] = [];
	for (let i = 0; i < rawLines.length; i += 1) {
		const wrapped = wrapOverlayLine(rawLines[i], maxWidth);
		for (let j = 0; j < wrapped.length; j += 1) {
			localLines.push(wrapped[j]);
		}
	}
	return localLines.length > 0 ? localLines : [''];
}

export function tryShowLuaErrorOverlay(error: unknown): boolean {
	let candidate: { line?: unknown; column?: unknown; chunkName?: unknown; message?: unknown };
	if (typeof error === 'string') {
		candidate = { message: error };
	} else if (error && typeof error === 'object') {
		candidate = error as { line?: unknown; column?: unknown; chunkName?: unknown; message?: unknown };
	} else {
		throw new Error('[VMCartEditor] Lua error payload is neither an object nor a string.');
	}
	const rawLine = candidate.line as number;
	const rawColumn = candidate.column as number;
	const chunkName = candidate.chunkName as string;
	const messageText = candidate.message as string;
	const hasLine = rawLine !== null && rawLine > 0;
	const hasColumn = rawColumn !== null && rawColumn > 0;
	if (!hasLine && !hasColumn) {
		if (messageText) {
			ide_state.showMessage(messageText, constants.COLOR_STATUS_ERROR, 4.0);
			return true;
		}
		return false;
	}
	const safeLine = hasLine ? rawLine : 0;
	const safeColumn = hasColumn ? rawColumn : 0;
	const baseMessage = messageText ?? 'Unprintable error';
	showRuntimeErrorInChunk(chunkName, safeLine, safeColumn, baseMessage);
	return true;
}

export function safeInspectLuaExpression(request: VMLuaHoverRequest): VMLuaHoverResult {
	ide_state.inspectorRequestFailed = false;
	try {
		return inspectLuaExpression(request);
	} catch (error) {
		ide_state.inspectorRequestFailed = true;
		const handled = tryShowLuaErrorOverlay(error);
		if (!handled) {
			const message = extractErrorMessage(error);
			ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 3.2);
		}
		return null;
	}
}

export function tickInput(): void {
	handlePointerWheel();
	handleTextEditorPointerInput();
	if (ide_state.pendingActionPrompt) {
		handleActionPromptInput();
		return;
	}
	handleEditorInput();
}

export function update(deltaSeconds: number): void {
	updateBlink(deltaSeconds);
	ide_state.updateMessage(deltaSeconds);
	updateRuntimeErrorOverlay(deltaSeconds);
	ide_state.completion.processPending(deltaSeconds);
	const semanticError = ide_state.layout.getLastSemanticError();
	if (semanticError && semanticError !== ide_state.lastReportedSemanticError) {
		ide_state.showMessage(semanticError, constants.COLOR_STATUS_ERROR, 2.0);
		ide_state.lastReportedSemanticError = semanticError;
	} else if (!semanticError && ide_state.lastReportedSemanticError !== null) {
		ide_state.lastReportedSemanticError = null;
	}
	if (ide_state.diagnosticsDirty) {
		processDiagnosticsQueue(ide_state.clockNow());
	}
	// if (isCodeTabActive() && !ide_state.cursorRevealSuspended) {
	// 	ensureCursorVisible();
	// }
}

const diagnosticsMinIntervalMs = 600;
let diagnosticsTimer: TimerHandle | null = null;
let diagnosticsScheduledForMs = 0;
let lastDiagnosticsRunMs = 0;

function cancelDiagnosticsTimer(): void {
	if (diagnosticsTimer) {
		diagnosticsTimer.cancel();
		diagnosticsTimer = null;
	}
	diagnosticsScheduledForMs = 0;
	ide_state.diagnosticsComputationScheduled = false;
}

export function processDiagnosticsQueue(now: number): void {
	if (!ide_state.diagnosticsDirty) {
		return;
	}
	const activeId = ide_state.activeCodeTabContextId;
	if (activeId && !ide_state.dirtyDiagnosticContexts.has(activeId)) {
		return;
	}
	if (ide_state.dirtyDiagnosticContexts.size === 0) {
		ide_state.diagnosticsDirty = false;
		ide_state.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	if (ide_state.diagnosticsTaskPending) {
		return;
	}
	if (ide_state.diagnosticsDueAtMs === null) {
		ide_state.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
	}
	scheduleDiagnosticsComputation();
}

export function scheduleDiagnosticsComputation(): void {
	const now = ide_state.clockNow();
	const dueAt = ide_state.diagnosticsDueAtMs ?? now + diagnosticsDebounceMs;
	const spacedDueAt = Math.max(dueAt, lastDiagnosticsRunMs + diagnosticsMinIntervalMs);
	ide_state.diagnosticsDueAtMs = spacedDueAt;
	if (diagnosticsTimer && diagnosticsTimer.isActive() && diagnosticsScheduledForMs >= spacedDueAt) {
		return;
	}
	cancelDiagnosticsTimer();
	const delay = clamp(spacedDueAt - now, 0, diagnosticsMinIntervalMs + diagnosticsDebounceMs);
	diagnosticsScheduledForMs = spacedDueAt;
	ide_state.diagnosticsComputationScheduled = true;
	diagnosticsTimer = scheduleIdeOnce(delay, () => {
		diagnosticsTimer = null;
		diagnosticsScheduledForMs = 0;
		ide_state.diagnosticsComputationScheduled = false;
		executeDiagnosticsComputation();
	});
}

export function executeDiagnosticsComputation(): void {
	if (!ide_state.diagnosticsDirty) {
		ide_state.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	const activeId = ide_state.activeCodeTabContextId;
	if (activeId && !ide_state.dirtyDiagnosticContexts.has(activeId)) {
		ide_state.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	if (ide_state.dirtyDiagnosticContexts.size === 0) {
		ide_state.diagnosticsDirty = false;
		ide_state.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	if (ide_state.diagnosticsTaskPending) {
		scheduleDiagnosticsComputation();
		return;
	}
	const now = ide_state.clockNow();
	if (ide_state.diagnosticsDueAtMs === null) {
		ide_state.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
		scheduleDiagnosticsComputation();
		return;
	}
	if (now < ide_state.diagnosticsDueAtMs) {
		scheduleDiagnosticsComputation();
		return;
	}
	const batch = collectDiagnosticsBatch();
	if (batch.length === 0) {
		ide_state.diagnosticsDirty = false;
		ide_state.diagnosticsDueAtMs = null;
		cancelDiagnosticsTimer();
		return;
	}
	enqueueDiagnosticsJob(batch);
}

export function enqueueDiagnosticsJob(contextIds: readonly string[]): void {
	if (contextIds.length === 0) {
		return;
	}
	ide_state.diagnosticsTaskPending = true;
	const batch = [...contextIds];
	enqueueBackgroundTask(() => {
		runDiagnosticsForContexts(batch);
		ide_state.diagnosticsTaskPending = false;
		lastDiagnosticsRunMs = ide_state.clockNow();
		if (ide_state.dirtyDiagnosticContexts.size === 0) {
			ide_state.diagnosticsDirty = false;
			ide_state.diagnosticsDueAtMs = null;
			cancelDiagnosticsTimer();
		} else {
			const now = ide_state.clockNow();
			ide_state.diagnosticsDueAtMs = now + diagnosticsDebounceMs;
			processDiagnosticsQueue(now);
		}
		return false;
	});
}

export function collectDiagnosticsBatch(): string[] {
	const activeId = ide_state.activeCodeTabContextId;
	if (activeId && ide_state.dirtyDiagnosticContexts.has(activeId)) {
		return [activeId];
	}
	return [];
}

export function runDiagnosticsForContexts(contextIds: readonly string[]): void {
	if (contextIds.length === 0) {
		return;
	}
	const providers = createDiagnosticProviders();
	const activeId = ide_state.activeCodeTabContextId;
	const inputs: DiagnosticContextInput[] = [];
	const inputLookup = new Map<string, DiagnosticContextInput>();
	const metadata: Array<{ id: string; chunkName: string }> = [];
	for (let index = 0; index < contextIds.length; index += 1) {
		const contextId = contextIds[index];
		const context = ide_state.codeTabContexts.get(contextId);
		if (!context) {
			ide_state.diagnosticsCache.delete(contextId);
			ide_state.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		const chunkName = resolveHoverChunkName(context);
		const isActive = activeId && contextId === activeId;
		const cached = ide_state.diagnosticsCache.get(contextId);
		const buffer = isActive ? ide_state.buffer : context.buffer;
		const version = buffer.version;
		if (cached && cached.chunkName === chunkName && cached.version === version) {
			ide_state.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		const source = getTextSnapshot(buffer);
		if (source.length === 0) {
			ide_state.diagnosticsCache.delete(contextId);
			ide_state.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		const input: DiagnosticContextInput = {
			id: context.id,
			title: context.title,
			descriptor: context.descriptor,
			chunkName,
			source,
			lines: splitText(source),
			version,
		};
		inputs.push(input);
		inputLookup.set(context.id, input);
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
		const input = inputLookup.get(meta.id)!;
		ide_state.diagnosticsCache.set(meta.id, {
			contextId: meta.id,
			chunkName: meta.chunkName,
			diagnostics: diagList,
			version: input.version,
			source: input.source,
		});
		ide_state.dirtyDiagnosticContexts.delete(meta.id);
	}
	updateDiagnosticsAggregates();
}

export function createDiagnosticProviders(): DiagnosticProviders {
	return {
		listLocalSymbols: (chunk) => {
			return listLuaSymbols(chunk);
		},
		listGlobalSymbols: () => {
			return listGlobalLuaSymbols();
		},
		listBuiltins: () => {
			return listLuaBuiltinFunctions();
		},
	};
}

export function updateDiagnosticsAggregates(): void {
	const aggregate: EditorDiagnostic[] = [];
	for (const context of ide_state.codeTabContexts.values()) {
		const entry = ide_state.diagnosticsCache.get(context.id);
		if (entry) {
			for (let index = 0; index < entry.diagnostics.length; index += 1) {
				aggregate.push(entry.diagnostics[index]);
			}
		}
	}
	for (const [contextId, entry] of ide_state.diagnosticsCache) {
		if (ide_state.codeTabContexts.has(contextId)) {
			continue;
		}
		for (let index = 0; index < entry.diagnostics.length; index += 1) {
			aggregate.push(entry.diagnostics[index]);
		}
	}
	ide_state.diagnostics = aggregate;
	refreshActiveDiagnostics();
	ide_state.problemsPanel.setDiagnostics(ide_state.diagnostics);
}

export function refreshActiveDiagnostics(): void {
	ide_state.diagnosticsByRow.clear();
	const activeId = ide_state.activeCodeTabContextId;
	if (!activeId) {
		return;
	}
	const entry = ide_state.diagnosticsCache.get(activeId);
	if (!entry) {
		return;
	}
	for (let index = 0; index < entry.diagnostics.length; index += 1) {
		const diag = entry.diagnostics[index];
		let bucket = ide_state.diagnosticsByRow.get(diag.row);
		if (!bucket) {
			bucket = [];
			ide_state.diagnosticsByRow.set(diag.row, bucket);
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

export function getActiveSemanticDefinitions(): readonly LuaDefinitionInfo[] {
	const context = getActiveCodeTabContext();
	const chunkName = resolveHoverChunkName(context) ?? '<anynomous>';
	return ide_state.layout.getSemanticDefinitions(ide_state.buffer, ide_state.textVersion, chunkName);
}

export function getLuaModuleAliases(chunkName: string): Map<string, string> {
	const activeContext = getActiveCodeTabContext();
	const targetChunk = chunkName ?? resolveHoverChunkName(activeContext) ?? '<anynomous>';
	ide_state.layout.getSemanticDefinitions(ide_state.buffer, ide_state.textVersion, targetChunk);
	const data = ide_state.semanticWorkspace.getFileData(targetChunk);
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

export function findContextByChunk(chunkName: string): CodeTabContext {
	const byChunk = findCodeTabContext(chunkName);
	if (byChunk) {
		return byChunk;
	}
	for (const context of ide_state.codeTabContexts.values()) {
		const descriptor = context.descriptor;
		if (descriptor) {
			continue;
		}
		const aliases: string[] = ['__entry__', '<anynomous>'];
		for (let index = 0; index < aliases.length; index += 1) {
			const alias = aliases[index];
			if (alias === chunkName) {
				return context;
			}
		}
	}
	return null;
}

export function getDiagnosticsForRow(row: number): readonly EditorDiagnostic[] {
	const bucket = ide_state.diagnosticsByRow.get(row);
	return bucket ?? EMPTY_DIAGNOSTICS;
}

export function isActive(): boolean {
	return ide_state.active;
}

export function draw(): void {
	ide_state.codeVerticalScrollbarVisible = false;
	ide_state.codeHorizontalScrollbarVisible = false;
	const frameColor = Msx1Colors[constants.COLOR_FRAME];
	api.rectfill_color(0, 0, ide_state.viewportWidth, ide_state.viewportHeight, undefined, { r: frameColor.r, g: frameColor.g, b: frameColor.b, a: frameColor.a });

	renderTopBar();

	ide_state.tabBarRowCount = renderTabBar(api, {
		viewportWidth: ide_state.viewportWidth,
		headerHeight: ide_state.headerHeight,
		rowHeight: ide_state.tabBarHeight,
		lineHeight: ide_state.lineHeight,
		tabs: ide_state.tabs,
		activeTabId: ide_state.activeTabId,
		tabHoverId: ide_state.tabHoverId,
		measureText: (text: string) => measureText(text),
		drawText: (text, x, y, color) => drawEditorText(ide_state.font, text, x, y, undefined, color),
		getDirtyMarkerMetrics: () => constants.TAB_DIRTY_MARKER_METRICS,
		tabButtonBounds: ide_state.tabButtonBounds,
		tabCloseButtonBounds: ide_state.tabCloseButtonBounds,
	});
	drawResourcePanel();
	if (isResourceViewActive()) {
		drawResourceViewer();
	} else {
		hideResourceViewerSprite();
		drawCreateResourceBar();
		drawSearchBar();
		renderResourceSearchBar();
		drawSymbolSearchBar();
		drawRenameBar();
		drawLineJumpBar();
		renderCodeArea();
	}
	drawProblemsPanel();
	renderStatusBar();
	renderTopBarDropdown();
	if (ide_state.pendingActionPrompt) {
		drawActionPromptOverlay();
	}
}

export function getActiveResourceViewer(): ResourceViewerState {
	const tab = ide_state.tabs.find(candidate => candidate.id === ide_state.activeTabId);
	if (!tab) {
		return null;
	}
	if (tab.kind !== 'resource_view' || !tab.resource) {
		return null;
	}
	return tab.resource;
}

export function shutdown(): void {
	clearExecutionStopHighlights();
	storeActiveCodeTabContext();
	ide_state.input.applyOverrides(false, captureKeys);
	ide_state.active = false;
	if (ide_state.workspaceAutosaveEnabled) {
		stopWorkspaceAutosaveLoop();
		void runWorkspaceAutosaveTick();
	}
	ide_state.workspaceAutosaveEnabled = false;
	clearWorkspaceCachedSources();
	ide_state.workspaceAutosaveSignature = null;
	initializeWorkspaceStorage(null);
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.pointerAuxWasPressed = false;
	clearGotoHoverHighlight();
	ide_state.cursorRevealSuspended = false;
	ide_state.searchActive = false;
	ide_state.searchVisible = false;
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.searchMatches = [];
	ide_state.globalSearchMatches = [];
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchScope = 'local';
	ide_state.searchCurrentIndex = -1;
	applySearchFieldText('', true);
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	applyLineJumpFieldText('', true);
	ide_state.createResourceActive = false;
	ide_state.createResourceVisible = false;
	applyCreateResourceFieldText('', true);
	ide_state.createResourceError = null;
	ide_state.createResourceWorking = false;
	resetActionPromptState();
	hideResourcePanel();
	activateCodeTab();
}

export function activate(): void {
	ide_state.input.applyOverrides(true, captureKeys);
	if (ide_state.activeCodeTabContextId) {
		const existingTab = ide_state.tabs.find(candidate => candidate.id === ide_state.activeCodeTabContextId);
		if (existingTab) {
			setActiveTab(ide_state.activeCodeTabContextId);
		} else {
			activateCodeTab();
		}
	} else {
		activateCodeTab();
	}
	bumpTextVersion();
	ide_state.cursorVisible = true;
	ide_state.blinkTimer = 0;
	ide_state.active = true;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.cursorRevealSuspended = false;
	updateDesiredColumn();
	ide_state.selectionAnchor = null;
	ide_state.searchActive = false;
	ide_state.searchVisible = false;
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	ide_state.lineJumpValue = '';
	syncRuntimeErrorOverlayFromContext(getActiveCodeTabContext());
	resetActionPromptState();
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.globalSearchMatches = [];
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchScope = 'local';
	if (ide_state.searchQuery.length === 0) {
		ide_state.searchMatches = [];
		ide_state.searchCurrentIndex = -1;
	} else {
		startSearchJob();
	}
	ensureCursorVisible();
	if (ide_state.message.visible && !Number.isFinite(ide_state.message.timer) && ide_state.deferredMessageDuration !== null) {
		ide_state.message.timer = ide_state.deferredMessageDuration;
	}
	ide_state.deferredMessageDuration = null;
	if (ide_state.dimCrtInEditor) {
		applyEditorCrtDimming();
	}
	if (BmsxVMRuntime.instance.hasRuntimeFailed) {
		const rendered = renderRuntimeFaultOverlay({
			snapshot: BmsxVMRuntime.instance.faultSnapshot,
			luaRuntimeFailed: BmsxVMRuntime.instance.hasRuntimeFailed,
			needsFlush: BmsxVMRuntime.instance.doesFaultOverlayNeedFlush,
			force: false,
		});
		if (rendered) BmsxVMRuntime.instance.flushedFaultOverlay();
	}
}

export function applyEditorCrtDimming(): void {
	$.view.crt_postprocessing_enabled = false;
	$.view.psx_dither_2d_enabled = false;

	// No-op because not used anyway and causing confusion as to whether it's properly restored to original values on close

	// const view = $.view;
	// const [bleedR, bleedG, bleedB] = view.colorBleed;
	// const [glowR, glowG, glowB] = view.glowColor;
	// ide_state.crtOptionsSnapshot = {
	// 	noiseIntensity: view.noiseIntensity,
	// 	colorBleed: [bleedR, bleedG, bleedB] as [number, number, number],
	// 	blurIntensity: view.blurIntensity,
	// 	glowColor: [glowR, glowG, glowB] as [number, number, number],
	// };
	// let snapshot = ide_state.crtOptionsSnapshot;
	// view.noiseIntensity = snapshot.noiseIntensity * 0.5;
	// view.colorBleed = [
	// 	snapshot.colorBleed[0] * 0.5,
	// 	snapshot.colorBleed[1] * 0.5,
	// 	snapshot.colorBleed[2] * 0.5,
	// ] as [number, number, number];
	// view.blurIntensity = snapshot.blurIntensity * 0.5;
	// view.glowColor = [
	// 	snapshot.glowColor[0] * 0.5,
	// 	snapshot.glowColor[1] * 0.5,
	// 	snapshot.glowColor[2] * 0.5,
	// ] as [number, number, number];
}

export function restoreCrtOptions(): void {
	$.view.crt_postprocessing_enabled = true;
	$.view.psx_dither_2d_enabled = true;
	// const snapshot = ide_state.crtOptionsSnapshot;
	// if (!snapshot) {
	// 	throw new Error('[VMCartEditor] CRT options snapshot unavailable during restore.');
	// }
	// ide_state.crtOptionsSnapshot = null;
	// const view = $.view;
	// view.noiseIntensity = snapshot.noiseIntensity;
	// view.colorBleed = [snapshot.colorBleed[0], snapshot.colorBleed[1], snapshot.colorBleed[2]] as [number, number, number];
	// view.blurIntensity = snapshot.blurIntensity;
	// view.glowColor = [snapshot.glowColor[0], snapshot.glowColor[1], snapshot.glowColor[2]] as [number, number, number];
}

export function deactivate(): void {
	storeActiveCodeTabContext();
	ide_state.active = false;
	if (ide_state.dimCrtInEditor) {
		restoreCrtOptions();
	}
	ide_state.completion.closeSession();
	ide_state.input.applyOverrides(false, captureKeys);
	ide_state.selectionAnchor = null;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.pointerAuxWasPressed = false;
	ide_state.tabDragState = null;
	clearGotoHoverHighlight();
	ide_state.scrollbarController.cancel();
	ide_state.cursorRevealSuspended = false;
	ide_state.searchActive = false;
	ide_state.searchVisible = false;
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	resetActionPromptState();
	closeCreateResourcePrompt(false);
	hideResourcePanel();
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.globalSearchMatches = [];
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchScope = 'local';
	clearBackgroundTasks();
	ide_state.diagnosticsTaskPending = false;
	ide_state.lastReportedSemanticError = null;
}

export function handleCreateResourceInput(): void {
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeCreateResourcePrompt(true);
		return;
	}
	if (!ide_state.createResourceWorking && (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter'))) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		void confirmCreateResourcePrompt();
		return;
	}
	if (ide_state.createResourceWorking) {
		return;
	}
	const textChanged = applyInlineFieldEditing(ide_state.createResourceField, {
		allowSpace: true,
		characterFilter: (value: string): boolean => isValidCreateResourceCharacter(value),
		maxLength: constants.CREATE_RESOURCE_MAX_PATH_LENGTH,
	});
	if (textChanged) {
		ide_state.createResourceError = null;
		resetBlink();
	}
	ide_state.createResourcePath = getFieldText(ide_state.createResourceField);
}

export function openCreateResourcePrompt(): void {
	if (ide_state.createResourceWorking) {
		return;
	}
	ide_state.resourcePanelFocused = false;
	ide_state.renameController.cancel();
	let defaultPath = ide_state.createResourcePath.length === 0
		? determineCreateResourceDefaultPath()
		: ide_state.createResourcePath;
	if (defaultPath.length > constants.CREATE_RESOURCE_MAX_PATH_LENGTH) {
		defaultPath = defaultPath.slice(defaultPath.length - constants.CREATE_RESOURCE_MAX_PATH_LENGTH);
	}
	applyCreateResourceFieldText(defaultPath, true);
	ide_state.createResourceVisible = true;
	ide_state.createResourceActive = true;
	ide_state.createResourceError = null;
	ide_state.cursorVisible = true;
	resetBlink();
}

export function closeCreateResourcePrompt(focusEditor: boolean): void {
	ide_state.createResourceActive = false;
	ide_state.createResourceVisible = false;
	ide_state.createResourceWorking = false;
	if (focusEditor) {
		focusEditorFromSearch();
		focusEditorFromLineJump();
	}
	applyCreateResourceFieldText('', true);
	ide_state.createResourceError = null;
	resetBlink();
}

export async function confirmCreateResourcePrompt(): Promise<void> {
	if (ide_state.createResourceWorking) {
		return;
	}
	let normalizedPath: string;
	let directory: string;
	try {
		const result = normalizeCreateResourceRequest(ide_state.createResourcePath);
		normalizedPath = result.path;
		directory = result.directory;
		applyCreateResourceFieldText(normalizedPath, true);
		ide_state.createResourceError = null;
	} catch (error) {
		const message = extractErrorMessage(error);
		ide_state.createResourceError = message;
		ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
		resetBlink();
		return;
	}
	ide_state.createResourceWorking = true;
	resetBlink();
	const contents = constants.DEFAULT_NEW_LUA_RESOURCE_CONTENT;
	try {
		const descriptor = await createLuaResource({ path: normalizedPath, contents });
		ide_state.lastCreateResourceDirectory = directory;
		ide_state.pendingResourceSelectionAssetId = descriptor.asset_id;
		if (ide_state.resourcePanelVisible) {
			refreshResourcePanelContents();
		}
		openLuaCodeTab(descriptor);
		ide_state.showMessage(`Created ${descriptor.path} (asset ${descriptor.asset_id})`, constants.COLOR_STATUS_SUCCESS, 2.5);
		closeCreateResourcePrompt(false);
	} catch (error) {
		const message = extractErrorMessage(error);
		const simplified = message.replace(/^\[BmsxVMRuntime\]\s*/, '');
		ide_state.createResourceError = simplified;
		ide_state.showMessage(`Failed to create resource: ${simplified}`, constants.COLOR_STATUS_WARNING, 4.0);
	} finally {
		ide_state.createResourceWorking = false;
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

export function normalizeCreateResourceRequest(rawPath: string): { path: string; asset_id: string; directory: string } {
	const candidate = rawPath;
	const slashIndex = candidate.lastIndexOf('/');
	const directory = slashIndex === -1 ? '' : candidate.slice(0, slashIndex + 1);
	const fileName = slashIndex === -1 ? candidate : candidate.slice(slashIndex + 1);
	const baseName = fileName.endsWith('.lua') ? fileName.slice(0, -4) : fileName;
	return { path: candidate, asset_id: baseName, directory: ensureDirectorySuffix(directory) };
}

export function determineCreateResourceDefaultPath(): string {
	if (ide_state.lastCreateResourceDirectory && ide_state.lastCreateResourceDirectory.length > 0) {
		return ide_state.lastCreateResourceDirectory;
	}
	const activeContext = getActiveCodeTabContext();
	if (activeContext && activeContext.descriptor && typeof activeContext.descriptor.path === 'string' && activeContext.descriptor.path.length > 0) {
		return ensureDirectorySuffix(activeContext.descriptor.path);
	}
	let descriptors: VMResourceDescriptor[] = [];
	try {
		descriptors = listResources();
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
	const slashIndex = path.lastIndexOf('/');
	if (slashIndex === -1) {
		return '';
	}
	return path.slice(0, slashIndex + 1);
}

export function openResourceSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeSymbolSearch(false);
	ide_state.renameController.cancel();
	ide_state.resourceSearchVisible = true;
	ide_state.resourceSearchActive = true;
	applyResourceSearchFieldText(initialQuery, true);
	refreshResourceCatalog();
	updateResourceSearchMatches();
	ide_state.resourceSearchHoverIndex = -1;
	resetBlink();
}

export function closeResourceSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applyResourceSearchFieldText('', true);
	}
	ide_state.resourceSearchActive = false;
	ide_state.resourceSearchVisible = false;
	ide_state.resourceSearchMatches = [];
	ide_state.resourceSearchSelectionIndex = -1;
	ide_state.resourceSearchDisplayOffset = 0;
	ide_state.resourceSearchHoverIndex = -1;
	ide_state.resourceSearchField.selectionAnchor = null;
	ide_state.resourceSearchField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromResourceSearch(): void {
	if (!ide_state.resourceSearchActive && !ide_state.resourceSearchVisible) {
		return;
	}
	ide_state.resourceSearchActive = false;
	if (ide_state.resourceSearchQuery.length === 0) {
		ide_state.resourceSearchVisible = false;
		ide_state.resourceSearchMatches = [];
		ide_state.resourceSearchSelectionIndex = -1;
		ide_state.resourceSearchDisplayOffset = 0;
	}
	ide_state.resourceSearchField.selectionAnchor = null;
	ide_state.resourceSearchField.pointerSelecting = false;
	resetBlink();
}

export function openSymbolSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	ide_state.renameController.cancel();
	ide_state.symbolSearchMode = 'symbols';
	ide_state.referenceCatalog = [];
	ide_state.symbolSearchGlobal = false;
	ide_state.symbolSearchVisible = true;
	ide_state.symbolSearchActive = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	ide_state.symbolSearchHoverIndex = -1;
	resetBlink();
}

export function openGlobalSymbolSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	ide_state.renameController.cancel();
	ide_state.symbolSearchMode = 'symbols';
	ide_state.referenceCatalog = [];
	ide_state.symbolSearchGlobal = true;
	ide_state.symbolSearchVisible = true;
	ide_state.symbolSearchActive = true;
	applySymbolSearchFieldText(initialQuery, true);
	refreshSymbolCatalog(true);
	updateSymbolSearchMatches();
	ide_state.symbolSearchHoverIndex = -1;
	resetBlink();
}

export function openReferenceSearchPopup(): void {
	const context = getActiveCodeTabContext();
	if (ide_state.symbolSearchVisible || ide_state.symbolSearchActive) {
		closeSymbolSearch(false);
	}
	ide_state.renameController.cancel();
	const referenceContext = buildProjectReferenceContext(context);
	const result = resolveReferenceLookup({
		layout: ide_state.layout,
		workspace: ide_state.semanticWorkspace,
		buffer: ide_state.buffer,
		textVersion: ide_state.textVersion,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		chunkName: referenceContext.chunkName,
	});
	if (result.kind === 'error') {
		ide_state.showMessage(result.message, constants.COLOR_STATUS_WARNING, result.duration);
		return;
	}
	const { info, initialIndex } = result;
	ide_state.referenceState.apply(info, initialIndex);
	ide_state.referenceCatalog = buildReferenceCatalogForExpression(info, context);
	if (ide_state.referenceCatalog.length === 0) {
		ide_state.showMessage('No references found', constants.COLOR_STATUS_WARNING, 1.6);
		return;
	}
	ide_state.symbolSearchMode = 'references';
	ide_state.symbolSearchGlobal = true;
	ide_state.symbolSearchVisible = true;
	ide_state.symbolSearchActive = true;
	applySymbolSearchFieldText('', true);
	ide_state.symbolSearchQuery = '';
	updateReferenceSearchMatches();
	ide_state.symbolSearchHoverIndex = -1;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
	showReferenceStatusMessage();
}

export function openRenamePrompt(): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	closeSearch(false, true);
	closeLineJump(false);
	closeResourceSearch(false);
	closeSymbolSearch(false);
	ide_state.createResourceActive = false;
	const context = getActiveCodeTabContext();
	const referenceContext = buildProjectReferenceContext(context);
	const started = ide_state.renameController.begin({
		layout: ide_state.layout,
		workspace: ide_state.semanticWorkspace,
		buffer: ide_state.buffer,
		textVersion: ide_state.textVersion,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		chunkName: referenceContext.chunkName,
	});
	if (started) {
		ide_state.cursorVisible = true;
		resetBlink();
	}
}

export function commitRename(payload: RenameCommitPayload): RenameCommitResult {
	const { matches, newName, activeIndex, info } = payload;
	const activeContext = getActiveCodeTabContext();
	const referenceContext = buildProjectReferenceContext(activeContext);
	const activeChunkName = referenceContext.chunkName;
	const renameManager = new CrossFileRenameManager(getCrossFileRenameDependencies(), ide_state.semanticWorkspace);
	const sortedMatches = matches.slice();
	sortedMatches.sort((a, b) => {
		if (a.row !== b.row) {
			return a.row - b.row;
		}
		return a.start - b.start;
	});
	let updatedTotal = 0;

	const decl = info.definitionKey ? ide_state.semanticWorkspace.getDecl(info.definitionKey) : null;
	const references = info.definitionKey ? ide_state.semanticWorkspace.getReferences(info.definitionKey) : [];
	type RangeBucket = { chunkName: string; ranges: LuaSourceRange[]; seen: Set<string> };
	const rangeMap = new Map<string, RangeBucket>();
	const addRange = (range: LuaSourceRange): void => {
		if (!range || !range.start || !range.end) {
			return;
		}
		const chunk = range.chunkName ?? activeChunkName;
		let bucket = rangeMap.get(chunk);
		if (!bucket) {
			bucket = { chunkName: chunk, ranges: [], seen: new Set<string>() };
			rangeMap.set(chunk, bucket);
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
	if (activeChunkName) {
		rangeMap.delete(activeChunkName);
	}

	if (sortedMatches.length > 0) {
		prepareUndo('rename', false);
		recordEditContext('replace', newName);
		for (let index = sortedMatches.length - 1; index >= 0; index -= 1) {
			const match = sortedMatches[index];
			const startOffset = ide_state.buffer.offsetAt(match.row, match.start);
			const endOffset = ide_state.buffer.offsetAt(match.row, match.end);
			applyUndoableReplace(startOffset, endOffset - startOffset, newName);
			ide_state.layout.invalidateLine(match.row);
		}
		markTextMutated();

		const clampedIndex = clamp(activeIndex, 0, sortedMatches.length - 1);
		const focused = sortedMatches[clampedIndex];
		ide_state.cursorRow = focused.row;
		ide_state.cursorColumn = focused.start;
		ide_state.selectionAnchor = { row: focused.row, column: focused.start + newName.length };
		updateDesiredColumn();
		resetBlink();
		ide_state.cursorRevealSuspended = false;
		ensureCursorVisible();
		updatedTotal += sortedMatches.length;
	}

	for (const bucket of rangeMap.values()) {
		const replacements = renameManager.applyRenameToChunk(bucket.chunkName, bucket.ranges, newName, activeChunkName);
		updatedTotal += replacements;
		if (replacements > 0) {
			markDiagnosticsDirtyForChunk(bucket.chunkName);
		}
	}
	return { updatedMatches: updatedTotal };
}

export function findResourceDescriptorForChunk(chunk: string): VMResourceDescriptor | null {
	const asset = $.rompack.cart.chunk2lua[chunk];
	return asset ? { asset_id: asset.resid, path: asset.normalized_source_path, type: asset.type } : null;
}

export function getCrossFileRenameDependencies(): CrossFileRenameDependencies {
	return {
		createLuaCodeTabContext: (descriptor: VMResourceDescriptor) => createLuaCodeTabContext(descriptor),
		createEntryTabContext: () => createEntryTabContext(),
		getCodeTabContext: (id: string) => ide_state.codeTabContexts.get(id),
		setCodeTabContext: (context: CodeTabContext) => {
			ide_state.codeTabContexts.set(context.id, context);
		},
		listCodeTabContexts: () => ide_state.codeTabContexts.values(),
		setTabDirty: (tabId: string, dirty: boolean) => setTabDirty(tabId, dirty),
	};
}

export function closeSymbolSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applySymbolSearchFieldText('', true);
	}
	ide_state.symbolSearchActive = false;
	ide_state.symbolSearchVisible = false;
	ide_state.symbolSearchGlobal = false;
	ide_state.symbolSearchMode = 'symbols';
	ide_state.referenceCatalog = [];
	ide_state.symbolSearchMatches = [];
	ide_state.symbolSearchSelectionIndex = -1;
	ide_state.symbolSearchDisplayOffset = 0;
	ide_state.symbolSearchHoverIndex = -1;
	ide_state.symbolSearchField.selectionAnchor = null;
	ide_state.symbolSearchField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromSymbolSearch(): void {
	if (!ide_state.symbolSearchActive && !ide_state.symbolSearchVisible) {
		return;
	}
	ide_state.symbolSearchActive = false;
	if (ide_state.symbolSearchQuery.length === 0) {
		ide_state.symbolSearchVisible = false;
		ide_state.symbolSearchMatches = [];
		ide_state.symbolSearchSelectionIndex = -1;
		ide_state.symbolSearchDisplayOffset = 0;
	}
	ide_state.symbolSearchField.selectionAnchor = null;
	ide_state.symbolSearchField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromRename(): void {
	ide_state.cursorRevealSuspended = false;
	resetBlink();
	revealCursor();
	ide_state.cursorVisible = true;
}

export function buildReferenceCatalogForExpression(info: ReferenceMatchInfo, context: CodeTabContext): ReferenceCatalogEntry[] {
	const descriptor = context ? context.descriptor : null;
	const normalizedPath = descriptor && descriptor.path ? descriptor.path : null;
	const asset_id = descriptor && descriptor.asset_id ? descriptor.asset_id : null;
	const chunkName = resolveHoverChunkName(context) ?? normalizedPath ?? asset_id ?? '<anynomous>';
	const activeLines = splitText(getTextSnapshot(ide_state.buffer));
	const environment: ProjectReferenceEnvironment = {
		activeContext: getActiveCodeTabContext(),
		activeLines,
		codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
	};
	const sourceLabelPath = descriptor ? (descriptor.path ?? descriptor.asset_id) : null;
	return buildProjectReferenceCatalog({
		workspace: ide_state.semanticWorkspace,
		info,
		lines: activeLines,
		chunkName,
		asset_id,
		environment,
		sourceLabelPath,
	});
}

export function updateSymbolSearchMatches(): void {
	if (ide_state.symbolSearchMode === 'references') {
		updateReferenceSearchMatches();
		return;
	}
	refreshSymbolCatalog(false);
	ide_state.symbolSearchMatches = [];
	ide_state.symbolSearchSelectionIndex = -1;
	ide_state.symbolSearchDisplayOffset = 0;
	ide_state.symbolSearchHoverIndex = -1;
	if (ide_state.symbolCatalog.length === 0) {
		return;
	}
	const query = ide_state.symbolSearchQuery.trim().toLowerCase();
	if (query.length === 0) {
		ide_state.symbolSearchMatches = ide_state.symbolCatalog.map(entry => ({ entry, matchIndex: 0 }));
		if (ide_state.symbolSearchMatches.length > 0) {
			ide_state.symbolSearchSelectionIndex = 0;
		}
		return;
	}
	const matches: SymbolSearchResult[] = [];
	for (const entry of ide_state.symbolCatalog) {
		const idx = entry.searchKey.indexOf(query);
		if (idx === -1) {
			continue;
		}
		matches.push({ entry, matchIndex: idx });
	}
	if (matches.length === 0) {
		ide_state.symbolSearchMatches = [];
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
	ide_state.symbolSearchMatches = matches;
	ide_state.symbolSearchSelectionIndex = 0;
	ide_state.symbolSearchDisplayOffset = 0;
}

export function updateReferenceSearchMatches(): void {
	const { matches, selectionIndex, displayOffset } = filterReferenceCatalog({
		catalog: ide_state.referenceCatalog,
		query: ide_state.symbolSearchQuery,
		state: ide_state.referenceState,
		pageSize: symbolSearchPageSize(),
	});
	ide_state.symbolSearchMatches = matches;
	ide_state.symbolSearchSelectionIndex = selectionIndex;
	ide_state.symbolSearchDisplayOffset = displayOffset;
	ide_state.symbolSearchHoverIndex = -1;
}

export function getActiveSymbolSearchMatch(): SymbolSearchResult {
	if (!ide_state.symbolSearchVisible || ide_state.symbolSearchMatches.length === 0) {
		return null;
	}
	let index = ide_state.symbolSearchHoverIndex;
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		index = ide_state.symbolSearchSelectionIndex;
	}
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		return null;
	}
	return ide_state.symbolSearchMatches[index];
}

export function ensureSymbolSearchSelectionVisible(): void {
	if (ide_state.symbolSearchSelectionIndex < 0) {
		ide_state.symbolSearchDisplayOffset = 0;
		return;
	}
	const maxVisible = symbolSearchPageSize();
	if (ide_state.symbolSearchSelectionIndex < ide_state.symbolSearchDisplayOffset) {
		ide_state.symbolSearchDisplayOffset = ide_state.symbolSearchSelectionIndex;
	}
	if (ide_state.symbolSearchSelectionIndex >= ide_state.symbolSearchDisplayOffset + maxVisible) {
		ide_state.symbolSearchDisplayOffset = ide_state.symbolSearchSelectionIndex - maxVisible + 1;
	}
	if (ide_state.symbolSearchDisplayOffset < 0) {
		ide_state.symbolSearchDisplayOffset = 0;
	}
	const maxOffset = Math.max(0, ide_state.symbolSearchMatches.length - maxVisible);
	if (ide_state.symbolSearchDisplayOffset > maxOffset) {
		ide_state.symbolSearchDisplayOffset = maxOffset;
	}
}

export function moveSymbolSearchSelection(delta: number): void {
	if (ide_state.symbolSearchMatches.length === 0) {
		return;
	}
	let next = ide_state.symbolSearchSelectionIndex;
	if (next === -1) {
		next = delta > 0 ? 0 : ide_state.symbolSearchMatches.length - 1;
	} else {
		next = clamp(next + delta, 0, ide_state.symbolSearchMatches.length - 1);
	}
	if (next === ide_state.symbolSearchSelectionIndex) {
		return;
	}
	ide_state.symbolSearchSelectionIndex = next;
	ensureSymbolSearchSelectionVisible();
	resetBlink();
}

export function applySymbolSearchSelection(index: number): void {
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		ide_state.showMessage('Symbol not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = ide_state.symbolSearchMatches[index];
	if (ide_state.symbolSearchMode === 'references') {
		const referenceEntry = match.entry as ReferenceCatalogEntry;
		const symbol = referenceEntry.symbol as ReferenceSymbolEntry;
		const entryIndex = ide_state.referenceCatalog.indexOf(referenceEntry);
		const expressionLabel = ide_state.referenceState.getExpression() ?? symbol.name;
		closeSymbolSearch(true);
		ide_state.referenceState.clear();
		navigateToLuaDefinition(symbol.location);
		const total = ide_state.referenceCatalog.length;
		if (entryIndex >= 0 && total > 0) {
			ide_state.showMessage(`Reference ${entryIndex + 1}/${total} for ${expressionLabel}`, constants.COLOR_STATUS_SUCCESS, 1.6);
		} else {
			ide_state.showMessage('Jumped to reference', constants.COLOR_STATUS_SUCCESS, 1.6);
		}
		return;
	}
	const location = match.entry.symbol.location;
	closeSymbolSearch(true);
	scheduleMicrotask(() => {
		navigateToLuaDefinition(location);
	});
}

export function refreshResourceCatalog(): void {
	let descriptors: VMResourceDescriptor[];
	try {
		descriptors = listResourcesStrict();
	} catch (error) {
		const message = extractErrorMessage(error);
		ide_state.resourceCatalog = [];
		ide_state.resourceSearchMatches = [];
		ide_state.resourceSearchSelectionIndex = -1;
		ide_state.resourceSearchDisplayOffset = 0;
		ide_state.resourceSearchHoverIndex = -1;
		ide_state.showMessage(`Failed to list resources: ${message}`, constants.COLOR_STATUS_ERROR, 3.0);
		return;
	}
	const augmented = descriptors.slice();
	const rompack = $.rompack;
	const img = rompack.img;
	const atlasKeys = Object.keys(img).filter(key => key === '_atlas' || key.startsWith('atlas'));
	for (const key of atlasKeys) {
		if (augmented.some(entry => entry.asset_id === key)) {
			continue;
		}
		augmented.push({ path: `atlas/${key}`, type: 'atlas', asset_id: key });
	}
	descriptors = augmented;
	const entries: ResourceCatalogEntry[] = descriptors.map((descriptor) => {
		const normalizedPath = descriptor.path.replace(/\\/g, '/');
		const displayPathSource = normalizedPath.length > 0 ? normalizedPath : (descriptor.asset_id ?? '');
		const displayPath = displayPathSource.length > 0 ? displayPathSource : '<unnamed>';
		const typeLabel = descriptor.type ? descriptor.type.toUpperCase() : '';
		const assetLabel = descriptor.asset_id && descriptor.asset_id !== displayPath ? descriptor.asset_id : null;
		const searchKeyParts = [displayPath, descriptor.asset_id ?? '', descriptor.type ?? ''];
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
	ide_state.resourceCatalog = entries;
}

export function updateResourceSearchMatches(): void {
	ide_state.resourceSearchMatches = [];
	ide_state.resourceSearchSelectionIndex = -1;
	ide_state.resourceSearchDisplayOffset = 0;
	ide_state.resourceSearchHoverIndex = -1;
	if (ide_state.resourceCatalog.length === 0) {
		return;
	}
	const query = ide_state.resourceSearchQuery.trim().toLowerCase();
	if (query.length === 0) {
		ide_state.resourceSearchMatches = ide_state.resourceCatalog.map(entry => ({ entry, matchIndex: 0 }));
		ide_state.resourceSearchSelectionIndex = -1;
		return;
	}
	const tokens = query.split(/\s+/).filter(token => token.length > 0);
	const matches: ResourceSearchResult[] = [];
	for (const entry of ide_state.resourceCatalog) {
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
		matches.push({ entry, matchIndex: bestIndex });
	}
	if (matches.length === 0) {
		ide_state.resourceSearchMatches = [];
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
	ide_state.resourceSearchMatches = matches;
	ide_state.resourceSearchSelectionIndex = matches.length > 0 ? 0 : -1;
}

export function ensureResourceSearchSelectionVisible(): void {
	if (ide_state.resourceSearchSelectionIndex < 0) {
		ide_state.resourceSearchDisplayOffset = 0;
		return;
	}
	const windowSize = Math.max(1, resourceSearchWindowCapacity());
	if (ide_state.resourceSearchSelectionIndex < ide_state.resourceSearchDisplayOffset) {
		ide_state.resourceSearchDisplayOffset = ide_state.resourceSearchSelectionIndex;
	}
	if (ide_state.resourceSearchSelectionIndex >= ide_state.resourceSearchDisplayOffset + windowSize) {
		ide_state.resourceSearchDisplayOffset = ide_state.resourceSearchSelectionIndex - windowSize + 1;
	}
	if (ide_state.resourceSearchDisplayOffset < 0) {
		ide_state.resourceSearchDisplayOffset = 0;
	}
	const maxOffset = Math.max(0, ide_state.resourceSearchMatches.length - windowSize);
	if (ide_state.resourceSearchDisplayOffset > maxOffset) {
		ide_state.resourceSearchDisplayOffset = maxOffset;
	}
}

export function moveResourceSearchSelection(delta: number): void {
	if (ide_state.resourceSearchMatches.length === 0) {
		return;
	}
	let next = ide_state.resourceSearchSelectionIndex;
	if (next === -1) {
		next = delta > 0 ? 0 : ide_state.resourceSearchMatches.length - 1;
	} else {
		next = clamp(next + delta, 0, ide_state.resourceSearchMatches.length - 1);
	}
	if (next === ide_state.resourceSearchSelectionIndex) {
		return;
	}
	ide_state.resourceSearchSelectionIndex = next;
	ensureResourceSearchSelectionVisible();
	resetBlink();
}

export function applyResourceSearchSelection(index: number): void {
	if (index < 0 || index >= ide_state.resourceSearchMatches.length) {
		ide_state.showMessage('Resource not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = ide_state.resourceSearchMatches[index];
	closeResourceSearch(true);
	scheduleMicrotask(() => {
		openResourceDescriptor(match.entry.descriptor);
	});
}

export function openLineJump(): void {
	clearReferenceHighlights();
	closeSymbolSearch(false);
	closeResourceSearch(false);
	closeSearch(false, true);
	ide_state.renameController.cancel();
	ide_state.lineJumpVisible = true;
	ide_state.lineJumpActive = true;
	applyLineJumpFieldText('', true);
	resetBlink();
}

export function closeLineJump(clearValue: boolean): void {
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	if (clearValue) {
		applyLineJumpFieldText('', true);
	}
	ide_state.lineJumpField.selectionAnchor = null;
	ide_state.lineJumpField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromLineJump(): void {
	if (!ide_state.lineJumpActive && !ide_state.lineJumpVisible) {
		return;
	}
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	ide_state.lineJumpField.selectionAnchor = null;
	ide_state.lineJumpField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromResourcePanel(): void {
	if (!ide_state.resourcePanelFocused) {
		return;
	}
	ide_state.resourcePanelFocused = false;
	resetBlink();
}

export function applyLineJump(): void {
	if (ide_state.lineJumpValue.length === 0) {
		ide_state.showMessage('Enter a line number', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const target = Number.parseInt(ide_state.lineJumpValue, 10);
	const lineCount = ide_state.buffer.getLineCount();
	if (!Number.isFinite(target) || target < 1 || target > lineCount) {
		ide_state.showMessage(`Line must be between 1 and ${lineCount}`, constants.COLOR_STATUS_WARNING, 1.8);
		return;
	}
	const navigationCheckpoint = beginNavigationCapture();
	setCursorPosition(target - 1, 0);
	TextEditing.clearSelection();
	breakUndoSequence();
	closeLineJump(true);
	ide_state.showMessage(`Jumped to line ${target}`, constants.COLOR_STATUS_SUCCESS, 1.5);
	completeNavigation(navigationCheckpoint);
}

export function gotoDiagnostic(diagnostic: EditorDiagnostic): void {
	const navigationCheckpoint = beginNavigationCapture();
	// Switch to the originating tab if provided
	if (diagnostic.contextId && diagnostic.contextId.length > 0 && diagnostic.contextId !== ide_state.activeCodeTabContextId) {
		setActiveTab(diagnostic.contextId);
	}
	if (!isCodeTabActive()) {
		activateCodeTab();
	}
	if (!isCodeTabActive()) {
		return;
	}
	const targetRow = clamp(diagnostic.row, 0, Math.max(0, ide_state.buffer.getLineCount() - 1));
	const line = ide_state.buffer.getLineContent(targetRow);
	const targetColumn = clamp(diagnostic.startColumn, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	TextEditing.clearSelection();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
	completeNavigation(navigationCheckpoint);
}

export function cancelSearchJob(): void {
	ide_state.searchJob = null;
}

export function showReferenceStatusMessage(): void {
	const matches = ide_state.referenceState.getMatches();
	const activeIndex = ide_state.referenceState.getActiveIndex();
	if (matches.length === 0 || activeIndex < 0) {
		return;
	}
	const label = ide_state.referenceState.getExpression() ?? '';
	ide_state.showMessage(`Reference ${activeIndex + 1}/${matches.length} for ${label}`, constants.COLOR_STATUS_SUCCESS, 1.6);
}

export function adjustHoverTooltipScroll(stepCount: number): boolean {
	if (!ide_state.hoverTooltip) {
		return false;
	}
	if (stepCount === 0) {
		return false;
	}
	const tooltip = ide_state.hoverTooltip;
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
	const tooltip = ide_state.hoverTooltip;
	if (!tooltip || !tooltip.bubbleBounds) {
		return false;
	}
	return point_in_rect(x, y, tooltip.bubbleBounds);
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

export function buildProjectReferenceContext(context: CodeTabContext): {
	environment: ProjectReferenceEnvironment;
	chunkName: string;
	normalizedPath: string;
	asset_id: string;
} {
	const descriptor = context ? context.descriptor : null;
	const normalizedPath = descriptor && descriptor.path ? descriptor.path : null;
	const descriptorasset_id = descriptor ? descriptor.asset_id : null;
	const resolvedChunk = resolveHoverChunkName(context)
		?? normalizedPath
		?? descriptorasset_id
		?? '<anynomous>';
	const environment: ProjectReferenceEnvironment = {
		activeContext: context,
		activeLines: splitText(getTextSnapshot(ide_state.buffer)),
		codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
	};
	return {
		environment,
		chunkName: resolvedChunk,
		normalizedPath,
		asset_id: descriptorasset_id,
	};
}

export function applyDefinitionSelection(range: VMLuaDefinitionLocation['range']): void {
	const lastRowIndex = Math.max(0, ide_state.buffer.getLineCount() - 1);
	const startRow = clamp(range.startLine - 1, 0, lastRowIndex);
	const startLine = ide_state.buffer.getLineContent(startRow);
	const startColumn = clamp(range.startColumn - 1, 0, startLine.length);
	ide_state.cursorRow = startRow;
	ide_state.cursorColumn = startColumn;
	ide_state.selectionAnchor = null;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.pointerAuxWasPressed = false;
	updateDesiredColumn();
	resetBlink();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
}

export function beginNavigationCapture(): NavigationHistoryEntry {
	if (ide_state.navigationCaptureSuspended) {
		return null;
	}
	if (!ide_state.navigationHistory.current) {
		ide_state.navigationHistory.current = createNavigationEntry();
	}
	const current = createNavigationEntry();
	if (current) {
		ide_state.navigationHistory.current = current;
		return { ...current };
	}
	return null;
}

export function completeNavigation(previous: NavigationHistoryEntry): void {
	if (ide_state.navigationCaptureSuspended) {
		return;
	}
	const next = createNavigationEntry();
	const backStack = ide_state.navigationHistory.back;
	if (previous && next && !areNavigationEntriesEqual(previous, next)) {
		const lastBack = backStack[backStack.length - 1];
		if (!lastBack || !areNavigationEntriesEqual(lastBack, previous)) {
			pushNavigationEntry(backStack, previous);
		}
		ide_state.navigationHistory.forward.length = 0;
	} else if (previous && !next) {
		const lastBack = backStack[backStack.length - 1];
		if (!lastBack || !areNavigationEntriesEqual(lastBack, previous)) {
			pushNavigationEntry(backStack, previous);
		}
		ide_state.navigationHistory.forward.length = 0;
	} else if (previous === null && next) {
		ide_state.navigationHistory.forward.length = 0;
	}
	ide_state.navigationHistory.current = next;
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
		&& a.asset_id === b.asset_id
		&& a.chunkName === b.chunkName
		&& a.path === b.path
		&& a.row === b.row
		&& a.column === b.column;
}

export function createNavigationEntry(): NavigationHistoryEntry {
	if (!isCodeTabActive()) {
		return null;
	}
	const context = getActiveCodeTabContext();
	if (!context) {
		return null;
	}
	const asset_id = resolveHoverAssetId(context);
	const chunkName = resolveHoverChunkName(context);
	const path = context.descriptor?.path;
	const maxRowIndex = Math.max(0, ide_state.buffer.getLineCount() - 1);
	const row = clamp(ide_state.cursorRow, 0, maxRowIndex);
	const lineLen = ide_state.buffer.getLineEndOffset(row) - ide_state.buffer.getLineStartOffset(row);
	const column = clamp(ide_state.cursorColumn, 0, lineLen);
	return {
		contextId: context.id,
		asset_id,
		chunkName,
		path,
		row,
		column,
	};
}

export function withNavigationCaptureSuspended<T>(operation: () => T): T {
	const previous = ide_state.navigationCaptureSuspended;
	ide_state.navigationCaptureSuspended = true;
	try {
		return operation();
	} finally {
		ide_state.navigationCaptureSuspended = previous;
	}
}

export function applyNavigationEntry(entry: NavigationHistoryEntry): void {
	const existingContext = ide_state.codeTabContexts.get(entry.contextId);
	if (existingContext) {
		setActiveTab(entry.contextId);
	} else {
		const hint: { asset_id: string; path?: string } = { asset_id: entry.asset_id };
		if (entry.path) {
			hint.path = entry.path;
		}
		focusChunkSource(entry.chunkName);
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
	const maxRowIndex = Math.max(0, ide_state.buffer.getLineCount() - 1);
	const targetRow = clamp(entry.row, 0, maxRowIndex);
	const line = ide_state.buffer.getLineContent(targetRow);
	const targetColumn = clamp(entry.column, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	TextEditing.clearSelection();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
}

export function goBackwardInNavigationHistory(): void {
	if (ide_state.navigationHistory.back.length === 0) {
		return;
	}
	const currentEntry = ide_state.navigationHistory.current ?? createNavigationEntry();
	if (currentEntry) {
		const forwardStack = ide_state.navigationHistory.forward;
		const lastForward = forwardStack[forwardStack.length - 1];
		if (!lastForward || !areNavigationEntriesEqual(lastForward, currentEntry)) {
			pushNavigationEntry(forwardStack, currentEntry);
		}
	}
	const target = ide_state.navigationHistory.back.pop()!;
	withNavigationCaptureSuspended(() => {
		applyNavigationEntry(target);
	});
	ide_state.navigationHistory.current = createNavigationEntry() ?? target;
}

export function goForwardInNavigationHistory(): void {
	if (ide_state.navigationHistory.forward.length === 0) {
		return;
	}
	const currentEntry = ide_state.navigationHistory.current ?? createNavigationEntry();
	if (currentEntry) {
		const backStack = ide_state.navigationHistory.back;
		const lastBack = backStack[backStack.length - 1];
		if (!lastBack || !areNavigationEntriesEqual(lastBack, currentEntry)) {
			pushNavigationEntry(backStack, currentEntry);
		}
	}
	const target = ide_state.navigationHistory.forward.pop()!;
	withNavigationCaptureSuspended(() => {
		applyNavigationEntry(target);
	});
	ide_state.navigationHistory.current = createNavigationEntry() ?? target;
}

export function openActionPrompt(action: PendingActionPrompt['action']): void {
	activateCodeTab();
	ide_state.pendingActionPrompt = { action };
	ide_state.actionPromptButtons.saveAndContinue = null;
	ide_state.actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
}

export async function handleActionPromptSelection(choice: 'save-continue' | 'continue' | 'cancel'): Promise<void> {
	if (!ide_state.pendingActionPrompt) {
		return;
	}
	if (choice === 'cancel') {
		resetActionPromptState();
		return;
	}
	if (choice === 'save-continue') {
		const saved = await attemptPromptSave(ide_state.pendingActionPrompt.action);
		if (!saved) {
			return;
		}
	}
	if (performAction(ide_state.pendingActionPrompt.action)) {
		resetActionPromptState(); // Only reset if action was performed
	}
}

export async function attemptPromptSave(action: PendingActionPrompt['action']): Promise<boolean> {
	if (action === 'close') {
		await save();
		return ide_state.dirty === false;
	}
	await save();
	return ide_state.dirty === false;
}

export function performAction(action: PendingActionPrompt['action']): boolean {
	switch (action) {
		case 'hot-reload-and-resume':
			return performHotReloadAndResume();
		case 'reboot':
			return performReboot();
		case 'close':
			BmsxVMRuntime.instance.deactivateEditor();
			return true;
		case 'theme-toggle':
			toggleThemeMode();
			return true;
		default:
			return false;
	}
}

export function performHotReloadAndResume(): boolean {
	const runtime = BmsxVMRuntime.instance;
	const targetGeneration = ide_state.saveGeneration;
	const shouldUpdateGeneration = hasPendingRuntimeReload();
	clearExecutionStopHighlights();
	BmsxVMRuntime.instance.deactivateEditor();
	console.log('[IDE] Performing hot-reload and resume');
	scheduleRuntimeTask(async () => {
		console.log('[IDE] Applying workspace overrides to cart before resume');
		await applyWorkspaceOverridesToCart({ cart: $.cart, storage: $.platform.storage, includeServer: true });
		console.log('[IDE] Capturing runtime snapshot for resume');
		const snapshot = runtime.captureCurrentState();
		console.log('[IDE] Clear execution stop highlights before resume');
		snapshot.luaRuntimeFailed = false;
		console.log('[IDE] Resuming from captured snapshot');
		await runtime.resumeFromSnapshot(snapshot);
		if (shouldUpdateGeneration) {
			console.log('[IDE] Updating applied generation after resume');
			ide_state.appliedGeneration = targetGeneration;
		}
		$.paused = false;
	}, (error) => {
		console.error(error);
		handleRuntimeTaskError(error, 'Failed to resume game');
	});
	return true;
}

export function performReboot(): boolean {
	const runtime = BmsxVMRuntime.instance;
	const requiresReload = hasPendingRuntimeReload();
	const targetGeneration = ide_state.saveGeneration;
	clearExecutionStopHighlights();
	BmsxVMRuntime.instance.deactivateEditor();
	scheduleRuntimeTask(async () => {
		if (requiresReload) {
			console.info('[IDE] Performing full program reload for reboot');
			await runtime.reloadProgramAndResetWorld({ runInit: true }); // Was false, but it makes no sense to skip init on reboot
		}
		else {
			console.info('[IDE] Performing standard reboot');
			await runtime.reloadProgramAndResetWorld({ runInit: true });
		}
		ide_state.appliedGeneration = targetGeneration;
		$.paused = false;
	}, (error) => {
		handleRuntimeTaskError(error, 'Failed to reboot game');
	});
	return true;
}

export function toggleLineComments(): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	const range = getLineRangeForMovement();
	if (range.startRow < 0 || range.endRow < range.startRow) {
		return;
	}
	let allCommented = true;
	for (let row = range.startRow; row <= range.endRow; row++) {
		const line = ide_state.buffer.getLineContent(row);
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
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	const target = range ?? getLineRangeForMovement();
	if (target.startRow < 0 || target.endRow < target.startRow) {
		return;
	}
	prepareUndo('comment-lines', false);
	let changed = false;
	for (let row = target.startRow; row <= target.endRow; row++) {
		const originalLine = ide_state.buffer.getLineContent(row);
		const insertIndex = firstNonWhitespaceIndex(originalLine);
		const hasContent = insertIndex < originalLine.length;
		let insertion = '--';
		if (hasContent) {
			const nextChar = originalLine.charAt(insertIndex);
			if (nextChar !== ' ' && nextChar !== '\t') {
				insertion = '-- ';
			}
		}
		applyUndoableReplace(ide_state.buffer.offsetAt(row, insertIndex), 0, insertion);
		ide_state.layout.invalidateLine(row);
		shiftPositionsForInsertion(row, insertIndex, insertion.length);
		changed = true;
	}
	if (!changed) {
		return;
	}
	clampCursorColumn();
	ide_state.selectionAnchor = clampSelectionPosition(ide_state.selectionAnchor);
	markTextMutated();
	resetBlink();
	updateDesiredColumn();
	revealCursor();
}

export function removeLineComments(range?: { startRow: number; endRow: number }): void {
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return;
	}
	const target = range ?? getLineRangeForMovement();
	if (target.startRow < 0 || target.endRow < target.startRow) {
		return;
	}
	prepareUndo('uncomment-lines', false);
	let changed = false;
	for (let row = target.startRow; row <= target.endRow; row++) {
		const originalLine = ide_state.buffer.getLineContent(row);
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
		applyUndoableReplace(ide_state.buffer.offsetAt(row, commentIndex), removal, '');
		ide_state.layout.invalidateLine(row);
		shiftPositionsForRemoval(row, commentIndex, removal);
		changed = true;
	}
	if (!changed) {
		return;
	}
	clampCursorColumn();
	ide_state.selectionAnchor = clampSelectionPosition(ide_state.selectionAnchor);
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
	if (ide_state.cursorRow === row && ide_state.cursorColumn >= column) {
		ide_state.cursorColumn += length;
	}
	if (ide_state.selectionAnchor && ide_state.selectionAnchor.row === row && ide_state.selectionAnchor.column >= column) {
		ide_state.selectionAnchor.column += length;
	}
}

export function shiftPositionsForRemoval(row: number, column: number, length: number): void {
	if (length <= 0) {
		return;
	}
	if (ide_state.cursorRow === row && ide_state.cursorColumn > column) {
		if (ide_state.cursorColumn <= column + length) {
			ide_state.cursorColumn = column;
		} else {
			ide_state.cursorColumn -= length;
		}
	}
	if (ide_state.selectionAnchor && ide_state.selectionAnchor.row === row && ide_state.selectionAnchor.column > column) {
		if (ide_state.selectionAnchor.column <= column + length) {
			ide_state.selectionAnchor.column = column;
		} else {
			ide_state.selectionAnchor.column -= length;
		}
	}
}

export function applyViewportSize(viewport: Viewport): void {
	ide_state.viewportWidth = viewport.width;
	ide_state.viewportHeight = viewport.height;
	ide_state.lastPointerRowResolution = null;
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
	const viewportX = (relativeX / width) * ide_state.viewportWidth;
	const viewportY = (relativeY / height) * ide_state.viewportHeight;
	return { x: viewportX, y: viewportY, inside, valid: true };
}

export function getCodeAreaBounds(): { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; gutterLeft: number; gutterRight: number; textLeft: number; } {
	const codeTop = codeViewportTop();
	const codeBottom = ide_state.viewportHeight - bottomMargin();
	const codeLeft = ide_state.resourcePanelVisible ? getResourcePanelWidth() : 0;
	const codeRight = ide_state.viewportWidth;
	const gutterLeft = codeLeft;
	const gutterRight = gutterLeft + ide_state.gutterWidth;
	const textLeft = gutterRight + 2;
	return { codeTop, codeBottom, codeLeft, codeRight, gutterLeft, gutterRight, textLeft };
}

export function resolvePointerRow(viewportY: number): number {
	ensureVisualLines();
	const bounds = getCodeAreaBounds();
	const relativeY = viewportY - bounds.codeTop;
	const lineOffset = Math.floor(relativeY / ide_state.lineHeight);
	let visualIndex = ide_state.scrollRow + lineOffset;
	const visualCount = getVisualLineCount();
	if (visualIndex < 0) {
		visualIndex = 0;
	}
	if (visualCount > 0 && visualIndex > visualCount - 1) {
		visualIndex = visualCount - 1;
	}
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		ide_state.lastPointerRowResolution = null;
		return clamp(visualIndex, 0, Math.max(0, ide_state.buffer.getLineCount() - 1));
	}
	ide_state.lastPointerRowResolution = { visualIndex, segment };
	return segment.row;
}

export function resolvePointerColumn(row: number, viewportX: number): number {
	const bounds = getCodeAreaBounds();
	const textLeft = bounds.textLeft;
	const entry = ide_state.layout.getCachedHighlight(ide_state.buffer, row);
	const line = entry.src;
	if (line.length === 0) {
		return 0;
	}
	const highlight = entry.hi;
	let segmentStartColumn = ide_state.scrollColumn;
	let segmentEndColumn = line.length;
	const resolvedSegment = ide_state.lastPointerRowResolution?.segment;
	if (ide_state.wordWrapEnabled && resolvedSegment && resolvedSegment.row === row) {
		segmentStartColumn = resolvedSegment.startColumn;
		segmentEndColumn = resolvedSegment.endColumn;
	}
	if (ide_state.wordWrapEnabled) {
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
	const startDisplay = ide_state.layout.columnToDisplay(highlight, effectiveStartColumn);
	const offset = viewportX - textLeft;
	if (offset <= 0) {
		return effectiveStartColumn;
	}
	const baseAdvance = entry.advancePrefix[startDisplay] ?? 0;
	const target = baseAdvance + offset;
	const lower = lower_bound(entry.advancePrefix, target, startDisplay + 1, entry.advancePrefix.length);
	let displayIndex = lower - 1;
	if (displayIndex < startDisplay) {
		displayIndex = startDisplay;
	}
	if (displayIndex >= highlight.text.length) {
		return ide_state.wordWrapEnabled ? Math.min(segmentEndColumn, line.length) : line.length;
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
	if (ide_state.wordWrapEnabled) {
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
	if (!ide_state.pointerSelecting) {
		return;
	}
	const bounds = getCodeAreaBounds();
	ensureVisualLines();
	if (viewportY < bounds.codeTop) {
		if (ide_state.scrollRow > 0) {
			ide_state.scrollRow -= 1;
		}
	}
	else if (viewportY >= bounds.codeBottom) {
		const lastRow = getVisualLineCount() - 1;
		if (ide_state.scrollRow < lastRow) {
			ide_state.scrollRow += 1;
		}
	}
	const maxScrollColumn = computeMaximumScrollColumn();
	if (viewportX < bounds.gutterLeft) {
		return;
	}
	if (!ide_state.wordWrapEnabled) {
		if (viewportX < bounds.textLeft) {
			if (ide_state.scrollColumn > 0) {
				ide_state.scrollColumn -= 1;
			}
		}
		else if (viewportX >= bounds.codeRight) {
			if (ide_state.scrollColumn < maxScrollColumn) {
				ide_state.scrollColumn += 1;
			}
		}
	}
	if (ide_state.scrollRow < 0) {
		ide_state.scrollRow = 0;
	}
	if (ide_state.scrollColumn < 0) {
		ide_state.scrollColumn = 0;
	}
	if (ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = 0;
	}
	const maxScrollRow = Math.max(0, getVisualLineCount() - visibleRowCount());
	if (ide_state.scrollRow > maxScrollRow) {
		ide_state.scrollRow = maxScrollRow;
	}
	if (!ide_state.wordWrapEnabled && ide_state.scrollColumn > maxScrollColumn) {
		ide_state.scrollColumn = maxScrollColumn;
	}
}

export function resetPointerClickTracking(): void {
	ide_state.lastPointerClickTimeMs = 0;
	ide_state.lastPointerClickRow = -1;
	ide_state.lastPointerClickColumn = -1;
}

export function scrollRows(deltaRows: number): void {
	if (deltaRows === 0) {
		return;
	}
	ensureVisualLines();
	const maxScrollRow = Math.max(0, getVisualLineCount() - visibleRowCount());
	const targetRow = clamp(ide_state.scrollRow + deltaRows, 0, maxScrollRow);
	ide_state.scrollRow = targetRow;
}

export function applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.searchQuery = value;
	setFieldText(ide_state.searchField, value, moveCursorToEnd);
}

export function applySymbolSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.symbolSearchQuery = value;
	setFieldText(ide_state.symbolSearchField, value, moveCursorToEnd);
}

export function applyResourceSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.resourceSearchQuery = value;
	setFieldText(ide_state.resourceSearchField, value, moveCursorToEnd);
}

export function applyLineJumpFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.lineJumpValue = value;
	setFieldText(ide_state.lineJumpField, value, moveCursorToEnd);
}

export function applyCreateResourceFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.createResourcePath = value;
	setFieldText(ide_state.createResourceField, value, moveCursorToEnd);
}

export function processInlineFieldPointer(field: TextField, textLeft: number, pointerX: number, justPressed: boolean, pointerPressed: boolean): void {
	const result = applyInlineFieldPointer(field, {
		metrics: ide_state.inlineFieldMetricsRef,
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
	ide_state.desiredColumn = ide_state.cursorColumn;
	ide_state.desiredDisplayOffset = 0;
	if (ide_state.cursorRow < 0 || ide_state.cursorRow >= ide_state.buffer.getLineCount()) {
		return;
	}
	const entry = ide_state.layout.getCachedHighlight(ide_state.buffer, ide_state.cursorRow);
	const highlight = entry.hi;
	const cursorDisplay = ide_state.layout.columnToDisplay(highlight, ide_state.cursorColumn);
	let segmentStartColumn = 0;
	if (ide_state.wordWrapEnabled) {
		ensureVisualLines();
		const override = caretNavigation.peek(ide_state.cursorRow, ide_state.cursorColumn);
		if (override) {
			segmentStartColumn = override.segmentStartColumn;
		} else {
			const visualIndex = positionToVisualIndex(ide_state.cursorRow, ide_state.cursorColumn);
			const segment = visualIndexToSegment(visualIndex);
			if (segment) {
				segmentStartColumn = segment.startColumn;
			}
		}
	}
	const segmentDisplayStart = ide_state.layout.columnToDisplay(highlight, segmentStartColumn);
	ide_state.desiredDisplayOffset = cursorDisplay - segmentDisplayStart;
	if (ide_state.desiredDisplayOffset < 0) {
		ide_state.desiredDisplayOffset = 0;
	}
}

export async function save(): Promise<void> {
	const context = getActiveCodeTabContext();
	if (!context) {
		return;
	}
	const source = getTextSnapshot(ide_state.buffer);
	const descriptor = context.descriptor;
	const targetPath = descriptor?.path ?? descriptor?.asset_id;
	try {
		if (targetPath) {
			await saveLuaResourceSource(targetPath, source);
			setWorkspaceCachedSources([targetPath, buildDirtyFilePath(targetPath)], source);
		}
		ide_state.dirty = false;
		ide_state.savePointDepth = ide_state.undoStack.length;
		context.savePointDepth = ide_state.savePointDepth;
		breakUndoSequence();
		ide_state.saveGeneration = ide_state.saveGeneration + 1;
		context.lastSavedSource = source;
		context.saveGeneration = ide_state.saveGeneration;
		ide_state.lastSavedSource = source;
		updateActiveContextDirtyFlag();
		const message = `${context.title} saved (restart pending)`;
		ide_state.showMessage(message, constants.COLOR_STATUS_SUCCESS, 2.5);
	} catch (error) {
		if (tryShowLuaErrorOverlay(error)) {
			return;
		}
		const message = extractErrorMessage(error);
		ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
	}
}

export function captureSnapshot(): EditorSnapshot {
	let selectionCopy: Position = null;
	const anchor = ide_state.selectionAnchor;
	if (anchor) {
		selectionCopy = { row: anchor.row, column: anchor.column };
	}
	return {
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		scrollRow: ide_state.scrollRow,
		scrollColumn: ide_state.scrollColumn,
		selectionAnchor: selectionCopy,
		textVersion: ide_state.textVersion,
	};
}

export type RestoreSnapshotOptions = {
	preserveScroll?: boolean;
};

export function restoreSnapshot(snapshot: EditorSnapshot, options?: RestoreSnapshotOptions): void {
	ide_state.maxLineLengthDirty = true;
	ide_state.layout.markVisualLinesDirty();
	ide_state.layout.invalidateHighlightsFromRow(0);
	ide_state.cursorRow = snapshot.cursorRow;
	ide_state.cursorColumn = snapshot.cursorColumn;
	ide_state.scrollRow = snapshot.scrollRow;
	ide_state.scrollColumn = snapshot.scrollColumn;
	ide_state.selectionAnchor = snapshot.selectionAnchor;
	ide_state.textVersion = ide_state.buffer.version;
	updateDesiredColumn();
	resetBlink();
	ide_state.cursorRevealSuspended = false;
	if (options?.preserveScroll !== true) {
		ensureCursorVisible();
	}
	requestSemanticRefresh();
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
	if (!ide_state.createResourceVisible) {
		return 0;
	}
	return ide_state.lineHeight + constants.CREATE_RESOURCE_BAR_MARGIN_Y * 2;
}

export function getSearchBarHeight(): number {
	if (!ide_state.searchVisible) {
		return 0;
	}
	const baseHeight = ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const visible = searchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SEARCH_RESULT_SPACING + visible * searchResultEntryHeight();
}

export function getResourceSearchBarHeight(): number {
	if (!ide_state.resourceSearchVisible) {
		return 0;
	}
	const baseHeight = ide_state.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	const visible = resourceSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.QUICK_OPEN_RESULT_SPACING + visible * resourceSearchEntryHeight();
}

export function getSymbolSearchBarHeight(): number {
	if (!ide_state.symbolSearchVisible) {
		return 0;
	}
	const baseHeight = ide_state.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	const visible = symbolSearchVisibleResultCount();
	if (visible <= 0) {
		return baseHeight;
	}
	return baseHeight + constants.SYMBOL_SEARCH_RESULT_SPACING + visible * symbolSearchEntryHeight();
}

export function getRenameBarHeight(): number {
	if (!ide_state.renameController?.isVisible()) {
		return 0;
	}
	return ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
}

export function getLineJumpBarHeight(): number {
	if (!ide_state.lineJumpVisible) {
		return 0;
	}
	return ide_state.lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2;
}

export function getCreateResourceBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getCreateResourceBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getSearchBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight() + getCreateResourceBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getResourceSearchBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getResourceSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight() + getCreateResourceBarHeight() + getSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getLineJumpBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getLineJumpBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight()
		+ getRenameBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getSymbolSearchBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getSymbolSearchBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function getRenameBarBounds(): { top: number; bottom: number; left: number; right: number } {
	const height = getRenameBarHeight();
	if (height <= 0) {
		return null;
	}
	const top = ide_state.headerHeight + getTabBarTotalHeight()
		+ getCreateResourceBarHeight()
		+ getSearchBarHeight()
		+ getResourceSearchBarHeight()
		+ getSymbolSearchBarHeight();
	return {
		top,
		bottom: top + height,
		left: 0,
		right: ide_state.viewportWidth,
	};
}

export function findFunctionDefinitionRowInActiveFile(functionName: string): number {
	if (typeof functionName !== 'string' || functionName.length === 0) {
		return null;
	}
	const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const patterns = [
		new RegExp(`^\\s*function\\s+${escaped}\\b`),
		new RegExp(`^\\s*local\\s+function\\s+${escaped}\\b`),
		new RegExp(`\\b${escaped}\\s*=\\s*function\\b`),
	];
	const lineCount = ide_state.buffer.getLineCount();
	for (let row = 0; row < lineCount; row += 1) {
		const line = ide_state.buffer.getLineContent(row);
		for (let index = 0; index < patterns.length; index += 1) {
			if (patterns[index].test(line)) {
				return row;
			}
		}
	}
	return null;
}

export function notifyReadOnlyEdit(): void {
	ide_state.showMessage('Tab is read-only', constants.COLOR_STATUS_WARNING, 1.5);
}

export function updateViewport(viewport: Viewport): void {
	applyViewportSize(viewport);
	ide_state.resourcePanel.clampHScroll();
	ide_state.resourcePanel.ensureSelectionVisible();
	ide_state.layout.markVisualLinesDirty();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
	rewrapRuntimeErrorOverlays();
}

export function setFontVariant(variant: VMFontVariant): void {
	ide_state.fontVariant = variant;
	ide_state.font = new VMEditorFont(variant);
	ide_state.lineHeight = ide_state.font.lineHeight;
	ide_state.charAdvance = ide_state.font.advance('M');
	ide_state.spaceAdvance = ide_state.font.advance(' ');
	ide_state.inlineFieldMetricsRef = {
		measureText: (text: string) => measureText(text),
		advanceChar: (ch: string) => ide_state.font.advance(ch),
		spaceAdvance: ide_state.spaceAdvance,
		tabSpaces: constants.TAB_SPACES,
	};
	ide_state.gutterWidth = 2;
	ide_state.headerHeight = ide_state.lineHeight + 4;
	ide_state.tabBarHeight = ide_state.lineHeight + 3;
	ide_state.baseBottomMargin = ide_state.lineHeight + 6;
	ide_state.layout = new VMCodeLayout(ide_state.font, ide_state.semanticWorkspace, {
		maxHighlightCache: 512,
		semanticDebounceMs: 200,
		clockNow: ide_state.clockNow,
		getBuiltinIdentifiers: () => getBuiltinIdentifiersSnapshot(),
	});
	if (ide_state.resourcePanel) {
		ide_state.resourcePanel.setFontMetrics(ide_state.lineHeight, ide_state.charAdvance);
	}
	ide_state.layout.invalidateAllHighlights();
	ide_state.layout.markVisualLinesDirty();
	ensureVisualLines();
	ide_state.cursorRevealSuspended = false;
	ensureCursorVisible();
	rewrapRuntimeErrorOverlays();
	requestSemanticRefresh();
	markDiagnosticsDirty();
}

export function toggleWordWrap(): void {
	ensureVisualLines();
	const previousWrap = ide_state.wordWrapEnabled;
	const visualLineCount = getVisualLineCount();
	const previousTopIndex = clamp(ide_state.scrollRow, 0, visualLineCount > 0 ? visualLineCount - 1 : 0);
	const previousTopSegment = visualIndexToSegment(previousTopIndex);
	const anchorRow = previousTopSegment ? previousTopSegment.row : ide_state.cursorRow;
	const anchorColumnForWrap = previousTopSegment ? previousTopSegment.startColumn : 0;
	const anchorColumnForUnwrap = previousTopSegment
		? (previousWrap ? previousTopSegment.startColumn : ide_state.scrollColumn)
		: ide_state.scrollColumn;
	const previousCursorRow = ide_state.cursorRow;
	const previousCursorColumn = ide_state.cursorColumn;
	const previousDesiredColumn = ide_state.desiredColumn;

	ide_state.wordWrapEnabled = !previousWrap;
	ide_state.cursorRevealSuspended = false;
	ide_state.layout.markVisualLinesDirty();
	ensureVisualLines();

	ide_state.cursorRow = clamp(previousCursorRow, 0, Math.max(0, ide_state.buffer.getLineCount() - 1));
	const currentLine = ide_state.buffer.getLineContent(ide_state.cursorRow);
	ide_state.cursorColumn = clamp(previousCursorColumn, 0, currentLine.length);
	ide_state.desiredColumn = previousDesiredColumn;

	if (ide_state.wordWrapEnabled) {
		ide_state.scrollColumn = 0;
		const anchorVisualIndex = positionToVisualIndex(anchorRow, anchorColumnForWrap);
		ide_state.scrollRow = clamp(anchorVisualIndex, 0, Math.max(0, getVisualLineCount() - visibleRowCount()));
	} else {
		ide_state.scrollColumn = clamp(anchorColumnForUnwrap, 0, computeMaximumScrollColumn());
		const anchorVisualIndex = positionToVisualIndex(anchorRow, ide_state.scrollColumn);
		ide_state.scrollRow = clamp(anchorVisualIndex, 0, Math.max(0, getVisualLineCount() - visibleRowCount()));
	}
	ide_state.lastPointerRowResolution = null;
	ensureCursorVisible();
	updateDesiredColumn();
	const message = ide_state.wordWrapEnabled ? 'Word wrap enabled' : 'Word wrap disabled';
	ide_state.showMessage(message, constants.COLOR_STATUS_TEXT, 2.5);
}

export function hideResourcePanel(): void {
	// Forward to controller; it resets its internal state
	ide_state.resourcePanel.hide();
	ide_state.resourcePanelFocused = false;
	ide_state.resourcePanelResizing = false;
	resetResourcePanelState();
}

export function openLuaCodeTab(descriptor: VMResourceDescriptor): void {
	const navigationCheckpoint = beginNavigationCapture();
	const tabId: EditorTabId = `lua:${descriptor.path}`;
	let tab = ide_state.tabs.find(candidate => candidate.id === tabId);
	if (!ide_state.codeTabContexts.has(tabId)) {
		const context = createLuaCodeTabContext(descriptor);
		ide_state.codeTabContexts.set(tabId, context);
	}
	const context = ide_state.codeTabContexts.get(tabId);
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
		ide_state.tabs.push(tab);
	} else {
		tab.title = computeResourceTabTitle(descriptor);
		if (context) {
			tab.dirty = context.dirty;
		}
	}
	setActiveTab(tabId);
	completeNavigation(navigationCheckpoint);
}

export function openResourceViewerTab(descriptor: VMResourceDescriptor): void {
	const tabId: EditorTabId = `resource:${descriptor.path}`;
	let tab = ide_state.tabs.find(candidate => candidate.id === tabId);
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
	ide_state.tabs.push(tab);
	setActiveTab(tabId);
}

export function closeActiveTab(): void {
	if (!ide_state.activeTabId) {
		return;
	}
	closeTab(ide_state.activeTabId);
}

export function resetEditorContent(): void {
	ide_state.buffer = new PieceTreeBuffer('');
	ide_state.layout.markVisualLinesDirty();
	markDiagnosticsDirty();
	ide_state.cursorRow = 0;
	ide_state.cursorColumn = 0;
	ide_state.scrollRow = 0;
	ide_state.scrollColumn = 0;
	ide_state.selectionAnchor = null;
	ide_state.lastSavedSource = '';
	ide_state.undoStack = [];
	ide_state.redoStack = [];
	ide_state.lastHistoryKey = null;
	ide_state.lastHistoryTimestamp = 0;
	ide_state.savePointDepth = 0;
	ide_state.layout.invalidateAllHighlights();
	bumpTextVersion();
	ide_state.dirty = false;
	updateActiveContextDirtyFlag();
	syncRuntimeErrorOverlayFromContext(null);
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
	requestSemanticRefresh();
}

export function resetResourcePanelState(): void {
	ide_state.resourceBrowserItems = [];
	ide_state.resourceBrowserSelectionIndex = -1;
	// max line width handled by controller
	ide_state.pendingResourceSelectionAssetId = null;
	ide_state.resourcePanelResizing = false;
}

export function refreshResourcePanelContents(): void {
	// New path owned by ResourcePanelController
	ide_state.resourcePanel.refresh();
	const s = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanelResourceCount = s.items.length;
	ide_state.resourceBrowserItems = s.items;
	ide_state.resourceBrowserSelectionIndex = s.selectionIndex;
}

export function enterResourceViewer(tab: EditorTabDescriptor): void {
	closeSearch(false, true);
	closeLineJump(false);
	ide_state.cursorRevealSuspended = false;
	tab.dirty = false;
	// hover state handled by controller; no-op here
	if (!tab.resource) {
		return;
	}
	resourceViewerClampScroll(tab.resource);
}

export function selectResourceInPanel(descriptor: VMResourceDescriptor): void {
	if (!descriptor.asset_id || descriptor.asset_id.length === 0) {
		return;
	}
	ide_state.pendingResourceSelectionAssetId = descriptor.asset_id;
	if (!ide_state.resourcePanelVisible) {
		return;
	}
	applyPendingResourceSelection();
}

export function applyPendingResourceSelection(): void {
	if (!ide_state.resourcePanelVisible) {
		return;
	}
	const asset_id = ide_state.pendingResourceSelectionAssetId;
	if (!asset_id) {
		return;
	}
	const index = findResourcePanelIndexByasset_id(asset_id);
	if (index === -1) {
		return;
	}
	ide_state.resourceBrowserSelectionIndex = index;
	ide_state.resourcePanel.ensureSelectionVisible();
	ide_state.pendingResourceSelectionAssetId = null;
}

export function findResourcePanelIndexByasset_id(asset_id: string): number {
	for (let i = 0; i < ide_state.resourceBrowserItems.length; i++) {
		const descriptor = ide_state.resourceBrowserItems[i].descriptor;
		if (descriptor && descriptor.asset_id === asset_id) {
			return i;
		}
	}
	return -1;
}

export function buildResourceViewerState(descriptor: VMResourceDescriptor): ResourceViewerState {
	const title = computeResourceTabTitle(descriptor);
	const lines: string[] = [
		`Path: ${descriptor.path || '<none>'}`,
		`Type: ${descriptor.type}`,
		`Asset ID: ${descriptor.asset_id || '<none>'}`,
	];
	const state: ResourceViewerState = {
		descriptor,
		lines,
		error: null,
		title,
		scroll: 0,
	};
	let error: string = null;
	const rompack = $.rompack;
	lines.push('');
	const data = rompack.data;
	const img = rompack.img;
	const audioTable = rompack.audio;
	const modelTable = rompack.model;
	const audioevents = rompack.audioevents;
	switch (descriptor.type) {
		case 'lua': {
			const chunkName = descriptor.path ?? descriptor.asset_id;
			const source = BmsxVMRuntime.instance.resourceSourceForChunk(chunkName);
			if (typeof source === 'string') {
				appendResourceViewerLines(lines, ['-- Lua Source --', '']);
				appendResourceViewerLines(lines, source.split(/\r?\n/));
			} else {
				error = `Lua source '${descriptor.asset_id}' unavailable.`;
			}
			break;
		}
		case 'code': {
			const dataEntry = data?.[descriptor.asset_id];
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
				error = `Code asset '${descriptor.asset_id}' unavailable.`;
			}
			break;
		}
		case 'data': {
			const dataEntry = data?.[descriptor.asset_id];
			if (dataEntry !== undefined) {
				const json = safeJsonStringify(dataEntry);
				appendResourceViewerLines(lines, ['-- Data --', '']);
				appendResourceViewerLines(lines, json.split(/\r?\n/));
			} else {
				error = `Data asset '${descriptor.asset_id}' not found.`;
			}
			break;
		}
		case 'image':
		case 'atlas':
		case 'romlabel': {
			const image = img?.[descriptor.asset_id];
			if (!image) {
				error = `Image asset '${descriptor.asset_id}' not found.`;
				break;
			}
			const meta = image.imgmeta;
			const width = meta.width;
			const height = meta.height;
			const atlasId = meta.atlasid;
			const atlassed = meta.atlassed;
			state.image = {
				asset_id: descriptor.asset_id,
				width: Math.max(1, Math.floor(width)),
				height: Math.max(1, Math.floor(height)),
				atlassed: Boolean(atlassed),
				atlasId: atlasId,
			};
			appendResourceViewerLines(lines, ['-- Image Metadata --']);
			appendResourceViewerLines(lines, [`Dimensions: ${width}x${height}`]);
			appendResourceViewerLines(lines, [`Atlassed: ${atlassed ? 'yes' : 'no'}`]);
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
			const audio = audioTable?.[descriptor.asset_id];
			if (!audio) {
				error = `Audio asset '${descriptor.asset_id}' not found.`;
				break;
			}
			const meta = audio.audiometa ?? {};
			appendResourceViewerLines(lines, ['-- Audio Metadata --']);
			const bufferSize = (audio.buffer as { byteLength?: number })?.byteLength;
			if (typeof bufferSize === 'number') {
				appendResourceViewerLines(lines, [`Buffer Size: ${bufferSize} bytes`]);
			}
			for (const [key, value] of Object.entries(meta)) {
				appendResourceViewerLines(lines, [`${key}: ${describeMetadataValue(value)}`]);
			}
			break;
		}
		case 'model': {
			const model = modelTable?.[descriptor.asset_id];
			if (!model) {
				error = `Model asset '${descriptor.asset_id}' not found.`;
				break;
			}
			const keys = Object.keys(model);
			appendResourceViewerLines(lines, ['-- Model Metadata --', `Keys: ${keys.join(', ')}`]);
			break;
		}
		case 'aem': {
			const events = audioevents?.[descriptor.asset_id];
			if (!events) {
				error = `Audio event map '${descriptor.asset_id}' not found.`;
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
	if (error) {
		lines.push('');
		lines.push(`Error: ${error}`);
	}
	if (lines.length === 0) {
		lines.push('<empty>');
	}
	state.error = error;
	return state;
}

export function appendResourceViewerLines(target: string[], additions: Iterable<string>): void {
	for (const entry of additions) {
		target.push(...splitText(entry));
	}
}

const DEBUG_PANEL_TITLES: Record<DebugPanelKind, string> = {
	objects: 'Objects',
	events: 'Events',
	registry: 'Registry',
};

export function debugPanelTabId(kind: DebugPanelKind): string {
	return `debug:${kind}`;
}

export function buildDebugPanelLines(kind: DebugPanelKind): string[] {
	const lines: string[] = [`${DEBUG_PANEL_TITLES[kind]} Overview`, ''];
	switch (kind) {
		case 'objects':
			appendResourceViewerLines(lines, collectWorldObjectLines());
			break;
		case 'events':
			appendResourceViewerLines(lines, collectEventEmitterLines());
			break;
		case 'registry':
			appendResourceViewerLines(lines, collectRegistryLines());
			break;
	}
	if (lines.length === 0) {
		lines.push('<empty>');
	}
	return lines;
}

export function collectWorldObjectLines(): string[] {
	const entries = $.world.allObjectsFromSpaces;
	if (entries.length === 0) return ['<no world objects>'];
	const lines: string[] = [`Total Objects: ${entries.length}`, ''];
	for (let index = 0; index < entries.length; index += 1) {
		const obj = entries[index]!;
		const className = obj.constructor.name;
		const id = obj.id ?? '<unnamed>';
		const posX = obj.x;
		const posY = obj.y;
		const posZ = obj.z;
		const active = obj.active;
		lines.push(`${index + 1}. ${id} [${className}] pos=(${posX}, ${posY}, ${posZ}) ${active}`);
	}
	return lines;
}

export function describeListenerSet(set: ListenerSet): string {
	const names: string[] = [];
	for (const entry of set) {
		const subscriber = entry.subscriber as { id?: string; constructor?: { name?: string } };
		const name = subscriber?.id ?? subscriber?.constructor?.name ?? '<anonymous>';
		if (!names.includes(name)) names.push(name);
		if (names.length >= 5) break;
	}
	const base = `${set.size} listener${set.size === 1 ? '' : 's'}`;
	if (names.length === 0) return base;
	const suffix = names.length < set.size ? `${names.join(', ')}, …` : names.join(', ');
	return `${base} (${suffix})`;
}

export function collectEventEmitterLines(): string[] {
	const emitter = EventEmitter.instance;
	const lines: string[] = [];
	const globalEntries = Object.entries(emitter.globalScopeListeners ?? {});
	lines.push('Global Listeners:');
	if (globalEntries.length === 0) {
		lines.push('  <none>');
	} else {
		for (const [eventName, set] of globalEntries.sort(([a], [b]) => a.localeCompare(b))) {
			lines.push(`  ${eventName}: ${describeListenerSet(set)}`);
		}
	}
	lines.push('');
	lines.push('Scoped Listeners:');
	const scopedEntries = Object.entries(emitter.emitterScopeListeners ?? {});
	if (scopedEntries.length === 0) {
		lines.push('  <none>');
	} else {
		for (const [eventName, scopes] of scopedEntries.sort(([a], [b]) => a.localeCompare(b))) {
			lines.push(`  ${eventName}:`);
			const scopeEntries = Object.entries(scopes);
			for (const [scopeId, set] of scopeEntries.sort(([a], [b]) => a.localeCompare(b))) {
				lines.push(`    [${scopeId}] ${describeListenerSet(set)}`);
			}
		}
	}
	return lines;
}

export function collectRegistryLines(): string[] {
	const registry = Registry.instance;
	const entities = registry.getRegisteredEntities();
	const lines: string[] = [`Registered Entities: ${entities.length}`, ''];
	if (entities.length === 0) {
		lines.push('<registry empty>');
		return lines;
	}
	entities.sort((a, b) => String(a.id).localeCompare(String(b.id)));
	for (const entity of entities) {
		const ctor = entity.constructor?.name ?? 'Unknown';
		const persistent = entity.registrypersistent ? 'persistent' : 'ephemeral';
		lines.push(`${entity.id} [${ctor}] ${persistent}`);
	}
	return lines;
}

export function openDebugPanelTab(kind: DebugPanelKind): void {
	const tabId = debugPanelTabId(kind);
	const title = DEBUG_PANEL_TITLES[kind];
	const source = buildDebugPanelLines(kind).join('\n');
	const wasActive = ide_state.activeTabId === tabId;
	let context = ide_state.codeTabContexts.get(tabId);
	if (!context) {
		const buffer = new PieceTreeBuffer(source);
		context = {
			id: tabId,
			title,
			descriptor: null,
			buffer,
			cursorRow: 0,
			cursorColumn: 0,
			scrollRow: 0,
			scrollColumn: 0,
			selectionAnchor: null,
			lastSavedSource: '',
			saveGeneration: 0,
			appliedGeneration: 0,
			undoStack: [],
			redoStack: [],
			lastHistoryKey: null,
			lastHistoryTimestamp: 0,
			savePointDepth: 0,
			dirty: false,
			runtimeErrorOverlay: null,
			executionStopRow: null,
			readOnly: true,
			textVersion: buffer.version,
		};
		ide_state.codeTabContexts.set(tabId, context);
	} else {
		context.title = title;
		context.readOnly = true;
		context.buffer.replace(0, context.buffer.length, source);
		context.textVersion = context.buffer.version;
		context.cursorRow = 0;
		context.cursorColumn = 0;
		context.scrollRow = 0;
		context.scrollColumn = 0;
		context.selectionAnchor = null;
		context.undoStack.length = 0;
		context.redoStack.length = 0;
		context.lastHistoryKey = null;
		context.lastHistoryTimestamp = 0;
		context.savePointDepth = 0;
		context.dirty = false;
	}
	let tab = ide_state.tabs.find(candidate => candidate.id === tabId);
	if (!tab) {
		tab = {
			id: tabId,
			kind: 'lua_editor',
			title,
			closable: true,
			dirty: false,
		};
		ide_state.tabs.push(tab);
	} else {
		tab.title = title;
		tab.dirty = false;
	}
	setTabDirty(tabId, false);
	setActiveTab(tabId);
	if (wasActive) {
		ide_state.textVersion = ide_state.buffer.version;
		ide_state.maxLineLengthDirty = true;
		ide_state.layout.invalidateHighlightsFromRow(0);
		ide_state.layout.markVisualLinesDirty();
	}
}

export function isDebugPanelActive(kind: DebugPanelKind): boolean {
	return ide_state.activeTabId === debugPanelTabId(kind);
}

export function openDebugOverviewTab(): void {
	openDebugPanelTab('registry');
}

export function openObjectInspectorTab(): void {
	openDebugPanelTab('objects');
}

export function openEventInspectorTab(): void {
	openDebugPanelTab('events');
}

export function computePanelRatioBounds(): { min: number; max: number } {
	const minRatio = constants.RESOURCE_PANEL_MIN_RATIO;
	const minEditorRatio = constants.RESOURCE_PANEL_MIN_EDITOR_RATIO;
	const availableForPanel = Math.max(0, 1 - minEditorRatio);
	const maxRatio = Math.max(minRatio, Math.min(constants.RESOURCE_PANEL_MAX_RATIO, availableForPanel));
	return { min: minRatio, max: maxRatio };
}

export function defaultResourcePanelRatio(): number {
	const metrics = $.platform.gameviewHost.getCapability('viewport-metrics').getViewportMetrics();
	const viewportWidth = metrics.windowInner.width;
	const screenWidth = metrics.screen.width;
	const relative = Math.min(1, viewportWidth / screenWidth);
	const responsiveness = 1 - relative;
	const ratio = constants.RESOURCE_PANEL_DEFAULT_RATIO + responsiveness * (constants.RESOURCE_PANEL_MAX_RATIO - constants.RESOURCE_PANEL_DEFAULT_RATIO) * 0.6;
	const bounds = computePanelRatioBounds();
	return Math.max(bounds.min, Math.min(bounds.max, ratio));
}

export function getResourcePanelWidth(): number {
	if (!ide_state.resourcePanelVisible) return 0;
	const bounds = ide_state.resourcePanel.getBounds();
	return bounds ? Math.max(0, bounds.right - bounds.left) : 0;
}

export function scrollResourceBrowser(amount: number): void {
	if (!ide_state.resourcePanelVisible) return;
	ide_state.resourcePanel.scrollBy(amount);
	// controller owns scroll; no local mirror required
}

export function resourceViewerImageLayout(viewer: ResourceViewerState): { left: number; top: number; width: number; height: number; bottom: number; scale: number } {
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
	const reservedTextHeight = Math.min(totalHeight * 0.45, ide_state.lineHeight * estimatedTextLines);
	const maxImageHeight = Math.max(ide_state.lineHeight * 2, totalHeight - reservedTextHeight);
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
		textTop = Math.floor(layout.bottom + ide_state.lineHeight);
	}
	if (textTop >= bounds.codeBottom) {
		return 0;
	}
	const availableHeight = Math.max(0, bounds.codeBottom - textTop);
	return Math.max(0, Math.floor(availableHeight / ide_state.lineHeight));
}

export function ensureResourceViewerSprite(asset_id: string, layout: { left: number; top: number; scale: number }): void {
	if (!ide_state.resourceViewerSpriteId) {
		ide_state.resourceViewerSpriteId = 'resource_viewer_sprite';
	}
	const spriteId = ide_state.resourceViewerSpriteId;
	let object = api.world_object(spriteId);
	// if (!object) {
	// 	api.spawn_object('WorldObject', {
	// 		id: spriteId,
	// 		position: { x: layout.left, y: layout.top, z: 0 },
	// 		components: [
	// 			{
	// 				class: 'SpriteComponent',
	// 				options: {
	// 					id_local: 'viewer_sprite',
	// 					imgid: asset_id,
	// 					layer: 'ui',
	// 				},
	// 			},
	// 		],
	// 	});
	// 	object = api.world_object(spriteId);
	// }
	if (!object) {
		return;
	}
	const sprite = object.get_component_by_local_id(SpriteComponent, 'viewer_sprite');
	if (!sprite) {
		return;
	}
	if (ide_state.resourceViewerSpriteAsset !== asset_id) {
		sprite.imgid = asset_id;
		ide_state.resourceViewerSpriteAsset = asset_id;
	}
	if (ide_state.resourceViewerSpriteScale !== layout.scale) {
		sprite.scale.x = layout.scale;
		sprite.scale.y = layout.scale;
		ide_state.resourceViewerSpriteScale = layout.scale;
	}
	object.x = layout.left;
	object.y = layout.top;
	object.visible = true;
}

export function hideResourceViewerSprite(): void {
	if (!ide_state.resourceViewerSpriteId) {
		return;
	}
	const object = api.world_object(ide_state.resourceViewerSpriteId);
	if (object) {
		object.visible = false;
	}
}

export function recordEditContext(kind: 'insert' | 'delete' | 'replace', text: string): void {
	ide_state.lastContentEditAtMs = ide_state.clockNow();
	ide_state.pendingEditContext = { kind, text };
}

export function applySourceToDocument(source: string): void {
	ide_state.buffer.replace(0, ide_state.buffer.length, source);
	invalidateLuaCommentContextFromRow(ide_state.buffer, 0);
	ide_state.textVersion = ide_state.buffer.version;
	ide_state.maxLineLengthDirty = true;
	ide_state.layout.invalidateHighlightsFromRow(0);
	ide_state.layout.markVisualLinesDirty();
}

export function resetActionPromptState(): void {
	ide_state.pendingActionPrompt = null;
	ide_state.actionPromptButtons.saveAndContinue = null;
	ide_state.actionPromptButtons.continue = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.actionPromptButtons.cancel = { left: 0, top: 0, right: 0, bottom: 0 };
}

export function hasPendingRuntimeReload(): boolean {
	return ide_state.saveGeneration > ide_state.appliedGeneration;
}

export function handleRuntimeTaskError(error: unknown, fallbackMessage: string): void {
	const errormsg = error instanceof Error ? error.message : String(error);
	$.paused = true;
	activate();
	const message = `${fallbackMessage}: ${errormsg}`;
	BmsxVMRuntime.instance.terminal.appendStderr(message);
	ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 2.0);
}
