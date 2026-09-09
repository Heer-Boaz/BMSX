import type { WorkbenchGraphEdge, WorkbenchGraphModel, WorkbenchGraphNode } from '../../ui/graph/model';
import type { WorkbenchCompoundLink } from '../../ui/graph/compound_layout';
import type { BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { StateMachineSourceEntry, StateMachineSourceOutcome } from './state_machine_model';
import type { StateMachineSourceReference } from './state_machine_selection';

export type StateGraphNode = WorkbenchGraphNode & {
	readonly source: BehaviorSourceNode;
	readonly children: StateGraphNode[];
};

export type StateGraphLink = WorkbenchCompoundLink<StateGraphNode> & {
	readonly reference: StateMachineSourceReference;
};

export type StateGraphEdge = WorkbenchGraphEdge & { readonly link: StateGraphLink };
export type StateGraphModel = WorkbenchGraphModel<StateGraphNode, StateGraphEdge> & {
	readonly nodesBySource: ReadonlyMap<BehaviorSourceRowKey, StateGraphNode>;
	readonly edgesByOutcome: ReadonlyMap<StateMachineSourceOutcome, StateGraphEdge>;
	readonly edgesByEntry: ReadonlyMap<StateMachineSourceEntry, StateGraphEdge>;
};
