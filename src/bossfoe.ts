import { Foe } from "./foe";
import { Point } from "./bmsx/common";

/*[Serializable]*/
export class BossFoe extends Foe {
    constructor(pos: Point) {
        super(pos);
        this.disposeOnSwitchRoom = false;
    }
}
