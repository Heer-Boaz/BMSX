import { RomLoadResult } from '../bmsx/rompack';
import { Game, BaseModel, GameObject, Sprite, sdef, mdef, leavingScreenHandler_prohibit as prohibitLeavingScreenHandler, statedef_builder, cmdef, sstate, cmstate, setPoint, newPoint, Direction, newSize, newArea, Point, randomInt, copyPoint, getOppositeDirection, Space } from '../bmsx/bmsx';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';
import { TextWriter } from '../bmsx/textwriter';
import { paintSprite } from '../bmsx/view';
import { GameMenu } from './gamemenu';
import { KonamiFont } from './konamifont';

const COLUMN_X = <Array<number>>[36, 48, 80, 160, 200];
const START_COLUMN = 1;
const MAX_CORONA = 3;
const TIME_CORONA_SPAWN = 200;
const MIN_CORONA_MOVE = 16;
const MAX_CORONA_MOVE = 72;
const CORONA_SPAWN_LOCS = <Array<Point>>[
    { x: MSX1ScreenWidth, y: 0 },
    { x: MSX1ScreenWidth, y: MSX1ScreenHeight },
];
const PITAS_OP_BORD_VOOR_WINST = 1;
const INGREDIENTEN_IN_PITA = 3;
const INVENTORY_POS = { x: 12, y: 12 };

// https://drive.google.com/file/d/1vyCxVBeMr89pQdUBCUcDjW6W2ImA6q2j/view?usp=sharing

class modelclass extends BaseModel {
    public marlies: Sprite;
    public ingredientEquipped: Ingredient;
    public pitasOpBord: number;

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
        this.pitasOpBord = 0;
        this.ingredientEquipped = null;
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

    public doePotentieelOprapen(o: Ingredient | Pita): void {
        if (o.ingredientType) {
            let type: string = o.ingredientType;
            if (this.ingredientEquipped?.ingredientType == 'mes') {
                if (type == 'komkommer') {
                    o.ingredientType = 'gesneden_komkommer';
                    o.imgid = BitmapId.Komkommer_gesneden;

                    this.ingredientEquipped.markForDisposure();
                    this.ingredientEquipped = null; // Haal inventory leeg
                }
            }
            else if (type != 'pita' && type != 'komkommer') { // Kan alleen gevulde pita of ingredienten oppakken en ook geen ongesneden komkommer
                if (this.ingredientEquipped) return;
                this.ingredientEquipped = o as Ingredient | Pita;
                this.ingredientEquipped.pos.x = INVENTORY_POS.x;
                this.ingredientEquipped.pos.y = INVENTORY_POS.y;
                this.ingredientEquipped.z = 2100;
                // _model.currentSpace.sortObjectsByPriority();
            }
        }
    }

    public ProbeerEquippedInPitaTeProppen(pita: Pita): void {
        if (!this.ingredientEquipped) return; // Als je niets hebt, kan je ook niets vullen
        let type: string = this.ingredientEquipped.ingredientType;
        if (type == 'gesneden_komkommer' || type == 'tomaatjes' || type == 'falafel') { // Kan alleen ingredienten in pita stoppen
            // Check of dit ingredient als was gestopt in deze pita
            if (!pita.ingredientenInPita.some(i => i == type)) {
                pita.ingredientenInPita.push(type);
                this.ingredientEquipped.markForDisposure(); // Exile ingredient
                this.ingredientEquipped = null; // Haal inventory leeg
                // Check of pita nu gevul>d is met alle ingredienten
                if (pita.ingredientenInPita.length == INGREDIENTEN_IN_PITA) {
                    pita.nuGevuld(); // Zo ja, verander type en plaatje van de pita
                }
            }
        }
    }

    public checkOfIetsMetBordMogelijk(bord: Bord): void {
        if (!this.ingredientEquipped || this.ingredientEquipped.ingredientType != 'gevulde_pita') return;
        this.plaatsPitaOpBord(bord);
    }

