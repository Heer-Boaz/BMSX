import type { CodeEditorControl } from '../code_editor_control';
import * as constants from '../../../common/constants';
import { ensureVisualLines } from '../../common/text/layout';
import { getCodeAreaBounds } from '../view/view';
import type { CodeAreaBounds } from '../view/view';

export type CodeAreaViewportMetrics = {
	rows: number;
	contentWidth: number;
	visualCount: number;
	contentRight: number;
	contentBottom: number;
	trackRight: number;
	wrapEnabled: boolean;
	maxScrollLeft: number;
};

export type CodeAreaViewport = CodeAreaBounds & CodeAreaViewportMetrics;

function cellCapacity(size: number, cellSize: number): number {
	const capacity = (size / cellSize) | 0;
	return capacity > 0 ? capacity : 1;
}

export function resolveCodeAreaViewportMetrics(code: CodeEditorControl,
	bounds: CodeAreaBounds,
	visualCount: number,
	maximumWidth: number,
): CodeAreaViewportMetrics {
	const wrapEnabled = code.view.wordWrapEnabled;
	const scrollbarWidth = constants.SCROLLBAR_WIDTH;
	let horizontalScrollbarWidth = !wrapEnabled && code.geometry.codeHorizontalScrollbarVisible ? scrollbarWidth : 0;
	let verticalScrollbarWidth = code.geometry.codeVerticalScrollbarVisible ? scrollbarWidth : 0;
	let rows = code.scratch.viewportMetrics.rows;
	let contentWidth = code.scratch.viewportMetrics.contentWidth;

	for (let i = 0; i < 3; i += 1) {
		rows = cellCapacity(bounds.codeBottom - bounds.codeTop - horizontalScrollbarWidth, code.lineHeight);
		verticalScrollbarWidth = visualCount > rows ? scrollbarWidth : 0;
		const scrollbarInset = wrapEnabled ? scrollbarWidth : verticalScrollbarWidth;
		contentWidth = Math.max(0, bounds.codeRight - bounds.textLeft - scrollbarInset - constants.CODE_AREA_RIGHT_MARGIN);
		horizontalScrollbarWidth = !wrapEnabled && maximumWidth > contentWidth ? scrollbarWidth : 0;
	}

	code.geometry.codeVerticalScrollbarVisible = verticalScrollbarWidth !== 0;
	code.geometry.codeHorizontalScrollbarVisible = horizontalScrollbarWidth !== 0;
	code.geometry.cachedVisibleRowCount = rows;
	code.geometry.cachedContentWidth = contentWidth;
	code.geometry.cachedMaxScrollLeft = wrapEnabled || maximumWidth <= contentWidth ? 0 : maximumWidth - contentWidth;

	const contentRight = bounds.textLeft + contentWidth;
	code.scratch.viewportMetrics.rows = rows;
	code.scratch.viewportMetrics.contentWidth = contentWidth;
	code.scratch.viewportMetrics.visualCount = visualCount;
	code.scratch.viewportMetrics.contentRight = contentRight;
	code.scratch.viewportMetrics.contentBottom = bounds.codeBottom - horizontalScrollbarWidth;
	code.scratch.viewportMetrics.trackRight = bounds.codeRight - verticalScrollbarWidth;
	code.scratch.viewportMetrics.wrapEnabled = wrapEnabled;
	code.scratch.viewportMetrics.maxScrollLeft = code.geometry.cachedMaxScrollLeft;
	return code.scratch.viewportMetrics;
}

export function resolveCodeAreaViewport(code: CodeEditorControl): CodeAreaViewport {
	ensureVisualLines(code);
	const bounds = getCodeAreaBounds(code);
	const metrics = resolveCodeAreaViewportMetrics(code,
		bounds,
		code.layout.getVisualLineCount(),
		code.view.wordWrapEnabled ? 0 : code.layout.maxViewWidth(),
	);

	code.scratch.viewport.codeTop = bounds.codeTop;
	code.scratch.viewport.codeBottom = bounds.codeBottom;
	code.scratch.viewport.codeLeft = bounds.codeLeft;
	code.scratch.viewport.codeRight = bounds.codeRight;
	code.scratch.viewport.gutterLeft = bounds.gutterLeft;
	code.scratch.viewport.gutterRight = bounds.gutterRight;
	code.scratch.viewport.textLeft = bounds.textLeft;
	code.scratch.viewport.rows = metrics.rows;
	code.scratch.viewport.contentWidth = metrics.contentWidth;
	code.scratch.viewport.visualCount = metrics.visualCount;
	code.scratch.viewport.contentRight = metrics.contentRight;
	code.scratch.viewport.contentBottom = metrics.contentBottom;
	code.scratch.viewport.trackRight = metrics.trackRight;
	code.scratch.viewport.wrapEnabled = metrics.wrapEnabled;
	code.scratch.viewport.maxScrollLeft = metrics.maxScrollLeft;
	return code.scratch.viewport;
}
