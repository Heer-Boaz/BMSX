import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { uppercaseOutsideStrings } from '../../../common/text';
import type { GraphLayoutEngine } from '../../services/graph_layout/engine';
import { layoutWorkbenchCompoundGraph } from '../../ui/graph/compound_layout';
import { createWorkbenchGraphDisc, createWorkbenchGraphModel, createWorkbenchGraphNode, GRAPH_NODE_PADDING } from '../../ui/graph/model';
import type { BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { StateMachineSourceBody, StateMachineSourceDefinition, StateMachineSourceEntry, StateMachineSourceOutcome } from './state_machine_model';
import type { StateMachineSourceReference } from './state_machine_selection';
import type { StateGraphEdge, StateGraphLink, StateGraphModel, StateGraphNode, StateGraphSourceNode, StateGraphEntryNode } from './state_graph_model';

export function emptyStateGraph(font: BFont): StateGraphModel {
	return { ...createWorkbenchGraphModel<StateGraphNode, StateGraphEdge>(font, [], []),
		nodesBySource: new Map(), nodesByEntry: new Map(), edgesByOutcome: new Map(), edgesByEntry: new Map() };
}

/** Only typed containment and proven relations enter layout; source objects stay on this side. */
export async function layoutStateGraph(definition: StateMachineSourceDefinition,
	references: ReadonlyMap<BehaviorSourceRowKey, readonly StateMachineSourceReference[]>,
	font: BFont, engine: GraphLayoutEngine): Promise<StateGraphModel> {
	const unresolved = new Set<BehaviorSourceRowKey>();
	const concurrent = new Set<BehaviorSourceRowKey>();
	for (const entry of definition.entries) {
		if (entry.target.kind === 'unresolved' && entry.target.reason !== 'implicit-initial') unresolved.add(entry.owner);
		if (entry.kind === 'concurrent') concurrent.add(entry.owner);
	}
	for (const transition of definition.transitions) {
		for (const outcome of transition.outcomes) {
			if (outcome.target.kind === 'unresolved') unresolved.add(transition.origin.rowKey);
		}
	}
	const nodesBySource = new Map<BehaviorSourceRowKey, StateGraphSourceNode>();
	function node(source: BehaviorSourceNode, body: StateMachineSourceBody | null): StateGraphSourceNode {
		const partial = source.resolution !== 'complete' || unresolved.has(source.rowKey)
			|| body !== null && body.states !== null && body.states.source.resolution !== 'complete';
		const lines = [source.label + (partial ? ' ?' : '')];
		if (concurrent.has(source.rowKey)) lines.push('CONCURRENT REGION');
		const result: StateGraphSourceNode = { ...createWorkbenchGraphNode(font, uppercaseOutsideStrings(lines.join('\n')), 0, 0),
			role: 'source', source, children: [] };
		nodesBySource.set(source.rowKey, result);
		if (body !== null && body.states !== null) {
			if (body.states.kind === 'dynamic') result.children.push(node(body.states.source, null));
			else for (const entry of body.states.entries) result.children.push(node(entry.node, entry.node.kind === 'state' ? entry.node.body : null));
		}
		return result;
	}
	const root = node(definition, definition.body);
	const links: StateGraphLink[] = [];
	const nodesByEntry = new Map<StateMachineSourceEntry, StateGraphEntryNode>();
	// An entry begins inside its origin scope, not on the enclosing state's event rail.
	// Implicit runtime entry has no authored field; Details retains that evidence.
	for (const entry of definition.entries) {
		if (entry.field === null) continue;
		const reference = references.get(entry.owner)!.find((item): item is Extract<StateMachineSourceReference, { kind: 'state-entry' }> =>
			item.kind === 'state-entry' && item.entry === entry)!;
		const marker: StateGraphEntryNode = {
			...createWorkbenchGraphDisc(font.lineHeight + GRAPH_NODE_PADDING, 0, 0),
			role: 'entry', reference, children: [],
		};
		nodesByEntry.set(entry, marker);
		nodesBySource.get(entry.origin)!.children.push(marker);
		if (entry.target.kind === 'state') links.push({ source: marker, target: nodesBySource.get(entry.target.rowKey)!,
			label: entry.kind === 'concurrent' ? 'CONCURRENT' : '', reference });
	}
	for (const transition of definition.transitions) {
		for (const reference of references.get(transition.slot.source.rowKey)!) {
			if (reference.kind !== 'state-outcome' || reference.outcome.target.kind !== 'path') continue;
			const title = transition.slot.kind === 'update' || transition.slot.kind === 'enter' ? transition.slot.kind : transition.slot.source.label;
			links.push({ source: nodesBySource.get(transition.origin.rowKey)!, target: nodesBySource.get(reference.outcome.target.target)!, reference,
				label: uppercaseOutsideStrings(title) });
		}
	}
	const graph = await layoutWorkbenchCompoundGraph<StateGraphNode, StateGraphLink>(font, [root], links, engine);
	const edgesByOutcome = new Map<StateMachineSourceOutcome, StateGraphEdge>();
	const edgesByEntry = new Map<StateMachineSourceEntry, StateGraphEdge>();
	for (const edge of graph.edges) {
		const reference = edge.link.reference;
		if (reference.kind === 'state-outcome') edgesByOutcome.set(reference.outcome, edge);
		else edgesByEntry.set(reference.entry, edge);
	}
	return { ...graph, nodesBySource, nodesByEntry, edgesByOutcome, edgesByEntry };
}
