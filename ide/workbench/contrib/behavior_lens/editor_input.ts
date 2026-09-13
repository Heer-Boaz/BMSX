import { CompositeTextEditorInput } from '../../common/composite_text_editor_input';
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
import { projectActionEffectProperties } from './action_effect_properties';
import type { ActionEffectSourceDefinition } from './action_effect_model';
import { layoutWorkbenchPropertyTree } from '../../ui/property_tree';
import { measureTextRange } from '../../../editor/common/text/layout';
import { sourceTabDescription } from '../../ui/tab/titles';
import type { BehaviorSourceNode } from './model';

let nextInputId = 0;

/** Retained input for one source-derived behavior view. */
export class BehaviorLensInput extends CompositeTextEditorInput<BehaviorLensTabId, 'behavior_lens'> {
	public readonly graphLayout: AsyncGraphLayout<StateGraphModel>;
	private definitionTitle: string | undefined;
	private ownedDefinition: BehaviorSourceNode | undefined;

	/** workingCopy anchors the registration; it is not necessarily an edit target. */
	public constructor(public readonly workingCopy: EditorTextModel, public readonly view: BehaviorLensViewState, createEngine: GraphLayoutEngineFactory) {
		super(
			`behavior:${nextInputId++}`,
			'behavior_lens',
			'BEHAVIOR LENS',
			true,
		);
		this.graphLayout = this.disposables.add(new AsyncGraphLayout(createEngine));
		this.setWorkingCopies(new Set([workingCopy]));
		this.updateDefinition();
	}

	public override dispose(): void {
		super.dispose();
		this.view.source.release();
	}

	/** Publish this source generation's represented documents and input label together. */
	public updateDefinition(): void {
		const view = this.view;
		const definition = view.definitionRowKey === null ? undefined : view.source.nodesByRowKey.get(view.definitionRowKey)!;
		if (definition !== this.ownedDefinition) {
			this.ownedDefinition = definition;
			// Source participation has input lifetime, not syntax-node lifetime:
			// removing an import or breaking its syntax must not remove its Undo/Save.
			const models = new Set(this.getWorkingCopies());
			if (definition !== undefined) {
				const pending = [definition];
				while (pending.length > 0) {
					const node = pending.pop()!;
					models.add(view.source.models.get(node.authoredRange.path)!);
					models.add(view.source.models.get(node.occurrenceRange.path)!);
					for (const child of node.children) pending.push(child);
				}
			}
			this.setWorkingCopies(models);
		}
		if (definition === undefined) {
			this.setLabel(this.definitionTitle === undefined ? 'BEHAVIOR LENS' : `${this.definitionTitle} (removed)`, sourceTabDescription(view.resource));
			return;
		}
		this.definitionTitle = definition.label;
		this.setLabel(this.definitionTitle, sourceTabDescription(view.resource, definition.occurrenceRange.start.line));
	}

	/** Called even for hidden inputs: no old source generation may publish or remain interactive. */
	public invalidatePresentation(): void {
		this.graphLayout.invalidate();
		const presentation = this.view.presentation;
		if (presentation.kind === 'properties') {
			presentation.dirty = true;
			presentation.tree.rows.length = 0;
			presentation.tree.selectionIndex = -1;
			presentation.tree.hoverIndex = -1;
			return;
		}
		if (presentation.kind === 'graph') {
			presentation.dirty = true;
			return;
		}
		if (presentation.kind !== 'state-graph') return;
		presentation.dirty = true;
		presentation.layoutState = this.graphLayout.state;
		presentation.viewport.setModel(presentation.emptyModel, null);
	}

	public updatePresentation(font: BFont): void {
		const view = this.view;
		const presentation = view.presentation;
		if (presentation.kind === 'properties') {
			if (presentation.dirty) {
				const definition = view.document.definitions.find((node): node is ActionEffectSourceDefinition =>
					node.behaviorKind === 'action_effect' && node.rowKey === view.definitionRowKey);
				projectActionEffectProperties(view, presentation, definition);
				presentation.dirty = false;
			}
			layoutWorkbenchPropertyTree(presentation.tree, font, measureTextRange, view.layout.left, view.layout.headerBottom + 1, view.layout.right, view.layout.bottom);
			return;
		}
		if (presentation.kind !== 'state-graph') return;
		const viewport = presentation.viewport;
		if (presentation.dirty || viewport.model.font !== font) {
			if (presentation.emptyModel.font !== font) presentation.emptyModel = emptyStateGraph(font);
			const definition = view.document.definitions.find(node => node.rowKey === view.definitionRowKey);
			if (definition === undefined) this.graphLayout.invalidate();
			else if (definition.behaviorKind === 'state_machine') {
				const references = view.stateMachines.references;
				this.graphLayout.request(engine => layoutStateGraph(definition, references, font, engine));
			}
			viewport.setModel(presentation.emptyModel, null);
			presentation.dirty = false;
		}
		const state = this.graphLayout.state;
		presentation.layoutState = state;
		if (state.kind === 'ready' && viewport.model !== state.model) {
			viewport.setModel(state.model, stateGraphSelection(state.model, view.selection));
			if (presentation.position === 'preserve' && viewport.selection !== null) viewport.reveal(viewport.selection);
			updateBehaviorLensStatus(view);
		}
		const position = presentation.position;
		if (state.kind === 'ready' && position !== 'preserve') {
			if (position === 'initial') {
				viewport.scrollX = 0;
				viewport.scrollY = 0;
				if (viewport.selection !== null) viewport.reveal(viewport.selection);
			} else {
				viewport.setZoom(position.zoom);
				viewport.scrollX = position.scrollX;
				viewport.scrollY = position.scrollY;
			}
			presentation.position = 'preserve';
		}
	}
}
