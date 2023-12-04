import { Direction, GameObjectId, mod, new_vec2, overwrite_vec2, set_vec2, vec2 } from "./bmsx";
import { Component, componenttags_postprocessing, ComponentUpdateArgs, ComponentUpdateParams } from "./component";
import { EventEmitter, subscribesToParentScopedEvent } from "./eventemitter";
import { GameObject } from "./gameobject";
import { insavegame } from "./gameserializer";
import { TileSize } from "./msx";

@insavegame
@componenttags_postprocessing('position_update_axis')
export class PositionUpdateAxisComponent extends Component {
    protected oldPos: vec2;
    protected currentPos: vec2;

    constructor(_id: GameObjectId) {
        super(_id);
        this.oldPos = new_vec2(0, 0)
        this.currentPos = new_vec2(0, 0);
    }

    protected setPos(newPos: vec2) {
        overwrite_vec2(this.oldPos, this.currentPos); // Store the old position
        overwrite_vec2(this.currentPos, newPos); // Update the position
    }

    override update(): void {
        this.setPos(this.parent.pos);
    }
}

@insavegame
export class ScreenBoundaryComponent extends PositionUpdateAxisComponent {
    override update(): void {
        super.update();
        if (this.oldPos.x !== this.currentPos.x) {
            this.checkBoundaryForXAxis.call(global.model.get(this.parentid), this.oldPos.x, this.currentPos.x);
        }
        if (this.oldPos.y !== this.currentPos.y) {
            this.checkBoundaryForYAxis.call(global.model.get(this.parentid), this.oldPos.y, this.currentPos.y);
        }
        this.setPos(this.parent.pos);
    }

    private checkBoundaryForXAxis(this: GameObject, oldx: number, newx: number) {
        if (newx < oldx) {
            if (newx + this.size.x < 0) {
                EventEmitter.getInstance().emit('leaveScreen', this.id, Direction.Left, oldx);
                this.onLeaveScreen?.(this, Direction.Left, oldx);
            }
            else if (newx < 0) {
                EventEmitter.getInstance().emit('leavingScreen', this.id, Direction.Left, oldx);
                this.onLeavingScreen?.(this, Direction.Left, oldx);
            }
        }
        else if (newx > oldx) {
            if (newx >= model.gamewidth) {
                EventEmitter.getInstance().emit('leaveScreen', this.id, Direction.Right, oldx);
                this.onLeaveScreen?.(this, Direction.Right, oldx);
            }
            else if (newx + this.size.x >= model.gamewidth) {
                EventEmitter.getInstance().emit('leavingScreen', this.id, Direction.Right, oldx);
                this.onLeavingScreen?.(this, Direction.Right, oldx);
            }
        }
    }

    private checkBoundaryForYAxis(this: GameObject, oldy: number, newy: number) {
        if (newy < oldy) {
            if (newy + this.size.y < 0) {
                EventEmitter.getInstance().emit('leaveScreen', this.id, Direction.Up, oldy);
                this.onLeaveScreen?.(this, Direction.Up, oldy);
            }
            else if (newy < 0) {
                EventEmitter.getInstance().emit('leavingScreen', this.id, Direction.Up, oldy);
                this.onLeavingScreen?.(this, Direction.Up, oldy);
            }
        }
        else if (newy > oldy) {
            if (newy >= model.gameheight) {
                EventEmitter.getInstance().emit('leaveScreen', this.id, Direction.Down, oldy);
                this.onLeaveScreen?.(this, Direction.Down, oldy);
            }
            else if (newy + this.size.y >= model.gameheight) {
                EventEmitter.getInstance().emit('leavingScreen', this.id, Direction.Down, oldy);
                this.onLeavingScreen?.(this, Direction.Down, oldy);
            }
        }
    }
}

@insavegame
export class TileCollisionComponent extends PositionUpdateAxisComponent {
    override update(): void {
        super.update();

        if (this.oldPos.x !== this.currentPos.x) {
            this.checkTileCollisionForXAxis.call(global.model.get(this.parentid), this.oldPos.x, this.currentPos.x);
        }
        if (this.oldPos.y !== this.currentPos.y) {
            this.checkTileCollisionForYAxis.call(global.model.get(this.parentid), this.oldPos.y, this.currentPos.y);
        }
        this.setPos(this.parent.pos);
    }

    private checkTileCollisionForXAxis(this: GameObject, oldx: number, newx: number) {
        if (newx < oldx) {
            if (model.collidesWithTile(this, Direction.Left)) {
                EventEmitter.getInstance().emit('wallcollide', this.id, Direction.Left);
                this.onWallcollide?.(Direction.Left);
                newx += TileSize - mod(newx, TileSize);
            }
            this.pos.x = ~~newx;
        }
        else if (newx > oldx) {
            if (model.collidesWithTile(this, Direction.Right)) {
                EventEmitter.getInstance().emit('wallcollide', this.id, Direction.Right);
                this.onWallcollide?.(Direction.Right);
                newx -= newx % TileSize;
            }
            this.pos.x = ~~newx;
        }
    }

    private checkTileCollisionForYAxis(this: GameObject, oldy: number, newy: number) {
        if (newy < oldy) {
            if (model.collidesWithTile(this, Direction.Up)) {
                EventEmitter.getInstance().emit('wallcollide', this.id, Direction.Up);
                this.onWallcollide?.(Direction.Up);
                newy += TileSize - mod(newy, TileSize);
            }
            this.pos.y = ~~newy;
        }
        else if (newy > oldy) {
            if (model.collidesWithTile(this, Direction.Down)) {
                EventEmitter.getInstance().emit('wallcollide', this.id, Direction.Down);
                this.onWallcollide?.(Direction.Down);
                newy -= newy % TileSize;
            }
            this.pos.y = ~~newy;
        }
    }
}

@insavegame
export class ProhibitLeavingScreenComponent extends ScreenBoundaryComponent {
    @subscribesToParentScopedEvent('leavingScreen')
    public onLeavingScreen(emitter: GameObjectId, d: Direction, old_x_or_y: number) {
        leavingScreenHandler_prohibit(global.model.get(emitter), d, old_x_or_y);
    }
}

/**
 * Shared function used for using as event handler for `IGameObject`/`Sprite.OnLeavingScreen`
 * This function is used as an event handler for the `onLeavingScreen` event of a `GameObject`.
 * It prohibits the `GameObject` from leaving the screen in the direction specified by setting its position to its old position.
 * @param ik The `GameObject` that is leaving the screen.
 * @param d The direction in which the `GameObject` is leaving the screen.
 * @param old_x_or_y The old x or y position of the `GameObject`.
 */
export function leavingScreenHandler_prohibit(ik: GameObject, d: Direction, old_x_or_y: number): void {
    switch (d) {
        case Direction.Left: case Direction.Right:
            ik.pos.x = old_x_or_y;
            break;
        case Direction.Up: case Direction.Down:
            ik.pos.y = old_x_or_y;
            break;
    }
}