    public plaatsPitaOpBord(bord: Bord): void {
        if (!(<Pita>this.ingredientEquipped)?.gevuld || bord.gevuld) return;

        // Plaats pita op bord
        bord.nuGevuld();
        this.ingredientEquipped.pos.x = bord.pos.x;
        this.ingredientEquipped.pos.y = bord.pos.y; // Plaats pita op bord
        this.ingredientEquipped.z = 850;
        // _model.currentSpace.sortObjectsByPriority();

        this.ingredientEquipped = null; // Haal inventory leeg
        if (++this.pitasOpBord >= PITAS_OP_BORD_VOOR_WINST) {
            this.marlies.state.to('win');
            this.filter_and_foreach(o => (<any>o).isEng, o => o.markForDisposure());
            // this.objects.filter(o => (<any>o).isEng).forEach(o => o.markForDisposure());
        }
    }
};

class brandblusser extends Sprite {
    @statedef_builder
    public static bouw(classname: string): cmdef {
        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        bla: new sdef('bla', {
                            nudges2move: 20,
                            onrun: (s: sstate, ik: brandblusser): void => {
                                setPoint(ik.pos, _model.marlies.pos.x, _model.marlies.pos.y + 12);
                                // let oldPrio = ik.z;
                                if (_model.marlies.direction == Direction.Up) ik.z = 950;
                                else ik.z = 1050;
                                // if (ik.z != oldPrio) _model.currentSpace.sortObjectsByPriority();
                                ++s.nudges;
                            },
                            onnext: (_, ik: brandblusser): void => {
                                ik.markForDisposure();
                            },
                        }),
                    }
                })
            }
        });
    }

    constructor() {
        super();
        this.imgid = BitmapId.Brandblusser;
        this.z = _model.marlies.direction == Direction.Up ? 950 : 1050;
        this.state.to('bla');
    }
};

interface Ingredient extends Sprite {
    ingredientType: string;
}

interface Pita extends Ingredient {
    ingredientenInPita: Array<string>;
    gevuld: boolean;
    nuGevuld(): void;
}

interface Bord extends Sprite {
    gevuld: boolean;
    nuGevuld(): void;
}

class invFrame extends Sprite {
    constructor() {
        super();
        this.z = 2000;
        this.imgid = BitmapId.InvFrame;
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

class ingredient extends Sprite implements Ingredient {
    constructor() {
        super();
        this.z = 850;
        this.hitarea = newArea(-8, 0, 24, 16);
    }

    ingredientType: string = 'niet_bepaald!';
};

class komkommer extends ingredient implements Ingredient {
    constructor() {
        super();
        this.imgid = BitmapId.Komkommer;
    }

    override ingredientType = 'komkommer';
};

class mes extends ingredient implements Ingredient {
    constructor() {
        super();
        this.imgid = BitmapId.Mes;
    }

    override ingredientType = 'mes';
};

class tomaatjes extends ingredient implements Ingredient {
    constructor() {
        super();
        this.imgid = BitmapId.Tomaatjes;
    }

    override ingredientType = 'tomaatjes';
};

class falafel extends ingredient implements Ingredient {
    constructor() {
        super();
        this.imgid = BitmapId.Falafel;
    }

    override ingredientType = 'falafel';
};

class pita extends ingredient implements Pita {
    constructor() {
        super();
        this.imgid = BitmapId.Pita;
        this.gevuld = false;
    }

    nuGevuld() {
        this.gevuld = true;
        this.imgid = BitmapId.PitaGevuld;
        this.ingredientType = 'gevulde_pita';
    }

    ingredientenInPita: string[] = new Array<string>();
    override ingredientType = 'pita';
    gevuld = false;
};

class bord extends Sprite implements Bord {
    constructor() {
        super();
        this.imgid = BitmapId.Bord;
        this.z = 800;
        this.hitarea = newArea(0, -16, 16, 20);
        this.gevuld = false;
    }
    gevuld: boolean;

    nuGevuld() {
        this.gevuld = true;
    }

    isBord = true;
};

class vuur extends Sprite {
    @statedef_builder
    public static bouw(classname: string) {
        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        brand: new sdef('brand', {
                            tape: <Array<number>>[
                                BitmapId.Vuur1,
                                BitmapId.Vuur2,
                                BitmapId.Vuur3,
                                BitmapId.Vuur4,
                                BitmapId.Vuur5,
                                BitmapId.Vuur6,
                                BitmapId.Vuur7,
                                BitmapId.Vuur8,
                                BitmapId.Vuur9,
                                BitmapId.Vuur10,
                                BitmapId.None,
                            ],
                            nudges2move: 2,
                            onenter: (s: sstate, ik: vuur): void => {
                                s.reset();
                                ik.imgid = s.current;
                            },
                            onrun: (s: sstate, ik: vuur): void => {
                                ++s.nudges;
                                switch (ik.direction) {
                                    case Direction.Up: ik.pos.y -= 3; break;
                                    case Direction.Right: ik.pos.x += 3; break;
                                    case Direction.Down: ik.pos.y += 3; break;
                                    case Direction.Left: ik.pos.x -= 3; break;
                                }
                            },
                            onnext: (s: sstate, ik: vuur): void => {
                                ik.imgid = s.current;
                            },
                            onend: (_, ik: vuur): void => {
                                ik.markForDisposure();
                            }
                        }),
                    }
                })
            }
        });
    }

    constructor(dir: Direction) {
        super();
        this.direction = dir;
        this.hitarea = newArea(4, 4, 12, 12);
        this.z = dir != Direction.Up ? 1100 : 900;
    }

    override onspawn(spawningPos?: Point): void {
        super.onspawn(spawningPos);
        this.state.to('brand');
    }

    isVuur = true;
};

