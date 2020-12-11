import { BStopwatch, Sprite, model, controller } from "../bmsx/engine";
import { Animation } from "../bmsx/animation";
import { BitmapId, AudioId } from './resourceids';
import { Direction, Point, newPoint, Area, newArea, copyPoint, waitDuration, addPoints, newSize, mod } from '../bmsx/common';
import { TileSize } from '../bmsx/msx';
import { SM } from '../bmsx/soundmaster';
import { Input } from '../bmsx/input';
import { Room, NearingRoomExitResult } from './room';
import { Model } from './gamemodel';
import { GameConstants as CS } from './gameconstants';
import { Controller } from './gamecontroller';

export class RoeState {
	public static framesPerDrawing: number[] = [4, 2, 8];
	public aniTimer: BStopwatch;
	public static RoeSprites: Map<Direction, BitmapId[]> = new Map([
		[Direction.Right, [BitmapId.Belmont_rw1, BitmapId.Belmont_rw2, BitmapId.Belmont_rw3]],
		[Direction.Left, [BitmapId.Belmont_lw1, BitmapId.Belmont_lw2, BitmapId.Belmont_lw3]],
	]);

	public static RoeSpritesCrouching: Map<Direction, BitmapId[]> = new Map([
		[Direction.Right, [BitmapId.Belmont_rwd1, BitmapId.Belmont_rwd2, BitmapId.Belmont_rwd3]],
		[Direction.Left, [BitmapId.Belmont_lwd1, BitmapId.Belmont_lwd2, BitmapId.Belmont_lwd3]],
	]);
	public static RoeSpritePosOffset: Map<Direction, Point[]> = new Map<Direction, Point[]>([
		[Direction.Right, [newPoint(-16, 0), newPoint(-16, 0), newPoint(0, 0)]],
		[Direction.Left, [newPoint(0, 0), newPoint(0, 0), newPoint(-25, 0)]],
	]);
	public static RoeSpritePosOffsetCrouching: Map<Direction, Point[]> = new Map<Direction, Point[]>([
		[Direction.Right, [newPoint(-16, 0), newPoint(-16, 0), newPoint(0, 0)]],
		[Direction.Left, [newPoint(0, 0), newPoint(0, 0), newPoint(-25, 0)]],
	]);

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

export class Belmont extends Sprite {
	public Health: number;
	public MaxHealth: number;
	public get HealthPercentage(): number {
		return ~~Math.round((this.Health / this.MaxHealth) * 100);
	}

	private static MoveBeforeFrameChange: number = 4;
	public Crouching: boolean;
	public CarryingShield: boolean;

	public get RecoveringFromHit(): boolean {
		return this.hitState.CurrentStep != HitStateStep.None;
	}

	private firstPressedButton: Direction;
	private get movementSpeed(): number {
		return 2;
	}

	protected moveLeftBeforeFrameChange: number = 0;
	protected currentWalkAnimationFrame: number = 0;

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
	private static MovementSpritesNoShield: Map<Direction, BitmapId[]> = new Map<Direction, BitmapId[]>([
		[Direction.Right, [BitmapId.Belmont_r1, BitmapId.Belmont_r3, BitmapId.Belmont_r2, BitmapId.Belmont_r3, BitmapId.Belmont_r1]],
		[Direction.Left, [BitmapId.Belmont_l1, BitmapId.Belmont_l3, BitmapId.Belmont_l2, BitmapId.Belmont_l3, BitmapId.Belmont_l1]],
	]);

	private static MovementSpritesNoShieldCrouching: Map<Direction, BitmapId[]> = new Map<Direction, BitmapId[]>([
		[Direction.Right, [BitmapId.Belmont_rd, BitmapId.Belmont_rd, BitmapId.Belmont_rd]],
		[Direction.Left, [BitmapId.Belmont_ld, BitmapId.Belmont_ld, BitmapId.Belmont_ld]]
	]);

