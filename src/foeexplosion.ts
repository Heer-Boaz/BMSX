import { ItemType } from "./item";
import { Animation, AniData } from "../BoazEngineJS/animation"
import { FX } from "./fx";
import { HeartSmall } from "./heartsmall";
import { AudioId, BitmapId } from "resourceids";
import { GameModel } from "./sintervaniamodel";
import { addPoints } from "../BoazEngineJS/common";
import { Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export class FoeExplosion extends FX {
    protected static AnimationFrames: AniData<BitmapId>[] = new Array(
        { time: 100, data: BitmapId.FoeKill_1 },
        { time: 100, data: BitmapId.FoeKill_2 },
        { time: 100, data: BitmapId.FoeKill_1 },
        { time: 100, data: BitmapId.FoeKill_2 },
    );

    protected frameIndex: number;
    protected itemSpawnedAfterKill: ItemType;

    constructor(pos: Point, itemSpawned: ItemType = ItemType.None) {
        super(<Point>pos);
        this.animation = new Animation<number>(FoeExplosion.AnimationFrames, null, false);
        this.init();
        this.itemSpawnedAfterKill = itemSpawned;
    }

    public TakeTurn(): void {
        let nextStep = this.animation.doAnimation(this.timer);
        if (nextStep.next) {
            this.imgid = nextStep.value;
            if (this.animation.finished()) {
                this.disposeFlag = true;
                if (this.itemSpawnedAfterKill == ItemType.HeartSmall) {
                    GameModel._.spawn(new HeartSmall(addPoints(<Point>{ x: this.pos.x, y: this.pos.y }, <Point>{ x: 4, y: 8 })));
                }
            }
        }
    }
}