class corona extends Sprite {
    @statedef_builder
    public static bouw(classname: string): cmdef {
        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        skulk: new sdef('skulk', {
                            nudges2move: 4,
                            tape: <Array<number>>[
                                BitmapId.Corona1,
                                BitmapId.Corona2,
                                BitmapId.Corona3,
                                BitmapId.Corona2,
                            ],
                            onenter: (s: sstate, ik: corona): void => {
                                s.reset();
                                ik.imgid = s.current;
                                ik.setRandomMove();
                            },
                            onrun(s: sstate, ik: corona) {
                                if (_model.objects.filter(o => (<any>o)?.isVuur).some(v => ik.objectCollide(v))) {
                                    ik.state.to('sterf');
                                }
                                switch (ik.direction) {
                                    case Direction.Up: ik.sety(ik.pos.y - 1); break;
                                    case Direction.Right: ik.setx(ik.pos.x + 1); break;
                                    case Direction.Down: ik.sety(ik.pos.y + 1); break;
                                    case Direction.Left: ik.setx(ik.pos.x - 1); break;
                                }

                                if (--ik.moveLeft <= 0) {
                                    ik.setRandomMove();
                                }
                                ++s.nudges;
                            },
                            onnext(s: sstate, ik: corona) { ik.imgid = s.current; },
                        }),
                        sterf: new sdef('sterf', {
                            nudges2move: 4,
                            tape: <Array<number>>[
                                BitmapId.Corona4,
                                BitmapId.Corona5,
                                BitmapId.Corona6,
                                BitmapId.Corona7,
                                BitmapId.Corona8,
                                BitmapId.Corona9,
                                BitmapId.Corona10,
                                BitmapId.Corona11,
                                BitmapId.None,
                            ],
                            onenter(s: sstate, ik: corona) {
                                ik.isEng = false;
                                s.reset();
                                ik.imgid = s.current;
                            },
                            onrun(s: sstate) {
                                ++s.nudges;
                            },
                            onend(_, ik: corona) {
                                ik.markForDisposure();
                            },
                            onnext(s: sstate, ik: corona) {
                                ik.imgid = s.current;
                            },
                        })
                    }
                })
            }
        });
    }

    public isEng = true;
    private moveLeft: number = 0;

    private onLeavingScreenHandler(ik: GameObject, dir: Direction, old_x_or_y: number) {
        prohibitLeavingScreenHandler(ik, dir, old_x_or_y);
        (ik as corona).moveLeft = randomInt(MIN_CORONA_MOVE, MAX_CORONA_MOVE);
        (ik as corona).direction = getOppositeDirection(dir);
    }

    private setRandomMove(): void {
        this.moveLeft = randomInt(MIN_CORONA_MOVE, MAX_CORONA_MOVE);
        this.direction = randomInt(1, 4);
    }

    constructor() {
        super();

        this.imgid = BitmapId.Corona1;
        this.size = { x: 32, y: 32 };
        this.hitarea = newArea(4, 4, 28, 28);
        this.z = 1200;

        this.onLeavingScreen = this.onLeavingScreenHandler;
    }

    override onspawn(spawningPos?: Point): void {
        super.onspawn(spawningPos);
        this.state.to('skulk');
    }
}
// http://livetv.sx/enx/eventinfo/1017596_ajax_psv_eindhoven/#_&h=AT3-qpCc0X_J3DgIWX3xpJ-9OVzV4caLwSUuTtTWvRBn84rp63llZo-kOgMY2P8mxbe65OLcencMjq39IwqJxzrsxLI3VpXOIBg1W4_ujbB827fjeYTHKsnPxBp_CJ_QqKL7_Ku6a9XW-372RIE
class speler extends Sprite {
    @statedef_builder
    public static bouw(classname: string): cmdef {
        let shared_switch_run = (_: sstate, ik: speler) => {
            if (Input.KC_BTN1 || Input.KC_SPACE) ik.zetBoelInDeHens();
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

            switch (ik.state.getCurrentId()) {
                case 'switchleft':
                    ik.pos.x -= 2;
                    if (ik.pos.x <= COLUMN_X[ik.column - 1]) {
                        ik.column -= 1;
                        switchToOld();
                    }
                    break;
                case 'switchright':
                    ik.pos.x += 2;
                    if (ik.pos.x >= COLUMN_X[ik.column + 1]) {
                        ik.column += 1;
                        switchToOld();
                    }
                    break;
            }
            ik.doeCoronaTest();
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
                                    if (ik.canSwitchLeft) {
                                        ik.state.to('switchleft');
                                        ik.direction = Direction.Left;
                                    }
                                }
                                else if (Input.KC_RIGHT) {
                                    if (ik.canSwitchRight) {
                                        ik.state.to('switchright');
                                        ik.direction = Direction.Right;
                                    }
                                }
                                else if (Input.KD_UP) {
                                    if (ik.pos.y >= 4 && ik.column !== 0) {
                                        if ((ik.column !== 3 && ik.column !== 4) ||
                                            (ik.pos.y > 104 || ik.pos.y <= 80)) {
                                            ik.pos.y -= 2;
                                        }
                                    }
                                    if (ik.state.getCurrentId('anistate') !== 'up') {
                                        ik.state.to('up', 'anistate');
                                        ik.direction = Direction.Up;
                                    }
                                }
                                else if (Input.KD_DOWN) {
                                    if (ik.pos.y <= _model.gameheight - 32 && ik.column !== 0) {
                                        if ((ik.column !== 3 && ik.column !== 4) ||
                                            (ik.pos.y < 44 || ik.pos.y >= 80)) {
                                            ik.pos.y += 2;
                                        }
                                    }
                                    if (ik.state.getCurrentId('anistate') !== 'down') {
                                        ik.state.to('down', 'anistate');
                                        ik.direction = Direction.Down;
                                    }
                                }
                                if (Input.KC_BTN1 || Input.KC_SPACE) {
                                    ik.zetBoelInDeHens();
                                }
                                if (Input.KC_BTN2) {
                                    ik.checkNaastIngredientOfPitaOfBord();
                                }
                                ik.doeCoronaTest();
                            },
                            onenter: (_, ik: speler) => ik.hittable = true
                        }),
                        switchleft: new sdef('switchleft', {
                            onenter: (_, ik: speler) => {
                                ik.state.to('columnswitch', 'anistate');
                                ik.hittable = false;
                            },
                            onrun: shared_switch_run,
                        }),
                        switchright: new sdef('switchright', {
                            onenter: (_, ik: speler) => {
                                ik.state.to('columnswitch', 'anistate');
                                ik.hittable = false;
                            },
                            onrun: shared_switch_run,
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
                        down: new sdef('down', {
                            ...down_up_state_def, ...{
                                tape: <Array<number>>[
                                    BitmapId.p1,
                                    BitmapId.p2,
                                    BitmapId.p1,
                                    BitmapId.p3,
                                    BitmapId.p1,
                                ]
                            }
                        }),
                        up: new sdef('up', {
                            ...down_up_state_def, ...{
                                tape: <Array<number>>[
                                    BitmapId.p4,
                                    BitmapId.p5,
                                    BitmapId.p4,
                                    BitmapId.p6,
                                    BitmapId.p4,
                                ]
                            }
                        }),
                        urgh: new sdef('urgh', {
                            tape: <Array<number>>[
                                BitmapId.p8,
                                BitmapId.p9,
                                BitmapId.p8,
                                BitmapId.p9,
                                BitmapId.p8,
                                BitmapId.p9,
                                BitmapId.p8,
                                BitmapId.p9,
                                BitmapId.p8,
                                BitmapId.p9,
                                BitmapId.p8,
                                BitmapId.p9,
                                BitmapId.p8,
                                BitmapId.p9,
                                BitmapId.p8,
                                BitmapId.p9,
                                BitmapId.p8,
                                BitmapId.p9,
                                BitmapId.p8,
                                BitmapId.p9,
                                BitmapId.p8,
                                BitmapId.p9,
                                BitmapId.p8,
                                BitmapId.p9,
                            ],
                            nudges2move: 4,
                            onenter(s: sstate, ik: speler): void {
                                s.reset();
                                ik.imgid = s.current;
                                ik.flippedH = false;
                            },
                            onrun(s: sstate): void {
                                ++s.nudges;
                            },
                            onend(s: sstate, ik: speler): void {
                                s.reset();
                                ik.hittable = true; // Zorg dat ik weer geraakt kan worden!
                                ik.state.machines['anistate'].pop();
                                ik.state.pop();
                            },
                            onnext(s: sstate, ik: speler): void {
                                ik.imgid = s.current;
                            },
                        }),
                        columnswitch: new sdef('columnswitch', {
                            onenter(_, ik: speler): void {
                                ik.imgid = BitmapId.p7;
                                if (ik.state.getCurrentId() === 'switchright')
                                    ik.flippedH = true;
                            },
                            onexit(_, ik: speler): void {
                                ik.flippedH = false;
                            },
                        }),
                        win: new sdef('win', {
                            onenter: (_, ik: speler) => ik.imgid = BitmapId.p10
                        }),
                    }
                }),
            }
        });
    }

    column: number;

    constructor(startcolumn: number) {
        super();
        this.imgid = BitmapId.p1;
        this.direction = Direction.Down;
        this.z = 1000;
        this.column = startcolumn;
        this.hitarea = newArea(0, 8, 16, 16);
    }

    override onspawn(spawningPos?: Point): void {
        super.onspawn(spawningPos);
        this.state.to('walk');
        this.state.to('down', 'anistate');
    }

    zetBoelInDeHens(): void {
        let brand = new vuur(this.direction);
        let brandpos = copyPoint(this.pos);
        switch (this.direction) {
            case Direction.Down: brandpos.y += 8; break;
            case Direction.Right: brandpos.x += 4; brandpos.y += 8; break;
            case Direction.Left: brandpos.x -= 4; brandpos.y += 8; break;
            case Direction.Up: brandpos.y -= 8; break;
        }
        _model.spawn(brand, brandpos);
        let brand2 = new vuur(this.direction);
        let brandpos2 = copyPoint(brandpos);
        brandpos2.x += randomInt(0, 16) - 8;
        brandpos2.y += randomInt(0, 8) - 4;
        _model.spawn(brand2, brandpos2);
        let brand3 = new vuur(this.direction);
        let brandpos3 = copyPoint(brandpos);
        brandpos3.x += randomInt(0, 16) - 8;
        brandpos3.y += randomInt(0, 8) - 4;
        _model.spawn(brand3, brandpos3);

        let blusser = new brandblusser();
        _model.spawn(blusser, newPoint(this.pos.x, this.pos.y + 12));
    }

    doeCoronaTest(): void {
        if (this.state.getCurrentId() == 'urgh') return;
        if (_model.objects.filter(o => (<any>o)?.isEng).some(c => this.objectCollide(c))) {
            this.state.to('urgh');
        }
    }

    checkNaastIngredientOfPitaOfBord(): void {
        if (this.state.getCurrentId() == 'urgh') return;
        _model.objects.filter(o => (<any>o)?.ingredientType && this.objectCollide(o)).forEach(o => {
            let i = o as any;
            switch (i.ingredientType) {
                case 'pita':
                    _model.ProbeerEquippedInPitaTeProppen(i);
                    break;
                case 'gevulde_pita':
                default:
                    _model.doePotentieelOprapen(i);
                    break;
            }
        });

        _model.objects.filter(o => (<any>o)?.isBord && this.objectCollide(o)).forEach(b => {
            _model.checkOfIetsMetBordMogelijk(<Bord>b);
        });

    }

    private get canSwitchLeft(): boolean {
        switch (this.column) {
            case 0: return false;
            case 1: return this.pos.y >= 144;
            case 2: return true;
            case 3: return (this.pos.y <= 12 || this.pos.y >= 144);
            case 4: return true;
            default: return false;
        }
    }

    private get canSwitchRight(): boolean {
        switch (this.column) {
            case 0: case 1: return true;
            case 2: return (this.pos.y <= 12 || this.pos.y >= 144);
            case 3: return true;
            case 4: return false;
            default: return false;
        }
    }
};

