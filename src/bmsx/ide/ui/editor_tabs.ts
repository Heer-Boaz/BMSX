import { editorRuntimeState } from '../core/editor_runtime_state';
import { showEditorMessage,showEditorWarningBanner } from '../core/editor_feedback_state';
import { editorDocumentState, restoreDocumentStateFromContext, storeDocumentStateInContext } from '../editing/editor_document_state';
import { editorChromeState } from './editor_chrome_state';
import { editorDiagnosticsState } from '../contrib/problems/diagnostics_state';
import { editorSessionState } from './editor_session_state';
import { editorViewState } from './editor_view_state';
import type {
	CodeTabContext,
	CodeTabMode,
	EditorTabId,
	EditorTabDescriptor,
	EditorTabKind,
	EditorRuntimeSyncState,
} from '../core/types';
import type { ResourceDescriptor } from '../core/types';
import * as constants from '../core/constants';
import { clamp } from '../../utils/clamp';
import { syncRuntimeErrorOverlayFromContext } from '../contrib/runtime_error/runtime_error_navigation';
import { updateDesiredColumn, ensureCursorVisible } from './caret';
import { refreshActiveDiagnostics } from '../contrib/problems/diagnostics_controller';
import { beginNavigationCapture, completeNavigation } from '../navigation/navigation_history';
import { closeLineJump } from '../contrib/find/line_jump';
import { closeSymbolSearch } from '../contrib/symbols/symbol_search_shared';
import { getCodeAreaBounds, hideResourcePanel, getTabBarTotalHeight, selectResourceInPanel } from './editor_view';
import { markDiagnosticsDirty, markAllDiagnosticsDirty } from '../contrib/problems/diagnostics';
import { closeSearch } from '../contrib/find/editor_search';
import { clampResourceViewerScroll, openResourceViewerTab } from '../contrib/resources/resource_viewer';
import { measureText, bumpTextVersion, invalidateLuaCommentContextFromRow } from '../core/text_utils';
import { requestSemanticRefresh } from '../contrib/intellisense/intellisense';
import { resetBlink } from '../render/render_caret';
import { Runtime } from '../../emulator/runtime';
import * as runtimeIde from '../../emulator/runtime_ide';
import * as runtimeLuaPipeline from '../../emulator/runtime_lua_pipeline';
import { getTextSnapshot } from '../text/source_text';
import { PieceTreeBuffer } from '../text/piece_tree_buffer';
import { listResources, saveLuaResourceSource } from '../../emulator/workspace';
import { buildDirtyFilePath } from '../core/workspace_storage';
import { setWorkspaceCachedSources } from '../../emulator/workspace_cache';
import { breakUndoSequence } from '../editing/undo_controller';
import { resourcePanel } from '../contrib/resources/resource_panel_controller';
import { tryShowLuaErrorOverlay } from '../contrib/runtime_error/runtime_error_navigation';
import { extractErrorMessage } from '../../lua/luavalue';
import { closeResourceSearch } from '../contrib/resources/resource_search';
import { findResourceDescriptorForChunk } from '../contrib/resources/resource_lookup';
import { applyAemSourceToRuntime, listAemResourceDescriptors, loadAemResourceSource, saveAemResourceSource } from '../language/aem/aem_editor';
import { editorPointerState, resetPointerClickTracking } from '../input/pointer/editor_pointer_state';
import { runtimeErrorState } from '../contrib/runtime_error/runtime_error_state';
import { editorCaretState } from './caret_state';

function resolvePath(descriptor: ResourceDescriptor): string {
	return descriptor.path;
}

function resolveLuaSource(descriptor: ResourceDescriptor): string {
	const runtime = Runtime.instance;
	const path = resolvePath(descriptor);
	return runtimeLuaPipeline.resourceSourceForChunk(runtime, path);
}

function buildCodeTabId(descriptor: ResourceDescriptor): EditorTabId {
	return `code:${descriptor.path}`;
}

function setTabRuntimeSyncState(tabId: string, runtimeSyncState: EditorRuntimeSyncState, runtimeSyncMessage: string): void {
	const tab = editorSessionState.tabs.find(candidate => candidate.id === tabId);
	if (!tab) {
		return;
	}
	tab.runtimeSyncState = runtimeSyncState;
	tab.runtimeSyncMessage = runtimeSyncMessage;
}

