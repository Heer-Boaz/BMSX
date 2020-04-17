import { ItemType } from "./item";
import { Animation, AniData } from "../bmsx/animation"
import { FX } from "./fx";
import { HeartSmall } from "./heartsmall";
import { BitmapId } from "./resourceids";
import { addPoints } from "../bmsx/common";
import { model } from '../bmsx/engine';

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

    constructor(itemSpawned: ItemType = ItemType.None) {
        super();
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
                    model.spawn(new HeartSmall(), addPoints({ x: this.pos.x, y: this.pos.y }, { x: 4, y: 8 }));
                }
            }
        }
    }
}