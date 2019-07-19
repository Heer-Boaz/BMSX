import { Item } from "./item";
import { Animation } from "../BoazEngineJS/animation"
import { FX } from "./fx";
import { HeartSmall } from "./heartsmall";

/*[Serializable]*/
export class FoeExplosion extends FX {
    protected static AnimationFrames: number[] = [<number>BitmapId.FoeKill_2,
    <number>BitmapId.FoeKill_1,
    <number>BitmapId.FoeKill_2,
    <number>BitmapId.FoeKill_1,
    <number>BitmapId.FoeKill_2];
    protected static ElapsedMsPerFrame: number[] = [100,
        100,
        100,
        100,
        100];
    protected frameIndex: number;
    protected itemSpawnedAfterKill: Item.Type;
    constructor(pos: Point, itemSpawned: Item.Type = Item.Type.None) {
        super(<Point>pos);
        this.animation = new Animation<number>(FoeExplosion.AnimationFrames, FoeExplosion.ElapsedMsPerFrame);
        this.init();
        this.itemSpawnedAfterKill = itemSpawned;
    }
    public TakeTurn(): void {
        if (this.animation.doAnimation(this.timer, this._imageId)) {
            if (this.animation.finished()) {
                this.disposeFlag = true;
                if (this.itemSpawnedAfterKill == Item.Type.HeartSmall) {
                    M._.Spawn(new HeartSmall(Point.Copy(this.pos) + new Point(4, 8)));
                }
            }
        }
    }
}