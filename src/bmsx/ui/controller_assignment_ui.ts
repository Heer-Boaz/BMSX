import { $ } from '../core/game';
import { subscribesToGlobalEvent, type EventPayload } from '../core/eventemitter';
import { createGameEvent, type GameEvent } from '../core/game_event';
import { excludeclassfromsavegame, type RevivableObjectArgs } from '../serializer/serializationhooks';
import { WorldObject } from '../core/object/worldobject';
import { SpriteObject } from '../core/object/sprite';
import { build_fsm } from '../fsm/fsmdecorators';
import type { StateMachineBlueprint } from '../fsm/fsmtypes';
import type { State } from '../fsm/state';
import { ZCOORD_MAX } from '../render/backend/webgl/webgl.constants';
import type { Identifier } from '../rompack/rompack';
import { Input } from '../input/input';
import { id_to_space_symbol } from '../core/space';

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
							do(this: SelectedPlayerIndexIcon, _src: any, payload: EventPayload & { gamepadIndex?: number }) {
								const { gamepadIndex } = payload;
								if (gamepadIndex == null) {
									throw new Error('[ControllerAssignmentUI] controller_assigned event missing gamepadIndex.');
								}
								if (gamepadIndex === this.gamepadIndex) return '/assigned';
								return undefined;
							}
						},
						controller_assignment_cancelled: {
							do(this: SelectedPlayerIndexIcon, _src: any, payload: EventPayload & { gamepadIndex?: number }) {
								const { gamepadIndex } = payload;
								if (gamepadIndex == null) {
									throw new Error('[ControllerAssignmentUI] controller_assignment_cancelled event missing gamepadIndex.');
								}
								if (gamepadIndex === this.gamepadIndex) return '/cancelled';
								return undefined;
							}
						},
					},
				},
				assigned: {
					tape_data: [true, false], repetitions: 5, tape_playback_mode: 'once', ticks2advance_tape: 4,
					tape_next(this: SelectedPlayerIndexIcon, state: State) { this.colorize = state.current_tape_value ? { r: 1, g: 1, b: 1, a: .5 } : { r: 0, g: 1, b: 0, a: .75 }; },
					tape_end(this: SelectedPlayerIndexIcon) {
						const event = createGameEvent({ type: 'animation_end', emitter: this });
						this.sc.dispatch_event(event);
					},
				},
				cancelled: {
					tape_data: [2], repetitions: 16, tape_playback_mode: 'once', ticks2advance_tape: 1,
					entering_state(this: SelectedPlayerIndexIcon) { this.colorize = { r: 1, g: 0, b: 0, a: .75 }; },
					tape_next(this: SelectedPlayerIndexIcon, state: State) { this.y -= state.current_tape_value; },
					tape_end(this: SelectedPlayerIndexIcon) {
						const event = createGameEvent({ type: 'animation_end', emitter: this });
						this.sc.dispatch_event(event);
					},
				},
			},
		};
	}
	public static getIconId(gamepadIndex: number): Identifier {
		if (!Number.isInteger(gamepadIndex)) {
			throw new Error(`[ControllerAssignmentUI] Invalid gamepad index '${gamepadIndex}' when generating icon id.`);
		}
		return `joystick_icon_${gamepadIndex}`;
	}
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
	private calcIconPositionX(positionIndex: number) {
		if (!Number.isFinite(positionIndex)) {
			throw new Error(`[ControllerAssignmentUI] Position index '${positionIndex}' is not finite.`);
		}
		return ControllerAssignmentUI.start.x + (ControllerAssignmentUI.stepX * positionIndex);
	};

	constructor(opts?: RevivableObjectArgs & { id: Identifier }) {
		super(opts);
		// Initial sync: pending assignments may already exist when UI spawns late.
		const pending = Input.instance.pendingGamepadAssignments;
		if (!Array.isArray(pending)) {
			throw new Error('[ControllerAssignmentUI] Pending gamepad assignments not initialised.');
		}
		for (const p of pending) {
			const gpIndex = p.inputHandler.gamepadIndex;
			if (!Number.isInteger(gpIndex)) {
				throw new Error(`[ControllerAssignmentUI] Pending assignment has invalid gamepad index '${gpIndex}'.`);
			}
			const icon = this.ensureIcon(gpIndex);
			icon.playerIndex = p.proposedPlayerIndex ?? null;
			icon.x = this.calcIconPositionX(gpIndex);
			icon.y = ControllerAssignmentUI.start.y;
		}
	}

	private ensureIcon(gpIndex: number): SelectedPlayerIndexIcon {
		if (!Number.isInteger(gpIndex)) {
			throw new Error(`[ControllerAssignmentUI] Attempted to create icon with invalid gamepad index '${gpIndex}'.`);
		}
		let icon = this.icons.get(gpIndex);
		if (!icon) {
			icon = new SelectedPlayerIndexIcon(gpIndex);
			this.icons.set(gpIndex, icon);
			$.world[id_to_space_symbol]['ui'].spawn(icon);
		}
		return icon;
	}

	@subscribesToGlobalEvent('controller_assignment_start', true)
	public startUIAssignmentProcess(event: GameEvent): void {
		const detail = event as GameEvent<'controller_assignment_start', { gamepadIndex: number; proposedPlayerIndex: number | null }>;
		const icon = this.ensureIcon(detail.gamepadIndex);
		icon.playerIndex = detail.proposedPlayerIndex;
		icon.x = this.calcIconPositionX(detail.gamepadIndex);
		icon.y = ControllerAssignmentUI.start.y;
	}

	// Event: emitted from PendingAssignmentProcessor
	@subscribesToGlobalEvent('controller_assignment_proposed', true)
	onProposed(event: GameEvent) {
		const detail = event as GameEvent<'controller_assignment_proposed', { gamepadIndex: number; proposedPlayerIndex: number | null }>;
		if (!this.icons.has(detail.gamepadIndex)) this.startUIAssignmentProcess(event);
		// Update sprite immediately for this device
		const icon = this.icons.get(detail.gamepadIndex);
		if (icon) icon.playerIndex = detail.proposedPlayerIndex;
	}

	@subscribesToGlobalEvent('controller_assigned', true)
	onAssigned(event: GameEvent) {
		const detail = event as GameEvent<'controller_assigned', { gamepadIndex: number }>;
		const { gamepadIndex } = detail;
		if (gamepadIndex == null) {
			throw new Error('[ControllerAssignmentUI] controller_assigned event missing gamepadIndex.');
		}
		this.icons.delete(gamepadIndex);
	}

	@subscribesToGlobalEvent('controller_assignment_cancelled', true)
	onCancelled(event: GameEvent) {
		const detail = event as GameEvent<'controller_assignment_cancelled', { gamepadIndex: number | undefined }>;
		const { gamepadIndex } = detail;
		if (gamepadIndex == null) {
			throw new Error('[ControllerAssignmentUI] controller_assignment_cancelled event missing gamepadIndex.');
		}
		this.icons.delete(gamepadIndex);
	}
}
