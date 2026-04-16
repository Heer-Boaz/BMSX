import type { ResourceDescriptor } from '../../common/types';
import { restoreBreakpointsFromPayload } from '../contrib/debugger/ide_debugger';
import { Runtime } from '../../../machine/runtime/runtime';
import * as runtimeIde from '../../runtime/runtime_ide';
import { editorDocumentState } from '../../editor/editing/editor_document_state';
import { fetchWorkspaceFile } from '../../workspace/workspace';
import { setFontVariant } from '../../editor/ui/editor_view';
import { initializeTabs } from '../ui/tabs';
import {
	clearCodeTabContexts,
	findCodeTabContext,
	getActiveCodeTabContextId,
	getCodeTabContextById,
	setTabDirty,
	updateActiveContextDirtyFlag,
} from '../ui/code_tab_contexts';
import { openCodeTabForDescriptor } from '../ui/code_tab_io';
import { getActiveTabId } from '../ui/tabs';
import { deleteWorkspaceCachedSources, setWorkspaceCachedSources } from '../../workspace/workspace_cache';
import { restoreSnapshot } from '../../editor/editing/undo_controller';
import { readDirtyBuffer, readWorkspaceStateFile, deleteDirtyBuffer } from './workspace_io';
import { applySourceToContext, buildSnapshotFromBuffer } from './workspace_context_snapshot';
import { buildWorkspaceAutosaveSignature } from './workspace_autosave';
import type { PersistedDirtyEntry, WorkspaceAutosavePayload } from './workspace_types';

export async function restoreWorkspaceSessionFromDisk(): Promise<string> {
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
	await applyWorkspaceAutosavePayload(payload);
	return buildWorkspaceAutosaveSignature(payload);
}

export async function applyWorkspaceAutosavePayload(payload: WorkspaceAutosavePayload): Promise<void> {
	clearCodeTabContexts();
	initializeTabs();
	const runtime = Runtime.instance;
	if (payload.fontVariant) {
		if (runtime) {
			runtimeIde.setActiveIdeFontVariant(runtime, payload.fontVariant);
		} else {
			setFontVariant(payload.fontVariant);
		}
	}
	await hydrateDirtyFiles(payload.dirtyFiles);
	restoreBreakpointsFromPayload(payload.breakpoints);
}

export async function hydrateDirtyFiles(entries: PersistedDirtyEntry[]): Promise<void> {
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
			await openCodeTabForDescriptor(descriptor);
			context = findCodeTabContext(descriptor.path);
		}
		if (!context) {
			throw new Error(`Failed to restore code tab context for '${descriptor.path}'.`);
		}
		const contents = await readDirtyBuffer(entry.dirtyPath);
		if (contents === null) {
			continue;
		}
		const saved = await fetchWorkspaceFile(descriptor.path);
		if (saved && saved.contents !== contents) {
			await deleteDirtyBuffer(entry.dirtyPath);
			deleteWorkspaceCachedSources([entry.dirtyPath, descriptor.path]);
			applySourceToContext(context, saved.contents, entry);
			context.lastSavedSource = saved.contents;
			context.dirty = false;
			context.savePointDepth = context.undoStack.length;
			setTabDirty(context.id, false);
			if (getActiveCodeTabContextId() === context.id && getActiveTabId() === context.id) {
				restoreSnapshot(buildSnapshotFromBuffer(context, entry), { preserveScroll: true });
				editorDocumentState.savePointDepth = context.savePointDepth;
				editorDocumentState.dirty = false;
				updateActiveContextDirtyFlag();
			}
			continue;
		}
		setWorkspaceCachedSources([entry.dirtyPath, descriptor.path], contents);
		applySourceToContext(context, contents, entry);
		context.dirty = true;
		context.savePointDepth = -1;
		setTabDirty(context.id, true);
		if (getActiveCodeTabContextId() === context.id && getActiveTabId() === context.id) {
			restoreSnapshot(buildSnapshotFromBuffer(context, entry), { preserveScroll: true });
			editorDocumentState.savePointDepth = context.savePointDepth;
			editorDocumentState.dirty = true;
			updateActiveContextDirtyFlag();
		}
	}
}
