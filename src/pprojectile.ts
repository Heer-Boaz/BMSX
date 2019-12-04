import { Foe } from "./foe";
import { Projectile } from "./projectile";
import { GameModel as model } from "./sintervaniamodel";
import { Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export abstract class PlayerProjectile extends Projectile {
    protected foesThatWereHit: Foe[];
    constructor(fpos: Point, speed: Point) {
        super(fpos, speed);
        this.foesThatWereHit = new Array<Foe>();
    }

    public checkAndInvokeHit(): boolean {
        let enemyWasHit: boolean = false;
        let bla = this.foesThatWereHit.length > 1;
        console.log(bla);
        model._.Foes.filter(f => !f.disposeFlag && f.hittable && !this.foesThatWereHit.includes(f) && this.objectCollide(f)).forEach(f => {
            this.foesThatWereHit.push(f);
            f.handleHit(this);
            enemyWasHit = true;
        });
        return enemyWasHit;
    }
}