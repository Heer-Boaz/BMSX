import { $ } from '../../core/engine_core';
import { type TimerHandle } from '../../platform/platform';
import type {
	LuaDefinitionLocation,
	LuaHoverRequest,
	LuaHoverResult,
	ResourceDescriptor,
} from '../types';
import { clamp } from '../../utils/clamp';
import { computeAggregatedEditorDiagnostics, markAllDiagnosticsDirty, markDiagnosticsDirty, type DiagnosticContextInput, type DiagnosticProviders } from './diagnostics';
import {
	getActiveCodeTabContext,
	updateActiveContextDirtyFlag,
	isCodeTabActive,
	isEditableCodeTab,
	setActiveTab,
	activateCodeTab,
	closeTab,
	findCodeTabContext,
	openLuaCodeTab,
} from './editor_tabs';

import { bumpTextVersion, capturePreMutationSource, ensureVisualLines, invalidateLuaCommentContextFromRow, markTextMutated, positionToVisualIndex, visualIndexToSegment } from './text_utils';
import { applyInlineFieldPointer, setFieldText } from './inline_text_field';
import { inspectLuaExpression, listGlobalLuaSymbols, listLuaBuiltinFunctions, listLuaSymbols, requestSemanticRefresh } from './intellisense';
import { getTextSnapshot, splitText } from './text/source_text';
import { EditorUndoRecord, TextUndoOp } from './text/editor_undo';
import { PieceTreeBuffer } from './text/piece_tree_buffer';
import type {
	CodeTabContext,
	EditorSnapshot,
	EditorDiagnostic,
	TextField,
	Position,
	RuntimeErrorOverlay,
} from './types';
import { enqueueBackgroundTask, scheduleIdeOnce } from './background_tasks';

import type { LuaDefinitionInfo } from '../../lua/syntax/lua_ast';
// Search logic moved to editor_search
import { closeSearch } from './editor_search';
import { closeSymbolSearch, closeResourceSearch, closeLineJump, findResourceDescriptorForChunk } from './search_bars';
import * as constants from './constants';
import { ide_state, type NavigationHistoryEntry, EMPTY_DIAGNOSTICS, NAVIGATION_HISTORY_LIMIT, diagnosticsDebounceMs, caretNavigation } from './ide_state';
import { ensureCursorVisible, revealCursor, setCursorPosition } from './caret';
import { clearWorkspaceDirtyBuffers, buildDirtyFilePath } from './workspace_storage';
import { getWorkspaceCachedSource, setWorkspaceCachedSources } from '../workspace_cache';
import { listResources, saveLuaResourceSource } from '../workspace';

import * as TextEditing from './text_editing_and_selection';
import { resetBlink } from './render/render_caret';
import { Runtime } from '../runtime';
import { getOrCreateSemanticWorkspace } from './semantic_workspace_sync';
import * as runtimeLuaPipeline from '../runtime_lua_pipeline';
import * as runtimeIde from '../runtime_ide';
import { renderFaultOverlay, renderRuntimeFaultOverlay, showRuntimeError, showRuntimeErrorInChunk } from './render/render_error_overlay';
import { type ModuleAliasEntry } from './semantic_model';
import { extractErrorMessage } from '../../lua/luavalue';
import {
	activateRuntimeEditor as activate,
	deactivateRuntimeEditor as deactivate,
	draw,
	shutdownRuntimeEditor as shutdown,
	tickInput,
	update,
} from './editor_runtime';
import { initializeCartEditor } from './editor_bootstrap';
import {
	notifyReadOnlyEdit,
	selectResourceInPanel,
	setFontVariant,
	updateViewport,
} from './editor_view';
import { openResourceViewerTab } from './resource_viewer';
import { Viewport } from '../../rompack/rompack';

