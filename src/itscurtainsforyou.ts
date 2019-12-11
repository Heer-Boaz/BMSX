import { BStopwatch } from "./bmsx/engine";
import { TileSize } from "./bmsx/msx"
import { waitDuration } from "./bmsx/common";
import { view } from "./bmsx/engine";
import { Controller as C } from "./gamecontroller";
import { Point } from "./bmsx/common";
import { BitmapId } from "./bmsx/resourceids";
import { GameConstants } from "./gameconstants";

export class ItsCurtainsForYou {
    private curtainPartCount: number;
    private timer: BStopwatch;
    private msCurtainPartWait: number = 1;
    private maxCurtainParts: number = ~~(GameConstants.GameScreenWidth / (TileSize / 2)) + 1;

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
            view.drawImg(BitmapId.CurtainPart, pos.x, pos.y);
            pos.x += TileSize / 2;
        }
    }
}