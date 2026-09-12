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
	readonly scrollX: number;
	readonly scrollY: number;
	readonly zoom: number;
};

export function captureBehaviorLensView(input: BehaviorLensInput): BehaviorLensViewSnapshot {
	const view = input.view;
	const definition = view.definitionRowKey === null ? undefined : captureBehaviorSourceBookmark(view, { kind: 'node', rowKey: view.definitionRowKey });
	const selected = view.selectionBookmark !== undefined ? copyBehaviorSourceBookmark(view.selectionBookmark)
		: view.selection === null ? undefined : captureBehaviorSourceBookmark(view, view.selection);
	const presentation = view.presentation;
	const collapsed: BehaviorSourceBookmark[] = [];
	const collapsedGroups: BehaviorLensEffectProperties['selectedGroup'][] = [];
	const selectedGroup = presentation.kind === 'properties' ? presentation.selectedGroup : undefined;
	let scrollX: number, scrollY: number, zoom: number;
	if (presentation.kind === 'graph' || presentation.kind === 'state-graph') {
		const position = presentation.position;
		scrollX = position === 'initial' || position === 'preserve' ? presentation.viewport.scrollX : position.scrollX;
		scrollY = position === 'initial' || position === 'preserve' ? presentation.viewport.scrollY : position.scrollY;
		zoom = position === 'initial' || position === 'preserve' ? presentation.viewport.zoom : position.zoom;
	} else {
		zoom = 1; scrollX = 0;
		scrollY = presentation.kind === 'outline' ? presentation.scroll : presentation.tree.scroll;
		for (const rowKey of presentation.collapsedRowKeys) collapsed.push(captureBehaviorSourceBookmark(view, { kind: 'node', rowKey }));
		if (presentation.kind === 'properties') collapsedGroups.push(...presentation.collapsedGroups);
	}
	return { definition, selected, collapsed, collapsedGroups, selectedGroup, scrollX, scrollY, zoom };
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
		view.definitionRowKey = null;
		view.selection = null;
		input.invalidatePresentation();
	} else {
		if (view.definitionRowKey !== definition[0].rowKey) input.invalidatePresentation();
		selectBehaviorLensDefinition(view, definition[0].rowKey);
		if (snapshot.selected === undefined) view.selection = null;
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
		if (presentation.kind === 'outline') { presentation.rowsDirty = true; presentation.scroll = snapshot.scrollY; }
		else {
			presentation.collapsedGroups.clear();
			for (const group of snapshot.collapsedGroups) presentation.collapsedGroups.add(group);
			presentation.selectedGroup = definition === undefined ? undefined : snapshot.selectedGroup;
			presentation.tree.scroll = snapshot.scrollY;
			presentation.dirty = true;
		}
	} else {
		presentation.position = { scrollX: snapshot.scrollX, scrollY: snapshot.scrollY, zoom: snapshot.zoom };
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
