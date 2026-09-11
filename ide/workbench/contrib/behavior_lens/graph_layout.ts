import { layoutBehaviorTreeGraph } from './graph_geometry';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { BehaviorLensGraph, BehaviorLensViewState } from './view_model';
import { projectBehaviorTreeGraph } from './graph_projection';

/** Rebuild only at a source/font boundary. Preserve the selected card's screen anchor. */
export function prepareBehaviorGraphLayout(state: BehaviorLensViewState, graph: BehaviorLensGraph, font: BFont): void {
	const viewport = graph.viewport;
	if (graph.dirty || viewport.model.font !== font) {
		const selected = viewport.selection;
		const definition = state.document.definitions.find(node => node.rowKey === state.definitionRowKey);
		const model = layoutBehaviorTreeGraph(projectBehaviorTreeGraph(definition !== undefined && definition.behaviorKind === 'behavior_tree' ? definition : null,
			font));
		viewport.setModel(model, null);
		if (state.selection !== null) {
			const next = state.selection.kind === 'node' ? model.nodesBySource.get(state.selection.rowKey) : model.edgesBySource.get(state.selection.rowKey);
			// A surviving source occurrence can cease to be a visible control-flow item
			// (for example, membership becomes dynamic). Do not select an unseen source.
			if (next === undefined) state.selection = null;
			else {
				viewport.selection = next;
				if (selected !== null && graph.position === 'preserve') viewport.pan((next.bounds.left - selected.bounds.left) * viewport.zoom, (next.bounds.top - selected.bounds.top) * viewport.zoom);
			}
		}
		graph.dirty = false;
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
