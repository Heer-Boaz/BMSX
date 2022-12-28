import { RomLoadResult } from '../bmsx/rompack';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';
import { TextWriter } from '../bmsx/textwriter';
import { DrawImgFlags, paintSprite } from '../bmsx/view';
import { GameMenu } from './gamemenu';
import { statedef_builder, mdef, sdef, sstate } from '../bmsx/bfsm';
import { Direction, newArea, new_vec2, vec2, new_vec2, randomInt, Game, BFont } from '../bmsx/bmsx';
import { GameObject } from '../bmsx/gameobject';
import { BaseModel, Space } from '../bmsx/model';
import { SpriteObject } from '../bmsx/sprite';

// https://drive.google.com/file/d/1vyCxVBeMr89pQdUBCUcDjW6W2ImA6q2j/view?usp=sharing

class modelclass extends BaseModel {
    public marlies: speler;
    public stressLevel: number;
    public enemyHp: number;
    public monster: monster;

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
        this.stressLevel = 100;
        this.enemyHp = 100;
    }

    public init_model_state_machines() {
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

class hoeraStuff extends SpriteObject {
    constructor() {
        super();
        this.z = 5000;
        this.imgid = BitmapId.Sint;
    }
};

class fles extends SpriteObject {
    @statedef_builder
    public static bouw(classname: string) {
        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        vlieg: new sdef('vlieg', {
                            tape: <Array<number>>[
                                BitmapId.fles2,
                                BitmapId.fles3,
                                BitmapId.fles4,
                                BitmapId.fles1,
                            ],
                            nudges2move: 4,
                            onenter: (s: sstate, ik: fles): void => {
                                s.reset();
                                ik.imgid = s.current;
                            },
                            onrun: (s: sstate, ik: fles): void => {
                                ++s.nudges;
                                ik.setx(ik.pos.x + 4);
                                if (_model.monster) {
                                    if (ik.pos.x >= _model.monster.pos.x - 12) {
                                        _model.monster.collide(ik);
                                        ik.markForDisposure();
                                    }
                                }
                                // if (ik.objectCollide(_model.monster)) {
                                //     _model.monster.collide(ik);
                                // }
                            },
                            onnext: (s: sstate, ik: fles): void => {
                                ik.imgid = s.current;
                            },
                            onend: (s: sstate, ik: fles): void => {
                                s.reset();
                            }
                        }),
                    }
                })
            }
        });
    }

    constructor() {
        super();
        this.z = 1020;
        this.imgid = BitmapId.fles2;
        this.onLeaveScreen = (ik: fles, _) => ik.markForDisposure();
        let me = this;

        this.hitarea = newArea(4, 4, 12, 12);
        this.size = new_vec2(16, 16);
        this.hittable = true;
    }

    override onspawn(spawningPos?: vec2): void {
        super.onspawn(spawningPos);
        this.state.to('vlieg');
    }
}

class stoom extends SpriteObject {
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
                            nudges2move: 4,
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

    override onspawn(spawningPos?: vec2): void {
        super.onspawn(spawningPos);
        this.state.to('doepluim');
    }
}

class monster extends SpriteObject {
    constructor() {
        super();
        this.imgid = BitmapId.monster;
        this.z = 1100;
        this.hitarea = newArea(0, 80, 0, 50);
        this.size = new_vec2(80, 50);
        this.hittable = true;
        let me = this;

        this.oncollide = (src: GameObject) => {
            _model.enemyHp -= 10;
            if (_model.enemyHp <= 0) {
                me.markForDisposure();
                // _model.monster = null;
                _model.marlies.state.to('naarrelax');
            }
        };
    }

    override onspawn(spawningPos?: vec2): void {
        super.onspawn(spawningPos);
        _model.monster = this;
    }
}

class speler extends SpriteObject {
    public floatbit: boolean;

