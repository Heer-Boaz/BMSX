import { BStopwatch } from "../BoazEngineJS/btimer";
import { Direction } from "./sintervaniamodel";
import { Animation } from "../BoazEngineJS/animation";

/*[Serializable]*/
export class HagGenerator implements IGameObject, IDisposable {
    protected timer: BStopwatch;
    protected spawnAnimation: Animation<boolean>;
    protected directionOfHags: Direction;
    public id: string;
    public DisposeFlag: boolean;
    public pos: Point;
    public size: Size;
    public hitarea: Area;
    public get hitbox_sx(): number {
        return this.pos.x + this.hitarea.sx;
    }
    public get hitbox_sy(): number {
        return this.pos.y + this.hitarea.sx;
    }
    public get hitbox_sz(): number {
        return this.pos.z + this.hitarea.sx;
    }
    public get hitbox_ex(): number {
        return this.pos.x + this.hitarea.ex;
    }
    public get hitbox_ey(): number {
        return this.pos.y + this.hitarea.ey;
    }
    public get hitbox_ez(): number {
        return this.pos.z + this.hitarea.ez;
    }
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
    protected extendedProperties: Map<string, Object>;
    constructor(pos: Point, directionOfHags: Direction) {
        this.spawnAnimation = new Animation<bool>((2000, true)) {
            Repeat = true
        };
        this.timer = BStopwatch.CreateWatch();
        this.timer.restart();
        this.directionOfHags = directionOfHags;
    }
    TakeTurn(): void {
        let stepValue = false;
        if (this.spawnanimation.doAnimation(this.timer, stepValue))
            M._.Spawn(new Hag(Point.Copy(this.pos), this.directionOfHags));
    }
    Dispose(): void {
        BStopwatch.removeWatch(this.timer);
    }
    Paint(offset: Point): void {

    }
    AreColliding(o2: IGameObject): boolean {
        return false;
    }
    AreColliding(a: Area): boolean {
        return false;
    }
    spawn(spawningPos: Point): void {
        if (spawningPos != null)
            this.pos = spawningPos;
    }
}