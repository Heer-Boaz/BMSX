import { ide_state } from './ide_state';
import type {
	CodeTabContext,
	EditorTabDescriptor,
	EditorTabKind,
} from './types';
import type { VMResourceDescriptor } from '../types';
import * as constants from './constants';
import { clamp } from '../../utils/clamp';
import {
	syncRuntimeErrorOverlayFromContext,
	updateDesiredColumn,
	refreshActiveDiagnostics,
	beginNavigationCapture,
	completeNavigation,
	closeSymbolSearch,
	hideResourcePanel,
	enterResourceViewer,
	getTabBarTotalHeight,
	resetPointerClickTracking,
} from './vm_cart_editor';
import { markDiagnosticsDirty } from './diagnostics';
import { measureText } from './text_utils';
import { requestSemanticRefresh } from './intellisense';
import { resetBlink } from './render/render_caret';
import { listResources } from '../workspace';
import { BmsxVMRuntime } from '../vm_runtime';
import { $ } from '../../core/engine_core';
import { PieceTreeBuffer } from './piece_tree_buffer';

function resolvePath(descriptor: VMResourceDescriptor): string {
	return descriptor.path;
}

function resolveSource(descriptor: VMResourceDescriptor): string {
	const runtime = BmsxVMRuntime.instance;
	const path = resolvePath(descriptor);
	return runtime.resourceSourceForChunk(path);
}

export function createEntryTabContext(): CodeTabContext {
	const luaDescriptors = listResources().filter(r => r.type === 'lua');
	const descriptor = luaDescriptors.find(r => r.path === $.luaSources.entry_path)!;
	return createLuaCodeTabContext(descriptor);
}

export function createLuaCodeTabContext(descriptor: VMResourceDescriptor): CodeTabContext {
	const title = computeResourceTabTitle(descriptor);
	const initialSource = resolveSource(descriptor);
	const buffer = new PieceTreeBuffer(initialSource);
	return {
		id: `lua:${descriptor.path}`,
		title,
		descriptor,
		buffer,
		cursorRow: 0,
		cursorColumn: 0,
		scrollRow: 0,
		scrollColumn: 0,
		selectionAnchor: null,
		lastSavedSource: initialSource,
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
		readOnly: descriptor.readOnly === true,
		textVersion: buffer.version,
	};
}

export function getActiveCodeTabContext(): CodeTabContext {
	return ide_state.codeTabContexts.get(ide_state.activeCodeTabContextId)!;
}

export function storeActiveCodeTabContext(): void {
	const context = getActiveCodeTabContext();
	context.buffer = ide_state.buffer;
	context.cursorRow = ide_state.cursorRow;
	context.cursorColumn = ide_state.cursorColumn;
	context.scrollRow = ide_state.scrollRow;
	context.scrollColumn = ide_state.scrollColumn;
	context.selectionAnchor = ide_state.selectionAnchor;
	context.textVersion = ide_state.textVersion;
	context.saveGeneration = ide_state.saveGeneration;
	context.appliedGeneration = ide_state.appliedGeneration;
	context.undoStack = ide_state.undoStack;
	context.redoStack = ide_state.redoStack;
	context.lastHistoryKey = ide_state.lastHistoryKey;
	context.lastHistoryTimestamp = ide_state.lastHistoryTimestamp;
	context.savePointDepth = ide_state.savePointDepth;
	context.dirty = ide_state.dirty;
	context.runtimeErrorOverlay = ide_state.runtimeErrorOverlay;
	context.executionStopRow = ide_state.executionStopRow;
	setTabDirty(context.id, context.dirty);
}

