import type { TextBuffer } from '../../../editor/text/text_buffer';
import { mapTrackedTextRange, type EditorTextChange, type TrackedTextRange } from '../../../editor/text/text_change';
import { luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { BehaviorSourceDocument, BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { BehaviorLensViewState } from './view_model';

/** Tracks the existing generation even while another pane edits its document. */
export function mapBehaviorLensSourceRanges(state: BehaviorLensViewState, changes: readonly EditorTextChange[]): void {
	for (const span of state.sourceRanges.values()) mapTrackedTextRange(span, changes);
	if (state.presentation.kind === 'outline') state.presentation.hoverIndex = -1;
}

/**
 * Correspondence requires the same mapped syntactic use under a corresponding
 * parent. Shared initializer ranges alone cannot identify subtree occurrences.
 */
export function reconcileBehaviorLensSource(
	state: BehaviorLensViewState,
	document: BehaviorSourceDocument,
	buffer: TextBuffer,
): BehaviorSourceRowKey | null {
	const selectedKey = state.selectedRowKey;
	const oldDefinitionKey = state.definitionRowKey;
	const oldRanges = state.sourceRanges;
	const oldCollapsed = new Set(state.collapsedRowKeys);
	const oldMatches = new Set(state.sourceMatchRowKeys);
	const oldDefinitions = state.document.definitions;
	const newRanges = new Map<BehaviorSourceRowKey, TrackedTextRange>();
	let selected: BehaviorSourceRowKey | null = null;
	state.definitionRowKey = null;
	state.sourceNodes.length = 0;
	state.nodesByRowKey.clear();
	state.parentRowKeyByRowKey.clear();
	state.collapsedRowKeys.clear();
	state.sourceMatchRowKeys.clear();

	function visit(nodes: readonly BehaviorSourceNode[], previous: readonly BehaviorSourceNode[], parent: BehaviorSourceRowKey | null, depth: number): void {
		const previousByStart = new Map<number, BehaviorSourceNode>();
		for (const node of previous) {
			const span = oldRanges.get(node.rowKey)!;
			if (span.start !== span.end) previousByStart.set(span.start, node);
		}
		for (const node of nodes) {
			const span = luaSourceRangeToTextRange(buffer, node.occurrenceRange);
			const candidate = previousByStart.get(span.start);
			const prior = candidate !== undefined && oldRanges.get(candidate.rowKey)!.end === span.end
				&& candidate.kind === node.kind && candidate.behaviorKind === node.behaviorKind ? candidate : undefined;
			newRanges.set(node.rowKey, span);
			state.sourceNodes.push(node);
			state.nodesByRowKey.set(node.rowKey, node);
			state.parentRowKeyByRowKey.set(node.rowKey, parent);
			if (prior !== undefined) {
				if (prior.rowKey === selectedKey) selected = node.rowKey;
				if (prior.rowKey === oldDefinitionKey) state.definitionRowKey = node.rowKey;
				if (oldCollapsed.has(prior.rowKey)) state.collapsedRowKeys.add(node.rowKey);
				if (oldMatches.has(prior.rowKey)) state.sourceMatchRowKeys.add(node.rowKey);
			} else if (node.children.length > 0 && depth > 1) {
				state.collapsedRowKeys.add(node.rowKey);
			}
			if (node.children.length > 0) visit(node.children, prior === undefined ? [] : prior.children, node.rowKey, depth + 1);
		}
	}

	visit(document.definitions, oldDefinitions, null, 0);
	state.document = document;
	state.sourceRanges = newRanges;
	return selected;
}
