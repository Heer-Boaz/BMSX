import { Hag } from "./hag";
import { IGameObject, model } from "../bmsx/engine";
import { Direction, Point } from "../bmsx/common";
import { bst } from "../bmsx/engine";
import { belmont } from "./gamemodel";
import { GameConstants } from "./gameconstants";

export class HagGenerator extends bst implements IGameObject {
    public disposeFlag: boolean;
    public id: string;
    public pos: Point;
    public disposeOnSwitchRoom?: boolean;

    constructor() {
        super();
        this.disposeOnSwitchRoom = true;
        let state0 = this.add(0);
        state0.nudges2move = 100;
        state0.onrun = (s) => ++s.nudges;
        state0.onnext = (s) => {
            // Poop hags based on where Belmont is
            let spawnPoint = { x: 0, y: this.pos.y };
            if (belmont.pos.x <= GameConstants.ViewportWidth / 2) {
                spawnPoint.x = GameConstants.ViewportWidth - Hag.HagSize.y;
                new Hag(Direction.Left).spawn(spawnPoint);
            }
            else {
                spawnPoint.x = 0;
                new Hag(Direction.Right).spawn(spawnPoint);
            }
        };
    }

    spawn(pos?: Point): HagGenerator {
        model.spawn(this, pos);
        return this;
    }

    takeTurn(): void {
        this.run();
    }

    onspawn(spawningPos?: Point): void {
        if (spawningPos) this.pos = spawningPos;
    }
}