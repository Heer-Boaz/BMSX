import { MSX2ScreenHeight, MSX2ScreenWidth } from './../bmsx/msx';
import { RomLoadResult } from '../bmsx/rompack';
import { Game, BaseModel, GameObject, Sprite, sdef, mdef, leavingScreenHandler_prohibit as prohibitLeavingScreenHandler, statedef_builder, cmdef, sstate, cmstate, setPoint, newPoint, Direction, newSize, newArea, Point, randomInt, copyPoint, getOppositeDirection, Space } from '../bmsx/bmsx';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';
import { DrawImgFlags, paintSprite } from '../bmsx/view';
import { TextWriter } from '../bmsx/textwriter';
import { GameMenu } from './gamemenu';
import { KonamiFont } from './konamifont';

const TIME_TO_SHINE = 60;
class modelclass extends BaseModel {
	public time_to_shine: number;
	public uitleg_tekst_dinges: number;
	public score: number = 0;

	public get diamant(): diamant {
		return this.get('diamant');
	}
	public get draaischijf(): draaischijf {
		return this.get('draaischijf');
	}

	public get_onvolmaaktheden(): onvolmaaktheid[] {
		return this.filter(o => (o as any).is_onvolmaaktheid) as onvolmaaktheid[];
	}

	public tel_onvolmaaktheden(): number {
		let total = 0;
		this.filter_and_foreach(
			o => (o as any).is_onvolmaaktheid,
			o => {
				let onvolmaaktje = o as onvolmaaktheid;
				if (onvolmaaktje.ben_ik_nog_onvolmaakt === true)
					++total;
			}
		);

		return total;
	}

	@statedef_builder
	public static buildModelStates(classname: string): cmdef {
		return new cmdef(classname, {
			machines: {
				master: new mdef('default', {
					states: {
						default: new sdef('default', {
							nudges2move: 50,
							onenter(s: sstate) {
								let ik = global.model as modelclass;
								ik.setSpace('default');
								ik.time_to_shine = TIME_TO_SHINE;
							},
							onnext(s: sstate) {
								let ik = global.model as modelclass;

								--ik.time_to_shine;
								if (ik.time_to_shine < 0) {
									ik.time_to_shine = 0;
									ik.score = ik.tel_onvolmaaktheden();
									ik.state.to('evaluatie!');
									// ik.state.to('hoera!');
								}
							},
							onrun(s: sstate, ik: modelclass) {
								BaseModel.defaultrun();

								++s.nudges; // Laat timer lopen

								if (Input.KC_F5) {
									global.model.state.to('gamemenu');
								}
							},
						}),
						gamemenu: new sdef('gamemenu', {
							onenter() {
								let menu = new GameMenu();
								global.model.spawn(menu);
								menu.Open();
							},
							onrun() {
								let menu = global.model.get('gamemenu') as GameMenu;
								menu.run();
								if (Input.KC_F5) {
									global.model.state.to('default');
								}
							},
							onexit() {
								let menu = global.model.get('gamemenu') as GameMenu;
								menu.Close();
								global.model.exile(menu);
							},
						}),
						'evaluatie!': new sdef('evaluatie!', {
							nudges2move: 50,
							onenter() {
								let ik = global.model as modelclass;
								ik.setSpace('evaluatie!');
								ik.time_to_shine = 5;
							},
							onnext(s: sstate) {
								let ik = global.model as modelclass;

								--ik.time_to_shine;
								if (ik.time_to_shine < 0) {
									ik.time_to_shine = 0;
									ik.state.to('hoera!');
								}
							},
							onrun(s: sstate) {
								++s.nudges;
							},
						}),
						'hoera!': new sdef('hoera!', {
							onenter() {
								let ik = global.model as modelclass;
								ik.setSpace('hoera!');
							},
						}),
						uitleg: new sdef('uitleg', {
							onenter() {
								let ik = global.model as modelclass;
								ik.uitleg_tekst_dinges = 0;
								ik.setSpace('uitleg');
								ik.spawn(new uitlegStuff());
							},
							onrun(s: sstate, ik: modelclass) {
								BaseModel.defaultrun();

								if (Input.KC_F5) {
									global.model.state.to('gamemenu');
								}
							},
						}),
					}
				}),
			}
		});
	}

