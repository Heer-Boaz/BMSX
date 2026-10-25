import { editorTextModelService } from '../../../editor/model/model_service';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { AnimationEditorController } from './controller';
import { AnimationEditorInput, type AnimationClient, type AnimationSourceSelection } from './editor_input';
import type { TrackedTextRange } from '../../../editor/text/text_change';

type LegacyAnimationSnapshot = {
	readonly source: TextFileModelSnapshot;
	readonly definition: TrackedTextRange | undefined;
	readonly label: string;
	readonly consumer: string | undefined;
	readonly dependencies: readonly TextFileModelSnapshot[];
	readonly track: AnimationSourceSelection | undefined;
	readonly key: AnimationSourceSelection | undefined;
	readonly detail: AnimationSourceSelection | undefined;
	readonly scroll: number;
	readonly cursor: number;
	/** Source-only selections have no numeric viewport to persist. */
	readonly view?: { readonly minimum: number; readonly maximum: number; readonly snap: boolean };
};

type AnimationSnapshot = LegacyAnimationSnapshot & {
	readonly version: 1;
	readonly client: AnimationClient;
	readonly columnRatio: number;
	readonly rowRatio: number;
};

export class AnimationInputSerializer implements EditorInputSerializer<AnimationEditorInput> {
	public constructor(private readonly sources: RuntimeSourceState, private readonly controller: AnimationEditorController) {}
	public serialize(input: AnimationEditorInput): string {
		const state: AnimationSnapshot = { version: 1, source: captureTextFileModel(input.workingCopy), definition: input.definitionRange, label: input.definitionLabel, consumer: input.consumerPath,
			dependencies: input.getWorkingCopies().filter(model => model !== input.workingCopy).map(captureTextFileModel),
			track: input.trackSelection, key: input.keySelection, detail: input.detailSelection, scroll: input.tracks.scroll, cursor: input.keys.cursor,
			client: input.activeClient, columnRatio: input.columnSplit.ratio, rowRatio: input.rowSplit.ratio,
			view: input.keys.unit === undefined ? undefined : { minimum: input.keys.range.minimum, maximum: input.keys.range.maximum, snap: input.keys.snap } };
		return JSON.stringify(state);
	}
	public async deserialize(value: string): Promise<AnimationEditorInput> {
		const state: AnimationSnapshot | LegacyAnimationSnapshot = JSON.parse(value);
		if ('version' in state && state.version !== 1) throw new Error(`Unsupported animation editor view version '${state.version}'.`);
		const primary = await resolveTextFileModelSnapshot(editorTextModelService, this.sources, state.source);
		const input = new AnimationEditorInput(primary.model, state.definition, state.label, state.consumer);
		if (!primary.sameSource && input.definitionRange !== undefined) input.definitionRange.end = input.definitionRange.start;
		let sameSource = primary.sameSource;
		for (const dependency of state.dependencies) {
			const resolved = await resolveTextFileModelSnapshot(editorTextModelService, this.sources, dependency);
			input.sourceModels.set(resolved.model.resource.path, resolved.model);
			if (!resolved.sameSource) sameSource = false;
		}
		if (sameSource) { input.trackSelection = state.track; input.keySelection = state.key; input.detailSelection = state.detail; input.tracks.scroll = state.scroll; }
		input.publishModels(); this.controller.refresh(input);
		if ('version' in state) {
			input.activeClient = state.client;
			input.columnSplit.ratio = state.columnRatio; input.rowSplit.ratio = state.rowRatio;
		}
		if (sameSource && state.view !== undefined) { input.keys.setView(state.view.minimum, state.view.maximum); input.keys.setCursor(state.cursor); input.keys.snap = state.view.snap; }
		return input;
	}
}
