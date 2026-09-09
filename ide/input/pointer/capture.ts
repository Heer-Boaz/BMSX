import type { PointerSnapshot } from '../../common/models';

export interface PointerCaptureTarget {
	handleCapturedPointer(snapshot: PointerSnapshot): void;
	cancelPointer(): void;
}

/** One control receives the rest of a physical gesture, ahead of ordinary hit testing. */
export class PointerCaptureService {
	private target: PointerCaptureTarget | null = null;

	public capture(target: PointerCaptureTarget): void {
		this.cancel();
		this.target = target;
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
	public dispatch(snapshot: PointerSnapshot, blocked: boolean): boolean {
		const target = this.target;
		if (target === null) return false;
		if (blocked || !snapshot.valid || !snapshot.insideViewport) {
			this.cancel();
			return false;
		}
		if (!snapshot.primaryPressed) {
			this.cancel();
			return true;
		}
		target.handleCapturedPointer(snapshot);
		return true;
	}
}

export const pointerCapture = new PointerCaptureService();
