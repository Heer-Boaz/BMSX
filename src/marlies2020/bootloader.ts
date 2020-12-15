import { RomLoadResult } from '../bmsx/rompack';
import { Game, game, model, BaseModel, IGameObject, Sprite, BSTEventType, bss, bst } from '../bmsx/engine';
import { setPoint, newPoint, Direction, newSize, newArea, Point, randomInt, copyPoint } from '../bmsx/common';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';
import { TextWriter } from './textwriter';

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
const PITAS_OP_BORD_VOOR_WINST = 2;
const INGREDIENTEN_IN_PITA = 3;
const INVENTORY_POS = { x: 12, y: 12 };

// https://drive.google.com/file/d/1vyCxVBeMr89pQdUBCUcDjW6W2ImA6q2j/view?usp=sharing

class modelclass extends BaseModel {
    public marlies: Sprite;
    public ingredientEquipped: Ingredient;
    public pitasOpBord: number;

    constructor() {
        super();
        this.pitasOpBord = 0;
        this.ingredientEquipped = null;

        this.add(new bss('hoera!', {
            onenter: () => {
                this.clearModel();
                this.spawn(new hoeraStuff());
            }
        }));
    }

    public get gamewidth(): number {
        return MSX1ScreenWidth;
    }

    public get gameheight(): number {
        return MSX1ScreenHeight;
    }

    public collidesWithTile(o: IGameObject, dir: Direction): boolean {
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
                _model.sortObjectsByPriority();
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
                // Check of pita nu gevuld is met alle ingredienten
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
        _model.sortObjectsByPriority();

        this.ingredientEquipped = null; // Haal inventory leeg
        if (++this.pitasOpBord >= PITAS_OP_BORD_VOOR_WINST) {
            this.marlies.to('win');
            this.where_do(o => (<any>o).isEng, o => o.markForDisposure());
            // this.objects.filter(o => (<any>o).isEng).forEach(o => o.markForDisposure());
        }
    }
};

var _model = new modelclass();

class brandblusser extends Sprite {
    constructor() {
        super();
        this.imgid = BitmapId.Brandblusser;
        this.z = _model.marlies.direction == Direction.Up ? 950 : 1050;
        let self = this;

        this.addTo('bla', new bss('bla', {
            nudges2move: 20,
            onrun: (s: bss, ik: brandblusser): void => {
                setPoint(self.pos, _model.marlies.pos.x, _model.marlies.pos.y + 12);
                let oldPrio = ik.z;
                if (_model.marlies.direction == Direction.Up) ik.z = 950;
                else ik.z = 1050;
                if (ik.z != oldPrio) _model.sortObjectsByPriority();
                ++s.nudges;
            },
            onnext: (): void => {
                self.markForDisposure();
            }
        }),
        );
    }

    takeTurn(): void {
        this.run();
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

    takeTurn(): void {
    }
};

class hoeraStuff extends Sprite {
    constructor() {
        super();
        this.z = 5000;
        this.imgid = BitmapId.Sint;
    }

    takeTurn(): void {
    }

    paint(offset?: Point, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean; }): void {
        super.paint(offset, colorize);
        TextWriter.drawText(24, 192, "Redelijk gedaan, Marlies!");
    }
};

class ingredient extends Sprite implements Ingredient {
    constructor() {
        super();
        this.z = 850;
        this.hitarea = newArea(-8, 0, 24, 16);
    }

    ingredientType: string = 'niet_bepaald!';

    takeTurn(): void {
    }
};

class komkommer extends ingredient implements Ingredient {
    constructor() {
        super();
        this.imgid = BitmapId.Komkommer;
    }

    ingredientType = 'komkommer';
};

class mes extends ingredient implements Ingredient {
    constructor() {
        super();
        this.imgid = BitmapId.Mes;
    }

    ingredientType = 'mes';
};

class tomaatjes extends ingredient implements Ingredient {
    constructor() {
        super();
        this.imgid = BitmapId.Tomaatjes;
    }

    ingredientType = 'tomaatjes';
};

class falafel extends ingredient implements Ingredient {
    constructor() {
        super();
        this.imgid = BitmapId.Falafel;
    }

    ingredientType = 'falafel';
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
    ingredientType = 'pita';
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

    takeTurn(): void {
    }

    nuGevuld() {
        this.gevuld = true;
    }

    isBord = true;
};

