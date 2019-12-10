import { BossFoe } from "./bossfoe";
import { Direction } from "../BoazEngineJS/direction";
import { AudioId, BitmapId } from "./resourceids";
import { PlayerProjectile } from "./pprojectile";
import { Area, Point, IGameObject } from "../lib/interfaces";
import { newArea, newSize, copyPoint, addPoints } from "../BoazEngineJS/common";
import { bst } from "../BoazEngineJS/statemachine";
import { GameConstants } from "./gameconstants";
import { TileSize, Tile } from "../BoazEngineJS/msx";
import { FProjectile } from "./fprojectile";
import { view } from "../BoazEngineJS/engine";
import { DrawImgFlags } from "../BoazEngineJS/view";
import { Model, GameState } from "./gamemodel";
import { Controller } from "./gamecontroller";
import { GameSubstate } from "./gamemodel";
import { FoeExplosion } from "./foeexplosion";
import { SM } from "../BoazEngineJS/soundmaster";

const floatspeed = 2;
const vanlinks_naarrechts = TileSize / 2;
const vanrechts_naarlinks = GameConstants.GameScreenWidth - (TileSize * 2);
const loops_tot_boos = 3;
export class Pietula extends BossFoe {
	public get damageToPlayer(): number {
		return 2;
	}

	public get respawnOnRoomEntry(): boolean {
		return false;
	}

	protected static HitArea: Area = newArea(8, 0, 32, 40);

	public fst: bst<Pietula>;
	public hover: bst<Pietula>;
	public blink: bst<Pietula>;
	public loops: number;
	public bliksem: { imgid: number, paint(offset: Point): void, pos: Point, flipped: boolean; };

