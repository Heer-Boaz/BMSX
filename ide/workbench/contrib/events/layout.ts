import type { RectBounds } from '../../../../machine/ts/common/rect';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText } from '../../../editor/common/text/layout';
import { SCROLLBAR_WIDTH } from '../../../common/constants';
import { updateFullWidthWorkbenchLayout, type FullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import type { EventViewerInput } from './editor_input';

// Event identity has priority; Timeline and Tick can move into Details.
export const EVENT_READING_COLUMNS = 16;

export type EventViewerLayout = FullWidthWorkbenchLayout & {
	compact: boolean;
	eventMinimumWidth: number;
	eventLeft: number;
	eventWidth: number;
	timelineLeft: number;
	timelineWidth: number;
	tickLeft: number;
	tickWidth: number;
	headerTop: number;
	digitWidth: number;
	timelineLabelWidth: number;
	timelinePrefixWidth: number;
	tickLabelWidth: number;
	measuredTimeline: number;
	measuredTick: number;
};

export function createEventViewerLayout(): EventViewerLayout {
	return { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		compact: true, eventMinimumWidth: 0, eventLeft: 0, eventWidth: 0,
		timelineLeft: 0, timelineWidth: 0, tickLeft: 0, tickWidth: 0, headerTop: 0, digitWidth: 0,
		timelineLabelWidth: 0, timelinePrefixWidth: 0, tickLabelWidth: 0, measuredTimeline: 0, measuredTick: 0 };
}

/** Event identity gets the reading budget; narrow clients retain metadata in Details and status. */
export function layoutEventViewer(input: EventViewerInput, bounds: Readonly<RectBounds>, projected: boolean): boolean {
	const { layout, viewport, projection } = input;
	const previousFont = layout.font, fontChanged = previousFont !== editorViewState.font;
	const leadingRow = previousFont === null ? 0 : viewport.scrollTop / layout.rowHeight;
	const resized = updateFullWidthWorkbenchLayout(layout, bounds), font = layout.font!;
	if (fontChanged) {
		layout.digitWidth = 0;
		for (const digit of '0123456789') layout.digitWidth = Math.max(layout.digitWidth, measureText(digit));
		layout.eventMinimumWidth = editorViewState.charAdvance * EVENT_READING_COLUMNS;
		layout.timelineLabelWidth = measureText('Timeline'); layout.timelinePrefixWidth = font.advance('T');
		layout.tickLabelWidth = measureText('Tick');
	}
	let changed = resized;
	if (resized || projected) {
		if (fontChanged || projection.maxTimeline !== layout.measuredTimeline) {
			layout.measuredTimeline = projection.maxTimeline;
			layout.timelineWidth = Math.max(layout.timelineLabelWidth, layout.timelinePrefixWidth + String(projection.maxTimeline).length * layout.digitWidth) + 8;
		}
		if (fontChanged || projection.maxCompletedTick !== layout.measuredTick) {
			layout.measuredTick = projection.maxCompletedTick;
			layout.tickWidth = Math.max(layout.tickLabelWidth, String(projection.maxCompletedTick).length * layout.digitWidth) + 8;
		}
		const available = Math.max(0, layout.right - layout.left - 4 - SCROLLBAR_WIDTH);
		const compact = available < layout.eventMinimumWidth + layout.timelineWidth + layout.tickWidth;
		const eventWidth = compact ? available : available - layout.timelineWidth - layout.tickWidth;
		const timelineLeft = layout.left + 4 + eventWidth;
		const tickLeft = compact ? timelineLeft : timelineLeft + layout.timelineWidth;
		changed ||= compact !== layout.compact || eventWidth !== layout.eventWidth || timelineLeft !== layout.timelineLeft || tickLeft !== layout.tickLeft;
		layout.compact = compact; layout.eventLeft = layout.left + 4; layout.eventWidth = eventWidth;
		layout.timelineLeft = timelineLeft; layout.tickLeft = tickLeft;
		layout.headerTop = layout.top + layout.rowHeight + 6;
		const contentTop = Math.min(layout.bottom, layout.top + layout.rowHeight * (compact ? 1 : 2) + (compact ? 8 : 10));
		viewport.layout(layout.left + 4, contentTop, layout.right, layout.bottom, projection.rows.length * layout.rowHeight);
		if (fontChanged && previousFont !== null) viewport.scrollbar.setScroll(leadingRow * layout.rowHeight);
	}
	layoutWorkbenchActionBar(input.actions, layout.right - 4, layout.top + 2, layout.top + layout.rowHeight + 6,
		measureText, font.renderFont(), layout.left + 4);
	return changed;
}
