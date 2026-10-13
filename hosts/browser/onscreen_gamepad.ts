import type { GamepadDevice, InputEventSink } from '../common/input/contracts';
import type { HostClock } from '../common/clock';
import { GAMEPAD_BUTTON_IDS } from '../common/input/gamepad_buttons';
import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import { contactIntersectsCircle } from './touch_geometry';

const enum ContactGroup { Miss = -2, Pad = -1 }
const DIAGONAL_SLOPE = Math.SQRT2 - 1;

export interface OnscreenActionGeometry {
	x: number;
	y: number;
	radius: number;
	buttons: number;
}

/** One physical button deck; a contact can press any of its buttons together. */
export interface OnscreenButtonGroupGeometry {
	x: number;
	y: number;
	radius: number;
	actions: readonly OnscreenActionGeometry[];
}

/** CSS-client geometry produced once by the control view's layout owner. */
export interface OnscreenGamepadGeometry {
	padX: number;
	padY: number;
	padRadius: number;
	padNeutralRadius: number;
	buttonGroups: readonly OnscreenButtonGroupGeometry[];
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
	private readonly contactGroups: number[] = [];
	private readonly contactGeometryVersions: number[] = [];
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
		this.geometry = geometry;
		// Layout is not a physical input sample. Held contributions change only
		// on their next native sample or release, never from stale coordinates.
		this.geometryVersion += 1;
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

	/** Acquire a mechanical component, including the neutral pad and face deck. */
	public beginContact(id: number, x: number, y: number, halfWidth: number, halfHeight: number, active: boolean): boolean {
		const group = this.acquireGroup(x, y, halfWidth, halfHeight);
		if (group === ContactGroup.Miss) return false;
		const previousButtons = this.activeButtons;
		const index = this.contactCount++;
		// Retain the high-water storage; ending a contact does not truncate these arrays.
		this.contactIds[index] = id;
		this.contactGroups[index] = group;
		this.contactGeometryVersions[index] = this.geometryVersion;
		this.contactX[index] = x;
		this.contactY[index] = y;
		this.contactHalfWidths[index] = halfWidth;
		this.contactHalfHeights[index] = halfHeight;
		this.contactActive[index] = active;
		this.contactContributions[index] = 0;
		this.setContribution(index, active ? this.contactButtons(group, x, y, halfWidth, halfHeight) : 0);
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
			&& this.contactActive[index] === active && this.contactGeometryVersions[index] === this.geometryVersion) return true;
		const previousButtons = this.activeButtons;
		this.contactX[index] = x;
		this.contactY[index] = y;
		this.contactHalfWidths[index] = halfWidth;
		this.contactHalfHeights[index] = halfHeight;
		this.contactActive[index] = active;
		this.contactGeometryVersions[index] = this.geometryVersion;
		this.setContribution(index, active ? this.contactButtons(this.contactGroups[index], x, y, halfWidth, halfHeight) : 0);
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
			this.contactGroups[index] = this.contactGroups[last];
			this.contactGeometryVersions[index] = this.contactGeometryVersions[last];
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

	private acquireGroup(x: number, y: number, halfWidth: number, halfHeight: number): number {
		const geometry = this.geometry;
		const padX = x - geometry.padX;
		const padY = y - geometry.padY;
		// Visible buttons win over the neutral plastic of another component.
		// The face deck's acquisition envelope can overlap an inner RS edge.
		for (let index = 0; index < geometry.buttonGroups.length; index += 1) {
			const actions = geometry.buttonGroups[index].actions;
			for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
				const action = actions[actionIndex];
				const dx = x - action.x;
				const dy = y - action.y;
				if (dx * dx + dy * dy <= action.radius * action.radius) return index;
			}
		}
		// Direct neutral-body contact still wins over skin-only pickup nearby.
		if (padX * padX + padY * padY <= geometry.padRadius * geometry.padRadius) return ContactGroup.Pad;
		for (let index = 0; index < geometry.buttonGroups.length; index += 1) {
			const group = geometry.buttonGroups[index];
			const dx = x - group.x;
			const dy = y - group.y;
			if (dx * dx + dy * dy <= group.radius * group.radius) return index;
		}
		let selected = ContactGroup.Miss;
		let nearest = Infinity;
		if (contactIntersectsCircle(padX, padY, halfWidth, halfHeight, geometry.padRadius)) {
			selected = ContactGroup.Pad;
			nearest = Math.hypot(padX, padY) - geometry.padRadius;
		}
		for (let index = 0; index < geometry.buttonGroups.length; index += 1) {
			const group = geometry.buttonGroups[index];
			const dx = x - group.x;
			const dy = y - group.y;
			if (!contactIntersectsCircle(dx, dy, halfWidth, halfHeight, group.radius)) continue;
			const distance = Math.hypot(dx, dy) - group.radius;
			if (distance < nearest) {
				selected = index;
				nearest = distance;
			}
		}
		return selected;
	}

	/** Face buttons share skin contact; the rocker is one joined digital control. */
	private contactButtons(groupIndex: number, x: number, y: number, halfWidth: number, halfHeight: number): number {
		if (groupIndex === ContactGroup.Pad) return this.padButtons(x, y);
		const group = this.geometry.buttonGroups[groupIndex];
		let buttons = 0;
		for (let index = 0; index < group.actions.length; index += 1) {
			const action = group.actions[index];
			if (contactIntersectsCircle(x - action.x, y - action.y, halfWidth, halfHeight, action.radius)) buttons |= action.buttons;
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
		// A joined rocker tilts at the contact center; its skin outline cannot
		// depress opposite arms. Overlapping absolute direction regions tile
		// the complete disc, without a moving stick or per-gesture drag origin.
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
