import { clear_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import * as constants from '../../../common/constants';
import { truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { WorkbenchChromeLayout } from '../../common/layout';
import { editorChromeState } from '../chrome_state';
import { editorTabGroup } from './group_model';
import type { EditorTabId } from './id';
import type { EditorInput } from './model';

type TabItemLayout = {
	bounds: RectBounds;
	closeBounds: RectBounds;
	text: string;
	closeWidth: number;
	indicatorWidth: number;
	dirty: boolean;
	markerWidth: number;
	markerHeight: number;
	closable: boolean;
	active: boolean;
	hovered: boolean;
	tabWidth: number;
};

/** Retained layout records consumed by painting; hit rectangles keep input lifetime. */
export const tabBarItems = new ScratchBuffer<TabItemLayout>(() => ({
	bounds: null, closeBounds: null, text: '', closeWidth: 0, indicatorWidth: 0,
	dirty: false, markerWidth: 0, markerHeight: 0, closable: false, active: false, hovered: false, tabWidth: 0,
}), 8);
const tabTrack = create_rect_bounds();
let measuredFont: BFont | undefined;
let closeButtonWidth = 0;
let laidOutScroll = 0;
let revealedGroupRevision = -1;
let revealedScrollbarRevision = -1;
const measuredLabels = new WeakMap<EditorInput, { label: string; font: BFont; availableWidth: number; text: string; width: number }>();

function getStoredTabBounds(boundsByTabId: Map<EditorTabId, RectBounds>, tab: EditorInput): RectBounds {
	let bounds = boundsByTabId.get(tab.id);
	if (bounds === undefined) {
		bounds = create_rect_bounds();
		boundsByTabId.set(tab.id, bounds);
		tab.onWillDispose(() => boundsByTabId.delete(tab.id));
	}
	return bounds;
}

/** Publish strip height, scrolling and hits before the workbench lays out its content. */
export function layoutTabBar(context: WorkbenchChromeLayout): void {
	const previousCount = tabBarItems.length;
	tabBarItems.clear();
	const tabs = editorTabGroup.tabs;
	tabBarItems.reserve(tabs.length);
	const font = editorViewState.font.renderFont();
	if (measuredFont !== font) {
		closeButtonWidth = context.measureText(constants.TAB_CLOSE_BUTTON_SYMBOL);
		measuredFont = font;
	}
	const { width: markerWidth, height: markerHeight } = constants.TAB_DIRTY_MARKER_METRICS;
	const viewportWidth = context.viewportWidth;
	let contentWidth = constants.TAB_DIRTY_LEFT_MARGIN;
	let activeLeft = 0, activeRight = 0;
	let itemsChanged = previousCount !== tabs.length;
	for (let index = 0; index < tabs.length; index++) {
		const tab = tabs[index], metric = tabBarItems.get(index);
		const dirty = tab.isDirty(), closable = tab.closable;
		const closeWidth = closable ? closeButtonWidth + constants.TAB_CLOSE_BUTTON_PADDING_X * 2 : 0;
		const indicatorWidth = closable ? closeWidth : dirty ? markerWidth + constants.TAB_DIRTY_MARKER_SPACING : 0;
		const label = editorTabGroup.getLabel(tab);
		const availableWidth = viewportWidth - constants.TAB_DIRTY_LEFT_MARGIN - constants.TAB_DIRTY_RIGHT_MARGIN
			- constants.TAB_BUTTON_PADDING_X * 2 - indicatorWidth;
		let measured = measuredLabels.get(tab);
		if (measured === undefined || measured.label !== label || measured.font !== font || measured.availableWidth !== availableWidth) {
			const text = truncateTextToWidth(label, availableWidth);
			measured = { label, font, availableWidth, text, width: context.measureText(text) };
			measuredLabels.set(tab, measured);
		}
		const bounds = getStoredTabBounds(editorChromeState.tabButtonBounds, tab);
		const hovered = tab.id === editorChromeState.tabHoverId;
		const tabWidth = measured.width + constants.TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
		itemsChanged ||= metric.bounds !== bounds || metric.tabWidth !== tabWidth
			|| metric.closeWidth !== closeWidth || metric.hovered !== hovered;
		metric.bounds = bounds;
		metric.closeBounds = getStoredTabBounds(editorChromeState.tabCloseButtonBounds, tab);
		metric.text = measured.text;
		metric.closeWidth = closeWidth;
		metric.indicatorWidth = indicatorWidth;
		metric.dirty = dirty;
		metric.markerWidth = dirty ? markerWidth : 0;
		metric.markerHeight = dirty ? markerHeight : 0;
		metric.closable = closable;
		metric.active = tab === editorTabGroup.activeTab;
		metric.hovered = hovered;
		metric.tabWidth = tabWidth;
		if (metric.active) { activeLeft = contentWidth; activeRight = contentWidth + metric.tabWidth; }
		contentWidth += metric.tabWidth + constants.TAB_BUTTON_SPACING;
	}
	contentWidth += constants.TAB_DIRTY_RIGHT_MARGIN;
	const barTop = context.headerHeight, rowBottom = barTop + context.tabBarHeight;
	const totalHeight = context.tabBarHeight + (contentWidth > viewportWidth ? constants.SCROLLBAR_WIDTH : 0);
	editorViewState.tabBarTotalHeight = totalHeight;
	const barBottom = barTop + totalHeight;
	write_rect_bounds(editorChromeState.tabBarBounds, 0, barTop, viewportWidth, barBottom);
	write_rect_bounds(tabTrack, 0, rowBottom, viewportWidth, barBottom);
	const scrollbar = editorChromeState.tabScrollbar;
	const previousScrollbarRevision = scrollbar.revision;
	scrollbar.layout(tabTrack, contentWidth, viewportWidth, scrollbar.getScroll());
	editorChromeState.tabScrollControl.update();
	if (revealedGroupRevision !== editorTabGroup.revision || revealedScrollbarRevision !== scrollbar.revision) {
		if (!editorChromeState.tabDragState?.hasDragged) scrollbar.reveal(activeLeft, activeRight);
		revealedGroupRevision = editorTabGroup.revision;
		revealedScrollbarRevision = scrollbar.revision;
	}
	const scroll = Math.round(scrollbar.getScroll());
	// Resize can publish synchronously; the next update consumes unchanged geometry.
	// Dirty/active presentation is still observed above, independent of group revision.
	if (!itemsChanged && previousScrollbarRevision === scrollbar.revision && laidOutScroll === scroll) return;
	laidOutScroll = scroll;
	let cursor = constants.TAB_DIRTY_LEFT_MARGIN - scroll;
	for (let index = 0; index < tabBarItems.length; index++) {
		const item = tabBarItems.peek(index), right = cursor + item.tabWidth;
		write_rect_bounds(item.bounds, cursor, barTop + 1, right, rowBottom - 1);
		if (right > 0 && cursor < viewportWidth && item.closable && item.hovered) {
			write_rect_bounds(item.closeBounds, right - item.closeWidth, barTop + 1, right, rowBottom - 1);
		} else clear_rect_bounds(item.closeBounds);
		cursor = right + constants.TAB_BUTTON_SPACING;
	}
}
