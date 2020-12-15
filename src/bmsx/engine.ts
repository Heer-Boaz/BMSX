import { DrawImgFlags, BaseView } from "./view";
import { SM } from "./soundmaster";
import { Input } from "./input";
import { RomLoadResult } from "./rompack";
import { MSX2ScreenWidth, MSX2ScreenHeight, TileSize } from "./msx";
import { Point, Area, moveArea, Size, Direction, mod } from "./common";
import { BaseModelOld } from './basemodel_old';
import { BaseControllerOld } from './basecontroller_old';

export let game: Game;
export let model: BaseModel | BaseModelOld;
export let controller: BaseControllerOld;
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

export const enum BSTEventType {
    None = 0,
    Run = 1,
    Enter = 2,
    Exit = 3,
    Next = 4,
    End = 5,
}

export type str2bss = { [key: string]: bss; };
export type bsfthandle = (state: bss, ik: any, type: BSTEventType) => void;
export type numstring = number | string;

export class bss {
    public id: numstring;
    public parent: bst;
    public ik: any;
    public start?: boolean; // Is this a start state?
    public init?: boolean; // Should this state be initiated when this is a start state?

    public constructor(_id: numstring = 0, _partialdef?: Partial<bss>) {
        this.id = _id;
        this.nudges2move = 1;
        if (_partialdef) Object.assign(this, _partialdef);
        this.reset();
    }

    public get current(): any { return (this.tape && this.head < this.tape.length) ? this.tape[this.head] : undefined; };
    public get atEnd(): boolean { return !this.tape || this.head === this.tape.length - 1; }
    public get atStart(): boolean { return this.head === 0; }
    public onrun: bsfthandle;
    public onfinal: bsfthandle;
    public onend: bsfthandle;
    public onnext: bsfthandle;
    public onenter: bsfthandle;
    public onexit: bsfthandle;
    public get internalstate() { return { statedata: this.tape, tapehead: this.head }; }
    public getTarget<T>(): T { return this.ik; }

    public tape: any[];

    public nudges2move: number; // Number of runs before tapehead moves to next statedata
    protected _tapehead: number;
    public get head(): number {
        return this._tapehead;
    }
    public set head(v: number) {
        this._nudges = 0; // Always reset tapehead nudges after moving tapehead
        // Check if the tape already was at the end
        if (this.tape && (this._tapehead >= this.tape.length - 1)) {
            // If so, rewind and move to the first element of the tapehead
            // But why? (Yes... Why?) Because we then can loop an animation,
            // including the first and last element of the tape, without having
            // to resort to any workarounds like duplicating the first entry
            // of the tape or similar.
            this._tapehead = 0;
        }
        else {
            // Else, move the tape ahead
            this._tapehead = v;
        }
        this.tapemove(); // Move the tape and trigger an event
        // Check if the tape now is at the end
        if (this.tape && (this._tapehead >= this.tape.length - 1)) {
            // If so, trigger the event for reaching the end of the tape
            this.tapeend();
        }
    }

    public setHeadNoSideEffect(v: number) {
        this._tapehead = v;
    }

    public setHeadNudgesNoSideEffect(v: number) {
        this._nudges = v;
    }

    protected _nudges: number;
    public get nudges(): number {
        return this._nudges;
    }
    public set nudges(v: number) {
        this._nudges = v;
        if (v >= this.nudges2move) { ++this.head; }
    }

    // Helper function to set all handlers
    public setAllHandlers(handler: bsfthandle): void {
        this.onrun = handler;
        this.onfinal = handler;
        this.onend = handler;
        this.onnext = handler;
        this.onenter = handler;
        this.onexit = handler;
    }

    protected tapemove() {
        this.onnext?.(this, this.ik, BSTEventType.Next);
    }

    protected tapeend() {
        this.onend?.(this, this.ik, BSTEventType.End);
    }

    public reset(): void {
        this._tapehead = 0;
        this._nudges = 0;
    }
}

const BST_MAX_HISTORY = 10;
const DEFAULT_BST_ID = 'master';
export class bst {
    public id: numstring;
    public ik: any;
    protected initstateid: numstring;

    public states: str2bss; // Note that numbers will be automatically converted to strings!
    public currentid: numstring; // Identifier of current state
    // protected previousid: numstring; // Identifier of the previous state
    protected history: Array<numstring>; // History of previous states
    public paused: boolean;
    public get current(): bss { return this.states[this.currentid]; };
    // public get previous(): bss { return this.states[this.previousid]; };

