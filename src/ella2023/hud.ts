import { $, Msx1Colors, SpriteObject, StateMachineBlueprint, build_fsm, insavegame, type RevivableObjectArgs } from 'bmsx';
import { Fighter } from './fighter';
import { BitmapId } from './resourceids';
import { computeBarArea } from 'bmsx/utils/utils';

@insavegame
export class Hud extends SpriteObject {
	@build_fsm()
	static bouw(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					tick(this: Hud) {
					}
				}
			}
		}
	}

	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'hud', ...opts ?? {} });
		this.imgid = BitmapId.hud;
		// Producer: HUD elements (health bars + text)
		this.getOrCreateCustomRenderer().addProducer(({ rc }) => {
			const world = $.world;
			const player = world.getWorldObject<Fighter>('player');
			const sinterklaas = world.getWorldObject<Fighter>('sinterklaas');
			const HP_BAR1 = { startX: 112, endX: 40, startY: 25, endY: 29 };
			const HP_BAR2 = { startX: 216, endX: 144, startY: 25, endY: 29 };
			const MAX_HP = 100;
			const color = Msx1Colors[4];
			const Z = 200;
			const hp1 = sinterklaas?.hp ?? 100; // Note that the computeBarArea handles clamping
			const hp2 = player?.hp ?? 100; // Note that the computeBarArea handles clamping

			const area1 = computeBarArea(HP_BAR1, hp1, MAX_HP, Z, false);
			rc.submitRect({ kind: 'fill', area: area1, color });
			const area2 = computeBarArea(HP_BAR2, hp2, MAX_HP, Z, true);
			rc.submitRect({ kind: 'fill', area: area2, color });
			rc.submitGlyphs({ x: 40, y: 32, glyphs: 'sen kai la' });
			rc.submitGlyphs({ x: 144, y: 32, glyphs: 'ei la' });
		});
	}

}