class vuur extends Sprite {
    constructor(dir: Direction) {
        super();
        this.direction = dir;
        this.hitarea = newArea(4, 4, 12, 12);
        this.z = dir != Direction.Up ? 1100 : 900;

        let self = this;

        this.add(new bss('brand', {
            tape: <Array<BitmapId>>[
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
            onenter: (s: bss): void => {
                s.reset();
                self.imgid = s.current;
            },
            onrun: (s: bss): void => {
                ++s.nudges;
                switch (self.direction) {
                    case Direction.Up: self.pos.y -= 3; break;
                    case Direction.Right: self.pos.x += 3; break;
                    case Direction.Down: self.pos.y += 3; break;
                    case Direction.Left: self.pos.x -= 3; break;
                }
            },
            onnext: (s: bss): void => {
                self.imgid = s.current;
            },
            onend: (s: bss): void => {
                self.markForDisposure();
            }
        }));
    }

    isVuur = true;

    takeTurn(): void {
        this.run();
    }
};

class corona extends Sprite {
    constructor() {
        super();

        let self = this;
        this.imgid = BitmapId.Corona1;
        this.hitarea = newArea(4, 4, 28, 28);
        this.z = 1200;

        this.add(new bss('skulk', {
            nudges2move: 4,
            tape: <Array<BitmapId>>[
                BitmapId.Corona1,
                BitmapId.Corona2,
                BitmapId.Corona3,
                BitmapId.Corona2,
            ],
            onenter: (s: bss): void => {
                s.reset();
                self.imgid = s.current;
                self.setRandomMove();
            },
            onrun: (s: bss): void => {
                if (_model.objects.filter(o => (<any>o)?.isVuur).some(v => self.objectCollide(v))) {
                    self.to('sterf');
                }
                switch (self.direction) {
                    case Direction.Up: self.pos.y -= 1; break;
                    case Direction.Right: self.pos.x += 1; break;
                    case Direction.Down: self.pos.y += 1; break;
                    case Direction.Left: self.pos.x -= 1; break;
                }
                if (self.pos.x < 0) self.pos.x = 0;
                if (self.pos.x > _model.gamewidth - 32) self.pos.x = _model.gamewidth - 32;
                if (self.pos.y < 0) self.pos.y = 0;
                if (self.pos.y > _model.gameheight - 32) self.pos.y = _model.gameheight - 32;

                if (--self.moveLeft <= 0) {
                    self.setRandomMove();
                }
                ++s.nudges;
            },
            onnext: (s: bss): void => self.imgid = s.current
        }));
        this.setStart('skulk');

        this.add(new bss('sterf', {
            nudges2move: 4,
            tape: <Array<BitmapId>>[
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
            onenter: (s: bss): void => {
                self.isEng = false;
                s.reset();
                self.imgid = s.current;
            },
            onrun: (s: bss): void => {
                ++s.nudges;
            },
            onend: (): void => {
                self.markForDisposure();
            },
            onnext: (s: bss): void => {
                self.imgid = s.current;
            },
        }));
    }

    isEng = true;
    moveLeft: number = 0;

    setRandomMove(): void {
        this.moveLeft = randomInt(MIN_CORONA_MOVE, MAX_CORONA_MOVE);
        this.direction = randomInt(1, 4);
    }

    takeTurn(): void {
        this.run();
    }
};

class speler extends Sprite {
    column: number;

