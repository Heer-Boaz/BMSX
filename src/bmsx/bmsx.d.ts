declare module "audio/psg" {
    export interface Envelope {
        attack: number;
        decay: number;
        sustain: number;
        release: number;
    }
    export interface VibratoParams {
        rate: number;
        depth: number;
    }
    export interface PitchSlideParams {
        targetFrequency: number;
        duration: number;
    }
    export interface Instrument {
        id: number;
        name: string;
        toneEnabled: boolean;
        noiseEnabled: boolean;
        envelope?: Envelope;
        vibrato?: VibratoParams;
        pitchSlide?: PitchSlideParams;
        noiseRegister?: number;
    }
    export const snareInstrument: Instrument;
    export const pianoInstrument: Instrument;
    export class PSG {
        private static sndContext;
        private static gainNode;
        private static psgInitialized;
        private static psgChannels;
        private static noiseSource;
        private static noteFrequencies;
        static init(sndcontext: AudioContext, startingVolume: number, gainnode?: GainNode): Promise<void>;
        private static initPSG;
        private static initPSGNoise;
        static setNoisePeriod(periodInSamples: number): void;
        static setAYNoiseRegister(value: number): void;
        private static applyEnvelope;
        private static applyEnvelopeCustom;
        private static applyVibratoToChannel;
        static playCustomInstrument(instrument: Instrument, baseFrequency: number, startTime?: number, noteDuration?: number): void;
        static playSong(song: {
            note: string;
            duration: number;
        }[], instrument: Instrument, startTime?: number): void;
        static pause(): void;
        static resume(): void;
        static get volume(): number;
        static set volume(v: number);
    }
}
declare module "rompack/rompack" {
    export type AudioType = 'sfx' | 'music';
    export type vec2arr = [number, number] | [number, number, number];
    export type vec3arr = [number, number, number];
    export interface vec2 {
        x: number;
        y: number;
    }
    export interface vec3 extends vec2 {
        z: number;
    }
    export type Vector = vec2 & {
        z?: number;
    };
    export type Size = Vector;
    export interface Area {
        start: Vector;
        end: Vector;
    }
    export type Polygon = number[];
    export interface AudioMeta {
        audiotype: AudioType;
        priority: number;
        loop?: number;
    }
    export interface BoundingBoxPrecalc {
        original: Area;
        fliph: Area;
        flipv: Area;
        fliphv: Area;
    }
    export interface HitPolygonsPrecalc {
        original: Polygon[];
        fliph: Polygon[];
        flipv: Polygon[];
        fliphv: Polygon[];
    }
    export interface ImgMeta {
        atlassed: boolean;
        atlasid?: number;
        width: number;
        height: number;
        texcoords?: number[];
        texcoords_fliph?: number[];
        texcoords_flipv?: number[];
        texcoords_fliphv?: number[];
        boundingbox?: BoundingBoxPrecalc;
        centerpoint?: vec2arr;
        hitpolygons?: HitPolygonsPrecalc;
    }
    export type asset_type = 'image' | 'audio' | 'code' | 'data' | 'atlas' | 'romlabel' | 'model';
    export interface RomAsset {
        resid: number;
        resname: string;
        type: asset_type;
        start?: number;
        end?: number;
        metabuffer_start?: number;
        metabuffer_end?: number;
        buffer?: Buffer;
        imgmeta?: ImgMeta;
        audiometa?: AudioMeta;
    }
    export interface RomImgAsset extends RomAsset {
        imgbin: HTMLImageElement;
    }
    export interface RomMeta {
        start: number;
        end: number;
    }
    export type id2res = Record<number | string, RomAsset>;
    export type id2imgres = Record<number | string, RomImgAsset>;
    export type id2data = Record<number | string, any>;
    export type id2htmlimg = Record<number | string, HTMLImageElement>;
    export interface OBJModel {
        positions: Float32Array;
        texcoords: Float32Array;
        normals: Float32Array | null;
    }
    export interface RomPack {
        rom: ArrayBuffer;
        img: id2imgres;
        audio: id2res;
        model: id2res;
        data: id2data;
        code: string;
    }
    export interface BootArgs {
        rom: RomPack;
        sndcontext: AudioContext;
        gainnode: GainNode;
        debug?: boolean;
        startingGamepadIndex?: number | null;
    }
}
declare module "audio/soundmaster" {
    import { AudioMeta, AudioType, id2res } from "rompack/rompack";
    export interface AudioMetadataWithID extends AudioMeta {
        id: string;
    }
    export type ModulationRange = [number, number];
    export interface FilterModulationParams {
        type?: BiquadFilterType;
        frequency?: number;
        q?: number;
        gain?: number;
    }
    export interface RandomModulationParams {
        pitchRange?: ModulationRange;
        volumeRange?: ModulationRange;
        offsetRange?: ModulationRange;
        playbackRateRange?: ModulationRange;
        filter?: FilterModulationParams;
    }
    export interface ModulationParams {
        pitchDelta?: number;
        volumeDelta?: number;
        offset?: number;
        playbackRate?: number;
        filter?: FilterModulationParams;
    }
    export class SM {
        private static limitToOneEffect;
        private static tracks;
        private static buffers;
        private static sndContext;
        private static currentAudioNodeByType;
        private static currentPlayParamsByType;
        private static nodeExtras;
        static currentAudioByType: Record<AudioType, AudioMetadataWithID | null>;
        private static gainNode;
        private static nodeStartTime;
        private static nodeStartOffset;
        static init(_audioResources: id2res, sndcontext: AudioContext, startingVolume: number, gainnode?: GainNode): Promise<void>;
        private static predecodeTracks;
        private static decode;
        private static createNode;
        private static nodeEndedHandler;
        private static resolvePlayParams;
        private static playNodeWithParams;
        static play(id: string, options?: ModulationParams | RandomModulationParams): void;
        private static releaseNode;
        private static stop;
        private static stopByType;
        static stopEffect(): void;
        static stopMusic(): void;
        static pause(): void;
        static resume(): void;
        static get volume(): number;
        static set volume(_v: number);
        static currentTimeByType(type: AudioType): number | null;
        static currentTrackByType(type: AudioType): string | null;
        static currentModulationParamsByType(type: AudioType): ModulationParams | null;
    }
}
declare module "debugger/rewindui" {
    export function showRewindDialog(): void;
    export function gamePaused(): void;
    export function gameResumed(): void;
}
declare module "core/registry" {
    import { Identifier, Registerable } from "core/game";
    export class Registry {
        private static _instance;
        private _registry;
        static get instance(): Registry;
        constructor();
        get<T extends Registerable = any>(id: Identifier): T | null;
        has(id: Identifier): boolean;
        register(entity: Registerable): void;
        deregister(id: Registerable | Identifier): boolean;
        getPersistentEntities(): Registerable[];
        clear(): void;
        getRegisteredEntities(): Registerable[];
        getRegisteredEntityIds(): Identifier[];
        getRegisteredEntityIdsByType(type: string): Identifier[];
        getRegisteredEntitiesByType(type: string): Registerable[];
    }
}
declare module "core/eventemitter" {
    import { Identifiable, Identifier, Parentable, type RegisterablePersistent } from "core/game";
    type Listener = {
        listener: Function;
        subscriber: any;
    };
    export type ListenerSet = Set<Listener>;
    type EventListenerMap = Record<string, ListenerSet>;
    type EmitterScopeListenerMap = Record<string, EventListenerMap>;
    type EventSubscriberType = EventSubscriber | (EventSubscriber & Parentable) | (EventSubscriber & Identifiable);
    export class EventEmitter implements RegisterablePersistent {
        get registrypersistent(): true;
        get id(): Identifier;
        dispose(): void;
        emitterScopeListeners: EmitterScopeListenerMap;
        globalScopeListeners: EventListenerMap;
        private static _instance;
        static get instance(): EventEmitter;
        constructor();
        initClassBoundEventSubscriptions(subscriber: EventSubscriberType, wrapper?: (...args: any[]) => any): void;
        private checkIfListenerExists;
        on(event_name: string, listener: Function, subscriber: any, filtered_on_emitter_id?: Identifier): void;
        emit(event_name: string, emitter: Identifiable, ...args: any[]): void;
        off(event_name: string, listener: Function, emitter?: string): void;
        removeSubscriber(subscriber: any): void;
        clear(): void;
    }
    export type EventScope = 'all' | 'parent' | 'self' | Identifier;
    export type EventSubscription = {
        eventName: string;
        handlerName: string;
        scope: EventScope;
    };
    export interface EventSubscriber {
        eventSubscriptions?: EventSubscription[];
    }
    export function subscribesToParentScopedEvent(eventName: string): (target: any, propertyKey: string) => void;
    export function subscribesToSelfScopedEvent(eventName: string): (target: any, propertyKey: string) => void;
    export function subscribesToEmitterScopedEvent(eventName: string, emitter_id: string): (target: any, propertyKey: string, _descriptor: PropertyDescriptor) => void;
    export function subscribesToGlobalEvent(eventName: string): (target: any, propertyKey: string, _descriptor: PropertyDescriptor) => void;
    export function emits_event(eventName: string): (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) => void;
}
declare module "fsm/statedefinition" {
    import { EventScope } from "core/eventemitter";
    import { type Identifier } from "core/game";
    import { type StateEventDefinition, type StateEventHandler, type StateExitHandler, type StateGuard, type StateNextHandler, type Tape, type TickCheckDefinition, type id2partial_sdef } from "fsm/fsmtypes";
    export class StateDefinition {
        #private;
        id: Identifier;
        data?: {
            [key: string]: any;
        };
        parallel?: boolean;
        tape: Tape;
        ticks2move: number;
        auto_tick: boolean;
        auto_reset: 'state' | 'tree' | 'subtree' | 'none';
        auto_rewind_tape_after_end: boolean;
        repetitions: number;
        parent: StateDefinition;
        root: StateDefinition;
        event_list: {
            name: string;
            scope: EventScope;
        }[];
        constructor(id?: Identifier, partialdef?: Partial<StateDefinition>, root?: StateDefinition);
        private repeat_tape;
        private construct_substate_machine;
        run?: StateEventHandler;
        end?: StateEventHandler;
        next?: StateNextHandler;
        enter?: StateEventHandler;
        exit?: StateExitHandler;
        process_input?: StateEventHandler;
        on?: {
            [key: string]: Identifier | StateEventDefinition;
        };
        on_input?: {
            [key: string]: Identifier | StateEventDefinition;
        };
        run_checks?: TickCheckDefinition[];
        guards?: StateGuard;
        states?: id2partial_sdef;
        start_state_id?: Identifier;
        static readonly START_STATE_PREFIXES = "_#";
        replace_partialsdef_with_sdef(state: StateDefinition, root: StateDefinition): void;
    }
    export function validateStateMachine(machinedef: StateDefinition, path?: string): void;
}
declare module "fsm/state" {
    import { EventSubscriber } from "core/eventemitter";
    import { Identifiable, Identifier, Registerable } from "core/game";
    import { type id2sstate, type Stateful, type Tape } from "fsm/fsmtypes";
    import { StateDefinition } from "fsm/statedefinition";
    export class State<T extends Stateful & EventSubscriber & Registerable = any> implements Identifiable {
        id: Identifier;
        parent_id: Identifier;
        get parent(): any;
        root_id: Identifier;
        get root(): any;
        def_id: Identifier;
        states: id2sstate;
        get parallel(): boolean;
        currentid: Identifier;
        history: Array<Identifier>;
        paused: boolean;
        target_id: Identifier;
        data: {
            [key: string]: any;
        };
        get target(): T;
        get current(): State;
        get_sstate(id: Identifier): State<any>;
        get definition(): StateDefinition;
        get start_state_id(): Identifier;
        private critical_section_counter;
        private transition_queue;
        private enterCriticalSection;
        private leaveCriticalSection;
        private process_transition_queue;
        get current_state_definition(): StateDefinition;
        static create(id: Identifier, target_id: Identifier, parent_id: Identifier, root_id: Identifier): State;
        constructor(def_id: Identifier, target_id: Identifier, parent_id: Identifier, root_id: Identifier);
        onLoadSetup(): void;
        start(): void;
        run(): void;
        processInput(): void;
        private processInputForCurrentState;
        private runCurrentState;
        runSubstateMachines(): void;
        doRunChecks(): void;
        runChecksForCurrentState(): void;
        private handle_path;
        to_path(path: string | string[], ...args: any[]): void;
        switch_path(path: string | string[], ...args: any[]): void;
        to(state_id: Identifier, ...args: any[]): void;
        switch(state_id: Identifier, ...args: any[]): void;
        is(path: string | string[]): boolean;
        private checkStateGuardConditions;
        private transitionToState;
        do(eventName: string, emitter: Identifier | Identifiable, ...args: any[]): void;
        dispatch(eventName: string, emitter_id: Identifier, ...args: any[]): void;
        private getNextState;
        private transitionToNextStateIfProvided;
        private handleEvent;
        private handleStateTransition;
        protected pushHistory(toPush: Identifier): void;
        pop(): void;
        populateStates(): void;
        private add;
        get tape(): Tape;
        get current_tape_value(): any;
        get at_tapeend(): boolean;
        protected get beyond_tapeend(): boolean;
        get tape_rewound(): boolean;
        private make_id;
        dispose(): void;
        protected _tapehead: number;
        get head(): number;
        set head(v: number);
        setHeadNoSideEffect(v: number): void;
        setTicksNoSideEffect(v: number): void;
        protected _ticks: number;
        get ticks(): number;
        set ticks(v: number);
        protected tapemove(tape_rewound?: boolean): void;
        protected tapeend(): void;
        rewind_tape(): void;
        reset(reset_tree?: boolean): void;
        resetSubmachine(reset_tree?: boolean): void;
    }
}
declare module "fsm/fsmtypes" {
    import type { EventScope, EventSubscriber } from "core/eventemitter";
    import type { Identifier, Registerable } from "core/game";
    import type { StateMachineController } from "fsm/fsmcontroller";
    import type { State } from "fsm/state";
    import type { StateDefinition } from "fsm/statedefinition";
    export const STATE_THIS_PREFIX = "#this";
    export const STATE_PARENT_PREFIX = "#parent";
    export const STATE_ROOT_PREFIX = "#root";
    export type id2sdef = Record<Identifier, StateDefinition>;
    export type id2mstate = Record<Identifier, State>;
    export type id2sstate = Record<Identifier, State>;
    export type StateMachineBlueprint = Partial<StateDefinition>;
    export type id2partial_sdef = Record<Identifier, StateMachineBlueprint>;
    export interface StateEventHandler<T extends Stateful = any> {
        (state: State<T>, ...args: any[]): StateTransition | Identifier | void;
    }
    export interface StateExitHandler<T extends Stateful = any> {
        (state: State<T>, ...args: any[]): void;
    }
    export interface StateNextHandler<T extends Stateful = any> extends StateEventHandler {
        (state: State<T>, tape_rewound: boolean, ...args: any[]): StateTransition | Identifier | void;
    }
    export interface StateEventCondition<T extends Stateful & EventSubscriber = any> {
        (state: State<T>, ...args: any[]): boolean;
    }
    export type listed_sdef_event = {
        name: string;
        scope: EventScope;
    };
    export type StateTransition = {
        state_id: Identifier;
        args?: any;
        transition_type?: TransitionType;
        force_transition_to_same_state?: boolean;
    };
    export type StateTransitionWithType = StateTransition & {
        transition_type: TransitionType;
    };
    export type StateEventDefinition<T extends Stateful & EventSubscriber = any> = {
        to?: StateTransition | Identifier;
        switch?: StateTransition | Identifier;
        if?: StateEventCondition<T>;
        do?: StateEventHandler<T>;
        scope?: EventScope;
    };
    export interface StateGuard<T extends Stateful & EventSubscriber = any> {
        canEnter?: (this: T, state: State) => boolean;
        canExit?: (this: T, state: State) => boolean;
    }
    export type TickCheckDefinition<T extends Stateful = any> = Omit<StateEventDefinition<T>, 'scope'>;
    export type TransitionType = 'to' | 'switch';
    export type Tape = any[];
    export interface Stateful extends Registerable, EventSubscriber {
        sc: StateMachineController;
        player_index?: number;
    }
    export type FSMName = string;
    export type ConstructorWithFSMProperty = Function & {
        linkedFSMs?: Set<FSMName>;
    };
}
declare module "fsm/fsmdecorators" {
    import type { Identifier } from "core/game";
    import type { ConstructorWithFSMProperty, FSMName, StateMachineBlueprint } from "fsm/fsmtypes";
    export var StateDefinitionBuilders: Record<string, () => StateMachineBlueprint>;
    export function assign_fsm(...fsms: FSMName[]): (constructor: ConstructorWithFSMProperty) => void;
    export function build_fsm(fsm_name?: Identifier): (target: any, _name: any, descriptor: PropertyDescriptor) => any;
}
declare module "fsm/fsmlibrary" {
    import { StateDefinition } from "fsm/statedefinition";
    export var StateDefinitions: Record<string, StateDefinition>;
    export function setupFSMlibrary(): void;
}
declare module "serializer/bincompressor" {
    interface CompressorOptions {
        windowSize?: number;
        minMatch?: number;
        maxMatch?: number;
        rleThreshold?: number;
        disableLZ77?: boolean;
        disableRLE?: boolean;
    }
    export const optimalGameStateCompressorOptions: CompressorOptions;
    export const optimalRompakCompressorOptions: CompressorOptions;
    export class BinaryCompressor {
        static readonly WINDOW_SIZE = 2048;
        static readonly MIN_MATCH = 4;
        static readonly MAX_MATCH = 255;
        static readonly MAX_RUN = 255;
        static readonly RLE_THRESHOLD = 4;
        static COMPRESS_SCRATCH: Uint8Array<ArrayBuffer>;
        static readonly CURRENT_VERSION = 1;
        static readonly MAGIC_HEADER: Uint8Array<ArrayBuffer>;
        static compressBinary(input: Uint8Array, options?: CompressorOptions): Uint8Array;
        static decompressBinary(input: Uint8Array): Uint8Array;
        static testRoundTrip(): boolean;
        static testFullPipeline(): boolean;
        static findBug(state: any): void;
        static testJsonUtf8RoundTrip(): boolean;
    }
}
declare module "render/math3d" {
    import type { vec3 } from "rompack/rompack";
    export type Mat4 = Float32Array;
    export const bmat: {
        identity(): Mat4;
        perspective(fov: number, aspect: number, near: number, far: number): Mat4;
        lookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Mat4;
        multiply(a: Mat4, b: Mat4): Mat4;
        translate(m: Mat4, x: number, y: number, z: number): Mat4;
        scale(m: Mat4, x: number, y: number, z: number): Mat4;
        rotateX(m: Mat4, rad: number): Mat4;
        rotateY(m: Mat4, rad: number): Mat4;
        rotateZ(m: Mat4, rad: number): Mat4;
        orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4;
        transpose(m: Mat4): Mat4;
        invert(m: Mat4): Mat4;
        normalMatrix(m: Mat4): Float32Array;
    };
    export const bvec3: {
        add(a: vec3, b: vec3): vec3;
        sub(a: vec3, b: vec3): vec3;
        scale(v: vec3, s: number): vec3;
        rotateX(v: vec3, rad: number, origin?: vec3): vec3;
        rotateY(v: vec3, rad: number, origin?: vec3): vec3;
        rotateZ(v: vec3, rad: number, origin?: vec3): vec3;
        length(v: vec3): number;
        normalize(v: vec3): vec3;
        cross(a: vec3, b: vec3): vec3;
    };
}
declare module "render/camera3d" {
    import { Mat4 } from "render/math3d";
    import type { vec3, vec3arr } from "rompack/rompack";
    export class Camera3D {
        position: vec3;
        target: vec3;
        up: vec3;
        fov: number;
        near: number;
        far: number;
        private _aspect;
        projection: 'perspective' | 'orthographic';
        orthoWidth: number;
        orthoHeight: number;
        constructor(opts?: {
            position?: vec3 | vec3arr;
            target?: vec3 | vec3arr;
            up?: vec3 | vec3arr;
            fov?: number;
            aspect?: number;
            near?: number;
            far?: number;
        });
        setAspect(aspect: number): void;
        setPosition(pos: vec3 | vec3arr): void;
        lookAt(target: vec3 | vec3arr): void;
        setViewDepth(near: number, far: number): void;
        rotateX(rad: number): void;
        rotateY(rad: number): void;
        rotateZ(rad: number): void;
        moveForward(dist: number): void;
        moveRight(dist: number): void;
        moveUp(dist: number): void;
        usePerspective(fov?: number): void;
        useOrthographic(width: number, height: number): void;
        get projectionMatrix(): Mat4;
        get viewMatrix(): Mat4;
        get viewProjectionMatrix(): Mat4;
    }
}
declare module "render/material" {
    export interface MaterialTextures {
        albedo?: string;
        normal?: string;
        metallicRoughness?: string;
    }
    export class Material {
        textures: MaterialTextures;
        color: [number, number, number];
        constructor(opts?: {
            textures?: MaterialTextures;
            color?: [number, number, number];
        });
    }
}
declare module "render/shadowmap" {
    export class ShadowMap {
        private gl;
        texture: WebGLTexture | null;
        framebuffer: WebGLFramebuffer | null;
        constructor(gl: WebGLRenderingContext, size?: number);
    }
}
declare module "render/view" {
    import { BFont, Identifier, type RegisterablePersistent } from "core/game";
    import type { Area, Polygon, Size, Vector, id2imgres, vec2 } from "rompack/rompack";
    import { Material } from "render/material";
    import { ShadowMap } from "render/shadowmap";
    export interface FlipOptions {
        flip_h: boolean;
        flip_v: boolean;
    }
    export interface DrawRectOptions {
        area: Area;
        color: Color;
    }
    export interface DrawImgOptions {
        imgid: string;
        pos: Vector;
        scale?: vec2;
        flip?: FlipOptions;
        colorize?: Color;
    }
    export interface Color {
        r: number;
        g: number;
        b: number;
        a: number;
    }
    export class PixelData {
        B: number;
        G: number;
        R: number;
    }
    export abstract class BaseView implements RegisterablePersistent {
        get registrypersistent(): true;
        get id(): Identifier;
        dispose(): void;
        canvas: HTMLCanvasElement;
        context: CanvasRenderingContext2D;
        static imgassets: id2imgres;
        accessor default_font: BFont;
        windowSize: Size;
        availableWindowSize: Size;
        viewportSize: Size;
        canvasSize: Size;
        dx: number;
        dy: number;
        viewportScale: number;
        canvas_dx: number;
        canvas_dy: number;
        canvasScale: number;
        constructor(viewportSize: Size, canvasSize?: Size);
        init(): void;
        drawgame(clearCanvas?: boolean): void;
        calculateSize(): void;
        handleResize(): void;
        protected listenToMediaEvents(): void;
        determineMaxScaleForFullscreen(clientWidth: number, clientHeight: number, originalBufferWidth: number, originalBufferHeight: number): number;
        toFullscreen(): void;
        get isFullscreen(): any;
        static get fullscreenEnabled(): any;
        static triggerFullScreenOnFakeUserEvent(): void;
        ToWindowed(): void;
        static triggerWindowedOnFakeUserEvent(): void;
        showFadingOverlay(text: string): void;
        hideFadingOverlay(): void;
        showPauseOverlay(): void;
        showResumeOverlay(): void;
        clear(): void;
        drawImg(options: DrawImgOptions): void;
        drawRectangle(options: DrawRectOptions): void;
        fillRectangle(options: DrawRectOptions): void;
        drawPolygon(points: Polygon, _z: number, color: Color, thickness?: number): void;
        private toRgb;
    }
    export function paintImage(options: DrawImgOptions): void;
    export interface DrawMeshOptions {
        positions: Float32Array;
        texcoords: Float32Array;
        normals?: Float32Array;
        matrix: Float32Array;
        color?: Color;
        atlasId?: number;
        material?: Material;
        shadow?: {
            map: ShadowMap;
            matrix: Float32Array;
            strength: number;
        };
    }
    export function paintMesh(options: DrawMeshOptions): void;
    export interface SkyboxImageIds {
        posX: string;
        negX: string;
        posY: string;
        negY: string;
        posZ: string;
        negZ: string;
    }
    export function setSkybox(images: SkyboxImageIds): void;
}
declare module "render/light" {
    import type { vec3arr } from "rompack/rompack";
    export interface BaseLight {
        id: string;
        color: vec3arr;
        intensity: number;
    }
    export interface AmbientLight extends BaseLight {
        type: 'ambient';
    }
    export interface DirectionalLight extends BaseLight {
        type: 'directional';
        direction: vec3arr;
    }
    export interface PointLight extends BaseLight {
        type: 'point';
        position: vec3arr;
        range: number;
    }
    export interface SpotLight extends BaseLight {
        type: 'spot';
        position: vec3arr;
        direction: vec3arr;
        angle: number;
        range: number;
    }
    export interface AreaLight extends BaseLight {
        type: 'area';
        position: vec3arr;
        size: [number, number];
        normal: vec3arr;
    }
    export type Light = AmbientLight | DirectionalLight | PointLight | SpotLight | AreaLight;
}
declare module "render/glview" {
    import type { Polygon, Size, vec3, vec3arr } from "rompack/rompack";
    import { BaseView, Color, DrawImgOptions, DrawRectOptions } from "render/view";
    import { Material } from "render/material";
    import { ShadowMap } from "render/shadowmap";
    import { Camera3D } from "render/camera3d";
    import type { DirectionalLight, PointLight } from "render/light";
    export const DEFAULT_VERTEX_COLOR: Color;
    export const VERTEX_COLOR_COLORIZED_RED: Color;
    export const VERTEX_COLOR_COLORIZED_GREEN: Color;
    export const VERTEX_COLOR_COLORIZED_BLUE: Color;
    export const MAX_SPRITES = 256;
    export const MAX_DIR_LIGHTS = 4;
    export const MAX_POINT_LIGHTS = 4;
    export const ZCOORD_MAX = 10000;
    export abstract class GLView extends BaseView {
        glctx: WebGL2RenderingContext;
        private textures;
        private gameShaderProgram;
        private vertexLocation;
        private texcoordLocation;
        private zcoordLocation;
        private color_overrideLocation;
        private atlas_idLocation;
        private resolutionLocation;
        private texture0Location;
        private texture1Location;
        private vertexBuffer;
        private texcoordBuffer;
        private zBuffer;
        private CRTShaderVertexBuffer;
        private CRTShaderTexcoordBuffer;
        private depthBuffer;
        private color_overrideBuffer;
        private atlas_idBuffer;
        private readonly vertex_shader_data;
        private imagesToDraw;
        private CRTShaderTexcoordLocation;
        private CRTShaderResolutionLocation;
        private CRTShaderTimeLocation;
        private CRTShaderRandomLocation;
        private CRTShaderVertexLocation;
        private CRTShaderApplyNoiseLocation;
        private CRTShaderApplyColorBleedLocation;
        private CRTShaderApplyScanlinesLocation;
        private CRTShaderApplyBlurLocation;
        private CRTShaderApplyGlowLocation;
        private CRTShaderApplyFringingLocation;
        private CRTShaderNoiseIntensityLocation;
        private CRTShaderColorBleedLocation;
        private CRTShaderBlurIntensityLocation;
        private CRTShaderGlowColorLocation;
        private CRTFragmentShaderTextureLocation;
        private CRTShaderProgram;
        private framebuffer;
        private isRendering;
        private needsResize;
        private gameShaderProgram3D;
        private vertexLocation3D;
        private texcoordLocation3D;
        private color_overrideLocation3D;
        private atlas_idLocation3D;
        private normalLocation3D;
        private mvpLocation3D;
        private modelLocation3D;
        private normalMatrixLocation3D;
        private ditherLocation3D;
        private ambientColorLocation3D;
        private ambientIntensityLocation3D;
        private dirLightDirectionLocation3D;
        private dirLightColorLocation3D;
        private numDirLightsLocation3D;
        private pointLightPositionLocation3D;
        private pointLightColorLocation3D;
        private pointLightRangeLocation3D;
        private numPointLightsLocation3D;
        private materialColorLocation3D;
        private shadowMapLocation3D;
        private lightMatrixLocation3D;
        private shadowStrengthLocation3D;
        private vertexBuffer3D;
        private texcoordBuffer3D;
        private color_overrideBuffer3D;
        private atlas_idBuffer3D;
        private normalBuffer3D;
        private meshesToDraw;
        private camera;
        private directionalLights;
        private pointLights;
        private skyboxProgram;
        private skyboxPositionLocation;
        private skyboxViewLocation;
        private skyboxProjectionLocation;
        private skyboxTextureLocation;
        private skyboxBuffer;
        private skyboxTexture;
        static readonly vertexShaderCode: string;
        static readonly fragmentShaderTextureCode: string;
        static readonly fragmentShaderCRTCode: string;
        static readonly vertexShader3DCode: string;
        static readonly fragmentShader3DCode: string;
        static readonly skyboxVertShaderCode: string;
        static readonly skyboxFragShaderCode: string;
        private _applyNoise;
        private _applyColorBleed;
        private _applyScanlines;
        private _applyBlur;
        private _applyGlow;
        private _applyFringing;
        private _noiseIntensity;
        private _colorBleed;
        private _blurIntensity;
        private _glowColor;
        get applyNoise(): boolean;
        set applyNoise(value: boolean);
        get applyColorBleed(): boolean;
        set applyColorBleed(value: boolean);
        get applyScanlines(): boolean;
        set applyScanlines(value: boolean);
        get applyBlur(): boolean;
        set applyBlur(value: boolean);
        get applyGlow(): boolean;
        set applyGlow(value: boolean);
        get applyFringing(): boolean;
        set applyFringing(value: boolean);
        get noiseIntensity(): number;
        set noiseIntensity(value: number);
        get colorBleed(): vec3arr;
        set colorBleed(value: vec3arr);
        get blurIntensity(): number;
        set blurIntensity(value: number);
        get glowColor(): vec3arr;
        set glowColor(value: vec3arr);
        setCameraPosition(pos: vec3 | vec3arr): void;
        pointCameraAt(target: vec3 | vec3arr): void;
        setCameraViewDepth(near: number, far: number): void;
        setCameraFov(fov: number): void;
        usePerspectiveCamera(fov?: number): void;
        useOrthographicCamera(width: number, height: number): void;
        getCamera(): Camera3D;
        setAmbientLight(color: vec3arr, intensity: number): void;
        private uploadDirectionalLights;
        private uploadPointLights;
        addDirectionalLight(id: string, direction: vec3arr, color: vec3arr): void;
        removeDirectionalLight(id: string): void;
        getDirectionalLight(id: string): DirectionalLight | undefined;
        addPointLight(id: string, position: vec3arr, color: vec3arr, range: number): void;
        removePointLight(id: string): void;
        getPointLight(id: string): PointLight | undefined;
        clearLights(): void;
        private gameShaderScaleLocation;
        private CRTVertexShaderScaleLocation;
        private offscreenCanvasSize;
        CRTFragmentShaderScaleLocation: WebGLUniformLocation;
        constructor(viewportsize: Size, crtOptions?: {
            noiseIntensity?: number;
            colorBleed?: vec3arr;
            blurIntensity?: number;
            glowColor?: vec3arr;
        });
        init(): void;
        private setDefaultUniformValues;
        private createCRTVertexBuffer;
        private createCRTShaderTexcoordBuffer;
        private switchProgram;
        private createCRTShaderPrograms;
        private setupCRTShaderLocations;
        private setupBuffers;
        private setupBuffers3D;
        private createSkyboxBuffer;
        private drawSkybox;
        private setupGameShaderLocations;
        private setupGameShader3DLocations;
        private setupTextures;
        setSkyboxImages(ids: {
            posX: string;
            negX: string;
            posY: string;
            negY: string;
            posZ: string;
            negZ: string;
        }): void;
        private setupGLContext;
        private createGameShaderPrograms;
        private createGameShaderPrograms3D;
        private createSkyboxProgram;
        private setupVertexShaderLocations;
        private setupVertexShaderLocations3D;
        private setupSkyboxLocations;
        private createBuffer;
        private setupAttributeFloat;
        private setupAttributeInt;
        private static getTextureCoordinates;
        private loadShader;
        private createTexture;
        private createFramebufferAndTexture;
        handleResize(this: GLView): void;
        drawgame(clearCanvas?: boolean): void;
        saveFramebufferToFile(): void;
        saveTextureToFile(): void;
        private applyCrtPostProcess;
        clear(): void;
        renderSpriteBatch(): void;
        private static updateBuffer;
        drawImg(options: DrawImgOptions): void;
        private getTexCoords;
        private updateBuffers;
        drawMesh3D(positions: Float32Array, texcoords: Float32Array, normals: Float32Array | undefined, matrix: Float32Array, color?: Color, atlasId?: number, material?: Material, shadow?: {
            map: ShadowMap;
            matrix: Float32Array;
            strength: number;
        }): void;
        renderMeshBatch(): void;
        private correctAreaStartEnd;
        drawRectangle(options: DrawRectOptions): void;
        fillRectangle(options: DrawRectOptions): void;
        drawPolygon(coords: Polygon, z: number, color: Color, thickness?: number): void;
        private _dynamicAtlasIndex;
        get dynamicAtlas(): number | null;
        set dynamicAtlas(index: number);
    }
}
declare module "core/cameraobject" {
    import { GameObject } from "core/gameobject";
    import { Camera3D } from "render/camera3d";
    import { GLView } from "render/glview";
    import type { Vector } from "rompack/rompack";
    export class CameraObject extends GameObject {
        camera: Camera3D;
        active: boolean;
        constructor(id?: string);
        onspawn(pos?: Vector): void;
        dispose(): void;
        applyToView(view: GLView): void;
    }
}
declare module "core/lightobject" {
    import { GameObject } from "core/gameobject";
    import type { Light } from "render/light";
    import { GLView } from "render/glview";
    export abstract class LightObject extends GameObject {
        light: Light;
        active: boolean;
        constructor(light: Light, id?: string);
        abstract applyToView(view: GLView): void;
    }
    export class AmbientLightObject extends LightObject {
        constructor(id: string, color: [number, number, number], intensity: number);
        applyToView(view: GLView): void;
    }
    export class DirectionalLightObject extends LightObject {
        constructor(id: string, direction: [number, number, number], color: [number, number, number]);
        applyToView(view: GLView): void;
    }
    export class PointLightObject extends LightObject {
        constructor(id: string, position: [number, number, number], color: [number, number, number], range: number);
        applyToView(view: GLView): void;
    }
}
declare module "core/basemodel" {
    import { BehaviorTreeDefinition, BehaviorTreeID } from "ai/behaviourtree";
    import { StateMachineController } from "fsm/fsmcontroller";
    import { Stateful } from "fsm/fsmtypes";
    import { StateDefinition } from "fsm/statedefinition";
    import { Vector } from "rompack/rompack";
    import type { Identifier, Registerable, RegisterablePersistent } from "core/game";
    import { Direction } from "core/game";
    import { GameObject } from "core/gameobject";
    import { CameraObject } from "core/cameraobject";
    import { LightObject } from "core/lightobject";
    export interface SpaceObject {
        spaceid: Identifier;
        objects: GameObject[];
    }
    export type id2objectType = Record<Identifier, GameObject>;
    export type id2spaceType = Record<Identifier, Space>;
    export type obj_id2space_id_type = Record<Identifier, Identifier>;
    export const id2obj: unique symbol;
    export const spaceid_2_space: unique symbol;
    export const objid_2_objspaceid: unique symbol;
    export class Space {
        [id2obj]: id2objectType;
        get<T extends GameObject>(id: Identifier): T | undefined;
        id: Identifier;
        objects: GameObject[];
        ondispose?: () => void;
        constructor(id: Identifier);
        sort_by_depth(): void;
        spawn(o: GameObject, pos?: Vector, skip_onspawn_event?: boolean): void;
        exile(o: GameObject, skip_ondispose_event?: boolean): void;
        clear(): void;
    }
    export type base_model_spaces = 'game_start' | 'default';
    export abstract class BaseModel implements Stateful, RegisterablePersistent {
        get registrypersistent(): true;
        get<T extends Registerable = any>(id: Identifier): T | null;
        get id(): Identifier;
        on(event_name: string, handler: Function, emitter_id: Identifier): void;
        static readonly keys_to_exclude_from_save: string[];
        sc: StateMachineController;
        [spaceid_2_space]: id2spaceType;
        [objid_2_objspaceid]: obj_id2space_id_type;
        get objects(): GameObject[];
        spaces: Space[];
        protected currentSpaceid: Identifier;
        get current_space_id(): Identifier;
        get currentSpace(): Space;
        setSpace(newSpaceId: Identifier): void;
        get_space<T extends Space>(id: Identifier): T;
        paused: boolean;
        startAfterLoad: boolean;
        activeCameraId: Identifier | null;
        setActiveCamera(id: Identifier): void;
        getActiveCamera(): CameraObject | null;
        getActiveLights(): LightObject[];
        applyViewSettings(): void;
        getFromCurrentSpace<T extends GameObject>(id: Identifier): T;
        getGameObject<T extends GameObject = GameObject>(id: Identifier): T | null;
        exists(obj_id: Identifier): boolean;
        get_spaceid_that_has_obj(obj_id: Identifier): Identifier;
        is_obj_in_current_space(obj_id: Identifier): boolean;
        move_obj_to_space(obj_id: Identifier, spaceid_to_move_obj_to: Identifier): void;
        move_obj_to_current_space(obj_id: Identifier): void;
        static getMachinedef(machineid: Identifier): StateDefinition;
        static getMachineStatedef(machineid: Identifier): StateDefinition;
        static getBTdef(btid: BehaviorTreeID): BehaviorTreeDefinition;
        abstract get gamewidth(): number;
        abstract get gameheight(): number;
        private static readonly MAX_ID_NUMBER;
        protected idCounter: number;
        getNextIdNumber(): number;
        constructor();
        init_on_boot(): void;
        dispose(): void;
        init_event_subscriptions(): BaseModel;
        init_spaces(): BaseModel;
        private static setup_fsmdef_library;
        private static setup_bt_library;
        abstract get constructor_name(): string;
        init_model_state_machines(derived_modelclass_constructor_name: string): this;
        abstract do_one_time_game_init(): this;
        run(_deltaTime: number): void;
        static defaultrun: () => void;
        static default_input_handler_for_allow_open_gamemenu(this: BaseModel): void;
        static default_input_handler_for_allow_close_gamemenu(this: BaseModel): void;
        static default_input_handler(this: BaseModel): void;
        load(serialized: Uint8Array, compressed?: boolean): void;
        save(compress?: boolean): Uint8Array;
        filter(predicate: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => unknown): GameObject[];
        filter_and_foreach(predicate: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => unknown, callbackfn: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => void): void;
        clear(): void;
        clearAllSpaces(): void;
        spawn(o: GameObject, pos?: Vector, ignoreSpawnhandler?: boolean): void;
        exile(o: GameObject): void;
        exileFromCurrentSpace(o: GameObject): void;
        addSpace(s: Space | Identifier): void;
        removeSpace(s: Space | Identifier): void;
        abstract collidesWithTile(o: GameObject, dir: Direction): boolean;
        abstract isCollisionTile(x: number, y: number): boolean;
    }
}
declare module "serializer/binencoder" {
    export const VERSION = 161;
    export function encodeBinary(obj: any): Uint8Array;
    export function decodeBinary(buf: Uint8Array): any;
}
declare module "serializer/gameserializer" {
    import { type ModulationParams } from "audio/soundmaster";
    import { Space, SpaceObject } from "core/basemodel";
    export class Serializer {
        static onSaves: Record<string, ((v: any) => Record<string, any>)[]>;
        static serialize(obj: any, options?: {
            binary?: boolean;
        }): string | Uint8Array;
        private static serializeAnyWithRefs;
        static excludedProperties: Record<string, Record<string, boolean>>;
        static excludedObjectTypes: Set<string>;
        static get_typename(value: any): string;
        private static buildReferenceGraph;
    }
    export class Reviver {
        static constructors: Record<string, new () => any>;
        static onLoads: Record<string, ((result: any) => any)[]>;
        static removeSerializerProps(obj: {
            typename: string;
        }): void;
        static get_constructor_for_type(typename: string): new () => any;
        static deserialize(input: string | Uint8Array, options?: {
            isBinary?: boolean;
        }): any;
    }
    export function onsave(target: any, _propertyKey: string | symbol, descriptor: PropertyDescriptor): any;
    export function excludepropfromsavegame(target: Object, propertyKey: string, _descriptor?: PropertyDescriptor): any;
    export function onload(target: any, _name: any, descriptor: PropertyDescriptor): any;
    export function insavegame(constructor: InstanceType<any>, _toJSON?: () => any, _fromJSON?: (value: any, value_data: any) => any): any;
    export function excludeclassfromsavegame(constructor: InstanceType<any>): any;
    type SoundMasterState = {
        sfxTrackId?: string;
        sfxOffset?: number;
        musicTrackId?: string;
        musicOffset?: number;
        sfxModParams?: ModulationParams;
        musicModParams?: ModulationParams;
    };
    type ViewState = {
        dynamicAtlasIndex: number;
        activeCameraId: string | null;
    };
    export class Savegame {
        modelprops: {};
        allSpacesObjects: SpaceObject[];
        spaces: Space[];
        SMState: SoundMasterState;
        viewState: ViewState;
        saveViewState(o: Savegame): {
            viewState: ViewState;
        };
        restoreViewState(): void;
        saveSoundState(o: Savegame): {
            SMState: {
                sfxTrackId: string;
                sfxOffset: number;
                musicTrackId: string;
                musicOffset: number;
                sfxModParams: ModulationParams;
                musicModParams: ModulationParams;
            };
        };
        restoreSoundState(): void;
    }
    export function debugPrintBinarySnapshot(buf: Uint8Array): string;
}
declare module "fsm/fsmcontroller" {
    import { Identifiable, Identifier } from "core/game";
    import { type id2sstate } from "fsm/fsmtypes";
    import { State } from "fsm/state";
    import { StateDefinition } from "fsm/statedefinition";
    export const BST_MAX_HISTORY = 10;
    export const DEFAULT_BST_ID = "master";
    export class StateMachineController {
        statemachines: Record<Identifier, State>;
        get machines(): Record<Identifier, State>;
        current_machine_id: Identifier;
        get current_machine(): State;
        get current_state(): State;
        get states(): id2sstate;
        get definition(): StateDefinition;
        constructor();
        dispose(): void;
        start(): void;
        initLoadSetup(): void;
        run(): void;
        to(newstate: Identifier, ...args: any[]): void;
        switch(path: string, ...args: any[]): void;
        do(event_name: string, emitter: Identifier | Identifiable, ...args: any[]): void;
        private auto_dispatch;
        add_statemachine(id: Identifier, target_id: Identifier): void;
        get_statemachine(id: Identifier): State;
        is(id: string): boolean;
        run_statemachine(id: Identifier): void;
        run_all_statemachines(): void;
        reset_statemachine(id: Identifier): void;
        reset_all_statemachines(): void;
        pop(): void;
        pop_statemachine(id: Identifier): void;
        pop_all_statemachines(): void;
        switch_state(id: Identifier, path: Identifier): void;
        pause_statemachine(id: Identifier): void;
        resume_statemachine(id: Identifier): void;
        pause_all_statemachines(): void;
        pause_all_except(to_exclude_id: Identifier): void;
        resume_all_statemachines(): void;
    }
}
declare module "core/objecttracker" {
    import type { Identifier } from "core/game";
    import { GameObject } from "core/gameobject";
    export class ObjectTracker {
        private trackedObjects;
        private lastValues;
        trackObject<T extends GameObject>(target: T, properties: Array<{
            property: keyof T;
            key?: string;
        }>): void;
        untrackObject(id: Identifier): void;
        getUpdates(): {
            [id: Identifier]: Array<{
                property: string;
                value: any;
                key?: string;
            }>;
        };
    }
}
declare module "core/gameobject" {
    import { BehaviorTreeID, Blackboard, BTNode } from "ai/behaviourtree";
    import { Component, ComponentConstructor, ComponentContainer, ComponentTag, KeyToComponentMap } from "component/basecomponent";
    import { StateMachineController } from "fsm/fsmcontroller";
    import type { Stateful } from "fsm/fsmtypes";
    import { Area, vec2, vec3, Vector, type Polygon, type vec2arr } from "rompack/rompack";
    import { AbstractConstructor, Direction, type Identifier } from "core/game";
    import { ObjectTracker } from "core/objecttracker";
    export class GameObject implements vec3, ComponentContainer, Stateful {
        components: KeyToComponentMap;
        objectTracker?: ObjectTracker;
        getComponent<T extends Component>(constructor: ComponentConstructor<T>): T | undefined;
        addComponent<T extends Component>(component: T): void;
        removeComponent<T extends Component>(constructor: ComponentConstructor<T>): void;
        updateComponentsWithTag(tag: ComponentTag, ...args: any[]): void;
        [Symbol.toPrimitive](): string;
        id: Identifier;
        disposeFlag: boolean;
        protected _pos: vec3;
        get pos(): vec3;
        set pos(pos: vec3);
        get x(): number;
        set x(x: number);
        protected setPosX(x: number): void;
        get y(): number;
        set y(y: number);
        protected setPosY(y: number): void;
        get z(): number;
        set z(z: number);
        protected setPosZ(z: number): void;
        get x_nonotify(): number;
        get y_nonotify(): number;
        get z_nonotify(): number;
        set x_nonotify(x: number);
        set y_nonotify(y: number);
        set z_nonotify(z: number);
        protected _size: vec3;
        get size(): vec3;
        set size(value: vec3);
        get sx(): number;
        set sx(sx: number);
        get sy(): number;
        set sy(sy: number);
        get sz(): number;
        set sz(sz: number);
        get center(): vec2;
        get center_x(): number;
        get center_y(): number;
        sc: StateMachineController;
        behaviortreeIds: {
            [id: BehaviorTreeID]: BehaviorTreeID;
        };
        get behaviortrees(): {
            [id: BehaviorTreeID]: BTNode;
        };
        blackboards: {
            [name: BehaviorTreeID]: Blackboard;
        };
        tickTree(bt_id: BehaviorTreeID): void;
        resetTree(bt_id: BehaviorTreeID): void;
        hitarea: Area;
        protected _hitpolygon: Polygon[];
        set hitpolygon(polys: Polygon[]);
        get hitpolygon(): Polygon[];
        get hasHitPolygon(): boolean;
        hittable: boolean;
        visible: boolean;
        get hitbox(): Area;
        get middlepoint(): vec2;
        get hitbox_left(): number;
        get hitbox_top(): number;
        get hitbox_right(): number;
        get hitbox_bottom(): number;
        get hitarea_left(): number;
        get hitarea_top(): number;
        get hitarea_right(): number;
        get hitarea_bottom(): number;
        get x_plus_width(): number;
        get y_plus_height(): number;
        onspawn(spawningPos?: Vector): void;
        dispose(): void;
        paint?(): void;
        postpaint?(): void;
        markForDisposal(): void;
        oncollide?: (src: GameObject) => void;
        onWallcollide?: (dir: Direction) => void;
        onLeaveScreen?: (ik: GameObject, dir: Direction, old_x_or_y: number) => void;
        onLeavingScreen?: (ik: GameObject, dir: Direction, old_x_or_y: number) => void;
        private _direction;
        oldDirection: Direction;
        get direction(): Direction;
        set direction(value: Direction);
        protected generateId(): string;
        constructor(id?: string, fsm_id?: string);
        private addAutoComponents;
        onLoadSetup(): void;
        protected initializeLinkedFSMs(): void;
        protected initializeBehaviorTrees(): void;
        collide(src: GameObject): void;
        collides(o: GameObject | Area): boolean;
        getCollisionCentroid(o: GameObject): vec2arr | null;
        detect_object_collision(o: GameObject): boolean;
        private static get_overlap_area;
        static detect_aabb_collision_areas(a1: Area, a2: Area): boolean;
        detect_aabb_collision_area(a: Area): boolean;
        static polygonsIntersect(polys1: Polygon[], polys2: Polygon[]): boolean;
        private static singlePolygonsIntersect;
        static polygonsIntersectionPoints(polys1: Polygon[], polys2: Polygon[]): vec2arr[] | null;
        private static singlePolygonsIntersectionPoints;
        static getCentroidFromIntersectionPoints(polys1: Polygon[], polys2: Polygon[]): vec2arr;
        static getCentroidFromListOfIntersectionPoints(points: vec2arr[]): vec2arr;
        static polygonAABB(poly: vec2[]): Area;
        overlaps_point(p: vec2): vec2 | null;
        run(): void;
    }
    export type GameObjectConstructorBase = new (_id?: Identifier, _fsm_id?: string, ...args: any[]) => GameObject;
    export type GameObjectConstructorBaseOrAbstract = GameObjectConstructorBase | AbstractConstructor<GameObject>;
}
declare module "component/basecomponent" {
    import { EventSubscription } from "core/eventemitter";
    import type { Disposable, Identifiable, Identifier } from "core/game";
    import { AbstractConstructor } from "core/game";
    import { type GameObjectConstructorBaseOrAbstract } from "core/gameobject";
    interface ConstructorWithAutoAddComponents {
        autoAddComponents?: ComponentConstructor<Component>[];
    }
    export type GameObjectConstructorWithComponentList = GameObjectConstructorBaseOrAbstract & ConstructorWithAutoAddComponents;
    export type KeyToComponentMap = {
        [key: string]: Component;
    };
    export type ComponentConstructor<T extends Component> = new (...args: any[]) => T | AbstractConstructor<new (...args: any[]) => T>;
    export type ComponentId = string;
    export interface ComponentContainer extends Identifiable, Disposable {
        components: KeyToComponentMap;
        getComponent<T extends Component>(constructor: ComponentConstructor<T>): T | undefined;
        addComponent<T extends Component>(component: T): void;
        removeComponent<T extends Component>(constructor: ComponentConstructor<T>): void;
        updateComponentsWithTag(tag: ComponentTag, ...args: any[]): void;
    }
    export type ComponentUpdateParams = {
        params: any[];
        returnvalue?: any;
    };
    export abstract class Component implements Identifiable {
        parentid: Identifier;
        id: ComponentId;
        static tagsPre: Set<ComponentTag>;
        static tagsPost: Set<ComponentTag>;
        static eventSubscriptions: EventSubscription[];
        get parent(): any;
        protected _enabled: boolean;
        set enabled(value: boolean);
        get enabled(): boolean;
        constructor(parentid: Identifier);
        dispose(): void;
        hasPreprocessingTag(tag: ComponentTag): boolean;
        hasPostprocessingTag(tag: ComponentTag): boolean;
        onloadSetup(): void;
        protected initEventSubscriptions(): void;
        preprocessingUpdate(..._args: any[]): void;
        postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void;
    }
    export type ComponentTag = string;
    type ConstructorWithTagsProperty = Function & {
        tagsPre?: Set<ComponentTag>;
        tagsPost?: Set<ComponentTag>;
    };
    export function componenttags_preprocessing(...tags: ComponentTag[]): (constructor: ConstructorWithTagsProperty) => void;
    export function componenttags_postprocessing(...tags: ComponentTag[]): (constructor: ConstructorWithTagsProperty) => void;
    export function update_tagged_components<T extends ComponentContainer>(...tags: ComponentTag[]): (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) => void;
    export function attach_components(...components: ComponentConstructor<Component>[]): (constructor: GameObjectConstructorWithComponentList) => void;
}
declare module "core/sprite" {
    import { Color, DrawImgOptions } from "render/view";
    import { vec3 } from "rompack/rompack";
    import { GameObject } from "core/gameobject";
    export abstract class SpriteObject extends GameObject {
        get flip_h(): boolean;
        set flip_h(fh: boolean);
        get flip_v(): boolean;
        set flip_v(fv: boolean);
        get imgid(): string;
        set imgid(id: string);
        get colorize(): Color;
        set colorize(c: Color);
        private updateHitareas;
        private static selectBoundingBox;
        private static selectConcavePolygon;
        sprite: Sprite;
        constructor(id?: string, fsm_id?: string);
        paint(): void;
    }
    export class Sprite {
        x: number;
        y: number;
        z: number;
        options: DrawImgOptions;
        get sx(): number;
        set sx(v: number);
        get sy(): number;
        set sy(v: number);
        get flip_h(): boolean;
        set flip_h(v: boolean);
        get flip_v(): boolean;
        set flip_v(v: boolean);
        get colorize(): Color;
        set colorize(v: Color);
        get imgid(): string;
        set imgid(v: string);
        constructor();
        paint_offset(offset: vec3): void;
        paint(): void;
    }
}
declare module "systems/msx" {
    import { Color } from "render/view";
    import { vec2 } from "rompack/rompack";
    export const TileSize: number;
    export class Tile {
        x: number;
        y: number;
        static create(x: number, y: number): Tile;
        constructor(x: number, y: number);
        [Symbol.toPrimitive](hint: any): any;
        static [Symbol.toPrimitive](hint: any): any;
        get stagePoint(): {
            x: number;
            y: number;
        };
        static toStageCoord(v: number): number;
        static toStagePoint(x: number, y: number): vec2;
    }
    export const MSX1ScreenWidth: number;
    export const MSX1ScreenHeight: number;
    export const MSX2ScreenWidth: number;
    export const MSX2ScreenHeight: number;
    export const Msx1Colors: Color[];
    export const Msx1ExtColors: Color[];
}
declare module "debugger/objectpropertydialog" {
    export const harmonicaExpandedStateById: Map<string, Set<string>>;
    export const harmonicaExpandedState: WeakMap<object, Set<string>>;
    export function createObjectTableElement(dialog: HTMLElement, addContentTo: HTMLElement, obj: any, objName: string, ignoreProps?: string[], parentPath?: string, depth?: number): HTMLElement;
    export class ObjectPropertyDialogOld {
        private static openDialogs;
        private dialog;
        private objectId;
        private title;
        private ignoreProps?;
        private contentDiv;
        private tableRoot;
        private valueCellMap;
        private lastObjSnapshot;
        private lastKeys;
        constructor(objectId: string, title: string, ignoreProps?: string[]);
        private renderTable;
        private buildTableRows;
        private addTableRow;
        frameUpdate(): void;
        close(): void;
        static refreshAll(): void;
        static openDialogById(objectId: string, title?: string, ignoreProps?: string[]): ObjectPropertyDialogOld;
    }
}
declare module "debugger/objectpropertydialogimproved" {
    export class ObjectPropertyDialog {
        private static openDialogs;
        private dialog;
        private objectId;
        private title;
        private contentDiv;
        private ignoreProps?;
        private treeState;
        private treeRoot;
        constructor(objectId: string, title: string, ignoreProps?: string[]);
        private renderTable;
        frameUpdate(): void;
        close(): void;
        static refreshAll(): void;
        static openDialogById(objectId: string, title?: string, ignoreProps?: string[]): ObjectPropertyDialog;
    }
    export function refreshAllObjectPropertyDialogs(): void;
    export function openObjectPropertyDialogById(objId: string, objName: string, ignoreProps?: string[], parentPath?: string): ObjectPropertyDialog;
    export function buildObjectAccordion(): void;
    export function buildObjectInspector(): void;
    export function buildObjectTable(obj: any, objName: string, ignoreProps?: string[], parentPath?: string, depth?: number): HTMLTableElement;
}
declare module "debugger/statemachinevisualizer" {
    import type { Identifier } from "core/game";
    export class StateMachineVisualizer {
        private dialog;
        private parentid;
        private machineElements;
        private stateElements;
        constructor(id: string);
        frameUpdate(): void;
        closeDialog(): void;
        openDialog(): void;
    }
    export function visualizeStateMachine(dialogElement: HTMLElement, container: HTMLElement, bfsmControllerId: Identifier): [HTMLElement, Map<string, HTMLElement>, Map<string, HTMLElement>];
    export function highlightCurrentState(stateElements: Map<string, HTMLElement>, machineElements: Map<string, HTMLElement>, bfsmControllerId: Identifier): void;
}
declare module "debugger/bmsxdebugger" {
    import { Component, ComponentUpdateParams } from "component/basecomponent";
    import type { Identifier } from "core/game";
    import { GameObject } from "core/gameobject";
    import type { vec2 } from "rompack/rompack";
    export class DebugHighlightComponent extends Component {
        protected oldPos: vec2;
        constructor(_id: Identifier);
        preprocessingUpdate(): void;
        postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void;
    }
    export class HitBoxVisualizer extends Component {
        static toggle(obj: GameObject): void;
        static attachToObject(obj: GameObject): void;
        static detachFromObject(obj: GameObject): void;
        static attachedToObject(obj: GameObject): HitBoxVisualizer;
        constructor(_id: Identifier);
        preprocessingUpdate(): void;
    }
    export class FloatingDialog {
        private dialogDiv;
        private contentDiv;
        private minimizeSpan;
        constructor(title?: string, previousDialog?: HTMLElement);
        private createDialog;
        clear(): void;
        minimize(): void;
        close(): void;
        updateSize(): void;
        getDialogElement(): HTMLDivElement;
        getContentElement(): HTMLDivElement;
    }
    export function handleOpenObjectMenu(e: UIEvent | null, previous?: HTMLElement): void;
    export function handleOpenEventEmitterMenu(previous?: HTMLElement): void;
    export function handleOpenDebugMenu(e: UIEvent): void;
    export function handleOpenModelMenu(e: UIEvent | null, previous: HTMLElement): void;
    export function handleDebugClick(e: MouseEvent): void;
    export function handleDebugMouseDown(e: MouseEvent): void;
    export function handleDebugMouseMove(e: MouseEvent): void;
    export function handleDebugMouseUp(_e: MouseEvent): void;
    export function handleDebugMouseOut(_e: MouseEvent): void;
    export function removeStateMachineVisualizer(objId: Identifier): void;
    export function handleContextMenu(e: MouseEvent): void;
}
declare module "input/inputtypes" {
    import type { Input } from "input/input";
    export type ActionStateQuery = {
        filter?: string[];
        pressed?: boolean;
        justReleased?: boolean;
        justPressed?: boolean;
        consumed?: boolean;
        pressTime?: number;
        actionsByPriority?: string[];
    };
    export type KeyboardButtonId = 'BTN1' | 'BTN2' | 'BTN3' | 'BTN4';
    export type ButtonId = string;
    export type KeyOrButtonId2ButtonState = {
        [index: ButtonId]: ButtonState;
    };
    export type KeyboardInputMapping = {
        [action: string]: KeyboardButton[];
    };
    export type GamepadInputMapping = {
        [action: string]: BGamepadButton[];
    };
    export interface InputMap {
        keyboard: KeyboardInputMapping;
        gamepad: GamepadInputMapping;
    }
    export type KeyboardButton = string | BGamepadButton;
    export type BGamepadButton = (typeof Input.BUTTON_IDS)[number];
    export type ButtonState = {
        pressed: boolean;
        justpressed: boolean;
        justreleased: boolean;
        waspressed: boolean;
        wasreleased: boolean;
        consumed: boolean;
        presstime: number | null;
        timestamp: number | null;
    };
    export type InputEvent = {
        eventType: 'press' | 'release';
        identifier: ButtonId;
        timestamp: number;
        consumed: boolean;
    };
    export type ActionState = {
        action: string;
        alljustpressed: boolean;
        allwaspressed: boolean;
        alljustreleased: boolean;
    } & ButtonState;
    export interface VibrationParams {
        effect: GamepadHapticEffectType;
        duration: number;
        intensity: number;
    }
    export interface InputHandler {
        pollInput(): void;
        getButtonState(btn: ButtonId): ButtonState;
        consumeButton(button: ButtonId): void;
        reset(except?: string[]): void;
        get gamepadIndex(): number;
        applyVibrationEffect: (params: VibrationParams) => void;
        get supportsVibrationEffect(): boolean;
        dispose(): void;
    }
}
declare module "input/dualsensehid" {
    type HidPadKind = 'ds5_usb' | 'ds4_usb' | 'ds5_bt' | 'ds4_bt' | null;
    export interface HidRumbleParams {
        strong: number;
        weak: number;
        duration: number;
    }
    export class DualSenseHID {
        private device;
        private rumbleTimer;
        private kind;
        private assignedIndex;
        private static assignedDevices;
        private static pendingRequest;
        private static requestHidPermission;
        private matchIds;
        get isConnected(): boolean;
        get padKind(): HidPadKind | null;
        get isDualShock4(): boolean;
        private parseGamepadId;
        init(gamepad?: Gamepad): Promise<void>;
        private detectPadKind;
        correlateWithInput(gamepad: Gamepad, candidates: HIDDevice[], timeoutMs?: number): Promise<HIDDevice | null>;
        stop(): void;
        sendRumble({ strong, weak, duration }: HidRumbleParams): void;
        private buildDualSenseReport;
        private buildDs4Report;
        private crc32_bt;
        private buildDs4BtReport;
        private buildDs5BtReport;
        close(): Promise<void>;
    }
}
declare module "input/gamepad" {
    import type { ButtonState, InputHandler, VibrationParams } from "input/inputtypes";
    export class GamepadInput implements InputHandler {
        get gamepadIndex(): number | null;
        private _gamepad;
        private hidPad;
        private isDs4Gamepad;
        get gamepad(): Gamepad;
        private gamepadButtonStates;
        get supportsVibrationEffect(): boolean;
        private parseGamepadId;
        private updateDs4Flag;
        private isDualShock4;
        applyVibrationEffect(params: VibrationParams): void;
        init(): Promise<void>;
        constructor(gamepad: Gamepad);
        pollInput(): void;
        private pollGamepadAxes;
        private pollGamepadButtons;
        getButtonState(btn: string): ButtonState;
        consumeButton(button: string): void;
        reset(except?: string[]): void;
        dispose(): void;
    }
}
declare module "input/keyboardinput" {
    import type { ButtonState, InputHandler, KeyboardButtonId, KeyOrButtonId2ButtonState, VibrationParams } from "input/inputtypes";
    export class KeyboardInput implements InputHandler {
        keyStates: KeyOrButtonId2ButtonState;
        gamepadButtonStates: KeyOrButtonId2ButtonState;
        get supportsVibrationEffect(): boolean;
        applyVibrationEffect(_params: VibrationParams): void;
        readonly gamepadIndex = 0;
        constructor();
        reset(except?: string[]): void;
        consumeButton(key: string): void;
        getButtonState(key: string): ButtonState;
        pollInput(): void;
        keydown(key_code: KeyboardButtonId | string): void;
        keyup(key_code: KeyboardButtonId | string): void;
        blur(_e: FocusEvent): void;
        focus(_e: FocusEvent): void;
        dispose(): void;
    }
}
declare module "input/onscreengamepad" {
    import type { VibrationParams } from "input/inputtypes";
    import { ButtonState, InputHandler } from "input/inputtypes";
    export class OnscreenGamepad implements InputHandler {
        readonly gamepadIndex = 7;
        get supportsVibrationEffect(): boolean;
        applyVibrationEffect(params: VibrationParams): void;
        private gamepadButtonStates;
        static hideButtons(gamepad_button_ids: string[]): void;
        getButtonState(btn: string): ButtonState;
        pollInput(): void;
        private isOtherElementPressingButton;
        consumeButton(button: string): void;
        private static readonly DPAD_BUTTON_MAP;
        private static readonly ACTION_BUTTON_MAP;
        private static readonly ACTION_BUTTON_TO_ELEMENTID_MAP;
        private static readonly ALL_BUTTON_MAP;
        private static readonly DPAD_BUTTON_ELEMENT_IDS;
        private static readonly ACTION_BUTTON_ELEMENT_IDS;
        private static readonly ONSCREEN_BUTTON_ELEMENT_NAMES;
        init(): void;
        reset(except?: string[]): void;
        resetUI(elementsToFilterById?: string[]): void;
        handleTouchMove(e: TouchEvent, control_type: 'dpad' | 'action'): void;
        handleTouchStart(e: TouchEvent, control_type: 'dpad' | 'action'): void;
        handleTouchEnd(_e: TouchEvent, control_type: 'dpad' | 'action'): void;
        blur(_e: FocusEvent): void;
        focus(_e: FocusEvent): void;
        dispose(): void;
    }
}
declare module "input/pendingassignmentprocessor" {
    import type { InputHandler } from "input/inputtypes";
    export class PendingAssignmentProcessor {
        inputHandler: InputHandler;
        proposedPlayerIndex: number | null;
        private static readonly joystick_icon_start;
        private static readonly joystick_icon_increment_x;
        private get pendingIndex();
        private icon;
        private checkNonConsumedPressed;
        private calcIconPositionX;
        private handleSelectPlayerIndexButtonPress;
        private createSelectPlayerIconIfNeeded;
        constructor(inputHandler: InputHandler, proposedPlayerIndex: number | null);
        run(): Promise<void>;
        removeIcon(): void;
    }
}
declare module "input/actionparser" {
    import type { ActionState } from "input/inputtypes";
    export class ActionDefinitionEvaluator {
        private static cache;
        static clearCache(): void;
        static checkActionTriggered(def: string, get: (n: string, w?: number) => ActionState): boolean;
    }
}
declare module "input/playerinput" {
    import type { ActionState, ActionStateQuery, ButtonId, ButtonState, InputHandler, InputMap, VibrationParams } from "input/inputtypes";
    export class PlayerInput {
        playerIndex: number;
        inputHandlers: {
            [key in 'keyboard' | 'gamepad']: InputHandler | null;
        };
        private previousStates;
        private stateManager;
        private get isMainPlayer();
        private inputMap;
        checkActionTriggered(actionDefinition: string): boolean;
        checkActionsTriggered(...actions: {
            id: string;
            def: string;
        }[]): string[];
        setInputMap(inputMap: InputMap): void;
        get supportsVibrationEffect(): boolean;
        applyVibrationEffect(params: VibrationParams): void;
        getActionState(action: string, framewindow?: number): ActionState;
        getPressedActions(query?: ActionStateQuery): ActionState[];
        consumeAction(actionToConsume: ActionState | string): void;
        consumeActions(...actions: (ActionState | string)[]): void;
        getButtonState(button: ButtonId, source: 'keyboard' | 'gamepad'): ButtonState;
        isButtonDown(button: ButtonId, source: 'keyboard' | 'gamepad'): boolean;
        checkAndConsume(key: ButtonId, button?: ButtonId): boolean;
        assignGamepadToPlayer(gamepadInput: InputHandler): void;
        pollInput(): void;
        update(currentTime: number): void;
        constructor(playerIndex: number);
        private isKeyboardConnected;
        private isGamepadConnected;
        reset(except?: string[]): void;
    }
}
declare module "input/input" {
    import type { Identifier, RegisterablePersistent } from "core/game";
    import type { ActionState, ButtonId, ButtonState, InputEvent, InputHandler, KeyOrButtonId2ButtonState } from "input/inputtypes";
    import { OnscreenGamepad } from "input/onscreengamepad";
    import { PlayerInput } from "input/playerinput";
    export function resetObject(obj: any, except?: string[]): void;
    export function getPressedState(stateMap: KeyOrButtonId2ButtonState, keyOrButtonId: ButtonId): ButtonState;
    export function makeButtonState(partialState?: Partial<ButtonState>): ButtonState;
    export function makeActionState(actionname: string, partialState?: Partial<ActionState>): ActionState;
    export const options: EventListenerOptions & {
        passive: boolean;
        once: boolean;
    };
    export class InputStateManager {
        bufferframeDuration: number;
        private inputBuffer;
        get bufferWindowDuration(): number;
        private toMs;
        constructor(bufferframeDuration?: number);
        update(currentTime: number): void;
        addInputEvent(event: InputEvent): void;
        getButtonState(identifier: ButtonId, framewindow?: number): ButtonState;
        consumeBufferedEvent(identifier: ButtonId): void;
    }
    export class Input implements RegisterablePersistent {
        get registrypersistent(): true;
        private static _instance;
        static readonly PLAYERS_MAX = 4;
        static readonly PLAYER_MAX_INDEX: number;
        static readonly DEFAULT_KEYBOARD_PLAYER_INDEX = 1;
        static readonly DEFAULT_ONSCREENGAMEPAD_PLAYER_INDEX = 1;
        static initialize(startingGamepadIndex?: number): Input;
        static get instance(): Input;
        private playerInputs;
        private pendingGamepadAssignments;
        private onscreenGamepad;
        getOnscreenGamepad(): OnscreenGamepad;
        getPlayerInput(playerIndex: number): PlayerInput;
        hideOnscreenGamepadButtons(gamepad_button_ids: string[]): void;
        static readonly BUTTON_IDS: readonly ["a", "b", "x", "y", "lb", "rb", "lt", "rt", "select", "start", "ls", "rs", "up", "down", "left", "right", "home", "touch"];
        static readonly KEYBOARDKEY2GAMEPADBUTTON: {
            readonly ArrowUp: "up";
            readonly ArrowLeft: "left";
            readonly ArrowRight: "right";
            readonly ArrowDown: "down";
            readonly KeyX: "b";
            readonly KeyA: "x";
            readonly KeyZ: "a";
            readonly ShiftLeft: "y";
            readonly KeyQ: "lb";
            readonly KeyW: "rb";
            readonly Digit1: "lt";
            readonly Digit3: "rt";
            readonly ShiftRight: "select";
            readonly Enter: "start";
            readonly KeyF: "ls";
            readonly KeyG: "rs";
            readonly KeyH: "home";
            readonly KeyT: "touch";
        };
        static readonly INDEX2BUTTON: {
            readonly 0: "a";
            readonly 1: "b";
            readonly 2: "x";
            readonly 3: "y";
            readonly 4: "lb";
            readonly 5: "rb";
            readonly 6: "lt";
            readonly 7: "rt";
            readonly 8: "select";
            readonly 9: "start";
            readonly 10: "ls";
            readonly 11: "rs";
            readonly 12: "up";
            readonly 13: "down";
            readonly 14: "left";
            readonly 15: "right";
            readonly 16: "home";
            readonly 17: "touch";
        };
        static preventDefaultEventAction(e: UIEvent, key: string): void;
        get id(): Identifier;
        constructor(startingGamepadIndex?: number);
        get isOnscreenGamepadEnabled(): boolean;
        enableOnscreenGamepad(): void;
        enableDebugMode(): void;
        dispose(): void;
        pollInput(): void;
        getFirstAvailablePlayerIndexForGamepadAssignment(from?: number, reverse?: boolean): number | null;
        isPlayerIndexAvailableForGamepadAssignment(playerIndex: number): boolean;
        private addPendingGamepadAssignment;
        removePendingGamepadAssignment(gamepadIndex: number): void;
        assignGamepadToPlayer(gamepad: InputHandler, playerIndex: number): void;
        static get KC_F1(): boolean;
        static get KC_F12(): boolean;
        static get KC_F2(): boolean;
        static get KC_F3(): boolean;
        static get KC_F4(): boolean;
        static get KC_F5(): boolean;
        static get KC_M(): boolean;
        static get KC_SPACE(): boolean;
        static get KC_UP(): boolean;
        static get KC_RIGHT(): boolean;
        static get KC_DOWN(): boolean;
        static get KC_LEFT(): boolean;
        static get KC_BTN1(): boolean;
        static get KC_BTN2(): boolean;
        static get KC_BTN3(): boolean;
        static get KC_BTN4(): boolean;
        static get KD_F1(): boolean;
        static get KD_F12(): boolean;
        static get KD_F2(): boolean;
        static get KD_F3(): boolean;
        static get KD_F4(): boolean;
        static get KD_F5(): boolean;
        static get KD_M(): boolean;
        static get KD_SPACE(): boolean;
        static get KD_UP(): boolean;
        static get KD_RIGHT(): boolean;
        static get KD_DOWN(): boolean;
        static get KD_LEFT(): boolean;
        static get KD_BTN1(): boolean;
        static get KD_BTN2(): boolean;
        static get KD_BTN3(): boolean;
        static get KD_BTN4(): boolean;
        private handleDebugEvents;
    }
}
declare module "render/textwriter" {
    import { BFont } from "core/game";
    import { Color } from "render/view";
    export class TextWriter {
        static drawText(x: number, y: number, textToWrite: string | string[], z?: number, _font?: BFont, color?: Color, backgroundColor?: Color): void;
    }
}
declare module "core/game" {
    import { RandomModulationParams, SM } from "audio/soundmaster";
    import { Input } from "input/input";
    import type { InputMap, VibrationParams } from "input/inputtypes";
    import { ActionState, ActionStateQuery } from "input/inputtypes";
    import { BaseView, Color, DrawImgOptions, DrawRectOptions } from "render/view";
    import { Area, RomPack, Size, vec2, vec3, Vector } from "rompack/rompack";
    import { BaseModel } from "core/basemodel";
    import { EventEmitter } from "core/eventemitter";
    import { GameObject } from "core/gameobject";
    import { Registry } from "core/registry";
    global {
        var $: Game;
        var $rom: RomPack;
        var debug: boolean;
    }
    export interface GameInitArgs<M extends BaseModel = BaseModel, V extends BaseView = BaseView> {
        rom: RomPack;
        model: M;
        view: V;
        sndcontext: AudioContext;
        gainnode: GainNode;
        debug?: boolean;
        startingGamepadIndex?: number | null;
    }
    export const GameOptions: {
        canvas_or_onscreengamepad_must_respect_lebensraum: "canvas" | "gamepad";
        Scale: number;
        Fullscreen: boolean;
        VolumePercentage: number;
        readonly WindowWidth: number;
        readonly WindowHeight: number;
        readonly BufferWidth: number;
        readonly BufferHeight: number;
    };
    export namespace Constants {
        const IMAGE_PATH: string;
        const AUDIO_PATH: string;
        const SaveSlotCount: number;
        const SaveSlotCheckpoint: number;
        const SaveGamePath: string;
        const CheckpointGamePath: string;
        const OptionsPath: string;
    }
    export type AbstractConstructor<T> = Function & {
        prototype: T;
    };
    export type Direction = 'none' | 'up' | 'right' | 'down' | 'left';
    export type Identifier = string | 'model';
    export interface Identifiable {
        id: Identifier;
    }
    export interface Parentable {
        parentid?: Identifier;
    }
    export interface Disposable {
        dispose(): void;
    }
    export interface Registerable extends Identifiable, Disposable {
        registrypersistent?: boolean;
    }
    export interface RegisterablePersistent extends Registerable {
        registrypersistent: true;
    }
    export class BFont {
        protected accessor font_res_map: Record<string, string>;
        char_width(letter: string): number;
        char_height(letter: string): number;
        readonly letter_to_img: Record<string, string>;
        constructor(_font_res_map: Record<string, string>);
        char_to_img(c: string): string;
    }
    export function mod(n: number, p: number): number;
    export function moveArea(a: Area, p: vec3): Area;
    export function translate_vec2(a: vec2, b: vec2): vec2;
    export function translate_inplace_vec2(a: vec2, b: vec2): void;
    export function translate_vec3(a: vec3, b: vec3): vec3;
    export function translate_inplace_vec3(a: vec3, b: vec3): void;
    export function randomInt(min: number, max: number): number;
    export function new_vec2(x: number, y: number): vec2;
    export function new_vec3(x: number, y: number, z: number): vec3;
    export function copy_vector(toCopy: Vector): Vector;
    export function trunc_vec2(p: vec2): vec2;
    export function trunc_vec3(p: vec3): vec3;
    export function multiply_vec(toMult: Vector, factor: number): Vector;
    export function multiply_vec2(toMult: vec2, factor: number): vec2;
    export function div_vec2(toDivide: vec2, divide_by: number): vec2;
    export function set_inplace_area(a: Area, n: Area): void;
    export function new_area(sx: number, sy: number, ex: number, ey: number): Area;
    export function new_area3d(sx: number, sy: number, sz: number, ex: number, ey: number, ez?: number): Area;
    export function middlepoint_area(a: Area): vec2;
    export function set_vec2(p: vec2, new_x: number, new_y: number): void;
    export function set_inplace_vec2(p: vec2, n: vec2): void;
    export function set_vec3(p: vec3, new_x: number, new_y: number, new_z: number): void;
    export function set_inplace_vec3(to_overwrite: vec3, data: vec3): void;
    export function setSize(s: Size, new_x: number, new_y: number): void;
    export function area2size(a: Area): {
        x: number;
        y: number;
    };
    export function addElementToScreen(element: HTMLElement): void;
    export function removeElementFromScreen(element: HTMLElement): void;
    export function createDivSprite(img?: HTMLImageElement, imgsrc?: string | null, classnames?: string[] | null): HTMLDivElement;
    export function GetDeltaFromSourceToTarget(source: vec2, target: vec2): vec2;
    export function LineLength(p1: vec3, p2: vec3): number;
    export function isStorageAvailable(storageType: string): boolean;
    export function isLocalStorageAvailable(): boolean;
    export function isSessionStorageAvailable(): boolean;
    export function getLookAtDirection(subjectpos: vec2, targetpos: vec2): Direction;
    export function getOppositeDirection(dir: Direction): Direction;
    interface RewindFrame {
        timestamp: number;
        frame: number;
        state: Uint8Array;
    }
    export class Game<M extends BaseModel = BaseModel, V extends BaseView = BaseView> {
        private _debug;
        private initialized;
        get debug(): boolean;
        targetFPS: number;
        updateInterval: number;
        lastUpdate: number;
        deltaTime: number;
        accumulatedTime: number;
        last_gametick_time: number;
        _turnCounter: number;
        animationFrameRequestid: number;
        running: boolean;
        private _paused;
        get paused(): boolean;
        set paused(value: boolean);
        wasupdated: boolean;
        debug_runSingleFrameAndPause: boolean;
        get rom(): RomPack;
        modelAs<T extends BaseModel = BaseModel>(): T;
        get model(): M;
        viewAs<T extends BaseView = BaseView>(): T;
        get view(): V;
        get event_emitter(): EventEmitter;
        get input(): Input;
        get registry(): Registry;
        get sndmaster(): SM;
        emit(event_name: string, emitter: Identifiable, ...args: any[]): void;
        get<T extends Registerable>(id: Identifier): T;
        getGameObject<T extends GameObject>(id: Identifier): T;
        has(id: Identifier): boolean;
        register(value: Registerable): void;
        deregister(id: Identifier | Registerable): void;
        spawn(o: GameObject, pos?: Vector, ignoreSpawnhandler?: boolean): void;
        exile(o: GameObject): void;
        drawImg(options: DrawImgOptions): void;
        drawRectangle(options: DrawRectOptions): void;
        fillRectangle(options: DrawRectOptions): void;
        drawText(x: number, y: number, textToWrite: string | string[], z?: number, font?: BFont, color?: Color, backgroundColor?: Color): void;
        playAudio(id: string, options?: RandomModulationParams): void;
        stopEffect(): void;
        stopMusic(): void;
        set volume(volume: number);
        get volume(): number;
        setInputMap(playerIndex: number, map: InputMap): void;
        checkActionTriggered(playerIndex: number, action: string): boolean;
        checkActionsTriggered(playerIndex: number, ...actions: {
            id: string;
            def: string;
        }[]): string[];
        getActionState(playerIndex: number, action: string, window?: number): ActionState;
        getPressedActions(playerIndex: number, query?: ActionStateQuery): ActionState[];
        consumeAction(playerIndex: number, actionToConsume: ActionState | string): void;
        consumeActions(playerIndex: number, ...actionsToConsume: (ActionState | string)[]): void;
        applyVibrationEffect(playerIndex: number, effectParams: VibrationParams): void;
        hideOnscreenGamepadButtons(gamepad_button_ids: string[]): void;
        getViewportSize(): Size;
        private rewindBuffer;
        private readonly REWINDBUFFER_LENGTH_SECONDS;
        constructor();
        init(init: GameInitArgs<M, V>): Promise<Game>;
        get turnCounter(): number;
        start(): void;
        update(deltaTime: number): void;
        run(currentTime: number): void;
        stop(): void;
        canRewind(): boolean;
        canForward(): boolean;
        private loadRewindFrame;
        rewindFrame(): boolean;
        forwardFrame(): boolean;
        jumpToFrame(idx: number): boolean;
        getRewindFrames(): RewindFrame[];
        resetRewind(): void;
        getCurrentRewindFrameIndex(): number;
    }
}
declare module "ai/behaviourtree" {
    import type { Identifiable, Identifier } from "core/game";
    import { GameObject } from "core/gameobject";
    export type BehaviorTreeDefinition = {
        type: 'Selector';
        children: BehaviorTreeDefinition[];
        priority?: number;
    } | {
        type: 'Sequence';
        children: BehaviorTreeDefinition[];
        priority?: number;
    } | {
        type: 'Parallel';
        children: BehaviorTreeDefinition[];
        successPolicy: 'ONE' | 'ALL';
        priority?: number;
    } | {
        type: 'Decorator';
        child: BehaviorTreeDefinition;
        decorator: NodeDecorator;
        priority?: number;
    } | {
        type: 'Condition';
        condition: NodeCondition;
        modifier?: NodeConditionModifier;
        parameters?: any[];
        priority?: number;
    } | {
        type: 'CompositeCondition';
        conditions: NodeCondition[];
        modifier: NodeCompositeConditionModifier;
        parameters?: any[];
        priority?: number;
    } | {
        type: 'RandomSelector';
        children: BehaviorTreeDefinition[];
        currentchild_propname: string;
        priority?: number;
    } | {
        type: 'Limit';
        child: BehaviorTreeDefinition;
        limit: number;
        count_propname: string;
        priority?: number;
    } | {
        type: 'PrioritySelector';
        children: BehaviorTreeDefinition[];
        priority?: number;
    } | {
        type: 'Wait';
        wait_time: number;
        wait_propname: string;
        priority?: number;
    } | {
        type: 'Action';
        action: NodeAction;
        parameters?: any[];
        priority?: number;
    } | {
        type: 'CompositeAction';
        actions: BehaviorTreeDefinition[];
        parameters?: any[];
        priority?: number;
    };
    export var BehaviorTreeDefinitions: {
        [key: BehaviorTreeID]: BehaviorTreeDefinition;
    } | null;
    export var BehaviorTrees: {
        [key: BehaviorTreeID]: BTNode;
    } | null;
    export function setup_bt_library(): void;
    export function setup_btdef_library(): void;
    export type ConstructorWithBTProperty = Function & {
        linkedBTs?: Set<BehaviorTreeID>;
    };
    export function assign_bt(...bts: BehaviorTreeID[]): (constructor: ConstructorWithBTProperty) => void;
    export function build_bt(bt_id?: BehaviorTreeID): (target: any, _name: any, descriptor: PropertyDescriptor) => any;
    export function constructBehaviorTree(bt_id: BehaviorTreeID): BTNode | null;
    export type BTStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';
    export type BTNodeFeedback = {
        status: BTStatus;
        updates?: (blackboard: Blackboard) => void;
    };
    export class Blackboard implements Identifiable {
        id: string;
        data: {
            [key: string]: any;
        };
        nodedata: {
            [key: string]: any;
        };
        executionPath: {
            node: BTNode;
            result: BTNodeFeedback;
        }[];
        constructor(_id: string);
        set<T>(key: string, value: T): void;
        get<T>(key: string): T | undefined;
        clearAllNodeData(): void;
        get actionInProgress(): boolean;
        set actionInProgress(inProgress: boolean);
        applyUpdates(updates: {
            [id: string]: Array<{
                property: string;
                value: any;
                key?: string;
            }>;
        }): void;
        copyPropertiesToBlackboard<T extends GameObject>(target: T, properties: Array<{
            property: keyof T;
            key?: string;
        }>): void;
    }
    export type BehaviorTreeID = string;
    export abstract class BTNode implements Identifiable {
        id: BehaviorTreeID;
        priority: number;
        private running;
        get isRunning(): boolean;
        start(): void;
        stop(): void;
        getTarget<T extends GameObject>(targetid: Identifier): T;
        constructor(id: BehaviorTreeID, _priority?: number);
        debug_tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
        abstract tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    export abstract class ParametrizedBTNode extends BTNode {
        parameters: any[];
        constructor(id: BehaviorTreeID, _priority?: number, parameters?: any[]);
    }
    export class SequenceNode extends BTNode {
        children: BTNode[];
        constructor(id: BehaviorTreeID, children: BTNode[], _priority?: number);
        tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    export class SelectorNode extends BTNode {
        children: BTNode[];
        constructor(id: BehaviorTreeID, children: BTNode[], _priority?: number);
        tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    export class ParallelNode extends BTNode {
        children: BTNode[];
        successPolicy: 'ONE' | 'ALL';
        constructor(id: BehaviorTreeID, children: BTNode[], successPolicy: 'ONE' | 'ALL', _priority?: number);
        tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    type NodeDecorator = (status: BTStatus, targetid: Identifier, blackboard: Blackboard) => BTStatus;
    export class DecoratorNode extends BTNode {
        child: BTNode;
        decorator: (status: BTStatus, targetid: Identifier, blackboard: Blackboard) => BTStatus;
        constructor(id: BehaviorTreeID, child: BTNode, decorator: NodeDecorator, _priority?: number);
        tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    export const InvertorDecorator: NodeDecorator;
    export const WaitForActionCompletionDecorator: NodeDecorator;
    type NodeCondition = (blackboard: Blackboard, ...parameters: any[]) => boolean;
    type NodeConditionModifier = 'NOT' | null;
    type NodeCompositeConditionModifier = 'AND' | 'OR';
    export class ConditionNode extends ParametrizedBTNode {
        condition: NodeCondition;
        modifier: NodeConditionModifier;
        constructor(id: BehaviorTreeID, condition: (blackboard: Blackboard) => boolean, modifier: NodeConditionModifier, _priority?: number, parameters?: any[]);
        tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    export class CompositeConditionNode extends ParametrizedBTNode {
        conditions: NodeCondition[];
        operator: NodeCompositeConditionModifier;
        constructor(id: BehaviorTreeID, conditions: NodeCondition[], operator: NodeCompositeConditionModifier, _priority?: number, parameters?: any[]);
        tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    export class RandomSelectorNode extends BTNode {
        children: BTNode[];
        currentchild_propname: string;
        constructor(id: BehaviorTreeID, children: BTNode[], _currentchild_propname: string, _priority?: number);
        tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    export class LimitNode extends BTNode {
        count_propname: string;
        limit: number;
        child: BTNode;
        constructor(id: BehaviorTreeID, limit: number, _count_propname: string, child: BTNode, _priority?: number);
        tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    export class PrioritySelectorNode extends BTNode {
        children: BTNode[];
        constructor(id: BehaviorTreeID, children: BTNode[], _priority?: number);
        tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    export class WaitNode extends BTNode {
        wait_propname: string;
        wait_time: number;
        constructor(id: BehaviorTreeID, waitTime: number, _wait_propname: string, _priority?: number);
        tick(_targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    export type NodeAction = (blackboard: Blackboard, ...parameters: any[]) => BTStatus;
    export class ActionNode extends ParametrizedBTNode {
        action: NodeAction;
        constructor(id: BehaviorTreeID, action: NodeAction, _priority?: number, parameters?: any[]);
        tick(targetId: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
    export class CompositeActionNode extends ParametrizedBTNode {
        actions: ActionNode[];
        constructor(id: BehaviorTreeID, actions: ActionNode[], _priority?: number, parameters?: any[]);
        tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
    }
}
declare module "component/collisioncomponents" {
    import type { Identifier } from "core/game";
    import { Direction } from "core/game";
    import { GameObject } from "core/gameobject";
    import { vec2 } from "rompack/rompack";
    import { Component, ComponentUpdateParams } from "component/basecomponent";
    export abstract class PositionUpdateAxisComponent extends Component {
        protected oldPos: vec2;
        constructor(_id: Identifier);
        preprocessingUpdate(): void;
    }
    export class ScreenBoundaryComponent extends PositionUpdateAxisComponent {
        postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void;
        private checkBoundaryForXAxis;
        private checkBoundaryForYAxis;
    }
    export class TileCollisionComponent extends PositionUpdateAxisComponent {
        postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void;
        protected checkTileCollisionForXAxis(this: GameObject, oldx: number, newx: number): void;
        protected checkTileCollisionForYAxis(this: GameObject, oldy: number, newy: number): void;
    }
    export class ProhibitLeavingScreenComponent extends ScreenBoundaryComponent {
        onLeavingScreen(_event_name: string, emitter: GameObject, d: Direction, old_x_or_y: number): void;
    }
    export function leavingScreenHandler_prohibit(ik: GameObject, d: Direction, old_x_or_y: number): void;
}
declare module "debugger/behaviourtreevisualizer" {
    import { Component } from "component/basecomponent";
    import type { Identifier } from "core/game";
    export class BTVisualizer extends Component {
        private dialog;
        private machineElements;
        constructor(_id: string);
        postprocessingUpdate(): void;
        closeDialog(): void;
        openDialog(): void;
    }
    export function visualizeBehaviorTree(container: HTMLElement, btControllerId: Identifier): [HTMLElement, Map<string, HTMLElement>];
}
declare module "ui/gamestatedialog" {
    export function show_download_savestate_dialog(): void;
    export function show_openfile_dialog(options: {
        multiple: boolean;
        accept: string;
        eventlistener: (this: HTMLInputElement, ev: Event) => any;
    }): void;
    export function show_load_savestate_dialog(): void;
}
declare module "component/transformcomponent" {
    import { Component } from "component/basecomponent";
    import { Mat4 } from "render/math3d";
    import type { vec3arr } from "rompack/rompack";
    import type { Identifier } from "core/game";
    export class TransformComponent extends Component {
        position: vec3arr;
        rotation: vec3arr;
        scale: vec3arr;
        private _parentNode;
        private children;
        private localMatrix;
        private worldMatrix;
        private dirty;
        constructor(parentid: Identifier, opts?: {
            position?: vec3arr;
            rotation?: vec3arr;
            scale?: vec3arr;
        });
        get parentNode(): TransformComponent | null;
        set parentNode(p: TransformComponent | null);
        markDirty(): void;
        private updateMatrices;
        getWorldMatrix(): Mat4;
        postprocessingUpdate(): void;
    }
}
declare module "core/mesh" {
    import { GameObject } from "core/gameobject";
    import type { vec3arr, OBJModel } from "rompack/rompack";
    import { Color } from "render/view";
    import { Material } from "render/material";
    import { ShadowMap } from "render/shadowmap";
    export class Mesh {
        positions: Float32Array;
        texcoords: Float32Array;
        normals: Float32Array | null;
        color: Color;
        atlasId: number;
        material?: Material;
        shadow?: {
            map: ShadowMap;
            matrix: Float32Array;
            strength: number;
        };
        constructor(opts?: {
            positions?: Float32Array;
            texcoords?: Float32Array;
            normals?: Float32Array;
            color?: Color;
            atlasId?: number;
            material?: Material;
        });
    }
    export abstract class MeshObject extends GameObject {
        mesh: Mesh;
        rotation: vec3arr;
        scale: vec3arr;
        constructor(id?: string, fsm_id?: string);
        setModel(model: OBJModel): void;
        paint(): void;
    }
}
declare module "render/meshinstance" {
    export interface InstancedMeshData {
        positions: Float32Array;
        texcoords: Float32Array;
        normals?: Float32Array;
        count: number;
    }
    export class InstancingGroup {
        private instances;
        addInstance(matrix: Float32Array): void;
        clear(): void;
        get instanceCount(): number;
        get instanceMatrices(): Float32Array[];
    }
}
declare module "bmsx" {
    export * from "ai/behaviourtree";
    export * from "audio/psg";
    export * from "audio/soundmaster";
    export * from "component/basecomponent";
    export * from "component/collisioncomponents";
    export * from "core/basemodel";
    export * from "core/eventemitter";
    export * from "core/game";
    export * from "core/gameobject";
    export * from "core/objecttracker";
    export * from "core/registry";
    export * from "core/sprite";
    export * from "debugger/behaviourtreevisualizer";
    export * from "debugger/bmsxdebugger";
    export * from "debugger/objectpropertydialog";
    export * from "debugger/objectpropertydialogimproved";
    export * from "debugger/rewindui";
    export * from "debugger/statemachinevisualizer";
    export * from "fsm/fsmcontroller";
    export * from "fsm/fsmdecorators";
    export * from "fsm/fsmlibrary";
    export * from "fsm/fsmtypes";
    export * from "fsm/state";
    export * from "fsm/statedefinition";
    export * from "input/actionparser";
    export * from "input/gamepad";
    export * from "input/input";
    export * from "input/inputtypes";
    export * from "input/keyboardinput";
    export * from "input/onscreengamepad";
    export * from "input/pendingassignmentprocessor";
    export * from "input/playerinput";
    export * from "render/glview";
    export * from "render/textwriter";
    export * from "render/view";
    export * from "rompack/rompack";
    export * from "serializer/bincompressor";
    export * from "serializer/binencoder";
    export * from "serializer/gameserializer";
    export * from "systems/msx";
    export * from "ui/gamestatedialog";
    export * from "render/math3d";
    export * from "render/camera3d";
    export * from "core/mesh";
    export * from "render/light";
    export * from "core/cameraobject";
    export * from "core/lightobject";
    export * from "component/transformcomponent";
    export * from "render/material";
    export * from "render/shadowmap";
    export * from "render/meshinstance";
}