export { activate, deactivate, draw, shutdown, tickInput, update };
export { openLuaCodeTab } from './editor_tabs';
export {
	applyPendingResourceSelection,
	applyViewportSize,
	bottomMargin,
	codeViewportTop,
	computeMaximumScrollColumn,
	findResourcePanelIndexByasset_id,
	getCodeAreaBounds,
	getCreateResourceBarBounds,
	getCreateResourceBarHeight,
	getLineJumpBarBounds,
	getLineJumpBarHeight,
	getRenameBarBounds,
	getRenameBarHeight,
	getResourcePanelWidth,
	getResourceSearchBarBounds,
	getResourceSearchBarHeight,
	getSearchBarBounds,
	getSearchBarHeight,
	getStatusMessageLines,
	getSymbolSearchBarBounds,
	getSymbolSearchBarHeight,
	getTabBarTotalHeight,
	getVisibleProblemsPanelHeight,
	hideResourcePanel,
	isResourceSearchCompactMode,
	isSymbolSearchCompactMode,
	mapScreenPointToViewport,
	maximumLineLength,
	notifyReadOnlyEdit,
	refreshResourcePanelContents,
	resetPointerClickTracking,
	resetResourcePanelState,
	resolvePointerColumn,
	resolvePointerRow,
	resourceSearchEntryHeight,
	resourceSearchPageSize,
	resourceSearchVisibleResultCount,
	resourceSearchWindowCapacity,
	scrollResourceBrowser,
	scrollRows,
	searchResultEntryHeight,
	searchVisibleResultCount,
	selectResourceInPanel,
	setFontVariant,
	statusAreaHeight,
	symbolSearchEntryHeight,
	symbolSearchPageSize,
	symbolSearchVisibleResultCount,
	toggleWordWrap,
	topMargin,
	handlePointerAutoScroll,
	updateViewport,
} from './editor_view';

export type CartEditor = {
	readonly blocksRuntimePipeline: true;
	isActive: boolean;
	activate: typeof activate;
	deactivate: typeof deactivate;
	tickInput: typeof tickInput;
	update: typeof update;
	draw: typeof draw;
	shutdown: typeof shutdown;
	updateViewport: typeof updateViewport;
	setFontVariant: typeof setFontVariant;
	showRuntimeErrorInChunk: typeof showRuntimeErrorInChunk;
	showRuntimeError: typeof showRuntimeError;
	clearRuntimeErrorOverlay: typeof clearRuntimeErrorOverlay;
	clearAllRuntimeErrorOverlays: typeof clearAllRuntimeErrorOverlays;
	getSourceForChunk: typeof getSourceForChunk;
	clearWorkspaceDirtyBuffers: typeof clearWorkspaceDirtyBuffers;
	renderFaultOverlay: typeof renderFaultOverlay;
	renderRuntimeFaultOverlay: typeof renderRuntimeFaultOverlay;
};

const editorRuntimeApi: CartEditor = {
	blocksRuntimePipeline: true,
	get isActive(): boolean { return ide_state.active; },
	activate,
	deactivate,
	tickInput,
	update,
	draw,
	shutdown,
	updateViewport,
	setFontVariant,
	showRuntimeErrorInChunk,
	showRuntimeError,
	clearRuntimeErrorOverlay,
	clearAllRuntimeErrorOverlays,
	getSourceForChunk,
	clearWorkspaceDirtyBuffers,
	renderFaultOverlay,
	renderRuntimeFaultOverlay,
};

export function createCartEditor(viewport: Viewport): CartEditor {
	initializeCartEditor(viewport);
	return editorRuntimeApi;
}

export function getSourceForChunk(path: string): string {
	const asset = runtimeLuaPipeline.resolveLuaSourceRecord(Runtime.instance, path);
	const context = findCodeTabContext(path);
	if (context) {
		if (context.id === ide_state.activeCodeTabContextId) {
			return getTextSnapshot(ide_state.buffer);
		}
		return getTextSnapshot(context.buffer);
	}
	const dirtyPath = buildDirtyFilePath(asset.source_path);
	const cached = getWorkspaceCachedSource(asset.source_path) ?? getWorkspaceCachedSource(dirtyPath);
	if (cached !== null) {
		return cached;
	}
	return asset.src;
}

