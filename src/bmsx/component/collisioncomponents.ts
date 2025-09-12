import { EventEmitter, subscribesToParentScopedEvent } from "../core/eventemitter";
import { $ } from '../core/game';
import { WorldObject, WorldObjectEventPayloads } from "../core/object/worldobject";
import { mod, new_vec2, set_inplace_vec2 } from '../utils/utils';
import type { Identifier } from '../rompack/rompack';
import { vec2 } from '../rompack/rompack';
import { insavegame, type RevivableObjectArgs } from "../serializer/gameserializer";
import { TileSize } from "../systems/msx";
import { Component, componenttags_postprocessing, componenttags_preprocessing, ComponentUpdateParams } from "./basecomponent";

/**
 * Represents a component responsible for updating the position of a world object along a specific axis.
 * This component handles preprocessing and postprocessing updates to handle collisions, screen boundaries, etc.
 */
@insavegame
@componenttags_preprocessing('position_update_axis') // Preprocessing update to store the old position so that it can be used in the postprocessing update to place the object back to its old position if it collides with a wall or leaves the screen, etc.
@componenttags_postprocessing('position_update_axis') // Postprocessing update to check for, and handle, collisions or leaving the screen, etc.
export abstract class PositionUpdateAxisComponent extends Component<WorldObject> {
	/**
	 * The previous position of the world object.
	 */
	public oldPos: vec2;

