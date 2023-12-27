import { insavegame } from '../bmsx/gameserializer';
import { SpriteObject } from '../bmsx/sprite';
import { attach_components } from '../bmsx/component';
import { ProhibitLeavingScreenComponent } from '../bmsx/collisioncomponents';
import { HitBoxVisualizer, StateMachineVisualizer } from '../bmsx/bmsxdebugger';
import { AudioId, BitmapId } from './resourceids';
import { assign_fsm, build_fsm, StateMachineBlueprint, sstate } from '../bmsx/bfsm';
import type { vec2, Area, vec3 } from '../bmsx/rompack';
import { middlepoint_area, new_area } from '../bmsx/bmsx';
import { gamemodel } from './gamemodel';
import { SM } from '../bmsx/soundmaster';
import type { Identifier } from "../bmsx/bmsx";

export type AttackType = string;

export type HitMarkerType = 'player_hit' | 'enemy_hit' | 'poef';

export type HitMarkerInfo = {
    type: HitMarkerType,
    pos: vec3, // Offset from the fighter's position
};

function getDamage(attackType: AttackType): number {
    switch (attackType) {
        default:
            return 5;
    }
}

@insavegame
@attach_components(ProhibitLeavingScreenComponent, StateMachineVisualizer, HitBoxVisualizer)
@assign_fsm('hitanimation')
export abstract class Fighter extends SpriteObject {
    public static readonly ATTACK_DURATION = 15;
    public static readonly JUMP_SPEED = 2;
    public static readonly JUMP_DURATION = 60;
    public static readonly SPEED = 2;

    @build_fsm('hitanimation')
    static bouw_hitanimation_fsm(): StateMachineBlueprint {
        return {
            parallel: true,
            states: {
                _geen_au: {
                },
                doet_au: {
                    enter(this: Fighter) {
                        this.sc.pause_all_except('hitanimation');
                    },
                    exit(this: Fighter) {
                        this.sc.resume_all_statemachines();
                    },
                },
                wel_au: {
                    tape: [-1, 1],
                    repetitions: 10,
                    auto_tick: true,
                    enter(this: Fighter, state: sstate) {
                        state.reset();
                        this.sc.pause_all_except('hitanimation');
                    },
                    next(this: Fighter, state: sstate) {
                        this.moveXNoSweep(state.current_tape_value);
                    },
                    end(this: Fighter) {
                        this.sc.to('hitanimation.geen_au');
                        $.event_emitter.emit('hit_animation_end', this);
                    },
                    exit(this: Fighter) {
                        this.sc.resume_all_statemachines();
                    },
                },
            }
        };
    }

    protected currentHitMarker: HitMarkerInfo;
    public facing: 'left' | 'right';
    public hp: number;
    /**
     * The player index of the fighter.
     * 1 = player 1
     * 2 = player 2
     */
    public playerIndex: number;

    constructor(id: Identifier, fsm_id: string, facing: 'left' | 'right' = 'right', playerIndex: number) {
        super(id, fsm_id);
        this.hitarea = new_area(0, 0, 0, 0); // Populate the hitarea with a default value. It is updated in the imgid setter.
        this.facing = facing;
        this.currentHitMarker = null;
        this.playerIndex = playerIndex;
    }

    public abstract handleFighterStukEvent(event_name: string, emitter: Fighter): void;

    public doAttackFlow(attackType: AttackType, opponent: Fighter): boolean {
        if (!opponent) return false;
        const hitArea = this.attackHitsOpponent(attackType, opponent);
        if (hitArea) {
            this.handleHittingOpponent(attackType, opponent, hitArea);
            opponent.handleBeingHit(attackType, this);
            return true;
        }
        return false;
    }

    public attackHitsOpponent(_attackType: AttackType, opponent: Fighter): Area | null {
        // if (this.state.is('hitanimation.wel_au')) return null; // Only check for hits when the fighter is not already being hit
        // Check if the opponent is hit by the attack
        const overlappingAreaOrFalse = this.collides(opponent);
        return overlappingAreaOrFalse ? overlappingAreaOrFalse : null;
    }

    public handleHittingOpponent(attackType: AttackType, _opponent: Fighter, hitArea: Area) {
        const hitMarkerInfo = this.determineHitMarker(attackType, hitArea);
        this.showHitMarker(hitMarkerInfo);
    }

    public handleBeingHit(attackType: AttackType, opponent: Fighter) {
        this.sc.to('hitanimation.wel_au');
        opponent.sc.to('hitanimation.doet_au');
        this.hp -= getDamage(attackType);
        if (attackType === 'punch') {
            SM.play(AudioId.hit2);
        } else {
            SM.play(AudioId.hit1);
        }
    }

    override paint(): void {
        this.flip_h = this.facing !== 'left';
        super.paint();

        this.paintHitMarker(this.currentHitMarker);
    }

    override onspawn(spawningPos?: vec3 | vec2): void {
        super.onspawn(spawningPos);
        this.resetVerticalPosition();
    }

    public resetVerticalPosition(): void {
        this.setYNoSweep(gamemodel.VERTICAL_POSITION_FIGHTERS - this.sy);
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

            $.view.drawImg({
                imgid: hitMarkerImgId,
                pos: hitMarker.pos
            });
        }
    }

    determineHitMarker(_attackType: AttackType, hitArea: Area): HitMarkerInfo {
        return { type: (this.id === 'player') ? 'enemy_hit' : 'player_hit', pos: { ...middlepoint_area(hitArea), z: this.z + 100 } };
    }

    showHitMarker(hitMarkerInfo: HitMarkerInfo) {
        this.currentHitMarker = hitMarkerInfo;
    }

    hideHitMarker() {
        this.currentHitMarker = null;
    }
}
