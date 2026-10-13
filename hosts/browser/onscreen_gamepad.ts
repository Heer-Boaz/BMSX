import type { GamepadDevice, InputEventSink } from '../common/input/contracts';
import type { HostClock } from '../common/clock';
import { GAMEPAD_BUTTON_IDS } from '../common/input/gamepad_buttons';
import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import { contactIntersectsCircle, contactIntersectsRoundedCircularArc, pointDistanceToRoundedCircularArc,
	type RoundedCircularArc } from './touch_geometry';

// Directional capture and live, nonexclusive button hits are distinct purposes:
// https://github.com/hrydgard/ppsspp/blob/dd6bd1a53d38773c1d07985fcb7d2f56fcaa872c/UI/GamepadEmu.cpp#L133-L454
const enum ContactPurpose { Pad, Buttons, SuppressedPad }
const DIAGONAL_SLOPE = Math.SQRT2 - 1;

export type OnscreenDirectionalMode = 'dpad' | 'stick';

export interface OnscreenActionGeometry {
	x: number;
	y: number;
	/** Exact for a circle; circumbound metadata when an outline is present. */
	radius: number;
	buttons: number;
	/** Absence identifies a circular control; shoulders supply their actual curved arc. */
	outline?: RoundedCircularArc;
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
	private padMode: OnscreenDirectionalMode = 'dpad';
	private stickContactIndex = -1;
	private tipX = 0;
	private tipY = 0;
	private tipActive = false;
	private publishedTipX = 0;
	private publishedTipY = 0;
	private publishedTipActive = false;

	public constructor(
		private readonly clock: HostClock,
		private readonly vibrate: ((durationMs: number) => void) | null = null,
	) {
		this.supportsVibration = vibrate !== null;
	}

	public get buttons(): number { return this.activeButtons; }
	public get geometryRevision(): number { return this.geometryVersion; }
	public get directionalMode(): OnscreenDirectionalMode { return this.padMode; }
	public get stickX(): number { return this.tipX; }
	public get stickY(): number { return this.tipY; }
	public get stickActive(): boolean { return this.tipActive; }

