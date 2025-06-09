import { mdef, sdef, sstate } from '../bmsx/bfsm';
import { copy_vec2, Direction, Game, getOppositeDirection, new_area, new_vec2, randomInt, set_vec2, vec2 } from '../bmsx/bmsx';
import { GameObject } from '../bmsx/gameobject';
import { GLView } from '../bmsx/glview';
import { Input } from '../bmsx/input';
import { BaseModel, Space } from '../bmsx/model';
import { MSX1ScreenHeight, MSX1ScreenWidth } from '../bmsx/msx';
import type { RomPack } from '../bmsx/rompack';
import { SpriteObject } from '../bmsx/sprite';
import { TextWriter } from '../bmsx/textwriter';
import { paintSprite } from '../bmsx/view';
import { GameMenu } from './gamemenu';
import { KonamiFont } from './konamifont';
import { BitmapId } from './resourceids';

const COLUMN_X = <Array<number>>[36, 48, 80, 160, 200];
const START_COLUMN = 1;
const MAX_CORONA = 3;
const TIME_CORONA_SPAWN = 200;
const MIN_CORONA_MOVE = 16;
const MAX_CORONA_MOVE = 72;
const CORONA_SPAWN_LOCS = <Array<vec2>>[
    { x: MSX1ScreenWidth, y: 0 },
    { x: MSX1ScreenWidth, y: MSX1ScreenHeight },
];
const PITAS_OP_BORD_VOOR_WINST = 1;
const INGREDIENTEN_IN_PITA = 3;
const INVENTORY_POS = { x: 12, y: 12 };

// https://drive.google.com/file/d/1vyCxVBeMr89pQdUBCUcDjW6W2ImA6q2j/view?usp=sharing

class modelclass extends BaseModel {
    public marlies: SpriteObject;
    public ingredientEquipped: Ingredient;
    public pitasOpBord: number;

