import { Creature } from "./creature";
import { PlayerProjectile } from "./pprojectile";
import { Item } from "./item";

/*[Serializable]*/
export class Foe extends Creature {
    Paint(offset: Point): any {
        throw new Error("Method not implemented.");
    }
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
    protected itemSpawnedAfterKill: Item.Type;
    public TakeTurn(): void {
        if (this.CanHurtPlayer && this.objectCollide(M._.Belmont)) {
            M._.Belmont.TakeDamage(this.DamageToPlayer);
        }
    }
    public HandleHit(source: PlayerProjectile): void {
        M._.LastFoeThatWasHit = this;
        S.PlayEffect(RM.Sound[AudioId.Hit]);
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
        if (this.itemSpawnedAfterKill == Item.Type.HeartSmall) {
            this.dieWithItem(this.itemSpawnedAfterKill);
        }
        else this.dieWithoutItem();
    }
    protected dieWithoutItem(): void {
        this.handleDie();
        M._.Spawn(new FoeExplosion(this.pos));
    }
    protected dieWithItem(itemToSpawn: Item.Type = Item.Type.None): void {
        this.handleDie();
        if (itemToSpawn != Item.Type.None) {
            M._.Spawn(new FoeExplosion(this.pos, itemToSpawn));
        }
    }
}