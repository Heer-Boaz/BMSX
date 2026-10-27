import { editorTextModelService } from '../../../editor/model/model_service';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { RuntimeResource } from '../../../common/resource';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { CodeEditorInput } from '../../contrib/code_editor/editor_input';
import { resolveLuaTextFileModel, resolveTextFileModel } from '../../services/working_copy/text_file_model';
import type { EditorGroupView } from '../../services/editor/editor_group';

export function resolveLuaCodeEditorInput(catalog: WorkspaceSourceCatalog, resource: RuntimeResource): CodeEditorInput {
	return new CodeEditorInput(resolveLuaTextFileModel(editorTextModelService, catalog, resource));
}

export async function resolveTextCodeEditorInput(
	catalog: WorkspaceSourceCatalog,
	resource: RuntimeResource,
): Promise<CodeEditorInput> {
	const model = await resolveTextFileModel(editorTextModelService, catalog, resource);
	return new CodeEditorInput(model);
}

export function openLuaCodeTab(
	editorGroup: EditorGroupView,
	catalog: WorkspaceSourceCatalog,
	resource: RuntimeResource,
	selection?: EditorTextSelection,
): void {
	const input = resolveLuaCodeEditorInput(catalog, resource);
	editorGroup.openEditor(input, { selection });
}
