import { uppercaseOutsideStrings } from '../../../common/text';
import { measureText, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import { reconcileBehaviorLensSource } from './source_correspondence';
import { resolveBehaviorSourceBookmark } from './source_bookmark';
import {
	clampWorkbenchListScroll,
	layoutWorkbenchList,
} from '../../ui/list_view';
import type { BehaviorKind, BehaviorSourceDocument, BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import { createBehaviorLensGraph, createBehaviorLensStateGraph, type BehaviorLensLayout, type BehaviorLensViewState, type BehaviorLensOutline } from './view_model';
import { prepareBehaviorGraphLayout } from './graph_layout';
import { indexStateMachineSource } from './state_machine_index';
import { stateGraphSelection } from './state_graph_navigation';
import { createBehaviorLensEffectProperties } from './action_effect_properties';

import { layoutWorkbenchActionBar } from '../../ui/action_bar';

const HEADER_PADDING_X = 4;
const HEADER_PADDING_Y = 2;
const CONTENT_PADDING_X = 4;
const TREE_INDENT_COLUMNS = 2;

export function createBehaviorLensLayout(): BehaviorLensLayout {
	return {
		left: 0,
		top: 0,
		right: 0,
		bottom: 0,
		headerBottom: 0,
		rowHeight: 0,
		headerText: '',
		font: null,
		viewportWidth: -1,
		viewportHeight: -1,
		codeAreaTop: -1,
		codeAreaBottom: -1,
	};
}

/**
 * Installs one source generation using text-owner correspondence, never old row keys.
 */
export function installBehaviorLensDocument(
	state: BehaviorLensViewState,
	document: BehaviorSourceDocument,
	buffer: TextBuffer,
): void {
	state.selection = reconcileBehaviorLensSource(state, document, buffer);
	const bookmark = state.selectionBookmark;
	state.selectionBookmark = undefined;
	if (bookmark !== undefined) {
		const path = resolveBehaviorSourceBookmark(bookmark, state);
		state.selection = null;
		if (path !== undefined) {
			selectBehaviorLensDefinition(state, path[0].rowKey);
			state.selection = { kind: bookmark.kind, rowKey: path[path.length - 1].rowKey };
			for (let index = 0; index < path.length - 1; index += 1) state.collapsedRowKeys.delete(path[index].rowKey);
		}
	}
	state.stateMachines = indexStateMachineSource(document);
	state.headerDirty = true;
	if (state.presentation.kind !== 'outline') state.presentation.dirty = true;
	else {
		rebuildBehaviorLensRows(state, state.presentation);
		state.presentation.rowsDirty = false;
		state.presentation.textDirty = true;
	}
}

/** An explicit picker choice selects a presentation; disappearing source does not select another definition. */
export function selectBehaviorLensDefinition(state: BehaviorLensViewState, key: BehaviorSourceRowKey): void {
	const previousKey = state.definitionRowKey;
	state.definitionRowKey = key;
	state.selection = { kind: 'node', rowKey: key };
	const definition = state.document.definitions.find(node => node.rowKey === key)!;
	if (definition.behaviorKind === 'behavior_tree' && state.presentation.kind === 'graph') {
		const graph = state.presentation;
		if (previousKey === key) graph.viewport.selection = graph.viewport.model.nodesBySource.get(key)!;
		else {
			graph.viewport.selection = null;
			graph.dirty = true;
			graph.initialPosition = true;
		}
	} else if (definition.behaviorKind === 'behavior_tree') {
		state.presentation = createBehaviorLensGraph();
	} else if (definition.behaviorKind === 'state_machine') {
		if (state.presentation.kind !== 'state-graph') state.presentation = createBehaviorLensStateGraph();
		else if (previousKey !== key) {
			state.presentation.dirty = true;
			state.presentation.initialPosition = true;
		}
		else state.presentation.viewport.selection = stateGraphSelection(state.presentation.viewport.model, state.selection);
	} else if (state.presentation.kind === 'properties') {
		state.presentation.selectedGroup = undefined;
		state.presentation.tree.selectionIndex = -1;
		state.presentation.tree.hoverIndex = -1;
		if (previousKey !== key) {
			state.presentation.collapsedGroups.clear();
			state.presentation.dirty = true;
		}
	} else state.presentation = createBehaviorLensEffectProperties();
	state.headerDirty = true;
}

/** Writes the retained layout only when the tree, font, or viewport changed. */
export function prepareBehaviorLensLayout(state: BehaviorLensViewState): BehaviorLensLayout {
	const layout = state.layout;
	const metricsChanged = updateFullWidthWorkbenchLayout(layout);
	const presentation = state.presentation;
	if (metricsChanged || state.headerDirty) {
		layout.headerBottom = layout.top + editorViewState.lineHeight + HEADER_PADDING_Y * 2;
		layoutWorkbenchActionBar(presentation.actionBar, layout.right - 4, layout.top, layout.headerBottom, measureText);
		const definition = state.definitionRowKey === null ? undefined : state.nodesByRowKey.get(state.definitionRowKey);
		layout.headerText = truncateTextToWidth(uppercaseOutsideStrings(definition === undefined ? state.resource.path : definition.label),
			presentation.actionBar.items[0].bounds.left - layout.left - HEADER_PADDING_X * 2);
		if (presentation.kind === 'outline') {
			layoutWorkbenchList(presentation.layout, layout.left + CONTENT_PADDING_X, layout.headerBottom + 1,
				layout.right - CONTENT_PADDING_X, layout.bottom, layout.rowHeight);
			presentation.textDirty = true;
		} else if (presentation.kind !== 'properties') presentation.viewport.layout(layout.left, layout.headerBottom + 1, layout.right, layout.bottom);
		state.headerDirty = false;
	}
	if (presentation.kind === 'graph') {
		prepareBehaviorGraphLayout(state, presentation, editorViewState.font.renderFont());
		return layout;
	}
	if (presentation.kind === 'state-graph' || presentation.kind === 'properties') return layout;
	if (presentation.rowsDirty) {
		rebuildBehaviorLensRows(state, presentation);
		presentation.rowsDirty = false;
		presentation.textDirty = true;
	}
	if (presentation.textDirty) {
		writeRetainedText(presentation);
		presentation.textDirty = false;
	}
	clampWorkbenchListScroll(presentation);
	return layout;
}

export function rebuildBehaviorLensRows(state: BehaviorLensViewState, outline: BehaviorLensOutline): void {
	outline.rows.length = 0;
	appendVisibleRows(state, outline, state.document.definitions, 0, null);
	outline.selectionIndex = state.selection === null ? -1 : findVisibleRowIndex(outline, state.selection.rowKey);
	outline.hoverIndex = -1;
}

function appendVisibleRows(
	state: BehaviorLensViewState,
	outline: BehaviorLensOutline,
	nodes: readonly BehaviorSourceNode[],
	depth: number,
	parentRowKey: BehaviorSourceRowKey | null,
): void {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		const expandable = node.children.length > 0;
		const expanded = expandable && !state.collapsedRowKeys.has(node.rowKey);
		outline.rows.push({
			node,
			depth,
			parentRowKey,
			expandable,
			expanded,
			text: '',
			twistieLeft: 0,
			twistieRight: 0,
		});
		if (expanded) {
			appendVisibleRows(state, outline, node.children, depth + 1, node.rowKey);
		}
	}
}

function writeRetainedText(state: BehaviorLensOutline): void {
	const layout = state.layout;
	const font = editorViewState.font;
	const indentWidth = font.advance(' ') * TREE_INDENT_COLUMNS;
	const markerHitWidth = indentWidth;
	const availableWidth = layout.contentRight - layout.contentLeft;
	for (let index = 0; index < state.rows.length; index += 1) {
		const row = state.rows[index];
		const marker = row.expandable ? (row.expanded ? '-' : '+') : ' ';
		const badge = behaviorKindBadge(row.node.behaviorKind, row.node.kind === 'definition');
		const detail = row.node.detail.length > 0 ? `  ${row.node.detail}` : '';
		const rawText = `${' '.repeat(row.depth * TREE_INDENT_COLUMNS)}${marker} ${badge}${row.node.label}${detail}`;
		const displayText = uppercaseOutsideStrings(rawText);
		row.text = truncateTextToWidth(displayText, availableWidth);
		row.twistieLeft = layout.contentLeft + row.depth * indentWidth;
		row.twistieRight = row.twistieLeft + markerHitWidth;
	}
}

function behaviorKindBadge(kind: BehaviorKind, definition: boolean): string {
	if (!definition) {
		return '';
	}
	switch (kind) {
		case 'behavior_tree': return 'BT  ';
		case 'state_machine': return 'FSM  ';
		case 'action_effect': return 'FX  ';
	}
}

export function findVisibleRowIndex(
	state: BehaviorLensOutline,
	rowKey: BehaviorSourceRowKey,
): number {
	for (let index = 0; index < state.rows.length; index += 1) {
		if (state.rows[index].node.rowKey === rowKey) {
			return index;
		}
	}
	return -1;
}
