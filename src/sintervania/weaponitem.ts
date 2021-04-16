import { Sprite, model, controller } from "../bmsx/bmsx";
import { Model, SecWeaponType, BagWeapon } from "./gamemodel";
import { Item } from "./item";
import { BitmapId } from "./resourceids";
import { moveArea, area2size, newArea } from "../bmsx/common";
import { Controller } from "./gamecontroller";
import { Area, Point } from "../bmsx/common";

export class WeaponItem extends Sprite {
    public static ItemHitArea: Area = newArea(0, 0, 16, 16);
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

    constructor(type: WeaponType) {
        super();
        this.ItsType = type;
        this.hitarea = Item.ItemHitArea;
        this.size = area2size(Item.ItemHitArea);
        this.imgid = WeaponItem.Type2Image(type);
    }

    public run(): void {
        if (this.areaCollide(moveArea((model as Model).Belmont.RoomCollisionArea, <Point>(model as Model).Belmont.pos))) {
            (controller as Controller).PickupWeaponItem(this);
            this.disposeFlag = true;
        }
    }

    public static Type2Image(type: WeaponType): BitmapId {
        switch (type) {
            default:
                return BitmapId.None;
        }
    }
}

export const enum WeaponType {
    None = -1,
    Cross = 0
}
