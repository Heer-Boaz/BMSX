export interface PointerHoverTarget {
	onPointerEnter?(): void;
	onPointerLeave(): void;
}

/** Routed hits, not focus or capture, determine the current hover path. */
export class PointerHoverService {
	private readonly targets = new Map<PointerHoverTarget, number>();
	private dispatchId = 0;
	private readonly leaveUnvisited = (dispatchId: number, target: PointerHoverTarget): void => {
		if (dispatchId !== this.dispatchId) this.release(target);
	};
	private readonly leaveTarget = (_dispatchId: number, target: PointerHoverTarget): void => this.release(target);

	public beginDispatch(): void { this.dispatchId += 1; }

	/** Called by a control only after the normal input route accepts its hit. */
	public visit(target: PointerHoverTarget): void {
		const entered = !this.targets.has(target);
		this.targets.set(target, this.dispatchId);
		if (entered) target.onPointerEnter?.();
	}

	public endDispatch(): void { this.targets.forEach(this.leaveUnvisited); }

	/** Detach/hide revokes hover immediately, without waiting for another poll. */
	public release(target: PointerHoverTarget): void {
		if (this.targets.delete(target)) target.onPointerLeave();
	}

	public clear(): void { this.targets.forEach(this.leaveTarget); }
}

export const pointerHover = new PointerHoverService();
