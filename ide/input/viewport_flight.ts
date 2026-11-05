/** Physical keys have separate bits: releasing W must not release a held Up arrow. */
const FLIGHT_KEYS = new Map([
	['KeyW', 1 << 0], ['ArrowUp', 1 << 1], ['Numpad8', 1 << 2],
	['KeyS', 1 << 3], ['ArrowDown', 1 << 4], ['Numpad2', 1 << 5],
	['KeyA', 1 << 6], ['ArrowLeft', 1 << 7], ['Numpad4', 1 << 8],
	['KeyD', 1 << 9], ['ArrowRight', 1 << 10], ['Numpad6', 1 << 11],
	['KeyQ', 1 << 12], ['PageDown', 1 << 13], ['Numpad7', 1 << 14],
	['KeyE', 1 << 15], ['PageUp', 1 << 16], ['Numpad9', 1 << 17],
	['KeyR', 1 << 18], ['KeyF', 1 << 19],
]);

/** Retained input integration only. The captured viewport owns admission,
 * host time, speed, camera axes and cancellation; this never polls guest input. */
export class ViewportFlightInput {
	private keys = 0;
	private time = 0;
	public right = 0;
	public up = 0;
	public forward = 0;
	public localUp = 0;

	public begin(now: number): void { this.keys = 0; this.time = now; }
	public clear(): void { this.keys = 0; }
	public key(code: string, down: boolean): boolean {
		const bit = FLIGHT_KEYS.get(code);
		if (bit === undefined) return false;
		this.keys = down ? this.keys | bit : this.keys & ~bit;
		return true;
	}
	/** Integrate the old hold before a key or speed transition. Outputs are valid
	 * when true, in the caller's distance units; repeated host times do no work. */
	public advance(now: number, unitsPerSecond: number): boolean {
		const elapsed = (now - this.time) / 1000, keys = this.keys;
		this.time = now;
		if (keys === 0 || elapsed === 0) return false;
		const distance = elapsed * unitsPerSecond;
		this.right = ((keys & (7 << 9) ? 1 : 0) - (keys & (7 << 6) ? 1 : 0)) * distance;
		this.up = ((keys & (7 << 15) ? 1 : 0) - (keys & (7 << 12) ? 1 : 0)) * distance;
		this.forward = ((keys & 7 ? 1 : 0) - (keys & (7 << 3) ? 1 : 0)) * distance;
		this.localUp = ((keys & (1 << 18) ? 1 : 0) - (keys & (1 << 19) ? 1 : 0)) * distance;
		return this.right !== 0 || this.up !== 0 || this.forward !== 0 || this.localUp !== 0;
	}
}