    constructor(startcolumn: number) {
        super();
        let self = this;
        this.imgid = BitmapId.p1;
        this.direction = Direction.Down;
        this.z = 1000;
        this.addBst('anistate');
        this.column = startcolumn;
        this.hitarea = newArea(0, 8, 16, 16);

        let down_up_state_def: Partial<bss> = {
            nudges2move: 8,
            onenter: (s: bss): void => (s.reset(), self.imgid = s.current),
            onrun: (s: bss): void => { ++s.nudges; },
            onend: (s: bss): void => s.reset(),
            onnext: (s: bss): void => self.imgid = s.current,
        };
        this.addTo('anistate',
            new bss('down', {
                ...down_up_state_def, ...{
                    start: true,
                    tape: <Array<BitmapId>>[
                        BitmapId.p1,
                        BitmapId.p2,
                        BitmapId.p1,
                        BitmapId.p3,
                        BitmapId.p1,
                    ]
                }
            }),
            new bss('up', {
                ...down_up_state_def, ...{
                    tape: <Array<BitmapId>>[
                        BitmapId.p4,
                        BitmapId.p5,
                        BitmapId.p4,
                        BitmapId.p6,
                        BitmapId.p4,
                    ]
                }
            }),
            new bss('urgh', {
                tape: <Array<BitmapId>>[
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
                onenter(s: bss, ik: speler): void {
                    s.reset();
                    ik.imgid = s.current;
                    ik.flippedH = false;
                },
                onrun(s: bss): void {
                    ++s.nudges;
                },
                onend(s: bss, ik: speler): void {
                    s.reset();
                    ik.pop();
                },
                onnext(s: bss, ik: speler): void {
                    ik.imgid = s.current;
                },
            }),
            new bss('columnswitch', {
                onenter(_, ik: speler): void {
                    ik.imgid = BitmapId.p7;
                    if (ik.getCurrentId() === 'switchright')
                        ik.flippedH = true;
                },
                onexit(_, ik: speler): void {
                    ik.flippedH = false;
                },
            }),
            new bss('win', { // winAniState
                onenter: () => self.imgid = BitmapId.p10
            }),
        );


        let shared_switch_run = () => {
            if (Input.KC_BTN1 || Input.KC_SPACE) self.zetBoelInDeHens();
            let switchToOld = (): void => {
                self.direction = self.oldDirection;
                self.to('walk');
                switch (self.direction) {
                    case Direction.Down:
                        self.to('down', 'anistate');
                        break;
                    case Direction.Up:
                        self.to('up', 'anistate');
                        break;
                }
            };

            switch (self.getCurrentId()) {
                case 'switchleft':
                    self.pos.x -= 2;
                    if (self.pos.x <= COLUMN_X[self.column - 1]) {
                        self.column -= 1;
                        switchToOld();
                    }
                    break;
                case 'switchright':
                    self.pos.x += 2;
                    if (self.pos.x >= COLUMN_X[self.column + 1]) {
                        self.column += 1;
                        switchToOld();
                    }
                    break;
            }
            self.doeCoronaTest();
        };

        this.add(new bss('walk', {
            onrun: (): void => {
                if (Input.KC_LEFT) {
                    if (self.canSwitchLeft) {
                        self.to('switchleft');
                        self.direction = Direction.Left;
                    }
                }
                else if (Input.KC_RIGHT) {
                    if (self.canSwitchRight) {
                        self.to('switchright');
                        self.direction = Direction.Right;
                    }
                }
                else if (Input.KD_UP) {
                    if (self.pos.y >= 4 && self.column !== 0) {
                        if ((self.column !== 3 && self.column !== 4) ||
                            (self.pos.y > 104 || self.pos.y <= 80)) {
                            self.pos.y -= 2;
                        }
                    }
                    if (self.getCurrentId('anistate') !== 'up') {
                        self.to('up', 'anistate');
                        self.direction = Direction.Up;
                    }
                }
                else if (Input.KD_DOWN) {
                    if (self.pos.y <= model.gameheight - 32 && self.column !== 0) {
                        if ((self.column !== 3 && self.column !== 4) ||
                            (self.pos.y < 44 || self.pos.y >= 80)) {
                            self.pos.y += 2;
                        }
                    }
                    if (self.getCurrentId('anistate') !== 'down') {
                        self.to('down', 'anistate');
                        self.direction = Direction.Down;
                    }
                }
                if (Input.KC_BTN1 || Input.KC_SPACE) {
                    self.zetBoelInDeHens();
                }
                if (Input.KC_BTN2) {
                    self.checkNaastIngredientOfPitaOfBord();
                }
                self.doeCoronaTest();
            },
        }));

        this.add(new bss('switchleft', {
            onenter: () => self.to('columnswitch', 'anistate'),
            onrun: shared_switch_run,
        }));
        this.add(new bss('switchright', {
            onenter: () => self.to('columnswitch', 'anistate'),
            onrun: shared_switch_run,
        }));

        this.add(new bss('urgh', { // urghSpelerState
            onenter: () => self.to('urgh', 'anistate')
            // Lelijk, maar animatie-state zorgt voor terugkeer naar previous state
        }));

        this.add(new bss('win', { // winSpelerState
            nudges2move: 300,
            onenter: () => self.to('win', 'anistate'),
            onrun: (s: bss) => (++s.nudges, _model.objects.filter(o => (<any>o).isEng).forEach(o => o.disposeFlag = true)),
            onnext: () => _model.to('hoera!')
        }));

        this.setStart('walk');
    }

    takeTurn(): void {
        this.run();
    };

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
        if (this.getCurrentId() == 'urgh') return;
        if (_model.objects.filter(o => (<any>o)?.isEng).some(c => this.objectCollide(c))) {
            this.to('urgh');
        }
    }

    checkNaastIngredientOfPitaOfBord(): void {
        if (this.getCurrentId() == 'urgh') return;
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
    constructor() {
        super();
        this.imgid = BitmapId.Keuken;
        this.z = 0;

        this.add(new bss('wees_een_keuken', {
            nudges2move: TIME_CORONA_SPAWN,
            onenter(s: bss) {
                s.reset();
            },
            onrun(s: bss) {
                ++s.nudges;
            },
            onnext() {
                if (_model.objects.filter(o => (<any>o)?.isEng).length < MAX_CORONA) {
                    let rloc = randomInt(0, CORONA_SPAWN_LOCS.length - 1);
                    let sloc = CORONA_SPAWN_LOCS[rloc];
                    model.spawn(new corona(), sloc);
                }
            },
            start: true,
        }));
    }

    takeTurn(): void {
        this.run();
    }
};


class viewclass extends GLView {
    public drawgame(): void {
        super.drawgame();
        super.drawSprites();
    }
};

var _global = window || global;
_global['h406A'] = (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode): void => {
    let _view = new viewclass(newSize(MSX1ScreenWidth, MSX1ScreenHeight));
    new Game(rom, _model, _view, null, sndcontext, gainnode);

    game.start();
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
    model.spawn(new komkommer(), newPoint(26, 64));
    model.spawn(new tomaatjes(), newPoint(26, 88));
    model.spawn(new tomaatjes(), newPoint(26, 112));
    model.spawn(new mes(), newPoint(26, 136));
    model.spawn(new falafel(), newPoint(100, 64));
    model.spawn(new falafel(), newPoint(100, 40));
    model.spawn(new pita(), newPoint(100, 88));
    model.spawn(new pita(), newPoint(100, 112));
    model.spawn(new mes(), newPoint(100, 136));
};
