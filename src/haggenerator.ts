import { Hag } from "./hag";
import { Direction } from "../BoazEngineJS/direction";
import { IGameObject, Point } from "../BoazEngineJS/interfaces";
import { bst } from '../BoazEngineJS/statemachine';
import { GameModel } from "./sintervaniamodel";
import { copyPoint } from '../BoazEngineJS/common';
import { GameConstants } from "./gameconstants";
import { Constants } from "../BoazEngineJS/constants";

type stuff = { ticks: number };

export class HagGenerator implements IGameObject {
    public disposeFlag: boolean;
    public id: string;
    public pos: Point;
    public disposeOnSwitchRoom?: boolean;
    protected statestuff: bst<HagGenerator, stuff>;

    constructor(pos: Point) {
        this.pos = pos;
        this.disposeOnSwitchRoom = true;
        this.statestuff = new bst<HagGenerator, stuff>(this, 0, true);
        let state0 = new bst<HagGenerator, stuff>(this);
        this.statestuff.append(state0, 0);
        state0.tapedata = [{ ticks: 100 }];
        state0.onrun = () => {
            let st = state0;
            ++st.delta2tapehead;
            if (st.delta2tapehead >= st.currentdata.ticks) {
                st.delta2tapehead = 0;
                st.tapeend();
            }
        };
        state0.ontapeend = () => {
            let st = state0;
            st.tapehead = 0;
            // Poop hags based on where Belmont is
            let spawnPoint = <Point>{ x: 0, y: this.pos.y };
            if (GameModel._.Belmont.pos.x <= GameConstants.ViewportWidth / 2) {
                spawnPoint.x = GameConstants.ViewportWidth - Hag.HagSize.y;
                GameModel._.spawn(new Hag(spawnPoint, Direction.Left));
            }
            else {
                spawnPoint.x = 0;
                GameModel._.spawn(new Hag(spawnPoint, Direction.Right));
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