    @build_fsm()
    public static buildModelStates(classname: string): cmdef {
        return new cmdef(classname, {
            machines: {
                master: new mdef('default', {
                    states: {
                        default: new sdef('default', {
                            run() {
                                BaseModel.defaultrun();
                                if (Input.KC_F5) {
                                    game.model.state.to('gamemenu');
                                }
                            },
                        }),
                        'gamemenu': new sdef('gamemenu', {
                            enter() {
                                let menu = new GameMenu();
                                game.model.spawn(menu);
                                menu.Open();
                            },
                            run() {
                                let menu = game.model.get('gamemenu') as GameMenu;
                                menu.run();
                                if (Input.KC_F5) {
                                    game.model.state.to('default');
                                }
                            },
                            exit() {
                                let menu = game.model.get('gamemenu') as GameMenu;
                                menu.Close();
                                game.model.exile(menu);
                            },
                        }),
                        'hoera!': new sdef('hoera!', {
                            enter() {
                                game.model.setSpace('hoera!');
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

    public doePotentieelOprapen(o: Ingredient | Pita): void {
        if (o.ingredientType) {
            let type: string = o.ingredientType;
            if (this.ingredientEquipped?.ingredientType == 'mes') {
                if (type == 'komkommer') {
                    o.ingredientType = 'gesneden_komkommer';
                    o.imgid = BitmapId.Komkommer_gesneden;

                    this.ingredientEquipped.banish();
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
                this.ingredientEquipped.banish(); // Exile ingredient
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
            this.filter_and_foreach(o => (<any>o).isEng, o => o.banish());
            // this.objects.filter(o => (<any>o).isEng).forEach(o => o.markForDisposure());
        }
    }
};

class brandblusser extends SpriteObject {
    @build_fsm()
    public static bouw(classname: string): cmdef {
        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        bla: new sdef('bla', {
                            ticks2move: 20,
                            run: (s: sstate, ik: brandblusser): void => {
                                set_vec2(ik.pos, _model.marlies.pos.x, _model.marlies.pos.y + 12);
                                // let oldPrio = ik.z;
                                if (_model.marlies.direction == 'up') ik.z = 950;
                                else ik.z = 1050;
                                // if (ik.z != oldPrio) _model.currentSpace.sortObjectsByPriority();
                                ++s.nudges;
                            },
                            next: (_, ik: brandblusser): void => {
                                ik.banish();
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
        this.z = _model.marlies.direction == 'up' ? 950 : 1050;
        this.state.to('bla');
    }
};

interface Ingredient extends SpriteObject {
    ingredientType: string;
}

interface Pita extends Ingredient {
    ingredientenInPita: Array<string>;
    gevuld: boolean;
    nuGevuld(): void;
}

interface Bord extends SpriteObject {
    gevuld: boolean;
    nuGevuld(): void;
}

class invFrame extends SpriteObject {
    constructor() {
        super();
        this.z = 2000;
        this.imgid = BitmapId.InvFrame;
    }
};

class hoeraStuff extends SpriteObject {
    constructor() {
        super();
        this.z = 5000;
        this.imgid = BitmapId.Sint;
    }

    override paint = (offset?: vec2, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean; }) => {
        TextWriter.drawText(24, 100, "Redelijk gedaan,Marlies!");
        paintSprite.call(this, offset, colorize); // .call() nodig, anders "this" undefined
    }
};

class ingredient extends SpriteObject implements Ingredient {
    constructor() {
        super();
        this.z = 850;
        this.hitarea = new_area(-8, 0, 24, 16);
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

class bord extends SpriteObject implements Bord {
    constructor() {
        super();
        this.imgid = BitmapId.Bord;
        this.z = 800;
        this.hitarea = new_area(0, -16, 16, 20);
        this.gevuld = false;
    }
    gevuld: boolean;

    nuGevuld() {
        this.gevuld = true;
    }

    isBord = true;
};

class vuur extends SpriteObject {
    @build_fsm()
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
                            ticks2move: 2,
                            enter: (s: sstate, ik: vuur): void => {
                                s.reset();
                                ik.imgid = s.current;
                            },
                            run: (s: sstate, ik: vuur): void => {
                                ++s.nudges;
                                switch (ik.direction) {
                                    case 'up': ik.pos.y -= 3; break;
                                    case 'right': ik.pos.x += 3; break;
                                    case 'down': ik.pos.y += 3; break;
                                    case 'left': ik.pos.x -= 3; break;
                                }
                            },
                            next: (s: sstate, ik: vuur): void => {
                                ik.imgid = s.current;
                            },
                            end: (_, ik: vuur): void => {
                                ik.banish();
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
        this.hitarea = new_area(4, 4, 12, 12);
        this.z = dir != 'up' ? 1100 : 900;
    }

    override onspawn(spawningPos?: vec2): void {
        super.onspawn(spawningPos);
        this.state.to('brand');
    }

    isVuur = true;
};

class corona extends SpriteObject {
    @build_fsm()
    public static bouw(classname: string): cmdef {
        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        skulk: new sdef('skulk', {
                            ticks2move: 4,
                            tape: <Array<number>>[
                                BitmapId.Corona1,
                                BitmapId.Corona2,
                                BitmapId.Corona3,
                                BitmapId.Corona2,
                            ],
                            enter: (s: sstate, ik: corona): void => {
                                s.reset();
                                ik.imgid = s.current;
                                ik.setRandomMove();
                            },
                            run(s: sstate, ik: corona) {
                                if (_model.objects.filter(o => (<any>o)?.isVuur).some(v => ik.detect_object_collision(v))) {
                                    ik.state.to('sterf');
                                }
                                switch (ik.direction) {
                                    case 'up': ik.sety(ik.pos.y - 1); break;
                                    case 'right': ik.setx(ik.pos.x + 1); break;
                                    case 'down': ik.sety(ik.pos.y + 1); break;
                                    case 'left': ik.setx(ik.pos.x - 1); break;
                                }

                                if (--ik.moveLeft <= 0) {
                                    ik.setRandomMove();
                                }
                                ++s.nudges;
                            },
                            next(s: sstate, ik: corona) { ik.imgid = s.current; },
                        }),
                        sterf: new sdef('sterf', {
                            ticks2move: 4,
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
                            enter(s: sstate, ik: corona) {
                                ik.isEng = false;
                                s.reset();
                                ik.imgid = s.current;
                            },
                            run(s: sstate) {
                                ++s.nudges;
                            },
                            end(_, ik: corona) {
                                ik.banish();
                            },
                            next(s: sstate, ik: corona) {
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
        this.hitarea = new_area(4, 4, 28, 28);
        this.z = 1200;

        this.onLeavingScreen = this.onLeavingScreenHandler;
    }

    override onspawn(spawningPos?: vec2): void {
        super.onspawn(spawningPos);
        this.state.to('skulk');
    }
}
// http://livetv.sx/enx/eventinfo/1017596_ajax_psv_eindhoven/#_&h=AT3-qpCc0X_J3DgIWX3xpJ-9OVzV4caLwSUuTtTWvRBn84rp63llZo-kOgMY2P8mxbe65OLcencMjq39IwqJxzrsxLI3VpXOIBg1W4_ujbB827fjeYTHKsnPxBp_CJ_QqKL7_Ku6a9XW-372RIE
class speler extends SpriteObject {
    @build_fsm()
    public static bouw(classname: string): cmdef {
        let shared_switch_run = (_: sstate, ik: speler) => {
            if (Input.KC_BTN1 || Input.KC_SPACE) ik.zetBoelInDeHens();
            let switchToOld = (): void => {
                ik.direction = ik.oldDirection;
                ik.state.to('walk');
                switch (ik.direction) {
                    case 'down':
                        ik.state.to('down', 'anistate');
                        break;
                    case 'up':
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
            ticks2move: 8,
            enter: (s: sstate, ik: speler): void => (s.reset(), ik.imgid = s.current),
            run: (s: sstate, ik: speler): void => { ++s.nudges; },
            end: (s: sstate, ik: speler): void => s.reset(),
            next: (s: sstate, ik: speler): void => ik.imgid = s.current,
        };

        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        walk: new sdef('walk', {
                            run: (_, ik: speler): void => {
                                if (Input.KC_LEFT) {
                                    if (ik.canSwitchLeft) {
                                        ik.state.to('switchleft');
                                        ik.direction = 'left';
                                    }
                                }
                                else if (Input.KC_RIGHT) {
                                    if (ik.canSwitchRight) {
                                        ik.state.to('switchright');
                                        ik.direction = 'right';
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
                                        ik.direction = 'up';
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
                                        ik.direction = 'down';
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
                            enter: (_, ik: speler) => ik.hittable = true
                        }),
                        switchleft: new sdef('switchleft', {
                            enter: (_, ik: speler) => {
                                ik.state.to('columnswitch', 'anistate');
                                ik.hittable = false;
                            },
                            run: shared_switch_run,
                        }),
                        switchright: new sdef('switchright', {
                            enter: (_, ik: speler) => {
                                ik.state.to('columnswitch', 'anistate');
                                ik.hittable = false;
                            },
                            run: shared_switch_run,
                        }),
                        urgh: new sdef('urgh', {
                            enter: (_, ik: speler) => {
                                ik.hittable = false; // Kan niet opnieuw geraakt worden als eenmaal in pain
                                ik.state.to('urgh', 'anistate');
                            }
                            // Lelijk, maar animatie-state zorgt voor terugkeer naar previous state
                        }),
                        win: new sdef('win', {
                            ticks2move: 300,
                            enter: (_, ik: speler) => ik.state.to('win', 'anistate'),
                            run: (s: sstate) => (++s.nudges, _model.objects.filter(o => (<any>o).isEng).forEach(o => o.disposeFlag = true)),
                            next: () => _model.state.to('hoera!')
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
                            ticks2move: 4,
                            enter(s: sstate, ik: speler): void {
                                s.reset();
                                ik.imgid = s.current;
                                ik.flip_h = false;
                            },
                            run(s: sstate): void {
                                ++s.nudges;
                            },
                            end(s: sstate, ik: speler): void {
                                s.reset();
                                ik.hittable = true; // Zorg dat ik weer geraakt kan worden!
                                ik.state.machines['anistate'].pop();
                                ik.state.pop();
                            },
                            next(s: sstate, ik: speler): void {
                                ik.imgid = s.current;
                            },
                        }),
                        columnswitch: new sdef('columnswitch', {
                            enter(_, ik: speler): void {
                                ik.imgid = BitmapId.p7;
                                if (ik.state.getCurrentId() === 'switchright')
                                    ik.flip_h = true;
                            },
                            exit(_, ik: speler): void {
                                ik.flip_h = false;
                            },
                        }),
                        win: new sdef('win', {
                            enter: (_, ik: speler) => ik.imgid = BitmapId.p10
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
        this.direction = 'down';
        this.z = 1000;
        this.column = startcolumn;
        this.hitarea = new_area(0, 8, 16, 16);
    }

    override onspawn(spawningPos?: vec2): void {
        super.onspawn(spawningPos);
        this.state.to('walk');
        this.state.to('down', 'anistate');
    }

    zetBoelInDeHens(): void {
        let brand = new vuur(this.direction);
        let brandpos = copy_vec2(this.pos);
        switch (this.direction) {
            case 'down': brandpos.y += 8; break;
            case 'right': brandpos.x += 4; brandpos.y += 8; break;
            case 'left': brandpos.x -= 4; brandpos.y += 8; break;
            case 'up': brandpos.y -= 8; break;
        }
        _model.spawn(brand, brandpos);
        let brand2 = new vuur(this.direction);
        let brandpos2 = copy_vec2(brandpos);
        brandpos2.x += randomInt(0, 16) - 8;
        brandpos2.y += randomInt(0, 8) - 4;
        _model.spawn(brand2, brandpos2);
        let brand3 = new vuur(this.direction);
        let brandpos3 = copy_vec2(brandpos);
        brandpos3.x += randomInt(0, 16) - 8;
        brandpos3.y += randomInt(0, 8) - 4;
        _model.spawn(brand3, brandpos3);

        let blusser = new brandblusser();
        _model.spawn(blusser, new_vec2(this.pos.x, this.pos.y + 12));
    }

    doeCoronaTest(): void {
        if (this.state.getCurrentId() == 'urgh') return;
        if (_model.objects.filter(o => (<any>o)?.isEng).some(c => this.detect_object_collision(c))) {
            this.state.to('urgh');
        }
    }

    checkNaastIngredientOfPitaOfBord(): void {
        if (this.state.getCurrentId() == 'urgh') return;
        _model.objects.filter(o => (<any>o)?.ingredientType && this.detect_object_collision(o)).forEach(o => {
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

        _model.objects.filter(o => (<any>o)?.isBord && this.detect_object_collision(o)).forEach(b => {
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

class keuken extends SpriteObject {
    @build_fsm()
    public static bouw(classname: string): cmdef {
        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        wees_een_keuken: new sdef('wees_een_keuken', {
                            ticks2move: TIME_CORONA_SPAWN,
                            enter(s: sstate) {
                                s.reset();
                            },
                            run(s: sstate) {
                                ++s.nudges;
                            },
                            next() {
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

    override onspawn(spawningPos?: vec2): void {
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
_global['h406A'] = (rom: RomPack, sndcontext: AudioContext, gainnode: GainNode): void => {
    let _view = new viewclass(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
    _model = new modelclass();
    new Game(rom, _model, _view, sndcontext, gainnode);
    game.view.default_font = new KonamiFont();

    global.game.start();
    let model = game.model;
    model.spawn(new keuken(), new_vec2(0, 0));
    model.spawn(new invFrame(), new_vec2(4, 4));
    let marlies = new speler(START_COLUMN);
    _model.marlies = marlies;
    model.spawn(marlies, new_vec2(COLUMN_X[START_COLUMN], 16));

    model.spawn(new bord(), new_vec2(160, 74));
    model.spawn(new bord(), new_vec2(160, 100));
    model.spawn(new bord(), new_vec2(200, 74));
    model.spawn(new bord(), new_vec2(200, 100));

    model.spawn(new komkommer(), new_vec2(26, 40));
    // model.spawn(new komkommer(), newPoint(26, 64));
    model.spawn(new tomaatjes(), new_vec2(26, 88));
    // model.spawn(new tomaatjes(), newPoint(26, 112));
    model.spawn(new mes(), new_vec2(26, 136));
    model.spawn(new falafel(), new_vec2(100, 64));
    // model.spawn(new falafel(), newPoint(100, 40));
    model.spawn(new pita(), new_vec2(100, 88));
    // model.spawn(new pita(), newPoint(100, 112));
    // model.spawn(new mes(), newPoint(100, 136));
};
