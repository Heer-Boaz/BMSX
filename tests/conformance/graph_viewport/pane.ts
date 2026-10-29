import { TEST_CARTRIDGE_CONTEXT_IDS } from '../../helpers/runtime_sources';
import type { KeyInputEvent } from '../../../hosts/common/input/text';
import { pointerHover } from '../../../ide/input/pointer/hover';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../ide/common/models';
import { inputFocus, type InputFocusScope } from '../../../ide/input/focus';
import { editorRuntimeState } from '../../../ide/editor/common/runtime_state';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import { EditorPane, measureUnconstrainedEditor } from '../../../ide/workbench/services/editor/editor_pane';
import { EditorGroupView } from '../../../ide/workbench/services/editor/editor_group';
import { WorkbenchGraphControl, WorkbenchGraphPointerResult } from '../../../ide/workbench/ui/graph/control';
import type { WorkbenchGraphViewport } from '../../../ide/workbench/ui/graph/viewport';
import type { WorkbenchGraphDragSource } from '../../../ide/workbench/ui/graph/drag';
import { drawWorkbenchGraph } from '../../../ide/workbench/render/graph';
import { BrowserGraphLayoutEngine } from '../../../ide/browser/graph_layout';
import { createTestGroupPresentation } from '../../helpers/editor_panes';
import { GraphLayoutTestInput } from '../../helpers/graph_layout_input';

/** A domain-free test contribution, mounted by the production editor-group owner. */
type GraphFixtureView = { view: WorkbenchGraphViewport; dragSource?: WorkbenchGraphDragSource };

class GraphFixturePane extends EditorPane<CodeEditorInput> {
	public override get commandTarget() { return this.graph.focusTarget; }

	public readonly graph: WorkbenchGraphControl;
	public result = WorkbenchGraphPointerResult.Outside;
	public constructor(private readonly views: ReadonlyMap<CodeEditorInput, GraphFixtureView>, scope: InputFocusScope) {
		super();
		const parent = inputFocus.createTarget(null, scope);
		this.graph = new WorkbenchGraphControl(inputFocus, pointerCapture, pointerHover, undefined, parent);
	}
	protected activate(): void {
		const input = this.views.get(this.input)!;
		this.graph.setInput(input.view, input.dragSource);
	}
	public focus(): void { this.graph.focusTarget.focus(); }
	public override clearInput(): void { this.graph.clearInput(); super.clearInput(); }
	public dispose(): void { this.graph.dispose(); }
	public override update(): void { this.graph.advanceDrag(editorRuntimeState.currentTimeMs); }
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
	public readonly statusItems = [];
	public updateStatus(): void {}
}

export function createGraphFixturePanes(views: readonly GraphFixtureView[]) {
	// Only use the existing input identity as an editor-group fixture carrier.
	// Neither the text model nor a Lua recognizer builds this graph.
	const inputs = views.map((_, index) => {
		const path = `graph-fixture-${index}.lua`;
		return new GraphLayoutTestInput(
			new EditorTextModel({ contextLabel: 'Profile project', sourceFilePath: path, location: { kind: 'workspace' as const, path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { resid: path, type: 'lua' } }, 'lua', ''),
			() => new BrowserGraphLayoutEngine(new Worker('/graph-layout.worker.js')),
		);
	});
	let pane!: GraphFixturePane;
	const inputViews = new Map(inputs.map((input, index) => [input, views[index]]));
	const unused = (): never => { throw new Error('Only the domain-free fixture is registered in this editor group'); };
	const group = new EditorGroupView({ workspace_search: { create: unused, measure: measureUnconstrainedEditor }, call_hierarchy: { create: unused, measure: measureUnconstrainedEditor }, play_session: { create: unused, measure: measureUnconstrainedEditor },
		home: { create: unused, measure: measureUnconstrainedEditor },
		code_editor: { create: group => pane = new GraphFixturePane(inputViews, group.focusScope), measure: measureUnconstrainedEditor }, behavior_lens: { create: unused, measure: measureUnconstrainedEditor }, resource_view: { create: unused, measure: measureUnconstrainedEditor }, scenario_lab: { create: unused, measure: measureUnconstrainedEditor }, scene_editor: { create: unused, measure: measureUnconstrainedEditor }, cart_map: { create: unused, measure: measureUnconstrainedEditor },
		animation: { create: unused, measure: measureUnconstrainedEditor }, host_error: { create: unused, measure: measureUnconstrainedEditor }, build_log: { create: unused, measure: measureUnconstrainedEditor },
		rom_inspector: { create: unused, measure: measureUnconstrainedEditor }, event_viewer: { create: unused, measure: measureUnconstrainedEditor }, gte_debugger: { create: unused, measure: measureUnconstrainedEditor }, gpu_debugger: { create: unused, measure: measureUnconstrainedEditor }, terminal: { create: unused, measure: measureUnconstrainedEditor }, actor_lab: { create: unused, measure: measureUnconstrainedEditor }, game_view: { create: unused, measure: measureUnconstrainedEditor }, workspace_edit_review: { create: unused, measure: measureUnconstrainedEditor }, assistant: { create: unused, measure: measureUnconstrainedEditor }, aem_editor: { create: unused, measure: measureUnconstrainedEditor }, lua_program: { create: unused, measure: measureUnconstrainedEditor }, conversation_observer: { create: unused, measure: measureUnconstrainedEditor } }, { isEnabled: () => false, execute() {} }, async targets => {
		for (const { group, input } of targets) group.removeEditor(input);
		return true;
	}, createTestGroupPresentation());
	group.openEditor(inputs[0]);
	for (let index = 1; index < inputs.length; index += 1) group.model.add(inputs[index]);
	return { inputs, pane, group };
}