function setContextRuntimeSyncState(context: CodeTabContext, runtimeSyncState: EditorRuntimeSyncState, runtimeSyncMessage: string): void {
	context.runtimeSyncState = runtimeSyncState;
	context.runtimeSyncMessage = runtimeSyncMessage;
	setTabRuntimeSyncState(context.id, runtimeSyncState, runtimeSyncMessage);
}

function createCodeTabContext(descriptor: ResourceDescriptor, initialSource: string, mode: CodeTabMode): CodeTabContext {
	const title = computeResourceTabTitle(descriptor);
	const buffer = new PieceTreeBuffer(initialSource);
	return {
		id: buildCodeTabId(descriptor),
		title,
		descriptor,
		mode,
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
		runtimeSyncState: 'synced',
		runtimeSyncMessage: null,
		readOnly: descriptor.readOnly === true,
		textVersion: buffer.version,
	};
}

function upsertCodeEditorTab(context: CodeTabContext): EditorTabDescriptor {
	let tab = editorSessionState.tabs.find(candidate => candidate.id === context.id);
	if (!tab) {
		tab = {
			id: context.id,
			kind: 'code_editor',
			title: '',
			closable: true,
			dirty: false,
		};
		editorSessionState.tabs.push(tab);
	}
	tab.kind = 'code_editor';
	tab.title = context.title;
	tab.dirty = context.dirty;
	tab.runtimeSyncState = context.runtimeSyncState;
	tab.runtimeSyncMessage = context.runtimeSyncMessage;
	tab.resource = undefined;
	return tab;
}

function setCodeTabDiagnosticsState(context: CodeTabContext): void {
	if (context.mode === 'lua') {
		const cached = editorDiagnosticsState.diagnosticsCache.get(context.id);
		const cachedVersion = cached?.version ?? -1;
		const cachedChunk = cached?.path;
		const path = resolvePath(context.descriptor);
		if (!cached || cachedVersion !== editorDocumentState.textVersion || cachedChunk !== path) {
			markDiagnosticsDirty(context.id);
		}
		return;
	}
	editorDiagnosticsState.dirtyDiagnosticContexts.delete(context.id);
	editorDiagnosticsState.diagnosticsCache.set(context.id, {
		contextId: context.id,
		path: context.descriptor.path,
		diagnostics: [],
		version: editorDocumentState.textVersion,
		source: getTextSnapshot(editorDocumentState.buffer),
	});
}

function activateResourceViewerTab(tab: EditorTabDescriptor): void {
	closeSearch(false, true);
	closeLineJump(false);
	editorCaretState.cursorRevealSuspended = false;
	tab.dirty = false;
	if (!tab.resource) {
		return;
	}
	clampResourceViewerScroll(tab.resource, getCodeAreaBounds(), editorViewState.lineHeight);
}

export function createEntryTabContext(): CodeTabContext {
	const runtime = Runtime.instance;
	const luaDescriptors = listResources().filter(r => r.type === 'lua');
	const preferredRegistry = runtimeLuaPipeline.listLuaSourceRegistries(runtime)[0].registry;
	const descriptor = luaDescriptors.find(r => r.path === preferredRegistry.entry_path)!;
	return createLuaCodeTabContext(descriptor);
}

export function createLuaCodeTabContext(descriptor: ResourceDescriptor): CodeTabContext {
	return createCodeTabContext(descriptor, resolveLuaSource(descriptor), 'lua');
}

function createAemCodeTabContext(descriptor: ResourceDescriptor, source: string): CodeTabContext {
	return createCodeTabContext(descriptor, source, 'aem');
}

export function getActiveCodeTabContext(): CodeTabContext {
	return editorSessionState.codeTabContexts.get(editorSessionState.activeCodeTabContextId)!;
}

export function storeActiveCodeTabContext(): void {
	const context = getActiveCodeTabContext();
	storeDocumentStateInContext(context);
	context.scrollRow = editorViewState.scrollRow;
	context.scrollColumn = editorViewState.scrollColumn;
	context.runtimeErrorOverlay = runtimeErrorState.activeOverlay;
	context.executionStopRow = runtimeErrorState.executionStopRow;
	setTabDirty(context.id, context.dirty);
	setTabRuntimeSyncState(context.id, context.runtimeSyncState, context.runtimeSyncMessage);
}

