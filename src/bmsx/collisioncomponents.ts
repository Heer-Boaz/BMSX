import { Direction, mod } from "./bmsx";
import { Component, componenttag } from "./component";
import { EventEmitter, subscribesToParentScopedEvent } from "./eventemitter";
import { GameObject, leavingScreenHandler_prohibit } from "./gameobject";
import { insavegame } from "./gameserializer";
import { TileSize } from "./msx";

@insavegame
export class ScreenBoundaryComponent extends Component {
    override update(axis: 'x' | 'y', oldPos: number, newPos: number) {
        if (axis === 'x') {
            this.checkBoundaryForXAxis.call(global.model.get(this.parentid), oldPos, newPos);
        }
        else {
            this.checkBoundaryForYAxis.call(global.model.get(this.parentid), oldPos, newPos);
        }
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
export class TileCollisionComponent extends Component {
    override update(axis: 'x' | 'y', oldPos: number, newPos: number) {
        if (axis === 'x') {
            this.checkTileCollisionForXAxis.call(global.model.get(this.parentid), oldPos, newPos);
        }
        else {
            this.checkTileCollisionForYAxis.call(global.model.get(this.parentid), oldPos, newPos);
        }
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

// export class ProhibitLeavingScreenComponent extends Component {
//     @subscribesToParentScopedEvent('leavingScreen')
//     public onLeavingScreen(ik: GameObject, d: Direction, old_x_or_y: number) {
//         leavingScreenHandler_prohibit(ik, d, old_x_or_y);
//     }
// }
