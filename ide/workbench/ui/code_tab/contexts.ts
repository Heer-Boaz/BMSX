import {
	developmentCartridgeSource,
	type RuntimeSourceState,
} from '../../../runtime/sources';
import { activeCodeEditor, createCodeEditorViewState } from '../../../editor/ui/code_editor_state';
import type { CodeEditorTabId } from '../tab/id';
import type { CodeEditorTabDescriptor } from '../tab/model';
import type { CodeEditorDocumentMode } from '../../../editor/model/text_model';
import type { CodeEditorInputId } from '../../../common/editor_context';
import * as luaPipeline from '../../../runtime/lua_pipeline';
import { computeResourceTabTitle } from '../tab/titles';
import { editorTabGroup } from '../tab/group_model';
import {
	SYSTEM_RESOURCE_DOMAIN,
	resourceIdentityKey,
	resourceIdentityKeyFromParts,
	type ResourceIdentity,
	type RuntimeResource,
} from '../../../common/resource';
import type { CodeTabContext } from './model';
import { codeEditorInputManager } from './input_manager';
import { editorTextModelService } from '../../../editor/model/model_service';

function resolveLuaSource(sources: RuntimeSourceState, resource: RuntimeResource): string {
	return luaPipeline.resourceSourceForChunk(sources, resource);
}

function createCodeTabContext(resource: RuntimeResource, initialSource: string, mode: CodeEditorDocumentMode): CodeTabContext {
	const title = computeResourceTabTitle(resource);
	const model = editorTextModelService.retain(resource, mode, initialSource);
	return {
		id: buildCodeTabId(resource),
		title,
		model,
		view: createCodeEditorViewState(),
		runtimeErrorOverlay: null,
		executionStopRow: null,
	};
}

export function buildCodeTabId(resource: ResourceIdentity): CodeEditorTabId {
	return `code:${resourceIdentityKey(resource)}`;
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
	let context = codeEditorInputManager.get(contextId);
	if (context === undefined) {
		context = createLuaCodeTabContext(sources, resource);
		codeEditorInputManager.register(context);
	}
	context.model.refreshResource(resource);
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
	return activeCodeEditor.model.readOnly;
}

export function getCodeTabContextById(contextId: CodeEditorInputId): CodeTabContext | undefined {
	return codeEditorInputManager.get(contextId);
}

export function hasCodeTabContext(contextId: CodeEditorInputId): boolean {
	return codeEditorInputManager.has(contextId);
}

export function getCodeTabContexts(): IterableIterator<CodeTabContext> {
	return codeEditorInputManager.inputs;
}

export function registerCodeTabContext(context: CodeTabContext): void {
	codeEditorInputManager.register(context);
}

export function clearCodeEditorInputs(): void {
	codeEditorInputManager.clear();
}

export function isActiveLuaCodeTab(): boolean {
	const activeTab = editorTabGroup.activeTab;
	return activeTab?.kind === 'code_editor' && activeTab.context.model.mode === 'lua';
}

export function isReadOnlyCodeTab(): boolean {
	return editorTabGroup.activeTab?.kind === 'code_editor' && activeCodeEditor.model.readOnly;
}

export function isEditableCodeTab(): boolean {
	return editorTabGroup.activeTab?.kind === 'code_editor' && !activeCodeEditor.model.readOnly;
}

export function findCodeTabContext(identity: ResourceIdentity): CodeTabContext | null {
	const context = codeEditorInputManager.get(buildCodeTabId(identity));
	return context === undefined ? null : context;
}
