import { $ } from '../core/game';
import { EventEmitter, type EventPayload } from '../core/eventemitter';
import { create_gameevent, type GameEvent } from '../core/game_event';
import { excludeclassfromsavegame, type RevivableObjectArgs } from '../serializer/serializationhooks';
import { WorldObject } from '../core/object/worldobject';
import { SpriteObject } from '../core/object/sprite';
import { build_fsm } from '../fsm/fsmdecorators';
import type { StateMachineBlueprint } from '../fsm/fsmtypes';
import type { State } from '../fsm/state';
import { ZCOORD_MAX } from '../render/backend/webgl/webgl.constants';
import type { Identifier } from '../rompack/rompack';
import { Input } from '../input/input';
import type { TimelineEndEventPayload, TimelineFrameEventPayload } from '../component/timeline_component';
import { Timeline } from '../timeline/timeline';

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
	private static readonly TIMELINE_IDS = {
		assigned: 'controller-assignment.assigned',
		cancelled: 'controller-assignment.cancelled',
	};
	@build_fsm()
	static bouw(): StateMachineBlueprint {
		const ASSIGNED_TIMELINE_ID = SelectedPlayerIndexIcon.TIMELINE_IDS.assigned;
		const CANCELLED_TIMELINE_ID = SelectedPlayerIndexIcon.TIMELINE_IDS.cancelled;
		return {
			on: {
				animation_end: { do(this: SelectedPlayerIndexIcon) { this.mark_for_disposal(); } },
			},
			states: {
				_default: {
					on: {
						// Guard transitions so only the icon for the matching gamepad reacts.
						controller_assigned: {
							do(this: SelectedPlayerIndexIcon, _src: any, payload: EventPayload & { gamepadIndex?: number }) {
								return payload.gamepadIndex === this.gamepadIndex ? '/assigned' : undefined;
							}
						},
						controller_assignment_cancelled: {
							do(this: SelectedPlayerIndexIcon, _src: any, payload: EventPayload & { gamepadIndex?: number }) {
								return payload.gamepadIndex === this.gamepadIndex ? '/cancelled' : undefined;
							}
						},
					},
				},
				assigned: {
					entering_state(this: SelectedPlayerIndexIcon) {
						this.timelines.play(ASSIGNED_TIMELINE_ID, { rewind: true, snap_to_start: true });
					},
				on: {
					[`timeline.frame.${ASSIGNED_TIMELINE_ID}`]: {
						do(this: SelectedPlayerIndexIcon, _state: State, event: GameEvent<'timeline.frame.assigned', TimelineFrameEventPayload>) {
							const visible = event.frame_value === true;
							this.colorize = visible ? { r: 1, g: 1, b: 1, a: .5 } : { r: 0, g: 1, b: 0, a: .75 };
						},
					},
					[`timeline.end.${ASSIGNED_TIMELINE_ID}`]: {
						do(this: SelectedPlayerIndexIcon, _state: State, _event: GameEvent<'timeline.end.assigned', TimelineEndEventPayload>) {
							this.notifyAnimationEnd();
						},
					},
					},
				},
				cancelled: {
					entering_state(this: SelectedPlayerIndexIcon) {
						this.colorize = { r: 1, g: 0, b: 0, a: .75 };
						this.timelines.play(CANCELLED_TIMELINE_ID, { rewind: true, snap_to_start: true });
					},
						on: {
							[`timeline.frame.${CANCELLED_TIMELINE_ID}`]: {
								do(this: SelectedPlayerIndexIcon, _state: State, event: GameEvent<'timeline.frame.cancelled', TimelineFrameEventPayload<number>>) {
								this.y -= event.frame_value;
							},
						},
						[`timeline.end.${CANCELLED_TIMELINE_ID}`]: {
							do(this: SelectedPlayerIndexIcon, _state: State, _event: GameEvent<'timeline.end.cancelled', TimelineEndEventPayload>) {
							this.notifyAnimationEnd();
						},
					},
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
		this.timelines.define(new Timeline({
			id: SelectedPlayerIndexIcon.TIMELINE_IDS.assigned,
			frames: [true, false],
			repetitions: 5,
			playback_mode: 'once',
			ticks_per_frame: 4,
		}));
		this.timelines.define(new Timeline({
			id: SelectedPlayerIndexIcon.TIMELINE_IDS.cancelled,
			frames: [2],
			repetitions: 16,
			playback_mode: 'once',
			ticks_per_frame: 1,
		}));
		this.z = ZCOORD_MAX; this.colorize = { r: 1, g: 1, b: 1, a: .75 };
		this.imgid = 'joystick_none';

	}

	private notifyAnimationEnd(): void {
		const event = create_gameevent({ type: 'animation_end', emitter: this });
		this.sc.dispatch_event(event);
	}
	public set playerIndex(idx: number) { this.imgid = idx == null ? 'joystick_none' : PlayerIndexNS.iconAsset(idx); }

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
		this.bindGlobalEvents();
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
			icon.playerIndex = p.proposedPlayerIndex ;
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
			const uiSpace = $.world.getSpace('ui');
			if (!uiSpace) throw new Error('[ControllerAssignmentUI] UI space not found while spawning icon.');
			uiSpace.spawn(icon);
		}
		return icon;
	}

	public startUIAssignmentProcess(event: GameEvent): void {
		const detail = event as GameEvent<'controller_assignment_start', { gamepadIndex: number; proposedPlayerIndex: number }>;
		const icon = this.ensureIcon(detail.gamepadIndex);
		icon.playerIndex = detail.proposedPlayerIndex;
		icon.x = this.calcIconPositionX(detail.gamepadIndex);
		icon.y = ControllerAssignmentUI.start.y;
	}

	onProposed(event: GameEvent) {
		const detail = event as GameEvent<'controller_assignment_proposed', { gamepadIndex: number; proposedPlayerIndex: number }>;
		if (!this.icons.has(detail.gamepadIndex)) this.startUIAssignmentProcess(event);
		// Update sprite immediately for this device
		const icon = this.icons.get(detail.gamepadIndex);
		if (icon) icon.playerIndex = detail.proposedPlayerIndex;
	}

	onAssigned(event: GameEvent) {
		const detail = event as GameEvent<'controller_assigned', { gamepadIndex: number }>;
		const { gamepadIndex } = detail;
		if (gamepadIndex == null) {
			throw new Error('[ControllerAssignmentUI] controller_assigned event missing gamepadIndex.');
		}
		this.icons.delete(gamepadIndex);
	}

	onCancelled(event: GameEvent) {
		const detail = event as GameEvent<'controller_assignment_cancelled', { gamepadIndex: number }>;
		const { gamepadIndex } = detail;
		if (gamepadIndex == null) {
			throw new Error('[ControllerAssignmentUI] controller_assignment_cancelled event missing gamepadIndex.');
		}
		this.icons.delete(gamepadIndex);
	}

	private bindGlobalEvents(): void {
		const bus = EventEmitter.instance;
		bus.on({ event_name: 'controller_assignment_start', handler: this.startUIAssignmentProcess, subscriber: this, persistent: true });
		bus.on({ event_name: 'controller_assignment_proposed', handler: this.onProposed, subscriber: this, persistent: true });
		bus.on({ event_name: 'controller_assigned', handler: this.onAssigned, subscriber: this, persistent: true });
		bus.on({ event_name: 'controller_assignment_cancelled', handler: this.onCancelled, subscriber: this, persistent: true });
	}
}
