import { setOverlayResolutionMode } from '../../runtime/state';
import type { RuntimeDebuggerState } from '../../runtime/debugger_state';
import type { OverlayRenderer } from '../../runtime/overlay_renderer';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { CartEditor } from '../../cart_editor';
import { machineManager } from '../../../machine/ts/core/machine_manager';
import { restoreBreakpointsFromPayload } from '../contrib/debugger/controller';
import { initializeTabs } from '../ui/tabs';
import {
	clearCodeTabContexts,
	createEntryTabContext,
	findCodeTabContext,
} from '../ui/code_tab/contexts';
import { openCodeTabForResource } from '../ui/code_tab/io';
import { workspaceFileCache } from '../../workspace/cache';
import { readWorkspaceFile, readWorkspaceStateFile } from './io';
import { restoreWorkspaceContextSource } from './context_snapshot';
import { buildWorkspaceAutosaveSignature } from './autosave';
import {
	WORKSPACE_AUTOSAVE_VERSION,
	type PersistedDirtyEntry,
	type WorkspaceAutosavePayload,
} from './models';
import { resolveRuntimeResource } from '../../runtime/sources';

export async function restoreWorkspaceSessionFromDisk(
	editor: CartEditor,
	sources: RuntimeSourceState,
	debuggerState: RuntimeDebuggerState,
	overlayRenderer: OverlayRenderer,
): Promise<string> {
	const stateText = await readWorkspaceStateFile();
	if (!stateText) {
		return null;
	}
	let payload: WorkspaceAutosavePayload;
	try {
		payload = JSON.parse(stateText);
	} catch (error) {
		console.warn('[CartEditor] Failed to parse workspace session state:', error);
		return null;
	}
	if (payload.version !== WORKSPACE_AUTOSAVE_VERSION) {
		throw new Error(`Unsupported workspace autosave version '${payload.version}'.`);
	}
	await applyWorkspaceAutosavePayload(editor, sources, debuggerState, overlayRenderer, payload);
	return buildWorkspaceAutosaveSignature(payload);
}

export async function applyWorkspaceAutosavePayload(
	editor: CartEditor,
	sources: RuntimeSourceState,
	debuggerState: RuntimeDebuggerState,
	overlayRenderer: OverlayRenderer,
	payload: WorkspaceAutosavePayload,
): Promise<void> {
	clearCodeTabContexts();
	initializeTabs(createEntryTabContext(sources));
	if (payload.fontVariant) {
		editor.setFontVariant(payload.fontVariant);
	}
	if (payload.overlayResolutionMode) {
		setOverlayResolutionMode(
			overlayRenderer,
			editor,
			machineManager.view,
			payload.overlayResolutionMode,
		);
	}
	await openDirtyFileTabs(editor, sources, payload.dirtyFiles);
	await hydrateDirtyFiles(payload.dirtyFiles);
	restoreBreakpointsFromPayload(debuggerState, payload.breakpoints);
}

async function openDirtyFileTabs(
	editor: CartEditor,
	sources: RuntimeSourceState,
	entries: PersistedDirtyEntry[],
): Promise<void> {
	for (const entry of entries) {
		const resource = resolveRuntimeResource(sources, entry.resource);
		if (!resource) {
			throw new Error(`Workspace resource '${entry.resource.path}' is not installed for domain '${entry.resource.domain}'.`);
		}
		if (!findCodeTabContext(resource)) {
			await openCodeTabForResource(editor.resourcePanel, sources, resource);
		}
	}
}

export async function hydrateDirtyFiles(entries: PersistedDirtyEntry[]): Promise<void> {
	for (const entry of entries) {
		const context = findCodeTabContext(entry.resource);
		if (!context) {
			throw new Error(`Failed to restore code tab context for '${entry.resource.path}'.`);
		}
		const contents = await readWorkspaceFile(entry.dirtyPath);
		if (contents === null) {
			continue;
		}
		workspaceFileCache.set(entry.dirtyPath, contents);
		restoreWorkspaceContextSource(context, contents, entry, true);
	}
}
