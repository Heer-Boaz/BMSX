import { Sprite } from "../BoazEngineJS/sprite";
import { moveArea } from "../BoazEngineJS/common"
import { GameConstants as CS } from "./gameconstants"
import { Direction } from "./sintervaniamodel";

/*[Serializable]*/
export class Creature extends Sprite {
    protected moveBeforeFrameChange: number;
    protected movementSprites: Map<Direction, BitmapId[]>;
    protected moveLeftBeforeFrameChange: number;
    protected currentWalkAnimationFrame: number = 0;
    public get WallHitArea(): Area {
        return <Area>this.hitarea;
    }
    public set WallHitArea(value: Area) {
    }
    private _direction: Direction;
    public get Direction(): Direction {
        return this._direction;
    }
    public set Direction(value: Direction) {
        this.OldDirection = this._direction;
        this._direction = value;
    }
    public OldDirection: Direction;
    constructor(p: Point) {
        super(p);
        this.originPos = Point.Copy(pos);
    }
    public Paint(offset: Point = null): void {
        if (this.disposeFlag || !this.visible)
            return
        let options: number = this.flippedH ? <number>DrawBitmap.HFLIP : 0;
        if (offset == null)
            BDX._.DrawBitmap(this.imgid, this.pos.x, this.pos.y, options);
        else BDX._.DrawBitmap(this.imgid, this.pos.x + offset.x, this.pos.y + offset.y, options);
    }
    protected originPos: Point;
    public customId: string = null;
    public get id(): string {
        return this.customId != null ? this.customId : string.Format("{0}:{1}:{2},{3}", this.GetType(), M._.CurrentRoom.Id, this.originPos.x, this.originPos.y);
    }
    public set id(value: string) {
        this.customId = value;
    }
    public DetermineFrame(): void {
        this.imgid = <number>this.movementSprites[this.Direction][this.currentWalkAnimationFrame];
        this.flippedH = this.Direction == this.Direction.Right;
    }
    public AnimateMovement(movedDistance: number): void {
        if (movedDistance > 0) {
            this.moveLeftBeforeFrameChange -= movedDistance;
            if (this.moveLeftBeforeFrameChange < 0) {
                this.moveLeftBeforeFrameChange = this.moveBeforeFrameChange;
                if (++this.currentWalkAnimationFrame >= this.movementSprites[this.Direction].Length) {
                    this.currentWalkAnimationFrame = 1;
                }
            }
        }
        else {
            this.currentWalkAnimationFrame = 0;
            this.DetermineFrame();
        }
    }
    protected checkWallSpriteCollisions(): boolean {
        return M._.GameObjects.Where(o => o != this && o.ExtendedProperty<boolean>(M.PROPERTY_ACT_AS_WALL) && (<Sprite>o).hittable).Any(o => o.areaCollide(moveArea(this.WallHitArea, this.pos)));
    }
    protected checkWallCollision(): boolean {
        let startx = this.pos.x + this.WallHitArea.start.x;
        let starty = this.pos.y + this.WallHitArea.start.y;
        let endx = this.pos.x + this.WallHitArea.end.x;
        let endy = this.pos.y + this.WallHitArea.end.y;
        switch (this.Direction) {
            case this.Direction.Up:
                return M._.CurrentRoom.IsCollisionTile(startx, starty, true) || M._.CurrentRoom.IsCollisionTile(endx, starty, true);
            case this.Direction.Right:
                return M._.CurrentRoom.IsCollisionTile(endx, starty, true) || M._.CurrentRoom.IsCollisionTile(endx, endy, true);
            case this.Direction.Down:
                return M._.CurrentRoom.IsCollisionTile(startx, endy, true) || M._.CurrentRoom.IsCollisionTile(endx, endy, true);
            case this.Direction.Left:
                return M._.CurrentRoom.IsCollisionTile(startx, starty, true) || M._.CurrentRoom.IsCollisionTile(startx, endy, true);
            case this.Direction.None:
                return M._.CurrentRoom.IsCollisionTile(startx, starty, true) || M._.CurrentRoom.IsCollisionTile(endx, endy, true);
            default:
                return false;
        }
    }
    protected handleWallCollision(): void {
        switch (this.Direction) {
            case this.Direction.Up:
                if (this.pos.y >= 0)
                    this.pos.y = (this.pos.y / CS.TileSize + 1) * CS.TileSize;
                this.pos.y = this.pos.y / CS.TileSize * CS.TileSize;
                break;
            case this.Direction.Right:
                this.pos.x = this.pos.x / CS.TileSize * CS.TileSize;
                break;
            case this.Direction.Down:
                this.pos.y = this.pos.y / CS.TileSize * CS.TileSize;
                break;
            case this.Direction.Left:
                if (this.pos.x >= 0)
                    this.pos.x = (this.pos.x / CS.TileSize + 1) * CS.TileSize;
                this.pos.x = this.pos.x / CS.TileSize * CS.TileSize;
                break;
        }
    }
}