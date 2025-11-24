import { ide_state } from './ide_state';
import type {
	CodeTabContext,
	EditorTabDescriptor,
	EditorTabKind,
} from './types';
import type { ConsoleResourceDescriptor } from '../types';
import * as constants from './constants';
import { clamp } from '../../utils/clamp';
import {
	captureSnapshot,
	restoreSnapshot,
	syncRuntimeErrorOverlayFromContext,
	invalidateAllHighlights,
	updateDesiredColumn,
	ensureCursorVisible,
	refreshActiveDiagnostics,
	resolveHoverChunkName,
	invalidateVisualLines,
	markDiagnosticsDirty,
	bumpTextVersion,
	findResourceDescriptorByasset_id,
	beginNavigationCapture,
	completeNavigation,
	closeSymbolSearch,
	hideResourcePanel,
	enterResourceViewer,
	normalizeChunkReference,
	getTabBarTotalHeight,
	resetPointerClickTracking,
	resetEditorContent,
	measureText,
} from './console_cart_editor';
import { resetBlink } from './render_caret';
import { splitLines } from './text_utils';

export function createEntryTabContext(): CodeTabContext | null {
	const asset_id = (typeof ide_state.primaryasset_id === 'string' && ide_state.primaryasset_id.length > 0)
		? ide_state.primaryasset_id
		: null;
	const descriptor = asset_id ? findResourceDescriptorByasset_id(asset_id) : null;
	const resolvedasset_id = descriptor ? descriptor.asset_id : (asset_id ?? '__entry__');
	const tabId: string = `lua:${resolvedasset_id}`;
	const title = descriptor
		? computeResourceTabTitle(descriptor)
		: (asset_id ?? ide_state.metadata.title ?? 'ENTRY').toUpperCase();
	const load = descriptor
		? () => ide_state.loadLuaResourceFn(descriptor.asset_id)
		: () => ide_state.loadSourceFn();
	const save = descriptor
		? (source: string) => ide_state.saveLuaResourceFn(descriptor.asset_id, source)
		: (source: string) => ide_state.saveSourceFn(source);
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
		id: `lua:${descriptor.asset_id}`,
		title,
		descriptor,
		load: () => ide_state.loadLuaResourceFn(descriptor.asset_id),
		save: (source: string) => ide_state.saveLuaResourceFn(descriptor.asset_id, source),
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
	if (!ide_state.activeCodeTabContextId) {
		return null;
	}
	return ide_state.codeTabContexts.get(ide_state.activeCodeTabContextId) ?? null;
}

export function storeActiveCodeTabContext(): void {
	const context = getActiveCodeTabContext();
	if (!context) {
		return;
	}
	context.snapshot = captureSnapshot();
	if (ide_state.entryTabId && context.id === ide_state.entryTabId) {
		context.lastSavedSource = ide_state.lastSavedSource;
	}
	context.saveGeneration = ide_state.saveGeneration;
	context.appliedGeneration = ide_state.appliedGeneration;
	context.dirty = ide_state.dirty;
	context.runtimeErrorOverlay = ide_state.runtimeErrorOverlay;
	context.executionStopRow = ide_state.executionStopRow;
	setTabDirty(context.id, context.dirty);
}

