import { BStopwatch } from "../BoazEngineJS/btimer";
import { BossFoe } from "./bossfoe";
import { Direction } from "../BoazEngineJS/direction";
import { BitmapId } from "./resourceids";
import { PlayerProjectile } from "./pprojectile";

/*[Serializable]*/
enum PietulaState {
	None,
	ThrowingZakFoes,
	Bla
}

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

	protected static PietulaHitArea: Area = new Area(0, 0, 10, 16);
	// protected static pietulaSprites: Map<Direction, BitmapId[]> = __init(new Map<Direction, BitmapId[]>(), { { Direction.None, BitmapId.Pietula_1 } });
	protected timer: BStopwatch;
	protected state: PietulaState;

	protected get movementSprites(): Map<Direction, BitmapId[]> {
		return Pietula.pietulaSprites;
	}

	constructor(pos: Point) {
		super(pos);
		this.CanHurtPlayer = true;
		@"this.animation = new Animation<(uint img, int dy)>(AnimationFrames) {			Repeat = true	} ";
		this.timer = BStopwatch.createWatch();
		this.imgid = <number>this.animation.stepValue().img;
		this.timer.restart();
		this.hitarea = Pietula.PietulaHitArea;
		this.size = new Size(this.hitarea.ex, this.hitarea.ey);
		this.Health = 20;
	}

	public StartBossfight(): void {
		throw "Not implemented!";
	}

	public TakeTurn(): void {
		@"(uint img, int dy) stepValue = (this.imgid, 0);"
		this.animation.doAnimation(this.timer, ref stepValue);
		this.imgid = stepValue.img;
		this.pos.y += stepValue.dy;
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