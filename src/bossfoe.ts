import { Foe } from "./foe";
import { Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export class BossFoe extends Foe {
    constructor(pos: Point) {
        super(pos);
        this.disposeOnSwitchRoom = false;
    }
}