export function activateCodeEditorTab(tabId: string | null): void {
	if (!tabId) {
		return;
	}
	let context = ide_state.codeTabContexts.get(tabId);
	if (!context) {
		if (ide_state.entryTabId && tabId === ide_state.entryTabId) {
			const recreated = createEntryTabContext();
			if (!recreated || recreated.id !== tabId) {
				return;
			}
			context = recreated;
			ide_state.entryTabId = context.id;
			ide_state.codeTabContexts.set(tabId, context);
		} else {
			return;
		}
	}
	ide_state.activeCodeTabContextId = tabId;
	ide_state.activeContextReadOnly = context.readOnly === true;
	const isEntry = ide_state.entryTabId !== null && context.id === ide_state.entryTabId;
	if (context.snapshot) {
		restoreSnapshot(context.snapshot);
		ide_state.saveGeneration = context.saveGeneration;
		ide_state.appliedGeneration = context.appliedGeneration;
		if (isEntry) {
			ide_state.lastSavedSource = context.lastSavedSource;
		}
		context.dirty = ide_state.dirty;
		setTabDirty(context.id, context.dirty);
		syncRuntimeErrorOverlayFromContext(context);
		invalidateAllHighlights();
		updateDesiredColumn();
		ensureCursorVisible();
		refreshActiveDiagnostics();
		const chunkNameSnapshot = resolveHoverChunkName(context) ?? '<console>';
		ide_state.layout.forceSemanticUpdate(ide_state.lines, ide_state.textVersion, chunkNameSnapshot);
		return;
	}
	const source = context.load();
	context.lastSavedSource = source;
	ide_state.lines = splitLines(source);
	invalidateVisualLines();
	markDiagnosticsDirty();
	if (ide_state.lines.length === 0) {
		ide_state.lines.push('');
	}
	invalidateAllHighlights();
	ide_state.cursorRow = 0;
	ide_state.cursorColumn = 0;
	ide_state.scrollRow = 0;
	ide_state.scrollColumn = 0;
	ide_state.selectionAnchor = null;
	ide_state.dirty = false;
	context.dirty = false;
	context.runtimeErrorOverlay = null;
	context.executionStopRow = null;
	ide_state.executionStopRow = null;
	ide_state.saveGeneration = context.saveGeneration;
	ide_state.appliedGeneration = context.appliedGeneration;
	if (isEntry) {
		ide_state.lastSavedSource = context.lastSavedSource;
	}
	setTabDirty(context.id, context.dirty);
	syncRuntimeErrorOverlayFromContext(context);
	bumpTextVersion();
	const chunkName = resolveHoverChunkName(context) ?? '<console>';
	ide_state.layout.forceSemanticUpdate(ide_state.lines, ide_state.textVersion, chunkName);
	updateDesiredColumn();
	resetBlink();
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	refreshActiveDiagnostics();
}

export function initializeTabs(entryContext: CodeTabContext | null = null): void {
	ide_state.tabs = [];
	ide_state.tabHoverId = null;
	ide_state.tabDragState = null;
	ide_state.tabButtonBounds.clear();
	ide_state.tabCloseButtonBounds.clear();
	if (entryContext) {
		ide_state.tabs.push({
			id: entryContext.id,
			kind: 'lua_editor',
			title: entryContext.title,
			closable: true,
			dirty: entryContext.dirty,
		});
		ide_state.activeTabId = entryContext.id;
		ide_state.activeCodeTabContextId = entryContext.id;
		return;
	}
	ide_state.activeTabId = null;
	ide_state.activeCodeTabContextId = null;
	ide_state.activeContextReadOnly = false;
}

export function setTabDirty(tabId: string, dirty: boolean): void {
	const tab = ide_state.tabs.find(candidate => candidate.id === tabId);
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
	context.dirty = ide_state.dirty;
	setTabDirty(context.id, context.dirty);
}

