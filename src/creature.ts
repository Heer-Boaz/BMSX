import { Sprite } from "../BoazEngineJS/sprite";
import { moveArea } from "../BoazEngineJS/common"
import { Direction } from "../BoazEngineJS/direction";
import { GameModel as M } from "./sintervaniamodel";
import { TileSize } from "../BoazEngineJS/msx";
import { AudioId, BitmapId } from "./resourceids";
import { view } from "../BoazEngineJS/engine";
import { Constants } from "../BoazEngineJS/constants";
import { Area, Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export abstract class Creature extends Sprite {
    protected moveBeforeFrameChange: number;
    protected movementSprites: Map<Direction, BitmapId[]>;
    protected moveLeftBeforeFrameChange: number = 0;
    protected currentWalkAnimationFrame: number = 0;

    public get wallHitArea(): Area {
        return <Area>this.hitarea;
    }

    public set wallHitArea(value: Area) {
    }

    private _direction: Direction;

    public get direction(): Direction {
        return this._direction;
    }

    public set direction(value: Direction) {
        this.oldDirection = this._direction;
        this._direction = value;
    }

    public oldDirection: Direction;

    constructor(p: Point) {
        super(p);
        this.originPos = <Point>{ x: this.pos.x, y: this.pos.y };
    }

    public paint(offset: Point = null): void {
        if (this.disposeFlag || !this.visible)
            return
        let options: number = this.flippedH ? Constants.DRAWBITMAP_HFLIP : 0;
        if (offset == null)
            view.drawImg(this.imgid, this.pos.x, this.pos.y, options);
        else view.drawImg(this.imgid, this.pos.x + offset.x, this.pos.y + offset.y, options);
    }

    protected originPos: Point;

    public customId: string = null;

    public get id(): string {
        return this.customId != null ? this.customId : `${this.constructor.name}:${M._.currentRoom.Id}:${this.originPos.x},${this.originPos.y}`;
    }

    public set id(value: string) {
        this.customId = value;
    }

    public determineFrame(): void {
        this.imgid = <number>this.movementSprites.get(this.direction)[this.currentWalkAnimationFrame];
        this.flippedH = this.direction == Direction.Right;
    }

    public animateMovement(movedDistance: number): void {
        if (movedDistance > 0) {
            this.moveLeftBeforeFrameChange -= movedDistance;
            if (this.moveLeftBeforeFrameChange < 0) {
                this.moveLeftBeforeFrameChange = this.moveBeforeFrameChange;
                if (++this.currentWalkAnimationFrame >= this.movementSprites.get(this.direction).length) {
                    this.currentWalkAnimationFrame = 1;
                }
            }
        }
        else {
            this.currentWalkAnimationFrame = 0;
            this.determineFrame();
        }
    }

    protected checkWallSpriteCollisions(): boolean {
        return M._.objects.filter(o => o !== this && o.isWall && o instanceof Sprite && (<Sprite>o).hittable).some(o => (<Sprite>o).areaCollide(moveArea(this.wallHitArea, this.pos)));
    }

    protected checkWallCollision(): boolean {
        let startx = this.pos.x + this.wallHitArea.start.x;
        let starty = this.pos.y + this.wallHitArea.start.y;
        let endx = this.pos.x + this.wallHitArea.end.x;
        let endy = this.pos.y + this.wallHitArea.end.y;
        switch (this.direction) {
            case Direction.Up:
                return M._.currentRoom.IsCollisionTile(startx, starty, true) || M._.currentRoom.IsCollisionTile(endx, starty, true);
            case Direction.Right:
                return M._.currentRoom.IsCollisionTile(endx, starty, true) || M._.currentRoom.IsCollisionTile(endx, endy, true);
            case Direction.Down:
                return M._.currentRoom.IsCollisionTile(startx, endy, true) || M._.currentRoom.IsCollisionTile(endx, endy, true);
            case Direction.Left:
                return M._.currentRoom.IsCollisionTile(startx, starty, true) || M._.currentRoom.IsCollisionTile(startx, endy, true);
            case Direction.None:
                return M._.currentRoom.IsCollisionTile(startx, starty, true) || M._.currentRoom.IsCollisionTile(endx, endy, true);
            default:
                return false;
        }
    }

    protected handleWallCollision(): void {
        switch (this.direction) {
            case Direction.Up:
                if (this.pos.y >= 0)
                    this.pos.y = (this.pos.y / TileSize + 1) * TileSize;
                this.pos.y = this.pos.y / TileSize * TileSize;
                break;
            case Direction.Right:
                this.pos.x = this.pos.x / TileSize * TileSize;
                break;
            case Direction.Down:
                this.pos.y = this.pos.y / TileSize * TileSize;
                break;
            case Direction.Left:
                if (this.pos.x >= 0)
                    this.pos.x = (this.pos.x / TileSize + 1) * TileSize;
                this.pos.x = this.pos.x / TileSize * TileSize;
                break;
        }
    }
}
