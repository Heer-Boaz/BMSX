import type { RuntimeBreakpointState } from '../../runtime/debugger_state';
import type { WorkspaceSourceCatalog } from '../../workspace/source_catalog';
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
	editor: Pick<CartEditor, 'editorParts' | 'editorInputSerializers' | 'setFontVariant'>,
	catalog: WorkspaceSourceCatalog,
	debuggerState: RuntimeBreakpointState,
	payload: WorkspaceAutosavePayload,
): Promise<void> {
	editor.editorParts.clear();
	editorTextModelService.clear();
	editor.setFontVariant(payload.fontVariant);
	await restoreWorkspaceDirtyModels(editorTextModelService, catalog, payload.dirtyFiles, workspaceDirtyRecords);
	await editor.editorParts.restore(payload.editorParts, editor.editorInputSerializers);
	debuggerState.breakpoints.restore(payload.breakpoints);
}

export function hydrateDirtyFiles(
	catalog: WorkspaceSourceCatalog,
	entries: PersistedDirtyEntry[],
): void {
	for (const entry of entries) {
		const model = editorTextModelService.get(entry)!;
		const projectRootPath = catalog.getContext(entry.contextId).projectRootPath;
		const dirtyPath = buildWorkspaceDirtyEntryPath(
			projectRootPath,
			entry.contextId,
			entry.path,
		);
		const record = workspaceDirtyRecords.get(dirtyPath);
		if (!record) {
			throw new Error(`Persisted dirty file '${dirtyPath}' was not loaded.`);
		}
		model.restoreDirtySource(record.contents);
	}
}
