import { $ } from '../../core/engine_core';
import { scheduleMicrotask, type TimerHandle } from '../../platform/platform';
import type {
	LuaDefinitionLocation,
	LuaHoverRequest,
	LuaHoverResult,
	ResourceDescriptor,
} from '../types';
import { drawEditorText } from './text_renderer';
import { clamp } from '../../utils/clamp';
import { computeAggregatedEditorDiagnostics, markAllDiagnosticsDirty, markDiagnosticsDirty, type DiagnosticContextInput, type DiagnosticProviders } from './diagnostics';
import {
	createEntryTabContext,
	createLuaCodeTabContext,
	getActiveCodeTabContext,
	setTabDirty,
	updateActiveContextDirtyFlag,
	isCodeTabActive,
	isEditableCodeTab,
	setActiveTab,
	activateCodeTab,
	closeTab,
	findCodeTabContext,
	openLuaCodeTab,
} from './editor_tabs';

import { bumpTextVersion, capturePreMutationSource, ensureVisualLines, invalidateLuaCommentContextFromRow, markTextMutated, measureText, positionToVisualIndex, visibleColumnCount, visibleRowCount, visualIndexToSegment } from './text_utils';
import {
	applyInlineFieldEditing,
	applyInlineFieldPointer,
	getFieldText,
	setFieldText,
} from './inline_text_field';
import { clearReferenceHighlights, extractHoverExpression, inspectLuaExpression, listGlobalLuaSymbols, listLuaBuiltinFunctions, listLuaSymbols, navigateToLuaDefinition, requestSemanticRefresh } from './intellisense';
import { isKeyJustPressed, toggleThemeMode } from './ide_input';
import { consumeIdeKey } from './ide_input';
import { getTextSnapshot, splitText } from './text/source_text';
import { EditorUndoRecord, TextUndoOp } from './text/editor_undo';
import { PieceTreeBuffer } from './text/piece_tree_buffer';
import type {
	CodeHoverTooltip,
	CodeTabContext,
	EditorSnapshot,
	EditorDiagnostic,
	TextField,
	PendingActionPrompt,
	PointerSnapshot,
	Position,
	RuntimeErrorOverlay,
	SymbolSearchResult,
} from './types';
import { resolveReferenceLookup, type ReferenceMatchInfo } from './code_reference';
import {
	buildReferenceCatalogForExpression as buildProjectReferenceCatalog,
	type ProjectReferenceEnvironment,
	filterReferenceCatalog,
	type ReferenceCatalogEntry,
	type ReferenceSymbolEntry,
} from './code_reference';
import { enqueueBackgroundTask, scheduleIdeOnce, scheduleRuntimeTask } from './background_tasks';

import type { RenameCommitPayload, RenameCommitResult } from './rename_controller';
import { CrossFileRenameManager, type CrossFileRenameDependencies } from './rename_controller';
import type { LuaDefinitionInfo, LuaSourceRange } from '../../lua/syntax/lua_ast';
// Search logic moved to editor_search
import { closeSearch, focusEditorFromSearch } from './editor_search';
import * as constants from './constants';
import { ide_state, type NavigationHistoryEntry, EMPTY_DIAGNOSTICS, NAVIGATION_HISTORY_LIMIT, diagnosticsDebounceMs, caretNavigation } from './ide_state';
import { clampCursorColumn, ensureCursorVisible, revealCursor, setCursorPosition } from './caret';
import {
	clearWorkspaceDirtyBuffers,
	buildDirtyFilePath,
} from './workspace_storage';
import { getWorkspaceCachedSource, setWorkspaceCachedSources } from '../workspace_cache';
import { applyWorkspaceOverridesToCart, createLuaResource, listResources, saveLuaResourceSource } from '../workspace';

import * as TextEditing from './text_editing_and_selection';
import { resetBlink } from './render/render_caret';
import { api, Runtime } from '../runtime';
import * as runtimeLuaPipeline from '../runtime_lua_pipeline';
import * as runtimeIde from '../runtime_ide';
import { renderFaultOverlay, renderRuntimeFaultOverlay, showRuntimeError, showRuntimeErrorInChunk } from './render/render_error_overlay';
import { point_in_rect } from '../../utils/rect_operations';
import { symbolPriority } from './semantic_model';
import { refreshSymbolCatalog } from './symbol_catalog';
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
	getCodeAreaBounds,
	notifyReadOnlyEdit,
	refreshResourcePanelContents,
	resolvePointerColumn,
	resolvePointerRow,
	resourceSearchWindowCapacity,
	selectResourceInPanel,
	setFontVariant,
	symbolSearchPageSize,
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
	openDebugOverviewTab,
	openEventInspectorTab,
	openObjectInspectorTab,
	openRegistryInspectorTab,
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

