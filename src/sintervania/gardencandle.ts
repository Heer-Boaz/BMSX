import { Animation } from "../bmsx/animation";
import { Candle } from "./candle";
import { BitmapId } from "../bmsx/resourceids";
import { ItemType } from "./item";
import { newArea } from "../bmsx/common";
import { Area } from "../bmsx/common";

export class GardenCandle extends Candle {
    protected static CandleHitArea: Area = newArea(0, 0, 16, 16);
    protected static AnimationFrames: BitmapId[] = new Array(BitmapId.GCandle_1, BitmapId.GCandle_2);

    constructor(itemSpawned: ItemType = ItemType.HeartSmall) {
        super(itemSpawned);
        this.animation = new Animation<BitmapId>(GardenCandle.AnimationFrames, Candle.framesPerDrawing, true);
        this.imgid = this.animation.stepValue;
        this.hitarea = GardenCandle.CandleHitArea;
        this.itemSpawnedAfterKill = itemSpawned;
    }
}