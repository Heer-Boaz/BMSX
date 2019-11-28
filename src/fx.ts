import { Sprite } from "../BoazEngineJS/sprite";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { Animation } from "../BoazEngineJS/animation";
import { Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export class FX extends Sprite {
    protected animation: Animation<number>;
    protected timer: BStopwatch;

    constructor(pos: Point) {
        super(pos);
        this.timer = BStopwatch.createWatch();
    }

    protected init(): void {
        this.imgid = <number>this.animation.stepValue();
        this.timer.restart();
    }

    public takeTurn(): void {
        this.doAnimation();
    }

    protected doAnimation(): void {
        let aniresult = this.animation.doAnimationTimer(this.timer);
        if (aniresult.next) {
            if (this.animation.finished())
                this.disposeFlag = true;
            this.imgid = aniresult.value;
        }

    }

    public Dispose(): void {
        BStopwatch.removeWatch(this.timer);
    }
}