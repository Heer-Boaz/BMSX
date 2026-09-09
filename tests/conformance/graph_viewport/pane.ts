import type { PlayerInput } from '../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../ide/common/models';
import { inputFocus } from '../../../ide/input/focus';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { createCodeEditorViewState } from '../../../ide/editor/ui/code_editor_state';
import { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import { EditorPane } from '../../../ide/workbench/services/editor/editor_pane';
import { EditorPanes } from '../../../ide/workbench/services/editor/editor_panes';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../../ide/workbench/ui/graph/control';
import type { WorkbenchGraphViewport } from '../../../ide/workbench/ui/graph/viewport';
import { drawWorkbenchGraph } from '../../../ide/workbench/render/graph';

/** A domain-free test contribution, mounted by the production editor-group owner. */
class GraphFixturePane extends EditorPane<CodeEditorInput> {
	public readonly graph = new WorkbenchGraphControl(inputFocus, pointerCapture);
	public result = WorkbenchGraphPointerResult.Outside;
	public constructor(private readonly views: ReadonlyMap<CodeEditorInput, WorkbenchGraphViewport>) { super(); }
	protected activate(): void { this.graph.setInput(this.views.get(this.input)!); }
	public focus(): void { this.graph.focusTarget.focus(); }
	public override clearInput(): void { this.graph.clearInput(); super.clearInput(); }
	public dispose(): void { this.graph.dispose(); }
	public draw(): void { drawWorkbenchGraph(this.views.get(this.input)!, this.graph.hover, this.graph.focusTarget.hasFocus); }
	public handleKeyboard(input: PlayerInput): void { inputFocus.handleKeyboard(input); }
	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean, _secondary: boolean, input: PlayerInput, now: number): void {
		this.result = this.graph.handlePointer(snapshot, justPressed, now);
		if (justPressed && this.result !== WorkbenchGraphPointerResult.Outside) input.inputHandlers.pointer!.consumeButton('pointer_primary');
	}
	public handleWheel(direction: number, steps: number, snapshot: PointerSnapshot | null, input: PlayerInput): void {
		if (snapshot !== null && this.graph.handleWheel(snapshot, 0, direction * steps * 16)) input.inputHandlers.pointer!.consumeButton('pointer_wheel');
	}
	public drawStatusBar(): void {}
}

export function createGraphFixturePanes(views: readonly WorkbenchGraphViewport[]) {
	// Only use the existing input identity as an editor-group fixture carrier.
	// Neither the text model nor a Lua recognizer builds this graph.
	const inputs = views.map((_, index) => {
		const path = `graph-fixture-${index}.lua`;
		return new CodeEditorInput({ id: `code:0\0${path}`, title: path,
			model: new EditorTextModel({ domain: 0, path, source: { resid: path, type: 'lua' } }, 'lua', ''),
			view: createCodeEditorViewState(), runtimeErrorOverlay: null, executionStopRow: null });
	});
	const pane = new GraphFixturePane(new Map(inputs.map((input, index) => [input, views[index]])));
	const unused = (): never => { throw new Error('Only the domain-free fixture is registered in this editor group'); };
	const panes = new EditorPanes({ code_editor: () => pane, behavior_lens: unused, resource_view: unused, scenario_lab: unused, scene_editor: unused });
	return { inputs, pane, panes };
}
