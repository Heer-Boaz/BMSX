import { DrawImgFlags, BaseView } from "./view";
import { SM } from "./soundmaster";
import { Input } from "./input";
import { RomLoadResult } from "./rompack";
import { MSX2ScreenWidth, MSX2ScreenHeight, TileSize } from "./msx";
import { Point, Area, moveArea, Size, Direction } from "./common";

export let game: Game;
export let model: BaseModel;
export let controller: BaseController;
export let view: BaseView;

const fps: number = 50;
const fpstime: number = 1000 / fps;

export class GameOptions {
    public static readonly INITIAL_SCALE: number = 1;
    public static readonly INITIAL_FULLSCREEN: boolean = false;

    public static Scale: number = GameOptions.INITIAL_SCALE;
    public static Fullscreen: boolean = GameOptions.INITIAL_FULLSCREEN;
    public static VolumePercentage: number = 50;
    public static MusicVolumePercentage: number = 50;

    public static get WindowWidth(): number {
        return (MSX2ScreenWidth * GameOptions.Scale);
    }

    public static get WindowHeight(): number {
        return (MSX2ScreenHeight * GameOptions.Scale);
    }

    public static get BufferWidth(): number {
        return (MSX2ScreenWidth * GameOptions.Scale);
    }

    public static get BufferHeight(): number {
        return (MSX2ScreenHeight * GameOptions.Scale);
    }
}

export module Constants {
    export const IMAGE_PATH: string = 'rom/Graphics/';
    export const AUDIO_PATH: string = 'rom/';

    export const SaveSlotCount: number = 6;
    export const SaveSlotCheckpoint: number = -1;
    export const SaveGamePath: string = "./Saves/sintervania.sa";
    export const CheckpointGamePath: string = "./Saves/sintervania.chk";
    export const OptionsPath: string = "./sintervania.ini";
}

export class Game {
    lastTick: number;
    _turnCounter: number;
    animationFrameRequestid: number;
    public running: boolean;
    wasupdated: boolean;
    public rom: RomLoadResult;

    constructor(_rom: RomLoadResult, _model: BaseModel, _view: BaseView, _controller: BaseController, sndcontext: AudioContext, gainnode: GainNode) {
        game = this;
        this.rom = _rom;

        model = _model;
        view = _view;
        controller = _controller;

        BaseView.images = _rom.images;
        view.init();
        SM.init(_rom['sndresources'], sndcontext, gainnode);
        Input.init();

        this.lastTick = performance.now();
        this.running = false;
        this.wasupdated = true;
    }

    public get turnCounter(): number {
        return this._turnCounter;
    }

    public GameOptionsChanged(): void {
        console.warn("Not implemented yet :-(");
        // GameOptionsPersistor.SaveOptions(GO._);
    }

    private loadGameOptions(): void {
        console.warn("Not implemented yet :-(");
        // let result = GameOptionsPersistor.LoadOptions();
        // if (result != null)
        //     GO._ = result;
    }

    public start(): void {
        window.addEventListener('resize', view.handleResize, false);
        window.addEventListener('orientationchange', view.handleResize, false);
        view.handleResize();

        this.running = true;
        this.lastTick = performance.now();
        this.run(performance.now());
        // this.intervalid = <number><unknown>setInterval(this.run, fpstime);
    }

    public update(elapsedMs: number): void {
        BStopwatch.updateTimers(elapsedMs);
        controller.takeTurn(elapsedMs);
    }

    // public draw(): void {
    //     if (!game.wasupdated) return;
    //     view.drawgame();
    //     if (game.running) requestAnimationFrame(game.draw);
    // }

    public run(tFrame: number): void {
        if (!game.running) return;

        game.animationFrameRequestid = window.requestAnimationFrame(game.run);
        let nextTick = game.lastTick + fpstime;
        let numTicks = 0;

        // If tFrame < nextTick then 0 ticks need to be updated (0 is default for numTicks).
        // If tFrame = nextTick then 1 tick needs to be updated (and so forth).
        // Note: As we mention in summary, you should keep track of how large numTicks is.
        // If it is large, then either your game was asleep, or the machine cannot keep up.
        if (tFrame > nextTick) {
            let timeSinceTick = tFrame - game.lastTick;
            numTicks = Math.floor(timeSinceTick / fpstime);
        }

        for (let i = 0; i < numTicks; i++) {
            ++game._turnCounter;
            game.lastTick = game.lastTick + fpstime; // Now lastTick is this tick.
            game.update(game.lastTick);
        }
        view.drawgame();
    }

