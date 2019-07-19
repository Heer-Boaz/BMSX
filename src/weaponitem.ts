import { Sprite } from "../BoazEngineJS/sprite";
import { SecWeaponType, BagWeapon } from "./sintervaniamodel";
import { Item } from "./item";

/*[Serializable]*/
export class WeaponItem extends Sprite {
    public static ItemHitArea: Area = <Area>{
        start: <Point>{ x: 0, y: 0 }, end: <Point>{ x: 16, y: 16 }
    };
    public ItsType: Type;
    public static Descriptions: Map<Type, string[]> = new Map<Type, string[]>();
    public static WeaponItem2SecWeaponType(weaponItem: BagWeapon): SecWeaponType {
        if (weaponItem == null)
            return SecWeaponType.None;
        switch (weaponItem.Type) {
            case Type.None:
            default:
                return SecWeaponType.None;
            case Type.Cross:
                return SecWeaponType.Cross;
        }
    }
    public static SecWeaponType2WeaponItemType(secWeapontype: SecWeaponType): Type {
        switch (secWeapontype) {
            case SecWeaponType.None:
            default:
                return Type.None;
            case SecWeaponType.Cross:
                return Type.Cross;
        }
    }
    constructor(type: Type, pos: Point) {
        super(pos);
        this.ItsType = type;
        this.hitarea = Item.ItemHitArea;
        this.size = Item.ItemHitArea.size;
        this.imgid = <number>WeaponItem.Type2Image(type);
    }
    public TakeTurn(): void {
        if (this.objectCollide(M._.Belmont.RoomCollisionArea + <Point>M._.Belmont.pos)) {
            C._.PickupWeaponItem(this);
            this.disposeFlag = true;
        }
    }
    public static Type2Image(type: Type): BitmapId {
        switch (type) {
            default:
                return BitmapId.None;
        }
    }
    public Dispose(): void {

    }
}

export enum Type {
    None = -1,
    Cross = 0
}