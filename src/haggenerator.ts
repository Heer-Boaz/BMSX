import { Hag } from "./hag";
import { IGameObject } from "./bmsx/engine";
import { Direction, Point } from "./bmsx/common";
import { bst } from "./bmsx/engine";
import { Model } from "./gamemodel";
import { GameConstants } from "./gameconstants";

export class HagGenerator extends bst implements IGameObject {
    public disposeFlag: boolean;
    public id: string;
    public pos: Point;
    public disposeOnSwitchRoom?: boolean;

    constructor(pos: Point) {
        super();
        this.pos = pos;
        this.disposeOnSwitchRoom = true;
        let state0 = this.add(0);
        state0.nudges2move = 100;
        state0.onrun = (s) => ++s.nudges;
        state0.ontapemove = (s) => {
            // Poop hags based on where Belmont is
            let spawnPoint = { x: 0, y: this.pos.y };
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
        this.run();
    }

    spawn(spawningPos?: Point): void {
        if (spawningPos) this.pos = spawningPos;
    }
}