import { Sprite, model, controller } from "../bmsx/bmsx";
import { newArea, area2size, moveArea } from "../bmsx/common";
import { Model } from "./gamemodel";
import { SM } from "../bmsx/soundmaster";
import { Controller } from "./gamecontroller";
import { AudioId, BitmapId } from "./resourceids";
import { Area, Point } from "../bmsx/common";

export const enum ItemType {
    None,
    HeartSmall,
    HeartBig,
    KeySmall,
    KeyBig
}

export const enum Usable {
    No,
    Yes,
    Infinite
}

export class Item extends Sprite {
    public ItsType: ItemType;
    public static ItemHitArea: Area = newArea(0, 0, 16, 16);
    static Usable: any;
    static Type: any;
    // public static Descriptions: Map<ItemType, string[]> = new Map<ItemType, string[]>(), { };

    constructor(type: ItemType, pos: Point) {
        super();
        this.ItsType = type;
        this.hitarea = Item.ItemHitArea;
        this.size = area2size(Item.ItemHitArea);
        this.imgid = Item.Type2Image(type);
    }

    public run(): void {
        if (this.areaCollide(moveArea((model as Model).Belmont.EventTouchHitArea, <Point>(model as Model).Belmont.pos))) {
            (controller as Controller).PickupItem(this);
            switch (this.ItsType) {
                case ItemType.HeartSmall:
                case ItemType.HeartBig:
                    SM.play(AudioId.Heart);
                    break;
                case ItemType.KeySmall:
                case ItemType.KeyBig:
                    SM.play(AudioId.Key);
                    break;
                default:
                    SM.play(AudioId.Item);
                    break;
            }
            this.disposeFlag = true;
        }
    }

    public static Type2Image(type: ItemType): BitmapId {
        switch (type) {
            case ItemType.KeyBig:
                return BitmapId.Key_big;
            default:
                return BitmapId.None;
        }
    }

    public static ItemUsable(type: ItemType): Usable {
        switch (type) {
            default:
                return Usable.No;
        }
    }
}