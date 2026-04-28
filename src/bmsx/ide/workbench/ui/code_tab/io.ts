import { showEditorMessage, showEditorWarningBanner } from '../../../common/feedback_state';
import type { CodeTabContext, CodeTabMode, ResourceDescriptor } from '../../../common/models';
import * as constants from '../../../common/constants';
import { tryShowLuaErrorOverlay } from '../../../runtime_error/navigation';
import { saveLuaResourceSource } from '../../../workspace/workspace';
import { loadWorkspaceSourceFile, persistWorkspaceSourceFile } from '../../../workspace/files';
import { buildDirtyFilePath } from '../../workspace/io';
import { setWorkspaceCachedSources } from '../../../workspace/cache';
import { applyAemSourceToRuntime } from '../../../language/aem/editor';
import { extractErrorMessage } from '../../../../lua/value';
import type { Runtime } from '../../../../machine/runtime/runtime';
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

function applyCodeTabDescriptor(context: CodeTabContext, descriptor: ResourceDescriptor, mode: CodeTabMode): void {
	context.descriptor = descriptor;
	context.readOnly = !!descriptor.readOnly;
	context.mode = mode;
	context.title = computeResourceTabTitle(descriptor);
}

export function openLuaCodeTab(runtime: Runtime, descriptor: ResourceDescriptor, selection?: CodeTabSelection): void {
	const tabId = buildCodeTabId(descriptor);
	if (!codeTabSessionState.contexts.has(tabId)) {
		codeTabSessionState.contexts.set(tabId, createLuaCodeTabContext(runtime, descriptor));
	}
	const context = codeTabSessionState.contexts.get(tabId)!;
	applyCodeTabDescriptor(context, descriptor, 'lua');
	upsertCodeEditorTab(context);
	setActiveTab(tabId, selection);
}

export async function openAemCodeTab(runtime: Runtime, descriptor: ResourceDescriptor): Promise<void> {
	const tabId = buildCodeTabId(descriptor);
	try {
		let context = codeTabSessionState.contexts.get(tabId);
		if (!context) {
			const source = await loadWorkspaceSourceFile(descriptor.path, runtime.cartProjectRootPath);
			if (source === null) {
				throw new Error(`AEM resource '${descriptor.path}' is unavailable.`);
			}
			context = createAemCodeTabContext(descriptor, source);
			codeTabSessionState.contexts.set(tabId, context);
		}
		applyCodeTabDescriptor(context, descriptor, 'aem');
		upsertCodeEditorTab(context);
		setActiveTab(tabId);
	} catch (error) {
		showEditorMessage(extractErrorMessage(error), constants.COLOR_STATUS_ERROR, 4.0);
	}
}

export async function openCodeTabForDescriptor(runtime: Runtime, descriptor: ResourceDescriptor): Promise<void> {
	if (descriptor.type === 'lua') {
		openLuaCodeTab(runtime, descriptor);
		return;
	}
	if (descriptor.type === 'aem') {
		await openAemCodeTab(runtime, descriptor);
		return;
	}
	throw new Error(`Unsupported code tab resource type '${descriptor.type}' for '${descriptor.path}'.`);
}

export async function save(runtime: Runtime): Promise<void> {
	const context = getActiveCodeTabContext();
	const source = captureActiveCodeTabSource();
	const targetPath = context.descriptor.path;
	const previousAppliedGeneration = context.appliedGeneration;
	try {
		if (context.mode === 'lua') {
			await saveLuaResourceSource(runtime, targetPath, source);
		} else {
			await persistWorkspaceSourceFile(targetPath, source, runtime.cartProjectRootPath);
		}
		setWorkspaceCachedSources([targetPath, buildDirtyFilePath(targetPath)], source);
		commitActiveCodeTabSave(context, source);
		if (context.mode === 'lua') {
			setContextRuntimeSyncState(context, 'restart_pending', null);
			showEditorMessage(`${context.title} saved (restart pending)`, constants.COLOR_STATUS_SUCCESS, 2.5);
			return;
		}
		try {
			applyAemSourceToRuntime(runtime, context.descriptor, source);
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
		if (context.mode === 'lua' && tryShowLuaErrorOverlay(runtime, error)) {
			return;
		}
		showEditorMessage(extractErrorMessage(error), constants.COLOR_STATUS_ERROR, 4.0);
	}
}
