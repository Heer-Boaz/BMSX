import { editorTextModelService } from '../../../editor/model/model_service';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { RuntimeResource } from '../../../common/resource';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { CodeEditorInput } from '../../contrib/code_editor/editor_input';
import { resolveLuaTextFileModel, resolveTextFileModel } from '../../services/working_copy/text_file_model';
import type { EditorGroupView } from '../../services/editor/editor_group';

export function resolveLuaCodeEditorInput(sources: RuntimeSourceState, resource: RuntimeResource): CodeEditorInput {
	return new CodeEditorInput(resolveLuaTextFileModel(editorTextModelService, sources, resource));
}

export async function resolveTextCodeEditorInput(
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): Promise<CodeEditorInput> {
	const model = await resolveTextFileModel(editorTextModelService, sources, resource);
	return new CodeEditorInput(model);
}

export function openLuaCodeTab(
	editorGroup: EditorGroupView,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
	selection?: EditorTextSelection,
): void {
	const input = resolveLuaCodeEditorInput(sources, resource);
	editorGroup.openEditor(input, { selection });
}
