import { engineCore } from '../../../core/engine';
import type { Runtime } from '../../../machine/runtime/runtime';
import * as luaPipeline from '../../runtime/lua_pipeline';
import { editorDocumentState } from '../../editor/editing/document_state';
import { editorViewState } from '../../editor/ui/view/state';
import { clearWorkspaceCachedSources, deleteWorkspaceCachedSources, getWorkspaceCachedSource, listWorkspaceCachedPaths, setWorkspaceCachedSources } from '../../workspace/cache';
import { restoreSnapshot } from '../../editor/editing/undo_controller';
import { resetNavigationHistoryState } from '../../navigation/navigation_history';
import { editorDebuggerState } from '../contrib/debugger/state';
import {
	findCodeTabContext,
	getActiveCodeTabContextId,
	getCodeTabContexts,
	setTabDirty,
	updateActiveContextDirtyFlag,
} from '../ui/code_tab/contexts';
import { getActiveTabId } from '../ui/tabs';
import { serializeBreakpoints } from '../contrib/debugger/controller';
import { buildDirtyFilePath, deleteDirtyBuffer, getWorkspaceDirtyDirSegment, hasWorkspaceStorage, writeDirtyBuffer } from './io';
import { workspaceState } from './state';
import { applySourceToContext, buildSnapshotFromBuffer, captureContextSnapshotMetadata, captureContextText } from './context_snapshot';
import type { DirtyContextEntry, PersistedDirtyEntry, SerializedDescriptor, WorkspaceAutosavePayload } from './models';

export function collectDirtyContextEntries(): Map<string, DirtyContextEntry> {
	if (!hasWorkspaceStorage()) {
		return new Map();
	}
	const entries = new Map<string, DirtyContextEntry>();
	for (const context of getCodeTabContexts()) {
		if (!context.dirty) {
			continue;
		}
		const descriptor: SerializedDescriptor = {
			path: context.descriptor.path,
			type: context.descriptor.type,
			asset_id: context.descriptor.asset_id,
			readOnly: context.descriptor.readOnly,
		};
		const metadata = captureContextSnapshotMetadata(context);
		const dirtyPath = buildDirtyFilePath(descriptor.path);
		const text = captureContextText(context);
		setWorkspaceCachedSources([dirtyPath, descriptor.path], text);
		entries.set(dirtyPath, {
			contextId: context.id,
			descriptor,
			dirtyPath,
			cursorRow: metadata.cursorRow,
			cursorColumn: metadata.cursorColumn,
			scrollRow: metadata.scrollRow,
			scrollColumn: metadata.scrollColumn,
			selectionAnchor: metadata.selectionAnchor ? { row: metadata.selectionAnchor.row, column: metadata.selectionAnchor.column } : null,
			text,
		});
	}
	return entries;
}

export function buildWorkspaceAutosavePayload(runtime: Runtime, entries: Map<string, DirtyContextEntry>): WorkspaceAutosavePayload {
	if (!workspaceState.autosaveEnabled) {
		return null;
	}
	const dirtyFiles: PersistedDirtyEntry[] = [];
	for (const entry of entries.values()) {
		dirtyFiles.push({
			contextId: entry.contextId,
			descriptor: entry.descriptor,
			dirtyPath: entry.dirtyPath,
			cursorRow: entry.cursorRow,
			cursorColumn: entry.cursorColumn,
			scrollRow: entry.scrollRow,
			scrollColumn: entry.scrollColumn,
			selectionAnchor: entry.selectionAnchor ? { row: entry.selectionAnchor.row, column: entry.selectionAnchor.column } : null,
		});
	}
	return {
		savedAt: engineCore.platform.clock.dateNow(),
		dirtyFiles,
		breakpoints: serializeBreakpoints(),
		fontVariant: editorViewState.fontVariant,
		overlayResolutionMode: runtime ? runtime.overlayResolutionMode : undefined,
	};
}

