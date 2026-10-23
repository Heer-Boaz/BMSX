import { create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import type { BFont } from '../../../machine/ts/render/shared/bitmap_font';
import type { WorkbenchActionBarState } from './action_bar';
import { WORKBENCH_ICON_SIZE } from './icon';
import type { WorkbenchSlider } from './slider';

/** One transport row: playback, history range, review offset and review decisions. */
export class RuntimeTimelineLayout {
	public readonly bounds = create_rect_bounds();
	public positionLabel = '';
	public positionLeft = 0;
	private offsetTenths = -1;
	private durationTenths = -1;
	private positionWidth = 0;
	private durationWidth = 0;
	private positionRight = 0;
	private font: BFont | undefined;

	public static height(font: BFont): number { return Math.max(font.lineHeight + 8, WORKBENCH_ICON_SIZE + 10); }

	public update(actions: WorkbenchActionBarState, range: WorkbenchSlider, font: BFont,
		left: number, top: number, right: number, offsetTenths: number, durationTenths: number): void {
		const fontChanged = this.font !== font, positionChanged = this.offsetTenths !== offsetTenths;
		if (positionChanged) {
			this.offsetTenths = offsetTenths;
			this.positionLabel = offsetTenths === 0 ? '' : '-' + (offsetTenths / 10).toFixed(1) + ' s';
		}
		if (fontChanged || positionChanged) this.positionWidth = font.measure(this.positionLabel);
		const previousDurationWidth = this.durationWidth;
		if (fontChanged || this.durationTenths !== durationTenths) {
			this.durationTenths = durationTenths;
			this.durationWidth = font.measure('-' + (durationTenths / 10).toFixed(1) + ' s');
		}
		this.positionLeft = this.positionRight - this.positionWidth;
		if (!fontChanged && previousDurationWidth === this.durationWidth
			&& this.bounds.left === left && this.bounds.top === top && this.bounds.right === right) return;
		this.font = font;
		const bottom = top + RuntimeTimelineLayout.height(font), buttonSize = bottom - top - 4;
		write_rect_bounds(this.bounds, left, top, right, bottom);
		let actionLeft = left + 4, actionRight = right - 4;
		for (let index = 0; index < 3; index++) {
			write_rect_bounds(actions.items[index].bounds, actionLeft, top + 2, actionLeft + buttonSize, bottom - 2);
			actionLeft += buttonSize + 2;
		}
		for (let index = actions.items.length - 1; index >= 3; index--) {
			const item = actions.items[index];
			write_rect_bounds(item.bounds, actionRight - buttonSize, top + 2, actionRight, bottom - 2);
			actionRight -= buttonSize + 2;
		}
		this.positionRight = actionRight;
		this.positionLeft = this.positionRight - this.positionWidth;
		range.layout(actionLeft + 3, top + 2, this.positionRight - this.durationWidth - 5, bottom - 2);
	}
}
