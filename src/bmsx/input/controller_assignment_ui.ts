import { $ } from '../core/game';
import { subscribesToGlobalEvent } from '../core/eventemitter';
import { excludeclassfromsavegame, type RevivableObjectArgs } from '../serializer/gameserializer';
import { WorldObject } from '../core/object/worldobject';
import { SpriteObject } from '../core/object/sprite';
import { build_fsm } from '../fsm/fsmdecorators';
import type { StateMachineBlueprint } from '../fsm/fsmtypes';
import type { State } from '../fsm/state';
import { ZCOORD_MAX } from '../render/backend/webgl/webgl.constants';
import type { Identifier } from '../rompack/rompack';
import { Input } from './input';
import { id_to_space_symbol } from 'bmsx/core/space';

// Branded types (compile-time only)
export type PlayerIndex = number & { readonly __brand: 'PlayerIndex' };
export type GamepadIndex = number & { readonly __brand: 'GamepadIndex' };

export const PlayerIndexNS = {
	from(n: number): PlayerIndex { return n as PlayerIndex; },
	iconAsset(n: number): string {
		if (n >= 1 && n <= Input.PLAYERS_MAX) return `joystick${n}`;
		console.debug(`[ControllerAssignmentUI] Requested icon for invalid player index: ${n}`);
		return 'joystick_none';
	},
};

export class SelectedPlayerIndexIcon extends SpriteObject {
	@build_fsm()
	static bouw(): StateMachineBlueprint {
		return {
			on: {
				animation_end: { do(this: SelectedPlayerIndexIcon) { this.markForDisposal(); } },
			},
			states: {
				_default: {
					on: {
						// Guard transitions so only the icon for the matching gamepad reacts.
						controller_assigned: {
							do(this: SelectedPlayerIndexIcon, _src: any, payload: { gamepadIndex?: number }) {
								if (payload?.gamepadIndex === this.gamepadIndex) return 'assigned'; // this.sc.transition_to('assigned');
								return undefined;
							}
						},
						controller_assignment_cancelled: {
							do(this: SelectedPlayerIndexIcon, _src: any, payload: { gamepadIndex?: number }) {
								if (payload?.gamepadIndex === this.gamepadIndex) return 'cancelled'; // this.sc.transition_to('cancelled');
								return undefined;
							}
						},
					},
				},
				assigned: {
					tape_data: [true, false], repetitions: 5, auto_rewind_tape_after_end: false, ticks2advance_tape: 4,
					tape_next(this: SelectedPlayerIndexIcon, state: State) { this.colorize = state.current_tape_value ? { r: 1, g: 1, b: 1, a: .5 } : { r: 0, g: 1, b: 0, a: .75 }; },
					tape_end(this: SelectedPlayerIndexIcon) { this.sc.dispatch_event('animation_end', this); },
				},
				cancelled: {
					tape_data: [2], repetitions: 16, auto_rewind_tape_after_end: false, ticks2advance_tape: 1,
					entering_state(this: SelectedPlayerIndexIcon) { this.colorize = { r: 1, g: 0, b: 0, a: .75 }; },
					tape_next(this: SelectedPlayerIndexIcon, state: State) { this.y -= state.current_tape_value; },
					tape_end(this: SelectedPlayerIndexIcon) { this.sc.dispatch_event('animation_end', this); },
				},
			},
		};
	}
	public static getIconId(gamepadIndex: number): Identifier { return `joystick_icon_${gamepadIndex ?? 0}`; }
	constructor(public gamepadIndex: number) {
		super({ id: SelectedPlayerIndexIcon.getIconId(gamepadIndex) });
		this.z = ZCOORD_MAX; this.colorize = { r: 1, g: 1, b: 1, a: .75 };
		this.imgid = 'joystick_none';

	}
	public set playerIndex(idx: number | null) { this.imgid = idx == null ? 'joystick_none' : PlayerIndexNS.iconAsset(idx); }

}


@excludeclassfromsavegame
export class ControllerAssignmentUI extends WorldObject {
	private icons = new Map<number, SelectedPlayerIndexIcon>(); // gamepadIndex -> icon

	/**
	 * The starting position of the joystick icon in pixels.
	 */
	private static readonly start = { x: 0, y: 0 };

	/**
	 * The amount of increment in the x-axis for the joystick icon in pixels.
	 */
	private static readonly stepX = 32;
	/**
	 * Calculates the X position of the assignment-icon based on the given position index.
	 * @param positionIndex The index of the position.
	 * @returns The calculated X position of the icon.
	 */
	private calcIconPositionX(positionIndex: number) { return ControllerAssignmentUI.start.x + (ControllerAssignmentUI.stepX * (positionIndex ?? 0)); };

	constructor(opts?: RevivableObjectArgs & { id: Identifier }) {
		super(opts);
		// Initial sync: pending assignments may already exist when UI spawns late.
		const pending = Input.instance.pendingGamepadAssignments ?? [];
		for (const p of pending) {
			const gpIndex = p.inputHandler.gamepadIndex;
			const icon = this.ensureIcon(gpIndex);
			icon.playerIndex = p.proposedPlayerIndex ?? null;
			icon.x = this.calcIconPositionX(gpIndex);
			icon.y = ControllerAssignmentUI.start.y;
			if (gpIndex == null) continue;
			this.ensureIcon(gpIndex);
		}
	}

	private ensureIcon(gpIndex: number): SelectedPlayerIndexIcon {
		let icon = this.icons.get(gpIndex);
		if (!icon) {
			icon = new SelectedPlayerIndexIcon(gpIndex);
			this.icons.set(gpIndex, icon);
			$.world[id_to_space_symbol]['ui'].spawn(icon);
		}
		return icon;
	}

	@subscribesToGlobalEvent('controller_assignment_start', true)
	public startUIAssignmentProcess(gamepadIndex: number, proposedPlayerIndex: number | null): void {
		const icon = this.ensureIcon(gamepadIndex);
		icon.playerIndex = proposedPlayerIndex;
		icon.x = this.calcIconPositionX(gamepadIndex);
		icon.y = ControllerAssignmentUI.start.y;
	}

	// Event: emitted from PendingAssignmentProcessor
	@subscribesToGlobalEvent('controller_assignment_proposed', true)
	onProposed(_source: any, payload: { gamepadIndex: number; proposedPlayerIndex: number | null }) {
		if (!this.icons.has(payload.gamepadIndex)) this.startUIAssignmentProcess(payload.gamepadIndex, payload.proposedPlayerIndex);
		// Update sprite immediately for this device
		const icon = this.icons.get(payload.gamepadIndex);
		if (icon) icon.playerIndex = payload.proposedPlayerIndex;
	}

	@subscribesToGlobalEvent('controller_assigned', true)
	onAssigned(_source: any, payload: { gamepadIndex?: number }) {
		// Icons listen to FSM events declared in their blueprint; no manual dispatch required.
		// Remove only the icon for the given gamepad; it will self-dispose via FSM.
		if (payload?.gamepadIndex != null) this.icons.delete(payload.gamepadIndex);
	}

	@subscribesToGlobalEvent('controller_assignment_cancelled', true)
	onCancelled(_source: any, payload: { gamepadIndex?: number }) {
		// Icons listen to FSM events declared in their blueprint; no manual dispatch required.
		if (payload?.gamepadIndex != null) this.icons.delete(payload.gamepadIndex);
	}
}
