import type { ResourceDescriptor } from '../../common/models';
import { restoreBreakpointsFromPayload } from '../contrib/debugger/controller';
import type { Runtime } from '../../../machine/runtime/runtime';
import * as workbenchMode from '../mode';
import { initializeTabs } from '../ui/tabs';
import {
	clearCodeTabContexts,
	createEntryTabContext,
	findCodeTabContext,
	getCodeTabContextById,
} from '../ui/code_tab/contexts';
import { openCodeTabForDescriptor } from '../ui/code_tab/io';
import { workspaceSourceCache } from '../../workspace/cache';
import { readWorkspaceFile, readWorkspaceStateFile } from './io';
import { restoreWorkspaceContextSource } from './context_snapshot';
import { buildWorkspaceAutosaveSignature } from './autosave';
import type { PersistedDirtyEntry, WorkspaceAutosavePayload } from './models';

export async function restoreWorkspaceSessionFromDisk(runtime: Runtime): Promise<string> {
	const stateText = await readWorkspaceStateFile();
	if (!stateText) {
		return null;
	}
	let payload: WorkspaceAutosavePayload = null;
	try {
		payload = JSON.parse(stateText) as WorkspaceAutosavePayload;
	} catch (error) {
		console.warn('[CartEditor] Failed to parse workspace session state:', error);
		return null;
	}
	if (!payload) {
		return null;
	}
	await applyWorkspaceAutosavePayload(runtime, payload);
	return buildWorkspaceAutosaveSignature(payload);
}

export async function applyWorkspaceAutosavePayload(runtime: Runtime, payload: WorkspaceAutosavePayload): Promise<void> {
	clearCodeTabContexts();
	initializeTabs(createEntryTabContext(runtime), runtime.editor.resourcePanel);
	if (payload.fontVariant) {
		workbenchMode.setActiveIdeFontVariant(runtime, payload.fontVariant);
	}
	await hydrateDirtyFiles(runtime, payload.dirtyFiles);
	restoreBreakpointsFromPayload(runtime, payload.breakpoints);
}

export async function hydrateDirtyFiles(runtime: Runtime, entries: PersistedDirtyEntry[]): Promise<void> {
	for (const entry of entries) {
		const descriptor: ResourceDescriptor = {
			path: entry.descriptor.path,
			type: entry.descriptor.type,
			asset_id: entry.descriptor.asset_id,
			readOnly: entry.descriptor.readOnly,
		};
		let context = getCodeTabContextById(entry.contextId);
		if (!context) {
			context = findCodeTabContext(descriptor.path);
		}
		if (!context) {
			await openCodeTabForDescriptor(runtime, descriptor);
			context = findCodeTabContext(descriptor.path);
		}
		if (!context) {
			throw new Error(`Failed to restore code tab context for '${descriptor.path}'.`);
		}
		const contents = await readWorkspaceFile(entry.dirtyPath);
		if (contents === null) {
			continue;
		}
		workspaceSourceCache.set(entry.dirtyPath, contents);
		workspaceSourceCache.set(descriptor.path, contents);
		restoreWorkspaceContextSource(context, contents, entry, true);
	}
}
