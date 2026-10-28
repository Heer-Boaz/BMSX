import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { SceneEditorController } from './controller';
import { SceneEditorInput } from './editor_input';
import { selectSceneOutlineRow } from './outline';
import { captureSceneEditorView, restoreSceneEditorView, type SceneEditorViewSnapshot } from './view_snapshot';

export type SerializedSceneEditorInput = { readonly source: TextFileModelSnapshot; readonly view: SceneEditorViewSnapshot };

export class SceneEditorInputSerializer implements EditorInputSerializer<SceneEditorInput> {
	public constructor(private readonly catalog: WorkspaceSourceCatalog,
		private readonly controller: SceneEditorController) {}

	public serialize(input: SceneEditorInput): string {
		const state: SerializedSceneEditorInput = { source: captureTextFileModel(input.workingCopy), view: captureSceneEditorView(input.view) };
		return JSON.stringify(state);
	}

	public async deserialize(value: string): Promise<SceneEditorInput> {
		const state: SerializedSceneEditorInput = JSON.parse(value);
		const { model, sameSource } = await resolveTextFileModelSnapshot(editorTextModelService, this.catalog, state.source);
		const input = new SceneEditorInput(model, this.controller.documents, this.controller.createView);
		input.view.refresh();
		if (sameSource) restoreSceneEditorView(input.view, state.view);
		else selectSceneOutlineRow(input.view, -1);
		return input;
	}
}
