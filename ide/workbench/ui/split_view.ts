import { create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import { clamp } from '../../../machine/ts/common/clamp';

/** Retained two-pane geometry; resizing never rebuilds a domain's data projection. */
export class WorkbenchSplitView {
	public readonly bounds = create_rect_bounds();
	private ratioValue: number;
	public minimumFirstSize = 0;
	public minimumSecondSize = 0;
	public revision = 0;
	public constructor(public readonly defaultRatio: number, public readonly orientation: 'horizontal' | 'vertical' = 'horizontal') { this.ratioValue = defaultRatio; }
	public get ratio(): number { return this.ratioValue; }
	/** Requested view intent is retained independently of current placement constraints. */
	public set ratio(value: number) {
		if (this.ratioValue === value) return;
		this.ratioValue = value; this.revision++;
	}
	public get start(): number { return this.orientation === 'horizontal' ? this.bounds.left : this.bounds.top; }
	public get end(): number { return this.orientation === 'horizontal' ? this.bounds.right : this.bounds.bottom; }
	public get position(): number {
		return clamp(Math.trunc(this.start + (this.end - this.start) * this.ratio),
			this.start + this.minimumFirstSize, this.end - this.minimumSecondSize);
	}
	public layout(left: number, top: number, right: number, bottom: number): void { write_rect_bounds(this.bounds, left, top, right, bottom); }
	public resize(ratio: number): void {
		const size = this.end - this.start;
		const min = this.minimumFirstSize > 0 ? Math.max(0.15, this.minimumFirstSize / size) : 0.15;
		const max = this.minimumSecondSize > 0 ? Math.min(0.85, 1 - this.minimumSecondSize / size) : 0.85;
		this.ratio = clamp(ratio, min, max);
	}
	public moveTo(position: number): void { this.resize((position - this.start) / (this.end - this.start)); }
}
