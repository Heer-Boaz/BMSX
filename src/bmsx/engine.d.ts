import { SM } from "./soundmaster";
import { RomLoadResult } from "./rompack";
import { Point, Area, Size } from "./common";
export declare let game: Game;
export declare let model: BaseModel;
export declare let controller: BaseController;
export declare let sound: SM;
export declare let view: any;
export declare class GameOptions {
    static readonly INITIAL_SCALE: number;
    static readonly INITIAL_FULLSCREEN: boolean;
    static Scale: number;
    static Fullscreen: boolean;
    static EffectsVolumePercentage: number;
    static MusicVolumePercentage: number;
    static get WindowWidth(): number;
    static get WindowHeight(): number;
    static get BufferWidth(): number;
    static get BufferHeight(): number;
}
export declare module Constants {
    const IMAGE_PATH: string;
    const AUDIO_PATH: string;
    const SaveSlotCount: number;
    const SaveSlotCheckpoint: number;
    const SaveGamePath: string;
    const CheckpointGamePath: string;
    const OptionsPath: string;
}
export declare class Game {
    lastUpdate: number;
    turnCounter: number;
    intervalid: number;
    running: boolean;
    wasupdated: boolean;
    rom: RomLoadResult;
    constructor(_rom: RomLoadResult, viewportsize: Size);
    setModel(m: BaseModel): void;
    setController(c: BaseController): void;
    get TurnCounter(): number;
    GameOptionsChanged(): void;
    private loadGameOptions;
    start(): void;
    update(elapsedMs: number): void;
    draw(elapsedMs: number): void;
    private drawgame;
    run(): void;
    stop(): void;
}
export declare abstract class BaseController {
    protected timer: BStopwatch;
    constructor();
    takeTurn(elapsedMs: number): void;
    protected doPausedState(): void;
    protected doStartAfterLoadState(): void;
    switchState(newstate: number): void;
    switchSubstate(newsubstate: number): void;
    protected abstract disposeOldState(newState: number): void;
    protected abstract disposeOldSubstate(newsubstate: number): void;
    protected abstract initNewSubstate(newsubstate: number): void;
    protected abstract initNewState(newstate: number): void;
}
export declare abstract class BaseModel {
    id2object: Map<string, IGameObject>;
    objects: IGameObject[];
    gameState: number;
    gameSubstate: number;
    gameOldState: number;
    gameOldSubstate: number;
    paused: boolean;
    startAfterLoad: boolean;
    get OldState(): number;
    set OldState(value: number);
    get State(): number;
    set State(value: number);
    get OldSubstate(): number;
    set OldSubstate(value: number);
    get Substate(): number;
    set Substate(value: number);
    constructor();
    abstract InitModelForGameStart(): void;
    clearModel(): void;
    spawn(o: IGameObject, pos?: Point, ifnotexists?: boolean): void;
    remove(o: IGameObject): void;
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
    spawn: ((spawningPos?: Point | null) => void) | (() => void);
    dispose(): void;
    paint?(offset?: Point): void;
    postpaint?(offset?: Point): void;
    objectCollide?(o: IRenderObject): boolean;
    areaCollide?(a: Area): boolean;
    collides?(o: IRenderObject | Area): boolean;
    collide?(src: IRenderObject): void;
    oncollide?: (src: IRenderObject) => void;
}
export declare abstract class HiddenObject implements IGameObject {
    pos: Point;
    id: string;
    disposeFlag: boolean;
    extendedProperties: Map<string, any>;
    abstract takeTurn(): void;
    abstract spawn: ((spawningPos?: Point) => void) | (() => void);
    abstract dispose(): void;
    static [Symbol.hasInstance](o: any): boolean;
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
    postpaint(offset?: Point): void;
    objectCollide(o: IRenderObject): boolean;
    areaCollide(a: Area): boolean;
    collides(o: IRenderObject | Area): boolean;
    collide(src: IRenderObject): void;
    oncollide: (src: IRenderObject) => void;
}
export declare abstract class Sprite implements IRenderObject {
    id: string | null;
    pos: Point;
    size: Size;
    hitarea: Area;
    visible: boolean;
    hittable: boolean;
    flippedH: boolean;
    flippedV: boolean;
    priority: number;
    disposeFlag: boolean;
    imgid: number;
    get hitbox_sx(): number;
    get hitbox_sy(): number;
    get hitbox_ex(): number;
    get hitbox_ey(): number;
    get x_plus_width(): number;
    get y_plus_height(): number;
    disposeOnSwitchRoom?: boolean;
    oncollide: (src: IRenderObject) => void;
    constructor(initialPos?: Point, imageId?: number);
    spawn(spawningPos?: Point): void;
    abstract dispose(): void;
    abstract takeTurn(): void;
    paint(offset?: Point): void;
    postpaint(offset?: Point): void;
    static objectCollide(o1: IRenderObject, o2: IRenderObject): boolean;
    collides(o: IRenderObject | Area): boolean;
    collide(src: IRenderObject): void;
    objectCollide(o: IRenderObject): boolean;
    areaCollide(a: Area): boolean;
    inside(p: Point): boolean;
}
export declare class BStopwatch {
    pauseDuringMenu: boolean;
    pauseAtFocusLoss: boolean;
    running: boolean;
    elapsedMilliseconds: number;
    elapsedFrames: number;
    private static watchesThatHaveBeenStopped;
    private static watchesThatHaveBeenStoppedAtFocusLoss;
    static Watches: Array<BStopwatch>;
    static createWatch(): BStopwatch;
    static addWatch(watch: BStopwatch): void;
    static removeWatch(watch: BStopwatch): void;
    static updateTimers(elapsedMs: number): void;
    static pauseAllRunningWatches(pauseCausedByMenu?: boolean): void;
    static resumeAllPausedWatches(): void;
    private static pauseWatchesOnFocusLoss;
    private static resumeAllPausedWatchesOnFocus;
    constructor();
    start(): void;
    stop(): void;
    restart(): void;
    reset(): void;
    updateTime(elapsedMs: number): void;
}
export interface anidata<A extends any | null | {}> {
    delta: number;
    data: A;
}
export declare type str2bst<T extends object> = {
    [key: string]: bst<T>;
};
export declare type runhandle<T extends object> = (_state: bst<T>, ...input: any[]) => any;
export declare type bsfthandle<T extends object> = (_state: bst<T>) => void;
export declare type numstring = number | string;
export declare class bst<T extends object> {
    bsm: bst<T>;
    target: T;
    tapedata: any[];
    protected _tapehead: number;
    get tapehead(): number;
    set tapehead(v: number);
    setTapeheadNoEvent(v: number): void;
    setTapeheadNudgesNoEvent(v: number): void;
    protected _tapeheadnudges: number;
    get tapeheadnudges(): number;
    set tapeheadnudges(v: number);
    get currentdata(): any;
    delta2tapehead: number;
    protected initstateid: numstring;
    states: str2bst<T>;
    id: numstring;
    currentid: numstring;
    isfinal: boolean;
    halted: boolean;
    onrun: runhandle<T>;
    onfinalstate: bsfthandle<T>;
    ontapeend: bsfthandle<T>;
    ontapeheadmove: bsfthandle<T>;
    oninitstate: bsfthandle<T>;
    onexitstate: bsfthandle<T>;
    get endoftape(): boolean;
    get startoftape(): boolean;
    get hasstates(): boolean;
    get iscomposite(): boolean;
    get internalstate(): {
        statedata: any[];
        tapehead: number;
    };
    get current(): bst<T>;
    constructor(_target: T, _id?: numstring, _composite?: boolean, _final?: boolean);
    setStartState(_id: numstring, init?: boolean): void;
    addNewState(_id: numstring, _composite?: boolean, _final?: boolean): bst<T>;
    addState(s: bst<T>): void;
    run(...input: any[]): any;
    tapeheadmove(): void;
    tapeend(): void;
    transition(newstate: numstring): void;
    transitionSM(newstate: numstring): void;
    reset(): void;
    append(_state: bst<T>, _id: numstring): void;
    remove(_id: numstring): void;
}
//# sourceMappingURL=engine.d.ts.map