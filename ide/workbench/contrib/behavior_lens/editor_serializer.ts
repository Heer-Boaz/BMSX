import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { BehaviorLensController } from './controller';
import type { BehaviorLensInput } from './editor_input';
import type { BehaviorLensViewState } from './view_model';
import { captureBehaviorLensView, restoreBehaviorLensView, type BehaviorLensViewSnapshot } from './view_snapshot';

export type SerializedBehaviorLensInput = {
	readonly source: TextFileModelSnapshot;
	readonly presentation: BehaviorLensViewState['presentation']['kind'];
	readonly view: BehaviorLensViewSnapshot;
};

export class BehaviorLensInputSerializer implements EditorInputSerializer<BehaviorLensInput> {
	public constructor(private readonly storage: KeyValueStorage, private readonly sources: RuntimeSourceState,
		private readonly controller: BehaviorLensController) {}

	public serialize(input: BehaviorLensInput): string {
		const state: SerializedBehaviorLensInput = { source: captureTextFileModel(input.workingCopy),
			presentation: input.view.presentation.kind, view: captureBehaviorLensView(input) };
		return JSON.stringify(state);
	}

	public async deserialize(value: string): Promise<BehaviorLensInput> {
		const state: SerializedBehaviorLensInput = JSON.parse(value);
		const { model, sameSource } = await resolveTextFileModelSnapshot(this.storage, this.sources, state.source);
		const input = this.controller.createInput(model, state.presentation);
		if (sameSource) restoreBehaviorLensView(input, state.view);
		input.updateLabel();
		return input;
	}
}
