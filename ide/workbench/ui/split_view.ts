import { create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import { clamp } from '../../../machine/ts/common/clamp';

/** Reserved geometry for the shared sash's complete pointer target. */
export const WORKBENCH_SPLIT_SIZE = 8;

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
	public get resizable(): boolean { return this.end - this.start > this.minimumFirstSize + this.minimumSecondSize; }
	public get position(): number {
		return this.positionFor(this.start, this.end, this.minimumFirstSize, this.minimumSecondSize);
	}
	/** Project the retained preference into another admitted interval without changing this split. */
	public positionFor(start: number, end: number, minimumFirstSize: number, minimumSecondSize: number): number {
		return clamp(Math.trunc(start + (end - start) * this.ratio), start + minimumFirstSize, end - minimumSecondSize);
	}
	public layout(left: number, top: number, right: number, bottom: number): void { write_rect_bounds(this.bounds, left, top, right, bottom); }
	public resize(ratio: number): void {
		if (!this.resizable) return;
		const size = this.end - this.start;
		const min = this.minimumFirstSize / size;
		const max = 1 - this.minimumSecondSize / size;
		this.ratio = clamp(ratio, min, max);
	}
	public moveTo(position: number): void { this.resize((position - this.start) / (this.end - this.start)); }
}
