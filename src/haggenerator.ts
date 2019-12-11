import { Hag } from "./hag";
import { IGameObject } from "./bmsx/engine";
import { Direction, Point } from "./bmsx/common";
import { bst } from "./bmsx/engine";
import { Model } from "./gamemodel";
import { copyPoint } from "./bmsx/common";
import { GameConstants } from "./gameconstants";
import { Constants } from "./bmsx/engine";

type stuff = { ticks: number };

export class HagGenerator implements IGameObject {
    public disposeFlag: boolean;
    public id: string;
    public pos: Point;
    public disposeOnSwitchRoom?: boolean;
    protected statestuff: bst<HagGenerator>;

    constructor(pos: Point) {
        this.pos = pos;
        this.disposeOnSwitchRoom = true;
        this.statestuff = new bst<HagGenerator>(this, 0, true);
        let state0 = this.statestuff.addNewState(0);
        state0.delta2tapehead = 100;
        state0.onrun = (s) => ++s.tapeheadnudges;
        state0.ontapeheadmove = (s) => {
            // Poop hags based on where Belmont is
            let spawnPoint = <Point>{ x: 0, y: this.pos.y };
            if (Model._.Belmont.pos.x <= GameConstants.ViewportWidth / 2) {
                spawnPoint.x = GameConstants.ViewportWidth - Hag.HagSize.y;
                Model._.spawn(new Hag(spawnPoint, Direction.Left));
            }
            else {
                spawnPoint.x = 0;
                Model._.spawn(new Hag(spawnPoint, Direction.Right));
            }
        };
    }

    takeTurn(): void {
        this.statestuff.run();
    }

    spawn(spawningPos?: Point): void {
        if (spawningPos) this.pos = spawningPos;
    }

    dispose(): void {
    }
}