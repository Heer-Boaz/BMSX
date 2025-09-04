import { AudioEventMapEntry } from '../audio/audioeventmanager';
import { StateMachineBlueprint } from '../fsm/fsmtypes';
import { quat } from '../render/3d/math3d';
import { TextureKey } from '../render/texturemanager';
export interface RomPack {
    rom: ArrayBuffer;
    img: id2imgres;
    audio: id2res;
    model: id2model;
    data: id2data;
    code: string;
    fsm: id2fsm;
    audioevents: id2audioevent;
}
export type asset_type = 'image' | 'audio' | 'code' | 'data' | 'atlas' | 'romlabel' | 'model' | 'fsm' | 'aem';
export type asset_id = string | number;
export interface RomAsset {
    resid: asset_id;
    resname: string;
    type: asset_type;
    start?: number;
    end?: number;
    metabuffer_start?: number;
    metabuffer_end?: number;
    buffer?: Buffer;
    texture_buffer?: Buffer;
    imgmeta?: ImgMeta;
    audiometa?: AudioMeta;
    texture_start?: number;
    texture_end?: number;
}
export interface RomImgAsset extends RomAsset {
    _imgbin: ImageBitmap;
    _imgbinYFlipped: ImageBitmap;
    get imgbin(): Promise<ImageBitmap>;
    get imgbinYFlipped(): Promise<ImageBitmap>;
}
export interface RomMeta {
    start: number;
    end: number;
}
export type id2res = Record<asset_id, RomAsset>;
export type id2imgres = Record<asset_id, RomImgAsset>;
export type id2model = Record<asset_id, GLTFModel>;
export type id2data = Record<asset_id, any>;
export type id2htmlimg = Record<asset_id, ImageBitmap>;
export type id2fsm = Record<asset_id, StateMachineBlueprint>;
export type id2audioevent = Record<asset_id, AudioEventMapEntry>;
export type BitmapId = asset_id;
export type AudioId = asset_id;
export type ModelId = asset_id;
export type DataId = asset_id;
export type FsmId = asset_id;
export interface BootArgs {
    rompack: RomPack;
    sndcontext: AudioContext;
    gainnode: GainNode;
    debug?: boolean;
    startingGamepadIndex?: number | null;
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
export interface RegisterablePersistent extends Registerable, Identifiable, Disposable {
    registrypersistent: true;
}
export type AudioType = 'sfx' | 'music' | 'ui';
export declare const AudioTypes: readonly AudioType[];
export type vec2arr = [number, number];
export type vec3arr = [number, number, number];
export type vec4arr = [number, number, number, number];
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
export type x_y_w_h_arr = vec4arr;
export interface Area {
    start: Vector;
    end: Vector;
}
export type Polygon = number[];
export interface Oriented {
    rotationQ: quat;
}
export interface Scaled {
    scale: vec3arr;
}
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
export type color_arr = vec4arr;
export interface GLTFMaterial {
    baseColorFactor?: color_arr;
    metallicFactor?: number;
    roughnessFactor?: number;
    baseColorTexture?: number;
    normalTexture?: number;
    metallicRoughnessTexture?: number;
}
export interface GLTFMesh {
    positions: Float32Array;
    texcoords?: Float32Array;
    normals?: Float32Array | null;
    tangents?: Float32Array | null;
    indices?: Uint16Array | Uint32Array;
    indexComponentType?: number;
    materialIndex?: number;
    morphPositions?: Float32Array[];
    morphNormals?: Float32Array[];
    morphTangents?: Float32Array[];
    weights?: number[];
    jointIndices?: Uint16Array;
    jointWeights?: Float32Array;
}
export interface GLTFAnimationSampler {
    interpolation: string;
    input: Float32Array;
    output: Float32Array;
}
export interface GLTFAnimationChannel {
    sampler: number;
    target: {
        node?: number;
        path: string;
    };
}
export interface GLTFAnimation {
    name?: string;
    samplers: GLTFAnimationSampler[];
    channels: GLTFAnimationChannel[];
}
export type Index2GpuTexture = Record<number, TextureKey>;
export interface GLTFNode {
    mesh?: number;
    children?: number[];
    translation?: vec3arr;
    rotation?: vec4arr;
    scale?: vec3arr;
    matrix?: Float32Array;
    skin?: number;
    weights?: number[];
    visible?: boolean;
}
export interface GLTFScene {
    nodes: number[];
}
export interface GLTFSkin {
    joints: number[];
    inverseBindMatrices?: Float32Array[];
}
export interface GLTFModel {
    name: string;
    meshes: GLTFMesh[];
    materials?: GLTFMaterial[];
    animations?: GLTFAnimation[];
    textures?: number[];
    imageURIs?: string[];
    imageOffsets?: {
        start: number;
        end: number;
    }[];
    imageBuffers?: ArrayBuffer[];
    gpuTextures?: Index2GpuTexture;
    nodes?: GLTFNode[];
    scenes?: GLTFScene[];
    scene?: number;
    skins?: GLTFSkin[];
}
export type OBJModel = GLTFModel;
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