    @statedef_builder
    public static bouw(classname: string): cmdef {
        let shared_switch_run = (_: sstate, ik: speler) => {
            // if (Input.KC_BTN1 || Input.KC_SPACE) ik.zetBoelInDeHens();
            let switchToOld = (): void => {
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
                        relax: new sdef('relax', {
                            nudges2move: 4,
                            onrun: (s: sstate, ik: speler): void => {
                                ++s.nudges;
                            },
                            onenter: (_, ik: speler) => {
                                ik.hittable = false;
                                ik.imgid = BitmapId.p1;
                            },
                            onnext: (s: sstate, ik: speler): void => {
                                s.reset();
                                --_model.stressLevel;
                                if (_model.stressLevel <= 0) {
                                    _model.stressLevel = 0;
                                    ik.state.to('spot');
                                    _model.enemyHp = 100;
                                    _model.spawn(new monster(), new_vec2(256 - 80, 192 - 60));
                                }
                            }
                        }),
                        spot: new sdef('spot', {
                            nudges2move: 500,
                            onrun: (s: sstate, ik: speler): void => {
                                ++s.nudges;
                            },
                            onenter: (_, ik: speler) => ik.imgid = BitmapId.p2,
                            onnext: (s: sstate, ik: speler): void => {
                                s.reset();
                                ik.state.to('spot2');
                            }
                        }),
                        spot2: new sdef('spot2', {
                            nudges2move: 500,
                            onrun: (s: sstate, ik: speler): void => {
                                ++s.nudges;
                            },
                            onenter: (_, ik: speler) => ik.imgid = BitmapId.p2,
                            onnext: (s: sstate, ik: speler): void => {
                                s.reset();
                                ik.state.to('boos');
                            }
                        }),
                        naarrelax: new sdef('naarrelax', {
                            nudges2move: 100,
                            onrun: (s: sstate, ik: speler): void => {
                                ++s.nudges;
                            },
                            onenter: (_, ik: speler) => ik.imgid = BitmapId.p2,
                            onnext: (s: sstate, ik: speler): void => {
                                s.reset();
                                ik.state.to('relax2');
                            }
                        }),
                        relax2: new sdef('relax2', {
                            nudges2move: 4,
                            onrun: (s: sstate, ik: speler): void => {
                                ++s.nudges;
                            },
                            onenter: (_, ik: speler) => {
                                ik.hittable = false;
                                ik.imgid = BitmapId.p1;
                            },
                            onnext: (s: sstate, ik: speler): void => {
                                s.reset();
                                --_model.stressLevel;
                                if (_model.stressLevel <= 0) {
                                    _model.stressLevel = 0;
                                    ik.state.to('waitforit');
                                }
                            }
                        }),
                        waitforit: new sdef('waitforit', {
                            nudges2move: 100,
                            onrun: (s: sstate, ik: speler): void => {
                                ++s.nudges;
                            },
                            onenter: (_, ik: speler) => {
                            },
                            onnext: (s: sstate, ik: speler): void => {
                                s.reset();
                                _model.state.to('hoera!');
                            }
                        }),
                        boos: new sdef('boos', {
                            nudges2move: 40,
                            onrun: (s: sstate, ik: speler): void => {
                                ++s.nudges;
                            },
                            onenter: (_, ik: speler) => ik.imgid = BitmapId.p3,
                            onnext: (s: sstate, ik: speler): void => {
                                s.reset();
                                ik.state.to('fight');
                            }
                        }),
                        fight: new sdef('fight', {
                            onrun: (_, ik: speler): void => {
                                if (++_model.stressLevel >= 100) {
                                    _model.stressLevel = 100;
                                }
                                if (Input.KC_BTN1) {
                                    ik.state.to('gooi');
                                }
                                if (Input.KD_RIGHT) {
                                    if (ik.pos.x <= 148)
                                        ik.setx(ik.pos.x + 1);
                                }
                                if (Input.KD_LEFT) {
                                    if (ik.pos.x >= 30)
                                        ik.setx(ik.pos.x - 1);
                                }
                            },
                            onenter: (_, ik: speler) => {
                                ik.hittable = true;
                                ik.imgid = BitmapId.p3;
                            }
                        }),
                        gooi: new sdef('gooi', {
                            onrun: (_, ik: speler): void => {
                                if (++_model.stressLevel >= 100) {
                                    _model.stressLevel = 100;
                                }
                            },
                            onenter: (_, ik: speler) => {
                                ik.state.to('gooi', 'anistate');
                                ik.imgid = BitmapId.p4;
                            }
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
                float: new mdef('float', {
                    states: {
                        floating: new sdef('floating', {
                            nudges2move: 50,
                            onrun: (s: sstate, ik: speler): void => {
                                ++s.nudges;
                            },
                            onnext: (s: sstate, ik: speler): void => {
                                ik.floatbit && --ik.pos.y;
                                (!ik.floatbit) && ++ik.pos.y;
                                ik.floatbit = !ik.floatbit;
                            },
                        }),
                    }
                }),
                anistate: new mdef('anistate', {
                    states: {
                        relax: new sdef('relax', {
                            onrun: (): void => { }
                        }),
                        spot: new sdef('spot', {
                            onrun: (): void => { }
                        }),
                        boos: new sdef('boos', {
                            onrun: (): void => { }
                        }),
                        gooi: new sdef('gooi', {
                            tape: <Array<number>>[
                                BitmapId.p4,
                                BitmapId.p4,
                                BitmapId.p5,
                                BitmapId.p5,
                            ],
                            nudges2move: 4,

                            onrun: (s: sstate): void => { ++s.nudges; },
                            onnext: (s: sstate, ik: speler): void => {
                                ik.imgid = s.current;
                            },
                            onend: (_, ik: speler): void => {
                                ik.state.to('boos', 'anistate');
                                ik.state.to('fight');
                                _model.spawn(new fles(), new_vec2(ik.pos.x + 16, ik.pos.y));
                            }
                        }),

                    }
                }),
            }
        });
    }

    constructor() {
        super();
        this.imgid = BitmapId.p1;
        this.direction = Direction.Right;
        this.z = 1000;
        this.floatbit = false;
        this.hitarea = newArea(0, 0, 16, 16);
        this.size = new_vec2(16, 16);
    }

    override onspawn(spawningPos?: vec2): void {
        super.onspawn(spawningPos);
        this.state.to('relax');
        this.state.to('relax', 'anistate');
        this.state.to('floating', 'float');
    }

    override paint = (offset?: vec2, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean; }) => {
        if (this.state.getCurrentId() == 'spot') {
            TextWriter.drawText(64, 40, "Artiestieke impressie");
            TextWriter.drawText(64, 48, "van stressoren zoals");
            TextWriter.drawText(64, 56, "corona,moederzorgen,");
            TextWriter.drawText(64, 64, "voetbal en f1.");

            _global.view.drawImg(BitmapId.arrowed, 0, 32, DrawImgFlags.None);
        }
        if (this.state.getCurrentId() == 'spot2') {
            TextWriter.drawText(64, 40, "Druk de shifttoets");
            TextWriter.drawText(64, 48, "om meditatietechnieken");
            TextWriter.drawText(64, 56, "toe te passen tegen,");
            TextWriter.drawText(64, 64, "de stressoren!");
            TextWriter.drawText(64, 72, "Beweeg met");
            TextWriter.drawText(64, 80, "links en rechts!");
        }

        paintSprite.call(this, offset, colorize); // .call() nodig, anders "this" undefined
    };

};

