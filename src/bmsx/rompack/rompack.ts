import type { AudioEventMapEntry } from '../audio/audioeventmanager';
import type { quat } from '../render/3d/math3d';
import type { TextureKey } from '../render/texturemanager';
import type { GameViewHost, Platform } from '../platform';
import { InputMap } from '../input/inputtypes';

export const GAME_FPS = 50;
export const CART_ROM_MAGIC = 0x58534D42;
export const CART_ROM_MAGIC_BYTES = new Uint8Array([0x42, 0x4d, 0x53, 0x58]);
export const CART_ROM_HEADER_SIZE = 32;

export type CartRomHeader = {
	headerSize: number;
	manifestOffset: number;
	manifestLength: number;
	tocOffset: number;
	tocLength: number;
	dataOffset: number;
	dataLength: number;
};

export type CartridgeLayerId = 'system' | 'cart' | 'overlay';
export type CartridgePayloads = Partial<Record<CartridgeLayerId, ArrayBuffer>>;
export type BmsxCartridgeBlob = ArrayBuffer | Uint8Array;
export type BmsxCartridge = BmsxCartridgeBlob;

export type RomAssetOp = 'delete';

export interface RuntimeAssets {
	// Runtime asset cache resolved for the engine. Raw cartridge bytes live outside of this structure.
	img: id2imgres; // Reference to the loaded image assets in the ROM pack, including metadata and the cached binary payload. ALWAYS PRESENT DURING GAME!
	audio: id2res; // Reference to the loaded audio assets in the ROM pack, including metadata. ALWAYS PRESENT DURING GAME!
	model: id2model; // Reference to the loaded model assets in the ROM pack, including metadata. ALWAYS PRESENT DURING GAME!
	data: id2data; // Reference to the loaded data assets in the ROM pack, including metadata. ALWAYS PRESENT DURING GAME!
	audioevents: id2audioevent; // Reference to the loaded audio event assets in the ROM pack, including metadata. ALWAYS PRESENT DURING GAME!
	project_root_path: string; // Workspace-relative cart root path for resolving filesystem writes.
	canonicalization: CanonicalizationType; // Canonicalization type for Lua identifiers in this ROM pack.
	manifest: RomManifest; // The manifest of the ROM pack.
}

export type RomAssetListPayload = {
	assets: RomAsset[];
	projectRootPath: string;
	manifest: RomManifest;
};

export type asset_type = 'image' | 'audio' | 'data' | 'atlas' | 'romlabel' | 'model' | 'aem' | 'lua' | 'code';
export type asset_id = string;

/**
 * Represents an asset in a ROM pack.
 */
export interface RomAsset {
	resid: asset_id; // The resource ID of the asset.
	type: asset_type; // The type of the asset.
	op?: RomAssetOp; // Optional patch operation for this asset.
	start?: number; // The optional start offset of the asset in the ROM. (e.g., atlassed images don't have a start offset, as they are part of an atlas)
	end?: number; // The optional end offset of the asset in the ROM. (e.g., atlassed images don't have an end offset, as they are part of an atlas)
	compiled_start?: number; // Optional start offset of precompiled Lua chunk data in the ROM
	compiled_end?: number; // Optional end offset of precompiled Lua chunk data in the ROM
	metabuffer_start?: number; // Optional start offset of binary-encoded per-asset metadata in the buffer
	metabuffer_end?: number; // Optional end offset of binary-encoded per-asset metadata in the buffer
	buffer?: Buffer; // The binary buffer of the asset, used for all assets, including images and audio.
	compiled_buffer?: Buffer; // ???? The compiled Lua chunk buffer for Lua script assets.
	texture_buffer?: Buffer; // Optional buffer holding packed textures for model assets
	imgmeta?: ImgMeta; // The metadata of the asset, if it is an image.
	audiometa?: AudioMeta; // The metadata of the asset, if it is an audio asset.
	texture_start?: number; // Start offset of the texture buffer within the ROM
	texture_end?: number;   // End offset of the texture buffer within the ROM
	source_path?: string; // Relative filesystem path for the asset when applicable (e.g., Lua source files).
	normalized_source_path?: string; // Normalized absolute-ish source path for this asset.
	update_timestamp?: number; // Last update timestamp for the asset, used for dev hot-reload.
	payload_id?: CartridgeLayerId; // Cartridge layer backing this asset's raw bytes.
}

export interface RomImgAsset extends RomAsset {
	_imgbin?: TextureSource | Promise<TextureSource>;
	_imgbinYFlipped?: TextureSource | Promise<TextureSource>;
	get imgbin(): Promise<TextureSource>;
	get imgbinYFlipped(): Promise<TextureSource>;
}

export type RomLuaAsset = RomAsset & {
	src: string; // The Lua source code of the Lua script asset. Known at pack time
	normalized_source_path?: string; // Normalized absolute source path for this Lua asset, used for source mapping and debugging.
	update_timestamp: number; // Timestamp of the last update to this Lua asset, used for caching and reloading during development.
}

export type id2res = Record<asset_id, RomAsset>;
export type id2imgres = Record<asset_id, RomImgAsset>;
export type id2model = Record<asset_id, GLTFModel>;
export type id2data = Record<asset_id, any>;
export type id2lua = Record<asset_id, RomLuaAsset>;
export type id2audioevent = Record<asset_id, AudioEventMapEntry>;

