import { BStopwatch } from "../BoazEngineJS/btimer";
import { Animation, AniStepCompoundValue, AniData } from "../BoazEngineJS/animation";
import { Direction } from "../BoazEngineJS/direction";
import { AudioId, BitmapId } from "../BoazEngineJS/resourceids";
import { ItemType } from "./item";
import { Foe } from "./foe";
import { GameConstants } from "./gameconstants";
import { PlayerProjectile } from "./pprojectile";
import { Size, Area, Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export class Hag extends Foe {
    public get DamageToPlayer(): number {
        return 1;
    }

    protected get moveBeforeFrameChange(): number {
        return 0;
    }

    public get RespawnAtRoomEntry(): boolean {
        return true;
    }

    protected static HagSize: Size = <Size>{ x: 16, y: 32 };
    protected static HagHitArea: Area = <Area>{ start: <Point>{ x: 2, y: 2 }, end: <Point>{ x: 14, y: 32 } };
    protected animation: Animation<number>;
    protected timer: BStopwatch;

    protected static hagSprites: Map<Direction, BitmapId[]> = new Map([[Direction.None, [BitmapId.Hag_1, BitmapId.Hag_2]]]);
    protected static movementSprites: Map<Direction, BitmapId[]> = Hag.hagSprites;
    protected static AnimationFrames: AniData<BitmapId>[] = new Array(
        { time: 250, data: BitmapId.Hag_1 },
        { time: 250, data: BitmapId.Hag_2 },
    );

    constructor({ pos, dir, itemSpawned = ItemType.HeartSmall }: { pos: Point; dir: Direction; itemSpawned?: ItemType; }) {
        super(pos);
        this.CanHurtPlayer = true;
        this.animation = new Animation<BitmapId>(Hag.AnimationFrames, null, true);
        this.timer = BStopwatch.createWatch();
        this.imgid = <number>this.animation.stepValue();
        this.timer.restart();
        this.size = Hag.HagSize;
        this.hitarea = Hag.HagHitArea;
        this.itemSpawnedAfterKill = itemSpawned;
        this.Health = 1;
        this.Direction = dir;
    }

    public TakeTurn(): void {
        let stepValue: AniStepCompoundValue<number> = { nextStepValue: <number>this.imgid };
        this.animation.doAnimation(this.timer, stepValue);
        this.imgid = stepValue.nextStepValue;
        this.flippedH = this.Direction == Direction.Left;
        this.pos.x += this.Direction == Direction.Left ? -2 : 2;
        if (this.pos.x >= GameConstants.GameScreenWidth || (0 > this.pos.x + this.size.x)) {
            this.disposeFlag = true;
        }
    }

    public Dispose(): void {
        BStopwatch.removeWatch(this.timer);
    }

    public HandleHit(source: PlayerProjectile): void {
        super.HandleHit(source);
        this.loseHealth(source);
    }

    public Paint(offset: Point = null): void {
        super.Paint(offset);
    }
}