class yakuzi extends SpriteObject {
    @statedef_builder
    public static bouw(classname: string): cmdef {
        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        wees_een_yakuzi: new sdef('wees_een_yakuzi', {
                            nudges2move: 50,
                            onenter(s: sstate) {
                                s.reset();
                            },
                            onrun(s: sstate) {
                                ++s.nudges;
                            },
                            onnext() {
                                _model.spawn(new stoom(), new_vec2(randomInt(8, 160), randomInt(140, 172)));
                            },
                        }),
                    }
                })
            }
        });
    }

    constructor() {
        super();
        this.imgid = BitmapId.chillruimte;
        this.z = 0;
    }

    override onspawn(spawningPos?: vec2): void {
        super.onspawn(spawningPos);
        this.state.to('wees_een_yakuzi');
    }
};

class hud extends SpriteObject {
    protected static HealthBarSizeX: number = 63;

    constructor() {
        super();
        this.z = 2000;
        this.imgid = BitmapId.HUD;
    }

    private percentageToBarLength(percentage: number): number {
        if (percentage === 0) return 0;
        // Let op: +1 wegens scaling i.p.v. render-loop!
        if (percentage === 100) return hud.HealthBarSizeX + 1;
        return ~~(hud.HealthBarSizeX / 100 * percentage) + 1;
    }

    override paint = (offset?: vec2, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean; }) => {
        let lengthShown = this.percentageToBarLength(_model.stressLevel);
        _global.view.drawImg(BitmapId.HUD_stress, 60, 10, DrawImgFlags.None, lengthShown);

        lengthShown = this.percentageToBarLength(_model.enemyHp);
        _global.view.drawImg(BitmapId.HUD_enemy, 60, 19, DrawImgFlags.None, lengthShown);
        paintSprite.call(this, offset, colorize); // .call() nodig, anders "this" undefined
    };
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
    let _view = new viewclass(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
    _model = new modelclass();
    new Game(rom, _model, _view, sndcontext, gainnode);
    global.view.default_font = new BFont(BitmapId);

    global.game.start();
    let model = global.model;
    model.spawn(new yakuzi(), new_vec2(0, 32));
    model.spawn(new hud(), new_vec2(0, 0));
    let marlies = new speler();
    _model.marlies = marlies;
    model.spawn(marlies, new_vec2(30, 142));
};
