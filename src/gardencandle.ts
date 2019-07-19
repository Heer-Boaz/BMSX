module Sintervania.Model.Foes {
    /*[Serializable]*/
    export class GardenCandle extends Candle {
        protected static candleSprites: Map<Direction, BitmapId[]> = __init(new Map<Direction, BitmapId[]>(), { { Direction.None, BitmapId.GCandle_1 } });
protected  static CandleHitArea: Area = new Area(0, 0, 16, 16);
protected  static AnimationFrames: number[] = [<number>BitmapId.GCandle_1,
    <number>BitmapId.GCandle_2];
    constructor(pos: Point, itemSpawned: Item.Type = Item.Type.HeartSmall)
    {
        super(pos, itemSpawned);
        this.animation = new Animation<number>(GardenCandle.AnimationFrames, ElapsedMsPerFrame);
        this.animation.Repeat = true;
        this.imgid = <number>this.animation.stepValue();
        this.hitarea = GardenCandle.CandleHitArea;
        this.itemSpawnedAfterKill = itemSpawned;
    }
}
                                }