import { Creature } from "./creature";
import { PlayerProjectile } from "./pprojectile";
import { ItemType } from "./item";
import { GameModel as M } from "./sintervaniamodel";
import { SM } from "../BoazEngineJS/soundmaster";
import { FoeExplosion } from "./foeexplosion";
import { AudioId } from "./resourceids";
import { Point } from "../BoazEngineJS/interfaces";

export abstract class Foe extends Creature {
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
        if (this.canHurtPlayer && this.objectCollide(M._.Belmont)) {
            M._.Belmont.TakeDamage(this.damageToPlayer);
        }
    }

    public handleHit(source: PlayerProjectile): void {
        if (this.disposeFlag) return;
        M._.LastFoeThatWasHit = this;
        SM.playEffect(AudioId.Hit);
    }

    protected loseHealth(source: PlayerProjectile): void {
        if (this.disposeFlag) return;
        this.health -= source.damageDealt;
        if (this.health <= 0)
            this.die();
    }

    protected handleDie(): void {
        if (this.disposeFlag) return;
        this.disposeFlag = true;
        M._.FoeDefeated(this);
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
        M._.spawn(new FoeExplosion(this.pos));
    }

    protected dieWithItem(itemToSpawn: ItemType = ItemType.None): void {
        this.handleDie();
        if (itemToSpawn !== ItemType.None) {
            M._.spawn(new FoeExplosion(this.pos, itemToSpawn));
        }
    }

    public dispose(): void {
        // Do nothing
    }
}