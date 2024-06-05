import { Identifier, ProhibitLeavingScreenComponent, SM, SpriteObject, StateMachineBlueprint, assign_fsm, attach_components, build_fsm, insavegame, middlepoint_area, new_area, State, Area, vec3, Vector } from '../bmsx/bmsx';
import { gamemodel } from './gamemodel';
import { AudioId, BitmapId } from './resourceids';

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
@attach_components(ProhibitLeavingScreenComponent)
@assign_fsm('hitanimation')
export abstract class Fighter extends SpriteObject {
    public static readonly ATTACK_DURATION = 15;
    public static readonly JUMP_SPEED = 2;
    public static readonly JUMP_DURATION = 60;
    public static readonly SPEED = 2;
    public fighting: boolean = true;
    public attacking: boolean = false;
    public jumping: boolean = false;
    public ducking: boolean = false;
    public attacked_while_jumping: boolean = false;
    public _aied: boolean = false;
    public previousAttackType: AttackType = null;
    public currentAttackType: AttackType = null;
    public get isAttacking(): boolean { return this.attacking; }
    public get isJumping(): boolean { return this.jumping; }
    public get isDucking(): boolean { return this.ducking; }
    public get isFighting(): boolean { return this.fighting; }
    public get isAIed(): boolean { return this._aied; }

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
                        // No emit here, because the player that was hit needs to be able to recuperate from the hit first, so that the attacking player can't hit them again immediately.
                    },
                },
                wel_au: {
                    tape: [-1, 1],
                    repetitions: 10,
                    auto_tick: true,
                    enter(this: Fighter) {
                        this.sc.pause_all_except('hitanimation');
                    },
                    next(this: Fighter, state: State) {
                        this.moveXNoSweep(state.current_tape_value);
                    },
                    end(this: Fighter) {
                        this.sc.to('hitanimation.geen_au');
                    },
                    exit(this: Fighter) {
                        this.sc.resume_all_statemachines();
                        $.emit('i_was_hit', this); // Allow the player to recuperate from the hit quickly.
                        $.emit('hit_animation_end', this); // The Game Model will handle the hit animation end event, which will hide the hit marker and determine if the fighter is down.
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
     * 3 = player 3
     * 4 = player 4
     */
    public playerIndex: number;

    constructor(id: Identifier, fsm_id: string, facing: 'left' | 'right' = 'right', playerIndex: number) {
        super(id, fsm_id);
        this.hitarea = new_area(0, 0, 0, 0); // Populate the hitarea with a default value. It is updated in the imgid setter.
        this.facing = facing;
        this.currentHitMarker = null;
        this.playerIndex = playerIndex;
    }

    public doAttackFlow(attackType: AttackType, opponent: Fighter): boolean {
        if (!opponent) return false;
        const hitArea = this.attackHitsOpponent(attackType, opponent);
        let hit: boolean = false;
        if (hitArea) {
            this.handleHittingOpponent(attackType, opponent, hitArea);
            opponent.handleBeingHit(attackType, this);
            hit = true;
        }
        return hit;
    }

    public attackHitsOpponent(attackType: AttackType, opponent: Fighter): Area | null {
        // Check if the fighter is facing the opponent
        const middlepoint = this.middlepoint;
        const opponentMiddlepoint = opponent.middlepoint;
        if (this.facing === 'left' && middlepoint.x< opponentMiddlepoint.x) { return null; }
        if (this.facing === 'right' && middlepoint.x > opponentMiddlepoint.x) { return null; }

        // Check if the attack is allowed to hit the opponent
        switch (attackType) {
            case 'highkick':
                if (opponent.isDucking) { return null; }
                break;
            case 'lowkick':
            case 'duckkick':
                if (opponent.isJumping) { return null; }
                break;
        }

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

    override onspawn(spawningPos?: Vector): void {
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
