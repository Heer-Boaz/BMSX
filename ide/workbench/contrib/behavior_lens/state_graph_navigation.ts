import type { TextBuffer } from '../../../editor/text/text_buffer';
import type { BehaviorSourceSelection } from './source_selection';
import type { StateGraphEdge, StateGraphModel, StateGraphNode } from './state_graph_model';
import { selectStateMachineSource } from './state_machine_selection';
import type { BehaviorLensStateGraph, BehaviorLensViewState } from './view_model';
import { BehaviorLensNavigationResult, type BehaviorLensNavigationCommand, updateBehaviorLensStatus } from './navigation';

/** A selected proof can survive without a geometric edge (for example, return nil). */
export function stateGraphSelection(model: StateGraphModel, selection: BehaviorSourceSelection) {
	if (selection === null) return null;
	let item: StateGraphNode | StateGraphEdge | undefined;
	switch (selection.kind) {
		case 'node': item = model.nodesBySource.get(selection.rowKey); break;
		case 'state-outcome': item = model.edgesByOutcome.get(selection.outcome); break;
		case 'state-entry': item = model.edgesByEntry.get(selection.entry); break;
		case 'tree-edge': return null;
	}
	return item === undefined ? null : item;
}

export function acceptStateGraphSelection(view: BehaviorLensViewState, graph: BehaviorLensStateGraph, buffer: TextBuffer): void {
	const item = graph.viewport.selection;
	view.selection = item === null ? null : item.kind === 'node' ? { kind: 'node', rowKey: item.source.rowKey }
		: selectStateMachineSource(item.link.reference, buffer);
	updateBehaviorLensStatus(view);
}

/** Read-only diagram: traversal visits nodes AND relations; arrows pan, never invent tree relatives. */
export function executeStateGraphNavigation(view: BehaviorLensViewState, graph: BehaviorLensStateGraph, command: BehaviorLensNavigationCommand): BehaviorLensNavigationResult {
	const viewport = graph.viewport;
	if (command === 'back') return BehaviorLensNavigationResult.Back;
	if (command === 'activate') return view.selection === null ? BehaviorLensNavigationResult.None : BehaviorLensNavigationResult.Activate;
	if (graph.layoutState.kind !== 'ready') return BehaviorLensNavigationResult.None;
	if (command === 'next' || command === 'previous') {
		viewport.selectRelative(command === 'next' ? 1 : -1);
		return BehaviorLensNavigationResult.Changed;
	}
	if (command === 'home' || command === 'end') {
		viewport.selection = null;
		viewport.selectRelative(command === 'home' ? 1 : -1);
		return BehaviorLensNavigationResult.Changed;
	}
	switch (command) {
		case 'up': viewport.pan(0, -16); break;
		case 'down': viewport.pan(0, 16); break;
		case 'left': viewport.pan(-16, 0); break;
		case 'right': viewport.pan(16, 0); break;
		case 'page-up': viewport.pan(0, viewport.bounds.top - viewport.bounds.bottom); break;
		case 'page-down': viewport.pan(0, viewport.bounds.bottom - viewport.bounds.top); break;
	}
	return BehaviorLensNavigationResult.Panned;
}
