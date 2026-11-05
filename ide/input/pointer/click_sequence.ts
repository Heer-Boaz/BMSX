import { DOUBLE_CLICK_MAX_INTERVAL_MS, POINTER_DRAG_ACTIVATION_THRESHOLD } from '../../common/constants';

/** A pair of clicks on the same retained item, within one physical location.
 * Owners clear the sequence when a gesture, binding or selection context retires. */
export class PointerClickSequence<T> {
	private target: T | undefined;
	private time = 0;
	private x = 0;
	private y = 0;
	public clear(): void { this.target = undefined; }
	public click(target: T, x: number, y: number, now: number): boolean {
		const twice = this.target === target && now - this.time <= DOUBLE_CLICK_MAX_INTERVAL_MS
			&& Math.max(Math.abs(x - this.x), Math.abs(y - this.y)) < POINTER_DRAG_ACTIVATION_THRESHOLD;
		this.target = twice ? undefined : target;
		this.time = now; this.x = x; this.y = y;
		return twice;
	}
}
