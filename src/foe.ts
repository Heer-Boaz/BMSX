import { Creature } from "./creature";
import { PlayerProjectile } from "./pprojectile";
import { ItemType } from "./item";
import { GameModel as M } from "./sintervaniamodel";
import { SoundMaster } from "../BoazEngineJS/soundmaster";
import { FoeExplosion } from "./foeexplosion";
import { AudioId } from "./resourceids";
import { ResourceMaster as RM } from "./resourcemaster";
import { Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export abstract class Foe extends Creature {
    public maxHealth: number;
    public health: number;

    public get healthPercentage(): number {
        return Math.min(<number>(Math.round(this.health / <number>this.maxHealth * 100)), 100);
    }

    constructor(pos: Point) {
        super(pos);

    }

    public get respawnAtRoomEntry(): boolean {
        return false;
    }

    public canHurtPlayer: boolean;
    public damageToPlayer: number;

    public get isAfoot(): boolean {
        return this.canHurtPlayer;
    }

    protected itemSpawnedAfterKill: ItemType;

    public takeTurn(): void {
        if (this.canHurtPlayer && this.objectCollide(M._.Belmont)) {
            M._.Belmont.TakeDamage(this.damageToPlayer);
        }
    }

    public handleHit(source: PlayerProjectile): void {
        M._.LastFoeThatWasHit = this;
        SoundMaster.PlayEffect(RM.Sound.get(AudioId.Hit));
    }

    protected loseHealth(source: PlayerProjectile): void {
        this.health -= source.damageDealt;
        if (this.health <= 0)
            this.die();
    }

    protected handleDie(): void {
        this.disposeFlag = true;
        M._.FoeDefeated(this);
    }

    public die(): void {
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