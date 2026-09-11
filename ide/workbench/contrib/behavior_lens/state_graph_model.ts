import type { WorkbenchGraphEdge, WorkbenchGraphModel, WorkbenchGraphNode } from '../../ui/graph/model';
import type { WorkbenchCompoundLink } from '../../ui/graph/compound_layout';
import type { BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { StateMachineSourceEntry, StateMachineSourceOutcome } from './state_machine_model';
import type { StateMachineSourceReference } from './state_machine_selection';

export type StateGraphSourceNode = WorkbenchGraphNode & {
	readonly role: 'source';
	readonly source: BehaviorSourceNode;
	readonly children: StateGraphNode[];
};

/** A source entry is not an authored state. Its marker shares the entry's source reference. */
export type StateGraphEntryNode = WorkbenchGraphNode & {
	readonly role: 'entry';
	readonly reference: Extract<StateMachineSourceReference, { kind: 'state-entry' }>;
	readonly children: readonly StateGraphNode[];
};

export type StateGraphNode = StateGraphSourceNode | StateGraphEntryNode;

export type StateGraphLink = WorkbenchCompoundLink<StateGraphNode> & {
	readonly reference: StateMachineSourceReference;
	readonly target: StateGraphSourceNode;
};

export type StateGraphEdge = WorkbenchGraphEdge & { readonly link: StateGraphLink };
export type StateGraphModel = WorkbenchGraphModel<StateGraphNode, StateGraphEdge> & {
	readonly nodesBySource: ReadonlyMap<BehaviorSourceRowKey, StateGraphSourceNode>;
	readonly nodesByEntry: ReadonlyMap<StateMachineSourceEntry, StateGraphEntryNode>;
	readonly edgesByOutcome: ReadonlyMap<StateMachineSourceOutcome, StateGraphEdge>;
	readonly edgesByEntry: ReadonlyMap<StateMachineSourceEntry, StateGraphEdge>;
};
