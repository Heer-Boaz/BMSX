import { PointerButton } from './buttons';
import type { PointerSnapshot } from '../../common/models';

export interface PointerCaptureTarget {
	handleCapturedPointer(snapshot: PointerSnapshot, now: number): void;
	releaseCapturedPointer(snapshot: PointerSnapshot, now: number): void;
	cancelPointer(): void;
}

/** One control receives the rest of a physical gesture, ahead of ordinary hit testing. */
export class PointerCaptureService {
	private target: PointerCaptureTarget | null = null;
	private button = PointerButton.Primary;

	public capture(target: PointerCaptureTarget, button = PointerButton.Primary): void {
		this.cancel();
		this.target = target;
		this.button = button;
	}

	public release(target: PointerCaptureTarget): void {
		if (this.target === target) this.target = null;
	}

	public cancel(): void {
		const target = this.target;
		this.target = null;
		if (target !== null) target.cancelPointer();
	}

	/** Blocking ends capture; it never postpones a drag until the popup closes. */
	public dispatch(snapshot: PointerSnapshot, blocked: boolean, now: number): boolean {
		const target = this.target;
		if (target === null) return false;
		if (blocked || !snapshot.valid || !snapshot.insideViewport) {
			this.cancel();
			return false;
		}
		if ((snapshot.justReleasedButtons & this.button) !== 0) {
			this.target = null;
			target.releaseCapturedPointer(snapshot, now);
			return true;
		}
		// Consumed/lost input is not a physical release and must never commit a drop.
		if ((snapshot.pressedButtons & this.button) === 0) {
			this.cancel();
			return true;
		}
		target.handleCapturedPointer(snapshot, now);
		return true;
	}
}

export const pointerCapture = new PointerCaptureService();
