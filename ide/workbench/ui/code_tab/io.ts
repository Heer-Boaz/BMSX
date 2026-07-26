import type { RuntimeSourceState } from '../../../runtime/sources';
import { showEditorMessage, showEditorWarningBanner } from '../../../common/feedback_state';
import type { CodeTabContext, CodeTabMode, ResourceDescriptor } from '../../../common/models';
import * as constants from '../../../common/constants';
import { showLuaErrorOverlay } from '../../../runtime_error/navigation';
import { saveLuaResourceSource } from '../../../workspace/workspace';
import { loadWorkspaceSourceFile, persistWorkspaceSourceFile } from '../../../workspace/files';
import { workspaceFileCache } from '../../../workspace/cache';
import { resolveWorkspacePath } from '../../../workspace/path';
import { applyAemSourceToRuntime } from '../../../runtime/aem';
import { extractErrorMessage } from '../../../language/lua/interpreter/value';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { CartEditor } from '../../../cart_editor';
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

function applyCodeTabDescriptor(context: CodeTabContext, descriptor: ResourceDescriptor, mode: CodeTabMode): void {
	context.descriptor = descriptor;
	context.readOnly = !!descriptor.readOnly;
	context.mode = mode;
	context.title = computeResourceTabTitle(descriptor);
}

export function openLuaCodeTab(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	descriptor: ResourceDescriptor,
	selection?: CodeTabSelection,
): void {
	const tabId = buildCodeTabId(descriptor);
	if (!codeTabSessionState.contexts.has(tabId)) {
		codeTabSessionState.contexts.set(tabId, createLuaCodeTabContext(sources, descriptor));
	}
	const context = codeTabSessionState.contexts.get(tabId)!;
	applyCodeTabDescriptor(context, descriptor, 'lua');
	upsertCodeEditorTab(context);
	setActiveTab(resourcePanel, tabId, selection);
}

export async function openAemCodeTab(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	descriptor: ResourceDescriptor,
): Promise<void> {
	const tabId = buildCodeTabId(descriptor);
	try {
		let context = codeTabSessionState.contexts.get(tabId);
		if (!context) {
			const projectRootPath = runtimeSourceProjectRootPath(sources, descriptor.domain);
			const source = await loadWorkspaceSourceFile(descriptor.path, projectRootPath);
			if (source === null) {
				throw new Error(`AEM resource '${descriptor.path}' is unavailable.`);
			}
			context = createAemCodeTabContext(descriptor, source);
			codeTabSessionState.contexts.set(tabId, context);
		}
		applyCodeTabDescriptor(context, descriptor, 'aem');
		upsertCodeEditorTab(context);
		setActiveTab(resourcePanel, tabId);
	} catch (error) {
		showEditorMessage(extractErrorMessage(error), constants.COLOR_STATUS_ERROR, 4.0);
	}
}

export async function openCodeTabForDescriptor(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	descriptor: ResourceDescriptor,
): Promise<void> {
	if (descriptor.type === 'lua') {
		openLuaCodeTab(resourcePanel, sources, descriptor);
		return;
	}
	if (descriptor.type === 'aem') {
		await openAemCodeTab(resourcePanel, sources, descriptor);
		return;
	}
	throw new Error(`Unsupported code tab resource type '${descriptor.type}' for '${descriptor.path}'.`);
}

export async function save(
	editor: CartEditor,
	sources: RuntimeSourceState,
	runtime: Runtime,
): Promise<void> {
	const context = getActiveCodeTabContext();
	const source = captureActiveCodeTabSource();
	const targetPath = context.descriptor.path;
	const previousAppliedGeneration = context.appliedGeneration;
	try {
		if (context.mode === 'lua') {
			await saveLuaResourceSource(sources, context.descriptor, source);
		} else {
			const projectRootPath = runtimeSourceProjectRootPath(
				sources,
				context.descriptor.domain,
			);
			await persistWorkspaceSourceFile(targetPath, source, projectRootPath);
			workspaceFileCache.set(resolveWorkspacePath(targetPath, projectRootPath), source);
		}
		commitActiveCodeTabSave(context, source);
		if (context.mode === 'lua') {
			setContextRuntimeSyncState(context, 'runtime_update_pending', null);
			showEditorMessage(`${context.title} saved (runtime update pending)`, constants.COLOR_STATUS_SUCCESS, 2.5);
			return;
		}
		try {
				applyAemSourceToRuntime(sources, runtime, context.descriptor, source);
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
	} catch (error) {
		if (context.mode === 'lua' && showLuaErrorOverlay(editor, error)) {
			return;
		}
		showEditorMessage(extractErrorMessage(error), constants.COLOR_STATUS_ERROR, 4.0);
	}
}