export function activateCodeEditorTab(tabId: string): void {
	const context = ide_state.codeTabContexts.get(tabId)!;
	ide_state.activeCodeTabContextId = tabId;
	ide_state.activeContextReadOnly = context.readOnly === true;
	ide_state.undoStack = context.undoStack;
	ide_state.redoStack = context.redoStack;
	ide_state.lastHistoryKey = context.lastHistoryKey;
	ide_state.lastHistoryTimestamp = context.lastHistoryTimestamp;
	ide_state.savePointDepth = context.savePointDepth;
	ide_state.buffer = context.buffer;
	ide_state.cursorRow = context.cursorRow;
	ide_state.cursorColumn = context.cursorColumn;
	ide_state.scrollRow = context.scrollRow;
	ide_state.scrollColumn = context.scrollColumn;
	ide_state.selectionAnchor = context.selectionAnchor;
	ide_state.textVersion = ide_state.buffer.version;
	context.textVersion = ide_state.textVersion;

	ide_state.maxLineLengthDirty = true;
	ide_state.layout.markVisualLinesDirty();
	ide_state.layout.invalidateAllHighlights();

	const cached = ide_state.diagnosticsCache.get(context.id);
	const cachedVersion = cached?.version ?? -1;
	const cachedChunk = cached?.path ?? null;
	const path = resolvePath(context.descriptor);
	if (!cached || cachedVersion !== ide_state.textVersion || cachedChunk !== path) {
		markDiagnosticsDirty(context.id);
	}

	ide_state.dirty = ide_state.undoStack.length !== ide_state.savePointDepth;
	ide_state.saveGeneration = context.saveGeneration;
	ide_state.appliedGeneration = context.appliedGeneration;
	ide_state.lastSavedSource = context.lastSavedSource;
	context.dirty = ide_state.dirty;
	setTabDirty(context.id, context.dirty);
	syncRuntimeErrorOverlayFromContext(context);
	requestSemanticRefresh(context);
	updateDesiredColumn();
	resetBlink();
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	refreshActiveDiagnostics();
}

export function initializeTabs(initialContext: CodeTabContext = null): void {
	ide_state.tabs = [];
	ide_state.tabHoverId = null;
	ide_state.tabDragState = null;
	ide_state.tabButtonBounds.clear();
	ide_state.tabCloseButtonBounds.clear();
	const context = initialContext ?? createEntryTabContext();
	ide_state.codeTabContexts.set(context.id, context);
	ide_state.tabs.push({
		id: context.id,
		kind: 'lua_editor',
		title: context.title,
		closable: true,
		dirty: context.dirty,
	});
	ide_state.activeTabId = context.id;
	ide_state.activeCodeTabContextId = context.id;
	activateCodeEditorTab(context.id);
}

export function setTabDirty(tabId: string, dirty: boolean): void {
	const tab = ide_state.tabs.find(candidate => candidate.id === tabId)!;
	tab.dirty = dirty;
}

export function updateActiveContextDirtyFlag(): void {
	const context = getActiveCodeTabContext();
	context.dirty = ide_state.dirty;
	setTabDirty(context.id, context.dirty);
}

export function getActiveTabKind(): EditorTabKind {
	const active = ide_state.tabs.find(tab => tab.id === ide_state.activeTabId)!;
	return active.kind;
}

export function isCodeTabActive(): boolean {
	return getActiveTabKind() === 'lua_editor';
}

export function isReadOnlyCodeTab(): boolean {
	return isCodeTabActive() && ide_state.activeContextReadOnly === true;
}

export function isEditableCodeTab(): boolean {
	return isCodeTabActive() && ide_state.activeContextReadOnly !== true;
}

export function isResourceViewActive(): boolean {
	return getActiveTabKind() === 'resource_view';
}

export function setActiveTab(tabId: string): void {
	const tab = ide_state.tabs.find(candidate => candidate.id === tabId)!;
	const isSameTab = ide_state.activeTabId === tabId;
	const navigationCheckpoint = !isSameTab && tab.kind === 'lua_editor'
		? beginNavigationCapture()
		: null;
	closeSymbolSearch(true);
	if (!isSameTab && getActiveTabKind() === 'lua_editor') {
		storeActiveCodeTabContext();
	}
	if (isSameTab) {
		if (tab.kind === 'resource_view') {
			ide_state.activeContextReadOnly = false;
			enterResourceViewer(tab);
			ide_state.runtimeErrorOverlay = null;
		}
		return;
	}
	ide_state.activeTabId = tabId;
	if (tab.kind === 'resource_view') {
		ide_state.activeContextReadOnly = false;
		enterResourceViewer(tab);
		ide_state.runtimeErrorOverlay = null;
		return;
	}
	if (tab.kind === 'lua_editor') {
		hideResourcePanel();
		activateCodeEditorTab(tab.id);
		if (navigationCheckpoint) {
			completeNavigation(navigationCheckpoint);
		}
	}
}

export function activateCodeTab(): void {
	const codeTab = ide_state.tabs.find(candidate => candidate.kind === 'lua_editor')!;
	setActiveTab(codeTab.id);
}

