import { BStopwatch, IGameObject, controller } from "../bmsx/engine";
import { TileSize } from "../bmsx/msx"
import { waitDuration } from "../bmsx/common";
import { view } from "../bmsx/engine";
import { Controller } from "./gamecontroller";
import { Point } from "../bmsx/common";
import { BitmapId } from "./resourceids";
import { GameConstants } from "./gameconstants";

export class ItsCurtainsForYou implements IGameObject {
    id: string = 'itscurtains';
    disposeFlag: boolean = false;
    priority: number = 4000;
    pos: Point = null;

    public constructor() {
    }

    private curtainPartCount: number;
    private timer: BStopwatch;
    private msCurtainPartWait: number = 1;
    private maxCurtainParts: number = ~~(GameConstants.GameScreenWidth / (TileSize / 2)) + 1;

    public onspawn(): void {
        this.curtainPartCount = 0;
        this.timer = this.timer ?? BStopwatch.createWatch();
        this.timer.restart();
    }

    public stop(): void {
        this.curtainPartCount = 0;
        BStopwatch.removeWatch(this.timer);
    }

    public takeTurn(): void {
        if (waitDuration(this.timer, this.msCurtainPartWait)) {
            this.curtainPartCount++;
            if (this.curtainPartCount >= this.maxCurtainParts)
                (controller as Controller).ItsCurtainsAniFinished();
        }
    }

    public paint(): void {
        for (let i = 0; i < this.curtainPartCount; i++) { view.drawImg(BitmapId.CurtainPart, i * TileSize / 2, 0); }
    }
}