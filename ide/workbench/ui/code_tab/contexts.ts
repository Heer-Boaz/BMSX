import {
	developmentCartridgeSource,
	type RuntimeSourceState,
} from '../../../runtime/sources';
import { editorDocumentState } from '../../../editor/editing/document_state';
import type { CodeEditorTabId } from '../tab/id';
import type { CodeEditorTabDescriptor } from '../tab/model';
import type { EditorDocumentMode } from '../../../editor/editing/document_state';
import type { EditorDocumentContextId } from '../../../common/editor_context';
import * as luaPipeline from '../../../runtime/lua_pipeline';
import { PieceTreeBuffer } from '../../../editor/text/piece_tree_buffer';
import { computeResourceTabTitle } from '../tab/titles';
import { editorTabGroup } from '../tab/group_model';
import {
	SYSTEM_RESOURCE_DOMAIN,
	resourceIdentityEquals,
	resourceIdentityKey,
	resourceIdentityKeyFromParts,
	type ResourceIdentity,
	type RuntimeResource,
} from '../../../common/resource';
import type { CodeTabContext } from './model';
import { codeEditorModelManager } from './model_manager';

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

export function buildCodeTabId(resource: ResourceIdentity): CodeEditorTabId {
	return `code:${resourceIdentityKey(resource)}`;
}

export function setContextRuntimeSyncState(
	context: CodeTabContext,
	runtimeSyncState: CodeTabContext['runtimeSyncState'],
	runtimeSyncMessage: string | null,
): void {
	context.runtimeSyncState = runtimeSyncState;
	context.runtimeSyncMessage = runtimeSyncMessage;
}

export function createCodeEditorTabDescriptor(context: CodeTabContext): CodeEditorTabDescriptor {
	return {
		id: context.id,
		kind: 'code_editor',
		title: context.title,
		closable: true,
		context,
	};
}

export function upsertCodeEditorTab(context: CodeTabContext): CodeEditorTabDescriptor {
	let tab = editorTabGroup.findById(context.id);
	if (!tab) {
		tab = createCodeEditorTabDescriptor(context);
		editorTabGroup.add(tab);
	}
	tab.title = context.title;
	tab.context = context;
	return tab;
}

function entryTabResource(sources: RuntimeSourceState): RuntimeResource {
	const cartridge = developmentCartridgeSource(sources);
	const domain = cartridge ? cartridge.domain : SYSTEM_RESOURCE_DOMAIN;
	const registry = cartridge ? cartridge.luaSources : sources.systemLuaSources;
	return sources.resourceByIdentity.get(resourceIdentityKeyFromParts(
		domain,
		registry.entrySourcePath,
	))!;
}

export function createLuaCodeTabContext(sources: RuntimeSourceState, resource: RuntimeResource): CodeTabContext {
	return createCodeTabContext(resource, resolveLuaSource(sources, resource), 'lua');
}

export function retainLuaCodeTabContext(
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): CodeTabContext {
	const contextId = buildCodeTabId(resource);
	let context = codeEditorModelManager.get(contextId);
	if (context === undefined) {
		context = createLuaCodeTabContext(sources, resource);
		codeEditorModelManager.register(context);
	}
	context.resource = resource;
	context.mode = 'lua';
	context.title = computeResourceTabTitle(resource);
	return context;
}

export function retainEntryTabContext(sources: RuntimeSourceState): CodeTabContext {
	return retainLuaCodeTabContext(sources, entryTabResource(sources));
}

export function createAemCodeTabContext(resource: RuntimeResource, source: string): CodeTabContext {
	return createCodeTabContext(resource, source, 'aem');
}

export function getActiveCodeTabContext(): CodeTabContext | null {
	const activeTab = editorTabGroup.activeTab;
	return activeTab?.kind === 'code_editor' ? activeTab.context : null;
}

export function getActiveCodeTabContextId(): CodeEditorTabId | null {
	const activeTab = editorTabGroup.activeTab;
	return activeTab?.kind === 'code_editor' ? activeTab.id : null;
}

export function isActiveCodeTabReadOnly(): boolean {
	return editorDocumentState.readOnly;
}

export function getCodeTabContextById(contextId: EditorDocumentContextId): CodeTabContext | undefined {
	return codeEditorModelManager.get(contextId);
}

export function hasCodeTabContext(contextId: EditorDocumentContextId): boolean {
	return codeEditorModelManager.has(contextId);
}

export function getCodeTabContexts(): IterableIterator<CodeTabContext> {
	return codeEditorModelManager.models;
}

export function registerCodeTabContext(context: CodeTabContext): void {
	codeEditorModelManager.register(context);
}

export function clearCodeTabContexts(): void {
	codeEditorModelManager.clear();
}

export function updateActiveContextDirtyFlag(): void {
	const context = getActiveCodeTabContext();
	context.saveGeneration = editorDocumentState.saveGeneration;
	context.textVersion = editorDocumentState.textVersion;
	context.dirty = editorDocumentState.dirty;
}

export function isActiveLuaCodeTab(): boolean {
	const activeTab = editorTabGroup.activeTab;
	return activeTab?.kind === 'code_editor' && activeTab.context.mode === 'lua';
}

export function isReadOnlyCodeTab(): boolean {
	return editorTabGroup.activeTab?.kind === 'code_editor' && editorDocumentState.readOnly;
}

export function isEditableCodeTab(): boolean {
	return editorTabGroup.activeTab?.kind === 'code_editor' && !editorDocumentState.readOnly;
}

export function findCodeTabContext(identity: ResourceIdentity): CodeTabContext | null {
	for (const context of getCodeTabContexts()) {
		if (resourceIdentityEquals(context.resource, identity)) {
			return context;
		}
	}
	return null;
}
