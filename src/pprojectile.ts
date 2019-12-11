import { Projectile } from './projectile';

import { Foe } from './foe';

import { Point } from './bmsx/common';

import { Model } from './gamemodel';

export abstract class PlayerProjectile extends Projectile {
    protected foesThatWereHit: Foe[];
    constructor(fpos: Point, speed: Point) {
        super(fpos, speed);
        this.foesThatWereHit = new Array<Foe>();
    }

    public checkAndInvokeHit(): boolean {
        let enemyWasHit: boolean = false;
        Model._.Foes.filter(f => !f.disposeFlag && f.hittable && !this.foesThatWereHit.includes(f) && this.objectCollide(f)).forEach(f => {
            this.foesThatWereHit.push(f);
            f.handleHit(this);
            enemyWasHit = true;
        });
        return enemyWasHit;
    }
}