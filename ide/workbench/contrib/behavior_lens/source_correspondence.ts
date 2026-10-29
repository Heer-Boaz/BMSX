import { resourceIdentityKey, type ResourceIdentity } from '../../../common/resource';
import { trackedTextLocationsEqual } from '../../../editor/text/text_location';
import type { EditorTextModelContentChangeEvent } from '../../../editor/model/text_model';
import { BehaviorSourceIndex } from './source_index';
import type { BehaviorSourceDocument, BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { BehaviorLensViewState } from './view_model';
import type { BehaviorSourceSelection } from './source_selection';
import { copyStateMachineSourceBookmark, reconcileStateMachineSourceSelection } from './state_machine_selection';
import { indexStateMachineSource } from './state_machine_index';
import { behaviorSourceEditState, resolveBehaviorSourceBookmark } from './source_bookmark';
import { indexBehaviorTreeSource } from './behavior_tree_index';

/** Tracks the existing generation even while another pane edits its document. */
export function mapBehaviorLensSourceRanges(state: BehaviorLensViewState, resource: ResourceIdentity, event: EditorTextModelContentChangeEvent): void {
	const { changes, editState } = event, owner = state.selectionState;
	const definition = owner.definitionRowKey === null ? undefined : state.source.ranges.get(owner.definitionRowKey);
	owner.mapSourceChange(resource, changes);
	// A document's typed history belongs to its originating definition and selected intent.
	if (editState !== null && editState.is(behaviorSourceEditState) && event.editSource === state.editSource && definition !== undefined
		&& definition.start !== definition.end && trackedTextLocationsEqual(definition, editState.value.bookmark.path[0])) {
		owner.applySourceBookmark(editState.value.bookmark, editState.value.originIntent, event.kind !== 'edit');
	}
	if (state.presentation.kind === 'outline') state.presentation.hoverIndex = -1;
	else if (state.presentation.kind === 'properties') state.presentation.tree.hoverIndex = -1;
}

/**
 * Correspondence requires the same mapped syntactic use under a corresponding
 * parent. Shared initializer ranges alone cannot identify subtree occurrences.
 */
export function reconcileBehaviorLensSource(
	state: BehaviorLensViewState,
	document: BehaviorSourceDocument,
): boolean {
	const owner = state.selectionState, selectionRevision = owner.selectionRevision, definitionRevision = owner.definitionRevision;
	const selection = owner.selected;
	const selectedKey = selection?.rowKey;
	const oldDefinitionKey = owner.definitionRowKey;
	const oldRanges = state.source.ranges;
	const presentation = state.presentation;
	const oldCollapsedRows = presentation.kind === 'outline' || presentation.kind === 'properties' ? presentation.collapsedRowKeys : undefined;
	const oldCollapsed = oldCollapsedRows === undefined ? undefined : new Set(oldCollapsedRows);
	const collapsed = oldCollapsed === undefined ? undefined : new Set<BehaviorSourceRowKey>();
	const matches = new Set<BehaviorSourceRowKey>();
	const oldMatches = new Set(state.sourceMatchRowKeys);
	const oldDefinitions = state.document.definitions;
	const previousSource = state.source;
	const stateMachines = indexStateMachineSource(document);
	const source = BehaviorSourceIndex.acquire(document, previousSource.model, previousSource.resolveModel);
	if (state.source !== previousSource || owner.selectionRevision !== selectionRevision || owner.definitionRevision !== definitionRevision
		|| !owner.available || !source.isCurrent) { source.release(); return false; }
	let definition: BehaviorSourceRowKey | null = null;
	let selected: BehaviorSourceRowKey | null = null;

	function visit(nodes: readonly BehaviorSourceNode[], previous: readonly BehaviorSourceNode[], depth: number): void {
		const previousByResource = new Map<string, Map<number, BehaviorSourceNode>>();
		for (const node of previous) {
			const span = oldRanges.get(node.rowKey)!;
			if (span.start === span.end) continue;
			const resource = resourceIdentityKey(span.resource);
			let previousByStart = previousByResource.get(resource);
			if (previousByStart === undefined) { previousByStart = new Map(); previousByResource.set(resource, previousByStart); }
			previousByStart.set(span.start, node);
		}
		for (const node of nodes) {
			const span = source.ranges.get(node.rowKey)!;
			const candidate = previousByResource.get(resourceIdentityKey(span.resource))?.get(span.start);
			const prior = candidate !== undefined && trackedTextLocationsEqual(oldRanges.get(candidate.rowKey)!, span)
				&& candidate.kind === node.kind && candidate.behaviorKind === node.behaviorKind ? candidate : undefined;
			if (prior !== undefined) {
				if (prior.rowKey === selectedKey) selected = node.rowKey;
				if (prior.rowKey === oldDefinitionKey) definition = node.rowKey;
				if (oldCollapsed?.has(prior.rowKey)) collapsed!.add(node.rowKey);
				if (oldMatches.has(prior.rowKey)) matches.add(node.rowKey);
			} else if (collapsed !== undefined && node.children.length > 0 && depth > 1) {
				collapsed.add(node.rowKey);
			}
			if (node.children.length > 0) visit(node.children, prior === undefined ? [] : prior.children, depth + 1);
		}
	}

	visit(document.definitions, oldDefinitions, 0);
	let nextSelection: BehaviorSourceSelection | null = null;
	if (selected !== null) {
		const previousSelection = selection!;
		nextSelection = previousSelection.kind === 'node' || previousSelection.kind === 'tree-edge'
			? { kind: previousSelection.kind, rowKey: selected }
			: reconcileStateMachineSourceSelection(previousSelection, stateMachines.references.get(selected), source.models);
	}
	const bookmark = owner.takeSourceBookmark();
	if (bookmark !== undefined) {
		const path = resolveBehaviorSourceBookmark(bookmark, { document, source });
		nextSelection = null;
		if (path !== undefined) {
			definition = path[0].rowKey;
			const rowKey = path[path.length - 1].rowKey;
			nextSelection = bookmark.kind === 'node' || bookmark.kind === 'tree-edge' ? { kind: bookmark.kind, rowKey }
				: reconcileStateMachineSourceSelection(copyStateMachineSourceBookmark(bookmark), stateMachines.references.get(rowKey), source.models);
			for (let index = 0; index < path.length - 1; index++) collapsed?.delete(path[index].rowKey);
		}
	}
	if (nextSelection?.kind === 'tree-edge' && definition !== null) {
		const root = document.definitions.find(node => node.rowKey === definition)!;
		if (root.behaviorKind === 'behavior_tree') {
			const topology = indexBehaviorTreeSource(root);
			if (!topology.edges.has(nextSelection.rowKey)) nextSelection = null;
		}
	}
	// Publish all source facts and the corresponding semantic pair before invalidation callbacks.
	state.document = document;
	state.source = source;
	state.stateMachines = stateMachines;
	owner.reconcile(definition, nextSelection);
	state.sourceMatchRowKeys.clear();
	for (const key of matches) state.sourceMatchRowKeys.add(key);
	if (oldCollapsedRows !== undefined) {
		oldCollapsedRows.clear();
		for (const key of collapsed!) oldCollapsedRows.add(key);
	}
	if (previousSource !== source) previousSource.invalidate();
	previousSource.release();
	return true;
}
