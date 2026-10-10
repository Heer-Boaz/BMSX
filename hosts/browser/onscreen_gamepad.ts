import type { GamepadDevice, InputEventSink } from '../common/input/contracts';
import type { HostClock } from '../common/clock';
import { GAMEPAD_BUTTON_IDS } from '../common/input/gamepad_buttons';
import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';

export interface OnscreenActionGeometry {
	x: number;
	y: number;
	radius: number;
	buttons: number;
}

/** CSS-client geometry produced once by the control view's layout owner. */
export interface OnscreenGamepadGeometry {
	stickX: number;
	stickY: number;
	stickRadius: number;
	stickDeadzoneRadius: number;
	actions: readonly OnscreenActionGeometry[];
}

const enum ContactControl {
	Action,
	Stick,
	OccupiedStick,
}

const UP = 1 << InputControllerGamepadButtonBit.Up;
const DOWN = 1 << InputControllerGamepadButtonBit.Down;
const LEFT = 1 << InputControllerGamepadButtonBit.Left;
const RIGHT = 1 << InputControllerGamepadButtonBit.Right;
const DIAGONAL_SLOPE = Math.SQRT2 - 1;

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
	private readonly contactControls: ContactControl[] = [];
	private readonly contactAssignments: number[] = [];
	private readonly contactContributions: number[] = [];
	private contactCount = 0;
	private stickContactIndex = -1;
	private readonly buttonCounts = new Uint32Array(GAMEPAD_BUTTON_IDS.length);
	private readonly pressIds = new Float64Array(GAMEPAD_BUTTON_IDS.length);
	private nextPressId = 1;
	private activeButtons = 0;
	private tipX = 0;
	private tipY = 0;
	private tipActive = false;

	public constructor(
		private readonly clock: HostClock,
		private readonly vibrate: ((durationMs: number) => void) | null = null,
	) {
		this.supportsVibration = vibrate !== null;
	}

	public get buttons(): number { return this.activeButtons; }
	public get stickX(): number { return this.tipX; }
	public get stickY(): number { return this.tipY; }
	public get stickActive(): boolean { return this.tipActive; }

	public setGeometry(geometry: OnscreenGamepadGeometry): void {
		this.geometry = geometry;
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

	public beginContact(id: number, x: number, y: number, active: boolean): boolean {
		const geometry = this.geometry;
		let assignment = 0;
		for (let index = 0; index < geometry.actions.length; index += 1) {
			const action = geometry.actions[index];
			const dx = x - action.x;
			const dy = y - action.y;
			if (dx * dx + dy * dy <= action.radius * action.radius) {
				assignment |= action.buttons;
			}
		}
		let control: ContactControl;
		if (assignment !== 0) {
			control = ContactControl.Action;
		} else {
			const dx = x - geometry.stickX;
			const dy = y - geometry.stickY;
			if (dx * dx + dy * dy > geometry.stickRadius * geometry.stickRadius) {
				return false;
			}
			control = this.stickContactIndex < 0 ? ContactControl.Stick : ContactControl.OccupiedStick;
		}
		const previousButtons = this.activeButtons;
		const previousX = this.tipX;
		const previousY = this.tipY;
		const previousActive = this.tipActive;
		const index = this.contactCount++;
		// Retain the high-water storage; ending a contact does not truncate these arrays.
		this.contactIds[index] = id;
		this.contactControls[index] = control;
		this.contactAssignments[index] = assignment;
		this.contactContributions[index] = 0;
		if (control === ContactControl.Stick) {
			this.stickContactIndex = index;
			this.updateStick(index, x, y, active);
		} else if (control === ContactControl.Action) {
			this.setContribution(index, active ? assignment : 0);
		}
		this.publishChanges(previousButtons, previousX, previousY, previousActive);
		return true;
	}

	/** Native hover routing queries ownership without mutating a retained controller lease. */
	public ownsContact(id: number): boolean {
		return this.contactIndex(id) >= 0;
	}

	public moveContact(id: number, x: number, y: number, active: boolean): boolean {
		const index = this.contactIndex(id);
		if (index < 0) return false;
		const previousButtons = this.activeButtons;
		const previousX = this.tipX;
		const previousY = this.tipY;
		const previousActive = this.tipActive;
		const control = this.contactControls[index];
		if (control === ContactControl.Stick) {
			this.updateStick(index, x, y, active);
		} else if (control === ContactControl.Action) {
			this.setContribution(index, active ? this.contactAssignments[index] : 0);
		}
		this.publishChanges(previousButtons, previousX, previousY, previousActive);
		return true;
	}

	public endContact(id: number): boolean {
		const index = this.contactIndex(id);
		if (index < 0) return false;
		const previousButtons = this.activeButtons;
		const previousX = this.tipX;
		const previousY = this.tipY;
		const previousActive = this.tipActive;
		this.setContribution(index, 0);
		if (index === this.stickContactIndex) {
			this.stickContactIndex = -1;
			this.tipX = 0;
			this.tipY = 0;
			this.tipActive = false;
		}
		const last = --this.contactCount;
		if (index !== last) {
			this.contactIds[index] = this.contactIds[last];
			this.contactControls[index] = this.contactControls[last];
			this.contactAssignments[index] = this.contactAssignments[last];
			this.contactContributions[index] = this.contactContributions[last];
			if (last === this.stickContactIndex) this.stickContactIndex = index;
		}
		this.publishChanges(previousButtons, previousX, previousY, previousActive);
		return true;
	}

	public cancelContacts(): void {
		const previousButtons = this.activeButtons;
		const previousX = this.tipX;
		const previousY = this.tipY;
		const previousActive = this.tipActive;
		this.contactCount = 0;
		this.stickContactIndex = -1;
		this.buttonCounts.fill(0);
		this.activeButtons = 0;
		this.tipX = 0;
		this.tipY = 0;
		this.tipActive = false;
		this.publishChanges(previousButtons, previousX, previousY, previousActive);
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

	private updateStick(index: number, x: number, y: number, active: boolean): void {
		this.tipActive = active;
		if (!active) {
			this.tipX = 0;
			this.tipY = 0;
			this.setContribution(index, 0);
			return;
		}
		const geometry = this.geometry;
		const dx = x - geometry.stickX;
		const dy = y - geometry.stickY;
		const distanceSquared = dx * dx + dy * dy;
		let buttons = 0;
		if (distanceSquared > geometry.stickDeadzoneRadius * geometry.stickDeadzoneRadius) {
			const ax = Math.abs(dx);
			const ay = Math.abs(dy);
			if (ax >= ay * DIAGONAL_SLOPE) buttons |= dx < 0 ? LEFT : RIGHT;
			if (ay >= ax * DIAGONAL_SLOPE) buttons |= dy < 0 ? UP : DOWN;
		}
		const radius = geometry.stickRadius;
		const divisor = distanceSquared > radius * radius ? Math.sqrt(distanceSquared) : radius;
		this.tipX = dx / divisor;
		this.tipY = dy / divisor;
		this.setContribution(index, buttons);
	}

	private publishChanges(previousButtons: number, previousX: number, previousY: number, previousActive: boolean): void {
		const changedButtons = this.activeButtons ^ previousButtons;
		if (changedButtons !== 0) {
			const time = this.clock.now();
			for (let bit = 0; bit < GAMEPAD_BUTTON_IDS.length; bit += 1) {
				const mask = 1 << bit;
				if ((changedButtons & mask) === 0) continue;
				const down = (this.activeButtons & mask) !== 0;
				if (down) this.pressIds[bit] = this.nextPressId++;
				this.sink.inputButton(this.id, GAMEPAD_BUTTON_IDS[bit], down, down ? 1 : 0, time, this.pressIds[bit]);
			}
		}
		if (changedButtons !== 0 || this.tipX !== previousX || this.tipY !== previousY || this.tipActive !== previousActive) {
			this.viewListener?.();
		}
	}
}