	constructor() {
		super();
		let winSpace = new Space('hoera!');
		winSpace.spawn(new hoeraStuff());
		this.addSpace(winSpace);

		let evaluatieSpace = new Space('evaluatie!');
		evaluatieSpace.spawn(new evaluatieStuff());
		this.addSpace(evaluatieSpace);

		let uitlegSpace = new Space('uitleg');
		this.addSpace(uitlegSpace);
	}

	public init() {
		this.state = new cmstate(this.constructor.name, '_');
		this.state.populateMachines();
		this.state.to('default');
		// this.state.to('uitleg');

		return this;
	}

	public get gamewidth(): number {
		return MSX1ScreenWidth;
	}

	public get gameheight(): number {
		return MSX1ScreenHeight;
	}

	public collidesWithTile(o: GameObject, dir: Direction): boolean {
		return false;
	}

	public isCollisionTile(x: number, y: number): boolean {
		return false;
	}
};

class hoeraStuff extends Sprite {
	constructor() {
		super();
		this.z = 0;
		this.imgid = BitmapId.Sint;
	}

	override paint = (offset?: Point) => {
		let line1: string;
		let line2: string;
		let line3: string;

		let score = _model.score;
		switch (true) {
			case (score == 0):
				line1 = `De diamant is perfect!`;
				line2 = `Redelijk gedaan Joanneke!`;
				line3 = ``;
				break;
			case (score > 0 && score <= 2):
				line1 = `De diamant is imperfect`;
				line2 = `doch erg mooi!`;
				line3 = `Acceptabel gedaan Joanneke!`;
				break;
			case (score > 2):
				line1 = `De diamant is nu`;
				line2 = `een baksteen geworden.`;
				line3 = `Maar toch ok gedaan Joanneke!`;
				break;
		}

		TextWriter.drawText(16, 160, `${line1}`);
		TextWriter.drawText(16, 168, `${line2}`);
		TextWriter.drawText(16, 176, `${line3}`);

		paintSprite.call(this, offset); // .call() nodig, anders "this" undefined
	};
};

class uitlegStuff extends Sprite {
	@statedef_builder
	public static bouw(classname: string): cmdef {
		return new cmdef(classname, {
			machines: {
				master: new mdef('master', {
					states: {
						uitleg: new sdef('uitleg', {
							nudges2move: 300,
							tape: <Array<number>>[
								0,
								1,
								2,
								3,
								4,
								5,
								6,
							],
							onenter(s: sstate, ik: uitlegStuff) {
								s.reset();
								if (_model)
								_model.uitleg_tekst_dinges = s.current;
							},
							onrun(s: sstate, ik: uitlegStuff) {
								++s.nudges;
							},
							onnext(s: sstate, ik: uitlegStuff) {
								if (_model)
									_model.uitleg_tekst_dinges = s.current;
							},
							onend(s: sstate, ik: uitlegStuff) {
								if (_model)
									_model.state.to('default');
							},
						}),
					}
				})
			}
		});
	}

	constructor() {
		super();
		this.z = 0;
		this.imgid = BitmapId.diamond_front;
		this.hitarea = newArea(0, 0, 187, 105);
		this.size = newSize(187, 105);
		this.pos = newPoint((MSX2ScreenWidth - this.size.x) / 2, (MSX2ScreenHeight - this.size.y) / 2);
	}