	/** Replacing a physical directional unit requires a fresh down, not a reinterpretation of held fingers. */
	public setDirectionalMode(mode: OnscreenDirectionalMode): void {
		if (mode === this.padMode) return;
		const previousButtons = this.activeButtons;
		this.padMode = mode;
		for (let index = 0; index < this.contactCount; index += 1) {
			if (this.contactPurposes[index] !== ContactPurpose.Pad) continue;
			this.setContribution(index, 0);
			this.contactPurposes[index] = ContactPurpose.SuppressedPad;
		}
		this.stickContactIndex = -1;
		this.tipX = 0;
		this.tipY = 0;
		this.tipActive = false;
		this.publishChanges(previousButtons, true);
	}

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
		if (this.stickContactIndex >= 0) this.updateStick(this.stickContactIndex);
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
				? contactIntersectsRoundedCircularArc(dx, dy, halfWidth, halfHeight, action.outline)
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
				const distance = action.outline ? pointDistanceToRoundedCircularArc(dx, dy, action.outline)
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
		if (purpose === ContactPurpose.Pad) {
			if (this.padMode === 'dpad') this.setContribution(index, active ? this.padButtons(x, y) : 0);
			else if (this.stickContactIndex < 0) {
				this.stickContactIndex = index;
				this.updateStick(index);
			}
		} else this.setContribution(index, active ? buttons : 0);
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
		if (index === this.stickContactIndex) this.updateStick(index);
		this.publishChanges(previousButtons);
		return true;
	}

	public endContact(id: number): boolean {
		const index = this.contactIndex(id);
		if (index < 0) return false;
		const previousButtons = this.activeButtons;
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
			this.contactPurposes[index] = this.contactPurposes[last];
			this.contactX[index] = this.contactX[last];
			this.contactY[index] = this.contactY[last];
			this.contactHalfWidths[index] = this.contactHalfWidths[last];
			this.contactHalfHeights[index] = this.contactHalfHeights[last];
			this.contactActive[index] = this.contactActive[last];
			this.contactContributions[index] = this.contactContributions[last];
			if (last === this.stickContactIndex) this.stickContactIndex = index;
		}
		this.publishChanges(previousButtons);
		return true;
	}

	public cancelContacts(): void {
		const previousButtons = this.activeButtons;
		this.contactCount = 0;
		this.buttonCounts.fill(0);
		this.activeButtons = 0;
		this.stickContactIndex = -1;
		this.tipX = 0;
		this.tipY = 0;
		this.tipActive = false;
		this.publishChanges(previousButtons);
	}

	private contactButtons(purpose: ContactPurpose, x: number, y: number, halfWidth: number, halfHeight: number): number {
		if (purpose === ContactPurpose.Pad) return this.padMode === 'dpad' ? this.padButtons(x, y) : 0;
		if (purpose === ContactPurpose.SuppressedPad) return 0;
		const actions = this.geometry.actions;
		let buttons = 0;
		for (let index = 0; index < actions.length; index += 1) {
			const action = actions[index];
			if (action.outline
				? contactIntersectsRoundedCircularArc(x - action.x, y - action.y, halfWidth, halfHeight, action.outline)
				: contactIntersectsCircle(x - action.x, y - action.y, halfWidth, halfHeight, action.radius)) buttons |= action.buttons;
		}
		return buttons;
	}

	/**
	 * One retained pointer drives a fixed-base, circular L-stick, including motion outside the artwork.
	 * https://github.com/hrydgard/ppsspp/blob/dd6bd1a53d38773c1d07985fcb7d2f56fcaa872c/UI/GamepadEmu.cpp#L552-L646
	 */
	private updateStick(index: number): void {
		this.tipActive = this.contactActive[index];
		if (!this.tipActive) {
			this.tipX = 0;
			this.tipY = 0;
			return;
		}
		const geometry = this.geometry;
		const dx = this.contactX[index] - geometry.padX;
		const dy = this.contactY[index] - geometry.padY;
		const distanceSquared = dx * dx + dy * dy;
		const neutralRadius = geometry.padNeutralRadius;
		if (distanceSquared <= neutralRadius * neutralRadius) {
			this.tipX = 0;
			this.tipY = 0;
			return;
		}
		const distance = Math.sqrt(distanceSquared);
		const magnitude = Math.min(1, (distance - neutralRadius) / (geometry.padRadius - neutralRadius));
		this.tipX = dx / distance * magnitude;
		this.tipY = dy / distance * magnitude;
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

	private publishChanges(previousButtons: number, modeChanged = false): void {
		const changedButtons = this.activeButtons ^ previousButtons;
		const changedAxes = this.tipX !== this.publishedTipX || this.tipY !== this.publishedTipY;
		if (changedButtons === 0 && !changedAxes && this.tipActive === this.publishedTipActive && !modeChanged) return;
		if (changedButtons !== 0 || changedAxes) {
			const time = this.clock.now();
			if (changedButtons !== 0) {
				for (let bit = 0; bit < GAMEPAD_BUTTON_IDS.length; bit += 1) {
					const mask = 1 << bit;
					if ((changedButtons & mask) === 0) continue;
					const down = (this.activeButtons & mask) !== 0;
					if (down) this.pressIds[bit] = this.nextPressId++;
					this.sink.inputButton(this.id, GAMEPAD_BUTTON_IDS[bit], down, down ? 1 : 0, time, this.pressIds[bit]);
				}
			}
			if (changedAxes) this.sink.inputAxis2(this.id, 'ls', this.tipX, this.tipY, time);
		}
		this.publishedTipX = this.tipX;
		this.publishedTipY = this.tipY;
		this.publishedTipActive = this.tipActive;
		this.viewListener?.();
	}
}