export function invalidateLineRange(startRow: number, endRow: number): void {
	let from = Math.min(startRow, endRow);
	let to = Math.max(startRow, endRow);
	from = ide_state.layout.clampBufferRow(ide_state.buffer, from);
	to = ide_state.layout.clampBufferRow(ide_state.buffer, to);
	for (let row = from; row <= to; row += 1) {
		ide_state.layout.invalidateLine(row);
	}
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

export function focusChunkSource(path: string): void {
	if (!ide_state.active) {
		runtimeIde.activateEditor(Runtime.instance);
	}
	closeSymbolSearch(true);
	closeResourceSearch(true);
	closeLineJump(true);
	closeSearch(true);
	if (!path) {
		return;
	}
	const descriptor = findResourceDescriptorForChunk(path);
	if (!descriptor) {
		return;
	}
	openResourceDescriptor(descriptor);
}

export function listResourcesStrict(): ResourceDescriptor[] {
	return listResources();
}

export function openResourceDescriptor(descriptor: ResourceDescriptor): void {
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
// editor may have switched ide_state.tabs to the faulting path.
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
		nextRow = ide_state.layout.clampBufferRow(ide_state.buffer, nextRow);
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

export function tryShowLuaErrorOverlay(error: unknown): boolean {
	let candidate: { line?: unknown; column?: unknown; path?: unknown; message?: unknown };
	if (typeof error === 'string') {
		candidate = { message: error };
	} else if (error && typeof error === 'object') {
		candidate = error as { line?: unknown; column?: unknown; path?: unknown; message?: unknown };
	} else {
		throw new Error('[CartEditor] Lua error payload is neither an object nor a string.');
	}
	const rawLine = candidate.line as number;
	const rawColumn = candidate.column as number;
	const path = candidate.path as string;
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
	showRuntimeErrorInChunk(path, safeLine, safeColumn, baseMessage);
	return true;
}

export function safeInspectLuaExpression(request: LuaHoverRequest): LuaHoverResult {
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
	const metadata: Array<{ id: string; path: string }> = [];
	for (let index = 0; index < contextIds.length; index += 1) {
		const contextId = contextIds[index];
		const context = ide_state.codeTabContexts.get(contextId);
		if (!context) {
			ide_state.diagnosticsCache.delete(contextId);
			ide_state.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		const path = context.descriptor.path;
		const isActive = activeId && contextId === activeId;
		const cached = ide_state.diagnosticsCache.get(contextId);
		const buffer = isActive ? ide_state.buffer : context.buffer;
		const version = buffer.version;
		if (cached && cached.path === path && cached.version === version) {
			ide_state.dirtyDiagnosticContexts.delete(contextId);
			continue;
		}
		const source = getTextSnapshot(buffer);
		const input: DiagnosticContextInput = {
			id: context.id,
			path,
			source,
			lines: splitText(source),
			version,
		};
		inputs.push(input);
		inputLookup.set(context.id, input);
		metadata.push({ id: context.id, path });
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
			path: meta.path,
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
		listLocalSymbols: (path) => {
			return listLuaSymbols(path);
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

export function markDiagnosticsDirtyForChunk(path: string): void {
	const context = findContextByChunk(path);
	if (!context) {
		return;
	}
	markDiagnosticsDirty(context.id);
}

export function getActiveSemanticDefinitions(): readonly LuaDefinitionInfo[] {
	const context = getActiveCodeTabContext();
	const path = context.descriptor.path;
	return ide_state.layout.getSemanticDefinitions(ide_state.buffer, ide_state.textVersion, path);
}

export function getLuaModuleAliases(path: string): Map<string, ModuleAliasEntry> {
	const activeContext = getActiveCodeTabContext();
	const targetChunk = path || activeContext.descriptor.path;
	ide_state.layout.getSemanticDefinitions(ide_state.buffer, ide_state.textVersion, targetChunk);
	const data = getOrCreateSemanticWorkspace().getSnapshot().getFileData(targetChunk);
	if (!data || data.moduleAliases.length === 0) {
		return new Map();
	}
	const aliases = new Map<string, ModuleAliasEntry>();
	for (let index = 0; index < data.moduleAliases.length; index += 1) {
		const entry = data.moduleAliases[index]!;
		aliases.set(entry.alias, entry);
	}
	return aliases;
}

export function findContextByChunk(path: string): CodeTabContext {
	const byChunk = findCodeTabContext(path);
	if (byChunk) {
		return byChunk;
	}
	for (const context of ide_state.codeTabContexts.values()) {
		const descriptor = context.descriptor;
		if (descriptor) {
			continue;
		}
		const aliases: string[] = ['__entry__'];
		for (let index = 0; index < aliases.length; index += 1) {
			const alias = aliases[index];
			if (alias === path) {
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

export function focusEditorFromResourcePanel(): void {
	if (!ide_state.resourcePanelFocused) {
		return;
	}
	ide_state.resourcePanelFocused = false;
	resetBlink();
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

export function applyDefinitionSelection(range: LuaDefinitionLocation['range']): void {
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
	const path = context.descriptor.path;
	const maxRowIndex = Math.max(0, ide_state.buffer.getLineCount() - 1);
	const row = clamp(ide_state.cursorRow, 0, maxRowIndex);
	const lineLen = ide_state.buffer.getLineEndOffset(row) - ide_state.buffer.getLineStartOffset(row);
	const column = clamp(ide_state.cursorColumn, 0, lineLen);
	return {
		contextId: context.id,
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
		focusChunkSource(entry.path);
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
	ide_state.cursorRow = ide_state.layout.clampBufferRow(ide_state.buffer, ide_state.cursorRow);
	const cursorLine = ide_state.buffer.getLineContent(ide_state.cursorRow);
	ide_state.cursorColumn = ide_state.layout.clampLineLength(cursorLine.length, ide_state.cursorColumn);
	ide_state.selectionAnchor = TextEditing.clampSelectionPosition(ide_state.selectionAnchor);
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
	ide_state.cursorRow = ide_state.layout.clampBufferRow(ide_state.buffer, ide_state.cursorRow);
	const cursorLine = ide_state.buffer.getLineContent(ide_state.cursorRow);
	ide_state.cursorColumn = ide_state.layout.clampLineLength(cursorLine.length, ide_state.cursorColumn);
	ide_state.selectionAnchor = TextEditing.clampSelectionPosition(ide_state.selectionAnchor);
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

export function applySearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.searchQuery = value;
	setFieldText(ide_state.searchField, value, moveCursorToEnd);
}

export function processInlineFieldPointer(field: TextField, textLeft: number, pointerX: number, justPressed: boolean, pointerPressed: boolean): void {
	const result = applyInlineFieldPointer(field, {
		metrics: ide_state.inlineFieldMetricsRef,
		textLeft,
		pointerX,
		justPressed,
		pointerPressed,
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
		const override = caretNavigation.lookup(ide_state.cursorRow, ide_state.cursorColumn);
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
	const source = getTextSnapshot(ide_state.buffer);
	const targetPath = context.descriptor.path;
	try {
		await saveLuaResourceSource(targetPath, source);
		setWorkspaceCachedSources([targetPath, buildDirtyFilePath(targetPath)], source);
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

export function closeActiveTab(): void {
	if (!ide_state.activeTabId) {
		return;
	}
	closeTab(ide_state.activeTabId);
}

export function resetEditorContent(): void {
	ide_state.buffer = new PieceTreeBuffer('');
	ide_state.layout.markVisualLinesDirty();
	markAllDiagnosticsDirty();
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

export function handleRuntimeTaskError(error: unknown, fallbackMessage: string): void {
	const errormsg = error instanceof Error ? error.message : String(error);
	$.paused = true;
	runtimeIde.activateEditor(Runtime.instance);
	const message = `${fallbackMessage}: ${errormsg}`;
	Runtime.instance.terminal.appendStderr(message);
	ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 2.0);
}