	private static MovementSpritesWShieldCrouching: Map<Direction, BitmapId[]> = new Map<Direction, BitmapId[]>([
		[Direction.Right, [BitmapId.Belmont_rd, BitmapId.Belmont_rd, BitmapId.Belmont_rd]],
		[Direction.Left, [BitmapId.Belmont_ld, BitmapId.Belmont_ld, BitmapId.Belmont_ld]],
	]);

	private static MovementSpritesWShield: Map<Direction, BitmapId[]> = new Map<Direction, BitmapId[]>([]);

	protected get moveBeforeFrameChange(): number {
		return Belmont.MoveBeforeFrameChange;
	}

	protected get movementSprites(): Map<Direction, BitmapId[]> {
		if (this.CarryingShield)
			return Belmont.MovementSpritesWShield;
		return Belmont.MovementSpritesNoShield;
	}

	public get wallHitArea(): Area {
		return this.EventTouchHitArea;
	}

	public set wallHitArea(value: Area) {
	}

	public EventTouchHitArea: Area = newArea(0, 2, 15, 31);
	private static buttonPressEventHitAreaUp: Area = newArea(0, 20, 16, 28);
	private static buttonPressEventHitAreaRight: Area = newArea(4, 24, 20, 32);
	private static buttonPressEventHitAreaDown: Area = newArea(0, 28, 16, 36);
	private static buttonPressEventHitAreaLeft: Area = newArea(-4, 24, 12, 32);

