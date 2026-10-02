import { create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import { clamp } from '../../../machine/ts/common/clamp';

/** Retained two-pane geometry; resizing never rebuilds a domain's data projection. */
export class WorkbenchSplitView {
	public readonly bounds = create_rect_bounds();
	private ratioValue: number;
	public minimumFirstSize = 0;
	public minimumSecondSize = 0;
	public revision = 0;
	public constructor(public readonly defaultRatio: number) { this.ratioValue = defaultRatio; }
	public get ratio(): number { return this.ratioValue; }
	public get position(): number {
		return clamp(Math.trunc(this.bounds.left + (this.bounds.right - this.bounds.left) * this.ratio),
			this.bounds.left + this.minimumFirstSize, this.bounds.right - this.minimumSecondSize);
	}
	public layout(left: number, top: number, right: number, bottom: number): void { write_rect_bounds(this.bounds, left, top, right, bottom); }
	public resize(ratio: number): void {
		const width = this.bounds.right - this.bounds.left;
		const min = this.minimumFirstSize > 0 ? Math.max(0.15, this.minimumFirstSize / width) : 0.15;
		const max = this.minimumSecondSize > 0 ? Math.min(0.85, 1 - this.minimumSecondSize / width) : 0.85;
		const next = clamp(ratio, min, max);
		if (this.ratio === next) return;
		this.ratioValue = next; this.revision++;
	}
	public moveTo(x: number): void { this.resize((x - this.bounds.left) / (this.bounds.right - this.bounds.left)); }
}
