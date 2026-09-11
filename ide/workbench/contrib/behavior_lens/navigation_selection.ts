import { EditorPaneSelection } from '../../services/editor/editor_selection';
import type { BehaviorLensInput } from './editor_input';
import { behaviorSourceBookmarksEqual, captureBehaviorSourceBookmark, mapBehaviorSourceBookmark, resolveBehaviorSourceBookmark, type BehaviorSourceBookmark } from './source_bookmark';
import { restoreBehaviorSourceBookmark, selectBehaviorLensDefinition } from './layout';
import { stateGraphSelection } from './state_graph_navigation';
import { updateBehaviorLensStatus } from './navigation';
import type { BehaviorLensEffectProperties } from './action_effect_properties';

/** Source occurrence bookmarks plus view coordinates, never a retained AST or graph. */
export class BehaviorLensNavigationSelection extends EditorPaneSelection {
	public readonly definition: BehaviorSourceBookmark | undefined;
	public readonly selected: BehaviorSourceBookmark | undefined;
	public readonly collapsed: BehaviorSourceBookmark[] = [];
	public readonly collapsedGroups: BehaviorLensEffectProperties['selectedGroup'][] = [];
	public readonly selectedGroup: BehaviorLensEffectProperties['selectedGroup'];
	public readonly scrollX: number;
	public readonly scrollY: number;
	public readonly zoom: number;

	public constructor(input: BehaviorLensInput) {
		super();
		const view = input.view;
		this.definition = view.definitionRowKey === null ? undefined : captureBehaviorSourceBookmark(view, { kind: 'node', rowKey: view.definitionRowKey });
		this.selected = view.selection === null ? undefined : captureBehaviorSourceBookmark(view, view.selection);
		const presentation = view.presentation;
		this.selectedGroup = presentation.kind === 'properties' ? presentation.selectedGroup : undefined;
		if (presentation.kind === 'graph' || presentation.kind === 'state-graph') {
			const position = presentation.position;
			this.scrollX = position === 'initial' || position === 'preserve' ? presentation.viewport.scrollX : position.scrollX;
			this.scrollY = position === 'initial' || position === 'preserve' ? presentation.viewport.scrollY : position.scrollY;
			this.zoom = position === 'initial' || position === 'preserve' ? presentation.viewport.zoom : position.zoom;
		} else {
			this.zoom = 1;
			this.scrollX = 0;
			this.scrollY = presentation.kind === 'outline' ? presentation.scroll : presentation.tree.scroll;
			for (const rowKey of presentation.collapsedRowKeys) this.collapsed.push(captureBehaviorSourceBookmark(view, { kind: 'node', rowKey }));
			if (presentation.kind === 'properties') this.collapsedGroups.push(...presentation.collapsedGroups);
		}
		this.add({ dispose: input.workingCopy.onDidChangeContent(event => {
			if (this.definition !== undefined) mapBehaviorSourceBookmark(this.definition, event.changes);
			if (this.selected !== undefined) mapBehaviorSourceBookmark(this.selected, event.changes);
			for (const bookmark of this.collapsed) mapBehaviorSourceBookmark(bookmark, event.changes);
		}) });
	}

	public matches(other: BehaviorLensNavigationSelection): boolean {
		return behaviorSourceBookmarksEqual(this.definition, other.definition)
			&& behaviorSourceBookmarksEqual(this.selected, other.selected) && this.selectedGroup === other.selectedGroup;
	}

	public restore(input: BehaviorLensInput): void {
		const view = input.view; // The pane has refreshed the canonical source generation, not its geometry.
		const definition = this.definition === undefined ? undefined : resolveBehaviorSourceBookmark(this.definition, view);
		if (definition === undefined) {
			view.definitionRowKey = null;
			view.selection = null;
			input.invalidatePresentation();
		} else {
			if (view.definitionRowKey !== definition[0].rowKey) input.invalidatePresentation();
			selectBehaviorLensDefinition(view, definition[0].rowKey);
			if (this.selected === undefined) view.selection = null;
			else restoreBehaviorSourceBookmark(view, this.selected, input.workingCopy.buffer);
		}
		view.headerDirty = true;
		const presentation = view.presentation;
		if (presentation.kind === 'outline' || presentation.kind === 'properties') {
			presentation.collapsedRowKeys.clear();
			for (const bookmark of this.collapsed) {
				const path = resolveBehaviorSourceBookmark(bookmark, view);
				if (path !== undefined) presentation.collapsedRowKeys.add(path[path.length - 1].rowKey);
			}
			if (presentation.kind === 'outline') { presentation.rowsDirty = true; presentation.scroll = this.scrollY; }
			else {
				presentation.collapsedGroups.clear();
				for (const group of this.collapsedGroups) presentation.collapsedGroups.add(group);
				presentation.selectedGroup = definition === undefined ? undefined : this.selectedGroup;
				presentation.tree.scroll = this.scrollY;
				presentation.dirty = true;
			}
		} else {
			presentation.position = { scrollX: this.scrollX, scrollY: this.scrollY, zoom: this.zoom };
			const viewport = presentation.viewport;
			if (presentation.kind === 'state-graph') viewport.selection = stateGraphSelection(presentation.viewport.model, view.selection);
			else {
				viewport.selection = null;
				if (view.selection !== null) {
					const model = presentation.viewport.model;
					const selected = view.selection.kind === 'node' ? model.nodesBySource.get(view.selection.rowKey) : model.edgesBySource.get(view.selection.rowKey);
					if (selected !== undefined) viewport.selection = selected;
				}
			}
		}

		updateBehaviorLensStatus(view);
	}
}
