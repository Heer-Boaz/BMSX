import { ItemType } from './item';
import { SM } from 'bmsx/soundmaster';
import { AudioId } from './resourceids';
import { FoeExplosion } from './foeexplosion';
import { Model } from './gamemodel';
import { Sprite, model, WorldObject } from 'bmsx';

export abstract class Foe extends Sprite {
    public maxHealth: number;
    public health: number;

    public get healthPercentage(): number {
        return ~~Math.min((Math.round(this.health / this.maxHealth * 100)), 100);
    }

    public canHurtPlayer: boolean = true;

    public get damageToPlayer(): number {
        return 1;
    }

    constructor() {
        super();
    }

    public get respawnOnRoomEntry(): boolean {
        return false;
    }

    public get isAfoot(): boolean {
        return this.canHurtPlayer && !this.disposeFlag;
    }

    protected itemSpawnedAfterKill: ItemType;

    public run(): void {
        if (this.canHurtPlayer && this.objectCollide((model as Model).Belmont)) {
            (model as Model).Belmont.takeDamage(this.damageToPlayer);
        }
    }

    public handleHit(source: WorldObject, dmg: number): void {
        if (this.disposeFlag) return;
        this.loseHealth(source, dmg);
        (model as Model).LastFoeThatWasHit = this;
        SM.play(AudioId.Hit);
    }

    protected loseHealth(source: WorldObject, dmg: number): void {
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
        new FoeExplosion().spawn(this.pos);
    }

    protected dieWithItem(itemToSpawn: ItemType = ItemType.None): void {
        this.handleDie();
        if (itemToSpawn !== ItemType.None) {
            new FoeExplosion(itemToSpawn).spawn(this.pos);
        }
    }
}
