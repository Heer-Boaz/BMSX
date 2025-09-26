import { AudioEventMapEntry } from '../audio/audioeventmanager';
import { StateMachineBlueprint } from '../fsm/fsmtypes';
import { quat } from '../render/3d/math3d';
import { TextureKey } from '../render/texturemanager';
import type { PlatformServices } from '../platform/platform_services';

export interface RomPack {
	rom: ArrayBuffer; // The binary buffer of the ROM pack, containing all assets, including images, audio and code.
	img: id2imgres; // Reference to the loaded image assets in the ROM pack, including metadata and the loaded image (ImageBitmap).
	audio: id2res; // Reference to the loaded audio assets in the ROM pack, including metadata.
	model: id2model; // Reference to the loaded model assets in the ROM pack, including metadata.
	data: id2data; // Reference to the loaded data assets in the ROM pack, including metadata.
	code: string; // The loaded game code in the ROM pack.
	fsm: id2fsm; // Reference to the loaded FSM assets in the ROM pack, including metadata.
	audioevents: id2audioevent; // Reference to the loaded audio event assets in the ROM pack, including metadata.
}

export type asset_type = 'image' | 'audio' | 'code' | 'data' | 'atlas' | 'romlabel' | 'model' | 'fsm' | 'aem';
export type asset_id = string;

/**
 * Represents an asset in a ROM pack.
 */
export interface RomAsset {
	resid: asset_id; // The resource ID of the asset.
	type: asset_type; // The type of the asset.
	start?: number; // The optional start offset of the asset in the ROM. (e.g., atlassed images don't have a start offset, as they are part of an atlas)
	end?: number; // The optional end offset of the asset in the ROM. (e.g., atlassed images don't have an end offset, as they are part of an atlas)
	metabuffer_start?: number; // Optional start offset of binary-encoded per-asset metadata in the buffer
	metabuffer_end?: number; // Optional end offset of binary-encoded per-asset metadata in the buffer
	buffer?: Buffer; // The binary buffer of the asset, used for all assets, including images and audio.
	texture_buffer?: Buffer; // Optional buffer holding packed textures for model assets
	imgmeta?: ImgMeta; // The metadata of the asset, if it is an image.
	audiometa?: AudioMeta; // The metadata of the asset, if it is an audio asset.
	texture_start?: number; // Start offset of the texture buffer within the ROM
	texture_end?: number;   // End offset of the texture buffer within the ROM
}

export interface RomImgAsset extends RomAsset {
	_imgbin: ImageBitmap; // The Image Bitmap of the image asset
	_imgbinYFlipped: ImageBitmap; // The flipped Image Bitmap of the image asset
	get imgbin(): Promise<ImageBitmap>; // A getter for the image element (#see `bootresources.getAssetImageBin`)
	get imgbinYFlipped(): Promise<ImageBitmap>; // A getter for the flipped image element (#see `bootresources.getAssetImageBin`)
}

