import { EventEmitter, subscribesToParentScopedEvent } from "../core/eventemitter";
import { $ } from '../core/game';
import { GameObject, GameObjectEventPayloads } from "../core/gameobject";
import { mod, new_vec2, set_inplace_vec2 } from '../core/utils';
import type { Identifier } from '../rompack/rompack';
import { vec2 } from '../rompack/rompack';
import { insavegame } from "../serializer/gameserializer";
import { TileSize } from "../systems/msx";
import { Component, componenttags_postprocessing, componenttags_preprocessing, ComponentUpdateParams } from "./basecomponent";

/**
 * Represents a component responsible for updating the position of a game object along a specific axis.
 * This component handles preprocessing and postprocessing updates to handle collisions, screen boundaries, etc.
 */
@insavegame
@componenttags_preprocessing('position_update_axis') // Preprocessing update to store the old position so that it can be used in the postprocessing update to place the object back to its old position if it collides with a wall or leaves the screen, etc.
@componenttags_postprocessing('position_update_axis') // Postprocessing update to check for, and handle, collisions or leaving the screen, etc.
export abstract class PositionUpdateAxisComponent extends Component<GameObject> {
    /**
     * The previous position of the game object.
     */
    protected oldPos: vec2;

    constructor(_id: Identifier) {
        super(_id);
        this.oldPos = new_vec2(0, 0)
    }

    override preprocessingUpdate(): void {
        set_inplace_vec2(this.oldPos, this.parent.pos); // Store the old position
    }
}

/**
 * Represents a screen boundary component that handles collision detection with the screen boundaries.
 * @class
 * @extends PositionUpdateAxisComponent
 */
@insavegame
export class ScreenBoundaryComponent extends PositionUpdateAxisComponent {
    /**
     * Overrides the postprocessingUpdate method to check for boundary collisions on the X and Y axes.
     * @override
     */
    override postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void {
        super.postprocessingUpdate({ params, returnvalue });
        const currentPos = this.parent.pos;
        if (this.oldPos.x !== currentPos.x) {
            this.checkBoundaryForXAxis.call($.model.getGameObject(this.parentid), this.oldPos.x, currentPos.x);
        }
        if (this.oldPos.y !== currentPos.y) {
            this.checkBoundaryForYAxis.call($.model.getGameObject(this.parentid), this.oldPos.y, currentPos.y);
        }
    }

    /**
     * Checks for boundary collisions on the X axis.
     * @private
     * @param {GameObject} this - The game object.
     * @param {number} oldx - The old x position.
     * @param {number} newx - The new x position.
     */
    private checkBoundaryForXAxis(this: GameObject, oldx: number, newx: number) {
        if (newx < oldx) {
            if (newx + this.size.x < 0) {
                const payload: GameObjectEventPayloads['leaveScreen'] = { d: 'left', old_x_or_y: oldx };
                EventEmitter.instance.emit('leaveScreen', this, payload);
                this.onLeaveScreen?.(this, payload);
            }
            else if (newx < 0) {
                const payload: GameObjectEventPayloads['leavingScreen'] = { d: 'left', old_x_or_y: oldx };
                EventEmitter.instance.emit('leavingScreen', this, payload);
                this.onLeavingScreen?.(this, payload);
            }
        }
        else if (newx > oldx) {
            if (newx >= $.model.gamewidth) {
                const payload: GameObjectEventPayloads['leaveScreen'] = { d: 'right', old_x_or_y: oldx };
                EventEmitter.instance.emit('leaveScreen', this, payload);
                this.onLeaveScreen?.(this, payload);
            }
            else if (newx + this.size.x >= $.model.gamewidth) {
                const payload: GameObjectEventPayloads['leavingScreen'] = { d: 'right', old_x_or_y: oldx };
                EventEmitter.instance.emit('leavingScreen', this, payload);
                this.onLeavingScreen?.(this, payload);
            }
        }
    }

