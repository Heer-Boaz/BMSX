import { Direction, mod } from "./bmsx";
import { Component, componenttag } from "./component";
import { GameObject } from "./gameobject";
import { TileSize } from "./msx";

@componenttag('screenboundary')
export class ScreenBoundaryComponent extends Component {
    override update(args: { axis: 'x' | 'y', oldPos: number, newPos: number }) {
        if (args.axis === 'x') {
            this.checkBoundaryForXAxis.call(global.model.get(this.parentid), args.oldPos, args.newPos);
        }
        else {
            this.checkBoundaryForYAxis.call(global.model.get(this.parentid), args.oldPos, args.newPos);
        }
    }

    private checkBoundaryForXAxis(this: GameObject, oldx: number, newx: number) {
        if (newx < oldx) {
            if (newx + this.size.x < 0) { this.onLeaveScreen?.(this, Direction.Left, oldx); }
            else if (newx < 0) { this.onLeavingScreen?.(this, Direction.Left, oldx); }
        }
        else if (newx > oldx) {
            if (newx >= model.gamewidth) { this.onLeaveScreen?.(this, Direction.Right, oldx); }
            else if (newx + this.size.x >= model.gamewidth) { this.onLeavingScreen?.(this, Direction.Right, oldx); }
        }
    }

    private checkBoundaryForYAxis(this: GameObject, oldy: number, newy: number) {
        if (newy < oldy) {
            if (newy + this.size.y < 0) { this.onLeaveScreen?.(this, Direction.Up, oldy); }
            else if (newy < 0) { this.onLeavingScreen?.(this, Direction.Up, oldy); }
        }
        else if (newy > oldy) {
            if (newy >= model.gameheight) { this.onLeaveScreen?.(this, Direction.Down, oldy); }
            else if (newy + this.size.y >= model.gameheight) { this.onLeavingScreen?.(this, Direction.Down, oldy); }
        }
    }
}

@componenttag('tilecollision')
export class TileCollisionComponent extends Component {
    override update(args: { axis: 'x' | 'y', oldPos: number, newPos: number }) {
        if (args.axis === 'x') {
            this.checkTileCollisionForXAxis.call(global.model.get(this.parentid), args.oldPos, args.newPos);
        }
        else {
            this.checkTileCollisionForYAxis.call(global.model.get(this.parentid), args.oldPos, args.newPos);
        }
    }

    private checkTileCollisionForXAxis(this: GameObject, oldx: number, newx: number) {
        if (newx < oldx) {
            if (model.collidesWithTile(this, Direction.Left)) {
                this.onWallcollide?.(Direction.Up);
                newx += TileSize - mod(newx, TileSize);
            }
            this.pos.x = ~~newx;
        }
        else if (newx > oldx) {
            if (model.collidesWithTile(this, Direction.Right)) {
                this.onWallcollide?.(Direction.Right);
                newx -= newx % TileSize;
            }
            this.pos.x = ~~newx;
        }
    }

    private checkTileCollisionForYAxis(this: GameObject, oldy: number, newy: number) {
        if (newy < oldy) {
            if (model.collidesWithTile(this, Direction.Up)) {
                this.onWallcollide?.(Direction.Up);
                newy += TileSize - mod(newy, TileSize);
            }
            this.pos.y = ~~newy;
        }
        else if (newy > oldy) {
            if (model.collidesWithTile(this, Direction.Down)) {
                this.onWallcollide?.(Direction.Down);
                newy -= newy % TileSize;
            }
            this.pos.y = ~~newy;
        }
    }
}
