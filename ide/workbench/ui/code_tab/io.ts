import type { RuntimeSourceState } from '../../../runtime/sources';
import { showEditorMessage, showEditorWarningBanner } from '../../../common/feedback_state';
import type { EditorDocumentMode } from '../../../editor/editing/document_state';
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
	captureActiveCodeTabSource,
	commitActiveCodeTabSave,
	setActiveCodeTabAppliedGeneration,
	type CodeTabSelection,
} from './activation';
import {
	buildCodeTabId,
	createAemCodeTabContext,
	createLuaCodeTabContext,
	getActiveCodeTabContext,
	setContextRuntimeSyncState,
	upsertCodeEditorTab,
} from './contexts';
import { codeTabSessionState } from './session_state';
import { runtimeSourceProjectRootPath } from '../../../runtime/sources';
import type { ResourcePanelController } from '../../contrib/resources/panel/controller';
import { requestWorkspaceAutosave } from '../../workspace/storage';
import { WorkspaceAutosaveChange } from '../../workspace/models';
import type { HostClock } from '../../../../hosts/common/clock';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';

function applyCodeTabResource(context: CodeTabContext, resource: RuntimeResource, mode: EditorDocumentMode): void {
	context.resource = resource;
	context.mode = mode;
	context.title = computeResourceTabTitle(resource);
}

export function openLuaCodeTab(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
	selection?: CodeTabSelection,
): void {
	const tabId = buildCodeTabId(resource);
	if (!codeTabSessionState.contexts.has(tabId)) {
		codeTabSessionState.contexts.set(tabId, createLuaCodeTabContext(sources, resource));
	}
	const context = codeTabSessionState.contexts.get(tabId)!;
	applyCodeTabResource(context, resource, 'lua');
	upsertCodeEditorTab(context);
	setActiveTab(resourcePanel, tabId, selection);
}

export async function openAemCodeTab(
	storage: KeyValueStorage,
	editor: CartEditor,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): Promise<void> {
	const resourcePanel = editor.resourcePanel;
	const tabId = buildCodeTabId(resource);
	try {
		let context = codeTabSessionState.contexts.get(tabId);
		if (!context) {
			const projectRootPath = runtimeSourceProjectRootPath(sources, resource.domain);
			const source = await loadWorkspaceSourceFile(
				storage,
				resource.path,
				projectRootPath,
			);
			if (source === null) {
				throw new Error(`AEM resource '${resource.path}' is unavailable.`);
			}
			context = createAemCodeTabContext(resource, source);
			codeTabSessionState.contexts.set(tabId, context);
		}
		applyCodeTabResource(context, resource, 'aem');
		upsertCodeEditorTab(context);
		setActiveTab(resourcePanel, tabId);
	} catch (error) {
		showEditorMessage(extractErrorMessage(error), constants.COLOR_STATUS_ERROR, 4.0);
	}
}

export async function openCodeTabForResource(
	storage: KeyValueStorage,
	editor: CartEditor,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): Promise<void> {
	const resourcePanel = editor.resourcePanel;
	switch (resource.source.type) {
		case 'lua':
			openLuaCodeTab(resourcePanel, sources, resource);
			return;
		case 'aem':
			await openAemCodeTab(storage, editor, sources, resource);
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
	const source = captureActiveCodeTabSource();
	const targetPath = context.resource.path;
	const previousAppliedGeneration = context.appliedGeneration;
	try {
		switch (context.mode) {
			case 'lua':
				await saveLuaResourceSource(
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
				await persistWorkspaceSourceFile(
					storage,
					clock,
					targetPath,
					source,
					projectRootPath,
				);
				workspaceCanonicalSourceCache.set(resolveWorkspacePath(targetPath, projectRootPath), source);
				break;
			}
		}
		commitActiveCodeTabSave(context, source);
		requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
		switch (context.mode) {
			case 'lua':
				setContextRuntimeSyncState(context, 'runtime_update_pending', null);
				showEditorMessage(`${context.title} saved (runtime update pending)`, constants.COLOR_STATUS_SUCCESS, 2.5);
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
				if (showLuaErrorOverlay(editor, error)) {
					return;
				}
				break;
			case 'aem':
				break;
		}
		showEditorMessage(extractErrorMessage(error), constants.COLOR_STATUS_ERROR, 4.0);
	}
}
