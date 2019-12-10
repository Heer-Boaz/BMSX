declare module "BoazEngineJS/statemachine" {
    export interface anidata<A extends any | null | {}> {
        delta: number;
        data: A;
    }
    export type str2bst<T extends object> = {
        [key: string]: bst<T>;
    };
    export type runhandle<T extends object> = (_state: bst<T>, ...input: any[]) => any;
    export type bsfthandle<T extends object> = (_state: bst<T>) => void;
    export type numstring = number | string;
    export class bst<T extends object> {
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
}
declare module "BoazEngineJS/msx" {
    import { Point, Color } from "../lib/interfaces";
    export const TileSize: number;
    export class Tile {
        x: number;
        y: number;
        static create(x: number, y: number): Tile;
        [Symbol.toPrimitive](hint: any): any;
        static [Symbol.toPrimitive](hint: any): any;
        get stagePoint(): {
            x: number;
            y: number;
        };
        static toStageCoord(v: number): number;
        static toStagePoint(x: number | Point, y: number): Point;
    }
    export const MSX1ScreenWidth: number;
    export const MSX1ScreenHeight: number;
    export const MSX2ScreenWidth: number;
    export const MSX2ScreenHeight: number;
    export const Msx1Colors: Color[];
    export const Msx1ExtColors: Color[];
}
declare module "BoazEngineJS/direction" {
    export const enum Direction {
        Up = 0,
        Right = 1,
        Down = 2,
        Left = 3,
        None = 4
    }
}
declare module "BoazEngineJS/model" {
    import { IGameObject, Point } from "../lib/interfaces";
    export abstract class BaseModel {
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
}
declare module "BoazEngineJS/btimer" {
    export class BStopwatch {
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
}
declare module "BoazEngineJS/controller" {
    import { BStopwatch } from "BoazEngineJS/btimer";
    export abstract class BaseController {
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
}
declare module "BoazEngineJS/constants" {
    export namespace Constants {
        const IMAGE_PATH: string;
        const AUDIO_PATH: string;
        const SaveSlotCount: number;
        const SaveSlotCheckpoint: number;
        const SaveGamePath: string;
        const CheckpointGamePath: string;
        const OptionsPath: string;
    }
}
declare module "BoazEngineJS/view" {
    import { Size, Color } from "../lib/interfaces";
    export const enum DrawImgFlags {
        None = 0,
        HFLIP = 1,
        VFLIP = 2
    }
    export class View {
        canvas: HTMLCanvasElement;
        context: CanvasRenderingContext2D;
        static images: Map<number, HTMLImageElement>;
        windowSize: Size;
        viewportSize: Size;
        dx: number;
        dy: number;
        scale: number;
        constructor(viewportsize: Size);
        init(): void;
        calculateSize(): void;
        handleResize(): void;
        DetermineMaxScaleForFullscreen(clientWidth: number, clientHeight: number, originalBufferWidth: number, originalBufferHeight: number): number;
        ToFullscreen(): void;
        static triggerFullScreenOnFakeUserEvent(): void;
        ToWindowed(): void;
        static triggerWindowedOnFakeUserEvent(): void;
        clear(): void;
        drawPressKey(): void;
        drawImg(imgid: number, x: number, y: number, options?: number): void;
        drawColoredBitmap(imgid: number, x: number, y: number, r: number, g: number, b: number, a?: number): void;
        drawRectangle(x: number, y: number, ex: number, ey: number, c: Color): void;
        fillRectangle(x: number, y: number, ex: number, ey: number, c: Color): void;
        private toRgb;
    }
}
declare module "BoazEngineJS/gameoptions" {
    export class GameOptions {
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
}
declare module "src/resourceids" {
    export const enum BitmapId {
        None = 0,
        Belmont_l1 = 1,
        Belmont_l2 = 2,
        Belmont_l3 = 3,
        Belmont_ld = 4,
        Belmont_ldead = 5,
        Belmont_lhitdown = 6,
        Belmont_lhitfly = 7,
        Belmont_lw1 = 8,
        Belmont_lw2 = 9,
        Belmont_lw3 = 10,
        Belmont_lwd1 = 11,
        Belmont_lwd2 = 12,
        Belmont_lwd3 = 13,
        Belmont_r1 = 14,
        Belmont_r2 = 15,
        Belmont_r3 = 16,
        Belmont_rd = 17,
        Belmont_rdead = 18,
        Belmont_rhitdown = 19,
        Belmont_rhitfly = 20,
        Belmont_rw1 = 21,
        Belmont_rw2 = 22,
        Belmont_rw3 = 23,
        Belmont_rwd1 = 24,
        Belmont_rwd2 = 25,
        Belmont_rwd3 = 26,
        Candle_1 = 27,
        Candle_2 = 28,
        Door = 29,
        GCandle_1 = 30,
        GCandle_2 = 31,
        Hag1 = 32,
        Hag2 = 33,
        Lightning1 = 34,
        Lightning2 = 35,
        Lightning3 = 36,
        Lightning4 = 37,
        Lightning5 = 38,
        Pietula1 = 39,
        Pietula2 = 40,
        Pietula3 = 41,
        Pietula4 = 42,
        ZakFoe1 = 43,
        ZakFoe2 = 44,
        ZakFoe3 = 45,
        Letter_0 = 46,
        Letter_1 = 47,
        Letter_2 = 48,
        Letter_3 = 49,
        Letter_4 = 50,
        Letter_5 = 51,
        Letter_6 = 52,
        Letter_7 = 53,
        Letter_8 = 54,
        Letter_9 = 55,
        Letter_A = 56,
        Letter_Apostroph = 57,
        Letter_B = 58,
        Letter_C = 59,
        Letter_Colon = 60,
        Letter_Comma = 61,
        Letter_Continue = 62,
        Letter_D = 63,
        Letter_Dot = 64,
        Letter_E = 65,
        Letter_Exclamation = 66,
        Letter_F = 67,
        Letter_G = 68,
        Letter_H = 69,
        Letter_I = 70,
        Letter_IJ = 71,
        Letter_J = 72,
        Letter_K = 73,
        Letter_L = 74,
        Letter_Line = 75,
        Letter_M = 76,
        Letter_N = 77,
        Letter_O = 78,
        Letter_P = 79,
        Letter_Percent = 80,
        Letter_Q = 81,
        Letter_Question = 82,
        Letter_R = 83,
        Letter_S = 84,
        Letter_Slash = 85,
        Letter_Space = 86,
        Letter_SpeakEnd = 87,
        Letter_SpeakStart = 88,
        Letter_Streep = 89,
        Letter_T = 90,
        Letter_U = 91,
        Letter_V = 92,
        Letter_W = 93,
        Letter_X = 94,
        Letter_Y = 95,
        Letter_Z = 96,
        deviation = 97,
        Foekill_1 = 98,
        Foekill_2 = 99,
        EnergybarStripe_Belmont = 100,
        EnergybarStripe_Boss = 101,
        HUD = 102,
        Chest = 103,
        Heart_big = 104,
        Heart_fly = 105,
        Heart_small = 106,
        Key_big = 107,
        Key_small = 108,
        MenuCursor = 109,
        Boaz = 110,
        CurtainPart = 111,
        IntroAnimation_1 = 112,
        PlayStart = 113,
        Sint = 114,
        Title = 115,
        behang = 116,
        Garden = 117,
        Garden_entrance = 118,
        Room1_d = 119,
        tiles1 = 120,
        tiles2 = 121,
        tiles3 = 122
    }
    export const enum AudioId {
        None = 0,
        Baas = 1,
        FeestVieren = 2,
        Hoera = 3,
        Humiliation = 4,
        OHNOES = 5,
        Prologue = 6,
        VampireKiller = 7,
        Au = 8,
        Bliksem = 9,
        Chestopen = 10,
        Cross = 11,
        Door = 12,
        Fout = 13,
        Heart = 14,
        Hit = 15,
        Init = 16,
        Item = 17,
        Kaboem = 18,
        Key = 19,
        Knife = 20,
        Land = 21,
        Portal = 22,
        Rotate = 23,
        Selectie = 24,
        WallBreak = 25,
        Whip = 26
    }
}
declare module "BoazEngineJS/soundmaster" {
    import { AudioId } from "src/resourceids";
    import { id2res, AudioMeta } from "../lib/rompack";
    export class SM {
        private static limitToOneEffect;
        private static tracks;
        private static sndContext;
        private static currentMusicNode;
        private static currentEffectNode;
        static currentEffectAudio: AudioMeta;
        static currentMusicAudio: AudioMeta;
        private static gainNode;
        static init(_audioResources: id2res): void;
        private static createNode;
        private static playNode;
        static play(id: AudioId): void;
        private static stop;
        static stopEffect(): void;
        static stopMusic(): void;
        static resumeEffect(): void;
        static resumeMusic(): void;
        static setEffectsVolume(volume: number): void;
        static setMusicVolume(volume: number): void;
    }
}
declare module "BoazEngineJS/common" {
    import { BStopwatch } from "BoazEngineJS/btimer";
    import { Direction } from "BoazEngineJS/direction";
    import { Point, Area, Size } from "../lib/interfaces";
    export function moveArea(a: Area, p: Point): Area;
    export function addPoints(a: Point, b: Point): Point;
    export function randomInt(min: number, max: number): number;
    export function newPoint(x: number, y: number): Point;
    export function copyPoint(toCopy: Point): Point;
    export function newArea(sx: number, sy: number, ex: number, ey: number): Area;
    export function newSize(x: number, y: number): Size;
    export function setPoint(p: Point, new_x: number, new_y: number): void;
    export function setSize(s: Size, new_x: number, new_y: number): void;
    export function area2size(a: Area): Point;
    export function waitDuration(timer: BStopwatch, duration: number): boolean;
    export function addToScreen(element: HTMLElement): void;
    export function removeFromScreen(element: HTMLElement): void;
    export function createDivSprite(img?: HTMLImageElement, imgsrc?: string | null, classnames?: string[] | null): HTMLDivElement;
    export function GetDeltaFromSourceToTarget(source: Point, target: Point): Point;
    export function LineLength(p1: Point, p2: Point): number;
    export function storageAvailable(type: string): boolean;
    export function localStorageAvailable(): boolean;
    export function sessionStorageAvailable(): boolean;
    export function LookAt(subjectpos: Point, targetpos: Point): Direction;
    export function Opposite(dir: Direction): Direction;
}
declare module "BoazEngineJS/input" {
    import { Point } from "../lib/interfaces";
    export class Input {
        static KeyState: {};
        static KeyClickRequestedState: {};
        private static getClickState;
        private static getKeyState;
        static get KC_DOWN(): boolean;
        static get KC_F1(): boolean;
        static get KC_F12(): boolean;
        static get KC_F2(): boolean;
        static get KC_F3(): boolean;
        static get KC_F4(): boolean;
        static get KC_F5(): boolean;
        static get KC_LEFT(): boolean;
        static get KC_M(): boolean;
        static get KC_RIGHT(): boolean;
        static get KC_SPACE(): boolean;
        static get KC_UP(): boolean;
        static get KD_DOWN(): boolean;
        static get KD_F1(): boolean;
        static get KD_F12(): boolean;
        static get KD_F2(): boolean;
        static get KD_F3(): boolean;
        static get KD_F4(): boolean;
        static get KD_F5(): boolean;
        static get KD_LEFT(): boolean;
        static get KD_M(): boolean;
        static get KD_RIGHT(): boolean;
        static get KD_SPACE(): boolean;
        static get KD_UP(): boolean;
        static init(): void;
        static reset(): void;
    }
    export function getMousePos(evt: MouseEvent): Point;
}
declare module "BoazEngineJS/engine" {
    import { BaseModel } from "BoazEngineJS/model";
    import { BaseController } from "BoazEngineJS/controller";
    import { View } from "BoazEngineJS/view";
    import { SM } from "BoazEngineJS/soundmaster";
    import { IGameView, Size } from "../lib/interfaces";
    import { RomLoadResult } from '../lib/rompack';
    export let game: Game;
    export let model: BaseModel;
    export let controller: BaseController;
    export let sound: SM;
    export let view: View;
    export let gameview: IGameView;
    export class Game {
        lastUpdate: number;
        turnCounter: number;
        intervalid: number;
        running: boolean;
        wasupdated: boolean;
        rom: RomLoadResult;
        constructor(_rom: RomLoadResult, viewportsize: Size);
        setModel(m: BaseModel): void;
        setController(c: BaseController): void;
        setGameView(v: IGameView): void;
        get TurnCounter(): number;
        GameOptionsChanged(): void;
        private loadGameOptions;
        start(): void;
        update(elapsedMs: number): void;
        draw(elapsedMs: number): void;
        run(): void;
        stop(): void;
    }
}
declare module "BoazEngineJS/sprite" {
    import { IRenderObject, Point, Size, Area } from "../lib/interfaces";
    export abstract class Sprite implements IRenderObject {
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
}
declare module "src/creature" {
    import { Sprite } from "BoazEngineJS/sprite";
    import { Direction } from "BoazEngineJS/direction";
    import { Area, Point } from "../lib/interfaces";
    export abstract class Creature extends Sprite {
        get wallhitbox_sx(): number;
        get wallhitbox_sy(): number;
        get wallhitbox_ex(): number;
        get wallhitbox_ey(): number;
        get wallHitArea(): Area;
        set wallHitArea(value: Area);
        private _direction;
        get direction(): Direction;
        set direction(value: Direction);
        oldDirection: Direction;
        constructor(p: Point);
        paint(offset?: Point): void;
        protected originPos: Point;
        customId: string;
        get id(): string;
        set id(value: string);
        protected checkWallSpriteCollisions(): boolean;
        protected checkWallCollision(): boolean;
        protected handleWallCollision(): void;
    }
}
declare module "src/projectile" {
    import { Sprite } from "BoazEngineJS/sprite";
    import { Direction } from "BoazEngineJS/direction";
    import { Point } from "../lib/interfaces";
    export abstract class Projectile extends Sprite {
        direction: Direction;
        protected speed: Point;
        disposeOnSwitchRoom: any;
        constructor(pos: Point, speed: Point);
        paint(offset?: Point): void;
        damageDealt: number;
        protected checkWallSpriteCollisions(): boolean;
        protected checkWallCollision(): boolean;
        dispose(): void;
    }
}
declare module "src/pprojectile" {
    import { Foe } from "src/foe";
    import { Projectile } from "src/projectile";
    import { Point } from "../lib/interfaces";
    export abstract class PlayerProjectile extends Projectile {
        protected foesThatWereHit: Foe[];
        constructor(fpos: Point, speed: Point);
        checkAndInvokeHit(): boolean;
    }
}
declare module "src/gameview" {
    import { IGameView } from "../lib/interfaces";
    export class GameView implements IGameView {
        private static _instance;
        static get _(): GameView;
        constructor();
        drawGame(elapsedMs: number): void;
    }
}
declare module "src/bootstrapper" {
    import { Chapter } from "src/gamemodel";
    import { RomLoadResult } from "../lib/rompack";
    export class Bootstrapper {
        static h406A(rom: RomLoadResult): void;
        static BootstrapGame(chapter: Chapter): void;
        private static bootstrapGameForGameStart;
        private static bootstrapGameForDebug;
    }
}
declare module "BoazEngineJS/savegame" {
    import { AudioId } from "src/resourceids";
    import { BStopwatch } from "BoazEngineJS/btimer";
    export class Savegame {
        Model: any;
        Timestamp: Date;
        Slot: number;
        RegisteredWatches: BStopwatch[];
        MusicBeingPlayed: AudioId;
    }
}
declare module "src/weaponitem" {
    import { Sprite } from "BoazEngineJS/sprite";
    import { SecWeaponType, BagWeapon } from "src/gamemodel";
    import { BitmapId } from "src/resourceids";
    import { Area, Point } from "../lib/interfaces";
    export class WeaponItem extends Sprite {
        static ItemHitArea: Area;
        ItsType: WeaponType;
        static Descriptions: Map<WeaponType, string[]>;
        static WeaponItem2SecWeaponType(weaponItem: BagWeapon): SecWeaponType;
        static SecWeaponType2WeaponItemType(secWeapontype: SecWeaponType): WeaponType;
        constructor(type: WeaponType, pos: Point);
        takeTurn(): void;
        static Type2Image(type: WeaponType): BitmapId;
        dispose(): void;
    }
    export const enum WeaponType {
        None = -1,
        Cross = 0
    }
}
declare module "BoazEngineJS/animation" {
    import { BStopwatch } from "BoazEngineJS/btimer";
    export interface AniData<T extends any | null | {}> {
        time: number;
        data: T;
    }
    export interface AniStepReturnValue<T> {
        stepValue: T;
        next: boolean;
    }
    export class Animation<T extends any | null | undefined | {}> {
        animationDataAndTime: Array<AniData<T>>;
        stepCounter: number;
        constantStepTime?: number;
        protected currentStepTime: number;
        repeat: boolean;
        constructor(dataAndOrTime: Array<AniData<T>> | Array<T>, timesOrConstantStepTime?: number | number[], repeat?: boolean);
        get stepValue(): T;
        get stepTime(): number;
        get hasNext(): boolean;
        get finished(): boolean;
        doNextStep(): T | null;
        doAnimation(timerOrStepValue: BStopwatch | number, nextStepRef?: T): AniStepReturnValue<T>;
        doAnimationTimer(timer: BStopwatch, nextStepRef?: T): AniStepReturnValue<T>;
        doAnimationStep(step: number, nextStepRef?: T): AniStepReturnValue<T>;
        waitForNextStep(timer: BStopwatch): boolean;
        restart(): void;
    }
}
declare module "src/belmont" {
    import { Direction } from "BoazEngineJS/direction";
    import { Creature } from "src/creature";
    import { BStopwatch } from "BoazEngineJS/btimer";
    import { Animation } from "BoazEngineJS/animation";
    import { BitmapId } from "src/resourceids";
    import { Area, Point } from "../lib/interfaces";
    export class RoeState {
        static framesPerDrawing: number[];
        aniTimer: BStopwatch;
        static RoeSprites: Map<Direction, BitmapId[]>;
        static RoeSpritesCrouching: Map<Direction, BitmapId[]>;
        static RoeSpritePosOffset: Map<Direction, Point[]>;
        static RoeSpritePosOffsetCrouching: Map<Direction, Point[]>;
        Roeing: boolean;
        CurrentFrame: number;
        Start(): void;
        Stop(): void;
        constructor();
    }
    export class Belmont extends Creature {
        Health: number;
        MaxHealth: number;
        get HealthPercentage(): number;
        private static MoveBeforeFrameChange;
        Crouching: boolean;
        CarryingShield: boolean;
        get RecoveringFromHit(): boolean;
        private firstPressedButton;
        private get movementSpeed();
        protected moveLeftBeforeFrameChange: number;
        protected currentWalkAnimationFrame: number;
        private state;
        get Blink(): boolean;
        get Dying(): boolean;
        get Roeing(): boolean;
        get Jumping(): boolean;
        private hitState;
        private dyingState;
        roeState: RoeState;
        private jumpState;
        private static MovementSpritesNoShield;
        private static MovementSpritesNoShieldCrouching;
        private static MovementSpritesWShieldCrouching;
        private static MovementSpritesHit;
        private static MovementSpritesWShield;
        protected get moveBeforeFrameChange(): number;
        protected get movementSprites(): Map<Direction, BitmapId[]>;
        get wallHitArea(): Area;
        set wallHitArea(value: Area);
        EventTouchHitArea: Area;
        private static buttonPressEventHitAreaUp;
        private static buttonPressEventHitAreaRight;
        private static buttonPressEventHitAreaDown;
        private static buttonPressEventHitAreaLeft;
        get EventButtonHitArea(): Area;
        get RoomCollisionArea(): Area;
        private _hitarea;
        get hitarea(): Area;
        set hitarea(value: Area);
        get Vulnerable(): boolean;
        setx(newx: number): void;
        sety(newy: number): void;
        constructor(initPos?: Point);
        ResetToDefaultFrame(): void;
        GetProjectileOrigin(): Point;
        takeTurn(): void;
        protected doHitFlying(): void;
        protected doHitFall(): void;
        protected doHitCrouching(): void;
        protected doJump(): void;
        doWalk(): void;
        protected animateMovement(movedDistance: number): void;
        determineFrame(): void;
        TakeDamage(amount: number): void;
        private doDeath;
        UseRoe(): void;
        private initHitRecoveryState;
        private initDyingState;
        private initRoeState;
        private handleInput;
        private doMovement;
        private checkAndHandleWallAndCeilingCollisions;
        private checkAndHandleFloorCollisions;
        private checkAndHandleCollisions;
        private checkAndHandleRoomExit;
        protected checkWallCollision(): boolean;
        protected handleWallCollision(): void;
        protected get CeilingCollision(): boolean;
        protected get FloorCollision(): boolean;
        protected handleFloorCollision(): void;
        protected handleCeilingCollision(): void;
        private nearRoomExit;
        private ignoreDirButtonPress;
        private multipleDirButtonsPressed;
        paint(offset?: Point): void;
        dispose(): void;
    }
    export const enum State {
        Normal = 0,
        HitRecovery = 1,
        Dying = 2,
        Dead = 3
    }
    export class JumpState {
        JumpTimer: BStopwatch;
        Jumping: boolean;
        GoingUp: boolean;
        JumpDirection: Direction;
        static jumpYDelta: number[];
        JumpAni: Animation<number>;
        get JumpHeightReached(): boolean;
        constructor();
        Stop(): void;
        GoingDownAfterAnimation(): void;
        Start(jumpDir: Direction): void;
    }
    export class HitState {
        static TotalBlinkTime: number;
        static BlinkTimePerSwitch: number;
        static CrouchTime: number;
        BlinkTimer: BStopwatch;
        RecoveryTimer: BStopwatch;
        CrouchTimer: BStopwatch;
        Blink: boolean;
        BlinkingAndInvulnerable: boolean;
        CurrentStep: HitStateStep;
        static hitDelta: Point[];
        HitAni: Animation<Point>;
        constructor();
        Stop(): void;
        Start(): void;
    }
    export const enum HitStateStep {
        None = 0,
        Flying = 1,
        Falling = 2,
        Crouching = 3
    }
    export interface BitmapAndDir {
        image: BitmapId;
        dir: Direction;
    }
    export class DyingState {
        DeathAni: Animation<BitmapAndDir>;
        static framesPerDrawing: number;
        protected static dyingFrames: BitmapAndDir[];
        protected static dyingFrameTimes: number[];
        aniTimer: BStopwatch;
        Start(): void;
        Stop(): void;
        constructor();
    }
}
declare module "src/triroe" {
    import { PlayerProjectile } from "src/pprojectile";
    import { Direction } from "BoazEngineJS/direction";
    import { Area, Point } from "../lib/interfaces";
    export class TriRoe extends PlayerProjectile {
        private static hitareas;
        get hitarea(): Area;
        set hitarea(value: Area);
        get damageDealt(): number;
        constructor(pos: Point, dir: Direction);
        takeTurn(): void;
        paint(offset?: Point): void;
        dispose(): void;
    }
}
declare module "src/cross" {
    import { PlayerProjectile } from "src/pprojectile";
    import { Direction } from "BoazEngineJS/direction";
    import { Area, Point } from "../lib/interfaces";
    export class Cross extends PlayerProjectile {
        direction: Direction;
        hitarea: Area;
        get damageDealt(): number;
        constructor(pos: Point, dir: Direction);
        takeTurn(): void;
        paint(offset?: Point): void;
        dispose(): void;
    }
}
declare module "src/weaponfirehandler" {
    export class WeaponFireHandler {
        private static msCrossCooldown;
        private static msTriRoeCooldown;
        private static _mainWeaponCurrentCooldown;
        private static get mainWeaponCurrentCooldown();
        private static set mainWeaponCurrentCooldown(value);
        static get MainWeaponOnCooldown(): boolean;
        private static _secWeaponCurrentCooldown;
        private static get secWeaponCurrentCooldown();
        private static set secWeaponCurrentCooldown(value);
        static get SecWeaponOnCooldown(): boolean;
        static HandleFireMainWeapon(): void;
        private static setMainWeaponCooldown;
        private static setSecWeaponCooldown;
        private static handleTriRoe;
        private static handleFireCross;
        static HandleFireSecondaryWeapon(): void;
    }
}
declare module "src/textwriter" {
    import { Point, Color } from "../lib/interfaces";
    export enum TextWriterType {
        Billboard = 0,
        Story = 1
    }
    export class TextWriter {
        static FontWidth: number;
        static FontHeight: number;
        Type: TextWriterType;
        Pos: Point;
        End: Point;
        Text: string[];
        visible: boolean;
        constructor(pos: Point, end: Point, type: TextWriterType);
        setText(text: string): void;
        addText(text: string | string[]): void;
        takeTurn(): void;
        static drawText(x: number, y: number, textToWrite: string | string[], color?: Color): void;
        private static drawLetter;
        paint(): void;
        private static getBitmapForLetter;
    }
}
declare module "BoazEngineJS/gamesaver" {
    import { Model } from "src/gamemodel";
    import { Savegame } from "BoazEngineJS/savegame";
    export namespace GameSaver {
        function saveGame(m: Model, slot: number): void;
        function GetCheckpoint(m: Model): Savegame;
    }
}
declare module "BoazEngineJS/gamestateloader" {
    import { Model } from "src/gamemodel";
    import { Savegame } from "BoazEngineJS/savegame";
    export function LoadGame(slot: number): Savegame;
    export function SlotExists(slot: number): boolean;
    export function GetCheckpoint(m: Model): Savegame;
    export function GetSavepath(slot: number): string;
}
declare module "src/mainmenu" {
    export const enum State {
        SelectMain = 0,
        SubMenu = 1,
        SelectChapter = 2
    }
    export const enum MenuItem {
        NewGame = 0,
        Continue = 1,
        LoadGame = 2,
        Options = 3,
        ToMainMenu = 4,
        Prologue = 5,
        Chapter0 = 6,
        Chapter1 = 7,
        Debug = 8
    }
    export class MainMenu {
        private selectedIndex;
        private state;
        private static items;
        private static menuOptions;
        private static chapterItems;
        private static chapterOptions;
        private static itemYs;
        private static itemsX;
        private static cursorPosX;
        private static boxX;
        private static boxY;
        private static boxEndX;
        private static boxEndY;
        private get cursorX();
        private get cursorY();
        private get selectedItem();
        constructor();
        Init(): void;
        private reset;
        HandleInput(): void;
        private changeSelection;
        TakeTurn(): void;
        Paint(): void;
        GameMenuClosed(): void;
    }
}
declare module "src/gamemenu" {
    import { MenuItem } from "src/mainmenu";
    module "src/mainmenu" {
        const enum MenuItem {
            Dummy = -1,
            SaveGame = 0,
            SaveSlot = 1,
            ChangeOptions = 2,
            ReturnToGame = 3,
            ReturnToMain = 4,
            Scale = 5,
            Fullscreen = 6,
            MusicVolume = 7,
            EffectVolume = 8,
            ExitGame = 9,
            Main = 10,
            Load = 11,
            Save = 12,
            LoadFromGameOver = 13,
            LoadFromMainMenu = 14,
            OptionsFromMainMenu = 15
        }
    }
    export class GameMenu {
        private static menuPosX;
        private static menuPosY;
        private static menuEndX;
        private static menuEndY;
        private static cursorVerticalSkipPerEntry;
        private static mainItemsOffsetX;
        private static loadsaveItemOffsetX;
        private static optionItemsOffsetX;
        private static itemOffsetY;
        private static itemVerticalSkipPerEntry;
        private static menuText;
        private static loadMenuText;
        private static saveMenuText;
        private static optionMenuText;
        private static backText;
        private static emptySlot;
        private static scaleText;
        private static effectVolumeText;
        private static musicVolumeText;
        private static mainMenuTextX;
        private static mainMenuTextY;
        private static cursorOffsetX;
        private static cursorOffsetY;
        private static mainItems;
        private static optionsItems;
        private static fullscreenOptionsOffsets;
        private static fullscreenOptionsOffsetY;
        private static fullscreenOptionsRectangleSize;
        visible: boolean;
        private cursorPos;
        private selectedItemIndex;
        private CurrentScreen;
        constructor();
        Open(currentscreen?: MenuItem): void;
        Close(): void;
        TakeTurn(): void;
        HandleInput(): void;
        private calculateCursorX;
        private calculateCursorY;
        private changeSelection;
        private get selectedItem();
        Paint(): void;
        private printFullscreenOptionRectangle;
        private printSaveSlot;
    }
}
declare module "src/bossfoe" {
    import { Foe } from "src/foe";
    import { Point } from "../lib/interfaces";
    export class BossFoe extends Foe {
        constructor(pos: Point);
    }
}
declare module "src/fprojectile" {
    import { Projectile } from "src/projectile";
    import { Point } from "../lib/interfaces";
    export class FProjectile extends Projectile {
        get canHurtPlayer(): boolean;
        constructor(pos: Point, speed: Point);
        takeTurn(): void;
    }
}
declare module "src/fx" {
    import { Sprite } from "BoazEngineJS/sprite";
    import { BStopwatch } from "BoazEngineJS/btimer";
    import { Animation } from "BoazEngineJS/animation";
    import { Point } from "../lib/interfaces";
    export class FX extends Sprite {
        protected animation: Animation<number>;
        protected timer: BStopwatch;
        constructor(pos: Point);
        protected init(): void;
        takeTurn(): void;
        protected doAnimation(): void;
        dispose(): void;
    }
}
declare module "src/heartsmall" {
    import { Sprite } from "BoazEngineJS/sprite";
    import { Animation } from "BoazEngineJS/animation";
    import { Area, Point } from "../lib/interfaces";
    export const enum HeartSmallState {
        Flying = 0,
        Standing = 1
    }
    export class HeartSmall extends Sprite {
        State: HeartSmallState;
        protected static HitAreaFly: Area;
        protected static HitAreaStand: Area;
        get hitarea(): Area;
        set hitarea(value: Area);
        protected animation: Animation<number>;
        protected animationData: number[];
        constructor(pos: Point);
        protected get floorCollision(): boolean;
        protected uglyBitThing: boolean;
        takeTurn(): void;
        paint(offset?: Point): void;
        dispose(): void;
    }
}
declare module "src/foeexplosion" {
    import { ItemType } from "src/item";
    import { AniData } from "BoazEngineJS/animation";
    import { FX } from "src/fx";
    import { BitmapId } from "src/resourceids";
    import { Point } from "../lib/interfaces";
    export class FoeExplosion extends FX {
        protected static AnimationFrames: AniData<BitmapId>[];
        protected frameIndex: number;
        protected itemSpawnedAfterKill: ItemType;
        constructor(pos: Point, itemSpawned?: ItemType);
        takeTurn(): void;
    }
}
declare module "src/pietula" {
    import { BossFoe } from "src/bossfoe";
    import { PlayerProjectile } from "src/pprojectile";
    import { Area, Point } from "../lib/interfaces";
    import { bst } from "BoazEngineJS/statemachine";
    export class Pietula extends BossFoe {
        get damageToPlayer(): number;
        get respawnOnRoomEntry(): boolean;
        protected static HitArea: Area;
        fst: bst<Pietula>;
        hover: bst<Pietula>;
        blink: bst<Pietula>;
        loops: number;
        bliksem: {
            imgid: number;
            paint(offset: Point): void;
            pos: Point;
            flipped: boolean;
        };
        constructor(pos?: Point);
        takeTurn(): void;
        dispose(): void;
        handleHit(source: PlayerProjectile): void;
        paint(offset?: Point): void;
        die(): void;
    }
}
declare module "src/gamecontroller" {
    import { Item, ItemType } from "src/item";
    import { Direction } from "BoazEngineJS/direction";
    import { Savegame } from "BoazEngineJS/savegame";
    import { WeaponItem } from "src/weaponitem";
    import { GameState, GameSubstate } from "src/gamemodel";
    import { BaseController } from "BoazEngineJS/controller";
    import { Pietula } from "src/pietula";
    export class Controller extends BaseController {
        private static _instance;
        static get _(): Controller;
        InEventState: boolean;
        private startAfterLoadTimer;
        ElapsedMsDelta: number;
        constructor();
        disposeOldState(newState: GameState): void;
        protected disposeOldSubstate(newsubstate: GameSubstate): void;
        SwitchToOldState(): void;
        SwitchToOldSubstate(): void;
        protected initNewState(newState: GameState): void;
        protected initNewSubstate(newsubstate: GameSubstate): void;
        switchSubstate(newSubstate: GameSubstate): void;
        takeTurn(elapsedMs: number): void;
        private handleInputDuringGame;
        private handleInputDuringPause;
        private handleInputDuringGameMenu;
        KillFocus(): void;
        SetFocus(): void;
        private handlePausedState;
        private handleStartAfterLoadState;
        BelmontDied(): void;
        BelmontDeathAniFinished(): void;
        ItsCurtainsAniFinished(): void;
        BossDefeated(): void;
        HandleRoomExitViaMovement(targetRoom: number, dir: Direction): void;
        DoRoomExit(targetRoom: number): void;
        private setupGameStart;
        PauseGame(): void;
        UnpauseGame(): void;
        OpenGameMenu(): void;
        CloseGameMenu(): void;
        LoadGame(sg: Savegame): void;
        SaveGame(slot: number): void;
        StoreCheckpoint(): void;
        LoadCheckpoint(): void;
        PickupItem(source: Item): void;
        UseItem(itemType: ItemType): void;
        private HandleUseItem;
        PickupWeaponItem(source: WeaponItem): void;
        startBossFight(baas: Pietula): void;
    }
}
declare module "src/item" {
    import { Sprite } from "BoazEngineJS/sprite";
    import { BitmapId } from "src/resourceids";
    import { Area, Point } from "../lib/interfaces";
    export const enum ItemType {
        None = 0,
        HeartSmall = 1,
        HeartBig = 2,
        KeySmall = 3,
        KeyBig = 4
    }
    export const enum Usable {
        No = 0,
        Yes = 1,
        Infinite = 2
    }
    export class Item extends Sprite {
        ItsType: ItemType;
        static ItemHitArea: Area;
        static Usable: any;
        static Type: any;
        constructor(type: ItemType, pos: Point);
        takeTurn(): void;
        static Type2Image(type: ItemType): BitmapId;
        static ItemUsable(type: ItemType): Usable;
        dispose(): void;
    }
}
declare module "src/foe" {
    import { Creature } from "src/creature";
    import { PlayerProjectile } from "src/pprojectile";
    import { ItemType } from "src/item";
    import { Point } from "../lib/interfaces";
    export abstract class Foe extends Creature {
        maxHealth: number;
        health: number;
        get healthPercentage(): number;
        constructor(pos: Point);
        get respawnOnRoomEntry(): boolean;
        canHurtPlayer: boolean;
        damageToPlayer: number;
        get isAfoot(): boolean;
        protected itemSpawnedAfterKill: ItemType;
        takeTurn(): void;
        handleHit(source: PlayerProjectile): void;
        protected loseHealth(source: PlayerProjectile): void;
        protected handleDie(): void;
        die(): void;
        protected dieWithoutItem(): void;
        protected dieWithItem(itemToSpawn?: ItemType): void;
        dispose(): void;
    }
}
declare module "src/hud" {
    import { Foe } from "src/foe";
    import { Point } from "../lib/interfaces";
    export class HUD {
        static Pos_X: number;
        static Pos_Y: number;
        private barTimer;
        private foebarTimer;
        protected static MsDurationBarChange: number;
        protected static MsDurationFoeBarChange: number;
        protected static HealthBarPosX: number;
        protected static HealthBarPosY: number;
        protected static HeartsPosX: number;
        protected static HeartsPosY: number;
        protected static WeaponPosX: number;
        protected static WeaponPosY: number;
        protected static AmmoPosX: number;
        protected static AmmoPosY: number;
        protected static ItemPosX: number;
        protected static ItemPosY: number;
        protected static readonly KeyPos: Point;
        protected static FoeBarStripePosX: number;
        protected static FoeBarStripePosY: number;
        protected static HealthBarSizeX: number;
        protected shownHealthLevel: number;
        protected shownWeaponLevel: number;
        protected shownFoeHealthLevel: number;
        protected foeForWhichHealthLevelIsShown: Foe;
        constructor();
        SetShownLevelsToProperValues(): void;
        TakeTurn(): void;
        private percentageToBarLength;
        Paint(): void;
    }
}
declare module "src/itscurtainsforyou" {
    export class ItsCurtainsForYou {
        private curtainPartCount;
        private timer;
        private msCurtainPartWait;
        private maxCurtainParts;
        Init(): void;
        Stop(): void;
        TakeTurn(): void;
        Paint(): void;
    }
}
declare module "src/gameover" {
    export const enum State {
        SelectContOrLoad = 0,
        SelectFile = 1
    }
    export class GameOver {
        private selectedIndex;
        private state;
        private static items;
        private static itemYs;
        private static itemsX;
        private static cursorPosX;
        private static boxX;
        private static boxY;
        private static boxEndX;
        private static boxEndY;
        private get cursorX();
        private get cursorY();
        constructor();
        Init(): void;
        private reset;
        HandleInput(): void;
        private changeSelection;
        TakeTurn(): void;
        Paint(): void;
        GameMenuClosed(): void;
    }
}
declare module "src/title" {
    export enum State {
        WaitForIt = 0,
        Konami = 1,
        TitleTop = 2,
        TitleBottom = 3,
        WaitForItAgain = 4,
        Other = 5
    }
    export class Title {
        private static titleTopY;
        private static titleBottomY;
        private static titleTopStartX;
        private static titleBottomStartX;
        private static titleTopEndX;
        private static titleBottomEndX;
        private static deltaX;
        private static waitFrames;
        private static waitKonamiFrames;
        private static konamiX;
        private static konamiY;
        private titleTopPos;
        private titleBottomPos;
        private static titleStates;
        private static titleMoves;
        private titleAni;
        private state;
        constructor();
        Init(): void;
        private reset;
        TakeTurn(): void;
        Paint(): void;
    }
}
declare module "src/enddemo" {
    export class EndDemo {
        constructor();
        Init(): void;
        private reset;
        TakeTurn(): void;
        Paint(): void;
    }
}
declare module "src/gamemodel" {
    import { Foe } from "src/foe";
    import { Belmont } from "src/belmont";
    import { Savegame } from "BoazEngineJS/savegame";
    import { BaseModel } from "BoazEngineJS/model";
    import { BStopwatch } from "BoazEngineJS/btimer";
    import { BossFoe } from "src/bossfoe";
    import { WeaponType } from "src/weaponitem";
    import { ItemType } from "src/item";
    import { GameMenu } from "src/gamemenu";
    import { Point, IGameObject } from "../lib/interfaces";
    import { Room } from "src/room";
    import { HUD } from "src/hud";
    import { ItsCurtainsForYou } from "src/itscurtainsforyou";
    import { GameOver } from "src/gameover";
    import { MainMenu } from "src/mainmenu";
    import { Title } from "src/title";
    import { EndDemo } from "src/enddemo";
    export const enum GameState {
        None = 0,
        Editor = 1,
        TitleScreen = 2,
        Tutorial = 3,
        GameStart1 = 4,
        GameStart2 = 5,
        GameStartFromGameOver = 6,
        Game = 7,
        Event = 8,
        F1 = 9,
        EndDemo = 10,
        GameOver = 11,
        LoadTheGame = 12
    }
    export const enum GameSubstate {
        Default = 0,
        Conversation = 1,
        BelmontDies = 2,
        ItsCurtainsForYou = 3,
        ToEndDemo = 4,
        GameOver = 5,
        IngameMenu = 6,
        GameMenu = 7,
        SwitchRoom = 8
    }
    export const enum Chapter {
        Debug = 0,
        Prologue = 1,
        Chapter_0 = 2,
        GameStart = 3
    }
    export class BagItem {
        Type: ItemType;
        Amount: number;
    }
    export class BagWeapon {
        Type: WeaponType;
    }
    export class Location {
        RoomID: number;
        Pos: Point;
    }
    export enum Switch {
        None = 0,
        Dummy = 1,
        GameStart = 2,
        Room1Aanloop = 3,
        Room1GebouwUitleg = 4,
        VijandenUitRaam = 5,
        SchuurSleutelGevonden = 6,
        PraatOverTroep = 7,
        NaarEindbaas = 8,
        WaterEnBroodGevonden = 9,
        WaterEnBroodGegeven = 10,
        VillaSleutelGevonden = 11,
        Ch0_Chapter0Intro = 12,
        Ch0_LigpietOnderzocht = 13,
        Ch0_SpeelgoedOntdekt = 14,
        Ch0_KruidnootschieterGevonden = 15,
        Ch0_SleutelGevonden = 16,
        Ch0_SpeelgoedOntdekt2 = 17,
        Ch0_BossIntro = 18,
        Ch0_LangVerhaal = 19
    }
    export const enum CombatType {
        Encounter = 0,
        Boss = 1
    }
    export const enum MainWeaponType {
        None = 0,
        TriRoe = 1
    }
    export const enum SecWeaponType {
        None = 0,
        Cross = 1
    }
    export class Model extends BaseModel {
        Checkpoint: Savegame;
        SelectedChapterToPlay: Chapter;
        static PROPERTY_KEEP_AT_ROOMSWITCH: string;
        static PROPERTY_ACT_AS_WALL: string;
        private static _instance;
        static get _(): Model;
        static set _(value: Model);
        Foes: Foe[];
        ItemsInInventory: BagItem[];
        WeaponsInInventory: BagWeapon[];
        protected _hearts: number;
        get Hearts(): number;
        set Hearts(value: number);
        Belmont: Belmont;
        Boss: BossFoe;
        currentRoom: Room;
        GameMenu: GameMenu;
        Switches: Map<Switch, boolean>;
        EventTriggered: Map<number, boolean>;
        EventFinished: Map<number, boolean>;
        FoesDefeated: Map<string, boolean>;
        ItemsPickedUp: Map<string, boolean>;
        WeaponItemsPickedUp: Map<string, boolean>;
        DoorsOpened: Map<string, boolean>;
        BossBattle: boolean;
        RoomExitsLocked: boolean;
        MainWeaponCooldownTimer: BStopwatch;
        SecWeaponCooldownTimer: BStopwatch;
        Hud: HUD;
        ItsCurtains: ItsCurtainsForYou;
        GameOverScreen: GameOver;
        MainMenu: MainMenu;
        Title: Title;
        EndDemo: EndDemo;
        PauseObject: IGameObject;
        get ShowFoeBar(): boolean;
        get FoeHealthPercentage(): number;
        get FoeForWhichHealthPercentageIsGiven(): Foe;
        private _selectedMainWeapon;
        get SelectedMainWeapon(): MainWeaponType;
        private _selectedSecondaryWeapon;
        get SelectedSecondaryWeapon(): SecWeaponType;
        set SelectedSecondaryWeapon(value: SecWeaponType);
        get SelectedSecBagWeapon(): BagWeapon;
        private _lastFoeThatWasHit;
        get LastFoeThatWasHit(): Foe;
        set LastFoeThatWasHit(value: Foe);
        private _selectedItem;
        get SelectedItem(): BagItem;
        set SelectedItem(value: BagItem);
        constructor();
        Initialize(): void;
        InitModelForGameStart(): void;
        InitAfterGameLoad(): void;
        spawn(o: IGameObject, spawnpos?: Point, ifnotexists?: boolean): void;
        remove(o: IGameObject): void;
        FoeDefeated(f: Foe): void;
        GetFoeDefeated(id: string): boolean;
        get FoesPresentInCurrentRoom(): boolean;
        GetSwitchState(s: Switch): boolean;
        GetItemPickedUp(id: string): boolean;
        DoorOpened(id: string): boolean;
        AddItemToInventory(itemType: ItemType): void;
        AddWeaponToInventory(itemType: WeaponType): void;
        RemoveItemFromInventory(itemType: ItemType, removeAll?: boolean): void;
        LoadRoom(id: number): void;
    }
}
declare module "src/gameconstants" {
    import { GameState, GameSubstate } from "src/gamemodel";
    export namespace GameConstants {
        const INITIAL_GAMESTATE: GameState;
        const INITIAL_GAMESUBSTATE: GameSubstate;
        const SoundEnabled: boolean;
        const InitialFullscreen: boolean;
        const InitialScale: number;
        const PauseGameOnKillFocus: boolean;
        const AnimateFoeHealthLevel: boolean;
        const EnemiesAfootAsProperty: boolean;
        const Belmont_MaxHealth_AtStart: number;
        const Belmont_MaxHealth_Increase: number;
        const Belmont_InitHearts: number;
        const Belmont_MaxHearts: number;
        const CheckpointAtRoomEntry: boolean;
        const ManualCheckpoints: boolean;
        const WindowTitle: string;
        const HUDHeight: number;
        const ViewportWidth: number;
        const ViewportHeight: number;
        const GameScreenWidth: number;
        const GameScreenHeight: number;
        const StageScreenWidthTiles: number;
        const StageScreenHeightTiles: number;
        const StageScreenStartHeightTiles: number;
        const GameScreenStartX: number;
        const GameScreenStartY: number;
        const ImageBasePath: string;
        const Extension_PNG: string;
        const WaitAfterLoadGame: number;
        const WaitAfterRoomSwitch: number;
        const WaitAfterGameStart1: number;
        const WaitAfterGameStart2: number;
        const pausePosX: number;
        const pausePosY: number;
        const pauseTextPosX: number;
        const pauseTextPosY: number;
        const pauseEndX: number;
        const pauseEndY: number;
        const pauseText: string;
    }
}
declare module "src/room" {
    import { Direction } from "BoazEngineJS/direction";
    import { RoomDataContainer } from "src/RoomFactory";
    import { BitmapId } from "src/resourceids";
    import { Point } from "../lib/interfaces";
    export type NearingRoomExitResult = {
        destRoom: number;
        direction: Direction;
    } | null;
    export type RoomInitDelegate = (room: Room) => void;
    export class Room {
        static RoomWidth: number;
        static RoomHeight: number;
        static NO_ROOM_EXIT: number;
        tiles: string[];
        id: number;
        exits: number[];
        initFunction: RoomInitDelegate;
        imgid: BitmapId;
        static LoadRoom(data: RoomDataContainer): Room;
        init(): void;
        TakeTurn(): void;
        AnyCollisionsTiles(...coordinatesToCheck: Point[]): boolean;
        nearingRoomExit(x: number, y: number): NearingRoomExitResult;
        nearestNonCollisionPoint(x: number, y: number, dir: Direction): number;
        IsCollisionTile(x: number, y: number): boolean;
        private roomExit;
        private CanLeaveRoom;
        Paint(): void;
        protected tileImgid(x: number, y: number): BitmapId;
    }
}
declare module "src/candle" {
    import { Foe } from "src/foe";
    import { BStopwatch } from "BoazEngineJS/btimer";
    import { ItemType } from "src/item";
    import { Animation } from "BoazEngineJS/animation";
    import { Direction } from "BoazEngineJS/direction";
    import { PlayerProjectile } from "src/pprojectile";
    import { BitmapId } from "src/resourceids";
    import { Area, Point } from "../lib/interfaces";
    export class Candle extends Foe {
        get damageToPlayer(): number;
        protected get moveBeforeFrameChange(): number;
        get respawnOnRoomEntry(): boolean;
        protected static CandleHitArea: Area;
        protected static candleSprites: Map<Direction, BitmapId[]>;
        protected static AnimationFrames: BitmapId[];
        protected static framesPerDrawing: number[];
        protected animation: Animation<BitmapId>;
        protected timer: BStopwatch;
        protected get movementSprites(): Map<Direction, BitmapId[]>;
        protected itemSpawnedAfterKill: ItemType;
        constructor(pos: Point, itemSpawned?: ItemType);
        takeTurn(): void;
        dispose(): void;
        handleHit(source: PlayerProjectile): void;
        paint(offset?: Point): void;
    }
}
declare module "src/gardencandle" {
    import { Candle } from "src/candle";
    import { Direction } from "BoazEngineJS/direction";
    import { BitmapId } from "src/resourceids";
    import { ItemType } from "src/item";
    import { Area, Point } from "../lib/interfaces";
    export class GardenCandle extends Candle {
        protected static candleSprites: Map<Direction, BitmapId[]>;
        protected static CandleHitArea: Area;
        protected static AnimationFrames: BitmapId[];
        constructor(pos: Point, itemSpawned?: ItemType);
    }
}
declare module "src/hag" {
    import { BStopwatch } from "BoazEngineJS/btimer";
    import { Animation, AniData } from "BoazEngineJS/animation";
    import { Direction } from "BoazEngineJS/direction";
    import { BitmapId } from "src/resourceids";
    import { ItemType } from "src/item";
    import { Foe } from "src/foe";
    import { PlayerProjectile } from "src/pprojectile";
    import { Size, Area, Point } from "../lib/interfaces";
    export class Hag extends Foe {
        get damageToPlayer(): number;
        protected get moveBeforeFrameChange(): number;
        get respawnOnRoomEntry(): boolean;
        static HagSize: Size;
        protected static HagHitArea: Area;
        protected animation: Animation<number>;
        protected timer: BStopwatch;
        protected static hagSprites: Map<Direction, BitmapId[]>;
        protected static movementSprites: Map<Direction, BitmapId[]>;
        protected static AnimationFrames: AniData<BitmapId>[];
        constructor(pos: Point, dir: Direction, itemSpawned?: ItemType);
        takeTurn(): void;
        dispose(): void;
        handleHit(source: PlayerProjectile): void;
        paint(offset?: Point): void;
    }
}
declare module "src/haggenerator" {
    import { IGameObject, Point } from "../lib/interfaces";
    import { bst } from "BoazEngineJS/statemachine";
    export class HagGenerator implements IGameObject {
        disposeFlag: boolean;
        id: string;
        pos: Point;
        disposeOnSwitchRoom?: boolean;
        protected statestuff: bst<HagGenerator>;
        constructor(pos: Point);
        takeTurn(): void;
        spawn(spawningPos?: Point): void;
        dispose(): void;
    }
}
declare module "src/zakfoe" {
    import { Foe } from "src/foe";
    import { ItemType } from "src/item";
    import { Direction } from "BoazEngineJS/direction";
    import { PlayerProjectile } from "src/pprojectile";
    import { bst } from "BoazEngineJS/statemachine";
    import { Area, Point } from "../lib/interfaces";
    export class ZakFoe extends Foe {
        get damageToPlayer(): number;
        get respawnOnRoomEntry(): boolean;
        protected static ZakFoeHitArea: Area;
        protected fst: bst<ZakFoe>;
        constructor(pos: Point, dir: Direction, itemSpawned?: ItemType);
        takeTurn(): void;
        dispose(): void;
        handleHit(source: PlayerProjectile): void;
        paint(offset?: Point): void;
    }
}
declare module "src/RoomFactory" {
    import { Room, RoomInitDelegate } from "src/room";
    import { BitmapId } from "src/resourceids";
    export class RoomDataContainer {
        id: number;
        tiles: string[];
        exits: number[];
        imgid: BitmapId;
        map: number[][];
        initFunction: RoomInitDelegate;
        constructor(id: number, tiles: string[], imgid: BitmapId, map: number[][], initFunction: RoomInitDelegate);
    }
    export enum RoomMap {
        Debug = 0,
        Dungeon1 = 1,
        Dungeon2 = 2,
        Town1 = 3
    }
    export class RoomFactory {
        private static dirOffsets;
        protected static rooms: Map<number, RoomDataContainer>;
        static RoomExists(id: number): boolean;
        static load(id: number): Room;
        private static posOnMap;
        static roomExits(map: number[][], id: number): number[];
        static PrepareData(): void;
        static RoomMap_stage0: number[][];
        static PrepareStage0Data(): void;
    }
}
declare module "src/chandelier" {
    import { BStopwatch } from "BoazEngineJS/btimer";
    import { Direction } from "BoazEngineJS/direction";
    import { Animation, AniData } from "BoazEngineJS/animation";
    import { Foe } from "src/foe";
    import { PlayerProjectile } from "src/pprojectile";
    import { ItemType } from "src/item";
    import { BitmapId } from "src/resourceids";
    import { Area, Point } from "../lib/interfaces";
    export class Chandelier extends Foe {
        get damageToPlayer(): number;
        protected get moveBeforeFrameChange(): number;
        get respawnOnRoomEntry(): boolean;
        protected static ChandelierHitArea: Area;
        protected static chandelierSprites: Map<Direction, BitmapId[]>;
        protected static AnimationFrames: AniData<number>[];
        protected animation: Animation<number>;
        protected timer: BStopwatch;
        protected get movementSprites(): Map<Direction, BitmapId[]>;
        protected state: ChandelierState;
        get canHurtPlayer(): boolean;
        set canHurtPlayer(value: boolean);
        constructor(pos: Point, itemSpawned?: ItemType);
        takeTurn(): void;
        Dispose(): void;
        handleHit(source: PlayerProjectile): void;
        paint(offset?: Point): void;
    }
    export enum ChandelierState {
        None = 0,
        Falling = 1,
        Crashing = 2,
        Crashed = 3
    }
}
declare module "src/story" {
    export class Story {
    }
}
declare module "BoazEngineJS/gameloader" {
    export function bla(): void;
}
declare module "BoazEngineJS/hiddenobject" {
    import { IGameObject, Point } from "../lib/interfaces";
    export abstract class HiddenObject implements IGameObject {
        pos: Point;
        id: string;
        disposeFlag: boolean;
        extendedProperties: Map<string, any>;
        abstract takeTurn(): void;
        abstract spawn: ((spawningPos?: Point) => void) | (() => void);
        abstract dispose(): void;
        static [Symbol.hasInstance](o: any): boolean;
    }
}
