import type { ResourceIdentity } from '../../../common/resource';
import { trackedTextLocationsEqual } from '../../../editor/text/text_location';
import type { EditorTextModelContentChangeEvent } from '../../../editor/model/text_model';
import { BehaviorSourceIndex } from './source_index';
import type { BehaviorSourceDocument, BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { BehaviorLensViewState } from './view_model';
import type { BehaviorSourceSelection } from './source_selection';
import { mapStateMachineSourceSelection, reconcileStateMachineSourceSelection } from './state_machine_selection';
import { behaviorSourceEditState, copyBehaviorSourceBookmark, mapBehaviorSourceBookmark } from './source_bookmark';

/** Tracks the existing generation even while another pane edits its document. */
export function mapBehaviorLensSourceRanges(state: BehaviorLensViewState, resource: ResourceIdentity, event: EditorTextModelContentChangeEvent): void {
	const { changes, editState } = event;
	const definition = state.definitionRowKey === null ? undefined : state.source.ranges.get(state.definitionRowKey);
	// A document's undo state belongs to the edited registration, not all its views.
	if (editState !== null && editState.is(behaviorSourceEditState) && definition !== undefined
		&& definition.start !== definition.end && trackedTextLocationsEqual(definition, editState.value.path[0])) {
		state.selectionBookmark = copyBehaviorSourceBookmark(editState.value);
	} else if (state.selectionBookmark !== undefined) {
		mapBehaviorSourceBookmark(state.selectionBookmark, resource, changes);
	}
	const selection = state.selection;
	if (selection !== null && (selection.kind === 'state-outcome' || selection.kind === 'state-entry')) {
		mapStateMachineSourceSelection(selection, resource, changes);
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
): BehaviorSourceSelection | null {
	const selection = state.selection;
	const selectedKey = selection?.rowKey;
	const oldDefinitionKey = state.definitionRowKey;
	const oldRanges = state.source.ranges;
	const presentation = state.presentation;
	const collapsed = presentation.kind === 'outline' || presentation.kind === 'properties' ? presentation.collapsedRowKeys : undefined;
	const oldCollapsed = collapsed === undefined ? undefined : new Set(collapsed);
	const oldMatches = new Set(state.sourceMatchRowKeys);
	const oldDefinitions = state.document.definitions;
	const previousSource = state.source;
	const source = BehaviorSourceIndex.acquire(document, previousSource.model, previousSource.resolveModel);
	let selected: BehaviorSourceRowKey | null = null;
	state.definitionRowKey = null;
	collapsed?.clear();
	state.sourceMatchRowKeys.clear();

	function visit(nodes: readonly BehaviorSourceNode[], previous: readonly BehaviorSourceNode[], depth: number): void {
		const previousByResource = new Map<string, Map<number, BehaviorSourceNode>>();
		for (const node of previous) {
			const span = oldRanges.get(node.rowKey)!;
			if (span.start === span.end) continue;
			const resource = span.resource.path;
			let previousByStart = previousByResource.get(resource);
			if (previousByStart === undefined) { previousByStart = new Map(); previousByResource.set(resource, previousByStart); }
			previousByStart.set(span.start, node);
		}
		for (const node of nodes) {
			const span = source.ranges.get(node.rowKey)!;
			const candidate = previousByResource.get(span.resource.path)?.get(span.start);
			const prior = candidate !== undefined && trackedTextLocationsEqual(oldRanges.get(candidate.rowKey)!, span)
				&& candidate.kind === node.kind && candidate.behaviorKind === node.behaviorKind ? candidate : undefined;
			if (prior !== undefined) {
				if (prior.rowKey === selectedKey) selected = node.rowKey;
				if (prior.rowKey === oldDefinitionKey) state.definitionRowKey = node.rowKey;
				if (oldCollapsed?.has(prior.rowKey)) collapsed!.add(node.rowKey);
				if (oldMatches.has(prior.rowKey)) state.sourceMatchRowKeys.add(node.rowKey);
			} else if (collapsed !== undefined && node.children.length > 0 && depth > 1) {
				collapsed.add(node.rowKey);
			}
			if (node.children.length > 0) visit(node.children, prior === undefined ? [] : prior.children, depth + 1);
		}
	}

	visit(document.definitions, oldDefinitions, 0);
	state.document = document;
	if (previousSource !== source) previousSource.invalidate();
	state.source = source;
	previousSource.release();
	if (selected === null) return null;
	const previousSelection = selection!;
	if (previousSelection.kind === 'node' || previousSelection.kind === 'tree-edge') return { kind: previousSelection.kind, rowKey: selected };
	return reconcileStateMachineSourceSelection(previousSelection, state.stateMachines.references.get(selected), source.models);
}
