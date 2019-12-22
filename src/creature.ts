import { Model } from './gamemodel';
import { Sprite } from './bmsx/engine';

import { Area, Point, moveArea, Direction } from './bmsx/common';

import { TileSize } from './bmsx/msx';

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

    public paint(offset?: Point, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean }): void {
        super.paint(offset, colorize);
    }

    protected originPos: Point;

    public customId: string = null;

    public get id(): string {
        return this.customId != null ? this.customId : `${this.constructor.name}:${Model._.currentRoom.roomid}:${this.originPos.x},${this.originPos.y}`;
    }

    public set id(value: string) {
        this.customId = value;
    }

    protected checkWallSpriteCollisions(): boolean {
        return Model._.objects.filter(o => o !== this && o.isWall && o instanceof Sprite && (<Sprite>o).hittable).some(o => (<Sprite>o).areaCollide(moveArea(this.wallHitArea, this.pos)));
    }

    protected checkWallCollision(): boolean {
        let startx = this.wallhitbox_sx;
        let starty = this.wallhitbox_sy;
        let endx = this.wallhitbox_ex;
        let endy = this.wallhitbox_ey;
        switch (this.direction) {
            case Direction.Up:
                return Model._.currentRoom.IsCollisionTile(startx, starty) || Model._.currentRoom.IsCollisionTile(endx, starty);
            case Direction.Right:
                return Model._.currentRoom.IsCollisionTile(endx, starty) || Model._.currentRoom.IsCollisionTile(endx, endy);
            case Direction.Down:
                return Model._.currentRoom.IsCollisionTile(startx, endy) || Model._.currentRoom.IsCollisionTile(endx, endy);
            case Direction.Left:
                return Model._.currentRoom.IsCollisionTile(startx, starty) || Model._.currentRoom.IsCollisionTile(startx, endy);
            case Direction.None:
                return Model._.currentRoom.IsCollisionTile(startx, starty) || Model._.currentRoom.IsCollisionTile(endx, endy);
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
