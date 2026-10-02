import { captureWorkbenchTreeView, restoreWorkbenchTreeView, type WorkbenchTreeViewSnapshot } from '../../ui/tree_view';
import { editorTextModelService } from '../../../editor/model/model_service';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { LuaProgramController } from './controller';
import { LuaProgramInput } from './editor_input';
import type { LuaProgramKind } from './source';
import type { TrackedTextRange } from '../../../editor/text/text_change';

type ProgramSnapshot = { readonly source: TextFileModelSnapshot; readonly dependencies: readonly TextFileModelSnapshot[];
	readonly kind: LuaProgramKind; readonly occurrence: TrackedTextRange; readonly view: WorkbenchTreeViewSnapshot };

export class LuaProgramInputSerializer implements EditorInputSerializer<LuaProgramInput> {
	public constructor(private readonly sources: RuntimeSourceState, private readonly controller: LuaProgramController) {}
	public serialize(input: LuaProgramInput): string {
		const state: ProgramSnapshot = { source: captureTextFileModel(input.workingCopy), dependencies: input.getWorkingCopies()
			.filter(model => model !== input.workingCopy).map(captureTextFileModel), kind: input.programKind,
			occurrence: input.occurrenceRange, view: captureWorkbenchTreeView(input.tree, element => element.key) };
		return JSON.stringify(state);
	}
	public async deserialize(value: string): Promise<LuaProgramInput> {
		const state: ProgramSnapshot = JSON.parse(value);
		const { model, sameSource } = await resolveTextFileModelSnapshot(editorTextModelService, this.sources, state.source);
		let sameDependencies = true;
		for (const dependency of state.dependencies) {
			const resolved = await resolveTextFileModelSnapshot(editorTextModelService, this.sources, dependency);
			if (!resolved.sameSource) sameDependencies = false;
		}
		const input = new LuaProgramInput(model, state.kind, state.occurrence, this.controller.guest);
		this.controller.refresh(input);
		if (sameSource && sameDependencies) {
			restoreWorkbenchTreeView(input.tree, state.view, element => element.key);
		}
		return input;
	}
}
