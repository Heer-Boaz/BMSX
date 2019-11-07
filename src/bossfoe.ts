import { Foe } from "./foe";
import { GameModel } from "./sintervaniamodel";
import { Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export class BossFoe extends Foe {
    constructor(pos: Point) {
        super(pos);
        this.extendedProperties.set(GameModel.PROPERTY_KEEP_AT_ROOMSWITCH, true);
    }

    public StartBossfight(): void {
        throw new Error('not implemented');
    }
}
