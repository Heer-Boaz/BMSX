import { SpriteObject } from '../bmsx/sprite';
import { BitmapId } from './resourceids';
import { machine_states, sstate, statedef_builder } from '../bmsx/bfsm';
import { get_gamemodel } from '../bmsx/bmsx';
import { GLView } from '../bmsx/glview';
import { Msx1Colors } from '../bmsx/msx';
import { gamemodel } from './gamemodel';
import { Fighter } from './fighter';
import { TextWriter } from '../bmsx/textwriter';

const get_model = get_gamemodel<gamemodel>;

export class Hud extends SpriteObject {
    @statedef_builder
    static bouw(): machine_states {
        return {
            states: {
                _default: {
                    run(this: Hud, state: sstate) {
                    }
                }
            }
        }
    }

    override paint(): void {
        super.paint();
        // Update hitpoints
        const model = get_model();
        const player = model.get<Fighter>('player');
        const sinterklaas = model.get<Fighter>('sinterklaas');

        const HP_BAR1 = { startX: 112, endX: 40, startY: 25, endY: 29 };
        const HP_BAR2 = { startX: 216, endX: 144, startY: 25, endY: 29 };
        const MAX_HP = 100;
        const COLOR = Msx1Colors[4];
        const Z = 200;

        const hp1 = sinterklaas?.hp ?? 100;
        const hp2 = player?.hp ?? 100;

        const hp1Width = HP_BAR1.startX + (HP_BAR1.endX - HP_BAR1.startX) * hp1 / MAX_HP;
        const hp2Width = HP_BAR2.endX - (HP_BAR2.endX - HP_BAR2.startX) * hp2 / MAX_HP;

        const view = global.view as GLView;
        view.fillRectangle(HP_BAR1.startX, HP_BAR1.startY, hp1Width, HP_BAR1.endY, COLOR, Z);
        view.fillRectangle(hp2Width, HP_BAR2.startY, HP_BAR2.endX, HP_BAR2.endY, COLOR, Z);

        TextWriter.drawText(40, 32, 'sen kai la');
        TextWriter.drawText(144, 32, 'ei la');
    }

    constructor() {
        super('hud');
        this.imgid = BitmapId.hud;
    }

}