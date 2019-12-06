import { BStopwatch } from "../BoazEngineJS/btimer";
import { Foe } from "./foe";
import { Item, ItemType } from "./item";
import { AudioId, BitmapId } from "./resourceids";
import { GameModel as M } from "./sintervaniamodel";
import { GameConstants as CS } from "./gameconstants";
import { view } from "../BoazEngineJS/engine";
import { GameView as V } from "./gameview"
import { waitDuration, setPoint } from "../BoazEngineJS/common";
import { TextWriter } from "./textwriter";
import { Point } from "../BoazEngineJS/interfaces";

export class HUD {
    public static Pos_X: number = 0;
    public static Pos_Y: number = 0;
    private barTimer: BStopwatch;
    private foebarTimer: BStopwatch;
    protected static MsDurationBarChange: number = 5;
    protected static MsDurationFoeBarChange: number = 1;
    protected static HealthBarPosX: number = HUD.Pos_X + 60;
    protected static HealthBarPosY: number = HUD.Pos_Y + 18;
    protected static HeartsPosX: number = HUD.Pos_X + 193;
    protected static HeartsPosY: number = HUD.Pos_Y + 5;
    protected static WeaponPosX: number = HUD.Pos_X + 214 - (24 + 24);
    protected static WeaponPosY: number = HUD.Pos_Y + 3;
    protected static AmmoPosX: number = HUD.Pos_X + 214 - 24;
    protected static AmmoPosY: number = HUD.Pos_Y + 6;
    protected static ItemPosX: number = HUD.Pos_X + 227;
    protected static ItemPosY: number = HUD.Pos_Y + 3;
    protected static readonly KeyPos: Point = { x: HUD.Pos_X + 168, y: HUD.Pos_Y + 18 };
    protected static FoeBarStripePosX: number = HUD.Pos_X + 60;
    protected static FoeBarStripePosY: number = HUD.Pos_Y + 27;
    protected static HealthBarSizeX: number = 63;
    protected shownHealthLevel: number;
    protected shownWeaponLevel: number;
    protected shownFoeHealthLevel: number;
    protected foeForWhichHealthLevelIsShown: Foe;

    constructor() {
        this.barTimer = BStopwatch.createWatch();
        this.barTimer.pauseDuringMenu = false;
        this.barTimer.restart();
        this.foebarTimer = BStopwatch.createWatch();
        this.foebarTimer.pauseDuringMenu = false;
        this.foebarTimer.restart();
        this.SetShownLevelsToProperValues();
    }

    public SetShownLevelsToProperValues(): void {
        if (M._ != null) {
            if (M._.Belmont != null)
                this.shownHealthLevel = M._.Belmont.HealthPercentage;
            this.shownFoeHealthLevel = M._.FoeHealthPercentage;
            this.foeForWhichHealthLevelIsShown = M._.FoeForWhichHealthPercentageIsGiven;
        }
    }

    public TakeTurn(): void {
        if (M._.Belmont.Dying)
            this.shownHealthLevel = M._.Belmont.HealthPercentage;

        if (M._.LastFoeThatWasHit != null && M._.LastFoeThatWasHit.disposeFlag)
            this.shownFoeHealthLevel = 0;

        if (waitDuration(this.barTimer, HUD.MsDurationBarChange)) {
            if (this.shownHealthLevel > M._.Belmont.HealthPercentage)
                this.shownHealthLevel--;
            else if (this.shownHealthLevel < M._.Belmont.HealthPercentage)
                this.shownHealthLevel++;
        }

        if (CS.AnimateFoeHealthLevel) {
            if (waitDuration(this.foebarTimer, HUD.MsDurationFoeBarChange)) {
                if (this.shownFoeHealthLevel > M._.FoeHealthPercentage)
                    this.shownFoeHealthLevel--;
                else if (this.shownFoeHealthLevel < M._.FoeHealthPercentage)
                    this.shownFoeHealthLevel++;
            }
        }
        else this.shownFoeHealthLevel = M._.FoeHealthPercentage;
    }

    private percentageToBarLength(percentage: number): number {
        return percentage == 0 ? 0 : ~~(HUD.HealthBarSizeX / 100 * percentage) + 1;
    }

    public Paint(): void {
        view.drawImg(BitmapId.HUD, HUD.Pos_X, HUD.Pos_Y);
        let pos: Point = { x: HUD.HealthBarPosX, y: HUD.HealthBarPosY };
        for (let i: number = 0; i < this.percentageToBarLength(this.shownHealthLevel); i++) {
            view.drawImg(BitmapId.EnergybarStripe_Belmont, ~~pos.x, ~~pos.y);
            pos.x += 1;
        }

        let heartstxt: string = M._.Hearts < 10 ? `0${M._.Hearts}` : M._.Hearts.toString();
        TextWriter.drawText(HUD.HeartsPosX, HUD.HeartsPosY, heartstxt);
        if (M._.ItemsInInventory.find(x => x.Type === ItemType.KeyBig)) {
            view.drawImg(Item.Type2Image(ItemType.KeyBig), HUD.KeyPos.x, HUD.KeyPos.y);
        }

        setPoint(pos, HUD.FoeBarStripePosX, HUD.FoeBarStripePosY);
        let lengthShown: number, lengthBefore: number;

        if (M._.BossBattle) {
            if (M._.FoeForWhichHealthPercentageIsGiven !== this.foeForWhichHealthLevelIsShown) {
                this.foeForWhichHealthLevelIsShown = M._.FoeForWhichHealthPercentageIsGiven;
                this.shownFoeHealthLevel = M._.FoeHealthPercentage;
            }
            lengthShown = this.percentageToBarLength(this.shownFoeHealthLevel);
            lengthBefore = this.percentageToBarLength(M._.FoeHealthPercentage);
        }
        else {
            lengthShown = this.percentageToBarLength(100);
            lengthBefore = this.percentageToBarLength(100);
        }

        if (lengthBefore != -1) {
            if (lengthBefore > 0) {
                for (let i: number = 0; i <= lengthBefore; i++) {
                    view.drawImg(BitmapId.EnergybarStripe_Boss, pos.x, pos.y);
                    pos.x += 1;
                }
            }
            if (lengthBefore != lengthShown) {
                for (let i: number = lengthBefore; i <= lengthShown; i++) {
                    view.drawImg(BitmapId.EnergybarStripe_Boss, pos.x, pos.y);
                    pos.x += 1;
                }
            }
        }
    }
}