import { RomLoadResult } from '../bmsx/rompack';
import { Game, BaseModel, GameObject, Sprite,  sdef, mdef, leavingScreenHandler_prohibit as prohibitLeavingScreenHandler, statedef_builder, cmdef, sstate, cmstate, setPoint, newPoint, Direction, newSize, newArea, Point, randomInt, copyPoint, getOppositeDirection, Space } from '../bmsx/bmsx';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';
import { TextWriter } from '../bmsx/textwriter';
import { paintSprite } from '../bmsx/view';
import { GameMenu } from './gamemenu';
import { KonamiFont } from './konamifont';

// https://drive.google.com/file/d/1vyCxVBeMr89pQdUBCUcDjW6W2ImA6q2j/view?usp=sharing

class modelclass extends BaseModel {
    public marlies: Sprite;

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
                       'gamemenu': new sdef('gamemenu', {
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

    override paint = (offset?: Point, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean; }) => {
        TextWriter.drawText(24, 100, "Redelijk gedaan,Marlies!");
        paintSprite.call(this, offset, colorize); // .call() nodig, anders "this" undefined
    }
};

class speler extends Sprite {
    @statedef_builder
    public static bouw(classname: string): cmdef {
        let shared_switch_run = (_: sstate, ik: speler) => {
            // if (Input.KC_BTN1 || Input.KC_SPACE) ik.zetBoelInDeHens();
            let switchToOld = (): void => {
                ik.direction = ik.oldDirection;
                ik.state.to('walk');
                switch (ik.direction) {
                    case Direction.Down:
                        ik.state.to('down', 'anistate');
                        break;
                    case Direction.Up:
                        ik.state.to('up', 'anistate');
                        break;
                }
            };
        };

        let down_up_state_def: Partial<sdef> = {
            nudges2move: 8,
            onenter: (s: sstate, ik: speler): void => (s.reset(), ik.imgid = s.current),
            onrun: (s: sstate, ik: speler): void => { ++s.nudges; },
            onend: (s: sstate, ik: speler): void => s.reset(),
            onnext: (s: sstate, ik: speler): void => ik.imgid = s.current,
        };

        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        walk: new sdef('walk', {
                            onrun: (_, ik: speler): void => {
                                if (Input.KC_LEFT) {
                                }
                                else if (Input.KC_RIGHT) {
                                }
                                else if (Input.KD_UP) {
                                }
                                else if (Input.KD_DOWN) {
                                }
                                if (Input.KC_BTN1 || Input.KC_SPACE) {
                                }
                                if (Input.KC_BTN2) {
                                }
                            },
                            onenter: (_, ik: speler) => ik.hittable = true
                        }),
                        urgh: new sdef('urgh', {
                            onenter: (_, ik: speler) => {
                                ik.hittable = false; // Kan niet opnieuw geraakt worden als eenmaal in pain
                                ik.state.to('urgh', 'anistate');
                            }
                            // Lelijk, maar animatie-state zorgt voor terugkeer naar previous state
                        }),
                        win: new sdef('win', {
                            nudges2move: 300,
                            onenter: (_, ik: speler) => ik.state.to('win', 'anistate'),
                            onrun: (s: sstate) => (++s.nudges, _model.objects.filter(o => (<any>o).isEng).forEach(o => o.disposeFlag = true)),
                            onnext: () => _model.state.to('hoera!')
                        }),
                    }
                }),
                anistate: new mdef('anistate', {
                    states: {
                    }
                }),
            }
        });
    }

    constructor() {
        super();
        this.imgid = BitmapId.p1;
        this.direction = Direction.Down;
        this.z = 1000;
        this.hitarea = newArea(0, 8, 16, 16);
    }

    override onspawn(spawningPos?: Point): void {
        super.onspawn(spawningPos);
        this.state.to('walk');
        this.state.to('down', 'anistate');
    }
};

class yakuzi extends Sprite {
    @statedef_builder
    public static bouw(classname: string): cmdef {
        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        wees_een_yakuzi: new sdef('wees_een_yakuzi', {
                            // nudges2move: TIME_CORONA_SPAWN,
                            onenter(s: sstate) {
                                s.reset();
                            },
                            onrun(s: sstate) {
                                ++s.nudges;
                            },
                            onnext() {
                            },
                        }),
                    }
                })
            }
        });
    }

    constructor() {
        super();
        this.imgid = BitmapId.Yakuzi;
        this.z = 0;
    }

    override onspawn(spawningPos?: Point): void {
        super.onspawn(spawningPos);
        this.state.to('wees_een_yakuzi');
    }
};

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
    model.spawn(new yakuzi(), newPoint(0, 0));
    let marlies = new speler();
    _model.marlies = marlies;
    // model.spawn(marlies, newPoint(COLUMN_X[START_COLUMN], 16));
    model.spawn(marlies, newPoint(16, 16));
};
