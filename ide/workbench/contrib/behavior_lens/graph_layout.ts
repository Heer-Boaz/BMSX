import { layoutBehaviorTreeGraph } from './graph_geometry';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { BehaviorLensGraph, BehaviorLensViewState } from './view_model';
import { projectBehaviorTreeGraph } from './graph_projection';
import { updateBehaviorLensStatus } from './navigation';

/** Rebuild only at a source/font boundary. Preserve the selected card's screen anchor. */
export function prepareBehaviorGraphLayout(state: BehaviorLensViewState, graph: BehaviorLensGraph, font: BFont): void {
	const viewport = graph.viewport;
	if (graph.dirty || viewport.model.font !== font) {
		const selected = viewport.selection;
		const definition = state.document.definitions.find(node => node.rowKey === state.selectionState.definitionRowKey);
		const model = layoutBehaviorTreeGraph(projectBehaviorTreeGraph(definition !== undefined && definition.behaviorKind === 'behavior_tree' ? definition : null,
			font));
		viewport.setModel(model, null);
		if (state.selectionState.selected !== null) {
			const next = state.selectionState.selected.kind === 'node' ? model.nodesBySource.get(state.selectionState.selected.rowKey) : model.edgesBySource.get(state.selectionState.selected.rowKey);
			// A source occurrence can survive without a rendered card or connection.
			// Only the viewport selection depends on the current graph projection.
			if (next !== undefined) {
				viewport.selection = next;
				if (selected !== null && graph.position === 'preserve') viewport.pan((next.bounds.left - selected.bounds.left) * viewport.zoom, (next.bounds.top - selected.bounds.top) * viewport.zoom);
			}
		}
		graph.dirty = false;
		updateBehaviorLensStatus(state);
	}
	if (graph.position === 'initial') {
		viewport.scrollX = -Math.round((viewport.bounds.right - viewport.bounds.left) / 2);
		viewport.scrollY = -8;
	} else if (graph.position !== 'preserve') {
		viewport.setZoom(graph.position.zoom);
		viewport.scrollX = graph.position.scrollX;
		viewport.scrollY = graph.position.scrollY;
	}
	graph.position = 'preserve';
}
