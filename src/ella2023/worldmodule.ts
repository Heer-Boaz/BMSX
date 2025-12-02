import { $, World, InputActionEffectSystem, Input, insavegame, Service, subscribesToGlobalEvent, TickGroup, type InputMap, type PointerInputMapping, type RevivableObjectArgs, type WorldModule } from 'bmsx';
import { create_gameevent, type GameEvent } from 'bmsx/core/game_event';
import { Fighter } from './fighter';
import { gamepadInputMapping, keyboardInputMapping } from './inputmapping';
import { YieArGameState } from './yieargamestate';

export const EILA_MODULE: WorldModule = {
	id: 'ella2023',
	version: '0.1.0',
	dependencyIDs: [],
	description: 'Eila 2023 game module',
	ecs: {
		systems: [{
			id: 'ella.inputAbility',
			group: TickGroup.Input,
			defaultPriority: 10,
			create: (priority: number) => new InputActionEffectSystem(priority),
		}],
		nodes: [{ ref: 'ella.inputAbility' }],
	},
	onBoot(world: World) {
		// Spaces
		world.addSpace('gameover');
		world.addSpace('hoera');
		world.addSpace('titlescreen');
		world.addSpace('niets');
		// Input maps
		const pointerInputMapping: PointerInputMapping = Input.clonePointerMapping();
		$.input.getPlayerInput(1).setInputMap({ keyboard: keyboardInputMapping, gamepad: gamepadInputMapping, pointer: pointerInputMapping } as InputMap);
		$.input.getPlayerInput(2).setInputMap({ keyboard: null, gamepad: gamepadInputMapping } as InputMap);
		// Register persistent Eila game state service
		new YieArGameState();
		// Register event service for handlers
		new EilaEventService().activate();
	},
};

@insavegame
export class EilaEventService extends Service {
	private _humiliationCount = 0;
	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'eila_events', ...opts });
	}

	// Example service state (DTO) participation: opt-in via getState/setState.
	public override getState() { return { humiliationCount: this._humiliationCount }; }
	public override setState(dto: unknown): void {
		if (dto && typeof dto === 'object' && 'humiliationCount' in dto) {
			const n = dto.humiliationCount;
			if (typeof n === 'number' && isFinite(n)) this._humiliationCount = n;
		}
	}

	public theOtherFighter(fighter: Fighter): Fighter {
		if (fighter.id === 'player') return $.world.getWorldObject<Fighter>('sinterklaas');
		return $.world.getWorldObject<Fighter>('player');
	}

	@subscribesToGlobalEvent('hit_animation_end', true)
	public handleHitAnimationEndEvent(event: GameEvent): void {
		const emitter = (event.emitter ) as Fighter;
		if (!emitter) throw new Error('[EilaEventService] hit_animation_end missing fighter emitter.');
		const otherFighter = this.theOtherFighter(emitter);
		if (otherFighter) {
			otherFighter.hideHitMarker();
			otherFighter.sc.transition_to('hitanimation:/geen_au');
		}

		if (emitter.hp <= 0) {
			emitter.hp = 0;
			$.stopmusic();

			// Handle that fighter is down
			const humiliated = create_gameevent({ type: 'mode.impact.humiliated', emitter });
			emitter.sc.dispatch_event(humiliated);
			if (otherFighter) {
				const dance = create_gameevent({ type: 'mode.control.stoerheidsdans', emitter: otherFighter });
				otherFighter.sc.dispatch_event(dance);
			}
		}
	}

	@subscribesToGlobalEvent('humiliated_animation_end', true)
	public handleHumiliationAnimationEndEvent(event: GameEvent): void {
		const fighter = (event as { fighter?: Fighter }).fighter ?? (event.emitter as Fighter);
		if (!fighter) throw new Error('[EilaEventService] humiliated_animation_end missing fighter.');
		// Track total humiliations for demo state persistence
		this._humiliationCount++;
		const player = $.world.getWorldObject<Fighter>('player');
		const sinterklaas = $.world.getWorldObject<Fighter>('sinterklaas');

		const hp_player = player?.hp ?? 0;
		const hp_sinterklaas = sinterklaas?.hp ?? 0;

		if (hp_player > 0 && hp_sinterklaas > 0) {
			if (sinterklaas) {
				const idleS = create_gameevent({ type: 'mode.locomotion.idle', emitter: sinterklaas });
				sinterklaas.sc.dispatch_event(idleS);
			}
			if (player) {
				const idleP = create_gameevent({ type: 'mode.locomotion.idle', emitter: player });
				player.sc.dispatch_event(idleP);
			}
			return;
		}

		switch (fighter.id) {
			case 'eila':
				$.world.sc.transition_to('gameover');
				break;
			case 'sinterklaas':
				$.world.sc.transition_to('hoera');
				break;
		}
	}
}
