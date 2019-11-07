import { Foe } from "./foe";
import { Projectile } from "./projectile";
import { GameModel as model } from "./sintervaniamodel";
import { Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export class PlayerProjectile extends Projectile {
    protected foesThatWereHit: Foe[];
    constructor(fpos: Point, speed: Point) {
        super(fpos, speed);
        this.foesThatWereHit = new Array<Foe>();
    }
    public CheckAndInvokeHit(): boolean {
        let enemyWasHit: boolean = false;
        model._.Foes.filter(f => f.hittable && this.objectCollide(f)).filter((f: Foe) => !this.foesThatWereHit.includes(f)).forEach((f: Foe) => {
            this.foesThatWereHit.push(f);
            f.HandleHit(this);
            enemyWasHit = true;
        });
        return enemyWasHit;
    }
}