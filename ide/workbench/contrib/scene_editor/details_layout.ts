import { write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { formatNumber } from '../../../../machine/ts/common/number_format';
import * as constants from '../../../common/constants';
import { firstLineTextPreview, uppercaseOutsideStrings, writeWrappedMeasuredText } from '../../../common/text';
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
		view.viewport.project(view.identity.contentBounds, view.identity.bounds);
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
	const label = subject.preserveLabelCase ? subject.label : uppercaseOutsideStrings(subject.label);
	const detail = subject.preserveDetailCase ? subject.detail : uppercaseOutsideStrings(subject.detail);
	// Only decoded equal identifiers prove a redundant description; equal dynamic
	// expressions can still produce different identities at their two callsites.
	const showDetail = !(subject.preserveLabelCase && subject.preserveDetailCase && subject.label === subject.detail);
	const displayLabel = truncateTextToWidth(firstLineTextPreview(label), textWidth, 'middle');
	const displayDetail = showDetail ? truncateTextToWidth(firstLineTextPreview(detail), textWidth, 'middle') : '';
	view.identity.tooltip = label + (showDetail ? '\n' + detail : '');
	view.identity.clipped = displayLabel !== label || showDetail && displayDetail !== detail;
	let top = PADDING;
	view.detailsText.push({ text: displayLabel, top, tone: 'normal' });
	top += view.layout.rowHeight;
	if (showDetail) {
		view.detailsText.push({ text: displayDetail, top, tone: 'description' });
		top += view.layout.rowHeight;
	}
	write_rect_bounds(view.identity.contentBounds, PADDING, PADDING, width - PADDING, top);
	top += PADDING;
	if (subject.selection.kind === 'scene') return top;
	if (view.properties.length > 0) top = appendText(view, 'LOCAL POSITION', textWidth, top);
	const fieldHeight = view.layout.rowHeight + PADDING;
	const fieldLeft = PADDING * 2 + editorViewState.font.advance('X');
	for (const property of view.properties) {
		write_rect_bounds(property.contentBounds, fieldLeft, top, Math.max(fieldLeft, width - PADDING), top + fieldHeight);
		const { family, value } = property.descriptor;
		// Compact coordinate readings are presentation only; focusing still exposes the
		// exact editable value and an unchanged acceptance publishes no source edit.
		const text = family === '2d' ? String(Number(value.toFixed(2))) : formatNumber(value);
		property.text = truncateTextToWidth(text, width - PADDING - fieldLeft - 6);
		top += fieldHeight + PADDING;
	}
	for (const property of view.optionProperties) {
		if (property.descriptor.kind !== 'boolean') top = appendText(view, uppercaseOutsideStrings(property.descriptor.label), textWidth, top);
		write_rect_bounds(property.contentBounds, PADDING, top, Math.max(PADDING, width - PADDING), top + fieldHeight);
		property.text = property.descriptor.kind === 'boolean' ? uppercaseOutsideStrings(property.descriptor.label)
			: truncateTextToWidth(property.descriptor.kind === 'string' ? property.descriptor.preview
			: uppercaseOutsideStrings(property.descriptor.preview), textWidth - 6);
		top += fieldHeight + PADDING;
	}
	return subject.resolution === 'partial' ? appendText(view, 'PARTIAL DEFINITION', textWidth, top, 'warning') : top;
}

function appendText(view: SceneDetailsViewState, text: string, width: number, top: number, tone: 'normal' | 'warning' = 'normal'): number {
	writeWrappedMeasuredText(view.wrappedLines, text, width, width, text.length, measureTextRange);
	for (const line of view.wrappedLines) {
		view.detailsText.push({ text: line, top, tone });
		top += view.layout.rowHeight;
	}
	return top + PADDING;
}
