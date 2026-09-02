import type { RuntimeSourceState } from '../../../runtime/sources';
import { showEditorMessage, showEditorWarningBanner } from '../../../common/feedback_state';
import {
	editorDocumentState,
	type EditorDocumentMode,
} from '../../../editor/editing/document_state';
import type { CodeTabContext } from './model';
import type { RuntimeResource } from '../../../common/resource';
import * as constants from '../../../common/constants';
import { showLuaErrorOverlay } from '../../../runtime_error/navigation';
import { saveLuaResourceSource } from '../../../workspace/workspace';
import { loadWorkspaceSourceFile, persistWorkspaceSourceFile } from '../../../workspace/files';
import { workspaceCanonicalSourceCache } from '../../../workspace/cache';
import { resolveWorkspacePath } from '../../../workspace/path';
import { applyAemSourceToRuntime } from '../../../runtime/aem';
import { extractErrorMessage } from '../../../language/lua/interpreter/value';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import { computeResourceTabTitle } from '../tab/titles';
import { setActiveTab } from '../tabs';
import {
	commitActiveCodeTabSave,
	setActiveCodeTabAppliedGeneration,
	type CodeTabSelection,
} from './activation';
import {
	buildCodeTabId,
	createAemCodeTabContext,
	getActiveCodeTabContext,
	getCodeTabContextById,
	registerCodeTabContext,
	retainLuaCodeTabContext,
	setContextRuntimeSyncState,
	upsertCodeEditorTab,
} from './contexts';
import { runtimeSourceProjectRootPath } from '../../../runtime/sources';
import type { ResourcePanelController } from '../../contrib/resources/panel/controller';
import { requestWorkspaceAutosave } from '../../workspace/storage';
import { WorkspaceAutosaveChange } from '../../workspace/models';
import type { HostClock } from '../../../../hosts/common/clock';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import { getTextSnapshot } from '../../../editor/text/source_text';

function applyCodeTabResource(context: CodeTabContext, resource: RuntimeResource, mode: EditorDocumentMode): void {
	context.resource = resource;
	context.mode = mode;
	context.title = computeResourceTabTitle(resource);
}

function retainLuaCodeTab(
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): CodeTabContext {
	const context = retainLuaCodeTabContext(sources, resource);
	upsertCodeEditorTab(context);
	return context;
}

async function retainAemCodeTab(
	storage: KeyValueStorage,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): Promise<CodeTabContext> {
	const tabId = buildCodeTabId(resource);
	let context = getCodeTabContextById(tabId);
	if (!context) {
		const projectRootPath = runtimeSourceProjectRootPath(sources, resource.domain);
		const workspacePath = resolveWorkspacePath(resource.path, projectRootPath);
		const source = await loadWorkspaceSourceFile(
			storage,
			workspacePath,
			projectRootPath,
		);
		if (source === null) {
			throw new Error(`AEM resource '${resource.path}' is unavailable.`);
		}
		context = createAemCodeTabContext(resource, source);
		registerCodeTabContext(context);
	}
	applyCodeTabResource(context, resource, 'aem');
	upsertCodeEditorTab(context);
	return context;
}

export function openLuaCodeTab(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
	selection?: CodeTabSelection,
): void {
	const context = retainLuaCodeTab(sources, resource);
	setActiveTab(resourcePanel, context.id, selection);
}

export async function openAemCodeTab(
	storage: KeyValueStorage,
	editor: CartEditor,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
	selection?: CodeTabSelection,
): Promise<void> {
	const resourcePanel = editor.resourcePanel;
	try {
		const context = await retainAemCodeTab(storage, sources, resource);
		setActiveTab(resourcePanel, context.id, selection);
	} catch (error) {
		showEditorMessage(extractErrorMessage(error), constants.COLOR_STATUS_ERROR, 4.0);
	}
}

export async function restoreCodeTabForResource(
	storage: KeyValueStorage,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): Promise<void> {
	switch (resource.source.type) {
		case 'lua':
			retainLuaCodeTab(sources, resource);
			return;
		case 'aem':
			await retainAemCodeTab(storage, sources, resource);
			return;
		default:
			throw new Error(`Unsupported code tab resource type '${resource.source.type}' for '${resource.path}'.`);
	}
}

export async function openCodeTabForResource(
	storage: KeyValueStorage,
	editor: CartEditor,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
	selection?: CodeTabSelection,
): Promise<void> {
	const resourcePanel = editor.resourcePanel;
	switch (resource.source.type) {
		case 'lua':
			openLuaCodeTab(resourcePanel, sources, resource, selection);
			return;
		case 'aem':
			await openAemCodeTab(storage, editor, sources, resource, selection);
			return;
		default:
			throw new Error(`Unsupported code tab resource type '${resource.source.type}' for '${resource.path}'.`);
	}
}

export async function save(
	storage: KeyValueStorage,
	clock: HostClock,
	editor: CartEditor,
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	runtime: Runtime,
): Promise<void> {
	const context = getActiveCodeTabContext();
	const source = getTextSnapshot(editorDocumentState.buffer);
	const targetPath = context.resource.path;
	const previousAppliedGeneration = context.appliedGeneration;
	let savedLuaProgramModule = false;
	try {
		switch (context.mode) {
			case 'lua':
				savedLuaProgramModule = await saveLuaResourceSource(
					storage,
					clock,
					sources,
					context.resource,
					source,
				);
				break;
			case 'aem': {
				const projectRootPath = runtimeSourceProjectRootPath(
					sources,
					context.resource.domain,
				);
				const workspacePath = resolveWorkspacePath(targetPath, projectRootPath);
				await persistWorkspaceSourceFile(
					storage,
					clock,
					workspacePath,
					source,
					projectRootPath,
				);
				workspaceCanonicalSourceCache.set(workspacePath, source);
				break;
			}
		}
		commitActiveCodeTabSave(context, source);
		requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
		switch (context.mode) {
			case 'lua':
				if (savedLuaProgramModule) {
					setContextRuntimeSyncState(context, 'runtime_update_pending', null);
					showEditorMessage(`${context.title} saved (runtime update pending)`, constants.COLOR_STATUS_SUCCESS, 2.5);
				} else {
					setActiveCodeTabAppliedGeneration(context, context.saveGeneration);
					setContextRuntimeSyncState(context, 'synced', null);
					showEditorMessage(`${context.title} saved`, constants.COLOR_STATUS_SUCCESS, 2.5);
				}
				return;
			case 'aem':
				try {
					applyAemSourceToRuntime(
						sources,
						luaTooling,
						editor,
						runtime,
						context.resource,
						source,
					);
					setActiveCodeTabAppliedGeneration(context, context.saveGeneration);
					setContextRuntimeSyncState(context, 'synced', null);
					showEditorMessage(`${context.title} saved`, constants.COLOR_STATUS_SUCCESS, 2.5);
				} catch (applyError) {
					const applyMessage = extractErrorMessage(applyError);
					setActiveCodeTabAppliedGeneration(context, previousAppliedGeneration);
					setContextRuntimeSyncState(context, 'diverged', applyMessage);
					showEditorMessage(`${context.title} saved, but runtime apply failed`, constants.COLOR_STATUS_WARNING, 4.0);
					showEditorWarningBanner(`Saved, but runtime apply failed: ${applyMessage}`, 5.0);
				}
				return;
		}
	} catch (error) {
		switch (context.mode) {
			case 'lua':
				if (showLuaErrorOverlay(editor, context.resource, error)) {
					return;
				}
				break;
			case 'aem':
				break;
		}
		showEditorMessage(extractErrorMessage(error), constants.COLOR_STATUS_ERROR, 4.0);
	}
}