export function activateCodeEditorTab(tabId: string): void {
	const context = editorSessionState.codeTabContexts.get(tabId)!;
	editorSessionState.activeCodeTabContextId = tabId;
	editorSessionState.activeContextReadOnly = context.readOnly === true;
	restoreDocumentStateFromContext(context);
	editorViewState.scrollRow = context.scrollRow;
	editorViewState.scrollColumn = context.scrollColumn;

	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.setCodeTabMode(context.mode);
	editorViewState.layout.markVisualLinesDirty();
	editorViewState.layout.invalidateAllHighlights();
	setCodeTabDiagnosticsState(context);

	context.dirty = editorDocumentState.dirty;
	setTabDirty(context.id, context.dirty);
	syncRuntimeErrorOverlayFromContext(context);
	requestSemanticRefresh(context);
	updateDesiredColumn();
	resetBlink();
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	refreshActiveDiagnostics();
}

export function initializeTabs(initialContext: CodeTabContext = null): void {
	editorSessionState.tabs = [];
	editorPointerState.tabHoverId = null;
	editorPointerState.tabDragState = null;
	editorChromeState.tabButtonBounds.clear();
	editorChromeState.tabCloseButtonBounds.clear();
	const context = initialContext ?? createEntryTabContext();
	editorSessionState.codeTabContexts.set(context.id, context);
	upsertCodeEditorTab(context);
	editorSessionState.activeTabId = context.id;
	editorSessionState.activeCodeTabContextId = context.id;
	activateCodeEditorTab(context.id);
}

export function setTabDirty(tabId: string, dirty: boolean): void {
	const tab = editorSessionState.tabs.find(candidate => candidate.id === tabId)!;
	tab.dirty = dirty;
}

export function updateActiveContextDirtyFlag(): void {
	const context = getActiveCodeTabContext();
	context.dirty = editorDocumentState.dirty;
	setTabDirty(context.id, context.dirty);
}

export function getActiveTabKind(): EditorTabKind {
	const active = editorSessionState.tabs.find(tab => tab.id === editorSessionState.activeTabId)!;
	return active.kind;
}

export function isCodeTabActive(): boolean {
	return getActiveTabKind() === 'code_editor';
}

export function isActiveLuaCodeTab(): boolean {
	return isCodeTabActive() && getActiveCodeTabContext().mode === 'lua';
}

export function isReadOnlyCodeTab(): boolean {
	return isCodeTabActive() && editorSessionState.activeContextReadOnly === true;
}

export function isEditableCodeTab(): boolean {
	return isCodeTabActive() && editorSessionState.activeContextReadOnly !== true;
}

export function isResourceViewActive(): boolean {
	return getActiveTabKind() === 'resource_view';
}

export function setActiveTab(tabId: string): void {
	const tab = editorSessionState.tabs.find(candidate => candidate.id === tabId)!;
	const isSameTab = editorSessionState.activeTabId === tabId;
	const navigationCheckpoint = !isSameTab && tab.kind === 'code_editor'
		? beginNavigationCapture()
		: null;
	closeSymbolSearch(true);
	if (!isSameTab && getActiveTabKind() === 'code_editor') {
		storeActiveCodeTabContext();
	}
	if (isSameTab) {
		if (tab.kind === 'resource_view') {
			editorSessionState.activeContextReadOnly = false;
			activateResourceViewerTab(tab);
			runtimeErrorState.activeOverlay = null;
			runtimeErrorState.executionStopRow = null;
		}
		return;
	}
	editorSessionState.activeTabId = tabId;
	if (tab.kind === 'resource_view') {
		editorSessionState.activeContextReadOnly = false;
		activateResourceViewerTab(tab);
		runtimeErrorState.activeOverlay = null;
		runtimeErrorState.executionStopRow = null;
		return;
	}
	if (tab.kind === 'code_editor') {
		hideResourcePanel();
		activateCodeEditorTab(tab.id);
		if (navigationCheckpoint) {
			completeNavigation(navigationCheckpoint);
		}
	}
}

