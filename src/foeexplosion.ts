import { ItemType } from "./item";
import { Animation, AniData } from "../BoazEngineJS/animation"
import { FX } from "./fx";
import { HeartSmall } from "./heartsmall";
import { AudioId, BitmapId } from "./resourceids";
import { Model } from "./gamemodel";
import { addPoints } from "../BoazEngineJS/common";
import { Point } from "../lib/interfaces";

/*[Serializable]*/
export class FoeExplosion extends FX {
    protected static AnimationFrames: AniData<BitmapId>[] = new Array(
        { time: 8, data: BitmapId.Foekill_1 },
        { time: 8, data: BitmapId.Foekill_2 },
        { time: 8, data: BitmapId.Foekill_1 },
        { time: 8, data: BitmapId.Foekill_2 },
    );

    protected frameIndex: number;
    protected itemSpawnedAfterKill: ItemType;

    constructor(pos: Point, itemSpawned: ItemType = ItemType.None) {
        super(pos);
        this.animation = new Animation(FoeExplosion.AnimationFrames, null, false);
        this.init();
        this.itemSpawnedAfterKill = itemSpawned;
        this.priority = 50;
    }

    public takeTurn(): void {
        let nextStep = this.animation.doAnimation(this.timer);
        if (nextStep.next) {
            this.imgid = nextStep.stepValue;
            if (this.animation.finished === true) {
                this.disposeFlag = true;
                if (this.itemSpawnedAfterKill === ItemType.HeartSmall) {
                    Model._.spawn(new HeartSmall(addPoints(<Point>{ x: this.pos.x, y: this.pos.y }, <Point>{ x: 4, y: 8 })));
                }
            }
        }
    }
}