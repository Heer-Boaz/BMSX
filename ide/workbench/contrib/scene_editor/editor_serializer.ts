import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { SceneEditorController } from './controller';
import { SceneEditorInput } from './editor_input';
import { selectSceneOutlineRow } from './outline';
import { captureSceneEditorView, restoreSceneEditorView, type SceneEditorViewSnapshot } from './view_snapshot';

export type SerializedSceneEditorInput = { readonly source: TextFileModelSnapshot; readonly view: SceneEditorViewSnapshot };

export class SceneEditorInputSerializer implements EditorInputSerializer<SceneEditorInput> {
	public constructor(private readonly storage: KeyValueStorage, private readonly sources: RuntimeSourceState,
		private readonly controller: SceneEditorController) {}

	public serialize(input: SceneEditorInput): string {
		const state: SerializedSceneEditorInput = { source: captureTextFileModel(input.workingCopy), view: captureSceneEditorView(input) };
		return JSON.stringify(state);
	}

	public async deserialize(value: string): Promise<SceneEditorInput> {
		const state: SerializedSceneEditorInput = JSON.parse(value);
		const { model, sameSource } = await resolveTextFileModelSnapshot(this.storage, this.sources, state.source);
		const input = new SceneEditorInput(model);
		this.controller.refresh(input);
		if (sameSource) restoreSceneEditorView(input, state.view);
		else selectSceneOutlineRow(input, -1);
		return input;
	}
}
