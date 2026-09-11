import type { RuntimeSourceState } from '../../../runtime/sources';
import type { RuntimeResource } from '../../../common/resource';
import { openEditorTab } from '../tabs';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { resolveCodeEditorInput, retainLuaCodeTabContext, retainModelCodeTabContext } from './contexts';
import { resolveTextFileModel } from '../../services/working_copy/text_file_model';
import type { EditorPanes } from '../../services/editor/editor_panes';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { CodeEditorInput } from '../tab/model';

export function resolveLuaCodeEditorInput(sources: RuntimeSourceState, resource: RuntimeResource): CodeEditorInput {
	return resolveCodeEditorInput(retainLuaCodeTabContext(sources, resource));
}

export async function resolveAemCodeEditorInput(
	storage: KeyValueStorage,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): Promise<CodeEditorInput> {
	const model = await resolveTextFileModel(storage, sources, resource);
	return resolveCodeEditorInput(retainModelCodeTabContext(model));
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
