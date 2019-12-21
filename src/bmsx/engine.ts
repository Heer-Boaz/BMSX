import { DrawImgFlags, BaseView } from "./view";
import { SM } from "./soundmaster";
import { Input } from "./input";
import { RomLoadResult } from "./rompack";
import { MSX2ScreenWidth, MSX2ScreenHeight } from "./msx";
import { Point, Area, moveArea, Size } from "./common";
import { AudioId } from './resourceids';

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
    lastUpdate: number;
    _turnCounter: number;
    intervalid: number;
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

        this.lastUpdate = 0;
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
        this.lastUpdate = performance.now();
        this.draw();
        this.intervalid = <number><unknown>setInterval(this.run, fpstime);
    }

    public update(elapsedMs: number): void {
        BStopwatch.updateTimers(elapsedMs);
        controller.takeTurn(elapsedMs);
    }

    public draw(): void {
        if (!game.wasupdated) return;
        view.drawgame();
        if (game.running) requestAnimationFrame(game.draw);
    }

    public run(): void {
        game.update(fpstime);
        game.wasupdated = true;

        ++game._turnCounter;
    }

    public stop(): void {
        game.running = false;
        clearInterval(game.intervalid);

        requestAnimationFrame(() => {
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
    public id2object: Map<string, IGameObject>;
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

    constructor() {
        this.objects = [];
        this.id2object = new Map<string, IGameObject>();
        this.gameState = 0;
        this.gameSubstate = 0;
        this.oldGameState = 0;
        this.oldGameSubstate = 0;

        this.paused = false;
    }

    public abstract initModelForGameStart(): void;

    public clearModel(): void {
        this.objects.forEach(o => {
            o.dispose();
        });
        this.objects.length = 0;
        this.id2object.clear();
        this.paused = false;
    }

    public spawn(o: IGameObject, pos?: Point, ifnotexists = false): void {
        if (ifnotexists && this.id2object.has(o.id)) return; // Don't add objects that already exist
        if (!o) throw new Error("Cannot spawn object of type null.");

        this.objects.push(o);

        this.objects.sort((o1, o2) => (o1.priority || 0) - (o2.priority || 0));

        if (o.id) this.id2object.set(o.id, o);
        o.spawn && o.spawn(pos || null);
    }

    public remove(o: IGameObject): void {
        if (!o) throw new Error("Cannot remove object of type null.");

        let index = this.objects.indexOf(o);
        if (index > -1) {
            delete this.objects[index];
            this.objects.splice(index, 1);
        }
        else throw new Error("Could not find object to remove.");

        if (o.id !== null && this.id2object.has(o.id)) this.id2object.delete(o.id);
        o.dispose && o.dispose();
    }
}

export interface IGameObject {
    id: string | null;
    disposeFlag: boolean;
    priority?: number;
    pos: Point;
    smachines?: bst<any>[];

    isWall?: boolean;
    disposeOnSwitchRoom?: boolean;

    takeTurn(): void;
    spawn?: ((spawningPos?: Point | null) => void) | (() => void);
    dispose?(): void;

    paint?(offset?: Point): void;
    postpaint?(offset?: Point): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
    objectCollide?(o: IRenderObject): boolean;
    areaCollide?(a: Area): boolean;
    collides?(o: IRenderObject | Area): boolean;
    collide?(src: IRenderObject): void;
    oncollide?: (src: IRenderObject) => void;
}

export abstract class HiddenObject implements IGameObject {
    pos: Point;
    id: string;
    disposeFlag: boolean;

    abstract takeTurn(): void;
    abstract spawn: ((spawningPos?: Point) => void) | (() => void);
    abstract dispose(): void;

    // public static [Symbol.hasInstance](o: any): boolean {
    //     return o && !o.paint;
    // }
}

export interface IRenderObject extends IGameObject {
    size: Size;
    hitarea?: Area;
    visible: boolean;
    hitbox_sx?: number;
    hitbox_sy?: number;
    hitbox_ex?: number;
    hitbox_ey?: number;
    x_plus_width?: number;
    y_plus_height?: number;
    priority?: number;

    paint(offset?: Point): void;
    postpaint(offset?: Point): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
    objectCollide(o: IRenderObject): boolean;
    areaCollide(a: Area): boolean;
    collides(o: IRenderObject | Area): boolean;
    collide(src: IRenderObject): void;
    oncollide: (src: IRenderObject) => void;
}

export abstract class Sprite implements IRenderObject {
    public id: string | null;
    public pos: Point;
    public size: Size;
    public hitarea: Area;
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

    public disposeOnSwitchRoom?: boolean;
    public oncollide: (src: IRenderObject) => void;

    constructor(initialPos?: Point, imageId?: number) {
        this.id = null;
        this.pos = initialPos || <Point>{ x: 0, y: 0 };
        this.size = <Size>{ x: 0, y: 0 };
        this.hitarea = <Area>{
            start: { x: 0, y: 0 },
            end: { x: 0, y: 0 }
        };
        this.visible = true;
        this.hittable = true;
        this.flippedH = false;
        this.flippedV = false;
        this.priority = 0;
        this.disposeFlag = false;
        this.imgid = imageId || undefined;

        this.disposeOnSwitchRoom = true;
        this.oncollide = undefined;
    }

    spawn(spawningPos?: Point): void {
        if (spawningPos) this.pos = spawningPos;
    }

    abstract dispose(): void;

    abstract takeTurn(): void;

    paint(offset?: Point, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean; }): void {
        if (this.disposeFlag || !this.visible) return;
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

    static objectCollide(o1: IRenderObject, o2: IRenderObject): boolean {
        return o1.objectCollide(o2);
    }

    public collides(o: IRenderObject | Area): boolean {
        if ((o as IRenderObject).id) return this.objectCollide(<IRenderObject>o);
        else return this.areaCollide(<Area>o);
    }

    public collide(src: IRenderObject): void {
        this.oncollide && this.oncollide(src);
    }

    objectCollide(o: IRenderObject): boolean {
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
}

export class BStopwatch {
    public pauseDuringMenu: boolean = true;
    public pauseAtFocusLoss: boolean = true;
    public running: boolean = false;
    public elapsedMilliseconds: number;
    public elapsedFrames: number;
    private static watchesThatHaveBeenStopped: BStopwatch[] = [];
    private static watchesThatHaveBeenStoppedAtFocusLoss: BStopwatch[] = [];

    /// <summary>
    /// This list is used to pause all running timers for when the game is paused, or the game loses focus, etc.
    /// </summary>
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

export type str2bst<T extends object> = { [key: string]: bst<T>; };
export type runhandle<T extends object> = (_state: bst<T>, ...input: any[]) => any;
export type bsfthandle<T extends object> = (_state: bst<T>) => void;
export type numstring = number | string;

export class bst<T extends object>{
    public bsm: bst<T>;
    public target: T;
    public tapedata: any[];

    protected _tapehead: number;
    public get tapehead(): number {
        return this._tapehead;
    }
    public set tapehead(v: number) {
        this._tapeheadnudges = 0;
        this._tapehead = v;
        this.tapeheadmove();
        if (this.tapedata) {
            if (this._tapehead >= this.tapedata.length - 1)
                this.tapeend();
        }
    }

    public setTapeheadNoEvent(v: number) {
        this._tapehead = v;
    }

    public setTapeheadNudgesNoEvent(v: number) {
        this._tapeheadnudges = v;
    }

    protected _tapeheadnudges: number;
    public get tapeheadnudges(): number {
        return this._tapeheadnudges;
    }
    public set tapeheadnudges(v: number) {
        this._tapeheadnudges = v;
        if (v >= this.delta2tapehead) {
            this._tapeheadnudges = 0;
            ++this.tapehead;
        }
    }

    public get currentdata(): any { return (this.tapedata && this.tapehead < this.tapedata.length) ? this.tapedata[this.tapehead] : undefined; };
    public delta2tapehead: number; // Number of runs before tapehead moves to next statedata

    protected initstateid: numstring = 0;

    public states: str2bst<T>; // Note that numbers will be automatically converted to strings!
    public id: numstring;
    public currentid: numstring; // Identifier of current state
    public isfinal: boolean;
    public halted: boolean;
    public onrun: runhandle<T>;
    public onfinalstate: bsfthandle<T>;
    public ontapeend: bsfthandle<T>;
    public ontapeheadmove: bsfthandle<T>;
    public oninitstate: bsfthandle<T>;
    public onexitstate: bsfthandle<T>;
    public get endoftape(): boolean { return !this.tapedata || this.tapehead === this.tapedata.length - 1; }
    public get startoftape(): boolean { return this.tapehead === 0; }
    public get hasstates(): boolean { return this.states !== undefined; }
    public get iscomposite(): boolean { return this.states !== undefined; }
    public get internalstate() { return { statedata: this.tapedata, tapehead: this.tapehead }; }
    public get current(): bst<T> { return this.states?.[this.currentid]; };

    constructor(_target: T, _id: numstring = 0, _composite = false, _final = false) {
        if (_composite) this.states = {};
        this.target = _target;
        this.id = _id;
        this.isfinal = _final;
        this.delta2tapehead = 1;
        this.halted = false;
        this.reset();
    }

    public setStartState(_id: numstring, init = true) {
        this.initstateid = _id;
        this.currentid = _id;
        if (init) this.current.oninitstate?.(this.current);
    }

    public addNewState(_id: numstring, _composite = false, _final = false): bst<T> {
        if (this.states[_id]) throw new Error(`State ${_id} already exists for state machine!`);
        let result = new bst<T>(this.target, _id, _composite, _final);
        this.states[_id] = result;
        result.bsm = this;
        return result;
    }

    public addState(s: bst<T>): void {
        if (this.states[s.id]) throw new Error(`State ${s.id} already exists for state machine!`);
        this.states[s.id] = s;
        s.bsm = this;
    }

    public run(...input: any[]) {
        if (this.halted) return;
        let state_to_run = this.current ?? this;
        let result = state_to_run.onrun?.(state_to_run, input);
        if (state_to_run.isfinal) state_to_run.onfinalstate?.(state_to_run);
        return result;
    }

    public tapeheadmove() {
        this.ontapeheadmove?.(this);
    }

    public tapeend() {
        this.ontapeend?.(this);
    }

    public transition(newstate: numstring): void {
        this.current.onexitstate?.(this.current);
        this.currentid = newstate;
        this.current.oninitstate?.(this.current);
    }

    public transitionSM(newstate: numstring): void {
        this.bsm.transition(newstate);
    }

    public reset(): void {
        this.currentid = this.initstateid;
        this._tapehead = 0;
        this._tapeheadnudges = 0;
        this.halted = false;
    }

    public append(_state: bst<T>, _id: numstring): void {
        this.states[_id] = _state;
    }

    public remove(_id: numstring): void {
        delete this.states[_id];
    }
}