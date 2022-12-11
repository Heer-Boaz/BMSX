import { RomLoadResult } from '../bmsx/rompack';
import { Game, BaseModel, GameObject, Sprite, sdef, mdef, leavingScreenHandler_prohibit as prohibitLeavingScreenHandler, statedef_builder, cmdef, sstate, cmstate, setPoint, newPoint, Direction, newSize, newArea, Point, randomInt, copyPoint, getOppositeDirection, Space } from '../bmsx/bmsx';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';
import { TextWriter } from '../bmsx/textwriter';
import { DrawImgFlags, paintSprite } from '../bmsx/view';
import { GameMenu } from './gamemenu';
import { KonamiFont } from './konamifont';

class modelclass extends BaseModel {
	public get diamant() : diamant {
		return this.get('diamant');
	}
	public get draaischijf() : draaischijf {
		return this.get('draaischijf');
	}

	public get_onvolmaaktheden() : onvolmaaktheid[] {
		return this.filter(o => (o as any).is_onvolmaaktheid) as onvolmaaktheid[];
	}

    @statedef_builder
    public static buildModelStates(classname: string): cmdef {
        return new cmdef(classname, {
            machines: {
                master: new mdef('default', {
                    states: {
                        default: new sdef('default', {
                            onrun() {
                                BaseModel.defaultrun();
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
                        'hoera!': new sdef('hoera!', {
                            onenter() {
                                global.model.setSpace('hoera!');
                            }
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
    }

    public init() {
        this.state = new cmstate(this.constructor.name, '_');
        this.state.populateMachines();
        this.state.to('default');

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
        this.z = 5000;
        this.imgid = BitmapId.Sint;
    }
};

class diamant extends Sprite {
	public _getoonde_zijde : zijde;

	public get getoonde_zijde() {
		return this._getoonde_zijde;
	}

	public set getoonde_zijde(_zijde : zijde) {
		this._getoonde_zijde = _zijde;

		switch (this._getoonde_zijde) {
			case zijde.Voor: this.imgid = BitmapId.diamond_front; break;
			case zijde.Zij: this.imgid = BitmapId.diamond_front; break;
			case zijde.Boven: this.imgid = BitmapId.diamond_top; break;
		}
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
							nudges2move: 1,
							onenter: (s: sstate, ik: draaischijf): void => {
								s.reset();
								ik.imgid = s.current;
							},
							onrun(s: sstate, ik: draaischijf) {
								switch (ik.direction) {
									case Direction.Up: ik.sety(ik.pos.y - 1); break;
									case Direction.Right: ik.setx(ik.pos.x + 1); break;
									case Direction.Down: ik.sety(ik.pos.y + 1); break;
									case Direction.Left: ik.setx(ik.pos.x - 1); break;
								}
							},
						}),
						slijpen: new sdef('slijpen', {
							nudges2move: 2,
							tape: <Array<number>> [
								BitmapId.Corona4,
								BitmapId.Corona11,
								BitmapId.None,
							],
							onenter(s: sstate, ik: draaischijf) {
								s.reset();
								ik.imgid = s.current;
							},
							onrun(s: sstate) {
								++s.nudges;
							},
							onend(s: sstate, ik: draaischijf) {
								s.reset();
							},
							onnext(s: sstate, ik: draaischijf) {
								ik.imgid = s.current;
							},
						})
					}
				})
			}
		});
	}

	constructor() {
		super('draaischijf');
		this.z = 100;
		this.imgid = BitmapId.None; // TODO: Naar echte plaatje
		this.onLeaveScreen = (ik: draaischijf, d: Direction, old_x_or_y: number) => prohibitLeavingScreenHandler(ik, d, old_x_or_y);
		this.size = { x: 32, y: 32 };
		this.hitarea = newArea(4, 4, 28, 28);
	}

	public handle_input_idle_state(): void {
		if (Input.KC_LEFT) {
			this.setx(this.pos.x - 1);
		}
		else if (Input.KC_RIGHT) {
			this.setx(this.pos.x + 1);
		}
		else if (Input.KC_UP) {
			this.sety(this.pos.y - 1);
		}
		else if (Input.KC_DOWN) {
			this.sety(this.pos.y + 1);
		}
		if (Input.KC_BTN1) {
			this.state.to('slijpen');
		}
	}

	public handle_input_slijp_state(): void {
		if (!Input.KC_BTN1) {
			this.state.to('idle');
		}
	}

	override onspawn(spawningPos?: Point): void {
		super.onspawn(spawningPos);
		this.state.to('bla');
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
	public soort : onvolmaaktheid_soort;
	public zijde : zijde;
	public _ernst : number;

	constructor(_soort : onvolmaaktheid_soort, _zijde : zijde, _plek : Point, __ernst? : number) {
		super();
		this.soort = _soort;
		this.zijde = _zijde;
		this.pos = _plek;
		__ernst && (this._ernst = __ernst);
	}

	override paint = (offset?: Point, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean; }) => {
		// Toon alleen als diamant op zelfde locatie is als dat diamant is weergegeven
		if (_model.diamant.getoonde_zijde == this.zijde) {
			paintSprite.call(this, offset, colorize); // .call() nodig, anders "this" undefined
		}
	}
}

class burn extends onvolmaaktheid {
	constructor(_zijde : zijde, _plek : Point, __ernst? : number) {
		super(onvolmaaktheid_soort.Burn, _zijde, _plek, __ernst);
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
								BitmapId.None,
							],
							onenter(s: sstate, ik: barst) {
								s.reset();
								ik.imgid = s.current;
							},
							onrun(s: sstate) { },
							onend(s: sstate, ik: barst) {
								s.reset();
							},
							onnext(s: sstate, ik: barst) {
								ik.imgid = s.current;
							},
						}),
						gepolijst: new sdef('gepolijst', {
							nudges2move : 40,
							onenter(s: sstate, ik: barst) {
								s.reset();
								ik.imgid = BitmapId.None;
							},
							onrun(s: sstate) { },
							onend(s: sstate, _) { },
							onnext(s: sstate, ik: barst) {
								// BURN!!!!
								global.model.spawn(new burn(this.zijde, copyPoint(this.pos)));
								ik.state.to('gedaan');
							}
						}),
						gedaan: new sdef('gedaan', {
							onenter(s: sstate, ik: barst) {
								s.reset();
								ik.imgid = BitmapId.None;
							}
						}),
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

	constructor(_zijde: zijde, _plek: Point, __ernst: number) {
		super(onvolmaaktheid_soort.Barst, _zijde, _plek);
		let defaultErnst = this.max_ernst();
		__ernst && (this.ernst = defaultErnst);
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
    let model = global.model;
	let _diamant = new diamant();

    model.spawn(diamant, newPoint(30, 142));
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