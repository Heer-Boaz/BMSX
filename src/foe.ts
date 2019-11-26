import { Creature } from "./creature";
import { PlayerProjectile } from "./pprojectile";
import { ItemType } from "./item";
import { GameModel as M } from "./sintervaniamodel";
import { SoundMaster } from "../BoazEngineJS/soundmaster";
import { FoeExplosion } from "./foeexplosion";
import { AudioId } from "../BoazEngineJS/resourceids";
import { ResourceMaster as RM } from "./resourcemaster";
import { Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export abstract class Foe extends Creature {
    public MaxHealth: number;
    public Health: number;

    public get HealthPercentage(): number {
        return Math.min(<number>(Math.round(this.Health / <number>this.MaxHealth * 100)), 100);
    }

    constructor(pos: Point) {
        super(pos);

    }

    public get RespawnAtRoomEntry(): boolean {
        return false;
    }

    public CanHurtPlayer: boolean;
    public DamageToPlayer: number;

    public get IsAfoot(): boolean {
        return this.CanHurtPlayer;
    }

    protected itemSpawnedAfterKill: ItemType;

    public TakeTurn(): void {
        if (this.CanHurtPlayer && this.objectCollide(M._.Belmont)) {
            M._.Belmont.TakeDamage(this.DamageToPlayer);
        }
    }

    public HandleHit(source: PlayerProjectile): void {
        M._.LastFoeThatWasHit = this;
        // SoundMaster.PlayEffect(RM.Sound[AudioId.Hit]);
    }

    protected loseHealth(source: PlayerProjectile): void {
        this.Health -= source.DamageDealt;
        if (this.Health <= 0)
            this.Die();
    }

    protected handleDie(): void {
        this.disposeFlag = true;
        M._.FoeDefeated(this);
    }

    public Die(): void {
        if (this.itemSpawnedAfterKill == ItemType.HeartSmall) {
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
        if (itemToSpawn != ItemType.None) {
            M._.spawn(new FoeExplosion(this.pos, itemToSpawn));
        }
    }
}