import { RomLoadResult } from '../bmsx/rompack';
import { Game, game, model, BaseModel, IGameObject, Sprite, BSTEventType, bss, bst } from '../bmsx/engine';
import { setPoint, newPoint, Direction, newSize } from '../bmsx/common';
import { Tile, MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';

const COLUMN_X = <Array<number>>[ 36, 48, 80, 160 ];
const START_COLUMN = 1;

let speler = class extends Sprite {
    anistate: bst;
    column: number;

    constructor(startcolumn: number) {
        super();
        let self = this;
        this.imgid = BitmapId.p1;
        this.priority = 1000;
        this.anistate = new bst();
        this.column = startcolumn;

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
        let urghstate = this.anistate.add('urgh');
        urghstate.tapedata = <Array<BitmapId>>[
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
        }

        let switch_run = (s: bss, type: BSTEventType): void => {
            switch (self.currentid) {
                case 'switchleft':
                    self.pos.x -= 2;
                    if (self.pos.x <= COLUMN_X[self.column - 1]) {
                        self.column -= 1;
                        self.anistate.toPrevious();
                        self.toPrevious();
                    }
                break;
                case 'switchright':
                    self.pos.x += 2;
                    if (self.pos.x >= COLUMN_X[self.column + 1]) {
                        self.column += 1;
                        self.anistate.toPrevious();
                        self.toPrevious();
                    }
                break;
            }
        }

        switch_left.oninitstate = switch_right.oninitstate = switch_init_exit;
        switch_left.onrun = switch_right.onrun = switch_run;

        let walkstaterunhandler = (s: bss, type: BSTEventType): void => {
            self.anistate.run();

            if (Input.KC_LEFT) {
                if (self.canSwitchLeft) {
                    self.to('switchleft');
                }
            }
            else if (Input.KC_RIGHT) {
                if (self.canSwitchRight) {
                    self.to('switchright');
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
                }
            }
        }
        let walkstate = this.add('walk');
        walkstate.onrun = walkstaterunhandler;

        let columnswitchstate = this.anistate.add('columnswitch');
        let columnswitchstatehandler = (s: bss, type: BSTEventType): void => {
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
        }
        columnswitchstate.setAllHandlers(columnswitchstatehandler);

        downstate.nudges2move = upstate.nudges2move = 8;
        urghstate.nudges2move = 8;
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
        }

        downstate.setAllHandlers(walkhandler);
        upstate.setAllHandlers(walkhandler);
        let urghhandler = (s: bss, type: BSTEventType): void => {
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
                    model.to('gameover');
                    break;
                case BSTEventType.TapeMove:
                    self.imgid = s.currentdata;
                    break;
            }
        }

        urghstate.setAllHandlers(urghhandler);
        this.anistate.setStart('down');
        this.setStart('walk');
    }

    takeTurn(): void {
        this.run();
    }

    private get canSwitchLeft(): boolean {
        switch (this.column) {
            case 0: return false;
            case 1: return true;
            case 2: return true;
            case 3: return (this.pos.y <= 12 || this.pos.y >= 144);
            default: return false;
        }
    }

    private get canSwitchRight(): boolean {
        switch (this.column) {
            case 0: case 1: return true;
            case 2: return (this.pos.y <= 12 || this.pos.y >= 144);
            case 3: return false
            default: return false;
        }
    }
};

let keuken = class extends Sprite {
    constructor() {
        super();
        this.imgid = BitmapId.Keuken;
        this.priority = 0;
    }

    takeTurn(): void {
    }
};

let _modelclass = class extends BaseModel {
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

let _viewclass = class extends GLView {
    public drawgame(): void {
        super.drawgame();
        super.drawSprites();
    }
};

var _global = window || global;
_global['h406A'] = (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode): void => {
    let _model = new _modelclass();
    let _view = new _viewclass(newSize(MSX1ScreenWidth, MSX1ScreenHeight));
    new Game(rom, _model, _view, null, sndcontext, gainnode);

    game.start();
    model.spawn(new keuken(), newPoint(0, 0));
    model.spawn(new speler(START_COLUMN), newPoint(COLUMN_X[START_COLUMN], 16));
};
