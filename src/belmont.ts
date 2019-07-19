import { Direction } from "./sintervaniamodel";
import { Creature } from "./creature";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { GameConstants as CS } from "./gameconstants";
import { copyPoint } from "../BoazEngineJS/common";
import { Animation } from "../BoazEngineJS/animation";

/*[Serializable]*/
export class RoeState {
	public static msPerFrame: number[] = [50, 25, 100];
	public aniTimer: BStopwatch;
	// 		public static RoeSprites: Map<Direction, BitmapId[]> = __init(new Map<Direction, BitmapId[]>(), { { Direction.Right, new Array(BitmapId.Belmont_rw1, BitmapId.Belmont_rw2, BitmapId.Belmont_rw3) },
	// 			{ Direction.Left, new Array(BitmapId.Belmont_lw1, BitmapId.Belmont_lw2, BitmapId.Belmont_lw3) } });
	// public static RoeSpritesCrouching: Map < Direction, BitmapId[] >  =  __init(new Map<Direction, BitmapId[]>(), { { Direction.Right, new Array(BitmapId.Belmont_rwd1, BitmapId.Belmont_rwd2, BitmapId.Belmont_rwd3) },
	// 				{ Direction.Left, new Array(BitmapId.Belmont_lwd1, BitmapId.Belmont_lwd2, BitmapId.Belmont_lwd3) } });
	// public static RoeSpritePosOffset: Dictionary < Direction, Point[] >  =  __init(new Dictionary<Direction, Point[]>(), { { Direction.Right, new Array(new Point(-16, 0), new Point(-16, 0), new Point(0, 0)) },
	// 					{ Direction.Left, new Array(new Point(0, 0), new Point(0, 0), new Point(-25, 0)) } });
	// public static RoeSpritePosOffsetCrouching: Dictionary < Direction, Point[] >  =  __init(new Dictionary<Direction, Point[]>(), { { Direction.Right, new Array(new Point(-16, 0), new Point(-16, 0), new Point(0, 0)) },
	// 						{ Direction.Left, new Array(new Point(0, 0), new Point(0, 0), new Point(-25, 0)) } });
	public Roeing: boolean;
	public CurrentFrame: number;
	public Start(): void {
		this.aniTimer.restart();
		this.Roeing = true;
		this.CurrentFrame = 0;
	}
	public Stop(): void {
		this.aniTimer.stop();
		this.Roeing = false;
		this.CurrentFrame = 0;
	}
	constructor() {
		this.aniTimer = new BStopwatch();
		this.Roeing = false;
		this.CurrentFrame = 0;
	}
}

