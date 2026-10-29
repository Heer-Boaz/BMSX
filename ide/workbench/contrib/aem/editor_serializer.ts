import { captureWorkbenchTreeView, restoreWorkbenchTreeView, type WorkbenchTreeViewSnapshot } from '../../ui/tree_view';
import { editorTextModelService } from '../../../editor/model/model_service';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { AemEditorInput } from './editor_input';
import { projectAemSource } from './source';

type AemSnapshot = { readonly source: TextFileModelSnapshot; readonly view: WorkbenchTreeViewSnapshot };
export class AemEditorInputSerializer implements EditorInputSerializer<AemEditorInput> {
	public constructor(private readonly catalog: WorkspaceSourceCatalog) {}
	public serialize(input: AemEditorInput): string {
		const state: AemSnapshot = { source: captureTextFileModel(input.workingCopy), view: captureWorkbenchTreeView(input.tree, element => element.key) };
		return JSON.stringify(state);
	}
	public async deserialize(value: string): Promise<AemEditorInput> {
		const state: AemSnapshot = JSON.parse(value);
		const { model, sameSource } = await resolveTextFileModelSnapshot(editorTextModelService, this.catalog, state.source);
		const input = new AemEditorInput(model);
		projectAemSource(input);
		if (sameSource) {
			restoreWorkbenchTreeView(input.tree, state.view, element => element.key);
			input.sourceSelection.restore(input.tree.rows[input.tree.selectionIndex]?.element.sourceIdentity);
		}
		return input;
	}
}