export interface RomMeta {
	start: number; // The start offset of the RomPack metadata in the ROM (file) buffer itself.
	end: number; // The end offset of the RomPack metadata in the ROM (file) buffer itself.
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

/**
 * Arguments passed from the bootloader to the game constructor.
 */
export interface BootArgs {
	rompack: RomPack;
	sndcontext: AudioContext;
	gainnode: GainNode;
	debug?: boolean;
	startingGamepadIndex?: number | null;
	platformServices?: PlatformServices;
}

export type Constructor<T> = new (...args: any[]) => T;

/**
 * Represents a type that is a constructor function with a prototype of type T.
 * This effectively allows it to match any class (including abstract classes) that produces T instances.
 * Used for attaching abstract classes to game objects.
 */
export type ConcreteOrAbstractConstructor<T> = Function & { prototype: T; };
// export type AbstractConstructor<T> = (abstract new (...args: any[]) => T);

/**
 * Represents the direction values.
 */
export type Direction = 'none' | 'up' | 'right' | 'down' | 'left';

export type Identifier = string | 'model';
export interface Identifiable {
	id: Identifier;
}

export type MaybeRegisterable = Partial<Registerable>;

export interface Parentable {
	parentid?: Identifier;
}

export interface Disposable {
	dispose(): void;
}

export interface Bindable extends Disposable {
	bind(): void;
	// unbind(): void;
}

export interface Registerable extends Identifiable, Bindable {
	registrypersistent?: boolean;
	eventhandling_enabled?: boolean;
}

export interface RegisterablePersistent extends Registerable {
	registrypersistent: true;
}

/*
 * Enum representing the type of an audio asset.
 */
export type AudioType = 'sfx' | 'music' | 'ui';
export const AudioTypes = Object.freeze(['sfx', 'music', 'ui'] as AudioType[]);

/**
 * Alternative representation of a 2D vector as an array.
 * Example: [x, y]
 */
export type vec2arr = [number, number];

/**
 * Alternative representation of a 3D vector as an array.
 * Example: [x, y, z]
 */
export type vec3arr = [number, number, number];

/**
 * Alternative representation of a 4D vector as an array.
 * Example: [x, y, z, w]
 */
export type vec4arr = [number, number, number, number];

/**
 * Represents a 2D vector.
 */
export interface vec2 { x: number; y: number; z?: number;}

/**
 * Represents a 3-dimensional vector.
 * Extends the vec2 interface.
 */
export interface vec3 extends vec2 {
	z: number;
}

export type x_y_w_h_arr = vec4arr;

/**
 * Represents an area defined by a start and end point.
 */
export interface Area {
	start: vec2;
	end: vec2;
}

export type Polygon = number[];

export interface Oriented {
	rotationQ: quat;
}

export interface Scaled {
	scale: vec3arr;
}

/**
 * Metadata for an audio asset.
 */
export interface AudioMeta {
	audiotype: AudioType; // The type of audio asset.
	priority: number; // The priority of the audio asset.
	loop?: number; // The loop point of the audio asset.
}

export interface BoundingBoxPrecalc {
	original: Area, // The bounding box of the image. Used for collision detection.
	fliph: Area, // The bounding box of the image, when flipped horizontally. Used for collision detection.
	flipv: Area, // The bounding box of the image, when flipped vertically. Used for collision detection.
	fliphv: Area, // The bounding box of the image, when flipped both horizontally and vertically. Used for collision detection.
}

export interface HitPolygonsPrecalc {
	original: Polygon[]; // The concave hull polygons of the image, used for collision detection.
	fliph: Polygon[]; // The concave hull polygons of the image, when flipped horizontally.
	flipv: Polygon[]; // The concave hull polygons of the image, when flipped vertically.
	fliphv: Polygon[]; // The concave hull polygons of the image, when flipped both horizontally and vertically.
}

export type color_arr = vec4arr;

export interface GLTFMaterial {
	baseColorFactor?: color_arr;
	metallicFactor?: number;
	roughnessFactor?: number;
	baseColorTexture?: number;
	baseColorTexCoord?: number;
	normalTexture?: number;
	normalTexCoord?: number;
	normalScale?: number;
	metallicRoughnessTexture?: number;
	metallicRoughnessTexCoord?: number;
	occlusionTexture?: number;
	occlusionTexCoord?: number;
	occlusionStrength?: number;
	emissiveTexture?: number;
	emissiveTexCoord?: number;
	emissiveFactor?: color_arr;
	alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
	alphaCutoff?: number;
	doubleSided?: boolean;
	unlit?: boolean;
}

export type GLTFIndexArray = Uint8Array | Uint16Array | Uint32Array;

export interface GLTFMesh {
	positions: Float32Array;
	texcoords?: Float32Array;
	texcoords1?: Float32Array;
	normals?: Float32Array | null;
	tangents?: Float32Array | null;
	indices?: GLTFIndexArray;
	indexComponentType?: 5121 | 5123 | 5125;
	materialIndex?: number;
	morphPositions?: Float32Array[];
	morphNormals?: Float32Array[];
	morphTangents?: Float32Array[];
	weights?: number[];
	jointIndices?: Uint16Array;
	jointWeights?: Float32Array;
	colors?: Float32Array;
}

export interface GLTFAnimationSampler {
	interpolation: string;
	input: Float32Array;
	output: Float32Array;
}

export interface GLTFAnimationChannel {
	sampler: number;
	target: { node?: number; path: string };
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
	/** Optional morph target weights for this node */
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
	/** Mapping from texture index to image index */
	textures?: number[];
	imageURIs?: string[];
	imageOffsets?: { start: number; end: number }[];
	imageBuffers?: ArrayBuffer[];
	gpuTextures?: Index2GpuTexture;
	nodes?: GLTFNode[];
	scenes?: GLTFScene[];
	scene?: number;
	skins?: GLTFSkin[];
}

export type OBJModel = GLTFModel;

/**
 * Metadata for an image asset.
 */
export interface ImgMeta {
	atlassed: boolean; // Whether the image is part of an atlas.
	atlasid?: number; // The ID of the atlas the image is part of, if applicable.
	width: number; // The width of the image.
	height: number; // The height of the image.
	texcoords?: number[]; // The texture coordinates for the image, used for rendering.
	texcoords_fliph?: number[]; // The texture coordinates for the image, when flipped horizontally.
	texcoords_flipv?: number[]; // The texture coordinates for the image, when flipped vertically.
	texcoords_fliphv?: number[]; // The texture coordinates for the image, when flipped both horizontally and vertically.
	boundingbox?: BoundingBoxPrecalc; // The bounding box of the image. Used for collision detection.
	centerpoint?: vec2arr; // The center point of the image, based on the bounding box.
	hitpolygons?: HitPolygonsPrecalc; // The concave hull polygons for collision detection, with flipped variants.
}
