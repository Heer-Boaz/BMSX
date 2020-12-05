import { RomLoadResult } from '../bmsx/rompack';
import { Game, game, model, BaseModel, IGameObject, Sprite, BSTEventType, bss, bst } from '../bmsx/engine';
import { setPoint, newPoint, Direction, newSize, newArea, Point, randomInt, copyPoint } from '../bmsx/common';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';

const COLUMN_X = <Array<number>>[36, 48, 80, 160];
const START_COLUMN = 1;
const MAX_CORONA = 3;
const TIME_CORONA_SPAWN = 100;
const MIN_CORONA_MOVE = 16;
const MAX_CORONA_MOVE = 72;
const CORONA_SPAWN_LOCS = <Array<Point>>[
    // { x: 150, y: 100 },
    { x: MSX1ScreenWidth, y: 0 },
    { x: MSX1ScreenWidth, y: MSX1ScreenHeight },
];

let _modelclass = class extends BaseModel {
    public marlies: Sprite;

    constructor() {
        super();
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
};

var _model = new _modelclass();

let brandblusser = class extends Sprite {
    constructor() {
        super();
        this.imgid = BitmapId.Brandblusser;
        this.priority = _model.marlies.direction == Direction.Up ? 950 : 1050;
        let self = this;

        let bla = this.add('bla');
        this.setStart('bla');
        bla.nudges2move = 20;

        let blaer = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Run:
                    setPoint(self.pos, _model.marlies.pos.x, _model.marlies.pos.y + 12);
                    let oldPrio = self.priority;
                    if (_model.marlies.direction == Direction.Up) self.priority = 950;
                    else self.priority = 1050;
                    if (self.priority != oldPrio) _model.sortObjectsByPriority();
                    ++s.nudges;
                    break;
                case BSTEventType.TapeMove:
                    self.disposeFlag = true;
                    break;
            }
        };
        bla.setAllHandlers(blaer);
    }

    takeTurn(): void {
        this.run();
    }
};

let ingredient = class extends Sprite {
    takeTurn(): void {
    }
};

let komkommer = class extends ingredient {
    constructor() {
        super();
        this.imgid = BitmapId.Komkommer;
    }
};

let tomaatjes = class extends ingredient {
    constructor() {
        super();
        this.imgid = BitmapId.Tomaatjes;
    }
};

let falafel = class extends ingredient {
    constructor() {
        super();
        this.imgid = BitmapId.Falafel;
    }
};

let vuur = class extends Sprite {
    constructor(dir: Direction) {
        super();
        this.direction = dir;
        this.hitarea = newArea(4, 4, 12, 12);
        this.priority = dir != Direction.Up ? 1100 : 900;

        let self = this;
        this.imgid = BitmapId.Vuur1;

        let brandstate = this.add('brand');
        this.setStart('brand');

        brandstate.tapedata = <Array<BitmapId>>[
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
        ];

        brandstate.nudges2move = 1;
        let brandHandler = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Init:
                    s.reset();
                    self.imgid = s.currentdata;
                    break;
                case BSTEventType.Run:
                    ++s.nudges;
                    switch (self.direction) {
                        case Direction.Up: self.pos.y -= 6; break;
                        case Direction.Right: self.pos.x += 6; break;
                        case Direction.Down: self.pos.y += 6; break;
                        case Direction.Left: self.pos.x -= 6; break;
                    }
                    break;
                case BSTEventType.TapeEnd:
                    s.reset();
                    self.disposeFlag = true;
                    break;
                case BSTEventType.TapeMove:
                    self.imgid = s.currentdata;
                    break;
            }
        };
        brandstate.setAllHandlers(brandHandler);
    }

    isVuur = true;

    takeTurn(): void {
        this.run();
    }
};

