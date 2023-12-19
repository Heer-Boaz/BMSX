import { BStopwatch } from "../bmsx/bmsx";
import { Animation, AniData } from "../bmsx/animation";
import { BitmapId } from "./resourceids";
import { ItemType } from "./item";
import { Foe } from "./foe";
import { GameConstants } from "./gameconstants";
import { Direction, Size, Area, Point } from "../bmsx/common";
import { Model, belmont } from "./gamemodel";

export class Hag extends Foe {
    public get respawnOnRoomEntry(): boolean { return true; }

    public static HagSize: Size = { x: 16, y: 32 };
    protected static HagHitArea: Area = { start: <Point>{ x: 2, y: 2 }, end: <Point>{ x: 14, y: 32 } };
    protected animation: Animation<number>;
    protected timer: BStopwatch;

    protected static hagSprites: Map<Direction, BitmapId[]> = new Map([
        ['none', [BitmapId.Hag1, BitmapId.Hag2]]
    ]);

    protected static movementSprites: Map<Direction, BitmapId[]> = Hag.hagSprites;
    protected static AnimationFrames: AniData<BitmapId>[] = new Array(
        { time: 12, data: BitmapId.Hag1 },
        { time: 12, data: BitmapId.Hag2 },
    );

    constructor(dir: Direction, itemSpawned = ItemType.HeartSmall) {
        super();
        this.animation = new Animation<BitmapId>(Hag.AnimationFrames, null, true);
        this.timer = BStopwatch.createWatch();
        this.imgid = this.animation.stepValue;
        this.timer.restart();
        this.size = Hag.HagSize;
        this.hitarea = Hag.HagHitArea;
        this.itemSpawnedAfterKill = itemSpawned;
        this.health = 1;
        this.direction = dir;
        this.flippedH = this.direction == 'left';
        this.z = 10;
    }

    public run(): void {
        if (this.collides(belmont)) belmont.takeDamage(this.damageToPlayer);

        let stepValue = this.animation.doAnimation(this.timer, this.imgid).stepValue;
        this.imgid = stepValue;
        this.pos.x += this.direction == 'left' ? -2 : 2;
        if (this.pos.x >= GameConstants.GameScreenWidth || (0 > this.pos.x + this.size.x)) {
            this.disposeFlag = true;
        }
    }

    public dispose(): void {
        BStopwatch.removeWatch(this.timer);
    }
}