	override paint = (offset?: Point) => {
		let line1: string;
		let line2: string;
		let line3: string;

		if (!_model) return;
		let bla = _model.uitleg_tekst_dinges;
		switch (bla) {
			case 0:
				line1 = `Deze diamant heeft blemishes!`;
				line2 = `Jij moet dit nu fixen!`;
				line3 = ``;
				break;
			case 1:
				line1 = `Gebruik de slijpsteen om`;
				line2 = `de diamant te herstellen!`;
				line3 = ``;
				break;
			case 2:
				line1 = `Bestuur de slijpsteen met`;
				line2 = `de cursortoetsen en zet deze`;
				line3 = `boven de kapotte delen.`;
				break;
			case 3:
				line1 = `Druk op lshift`;
				line2 = `Om de slijpsteen aan te zetten.`;
				line3 = ``;
				break;
			case 4:
				line1 = `Maar pas op!`;
				line2 = `Te lang slijpen maakt`;
				line3 = `nieuwe problemen en`;
				break;
			case 5:
				line1 = `Die moet je dan weer`;
				line2 = `repareren met de slijpsteen`;
				line3 = `Oh en je hebt 1 minuut!`;
				break;
			case 6:
				line1 = `De Sint gaat je beoordelen!`;
				line2 = `Goed geluk!`;
				line3 = ``;
				break;
		}

		TextWriter.drawText(16, 160, `${line1}`);
		TextWriter.drawText(16, 168, `${line2}`);
		TextWriter.drawText(16, 176, `${line3}`);

		paintSprite.call(this, offset); // .call() nodig, anders "this" undefined
	};

	override onspawn(spawningPos?: Point): void {
		this.state.to('uitleg');
	}
};

class evaluatieStuff extends Sprite {
	constructor() {
		super();
		this.z = 0;
		this.imgid = BitmapId.sint_evalueert;
	}

	override paint = (offset?: Point) => {
		TextWriter.drawText(4, 8, `Sinterklaas kijkt nu hoe goed`);
		TextWriter.drawText(4, 16, `je het hebt gedaan Joanneke...`);

		paintSprite.call(this, offset); // .call() nodig, anders "this" undefined
	};
};

class hud extends GameObject {
	@statedef_builder
	public static bouw(classname: string): cmdef {
		return new cmdef(classname, {
			machines: {
				master: new mdef('master', {
					states: {
						default: new sdef('default', {
							// nudges2move: 50,
							onenter(s: sstate, ik: hud) {
								s.reset();
								ik.visible = true;
							},
							onrun(s: sstate, ik: hud) {
								// ++s.nudges;
							},
							onnext(s: sstate, ik: hud) {
							},
						}),
					}
				})
			}
		});
	}

	constructor() {
		super();
		// this.imgid = BitmapId.None;
	}

	override onspawn(spawningPos?: Point): void {
		this.state.to('default');
	}

	override paint = (offset?: Point) => {
		TextWriter.drawText(0, 0, `Time to shine: ${_model.time_to_shine}`);
	};
}

class stoom extends Sprite {
	@statedef_builder
	public static bouw(classname: string): cmdef {
		return new cmdef(classname, {
			machines: {
				master: new mdef('master', {
					states: {
						doepluim: new sdef('doepluim', {
							tape: <Array<number>>[
								BitmapId.pluim1,
								BitmapId.pluim2,
								BitmapId.pluim3,
								BitmapId.pluim4,
								BitmapId.pluim5,
								BitmapId.pluim6,
								BitmapId.pluim7,
								BitmapId.pluim8,
								BitmapId.pluim9,
								BitmapId.pluimx,
								BitmapId.pluimx,
							],
							nudges2move: 2,
							onenter: (s: sstate, ik: stoom): void => {
								s.reset();
								ik.imgid = s.current;
							},
							onrun: (s: sstate, ik: stoom): void => {
								++s.nudges;
							},
							onnext: (s: sstate, ik: stoom): void => {
								ik.imgid = s.current;
							},
							onend: (_, ik: stoom): void => {
								ik.markForDisposure();
							}
						}),
					}
				})
			}
		});
	}

	constructor() {
		super();
		this.z = 1010;
		this.imgid = BitmapId.None;
	}

	override onspawn(spawningPos?: Point): void {
		super.onspawn(spawningPos);
		this.state.to('doepluim');
	}
}

class diamant extends Sprite {
	public _getoonde_zijde: zijde;