export function closeTab(tabId: string): void {
	const index = ide_state.tabs.findIndex(tab => tab.id === tabId);
	const tab = ide_state.tabs[index];
	if (!tab.closable) {
		return;
	}
	if (ide_state.tabDragState && ide_state.tabDragState.tabId === tabId) {
		endTabDrag();
	}
	const isActive = ide_state.activeTabId === tabId;
	if (isActive && ide_state.tabs.length > 1) {
		const fallback = ide_state.tabs[index - 1] ?? ide_state.tabs[index + 1];
		setActiveTab(fallback.id);
	} else if (isActive && tab.kind === 'lua_editor') {
		storeActiveCodeTabContext();
	}
	ide_state.tabs.splice(index, 1);
	if (tab.kind === 'lua_editor') {
		ide_state.dirtyDiagnosticContexts.delete(tab.id);
		ide_state.diagnosticsCache.delete(tab.id);
	}
	if (ide_state.tabs.length === 0) {
		initializeTabs();
	}
}

export function cycleTab(direction: number): void {
	if (ide_state.tabs.length <= 1 || direction === 0) {
		return;
	}
	const count = ide_state.tabs.length;
	const currentIndex = ide_state.tabs.findIndex(tab => tab.id === ide_state.activeTabId);
	let nextIndex = currentIndex + direction;
	nextIndex = ((nextIndex % count) + count) % count;
	if (nextIndex === currentIndex) {
		return;
	}
	const target = ide_state.tabs[nextIndex];
	setActiveTab(target.id);
}

export function measureTabWidth(tab: EditorTabDescriptor): number {
	const textWidth = measureText(tab.title);
	let indicatorWidth = 0;
	if (tab.closable) {
		indicatorWidth = measureText(constants.TAB_CLOSE_BUTTON_SYMBOL) + constants.TAB_CLOSE_BUTTON_PADDING_X * 2;
	} else if (tab.dirty) {
		indicatorWidth = constants.TAB_DIRTY_MARKER_METRICS.width + constants.TAB_DIRTY_MARKER_SPACING;
	}
	return textWidth + constants.TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
}

export function computeTabLayout(): Array<{ id: string; left: number; right: number; width: number; center: number; rowIndex: number }> {
	const layout: Array<{ id: string; left: number; right: number; width: number; center: number; rowIndex: number }> = [];
	for (let index = 0; index < ide_state.tabs.length; index += 1) {
		const tab = ide_state.tabs[index];
		const bounds = ide_state.tabButtonBounds.get(tab.id) ;
		if (bounds) {
			const left = bounds.left;
			const right = bounds.right;
			const width = Math.max(0, right - left);
			const rowIndex = Math.max(0, Math.floor((bounds.top - ide_state.headerHeight) / ide_state.tabBarHeight));
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
	if (ide_state.tabs.length <= 1) {
		ide_state.tabDragState = null;
		return;
	}
	const bounds = ide_state.tabButtonBounds.get(tabId) ;
	const pointerOffset = bounds ? pointerX - bounds.left : 0;
	ide_state.tabDragState = {
		tabId,
		pointerOffset,
		startX: pointerX,
		hasDragged: false,
	};
}

export function updateTabDrag(pointerX: number, pointerY: number): void {
	const state = ide_state.tabDragState!;
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
	const dragged = layout[currentIndex];
	const pointerLeft = pointerX - state.pointerOffset;
	const pointerCenter = pointerLeft + Math.max(dragged.width, 1) * 0.5;
	const totalTabHeight = getTabBarTotalHeight();
	const withinTabBar = pointerY >= ide_state.headerHeight && pointerY < ide_state.headerHeight + totalTabHeight;
	const maxRowIndex = Math.max(0, ide_state.tabBarRowCount - 1);
	const pointerRow = withinTabBar
		? clamp(Math.floor((pointerY - ide_state.headerHeight) / ide_state.tabBarHeight), 0, maxRowIndex)
		: dragged.rowIndex;
	const rowStride = ide_state.viewportWidth + constants.TAB_BUTTON_SPACING * 4;
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
	const tabIndex = ide_state.tabs.findIndex(entry => entry.id === state.tabId);
	const removed = ide_state.tabs.splice(tabIndex, 1);
	const tab = removed[0];
	const targetIndex = clamp(desiredIndex, 0, ide_state.tabs.length);
	ide_state.tabs.splice(targetIndex, 0, tab);
}

export function endTabDrag(): void {
	ide_state.tabDragState = null;
}

export function findCodeTabContext(path: string): CodeTabContext {
	for (const context of ide_state.codeTabContexts.values()) {
		const descriptor = context.descriptor;
		if (descriptor.path === path) {
			return context;
		}
	}
	return null;
}

export function computeResourceTabTitle(descriptor: VMResourceDescriptor): string {
	const parts = descriptor.path.split('/').filter(part => part.length > 0);
	if (parts.length > 0) {
		return parts[parts.length - 1];
	}
	return descriptor.type.toUpperCase();
}