    public stop(): void {
        game.running = false;
        // clearInterval(game.intervalid);
        window.cancelAnimationFrame(this.animationFrameRequestid);
        window.requestAnimationFrame(() => {
            view.clear();
            view.handleResize();
            SM.stopEffect();
            SM.stopMusic();
        });
    }
}

export abstract class BaseController {
    protected timer: BStopwatch;

    constructor() {
        this.timer = BStopwatch.createWatch();
        this.timer.restart();
    }

    // Methods
    public takeTurn(elapsedMs: number): void {
        if (model.paused) {
            this.doPausedState();
            return;
        }
        if (model.startAfterLoad) {
            this.doStartAfterLoadState();
        }

        // Update all timers
        BStopwatch.updateTimers(elapsedMs);

        // Remove all objects that are to be disposed
        model.objects.filter(o => o.disposeFlag).forEach(o => model.remove(o));
    }

    protected doPausedState() {
    }

    protected doStartAfterLoadState() {
    }

    public switchState(newstate: number): void {
        this.disposeOldState(newstate);
        this.initNewState(newstate);

        model.gameOldState = model.gameState;
        model.gameState = newstate;
    }

    public switchSubstate(newsubstate: number): void {
        this.disposeOldSubstate(newsubstate);
        this.initNewSubstate(newsubstate);

        model.gameOldSubstate = model.gameSubstate;
        model.gameSubstate = newsubstate;
    }

    protected abstract disposeOldState(newState: number): void;

    protected abstract disposeOldSubstate(newsubstate: number): void;

    protected abstract initNewSubstate(newsubstate: number): void;

    protected abstract initNewState(newstate: number): void;
}

export abstract class BaseModel {
    public id2object: { [key: string]: IGameObject; };
    public objects: IGameObject[];
    public gameState: number;
    public gameSubstate: number;
    public gameOldState: number;
    public gameOldSubstate: number;
    public paused: boolean;
    public startAfterLoad: boolean;

    public get oldGameState(): number {
        return this.gameOldState;
    }

    public set oldGameState(value: number) {
        this.gameOldState = value;
    }

    public get state(): number {
        return this.gameState;
    }

    public set state(value: number) {
        this.gameState = value;
    }

    public get oldGameSubstate(): number {
        return this.gameOldSubstate;
    }

    public set oldGameSubstate(value: number) {
        this.gameOldSubstate = value;
    }

    public get substate(): number {
        return this.gameSubstate;
    }

    public set substate(value: number) {
        this.gameSubstate = value;
    }

    public abstract get gamewidth(): number;
    public abstract get gameheight(): number;

    constructor() {
        this.objects = [];
        this.id2object = {};
        this.gameState = 0;
        this.gameSubstate = 0;
        this.oldGameState = 0;
        this.oldGameSubstate = 0;

        this.paused = false;
    }

    public abstract initModelForGameStart(): void;

    public clearModel(): void {
        this.objects.forEach(o => o.ondispose?.());
        this.objects.length = 0;
        delete this.id2object;
        this.id2object = {};
        this.paused = false;
    }

    public spawn(o: IGameObject, pos?: Point): void {
        this.objects.push(o);

        // this.objects.sort((o1, o2) => (o1.priority || 0) - (o2.priority || 0));
        this.objects.sort((o1, o2) => (o2.priority || 0) - (o1.priority || 0));

        this.id2object[o.id] = o;
        o.onspawn?.(pos);
    }

    public remove(o: IGameObject): void {
        let index = this.objects.indexOf(o);
        if (index > -1) {
            delete this.objects[index];
            this.objects.splice(index, 1);
        }

        if (this.id2object[o.id]) this.id2object[o.id] = undefined;
        o.ondispose?.();
    }

    public exists(id: string): boolean {
        return this.id2object[id] !== undefined;
    }

    public abstract collidesWithTile(o: IGameObject, dir: Direction): boolean;
    public abstract isCollisionTile(x: number, y: number): boolean;
}

export const enum BSTEventType {
    None = 0,
    Run = 1,
    Init = 2,
    Exit = 3,
    Final = 4,
    TapeMove = 5,
    TapeEnd = 6,
}

export type str2bss = { [key: string]: bss; };
export type bsfthandle = (state: bss, type: BSTEventType, gameobject: bst) => void;
export type numstring = number | string;

export class bss {
    public id: numstring;
    public isfinal: boolean;
    public parentbst: bst;

    public constructor(_id: numstring = 0, _composite = false, _final = false) {
        this.id = _id;
        this.isfinal = _final;
        this.nudges2move = 1;
        this.reset();
    }

