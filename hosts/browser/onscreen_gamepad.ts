import type { GamepadDevice, InputEventSink } from '../common/input/contracts';
import type { HostClock } from '../common/clock';
import { GAMEPAD_BUTTON_IDS } from '../common/input/gamepad_buttons';
import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import { contactIntersectsCircle, contactIntersectsHorizontalCapsule, pointDistanceToHorizontalCapsule,
	type HorizontalCapsule } from './touch_geometry';

// Directional capture and live, nonexclusive button hits are distinct purposes:
// https://github.com/hrydgard/ppsspp/blob/dd6bd1a53d38773c1d07985fcb7d2f56fcaa872c/UI/GamepadEmu.cpp#L133-L454
const enum ContactPurpose { Pad, Buttons }
const DIAGONAL_SLOPE = Math.SQRT2 - 1;

export interface OnscreenActionGeometry {
	x: number;
	y: number;
	/** Exact for a circle; circumbound metadata when an outline is present. */
	radius: number;
	buttons: number;
	/** Absence identifies a circular control; shoulders supply their actual capsule. */
	outline?: HorizontalCapsule;
}

/** CSS-client geometry produced once by the control view's layout owner. */
export interface OnscreenGamepadGeometry {
	padX: number;
	padY: number;
	padRadius: number;
	padNeutralRadius: number;
	faceX: number;
	faceY: number;
	faceRadius: number;
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
	private geometryVersion = 0;
	private sink: InputEventSink;
	private viewListener: (() => void) | null = null;
	private readonly contactIds: number[] = [];
	private readonly contactPurposes: ContactPurpose[] = [];
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
	public get geometryRevision(): number { return this.geometryVersion; }

	public setGeometry(geometry: OnscreenGamepadGeometry): void {
		const previousButtons = this.activeButtons;
		this.geometry = geometry;
		this.geometryVersion += 1;
		for (let index = 0; index < this.contactCount; index += 1) {
			this.setContribution(index, this.contactActive[index]
				? this.contactButtons(this.contactPurposes[index], this.contactX[index], this.contactY[index],
					this.contactHalfWidths[index], this.contactHalfHeights[index])
				: 0);
		}
		// Publish the final aggregate, not temporary count changes while resampling.
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

	/** Capture a directional gesture or acquire live buttons, including their neutral face area. */
	public beginContact(id: number, x: number, y: number, halfWidth: number, halfHeight: number, active: boolean): boolean {
		const geometry = this.geometry;
		let buttons = 0;
		for (let index = 0; index < geometry.actions.length; index += 1) {
			const action = geometry.actions[index];
			const dx = x - action.x;
			const dy = y - action.y;
			if (action.outline
				? contactIntersectsHorizontalCapsule(dx, dy, halfWidth, halfHeight, action.outline)
				: contactIntersectsCircle(dx, dy, halfWidth, halfHeight, action.radius)) buttons |= action.buttons;
		}
		const padX = x - geometry.padX;
		const padY = y - geometry.padY;
		const padDistanceSquared = padX * padX + padY * padY;
		let purpose = ContactPurpose.Buttons;
		if (contactIntersectsCircle(padX, padY, halfWidth, halfHeight, geometry.padRadius)) {
			// Only an ambiguous pad/button footprint needs actual surface distances.
			// Circumbounds cannot steal a direct hit or invent a nearest shoulder.
			let directButton = false;
			let nearestButton = Infinity;
			for (let index = 0; index < geometry.actions.length; index += 1) {
				const action = geometry.actions[index];
				if ((buttons & action.buttons) === 0) continue;
				const dx = x - action.x;
				const dy = y - action.y;
				const distance = action.outline ? pointDistanceToHorizontalCapsule(dx, dy, action.outline)
					: Math.max(0, Math.hypot(dx, dy) - action.radius);
				if (distance === 0) {
					directButton = true;
					break;
				}
				nearestButton = Math.min(nearestButton, distance);
			}
			if (!directButton && (padDistanceSquared <= geometry.padRadius * geometry.padRadius
				|| Math.sqrt(padDistanceSquared) - geometry.padRadius <= nearestButton)) purpose = ContactPurpose.Pad;
		} else if (buttons === 0 && !contactIntersectsCircle(x - geometry.faceX, y - geometry.faceY,
			halfWidth, halfHeight, geometry.faceRadius)) {
			return false;
		}
		const previousButtons = this.activeButtons;
		const index = this.contactCount++;
		// Retain the high-water storage; ending a contact does not truncate these arrays.
		this.contactIds[index] = id;
		this.contactPurposes[index] = purpose;
		this.contactX[index] = x;
		this.contactY[index] = y;
		this.contactHalfWidths[index] = halfWidth;
		this.contactHalfHeights[index] = halfHeight;
		this.contactActive[index] = active;
		this.contactContributions[index] = 0;
		this.setContribution(index, active ? purpose === ContactPurpose.Pad ? this.padButtons(x, y) : buttons : 0);
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
		this.setContribution(index, active ? this.contactButtons(this.contactPurposes[index], x, y, halfWidth, halfHeight) : 0);
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
			this.contactPurposes[index] = this.contactPurposes[last];
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

	private contactButtons(purpose: ContactPurpose, x: number, y: number, halfWidth: number, halfHeight: number): number {
		if (purpose === ContactPurpose.Pad) return this.padButtons(x, y);
		const actions = this.geometry.actions;
		let buttons = 0;
		for (let index = 0; index < actions.length; index += 1) {
			const action = actions[index];
			if (action.outline
				? contactIntersectsHorizontalCapsule(x - action.x, y - action.y, halfWidth, halfHeight, action.outline)
				: contactIntersectsCircle(x - action.x, y - action.y, halfWidth, halfHeight, action.radius)) buttons |= action.buttons;
		}
		return buttons;
	}

	private padButtons(x: number, y: number): number {
		const geometry = this.geometry;
		const dx = x - geometry.padX;
		const dy = y - geometry.padY;
		if (dx * dx + dy * dy <= geometry.padNeutralRadius * geometry.padNeutralRadius) return 0;
		const ax = Math.abs(dx);
		const ay = Math.abs(dy);
		// Absolute eight-way regions tile the disc without a drag origin. The
		// footprint acquires the gesture; its center selects the direction, so
		// one broad contact does not invent opposing directional contributions.
		let buttons = 0;
		if (dx !== 0 && ax >= DIAGONAL_SLOPE * ay) {
			buttons |= 1 << (dx > 0 ? InputControllerGamepadButtonBit.Right : InputControllerGamepadButtonBit.Left);
		}
		if (dy !== 0 && ay >= DIAGONAL_SLOPE * ax) {
			buttons |= 1 << (dy > 0 ? InputControllerGamepadButtonBit.Down : InputControllerGamepadButtonBit.Up);
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
