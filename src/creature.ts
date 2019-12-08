import { Sprite } from "../BoazEngineJS/sprite";
import { moveArea } from "../BoazEngineJS/common"
import { Direction } from "../BoazEngineJS/direction";
import { Model as M } from "./gamemodel";
import { TileSize } from "../BoazEngineJS/msx";
import { Area, Point } from "../lib/interfaces";

export abstract class Creature extends Sprite {
    public get wallhitbox_sx(): number {
        return this.pos.x + this.wallHitArea.start.x;
    }

    public get wallhitbox_sy(): number {
        return this.pos.y + this.wallHitArea.start.y;
    }

    public get wallhitbox_ex(): number {
        return this.pos.x + this.wallHitArea.end.x;
    }

    public get wallhitbox_ey(): number {
        return this.pos.y + this.wallHitArea.end.y;
    }

    public get wallHitArea(): Area {
        return this.hitarea;
    }

    public set wallHitArea(value: Area) {
        this.wallHitArea = value;
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
        super.paint(offset);
    }

    protected originPos: Point;

    public customId: string = null;

    public get id(): string {
        return this.customId != null ? this.customId : `${this.constructor.name}:${M._.currentRoom.id}:${this.originPos.x},${this.originPos.y}`;
    }

    public set id(value: string) {
        this.customId = value;
    }

    protected checkWallSpriteCollisions(): boolean {
        return M._.objects.filter(o => o !== this && o.isWall && o instanceof Sprite && (<Sprite>o).hittable).some(o => (<Sprite>o).areaCollide(moveArea(this.wallHitArea, this.pos)));
    }

    protected checkWallCollision(): boolean {
        let startx = this.wallhitbox_sx;
        let starty = this.wallhitbox_sy;
        let endx = this.wallhitbox_ex;
        let endy = this.wallhitbox_ey;
        switch (this.direction) {
            case Direction.Up:
                return M._.currentRoom.IsCollisionTile(startx, starty) || M._.currentRoom.IsCollisionTile(endx, starty);
            case Direction.Right:
                return M._.currentRoom.IsCollisionTile(endx, starty) || M._.currentRoom.IsCollisionTile(endx, endy);
            case Direction.Down:
                return M._.currentRoom.IsCollisionTile(startx, endy) || M._.currentRoom.IsCollisionTile(endx, endy);
            case Direction.Left:
                return M._.currentRoom.IsCollisionTile(startx, starty) || M._.currentRoom.IsCollisionTile(startx, endy);
            case Direction.None:
                return M._.currentRoom.IsCollisionTile(startx, starty) || M._.currentRoom.IsCollisionTile(endx, endy);
            default:
                return false;
        }
    }

    protected handleWallCollision(): void {
        switch (this.direction) {
            case Direction.Up:
                if (this.pos.y >= 0)
                    this.pos.y = ~~(this.pos.y / TileSize + 1) * TileSize;
                this.pos.y = ~~(this.pos.y / TileSize) * TileSize;
                break;
            case Direction.Right:
                this.pos.x = ~~(this.pos.x / TileSize) * TileSize;
                break;
            case Direction.Down:
                this.pos.y = ~~(this.pos.y / TileSize) * TileSize;
                break;
            case Direction.Left:
                if (this.pos.x >= 0)
                    this.pos.x = ~~(this.pos.x / (TileSize + 1)) * TileSize;
                this.pos.x = ~~(this.pos.x / TileSize) * TileSize;
                break;
        }
    }
}
