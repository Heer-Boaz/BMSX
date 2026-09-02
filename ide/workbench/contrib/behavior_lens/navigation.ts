import { clamp } from '../../../../machine/ts/common/clamp';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import { compareSourcePosition, sourcePositionInRange } from '../../../../toolchain/ts/lua/semantic/source_range';
import {
	findVisibleRowIndex,
	rebuildBehaviorLensRows,
} from './layout';
import { revealWorkbenchListSelection } from '../../ui/list_view';
import type { BehaviorSourceNode, BehaviorSourceRowKey } from './model';
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
	const selectionIndex = state.selectionIndex >= 0 ? state.selectionIndex : 0;
	switch (command) {
		case 'up': return selectRow(state, selectionIndex - 1);
		case 'down': return selectRow(state, selectionIndex + 1);
		case 'page-up': return selectRow(state, selectionIndex - state.layout.visibleRowCount);
		case 'page-down': return selectRow(state, selectionIndex + state.layout.visibleRowCount);
		case 'home': return selectRow(state, 0);
		case 'end': return selectRow(state, state.rows.length - 1);
		case 'left': return collapseOrSelectParent(state, selectionIndex);
		case 'right': return expandOrSelectChild(state, selectionIndex);
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

/**
 * Matches a source position to every view occurrence of the narrowest authored
 * initializer range. A direct reference at the position takes precedence.
 */
export function setBehaviorLensSourcePosition(
	state: BehaviorLensViewState,
	path: string,
	line: number,
	column: number,
): number {
	state.sourceLine = line;
	state.sourceColumn = column;
	state.sourceMatchRowKeys.clear();
	const reference = narrowestRangeAtPosition(state.sourceNodes, path, line, column, true);
	const authored = reference === null
		? narrowestRangeAtPosition(state.sourceNodes, path, line, column, false)
		: null;
	const target = reference === null ? authored : reference;
	if (target === null) {
		return 0;
	}
	const matchReference = reference !== null;
	for (let index = 0; index < state.sourceNodes.length; index += 1) {
		const node = state.sourceNodes[index];
		const candidate = matchReference ? node.referenceRange : node.authoredRange;
		if (candidate !== null && sourceRangesEqual(candidate, target)) {
			state.sourceMatchRowKeys.add(node.rowKey);
			expandAncestors(state, node.rowKey);
		}
	}
	if (state.rowsDirty) {
		rebuildBehaviorLensRows(state);
		state.rowsDirty = false;
		state.textDirty = true;
	}
	for (let index = 0; index < state.rows.length; index += 1) {
		if (state.sourceMatchRowKeys.has(state.rows[index].node.rowKey)) {
			state.selectionIndex = index;
			break;
		}
	}
	return state.sourceMatchRowKeys.size;
}

function narrowestRangeAtPosition(
	nodes: readonly BehaviorSourceNode[],
	path: string,
	line: number,
	column: number,
	reference: boolean,
): LuaSourceRange | null {
	let best: LuaSourceRange | null = null;
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		const candidate = reference ? node.referenceRange : node.authoredRange;
		if (candidate === null || candidate.path !== path || !sourcePositionInRange(line, column, candidate)) {
			continue;
		}
		if (best === null || sourceRangeIsInside(candidate, best)) {
			best = candidate;
		}
	}
	return best;
}

function sourceRangeIsInside(candidate: LuaSourceRange, outer: LuaSourceRange): boolean {
	return compareSourcePosition(
		candidate.start.line,
		candidate.start.column,
		outer.start.line,
		outer.start.column,
	) >= 0 && compareSourcePosition(
		candidate.end.line,
		candidate.end.column,
		outer.end.line,
		outer.end.column,
	) <= 0;
}

function sourceRangesEqual(left: LuaSourceRange, right: LuaSourceRange): boolean {
	return left.path === right.path
		&& left.start.line === right.start.line
		&& left.start.column === right.start.column
		&& left.end.line === right.end.line
		&& left.end.column === right.end.column;
}

function expandAncestors(state: BehaviorLensViewState, rowKey: BehaviorSourceRowKey): void {
	let parentRowKey = state.parentRowKeyByRowKey.get(rowKey)!;
	while (parentRowKey !== null) {
		if (state.collapsedRowKeys.delete(parentRowKey)) {
			state.rowsDirty = true;
		}
		parentRowKey = state.parentRowKeyByRowKey.get(parentRowKey)!;
	}
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
