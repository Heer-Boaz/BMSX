import { insavegame } from '../bmsx/gameserializer';
import { SpriteObject } from '../bmsx/sprite';
import { attach_components } from '../bmsx/component';
import { ProhibitLeavingScreenComponent } from './../bmsx/collisioncomponents';
import { StateMachineVisualizer } from '../bmsx/bmsxdebugger';
import { BitmapId } from './resourceids';
import { assign_fsm, build_fsm, machine_states, sstate } from '../bmsx/bfsm';
import type { vec2, GameObjectId } from '../bmsx/rompack';
import { new_area } from '../bmsx/bmsx';

export type AttackType = string;

export type HitMarkerType = 'player_hit' | 'enemy_hit' | 'poef';

export type HitMarkerInfo = {
    type: HitMarkerType,
    offset: vec2, // Offset from the fighter's position
};

@insavegame
@attach_components(ProhibitLeavingScreenComponent, StateMachineVisualizer)
@assign_fsm('hitanimation')
export abstract class Fighter extends SpriteObject {
    @build_fsm('hitanimation')
    static bouw_hitanimation_fsm(): machine_states {
        return {
            states: {
                _geen_au: {
                },
                wel_au: {
                    tape: [-1, 1],
                    repetitions: 10,
                    auto_tick: true,
                    enter(this: Fighter, state: sstate) {
                        state.reset();
                        this.moveXNoSweep(state.head);
                    },
                    next(this: Fighter, state: sstate) {
                        this.moveXNoSweep(state.head);
                    },
                    end(this: Fighter, state: sstate) {
                        this.state.to('hitanimation.geen_au');
                        global.eventEmitter.emit('hit_animation_end', this);
                    },
                },
            }
        };
    }

    protected currentHitMarker: HitMarkerInfo;
    public facing: 'left' | 'right';

    constructor(id: GameObjectId, fsm_id: string, facing: 'left' | 'right' = 'right') {
        super(id, fsm_id);
        this.hitarea = new_area(0, 0, 0, 0); // Populate the hitarea with a default value. It is updated in the imgid setter.
        this.facing = facing;
        this.currentHitMarker = null;
    }

    override paint(): void {
        this.flip_h = this.facing !== 'left';
        super.paint();

        this.paintHitMarker(this.currentHitMarker);
    }

    protected paintHitMarker(hitMarker: HitMarkerInfo) {
        // Show hit marker if there is one
        if (hitMarker) {
            let hitMarkerImgId: string;
            switch (hitMarker.type) {
                case 'player_hit':
                    hitMarkerImgId = BitmapId.au_p1;
                    break;
                case 'enemy_hit':
                    hitMarkerImgId = BitmapId.au_p2;
                    break;
                case 'poef':
                    hitMarkerImgId = BitmapId.poef;
                    break;
            }

            global.view.drawImg({
                imgid: hitMarkerImgId,
                x: this.x + hitMarker.offset.x,
                y: this.y + hitMarker.offset.y,
                z: this.z + 10,
            });
        }
    }

    // Abstract method to be implemented by each specific fighter
    abstract determineHitMarker(attackType: AttackType): HitMarkerInfo;

    showHitMarker(hitMarkerInfo: HitMarkerInfo) {
        this.currentHitMarker = hitMarkerInfo;
    }

    hideHitMarker() {
        this.currentHitMarker = null;
    }
}
