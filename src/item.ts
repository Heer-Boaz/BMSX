import { Sprite } from "../BoazEngineJS/sprite";
import { newArea, area2size, moveArea } from "../BoazEngineJS/common";
import { GameModel } from "./sintervaniamodel";
import { SoundMaster as S } from "../BoazEngineJS/soundmaster";
import { ResourceMaster as RM } from "./resourcemaster";
import { GameController } from "./gamecontroller";
import { Area, Point } from "../BoazEngineJS/interfaces";
import { AudioId, BitmapId } from "./resourceids";

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
        super(pos);
        this.ItsType = type;
        this.hitarea = Item.ItemHitArea;
        this.size = area2size(Item.ItemHitArea);
        this.imgid = Item.Type2Image(type);
    }

    public takeTurn(): void {
        if (this.areaCollide(moveArea(GameModel._.Belmont.EventTouchHitArea, <Point>GameModel._.Belmont.pos))) {
            GameController._.PickupItem(this);
            switch (this.ItsType) {
                case ItemType.HeartSmall:
                case ItemType.HeartBig:
                    S.PlayEffect(RM.Sound.get(AudioId.Heart));
                    break;
                case ItemType.KeySmall:
                case ItemType.KeyBig:
                    S.PlayEffect(RM.Sound.get(AudioId.Key));
                    break;
                default:
                    S.PlayEffect(RM.Sound.get(AudioId.Item));
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

    public dispose(): void {
    }
}