export function buildWorkspaceAutosaveSignature(payload: WorkspaceAutosavePayload): string {
	const dirtyParts = payload.dirtyFiles
		.map((dirty) => {
			const selection = dirty.selectionAnchor ? `${dirty.selectionAnchor.row}:${dirty.selectionAnchor.column}` : '';
			const descriptorKey = `${dirty.descriptor.path}:${dirty.descriptor.type}`;
			return [
				dirty.dirtyPath,
				descriptorKey,
				dirty.cursorRow,
				dirty.cursorColumn,
				dirty.scrollRow,
				dirty.scrollColumn,
				selection,
			].join(':');
		})
		.sort();
	const breakpointEntries = payload.breakpoints
		? Object.keys(payload.breakpoints)
			.sort()
			.map(path => `${path}:${payload.breakpoints[path].join(',')}`)
		: [];
	return [
		payload.fontVariant ?? '',
		payload.overlayResolutionMode ?? '',
		dirtyParts.join('|'),
		breakpointEntries.join('|'),
	].join('#');
}

export async function persistDirtyContextEntries(entries: Map<string, DirtyContextEntry>): Promise<void> {
	const activeDirtyPaths = new Set<string>();
	for (const [dirtyPath, entry] of entries) {
		activeDirtyPaths.add(dirtyPath);
		const cached = getWorkspaceCachedSource(dirtyPath);
		if (cached === entry.text) {
			continue;
		}
		await writeDirtyBuffer(dirtyPath, entry.text);
		setWorkspaceCachedSources([dirtyPath, entry.descriptor.path], entry.text);
	}
	for (const cachedPath of Array.from(listWorkspaceCachedPaths())) {
		if (!cachedPath.includes(`/${getWorkspaceDirtyDirSegment()}/`)) {
			continue;
		}
		if (activeDirtyPaths.has(cachedPath)) {
			continue;
		}
		await deleteDirtyBuffer(cachedPath);
		deleteWorkspaceCachedSources([cachedPath]);
	}
}

export function loadCleanSrc(runtime: Runtime, path: string): string {
	const context = findCodeTabContext(path);
	if (context && context.mode === 'aem') {
		return context.lastSavedSource;
	}
	return luaPipeline.resourceSourceForChunk(runtime, path);
}

export function clearWorkspaceDirtyBuffers(runtime: Runtime): void {
	clearWorkspaceCachedSources();
	workspaceState.autosaveSignature = null;
	editorDocumentState.saveGeneration = editorDocumentState.appliedGeneration;
	editorDocumentState.dirty = false;
	editorDocumentState.undoStack.length = 0;
	editorDocumentState.redoStack.length = 0;
	editorDocumentState.lastHistoryKey = null;
	editorDocumentState.lastHistoryTimestamp = 0;
	editorDocumentState.savePointDepth = 0;
	for (const context of getCodeTabContexts()) {
		const source = loadCleanSrc(runtime, context.descriptor.path);
		applySourceToContext(context, source);
		context.dirty = false;
		context.saveGeneration = editorDocumentState.saveGeneration;
		context.appliedGeneration = editorDocumentState.appliedGeneration;
		context.lastSavedSource = source;
		context.undoStack.length = 0;
		context.redoStack.length = 0;
		context.lastHistoryKey = null;
		context.lastHistoryTimestamp = 0;
		context.savePointDepth = 0;
		setTabDirty(context.id, false);
		if (getActiveCodeTabContextId() === context.id && getActiveTabId() === context.id) {
			restoreSnapshot(buildSnapshotFromBuffer(context), { preserveScroll: false });
			updateActiveContextDirtyFlag();
		}
	}
	updateActiveContextDirtyFlag();
}

export function clearWorkspaceSessionStateData(): void {
	editorDocumentState.undoStack.length = 0;
	editorDocumentState.redoStack.length = 0;
	editorDocumentState.lastHistoryKey = null;
	editorDocumentState.lastHistoryTimestamp = 0;
	editorDocumentState.savePointDepth = 0;
	editorDocumentState.dirty = false;
	for (const context of getCodeTabContexts()) {
		context.undoStack.length = 0;
		context.redoStack.length = 0;
		context.lastHistoryKey = null;
		context.lastHistoryTimestamp = 0;
		context.savePointDepth = 0;
		context.dirty = false;
		setTabDirty(context.id, false);
	}
	resetNavigationHistoryState();
	editorDebuggerState.breakpoints.clear();
	workspaceState.autosaveSignature = null;
	workspaceState.autosaveQueued = false;
	workspaceState.autosaveRunning = false;
}
