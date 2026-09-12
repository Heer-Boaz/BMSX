import type { EditorTextModel } from '../../../editor/model/text_model';
import { WorkbenchGraphConnectionPreview } from '../../ui/graph/connection';
import type { WorkbenchGraphDragSession, WorkbenchGraphDragStart } from '../../ui/graph/drag';
import type { WorkbenchGraphEdge } from '../../ui/graph/model';
import type { WorkbenchGraphViewport } from '../../ui/graph/viewport';
import type { StateGraphEdge, StateGraphModel } from './state_graph_model';
import { StateMachineRetargetAnalysis, type StateMachineRetargetCheck } from './state_machine_retarget';
import type { StateMachineSourceSelection } from './state_machine_selection';
import type { BehaviorLensViewState } from './view_model';

export type StateMachineRetargetDrop = (
	selection: Extract<StateMachineSourceSelection, { kind: 'state-outcome' }>,
	target: Extract<StateMachineRetargetCheck, { kind: 'available' }>,
) => void;

/** Selected-proof capability consumes the cold source index; no consumer scan on hover. */
export function stateMachineConnectionEnds(model: EditorTextModel, view: BehaviorLensViewState, edge: WorkbenchGraphEdge): 'target' | undefined {
	if (model.readOnly || !view.source.isCurrent || view.presentation.kind !== 'state-graph') return undefined;
	const selected = view.presentation.viewport.selection;
	if (selected === null || selected.kind !== 'edge' || selected !== edge) return undefined;
	const reference = selected.link.reference;
	return reference.kind === 'state-outcome' && view.stateMachines.retargetable.has(reference.outcome) ? 'target' : undefined;
}

export function beginStateMachineDrag(model: EditorTextModel, view: BehaviorLensViewState,
	start: WorkbenchGraphDragStart, accept: StateMachineRetargetDrop): WorkbenchGraphDragSession | undefined {
	if (start.kind !== 'connection' || start.end !== 'target' || model.readOnly || !view.source.isCurrent) return undefined;
	const presentation = view.presentation;
	const selection = view.selection;
	if (presentation.kind !== 'state-graph' || selection?.kind !== 'state-outcome') return undefined;
	const selected = presentation.viewport.selection;
	if (selected === null || selected.kind !== 'edge' || selected !== start.edge || selected.link.reference.kind !== 'state-outcome'
		|| selected.link.reference.outcome !== selection.outcome || !view.stateMachines.retargetable.has(selection.outcome)) return undefined;
	return new StateMachineDrag(model, view, presentation.viewport, selected, selection, accept);
}

class StateMachineDrag implements WorkbenchGraphDragSession {
	public readonly feedback: WorkbenchGraphConnectionPreview;
	private readonly source: BehaviorLensViewState['source'];
	private readonly analysis: StateMachineRetargetAnalysis;
	private target: Extract<StateMachineRetargetCheck, { kind: 'available' }> | undefined;

	public constructor(private readonly model: EditorTextModel, private readonly view: BehaviorLensViewState,
		private readonly viewport: WorkbenchGraphViewport<StateGraphModel>, edge: StateGraphEdge,
		private readonly selection: Extract<StateMachineSourceSelection, { kind: 'state-outcome' }>,
		private readonly accept: StateMachineRetargetDrop) {
		this.source = view.source;
		this.analysis = new StateMachineRetargetAnalysis(view.document, selection.transition, selection.outcome);
		this.feedback = new WorkbenchGraphConnectionPreview(edge, 'target');
	}

	public isCurrent(): boolean { return !this.model.readOnly && this.source === this.view.source && this.source.isCurrent; }

	public dragOver(viewportX: number, viewportY: number): void {
		const hit = this.viewport.hitTest(viewportX, viewportY);
		const scope = hit !== null && hit.kind === 'node' && hit.role === 'source' ? this.view.stateMachines.scopes.get(hit.source.rowKey) : undefined;
		const check = scope === undefined ? undefined : this.analysis.checkTarget(scope);
		this.target = check?.kind === 'available' ? check : undefined;
		this.feedback.target = this.target !== undefined && hit !== null && hit.kind === 'node' ? hit : undefined;
	}

	public drop(): void { this.accept(this.selection, this.target!); }
}