export type BitmapId = asset_id;
export type AudioId = asset_id;
export type ModelId = asset_id;
export type DataId = asset_id;
export type LuaId = asset_id;

export type RomManifest = CartManifest;

export type CartridgeIndex = {
	assets: RomAsset[];
	projectRootPath: string;
	manifest: RomManifest;
};

/**
 * Arguments passed from the bootloader to the game constructor.
 */
export interface BootArgs {
	cartridge?: BmsxCartridge;
	engineAssets: BmsxCartridge;
	workspaceOverlay?: BmsxCartridge;
	sndcontext?: AudioContext;
	gainnode?: GainNode;
	debug?: boolean;
	startingGamepadIndex?: number;
	enableOnscreenGamepad?: boolean;
	platform: Platform;
	viewHost?: GameViewHost;
	canonicalization?: CanonicalizationType;
}

export type Constructor<T> = new (...args: any[]) => T;

/**
 * Represents a type that is a constructor function with a prototype of type T.
 * This effectively allows it to match any class (including abstract classes) that produces T instances.
 * Used for attaching abstract classes to game objects.
 */
export type ConcreteOrAbstractConstructor<T> = Function & { prototype: T; };

export interface Native {
	__native__: string;
}

export type NativeRegisteredObject = Native & Registerable & { constructor: { name: string }, ctor?: { name: string } }; // Used to mark native objects in the console API, includes JS-engine constructor name

/**
 * Represents the direction values.
 */
export type Direction = 'none' | 'up' | 'right' | 'down' | 'left';
export type Facing = Direction | 'up-right' | 'down-right' | 'down-left' | 'up-left';

export type Identifier = string | 'model';
export interface Identifiable {
	id: Identifier;
}

export type MaybeRegisterable = Partial<Registerable>;

export interface Parentable {
	parent?: Identifiable;
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

/**
 * Reserved atlas metadata for engine/runtime resources.
 *
 * Atlas indices are stored in packed sprite metadata and must fit in an
 * unsigned byte. We reserve index 254 for engine assets so carts can safely
 * use lower indices without risk of collision.
 */
export const ENGINE_ATLAS_INDEX = 254;

/**
 * Texture dictionary key used by GameView to cache the engine atlas texture.
 */
export const ENGINE_ATLAS_TEXTURE_KEY = '_atlas_engine';
const atlasNameCache = new Map<number, string>(); // Cache for atlas names to avoid regenerating them for each request

export function generateAtlasName(atlasIndex: number): string {
	// Check if the atlas name is already cached
	if (atlasNameCache.has(atlasIndex)) {
		return atlasNameCache.get(atlasIndex)!;
	}
	// Generate a new atlas name and cache it
	const idxStr = atlasIndex.toString().padStart(2, '0');
	const atlasName = `_atlas_${idxStr}`;
	atlasNameCache.set(atlasIndex, atlasName);
	return atlasName;
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

export type vec4 = { x: number; y: number; z: number; w: number; };

/**
 * Alternative representation of a 4D vector as an array.
 * Example: [x, y, z, w]
 */
export type vec4arr = [number, number, number, number];

/**
 * Represents a 2D vector.
 */
export interface vec2 { x: number; y: number; z?: number; }

/**
 * Represents a 3-dimensional vector.
 * Extends the vec2 interface.
 */
export interface vec3 extends vec2 {
	z: number;
}

export type x_y_w_h_arr = vec4arr;

export type RectBounds = {
	left: number;
	top: number;
	right: number;
	bottom: number;
	z?: number;
};

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
	loopEnd?: number; // Optional loop end point of the audio asset.
}

export interface BoundingBoxPrecalc {
	original: RectBounds, // The bounding box of the image. Used for collision detection.
	fliph: RectBounds, // The bounding box of the image, when flipped horizontally. Used for collision detection.
	flipv: RectBounds, // The bounding box of the image, when flipped vertically. Used for collision detection.
	fliphv: RectBounds, // The bounding box of the image, when flipped both horizontally and vertically. Used for collision detection.
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
	normals?: Float32Array;
	tangents?: Float32Array;
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

export type TextureSource = unknown & { close?(): void; width: number; height: number; }; // platform-specific source type (e.g. ImageBitmap in browsers)
export type Viewport = { width: number; height: number; };
export type CanonicalizationType = 'none' | 'upper' | 'lower';

export type CartManifest = {
	title?: string;
	short_name?: string;
	rom_name?: string;
	vm: {
		viewport: Viewport;
		canonicalization: CanonicalizationType;
		namespace: string;
	};
	input?: {
		1: InputMap,
		2?: InputMap,
		3?: InputMap,
		4?: InputMap,
	};
	lua: {
		entry_path: string;
	};
};
// 		data: merge(bullshit.data, engine.data),
// 		audioevents: merge(bullshit.audioevents, engine.audioevents),
// 		cart: bullshit.cart,
// 		project_root_path: bullshit.project_root_path,
// 		canonicalization: bullshit.canonicalization,
// 		manifest: bullshit.manifest,
// 	};
// 	return merged;
// }
