import { write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { uppercaseOutsideStrings, writeWrappedMeasuredText } from '../../../common/text';
import { measureTextRange, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { EditorFont } from '../../../editor/ui/view/font';
import { updateFullWidthWorkbenchLayout, type WorkbenchViewSizeConstraints } from '../../common/layout';
import type { SceneDetailsViewState } from './details_view';

const PADDING = 4;

/** Inspector fields keep an editing column alongside their axis label and their own scroll lane. */
export function measureSceneDetails(font: EditorFont, target: WorkbenchViewSizeConstraints): void {
	target.minimumHeight = font.lineHeight + 4;
	const chrome = PADDING * 3 + font.advance('X') + constants.SCROLLBAR_WIDTH;
	target.minimumWidth = chrome + font.charAdvance * 16;
	target.preferredWidth = chrome + font.charAdvance * 24;
}

/** Measure this inspector's descriptors once; scrolling only projects its retained field rectangles. */
export function layoutSceneDetails(view: SceneDetailsViewState, contentChanged: boolean, bounds: Readonly<RectBounds>): boolean {
	const changed = updateFullWidthWorkbenchLayout(view.layout, bounds);
	const measured = changed || contentChanged;
	if (measured) {
		const width = bounds.right - bounds.left - constants.SCROLLBAR_WIDTH;
		const height = measureDetails(view, width);
		view.viewport.layout(bounds.left, bounds.top, bounds.right, bounds.bottom, height);
	}
	if (view.position !== undefined && view.viewport.height > 0) {
		view.viewport.scrollbar.setScroll(view.position);
		view.position = undefined;
	}
	if (measured || view.layout.projectedOffsetTop !== view.viewport.offsetTop) {
		for (const property of view.properties) view.viewport.project(property.contentBounds, property.bounds);
		for (const property of view.optionProperties) view.viewport.project(property.contentBounds, property.bounds);
		view.layout.projectedOffsetTop = view.viewport.offsetTop;
	}
	return measured;
}

function measureDetails(view: SceneDetailsViewState, width: number): number {
	view.detailsText.length = 0;
	const subject = view.projection.subject;
	if (subject === undefined) return 0;
	const textWidth = width - PADDING * 2;
	let top = appendText(view, subject.preserveLabelCase ? subject.label : uppercaseOutsideStrings(subject.label), textWidth, PADDING);
	top = appendText(view, subject.preserveDetailCase ? subject.detail : uppercaseOutsideStrings(subject.detail), textWidth, top);
	if (subject.selection.kind === 'scene') return top;
	top = appendText(view, 'POSITION / WORLD UNITS', textWidth, top);
	const fieldHeight = view.layout.rowHeight + PADDING;
	const fieldLeft = PADDING * 2 + editorViewState.font.advance('X');
	for (const property of view.properties) {
		write_rect_bounds(property.contentBounds, fieldLeft, top, Math.max(fieldLeft, width - PADDING), top + fieldHeight);
		property.text = truncateTextToWidth(uppercaseOutsideStrings(property.descriptor.sourceText ?? 'Lua source'), width - PADDING - fieldLeft - 6);
		top += fieldHeight + PADDING;
	}
	if (view.optionProperties.length > 0) top = appendText(view, 'OPTIONS / LUA VALUES', textWidth, top);
	for (const property of view.optionProperties) {
		top = appendText(view, uppercaseOutsideStrings(property.descriptor.label), textWidth, top);
		write_rect_bounds(property.contentBounds, PADDING, top, Math.max(PADDING, width - PADDING), top + fieldHeight);
		property.text = truncateTextToWidth(uppercaseOutsideStrings(property.descriptor.preview), textWidth - 6);
		top += fieldHeight + PADDING;
	}
	top = appendText(view, subject.resolution === 'partial' ? 'PARTIAL DEFINITION' : 'DEFINITION ONLY', textWidth, top, true);
	return appendText(view, 'AFFECTS NEW INSTANCES', textWidth, top);
}

function appendText(view: SceneDetailsViewState, text: string, width: number, top: number, warning = false): number {
	writeWrappedMeasuredText(view.wrappedLines, text, width, width, text.length, measureTextRange);
	for (const line of view.wrappedLines) {
		view.detailsText.push({ text: line, top, warning });
		top += view.layout.rowHeight;
	}
	return top + PADDING;
}