export function activateCodeTab(): void {
	const codeTab = editorSessionState.tabs.find(candidate => candidate.kind === 'code_editor')!;
	setActiveTab(codeTab.id);
}

export function openLuaCodeTab(descriptor: ResourceDescriptor): void {
	const navigationCheckpoint = beginNavigationCapture();
	const tabId = buildCodeTabId(descriptor);
	if (!editorSessionState.codeTabContexts.has(tabId)) {
		const context = createLuaCodeTabContext(descriptor);
		editorSessionState.codeTabContexts.set(tabId, context);
	}
	const context = editorSessionState.codeTabContexts.get(tabId)!;
	context.descriptor = descriptor;
	context.readOnly = descriptor.readOnly === true;
	context.mode = 'lua';
	context.title = computeResourceTabTitle(descriptor);
	upsertCodeEditorTab(context);
	setActiveTab(tabId);
	completeNavigation(navigationCheckpoint);
}

export async function openAemCodeTab(descriptor: ResourceDescriptor): Promise<void> {
	const navigationCheckpoint = beginNavigationCapture();
	const tabId = buildCodeTabId(descriptor);
	try {
		let context = editorSessionState.codeTabContexts.get(tabId);
		if (!context) {
			const source = await loadAemResourceSource(descriptor.path);
			if (source === null) {
				throw new Error(`AEM resource '${descriptor.path}' is unavailable.`);
			}
			context = createAemCodeTabContext(descriptor, source);
			editorSessionState.codeTabContexts.set(tabId, context);
		}
		context.descriptor = descriptor;
		context.readOnly = descriptor.readOnly === true;
		context.mode = 'aem';
		context.title = computeResourceTabTitle(descriptor);
		upsertCodeEditorTab(context);
		setActiveTab(tabId);
		completeNavigation(navigationCheckpoint);
	} catch (error) {
		completeNavigation(navigationCheckpoint);
		const message = extractErrorMessage(error);
		showEditorMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
	}
}

export async function openCodeTabForDescriptor(descriptor: ResourceDescriptor): Promise<void> {
	if (descriptor.type === 'lua') {
		openLuaCodeTab(descriptor);
		return;
	}
	if (descriptor.type === 'aem') {
		await openAemCodeTab(descriptor);
		return;
	}
	throw new Error(`Unsupported code tab resource type '${descriptor.type}' for '${descriptor.path}'.`);
}

export function closeTab(tabId: string): void {
	const index = editorSessionState.tabs.findIndex(tab => tab.id === tabId);
	const tab = editorSessionState.tabs[index];
	if (!tab.closable) {
		return;
	}
	if (editorPointerState.tabDragState && editorPointerState.tabDragState.tabId === tabId) {
		endTabDrag();
	}
	const isActive = editorSessionState.activeTabId === tabId;
	if (isActive && editorSessionState.tabs.length > 1) {
		const fallback = editorSessionState.tabs[index - 1] ?? editorSessionState.tabs[index + 1];
		setActiveTab(fallback.id);
	} else if (isActive && tab.kind === 'code_editor') {
		storeActiveCodeTabContext();
	}
	editorSessionState.tabs.splice(index, 1);
	if (tab.kind === 'code_editor') {
		editorDiagnosticsState.dirtyDiagnosticContexts.delete(tab.id);
		editorDiagnosticsState.diagnosticsCache.delete(tab.id);
	}
	if (editorSessionState.tabs.length === 0) {
		initializeTabs();
	}
}

