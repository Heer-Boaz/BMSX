import { KeyModifier } from '../../../hosts/common/input/text';
import type { PointerCaptureScope } from './capture';

export interface PointerHoverTarget {
	onPointerEnter?(): void;
	onPointerModifiersChanged?(modifiers: KeyModifier): void;
	onPointerLeave(): void;
}

/** Routed hits, not focus or capture, determine the current hover path. */
export class PointerHoverService {
	private readonly targets = new Map<PointerHoverTarget, number>();
	private dispatchId = 0;
	private routeScope: PointerCaptureScope | undefined;
	private modifiers = KeyModifier.none;
	private readonly updateModifiers = (_dispatchId: number, target: PointerHoverTarget): void => {
		target.onPointerModifiersChanged?.(this.modifiers);
	};
	private readonly leaveUnvisited = (dispatchId: number, target: PointerHoverTarget): void => {
		if (dispatchId !== this.dispatchId) this.release(target);
	};
	private readonly leaveTarget = (_dispatchId: number, target: PointerHoverTarget): void => this.release(target);

	public has(target: PointerHoverTarget): boolean { return this.targets.has(target); }

	public beginDispatch(scope?: PointerCaptureScope): void {
		this.dispatchId += 1;
		this.routeScope = scope;
	}

	/** Presentation changes revoke only a hover path that no longer owns the physical hit. */
	public reconcileRoute(scope: PointerCaptureScope | undefined): void {
		if (this.routeScope === undefined || this.routeScope !== scope) this.clear();
	}

	/** Called by a control only after the normal input route accepts its hit. */
	public visit(target: PointerHoverTarget): void {
		const entered = !this.targets.has(target);
		this.targets.set(target, this.dispatchId);
		if (entered) target.onPointerEnter?.();
	}

	public endDispatch(): void { this.targets.forEach(this.leaveUnvisited); }

	/** Keyboard modifiers update the admitted hover path even while the pointer is stationary. */
	public dispatchModifiers(modifiers: KeyModifier): void {
		this.modifiers = modifiers;
		this.targets.forEach(this.updateModifiers);
	}

	/** Detach/hide revokes hover immediately, without waiting for another poll. */
	public release(target: PointerHoverTarget): void {
		if (this.targets.delete(target)) target.onPointerLeave();
	}

	public clear(): void {
		this.routeScope = undefined;
		this.targets.forEach(this.leaveTarget);
	}
}

export const pointerHover = new PointerHoverService();
