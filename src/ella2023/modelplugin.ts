import { $, World, InputMap, insavegame, Service, subscribesToGlobalEvent } from 'bmsx';
import { Fighter } from './fighter';
import { gamepadInputMapping, keyboardInputMapping } from './inputmapping';
import { EilaGameState } from './state';

export const EILA_PLUGIN = {
	onBoot(model: World) {
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
};

export type ExtendedModel = World & typeof EILA_PLUGIN;

@insavegame
export class EilaEventService extends Service {
    private _humiliationCount = 0;
    constructor() {
        super('eila_events');
    }

    public override dispose() {
        // Remove any event subscriptions and force deregister persistent record
        $.event_emitter.removeSubscriber(this);
        this.disableEvents();
        $.registry.deregister(this, true);
    }

    // Example service state (DTO) participation: opt-in via getState/setState.
    public getState() { return { humiliationCount: this._humiliationCount }; }
    public setState(dto: unknown): void {
        if (dto && typeof dto === 'object' && 'humiliationCount' in dto) {
            const n = (dto as any).humiliationCount;
            if (typeof n === 'number' && isFinite(n)) this._humiliationCount = n;
        }
    }

	public theOtherFighter(fighter: Fighter): Fighter | null {
		if (fighter.id === 'player') return $.world.getWorldObject('sinterklaas');
		return $.world.getWorldObject('player');
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
        // Track total humiliations for demo state persistence
        this._humiliationCount++;
		const player = $.world.getWorldObject<Fighter>('player');
		const sinterklaas = $.world.getWorldObject<Fighter>('sinterklaas');

		const hp_player = player?.hp ?? 0;
		const hp_sinterklaas = sinterklaas?.hp ?? 0;

		if (hp_player > 0 && hp_sinterklaas > 0) {
			sinterklaas?.sc.dispatch_event('go_idle', sinterklaas);
			player?.sc.dispatch_event('go_idle', player);
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
