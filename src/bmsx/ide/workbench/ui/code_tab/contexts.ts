// disable cross_layer_import_pattern -- code-tab contexts own editable buffer instances stored in workbench tab state.
import { editorDocumentState } from '../../../editor/editing/document_state';
import type {
	CodeTabContext,
	CodeTabMode,
	EditorRuntimeSyncState,
	EditorTabDescriptor,
	ResourceDescriptor,
} from '../../../common/models';
import * as luaPipeline from '../../../runtime/lua_pipeline';
import { PieceTreeBuffer } from '../../../editor/text/piece_tree_buffer';
import { listResources } from '../../../workspace/workspace';
import { clearOpenWorkspacePathDirtyState, setOpenWorkspacePathDirty } from '../../../workspace/open_dirty';
import { computeResourceTabTitle } from '../tab/titles';
import { codeTabSessionState } from './session_state';
import { tabSessionState } from '../tab/session_state';
import type { Runtime } from '../../../../machine/runtime/runtime';

function resolveLuaSource(runtime: Runtime, descriptor: ResourceDescriptor): string {
	return luaPipeline.resourceSourceForChunk(runtime, descriptor.path);
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
		readOnly: !!descriptor.readOnly,
		textVersion: buffer.version,
	};
}

export function buildCodeTabId(descriptor: ResourceDescriptor): string {
	return `code:${descriptor.path}`;
}

export function setTabRuntimeSyncState(tabId: string, runtimeSyncState: EditorRuntimeSyncState, runtimeSyncMessage: string): void {
	const tab = tabSessionState.tabs.find(candidate => candidate.id === tabId)!;
	tab.runtimeSyncState = runtimeSyncState;
	tab.runtimeSyncMessage = runtimeSyncMessage;
}

export function setContextRuntimeSyncState(context: CodeTabContext, runtimeSyncState: EditorRuntimeSyncState, runtimeSyncMessage: string): void {
	context.runtimeSyncState = runtimeSyncState;
	context.runtimeSyncMessage = runtimeSyncMessage;
	setTabRuntimeSyncState(context.id, runtimeSyncState, runtimeSyncMessage);
}

export function upsertCodeEditorTab(context: CodeTabContext): EditorTabDescriptor {
	let tab = tabSessionState.tabs.find(candidate => candidate.id === context.id);
	if (!tab) {
		tab = {
			id: context.id,
			kind: 'code_editor',
			title: '',
			closable: true,
			dirty: false,
		};
		tabSessionState.tabs.push(tab);
	}
	tab.kind = 'code_editor';
	tab.title = context.title;
	tab.dirty = context.dirty;
	tab.runtimeSyncState = context.runtimeSyncState;
	tab.runtimeSyncMessage = context.runtimeSyncMessage;
	tab.resource = undefined;
	return tab;
}

export function createEntryTabContext(runtime: Runtime): CodeTabContext {
	const luaDescriptors = listResources(runtime).filter(r => r.type === 'lua');
	const preferredRegistry = luaPipeline.listLuaSourceRegistries(runtime)[0].registry;
	const descriptor = luaDescriptors.find(r => r.path === preferredRegistry.entry_path)!;
	return createLuaCodeTabContext(runtime, descriptor);
}

export function createLuaCodeTabContext(runtime: Runtime, descriptor: ResourceDescriptor): CodeTabContext {
	return createCodeTabContext(descriptor, resolveLuaSource(runtime, descriptor), 'lua');
}

export function createAemCodeTabContext(descriptor: ResourceDescriptor, source: string): CodeTabContext {
	return createCodeTabContext(descriptor, source, 'aem');
}

export function getActiveCodeTabContext(): CodeTabContext {
	return codeTabSessionState.contexts.get(codeTabSessionState.activeContextId)!;
}

export function getActiveCodeTabContextId(): string {
	return codeTabSessionState.activeContextId;
}

export function isActiveCodeTabReadOnly(): boolean {
	return codeTabSessionState.activeContextReadOnly;
}

export function getCodeTabContextById(contextId: string): CodeTabContext {
	return codeTabSessionState.contexts.get(contextId);
}

export function hasCodeTabContext(contextId: string): boolean {
	return codeTabSessionState.contexts.has(contextId);
}

export function getCodeTabContexts(): Iterable<CodeTabContext> {
	return codeTabSessionState.contexts.values();
}

export function registerCodeTabContext(context: CodeTabContext): void {
	codeTabSessionState.contexts.set(context.id, context);
	setOpenWorkspacePathDirty(context.descriptor.path, context.dirty);
}

export function clearCodeTabContexts(): void {
	codeTabSessionState.contexts.clear();
	clearOpenWorkspacePathDirtyState();
}

export function setTabDirty(tabId: string, dirty: boolean): void {
	const tab = tabSessionState.tabs.find(candidate => candidate.id === tabId)!;
	tab.dirty = dirty;
	const context = codeTabSessionState.contexts.get(tabId);
	if (context) {
		setOpenWorkspacePathDirty(context.descriptor.path, dirty);
	}
}

export function updateActiveContextDirtyFlag(): void {
	const context = getActiveCodeTabContext();
	context.dirty = editorDocumentState.dirty;
	setTabDirty(context.id, context.dirty);
}

export function isCodeTabActive(): boolean {
	const active = tabSessionState.tabs.find(tab => tab.id === tabSessionState.activeTabId)!;
	return active.kind === 'code_editor';
}

export function isActiveLuaCodeTab(): boolean {
	return isCodeTabActive() && getActiveCodeTabContext().mode === 'lua';
}

export function isReadOnlyCodeTab(): boolean {
	return isCodeTabActive() && codeTabSessionState.activeContextReadOnly;
}

export function isEditableCodeTab(): boolean {
	return isCodeTabActive() && !codeTabSessionState.activeContextReadOnly;
}

export function findCodeTabContext(path: string): CodeTabContext {
	for (const context of codeTabSessionState.contexts.values()) {
		if (context.descriptor.path === path) {
			return context;
		}
	}
	return null;
}