/*[Serializable]*/
export class Belmont extends Creature {
	public Health: number;
	public MaxHealth: number;
	public get HealthPercentage(): number {
		return Math.min(<number>(Math.round(this.Health / <number>this.MaxHealth * 100)), 100);
	}
	private static MoveBeforeFrameChange: number = 4;
	public Crouching: boolean;
	public CarryingShield: boolean;
	public get RecoveringFromHit(): boolean {
		return this.hitState.CurrentStep != HitState.HitStateStep.None;
	}
	private firstPressedButton: Direction;
	private get movementSpeed(): number {
		return 2;
	}
	private state: State;
	public get Blink(): boolean {
		return this.hitState.Blink;
	}
	public get Dying(): boolean {
		return this.state == State.Dying || this.state == State.Dead;
	}
	public get Roeing(): boolean {
		return this.roeState.Roeing;
	}
	public get Jumping(): boolean {
		return this.jumpState.Jumping;
	}
	private hitState: HitState;
	private dyingState: DyingState;
	public roeState: RoeState;
	private jumpState: JumpState;
	// private static MovementSpritesNoShield: Map<Direction, BitmapId[]> = __init(new Map<Direction, BitmapId[]>(), { { Direction.Right, new Array(BitmapId.Belmont_r1, BitmapId.Belmont_r3, BitmapId.Belmont_r2, BitmapId.Belmont_r3, BitmapId.Belmont_r1) },
	//     { Direction.Left, new Array(BitmapId.Belmont_l1, BitmapId.Belmont_l3, BitmapId.Belmont_l2, BitmapId.Belmont_l3, BitmapId.Belmont_l1) } });
	// private static MovementSpritesNoShieldCrouching: Map < Direction, BitmapId[] >  =  __init(new Map<Direction, BitmapId[]>(), { { Direction.Right, new Array(BitmapId.Belmont_rd, BitmapId.Belmont_rd, BitmapId.Belmont_rd) },
	//         { Direction.Left, new Array(BitmapId.Belmont_ld, BitmapId.Belmont_ld, BitmapId.Belmont_ld) } });
	// private static MovementSpritesWShieldCrouching: Map < Direction, BitmapId[] >  =  __init(new Map<Direction, BitmapId[]>(), { { Direction.Right, new Array(BitmapId.Belmont_rd, BitmapId.Belmont_rd, BitmapId.Belmont_rd) },
	//     { Direction.Left, new Array(BitmapId.Belmont_ld, BitmapId.Belmont_ld, BitmapId.Belmont_ld) } });
	// private static MovementSpritesHit: Map < Direction, BitmapId[] >  =  __init(new Map<Direction, BitmapId[]>(), { { Direction.Right, new Array(BitmapId.Belmont_rhitfly, BitmapId.Belmont_rhitdown) },
	//     { Direction.Left, new Array(BitmapId.Belmont_lhitfly, BitmapId.Belmont_lhitdown) } });
	// private static MovementSpritesWShield: Map < Direction, BitmapId[] >  =  __init(new Map<Direction, BitmapId[]>(), {});
	protected get moveBeforeFrameChange(): number {
		return Belmont.MoveBeforeFrameChange;
	}
	protected get movementSprites(): Map<Direction, BitmapId[]> {
		if (this.CarryingShield)
			return Belmont.MovementSpritesWShield;
		return Belmont.MovementSpritesNoShield;
	}
	public get WallHitArea(): Area {
		return this.EventTouchHitArea;
	}
	public set WallHitArea(value: Area) {

	}
	public EventTouchHitArea: Area = new Area(0, 24, 16, 32);
	private static buttonPressEventHitAreaUp: Area = new Area(0, 20, 16, 28);
	private static buttonPressEventHitAreaRight: Area = new Area(4, 24, 20, 32);
	private static buttonPressEventHitAreaDown: Area = new Area(0, 28, 16, 36);
	private static buttonPressEventHitAreaLeft: Area = new Area(-4, 24, 12, 32);
	public get EventButtonHitArea(): Area {
		switch (this.Direction) {
			case Direction.Up:
				return Belmont.buttonPressEventHitAreaUp;
			case Direction.Right:
				return Belmont.buttonPressEventHitAreaRight;
			case Direction.Down:
				return Belmont.buttonPressEventHitAreaDown;
			case Direction.Left:
				return Belmont.buttonPressEventHitAreaLeft;
			default:
				return null;
		}
	}
	public get RoomCollisionArea(): Area {
		return this.EventTouchHitArea;
	}
	private static _hitarea: Area = new Area(2, 8, 14, 30);
	public get hitarea(): Area {
		return Belmont._hitarea;
	}
	public set hitarea(value: Area) {

	}
	public get Vulnerable(): boolean {
		return !this.hitState.BlinkingAndInvulnerable && !this.Dying;
	}
	constructor() {
		super(null);
		this.imgid = <number>BitmapId.Belmont_r1;
		this.flippedH = false;
		this.CarryingShield = false;
		this.Direction = Direction.Right;
		this.id = "Belmont";
		this.state = State.Normal;
		this.size.Set(16, 32);
		this.Health = CS.Belmont_MaxHealth_AtStart;
		this.MaxHealth = CS.Belmont_MaxHealth_AtStart;
		this.hitState = new HitState();
		this.dyingState = new DyingState();
		this.roeState = new RoeState();
		this.jumpState = new JumpState();
		this.hitState.BlinkTimer = BStopwatch.createWatch();
		this.hitState.RecoveryTimer = BStopwatch.createWatch();
		this.hitState.CrouchTimer = BStopwatch.createWatch();
		this.dyingState.aniTimer = BStopwatch.createWatch();
		this.roeState.aniTimer = BStopwatch.createWatch();
		this.SetExtendedProperty(M.PROPERTY_KEEP_AT_ROOMSWITCH, true);
	}
	public ResetToDefaultFrame(): void {
		this.currentWalkAnimationFrame = 0;
		this.moveLeftBeforeFrameChange = Belmont.MoveBeforeFrameChange;
		this.roeState.Stop();
		this.DetermineFrame();
		this.state = State.Normal;
	}
	public GetProjectileOrigin(): Point {
		let result: Point = copyPoint(this.pos);
		switch (this.Direction) {
			case Direction.Right:
				result.x += 8;
				result.y += 12;
				break;
			case Direction.Left:
				result.y += 12;
				break;
		}
		return result;
	}
	public TakeTurn(): void {
		if (this.state == State.Dying) {
			this.doDeath();
			return
		}
		if (this.state == State.Dead)
			return
		if (this.hitState.BlinkingAndInvulnerable) {
			if (Helpers.WaitDuration(this.hitState.BlinkTimer, HitState.BlinkTimePerSwitch))
				this.hitState.Blink = !this.hitState.Blink;
			if (Helpers.WaitDuration(this.hitState.RecoveryTimer, HitState.TotalBlinkTime)) {
				this.hitState.BlinkingAndInvulnerable = false;
				this.hitState.Blink = false;
				this.hitState.BlinkTimer.stop();
				this.hitState.RecoveryTimer.stop();
				this.state = State.Normal;
			}
		}
		if (this.hitState.CurrentStep == HitState.HitStateStep.Flying) {
			this.doHitFlying();
		}
		else if (this.hitState.CurrentStep == HitState.HitStateStep.Falling) {
			this.doHitFall();
		}
		else if (this.hitState.CurrentStep == HitState.HitStateStep.Crouching) {
			this.doHitCrouching();
		}
		else if (this.roeState.Roeing) {
			if (Helpers.WaitDuration(this.roeState.aniTimer, RoeState.msPerFrame[this.roeState.CurrentFrame])) {
				if (++this.roeState.CurrentFrame >= RoeState.msPerFrame.length) {
					this.roeState.Stop();
				}
				else {
					this.roeState.aniTimer.restart();
				}
			}
		}
		else {
			let walked: boolean = false;
			if (!this.FloorCollision || this.Jumping || this.hitState.CurrentStep != HitState.HitStateStep.None) {
				this.Crouching = false;
				walked = false;
				this.AnimateMovement(0);
			}
			else {
				this.handleInput(walked);
				if (walked) {
					this.doWalk();
				}
				else {
					this.AnimateMovement(0);
					this.firstPressedButton = Direction.None;
				}
			}
		}
		if (!this.FloorCollision && (!this.Jumping || !this.jumpState.GoingUp) && this.hitState.CurrentStep != HitState.HitStateStep.Flying && this.hitState.CurrentStep != HitState.HitStateStep.Falling) {
			let originalPos = Point.Copy(this.pos);
			this.checkAndHandleCollisions(originalPos);
			if (!this.FloorCollision)
				this.pos.y += 4;
			this.checkAndHandleCollisions(originalPos);
			if (this.FloorCollision)
				S.PlayEffect(RM.Sound[AudioId.Land]);
		}
		if (this.Jumping) {
			this.doJump();
		}
		this.DetermineFrame();
	}
	protected doHitFlying(): void {
		let delta: Point = new Point();
		this.hitState.HitAni.DoAnimation(1, delta);
		let originalPos = copyPoint(this.pos);
		this.pos.x += this.Direction == Direction.Right ? delta.x : -delta.x;
		let dir = this.Direction;
		this.Direction = this.Direction == Direction.Left ? Direction.Right : Direction.Left;
		this.checkAndHandleWallAndCeilingCollisions(originalPos);
		this.Direction = dir;
		this.pos.y += delta.y;
		if (!this.hitState.HitAni.HasNext) {
			this.hitState.CurrentStep = HitState.HitStateStep.Falling;
		}
	}
	protected doHitFall(): void {
		let originalPos = copyPoint(this.pos);
		this.pos.x += this.Direction == Direction.Right ? -2 : 2;
		let dir = this.Direction;
		this.Direction = this.Direction == Direction.Left ? Direction.Right : Direction.Left;
		this.checkAndHandleWallAndCeilingCollisions(originalPos);
		this.Direction = dir;
		if (!this.FloorCollision) {
			this.pos.y += 4;
			if (this.FloorCollision) {
				this.handleFloorCollision();
			}
		}
	}
	protected doHitCrouching(): void {
		if (Helpers.WaitDuration(this.hitState.CrouchTimer, HitState.CrouchTime)) {
			this.hitState.CurrentStep = HitState.HitStateStep.None;
			if (this.Health <= 0) {
				this.initDyingState();
				C._.BelmontDied();
			}
		}
	}
	protected doJump(): void {
		let originalPos = copyPoint(this.pos);
		this.pos.y += this.jumpState.JumpAni.stepValue();
		let dummy: number = 0;
		this.jumpState.JumpAni.DoAnimation(1, dummy);
		if (!this.jumpState.JumpAni.HasNext) {
			this.jumpState.Stop();
		}
		this.checkAndHandleWallAndCeilingCollisions(originalPos);
		originalPos = copyPoint(this.pos);
		if (this.jumpState.JumpDirection == Direction.Right)
			this.pos.x += this.movementSpeed;
		if (this.jumpState.JumpDirection == Direction.Left)
			this.pos.x -= this.movementSpeed;
		if (this.jumpState.GoingUp) {
			this.checkAndHandleWallAndCeilingCollisions(originalPos);
		}
		else {
			this.checkAndHandleCollisions(originalPos);
		}
	}
	public doWalk(): void {
		if (this.currentWalkAnimationFrame == 0)
			this.currentWalkAnimationFrame = 1;
		this.AnimateMovement(1);
		if (!this.multipleDirButtonsPressed())
			this.firstPressedButton = this.Direction;
	}
	public DetermineFrame(): void {
		switch (this.state) {
			case State.Normal:
			case State.HitRecovery:
				if (this.hitState.CurrentStep != HitState.HitStateStep.None) {
					if (this.hitState.CurrentStep == HitState.HitStateStep.Falling || this.hitState.CurrentStep == HitState.HitStateStep.Flying)
						this.imgid = this.Direction == Direction.Right ? <number>BitmapId.Belmont_rhitfly : <number>BitmapId.Belmont_lhitfly;
					else this.imgid = this.Direction == Direction.Right ? <number>BitmapId.Belmont_rhitdown : <number>BitmapId.Belmont_lhitdown;
				}
				else if (!this.roeState.Roeing) {
					if (!this.Crouching && !this.Jumping) {
						this.imgid = this.CarryingShield ? <number>Belmont.MovementSpritesWShield[this.Direction][this.currentWalkAnimationFrame] : <number>Belmont.MovementSpritesNoShield[this.Direction][this.currentWalkAnimationFrame];
					}
					else {
						this.imgid = this.CarryingShield ? <number>Belmont.MovementSpritesWShieldCrouching[this.Direction][this.currentWalkAnimationFrame] : <number>Belmont.MovementSpritesNoShieldCrouching[this.Direction][this.currentWalkAnimationFrame];
					}
				}
				else {
					if (!this.Crouching && !this.Jumping) {
						this.imgid = <number>Belmont.RoeState.RoeSprites[this.Direction][this.roeState.CurrentFrame];
					}
					else {
						this.imgid = <number>Belmont.RoeState.RoeSpritesCrouching[this.Direction][this.roeState.CurrentFrame];
					}
				}
				break;
			case State.Dying:
			case State.Dead:
				break;
		}
	}
	public TakeDamage(amount: number): void {
		if (!this.hittable)
			return
		if (this.state != State.HitRecovery && this.state != State.Dying) {
			this.Health -= amount;
			this.initHitRecoveryState();
			if (this.jumpState.Jumping)
				this.jumpState.Stop();
			if (this.Roeing) {
				this.roeState.Stop();
			}
			S.PlayEffect(RM.Sound[AudioId.PlayerDamage]);
		}
	}
	private doDeath(): void {
		let stepValue: DyingState.BitmapAndDir = new DyingState.BitmapAndDir();
		if (this.dyingState.DeathAni.doAnimation(this.dyingState.aniTimer, stepValue)) {
			if (this.dyingState.DeathAni.finished()) {
				C._.BelmontDeathAniFinished();
				this.dyingState.Stop();
				this.state = State.Dead;
			}
			else {
				this.imgid = <number>stepValue.image;
			}
		}
	}
	public UseRoe(): void {
		if (!this.Roeing && this.state != State.Dying) {
			this.initRoeState();
		}
	}
	private initHitRecoveryState(): void {
		this.state = State.HitRecovery;
		this.hitState.Start();
	}
	private initDyingState(): void {
		this.dyingState.Start();
		this.state = State.Dying;
	}
	private initRoeState(): void {
		this.roeState.Start();
		this.DetermineFrame();
	}
	private handleInput(moved: boolean): void {
		if (I.KeyState.KD_DOWN && !this.ignoreDirButtonPress(Direction.Down)) {
			this.Crouching = true;
			if (I.KeyState.KD_RIGHT && !this.ignoreDirButtonPress(Direction.Right))
				this.Direction = Direction.Right;
			if (I.KeyState.KD_LEFT && !this.ignoreDirButtonPress(Direction.Left))
				this.Direction = Direction.Left;
		}
		else if (I.KeyState.KC_UP && !this.ignoreDirButtonPress(Direction.Up)) {
			this.Crouching = false;
			let jumpDir: Direction = Direction.Up;
			if (I.KeyState.KD_RIGHT) {
				jumpDir = Direction.Right;
				this.Direction = Direction.Right;
			}
			else if (I.KeyState.KD_LEFT) {
				jumpDir = Direction.Left;
				this.Direction = Direction.Left;
			}
			this.jumpState.Start(jumpDir);
		}
		else if (I.KeyState.KD_RIGHT && !this.ignoreDirButtonPress(Direction.Right)) {
			this.Crouching = false;
			this.doMovement(Direction.Right, moved);
		}
		else if (I.KeyState.KD_LEFT && !this.ignoreDirButtonPress(Direction.Left)) {
			this.Crouching = false;
			this.doMovement(Direction.Left, moved);
		}
		else {
			this.Crouching = false;
			this.firstPressedButton = Direction.None;
		}
	}
	private doMovement(dir: Direction, moved: boolean): void {
		let speed = this.movementSpeed;
		let originalPos = copyPoint(this.pos);
		switch (dir) {
			case Direction.Right:
				this.pos.x += speed;
				this.Direction = Direction.Right;
				break;
			case Direction.Left:
				this.pos.x -= speed;
				this.Direction = Direction.Left;
				break;
		}
		this.checkAndHandleCollisions(originalPos);
		moved = true;
	}
	private checkAndHandleWallAndCeilingCollisions(originalPos: Point): void {
		if (this.checkWallSpriteCollisions())
			this.pos.Set(originalPos);
		if (this.checkWallCollision())
			this.handleWallCollision();
		if (this.CeilingCollision) {
			this.handleCeilingCollision();
		}
		let possibleRoomExit = this.nearRoomExit();
		if (possibleRoomExit != null && possibleRoomExit ?.destRoom != Room.NO_ROOM_EXIT) {
			C._.HandleRoomExitViaMovement(possibleRoomExit.Value.destRoom, possibleRoomExit.Value.direction);
		}
	}
	private checkAndHandleFloorCollisions(originalPos: Point): void {
		if (this.FloorCollision) {
			this.handleFloorCollision();
		}
		else this.checkAndHandleRoomExit();
	}
	private checkAndHandleCollisions(originalPos: Point): void {
		this.checkAndHandleWallAndCeilingCollisions(originalPos);
		this.checkAndHandleFloorCollisions(originalPos);
	}
	private checkAndHandleRoomExit(): void {
		let possibleRoomExit = this.nearRoomExit();
		if (possibleRoomExit != null && possibleRoomExit ?.destRoom != Room.NO_ROOM_EXIT) {
			C._.HandleRoomExitViaMovement(possibleRoomExit.Value.destRoom, possibleRoomExit.Value.direction);
		}
	}
	protected checkWallCollision(): boolean {
		switch (this.Direction) {
			case Direction.Right:
				return M._.CurrentRoom.IsCollisionTile(this.pos.x + 16, this.pos.y + 25, true) || M._.CurrentRoom.IsCollisionTile(this.pos.x + 16, this.pos.y + 31, true);
			case Direction.Left:
				return M._.CurrentRoom.IsCollisionTile(this.pos.x, this.pos.y + 25, true) || M._.CurrentRoom.IsCollisionTile(this.pos.x, this.pos.y + 31, true);
			default:
				return false;
		}
	}
	protected handleWallCollision(): void {
		switch (this.Direction) {
			case Direction.Right:
				this.pos.x = (this.pos.x / CS.TileSize) * CS.TileSize;
				break;
			case Direction.Down:
				this.pos.y = (this.pos.y / CS.TileSize) * CS.TileSize;
				break;
			case Direction.Left:
				if (this.pos.x >= 0)
					this.pos.x = (this.pos.x / CS.TileSize + 1) * CS.TileSize;
				this.pos.x = this.pos.x / CS.TileSize * CS.TileSize;
				break;
		}
	}
	protected get CeilingCollision(): boolean {
		return M._.CurrentRoom.IsCollisionTile(this.pos.x + 1, this.pos.y + 8, true) || M._.CurrentRoom.IsCollisionTile(this.pos.x + 15, this.pos.y + 8, true);
	}
	protected get FloorCollision(): boolean {
		return M._.CurrentRoom.IsCollisionTile(this.pos.x + 1, this.pos.y + 32, true) || M._.CurrentRoom.IsCollisionTile(this.pos.x + 15, this.pos.y + 32, true);
	}
	protected handleFloorCollision(): void {
		this.pos.y = (this.pos.y / CS.TileSize) * CS.TileSize;
		if (this.Jumping) {
			this.jumpState.Stop();
		}
		if (this.hitState.CurrentStep == HitState.HitStateStep.Falling) {
			this.hitState.CurrentStep = HitState.HitStateStep.Crouching;
			this.hitState.CrouchTimer.restart();
		}
	}
	protected handleCeilingCollision(): void {
		if (this.pos.y >= 0)
			this.pos.y = (this.pos.y / CS.TileSize + 1) * CS.TileSize;
		else this.pos.y = (this.pos.y / CS.TileSize) * CS.TileSize;
		this.jumpState.GoingUp = false;
	}
	// private (int destRoom, Direction direction)? nearRoomExit() {
	// 	let exitUp = M._.CurrentRoom.NearingRoomExit(this.pos.x + 1, this.pos.y + 8); // 24
	// 	if (exitUp != null) return exitUp;
	// 	let exitRight = M._.CurrentRoom.NearingRoomExit(this.pos.x + 16, this.pos.y + 25);
	// 	if (exitRight != null) return exitRight;
	// 	let exitDown = M._.CurrentRoom.NearingRoomExit(this.pos.x + 1, this.pos.y + 32);
	// 	if (exitDown != null) return exitDown;
	// 	let exitLeft = M._.CurrentRoom.NearingRoomExit(this.pos.x, this.pos.y + 25);
	// 	if (exitLeft != null) return exitLeft;

