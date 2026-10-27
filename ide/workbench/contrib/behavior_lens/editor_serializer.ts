import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { BehaviorLensController } from './controller';
import type { BehaviorLensInput } from './editor_input';
import type { BehaviorLensViewState } from './view_model';
import { captureBehaviorLensView, restoreBehaviorLensView, type BehaviorLensViewSnapshot } from './view_snapshot';

export type SerializedBehaviorLensInput = { readonly version: 1;
	readonly source: TextFileModelSnapshot;
	readonly dependencies: readonly TextFileModelSnapshot[];
	readonly presentation: BehaviorLensViewState['presentation']['kind'];
	readonly view: BehaviorLensViewSnapshot;
};

export class BehaviorLensInputSerializer implements EditorInputSerializer<BehaviorLensInput> {
	public constructor(private readonly catalog: WorkspaceSourceCatalog,
		private readonly controller: BehaviorLensController) {}

	public serialize(input: BehaviorLensInput): string {
		const dependencies: TextFileModelSnapshot[] = [];
		for (const model of input.view.source.models.values()) {
			if (model !== input.workingCopy) dependencies.push(captureTextFileModel(model));
		}
		const state: SerializedBehaviorLensInput = { version: 1, source: captureTextFileModel(input.workingCopy),
			dependencies, presentation: input.view.presentation.kind, view: captureBehaviorLensView(input) };
		return JSON.stringify(state);
	}

	public async deserialize(value: string): Promise<BehaviorLensInput> {
		const state: SerializedBehaviorLensInput = JSON.parse(value);
		if (state.version !== 1) throw new Error(`Unsupported behavior lens editor version '${state.version}'.`);
		const { model, sameSource } = await resolveTextFileModelSnapshot(editorTextModelService, this.catalog, state.source);
		let sameDependencies = true;
		for (const dependency of state.dependencies) {
			const resolved = await resolveTextFileModelSnapshot(editorTextModelService, this.catalog, dependency);
			if (!resolved.sameSource) sameDependencies = false;
		}
		const input = this.controller.createInput(model, state.presentation);
		if (sameSource && sameDependencies) restoreBehaviorLensView(input, state.view);
		input.updateDefinition();
		return input;
	}
}
