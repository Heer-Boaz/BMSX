import type { KeyInputEvent } from '../../../hosts/common/input/text';
import { pointerHover } from '../../../ide/input/pointer/hover';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../ide/common/models';
import { inputFocus } from '../../../ide/input/focus';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import { EditorPane } from '../../../ide/workbench/services/editor/editor_pane';
import { EditorPanes } from '../../../ide/workbench/services/editor/editor_panes';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../../ide/workbench/ui/graph/control';
import type { WorkbenchGraphViewport } from '../../../ide/workbench/ui/graph/viewport';
import type { WorkbenchGraphDragSource } from '../../../ide/workbench/ui/graph/drag';
import { drawWorkbenchGraph } from '../../../ide/workbench/render/graph';
import { BrowserGraphLayoutEngine } from '../../../ide/browser/graph_layout';
import { GraphLayoutTestInput } from '../../helpers/graph_layout_input';
import { EditorTabGroupModel } from '../../../ide/workbench/ui/tab/group_model';

/** A domain-free test contribution, mounted by the production editor-group owner. */
type GraphFixtureView = { view: WorkbenchGraphViewport; dragSource?: WorkbenchGraphDragSource };

class GraphFixturePane extends EditorPane<CodeEditorInput> {
	public override get companionGameMinimumWidth(): undefined { return undefined; }

	public readonly graph = new WorkbenchGraphControl(inputFocus, pointerCapture, pointerHover);
	public result = WorkbenchGraphPointerResult.Outside;
	public constructor(private readonly views: ReadonlyMap<CodeEditorInput, GraphFixtureView>) { super(); }
	protected activate(): void {
		const input = this.views.get(this.input)!;
		this.graph.setInput(input.view, input.dragSource);
	}
	public focus(): void { this.graph.focusTarget.focus(); }
	public override clearInput(): void { this.graph.clearInput(); super.clearInput(); }
	public dispose(): void { this.graph.dispose(); }
	public override update(): void { this.graph.update(); }
	public draw(): void {
		drawWorkbenchGraph(this.views.get(this.input)!.view, this.graph.hover, this.graph.focusTarget.hasFocus,
			this.graph.dragFeedback, this.graph.connectionHandles);
	}
	public handleKeyboard(input: KeyInputEvent): void { inputFocus.handleKeyboard(input); }
	public handlePointer(snapshot: PointerInputSnapshot, _justPressed: boolean, _secondary: boolean, now: number): void {
		this.result = this.graph.handlePointer(snapshot, now, snapshot.spaceDown);
	}
	public handleWheel(event: WheelInputSnapshot): void {
		this.graph.handleWheel(event);
	}
	public drawStatusBar(): void {}
}

export function createGraphFixturePanes(views: readonly GraphFixtureView[]) {
	// Only use the existing input identity as an editor-group fixture carrier.
	// Neither the text model nor a Lua recognizer builds this graph.
	const inputs = views.map((_, index) => {
		const path = `graph-fixture-${index}.lua`;
		return new GraphLayoutTestInput(
			new EditorTextModel({ location: { kind: 'workspace' as const, path }, domain: 0, path, source: { resid: path, type: 'lua' } }, 'lua', ''),
			() => new BrowserGraphLayoutEngine(new Worker('/graph-layout.worker.js')),
		);
	});
	const pane = new GraphFixturePane(new Map(inputs.map((input, index) => [input, views[index]])));
	const unused = (): never => { throw new Error('Only the domain-free fixture is registered in this editor group'); };
	const panes = new EditorPanes({ play_session: () => { throw new Error('Play is not part of the graph viewport fixture'); },
		code_editor: () => pane, behavior_lens: unused, resource_view: unused, scenario_lab: unused, scene_editor: unused, cart_map: unused,
		animation: unused, host_error: unused, build_log: unused,
		rom_inspector: unused, event_viewer: unused, gte_debugger: unused, gpu_debugger: unused, terminal: unused, actor_lab: unused, game_view: unused, workspace_edit_review: unused, assistant: unused, aem_editor: unused, lua_program: unused, conversation_observer: unused });
	const group = new EditorTabGroupModel();
	group.initialize(inputs[0]);
	for (let index = 1; index < inputs.length; index += 1) group.add(inputs[index]);
	return { inputs, pane, panes, group };
}
