import { Sprite } from "./bmsx/engine";
import { Model, SecWeaponType, BagWeapon } from "./gamemodel";
import { Item } from "./item";
import { AudioId, BitmapId } from "./bmsx/resourceids";
import { moveArea, area2size } from "./bmsx/common";
import { Controller as C } from "./gamecontroller";
import { Area, Point } from "./bmsx/common";

/*[Serializable]*/
export class WeaponItem extends Sprite {
    public static ItemHitArea: Area = <Area>{
        start: <Point>{ x: 0, y: 0 }, end: <Point>{ x: 16, y: 16 }
    };
    public ItsType: WeaponType;
    public static Descriptions: Map<WeaponType, string[]> = new Map<WeaponType, string[]>();

    public static WeaponItem2SecWeaponType(weaponItem: BagWeapon): SecWeaponType {
        if (weaponItem == null)
            return SecWeaponType.None;
        switch (weaponItem.Type) {
            case WeaponType.None:
            default:
                return SecWeaponType.None;
            case WeaponType.Cross:
                return SecWeaponType.Cross;
        }
    }

    public static SecWeaponType2WeaponItemType(secWeapontype: SecWeaponType): WeaponType {
        switch (secWeapontype) {
            case SecWeaponType.None:
            default:
                return WeaponType.None;
            case SecWeaponType.Cross:
                return WeaponType.Cross;
        }
    }

    constructor(type: WeaponType, pos: Point) {
        super(pos);
        this.ItsType = type;
        this.hitarea = Item.ItemHitArea;
        this.size = area2size(Item.ItemHitArea);
        this.imgid = <number>WeaponItem.Type2Image(type);
    }

    public takeTurn(): void {
        if (this.areaCollide(moveArea(Model._.Belmont.RoomCollisionArea, <Point>Model._.Belmont.pos))) {
            C._.PickupWeaponItem(this);
            this.disposeFlag = true;
        }
    }

    public static Type2Image(type: WeaponType): BitmapId {
        switch (type) {
            default:
                return BitmapId.None;
        }
    }

    public dispose(): void {
    }
}

export const enum WeaponType {
    None = -1,
    Cross = 0
}
