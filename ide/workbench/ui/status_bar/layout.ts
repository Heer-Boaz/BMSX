import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import { clear_rect_bounds, copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { ELLIPSIS, truncateMeasuredText } from '../../../common/text';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { WorkbenchStatusItem } from '../../common/status_bar';

export const STATUS_ITEM_PADDING = 4;
const GAP = 4;

export type WorkbenchStatusItemPresentation = {
	item: WorkbenchStatusItem | undefined;
	fullText: string;
	lineText: string;
	text: string;
	naturalWidth: number;
	bounds: RectBounds;
	visible: boolean;
	truncated: boolean;
	priority: number;
	width: number;
	textWidth: number;
	nextWidth: number;
};

/** Admission rank and visual alignment are independent; every drawn item has its own bounded slot. */
export class WorkbenchStatusItemsLayout {
	public readonly bounds = create_rect_bounds();
	public readonly disclosureBounds = create_rect_bounds();
	public readonly items = new ScratchBuffer<WorkbenchStatusItemPresentation>(() => ({ item: undefined, fullText: '', lineText: '', text: '',
		naturalWidth: 0, bounds: create_rect_bounds(), visible: false, truncated: false, priority: 0, width: -1, textWidth: 0, nextWidth: 0 }));
	public overflow = false;
	private readonly order: number[] = [];
	private font: EditorFont | undefined;
	private markerWidth = 0;
	private disclosureWidth = -1;
	private readonly compare = (left: number, right: number): number => this.items.peek(right).priority - this.items.peek(left).priority || left - right;

	public update(input: readonly WorkbenchStatusItem[], bounds: Readonly<RectBounds>, font: EditorFont, disclosureWidth = 0): boolean {
		const fontChanged = this.font !== font, previousCount = this.items.length;
		let changed = fontChanged || previousCount !== input.length || this.disclosureWidth !== disclosureWidth
			|| this.bounds.left !== bounds.left || this.bounds.top !== bounds.top || this.bounds.right !== bounds.right || this.bounds.bottom !== bounds.bottom;
		let reordered = previousCount !== input.length;
		if (fontChanged) { this.font = font; this.markerWidth = font.measure(ELLIPSIS); }
		this.items.clear();
		for (let index = 0; index < input.length; index++) {
			const item = input[index], presentation = this.items.get(index);
			if (presentation.item !== item || presentation.priority !== item.priority) reordered = changed = true;
			if (fontChanged || presentation.fullText !== item.text) {
				if (presentation.fullText !== item.text) presentation.lineText = item.text.replace(/\r\n|[\r\n\t]/g, ' ');
				presentation.fullText = item.text;
				presentation.textWidth = font.measure(presentation.lineText);
				presentation.naturalWidth = item.text.length === 0 ? 0 : presentation.textWidth + STATUS_ITEM_PADDING * 2;
				presentation.width = -1; changed = true;
			}
			presentation.item = item; presentation.priority = item.priority;
		}
		if (!changed) return false;
		copy_rect_bounds(this.bounds, bounds);
		if (reordered) {
			this.order.length = input.length;
			for (let index = 0; index < input.length; index++) this.order[index] = index;
			this.order.sort(this.compare);
		}
		this.disclosureWidth = disclosureWidth;
		const width = Math.max(0, bounds.right - bounds.left);
		this.allocate(width);
		const reserved = this.overflow && disclosureWidth <= width ? disclosureWidth : 0;
		if (reserved > 0) this.allocate(width - reserved);
		if (reserved > 0) write_rect_bounds(this.disclosureBounds, bounds.right - reserved, bounds.top, bounds.right, bounds.bottom);
		else clear_rect_bounds(this.disclosureBounds);
		for (let index = 0; index < input.length; index++) {
			const entry = this.items.peek(index);
			if (entry.nextWidth !== entry.width) {
				entry.width = entry.nextWidth;
				entry.text = truncateMeasuredText(entry.lineText, Math.max(0, entry.width - STATUS_ITEM_PADDING * 2), font.measureTextRange,
					ELLIPSIS, 'end', entry.textWidth);
			}
		}
		let left = bounds.left, right = bounds.right - reserved;
		for (let index = 0; index < input.length; index++) {
			const entry = this.items.peek(index);
			if (!entry.visible || entry.item!.alignment !== 'left') continue;
			write_rect_bounds(entry.bounds, left, bounds.top, left + entry.width, bounds.bottom); left += entry.width + GAP;
		}
		for (let index = input.length - 1; index >= 0; index--) {
			const entry = this.items.peek(index);
			if (!entry.visible || entry.item!.alignment !== 'right') continue;
			write_rect_bounds(entry.bounds, right - entry.width, bounds.top, right, bounds.bottom); right -= entry.width + GAP;
		}
		return true;
	}
	/** The overflow pass changes only integer extents, not formatted strings or the published input bounds. */
	private allocate(width: number): void {
		let available = width, admitted = 0;
		this.overflow = false;
		for (let rank = 0; rank < this.order.length; rank++) {
			const entry = this.items.peek(this.order[rank]), item = entry.item!;
			const gap = admitted === 0 ? 0 : GAP;
			let width = Math.min(entry.naturalWidth, Math.max(0, available - gap));
			if (width < entry.naturalWidth && (item.overflow === 'hide' || width < this.markerWidth + STATUS_ITEM_PADDING * 2)) width = 0;
			entry.visible = width > 0;
			entry.truncated = width < entry.naturalWidth;
			this.overflow ||= entry.truncated;
			entry.nextWidth = width;
			if (entry.visible) { available -= width + gap; admitted++; }
			else clear_rect_bounds(entry.bounds);
		}
	}

}
