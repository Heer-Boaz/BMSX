import { clear_rect_bounds, copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import { WorkbenchSplitView, WORKBENCH_SPLIT_SIZE } from '../ui/split_view';

export const WORKBENCH_MAIN_AREA_GAP = 4;

/** Parent allocation for Main's editors and its optional companion, independent of either client's controls. */
export class WorkbenchMainAreaLayout {
	public readonly availableBounds = create_rect_bounds();
	public readonly primaryBounds = create_rect_bounds();
	public readonly companionBounds = create_rect_bounds();
	public readonly sashBounds = create_rect_bounds();
	public readonly split = new WorkbenchSplitView(0.58);
	public enabled = false;
	public visible = false;
	public revision = 0;
	private companionMinimumWidth = 0;
	private companionMinimumHeight = 0;

	/** Parent chrome supplies the already reserved area and the companion's measured requirements. */
	public prepare(bounds: Readonly<RectBounds>, companionMinimumWidth: number, companionMinimumHeight: number): void {
		copy_rect_bounds(this.availableBounds, bounds);
		this.companionMinimumWidth = companionMinimumWidth;
		this.companionMinimumHeight = companionMinimumHeight;
	}

	/** Publish both child rectangles; withholding presentation preserves the requested split and open intent. */
	public layout(primaryMinimumWidth: number | undefined, bounds: Readonly<RectBounds> = this.availableBounds): boolean {
		copy_rect_bounds(this.availableBounds, bounds);
		const primary = this.primaryBounds, companion = this.companionBounds, available = this.availableBounds;
		const left = primary.left, top = primary.top, right = primary.right, bottom = primary.bottom;
		const visible = this.writePrimaryBounds(primaryMinimumWidth, primary);
		let changed = this.visible !== visible || primary.left !== left || primary.top !== top || primary.right !== right || primary.bottom !== bottom;
		this.visible = visible;
		if (visible) {
			const companionLeft = primary.right + WORKBENCH_MAIN_AREA_GAP;
			changed = changed || companion.left !== companionLeft || companion.top !== available.top || companion.right !== available.right || companion.bottom !== available.bottom;
			write_rect_bounds(companion, companionLeft, available.top, available.right, available.bottom);
			this.split.minimumFirstSize = primaryMinimumWidth! + WORKBENCH_MAIN_AREA_GAP / 2;
			this.split.minimumSecondSize = this.companionMinimumWidth + WORKBENCH_MAIN_AREA_GAP / 2;
			this.split.layout(available.left, available.top, available.right, available.bottom);
			write_rect_bounds(this.sashBounds, this.split.position - WORKBENCH_SPLIT_SIZE / 2, available.top,
				this.split.position + WORKBENCH_SPLIT_SIZE / 2, available.bottom);
		} else {
			changed = changed || companion.left !== 0 || companion.top !== 0 || companion.right !== 0 || companion.bottom !== 0;
			clear_rect_bounds(companion);
			clear_rect_bounds(this.sashBounds);
		}
		if (changed) this.revision++;
		return changed;
	}

	/** A projected child policy changes only its destination, never the live allocation or sash. */
	public writePrimaryBounds(primaryMinimumWidth: number | undefined, target: RectBounds): boolean {
		const available = this.availableBounds;
		if (!this.enabled || primaryMinimumWidth === undefined
			|| available.right - available.left < primaryMinimumWidth + WORKBENCH_MAIN_AREA_GAP + this.companionMinimumWidth
			|| available.bottom - available.top < this.companionMinimumHeight) {
			copy_rect_bounds(target, available);
			return false;
		}
		const position = this.split.positionFor(available.left, available.right,
			primaryMinimumWidth + WORKBENCH_MAIN_AREA_GAP / 2, this.companionMinimumWidth + WORKBENCH_MAIN_AREA_GAP / 2);
		write_rect_bounds(target, available.left, available.top, position - WORKBENCH_MAIN_AREA_GAP / 2, available.bottom);
		return true;
	}
}
