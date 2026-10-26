import type { RuntimeBreakpointState } from '../../runtime/debugger_state';
import {
	runtimeSourceProjectRootPath,
	type RuntimeSourceState,
} from '../../runtime/sources';
import type { CartEditor } from '../../cart_editor';
import { editorTextModelService } from '../../editor/model/model_service';
import { buildWorkspaceDirtyEntryPath } from '../../workspace/files';
import { workspaceDirtyRecords } from './state';
import { restoreWorkspaceDirtyModels } from '../services/working_copy/source_recovery';
import {
	type PersistedDirtyEntry,
	type WorkspaceAutosavePayload,
} from './models';

export async function applyWorkspaceAutosavePayload(
	editor: Pick<CartEditor, 'editorGroup' | 'editorInputSerializers' | 'setFontVariant'>,
	sources: RuntimeSourceState,
	debuggerState: RuntimeBreakpointState,
	payload: WorkspaceAutosavePayload,
): Promise<void> {
	editor.editorGroup.panes.clearEditor();
	editor.editorGroup.model.clear();
	editorTextModelService.clear();
	editor.setFontVariant(payload.fontVariant);
	await restoreWorkspaceDirtyModels(editorTextModelService, sources, payload.dirtyFiles, workspaceDirtyRecords);
	await editor.editorGroup.model.deserialize(payload.editorGroup, editor.editorInputSerializers);
	const active = editor.editorGroup.model.activeTab;
	if (active !== null) editor.editorGroup.activate(active.id);
	debuggerState.breakpoints.restore(payload.breakpoints);
}

export function hydrateDirtyFiles(
	sources: RuntimeSourceState,
	entries: PersistedDirtyEntry[],
): void {
	for (const entry of entries) {
		const model = editorTextModelService.get(entry)!;
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
		model.restoreDirtySource(record.contents);
	}
}
