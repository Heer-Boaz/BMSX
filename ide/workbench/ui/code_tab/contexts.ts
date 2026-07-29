import type { RuntimeSourceState } from '../../../runtime/sources';
import { editorDocumentState } from '../../../editor/editing/document_state';
import type {
	EditorRuntimeSyncState,
	EditorTabDescriptor,
} from '../../../common/models';
import type { EditorDocumentMode } from '../../../editor/editing/document_state';
import * as luaPipeline from '../../../runtime/lua_pipeline';
import { PieceTreeBuffer } from '../../../editor/text/piece_tree_buffer';
import { computeResourceTabTitle } from '../tab/titles';
import { codeTabSessionState } from './session_state';
import { tabSessionState } from '../tab/session_state';
import {
	resourceIdentityEquals,
	resourceIdentityKey,
	type ResourceIdentity,
	type RuntimeResource,
} from '../../../common/resource';
import type { CodeTabContext } from './model';

function resolveLuaSource(sources: RuntimeSourceState, resource: RuntimeResource): string {
	return luaPipeline.resourceSourceForChunk(sources, resource);
}

function createCodeTabContext(resource: RuntimeResource, initialSource: string, mode: EditorDocumentMode): CodeTabContext {
	const title = computeResourceTabTitle(resource);
	const buffer = new PieceTreeBuffer(initialSource);
	return {
		id: buildCodeTabId(resource),
		title,
		resource,
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
		textVersion: buffer.version,
	};
}

export function buildCodeTabId(resource: ResourceIdentity): string {
	return `code:${resourceIdentityKey(resource)}`;
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

export function createEntryTabContext(sources: RuntimeSourceState): CodeTabContext {
	const resource = sources.activeResources.find(r =>
		r.domain === sources.activeCartridgeSlot
		&& r.path === sources.activeLuaSources.entrySourcePath
		&& r.source.type === 'lua'
	)!;
	return createLuaCodeTabContext(sources, resource);
}

export function createLuaCodeTabContext(sources: RuntimeSourceState, resource: RuntimeResource): CodeTabContext {
	return createCodeTabContext(resource, resolveLuaSource(sources, resource), 'lua');
}

export function createAemCodeTabContext(resource: RuntimeResource, source: string): CodeTabContext {
	return createCodeTabContext(resource, source, 'aem');
}

export function getActiveCodeTabContext(): CodeTabContext {
	return codeTabSessionState.contexts.get(codeTabSessionState.activeContextId)!;
}

export function getActiveCodeTabContextId(): string {
	return codeTabSessionState.activeContextId;
}

export function isActiveCodeTabReadOnly(): boolean {
	return editorDocumentState.readOnly;
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
	context.saveGeneration = editorDocumentState.saveGeneration;
	context.textVersion = editorDocumentState.textVersion;
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
	return isCodeTabActive() && editorDocumentState.readOnly;
}

export function isEditableCodeTab(): boolean {
	return isCodeTabActive() && !editorDocumentState.readOnly;
}

export function findCodeTabContext(identity: ResourceIdentity): CodeTabContext {
	for (const context of codeTabSessionState.contexts.values()) {
		if (resourceIdentityEquals(context.resource, identity)) {
			return context;
		}
	}
	return null;
}
