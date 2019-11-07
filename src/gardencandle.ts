import { Animation } from "../BoazEngineJS/animation";
import { Candle } from "./candle";
import { Direction } from "../BoazEngineJS/direction";
import { BitmapId } from "./resourceids";
import { ItemType } from "./item";
import { newArea } from "../BoazEngineJS/common";
import { Area, Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export class GardenCandle extends Candle {
    protected static candleSprites: Map<Direction, BitmapId[]> = new Map([[Direction.None, [BitmapId.GCandle_1]]]);
    protected static CandleHitArea: Area = newArea(0, 0, 16, 16);
    protected static AnimationFrames: BitmapId[] = new Array(<BitmapId>BitmapId.GCandle_1, <BitmapId>BitmapId.GCandle_2);

    constructor(pos: Point, itemSpawned: ItemType = ItemType.HeartSmall) {
        super(pos, itemSpawned);
        this.animation = new Animation<BitmapId>(GardenCandle.AnimationFrames, Candle.ElapsedMsPerFrame, true);
        this.imgid = this.animation.stepValue();
        this.hitarea = GardenCandle.CandleHitArea;
        this.itemSpawnedAfterKill = itemSpawned;
    }
}