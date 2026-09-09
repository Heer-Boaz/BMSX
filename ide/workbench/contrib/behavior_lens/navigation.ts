import { executeBehaviorGraphNavigation } from './graph_navigation';
import { clamp } from '../../../../machine/ts/common/clamp';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import {
	findVisibleRowIndex,
	rebuildBehaviorLensRows,
} from './layout';
import { revealWorkbenchListSelection } from '../../ui/list_view';
import type { BehaviorLensOutline, BehaviorLensViewState } from './view_model';

export type BehaviorLensNavigationCommand =
	| 'up'
	| 'down'
	| 'page-up'
	| 'page-down'
	| 'home'
	| 'end'
	| 'left'
	| 'right'
	| 'activate'
	| 'back';

export const enum BehaviorLensNavigationResult {
	None,
	Changed,
	Activate,
	Back,
	Panned,
}

export function executeBehaviorLensNavigation(
	state: BehaviorLensViewState,
	command: BehaviorLensNavigationCommand,
): BehaviorLensNavigationResult {
	const outline = state.presentation;
	if (outline.kind === 'graph') return executeBehaviorGraphNavigation(state, outline, command);
	if (command === 'back') {
		return BehaviorLensNavigationResult.Back;
	}
	if (command === 'activate') {
		return outline.selectionIndex >= 0
			? BehaviorLensNavigationResult.Activate
			: BehaviorLensNavigationResult.None;
	}
	if (outline.rows.length === 0) {
		return BehaviorLensNavigationResult.None;
	}
	const selectionIndex = outline.selectionIndex;
	switch (command) {
		case 'up': return selectRow(state, outline, selectionIndex - 1);
		case 'down': return selectRow(state, outline, selectionIndex + 1);
		case 'page-up': return selectRow(state, outline, selectionIndex < 0 ? outline.scroll : selectionIndex - outline.layout.visibleRowCount);
		case 'page-down': return selectRow(state, outline, selectionIndex < 0
			? outline.scroll + outline.layout.visibleRowCount - 1 : selectionIndex + outline.layout.visibleRowCount);
		case 'home': return selectRow(state, outline, 0);
		case 'end': return selectRow(state, outline, outline.rows.length - 1);
		case 'left': return selectionIndex < 0 ? BehaviorLensNavigationResult.None : collapseOrSelectParent(state, outline, selectionIndex);
		case 'right': return selectionIndex < 0 ? BehaviorLensNavigationResult.None : expandOrSelectChild(state, outline, selectionIndex);
	}
}

function selectRow(
	state: BehaviorLensViewState,
	outline: BehaviorLensOutline,
	index: number,
): BehaviorLensNavigationResult {
	const nextIndex = clamp(index, 0, outline.rows.length - 1);
	if (nextIndex === outline.selectionIndex) {
		return BehaviorLensNavigationResult.None;
	}
	outline.selectionIndex = nextIndex;
	state.selectedRowKey = outline.rows[nextIndex].node.rowKey;
	outline.hoverIndex = -1;
	return BehaviorLensNavigationResult.Changed;
}

function collapseOrSelectParent(
	state: BehaviorLensViewState,
	outline: BehaviorLensOutline,
	selectionIndex: number,
): BehaviorLensNavigationResult {
	const row = outline.rows[selectionIndex];
	if (row.expandable && row.expanded) {
		state.collapsedRowKeys.add(row.node.rowKey);
		outline.rowsDirty = true;
		rebuildBehaviorLensRows(state, outline);
		outline.rowsDirty = false;
		outline.textDirty = true;
		return BehaviorLensNavigationResult.Changed;
	}
	if (row.parentRowKey === null) {
		return BehaviorLensNavigationResult.None;
	}
	return selectRow(state, outline, findVisibleRowIndex(outline, row.parentRowKey));
}

function expandOrSelectChild(
	state: BehaviorLensViewState,
	outline: BehaviorLensOutline,
	selectionIndex: number,
): BehaviorLensNavigationResult {
	const row = outline.rows[selectionIndex];
	if (!row.expandable) {
		return BehaviorLensNavigationResult.None;
	}
	if (!row.expanded) {
		state.collapsedRowKeys.delete(row.node.rowKey);
		outline.rowsDirty = true;
		rebuildBehaviorLensRows(state, outline);
		outline.rowsDirty = false;
		outline.textDirty = true;
		return BehaviorLensNavigationResult.Changed;
	}
	return selectRow(state, outline, selectionIndex + 1);
}

export function selectBehaviorLensRow(state: BehaviorLensViewState, outline: BehaviorLensOutline, rowIndex: number): void {
	state.selectedRowKey = rowIndex < 0 ? null : outline.rows[rowIndex].node.rowKey;
	outline.selectionIndex = rowIndex;
	outline.hoverIndex = -1;
	updateBehaviorLensStatus(state);
}

export function toggleBehaviorLensRow(state: BehaviorLensViewState, outline: BehaviorLensOutline, rowIndex: number): void {
	const row = outline.rows[rowIndex];
	if (row.expanded) {
		state.collapsedRowKeys.add(row.node.rowKey);
	} else {
		state.collapsedRowKeys.delete(row.node.rowKey);
	}
	state.selectedRowKey = outline.rows[rowIndex].node.rowKey;
	outline.selectionIndex = rowIndex;
	outline.rowsDirty = true;
	rebuildBehaviorLensRows(state, outline);
	outline.rowsDirty = false;
	outline.textDirty = true;
	updateBehaviorLensStatus(state);
}

export function selectedBehaviorLensSourceRange(state: BehaviorLensViewState): LuaSourceRange | null {
	if (state.selectedRowKey === null) return null;
	const presentation = state.presentation;
	if (presentation.kind === 'graph' && presentation.viewport.selection?.kind === 'edge') return presentation.viewport.selection.range;
	const node = state.nodesByRowKey.get(state.selectedRowKey)!;
	return node.referenceRange !== null ? node.referenceRange : node.authoredRange;
}

export function finishBehaviorLensNavigation(state: BehaviorLensViewState): void {
	if (state.presentation.kind === 'outline') revealWorkbenchListSelection(state.presentation);
	else if (state.presentation.viewport.selection !== null) state.presentation.viewport.reveal(state.presentation.viewport.selection);
	updateBehaviorLensStatus(state);
}

export function updateBehaviorLensStatus(state: BehaviorLensViewState): void {
	state.status.info = state.presentation.kind === 'graph'
		? `${state.presentation.viewport.model.nodes.length} CARDS`
		: `${state.document.definitions.length} DEF  ${state.sourceNodes.length} SOURCE NODES`;
	const range = selectedBehaviorLensSourceRange(state);
	if (range === null) { state.status.detail = ''; return; }
	const node = state.nodesByRowKey.get(state.selectedRowKey!)!;
	const kind = state.presentation.kind === 'graph' ? state.presentation.selectionKind : node.kind;
	state.status.detail = `${kind.toUpperCase()}  LN ${range.start.line}:${range.start.column}`;
}
