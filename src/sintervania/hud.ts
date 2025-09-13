import { Foe } from "./foe";
import { Item, ItemType } from "./item";
import { BitmapId } from "./resourceids";
import { Model } from "./gamemodel";
import { GameConstants as CS } from "./gameconstants";
import { view, BStopwatch, model } from 'bmsx';
import { waitDuration, setPoint, Point } from "bmsx/common";
import { TextWriter } from "./textwriter";
import { DrawImgFlags } from 'bmsx/view';

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
	protected shownHealthLevel: number = 100;
	protected shownWeaponLevel: number = 100;
	protected shownFoeHealthLevel: number = 100;
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
		if (!model) return;
		if ((model as Model).Belmont != null)
			this.shownHealthLevel = (model as Model).Belmont.HealthPercentage;
		this.shownFoeHealthLevel = (model as Model).FoeHealthPercentage;
		this.foeForWhichHealthLevelIsShown = (model as Model).FoeForWhichHealthPercentageIsGiven;
	}

	public takeTurn(): void {
		if ((model as Model).Belmont.Dying)
			this.shownHealthLevel = (model as Model).Belmont.HealthPercentage;

		if ((model as Model).LastFoeThatWasHit != null && (model as Model).LastFoeThatWasHit.disposeFlag)
			this.shownFoeHealthLevel = 0;

		if (waitDuration(this.barTimer, HUD.MsDurationBarChange)) {
			if (this.shownHealthLevel > (model as Model).Belmont.HealthPercentage)
				this.shownHealthLevel--;
			else if (this.shownHealthLevel < (model as Model).Belmont.HealthPercentage)
				this.shownHealthLevel++;
		}

		if (CS.AnimateFoeHealthLevel) {
			if (waitDuration(this.foebarTimer, HUD.MsDurationFoeBarChange)) {
				if (this.shownFoeHealthLevel > (model as Model).FoeHealthPercentage)
					this.shownFoeHealthLevel--;
				else if (this.shownFoeHealthLevel < (model as Model).FoeHealthPercentage)
					this.shownFoeHealthLevel++;
			}
		}
		else this.shownFoeHealthLevel = (model as Model).FoeHealthPercentage;
	}

	private percentageToBarLength(percentage: number): number {
		if (percentage === 0) return 0;
		// Let op: +1 wegens scaling i.p.v. render-loop!
		if (percentage === 100) return HUD.HealthBarSizeX + 1;
		return ~~(HUD.HealthBarSizeX / 100 * percentage) + 1;
	}

	public paint(): void {
		let pos: Point = { x: HUD.HealthBarPosX, y: HUD.HealthBarPosY };
		let length = this.percentageToBarLength(this.shownHealthLevel);
		if (length > 0) { view.drawImg(BitmapId.EnergybarStripe_Belmont, pos.x, pos.y, DrawImgFlags.None, length); }

		let heartstxt: string = (model as Model).hearts < 10 ? `0${(model as Model).hearts}` : (model as Model).hearts.toString();
		$.drawGlyphs(HUD.HeartsPosX, HUD.HeartsPosY, heartstxt);
		if ((model as Model).ItemsInInventory.find(x => x.Type === ItemType.KeyBig)) {
			view.drawImg(Item.Type2Image(ItemType.KeyBig), HUD.KeyPos.x, HUD.KeyPos.y);
		}

		setPoint(pos, HUD.FoeBarStripePosX, HUD.FoeBarStripePosY);
		let lengthShown: number, lengthBefore: number;

		if ((model as Model).BossBattle) {
			// if ((model as Model).FoeForWhichHealthPercentageIsGiven !== this.foeForWhichHealthLevelIsShown) {
			//     this.foeForWhichHealthLevelIsShown = (model as Model).FoeForWhichHealthPercentageIsGiven;
			//     this.shownFoeHealthLevel = (model as Model).FoeHealthPercentage;
			// }
			lengthShown = this.percentageToBarLength(this.shownFoeHealthLevel);
			lengthBefore = this.percentageToBarLength((model as Model).FoeHealthPercentage);
		}
		else {
			lengthShown = this.percentageToBarLength(100);
			lengthBefore = this.percentageToBarLength(100);
		}

		if (lengthBefore != -1) {
			if (lengthBefore > 0) {
				view.drawImg(BitmapId.EnergybarStripe_Boss, HUD.FoeBarStripePosX, HUD.FoeBarStripePosY, DrawImgFlags.None, lengthBefore);
			}
			if (lengthBefore != lengthShown) {
				if (lengthShown > 0) { view.drawImg(BitmapId.EnergybarStripe_Boss, HUD.FoeBarStripePosX + lengthBefore, HUD.FoeBarStripePosY, DrawImgFlags.None, lengthShown - lengthBefore); }
			}
		}
		view.drawImg(BitmapId.HUD, HUD.Pos_X, HUD.Pos_Y);
	}
}
