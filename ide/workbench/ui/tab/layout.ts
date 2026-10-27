import { clear_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import * as constants from '../../../common/constants';
import { ELLIPSIS, truncateMeasuredText, type TextRangeMeasure } from '../../../common/text';
import type { EditorTabGroupModel } from './group_model';
import type { EditorTabId } from './id';
import type { EditorInput } from '../../common/editor_inputs';
import { layoutWorkbenchActionBar, type WorkbenchActionBarState } from '../action_bar';
import type { Scrollbar } from '../scrollbar';

export type EditorTabStripLayoutContext = {
	readonly font: BFont;
	readonly tabBarHeight: number;
	readonly charAdvance: number;
	measureText(text: string): number;
	readonly measureTextRange: TextRangeMeasure;
};

export type TabItemLayout = {
	input: EditorInput;
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
	contentLeft: number;
	tabWidth: number;
};

type MeasuredTab = {
	readonly bounds: RectBounds;
	readonly closeBounds: RectBounds;
	label: string;
	font: BFont;
	naturalWidth: number;
	availableWidth: number;
	text: string;
	width: number;
};

/** A group's retained strip projection. Paint and pointer consume these same records. */
export class EditorTabStripLayout {
	public readonly bounds = create_rect_bounds();
	public readonly viewportBounds = create_rect_bounds();
	public readonly items = new ScratchBuffer<TabItemLayout>(() => ({
		input: null!, bounds: null!, closeBounds: null!, text: '', closeWidth: 0, indicatorWidth: 0,
		dirty: false, markerWidth: 0, markerHeight: 0, closable: false, active: false, hovered: false, contentLeft: 0, tabWidth: 0,
	}), 8);
	public revision = 0;
	public totalHeight = 0;
	public rowHeight = 0;
	public charAdvance = 0;
	public font!: BFont;
	private readonly track = create_rect_bounds();
	private measuredFont: BFont | undefined;
	private closeButtonWidth = 0;
	private laidOutScroll = 0;
	private revealedGroupRevision = -1;
	private revealedScrollbarRevision = -1;
	private readonly measuredLabels = new WeakMap<EditorInput, MeasuredTab>();

	public constructor(private readonly model: EditorTabGroupModel, private readonly actions: WorkbenchActionBarState,
		private readonly scrollbar: Scrollbar) {}

	public clear(): void {
		for (let index = 0; index < this.items.length; index++) this.items.peek(index).input = null!;
		this.items.clear();
		clear_rect_bounds(this.bounds);
		clear_rect_bounds(this.viewportBounds);
		clear_rect_bounds(this.track);
		this.scrollbar.layout(this.track, 0, 0, 0);
		this.totalHeight = 0;
		this.rowHeight = 0;
		this.charAdvance = 0;
		this.revealedGroupRevision = -1;
		this.revealedScrollbarRevision = -1;
		this.revision += 1;
	}

	/** The owning group supplies its actual strip extent, independent of root menu placement. */
	public layout(bounds: Readonly<RectBounds>, context: EditorTabStripLayoutContext,
		hoverId: EditorTabId | null, dragging: boolean): void {
		const previousCount = this.items.length;
		const tabs = this.model.tabs;
		for (let index = tabs.length; index < previousCount; index++) this.items.peek(index).input = null!;
		this.items.clear();
		this.items.reserve(tabs.length);
		const font = context.font;
		this.font = font;
		this.rowHeight = context.tabBarHeight;
		this.charAdvance = context.charAdvance;
		if (this.measuredFont !== font) {
			this.closeButtonWidth = context.measureText(constants.TAB_CLOSE_BUTTON_SYMBOL);
			this.measuredFont = font;
		}
		const { width: markerWidth, height: markerHeight } = constants.TAB_DIRTY_MARKER_METRICS;
		const tabsLeft = bounds.left, stripRight = bounds.right;
		const availableStrip = stripRight - tabsLeft;
		let contentWidth = constants.TAB_DIRTY_LEFT_MARGIN;
		let activeLeft = 0, activeRight = 0;
		let itemsChanged = previousCount !== tabs.length;
		for (let index = 0; index < tabs.length; index++) {
			const tab = tabs[index], metric = this.items.get(index);
			const dirty = tab.isDirty(), closable = tab.closable;
			const closeWidth = closable ? this.closeButtonWidth + constants.TAB_CLOSE_BUTTON_PADDING_X * 2 : 0;
			const indicatorWidth = closable ? closeWidth : dirty ? markerWidth + constants.TAB_DIRTY_MARKER_SPACING : 0;
			const label = this.model.getLabel(tab);
			const availableWidth = availableStrip - constants.TAB_DIRTY_LEFT_MARGIN - constants.TAB_DIRTY_RIGHT_MARGIN
				- constants.TAB_BUTTON_PADDING_X * 2 - indicatorWidth;
			let measured = this.measuredLabels.get(tab);
			if (measured === undefined) {
				measured = { bounds: create_rect_bounds(), closeBounds: create_rect_bounds(), label, font,
					naturalWidth: context.measureText(label), availableWidth: -1, text: '', width: 0 };
				this.measuredLabels.set(tab, measured);
			} else if (measured.label !== label || measured.font !== font) {
				measured.label = label; measured.font = font; measured.naturalWidth = context.measureText(label);
				measured.availableWidth = -1;
			}
			const hovered = tab.id === hoverId;
			itemsChanged ||= metric.bounds !== measured.bounds || metric.closeWidth !== closeWidth || metric.hovered !== hovered;
			metric.input = tab;
			metric.bounds = measured.bounds;
			metric.closeBounds = measured.closeBounds;
			metric.closeWidth = closeWidth;
			metric.indicatorWidth = indicatorWidth;
			metric.dirty = dirty;
			metric.markerWidth = dirty ? markerWidth : 0;
			metric.markerHeight = dirty ? markerHeight : 0;
			metric.closable = closable;
			metric.active = tab === this.model.activeTab;
			metric.hovered = hovered;
			contentWidth += Math.min(measured.naturalWidth, availableWidth) + constants.TAB_BUTTON_PADDING_X * 2 + indicatorWidth;
			if (index + 1 < tabs.length) contentWidth += constants.TAB_BUTTON_SPACING;
		}
		contentWidth += constants.TAB_DIRTY_RIGHT_MARGIN;
		const barTop = bounds.top, rowBottom = barTop + context.tabBarHeight;
		const overflow = contentWidth > availableStrip;
		for (const item of this.actions.items) item.visible = overflow;
		let tabsRight = stripRight;
		if (overflow) {
			layoutWorkbenchActionBar(this.actions, stripRight - 1, barTop + 1, rowBottom - 1, context.measureText, font, tabsLeft);
			tabsRight = this.actions.items[0].bounds.left - constants.TAB_BUTTON_SPACING;
		}
		// Actions reserve their actual strip extent before long labels are truncated.
		contentWidth = constants.TAB_DIRTY_LEFT_MARGIN;
		for (let index = 0; index < tabs.length; index++) {
			const metric = this.items.peek(index), measured = this.measuredLabels.get(tabs[index])!;
			const availableWidth = tabsRight - tabsLeft - constants.TAB_DIRTY_LEFT_MARGIN - constants.TAB_DIRTY_RIGHT_MARGIN
				- constants.TAB_BUTTON_PADDING_X * 2 - metric.indicatorWidth;
			if (measured.availableWidth !== availableWidth) {
				measured.availableWidth = availableWidth;
				measured.text = truncateMeasuredText(measured.label, availableWidth, context.measureTextRange, ELLIPSIS, 'end', measured.naturalWidth);
				measured.width = measured.text === measured.label ? measured.naturalWidth : context.measureText(measured.text);
			}
			const width = measured.width + constants.TAB_BUTTON_PADDING_X * 2 + metric.indicatorWidth;
			itemsChanged ||= metric.tabWidth !== width;
			metric.text = measured.text; metric.tabWidth = width;
			metric.contentLeft = tabsLeft + contentWidth;
			if (metric.active) { activeLeft = contentWidth; activeRight = contentWidth + width; }
			contentWidth += width;
			if (index + 1 < tabs.length) contentWidth += constants.TAB_BUTTON_SPACING;
		}
		contentWidth += constants.TAB_DIRTY_RIGHT_MARGIN;
		this.totalHeight = context.tabBarHeight + (overflow ? constants.SCROLLBAR_WIDTH : 0);
		const barBottom = barTop + this.totalHeight;
		const extentChanged = this.bounds.left !== tabsLeft || this.bounds.top !== barTop || this.bounds.right !== stripRight || this.bounds.bottom !== barBottom
			|| this.viewportBounds.right !== tabsRight || this.viewportBounds.bottom !== rowBottom;
		write_rect_bounds(this.bounds, tabsLeft, barTop, stripRight, barBottom);
		write_rect_bounds(this.viewportBounds, tabsLeft, barTop, tabsRight, rowBottom);
		write_rect_bounds(this.track, tabsLeft, rowBottom, tabsRight, barBottom);
		const previousScrollbarRevision = this.scrollbar.revision;
		this.scrollbar.layout(this.track, contentWidth, tabsRight - tabsLeft, this.scrollbar.getScroll());
		if (this.revealedGroupRevision !== this.model.revision || this.revealedScrollbarRevision !== this.scrollbar.revision) {
			if (!dragging) this.scrollbar.reveal(activeLeft, activeRight);
			this.revealedGroupRevision = this.model.revision;
			this.revealedScrollbarRevision = this.scrollbar.revision;
		}
		const scroll = Math.round(this.scrollbar.getScroll());
		if (!itemsChanged && !extentChanged && previousScrollbarRevision === this.scrollbar.revision && this.laidOutScroll === scroll) return;
		this.revision += 1;
		this.laidOutScroll = scroll;
		let cursor = tabsLeft + constants.TAB_DIRTY_LEFT_MARGIN - scroll;
		for (let index = 0; index < this.items.length; index++) {
			const item = this.items.peek(index), right = cursor + item.tabWidth;
			write_rect_bounds(item.bounds, cursor, barTop + 1, right, rowBottom - 1);
			if (right > tabsLeft && cursor < tabsRight && item.closable && item.hovered) {
				write_rect_bounds(item.closeBounds, right - item.closeWidth, barTop + 1, right, rowBottom - 1);
			} else clear_rect_bounds(item.closeBounds);
			cursor = right + constants.TAB_BUTTON_SPACING;
		}
	}
}