export function cycleTab(direction: number): void {
	if (editorSessionState.tabs.length <= 1 || direction === 0) {
		return;
	}
	const count = editorSessionState.tabs.length;
	const currentIndex = editorSessionState.tabs.findIndex(tab => tab.id === editorSessionState.activeTabId);
	let nextIndex = currentIndex + direction;
	nextIndex = ((nextIndex % count) + count) % count;
	if (nextIndex === currentIndex) {
		return;
	}
	const target = editorSessionState.tabs[nextIndex];
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
	for (let index = 0; index < editorSessionState.tabs.length; index += 1) {
		const tab = editorSessionState.tabs[index];
		const bounds = editorChromeState.tabButtonBounds.get(tab.id) ;
		if (bounds) {
			const left = bounds.left;
			const right = bounds.right;
			const width = Math.max(0, right - left);
			const rowIndex = Math.max(0, Math.floor((bounds.top - editorViewState.headerHeight) / editorViewState.tabBarHeight));
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
	if (editorSessionState.tabs.length <= 1) {
		editorPointerState.tabDragState = null;
		return;
	}
	const bounds = editorChromeState.tabButtonBounds.get(tabId) ;
	const pointerOffset = bounds ? pointerX - bounds.left : 0;
	editorPointerState.tabDragState = {
		tabId,
		pointerOffset,
		startX: pointerX,
		hasDragged: false,
	};
}

export function updateTabDrag(pointerX: number, pointerY: number): void {
	const state = editorPointerState.tabDragState!;
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
	const withinTabBar = pointerY >= editorViewState.headerHeight && pointerY < editorViewState.headerHeight + totalTabHeight;
	const maxRowIndex = Math.max(0, editorViewState.tabBarRowCount - 1);
	const pointerRow = withinTabBar
		? clamp(Math.floor((pointerY - editorViewState.headerHeight) / editorViewState.tabBarHeight), 0, maxRowIndex)
		: dragged.rowIndex;
	const rowStride = editorViewState.viewportWidth + constants.TAB_BUTTON_SPACING * 4;
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
	const tabIndex = editorSessionState.tabs.findIndex(entry => entry.id === state.tabId);
	const removed = editorSessionState.tabs.splice(tabIndex, 1);
	const tab = removed[0];
	const targetIndex = clamp(desiredIndex, 0, editorSessionState.tabs.length);
	editorSessionState.tabs.splice(targetIndex, 0, tab);
}

export function endTabDrag(): void {
	editorPointerState.tabDragState = null;
}

export function findCodeTabContext(path: string): CodeTabContext {
	for (const context of editorSessionState.codeTabContexts.values()) {
		const descriptor = context.descriptor;
		if (descriptor.path === path) {
			return context;
		}
	}
	return null;
}

export function computeResourceTabTitle(descriptor: ResourceDescriptor): string {
	const parts = descriptor.path.split('/').filter(part => part.length > 0);
	if (parts.length > 0) {
		return parts[parts.length - 1];
	}
	return descriptor.type.toUpperCase();
}

export function focusChunkSource(path: string): void {
	if (!editorRuntimeState.active) {
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
	const descriptorsByPath = new Map<string, ResourceDescriptor>();
	const luaDescriptors = listResources();
	for (let index = 0; index < luaDescriptors.length; index += 1) {
		const descriptor = luaDescriptors[index]!;
		descriptorsByPath.set(descriptor.path, descriptor);
	}
	const aemDescriptors = listAemResourceDescriptors();
	for (let index = 0; index < aemDescriptors.length; index += 1) {
		const descriptor = aemDescriptors[index]!;
		descriptorsByPath.set(descriptor.path, descriptor);
	}
	const descriptors = Array.from(descriptorsByPath.values());
	descriptors.sort((left, right) => left.path.localeCompare(right.path));
	return descriptors;
}

export function openResourceDescriptor(descriptor: ResourceDescriptor): void {
	selectResourceInPanel(descriptor);
	if (descriptor.type === 'atlas') {
		showEditorMessage('Atlas resources cannot be previewed in the IDE.', constants.COLOR_STATUS_WARNING, 3.2);
		focusEditorFromResourcePanel();
		return;
	}
	if (descriptor.type === 'lua' || descriptor.type === 'aem') {
		void openCodeTabForDescriptor(descriptor);
	} else {
		openResourceViewerTab(descriptor);
	}
	focusEditorFromResourcePanel();
}

export function isActive(): boolean {
	return editorRuntimeState.active;
}

export function focusEditorFromResourcePanel(): void {
	if (!resourcePanel.isFocused()) {
		return;
	}
	resourcePanel.setFocused(false);
	resetBlink();
}

export function closeActiveTab(): void {
	if (!editorSessionState.activeTabId) {
		return;
	}
	closeTab(editorSessionState.activeTabId);
}

export function resetEditorContent(): void {
	editorDocumentState.buffer = new PieceTreeBuffer('');
	editorViewState.layout.markVisualLinesDirty();
	markAllDiagnosticsDirty();
	editorDocumentState.cursorRow = 0;
	editorDocumentState.cursorColumn = 0;
	editorViewState.scrollRow = 0;
	editorViewState.scrollColumn = 0;
	editorDocumentState.selectionAnchor = null;
	editorDocumentState.lastSavedSource = '';
	editorDocumentState.undoStack = [];
	editorDocumentState.redoStack = [];
	editorDocumentState.lastHistoryKey = null;
	editorDocumentState.lastHistoryTimestamp = 0;
	editorDocumentState.savePointDepth = 0;
	editorViewState.layout.invalidateAllHighlights();
	bumpTextVersion();
	editorDocumentState.dirty = false;
	updateActiveContextDirtyFlag();
	syncRuntimeErrorOverlayFromContext(null);
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
	requestSemanticRefresh();
}

export async function save(): Promise<void> {
	const context = getActiveCodeTabContext();
	const source = getTextSnapshot(editorDocumentState.buffer);
	const targetPath = context.descriptor.path;
	const previousAppliedGeneration = editorDocumentState.appliedGeneration;
	try {
		if (context.mode === 'lua') {
			await saveLuaResourceSource(targetPath, source);
		} else {
			await saveAemResourceSource(targetPath, source);
		}
		setWorkspaceCachedSources([targetPath, buildDirtyFilePath(targetPath)], source);
		editorDocumentState.dirty = false;
		editorDocumentState.savePointDepth = editorDocumentState.undoStack.length;
		context.savePointDepth = editorDocumentState.savePointDepth;
		breakUndoSequence();
		editorDocumentState.saveGeneration = editorDocumentState.saveGeneration + 1;
		context.lastSavedSource = source;
		context.saveGeneration = editorDocumentState.saveGeneration;
		editorDocumentState.lastSavedSource = source;
		updateActiveContextDirtyFlag();
		if (context.mode === 'lua') {
			context.appliedGeneration = editorDocumentState.appliedGeneration;
			setContextRuntimeSyncState(context, 'restart_pending', null);
			showEditorMessage(`${context.title} saved (restart pending)`, constants.COLOR_STATUS_SUCCESS, 2.5);
			return;
		}
		try {
			applyAemSourceToRuntime(context.descriptor, source);
			editorDocumentState.appliedGeneration = editorDocumentState.saveGeneration;
			context.appliedGeneration = editorDocumentState.appliedGeneration;
			setContextRuntimeSyncState(context, 'synced', null);
			showEditorMessage(`${context.title} saved`, constants.COLOR_STATUS_SUCCESS, 2.5);
		} catch (applyError) {
			const applyMessage = extractErrorMessage(applyError);
			editorDocumentState.appliedGeneration = previousAppliedGeneration;
			context.appliedGeneration = previousAppliedGeneration;
			setContextRuntimeSyncState(context, 'diverged', applyMessage);
			showEditorMessage(`${context.title} saved, but runtime apply failed`, constants.COLOR_STATUS_WARNING, 4.0);
			showEditorWarningBanner(`Saved, but runtime apply failed: ${applyMessage}`, 5.0);
		}
	} catch (error) {
		if (context.mode === 'lua' && tryShowLuaErrorOverlay(error)) {
			return;
		}
		const message = extractErrorMessage(error);
		showEditorMessage(message, constants.COLOR_STATUS_ERROR, 4.0);
	}
}

export function recordEditContext(kind: 'insert' | 'delete' | 'replace', text: string): void {
	editorDocumentState.lastContentEditAtMs = editorRuntimeState.clockNow();
	editorRuntimeState.pendingEditContext = { kind, text };
}

export function applySourceToDocument(source: string): void {
	editorDocumentState.buffer.replace(0, editorDocumentState.buffer.length, source);
	invalidateLuaCommentContextFromRow(editorDocumentState.buffer, 0);
	editorDocumentState.textVersion = editorDocumentState.buffer.version;
	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.invalidateHighlightsFromRow(0);
	editorViewState.layout.markVisualLinesDirty();
}
