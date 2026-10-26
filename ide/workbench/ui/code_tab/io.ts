import { editorTextModelService } from '../../../editor/model/model_service';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { RuntimeResource } from '../../../common/resource';
import { openEditorTab } from '../tabs';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { CodeEditorInput } from '../../contrib/code_editor/editor_input';
import { resolveLuaTextFileModel, resolveTextFileModel } from '../../services/working_copy/text_file_model';
import type { EditorPanes } from '../../services/editor/editor_panes';

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
	editorPanes: EditorPanes,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
	selection?: EditorTextSelection,
): void {
	const input = resolveLuaCodeEditorInput(sources, resource);
	openEditorTab(editorPanes, input, { selection });
}