    /**
     * Checks for boundary collisions on the Y axis.
     * @private
     * @param {GameObject} this - The game object.
     * @param {number} oldy - The old y position.
     * @param {number} newy - The new y position.
     */
    private checkBoundaryForYAxis(this: GameObject, oldy: number, newy: number) {
        if (newy < oldy) {
            if (newy + this.size.y < 0) {
                const payload: GameObjectEventPayloads['leaveScreen'] = { d: 'up', old_x_or_y: oldy };
                EventEmitter.instance.emit('leaveScreen', this, payload);
                this.onLeaveScreen?.(this, payload);
            }
            else if (newy < 0) {
                const payload: GameObjectEventPayloads['leavingScreen'] = { d: 'up', old_x_or_y: oldy };
                EventEmitter.instance.emit('leavingScreen', this, payload);
                this.onLeavingScreen?.(this, payload);
            }
        }
        else if (newy > oldy) {
            if (newy >= $.model.gameheight) {
                const payload: GameObjectEventPayloads['leaveScreen'] = { d: 'down', old_x_or_y: oldy };
                EventEmitter.instance.emit('leaveScreen', this, payload);
                this.onLeaveScreen?.(this, payload);
            }
            else if (newy + this.size.y >= $.model.gameheight) {
                const payload: GameObjectEventPayloads['leavingScreen'] = { d: 'down', old_x_or_y: oldy };
                EventEmitter.instance.emit('leavingScreen', this, payload);
                this.onLeavingScreen?.(this, payload);
            }
        }
    }
}

/**
 * Represents a collision component for game objects vs tiles.
 * Extends the PositionUpdateAxisComponent class.
 */
@insavegame
export class TileCollisionComponent extends PositionUpdateAxisComponent {
    /**
     * Performs post-processing update for collision components.
     * Overrides the base class's update method and checks for tile collisions on the x and y axes.
     */
    override postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void {
        super.postprocessingUpdate({ params, returnvalue });
        const currentPos = this.parent.pos;
        if (this.oldPos.x !== currentPos.x) {
            this.checkTileCollisionForXAxis.call(this.parent, this.oldPos.x, currentPos.x);
        }
        if (this.oldPos.y !== currentPos.y) {
            this.checkTileCollisionForYAxis.call(this.parent, this.oldPos.y, currentPos.y);
        }
    }

    /**
     * Checks for tile collision along the X-axis and updates the object's position accordingly.
     * @param oldx The previous X-coordinate of the object.
     * @param newx The new X-coordinate of the object.
     */
    protected checkTileCollisionForXAxis(this: GameObject, oldx: number, newx: number) {
        if (newx < oldx) {
            if ($.model.collidesWithTile(this, 'left')) {
                EventEmitter.instance.emit('wallcollide', this, { d: 'left' });
                this.onWallcollide?.('left');
                newx += TileSize - mod(newx, TileSize);
            }
            this.pos.x = ~~newx;
        }
        else if (newx > oldx) {
            if ($.model.collidesWithTile(this, 'right')) {
                EventEmitter.instance.emit('wallcollide', this, { d: 'right' });
                this.onWallcollide?.('right');
                newx -= newx % TileSize;
            }
            this.pos.x = ~~newx;
        }
    }

    /**
     * Checks for tile collision along the Y-axis and updates the object's position accordingly.
     * @param oldy The previous Y-coordinate of the object.
     * @param newy The new Y-coordinate of the object.
     */
    protected checkTileCollisionForYAxis(this: GameObject, oldy: number, newy: number) {
        if (newy < oldy) {
            if ($.model.collidesWithTile(this, 'up')) {
                EventEmitter.instance.emit('wallcollide', this, { d: 'up' });
                this.onWallcollide?.('up');
                newy += TileSize - mod(newy, TileSize);
            }
            this.pos.y = ~~newy;
        }
        else if (newy > oldy) {
            if ($.model.collidesWithTile(this, 'down')) {
                EventEmitter.instance.emit('wallcollide', this, { d: 'down' });
                this.onWallcollide?.('down');
                newy -= newy % TileSize;
            }
            this.pos.y = ~~newy;
        }
    }
}

/**
 * Represents a component that prohibits the game object from leaving the screen boundary.
 * Inherits from ScreenBoundaryComponent.
 */
@insavegame
export class ProhibitLeavingScreenComponent extends ScreenBoundaryComponent {
    /**
     * Event handler for the 'leavingScreen' event.
     * @param emitter - The ID of the game object emitting the event.
     * @param d - The direction in which the game object is leaving the screen.
     * @param old_x_or_y - The previous x or y coordinate of the game object.
     */
    @subscribesToParentScopedEvent('leavingScreen')
    public onLeavingScreen(_event_name: string, emitter: GameObject, { d, old_x_or_y }: GameObjectEventPayloads['leavingScreen']) {
        leavingScreenHandler_prohibit(emitter, { d, old_x_or_y });
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
export function leavingScreenHandler_prohibit(ik: GameObject, { d, old_x_or_y }: GameObjectEventPayloads['leaveScreen']): void {
    switch (d) {
        case 'left': case 'right':
            ik.pos.x = old_x_or_y;
            break;
        case 'up': case 'down':
            ik.pos.y = old_x_or_y;
            break;
    }
}
