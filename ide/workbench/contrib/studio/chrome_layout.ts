import {
	create_rect_bounds,
	type RectBounds,
	write_rect_bounds,
} from '../../../../machine/ts/common/rect';

export const STUDIO_CHROME_TOP_HEIGHT = 16;
export const STUDIO_CHROME_PANEL_HEADER_HEIGHT = 12;
export const STUDIO_CHROME_TREE_ROW_HEIGHT = 10;
export const STUDIO_CHROME_LEFT_WIDTH = 96;
export const STUDIO_CHROME_RIGHT_WIDTH = 108;
export const STUDIO_CHROME_DETAILS_ROW_HEIGHT = 14;

export type StudioChromeLayout = {
	viewportWidth: number;
	viewportHeight: number;
	visibleTreeRows: number;
	topBar: RectBounds;
	leftPanel: RectBounds;
	rightPanel: RectBounds;
	outlinerList: RectBounds;
	playButton: RectBounds;
	editButton: RectBounds;
	positionMinus: readonly [RectBounds, RectBounds, RectBounds];
	positionPlus: readonly [RectBounds, RectBounds, RectBounds];
	visibleToggle: RectBounds;
	componentEnabledToggle: RectBounds;
};

export function createStudioChromeLayout(): StudioChromeLayout {
	return {
		viewportWidth: 0,
		viewportHeight: 0,
		visibleTreeRows: 0,
		topBar: create_rect_bounds(),
		leftPanel: create_rect_bounds(),
		rightPanel: create_rect_bounds(),
		outlinerList: create_rect_bounds(),
		playButton: create_rect_bounds(),
		editButton: create_rect_bounds(),
		positionMinus: [
			create_rect_bounds(),
			create_rect_bounds(),
			create_rect_bounds(),
		],
		positionPlus: [
			create_rect_bounds(),
			create_rect_bounds(),
			create_rect_bounds(),
		],
		visibleToggle: create_rect_bounds(),
		componentEnabledToggle: create_rect_bounds(),
	};
}

export function writeStudioChromeLayout(
	layout: StudioChromeLayout,
	viewportWidth: number,
	viewportHeight: number,
): void {
	layout.viewportWidth = viewportWidth;
	layout.viewportHeight = viewportHeight;
	write_rect_bounds(layout.topBar, 0, 0, viewportWidth, STUDIO_CHROME_TOP_HEIGHT);
	write_rect_bounds(
		layout.leftPanel,
		0,
		STUDIO_CHROME_TOP_HEIGHT,
		STUDIO_CHROME_LEFT_WIDTH,
		viewportHeight,
	);
	const rightPanelLeft = viewportWidth - STUDIO_CHROME_RIGHT_WIDTH;
	write_rect_bounds(
		layout.rightPanel,
		rightPanelLeft,
		STUDIO_CHROME_TOP_HEIGHT,
		viewportWidth,
		viewportHeight,
	);
	const outlinerTop = STUDIO_CHROME_TOP_HEIGHT + STUDIO_CHROME_PANEL_HEADER_HEIGHT;
	write_rect_bounds(
		layout.outlinerList,
		0,
		outlinerTop,
		STUDIO_CHROME_LEFT_WIDTH,
		viewportHeight,
	);
	write_rect_bounds(layout.playButton, 58, 2, 92, 14);
	write_rect_bounds(layout.editButton, 94, 2, 128, 14);

	const actionRight = viewportWidth - 4;
	const plusLeft = actionRight - 14;
	const minusRight = plusLeft - 2;
	const minusLeft = minusRight - 14;
	const positionTop = STUDIO_CHROME_TOP_HEIGHT + STUDIO_CHROME_PANEL_HEADER_HEIGHT + 42;
	for (let axis = 0; axis < 3; axis += 1) {
		const top = positionTop + axis * STUDIO_CHROME_DETAILS_ROW_HEIGHT;
		write_rect_bounds(layout.positionMinus[axis], minusLeft, top, minusRight, top + 11);
		write_rect_bounds(layout.positionPlus[axis], plusLeft, top, actionRight, top + 11);
	}
	const toggleTop = positionTop + STUDIO_CHROME_DETAILS_ROW_HEIGHT * 3 + 2;
	write_rect_bounds(
		layout.visibleToggle,
		rightPanelLeft + 4,
		toggleTop,
		actionRight,
		toggleTop + 12,
	);
	write_rect_bounds(
		layout.componentEnabledToggle,
		rightPanelLeft + 4,
		positionTop,
		actionRight,
		positionTop + 12,
	);

	let visibleTreeRows = 0;
	let rowTop = outlinerTop;
	while (rowTop + STUDIO_CHROME_TREE_ROW_HEIGHT <= viewportHeight) {
		visibleTreeRows += 1;
		rowTop += STUDIO_CHROME_TREE_ROW_HEIGHT;
	}
	layout.visibleTreeRows = visibleTreeRows;
}
