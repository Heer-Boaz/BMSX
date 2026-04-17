import type { quat } from '../render/3d/math';
import type { TextureKey } from '../render/texture_manager';
import type { GameViewHost, Platform } from '../platform';
import { InputMap } from '../input/models';

export const CART_ROM_MAGIC = 0x58534D42;
export const CART_ROM_MAGIC_BYTES = new Uint8Array([0x42, 0x4d, 0x53, 0x58]);
export const CART_ROM_BASE_HEADER_SIZE = 32;
export const CART_ROM_PROGRAM_HEADER_SIZE = 64;
export const CART_ROM_HEADER_SIZE = 72;

export type CartRomHeader = {
	headerSize: number;
	manifestOffset: number;
	manifestLength: number;
	tocOffset: number;
	tocLength: number;
	dataOffset: number;
	dataLength: number;
	programBootVersion: number;
	programBootFlags: number;
	programEntryProtoIndex: number;
	programCodeByteCount: number;
	programConstPoolCount: number;
	programProtoCount: number;
	programModuleAliasCount: number;
	programConstRelocCount: number;
	metadataOffset: number;
	metadataLength: number;
};

export type CartridgeLayerId = 'system' | 'cart' | 'overlay';

export type RomAssetOp = 'delete';

export interface RuntimeAssets {
	// Runtime asset cache resolved for the engine. Raw cartridge bytes live outside of this structure.
	img: id2imgres; // Reference to the loaded image assets in the ROM pack, including metadata. ALWAYS PRESENT DURING GAME!
	audio: id2res; // Reference to the loaded audio assets in the ROM pack, including metadata. ALWAYS PRESENT DURING GAME!
	model: id2model; // Reference to the loaded model assets in the ROM pack, including metadata. ALWAYS PRESENT DURING GAME!
	data: id2data; // Reference to the loaded data assets in the ROM pack, including metadata. ALWAYS PRESENT DURING GAME!
	bin: id2res; // Reference to raw binary assets that remain addressable in ROM. ALWAYS PRESENT DURING GAME!
	audioevents: id2audioevent; // Reference to the loaded audio event assets in the ROM pack, including metadata. ALWAYS PRESENT DURING GAME!
	project_root_path: string; // Workspace-relative cart root path for resolving filesystem writes.
	cart_manifest: CartManifest | null; // Cart metadata for the active program, absent for system assets.
	machine: MachineManifest; // Effective machine spec for this asset layer.
	entry_path: string; // Entry Lua path for this program.
}

export type asset_type = 'image' | 'audio' | 'data' | 'bin' | 'atlas' | 'romlabel' | 'model' | 'aem' | 'lua' | 'code';
export type asset_id = string;

/**
 * Represents an asset in a ROM pack.
 */
export interface RomAsset {
	resid: asset_id; // The resource ID of the asset.
	type: asset_type; // The type of the asset.
	handle?: number; // Runtime-resolved memory handle for firmware-facing MMIO code.
	id_token_lo?: number; // 64-bit exact-id token (low 32)
	id_token_hi?: number; // 64-bit exact-id token (high 32)
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
	collision_bin_buffer?: Buffer; // Optional auxiliary collision binary owned by an image asset.
	imgmeta?: ImgMeta; // The metadata of the asset, if it is an image.
	audiometa?: AudioMeta; // The metadata of the asset, if it is an audio asset.
	texture_start?: number; // Start offset of the texture buffer within the ROM
	texture_end?: number;   // End offset of the texture buffer within the ROM
	collision_bin_start?: number; // Start offset of the image-owned collision binary within the ROM
	collision_bin_end?: number;   // End offset of the image-owned collision binary within the ROM
	source_path?: string; // Relative filesystem path for the asset when applicable (e.g., Lua source files).
	normalized_source_path?: string; // Normalized absolute-ish source path for this asset.
	update_timestamp?: number; // Last update timestamp for the asset, used for dev hot-resume.
	payload_id?: CartridgeLayerId; // Cartridge layer backing this asset's raw bytes.
}

