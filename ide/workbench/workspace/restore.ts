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
	editor: Pick<CartEditor, 'editorParts' | 'editorInputSerializers' | 'mainWorkspace' | 'resourcePanel' | 'restorePrimaryClient' | 'setFontVariant'>,
	catalog: WorkspaceSourceCatalog,
	debuggerState: RuntimeBreakpointState,
	payload: WorkspaceAutosavePayload,
): Promise<void> {
	editor.editorParts.clear();
	editorTextModelService.clear();
	const primary = editor.mainWorkspace.beginRestore();
	const documents = editor.editorParts.beginRestore();
	const files = editor.resourcePanel.beginRestore();
	try {
		editor.setFontVariant(payload.fontVariant);
		await restoreWorkspaceDirtyModels(editorTextModelService, catalog, payload.dirtyFiles, workspaceDirtyRecords);
		const restoredFiles = files.restore(payload.filesBrowser);
		const primaryRestored = primary.restore(payload.mainWorkspace, (record, regions, scope, isCurrent) =>
			editor.restorePrimaryClient(record, regions, scope, isCurrent));
		const documentsRestored = documents.restore(payload.editorParts, editor.editorInputSerializers,
			{ preserveFocus: payload.filesBrowser.focused || payload.editorParts.active === 0 && payload.mainWorkspace.activeClient !== 'documents' });
		const [restoredPrimary, restoredDocuments] = await Promise.all([primaryRestored, documentsRestored]);
		if (restoredFiles && payload.filesBrowser.focused) files.focus();
		if (!restoredDocuments) return;
		if (!payload.filesBrowser.focused && restoredPrimary && payload.editorParts.active === 0) primary.focusClient();
		debuggerState.breakpoints.restore(payload.breakpoints);
	} finally { primary.dispose(); documents.dispose(); files.dispose(); }
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
