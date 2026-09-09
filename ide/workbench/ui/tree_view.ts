import { clamp } from '../../../machine/ts/common/clamp';
import { clampWorkbenchListScroll, revealWorkbenchListSelection, type WorkbenchListLayout, type WorkbenchListState } from './list_view';

/** Retained topology; visible list rows refer to these same nodes. */
export type WorkbenchTreeNode<Element> = {
	readonly element: Element;
	readonly parent: WorkbenchTreeNode<Element> | null;
	readonly children: WorkbenchTreeNode<Element>[];
	readonly depth: number;
	collapsed: boolean;
};

export type WorkbenchTreeLayout = WorkbenchListLayout & { indentWidth: number; twistieWidth: number };
export type WorkbenchTreeState<Element> = WorkbenchListState<WorkbenchTreeNode<Element>, WorkbenchTreeLayout> & {
	readonly roots: WorkbenchTreeNode<Element>[];
};

/** The topology owner computes depth and attaches a node to its actual parent. */
export function appendWorkbenchTreeNode<Element>(
	state: WorkbenchTreeState<Element>, parent: WorkbenchTreeNode<Element> | null, element: Element, collapsed = false,
): WorkbenchTreeNode<Element> {
	const node: WorkbenchTreeNode<Element> = { element, parent, children: [], depth: parent === null ? 0 : parent.depth + 1, collapsed };
	if (parent === null) state.roots.push(node);
	else parent.children.push(node);
	return node;
}

/** Called on topology/collapse changes, never during layout or rendering. */
export function rebuildWorkbenchTreeRows<Element>(state: WorkbenchTreeState<Element>, selected: WorkbenchTreeNode<Element> | null): void {
	state.rows.length = 0;
	appendVisibleNodes(state.roots, state.rows);
	state.selectionIndex = selected === null ? -1 : state.rows.indexOf(selected);
	state.hoverIndex = -1;
	clampWorkbenchListScroll(state);
}

function appendVisibleNodes<Element>(nodes: readonly WorkbenchTreeNode<Element>[], rows: WorkbenchTreeNode<Element>[]): void {
	for (const node of nodes) {
		rows.push(node);
		if (!node.collapsed) appendVisibleNodes(node.children, rows);
	}
}

export function setWorkbenchTreeCollapsed<Element>(state: WorkbenchTreeState<Element>, index: number, collapsed: boolean): boolean {
	const node = state.rows[index];
	if (node.children.length === 0 || node.collapsed === collapsed) return false;
	let selected = state.selectionIndex < 0 ? null : state.rows[state.selectionIndex];
	if (collapsed) {
		// A hidden descendant cannot remain the active edit target.
		for (let ancestor = selected; ancestor !== null; ancestor = ancestor.parent) {
			if (ancestor === node) {
				selected = node;
				break;
			}
		}
	}
	node.collapsed = collapsed;
	rebuildWorkbenchTreeRows(state, selected);
	return true;
}

export type WorkbenchTreeNavigation = 'up' | 'down' | 'page-up' | 'page-down' | 'home' | 'end' | 'left' | 'right';

export const enum WorkbenchTreeNavigationResult { None, Selection, Collapse }

/** VS Code tree navigation: Left collapses/ascends, Right expands/descends. */
export function navigateWorkbenchTree<Element>(state: WorkbenchTreeState<Element>, command: WorkbenchTreeNavigation): WorkbenchTreeNavigationResult {
	if (state.rows.length === 0) return WorkbenchTreeNavigationResult.None;
	let next = state.selectionIndex;
	if (next < 0) next = command === 'end' ? state.rows.length - 1 : 0;
	else {
		switch (command) {
			case 'up': next -= 1; break;
			case 'down': next += 1; break;
			case 'page-up': next -= state.layout.visibleRowCount; break;
			case 'page-down': next += state.layout.visibleRowCount; break;
			case 'home': next = 0; break;
			case 'end': next = state.rows.length - 1; break;
			case 'left':
				if (setWorkbenchTreeCollapsed(state, next, true)) {
					revealWorkbenchListSelection(state);
					return WorkbenchTreeNavigationResult.Collapse;
				}
				if (state.rows[next].parent !== null) next = state.rows.indexOf(state.rows[next].parent!);
				break;
			case 'right':
				if (setWorkbenchTreeCollapsed(state, next, false)) {
					revealWorkbenchListSelection(state);
					return WorkbenchTreeNavigationResult.Collapse;
				}
				if (state.rows[next].children.length > 0) next += 1;
				break;
		}
	}
	next = clamp(next, 0, state.rows.length - 1);
	if (next === state.selectionIndex) return WorkbenchTreeNavigationResult.None;
	state.selectionIndex = next;
	state.hoverIndex = -1;
	revealWorkbenchListSelection(state);
	return WorkbenchTreeNavigationResult.Selection;
}

/** The caller supplies the row found by the shared list hit test. */
export function workbenchTreeTwistieContainsPosition<Element>(state: WorkbenchTreeState<Element>, index: number, viewportX: number): boolean {
	const node = state.rows[index];
	const left = state.layout.contentLeft + node.depth * state.layout.indentWidth;
	return node.children.length > 0 && viewportX >= left && viewportX < left + state.layout.twistieWidth;
}