	constructor(pos: Point = null) {
		super(pos);
		this.canHurtPlayer = false;
		this.imgid = BitmapId.Pietula1;
		this.hitarea = Pietula.HitArea;
		this.size = newSize(this.hitarea.end.x, this.hitarea.end.y);
		this.health = 30;
		this.maxHealth = this.health;
		this.loops = 0;
		this.visible = false;
		this.priority = 20;

		let fst = new bst<Pietula>(this, 0, true);
		this.fst = fst;
		let waitAfterDeath = fst.addNewState('wachten_op_elmo');
		waitAfterDeath.delta2tapehead = 6000 / 20;
		waitAfterDeath.onrun = (s) => ++s.tapeheadnudges;
		waitAfterDeath.ontapeheadmove = (s) => Controller._.switchSubstate(GameSubstate.ToEndDemo);

		let intro_wacht = fst.addNewState('intro_wacht');
		intro_wacht.oninitstate = (s) => {
			s.target.pos = Tile.toStagePoint(7, 3);
			s.target.flippedH = false;
			s.target.blink.transition('in');
			s.target.hover.reset();
			s.target.imgid = BitmapId.Pietula1;
			s.target.hover.halted = true;
		};
		intro_wacht.delta2tapehead = 2000 / 20;
		intro_wacht.onrun = (s) => ++s.tapeheadnudges;
		intro_wacht.ontapeheadmove = (s) => s.bsm.transition('naarlinks');
		intro_wacht.onexitstate = (s) => s.target.hover.halted = false;
		let naarlinks = fst.addNewState('naarlinks');
		naarlinks.onrun = (s) => {
			s.target.pos.x -= floatspeed;
			if (s.target.pos.x <= vanlinks_naarrechts) {
				++s.target.loops;
				if (s.target.loops >= loops_tot_boos) {
					s.target.loops = 0;
					s.target.blink.transition('out');
				}
				s.transitionSM('naarrechts');
			}
			if (s.target.blink.current.id === 'invisible') {
				s.transitionSM('wait_for_teleport');
			}
		};
		let naarrechts = fst.addNewState('naarrechts');
		naarrechts.onrun = (s) => {
			s.target.pos.x += floatspeed;
			if (s.target.pos.x >= vanrechts_naarlinks) {
				++s.target.loops;
				if (s.target.loops >= loops_tot_boos) {
					s.target.loops = 0;
					s.target.blink.transition('out');
				}
				s.transitionSM('naarlinks');
			}
			if (s.target.blink.current.id === 'invisible') {
				s.transitionSM('wait_for_teleport');
			}
		};

		let waitforteleport = fst.addNewState('wait_for_teleport');
		waitforteleport.delta2tapehead = 1000 / 20;
		waitforteleport.onrun = (s) => ++s.tapeheadnudges;
		waitforteleport.ontapeheadmove = (s) => s.transitionSM('wait_for_bliksem');

		let waitforbliksem = fst.addNewState('wait_for_bliksem');
		waitforbliksem.delta2tapehead = 3000 / 20;
		waitforbliksem.onrun = (s) => {
			++s.tapeheadnudges;
		};
		waitforbliksem.ontapeheadmove = (s) => {
			s.transitionSM('bliksem');
		};

		waitforbliksem.oninitstate = (s) => {
			s.target.blink.transition('in');
			s.target.hover.halted = true;
			let plek = Math.floor(Math.random() * 4);
			s.target.bliksem = {
				imgid: BitmapId.Lightning1,
				flipped: false,
				paint(offset: Point) {
					if (this.imgid !== BitmapId.None)
						view.drawImg(this.imgid, this.pos.x + offset.x, this.pos.y + offset.y, this.flipped ? DrawImgFlags.HFLIP : DrawImgFlags.None);
				},
				pos: { x: 0, y: 0 },
			};
			switch (plek) {
				case 0:
					s.target.pos.x = vanlinks_naarrechts;
					s.target.pos.y = Tile.toStageCoord(4);
					s.target.flippedH = true;
					s.target.bliksem.flipped = false;
					s.target.bliksem.pos.x = s.target.pos.x + 41;
					s.target.bliksem.pos.y = s.target.pos.y - 28;
					break;
				case 1:
					s.target.pos.x = vanlinks_naarrechts;
					s.target.pos.y = Tile.toStageCoord(7);
					s.target.flippedH = true;
					s.target.bliksem.flipped = false;
					s.target.bliksem.pos.x = s.target.pos.x + 41;
					s.target.bliksem.pos.y = s.target.pos.y - 28;
					break;
				case 2:
					s.target.pos.x = vanrechts_naarlinks;
					s.target.pos.y = Tile.toStageCoord(4);
					s.target.bliksem.pos.x = s.target.pos.x - 256;
					s.target.bliksem.pos.y = s.target.pos.y - 28;
					s.target.bliksem.flipped = true;
					break;
				case 3:
					s.target.pos.x = vanrechts_naarlinks;
					s.target.pos.y = Tile.toStageCoord(7);
					s.target.bliksem.pos.x = s.target.pos.x - 256;
					s.target.bliksem.pos.y = s.target.pos.y - 28;
					s.target.bliksem.flipped = true;
					break;
			}
			s.target.imgid = BitmapId.Pietula2;
		};

		let bliksemstate = fst.addNewState('bliksem');
		bliksemstate.oninitstate = (s) => {
			bliksemstate.reset();
			SM.play(AudioId.Bliksem);
		};
		bliksemstate.tapedata = [
			BitmapId.Lightning1,
			BitmapId.Lightning2,
			BitmapId.None,
			BitmapId.Lightning3,
			BitmapId.None,
			BitmapId.Lightning4,
			BitmapId.Lightning5,
			BitmapId.None,
		];
		bliksemstate.delta2tapehead = 4;
		bliksemstate.onrun = (s) => {
			if (Model._.Belmont.areaCollide(
				<Area>{
					start: {
						x: s.target.bliksem.pos.x,
						y: s.target.bliksem.pos.y + 6
					},
					end: {
						x: s.target.bliksem.pos.x + 256,
						y: s.target.bliksem.pos.y + 48
					}
				}
			)) {
				Model._.Belmont.TakeDamage(4);
			}
			++s.tapeheadnudges;
		};
		bliksemstate.ontapeheadmove = (s) => {
			let data = s.currentdata as BitmapId;
			s.target.bliksem.imgid = data;
			if (data === BitmapId.None)
				s.target.imgid = BitmapId.Pietula2;
			else s.target.imgid = BitmapId.Pietula3;
		};
		bliksemstate.ontapeend = (s) => s.transitionSM('wait_after_bliksem1');

		let waitafterbliksem1 = fst.addNewState('wait_after_bliksem1');
		waitafterbliksem1.delta2tapehead = 2000 / 20;
		waitafterbliksem1.onrun = (s) => ++s.tapeheadnudges;
		waitafterbliksem1.ontapeheadmove = (s) => {
			s.transitionSM('wait_after_bliksem2');
			s.target.blink.transition('out');
		};

		let waitafterbliksem2 = fst.addNewState('wait_after_bliksem2');
		waitafterbliksem2.delta2tapehead = 2000 / 20;
		waitafterbliksem2.onrun = (s) => ++s.tapeheadnudges;
		waitafterbliksem2.ontapeheadmove = (s) => s.transitionSM('intro_wacht');

		let hover = new bst<Pietula>(this, 0, true);
		this.hover = hover;
		hover.tapedata = [
			0,
			2,
			2,
			4,
			4,
			4,
			4,
			8,
			8,
			8,
			8,
			8,
			8,
			4,
			4,
			4,
			4,
			2,
			2,
			0,
			0,
			-2,
			-2,
			-4,
			-4,
			-4,
			-4,
			-8,
			-8,
			-8,
			-8,
			-8,
			-8,
			-4,
			-4,
			-4,
			-4,
			-2,
			-2,
			0,
		];
		hover.delta2tapehead = 2;
		hover.onrun = (s) => ++s.tapeheadnudges;
		hover.ontapeheadmove = (s) => s.target.pos.y += s.currentdata;
		hover.ontapeend = (s) => s.setTapeheadNoEvent(0);

		let blink = new bst<Pietula>(this, 0, true);
		this.blink = blink;

		let visible = blink.addNewState('visible');
		visible.oninitstate = (s) => {
			s.target.hittable = true;
			s.target.canHurtPlayer = true;
		};
		let invisible = blink.addNewState('invisible');
		invisible.oninitstate = (s) => {
			s.target.hittable = false;
			s.target.canHurtPlayer = false;
		};

		let blinkout = blink.addNewState('out');
		blinkout.delta2tapehead = 2;
		blinkout.tapedata = [
			true,
			true,
			true,
			true,
			false,
			false,
			false,
			false,
			true,
			true,
			true,
			false,
			false,
			false,
			true,
			true,
			false,
			false,
			true,
			false,
			true,
			false,
			true,
			false,
		];
		blinkout.oninitstate = (s) => s.reset();
		blinkout.onrun = (s) => ++s.tapeheadnudges;
		blinkout.ontapeheadmove = (s) => s.target.visible = s.currentdata;
		blinkout.ontapeend = (s) => s.transitionSM('invisible');

		let blinkin = blink.addNewState('in');
		blinkin.delta2tapehead = 2;
		blinkin.tapedata = [
			true,
			true,
			true,
			true,
			false,
			false,
			false,
			false,
			true,
			true,
			true,
			false,
			false,
			false,
			true,
			true,
			false,
			false,
			true,
			false,
			true,
			false,
			true,
			false,
			true
		];
		blinkin.oninitstate = (s) => s.reset();
		blinkin.onrun = (s) => ++s.tapeheadnudges;
		blinkin.ontapeheadmove = (s) => s.target.visible = s.currentdata;
		blinkin.ontapeend = (s) => s.transitionSM('visible');
		blink.setStartState('visible');
		fst.setStartState('intro_wacht');
	}

	public takeTurn(): void {
		this.fst.run();
		this.hover.run();
		this.blink.run();

		super.takeTurn();
	}

	public dispose(): void {
	}

	public handleHit(source: PlayerProjectile): void {
		super.handleHit(source);
		this.loseHealth(source);
	}

	public paint(offset: Point = null): void {
		super.paint(offset);
		if (this.fst.current.id === 'bliksem') {
			this.bliksem?.paint(offset);
		}

	}

	public die(): void {
		Model._.spawn(new FoeExplosion(copyPoint(this.pos)));
		Model._.spawn(new FoeExplosion(addPoints(this.pos, { x: 16, y: 0 })));
		Model._.spawn(new FoeExplosion(addPoints(this.pos, { x: 0, y: 16 })));
		Model._.spawn(new FoeExplosion(addPoints(this.pos, { x: 16, y: 16 })));
		SM.play(AudioId.Kaboem);
		this.visible = false;
		this.canHurtPlayer = false;
		this.hittable = false;
		this.blink.halted = true;
		this.hover.halted = true;

		SM.play(AudioId.Hoera);
		this.fst.transition('wachten_op_elmo');
	}
}