class keuken extends Sprite {
    @statedef_builder
    public static bouw(classname: string): cmdef {
        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        wees_een_keuken: new sdef('wees_een_keuken', {
                            nudges2move: TIME_CORONA_SPAWN,
                            onenter(s: sstate) {
                                s.reset();
                            },
                            onrun(s: sstate) {
                                ++s.nudges;
                            },
                            onnext() {
                                if (_model.objects.filter(o => (<any>o)?.isEng).length < MAX_CORONA) {
                                    let rloc = randomInt(0, CORONA_SPAWN_LOCS.length - 1);
                                    let sloc = CORONA_SPAWN_LOCS[rloc];
                                    _model.spawn(new corona(), sloc);
                                }
                            },
                        }),
                    }
                })
            }
        });
    }

    constructor() {
        super();
        this.imgid = BitmapId.Keuken;
        this.z = 0;
    }

    override onspawn(spawningPos?: Point): void {
        super.onspawn(spawningPos);
        this.state.to('wees_een_keuken');
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
    model.spawn(new keuken(), newPoint(0, 0));
    model.spawn(new invFrame(), newPoint(4, 4));
    let marlies = new speler(START_COLUMN);
    _model.marlies = marlies;
    model.spawn(marlies, newPoint(COLUMN_X[START_COLUMN], 16));

    model.spawn(new bord(), newPoint(160, 74));
    model.spawn(new bord(), newPoint(160, 100));
    model.spawn(new bord(), newPoint(200, 74));
    model.spawn(new bord(), newPoint(200, 100));

    model.spawn(new komkommer(), newPoint(26, 40));
    // model.spawn(new komkommer(), newPoint(26, 64));
    model.spawn(new tomaatjes(), newPoint(26, 88));
    // model.spawn(new tomaatjes(), newPoint(26, 112));
    model.spawn(new mes(), newPoint(26, 136));
    model.spawn(new falafel(), newPoint(100, 64));
    // model.spawn(new falafel(), newPoint(100, 40));
    model.spawn(new pita(), newPoint(100, 88));
    // model.spawn(new pita(), newPoint(100, 112));
    // model.spawn(new mes(), newPoint(100, 136));
};
