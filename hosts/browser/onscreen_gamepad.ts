import type { GamepadDevice, InputEventSink } from '../common/input/contracts';
import type { HostClock } from '../common/clock';
import { GAMEPAD_BUTTON_IDS } from '../common/input/gamepad_buttons';

export interface OnscreenActionGeometry {
	x: number;
	y: number;
	radius: number;
	buttons: number;
}

export interface OnscreenDirectionGeometry {
	x: number;
	y: number;
	halfWidth: number;
	halfHeight: number;
	buttons: number;
}

/** CSS-client geometry produced once by the control view's layout owner. */
export interface OnscreenGamepadGeometry {
	padX: number;
	padY: number;
	padRadius: number;
	directions: readonly OnscreenDirectionGeometry[];
	actions: readonly OnscreenActionGeometry[];
}

/** Contact-owned virtual device. Native routing and presentation have separate owners. */
export class BrowserOnscreenGamepad implements GamepadDevice {
	public static readonly GAMEPAD_INDEX = 0x7ffffffe;
	public readonly id = `gamepad:${BrowserOnscreenGamepad.GAMEPAD_INDEX}`;
	public readonly kind = 'gamepad';
	public readonly gamepadIndex = BrowserOnscreenGamepad.GAMEPAD_INDEX;
	public readonly label = 'TOUCH';
	public readonly vibrationInitialization = null;
	public readonly supportsVibration: boolean;

	private geometry: OnscreenGamepadGeometry;
	private sink: InputEventSink;
	private viewListener: (() => void) | null = null;
	private readonly contactIds: number[] = [];
	private readonly contactX: number[] = [];
	private readonly contactY: number[] = [];
	private readonly contactHalfWidths: number[] = [];
	private readonly contactHalfHeights: number[] = [];
	private readonly contactActive: boolean[] = [];
	private readonly contactContributions: number[] = [];
	private contactCount = 0;
	private readonly buttonCounts = new Uint32Array(GAMEPAD_BUTTON_IDS.length);
	private readonly pressIds = new Float64Array(GAMEPAD_BUTTON_IDS.length);
	private nextPressId = 1;
	private activeButtons = 0;

	public constructor(
		private readonly clock: HostClock,
		private readonly vibrate: ((durationMs: number) => void) | null = null,
	) {
		this.supportsVibration = vibrate !== null;
	}

	public get buttons(): number { return this.activeButtons; }

	public setGeometry(geometry: OnscreenGamepadGeometry): void {
		const previousButtons = this.activeButtons;
		this.geometry = geometry;
		for (let index = 0; index < this.contactCount; index += 1) {
			this.setContribution(index, this.contactActive[index]
				? this.contactButtons(this.contactX[index], this.contactY[index], this.contactHalfWidths[index], this.contactHalfHeights[index])
				: 0);
		}
		// Replacing geometry is one model update, not intermediate per-contact edges.
		this.publishChanges(previousButtons);
	}

	public setVibration(durationMs: number, intensity: number): void {
		this.vibrate?.(durationMs * intensity);
	}

	public subscribe(sink: InputEventSink): () => void {
		this.sink = sink;
		return () => {
			this.cancelContacts();
			this.sink = null;
		};
	}

	/** A view observes numerical state; it owns its own render scheduling. */
	public subscribeView(listener: () => void): () => void {
		this.viewListener = listener;
		return () => { this.viewListener = null; };
	}

	/** Acquire the controller route, including the pad's neutral center. */
	public beginContact(id: number, x: number, y: number, halfWidth: number, halfHeight: number, active: boolean): boolean {
		const buttons = this.contactButtons(x, y, halfWidth, halfHeight);
		if (buttons === 0) {
			const geometry = this.geometry;
			const dx = Math.max(Math.abs(x - geometry.padX) - halfWidth, 0);
			const dy = Math.max(Math.abs(y - geometry.padY) - halfHeight, 0);
			if (dx * dx + dy * dy > geometry.padRadius * geometry.padRadius) return false;
		}
		const previousButtons = this.activeButtons;
		const index = this.contactCount++;
		// Retain the high-water storage; ending a contact does not truncate these arrays.
		this.contactIds[index] = id;
		this.contactX[index] = x;
		this.contactY[index] = y;
		this.contactHalfWidths[index] = halfWidth;
		this.contactHalfHeights[index] = halfHeight;
		this.contactActive[index] = active;
		this.contactContributions[index] = 0;
		this.setContribution(index, active ? buttons : 0);
		this.publishChanges(previousButtons);
		return true;
	}

