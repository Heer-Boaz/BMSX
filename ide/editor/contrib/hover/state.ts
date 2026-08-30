import type { RectBounds } from '../../../../machine/ts/common/rect';

export type CodeHoverTooltip = {
	readonly contentLines: readonly string[];
	readonly path: string;
	readonly row: number;
	readonly startColumn: number;
	readonly endColumn: number;
	scrollOffset: number;
	visibleLineCount: number;
	bubbleBounds: RectBounds;
};

export const hoverState: { tooltip: CodeHoverTooltip | null } = {
	tooltip: null,
};
