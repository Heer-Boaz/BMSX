import type { RectBounds } from '../../../../machine/ts/common/rect';

export type CodeHoverTooltip = {
	readonly contentLines: readonly string[];
	readonly lineWidths: readonly number[];
	readonly path: string;
	readonly row: number;
	readonly startColumn: number;
	readonly endColumn: number;
	scrollOffset: number;
	visibleLineCount: number;
	readonly bubbleBounds: RectBounds;
};