	/** Native hover routing queries ownership without mutating a retained controller lease. */
	public ownsContact(id: number): boolean {
		return this.contactIndex(id) >= 0;
	}

	public moveContact(id: number, x: number, y: number, halfWidth: number, halfHeight: number, active: boolean): boolean {
		const index = this.contactIndex(id);
		if (index < 0) return false;
		if (this.contactX[index] === x && this.contactY[index] === y
			&& this.contactHalfWidths[index] === halfWidth && this.contactHalfHeights[index] === halfHeight
			&& this.contactActive[index] === active) return true;
		const previousButtons = this.activeButtons;
		this.contactX[index] = x;
		this.contactY[index] = y;
		this.contactHalfWidths[index] = halfWidth;
		this.contactHalfHeights[index] = halfHeight;
		this.contactActive[index] = active;
		this.setContribution(index, active ? this.contactButtons(x, y, halfWidth, halfHeight) : 0);
		this.publishChanges(previousButtons);
		return true;
	}

	public endContact(id: number): boolean {
		const index = this.contactIndex(id);
		if (index < 0) return false;
		const previousButtons = this.activeButtons;
		this.setContribution(index, 0);
		const last = --this.contactCount;
		if (index !== last) {
			this.contactIds[index] = this.contactIds[last];
			this.contactX[index] = this.contactX[last];
			this.contactY[index] = this.contactY[last];
			this.contactHalfWidths[index] = this.contactHalfWidths[last];
			this.contactHalfHeights[index] = this.contactHalfHeights[last];
			this.contactActive[index] = this.contactActive[last];
			this.contactContributions[index] = this.contactContributions[last];
		}
		this.publishChanges(previousButtons);
		return true;
	}

	public cancelContacts(): void {
		const previousButtons = this.activeButtons;
		this.contactCount = 0;
		this.buttonCounts.fill(0);
		this.activeButtons = 0;
		this.publishChanges(previousButtons);
	}

	/** A contact envelope may press every intersecting virtual button. */
	private contactButtons(x: number, y: number, halfWidth: number, halfHeight: number): number {
		const geometry = this.geometry;
		let buttons = 0;
		for (let index = 0; index < geometry.actions.length; index += 1) {
			const action = geometry.actions[index];
			const dx = Math.max(Math.abs(x - action.x) - halfWidth, 0);
			const dy = Math.max(Math.abs(y - action.y) - halfHeight, 0);
			if (dx * dx + dy * dy <= action.radius * action.radius) buttons |= action.buttons;
		}
		for (let index = 0; index < geometry.directions.length; index += 1) {
			const direction = geometry.directions[index];
			if (Math.abs(x - direction.x) <= halfWidth + direction.halfWidth
				&& Math.abs(y - direction.y) <= halfHeight + direction.halfHeight) {
				buttons |= direction.buttons;
			}
		}
		return buttons;
	}

	private contactIndex(id: number): number {
		for (let index = 0; index < this.contactCount; index += 1) {
			if (this.contactIds[index] === id) return index;
		}
		return -1;
	}

	private setContribution(index: number, buttons: number): void {
		const previous = this.contactContributions[index];
		const changed = previous ^ buttons;
		if (changed === 0) return;
		this.contactContributions[index] = buttons;
		for (let bit = 0; bit < GAMEPAD_BUTTON_IDS.length; bit += 1) {
			const mask = 1 << bit;
			if ((changed & mask) === 0) continue;
			if ((buttons & mask) !== 0) {
				this.buttonCounts[bit] += 1;
				if (this.buttonCounts[bit] === 1) this.activeButtons = (this.activeButtons | mask) >>> 0;
			} else {
				this.buttonCounts[bit] -= 1;
				if (this.buttonCounts[bit] === 0) this.activeButtons = (this.activeButtons & ~mask) >>> 0;
			}
		}
	}

	private publishChanges(previousButtons: number): void {
		const changedButtons = this.activeButtons ^ previousButtons;
		if (changedButtons === 0) return;
		const time = this.clock.now();
		for (let bit = 0; bit < GAMEPAD_BUTTON_IDS.length; bit += 1) {
			const mask = 1 << bit;
			if ((changedButtons & mask) === 0) continue;
			const down = (this.activeButtons & mask) !== 0;
			if (down) this.pressIds[bit] = this.nextPressId++;
			this.sink.inputButton(this.id, GAMEPAD_BUTTON_IDS[bit], down, down ? 1 : 0, time, this.pressIds[bit]);
		}
		this.viewListener?.();
	}
}
