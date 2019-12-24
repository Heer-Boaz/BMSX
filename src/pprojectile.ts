import { Foe } from './foe';
import { Point } from './bmsx/common';
import { Model } from './gamemodel';
import { Sprite, model } from './bmsx/engine';

export abstract class PlayerProjectile extends Sprite {
    protected foesThatWereHit: Foe[];
    constructor(pos: Point) {
        super(pos);
        this.foesThatWereHit = new Array<Foe>();
    }

    public checkAndInvokeHit(): boolean {
        let enemyWasHit: boolean = false;
        (model as Model).foes.filter(f => !f.disposeFlag && f.hittable && !this.foesThatWereHit.includes(f) && this.objectCollide(f)).forEach(f => {
            this.foesThatWereHit.push(f);
            f.handleHit(this, 1);
            enemyWasHit = true;
        });
        return enemyWasHit;
    }
}