import { Sprite } from "../BoazEngineJS/sprite";
import { Direction } from "../BoazEngineJS/direction";
import { moveArea } from "../BoazEngineJS/common";
import { Constants } from "../BoazEngineJS/constants";
import { GameModel as M } from "./sintervaniamodel";
import { view } from "../BoazEngineJS/engine";
import { Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export abstract class Projectile extends Sprite {
    public Direction: Direction;
    protected speed: Point;

    constructor(pos: Point, speed: Point) {
        super(<Point>{ x: pos.x, y: pos.y });
        this.speed = speed;
    }

    public Paint(offset: Point = null): void {
        if (this.disposeFlag || !this.visible)
            return
        let options: number = this.flippedH ? Constants.DRAWBITMAP_HFLIP : 0;
        options = options || this.flippedV ? Constants.DRAWBITMAP_VFLIP : 0;
        view.DrawBitmap(this.imgid, this.pos.x, this.pos.y, options);
    }

    public DamageDealt: number;

    protected checkWallSpriteCollisions(): boolean {
        return M._.objects.filter(o => o.extendedProperties[M.PROPERTY_ACT_AS_WALL]).some(o => o.areaCollide(moveArea(this.hitarea, this.pos)));
    }

    protected checkWallCollision(): boolean {
        let startx = this.pos.x + this.hitarea.start.x;
        let starty = this.pos.y + this.hitarea.start.y;
        let endx = this.pos.x + this.hitarea.end.x;
        let endy = this.pos.y + this.hitarea.end.y;
        switch (this.Direction) {
            case Direction.Up:
                return M._.CurrentRoom.IsCollisionTile(startx, starty, true) || M._.CurrentRoom.IsCollisionTile(endx, starty, true);
            case Direction.Right:
                return M._.CurrentRoom.IsCollisionTile(endx, starty, true) || M._.CurrentRoom.IsCollisionTile(endx, endy, true);
            case Direction.Down:
                return M._.CurrentRoom.IsCollisionTile(startx, endy, true) || M._.CurrentRoom.IsCollisionTile(endx, endy, true);
            case Direction.Left:
                return M._.CurrentRoom.IsCollisionTile(startx, starty, true) || M._.CurrentRoom.IsCollisionTile(startx, endy, true);
            default:
                return false;
        }
    }
}