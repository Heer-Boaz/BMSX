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
	sourceState: RuntimeSourceState,
	payload: LegacyWorkspaceAutosavePayload,
	projectRootPath: string,
): WorkspaceAutosavePayload {
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

export async function restoreWorkspaceSessionFromDisk(
	editor: CartEditor,
	sources: RuntimeSourceState,
	debuggerState: RuntimeDebuggerState,
	overlayRenderer: OverlayRenderer,
	projectRootPath: string,
): Promise<string> {
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
	if (storedVersion && storedVersion !== WORKSPACE_AUTOSAVE_VERSION) {
		throw new Error(`Unsupported workspace autosave version '${storedVersion}'.`);
	}
	const payload = storedVersion
		? storedPayload as WorkspaceAutosavePayload
		: migrateLegacyWorkspaceAutosavePayload(sources, storedPayload as LegacyWorkspaceAutosavePayload, projectRootPath);
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
		if (!findCodeTabContext(entry.descriptor)) {
			await openCodeTabForDescriptor(editor.resourcePanel, sources, entry.descriptor);
		}
	}
}

export async function hydrateDirtyFiles(entries: PersistedDirtyEntry[]): Promise<void> {
	for (const entry of entries) {
		const context = findCodeTabContext(entry.descriptor);
		if (!context) {
			throw new Error(`Failed to restore code tab context for '${entry.descriptor.path}'.`);
		}
		const contents = await readWorkspaceFile(entry.dirtyPath);
		if (contents === null) {
			continue;
		}
		workspaceFileCache.set(entry.dirtyPath, contents);
		restoreWorkspaceContextSource(context, contents, entry, true);
	}
}
