import type { BehaviorLensGraph, BehaviorLensViewState } from './view_model';
import type { BehaviorGraphNode } from './graph_model';
import { prepareBehaviorLensLayout } from './layout';
import { BehaviorLensNavigationResult, type BehaviorLensNavigationCommand, updateBehaviorLensStatus } from './navigation';

/** Selection correspondence is a source occurrence plus its presentation role, never a hidden row. */
export function acceptBehaviorGraphSelection(state: BehaviorLensViewState, graph: BehaviorLensGraph): void {
	const item = graph.viewport.selection;
	state.selectedRowKey = item === null ? null : item.source.rowKey;
	if (item !== null) graph.selectionKind = item.kind;
	updateBehaviorLensStatus(state);
}

export function toggleBehaviorGraphBranch(state: BehaviorLensViewState, graph: BehaviorLensGraph): void {
	const item = graph.viewport.selection;
	if (item === null || item.kind !== 'node' || !item.expandable) return;
	if (state.collapsedRowKeys.has(item.source.rowKey)) state.collapsedRowKeys.delete(item.source.rowKey);
	else state.collapsedRowKeys.add(item.source.rowKey);
	graph.dirty = true;
	prepareBehaviorLensLayout(state);
	updateBehaviorLensStatus(state);
}

/** Physical tree relationships: up = parent, down = first child, left/right = siblings. */
export function executeBehaviorGraphNavigation(
	state: BehaviorLensViewState, graph: BehaviorLensGraph, command: BehaviorLensNavigationCommand,
): BehaviorLensNavigationResult {
	const viewport = graph.viewport;
	if (command === 'back') return BehaviorLensNavigationResult.Back;
	if (command === 'activate') return viewport.selection === null ? BehaviorLensNavigationResult.None : BehaviorLensNavigationResult.Activate;
	if (command === 'page-up' || command === 'page-down') {
		viewport.pan(0, (viewport.bounds.bottom - viewport.bounds.top) * (command === 'page-up' ? -1 : 1));
		return BehaviorLensNavigationResult.Panned;
	}
	if (viewport.model.nodes.length === 0) return BehaviorLensNavigationResult.None;
	const item = viewport.selection;
	let node: BehaviorGraphNode = item === null ? viewport.model.nodes[0] : item.kind === 'node' ? item : item.child;
	if (item !== null) {
		switch (command) {
			case 'home': node = viewport.model.nodes[0]; break;
			case 'end':
				while (node.children.length > 0) node = node.children[node.children.length - 1];
				break;
			case 'up': if (node.parent !== null) node = node.parent; break;
			case 'down':
				if (node.expandable && state.collapsedRowKeys.has(node.source.rowKey)) {
					viewport.selection = node;
					acceptBehaviorGraphSelection(state, graph);
					toggleBehaviorGraphBranch(state, graph);
					node = viewport.model.nodesBySource.get(node.source.rowKey)!;
				}
				if (node.children.length > 0) node = node.children[0];
				break;
			case 'left':
			case 'right':
				if (node.parent !== null) {
					const siblings = node.parent.children;
					const index = siblings.indexOf(node) + (command === 'left' ? -1 : 1);
					if (index >= 0 && index < siblings.length) node = siblings[index];
				}
				break;
		}
	}
	viewport.selection = node;
	acceptBehaviorGraphSelection(state, graph);
	return BehaviorLensNavigationResult.Changed;
}
