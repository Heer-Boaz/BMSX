import { resourceIdentityEquals, resourceIdentityKey } from '../../../common/resource';
import type { AbstractEditorInput } from '../../common/editor_input';
import { editorTextModelService } from '../../../editor/model/model_service';
import { mapBehaviorLensSourceRanges } from './source_correspondence';
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
import type { BehaviorRuntimeInspection } from './runtime_inspection';

let nextInputId = 0;

/** Retained input for one source-derived behavior view. */
export class BehaviorLensInput extends CompositeTextEditorInput<BehaviorLensTabId, 'behavior_lens'> {
	public readonly createView?: () => BehaviorLensInput;
	/** The attached pane owns/disposes this visible inspection; source identity stays separate. */
	public runtimeInspection: BehaviorRuntimeInspection | undefined;
	public override canMove(): boolean { return this.runtimeInspection === undefined; }
	public override matches(other: AbstractEditorInput<string, string>): boolean {
		if (this === other) return true;
		if (!(other instanceof BehaviorLensInput) || !resourceIdentityEquals(this.workingCopy.resource, other.workingCopy.resource)
			|| this.view.selectionState.definitionRowKey === null || other.view.selectionState.definitionRowKey === null) return false;
		const key = this.view.selectionState.definitionRowKey, candidate = other.view.selectionState.definitionRowKey;
		const range = this.view.source.ranges.get(key)!, candidateRange = other.view.source.ranges.get(candidate)!;
		return range.start !== range.end && range.start === candidateRange.start && range.end === candidateRange.end
			&& this.view.source.nodesByRowKey.get(key)!.behaviorKind === other.view.source.nodesByRowKey.get(candidate)!.behaviorKind;
	}
	public readonly graphLayout: AsyncGraphLayout<StateGraphModel>;
	private definitionTitle: string | undefined;
	private ownedDefinition: BehaviorSourceNode | undefined;

	/** workingCopy anchors the registration; it is not necessarily an edit target. */
	public constructor(public readonly workingCopy: EditorTextModel, public readonly view: BehaviorLensViewState, sourceContexts: ReadonlySet<string>, createEngine: GraphLayoutEngineFactory,
		createView?: (source: BehaviorLensInput) => BehaviorLensInput, initialWorkingCopies: readonly EditorTextModel[] = [workingCopy]) {
		super(
			`behavior:${nextInputId++}`,
			'behavior_lens',
			'BEHAVIOR LENS',
			true,
		);
		if (createView !== undefined) this.createView = () => createView(this);
		this.graphLayout = this.disposables.add(new AsyncGraphLayout(createEngine));
		this.setWorkingCopies(new Set(initialWorkingCopies));
		this.updateDefinition();
		this.disposables.add({ dispose: editorTextModelService.onDidChangeContent((model, event) => {
			if (model.mode !== 'lua' || !sourceContexts.has(model.resource.contextId)) return;
			view.source.invalidate();
			if (view.source.models.get(resourceIdentityKey(model.resource)) === model) mapBehaviorLensSourceRanges(view, model.resource, event);
			this.invalidatePresentation();
		}) });
	}

	public override dispose(): void {
		this.view.selectionState.retire();
		super.dispose();
		this.view.source.release();
	}

	/** Publish this source generation's represented documents and input label together. */
	public updateDefinition(): void {
		const view = this.view;
		const definition = view.selectionState.definitionRowKey === null ? undefined : view.source.nodesByRowKey.get(view.selectionState.definitionRowKey)!;
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
					// A proven returned path can be written in an imported callback,
					// outside the declaration's displayed source-tree nodes.
					const references = view.stateMachines.references.get(node.rowKey);
					if (references !== undefined) for (const reference of references) {
						if (reference.kind !== 'state-outcome') continue;
						const literal = view.stateMachines.retargetLiterals.get(reference.outcome);
						if (literal !== undefined) models.add(view.source.models.get(reference.outcome.valueFile!.file)!);
					}
					for (const child of node.children) pending.push(child);
				}
			}
			this.setWorkingCopies(models);
		}
		if (definition === undefined) {
			this.setLabel(this.definitionTitle === undefined ? 'BEHAVIOR LENS' : `${this.definitionTitle} (removed)`, sourceTabDescription(this.workingCopy.resource));
			return;
		}
		this.definitionTitle = definition.label;
		this.setLabel(this.definitionTitle, sourceTabDescription(this.workingCopy.resource, definition.occurrenceRange.start.line));
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
					node.behaviorKind === 'action_effect' && node.rowKey === view.selectionState.definitionRowKey);
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
			const definition = view.document.definitions.find(node => node.rowKey === view.selectionState.definitionRowKey);
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
			viewport.setModel(state.model, stateGraphSelection(state.model, view.selectionState.selected));
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
