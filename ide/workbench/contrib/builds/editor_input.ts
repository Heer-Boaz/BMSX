import { ReadonlyEditorInput } from '../../common/editor_input';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { BuildOutput } from './output';
import { BuildLogViewModel } from './view_model';

let nextViewId = 0;

/** One retained reader over a workspace-owned build observation. */
export class BuildLogInput extends ReadonlyEditorInput<`build-log:${number}`, 'build_log'> {
	public override readonly serializable = false;
	public readonly view: BuildLogViewModel;
	public get resource(): undefined { return undefined; }
	public override canMove(): boolean { return true; }

	public constructor(result: BuildOutput) {
		super(`build-log:${nextViewId++}`, 'build_log', `Build: ${result.job.request.target}`, true);
		this.setLabel(this.title, result.requestId);
		this.view = this.disposables.add(new BuildLogViewModel(result));
	}

	public override matches(other: ReadonlyEditorInput<string, string>): boolean {
		return other instanceof BuildLogInput && other.view.result === this.view.result;
	}
	public createView(): BuildLogInput {
		const input = new BuildLogInput(this.view.result);
		input.view.channel = this.view.channel;
		return input;
	}
}

export function openBuildLog(group: EditorGroupView, result: BuildOutput): BuildLogInput | undefined {
	const input = group.openProducedEditor(() => {
		for (const tab of group.model.tabs) if (tab instanceof BuildLogInput && tab.view.result === result) return tab;
		return new BuildLogInput(result);
	}, { isCurrent: () => !result.isDisposed });
	// Accepted receiver handoff can retire the source while retaining its captured document.
	if (input !== undefined && !result.isDisposed) void result.refresh();
	return input;
}
