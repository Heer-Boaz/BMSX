import { resourceIdentityKey } from '../../../common/resource';
import { WorkingCopyEditorInput } from '../../common/editor_input';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { BehaviorLensTabId } from '../../ui/tab/id';
import type { BehaviorLensViewState } from './view_model';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { AsyncGraphLayout } from '../../services/graph_layout/async_layout';
import type { GraphLayoutEngineFactory } from '../../services/graph_layout/engine';
import type { StateGraphModel } from './state_graph_model';
import { emptyStateGraph, layoutStateGraph } from './state_graph_projection';
import { stateGraphSelection } from './state_graph_navigation';
import { updateBehaviorLensStatus } from './navigation';

/** Retained input for one source-derived behavior view. */
export class BehaviorLensInput extends WorkingCopyEditorInput<BehaviorLensTabId, 'behavior_lens'> {
	public readonly graphLayout: AsyncGraphLayout<StateGraphModel>;

	public constructor(public readonly workingCopy: EditorTextModel, public readonly view: BehaviorLensViewState, createEngine: GraphLayoutEngineFactory) {
		super(
			`behavior:${resourceIdentityKey(view.resource)}`,
			'behavior_lens',
			'BEHAVIOR LENS',
			true,
		);
		this.graphLayout = this.disposables.add(new AsyncGraphLayout(createEngine));
	}

	/** Called even for hidden inputs: no old source generation may publish or remain interactive. */
	public invalidateGraph(): void {
		this.graphLayout.invalidate();
		const graph = this.view.presentation;
		if (graph.kind !== 'state-graph') return;
		graph.dirty = true;
		graph.layoutState = this.graphLayout.state;
		graph.viewport.setModel(graph.emptyModel, null);
	}

	public updateGraph(font: BFont): void {
		const view = this.view;
		const graph = view.presentation;
		if (graph.kind !== 'state-graph') return;
		const viewport = graph.viewport;
		if (graph.dirty || viewport.model.font !== font) {
			if (graph.emptyModel.font !== font) graph.emptyModel = emptyStateGraph(font);
			const definition = view.document.definitions.find(node => node.rowKey === view.definitionRowKey);
			if (definition === undefined) this.graphLayout.invalidate();
			else if (definition.behaviorKind === 'state_machine') {
				const references = view.stateMachines.references;
				this.graphLayout.request(engine => layoutStateGraph(definition, references, font, engine));
			}
			viewport.setModel(graph.emptyModel, null);
			graph.dirty = false;
		}
		const state = this.graphLayout.state;
		graph.layoutState = state;
		if (state.kind === 'ready' && viewport.model !== state.model) {
			viewport.setModel(state.model, stateGraphSelection(state.model, view.selection));
			if (graph.initialPosition) {
				viewport.scrollX = 0;
				viewport.scrollY = 0;
				graph.initialPosition = false;
			}
			if (viewport.selection !== null) viewport.reveal(viewport.selection);
			updateBehaviorLensStatus(view);
		}
	}
}
