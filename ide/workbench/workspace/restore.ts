import { machineManager } from '../../../machine/ts/core/machine_manager';
import type { ResourceDescriptor } from '../../common/models';
import { restoreBreakpointsFromPayload } from '../contrib/debugger/controller';
import * as workbenchMode from '../mode';
import { initializeTabs } from '../ui/tabs';
import {
	clearCodeTabContexts,
	createEntryTabContext,
	findCodeTabContext,
} from '../ui/code_tab/contexts';
import { openCodeTabForDescriptor } from '../ui/code_tab/io';
import { workspaceFileCache } from '../../workspace/cache';
import { readWorkspaceFile, readWorkspaceStateFile } from './io';
import { restoreWorkspaceContextSource } from './context_snapshot';
import { buildWorkspaceAutosaveSignature } from './autosave';
import {
	WORKSPACE_AUTOSAVE_VERSION,
	type LegacyWorkspaceAutosavePayload,
	type PersistedDirtyEntry,
	type StoredWorkspaceAutosavePayload,
	type WorkspaceAutosavePayload,
} from './models';
import {
	resolveRuntimeLuaSourceForContext,
	runtimeSourceDomainForProjectRootPath,
} from '../../runtime/sources';

function migrateLegacyWorkspaceAutosavePayload(
	payload: LegacyWorkspaceAutosavePayload,
	projectRootPath: string,
): WorkspaceAutosavePayload {
	const sourceState = machineManager.sourceState;
	const workspaceDomain = runtimeSourceDomainForProjectRootPath(sourceState, projectRootPath);
	const dirtyFiles: PersistedDirtyEntry[] = payload.dirtyFiles.map(entry => {
		const domain = entry.descriptor.type === 'lua'
			? resolveRuntimeLuaSourceForContext(sourceState, workspaceDomain, entry.descriptor.path)!.domain
			: workspaceDomain;
		return {
			descriptor: {
				domain,
				path: entry.descriptor.path,
				type: entry.descriptor.type,
				asset_id: entry.descriptor.asset_id,
				readOnly: entry.descriptor.readOnly,
			},
			dirtyPath: entry.dirtyPath,
			cursorRow: entry.cursorRow,
			cursorColumn: entry.cursorColumn,
			scrollRow: entry.scrollRow,
			scrollColumn: entry.scrollColumn,
			selectionAnchor: entry.selectionAnchor,
		};
	});
	return {
		version: WORKSPACE_AUTOSAVE_VERSION,
		savedAt: payload.savedAt,
		dirtyFiles,
		breakpoints: payload.breakpoints,
		fontVariant: payload.fontVariant,
		overlayResolutionMode: payload.overlayResolutionMode,
	};
}

export async function restoreWorkspaceSessionFromDisk(projectRootPath: string): Promise<string> {
	const stateText = await readWorkspaceStateFile();
	if (!stateText) {
		return null;
	}
	let storedPayload: StoredWorkspaceAutosavePayload = null;
	try {
		storedPayload = JSON.parse(stateText) as StoredWorkspaceAutosavePayload;
	} catch (error) {
		console.warn('[CartEditor] Failed to parse workspace session state:', error);
		return null;
	}
	if (!storedPayload) {
		return null;
	}
	const storedVersion: number | undefined = storedPayload.version;
	if (storedVersion !== undefined && storedVersion !== WORKSPACE_AUTOSAVE_VERSION) {
		throw new Error(`Unsupported workspace autosave version '${storedVersion}'.`);
	}
	const payload = storedVersion === undefined
		? migrateLegacyWorkspaceAutosavePayload(storedPayload as LegacyWorkspaceAutosavePayload, projectRootPath)
		: storedPayload as WorkspaceAutosavePayload;
	await applyWorkspaceAutosavePayload(payload);
	return buildWorkspaceAutosaveSignature(payload);
}

export async function applyWorkspaceAutosavePayload(payload: WorkspaceAutosavePayload): Promise<void> {
	clearCodeTabContexts();
	initializeTabs(createEntryTabContext(), machineManager.ideState.editor.resourcePanel);
	if (payload.fontVariant) {
		workbenchMode.setActiveIdeFontVariant(payload.fontVariant);
	}
	await hydrateDirtyFiles(payload.dirtyFiles);
	restoreBreakpointsFromPayload(payload.breakpoints);
}

export async function hydrateDirtyFiles(entries: PersistedDirtyEntry[]): Promise<void> {
	for (const entry of entries) {
		const descriptor: ResourceDescriptor = {
			domain: entry.descriptor.domain,
			path: entry.descriptor.path,
			type: entry.descriptor.type,
			asset_id: entry.descriptor.asset_id,
			readOnly: entry.descriptor.readOnly,
		};
		let context = findCodeTabContext(descriptor);
		if (!context) {
			await openCodeTabForDescriptor(descriptor);
			context = findCodeTabContext(descriptor);
		}
		if (!context) {
			throw new Error(`Failed to restore code tab context for '${descriptor.path}'.`);
		}
		const contents = await readWorkspaceFile(entry.dirtyPath);
		if (contents === null) {
			continue;
		}
		workspaceFileCache.set(entry.dirtyPath, contents);
		restoreWorkspaceContextSource(context, contents, entry, true);
	}
}