	public get getoonde_zijde() {
		return this._getoonde_zijde;
	}

	public set getoonde_zijde(_zijde: zijde) {
		this._getoonde_zijde = _zijde;

		switch (this._getoonde_zijde) {
			case zijde.Voor:
				this.imgid = BitmapId.diamond_front;
				this.hitarea = newArea(0, 0, 187, 105);
				this.size = newSize(187, 105);
				break;
			case zijde.Zij:
				this.imgid = BitmapId.diamond_front;
				this.hitarea = newArea(0, 0, 187, 105);
				this.size = newSize(187, 105);
				break;
			case zijde.Boven:
				this.imgid = BitmapId.diamond_top;
				this.hitarea = newArea(0, 0, 192, 192);
				this.size = newSize(192, 192);
				break;
		}

		this.pos = newPoint((MSX2ScreenWidth - this.size.x) / 2, (MSX2ScreenHeight - this.size.y) / 2);
	}

	constructor() {
		super('diamant');
		this.z = 0;
		this.getoonde_zijde = zijde.Voor;
	}
}

class draaischijf extends Sprite {
	@statedef_builder
	public static bouw(classname: string): cmdef {
		return new cmdef(classname, {
			machines: {
				master: new mdef('master', {
					states: {
						idle: new sdef('idle', {
							onenter: (s: sstate, ik: draaischijf): void => {
								s.reset();
								ik.imgid = BitmapId.slijpschijf1;
							},
							onrun(s: sstate, ik: draaischijf) {
								ik.handle_input_idle_state();
							},
						}),
						slijpen_opstart: new sdef('slijpen_opstart', {
							nudges2move: 5,
							auto_rewind_tape_after_end: false,
							tape: <Array<number>>[
								BitmapId.slijpschijf2,
								BitmapId.slijpschijf1,
								BitmapId.slijpschijf2,
								BitmapId.slijpschijf1,
								BitmapId.slijpschijf2,
								BitmapId.slijpschijf1,
								BitmapId.slijpschijf2,
								BitmapId.slijpschijf1,
								BitmapId.slijpschijf2,
							],
							onenter(s: sstate, ik: draaischijf) {
								s.reset();
								ik.imgid = s.current;
							},
							onrun(s: sstate, ik: draaischijf) {
								++s.nudges;
								ik.handle_input_slijp_opstart_state();
							},
							onend(s: sstate, ik: draaischijf) {
								ik.state.to('slijpen');
							},
							onnext(s: sstate, ik: draaischijf) {
								ik.imgid = s.current;
							},
						}),
						slijpen: new sdef('slijpen', {
							nudges2move: 10,
							tape: <Array<number>>[
								BitmapId.slijpschijf3,
								BitmapId.slijpschijf4,
							],
							onenter(s: sstate, ik: draaischijf) {
								s.reset();
								ik.imgid = s.current;
							},
							onrun(s: sstate, ik: draaischijf) {
								++s.nudges;
								ik.handle_input_slijp_state();
							},
							// onend(s: sstate, ik: draaischijf) {

							// },
							onnext(s: sstate, ik: draaischijf) {
								ik.imgid = s.current;
								if (s.head === 0) ++ik.pos.y;
								else --ik.pos.y;
								_model.spawn(new stoom(), newPoint(randomInt(ik.pos.x, ik.pos.x + ik.size.x), randomInt(ik.pos.y, ik.pos.y + ik.size.y)));
							},
						}),
						slijpen_afkoel: new sdef('slijpen_afkoel', {
							nudges2move: 5,
							auto_rewind_tape_after_end: false,
							tape: <Array<number>>[
								BitmapId.slijpschijf2,
								BitmapId.slijpschijf1,
								BitmapId.slijpschijf2,
								BitmapId.slijpschijf1,
								BitmapId.slijpschijf2,
								BitmapId.slijpschijf1,
								BitmapId.slijpschijf2,
								BitmapId.slijpschijf1,
								BitmapId.slijpschijf2,
							],
							onenter(s: sstate, ik: draaischijf) {
								s.reset();
								ik.imgid = s.current;
							},
							onrun(s: sstate, ik: draaischijf) {
								++s.nudges;
								ik.handle_input_slijp_afkoel_state();
							},
							onend(s: sstate, ik: draaischijf) {
								ik.state.to('idle');
							},
							onnext(s: sstate, ik: draaischijf) {
								ik.imgid = s.current;
							},
						}),
					}
				})
			}
		});
	}

