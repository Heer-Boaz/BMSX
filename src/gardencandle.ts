import { Animation } from "../BoazEngineJS/animation";
import { Candle } from "./candle";
import { Direction } from "../BoazEngineJS/direction";
import { BitmapId } from "./resourceids";
import { ItemType } from "./item";
import { newArea } from "../BoazEngineJS/common";

/*[Serializable]*/
export class GardenCandle extends Candle {
    protected static candleSprites: Map<Direction, BitmapId[]> = new Map([[Direction.None, [<number>BitmapId.GCandle_1]]]);
    protected static CandleHitArea: Area = newArea(0, 0, 16, 16);
    protected static AnimationFrames: number[] = new Array(<number>BitmapId.GCandle_1, <number>BitmapId.GCandle_2);

    constructor(pos: Point, itemSpawned: ItemType = ItemType.HeartSmall) {
        super(pos, itemSpawned);
        this.animation = new Animation<number>(GardenCandle.AnimationFrames, Candle.ElapsedMsPerFrame, true);
        this.imgid = <number>this.animation.stepValue();
        this.hitarea = GardenCandle.CandleHitArea;
        this.itemSpawnedAfterKill = itemSpawned;
    }
}