let corona = class extends Sprite {
    constructor() {
        super();

        let self = this;
        this.imgid = BitmapId.Corona1;
        this.hitarea = newArea(4, 4, 28, 28);
        this.priority = 1200;

        let skulkstate = this.add('skulk');
        this.setStart('skulk');

        skulkstate.tapedata = <Array<BitmapId>>[
            BitmapId.Corona1,
            BitmapId.Corona2,
            BitmapId.Corona3,
            BitmapId.Corona2,
        ];

        let sterfstate = this.add('sterf');
        sterfstate.tapedata = <Array<BitmapId>>[
            BitmapId.Corona4,
            BitmapId.Corona5,
            BitmapId.Corona6,
            BitmapId.Corona7,
            BitmapId.Corona8,
            BitmapId.Corona9,
            BitmapId.Corona10,
            BitmapId.Corona11,
            BitmapId.None,
        ];

        skulkstate.nudges2move = 4;
        sterfstate.nudges2move = 4;

        let skulkHandler = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Init:
                    s.reset();
                    self.imgid = s.currentdata;
                    self.setRandomMove();
                    break;
                case BSTEventType.Run:
                    ++s.nudges;
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
                    break;
                case BSTEventType.TapeEnd:
                    s.reset();
                    self.imgid = s.currentdata;
                    break;
                case BSTEventType.TapeMove:
                    self.imgid = s.currentdata;
                    break;
            }
        };

        let sterfHandler = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Init:
                    self.isEng = false;
                    s.reset();
                    self.imgid = s.currentdata;
                    break;
                case BSTEventType.Run:
                    ++s.nudges;
                    break;
                case BSTEventType.TapeEnd:
                    s.reset();
                    self.disposeFlag = true;
                    break;
                case BSTEventType.TapeMove:
                    self.imgid = s.currentdata;
                    break;
            }
        };

        skulkstate.setAllHandlers(skulkHandler);
        sterfstate.setAllHandlers(sterfHandler);
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

let speler = class extends Sprite {
    anistate: bst;
    column: number;

    constructor(startcolumn: number) {
        super();
        let self = this;
        this.imgid = BitmapId.p1;
        this.direction = Direction.Down;
        this.priority = 1000;
        this.anistate = new bst();
        this.column = startcolumn;
        this.hitarea = newArea(0, 8, 16, 16);

        let downstate = this.anistate.add('down');
        downstate.tapedata = <Array<BitmapId>>[
            BitmapId.p1,
            BitmapId.p2,
            BitmapId.p1,
            BitmapId.p3,
            BitmapId.p1,
        ];
        let upstate = this.anistate.add('up');
        upstate.tapedata = <Array<BitmapId>>[
            BitmapId.p4,
            BitmapId.p5,
            BitmapId.p4,
            BitmapId.p6,
            BitmapId.p4,
        ];
        let urghAniState = this.anistate.add('urgh');
        urghAniState.tapedata = <Array<BitmapId>>[
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
        ];

        let switch_left = this.add('switchleft');
        let switch_right = this.add('switchright');
        let switch_init_exit = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Init:
                    self.anistate.to('columnswitch');
                    break;
                case BSTEventType.Exit:
                    break;
            }
        };

        let switch_run = (s: bss, type: BSTEventType): void => {
            if (Input.KC_BTN1 || Input.KC_SPACE) {
                self.zetBoelInDeHens();
            }

            switch (self.currentid) {
                case 'switchleft':
                    self.pos.x -= 2;
                    if (self.pos.x <= COLUMN_X[self.column - 1]) {
                        self.column -= 1;
                        self.anistate.toPrevious();
                        self.toPrevious();
                        self.direction = self.oldDirection;
                    }
                    break;
                case 'switchright':
                    self.pos.x += 2;
                    if (self.pos.x >= COLUMN_X[self.column + 1]) {
                        self.column += 1;
                        self.anistate.toPrevious();
                        self.toPrevious();
                        self.direction = self.oldDirection;
                    }
                    break;
            }
            self.doeCoronaTest();
        };

        switch_left.oninitstate = switch_right.oninitstate = switch_init_exit;
        switch_left.onrun = switch_right.onrun = switch_run;

        let walkstaterunhandler = (s: bss, type: BSTEventType): void => {
            self.anistate.run();

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
                    if (self.column !== 3 ||
                        (self.pos.y > 104 || self.pos.y <= 80)) {
                        self.pos.y -= 2;
                    }
                }
                if (self.anistate.currentid !== 'up') {
                    self.anistate.to('up');
                    self.direction = Direction.Up;
                }
            }
            else if (Input.KD_DOWN) {
                if (self.pos.y <= model.gameheight - 32 && self.column !== 0) {
                    if (self.column !== 3 ||
                        (self.pos.y < 44 || self.pos.y >= 80)) {
                        self.pos.y += 2;
                    }
                }
                if (self.anistate.currentid !== 'down') {
                    self.anistate.to('down');
                    self.direction = Direction.Down;
                }
            }
            if (Input.KC_BTN1 || Input.KC_SPACE) {
                self.zetBoelInDeHens();
            }
            self.doeCoronaTest();
        };
        let walkstate = this.add('walk');
        walkstate.onrun = walkstaterunhandler;

        let columnswitchAnistate = this.anistate.add('columnswitch');
        let columnswitchAnistatehandler = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Init:
                    self.imgid = BitmapId.p7;
                    if (self.current.id === 'switchright')
                        self.flippedH = true;
                    break;
                case BSTEventType.Exit:
                    self.flippedH = false;
                    break;
            }
        };
        columnswitchAnistate.setAllHandlers(columnswitchAnistatehandler);

        downstate.nudges2move = upstate.nudges2move = 8;
        let walkhandler = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Init:
                    s.reset();
                    self.imgid = s.currentdata;
                    break;
                case BSTEventType.Run:
                    ++s.nudges;
                    break;
                case BSTEventType.TapeEnd:
                    s.reset();
                    break;
                case BSTEventType.TapeMove:
                    self.imgid = s.currentdata;
                    break;
            }
        };

        downstate.setAllHandlers(walkhandler);
        upstate.setAllHandlers(walkhandler);
        urghAniState.nudges2move = 4;
        let urghAniHandler = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Init:
                    s.reset();
                    self.imgid = s.currentdata;
                    self.flippedH = false;
                    break;
                case BSTEventType.Run:
                    ++s.nudges;
                    break;
                case BSTEventType.TapeEnd:
                    s.reset();
                    // model.to('gameover');
                    self.toPrevious();
                    s.parentbst.toPrevious();
                    break;
                case BSTEventType.TapeMove:
                    self.imgid = s.currentdata;
                    break;
            }
        };

        let urghSpelerState = this.add('urgh');
        let urghSpelerHandler = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Init:
                    self.anistate.to('urgh');
                    break;
                case BSTEventType.Run:
                    self.anistate.run(); // Lelijk, maar animatie-state zorgt voor terugkeer naar previous state
                    break;
            }
        };
        urghSpelerState.setAllHandlers(urghSpelerHandler);

        urghAniState.setAllHandlers(urghAniHandler);
        this.anistate.setStart('down');
        this.setStart('walk');
    }

    takeTurn(): void {
        this.run();
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
        if (this.currentid == 'urgh') return;
        if (_model.objects.filter(o => (<any>o)?.isEng).some(c => this.objectCollide(c))) {
            this.to('urgh');
        }
    }

    private get canSwitchLeft(): boolean {
        switch (this.column) {
            case 0: return false;
            case 1: return this.pos.y >= 144;
            case 2: return true;
            case 3: return (this.pos.y <= 12 || this.pos.y >= 144);
            default: return false;
        }
    }

    private get canSwitchRight(): boolean {
        switch (this.column) {
            case 0: case 1: return true;
            case 2: return (this.pos.y <= 12 || this.pos.y >= 144);
            case 3: return false;
            default: return false;
        }
    }
};