    public get currentdata(): any { return (this.tapedata && this.tapehead < this.tapedata.length) ? this.tapedata[this.tapehead] : undefined; };
    public get endoftape(): boolean { return !this.tapedata || this.tapehead === this.tapedata.length - 1; }
    public get startoftape(): boolean { return this.tapehead === 0; }
    public onrun: bsfthandle;
    public onfinalstate: bsfthandle;
    public ontapeend: bsfthandle;
    public ontapemove: bsfthandle;
    public oninitstate: bsfthandle;
    public onexitstate: bsfthandle;
    public get internalstate() { return { statedata: this.tapedata, tapehead: this.tapehead }; }

    public tapedata: any[];

    public nudges2move: number; // Number of runs before tapehead moves to next statedata
    protected _tapehead: number;
    public get tapehead(): number {
        return this._tapehead;
    }
    public set tapehead(v: number) {
        this._nudges = 0; // Always reset tapehead nudges after moving tapehead
        this._tapehead = v;
        this.tapemove();
        if (this.tapedata && (this._tapehead >= this.tapedata.length - 1)) { this.tapeend(); }
    }

    public setTapeheadNoEvent(v: number) {
        this._tapehead = v;
    }

    public setTapeheadNudgesNoEvent(v: number) {
        this._nudges = v;
    }

    protected _nudges: number;
    public get nudges(): number {
        return this._nudges;
    }
    public set nudges(v: number) {
        this._nudges = v;
        if (v >= this.nudges2move) { ++this.tapehead; }
    }

    protected tapemove() {
        this.ontapemove?.(this, BSTEventType.TapeMove, this.parentbst);
    }

    protected tapeend() {
        this.ontapeend?.(this, BSTEventType.TapeEnd, this.parentbst);
        this._tapehead = 0; // Reset tapehead at reaching end (but only after event has been handled)
    }

    public reset(): void {
        this._tapehead = 0;
        this._nudges = 0;
    }
}

export class bst {
    protected initstateid: numstring = 0;

    public states: str2bss; // Note that numbers will be automatically converted to strings!
    public currentid: numstring; // Identifier of current state
    public halted: boolean;
    public get current(): bss { return this.states[this.currentid]; };

    constructor() {
        this.states = {};
        this.halted = false;
        this.reset();
    }

    public setStart(_id: numstring, init = true) {
        this.initstateid = _id;
        this.currentid = _id;
        if (init) this.current.oninitstate?.(this.current, BSTEventType.Init, this);
    }

    public add(id_or_state: numstring | bss, final = false): bss {
        if (typeof (id_or_state) !== 'object') {
            if (this.states[id_or_state]) throw new Error(`State ${id_or_state} already exists for state machine!`);
            let result = new bss(id_or_state, final);
            this.states[id_or_state] = result;
            result.parentbst = this;
            return result;
        }
        else {
            let s = id_or_state as bss;
            if (this.states[s.id]) throw new Error(`State ${s.id} already exists for state machine!`);
            this.states[s.id] = s;
            s.parentbst = this;
            return s;
        }
    }

    public run() {
        if (this.halted) return;
        this.current.onrun?.(this.current, BSTEventType.Run, this);
    }

    public to(newstate: numstring): void {
        this.current.onexitstate?.(this.current, BSTEventType.Exit, this);
        this.currentid = newstate;
        this.current.oninitstate?.(this.current, BSTEventType.Final, this);
    }

    public reset(): void {
        this.currentid = this.initstateid;
        this.halted = false;
    }

    public append(_state: bss, _id: numstring): void {
        this.states[_id] = _state;
    }

    public remove(_id: numstring): void {
        delete this.states[_id];
    }
}

export interface IGameObject {
    id: string | null;
    disposeFlag: boolean;
    priority?: number;
    pos: Point;
    size?: Size;
    hitarea?: Area;
    hittable?: boolean;
    visible?: boolean;

    hitbox_sx?: number;
    hitbox_sy?: number;
    hitbox_ex?: number;
    hitbox_ey?: number;
    wallhitbox_sx?: number;
    wallhitbox_sy?: number;
    wallhitbox_ex?: number;
    wallhitbox_ey?: number;
    isWall?: boolean;
    disposeOnSwitchRoom?: boolean;

    takeTurn(): void;
    spawn?(spawningPos?: Point): void;
    onspawn?: ((spawningPos?: Point) => void) | (() => void);
    ondispose?: () => void;

    paint?(offset?: Point): void;
    postpaint?(offset?: Point): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
    objectCollide?(o: IGameObject): boolean;
    areaCollide?(a: Area): boolean;
    collides?(o: IGameObject | Area): boolean;
    collide?(src: IGameObject): void;
    oncollide?: (src: IGameObject) => void;
}

