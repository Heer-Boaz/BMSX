import { $ } from '../core/game';
import { subscribesToGlobalEvent } from '../core/eventemitter';
import { excludeclassfromsavegame } from '../serializer/gameserializer';
import { GameObject } from '../core/object/gameobject';
import { SpriteObject } from '../core/object/sprite';
import { build_fsm } from '../fsm/fsmdecorators';
import type { StateMachineBlueprint } from '../fsm/fsmtypes';
import type { State } from '../fsm/state';
import { ZCOORD_MAX } from '../render/backend/webgl.constants';
import type { Identifier } from '../rompack/rompack';
import { Input } from './input';

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
            event_handlers: {
                animation_end: { do(this: SelectedPlayerIndexIcon) { this.markForDisposal(); } },
                controller_assignment_proposed: {
                    do(this: SelectedPlayerIndexIcon, _state: State, payload?: { proposedPlayerIndex?: number | null, gamepadIndex?: number }) {
                        // Only update the icon that belongs to the originating gamepad
                        if (payload?.gamepadIndex !== this.gamepadIndex) return;
                        const idx = payload?.proposedPlayerIndex ?? null;
                        this.playerIndex = (idx === undefined ? null : idx);
                    }
                },
            },
            substates: {
                _default: {
                    event_handlers: {
                        controller_assigned: 'assigned',
                        controller_assignment_cancelled: 'cancelled',
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
        super(SelectedPlayerIndexIcon.getIconId(gamepadIndex));
        this.z = ZCOORD_MAX; this.colorize = { r: 1, g: 1, b: 1, a: .75 };
        this.imgid = 'joystick_none';
    }
    public set playerIndex(idx: number | null) { this.imgid = idx == null ? 'joystick_none' : PlayerIndexNS.iconAsset(idx); }
}

@excludeclassfromsavegame
export class ControllerAssignmentUI extends GameObject {
    private icons = new Map<number, SelectedPlayerIndexIcon>(); // gamepadIndex -> icon
    private static readonly start = { x: 0, y: 0 };
    private static readonly stepX = 32;

    constructor() { super('controller_assignment_ui'); }

    private ensureIcon(gpIndex: number): SelectedPlayerIndexIcon {
        let icon = this.icons.get(gpIndex);
        if (!icon) {
            icon = new SelectedPlayerIndexIcon(gpIndex);
            $.world.get_space('ui').spawn(icon);
            this.icons.set(gpIndex, icon);
        }
        return icon;
    }

    // Event: emitted from PendingAssignmentProcessor
    @subscribesToGlobalEvent('controller_assignment_proposed', true)
    onProposed(_source: any, payload: { gamepadIndex: number; proposedPlayerIndex: number | null; positionIndex: number }) {
        const icon = this.ensureIcon(payload.gamepadIndex);
        icon.x = ControllerAssignmentUI.start.x + ControllerAssignmentUI.stepX * (payload.positionIndex ?? 0);
        icon.y = ControllerAssignmentUI.start.y;
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
