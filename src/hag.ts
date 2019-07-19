module Sintervania.Model.Foes {
    /*[Serializable]*/
    export class Hag extends Foe {
        public get DamageToPlayer(): number {
            return 1;
        }
        protected get moveBeforeFrameChange(): number {
            return 0;
        }
        public get RespawnAtRoomEntry(): boolean {
            return true;
        }
        protected static HagSize: Size = new Size(16, 32);
        protected static HagHitArea: Area = new Area(2, 2, 14, 32);
        protected animation: Animation<number>;
        protected timer: BStopwatch;
        protected get movementSprites(): Map<Direction, BitmapId[]> {
            return hagSprites;
        }
        protected static readonly Dictionary<Direction, BitmapId[]> hagSprites = new Dictionary < Direction, BitmapId[] > {
			{ Direction.None, new BitmapId[] { BitmapId.Hag_1, BitmapId.Hag_2 } },
};

		protected static(ulong, uint img)[] AnimationFrames = {
			(250, (uint)BitmapId.Hag_1),
    (250, (uint)BitmapId.Hag_2),
		};

constructor(pos: Point, dir: Direction, itemSpawned: Item.Type = Item.Type.HeartSmall) {
    super(pos);
    this.CanHurtPlayer = true;
    this.animation = __init(new Animation<number>(AnimationFrames), { Repeat: true });
    this.timer = BStopwatch.CreateWatch();
    this.imgid = <number>this.animation.stepValue();
    this.timer.restart();
    this.size = Hag.HagSize;
    this.hitarea = Hag.HagHitArea;
    this.itemSpawnedAfterKill = itemSpawned;
    this.Health = 1;
    this.Direction = dir;
}
        public TakeTurn(): void {
    let stepValue: number = this.imgid;
    this.animation.doAnimation(this.timer, stepValue);
    this.imgid = stepValue;
    this.flippedH = this.Direction == Direction.Left;
    this.pos.x += this.Direction == Direction.Left ? -2 : 2;
    if(this.pos.x >= CS.GameScreenWidth || (0 > this.pos.x + this.size.x)) {
    this.disposeFlag = true;
}
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
    }
}