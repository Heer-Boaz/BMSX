import { clamp } from '../../../../machine/ts/common/clamp';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import {
	findVisibleRowIndex,
	rebuildBehaviorLensRows,
} from './layout';
import { revealWorkbenchListSelection } from '../../ui/list_view';
import type { BehaviorLensViewState } from './view_model';

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
}

export function executeBehaviorLensNavigation(
	state: BehaviorLensViewState,
	command: BehaviorLensNavigationCommand,
): BehaviorLensNavigationResult {
	if (command === 'back') {
		return BehaviorLensNavigationResult.Back;
	}
	if (command === 'activate') {
		return state.selectionIndex >= 0
			? BehaviorLensNavigationResult.Activate
			: BehaviorLensNavigationResult.None;
	}
	if (state.rows.length === 0) {
		return BehaviorLensNavigationResult.None;
	}
	const selectionIndex = state.selectionIndex;
	switch (command) {
		case 'up': return selectRow(state, selectionIndex - 1);
		case 'down': return selectRow(state, selectionIndex + 1);
		case 'page-up': return selectRow(state, selectionIndex < 0 ? state.scroll : selectionIndex - state.layout.visibleRowCount);
		case 'page-down': return selectRow(state, selectionIndex < 0
			? state.scroll + state.layout.visibleRowCount - 1 : selectionIndex + state.layout.visibleRowCount);
		case 'home': return selectRow(state, 0);
		case 'end': return selectRow(state, state.rows.length - 1);
		case 'left': return selectionIndex < 0 ? BehaviorLensNavigationResult.None : collapseOrSelectParent(state, selectionIndex);
		case 'right': return selectionIndex < 0 ? BehaviorLensNavigationResult.None : expandOrSelectChild(state, selectionIndex);
	}
}

function selectRow(
	state: BehaviorLensViewState,
	index: number,
): BehaviorLensNavigationResult {
	const nextIndex = clamp(index, 0, state.rows.length - 1);
	if (nextIndex === state.selectionIndex) {
		return BehaviorLensNavigationResult.None;
	}
	state.selectionIndex = nextIndex;
	state.hoverIndex = -1;
	return BehaviorLensNavigationResult.Changed;
}

function collapseOrSelectParent(
	state: BehaviorLensViewState,
	selectionIndex: number,
): BehaviorLensNavigationResult {
	const row = state.rows[selectionIndex];
	if (row.expandable && row.expanded) {
		state.collapsedRowKeys.add(row.node.rowKey);
		state.rowsDirty = true;
		rebuildBehaviorLensRows(state);
		state.rowsDirty = false;
		state.textDirty = true;
		return BehaviorLensNavigationResult.Changed;
	}
	if (row.parentRowKey === null) {
		return BehaviorLensNavigationResult.None;
	}
	return selectRow(state, findVisibleRowIndex(state, row.parentRowKey));
}

function expandOrSelectChild(
	state: BehaviorLensViewState,
	selectionIndex: number,
): BehaviorLensNavigationResult {
	const row = state.rows[selectionIndex];
	if (!row.expandable) {
		return BehaviorLensNavigationResult.None;
	}
	if (!row.expanded) {
		state.collapsedRowKeys.delete(row.node.rowKey);
		state.rowsDirty = true;
		rebuildBehaviorLensRows(state);
		state.rowsDirty = false;
		state.textDirty = true;
		return BehaviorLensNavigationResult.Changed;
	}
	return selectRow(state, selectionIndex + 1);
}

export function selectBehaviorLensRow(state: BehaviorLensViewState, rowIndex: number): void {
	state.selectionIndex = rowIndex;
	state.hoverIndex = -1;
	updateBehaviorLensStatus(state);
}

export function toggleBehaviorLensRow(state: BehaviorLensViewState, rowIndex: number): void {
	const row = state.rows[rowIndex];
	if (row.expanded) {
		state.collapsedRowKeys.add(row.node.rowKey);
	} else {
		state.collapsedRowKeys.delete(row.node.rowKey);
	}
	state.selectionIndex = rowIndex;
	state.rowsDirty = true;
	rebuildBehaviorLensRows(state);
	state.rowsDirty = false;
	state.textDirty = true;
	updateBehaviorLensStatus(state);
}

export function selectedBehaviorLensSourceRange(state: BehaviorLensViewState): LuaSourceRange | null {
	if (state.selectionIndex < 0) {
		return null;
	}
	const node = state.rows[state.selectionIndex].node;
	return node.referenceRange !== null ? node.referenceRange : node.authoredRange;
}

export function finishBehaviorLensNavigation(state: BehaviorLensViewState): void {
	revealWorkbenchListSelection(state);
	updateBehaviorLensStatus(state);
}

export function updateBehaviorLensStatus(state: BehaviorLensViewState): void {
	state.status.info = `${state.document.definitions.length} DEF  ${state.sourceNodes.length} SOURCE NODES`;
	if (state.selectionIndex < 0) {
		state.status.detail = '';
		return;
	}
	const node = state.rows[state.selectionIndex].node;
	const range = node.referenceRange !== null ? node.referenceRange : node.authoredRange;
	state.status.detail = `${node.kind.toUpperCase()}  LN ${range.start.line}:${range.start.column}`;
}