	constructor(opts: RevivableObjectArgs & { parentid: Identifier }) {
		super(opts);
		this.oldPos = new_vec2(0, 0);
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
    static unique = true;
	/**
	 * Overrides the postprocessingUpdate method to check for boundary collisions on the X and Y axes.
	 * @override
	 */
	override postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void {
		super.postprocessingUpdate({ params, returnvalue });
		const currentPos = this.parent.pos;
		if (this.oldPos.x !== currentPos.x) {
			this.checkBoundaryForXAxis.call($.world.getWorldObject(this.parentid), this.oldPos.x, currentPos.x);
		}
		if (this.oldPos.y !== currentPos.y) {
			this.checkBoundaryForYAxis.call($.world.getWorldObject(this.parentid), this.oldPos.y, currentPos.y);
		}
	}

	/**
	 * Checks for boundary collisions on the X axis.
	 * @private
	 * @param {WorldObject} this - The world object.
	 * @param {number} oldx - The old x position.
	 * @param {number} newx - The new x position.
	 */
	private checkBoundaryForXAxis(this: WorldObject, oldx: number, newx: number) {
		if (newx < oldx) {
			if (newx + this.size.x < 0) {
				const payload: WorldObjectEventPayloads['leaveScreen'] = { d: 'left', old_x_or_y: oldx };
				EventEmitter.instance.emit('leaveScreen', this, payload);
			}
			else if (newx < 0) {
				const payload: WorldObjectEventPayloads['leavingScreen'] = { d: 'left', old_x_or_y: oldx };
				EventEmitter.instance.emit('leavingScreen', this, payload);
			}
		}
		else if (newx > oldx) {
			if (newx >= $.world.gamewidth) {
				const payload: WorldObjectEventPayloads['leaveScreen'] = { d: 'right', old_x_or_y: oldx };
				EventEmitter.instance.emit('leaveScreen', this, payload);
			}
			else if (newx + this.size.x >= $.world.gamewidth) {
				const payload: WorldObjectEventPayloads['leavingScreen'] = { d: 'right', old_x_or_y: oldx };
				EventEmitter.instance.emit('leavingScreen', this, payload);
			}
		}
	}

	/**
	 * Checks for boundary collisions on the Y axis.
	 * @private
	 * @param {WorldObject} this - The world object.
	 * @param {number} oldy - The old y position.
	 * @param {number} newy - The new y position.
	 */
	private checkBoundaryForYAxis(this: WorldObject, oldy: number, newy: number) {
		if (newy < oldy) {
			if (newy + this.size.y < 0) {
				const payload: WorldObjectEventPayloads['leaveScreen'] = { d: 'up', old_x_or_y: oldy };
				EventEmitter.instance.emit('leaveScreen', this, payload);
			}
			else if (newy < 0) {
				const payload: WorldObjectEventPayloads['leavingScreen'] = { d: 'up', old_x_or_y: oldy };
				EventEmitter.instance.emit('leavingScreen', this, payload);
			}
		}
		else if (newy > oldy) {
			if (newy >= $.world.gameheight) {
				const payload: WorldObjectEventPayloads['leaveScreen'] = { d: 'down', old_x_or_y: oldy };
				EventEmitter.instance.emit('leaveScreen', this, payload);
			}
			else if (newy + this.size.y >= $.world.gameheight) {
				const payload: WorldObjectEventPayloads['leavingScreen'] = { d: 'down', old_x_or_y: oldy };
				EventEmitter.instance.emit('leavingScreen', this, payload);
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
    static unique = true;
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
	protected checkTileCollisionForXAxis(this: WorldObject, oldx: number, newx: number) {
		if (newx < oldx) {
			if ($.world.collidesWithTile(this, 'left')) {
				EventEmitter.instance.emit('wallcollide', this, { d: 'left' });
				newx += TileSize - mod(newx, TileSize);
			}
			this.pos.x = ~~newx;
		}
		else if (newx > oldx) {
			if ($.world.collidesWithTile(this, 'right')) {
				EventEmitter.instance.emit('wallcollide', this, { d: 'right' });
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
	protected checkTileCollisionForYAxis(this: WorldObject, oldy: number, newy: number) {
		if (newy < oldy) {
			if ($.world.collidesWithTile(this, 'up')) {
				EventEmitter.instance.emit('wallcollide', this, { d: 'up' });
				newy += TileSize - mod(newy, TileSize);
			}
			this.pos.y = ~~newy;
		}
		else if (newy > oldy) {
			if ($.world.collidesWithTile(this, 'down')) {
				EventEmitter.instance.emit('wallcollide', this, { d: 'down' });
				newy -= newy % TileSize;
			}
			this.pos.y = ~~newy;
		}
	}
}

/**
 * Represents a component that prohibits the world object from leaving the screen boundary.
 * Inherits from ScreenBoundaryComponent.
 */
@insavegame
export class ProhibitLeavingScreenComponent extends ScreenBoundaryComponent {
	/**
	 * Event handler for the 'leavingScreen' event.
	 * @param emitter - The ID of the world object emitting the event.
	 * @param d - The direction in which the world object is leaving the screen.
	 * @param old_x_or_y - The previous x or y coordinate of the world object.
	 */
	@subscribesToParentScopedEvent('leavingScreen')
	public onLeavingScreen(_event_name: string, emitter: WorldObject, { d, old_x_or_y }: WorldObjectEventPayloads['leavingScreen']) {
		leavingScreenHandler_prohibit(emitter, { d, old_x_or_y });
	}
}

/**
 * Shared function used for using as event handler for `IWorldObject`/`Sprite.OnLeavingScreen`
 * This function is used as an event handler for the `onLeavingScreen` event of a `WorldObject`.
 * It prohibits the `WorldObject` from leaving the screen in the direction specified by setting its position to its old position.
 * @param ik The `WorldObject` that is leaving the screen.
 * @param d The direction in which the `WorldObject` is leaving the screen.
 * @param old_x_or_y The old x or y position of the `WorldObject`.
 */
export function leavingScreenHandler_prohibit(ik: WorldObject, { d, old_x_or_y }: WorldObjectEventPayloads['leaveScreen']): void {
	switch (d) {
		case 'left': case 'right':
			ik.pos.x = old_x_or_y;
			break;
		case 'up': case 'down':
			ik.pos.y = old_x_or_y;
			break;
	}
}
