import { BStopwatch } from "../BoazEngineJS/btimer";
import { GameModel } from "./sintervaniamodel";
import { Animation, AniStepCompoundValue } from "../BoazEngineJS/animation";
import { Hag } from "./hag";
import { Direction } from "../BoazEngineJS/direction";

export class HagGenerator implements IGameObject {
    disposeFlag: boolean;
    visible: boolean;
    hitbox_sz?: number;
    hitbox_ez?: number;

    protected timer: BStopwatch;
    protected spawnAnimation: Animation<boolean>;
    protected directionOfHags: Direction;
    public id: string;
    public DisposeFlag: boolean;
    public pos: Point;
    public size: Size;
    public hitarea: Area;

    public get hitbox_sx(): number {
        return this.pos.x + this.hitarea.start.x;
    }

    public get hitbox_sy(): number {
        return this.pos.y + this.hitarea.start.y;
    }

    // public get hitbox_sz(): number {
    //     return this.pos.z + this.hitarea.start.z;
    // }

    public get hitbox_ex(): number {
        return this.pos.x + this.hitarea.end.x;
    }

    public get hitbox_ey(): number {
        return this.pos.y + this.hitarea.end.y;
    }

    // public get hitbox_ez(): number {
    //     return this.pos.z + this.hitarea.ez;
    // }

    public Priority: number;

    public get x_plus_width(): number {
        return 0;
    }

    public get y_plus_height(): number {
        return 0;
    }

    public get z_plus_depth(): number {
        return 0;
    }

    public extendedProperties: Map<string, Object>;

    constructor(pos: Point, directionOfHags: Direction) {
        this.spawnAnimation = new Animation<boolean>([true], [2000], true);
        this.timer = BStopwatch.createWatch();
        this.timer.restart();
        this.directionOfHags = directionOfHags;
    }

    takeTurn(): void {
        let stepValue = <AniStepCompoundValue<boolean>>{ nextStepValue: false };
        if (this.spawnAnimation.doAnimation(this.timer, stepValue))
            GameModel._.spawn(new Hag({ pos: (<Point>{ x: this.pos.x, y: this.pos.y }), dir: this.directionOfHags }));
    }

    Dispose(): void {
        BStopwatch.removeWatch(this.timer);
    }

    spawn(spawningPos: Point): void {
        if (spawningPos != null)
            this.pos = spawningPos;
    }

    objectCollide(o: IGameObject): boolean {
        return false;
    }

    areaCollide(a: Area): boolean {
        return false;
    }

    handleResizeEvent(): void {

    }

    exile(): void {
        BStopwatch.removeWatch(this.timer);
    }
}