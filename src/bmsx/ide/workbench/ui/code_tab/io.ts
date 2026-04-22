import { showEditorMessage, showEditorWarningBanner } from '../../../common/feedback_state';
import type { CodeTabContext, CodeTabMode, ResourceDescriptor } from '../../../common/models';
import * as constants from '../../../common/constants';
import { tryShowLuaErrorOverlay } from '../../../runtime/error/navigation';
import { saveLuaResourceSource } from '../../../workspace/workspace';
import { buildDirtyFilePath } from '../../workspace/io';
import { setWorkspaceCachedSources } from '../../../workspace/cache';
import { applyAemSourceToRuntime, loadAemResourceSource, saveAemResourceSource } from '../../../language/aem/editor';
import { extractErrorMessage } from '../../../../lua/value';
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

export function openLuaCodeTab(descriptor: ResourceDescriptor, selection?: CodeTabSelection): void {
	const tabId = buildCodeTabId(descriptor);
	if (!codeTabSessionState.contexts.has(tabId)) {
		codeTabSessionState.contexts.set(tabId, createLuaCodeTabContext(descriptor));
	}
	const context = codeTabSessionState.contexts.get(tabId)!;
	applyCodeTabDescriptor(context, descriptor, 'lua');
	upsertCodeEditorTab(context);
	setActiveTab(tabId, selection);
}

export async function openAemCodeTab(descriptor: ResourceDescriptor): Promise<void> {
	const tabId = buildCodeTabId(descriptor);
	try {
		let context = codeTabSessionState.contexts.get(tabId);
		if (!context) {
			const source = await loadAemResourceSource(descriptor.path);
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
	const source = captureActiveCodeTabSource();
	const targetPath = context.descriptor.path;
	const previousAppliedGeneration = context.appliedGeneration;
	try {
		if (context.mode === 'lua') {
			await saveLuaResourceSource(targetPath, source);
		} else {
			await saveAemResourceSource(targetPath, source);
		}
		setWorkspaceCachedSources([targetPath, buildDirtyFilePath(targetPath)], source);
		commitActiveCodeTabSave(context, source);
		if (context.mode === 'lua') {
			setContextRuntimeSyncState(context, 'restart_pending', null);
			showEditorMessage(`${context.title} saved (restart pending)`, constants.COLOR_STATUS_SUCCESS, 2.5);
			return;
		}
		try {
			applyAemSourceToRuntime(context.descriptor, source);
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
		if (context.mode === 'lua' && tryShowLuaErrorOverlay(error)) {
			return;
		}
		showEditorMessage(extractErrorMessage(error), constants.COLOR_STATUS_ERROR, 4.0);
	}
}
