import { $, BaseModel, InputMap, insavegame } from '../bmsx';
import { subscribesToGlobalEvent } from '../bmsx/core/eventemitter';
import { Fighter } from './fighter';
import { gamepadInputMapping, keyboardInputMapping } from './inputmapping';
import { EilaGameState } from './state';

export const EILA_PLUGIN = {
	onBoot(model: BaseModel) {
		// Spaces
		model.addSpace('gameover');
		model.addSpace('hoera');
		model.addSpace('titlescreen');
		model.addSpace('niets');
		// Input maps
		$.input.getPlayerInput(1).setInputMap({ keyboard: keyboardInputMapping, gamepad: gamepadInputMapping } as InputMap);
		$.input.getPlayerInput(2).setInputMap({ keyboard: null, gamepad: gamepadInputMapping } as InputMap);
		// Register persistent Eila game state service
		new EilaGameState();
		// Register event service for handlers
		new EilaEventService();
	},
	constants: {
		EILA_START_HP: 100,
		SINTERKLAAS_START_HP: 100,
		VERTICAL_POSITION_FIGHTERS: 176,
	},
}

export type ExtendedModel = BaseModel & typeof EILA_PLUGIN;

@insavegame
export class EilaEventService {
	public id: 'eila_events' = 'eila_events';
	constructor() {
		$.registry.register(this);
		$.event_emitter.initClassBoundEventSubscriptions(this);
	}

	public dispose() {
		$.registry.deregister(this, true);
	}

	public theOtherFighter(fighter: Fighter): Fighter | null {
		if (fighter.id === 'player') return $.model.getGameObject('sinterklaas');
		return $.model.getGameObject('player');
	}

	@subscribesToGlobalEvent('hit_animation_end')
	public handleHitAnimationEndEvent(_event_name: string, emitter: Fighter): void {
		const otherFighter = this.theOtherFighter(emitter);
		if (otherFighter) {
			otherFighter.hideHitMarker();
			otherFighter.sc.transition_to('hitanimation.geen_au');
		}

		if (emitter.hp <= 0) {
			emitter.hp = 0;
			$.stopMusic();

			// Handle that fighter is down
			emitter.sc.dispatch_event('go_humiliated', emitter);
			if (otherFighter) {
				otherFighter.sc.dispatch_event('go_stoerheidsdans', otherFighter);
			}
		}
	}

	@subscribesToGlobalEvent('humiliated_animation_end')
	public handleHumiliationAnimationEndEvent(_event_name: string, _emitter: Fighter, { character }: { character: string }): void {
		const player = $.model.getGameObject<Fighter>('player');
		const sinterklaas = $.model.getGameObject<Fighter>('sinterklaas');

		const hp_player = player?.hp ?? 0;
		const hp_sinterklaas = sinterklaas?.hp ?? 0;

		if (hp_player > 0 && hp_sinterklaas > 0) {
			sinterklaas?.sc.dispatch_event('go_idle', sinterklaas);
			player?.sc.dispatch_event('go_idle', player);
			return;
		}

		switch (character) {
			case 'eila':
				$.model.sc.transition_to('gameover');
				break;
			case 'sinterklaas':
				$.model.sc.transition_to('hoera');
				break;
		}
	}
}
