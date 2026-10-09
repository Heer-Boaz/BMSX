import { editorTextModelService } from '../../../editor/model/model_service';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { AnimationEditorController } from './controller';
import { AnimationEditorInput, type AnimationSourceSelection } from './editor_input';

type AnimationSnapshot = {
	readonly source: TextFileModelSnapshot;
	readonly dependencies: readonly TextFileModelSnapshot[];
	readonly track: AnimationSourceSelection | undefined;
	readonly key: AnimationSourceSelection | undefined;
	readonly scroll: number;
	readonly cursor: number;
};

export class AnimationInputSerializer implements EditorInputSerializer<AnimationEditorInput> {
	public constructor(private readonly sources: RuntimeSourceState, private readonly controller: AnimationEditorController) {}
	public serialize(input: AnimationEditorInput): string {
		const state: AnimationSnapshot = { source: captureTextFileModel(input.workingCopy),
			dependencies: input.getWorkingCopies().filter(model => model !== input.workingCopy).map(captureTextFileModel),
			track: input.trackSelection, key: input.keySelection, scroll: input.tracks.scroll, cursor: input.keys.cursor };
		return JSON.stringify(state);
	}
	public async deserialize(value: string): Promise<AnimationEditorInput> {
		const state: AnimationSnapshot = JSON.parse(value);
		const primary = await resolveTextFileModelSnapshot(editorTextModelService, this.sources, state.source);
		const input = new AnimationEditorInput(primary.model);
		let sameSource = primary.sameSource;
		for (const dependency of state.dependencies) {
			const resolved = await resolveTextFileModelSnapshot(editorTextModelService, this.sources, dependency);
			input.sourceModels.set(resolved.model.resource.path, resolved.model);
			if (!resolved.sameSource) sameSource = false;
		}
		if (sameSource) { input.trackSelection = state.track; input.keySelection = state.key; input.tracks.scroll = state.scroll; input.keys.cursor = state.cursor; }
		input.publishModels(); this.controller.refresh(input);
		return input;
	}
}
