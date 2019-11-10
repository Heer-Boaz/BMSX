import { BStopwatch } from "../BoazEngineJS/btimer";
import { MSXConstants as MCS, TileSize } from "../BoazEngineJS/msx"
import { Constants as CS } from "../BoazEngineJS/constants"
import { waitDuration } from "../BoazEngineJS/common";
import { view } from "../BoazEngineJS/engine";
import { GameController as C } from "./gamecontroller";
import { Point } from "../BoazEngineJS/interfaces";
import { BitmapId } from "resourceids";

export class ItsCurtainsForYou {
    private curtainPartCount: number;
    private timer: BStopwatch;
    private msCurtainPartWait: number = 18;
    private maxCurtainParts: number = CS.GAMESCREEN_WIDTH / TileSize;

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
            view.DrawBitmap(BitmapId.CurtainPart, pos.x, pos.y);
            pos.x += TileSize;
        }
    }
}