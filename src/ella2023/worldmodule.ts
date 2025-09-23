import { $, World, InputMap, insavegame, Service, subscribesToGlobalEvent, TickGroup, type RevivableObjectArgs } from 'bmsx';
import { Fighter } from './fighter';
import { gamepadInputMapping, keyboardInputMapping } from './inputmapping';
import { YieArGameState } from './yieargamestate';
import { FighterInputIntentSystem } from './systems/fighter_input_intent_system';

export const EILA_MODULE = {
	ecs: {
		systems: [{
			id: 'ella.fighterInputIntent',
			group: TickGroup.Input,
			defaultPriority: 10,
			create: (priority: number) => new FighterInputIntentSystem(priority),
		}],
		nodes: [{ ref: 'ella.fighterInputIntent', after: ['behaviorTrees'] }],
	},
	onBoot(world: World) {
		// Spaces
		world.addSpace('gameover');
		world.addSpace('hoera');
		world.addSpace('titlescreen');
		world.addSpace('niets');
		// Input maps
		$.input.getPlayerInput(1).setInputMap({ keyboard: keyboardInputMapping, gamepad: gamepadInputMapping } as InputMap);
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

	public theOtherFighter(fighter: Fighter): Fighter | null {
		if (fighter.id === 'player') return $.world.getWorldObject<Fighter>('sinterklaas');
		return $.world.getWorldObject<Fighter>('player');
	}

	@subscribesToGlobalEvent('hit_animation_end', true)
	public handleHitAnimationEndEvent(_event_name: string, emitter: Fighter): void {
		const otherFighter = this.theOtherFighter(emitter);
		if (otherFighter) {
			otherFighter.hideHitMarker();
			otherFighter.sc.transition_to('hitanimation:/geen_au');
		}

		if (emitter.hp <= 0) {
			emitter.hp = 0;
			$.stopMusic();

			// Handle that fighter is down
			emitter.sc.dispatch_event('mode.impact.humiliated', emitter);
			if (otherFighter) {
				otherFighter.sc.dispatch_event('mode.control.stoerheidsdans', otherFighter);
			}
		}
	}

	@subscribesToGlobalEvent('humiliated_animation_end', true)
	public handleHumiliationAnimationEndEvent(_event_name: string, _emitter: Fighter, { character }: { character: string }): void {
		// Track total humiliations for demo state persistence
		this._humiliationCount++;
		const player = $.world.getWorldObject<Fighter>('player');
		const sinterklaas = $.world.getWorldObject<Fighter>('sinterklaas');

		const hp_player = player?.hp ?? 0;
		const hp_sinterklaas = sinterklaas?.hp ?? 0;

		if (hp_player > 0 && hp_sinterklaas > 0) {
			sinterklaas?.sc.dispatch_event('mode.locomotion.idle', sinterklaas);
			player?.sc.dispatch_event('mode.locomotion.idle', player);
			return;
		}

		switch (character) {
			case 'eila':
				$.world.sc.transition_to('gameover');
				break;
			case 'sinterklaas':
				$.world.sc.transition_to('hoera');
				break;
		}
	}
}