let keuken = class extends Sprite {
    constructor() {
        super();
        this.imgid = BitmapId.Keuken;
        this.priority = 0;

        let defaultState = this.add('wees_een_keuken');
        this.setStart('wees_een_keuken');
        defaultState.nudges2move = TIME_CORONA_SPAWN;

        let defaultHandler = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Init:
                    s.reset();
                    break;
                case BSTEventType.Run:
                    ++s.nudges;
                    break;
                case BSTEventType.TapeMove:
                    if (_model.objects.filter(o => (<any>o)?.isEng).length < MAX_CORONA) {
                        let rloc = randomInt(0, CORONA_SPAWN_LOCS.length - 1);
                        let sloc = CORONA_SPAWN_LOCS[rloc];
                        model.spawn(new corona(), sloc);
                    }
                    break;
            }
        };

        defaultState.setAllHandlers(defaultHandler);
    }

    takeTurn(): void {
        this.run();
    }
};


let _viewclass = class extends GLView {
    public drawgame(): void {
        super.drawgame();
        super.drawSprites();
    }
};

var _global = window || global;
_global['h406A'] = (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode): void => {
    // _model = new _modelclass();
    let _view = new _viewclass(newSize(MSX1ScreenWidth, MSX1ScreenHeight));
    new Game(rom, _model, _view, null, sndcontext, gainnode);

    game.start();
    model.spawn(new keuken(), newPoint(0, 0));
    let marlies = new speler(START_COLUMN);
    _model.marlies = marlies;
    model.spawn(marlies, newPoint(COLUMN_X[START_COLUMN], 16));
};
