import type { WorkbenchGraphViewState } from '../../ui/graph/viewport';
import type { BehaviorLensInput } from './editor_input';
import { captureBehaviorSourceBookmark, copyBehaviorSourceBookmark, mapBehaviorSourceBookmark, resolveBehaviorSourceBookmark, type BehaviorSourceBookmark } from './source_bookmark';
import { restoreBehaviorSourceBookmark, selectBehaviorLensDefinition } from './layout';
import { stateGraphSelection } from './state_graph_navigation';
import { updateBehaviorLensStatus } from './navigation';
import type { BehaviorLensEffectProperties } from './action_effect_properties';
import type { ResourceIdentity } from '../../../common/resource';
import type { EditorTextChange } from '../../../editor/text/text_change';

/** Plain source occurrences and viewport values, independent of navigation lifetime. */
export type BehaviorLensViewSnapshot = {
	readonly definition: BehaviorSourceBookmark | undefined;
	readonly selected: BehaviorSourceBookmark | undefined;
	readonly collapsed: readonly BehaviorSourceBookmark[];
	readonly collapsedGroups: readonly BehaviorLensEffectProperties['selectedGroup'][];
	readonly selectedGroup: BehaviorLensEffectProperties['selectedGroup'];
	readonly reading: { readonly kind: 'graph'; readonly camera: WorkbenchGraphViewState }
		| { readonly kind: 'list'; readonly scroll: number };
};

export function captureBehaviorLensView(input: BehaviorLensInput): BehaviorLensViewSnapshot {
	const view = input.view;
	const definition = view.selectionState.definitionRowKey === null ? undefined : captureBehaviorSourceBookmark(view, { kind: 'node', rowKey: view.selectionState.definitionRowKey });
	const selected = view.selectionState.pendingBookmark !== undefined ? copyBehaviorSourceBookmark(view.selectionState.pendingBookmark)
		: view.selectionState.selected === null ? undefined : captureBehaviorSourceBookmark(view, view.selectionState.selected);
	const presentation = view.presentation;
	const collapsed: BehaviorSourceBookmark[] = [];
	const collapsedGroups: BehaviorLensEffectProperties['selectedGroup'][] = [];
	const selectedGroup = presentation.kind === 'properties' ? presentation.selectedGroup : undefined;
	let reading: BehaviorLensViewSnapshot['reading'];
	if (presentation.kind === 'graph' || presentation.kind === 'state-graph') reading = { kind: 'graph', camera: presentation.viewport.captureViewState() };
	else {
		reading = { kind: 'list', scroll: presentation.kind === 'outline' ? presentation.scroll : presentation.tree.scroll };
		for (const rowKey of presentation.collapsedRowKeys) collapsed.push(captureBehaviorSourceBookmark(view, { kind: 'node', rowKey }));
		if (presentation.kind === 'properties') collapsedGroups.push(...presentation.collapsedGroups);
	}
	return { definition, selected, collapsed, collapsedGroups, selectedGroup, reading };
}

/** Only live navigation owns a mapped copy; persisted snapshots remain immutable. */
export function mapBehaviorLensView(snapshot: BehaviorLensViewSnapshot, resource: ResourceIdentity, changes: readonly EditorTextChange[]): void {
	if (snapshot.definition !== undefined) mapBehaviorSourceBookmark(snapshot.definition, resource, changes);
	if (snapshot.selected !== undefined) mapBehaviorSourceBookmark(snapshot.selected, resource, changes);
	for (const bookmark of snapshot.collapsed) mapBehaviorSourceBookmark(bookmark, resource, changes);
}

export function restoreBehaviorLensView(input: BehaviorLensInput, snapshot: BehaviorLensViewSnapshot): void {
	const view = input.view; // The pane has refreshed the canonical source generation, not its geometry.
	const definition = snapshot.definition === undefined ? undefined : resolveBehaviorSourceBookmark(snapshot.definition, view);
	if (definition === undefined) {
		view.selectionState.restore(null, null);
		input.invalidatePresentation();
	} else {
		if (view.selectionState.definitionRowKey !== definition[0].rowKey) input.invalidatePresentation();
		selectBehaviorLensDefinition(view, definition[0].rowKey);
		if (snapshot.selected === undefined) view.selectionState.restore(definition[0].rowKey, null);
		else restoreBehaviorSourceBookmark(view, snapshot.selected);
	}
	view.headerDirty = true;
	const presentation = view.presentation;
	if (presentation.kind === 'outline' || presentation.kind === 'properties') {
		presentation.collapsedRowKeys.clear();
		for (const bookmark of snapshot.collapsed) {
			const path = resolveBehaviorSourceBookmark(bookmark, view);
			if (path !== undefined) presentation.collapsedRowKeys.add(path[path.length - 1].rowKey);
		}
		if (presentation.kind === 'outline') {
			presentation.rowsDirty = true;
			if (snapshot.reading.kind === 'list') presentation.scroll = snapshot.reading.scroll;
		}
		else {
			presentation.collapsedGroups.clear();
			for (const group of snapshot.collapsedGroups) presentation.collapsedGroups.add(group);
			presentation.selectedGroup = definition === undefined ? undefined : snapshot.selectedGroup;
			if (snapshot.reading.kind === 'list') presentation.tree.scroll = snapshot.reading.scroll;
			presentation.dirty = true;
		}
	} else {
		// Restoring source intent can enter a different presentation. Only its
		// actual reading capability transfers; a new diagram retains its own Fit.
		if (snapshot.reading.kind === 'graph') presentation.viewport.restoreViewState(snapshot.reading.camera);
		const viewport = presentation.viewport;
		if (presentation.kind === 'state-graph') viewport.selection = stateGraphSelection(presentation.viewport.model, view.selectionState.selected);
		else {
			viewport.selection = null;
			if (view.selectionState.selected !== null) {
				const model = presentation.viewport.model;
				const selected = view.selectionState.selected.kind === 'node' ? model.nodesBySource.get(view.selectionState.selected.rowKey) : model.edgesBySource.get(view.selectionState.selected.rowKey);
				if (selected !== undefined) viewport.selection = selected;
			}
		}
	}

	updateBehaviorLensStatus(view);
}
