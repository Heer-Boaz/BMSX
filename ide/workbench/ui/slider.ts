import { create_rect_bounds, write_rect_bounds } from '../../../machine/ts/common/rect';
import { clamp, clamp01 } from '../../../machine/ts/common/clamp';

/** Numeric range and pixel mapping; readback is separate from user input. */
export class WorkbenchSlider {
	public readonly bounds = create_rect_bounds();
	public minimum = 0;
	public maximum = 1;
	public step = 1;
	public value = 0;
	public enabled = false;
	public revision = 0;

	public get interactive(): boolean { return this.enabled && this.maximum > this.minimum && this.bounds.right - this.bounds.left > 6; }
	public get valueX(): number {
		const ratio = this.maximum > this.minimum ? clamp01((this.value - this.minimum) / (this.maximum - this.minimum)) : 0;
		return this.bounds.left + 3 + Math.round(ratio * (this.bounds.right - this.bounds.left - 6));
	}
	public layout(left: number, top: number, right: number, bottom: number): void {
		const bounds = this.bounds;
		if (bounds.left === left && bounds.top === top && bounds.right === right && bounds.bottom === bottom) return;
		write_rect_bounds(bounds, left, top, right, bottom);
		this.revision += 1;
	}
	public setRange(minimum: number, maximum: number, step: number): void {
		if (this.minimum === minimum && this.maximum === maximum && this.step === step) return;
		this.minimum = minimum; this.maximum = maximum; this.step = step;
		this.revision += 1;
	}
	public snap(value: number): number {
		if (value <= this.minimum) return this.minimum;
		if (value >= this.maximum) return this.maximum;
		return clamp(this.minimum + Math.round((value - this.minimum) / this.step) * this.step, this.minimum, this.maximum);
	}
	public valueAt(x: number): number {
		const ratio = clamp01((x - this.bounds.left - 3) / (this.bounds.right - this.bounds.left - 6));
		return this.snap(this.minimum + ratio * (this.maximum - this.minimum));
	}
}