export abstract class Sprite extends bst {
    public id: string | null;
    public pos: Point;
    public size: Size;
    public hitarea: Area;
    public get wallHitarea(): Area { return this.hitarea; }
    public visible: boolean;
    public hittable: boolean;
    public flippedH: boolean;
    public flippedV: boolean;
    public priority: number;
    public disposeFlag: boolean;
    public imgid: number;

    public get hitbox_sx(): number {
        return this.pos.x + this.hitarea.start.x;
    }

    public get hitbox_sy(): number {
        return this.pos.y + this.hitarea.start.y;
    }

    public get hitbox_ex(): number {
        return this.pos.x + this.hitarea.end.x;
    }

    public get hitbox_ey(): number {
        return this.pos.y + this.hitarea.end.y;
    }

    public get x_plus_width(): number {
        return this.pos.x + this.size.x;
    }

    public get y_plus_height(): number {
        return this.pos.y + this.size.y;
    }

    public get wallhitbox_sx(): number {
        return this.pos.x + this.wallHitarea.start.x;
    }

    public get wallhitbox_sy(): number {
        return this.pos.y + this.wallHitarea.start.y;
    }

    public get wallhitbox_ex(): number {
        return this.pos.x + this.wallHitarea.end.x;
    }

    public get wallhitbox_ey(): number {
        return this.pos.y + this.wallHitarea.end.y;
    }

    public disposeOnSwitchRoom?: boolean;
    public oncollide?: (src: IGameObject) => void;
    public onWallcollide?: (dir: Direction) => void;
    public onLeaveScreen?: (dir: Direction) => void;

    private _direction: Direction;
    public oldDirection: Direction;

    public get direction(): Direction {
        return this._direction;
    }

    public set direction(value: Direction) {
        this.oldDirection = this._direction;
        this._direction = value;
    }

    constructor() {
        super();
        this.pos = { x: 0, y: 0 };
        this.visible = true;
        this.hittable = true;
        this.flippedH = false;
        this.flippedV = false;
        this.priority = 0;
        this.disposeFlag = false;
        this.disposeOnSwitchRoom = true;
    }

    /**
    * Gebruik ik als event handler voor e.g. onLeaveScreen
    */
    markForDisposure(): void {
        this.disposeFlag = true;
    }

    spawn(spawningPos: Point = null): Sprite {
        model.spawn(this, spawningPos);
        return this; // Voor chaining
    }

    onspawn(spawningPos?: Point): void {
        if (spawningPos) {
            [this.pos.x, this.pos.y] = [spawningPos.x, spawningPos.y];
        }
    }

    abstract takeTurn(): void;

    paint(offset?: Point, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean; }): void {
        let options: number = this.flippedH ? DrawImgFlags.HFLIP : 0;
        options |= (this.flippedV ? DrawImgFlags.VFLIP : 0);
        let dx = offset?.x || 0;
        let dy = offset?.y || 0;

        if (colorize) {
            view.drawColoredBitmap(this.imgid, this.pos.x + dx, this.pos.y + dy, options, colorize.r, colorize.g, colorize.b, colorize.a);
        }
        else {
            view.drawImg(this.imgid, this.pos.x + dx, this.pos.y + dy, options);
        }
    }

    postpaint(offset?: Point): void {
    }

    static objectCollide(o1: IGameObject, o2: IGameObject): boolean {
        return o1.objectCollide(o2);
    }

    public collides(o: IGameObject | Area): boolean {
        if ((o as IGameObject).id) return this.objectCollide(<IGameObject>o);
        else return this.areaCollide(<Area>o);
    }

    public collide(src: IGameObject): void {
        this.oncollide?.(src);
    }

    objectCollide(o: IGameObject): boolean {
        return this.areaCollide(moveArea(o.hitarea, o.pos));
    }

    areaCollide(a: Area): boolean {
        let o1 = this;
        let o1p = o1.pos;
        let o1a = o1.hitarea;

        let o2a = a;

        return o1p.x + o1a.end.x >= o2a.start.x && o1p.x + o1a.start.x <= o2a.end.x &&
            o1p.y + o1a.end.y >= o2a.start.y && o1p.y + o1a.start.y <= o2a.end.y;
    }

    inside(p: Point): boolean {
        let o1 = this;
        let o1p = o1.pos;
        let o1a = o1.hitarea;

        return o1p.x + o1a.end.x >= p.x && o1p.x + o1a.start.x <= p.x &&
            o1p.y + o1a.end.y >= p.y && o1p.y + o1a.start.y <= p.y;
    }

    public setx(newx: number) {
        let oldx = this.pos.x;
        this.pos.x = ~~newx;
        if (newx < oldx) {
            if (model.collidesWithTile(this, Direction.Left)) {
                this.onWallcollide?.(Direction.Up);
                newx += TileSize - (newx % TileSize);
            }
            if (newx + this.size.x < 0) { this.onLeaveScreen?.(Direction.Left); }
        }
        else if (newx > oldx) {
            if (model.collidesWithTile(this, Direction.Right)) {
                this.onWallcollide?.(Direction.Right);
                newx -= newx % TileSize;
            }
            if (newx >= model.gamewidth) { this.onLeaveScreen?.(Direction.Right); }
        }
        this.pos.x = ~~newx;
    }

    public sety(newy: number) {
        let oldy = this.pos.y;
        this.pos.y = ~~newy;
        if (newy < oldy) {
            if (model.collidesWithTile(this, Direction.Up)) {
                this.onWallcollide?.(Direction.Up);
                newy += TileSize - (newy % TileSize);
            }
            if (newy + this.size.y < 0) { this.onLeaveScreen?.(Direction.Up); }
        }
        else if (newy > oldy) {
            if (model.collidesWithTile(this, Direction.Down)) {
                this.onWallcollide?.(Direction.Down);
                newy -= newy % TileSize;
            }
            if (newy >= model.gameheight) { this.onLeaveScreen?.(Direction.Down); }
        }
        this.pos.y = ~~newy;
    }
}

