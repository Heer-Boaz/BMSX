import { SCROLLBAR_WIDTH } from '../../../common/constants';
import { GRAPH_NODE_PADDING } from '../../ui/graph/model';
import { measureWorkbenchPropertyTreeMinimumWidth } from '../../ui/property_tree';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { uppercaseOutsideStrings } from '../../../common/text';
import { measureText, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { reconcileBehaviorLensSource } from './source_correspondence';
import { resolveBehaviorSourceBookmark, type BehaviorSourceBookmark } from './source_bookmark';
import { copyStateMachineSourceBookmark, reconcileStateMachineSourceSelection } from './state_machine_selection';
import {
	clampWorkbenchListScroll,
	layoutWorkbenchList,
} from '../../ui/list_view';
import type { BehaviorKind, BehaviorSourceDocument, BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import { createBehaviorLensGraph, createBehaviorLensStateGraph, type BehaviorLensLayout, type BehaviorLensViewState, type BehaviorLensOutline } from './view_model';
import { prepareBehaviorGraphLayout } from './graph_layout';
import { stateGraphSelection } from './state_graph_navigation';
import { createBehaviorLensEffectProperties } from './action_effect_properties';

import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import type { BehaviorLensInput } from './editor_input';

const HEADER_PADDING_X = 4;
const HEADER_PADDING_Y = 2;
const CONTENT_PADDING_X = 4;
const TREE_INDENT_COLUMNS = 2;

// Preserve a named behavior and its relationship context, not just a clipped card sliver.
const GRAPH_READING_COLUMNS = 32;
const OUTLINE_READING_COLUMNS = 32;
const PROPERTY_NAME_READING_COLUMNS = 12;
const PROPERTY_VALUE_READING_COLUMNS = 20;

export function measureBehaviorLensMinimumWidth(state: BehaviorLensViewState, font: EditorFont = editorViewState.font): number {
	const presentation = state.presentation;
	if (presentation.kind === 'properties') return measureWorkbenchPropertyTreeMinimumWidth(font.renderFont(),
		PROPERTY_NAME_READING_COLUMNS, PROPERTY_VALUE_READING_COLUMNS) + CONTENT_PADDING_X * 2;
	if (presentation.kind === 'outline') return font.charAdvance * OUTLINE_READING_COLUMNS
		+ font.charAdvance * TREE_INDENT_COLUMNS * 2 + CONTENT_PADDING_X * 2;
	return font.charAdvance * GRAPH_READING_COLUMNS + GRAPH_NODE_PADDING * 2 + SCROLLBAR_WIDTH + CONTENT_PADDING_X * 2;
}

export function measureBehaviorLensEditor(input: BehaviorLensInput, font: EditorFont, companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = 0; target.minimumHeight = 0;
	target.companionWidth = companionRequested ? measureBehaviorLensMinimumWidth(input.view, font) : undefined;
}

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
	};
}

/**
 * Installs one source generation using text-owner correspondence, never old row keys.
 */
export function installBehaviorLensDocument(
	state: BehaviorLensViewState,
	document: BehaviorSourceDocument,
): void {
	if (!reconcileBehaviorLensSource(state, document)) return;
	state.headerDirty = true;
	if (state.presentation.kind !== 'outline') state.presentation.dirty = true;
	else {
		rebuildBehaviorLensRows(state, state.presentation);
		state.presentation.rowsDirty = false;
		state.presentation.textDirty = true;
	}
}

