import { $, Msx1Colors, RenderView, SpriteObject, StateMachineBlueprint, TextWriter, build_fsm, insavegame, new_area3d } from '../bmsx';
import { Fighter } from './fighter';
import { BitmapId } from './resourceids';

@insavegame
export class Hud extends SpriteObject {
    @build_fsm()
    static bouw(): StateMachineBlueprint {
        return {
            states: {
                _default: {
                    run(this: Hud) {
                    }
                }
            }
        }
    }

    override paint(): void {
        super.paint();
        // Update hitpoints
        const model = $.model;
        const view = $.view as RenderView;
        const player = model.getGameObject<Fighter>('player');
        const sinterklaas = model.getGameObject<Fighter>('sinterklaas');

        const HP_BAR1 = { startX: 112, endX: 40, startY: 25, endY: 29 };
        const HP_BAR2 = { startX: 216, endX: 144, startY: 25, endY: 29 };
        const MAX_HP = 100;
        const color = Msx1Colors[4];
        const Z = 200;

        const hp1 = sinterklaas?.hp ?? 100;
        const hp2 = player?.hp ?? 100;

        const hp1EndX = HP_BAR1.startX + (HP_BAR1.endX - HP_BAR1.startX) * hp1 / MAX_HP;
        const hp2EndX = HP_BAR2.endX - (HP_BAR2.endX - HP_BAR2.startX) * hp2 / MAX_HP;

        let area = new_area3d(HP_BAR1.startX, HP_BAR1.startY, Z, hp1EndX, HP_BAR1.endY, Z);
        view.fillRectangle({ area, color });
        area = new_area3d(hp2EndX, HP_BAR2.startY, Z, HP_BAR2.endX, HP_BAR2.endY, Z);
        view.fillRectangle({ area, color });

        TextWriter.drawText(40, 32, 'sen kai la');
        TextWriter.drawText(144, 32, 'ei la');
    }

    constructor() {
        super('hud');
        this.imgid = BitmapId.hud;
    }

}