export function getActiveTabKind(): EditorTabKind {
	if (!ide_state.activeTabId) {
		return 'lua_editor';
	}
	const active = ide_state.tabs.find(tab => tab.id === ide_state.activeTabId) ?? null;
	if (active) {
		return active.kind;
	}
	if (ide_state.tabs.length > 0) {
		const first = ide_state.tabs[0];
		ide_state.activeTabId = first.id;
		return first.kind;
	}
	ide_state.activeTabId = null;
	return 'lua_editor';
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
	const tab = ide_state.tabs.find(candidate => candidate.id === tabId);
	if (!tab) {
		return;
	}
	const navigationCheckpoint = tab.kind === 'lua_editor' && tabId !== ide_state.activeTabId
		? beginNavigationCapture()
		: null;
	closeSymbolSearch(true);
	const previousKind = getActiveTabKind();
	if (previousKind === 'lua_editor') {
		storeActiveCodeTabContext();
	}
	if (ide_state.activeTabId === tabId) {
		if (tab.kind === 'resource_view') {
			ide_state.activeContextReadOnly = false;
			enterResourceViewer(tab);
			ide_state.runtimeErrorOverlay = null;
		} else if (tab.kind === 'lua_editor') {
			activateCodeEditorTab(tab.id);
			if (navigationCheckpoint) {
				completeNavigation(navigationCheckpoint);
			}
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
	const codeTab = ide_state.tabs.find(candidate => candidate.kind === 'lua_editor');
	if (codeTab) {
		setActiveTab(codeTab.id);
		return;
	}
	if (ide_state.entryTabId) {
		let context = ide_state.codeTabContexts.get(ide_state.entryTabId);
		if (!context) {
			context = createEntryTabContext();
			if (!context) {
				return;
			}
			ide_state.entryTabId = context.id;
			ide_state.codeTabContexts.set(context.id, context);
		}
		let entryTab = ide_state.tabs.find(candidate => candidate.id === context.id);
		if (!entryTab) {
			entryTab = {
				id: context.id,
				kind: 'lua_editor',
				title: context.title,
				closable: true,
				dirty: context.dirty,
				resource: undefined,
			};
			ide_state.tabs.unshift(entryTab);
		}
		setActiveTab(context.id);
	}
}

export function closeTab(tabId: string): void {
	const index = ide_state.tabs.findIndex(tab => tab.id === tabId);
	if (index === -1) {
		return;
	}
	if (ide_state.tabDragState && ide_state.tabDragState.tabId === tabId) {
		endTabDrag();
	}
	const tab = ide_state.tabs[index];
	if (!tab.closable) {
		return;
	}
	const wasActiveContext = tab.kind === 'lua_editor' && ide_state.activeCodeTabContextId === tab.id;
	if (wasActiveContext) {
		storeActiveCodeTabContext();
	}
	ide_state.tabs.splice(index, 1);
	if (tab.kind === 'lua_editor') {
		if (ide_state.activeCodeTabContextId === tab.id) {
			ide_state.activeCodeTabContextId = null;
		}
		ide_state.dirtyDiagnosticContexts.delete(tab.id);
		ide_state.diagnosticsCache.delete(tab.id);
	}
	if (ide_state.activeTabId === tabId) {
		const fallback = ide_state.tabs[index - 1] ?? ide_state.tabs[0];
		if (fallback) {
			setActiveTab(fallback.id);
		} else {
			ide_state.activeTabId = null;
			ide_state.activeCodeTabContextId = null;
			resetEditorContent();
		}
	}
}

export function cycleTab(direction: number): void {
	if (ide_state.tabs.length <= 1 || direction === 0) {
		return;
	}
	const count = ide_state.tabs.length;
	let currentIndex = ide_state.tabs.findIndex(tab => tab.id === ide_state.activeTabId);
	if (currentIndex === -1) {
		const fallbackIndex = direction > 0 ? 0 : count - 1;
		const fallback = ide_state.tabs[fallbackIndex];
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
		const bounds = ide_state.tabButtonBounds.get(tab.id) ?? null;
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
	const bounds = ide_state.tabButtonBounds.get(tabId) ?? null;
	const pointerOffset = bounds ? pointerX - bounds.left : 0;
	ide_state.tabDragState = {
		tabId,
		pointerOffset,
		startX: pointerX,
		hasDragged: false,
	};
}

export function updateTabDrag(pointerX: number, pointerY: number): void {
	const state = ide_state.tabDragState;
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
	if (tabIndex === -1) {
		return;
	}
	const removed = ide_state.tabs.splice(tabIndex, 1);
	const tab = removed[0];
	if (!tab) {
		return;
	}
	const targetIndex = clamp(desiredIndex, 0, ide_state.tabs.length);
	ide_state.tabs.splice(targetIndex, 0, tab);
}

export function endTabDrag(): void {
	if (!ide_state.tabDragState) {
		return;
	}
	ide_state.tabDragState = null;
}

export function findCodeTabContext(asset_id: string | null, chunkName: string | null): CodeTabContext | null {
	const normalizedChunk = normalizeChunkReference(chunkName);
	for (const context of ide_state.codeTabContexts.values()) {
		const descriptor = context.descriptor;
		if (asset_id && descriptor && descriptor.asset_id === asset_id) {
			return context;
		}
		if (!asset_id && normalizedChunk && descriptor) {
			const descriptorPath = normalizeChunkReference(descriptor.path);
			if (descriptorPath && descriptorPath === normalizedChunk) {
				return context;
			}
		}
	}
	if (!ide_state.entryTabId) {
		return null;
	}
	const entry = ide_state.codeTabContexts.get(ide_state.entryTabId);
	if (entry && !asset_id && normalizedChunk) {
		// Entry script might match if it's the main file
		// But usually entry script is anonymous or has special handling
	}
	return null;
}

export function computeResourceTabTitle(descriptor: ConsoleResourceDescriptor): string {
	const normalized = descriptor.path.replace(/\\/g, '/');
	const parts = normalized.split('/').filter(part => part.length > 0);
	if (parts.length > 0) {
		return parts[parts.length - 1];
	}
	if (descriptor.asset_id && descriptor.asset_id.length > 0) {
		return descriptor.asset_id;
	}
	return descriptor.type.toUpperCase();
}
