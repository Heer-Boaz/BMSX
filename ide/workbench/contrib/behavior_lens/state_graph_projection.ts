import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { uppercaseOutsideStrings } from '../../../common/text';
import type { GraphLayoutEngine } from '../../services/graph_layout/engine';
import { layoutWorkbenchCompoundGraph } from '../../ui/graph/compound_layout';
import { createWorkbenchGraphDisc, createWorkbenchGraphModel, createWorkbenchGraphNode, GRAPH_NODE_PADDING } from '../../ui/graph/model';
import type { BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { StateMachineSourceBody, StateMachineSourceDefinition, StateMachineSourceEntry, StateMachineSourceOutcome } from './state_machine_model';
import { stateMachineSourceRange, type StateMachineSourceReference } from './state_machine_selection';
import type { StateGraphEdge, StateGraphLink, StateGraphModel, StateGraphNode, StateGraphSourceNode, StateGraphEntryNode } from './state_graph_model';

export function emptyStateGraph(font: BFont): StateGraphModel {
	return { ...createWorkbenchGraphModel<StateGraphNode, StateGraphEdge>(font, [], []),
		nodesBySource: new Map(), nodesByEntry: new Map(), edgesByOutcome: new Map(), edgesByEntry: new Map() };
}

/** Only typed containment and proven relations enter layout; source objects stay on this side. */
export async function layoutStateGraph(definition: StateMachineSourceDefinition,
	references: ReadonlyMap<BehaviorSourceRowKey, readonly StateMachineSourceReference[]>,
	font: BFont, engine: GraphLayoutEngine): Promise<StateGraphModel> {
	const notes = new Map<BehaviorSourceRowKey, string[]>();
	function note(key: BehaviorSourceRowKey, text: string): void {
		let lines = notes.get(key);
		if (lines === undefined) { lines = []; notes.set(key, lines); }
		lines.push(text);
	}
	for (const entry of definition.entries) {
		if (entry.target.kind === 'unresolved') note(entry.owner, `${entry.kind}: ? ${entry.target.reason}`);
		else if (entry.kind === 'concurrent') note(entry.owner, 'CONCURRENT REGION');
	}
	for (const transition of definition.transitions) {
		let unknown = 0;
		let noPath = 0;
		for (const outcome of transition.outcomes) {
			if (outcome.target.kind === 'unresolved') unknown += 1;
			else if (outcome.target.kind === 'no-path') noPath += 1;
		}
		if (unknown > 0 || noPath > 0) note(transition.origin.rowKey,
			`${transition.slot.kind}: ${unknown} UNKNOWN / ${noPath} NO PATH`);
		else if (transition.outcomes.length === 0) note(transition.origin.rowKey, `${transition.slot.kind}: NO RETURN EVIDENCE`);
	}
	const nodesBySource = new Map<BehaviorSourceRowKey, StateGraphSourceNode>();
	function node(source: BehaviorSourceNode, body: StateMachineSourceBody | null): StateGraphSourceNode {
		const lines = [source.label];
		if (source.resolution !== 'complete') lines.push(`SOURCE ${source.resolution}`);
		if (body !== null && body.guards !== null) lines.push('GUARDS (SOURCE ONLY)');
		if (body !== null && body.states !== null && body.states.source.resolution !== 'complete') lines.push('STATES: PARTIAL SOURCE');
		const localNotes = notes.get(source.rowKey);
		if (localNotes !== undefined) lines.push(...localNotes);
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
	// Implicit runtime entry has no authored field; its existing scope note stays visible.
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
			const range = stateMachineSourceRange(reference);
			const title = transition.slot.kind === 'update' || transition.slot.kind === 'enter' ? transition.slot.kind : transition.slot.source.label;
			links.push({ source: nodesBySource.get(transition.origin.rowKey)!, target: nodesBySource.get(reference.outcome.target.target)!, reference,
				label: uppercaseOutsideStrings(`${title}\n${reference.outcome.proof.kind} LN ${range.start.line}:${range.start.column}`) });
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
