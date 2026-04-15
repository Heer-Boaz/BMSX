import { showEditorMessage, showEditorWarningBanner } from '../common/feedback_state';
import { editorDocumentState, restoreDocumentStateFromContext, storeDocumentStateInContext } from '../../editor/editing/editor_document_state';
import { editorDiagnosticsState } from '../../editor/contrib/diagnostics/diagnostics_state';
import { editorSessionState } from '../../editor/ui/editor_session_state';
import { editorViewState } from '../../editor/ui/editor_view_state';
import type {
	CodeTabContext,
	CodeTabMode,
	EditorRuntimeSyncState,
	EditorTabDescriptor,
	ResourceDescriptor,
} from '../../common/types';
import * as constants from '../../common/constants';
import { beginNavigationCapture, completeNavigation } from '../../editor/navigation/navigation_history';
import { syncRuntimeErrorOverlayFromContext, tryShowLuaErrorOverlay } from '../../editor/contrib/runtime_error/runtime_error_navigation';
import { updateDesiredColumn, ensureCursorVisible } from '../../editor/ui/caret';
import { refreshActiveDiagnostics } from '../../editor/contrib/diagnostics/diagnostics_controller';
import { markDiagnosticsDirty, markAllDiagnosticsDirty } from '../../editor/contrib/diagnostics/diagnostics';
import { requestSemanticRefresh } from '../../editor/contrib/intellisense/intellisense';
import { resetBlink } from '../../editor/render/render_caret';
import { Runtime } from '../../../emulator/runtime';
import * as runtimeLuaPipeline from '../../../emulator/runtime_lua_pipeline';
import { getTextSnapshot } from '../../editor/text/source_text';
import { PieceTreeBuffer } from '../../editor/text/piece_tree_buffer';
import { listResources, saveLuaResourceSource } from '../../../emulator/workspace';
import { buildDirtyFilePath } from '../common/workspace_io';
import { setWorkspaceCachedSources } from '../../../emulator/workspace_cache';
import { breakUndoSequence } from '../../editor/editing/undo_controller';
import { applyAemSourceToRuntime, saveAemResourceSource } from '../../language/aem/aem_editor';
import { loadAemResourceSource } from '../../language/aem/aem_editor';
import { extractErrorMessage } from '../../../lua/luavalue';
import { editorPointerState } from '../../editor/input/pointer/editor_pointer_state';
import { runtimeErrorState } from '../../editor/contrib/runtime_error/runtime_error_state';
import { computeResourceTabTitle } from './tab_titles';
import { setActiveTab } from './tabs';

function resolveLuaSource(descriptor: ResourceDescriptor): string {
	const runtime = Runtime.instance;
	return runtimeLuaPipeline.resourceSourceForChunk(runtime, descriptor.path);
}

export function buildCodeTabId(descriptor: ResourceDescriptor): string {
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

export function upsertCodeEditorTab(context: CodeTabContext): EditorTabDescriptor {
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
		const path = context.descriptor.path;
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

export function createAemCodeTabContext(descriptor: ResourceDescriptor, source: string): CodeTabContext {
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

export function setTabDirty(tabId: string, dirty: boolean): void {
	const tab = editorSessionState.tabs.find(candidate => candidate.id === tabId)!;
	tab.dirty = dirty;
}

export function updateActiveContextDirtyFlag(): void {
	const context = getActiveCodeTabContext();
	context.dirty = editorDocumentState.dirty;
	setTabDirty(context.id, context.dirty);
}

export function isCodeTabActive(): boolean {
	const active = editorSessionState.tabs.find(tab => tab.id === editorSessionState.activeTabId)!;
	return active.kind === 'code_editor';
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

export function findCodeTabContext(path: string): CodeTabContext {
	for (const context of editorSessionState.codeTabContexts.values()) {
		const descriptor = context.descriptor;
		if (descriptor.path === path) {
			return context;
		}
	}
	return null;
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
	editorDocumentState.textVersion = editorDocumentState.buffer.version;
	editorDocumentState.dirty = false;
	updateActiveContextDirtyFlag();
	syncRuntimeErrorOverlayFromContext(null);
	updateDesiredColumn();
	resetBlink();
	ensureCursorVisible();
	requestSemanticRefresh();
}

export function openLuaCodeTab(descriptor: ResourceDescriptor): void {
	const navigationCheckpoint = beginNavigationCapture();
	const tabId = buildCodeTabId(descriptor);
	if (!editorSessionState.codeTabContexts.has(tabId)) {
		editorSessionState.codeTabContexts.set(tabId, createLuaCodeTabContext(descriptor));
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
