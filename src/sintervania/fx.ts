import { Sprite } from "../bmsx/bmsx";
import { Animation } from "../bmsx/animation";
import { BStopwatch } from '../bmsx/bmsx';

export class FX extends Sprite {
    protected animation: Animation<number>;
    protected timer: BStopwatch;

    constructor() {
        super();
        this.timer = BStopwatch.createWatch();
        this.hittable = false;
    }

    protected init(): void {
        this.imgid = <number>this.animation.stepValue;
        this.timer.restart();
    }

    public run(): void {
        this.doAnimation();
    }

    protected doAnimation(): void {
        let aniresult = this.animation.doAnimationTimer(this.timer);
        if (aniresult.next) {
            if (this.animation.finished === true)
                this.disposeFlag = true;
            else this.imgid = aniresult.stepValue;
        }

    }

    public dispose(): void {
        BStopwatch.removeWatch(this.timer);
    }
}