	constructor() {
		super('draaischijf');
		this.z = 20;
		this.imgid = BitmapId.None; // Wordt goed gezet bij ingang start state
		this.onLeaveScreen = (ik: draaischijf, d: Direction, old_x_or_y: number) => prohibitLeavingScreenHandler(ik, d, old_x_or_y);
		this.size = { x: 64, y: 64 };
		this.hitarea = newArea(24, 24, 64 - 24, 64 - 24);
	}

	public handle_input_idle_state(): void {
		if (Input.KD_LEFT) {
			this.setx(this.pos.x - 1);
		}
		else if (Input.KD_RIGHT) {
			this.setx(this.pos.x + 1);
		}
		else if (Input.KD_UP) {
			this.sety(this.pos.y - 1);
		}
		else if (Input.KD_DOWN) {
			this.sety(this.pos.y + 1);
		}
		if (Input.KD_BTN1) {
			this.state.to('slijpen_opstart');
		}
	}

	public handle_input_slijp_opstart_state(): void {
		if (!Input.KD_BTN1) {
			this.state.to('slijpen_afkoel');
		}
	}

	public handle_input_slijp_afkoel_state(): void {
		if (Input.KD_BTN1) {
			this.state.to('slijpen_opstart');
		}
	}

	public handle_input_slijp_state(): void {
		if (!Input.KD_BTN1) {
			this.state.to('slijpen_afkoel');
		}
		else {
			// Slijpen!!
			_model.filter_and_foreach(
				o => (o as any).is_onvolmaaktheid,
				o => {
					let onvolmaaktje = o as onvolmaaktheid;
					if (onvolmaaktje.collides(this)) {
						onvolmaaktje.polijst_nudge();
					}
				}
			);
		}
	}

	override onspawn(spawningPos?: Point): void {
		super.onspawn(spawningPos);
		this.state.to('idle');
	}
}

export enum onvolmaaktheid_soort {
	Geen = 0,
	Barst = 1,
	Kras = 2,
	Dof = 3,
	Burn = 4,
}

export enum zijde {
	Voor = 0,
	Zij = 1,
	Boven = 2
}

abstract class onvolmaaktheid extends Sprite {
	public is_onvolmaaktheid = true; // Om objecten te filteren
	public ben_ik_nog_onvolmaakt = true; // Overwinningspunten tellen
	public soort: onvolmaaktheid_soort;
	public zijde: zijde;
	public _ernst: number;

	constructor(_soort: onvolmaaktheid_soort, _zijde: zijde, _plek: Point, __ernst?: number) {
		super();
		this.soort = _soort;
		this.zijde = _zijde;
		this.pos = _plek;
		this.z = 10;
		__ernst && (this._ernst = __ernst);
	}

	public polijst_nudge = (): void => {
		++this.state.getCurrentState().nudges;
	};

	override paint = (offset?: Point, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean; }) => {
		// Toon alleen als diamant op zelfde locatie is als dat diamant is weergegeven
		if (_model.diamant.getoonde_zijde == this.zijde) {
			paintSprite.call(this, offset, colorize); // .call() nodig, anders "this" undefined
		}
	};
}

