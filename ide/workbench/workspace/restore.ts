import type { RuntimeBreakpointState } from '../../runtime/debugger_state';
import {
	resolveRuntimeResource,
	runtimeSourceProjectRootPath,
	type RuntimeSourceState,
} from '../../runtime/sources';
import type { CartEditor } from '../../cart_editor';
import { restoreBreakpointsFromPayload } from '../contrib/debugger/controller';
import { initializeTabs } from '../ui/tabs';
import {
	clearCodeEditorInputs,
	findCodeTabContext,
	retainEntryTabContext,
} from '../ui/code_tab/contexts';
import { editorTextModelService } from '../../editor/model/model_service';
import { buildWorkspaceDirtyEntryPath } from '../../workspace/files';
import { restoreWorkspaceCodeEditorView } from './context_snapshot';
import { workspaceDirtyRecords } from './state';
import {
	type PersistedCodeEditorView,
	type PersistedDirtyEntry,
	type WorkspaceAutosavePayload,
} from './models';

export async function applyWorkspaceAutosavePayload(
	editor: CartEditor,
	sources: RuntimeSourceState,
	debuggerState: RuntimeBreakpointState,
	payload: WorkspaceAutosavePayload,
): Promise<void> {
	clearCodeEditorInputs();
	editorTextModelService.clear();
	initializeTabs(retainEntryTabContext(sources));
	editor.setFontVariant(payload.fontVariant);
	await retainDirtyFileInputs(editor, sources, payload.dirtyFiles);
	hydrateDirtyFiles(sources, payload.dirtyFiles);
	restoreCodeEditorViews(payload.codeEditorViews);
	restoreBreakpointsFromPayload(debuggerState, payload.breakpoints);
}

async function retainDirtyFileInputs(
	editor: CartEditor,
	sources: RuntimeSourceState,
	entries: PersistedDirtyEntry[],
): Promise<void> {
	for (const entry of entries) {
		const resource = resolveRuntimeResource(sources, entry);
		if (!resource) {
			throw new Error(`Workspace resource '${entry.path}' is not installed for domain '${entry.domain}'.`);
		}
		await editor.resourceEditors.resolveEditorInput(resource);
	}
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

function restoreCodeEditorViews(views: PersistedCodeEditorView[]): void {
	for (let index = 0; index < views.length; index += 1) {
		const view = views[index];
		const context = findCodeTabContext(view)!;
		restoreWorkspaceCodeEditorView(context, view);
	}
}