    constructor(ik: object, id?: string) {
        this.id = id ?? DEFAULT_BST_ID;
        this.ik = ik;
        this.states = {};
        this.paused = false;
        this.initstateid = null;
        this.reset();
    }

    public setStart(_id: numstring, init = true): void {
        this.initstateid = _id;
        this.currentid = _id;
        if (init) this.current.onenter?.(this.current, this.ik, BSTEventType.Enter);
    }

    public create(id: numstring, ik: any): bss {
        if (this.states[id]) throw new Error(`State ${id} already exists for state machine!`);
        let result = new bss(id);
        this.states[id] = result;
        result.parent = this;
        result.ik ??= ik;
        // if (!this.initstateid) this.setStart(id_or_state); // If no start-state was defined, we assign this as a default start state
        return result;
    }

    public add(ik: any, ...states: bss[]): void {
        for (let state of states) {
            if (!state.id) throw new Error(`State is missing an id, while attempting to add it to this bst!`);
            if (this.states[state.id]) throw new Error(`State ${state.id} already exists for state machine!`);
            this.states[state.id] = state;
            state.parent = this;
            state.ik ??= ik;
            if (state.start) this.setStart(state.id, state.init ?? true); // If designated as a start state, assign it as the start state
        }
    }

    public run(): void {
        if (this.paused) return;
        this.current.onrun?.(this.current, this.ik, BSTEventType.Run);
    }

    public to(newstate: numstring): void {
        this.current.onexit?.(this.current, this.ik, BSTEventType.Exit);
        this.pushHistory(this.currentid); // Store the previous state on the history stack
        this.currentid = newstate; // Switch the current state to the new state
        if (!this.current) throw new Error(`State "${newstate}" doesn't exist for this state machine!`);
        this.current.onenter?.(this.current, this.ik, BSTEventType.Enter);
    }

    protected pushHistory(toPush: numstring): void {
        this.history.push(toPush);
        if (this.history.length > BST_MAX_HISTORY)
            this.history.shift(); // Remove the first element in the history-array
    }

    public pop(): void {
        if (this.history.length <= 0) return;
        let poppedStateId = this.history.pop();
        this.to(poppedStateId);
    }

    public reset(): void {
        this.currentid = this.initstateid;
        this.history = new Array();
        this.paused = false;
    }

    public append(_state: bss, _id: numstring): void {
        this.states[_id] = _state;
    }

    public remove(_id: numstring): void {
        delete this.states[_id];
    }
}

export type numstr2bst = { [key: string]: bst; };
export abstract class cbst {
    public machines: numstr2bst;
    public paused: boolean;

    constructor() {
        this.machines = {};
        this.paused = false;
        this.addBst(DEFAULT_BST_ID);
    }

    public getBst(machine_id: string): bst {
        return this.machines[machine_id];
    }

    public getCurrentId(machine_id: string = DEFAULT_BST_ID): numstring {
        return this.machines[machine_id].currentid;
    }

    public addBst(machine_id: string): bst {
        let result = new bst(this, machine_id);
        this.machines[machine_id] = result;

        return result;
    }

    public removeBst(machine_id: string): bst {
        let result = this.machines[machine_id];
        delete this.machines[machine_id];
        this.machines[machine_id] = undefined;
        return result;
    }

    public createState(state_id: numstring, machine_id: string = DEFAULT_BST_ID): bss {
        return this.machines[machine_id].create(state_id, this);
    }

    public add(...states: bss[]): void {
        this.addTo(DEFAULT_BST_ID, ...states);
    }

    public addTo(machine_id: string = DEFAULT_BST_ID, ...states: bss[]): void {
        this.machines[machine_id].add(this, ...states);
    }

    public run(): void {
        if (this.paused) return;
        for (const key of Object.keys(this.machines)) {
            this.machines[key].run();
        }
    }

    public setStart(_id: numstring, init = true, machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].setStart(_id, init);
    }

    public to(newstate: numstring, machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].to(newstate);
    }

    public pop(machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].pop();
    }

    public reset(machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].reset();
    }

    public append(_state: bss, _id: numstring, machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].append(_state, _id);
    }

    public remove(_id: numstring, machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].remove(_id);
    }
}

export abstract class BaseModel extends cbst {
    public id2object: { [key: string]: IGameObject; };
    public objects: IGameObject[];
    public paused: boolean;
    public startAfterLoad: boolean;
    public abstract get gamewidth(): number;
    public abstract get gameheight(): number;