	public get EventButtonHitArea(): Area {
		switch (this.direction) {
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

	public get hitarea(): Area {
		return this._hitarea;
	}

	public set hitarea(value: Area) {
		this._hitarea = value;
	}

	public get Vulnerable(): boolean {
		return !this.hitState.BlinkingAndInvulnerable && !this.Dying;
	}

	public setx(newx: number) {
		let oldx = this.pos.x;
		this.pos.x = ~~newx;
		if (newx < oldx) {
			if ((model as Model).currentRoom.isCollisionTile(this.wallhitbox_sx, this.wallhitbox_sy) ||
				(model as Model).currentRoom.isCollisionTile(this.wallhitbox_sx, this.wallhitbox_ey)) {
				newx += TileSize - mod(newx, TileSize);
			}
		}
		else if (newx > oldx) {
			if ((model as Model).currentRoom.isCollisionTile(this.wallhitbox_ex, this.wallhitbox_sy) ||
				(model as Model).currentRoom.isCollisionTile(this.wallhitbox_ex, this.wallhitbox_ey)) {
				newx -= newx % TileSize;
			}
		}
		this.pos.x = ~~newx;
		this.checkAndHandleRoomExit();
	}

	public sety(newy: number) {
		let oldy = this.pos.y;
		this.pos.y = ~~newy;
		if (newy < oldy) {
			if ((model as Model).currentRoom.isCollisionTile(this.wallhitbox_sx, this.wallhitbox_sy) ||
				(model as Model).currentRoom.isCollisionTile(this.wallhitbox_ex, this.wallhitbox_sy)) {
				this.handleCeilingCollision();
				newy += TileSize - mod(newy, TileSize);
			}
		}
		else if (newy > oldy) {
			if ((model as Model).currentRoom.isCollisionTile(this.wallhitbox_sx, this.wallhitbox_ey) ||
				(model as Model).currentRoom.isCollisionTile(this.wallhitbox_ex, this.wallhitbox_ey)) {
				this.handleFloorCollision();
				newy -= newy % TileSize;
			}
		}
		this.pos.y = ~~newy;
		this.checkAndHandleRoomExit();
	}

	constructor() {
		super();
		this.imgid = BitmapId.Belmont_r1;
		this._hitarea = newArea(0, 2, 15, 31)
		this.flippedH = false;
		this.CarryingShield = false;
		this.direction = Direction.Right;
		this.id = "Belmont";
		this.state = State.Normal;
		this.size = newSize(16, 32);
		this.Health = CS.Belmont_MaxHealth_AtStart;
		this.MaxHealth = CS.Belmont_MaxHealth_AtStart;
		this.Crouching = false;
		this.hitState = new HitState();
		this.dyingState = new DyingState();
		this.roeState = new RoeState();
		this.jumpState = new JumpState();
		this.hitState.BlinkTimer = BStopwatch.createWatch();
		this.hitState.RecoveryTimer = BStopwatch.createWatch();
		this.hitState.CrouchTimer = BStopwatch.createWatch();
		this.dyingState.aniTimer = BStopwatch.createWatch();
		this.roeState.aniTimer = BStopwatch.createWatch();
		this.disposeOnSwitchRoom = false;
		this.z = 200;
	}

	public ResetToDefaultFrame(): void {
		this.currentWalkAnimationFrame = 0;
		this.moveLeftBeforeFrameChange = Belmont.MoveBeforeFrameChange;
		this.roeState.Stop();
		this.determineFrame();
		this.state = State.Normal;
	}

	public GetProjectileOrigin(): Point {
		let result: Point = copyPoint(this.pos);
		switch (this.direction) {
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

	public takeTurn(): void {
		if (this.state == State.Dying) {
			this.doDeath();
			return;
		}
		if (this.state == State.Dead)
			return;
		if (this.hitState.BlinkingAndInvulnerable) {
			if (waitDuration(this.hitState.BlinkTimer, HitState.BlinkTimePerSwitch))
				this.hitState.Blink = !this.hitState.Blink;
			if (waitDuration(this.hitState.RecoveryTimer, HitState.TotalBlinkTime)) {
				this.hitState.BlinkingAndInvulnerable = false;
				this.hitState.Blink = false;
				this.hitState.BlinkTimer.stop();
				this.hitState.RecoveryTimer.stop();
				this.state = State.Normal;
			}
		}
		if (this.hitState.CurrentStep == HitStateStep.Flying) {
			this.doHitFlying();
		}
		else if (this.hitState.CurrentStep == HitStateStep.Falling) {
			this.doHitFall();
		}
		else if (this.hitState.CurrentStep == HitStateStep.Crouching) {
			this.doHitCrouching();
		}
		else if (this.roeState.Roeing) {
			if (waitDuration(this.roeState.aniTimer, RoeState.framesPerDrawing[this.roeState.CurrentFrame])) {
				if (++this.roeState.CurrentFrame >= RoeState.framesPerDrawing.length) {
					this.roeState.Stop();
				}
				else {
					this.roeState.aniTimer.restart();
				}
			}
		}
		else {
			let walked: boolean = false;
			if (!this.FloorCollision || this.Jumping || this.hitState.CurrentStep != HitStateStep.None) {
				this.Crouching = false;
				walked = false;
				this.animateMovement(0);
			}
			else {
				walked = this.handleInput().moved;
				if (walked) {
					this.doWalk();
				}
				else {
					this.animateMovement(0);
					this.firstPressedButton = Direction.None;
				}
			}
		}
		if (!this.FloorCollision && (!this.Jumping || !this.jumpState.GoingUp) && this.hitState.CurrentStep != HitStateStep.Flying && this.hitState.CurrentStep != HitStateStep.Falling) {
			if (!this.FloorCollision)
				this.sety(this.pos.y + 4);
			if (this.FloorCollision) {
				SM.play(AudioId.Land);
				if (this.Jumping) this.jumpState.Stop();
			}
		}
		if (this.Jumping) {
			this.doJump();
		}
		this.determineFrame();
	}

	protected doHitFlying(): void {
		let delta = this.hitState.HitAni.doAnimation(1, <Point>{ x: 0, y: 0 });
		let originalPos = copyPoint(this.pos);
		this.setx(this.pos.x + (this.direction == Direction.Right ? delta.stepValue.x : -delta.stepValue.x));
		let dir = this.direction;
		this.direction = this.direction == Direction.Left ? Direction.Right : Direction.Left;
		this.direction = dir;
		this.sety(this.pos.y + delta.stepValue.y);
		if (this.hitState.HitAni.hasNext === false) {
			this.hitState.CurrentStep = HitStateStep.Falling;
		}
	}

	protected doHitFall(): void {
		this.setx(this.pos.x + (this.direction == Direction.Right ? -2 : 2));
		let dir = this.direction;
		this.direction = this.direction == Direction.Left ? Direction.Right : Direction.Left;
		this.direction = dir;
		if (this.FloorCollision) this.handleFloorCollision();
		else {
			this.sety(this.pos.y + 4);
			if (this.FloorCollision) this.handleFloorCollision();
		}
	}

	protected doHitCrouching(): void {
		if (waitDuration(this.hitState.CrouchTimer, HitState.CrouchTime)) {
			this.hitState.CurrentStep = HitStateStep.None;
			if (this.Health <= 0) {
				this.initDyingState();
				(controller as Controller).BelmontDied();
			}
		}
	}

	protected doJump(): void {
		if (!this.jumpState.JumpAni.finished) {
			this.sety(this.pos.y + this.jumpState.JumpAni.stepValue);
			this.jumpState.JumpAni.doAnimation(1);
			if (this.jumpState.JumpAni.finished) {
				this.jumpState.GoingDownAfterAnimation();
			}
		}
		else if (this.FloorCollision) {
			this.jumpState.Stop();
		}
		if (this.jumpState.JumpDirection == Direction.Right)
			this.setx(this.pos.x + this.movementSpeed);
		if (this.jumpState.JumpDirection == Direction.Left)
			this.setx(this.pos.x - this.movementSpeed);
	}

	public doWalk(): void {
		if (this.currentWalkAnimationFrame == 0)
			this.currentWalkAnimationFrame = 1;
		this.animateMovement(1);
		if (!this.multipleDirButtonsPressed())
			this.firstPressedButton = this.direction;
	}

	protected animateMovement(movedDistance: number): void {
		if (movedDistance > 0) {
			this.moveLeftBeforeFrameChange -= movedDistance;
			if (this.moveLeftBeforeFrameChange < 0) {
				this.moveLeftBeforeFrameChange = this.moveBeforeFrameChange;
				if (++this.currentWalkAnimationFrame >= this.movementSprites.get(this.direction).length) {
					this.currentWalkAnimationFrame = 1;
				}
			}
		}
		else {
			this.currentWalkAnimationFrame = 0;
			this.determineFrame();
		}
	}

	public determineFrame(): void {
		switch (this.state) {
			case State.Normal:
			case State.HitRecovery:
				if (this.hitState.CurrentStep != HitStateStep.None) {
					if (this.hitState.CurrentStep == HitStateStep.Falling || this.hitState.CurrentStep == HitStateStep.Flying)
						this.imgid = this.direction == Direction.Right ? BitmapId.Belmont_rhitfly : BitmapId.Belmont_lhitfly;
					else this.imgid = this.direction == Direction.Right ? BitmapId.Belmont_rhitdown : BitmapId.Belmont_lhitdown;
				}
				else if (!this.roeState.Roeing) {
					if (!this.Crouching && !this.Jumping) {
						this.imgid = this.CarryingShield ? Belmont.MovementSpritesWShield.get(this.direction)[this.currentWalkAnimationFrame] : Belmont.MovementSpritesNoShield.get(this.direction)[this.currentWalkAnimationFrame];
					}
					else {
						this.imgid = this.CarryingShield ? Belmont.MovementSpritesWShieldCrouching.get(this.direction)[this.currentWalkAnimationFrame] : Belmont.MovementSpritesNoShieldCrouching.get(this.direction)[this.currentWalkAnimationFrame];
					}
				}
				else {
					if (!this.Crouching && !this.Jumping) {
						this.imgid = RoeState.RoeSprites.get(this.direction)[this.roeState.CurrentFrame];
					}
					else {
						this.imgid = RoeState.RoeSpritesCrouching.get(this.direction)[this.roeState.CurrentFrame];
					}
				}
				break;
			case State.Dying:
			case State.Dead:
				break;
		}
	}

	public takeDamage(amount: number): void {
		if (!this.hittable)
			return;
		if (this.state != State.HitRecovery && this.state != State.Dying) {
			this.Health -= amount;
			this.initHitRecoveryState();
			if (this.jumpState.Jumping)
				this.jumpState.Stop();
			if (this.Roeing) {
				this.roeState.Stop();
			}
			SM.play(AudioId.Au);
		}
	}

	private doDeath(): void {
		let step = this.dyingState.DeathAni.doAnimation(this.dyingState.aniTimer);
		if (step.next) {
			if (this.dyingState.DeathAni.finished === true) {
				(controller as Controller).BelmontDeathAniFinished();
				this.dyingState.Stop();
				this.state = State.Dead;
			}
			else {
				this.imgid = step.stepValue.image;
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
		this.determineFrame();
	}

	private handleInput(): { moved: boolean } {
		let moved = false;
		if (Input.KD_DOWN && !this.ignoreDirButtonPress(Direction.Down)) {
			this.Crouching = true;
			if (Input.KD_RIGHT && !this.ignoreDirButtonPress(Direction.Right))
				this.direction = Direction.Right;
			if (Input.KD_LEFT && !this.ignoreDirButtonPress(Direction.Left))
				this.direction = Direction.Left;
		}
		else if (Input.KC_BTN2 && !this.ignoreDirButtonPress(Direction.Up)) {
			this.Crouching = false;
			let jumpDir: Direction = Direction.Up;
			if (Input.KD_RIGHT) {
				jumpDir = Direction.Right;
				this.direction = Direction.Right;
			}
			else if (Input.KD_LEFT) {
				jumpDir = Direction.Left;
				this.direction = Direction.Left;
			}
			this.jumpState.Start(jumpDir);
		}
		else if (Input.KD_RIGHT && !this.ignoreDirButtonPress(Direction.Right)) {
			this.Crouching = false;
			moved = this.doMovement(Direction.Right).moved;
		}
		else if (Input.KD_LEFT && !this.ignoreDirButtonPress(Direction.Left)) {
			this.Crouching = false;
			moved = this.doMovement(Direction.Left).moved;
		}
		else {
			this.Crouching = false;
			this.firstPressedButton = Direction.None;
		}

		return { moved: moved };
	}

	private doMovement(dir: Direction): { moved: boolean } {
		let speed = this.movementSpeed;
		let originalPos = copyPoint(this.pos);
		switch (dir) {
			case Direction.Right:
				this.setx(this.pos.x + speed);
				this.direction = Direction.Right;
				break;
			case Direction.Left:
				this.setx(this.pos.x - speed);
				this.direction = Direction.Left;
				break;
		}
		return { moved: true };
	}

	private checkAndHandleRoomExit(): void {
		let possibleRoomExit = this.nearRoomExit();
		if (possibleRoomExit && possibleRoomExit.destRoom !== Room.NO_ROOM_EXIT) {
			(controller as Controller).HandleRoomExitViaMovement(possibleRoomExit.destRoom, possibleRoomExit.direction);
		}
	}

	protected checkWallCollision(): boolean {
		switch (this.direction) {
			case Direction.Right:
				return (model as Model).currentRoom.isCollisionTile(this.pos.x + 16, this.pos.y + 25) || (model as Model).currentRoom.isCollisionTile(this.pos.x + 16, this.pos.y + 31);
			case Direction.Left:
				return (model as Model).currentRoom.isCollisionTile(this.pos.x, this.pos.y + 25) || (model as Model).currentRoom.isCollisionTile(this.pos.x, this.pos.y + 31);
			default:
				return false;
		}
	}

	protected get CeilingCollision(): boolean {
		return (model as Model).currentRoom.isCollisionTile(this.wallhitbox_sx, this.pos.y + 8) || (model as Model).currentRoom.isCollisionTile(this.wallhitbox_ex, this.pos.y + 8);
	}

	protected get FloorCollision(): boolean {
		return (model as Model).currentRoom.isCollisionTile(this.wallhitbox_sx, this.pos.y + 32) || (model as Model).currentRoom.isCollisionTile(this.wallhitbox_ex, this.pos.y + 32);
	}

	protected handleFloorCollision(): void {
		if (this.Jumping) {
			this.jumpState.Stop();
		}
		if (this.hitState.CurrentStep == HitStateStep.Falling) {
			this.hitState.CurrentStep = HitStateStep.Crouching;
			this.hitState.CrouchTimer.restart();
		}
	}

	protected handleCeilingCollision(): void {
		this.jumpState.GoingUp = false;
	}

	private nearRoomExit(): NearingRoomExitResult {
		let exitUp = (model as Model).currentRoom.nearingRoomExit(this.wallhitbox_sx, this.pos.y + 4); // 24
		if (exitUp.destRoom !== Room.NO_ROOM_EXIT) return exitUp;
		let exitRight = (model as Model).currentRoom.nearingRoomExit(this.wallhitbox_ex + 1, this.pos.y + 25);
		if (exitRight.destRoom !== Room.NO_ROOM_EXIT) return exitRight;
		let exitDown = (model as Model).currentRoom.nearingRoomExit(this.wallhitbox_sx, this.pos.y + 36);
		if (exitDown.destRoom !== Room.NO_ROOM_EXIT) return exitDown;
		let exitLeft = (model as Model).currentRoom.nearingRoomExit(this.wallhitbox_sx - 1, this.pos.y + 25);
		if (exitLeft.destRoom !== Room.NO_ROOM_EXIT) return exitLeft;

		return null;
	}

	private ignoreDirButtonPress(dir: Direction): boolean {
		return this.multipleDirButtonsPressed() && dir == this.firstPressedButton;
	}

	private multipleDirButtonsPressed(): boolean {
		let u: number = Input.KD_UP ? 1 : 0;
		let r: number = Input.KD_RIGHT ? 1 : 0;
		let d: number = Input.KD_DOWN ? 1 : 0;
		let l: number = Input.KD_LEFT ? 1 : 0;
		return u + r + d + l > 1;
	}

	public paint(offset: Point = null): void {
		let roeOffset = <Point>{ x: 0, y: 0 };
		if (this.Roeing) {
			if (!this.Crouching) {
				roeOffset.x += RoeState.RoeSpritePosOffset.get(this.direction)[this.roeState.CurrentFrame].x;
				roeOffset.y += RoeState.RoeSpritePosOffset.get(this.direction)[this.roeState.CurrentFrame].y;
			}
			else {
				roeOffset.x += RoeState.RoeSpritePosOffsetCrouching.get(this.direction)[this.roeState.CurrentFrame].x;
				roeOffset.y += RoeState.RoeSpritePosOffsetCrouching.get(this.direction)[this.roeState.CurrentFrame].y;
			}
		}
		if (!this.hitState.Blink || (controller as Controller).InEventState) {
			super.paint(addPoints(roeOffset, offset));
		}
		else {
			// super.paint(addPoints(roeOffset, offset), { r: false, g: false, b: true, a: true });
		}
		// view.drawRectangle(this.wallhitbox_sx, CS.GameScreenStartY + this.wallhitbox_sy, this.wallhitbox_ex, CS.GameScreenStartY + this.wallhitbox_ey, Msx1Colors[15]);
	}

	public dispose(): void {
		BStopwatch.removeWatch(this.hitState.BlinkTimer);
		BStopwatch.removeWatch(this.hitState.RecoveryTimer);
		BStopwatch.removeWatch(this.dyingState.aniTimer);
		BStopwatch.removeWatch(this.roeState.aniTimer);
	}
}

export const enum State {
	Normal,
	HitRecovery,
	Dying,
	Dead
}

export class JumpState {
	public JumpTimer: BStopwatch;
	public Jumping: boolean;
	public GoingUp: boolean;
	public JumpDirection: Direction;
	public static jumpYDelta: number[] = [0, -8, -8, -4, -4, -4, -4, -4, -4, -4, -2, -2, -1, -1, 0, 0, 0, 0, 1, 1, 2, 2, 4, 4, 4, 4, 4, 4, 4, 8, 8];
	public JumpAni: Animation<number>;
	public get JumpHeightReached(): boolean {
		return this.JumpAni.stepValue >= 0;
	}

	constructor() {
		this.JumpTimer = new BStopwatch();
		this.Jumping = false;
		this.GoingUp = false;
		this.JumpAni = new Animation<number>(JumpState.jumpYDelta, 1, false);
	}

	public Stop(): void {
		this.JumpTimer.stop();
		this.Jumping = false;
		this.GoingUp = false;
	}

	public GoingDownAfterAnimation(): void {
		this.JumpTimer.stop();
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

export class HitState {
	public static TotalBlinkTime: number = 100;
	public static BlinkTimePerSwitch: number = 2;
	public static CrouchTime: number = 25;
	public BlinkTimer: BStopwatch;
	public RecoveryTimer: BStopwatch;
	public CrouchTimer: BStopwatch;
	public Blink: boolean;
	public BlinkingAndInvulnerable: boolean;
	public CurrentStep: HitStateStep;
	public static hitDelta: Point[] = new Array(newPoint(-2, -2),
		newPoint(-2, -2),
		newPoint(-2, -2),
		newPoint(-2, -2),
		newPoint(-2, -2),
		newPoint(-2, -2),
		newPoint(-1, -1),
		newPoint(-1, -1),
		newPoint(-1, -1),
		newPoint(-1, -1),
		newPoint(-1, 0),
		newPoint(-1, 0),
		newPoint(-1, 0),
		newPoint(-1, 0),
		newPoint(-2, 1),
		newPoint(-2, 1),
		newPoint(-2, 1),
		newPoint(-2, 1));
	public HitAni: Animation<Point>;

	constructor() {
		this.Blink = false;
		this.BlinkingAndInvulnerable = false;
		this.CurrentStep = HitStateStep.None;
		this.HitAni = new Animation<Point>(HitState.hitDelta,/*constantStepTime:*/1);
	}

	public Stop(): void {
		this.BlinkTimer.stop();
		this.RecoveryTimer.stop();
		this.CrouchTimer.stop();
		this.Blink = false;
		this.BlinkingAndInvulnerable = false;
		this.CurrentStep = HitStateStep.None;
	}

	public Start(): void {
		this.Blink = true;
		this.BlinkingAndInvulnerable = true;
		this.CurrentStep = HitStateStep.Flying;
		this.BlinkTimer.restart();
		this.RecoveryTimer.restart();
		this.CrouchTimer.reset();
		this.HitAni.restart();
	}
}

export const enum HitStateStep {
	None,
	Flying,
	Falling,
	Crouching
}

export interface BitmapAndDir {
	image: BitmapId;
	dir: Direction;
}

export class DyingState {
	public DeathAni: Animation<BitmapAndDir>;
	public static framesPerDrawing: number = 15;
	protected static dyingFrames: BitmapAndDir[] = new Array(
		{ image: BitmapId.Belmont_rhitdown, dir: Direction.Right },
		{ image: BitmapId.Belmont_rdead, dir: Direction.Right }
	);
	protected static dyingFrameTimes: number[] = [5, 100];
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
