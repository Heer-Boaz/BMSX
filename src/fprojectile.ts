import { GameConstants as CS } from "./gameconstants"
import { Projectile } from "./projectile"
import { addPoints } from "../BoazEngineJS/common"
import { GameModel as M } from "./sintervaniamodel"
import { Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export class FProjectile extends Projectile {
    public get canHurtPlayer(): boolean {
        return true;
    }

    constructor(pos: Point, speed: Point) {
        super(pos, speed);
        this.speed = speed;
    }

    public takeTurn(): void {
        this.pos = addPoints(this.pos, this.speed);
        if (this.canHurtPlayer && this.objectCollide(M._.Belmont))
            M._.Belmont.TakeDamage(this.damageDealt);
        if (this.checkWallSpriteCollisions() || this.checkWallCollision())
            this.disposeFlag = true;
        if (this.pos.x < 0 || this.pos.x + this.size.x >= CS.GameScreenWidth || this.pos.y < 0 || this.pos.y + this.size.y >= CS.GameScreenHeight)
            this.disposeFlag = true;
    }
}