export interface RomImgAsset extends RomAsset {
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
export type AudioEventMapEntry = Record<string, unknown>;
export type id2audioevent = Record<asset_id, AudioEventMapEntry>;

export type BitmapId = asset_id;
export type AudioId = asset_id;
export type ModelId = asset_id;
export type DataId = asset_id;
export type BinId = asset_id;
export type LuaId = asset_id;

export type CartridgeIndex = {
	assets: RomAsset[];
	projectRootPath: string;
	cart_manifest: CartManifest | null;
	machine: MachineManifest;
	entry_path: string;
	input?: CartManifest['input'];
};

/**
 * Arguments passed from the bootloader to the game constructor.
 */
export interface BootArgs {
	cartridge?: Uint8Array;
	engineAssets: Uint8Array;
	workspaceOverlay?: Uint8Array;
	sndcontext?: AudioContext;
	gainnode?: GainNode;
	debug?: boolean;
	startingGamepadIndex?: number;
	enableOnscreenGamepad?: boolean;
	platform: Platform;
	viewHost?: GameViewHost;
	canonicalization?: CanonicalizationType;
}

export type Identifier = string | 'model';
export interface Identifiable {
	id: Identifier;
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
export const ATLAS_PRIMARY_SLOT_ID = '_atlas_primary';
export const ATLAS_SECONDARY_SLOT_ID = '_atlas_secondary';

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
	fliph?: RectBounds, // The bounding box of the image, when flipped horizontally. Used for collision detection.
	flipv?: RectBounds, // The bounding box of the image, when flipped vertically. Used for collision detection.
	fliphv?: RectBounds, // The bounding box of the image, when flipped both horizontally and vertically. Used for collision detection.
}

export interface HitPolygonsPrecalc {
	original: Polygon[]; // The concave hull polygons of the image, used for collision detection.
	fliph?: Polygon[]; // The concave hull polygons of the image, when flipped horizontally.
	flipv?: Polygon[]; // The concave hull polygons of the image, when flipped vertically.
	fliphv?: Polygon[]; // The concave hull polygons of the image, when flipped both horizontally and vertically.
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

export type TextureSource = unknown & { close?(): void; width: number; height: number; data?: Uint8Array; }; // platform-specific source type (e.g. ImageBitmap in browsers)
export type Viewport = { width: number; height: number; };
export type CanonicalizationType = 'none' | 'upper' | 'lower';
export type MachineVoiceSpecs = {
	sfx?: number;
	music?: number;
	ui?: number;
};
export const DEFAULT_MACHINE_MAX_VOICES: Required<MachineVoiceSpecs> = {
	sfx: 1,
	music: 1,
	ui: 1,
};
export type MachineCpuSpecs = {
	cpu_freq_hz: number;
	imgdec_bytes_per_sec: number;
};
export type MachineDmaSpecs = {
	dma_bytes_per_sec_iso: number;
	dma_bytes_per_sec_bulk: number;
};
export type MachineVdpSpecs = {
	work_units_per_sec?: number;
};
export type MachineGeoSpecs = {
	work_units_per_sec?: number;
};
export type MachineRamSpecs = {
	ram_bytes?: number;
};
export type MachineVramSpecs = {
	atlas_slot_bytes?: number;
	system_atlas_slot_bytes?: number;
	staging_bytes?: number;
};
export type MachineAudioSpecs = {
	max_voices?: MachineVoiceSpecs;
};
export type MachineSpecs = {
	cpu: MachineCpuSpecs;
	dma: MachineDmaSpecs;
	vdp?: MachineVdpSpecs;
	geo?: MachineGeoSpecs;
	audio?: MachineAudioSpecs;
	ram?: MachineRamSpecs;
	vram?: MachineVramSpecs;
};

export type MachineManifest = {
	render_size: Viewport;
	canonicalization: CanonicalizationType;
	namespace: string;
	ufps: number;
	specs: MachineSpecs;
};

export type CartManifest = {
	title?: string;
	short_name?: string;
	rom_name?: string;
	machine: MachineManifest;
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

export type RomManifest = CartManifest;

export type MachinePerfSpecs = {
	cpu_freq_hz: number;
	imgdec_bytes_per_sec: number;
	dma_bytes_per_sec_iso: number;
	dma_bytes_per_sec_bulk: number;
	work_units_per_sec: number;
	geo_work_units_per_sec: number;
	ufps: number;
};

export const DEFAULT_VDP_WORK_UNITS_PER_SEC = 25_600;
export const DEFAULT_GEO_WORK_UNITS_PER_SEC = 16_384_000;

export type MachineMemorySpecs = {
	ram_bytes?: number;
	atlas_slot_bytes?: number;
	system_atlas_slot_bytes?: number;
	staging_bytes?: number;
};

export function getMachinePerfSpecs(machine: MachineManifest): MachinePerfSpecs {
	const cpu = machine.specs.cpu;
	const dma = machine.specs.dma;
	const vdp = machine.specs.vdp;
	const geo = machine.specs.geo;
	return {
		cpu_freq_hz: cpu.cpu_freq_hz,
		imgdec_bytes_per_sec: cpu.imgdec_bytes_per_sec,
		dma_bytes_per_sec_iso: dma.dma_bytes_per_sec_iso,
		dma_bytes_per_sec_bulk: dma.dma_bytes_per_sec_bulk,
		work_units_per_sec: vdp?.work_units_per_sec ?? DEFAULT_VDP_WORK_UNITS_PER_SEC,
		geo_work_units_per_sec: geo?.work_units_per_sec ?? DEFAULT_GEO_WORK_UNITS_PER_SEC,
		ufps: machine.ufps,
	};
}

export function getMachineMemorySpecs(machine: MachineManifest): MachineMemorySpecs {
	const ram = machine.specs.ram;
	const vram = machine.specs.vram;
	return {
		ram_bytes: ram?.ram_bytes,
		atlas_slot_bytes: vram?.atlas_slot_bytes,
		system_atlas_slot_bytes: vram?.system_atlas_slot_bytes,
		staging_bytes: vram?.staging_bytes,
	};
}

export function getMachineMaxVoices(machine: MachineManifest): Required<MachineVoiceSpecs> {
	const voices = machine.specs.audio?.max_voices;
	return {
		sfx: voices?.sfx ?? DEFAULT_MACHINE_MAX_VOICES.sfx,
		music: voices?.music ?? DEFAULT_MACHINE_MAX_VOICES.music,
		ui: voices?.ui ?? DEFAULT_MACHINE_MAX_VOICES.ui,
	};
}
// 		data: merge(bullshit.data, engine.data),
// 		audioevents: merge(bullshit.audioevents, engine.audioevents),
// 		cart: bullshit.cart,
// 		project_root_path: bullshit.project_root_path,
// 		canonicalization: bullshit.canonicalization,
// 		manifest: bullshit.manifest,
// 	};
// 	return merged;
// }
