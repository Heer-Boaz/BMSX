import { PlayerProjectile } from "./pprojectile";
import { Belmont } from "./belmont";
import { Direction } from "../BoazEngineJS/direction";
import { GameModel as M } from "./sintervaniamodel";
import { Area, Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export class TriRoe extends PlayerProjectile {
	// 		private static hitareas: Dictionary<number, Area> = __init(new Dictionary<number, Area>(), { { <number>BitmapId.Belmont_rw1, new Area(0, 9, 7, 26) },
	// 	{ <number>BitmapId.Belmont_rw2, new Area(0, 6, 15, 16) },
	// 	{ <number>BitmapId.Belmont_rw3, new Area(20, 8, 41, 16) },
	// 	{ <number>BitmapId.Belmont_rwd1, new Area(0, 15, 7, 32) },
	// 	{ <number>BitmapId.Belmont_rwd2, new Area(0, 12, 15, 22) },
	// 	{ <number>BitmapId.Belmont_rwd3, new Area(20, 14, 41, 22) },
	// 	{ <number>BitmapId.Belmont_lw1, new Area(24, 9, 31, 26) },
	// 	{ <number>BitmapId.Belmont_lw2, new Area(17, 6, 31, 16) },
	// 	{ <number>BitmapId.Belmont_lw3, new Area(0, 8, 19, 16) },
	// 	{ <number>BitmapId.Belmont_lwd1, new Area(24, 15, 31, 32) },
	// 	{ <number>BitmapId.Belmont_lwd2, new Area(17, 12, 31, 22) },
	// 	{ <number>BitmapId.Belmont_lwd3, new Area(0, 14, 19, 22) }
	// });
	public get hitarea(): Area {
		if (!M._.Belmont.roeState.Roeing || M._.Belmont.RecoveringFromHit)
			return null;
		if (!M._.Belmont.Crouching)
			return TriRoe.hitareas[M._.Belmont.imgid] + Belmont.RoeState.RoeSpritePosOffset[M._.Belmont.Direction][M._.Belmont.roeState.CurrentFrame];
		return TriRoe.hitareas[M._.Belmont.imgid] + Belmont.RoeState.RoeSpritePosOffsetCrouching[M._.Belmont.Direction][M._.Belmont.roeState.CurrentFrame];
	}
	public set hitarea(value: Area) {
	}

	public get DamageDealt(): number {
		return 1;
	}

	constructor(pos: Point, dir: Direction) {
		super({ x: pos.x, y: pos.y }, { x: 0, y: 0 });
		this.Direction = dir;
		this.pos = M._.Belmont.pos;
	}

	public TakeTurn(): void {
		if (M._.Belmont.Dying || !M._.Belmont.roeState.Roeing) {
			this.disposeFlag = true;
			return
		}
		this.pos = M._.Belmont.pos;
		this.CheckAndInvokeHit();
	}

	public Paint(offset: Point = null): void {
		// The tri-roe is part of the Belmont-sprite and is not drawn
	}

	public Dispose(): void {
	}
}