import { Animation, AniStepCompoundValue, AniData } from '../BoazEngineJS/animation';
import { BStopwatch } from "../BoazEngineJS/btimer";
import { BossFoe } from "./bossfoe";
import { Direction } from "../BoazEngineJS/direction";
import { AudioId, BitmapId } from "resourceids";
import { PlayerProjectile } from "./pprojectile";
import { Area, Point } from '../BoazEngineJS/interfaces';
import { newArea, newSize } from '../BoazEngineJS/common';

/*[Serializable]*/
enum PietulaState {
	None,
	ThrowingZakFoes,
	Bla
}

type AniType = { img: BitmapId, dy: number };

export class Pietula extends BossFoe {
	public get DamageToPlayer(): number {
		return 5;
	}

	protected get moveBeforeFrameChange(): number {
		return 0;
	}

	public get RespawnAtRoomEntry(): boolean {
		return true;
	}

	protected static PietulaHitArea: Area = newArea(0, 0, 10, 16);
	protected static pietulaSprites: Map<Direction, BitmapId[]> = new Map([[Direction.None, [BitmapId.Pietula_1]]]);

	protected timer: BStopwatch;
	protected state: PietulaState;
	protected animation: Animation<AniType>;

	protected get movementSprites(): Map<Direction, BitmapId[]> {
		return Pietula.pietulaSprites;
	}

	protected static AnimationFrames: AniData<AniType>[] = new Array(
		{ time: 250, data: { img: BitmapId.Pietula_1, dy: -1 } },
		{ time: 250, data: { img: BitmapId.Pietula_2, dy: 1 } },
	);

	constructor(pos: Point) {
		super(pos);
		this.CanHurtPlayer = true;
		this.animation = new Animation<AniType>(Pietula.AnimationFrames, null, true);
		this.timer = BStopwatch.createWatch();
		this.imgid = this.animation.stepValue().img;
		this.timer.restart();
		this.hitarea = Pietula.PietulaHitArea;
		this.size = newSize(this.hitarea.end.x, this.hitarea.end.y);
		this.Health = 20;
	}

	public StartBossfight(): void {
		throw "Not implemented!";
	}

	public TakeTurn(): void {
		let stepValue: AniStepCompoundValue<AniType> = { nextStepValue: { img: this.imgid, dy: 0 } };
		this.animation.doAnimation(this.timer, stepValue);
		this.imgid = stepValue.nextStepValue.img;
		this.pos.y += stepValue.nextStepValue.dy;
	}

	public Dispose(): void {
		BStopwatch.removeWatch(this.timer);
	}

	public HandleHit(source: PlayerProjectile): void {
		super.HandleHit(source);
		this.loseHealth(source);
	}

	public Paint(offset: Point = null): void {
		super.Paint(offset);
	}

	public Die(): void {
		super.Die();
	}
}