    constructor() {
        super();
        this.objects = [];
        this.id2object = {};

        this.paused = false;

        // Create default state for running the game
        this.add(new bss('default', {
            onrun: this.defaultrun,
            start: true,
        }));
    }

    public defaultrun(_, ik: BaseModel): void {
        if (ik.paused) {
            return;
        }
        if (ik.startAfterLoad) {
            return;
        }

        let objects = ik.objects;
        // Let all game objects take a turn
        objects.forEach(o => !o.disposeFlag && o.takeTurn());

        // Remove all objects that are to be disposed
        objects.filter(o => o.disposeFlag).forEach(o => ik.exile(o));
    }

    // https://hackernoon.com/3-javascript-performance-mistakes-you-should-stop-doing-ebf84b9de951
    public where_do(predicate: (value: IGameObject, index: number, array: IGameObject[], thisArg?: any) => unknown, callbackfn: (value: IGameObject, index: number, array: IGameObject[], thisArg?: any) => void): void {
        let filteredList = this.objects.filter(predicate);
        for (let i = 0; i < filteredList.length; i++) {
            callbackfn(filteredList[i], i, filteredList, this);
        }
    }

    public clearModel(): void {
        this.objects.forEach(o => o.ondispose?.());
        this.objects.length = 0;
        delete this.id2object;
        this.id2object = {};
        this.paused = false;
    }

    public sortObjectsByPriority(): void {
        this.objects.sort((o1, o2) => (o2.z || 0) - (o1.z || 0));
    }

    public spawn(o: IGameObject, pos?: Point): void {
        this.objects.push(o);

        this.sortObjectsByPriority();

        this.id2object[o.id] = o;
        o.onspawn?.(pos);
    }

    public exile(o: IGameObject): void {
        let index = this.objects.indexOf(o);
        if (index > -1) {
            delete this.objects[index];
            this.objects.splice(index, 1);
        }

        if (this.id2object[o.id])
            this.id2object[o.id] = undefined;
        o.ondispose?.();
    }

    public exists(id: string): boolean {
        return this.id2object[id] !== undefined;
    }

    public abstract collidesWithTile(o: IGameObject, dir: Direction): boolean;
    public abstract isCollisionTile(x: number, y: number): boolean;
}

export class Game {
    lastTick: number;
    _turnCounter: number;
    animationFrameRequestid: number;
    public running: boolean;
    wasupdated: boolean;
    public rom: RomLoadResult;

    constructor(_rom: RomLoadResult, _model: BaseModel | BaseModelOld, _view: BaseView, _controller: BaseControllerOld | null, sndcontext: AudioContext, gainnode: GainNode) {
        game = this;
        this.rom = _rom;

        model = _model;
        view = _view;
        controller = _controller;

        global['model'] = model;
        global['view'] = view;
        global['controller'] = controller;

        BaseView.images = _rom.images;
        view.init();
        SM.init(_rom['sndresources'], sndcontext, gainnode);
        Input.init();

        this.running = false;
        this.wasupdated = true;
    }

    public get turnCounter(): number {
        return this._turnCounter;
    }

    public start(): void {
        window.addEventListener('resize', view.handleResize, false);
        window.addEventListener('orientationchange', view.handleResize, false);
        view.handleResize();

        this.running = true;
        this.lastTick = performance.now();
        this.run(performance.now());
    }

    public update(elapsedMs: number): void {
        BStopwatch.updateTimers(elapsedMs);
        model.run(elapsedMs);
    }

    public run(tFrame?: number): void {
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
            Input.pollGamepadInput();
            game.update(game.lastTick);
        }
        view.drawgame();
    }

    public stop(): void {
        game.running = false;
        window.cancelAnimationFrame(this.animationFrameRequestid);
        window.requestAnimationFrame(() => {
            view.clear();
            view.handleResize();
            SM.stopEffect();
            SM.stopMusic();
        });
    }
}

export interface IGameObject {
    id: string | null;
    disposeFlag: boolean;
    z?: number;
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
    markForDisposure?: () => void;
}

export abstract class Sprite extends cbst {
    public id: string | null;
    public pos: Point;
    public size: Size;
    protected _hitarea: Area;
    public get hitarea() { return this._hitarea; }
    public set hitarea(value: Area) { this._hitarea = value; }
    public get wallHitarea(): Area { return this.hitarea; }
    public visible: boolean;
    public hittable: boolean;
    public flippedH: boolean;
    public flippedV: boolean;
    public z: number;
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
        this.z = 0;
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
                newx += TileSize - mod(newx, TileSize);
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
                newy += TileSize - mod(newy, TileSize);
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
