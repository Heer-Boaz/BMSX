import { BStopwatch } from "../BoazEngineJS/btimer";
import { GameConstants as CS } from "./gameconstants"
import { waitDuration } from "../BoazEngineJS/common";

export class ItsCurtainsForYou {
    private curtainPartCount: number;
    private timer: BStopwatch;
    private msCurtainPartWait: number = 18;
    private maxCurtainParts: number = CS.GameScreenWidth / CS.TileSize;
    public Init(): void {
        this.curtainPartCount = 0;
        if (this.timer == null) {
            this.timer = BStopwatch.createWatch();
        }
        this.timer.restart();
    }
    public Stop(): void {
        this.curtainPartCount = 0;
        BStopwatch.removeWatch(this.timer);
    }
    public TakeTurn(): void {
        if (waitDuration(this.timer, this.msCurtainPartWait)) {
            this.curtainPartCount++;
            if (this.curtainPartCount >= this.maxCurtainParts)
                C._.ItsCurtainsAniFinished();
        }
    }
    public Paint(): void {
        let pos: Point = { x: 0, y: 0 };
        for (let i = 0; i < this.curtainPartCount; i++) {
            BDX._.DrawBitmap(<number>BitmapId.CurtainPart, pos.x, pos.y);
            pos.x += CS.TileSize;
        }
    }
}