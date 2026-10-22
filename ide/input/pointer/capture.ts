import { PointerButton } from '../../../hosts/common/input/pointer_event';
import type { PointerSnapshot } from '../../common/models';
import type { GuestInputBinding } from '../focus';

export type PointerCaptureScope = symbol;
export const WORKBENCH_POINTER_SCOPE: PointerCaptureScope = Symbol('workbench');

export interface PointerCaptureTarget {
	handleCapturedPointer(snapshot: PointerSnapshot, now: number): void;
	releaseCapturedPointer(snapshot: PointerSnapshot, now: number): void;
	cancelPointer(): void;
}

/** One control receives the rest of a physical gesture, ahead of ordinary hit testing. */
export class PointerCaptureService {
	private target: PointerCaptureTarget | null = null;
	private button = PointerButton.Primary;
	private scope = WORKBENCH_POINTER_SCOPE;
	private route: PointerCaptureScope | undefined;
	private routeButtons = 0;
	private drain = false;
	private guest: GuestInputBinding | undefined;

	public get active(): boolean { return this.target !== null; }
	public get routeScope(): PointerCaptureScope | undefined { return this.route; }
	public get draining(): boolean { return this.drain; }
	public get guestBinding(): GuestInputBinding | undefined { return this.guest; }

	/** The first physical down owns the surface route, independently of a control's drag. */
	public beginRoute(scope: PointerCaptureScope, snapshot: PointerSnapshot): void {
		this.routeButtons = snapshot.pressedButtons;
		if (!this.drain && this.route === undefined && snapshot.justPressedButtons !== 0) this.route = scope;
	}

	public endRoute(snapshot: PointerSnapshot): void {
		this.routeButtons = snapshot.pressedButtons;
		if (snapshot.pressedButtons === 0) { this.route = undefined; this.guest = undefined; }
	}

	public captureGuest(binding: GuestInputBinding): void { this.guest = binding; }

	/** Releasing keyboard focus does not end a pointer hold; retiring its viewport does. */
	public cancelGuest(binding: GuestInputBinding): void {
		if (this.guest === binding) this.cancel();
	}

	public capture(target: PointerCaptureTarget, button = PointerButton.Primary, scope = this.route ?? WORKBENCH_POINTER_SCOPE): void {
		const previous = this.target;
		this.target = null;
		if (previous !== null) previous.cancelPointer();
		this.target = target;
		this.button = button;
		this.scope = scope;
	}

	public release(target: PointerCaptureTarget): void {
		if (this.target === target) this.target = null;
	}

	public cancel(): void {
		const target = this.target;
		this.target = null;
		if (this.route !== undefined && this.routeButtons !== 0) this.drain = true;
		this.route = undefined;
		this.guest?.recipient.pointerContribution.cancel();
		this.guest = undefined;
		if (target !== null) target.cancelPointer();
	}

	/** Admission changes carry the producer's current hold, even before any UI route exists. */
	public interrupt(buttonsDown: boolean): void {
		this.cancel();
		this.drain = buttonsDown;
	}

	/** Retiring one surface cannot cancel a sibling window's gesture. */
	public cancelScope(scope: PointerCaptureScope): void {
		if (this.route === scope || this.target !== null && this.scope === scope) this.cancel();
	}

	public cancelButtons(buttons: number): void {
		if ((buttons & (this.route === undefined ? this.button : this.routeButtons)) !== 0) this.cancel();
	}

	/** Blocking ends capture; it never postpones a drag until the popup closes. */
	public dispatch(snapshot: PointerSnapshot, blocked: boolean, now: number, scope = WORKBENCH_POINTER_SCOPE): boolean {
		this.routeButtons = snapshot.pressedButtons;
		if (this.drain) {
			if (snapshot.pressedButtons === 0) this.drain = false;
			return true;
		}
		const target = this.target;
		if (target === null) return false;
		if (blocked || this.scope !== scope || !snapshot.valid) {
			this.cancel();
			return this.drain;
		}
		if ((snapshot.justReleasedButtons & this.button) !== 0) {
			this.target = null;
			if (snapshot.pressedButtons === 0) this.route = undefined;
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
