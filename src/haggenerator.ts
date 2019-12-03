import { Hag } from "./hag";
import { Direction } from "../BoazEngineJS/direction";
import { IGameObject, Point } from "../BoazEngineJS/interfaces";

export class HagGenerator implements IGameObject {
    disposeFlag: boolean;
    // protected timer: BStopwatch;
    // protected spawnAnimation: Animation<boolean>;
    protected directionOfHags: Direction;
    public id: string;
    public DisposeFlag: boolean;
    public pos: Point;

    public extendedProperties: Map<string, Object>;

    constructor(pos: Point, directionOfHags: Direction) {
        // this.spawnAnimation = new Animation<boolean>([true], [2000], true);
        // this.timer = BStopwatch.createWatch();
        // this.timer.restart();
        this.pos = pos;
        this.directionOfHags = directionOfHags;
    }

    takeTurn(): void {
        // let stepValue = <AniStepCompoundValue<boolean>>{ nextStepValue: false };
        // if (this.spawnAnimation.doAnimation(this.timer, stepValue))
        //     GameModel._.spawn(new Hag({ pos: (<Point>{ x: this.pos.x, y: this.pos.y }), dir: this.directionOfHags }));
    }

    Dispose(): void {
    }

    spawn(spawningPos?: Point): void {
        if (spawningPos) this.pos = spawningPos;
    }


    dispose(): void {
    }
}