class burn extends onvolmaaktheid {
	@statedef_builder
	public static bouw(classname: string): cmdef {
		return new cmdef(classname, {
			machines: {
				master: new mdef('master', {
					states: {
						wees_een_burn: new sdef('wees_een_burn', {
							nudges2move: 20,
							auto_rewind_tape_after_end: false,
							tape: <Array<number>>[
								BitmapId.burn1,
								BitmapId.burn2,
								BitmapId.burn3,
								BitmapId.burn4,
								BitmapId.burn5,
							],
							onenter(s: sstate, ik: burn) {
								s.reset();
								ik.imgid = s.current;
								ik.ben_ik_nog_onvolmaakt = true;
							},
							onrun(s: sstate) { },
							onend(s: sstate, ik: burn) {
								ik.state.to('gepolijst');
							},
							onnext(s: sstate, ik: burn) {
								ik.imgid = s.current;
							},
						}),
						gepolijst: new sdef('gepolijst', {
							nudges2move: 20,
							tape: <Array<number>>[
								BitmapId.None,
								BitmapId.None,
								BitmapId.None,
							],
							onenter(s: sstate, ik: burn) {
								s.reset();
								ik.imgid = s.current;
								ik.ben_ik_nog_onvolmaakt = false;
							},
							onrun(s: sstate) { },
							onend(s: sstate, _) { },
							onnext(s: sstate, ik: burn) {
								// BURN!!!!
								ik.state.to('wees_een_burn');
							}
						}),
					}
				})
			}
		});
	}

	override onspawn = (spawningPos?: Point): void => {
		super.onspawn?.(spawningPos);
		this.state.to('wees_een_burn');
	};

	constructor(_zijde: zijde, _plek: Point, __ernst?: number) {
		super(onvolmaaktheid_soort.Burn, _zijde, _plek, __ernst);
		this.imgid = BitmapId.Letter_A;
		this.hitarea = newArea(0, 0, 40, 31);
		this.size = newSize(40, 31);
	}
}

class barst extends onvolmaaktheid {
	@statedef_builder
	public static bouw(classname: string): cmdef {
		return new cmdef(classname, {
			machines: {
				master: new mdef('master', {
					states: {
						wees_een_barst: new sdef('wees_een_barst', {
							nudges2move: 20,
							tape: <Array<number>>[
								BitmapId.break1,
								BitmapId.break2,
								BitmapId.break3,
								BitmapId.break4,
								BitmapId.break5,
								BitmapId.break6,
							],
							onenter(s: sstate, ik: barst) {
								s.reset();
								ik.imgid = s.current;
								ik.ben_ik_nog_onvolmaakt = true;
							},
							onrun(s: sstate) { },
							onend(s: sstate, ik: barst) {
								ik.state.to('gepolijst');
							},
							onnext(s: sstate, ik: barst) {
								ik.imgid = s.current;
							},
						}),
						gepolijst: new sdef('gepolijst', {
							nudges2move: 40,
							onenter(s: sstate, ik: barst) {
								s.reset();
								ik.imgid = BitmapId.None;
								ik.ben_ik_nog_onvolmaakt = false;
							},
							onrun(s: sstate) { },
							onend(s: sstate, _) { },
							onnext(s: sstate, ik: barst) {
								// BURN!!!!
								_model.spawn(new burn(ik.zijde, copyPoint(ik.pos)));
								ik.disposeFlag = true; // Vervang met nieuwe soort onvolmaaktheid
							}
						}),
						// gedaan: new sdef('gedaan', {
						// 	onenter(s: sstate, ik: barst) {
						// 		s.reset();
						// 		ik.imgid = BitmapId.None;
						// 	}
						// }),
					}
				})
			}
		});
	}

	public get ernst() {
		return this._ernst;
	}

	public set ernst(x) {
		this._ernst = x;
		let s = this.state.getState('wees_een_barst');
		s.reset();
		s.head = this.max_ernst() - this._ernst;
	}

	private max_ernst() {
		let s = this.state.getState('wees_een_barst');
		return s.tape.length - 1;
	}

	override onspawn = (spawningPos?: Point): void => {
		super.onspawn?.(spawningPos);
		this.state.to('wees_een_barst');
	};

	constructor(_zijde: zijde, _plek: Point, __ernst?: number) {
		super(onvolmaaktheid_soort.Barst, _zijde, _plek);
		let defaultErnst = this.max_ernst();
		__ernst && (this.ernst = defaultErnst);
		this.hitarea = newArea(0, 0, 40, 31);
		this.size = newSize(40, 31);
	}
}

