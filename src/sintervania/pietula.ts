import { TileSize, Tile } from '../bmsx/msx';
import { GameConstants } from './gameconstants';
import { Area, newArea, Point, newSize, copyPoint, addPoints } from '../bmsx/common';
import { mdef, view, model, controller, sdef } from '../bmsx/engine';
import { BitmapId, AudioId } from './resourceids';
import { Controller } from './gamecontroller';
import { GameSubstate, Model } from './gamemodel';
import { DrawImgFlags } from '../bmsx/view';
import { SM } from '../bmsx/soundmaster';
import { FoeExplosion } from './foeexplosion';
import { Foe } from './foe';

const floatspeed = 2;
const vanlinks_naarrechts = TileSize / 2;
const vanrechts_naarlinks = GameConstants.GameScreenWidth - (TileSize * 2);
const loops_tot_boos = 3;
export class Pietula extends Foe {
	public get respawnOnRoomEntry(): boolean { return false; }

	public fst: mdef;
	public hover: mdef;
	public blink: mdef;
	public loops: number;
	public bliksem: { imgid: number, paint(offset: Point): void, pos: Point, flipped: boolean; };

	constructor() {
		super();
		this.canHurtPlayer = false;
		this.imgid = BitmapId.Pietula1;
		this.hitarea = newArea(8, 0, 32, 40);
		this.size = newSize(this.hitarea.end.x, this.hitarea.end.y);
		this.health = 30;
		this.maxHealth = this.health;
		this.loops = 0;
		this.visible = false;
		this.z = 20;

		let fst = new mdef();
		this.fst = fst;
		let waitAfterDeath = fst.add('wachten_op_elmo');
		waitAfterDeath.nudges2move = 6000 / 20;
		waitAfterDeath.onrun = (s) => ++s.nudges;
		waitAfterDeath.onnext = (s) => (controller as Controller).switchSubstate(GameSubstate.ToEndDemo);

		let intro_wacht = fst.add('intro_wacht');
		intro_wacht.onenter = (s, type) => {
			this.pos = Tile.toStagePoint(7, 3);
			this.flippedH = false;
			this.blink.to('in');
			this.hover.reset();
			this.imgid = BitmapId.Pietula1;
			this.hover.paused = true;
		};
		intro_wacht.nudges2move = 2000 / 20;
		intro_wacht.onrun = (s) => ++s.nudges;
		intro_wacht.onnext = (s) => s.parentbst.to('naarlinks');
		intro_wacht.onexit = (s) => this.hover.paused = false;
		let naarlinks = fst.add('naarlinks');
		naarlinks.onrun = (s) => {
			this.pos.x -= floatspeed;
			if (this.pos.x <= vanlinks_naarrechts) {
				++this.loops;
				if (this.loops >= loops_tot_boos) {
					this.loops = 0;
					this.blink.to('out');
				}
				s.parentbst.to('naarrechts');
			}
			if (this.blink.current.id === 'invisible') {
				s.parentbst.to('wait_for_teleport');
			}
		};
		let naarrechts = fst.add('naarrechts');
		naarrechts.onrun = (s) => {
			this.pos.x += floatspeed;
			if (this.pos.x >= vanrechts_naarlinks) {
				++this.loops;
				if (this.loops >= loops_tot_boos) {
					this.loops = 0;
					this.blink.to('out');
				}
				s.parentbst.to('naarlinks');
			}
			if (this.blink.current.id === 'invisible') {
				s.parentbst.to('wait_for_teleport');
			}
		};

		let waitforteleport = fst.add('wait_for_teleport');
		waitforteleport.nudges2move = 1000 / 20;
		waitforteleport.onrun = (s) => ++s.nudges;
		waitforteleport.onnext = (s) => s.parentbst.to('wait_for_bliksem');

		let waitforbliksem = fst.add('wait_for_bliksem');
		waitforbliksem.nudges2move = 3000 / 20;
		waitforbliksem.onrun = (s) => {
			++s.nudges;
		};
		waitforbliksem.onnext = (s) => {
			s.parentbst.to('bliksem');
		};

		waitforbliksem.onenter = (s) => {
			this.blink.to('in');
			this.hover.paused = true;
			let plek = Math.floor(Math.random() * 4);
			this.bliksem = {
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
					this.pos.x = vanlinks_naarrechts;
					this.pos.y = Tile.toStageCoord(4);
					this.flippedH = true;
					this.bliksem.flipped = false;
					this.bliksem.pos.x = this.pos.x + 41;
					this.bliksem.pos.y = this.pos.y - 28;
					break;
				case 1:
					this.pos.x = vanlinks_naarrechts;
					this.pos.y = Tile.toStageCoord(7);
					this.flippedH = true;
					this.bliksem.flipped = false;
					this.bliksem.pos.x = this.pos.x + 41;
					this.bliksem.pos.y = this.pos.y - 28;
					break;
				case 2:
					this.pos.x = vanrechts_naarlinks;
					this.pos.y = Tile.toStageCoord(4);
					this.bliksem.pos.x = this.pos.x - 256;
					this.bliksem.pos.y = this.pos.y - 28;
					this.bliksem.flipped = true;
					break;
				case 3:
					this.pos.x = vanrechts_naarlinks;
					this.pos.y = Tile.toStageCoord(7);
					this.bliksem.pos.x = this.pos.x - 256;
					this.bliksem.pos.y = this.pos.y - 28;
					this.bliksem.flipped = true;
					break;
			}
			this.imgid = BitmapId.Pietula2;
		};

		let bliksemstate = fst.add('bliksem');
		bliksemstate.onenter = (s) => {
			bliksemstate.reset();
			SM.play(AudioId.Bliksem);
		};
		bliksemstate.tape = [
			BitmapId.Lightning1,
			BitmapId.Lightning2,
			BitmapId.None,
			BitmapId.Lightning3,
			BitmapId.None,
			BitmapId.Lightning4,
			BitmapId.Lightning5,
			BitmapId.None,
		];
		bliksemstate.nudges2move = 4;
		bliksemstate.onrun = (s) => {
			if ((model as Model).Belmont.areaCollide(
				<Area>{
					start: {
						x: this.bliksem.pos.x,
						y: this.bliksem.pos.y + 6
					},
					end: {
						x: this.bliksem.pos.x + 256,
						y: this.bliksem.pos.y + 48
					}
				}
			)) {
				(model as Model).Belmont.takeDamage(4);
			}
			++s.nudges;
		};
		bliksemstate.onnext = (s) => {
			let data = s.current as BitmapId;
			this.bliksem.imgid = data;
			if (data === BitmapId.None)
				this.imgid = BitmapId.Pietula2;
			else this.imgid = BitmapId.Pietula3;
		};
		bliksemstate.onend = (s) => s.parentbst.to('wait_after_bliksem1');

		let waitafterbliksem1 = fst.add('wait_after_bliksem1');
		waitafterbliksem1.nudges2move = 2000 / 20;
		waitafterbliksem1.onrun = (s) => ++s.nudges;
		waitafterbliksem1.onnext = (s) => {
			s.parentbst.to('wait_after_bliksem2');
			this.blink.to('out');
		};

		let waitafterbliksem2 = fst.add('wait_after_bliksem2');
		waitafterbliksem2.nudges2move = 2000 / 20;
		waitafterbliksem2.onrun = (s) => ++s.nudges;
		waitafterbliksem2.onnext = (s) => s.parentbst.to('intro_wacht');

		let hover = new mdef();
		let hovers0 = hover.add(0);

		this.hover = hover;
		hovers0.tape = [
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
		hovers0.nudges2move = 2;
		hovers0.onrun = (s: sdef) => ++s.nudges;
		hovers0.onnext = (s: sdef) => this.pos.y += s.current;
		hovers0.onend = (s: sdef) => s.setHeadNoSideEffect(0);

		let blink = new mdef();
		this.blink = blink;

		let visible = blink.add('visible');
		visible.onenter = (s) => {
			this.hittable = true;
			this.canHurtPlayer = true;
		};
		let invisible = blink.add('invisible');
		invisible.onenter = (s) => {
			this.hittable = false;
			this.canHurtPlayer = false;
		};

		let blinkout = blink.add('out');
		blinkout.nudges2move = 2;
		blinkout.tape = [
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
		blinkout.onenter = (s) => s.reset();
		blinkout.onrun = (s) => ++s.nudges;
		blinkout.onnext = (s: sdef) => this.visible = s.current;
		blinkout.onend = (s) => s.parentbst.to('invisible');

		let blinkin = blink.add('in');
		blinkin.nudges2move = 2;
		blinkin.tape = [
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
		blinkin.onenter = (s) => s.reset();
		blinkin.onrun = (s) => ++s.nudges;
		blinkin.onnext = (s) => this.visible = s.current;
		blinkin.onend = (s) => s.parentbst.to('visible');
		blink.setStart('visible');
		fst.setStart('intro_wacht');
	}

	public run(): void {
		this.fst.run();
		this.hover.run();
		this.blink.run();

		super.run();
	}

	public paint(offset: Point = null): void {
		super.paint(offset);
		if (this.fst.current.id === 'bliksem') {
			this.bliksem?.paint(offset);
		}

	}

	public die(): void {
		new FoeExplosion().spawn(copyPoint(this.pos));
		new FoeExplosion().spawn(addPoints(this.pos, { x: 16, y: 0 }));
		new FoeExplosion().spawn(addPoints(this.pos, { x: 0, y: 16 }));
		new FoeExplosion().spawn(addPoints(this.pos, { x: 16, y: 16 }));
		SM.play(AudioId.Kaboem);
		this.visible = false;
		this.canHurtPlayer = false;
		this.hittable = false;
		this.blink.paused = true;
		this.hover.paused = true;

		SM.play(AudioId.Hoera);
		this.fst.to('wachten_op_elmo');
	}
}