/** Both edit-associated selection and navigation restore use the same source proof. */
export function restoreBehaviorSourceBookmark(state: BehaviorLensViewState, bookmark: BehaviorSourceBookmark): void {
	const path = resolveBehaviorSourceBookmark(bookmark, state);
	if (path === undefined) { state.selectionState.select(null); return; }
	const rowKey = path[path.length - 1].rowKey;
	// History and Undo own their marker values. The active selection receives its own mapped copy.
	const selection = bookmark.kind === 'node' || bookmark.kind === 'tree-edge' ? { kind: bookmark.kind, rowKey }
		: reconcileStateMachineSourceSelection(copyStateMachineSourceBookmark(bookmark), state.stateMachines.references.get(rowKey), state.source.models);
	const previousKey = state.selectionState.definitionRowKey;
	state.selectionState.restore(path[0].rowKey, selection);
	presentBehaviorLensDefinition(state, path[0].rowKey, previousKey);
	if (state.presentation.kind === 'outline' || state.presentation.kind === 'properties') {
		for (let index = 0; index < path.length - 1; index += 1) state.presentation.collapsedRowKeys.delete(path[index].rowKey);
	}
}

/** An explicit picker choice selects a presentation; disappearing source does not select another definition. */
export function selectBehaviorLensDefinition(state: BehaviorLensViewState, key: BehaviorSourceRowKey): void {
	const previousKey = state.selectionState.definitionRowKey;
	state.selectionState.selectDefinition(key);
	presentBehaviorLensDefinition(state, key, previousKey);
}

function presentBehaviorLensDefinition(state: BehaviorLensViewState, key: BehaviorSourceRowKey, previousKey: BehaviorSourceRowKey | null): void {
	const definition = state.document.definitions.find(node => node.rowKey === key)!;
	if (definition.behaviorKind === 'behavior_tree' && state.presentation.kind === 'graph') {
		const graph = state.presentation;
		if (previousKey === key) graph.viewport.selection = graph.viewport.model.nodesBySource.get(key)!;
		else {
			graph.viewport.selection = null;
			graph.dirty = true;
			graph.viewport.frameAll();
		}
	} else if (definition.behaviorKind === 'behavior_tree') {
		state.presentation = createBehaviorLensGraph();
	} else if (definition.behaviorKind === 'state_machine') {
		if (state.presentation.kind !== 'state-graph') state.presentation = createBehaviorLensStateGraph();
		else if (previousKey !== key) {
			state.presentation.dirty = true;
			state.presentation.viewport.frameAll();
		}
		else state.presentation.viewport.selection = stateGraphSelection(state.presentation.viewport.model, state.selectionState.selected);
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
export function prepareBehaviorLensLayout(state: BehaviorLensViewState, bounds: Readonly<RectBounds>): BehaviorLensLayout {
	const layout = state.layout;
	const metricsChanged = updateFullWidthWorkbenchLayout(layout, bounds);
	const presentation = state.presentation;
	if (metricsChanged || state.headerDirty) {
		layout.headerBottom = layout.top + editorViewState.lineHeight + HEADER_PADDING_Y * 2;
		layoutWorkbenchActionBar(presentation.actionBar, layout.right - 4, layout.top, layout.headerBottom, measureText, editorViewState.font.renderFont(), layout.left + HEADER_PADDING_X);
		const definition = state.selectionState.definitionRowKey === null ? undefined : state.source.nodesByRowKey.get(state.selectionState.definitionRowKey);
		const header = definition === undefined ? uppercaseOutsideStrings(state.resource.path)
			: definition.preserveLabelCase ? definition.label : uppercaseOutsideStrings(definition.label);
		layout.headerText = truncateTextToWidth(header,
			presentation.actionBar.bounds.left - layout.left - HEADER_PADDING_X * 2);
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
	outline.selectionIndex = state.selectionState.selected === null ? -1 : findVisibleRowIndex(outline, state.selectionState.selected.rowKey);
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
		const expanded = expandable && !outline.collapsedRowKeys.has(node.rowKey);
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
		const label = row.node.preserveLabelCase ? row.node.label : uppercaseOutsideStrings(row.node.label);
		const displayText = `${' '.repeat(row.depth * TREE_INDENT_COLUMNS)}${marker} ${badge}${label}${uppercaseOutsideStrings(detail)}`;
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