class viewclass extends GLView {
	override drawgame(): void {
		super.drawgame();
		super.drawSprites();
	}
};

let _model: modelclass;

var _global = window || global;
_global['h406A'] = (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode): void => {
	let _view = new viewclass(newSize(MSX1ScreenWidth, MSX1ScreenHeight));
	_model = new modelclass();
	new Game(rom, _model, _view, sndcontext, gainnode);
	global.view.default_font = new KonamiFont();

	global.game.start();
	let model = global.model as modelclass;
	let _diamant = new diamant();
	let _draaischijf = new draaischijf();

	model.setSpace('default');
	model.spawn(new hud());
	model.spawn(_diamant);
	model.spawn(_draaischijf, newPoint(96, 120));
	model.spawn(new barst(zijde.Voor, newPoint(_diamant.pos.x + 30, _diamant.pos.y + 10)));
	model.spawn(new barst(zijde.Voor, newPoint(_diamant.pos.x + 60, _diamant.pos.y + 40)));
	model.spawn(new barst(zijde.Voor, newPoint(_diamant.pos.x + 110, _diamant.pos.y + 20)));
	model.spawn(new barst(zijde.Voor, newPoint(_diamant.pos.x + 80, _diamant.pos.y + 60)));

	model.state.to('uitleg');
};

// https://www.25karats.com/education/diamonds/features
// Diamond Inclusions
// Inclusions are internal clarity characteristic of a diamond.

// crystal	Sometimes a diamond contains a mineral crystal that looks like a bubble or black spot and this feature is called crystal.
// needle	A long and thin crystal.
// pinpoint	A tiny crystal that appears like a dot.
// cloud	A grayish patch that consists of a group of pinpoints.
// twinning wisp	A ribbon like inclusion on the diamond’s growth plane.
// internal graining	Irregularities in crystal growth may cause some lines or textures that appear like haze on the diamond surface.
// grain center	Although not visible from every angle, grain center looks like a transparent tornado inside the diamond..
// feather	Any break in a diamond.There are two types: cleavage is a break that is in a cleavage plane, and fracture is one that is in any other direction.Feathers can get larger with a hard knock and thus considered more problematic than any other inclusion.
// bearded girdle	Fine feathers scattered around the diamond’s perimeter.If it’s heavy, it can go all the way around the stone.
// bruise	A small tree - root like feather caused by a hard blow.
// knot	A shallow opening on the surface caused by damage after cut and polish.
// chip	A ribbon like inclusion on the diamond’s growth plane.
// cavity	A deep opening with visible drag lines at side.
// indented natural	A part of the rough diamond surface that goes below the polished diamond surface and leaves triangle shaped or parallel grooves.
// laser drill - hole	A tiny tunnel shaped inclusion caused by laser beam process.;

// Diamond Blemishes
// Blemishes are external clarity characteristic of a diamond.

// abrasion	Small nicks on the facet caused by mishandling of the stones.It can happen when diamonds rub against one another.
// pit	A tiny cavity that looks like a white dot.
// nicks	Small surface chips caused by wear.
// lines	Visible lines at surface that run across facet junctions.
// naturals	A part of the rough crystal surface that was not polished on the polished stone.They are usually on or near the girdle.If the term “indented natural” is used, that means the natural extends onto the crown or pavilion.
// scratches and wheel marks	Scratches are caused by improper storage of the diamond in the diamond paper or contact with other diamonds.If diamond is polished without care, grooves called wheel marks can occur.
// extra facets	Facets placed on a diamond to polish out small blemishes like a natural or nick.They may be additional to any facet needed for a specific cut style.Extra facets don’t affect the clarity grade.
// rough girdle	A girdle surface that is irregular, pitted, and sometimes chipped.This can be a sign of weakness.
// burn marks	Marks caused by either too fast polishing or a real heat source.It can be polished out.;