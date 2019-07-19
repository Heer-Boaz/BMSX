export namespace Item {
    export enum Type {
        None,
        HeartSmall,
        HeartBig,
        KeySmall,
        KeyBig
    }
    export enum Usable {
        No,
        Yes,
        Infinite
    }
}

/*[Serializable]*/
export class Item extends Sprite {
    public ItsType: Type;
    public static ItemHitArea: IArea = new Area(0, 0, 16, 16);
    public static Descriptions: Dictionary<Type, string[]> = __init(new Dictionary<Type, string[]>(), {});
    constructor(type: Type, pos: Point) {
        super(pos);
        this.ItsType = type;
        this.hitarea = Item.ItemHitArea;
        this.size = Item.ItemHitArea.size;
        this.imgid = <number>Item.Type2Image(type);
    }
    public TakeTurn(): void {
        if (this.objectCollide(M._.Belmont.EventTouchHitArea + <Point>M._.Belmont.pos)) {
            C._.PickupItem(this);
            switch (this.ItsType) {
                case Item.Type.HeartSmall:
                case Item.Type.HeartBig:
                    S.PlayEffect(RM.Sound[AudioId.Heart]);
                    break;
                case Item.Type.KeySmall:
                case Item.Type.KeyBig:
                    S.PlayEffect(RM.Sound[AudioId.KeyGrab]);
                    break;
                default:
                    S.PlayEffect(RM.Sound[AudioId.ItemPickup]);
                    break;
            }
            this.disposeFlag = true;
        }
    }
    public static Type2Image(type: Type): BitmapId {
        switch (type) {
            case Item.Type.KeyBig:
                return BitmapId.Key_big;
                break;
            default:
                return BitmapId.None;
        }
    }
    public static ItemUsable(type: Type): Usable {
        switch (type) {
            default:
                return Usable.No;
        }
    }
    public Dispose(): void {

    }
}