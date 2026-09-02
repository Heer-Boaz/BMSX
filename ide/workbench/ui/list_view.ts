import { clamp } from '../../../machine/ts/common/clamp';

/** Retained viewport geometry owned by one workbench list. */
export type WorkbenchListLayout = {
	contentLeft: number;
	contentTop: number;
	contentRight: number;
	contentBottom: number;
	rowHeight: number;
	visibleRowCount: number;
};

/**
 * Structural state contract for retained workbench lists. Feature views retain
 * their own row model while the list owner maintains navigation and viewport
 * invariants.
 */
export type WorkbenchListState<
	Row,
	Layout extends WorkbenchListLayout = WorkbenchListLayout,
> = {
	readonly rows: Row[];
	selectionIndex: number;
	scroll: number;
	hoverIndex: number;
	readonly layout: Layout;
};

export function layoutWorkbenchList(
	layout: WorkbenchListLayout,
	left: number,
	top: number,
	right: number,
	bottom: number,
	rowHeight: number,
): void {
	layout.contentLeft = left;
	layout.contentTop = top;
	layout.contentRight = right;
	layout.contentBottom = bottom;
	layout.rowHeight = rowHeight;
	layout.visibleRowCount = ((bottom - top) / rowHeight) | 0;
}

export function workbenchListRowIndexAtPosition<Row>(
	state: WorkbenchListState<Row>,
	viewportX: number,
	viewportY: number,
): number {
	if (!workbenchListContainsPosition(state, viewportX, viewportY)) {
		return -1;
	}
	const layout = state.layout;
	const visibleIndex = ((viewportY - layout.contentTop) / layout.rowHeight) | 0;
	const rowIndex = state.scroll + visibleIndex;
	return rowIndex < state.rows.length ? rowIndex : -1;
}

export function workbenchListContainsPosition<Row>(
	state: WorkbenchListState<Row>,
	viewportX: number,
	viewportY: number,
): boolean {
	const layout = state.layout;
	return viewportX >= layout.contentLeft
		&& viewportX < layout.contentRight
		&& viewportY >= layout.contentTop
		&& viewportY < layout.contentBottom;
}

export function clampWorkbenchListScroll<Row>(state: WorkbenchListState<Row>): void {
	const maxScroll = state.rows.length > state.layout.visibleRowCount
		? state.rows.length - state.layout.visibleRowCount
		: 0;
	state.scroll = clamp(state.scroll, 0, maxScroll);
}

export function scrollWorkbenchList<Row>(state: WorkbenchListState<Row>, delta: number): void {
	state.scroll += delta;
	clampWorkbenchListScroll(state);
	state.hoverIndex = -1;
}

export function revealWorkbenchListSelection<Row>(state: WorkbenchListState<Row>): void {
	if (state.selectionIndex < state.scroll) {
		state.scroll = state.selectionIndex;
	} else if (state.selectionIndex >= state.scroll + state.layout.visibleRowCount) {
		state.scroll = state.selectionIndex - state.layout.visibleRowCount + 1;
	}
	clampWorkbenchListScroll(state);
}
