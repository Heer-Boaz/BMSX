/**
 * Represents a single frame in the rewind buffer.
 * Contains the timestamp, frame number, and the compressed snapshot of the game state.
 */
export interface RewindFrame {
	timestamp: number; // ms
	frame: number;
	state: Uint8Array; // compressed snapshot
}

/**
 * Represents a buffer for managing rewindable game states.
 * Stores a series of frames and their associated states, allowing
 * the game to rewind or fast-forward through its history.
 */
export class RewindBuffer {
	private buffer: RewindFrame[] = [];
	private maxFrames: number;
	private frameInterval: number; // ms per frame
	private windowMs: number;
	private currentIdx: number = -1; // -1 = latest

	/**
	 * Creates a new instance of `RewindBuffer`.
	 * @param targetFPS - The target frames per second of the game.
	 * @param windowSeconds - The duration of the rewind window in seconds.
	 */
	constructor(targetFPS: number, windowSeconds: number) {
		this.frameInterval = 1000 / targetFPS; // ms per frame
		this.windowMs = windowSeconds * 1000; // Convert seconds to milliseconds
		this.maxFrames = Math.ceil(windowSeconds * targetFPS) + 1; // Include an additional frame for the current frame
	}

	/**
	 * Pushes a new frame and its state into the buffer.
	 * Automatically removes old frames that fall outside the rewind window.
	 * @param frame - The frame number.
	 * @param state - The compressed snapshot of the game state.
	 */
	push(frame: number, state: Uint8Array) {
		const now = frame * this.frameInterval; // Use frame-based timestamp
		this.buffer.push({ timestamp: now, frame, state });
		// Remove old frames outside window
		const cutoff = now - this.windowMs;
		while (this.buffer.length > this.maxFrames || (this.buffer.length && this.buffer[0].timestamp < cutoff)) {
			this.buffer.shift();
		}
		this.currentIdx = -1;
	}

	/**
	 * Checks if rewinding is possible.
	 * @returns `true` if rewinding is possible, otherwise `false`.
	 */
	canRewind(): boolean {
		return this.buffer.length > 1 && (this.currentIdx < this.buffer.length - 1);
	}

	/**
	 * Checks if fast-forwarding is possible.
	 * @returns `true` if fast-forwarding is possible, otherwise `false`.
	 */
	canForward(): boolean {
		return this.currentIdx > 0;
	}

	/**
	 * Rewinds to the previous frame in the buffer.
	 * @returns The `RewindFrame` object of the previous frame, or `null` if rewinding is not possible.
	 */
	rewind(): RewindFrame | null {
		if (!this.canRewind()) return null;
		if (this.currentIdx === -1) this.currentIdx = this.buffer.length - 1;
		if (this.currentIdx < this.buffer.length - 1) this.currentIdx++;
		return this.buffer[this.buffer.length - 1 - this.currentIdx];
	}

	/**
	 * Fast-forwards to the next frame in the buffer.
	 * @returns The `RewindFrame` object of the next frame, or `null` if fast-forwarding is not possible.
	 */
	forward(): RewindFrame | null {
		if (!this.canForward()) return null;
		this.currentIdx--;
		return this.buffer[this.buffer.length - 1 - this.currentIdx];
	}

	/**
	 * Jumps to a specific frame in the buffer by index.
	 * @param idx - The index of the frame to jump to.
	 * @returns The `RewindFrame` object of the specified frame, or `null` if the index is invalid.
	 */
	jumpTo(idx: number): RewindFrame | null {
		if (idx < 0 || idx >= this.buffer.length) return null;
		this.currentIdx = this.buffer.length - 1 - idx;
		return this.buffer[idx];
	}

	/**
	 * Gets the current frame in the buffer.
	 * @returns The `RewindFrame` object of the current frame, or `null` if the buffer is empty.
	 */
	getCurrent(): RewindFrame | null {
		if (this.currentIdx === -1) return this.buffer[this.buffer.length - 1];
		return this.buffer[this.buffer.length - 1 - this.currentIdx];
	}

	/**
	 * Retrieves all frames currently stored in the buffer.
	 * @returns An array of `RewindFrame` objects.
	 */
	getFrames(): RewindFrame[] {
		return this.buffer.slice();
	}

	/**
	 * Resets the rewind buffer, clearing the current index.
	 */
	reset() {
		this.currentIdx = -1;
	}

	/**
	 * Gets the current index of the rewind buffer.
	 * @returns The current index, or `-1` if pointing to the latest frame.
	 */
	public getCurrentIdx(): number { return this.currentIdx; }
}
