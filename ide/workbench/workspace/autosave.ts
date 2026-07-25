import { machineManager } from '../../../machine/ts/core/machine_manager';
import * as luaPipeline from '../../runtime/lua_pipeline';
import {
	clearWorkspaceSourceCaches,
	workspaceFileCache,
} from '../../workspace/cache';
import { resetNavigationHistoryState } from '../../navigation/navigation_history';
import { editorDebuggerState } from '../contrib/debugger/state';
import {
	findCodeTabContext,
	getCodeTabContexts,
} from '../ui/code_tab/contexts';
import { serializeBreakpoints } from '../contrib/debugger/controller';
import { buildDirtyFilePath, deleteWorkspaceFile, getWorkspaceDirtyDirSegment, hasWorkspaceStorage, writeWorkspaceFile } from './io';
import { workspaceState } from './state';
import {
	captureContextSnapshotMetadata,
	captureContextText,
	clearWorkspaceActiveDocumentSessionState,
	clearWorkspaceContextSessionState,
	resetWorkspaceActiveDocumentDirtyBufferState,
	resetWorkspaceContextToCleanSource,
} from './context_snapshot';
import {
	WORKSPACE_AUTOSAVE_VERSION,
	type DirtyContextEntry,
	type PersistedDirtyEntry,
	type SerializedDescriptor,
	type WorkspaceAutosavePayload,
} from './models';

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
			domain: context.descriptor.domain,
			path: context.descriptor.path,
			type: context.descriptor.type,
			asset_id: context.descriptor.asset_id,
			readOnly: context.descriptor.readOnly,
		};
		const metadata = captureContextSnapshotMetadata(context);
		const dirtyPath = buildDirtyFilePath(descriptor);
		const text = captureContextText(context);
		entries.set(dirtyPath, {
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
		version: WORKSPACE_AUTOSAVE_VERSION,
		savedAt: machineManager.platform.clock.dateNow(),
		dirtyFiles,
		breakpoints: serializeBreakpoints(),
		fontVariant: machineManager.ideState.activeFontVariant,
		overlayResolutionMode: machineManager.ideState.overlayResolutionMode,
	};
}

export function buildWorkspaceAutosaveSignature(payload: WorkspaceAutosavePayload): string {
	const dirtyParts = payload.dirtyFiles
		.map((dirty) => {
			const selection = dirty.selectionAnchor ? `${dirty.selectionAnchor.row}:${dirty.selectionAnchor.column}` : '';
			const descriptorKey = `${dirty.descriptor.domain}:${dirty.descriptor.path}:${dirty.descriptor.type}`;
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
		payload.fontVariant === undefined ? 'font:unset' : `font:${payload.fontVariant}`,
		payload.overlayResolutionMode === undefined ? 'overlay:unset' : `overlay:${payload.overlayResolutionMode}`,
		dirtyParts.join('|'),
		breakpointEntries.join('|'),
	].join('#');
}

export async function persistDirtyContextEntries(entries: Map<string, DirtyContextEntry>): Promise<void> {
	const activeDirtyPaths = new Set<string>();
	for (const [dirtyPath, entry] of entries) {
		activeDirtyPaths.add(dirtyPath);
		const cached = workspaceFileCache.get(dirtyPath);
		if (cached === entry.text) {
			continue;
		}
		await writeWorkspaceFile(dirtyPath, entry.text);
		workspaceFileCache.set(dirtyPath, entry.text);
	}
	for (const cachedPath of workspaceFileCache.keys()) {
		if (!cachedPath.includes(`/${getWorkspaceDirtyDirSegment()}/`)) {
			continue;
		}
		if (activeDirtyPaths.has(cachedPath)) {
			continue;
		}
		await deleteWorkspaceFile(cachedPath);
		workspaceFileCache.delete(cachedPath);
	}
}

export function loadCleanSrc(descriptor: SerializedDescriptor): string {
	const context = findCodeTabContext(descriptor);
	if (context && context.mode === 'aem') {
		return context.lastSavedSource;
	}
	return luaPipeline.resourceSourceForChunk(descriptor);
}

export function clearWorkspaceDirtyBuffers(): void {
	clearWorkspaceSourceCaches();
	workspaceState.autosaveSignature = null;
	resetWorkspaceActiveDocumentDirtyBufferState();
	for (const context of getCodeTabContexts()) {
		resetWorkspaceContextToCleanSource(context, loadCleanSrc(context.descriptor));
	}
}

export function clearWorkspaceSessionStateData(): void {
	clearWorkspaceActiveDocumentSessionState();
	for (const context of getCodeTabContexts()) {
		clearWorkspaceContextSessionState(context);
	}
	resetNavigationHistoryState();
	editorDebuggerState.breakpoints.clear();
	workspaceState.autosaveSignature = null;
	workspaceState.autosaveQueued = false;
	workspaceState.autosaveRunning = false;
}
