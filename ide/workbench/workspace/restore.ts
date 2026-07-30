import type { RuntimeDebuggerState } from '../../runtime/debugger_state';
import {
	resolveRuntimeResource,
	runtimeSourceProjectRootPath,
	type RuntimeSourceState,
} from '../../runtime/sources';
import type { CartEditor } from '../../cart_editor';
import { restoreBreakpointsFromPayload } from '../contrib/debugger/controller';
import { initializeTabs } from '../ui/tabs';
import {
	clearCodeTabContexts,
	createEntryTabContext,
	findCodeTabContext,
} from '../ui/code_tab/contexts';
import { openCodeTabForResource } from '../ui/code_tab/io';
import { buildWorkspaceDirtyEntryPath } from '../../workspace/files';
import { restoreWorkspaceContextSource } from './context_snapshot';
import { workspaceDirtyRecords } from './state';
import {
	type PersistedDirtyEntry,
	type WorkspaceAutosavePayload,
} from './models';
import type { KeyValueStorage } from '../../workspace/key_value_storage';

export async function applyWorkspaceAutosavePayload(
	storage: KeyValueStorage,
	editor: CartEditor,
	sources: RuntimeSourceState,
	debuggerState: RuntimeDebuggerState,
	payload: WorkspaceAutosavePayload,
): Promise<void> {
	clearCodeTabContexts();
	initializeTabs(createEntryTabContext(sources));
	editor.setFontVariant(payload.fontVariant);
	await openDirtyFileTabs(storage, editor, sources, payload.dirtyFiles);
	hydrateDirtyFiles(sources, payload.dirtyFiles);
	restoreBreakpointsFromPayload(debuggerState, payload.breakpoints);
}

async function openDirtyFileTabs(
	storage: KeyValueStorage,
	editor: CartEditor,
	sources: RuntimeSourceState,
	entries: PersistedDirtyEntry[],
): Promise<void> {
	for (const entry of entries) {
		const resource = resolveRuntimeResource(sources, entry);
		if (!resource) {
			throw new Error(`Workspace resource '${entry.path}' is not installed for domain '${entry.domain}'.`);
		}
		if (!findCodeTabContext(resource)) {
			await openCodeTabForResource(storage, editor, sources, resource);
		}
	}
}

export function hydrateDirtyFiles(
	sources: RuntimeSourceState,
	entries: PersistedDirtyEntry[],
): void {
	for (const entry of entries) {
		const context = findCodeTabContext(entry);
		if (!context) {
			throw new Error(`Failed to restore code tab context for '${entry.path}'.`);
		}
		const projectRootPath = runtimeSourceProjectRootPath(sources, entry.domain);
		const dirtyPath = buildWorkspaceDirtyEntryPath(
			projectRootPath,
			entry.domain,
			entry.path,
		);
		const record = workspaceDirtyRecords.get(dirtyPath);
		if (!record) {
			throw new Error(`Persisted dirty file '${dirtyPath}' was not loaded.`);
		}
		restoreWorkspaceContextSource(context, record.contents, entry, true);
	}
}
