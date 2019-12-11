import { Sprite } from './bmsx/engine';

import { Point, moveArea, Direction } from './bmsx/common';

import { Model } from './gamemodel';

/*[Serializable]*/
export abstract class Projectile extends Sprite {
    public direction: Direction;
    protected speed: Point;
    public disposeOnSwitchRoom

    constructor(pos: Point, speed: Point) {
        super(<Point>{ x: pos.x, y: pos.y });
        this.speed = speed;
    }

    public paint(offset: Point = null): void {
        super.paint(offset);
    }

    public damageDealt: number;

    protected checkWallSpriteCollisions(): boolean {
        return Model._.objects.filter(o => o.isWall && o.areaCollide).some(o => o.areaCollide(moveArea(this.hitarea, this.pos)));
    }

    protected checkWallCollision(): boolean {
        let startx = this.pos.x + this.hitarea.start.x;
        let starty = this.pos.y + this.hitarea.start.y;
        let endx = this.pos.x + this.hitarea.end.x;
        let endy = this.pos.y + this.hitarea.end.y;
        switch (this.direction) {
            case Direction.Up:
                return Model._.currentRoom.IsCollisionTile(startx, starty) || Model._.currentRoom.IsCollisionTile(endx, starty);
            case Direction.Right:
                return Model._.currentRoom.IsCollisionTile(endx, starty) || Model._.currentRoom.IsCollisionTile(endx, endy);
            case Direction.Down:
                return Model._.currentRoom.IsCollisionTile(startx, endy) || Model._.currentRoom.IsCollisionTile(endx, endy);
            case Direction.Left:
                return Model._.currentRoom.IsCollisionTile(startx, starty) || Model._.currentRoom.IsCollisionTile(startx, endy);
            default:
                return false;
        }
    }

    public dispose(): void {
        // Do nothing
    }
}