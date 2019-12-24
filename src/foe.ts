import { Point } from './bmsx/common';
import { ItemType } from './item';
import { PlayerProjectile } from './pprojectile';
import { SM } from './bmsx/soundmaster';
import { AudioId } from './bmsx/resourceids';
import { FoeExplosion } from './foeexplosion';
import { Model } from './gamemodel';
import { Sprite, model, IGameObject } from './bmsx/engine';

export abstract class Foe extends Sprite {
    public maxHealth: number;
    public health: number;

    public get healthPercentage(): number {
        return ~~Math.min((Math.round(this.health / this.maxHealth * 100)), 100);
    }

    constructor(pos: Point) {
        super(pos);
    }

    public get respawnOnRoomEntry(): boolean {
        return false;
    }

    public canHurtPlayer: boolean;
    public damageToPlayer: number;

    public get isAfoot(): boolean {
        return this.canHurtPlayer && !this.disposeFlag;
    }

    protected itemSpawnedAfterKill: ItemType;

    public takeTurn(): void {
        if (this.canHurtPlayer && this.objectCollide((model as Model).Belmont)) {
            (model as Model).Belmont.takeDamage(this.damageToPlayer);
        }
    }

    public handleHit(source: IGameObject, dmg: number): void {
        if (this.disposeFlag) return;
        this.loseHealth(source, dmg);
        (model as Model).LastFoeThatWasHit = this;
        SM.play(AudioId.Hit);
    }

    protected loseHealth(source: IGameObject, dmg: number): void {
        if (this.disposeFlag) return;
        this.health -= dmg;
        if (this.health <= 0)
            this.die();
    }

    protected handleDie(): void {
        if (this.disposeFlag) return;
        this.disposeFlag = true;
        (model as Model).foeDefeated(this);
    }

    public die(): void {
        if (this.disposeFlag) return;
        if (this.itemSpawnedAfterKill === ItemType.HeartSmall) {
            this.dieWithItem(this.itemSpawnedAfterKill);
        }
        else this.dieWithoutItem();
    }

    protected dieWithoutItem(): void {
        this.handleDie();
        model.spawn(new FoeExplosion(this.pos));
    }

    protected dieWithItem(itemToSpawn: ItemType = ItemType.None): void {
        this.handleDie();
        if (itemToSpawn !== ItemType.None) {
            model.spawn(new FoeExplosion(this.pos, itemToSpawn));
        }
    }
}