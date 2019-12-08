import { Foe } from "./foe";
import { Point } from "../lib/interfaces";

/*[Serializable]*/
export class BossFoe extends Foe {
    constructor(pos: Point) {
        super(pos);
        this.disposeOnSwitchRoom = false;
    }
}
