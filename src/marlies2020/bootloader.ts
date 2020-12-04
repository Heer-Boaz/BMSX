import { RomLoadResult } from '../bmsx/rompack';
import { Game, game, model, BaseModel, IGameObject, Sprite, BSTEventType, bss, bst } from '../bmsx/engine';
import { setPoint, newPoint, Direction, newSize } from '../bmsx/common';
import { Tile, MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';

let speler = class extends Sprite {
    anistate: bst;
    column: number;

    constructor() {
        super();
        this.imgid = BitmapId.p1;
        this.priority = 1000;
        this.anistate = new bst();
        this.column = 2;

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

        let columnswitchstate = this.anistate.add('columnswitch');
        let columnswitchstatehandler = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Init:
                    this.imgid = BitmapId.p7;
                    break;
                case BSTEventType.Exit:
                    s.parentbst.toPrevious();
                    break;
            }
        }
        columnswitchstate.onrun = columnswitchstate.ontapeend = columnswitchstate.ontapemove = columnswitchstatehandler;
        // this.flippedH = this.direction == Direction.Left ? true : false;
        // if (!model.isCollisionTile(this.hitbox_sx + 4, this.hitbox_ey + 12)) {
        //     this.pos.y += 4;
        // }

        downstate.nudges2move = upstate.nudges2move = 8;
        urghstate.nudges2move = 8;
        let state0handler = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Run:
                    ++s.nudges;
                    break;
                case BSTEventType.TapeEnd:
                    s.reset();
                    break;
                case BSTEventType.TapeMove:
                    this.imgid = s.currentdata;
                    break;
            }
        };
        downstate.onrun = downstate.ontapeend = downstate.ontapemove = state0handler;
        upstate.onrun = upstate.ontapeend = upstate.ontapemove = state0handler;
        let urghhandler = (s: bss, type: BSTEventType): void => {
            switch (type) {
                case BSTEventType.Run:
                    ++s.nudges;
                    break;
                case BSTEventType.TapeEnd:
                    s.reset();
                    model.to('gameover');
                    break;
                case BSTEventType.TapeMove:
                    this.imgid = s.currentdata;
                    break;
            }
        };
        urghstate.onrun = urghstate.ontapeend = urghstate.ontapemove = urghhandler;
        this.anistate.setStart('down');
    }

    takeTurn(): void {
        // this.run();
        this.anistate.run();

        if (Input.KD_UP) {
            if (this.pos.y >= 4) {
                if (this.column !== 2 ||
                    (this.pos.y > 104 || this.pos.y <= 80)) {
                    this.pos.y -= 2;
                }
            }
            if (this.anistate.currentid !== 'up') {
                this.anistate.to('up');
            }
        }
        if (Input.KD_RIGHT) {
            // this.pos.x += 2;
        }
        if (Input.KD_DOWN) {
            if (this.pos.y <= model.gameheight - 32) {
                if (this.column !== 2 ||
                    (this.pos.y < 44 || this.pos.y >= 80)) {
                    this.pos.y += 2;
                }
            }
            if (this.anistate.currentid !== 'down') {
                this.anistate.to('down');
            }
        }
        if (Input.KD_LEFT) {
            // this.pos.x -= 2;
        }
    }
    // 8 -> column 1 <-> 2
    // 152 -> column 1 <-> 2
    //
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
    model.spawn(new speler(), newPoint(160, 16));
};
