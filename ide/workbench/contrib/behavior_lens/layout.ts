import { uppercaseOutsideStrings } from '../../../common/text';
import { truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import {
	clampWorkbenchListScroll,
	layoutWorkbenchList,
} from '../../ui/list_view';
import type { BehaviorKind, BehaviorSourceDocument, BehaviorSourceNode, BehaviorSourceRowKey } from './model';
import type { BehaviorLensLayout, BehaviorLensViewState } from './view_model';

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
		contentLeft: 0,
		contentTop: 0,
		contentRight: 0,
		contentBottom: 0,
		rowHeight: 0,
		visibleRowCount: 0,
		headerText: '',
		font: null,
		viewportWidth: -1,
		viewportHeight: -1,
		codeAreaTop: -1,
		codeAreaBottom: -1,
	};
}

/**
 * Installs one immutable source model while preserving view state for row keys
 * that still occur in the new source generation.
 */
export function installBehaviorLensDocument(
	state: BehaviorLensViewState,
	document: BehaviorSourceDocument,
): void {
	const selectedRowKey = state.selectionIndex >= 0 && state.selectionIndex < state.rows.length
		? state.rows[state.selectionIndex].node.rowKey
		: null;
	const previousRowKeys = new Set(state.nodesByRowKey.keys());
	state.document = document;
	state.sourceNodes.length = 0;
	state.nodesByRowKey.clear();
	state.parentRowKeyByRowKey.clear();
	state.sourceMatchRowKeys.clear();

	indexSourceNodes(state, document.definitions, null, 0, previousRowKeys);
	for (const rowKey of state.collapsedRowKeys) {
		if (!state.nodesByRowKey.has(rowKey)) {
			state.collapsedRowKeys.delete(rowKey);
		}
	}

	state.rowsDirty = true;
	rebuildBehaviorLensRows(state);
	state.rowsDirty = false;
	state.textDirty = true;
	if (selectedRowKey !== null) {
		const selectedIndex = findVisibleRowIndex(state, selectedRowKey);
		state.selectionIndex = selectedIndex >= 0 ? selectedIndex : defaultSelectionIndex(state);
	} else {
		state.selectionIndex = defaultSelectionIndex(state);
	}
	state.hoverIndex = -1;
}

function indexSourceNodes(
	state: BehaviorLensViewState,
	nodes: readonly BehaviorSourceNode[],
	parentRowKey: BehaviorSourceRowKey | null,
	depth: number,
	previousRowKeys: ReadonlySet<BehaviorSourceRowKey>,
): void {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		state.sourceNodes.push(node);
		state.nodesByRowKey.set(node.rowKey, node);
		state.parentRowKeyByRowKey.set(node.rowKey, parentRowKey);
		if (node.children.length > 0 && depth > 1 && !previousRowKeys.has(node.rowKey)) {
			state.collapsedRowKeys.add(node.rowKey);
		}
		indexSourceNodes(state, node.children, node.rowKey, depth + 1, previousRowKeys);
	}
}

/** Writes the retained layout only when the tree, font, or viewport changed. */
export function prepareBehaviorLensLayout(state: BehaviorLensViewState): BehaviorLensLayout {
	const layout = state.layout;
	if (updateFullWidthWorkbenchLayout(layout)) {
		layout.headerBottom = layout.top + editorViewState.lineHeight + HEADER_PADDING_Y * 2;
		layoutWorkbenchList(
			layout,
			layout.left + CONTENT_PADDING_X,
			layout.headerBottom + 1,
			layout.right - CONTENT_PADDING_X,
			layout.bottom,
			layout.rowHeight,
		);
		state.textDirty = true;
	}
	if (state.rowsDirty) {
		rebuildBehaviorLensRows(state);
		state.rowsDirty = false;
		state.textDirty = true;
	}
	if (state.textDirty) {
		writeRetainedText(state);
		state.textDirty = false;
	}
	clampWorkbenchListScroll(state);
	return layout;
}

export function rebuildBehaviorLensRows(state: BehaviorLensViewState): void {
	const selectedRowKey = state.selectionIndex >= 0 && state.selectionIndex < state.rows.length
		? state.rows[state.selectionIndex].node.rowKey
		: null;
	state.rows.length = 0;
	appendVisibleRows(state, state.document.definitions, 0, null);
	if (selectedRowKey !== null) {
		const selectedIndex = findVisibleRowIndex(state, selectedRowKey);
		state.selectionIndex = selectedIndex >= 0 ? selectedIndex : defaultSelectionIndex(state);
	} else {
		state.selectionIndex = defaultSelectionIndex(state);
	}
	state.hoverIndex = -1;
}

function appendVisibleRows(
	state: BehaviorLensViewState,
	nodes: readonly BehaviorSourceNode[],
	depth: number,
	parentRowKey: BehaviorSourceRowKey | null,
): void {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		const expandable = node.children.length > 0;
		const expanded = expandable && !state.collapsedRowKeys.has(node.rowKey);
		state.rows.push({
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
			appendVisibleRows(state, node.children, depth + 1, node.rowKey);
		}
	}
}

function writeRetainedText(state: BehaviorLensViewState): void {
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
	const rawHeader = `BEHAVIOR SOURCE  ${state.document.resource.path}  ${state.document.definitions.length} DEF`;
	layout.headerText = truncateTextToWidth(
		uppercaseOutsideStrings(rawHeader),
		layout.right - layout.left - HEADER_PADDING_X * 2,
	);
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
	state: BehaviorLensViewState,
	rowKey: BehaviorSourceRowKey,
): number {
	for (let index = 0; index < state.rows.length; index += 1) {
		if (state.rows[index].node.rowKey === rowKey) {
			return index;
		}
	}
	return -1;
}

function defaultSelectionIndex(state: BehaviorLensViewState): number {
	return state.rows.length > 0 ? 0 : -1;
}
