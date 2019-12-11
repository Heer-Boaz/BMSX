import { Projectile } from './projectile';

import { Point, addPoints } from './bmsx/common';

import { Model } from './gamemodel';
import { Constants } from './bmsx/engine';
import { GameConstants } from './gameconstants';

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
        if (this.canHurtPlayer && this.objectCollide(Model._.Belmont))
            Model._.Belmont.TakeDamage(this.damageDealt);
        if (this.checkWallSpriteCollisions() || this.checkWallCollision())
            this.disposeFlag = true;
        if (this.pos.x < 0 || this.pos.x + this.size.x >= GameConstants.GameScreenWidth || this.pos.y < 0 || this.pos.y + this.size.y >= GameConstants.GameScreenHeight)
            this.disposeFlag = true;
    }
}