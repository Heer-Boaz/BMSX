import { PlayerProjectile } from "./pprojectile";
import { RoeState } from "./belmont";
import { Model } from "./gamemodel";
import { BitmapId } from "./bmsx/resourceids";
import { Area, Point, Direction, newArea, moveArea } from "./bmsx/common";

export class TriRoe extends PlayerProjectile {
	private static hitareas: Map<number, Area> = new Map<number, Area>([
		[BitmapId.Belmont_rw1, newArea(0, 9, 7, 26)],
		[BitmapId.Belmont_rw2, newArea(0, 6, 15, 16)],
		[BitmapId.Belmont_rw3, newArea(20, 8, 41, 16)],
		[BitmapId.Belmont_rwd1, newArea(0, 15, 7, 32)],
		[BitmapId.Belmont_rwd2, newArea(0, 12, 15, 22)],
		[BitmapId.Belmont_rwd3, newArea(20, 14, 41, 22)],
		[BitmapId.Belmont_lw1, newArea(24, 9, 31, 26)],
		[BitmapId.Belmont_lw2, newArea(17, 6, 31, 16)],
		[BitmapId.Belmont_lw3, newArea(0, 8, 19, 16)],
		[BitmapId.Belmont_lwd1, newArea(24, 15, 31, 32)],
		[BitmapId.Belmont_lwd2, newArea(17, 12, 31, 22)],
		[BitmapId.Belmont_lwd3, newArea(0, 14, 19, 22)],
	]);

	public get hitarea(): Area {
		if (!Model._.Belmont.roeState.Roeing || Model._.Belmont.RecoveringFromHit)
			return null;
		if (!Model._.Belmont.Crouching)
			return moveArea(TriRoe.hitareas.get(Model._.Belmont.imgid), RoeState.RoeSpritePosOffset.get(Model._.Belmont.direction)[Model._.Belmont.roeState.CurrentFrame]);
		return moveArea(TriRoe.hitareas.get(Model._.Belmont.imgid), RoeState.RoeSpritePosOffsetCrouching.get(Model._.Belmont.direction)[Model._.Belmont.roeState.CurrentFrame]);
	}

	public set hitarea(value: Area) {
	}

	public get damageDealt(): number {
		return 1;
	}

	constructor(pos: Point, dir: Direction) {
		super({ x: pos.x, y: pos.y }, { x: 0, y: 0 });
		this.direction = dir;
		this.pos = Model._.Belmont.pos;
	}

	public takeTurn(): void {
		if (Model._.Belmont.Dying || !Model._.Belmont.roeState.Roeing) {
			this.disposeFlag = true;
			return;
		}
		this.pos = Model._.Belmont.pos;
		this.checkAndInvokeHit();
	}

	public paint(offset: Point = null): void {
		// The tri-roe is part of the Belmont-sprite and is not drawn
	}

	public dispose(): void {
	}
}