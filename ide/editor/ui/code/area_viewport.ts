import * as constants from '../../../common/constants';
import { ensureVisualLines } from '../../common/text/layout';
import { getCodeAreaBounds } from '../view/view';
import { activeCodeEditor } from '../code_editor_state';
import { editorViewState } from '../view/state';
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

const codeAreaViewportMetrics: CodeAreaViewportMetrics = {
	rows: 1,
	contentWidth: 1,
	visualCount: 0,
	contentRight: 0,
	contentBottom: 0,
	trackRight: 0,
	wrapEnabled: false,
	maxScrollLeft: 0,
};

const codeAreaViewport: CodeAreaViewport = {
	codeTop: 0,
	codeBottom: 0,
	codeLeft: 0,
	codeRight: 0,
	gutterLeft: 0,
	gutterRight: 0,
	textLeft: 0,
	rows: 1,
	contentWidth: 1,
	visualCount: 0,
	contentRight: 0,
	contentBottom: 0,
	trackRight: 0,
	wrapEnabled: false,
	maxScrollLeft: 0,
};

function cellCapacity(size: number, cellSize: number): number {
	const capacity = (size / cellSize) | 0;
	return capacity > 0 ? capacity : 1;
}

export function resolveCodeAreaViewportMetrics(
	bounds: CodeAreaBounds,
	visualCount: number,
	maximumWidth: number,
): CodeAreaViewportMetrics {
	const wrapEnabled = editorViewState.wordWrapEnabled;
	const scrollbarWidth = constants.SCROLLBAR_WIDTH;
	let horizontalScrollbarWidth = !wrapEnabled && editorViewState.codeHorizontalScrollbarVisible ? scrollbarWidth : 0;
	let verticalScrollbarWidth = editorViewState.codeVerticalScrollbarVisible ? scrollbarWidth : 0;
	let rows = codeAreaViewportMetrics.rows;
	let contentWidth = codeAreaViewportMetrics.contentWidth;

	for (let i = 0; i < 3; i += 1) {
		rows = cellCapacity(bounds.codeBottom - bounds.codeTop - horizontalScrollbarWidth, editorViewState.lineHeight);
		verticalScrollbarWidth = visualCount > rows ? scrollbarWidth : 0;
		const scrollbarInset = wrapEnabled ? scrollbarWidth : verticalScrollbarWidth;
		contentWidth = Math.max(0, bounds.codeRight - bounds.textLeft - scrollbarInset - constants.CODE_AREA_RIGHT_MARGIN);
		horizontalScrollbarWidth = !wrapEnabled && maximumWidth > contentWidth ? scrollbarWidth : 0;
	}

	editorViewState.codeVerticalScrollbarVisible = verticalScrollbarWidth !== 0;
	editorViewState.codeHorizontalScrollbarVisible = horizontalScrollbarWidth !== 0;
	editorViewState.cachedVisibleRowCount = rows;
	editorViewState.cachedContentWidth = contentWidth;
	editorViewState.cachedMaxScrollLeft = wrapEnabled || maximumWidth <= contentWidth ? 0 : maximumWidth - contentWidth;

	const contentRight = bounds.textLeft + contentWidth;
	codeAreaViewportMetrics.rows = rows;
	codeAreaViewportMetrics.contentWidth = contentWidth;
	codeAreaViewportMetrics.visualCount = visualCount;
	codeAreaViewportMetrics.contentRight = contentRight;
	codeAreaViewportMetrics.contentBottom = bounds.codeBottom - horizontalScrollbarWidth;
	codeAreaViewportMetrics.trackRight = bounds.codeRight - verticalScrollbarWidth;
	codeAreaViewportMetrics.wrapEnabled = wrapEnabled;
	codeAreaViewportMetrics.maxScrollLeft = editorViewState.cachedMaxScrollLeft;
	return codeAreaViewportMetrics;
}

export function resolveCodeAreaViewport(): CodeAreaViewport {
	ensureVisualLines();
	const bounds = getCodeAreaBounds();
	const metrics = resolveCodeAreaViewportMetrics(
		bounds,
		editorViewState.layout.getVisualLineCount(),
		editorViewState.wordWrapEnabled ? 0 : editorViewState.layout.maxViewWidth(activeCodeEditor.model.buffer),
	);

	codeAreaViewport.codeTop = bounds.codeTop;
	codeAreaViewport.codeBottom = bounds.codeBottom;
	codeAreaViewport.codeLeft = bounds.codeLeft;
	codeAreaViewport.codeRight = bounds.codeRight;
	codeAreaViewport.gutterLeft = bounds.gutterLeft;
	codeAreaViewport.gutterRight = bounds.gutterRight;
	codeAreaViewport.textLeft = bounds.textLeft;
	codeAreaViewport.rows = metrics.rows;
	codeAreaViewport.contentWidth = metrics.contentWidth;
	codeAreaViewport.visualCount = metrics.visualCount;
	codeAreaViewport.contentRight = metrics.contentRight;
	codeAreaViewport.contentBottom = metrics.contentBottom;
	codeAreaViewport.trackRight = metrics.trackRight;
	codeAreaViewport.wrapEnabled = metrics.wrapEnabled;
	codeAreaViewport.maxScrollLeft = metrics.maxScrollLeft;
	return codeAreaViewport;
}