export class BStopwatch {
    public pauseDuringMenu: boolean = true;
    public pauseAtFocusLoss: boolean = true;
    public running: boolean = false;
    public elapsedMilliseconds: number;
    public elapsedFrames: number;
    private static watchesThatHaveBeenStopped: BStopwatch[] = [];
    private static watchesThatHaveBeenStoppedAtFocusLoss: BStopwatch[] = [];

    /**
     * This list is used to pause all running timers for when the game is paused, or the game loses focus, etc.
     */
    public static Watches: Array<BStopwatch> = [];

    public static createWatch(): BStopwatch {
        let result = new BStopwatch();
        BStopwatch.Watches.push(result);
        return result;
    }

    public static addWatch(watch: BStopwatch): void {
        if (BStopwatch.Watches.indexOf(watch) > -1)
            BStopwatch.Watches.push(watch);
    }

    public static removeWatch(watch: BStopwatch): void {
        let index = BStopwatch.Watches.indexOf(watch);
        if (index > -1) {
            delete BStopwatch.Watches[index];
            BStopwatch.Watches.splice(index, 1);
        }
    }

    public static updateTimers(elapsedMs: number): void {
        BStopwatch.Watches.forEach(s => { s.updateTime(elapsedMs); });
    }

    public static pauseAllRunningWatches(pauseCausedByMenu?: boolean): void {
        BStopwatch.Watches.filter(s => !s.running).forEach(s => { s.running = false; });
        //this.watchesThatHaveBeenStopped.Clear();
        BStopwatch.Watches.forEach(w => {
            if (w.running && (!pauseCausedByMenu || w.pauseDuringMenu)) {
                w.stop();
                BStopwatch.watchesThatHaveBeenStopped.push(w);
            }
        });
    }

    public static resumeAllPausedWatches(): void {
        BStopwatch.watchesThatHaveBeenStopped.filter(s => !s.running).forEach(s => { s.running = false; });
    }

    private static pauseWatchesOnFocusLoss(): void {
        BStopwatch.Watches.forEach(w => {
            if (w.running && w.pauseAtFocusLoss) {
                w.stop();
                this.watchesThatHaveBeenStoppedAtFocusLoss.push(w);
            }
        });
    }

    private static resumeAllPausedWatchesOnFocus(): void {
        this.watchesThatHaveBeenStoppedAtFocusLoss.forEach(w => w.start());
        this.watchesThatHaveBeenStoppedAtFocusLoss.length = 0;
    }

    constructor() {
        this.elapsedMilliseconds = 0;
        this.elapsedFrames = 0;
    }

    public start(): void {
        this.running = true;
    }

    public stop(): void {
        this.running = false;
    }

    public restart(): void {
        this.reset();
        this.running = true;
    }

    public reset(): void {
        this.elapsedMilliseconds = 0;
        this.elapsedFrames = 0;
    }

    public updateTime(elapsedMs: number): void {
        if (!this.running) return;
        this.elapsedMilliseconds += elapsedMs;
        ++this.elapsedFrames;
    }
}

export interface anidata<A extends any | null | {}> {
    delta: number;
    data: A;
}