	// 	return null;
	// }
	private ignoreDirButtonPress(dir: Direction): boolean {
		return this.multipleDirButtonsPressed() && dir == this.firstPressedButton;
	}
	private multipleDirButtonsPressed(): boolean {
		let u: number = I.KeyState.KD_UP ? 1 : 0;
		let r: number = I.KeyState.KD_RIGHT ? 1 : 0;
		let d: number = I.KeyState.KD_DOWN ? 1 : 0;
		let l: number = I.KeyState.KD_LEFT ? 1 : 0;
		return u + r + d + l > 1;
	}
	public Paint(offset: Point = null): void {
		let roeOffset = new Point();
		if (this.Roeing) {
			if (!this.Crouching) {
				roeOffset.x += RoeState.RoeSpritePosOffset[this.Direction][this.roeState.CurrentFrame].x;
				roeOffset.y += RoeState.RoeSpritePosOffset[this.Direction][this.roeState.CurrentFrame].y;
			}
			else {
				roeOffset.x += RoeState.RoeSpritePosOffsetCrouching[this.Direction][this.roeState.CurrentFrame].x;
				roeOffset.y += RoeState.RoeSpritePosOffsetCrouching[this.Direction][this.roeState.CurrentFrame].y;
			}
		}
		if (!this.hitState.Blink || C._.InEventState) {
			let options: number = this.flippedH ? <number>DrawBitmap.HFLIP : 0;
			if (offset == null)
				BDX._.DrawBitmap(this.imgid, this.pos.x + roeOffset.x, this.pos.y + roeOffset.y, options);
			else BDX._.DrawBitmap(this.imgid, this.pos.x + roeOffset.x + offset.x, this.pos.y + roeOffset.y + offset.y, options);
		}
		else {
			if (this.disposeFlag || !this.visible)
				return
			let options: number = this.flippedH ? <number>DrawBitmap.HFLIP : 0;
			if (offset == null)
				BDX._.DrawColoredBitmap(this.imgid, pos.x + roeOffset.x, pos.y + roeOffset.y, options, 50.0f, .0f, .0f);
			else BDX._.DrawColoredBitmap(this.imgid, pos.x + roeOffset.x + offset.x, pos.y + roeOffset.y + offset.y, options, 50.0f, .0f, .0f);
		}
	}
	public Dispose(): void {
		BStopwatch.removeWatch(this.hitState.BlinkTimer);
		BStopwatch.removeWatch(this.hitState.RecoveryTimer);
		BStopwatch.removeWatch(this.dyingState.aniTimer);
		BStopwatch.removeWatch(this.roeState.aniTimer);
	}
}
export enum State {
	Normal,
	HitRecovery,
	Dying,
	Dead
}
/*[Serializable]*/
export class JumpState {
	public JumpTimer: BStopwatch;
	public Jumping: boolean;
	public GoingUp: boolean;
	public JumpDirection: Direction;
	// public static jumpYDelta: number[] = 0,-8, -4, -4, -4, -4, -4, -4, -4, -2, -2, -1, -1, 0, 0, 0, 0, 1, 1, 2, 2, 4, 4, 4, 4, 4, 4, 4, 8, 0;
	public JumpAni: Animation<number>;
	public get JumpHeightReached(): boolean {
		return this.JumpAni.stepValue() >= 0;
	}
	constructor() {
		this.JumpTimer = new BStopwatch();
		this.Jumping = false;
		this.GoingUp = false;
		this.JumpAni = new Animation<number>(JumpState.jumpYDelta, null, 1);
	}
	public Stop(): void {
		this.JumpTimer.stop();
		this.Jumping = false;
		this.GoingUp = false;
	}
	public Start(jumpDir: Direction): void {
		this.JumpTimer.restart();
		this.Jumping = true;
		this.GoingUp = true;
		this.JumpDirection = jumpDir;
		this.JumpAni.restart();
	}
}
/*[Serializable]*/
export class HitState {
	public static TotalBlinkTime: number = 2000;
	public static BlinkTimePerSwitch: number = 20;
	public static CrouchTime: number = 500;
	public BlinkTimer: BStopwatch;
	public RecoveryTimer: BStopwatch;
	public CrouchTimer: BStopwatch;
	public Blink: boolean;
	public BlinkingAndInvulnerable: boolean;
	public CurrentStep: HitStateStep;
	public static hitDelta: Point[] = new Array(new Point(-2, -2),
		new Point(-2, -2),
		new Point(-2, -2),
		new Point(-2, -2),
		new Point(-2, -2),
		new Point(-2, -2),
		new Point(-1, -1),
		new Point(-1, -1),
		new Point(-1, -1),
		new Point(-1, -1),
		new Point(-1, 0),
		new Point(-1, 0),
		new Point(-1, 0),
		new Point(-1, 0),
		new Point(-2, 1),
		new Point(-2, 1),
		new Point(-2, 1),
		new Point(-2, 1));
	public HitAni: Animation<Point>;
	constructor() {
		this.Blink = false;
		this.BlinkingAndInvulnerable = false;
		this.CurrentStep = HitState.HitStateStep.None;
		this.HitAni = new Animation<Point>(HitState.hitDelta,/*constantStepTime:*/1);
	}
	public Stop(): void {
		this.BlinkTimer.Stop();
		this.RecoveryTimer.Stop();
		this.CrouchTimer.Stop();
		this.Blink = false;
		this.BlinkingAndInvulnerable = false;
		this.CurrentStep = HitStateStep.None;
	}
	public Start(): void {
		this.Blink = true;
		this.BlinkingAndInvulnerable = true;
		this.CurrentStep = HitState.HitStateStep.Flying;
		this.BlinkTimer.restart();
		this.RecoveryTimer.restart();
		this.CrouchTimer.Reset();
		this.HitAni.restart();
	}
}
export enum HitStateStep {
	None,
	Flying,
	Falling,
	Crouching
}
/*[Serializable]*/
export class DyingState {
	public DeathAni: Animation<BitmapAndDir>;
	public static MsPerFrame: number = 300;
	protected static dyingFrames: BitmapAndDir[] = new Array(__init(new BitmapAndDir(), { image: BitmapId.Belmont_rhitdown, dir: Direction.Right }),
		__init(new BitmapAndDir(), { image: BitmapId.Belmont_rdead, dir: Direction.Right }));
	protected static dyingFrameTimes: number[] = 100,
	2000;
	public aniTimer: BStopwatch;
	public Start(): void {
		this.aniTimer.restart();
		this.DeathAni.restart();
	}
	public Stop(): void {
		this.aniTimer.stop();
	}
	constructor() {
		this.DeathAni = new Animation<BitmapAndDir>(DyingState.dyingFrames, DyingState.dyingFrameTimes);
	}
}
export module DyingState {
	/*[Serializable]*/
	export class BitmapAndDir {
		public image: BitmapId;
		public dir: Direction;
	}
}