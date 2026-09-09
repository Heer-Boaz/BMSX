import { executeBehaviorGraphNavigation } from './graph_navigation';
import { executeStateGraphNavigation } from './state_graph_navigation';
import { clamp } from '../../../../machine/ts/common/clamp';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import {
	findVisibleRowIndex,
	rebuildBehaviorLensRows,
} from './layout';
import { revealWorkbenchListSelection } from '../../ui/list_view';
import type { BehaviorLensOutline, BehaviorLensViewState } from './view_model';
import { stateMachineSourceRange } from './state_machine_selection';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, WorkbenchTreeNavigationResult } from '../../ui/tree_view';
import { acceptEffectPropertySelection } from './action_effect_properties';

export type BehaviorLensNavigationCommand =
	| 'next' | 'previous'
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
	if (outline.kind === 'state-graph') return executeStateGraphNavigation(state, outline, command);
	if (outline.kind === 'properties') {
		if (command === 'back') return BehaviorLensNavigationResult.Back;
		if (command === 'activate') {
			const selected = outline.tree.rows[outline.tree.selectionIndex];
			if (selected?.element.kind === 'group') {
				setWorkbenchTreeCollapsed(outline.tree, outline.tree.selectionIndex, !selected.collapsed);
				acceptEffectPropertySelection(state, outline, true);
				return BehaviorLensNavigationResult.Changed;
			}
			return state.selection === null ? BehaviorLensNavigationResult.None : BehaviorLensNavigationResult.Activate;
		}
		const result = navigateWorkbenchTree(outline.tree, command === 'next' ? 'down' : command === 'previous' ? 'up' : command);
		if (result === WorkbenchTreeNavigationResult.None) return BehaviorLensNavigationResult.None;
		acceptEffectPropertySelection(state, outline, result === WorkbenchTreeNavigationResult.Collapse);
		return BehaviorLensNavigationResult.Changed;
	}
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
	state.selection = { kind: 'node', rowKey: outline.rows[nextIndex].node.rowKey };
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
	state.selection = rowIndex < 0 ? null : { kind: 'node', rowKey: outline.rows[rowIndex].node.rowKey };
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
	state.selection = { kind: 'node', rowKey: outline.rows[rowIndex].node.rowKey };
	outline.selectionIndex = rowIndex;
	outline.rowsDirty = true;
	rebuildBehaviorLensRows(state, outline);
	outline.rowsDirty = false;
	outline.textDirty = true;
	updateBehaviorLensStatus(state);
}

export function selectedBehaviorLensSourceRange(state: BehaviorLensViewState): LuaSourceRange | null {
	const selection = state.selection;
	if (selection === null) return null;
	if (selection.kind === 'state-outcome' || selection.kind === 'state-entry') return stateMachineSourceRange(selection);
	const node = state.nodesByRowKey.get(selection.rowKey)!;
	if (selection.kind === 'tree-edge') return node.occurrenceRange;
	return node.referenceRange !== null ? node.referenceRange : node.authoredRange;
}

export function finishBehaviorLensNavigation(state: BehaviorLensViewState): void {
	if (state.presentation.kind === 'outline') revealWorkbenchListSelection(state.presentation);
	else if (state.presentation.kind === 'properties') revealWorkbenchListSelection(state.presentation.tree);
	else if (state.presentation.viewport.selection !== null) state.presentation.viewport.reveal(state.presentation.viewport.selection);
	updateBehaviorLensStatus(state);
}

export function updateBehaviorLensStatus(state: BehaviorLensViewState): void {
	state.status.info = state.presentation.kind === 'properties' ? state.presentation.summary : state.presentation.kind !== 'outline'
		? state.presentation.kind === 'state-graph' ? `${state.presentation.viewport.model.nodes.length} SCOPES / POSSIBLE PATHS`
			: `${state.presentation.viewport.model.nodes.length} CARDS`
		: `${state.document.definitions.length} DEF  ${state.sourceNodes.length} SOURCE NODES`;
	const range = selectedBehaviorLensSourceRange(state);
	if (range === null) { state.status.detail = ''; return; }
	const selection = state.selection!;
	const node = state.nodesByRowKey.get(selection.rowKey)!;
	const kind = selection.kind === 'state-outcome' ? selection.outcome.proof.kind
		: selection.kind === 'state-entry' ? selection.entry.kind : selection.kind === 'tree-edge' ? 'edge' : node.kind;
	state.status.detail = `${kind.toUpperCase()}  LN ${range.start.line}:${range.start.column}`;
}
