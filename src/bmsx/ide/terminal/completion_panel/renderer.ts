import type { OverlayRenderer } from '../../runtime/overlay_renderer';
import type { TerminalPanelGridLayout } from './model';
import type { color } from '../../../render/shared/submissions';

export type TerminalGridPanelRenderParams = {
	renderer: OverlayRenderer;
	contentWidth: number;
	lineHeight: number;
	charWidth: number;
	panelTop: number;
	layout: TerminalPanelGridLayout;
	entriesCount: number;
	getLabel: (index: number) => string;
	filter: string;
	selectionIndex: number;
	displayRowOffset: number;
	emptyMessageNoFilter: string;
	emptyMessageWithFilter: string;
	paddingX: number;
	backgroundColor: color;
	borderColor: color;
	highlightColor: color;
	textColor: color;
	highlightTextColor: color;
	drawText: (text: string, x: number, y: number, color: color) => void;
};

export function drawTerminalGridPanel(params: TerminalGridPanelRenderParams): void {
	const panelRows = params.layout.visibleRows + params.layout.paddingY * 2;
	const panelLeft = params.paddingX;
	const panelRight = panelLeft + params.contentWidth;
	const panelBottom = params.panelTop + panelRows * params.lineHeight;
	params.renderer.rect({
		kind: 'fill',
		area: { left: panelLeft, top: params.panelTop, right: panelRight, bottom: panelBottom },
		color: params.backgroundColor,
	});
	params.renderer.rect({
		kind: 'rect',
		area: { left: panelLeft, top: params.panelTop, right: panelRight, bottom: panelBottom },
		color: params.borderColor,
	});

	const gridStartX = panelLeft + params.layout.paddingX * params.charWidth;
	const gridStartY = params.panelTop + params.layout.paddingY * params.lineHeight;
	const cellWidthPx = params.layout.cellWidth * params.charWidth;
	const gapWidthPx = params.layout.gap * params.charWidth;
	const strideX = cellWidthPx + gapWidthPx;

	if (params.entriesCount === 0) {
		const message = params.filter.length > 0 ? params.emptyMessageWithFilter : params.emptyMessageNoFilter;
		params.drawText(message, gridStartX, gridStartY, params.textColor);
		return;
	}

	const startRow = params.displayRowOffset;
	const endRow = Math.min(params.layout.rows, startRow + params.layout.visibleRows);
	for (let row = startRow; row < endRow; row += 1) {
		const drawRow = row - startRow;
		const cellY = gridStartY + drawRow * params.lineHeight;
		for (let col = 0; col < params.layout.columns; col += 1) {
			const index = row + col * params.layout.rows;
			if (index >= params.entriesCount) continue;
			const label = params.getLabel(index);
			const cellX = gridStartX + col * strideX;
			const isSelected = index === params.selectionIndex;
			if (isSelected) {
				params.renderer.rect({
					kind: 'fill',
					area: {
						left: cellX - 1,
						top: cellY - 1,
						right: cellX + cellWidthPx + 1,
						bottom: cellY + params.lineHeight + 1,
					},
					color: params.highlightColor,
				});
			}
			const color = isSelected ? params.highlightTextColor : params.textColor;
			params.drawText(label, cellX, cellY, color);
		}
	}
}
