import * as constants from '../../common/constants';
import { editorFeedbackState } from '../../workbench/common/feedback_state';
import { ensureVisualLines } from '../common/text_layout';
import { getCodeAreaBounds, maximumLineLength } from './view/view';
import { editorViewState } from './view/state';
import type { CodeAreaBounds } from './view/view';

export type CodeAreaViewportMetrics = {
	rows: number;
	columns: number;
	visualCount: number;
	contentRight: number;
	contentBottom: number;
	trackRight: number;
	wrapEnabled: boolean;
	sliceWidth: number;
	maxScrollColumn: number;
};

export type CodeAreaViewport = CodeAreaBounds & CodeAreaViewportMetrics;

const codeAreaViewportMetrics: CodeAreaViewportMetrics = {
	rows: 1,
	columns: 1,
	visualCount: 0,
	contentRight: 0,
	contentBottom: 0,
	trackRight: 0,
	wrapEnabled: false,
	sliceWidth: 3,
	maxScrollColumn: 0,
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
	columns: 1,
	visualCount: 0,
	contentRight: 0,
	contentBottom: 0,
	trackRight: 0,
	wrapEnabled: false,
	sliceWidth: 3,
	maxScrollColumn: 0,
};

function cellCapacity(size: number, cellSize: number): number {
	const capacity = (size / cellSize) | 0;
	return capacity > 0 ? capacity : 1;
}

export function resolveCodeAreaViewportMetrics(
	bounds: CodeAreaBounds,
	visualCount: number,
	maximumColumns: number,
): CodeAreaViewportMetrics {
	const wrapEnabled = editorViewState.wordWrapEnabled;
	const advance = editorFeedbackState.warnNonMonospace ? editorViewState.spaceAdvance : editorViewState.charAdvance;
	let horizontalScrollbarWidth = !wrapEnabled && editorViewState.codeHorizontalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0;
	let verticalScrollbarWidth = editorViewState.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0;
	let rows = codeAreaViewportMetrics.rows;
	let columns = codeAreaViewportMetrics.columns;

	for (let i = 0; i < 3; i += 1) {
		rows = cellCapacity(bounds.codeBottom - bounds.codeTop - horizontalScrollbarWidth, editorViewState.lineHeight);
		verticalScrollbarWidth = visualCount > rows ? constants.SCROLLBAR_WIDTH : 0;
		columns = cellCapacity(bounds.codeRight - bounds.textLeft - verticalScrollbarWidth - constants.CODE_AREA_RIGHT_MARGIN, advance);
		horizontalScrollbarWidth = !wrapEnabled && maximumColumns > columns ? constants.SCROLLBAR_WIDTH : 0;
	}

	editorViewState.codeVerticalScrollbarVisible = verticalScrollbarWidth !== 0;
	editorViewState.codeHorizontalScrollbarVisible = horizontalScrollbarWidth !== 0;
	editorViewState.cachedVisibleRowCount = rows;
	editorViewState.cachedVisibleColumnCount = columns;
	editorViewState.cachedMaxScrollColumn = wrapEnabled || maximumColumns <= columns ? 0 : maximumColumns - columns;

	const contentRight = bounds.codeRight - verticalScrollbarWidth - constants.CODE_AREA_RIGHT_MARGIN;
	codeAreaViewportMetrics.rows = rows;
	codeAreaViewportMetrics.columns = columns;
	codeAreaViewportMetrics.visualCount = visualCount;
	codeAreaViewportMetrics.contentRight = contentRight > bounds.textLeft ? contentRight : bounds.textLeft;
	codeAreaViewportMetrics.contentBottom = bounds.codeBottom - horizontalScrollbarWidth;
	codeAreaViewportMetrics.trackRight = bounds.codeRight - verticalScrollbarWidth;
	codeAreaViewportMetrics.wrapEnabled = wrapEnabled;
	codeAreaViewportMetrics.sliceWidth = columns + 2;
	codeAreaViewportMetrics.maxScrollColumn = editorViewState.cachedMaxScrollColumn;
	return codeAreaViewportMetrics;
}

export function resolveCodeAreaViewport(): CodeAreaViewport {
	ensureVisualLines();
	const bounds = getCodeAreaBounds();
	const metrics = resolveCodeAreaViewportMetrics(
		bounds,
		editorViewState.layout.getVisualLineCount(),
		editorViewState.wordWrapEnabled ? 0 : maximumLineLength(),
	);

	codeAreaViewport.codeTop = bounds.codeTop;
	codeAreaViewport.codeBottom = bounds.codeBottom;
	codeAreaViewport.codeLeft = bounds.codeLeft;
	codeAreaViewport.codeRight = bounds.codeRight;
	codeAreaViewport.gutterLeft = bounds.gutterLeft;
	codeAreaViewport.gutterRight = bounds.gutterRight;
	codeAreaViewport.textLeft = bounds.textLeft;
	codeAreaViewport.rows = metrics.rows;
	codeAreaViewport.columns = metrics.columns;
	codeAreaViewport.visualCount = metrics.visualCount;
	codeAreaViewport.contentRight = metrics.contentRight;
	codeAreaViewport.contentBottom = metrics.contentBottom;
	codeAreaViewport.trackRight = metrics.trackRight;
	codeAreaViewport.wrapEnabled = metrics.wrapEnabled;
	codeAreaViewport.sliceWidth = metrics.sliceWidth;
	codeAreaViewport.maxScrollColumn = metrics.maxScrollColumn;
	return codeAreaViewport;
}
