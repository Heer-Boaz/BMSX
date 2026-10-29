import type { RuntimeBreakpointState } from '../../runtime/debugger_state';
import type { WorkspaceSourceCatalog } from '../../workspace/source_catalog';
import type { CartEditor } from '../../cart_editor';
import { editorTextModelService } from '../../editor/model/model_service';
import { DisposableStore } from '../../common/lifecycle';
import { workspaceDirtyRecords } from './state';
import { beginWorkspaceDirtyModelRestore } from '../services/working_copy/source_recovery';
import type { WorkspaceAutosavePayload } from './models';

export async function applyWorkspaceAutosavePayload(
	editor: Pick<CartEditor, 'editorParts' | 'editorInputSerializers' | 'mainWorkspace' | 'resourcePanel' | 'restorePrimaryClient' | 'setFontVariant'>,
	catalog: WorkspaceSourceCatalog,
	debuggerState: RuntimeBreakpointState,
	payload: WorkspaceAutosavePayload,
): Promise<void> {
	const lifetime = new DisposableStore();
	try {
		const files = lifetime.add(editor.resourcePanel.beginRestore());
		const documents = lifetime.add(editor.editorParts.beginRestore());
		const primary = lifetime.add(editor.mainWorkspace.beginRestore());
		const sources = lifetime.add(beginWorkspaceDirtyModelRestore(editorTextModelService, catalog, payload.dirtyFiles, workspaceDirtyRecords));
		primary.prepare(); documents.prepare();
		sources.publish();
		editor.setFontVariant(payload.fontVariant);
		primary.retire(); files.prepare(); documents.retire();
		sources.dispose();
		if (!sources.isCurrent()) return;
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
	} finally { lifetime.dispose(); }
}
