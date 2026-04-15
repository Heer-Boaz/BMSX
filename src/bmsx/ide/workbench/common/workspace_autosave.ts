import { $ } from '../../../core/engine_core';
import { Runtime } from '../../../emulator/runtime';
import * as runtimeLuaPipeline from '../../../emulator/runtime_lua_pipeline';
import { editorDocumentState } from '../../editor/editing/editor_document_state';
import { editorSessionState } from '../../editor/ui/editor_session_state';
import { editorViewState } from '../../editor/ui/editor_view_state';
import { clearWorkspaceCachedSources, deleteWorkspaceCachedSources, getWorkspaceCachedSource, listWorkspaceCachedPaths, setWorkspaceCachedSources } from '../../../emulator/workspace_cache';
import { restoreSnapshot } from '../../editor/editing/undo_controller';
import { resetNavigationHistoryState } from '../../editor/navigation/navigation_history';
import { editorDebuggerState } from '../contrib/debugger/debugger_state';
import { findCodeTabContext, setTabDirty, updateActiveContextDirtyFlag } from '../ui/code_tabs';
import { serializeBreakpoints } from '../contrib/debugger/ide_debugger';
import { buildDirtyFilePath, deleteDirtyBuffer, getWorkspaceDirtyDirSegment, hasWorkspaceStorage, writeDirtyBuffer } from './workspace_io';
import { workspaceState } from './workspace_state';
import { applySourceToContext, buildSnapshotFromBuffer, captureContextSnapshotMetadata, captureContextText } from './workspace_context_snapshot';
import type { DirtyContextEntry, PersistedDirtyEntry, SerializedDescriptor, WorkspaceAutosavePayload } from './workspace_types';

export function collectDirtyContextEntries(): Map<string, DirtyContextEntry> {
	if (!hasWorkspaceStorage()) {
		return new Map();
	}
	const entries = new Map<string, DirtyContextEntry>();
	for (const context of editorSessionState.codeTabContexts.values()) {
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

export function buildWorkspaceAutosavePayload(entries: Map<string, DirtyContextEntry>): WorkspaceAutosavePayload {
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
	const runtime = Runtime.instance;
	return {
		savedAt: $.platform.clock.dateNow(),
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

export function loadCleanSrc(path: string): string {
	const context = findCodeTabContext(path);
	if (context && context.mode === 'aem') {
		return context.lastSavedSource;
	}
	return runtimeLuaPipeline.resourceSourceForChunk(Runtime.instance, path);
}

export function clearWorkspaceDirtyBuffers(): void {
	clearWorkspaceCachedSources();
	workspaceState.autosaveSignature = null;
	editorDocumentState.saveGeneration = editorDocumentState.appliedGeneration;
	editorDocumentState.dirty = false;
	editorDocumentState.undoStack.length = 0;
	editorDocumentState.redoStack.length = 0;
	editorDocumentState.lastHistoryKey = null;
	editorDocumentState.lastHistoryTimestamp = 0;
	editorDocumentState.savePointDepth = 0;
	for (const context of editorSessionState.codeTabContexts.values()) {
		const source = loadCleanSrc(context.descriptor.path);
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
		if (editorSessionState.activeCodeTabContextId === context.id && editorSessionState.activeTabId === context.id) {
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
	for (const context of editorSessionState.codeTabContexts.values()) {
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
