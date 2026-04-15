import { editorDocumentState } from '../../editor/editing/editor_document_state';
import type {
	CodeTabContext,
	CodeTabMode,
	EditorRuntimeSyncState,
	EditorTabDescriptor,
	ResourceDescriptor,
} from '../../common/types';
import { Runtime } from '../../../emulator/runtime';
import * as runtimeLuaPipeline from '../../../emulator/runtime_lua_pipeline';
import { PieceTreeBuffer } from '../../editor/text/piece_tree_buffer';
import { listResources } from '../../../emulator/workspace';
import { computeResourceTabTitle } from './tab_titles';
import { codeTabSessionState } from './code_tab_session_state';
import { tabSessionState } from './tab_session_state';

function resolveLuaSource(descriptor: ResourceDescriptor): string {
	const runtime = Runtime.instance;
	return runtimeLuaPipeline.resourceSourceForChunk(runtime, descriptor.path);
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
}

export function clearCodeTabContexts(): void {
	codeTabSessionState.contexts.clear();
}

export function setTabDirty(tabId: string, dirty: boolean): void {
	const tab = tabSessionState.tabs.find(candidate => candidate.id === tabId)!;
	tab.dirty = dirty;
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
	return isCodeTabActive() && codeTabSessionState.activeContextReadOnly === true;
}

export function isEditableCodeTab(): boolean {
	return isCodeTabActive() && codeTabSessionState.activeContextReadOnly !== true;
}

export function findCodeTabContext(path: string): CodeTabContext {
	for (const context of codeTabSessionState.contexts.values()) {
		if (context.descriptor.path === path) {
			return context;
		}
	}
	return null;
}