export const editorFacade = {
	activate,
	deactivate,
	blocksRuntimePipeline: true,
	get isActive(): boolean { return ide_state.active; },
	get exists(): boolean { return ide_state.initialized; },
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

export type CartEditor = typeof editorFacade;

export function createCartEditor(viewport: Viewport): CartEditor {
	initializeCartEditor(viewport);
	return editorFacade;
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
	const lastRow = ide_state.buffer.getLineCount() - 1;
	from = clamp(from, 0, lastRow);
	to = clamp(to, 0, lastRow);
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
	api.put_rectfillcolor(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, undefined, constants.HOVER_TOOLTIP_BACKGROUND);
	api.put_rect(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, undefined, constants.HOVER_TOOLTIP_BORDER);
	for (let i = 0; i < visibleLines.length; i += 1) {
		const lineY = bubbleTop + constants.HOVER_TOOLTIP_PADDING_Y + i * ide_state.lineHeight;
		drawEditorText(ide_state.font, visibleLines[i], bubbleLeft + constants.HOVER_TOOLTIP_PADDING_X, lineY, undefined, constants.COLOR_STATUS_TEXT);
	}
	tooltip.bubbleBounds = { left: bubbleLeft, top: bubbleTop, right: bubbleLeft + bubbleWidth, bottom: bubbleTop + bubbleHeight };
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

export function getLuaModuleAliases(path: string): Map<string, string> {
	const activeContext = getActiveCodeTabContext();
	const targetChunk = path || activeContext.descriptor.path;
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
	let resourcePath: string;
	let directory: string;
	try {
		const result = parseCreateResourceRequest(ide_state.createResourcePath);
		resourcePath = result.path;
		directory = result.directory;
		applyCreateResourceFieldText(resourcePath, true);
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
		const descriptor = await createLuaResource({ path: resourcePath, contents });
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
		const simplified = message.replace(/^\[Runtime\]\s*/, '');
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

export function parseCreateResourceRequest(rawPath: string): { path: string; asset_id: string; directory: string } {
	const candidate = rawPath;
	const slashIndex = candidate.lastIndexOf('/');
	const directory = slashIndex === -1 ? '' : candidate.slice(0, slashIndex + 1);
	const fileName = slashIndex === -1 ? candidate : candidate.slice(slashIndex + 1);
	const baseName = fileName.endsWith('.lua') ? fileName.slice(0, -4) : fileName;
	return { path: candidate, asset_id: baseName, directory: ensureDirectorySuffix(directory) };
}

export function determineCreateResourceDefaultPath(): string {
	const lastDirectory = ide_state.lastCreateResourceDirectory;
	if (lastDirectory.length > 0) {
		return lastDirectory;
	}
	const activeContext = getActiveCodeTabContext();
	const activePath = activeContext.descriptor.path;
	if (activePath.length > 0) {
		return ensureDirectorySuffix(activePath);
	}
	const descriptors = listResources();
	const firstEditableLua = descriptors.find(entry => entry.type === 'lua' && entry.readOnly !== true && entry.path.length > 0);
	if (firstEditableLua) {
		return ensureDirectorySuffix(firstEditableLua.path);
	}
	const firstLua = descriptors.find(entry => entry.type === 'lua' && entry.path.length > 0);
	if (firstLua) {
		return ensureDirectorySuffix(firstLua.path);
	}
	return './';
}

export function ensureDirectorySuffix(path: string): string {
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
		workspace: ide_state.semanticWorkspace,
		buffer: ide_state.buffer,
		textVersion: ide_state.textVersion,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		path: referenceContext.path,
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
		workspace: ide_state.semanticWorkspace,
		buffer: ide_state.buffer,
		textVersion: ide_state.textVersion,
		cursorRow: ide_state.cursorRow,
		cursorColumn: ide_state.cursorColumn,
		extractExpression: (row, column) => extractHoverExpression(row, column),
		path: referenceContext.path,
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
	const activePath = referenceContext.path;
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
	type RangeBucket = { path: string; ranges: LuaSourceRange[]; seen: Set<string> };
	const rangeMap = new Map<string, RangeBucket>();
	const addRange = (range: LuaSourceRange): void => {
		const path = range.path ?? activePath;
		let bucket = rangeMap.get(path);
		if (!bucket) {
			bucket = { path: path, ranges: [], seen: new Set<string>() };
			rangeMap.set(path, bucket);
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
	rangeMap.delete(activePath);

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
		const replacements = renameManager.applyRenameToChunk(bucket.path, bucket.ranges, newName, activePath);
		updatedTotal += replacements;
		if (replacements > 0) {
			markDiagnosticsDirtyForChunk(bucket.path);
		}
	}
	return { updatedMatches: updatedTotal };
}

export function findResourceDescriptorForChunk(path: string): ResourceDescriptor | null {
	const runtime = Runtime.instance;
	const registries = runtimeLuaPipeline.listLuaSourceRegistries(runtime);
	for (const entry of registries) {
		const asset = entry.registry.path2lua[path];
		if (asset) {
			return { asset_id: asset.resid, path: asset.source_path, type: asset.type, readOnly: entry.readOnly };
		}
	}
	return null;
}

export function getCrossFileRenameDependencies(): CrossFileRenameDependencies {
	return {
		createLuaCodeTabContext: (descriptor: ResourceDescriptor) => createLuaCodeTabContext(descriptor),
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
	const path = context.descriptor.path;
	const activeLines = splitText(getTextSnapshot(ide_state.buffer));
	const environment: ProjectReferenceEnvironment = {
		activeContext: getActiveCodeTabContext(),
		activeLines,
		codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
	};
	return buildProjectReferenceCatalog({
		workspace: ide_state.semanticWorkspace,
		info,
		lines: activeLines,
		path,
		environment,
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
	try {
		const descriptors = listResourcesStrict();
		const augmented = descriptors.slice();
		const imgAssets = Object.values($.assets.img);
		for (const asset of imgAssets) {
			if (asset.type !== 'atlas') {
				continue;
			}
			const key = asset.resid;
			if (key !== '_atlas_primary' && !key.startsWith('atlas') && !key.startsWith('_atlas_')) {
				continue;
			}
			if (augmented.some(entry => entry.asset_id === key)) {
				continue;
			}
			augmented.push({ path: `atlas/${key}`, type: 'atlas', asset_id: key });
		}
		ide_state.resourceCatalog = augmented.map((descriptor) => {
			const displayPathSource = descriptor.path.length > 0 ? descriptor.path : (descriptor.asset_id ?? '');
			const displayPath = displayPathSource.length > 0 ? displayPathSource : '<unnamed>';
			const typeLabel = descriptor.type ? descriptor.type.toUpperCase() : '';
			const assetLabel = descriptor.asset_id && descriptor.asset_id !== displayPath ? descriptor.asset_id : null;
			const searchKey = [displayPath, descriptor.asset_id ?? '', descriptor.type ?? '']
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
		ide_state.resourceCatalog.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
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
		return;
	}
	const tokens = query.split(/\s+/).filter(token => token.length > 0);
	const matches = ide_state.resourceCatalog
		.filter((entry) => {
			for (const token of tokens) {
				if (entry.searchKey.indexOf(token) === -1) {
					return false;
				}
			}
			return true;
		})
		.map((entry) => {
			let matchIndex = Number.POSITIVE_INFINITY;
			for (const token of tokens) {
				const index = entry.searchKey.indexOf(token);
				if (index < matchIndex) {
					matchIndex = index;
				}
			}
			return { entry, matchIndex };
		});
	if (matches.length === 0) {
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
	ide_state.resourceSearchSelectionIndex = 0;
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

export function buildProjectReferenceContext(context: CodeTabContext): { environment: ProjectReferenceEnvironment; path: string; } {
	const path = context.descriptor.path;
	const environment: ProjectReferenceEnvironment = {
		activeContext: context,
		activeLines: splitText(getTextSnapshot(ide_state.buffer)),
		codeTabContexts: Array.from(ide_state.codeTabContexts.values()),
	};
	return { environment, path, };
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
			runtimeIde.deactivateEditor(Runtime.instance);
			return true;
		case 'theme-toggle':
			toggleThemeMode();
			return true;
		default:
			return false;
	}
}

export function performHotReloadAndResume(): boolean {
	const runtime = Runtime.instance;
	const targetGeneration = ide_state.saveGeneration;
	const shouldUpdateGeneration = hasPendingRuntimeReload();
	clearExecutionStopHighlights();
	runtimeIde.deactivateEditor(Runtime.instance);
	console.log('[IDE] Performing hot-reload and resume');
	scheduleRuntimeTask(async () => {
		console.log('[IDE] Applying workspace overrides to cart before resume');
		await applyWorkspaceOverridesToCart({ cart: $.lua_sources, storage: $.platform.storage, includeServer: true });
		console.log('[IDE] Capturing runtime snapshot for resume');
		const snapshot = runtimeLuaPipeline.captureCurrentState(runtime);
		console.log('[IDE] Clear execution stop highlights before resume');
		runtimeIde.clearFaultState(runtime);
		console.log('[IDE] Resuming from snapshot after hot reload');
		await runtimeLuaPipeline.resumeFromSnapshot(runtime, snapshot);
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
	const runtime = Runtime.instance;
	const requiresReload = hasPendingRuntimeReload();
	const targetGeneration = ide_state.saveGeneration;
	clearExecutionStopHighlights();
	runtimeIde.deactivateEditor(Runtime.instance);
	scheduleRuntimeTask(async () => {
		if (requiresReload) {
			console.info('[IDE] Performing full program reload for reboot');
			await runtimeLuaPipeline.reloadProgramAndResetWorld(runtime, { runInit: true }); // Was false, but it makes no sense to skip init on reboot
		}
		else {
			console.info('[IDE] Performing standard reboot');
			await runtimeLuaPipeline.reloadProgramAndResetWorld(runtime, { runInit: true });
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
	runtimeIde.activateEditor(Runtime.instance);
	const message = `${fallbackMessage}: ${errormsg}`;
	Runtime.instance.terminal.appendStderr(message);
	ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 2.0);
}
