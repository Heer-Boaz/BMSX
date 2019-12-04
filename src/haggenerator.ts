import { Hag } from "./hag";
import { Direction } from "../BoazEngineJS/direction";
import { IGameObject, Point } from "../BoazEngineJS/interfaces";
import { bst } from '../BoazEngineJS/statemachine';
import { GameModel } from "./sintervaniamodel";
import { copyPoint } from '../BoazEngineJS/common';

type stuff = { ticks: number };

export class HagGenerator implements IGameObject {
    public disposeFlag: boolean;
    protected directionOfHags: Direction;
    public id: string;
    public pos: Point;
    public disposeOnSwitchRoom?: boolean;
    protected statestuff: bst<HagGenerator, stuff>;

    constructor(pos: Point, directionOfHags: Direction) {
        this.pos = pos;
        this.directionOfHags = directionOfHags;
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
            GameModel._.spawn(new Hag(copyPoint(this.pos), this.directionOfHags));
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