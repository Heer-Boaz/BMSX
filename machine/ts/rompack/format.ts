import {
	CARTRIDGE_BOARD_MAILBOX,
	CARTRIDGE_BOARD_RAM,
} from '../spec/bmsx/cartridge';
import {
	BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_HI_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_LO_OFFSET,
} from '../spec/bmsx/rom_header';
import {
	CART_ROM_HEADER_CARTRIDGE_BOARD_OFFSET,
	CART_ROM_HEADER_CARTRIDGE_RAM_BYTES_OFFSET,
	CART_ROM_HEADER_DATA_LENGTH_OFFSET,
	CART_ROM_HEADER_DATA_OFFSET,
	CART_ROM_HEADER_MANIFEST_LENGTH_OFFSET,
	CART_ROM_HEADER_MANIFEST_OFFSET,
	CART_ROM_HEADER_MAGIC_OFFSET,
	CART_ROM_HEADER_METADATA_LENGTH_OFFSET,
	CART_ROM_HEADER_METADATA_OFFSET,
	CART_ROM_HEADER_SIZE,
	CART_ROM_HEADER_SIZE_OFFSET,
	CART_ROM_HEADER_TOC_LENGTH_OFFSET,
	CART_ROM_HEADER_TOC_OFFSET,
	CART_ROM_HEADER_VDP_CLASS_OFFSET,
	CART_ROM_MAGIC,
	CART_VDP_CLASS_PSX,
} from '../spec/bmsx/rom_package';
import { CART_RAM_SIZE } from '../spec/bmsx/memory_map';
import { formatNumberAsHex } from '../common/byte_hex_string';

export const ROM_ASSET_SYMBOL_MODULE_PATH = 'bmsx/assets';
export const ROM_ASSET_SYMBOL_SOURCE_PATH = `${ROM_ASSET_SYMBOL_MODULE_PATH}.lua`;
export const GX_TEXTURE_LAYOUT_MODULE_PATH = 'bmsx/gx_texture_layout';
export const GX_TEXTURE_LAYOUT_SOURCE_PATH = `${GX_TEXTURE_LAYOUT_MODULE_PATH}.lua`;
export const ROM_GENERATED_MODULE_PATHS: ReadonlyArray<string> = [
	ROM_ASSET_SYMBOL_MODULE_PATH,
	GX_TEXTURE_LAYOUT_MODULE_PATH,
];

export type MachineVdpClass = 'psx';

export type CartRomHeader = {
	headerSize: number;
	manifestOffset: number;
	manifestLength: number;
	tocOffset: number;
	tocLength: number;
	dataOffset: number;
	dataLength: number;
	blua32ImageOffset: number;
	blua32ImageByteCount: number;
	blua32StartupFunctionAddress: number;
	blua32IrqFunctionAddress: number;
	blua32ExceptionFunctionAddress: number;
	blua32StaticLayoutTokenLo: number;
	blua32StaticLayoutTokenHi: number;
	metadataOffset: number;
	metadataLength: number;
	vdpClass: MachineVdpClass;
	cartridgeBoardWord: number;
	cartridgeRamByteCount: number;
};

function assertRomSectionRange(offset: number, length: number, total: number, label: string): void {
	if (offset + length > total) {
		throw new Error(`Invalid ROM ${label} range: offset=${formatNumberAsHex(offset)} len=${formatNumberAsHex(length)} total=${formatNumberAsHex(total)}.`);
	}
}

export function parseCartHeader(payload: Uint8Array): CartRomHeader {
	if (payload.byteLength < CART_ROM_HEADER_SIZE) {
		throw new Error('ROM payload is too small for cart header.');
	}
	const view = new DataView(payload.buffer, payload.byteOffset, CART_ROM_HEADER_SIZE);
	if (view.getUint32(CART_ROM_HEADER_MAGIC_OFFSET, true) !== CART_ROM_MAGIC) {
		throw new Error('Invalid ROM cart header.');
	}
	const headerSize = view.getUint32(CART_ROM_HEADER_SIZE_OFFSET, true);
	if (headerSize < CART_ROM_HEADER_SIZE) {
		throw new Error(`ROM header size is too small: ${headerSize}.`);
	}
	if (headerSize > payload.byteLength) {
		throw new Error(`ROM header size exceeds payload length: ${headerSize}.`);
	}
	const manifestOffset = view.getUint32(CART_ROM_HEADER_MANIFEST_OFFSET, true);
	const manifestLength = view.getUint32(CART_ROM_HEADER_MANIFEST_LENGTH_OFFSET, true);
	const tocOffset = view.getUint32(CART_ROM_HEADER_TOC_OFFSET, true);
	const tocLength = view.getUint32(CART_ROM_HEADER_TOC_LENGTH_OFFSET, true);
	const dataOffset = view.getUint32(CART_ROM_HEADER_DATA_OFFSET, true);
	const dataLength = view.getUint32(CART_ROM_HEADER_DATA_LENGTH_OFFSET, true);
	const metadataOffset = view.getUint32(CART_ROM_HEADER_METADATA_OFFSET, true);
	const metadataLength = view.getUint32(CART_ROM_HEADER_METADATA_LENGTH_OFFSET, true);
	const vdpClassWord = view.getUint32(CART_ROM_HEADER_VDP_CLASS_OFFSET, true);
	if (vdpClassWord !== CART_VDP_CLASS_PSX) {
		throw new Error(`Unsupported ROM VDP class marker: ${vdpClassWord}.`);
	}
	const cartridgeBoardWord = view.getUint32(CART_ROM_HEADER_CARTRIDGE_BOARD_OFFSET, true);
	const cartridgeRamByteCount = view.getUint32(CART_ROM_HEADER_CARTRIDGE_RAM_BYTES_OFFSET, true);
	if (cartridgeRamByteCount > CART_RAM_SIZE) {
		throw new Error(`Cartridge RAM byte count exceeds the ${CART_RAM_SIZE}-byte socket aperture.`);
	}

	assertRomSectionRange(manifestOffset, manifestLength, payload.byteLength, 'manifest');
	assertRomSectionRange(tocOffset, tocLength, payload.byteLength, 'toc');
	assertRomSectionRange(dataOffset, dataLength, payload.byteLength, 'data');
	if (metadataLength > 0) {
		assertRomSectionRange(metadataOffset, metadataLength, payload.byteLength, 'metadata');
	}

	return {
		headerSize,
		manifestOffset,
		manifestLength,
		tocOffset,
		tocLength,
		dataOffset,
		dataLength,
		blua32ImageOffset: view.getUint32(BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, true),
		blua32ImageByteCount: view.getUint32(BMSX_ROM_HEADER_BLUA32_IMAGE_BYTE_COUNT_OFFSET, true),
		blua32StartupFunctionAddress: view.getUint32(BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET, true),
		blua32IrqFunctionAddress: view.getUint32(BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET, true),
		blua32ExceptionFunctionAddress: view.getUint32(BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET, true),
		blua32StaticLayoutTokenLo: view.getUint32(BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_LO_OFFSET, true),
		blua32StaticLayoutTokenHi: view.getUint32(BMSX_ROM_HEADER_BLUA32_STATIC_LAYOUT_TOKEN_HI_OFFSET, true),
		metadataOffset,
		metadataLength,
		vdpClass: 'psx',
		cartridgeBoardWord,
		cartridgeRamByteCount,
	};
}

export type CartridgeLayerId = 'system' | 'cart';

export type RomAssetOp = 'delete';

export interface RomToolingPackage {
	// Decoded ROM package records. Raw cartridge bytes live outside of this structure.
	img: id2imgres;
	audio: id2res;
	model: id2model;
	data: id2data;
	bin: id2res;
	audioevents: id2audioevent;
	project_root_path: string; // Workspace-relative cart root path for resolving filesystem writes.
	cart_manifest: CartManifest | null; // Cart metadata for the active cartridge, absent for system ROM packages.
	machine: MachineManifest; // Effective machine spec for this ROM package.
	entry_path: string; // Entry BLua source path for this ROM package.
}

export type asset_type = 'image' | 'texture' | 'audio' | 'data' | 'bin' | 'romlabel' | 'model' | 'aem' | 'lua' | 'code';
export type asset_id = string;

/**
 * Represents a ROM TOC entry.
 */
export interface RomAsset {
	resid: asset_id; // Resource ID stored in the ROM TOC.
	type: asset_type; // ROM TOC record type.
	id_token_lo?: number; // 64-bit exact-id token (low 32)
	id_token_hi?: number; // 64-bit exact-id token (high 32)
	op?: RomAssetOp; // Optional patch operation for this ROM entry.
	start?: number; // Optional start offset in the ROM.
	end?: number; // Optional end offset in the ROM.
	compiled_start?: number; // Optional start offset of precompiled Lua chunk data in the ROM
	compiled_end?: number; // Optional end offset of precompiled Lua chunk data in the ROM
	metabuffer_start?: number; // Optional start offset of binary-encoded per-entry metadata in the buffer
	metabuffer_end?: number; // Optional end offset of binary-encoded per-entry metadata in the buffer
	buffer?: Buffer; // Raw buffer owned by this ROM entry at pack time.
	compiled_buffer?: Buffer; // Compiled Lua chunk buffer for Lua source records.
	model_texture_buffer?: Buffer; // Optional packed image payload owned by a model record.
	collision_bin_buffer?: Buffer; // Optional auxiliary collision binary owned by an image record.
	imgmeta?: ImgMeta; // Metadata when this record is an image.
	texturemeta?: TextureMeta; // Metadata when this record is a GX texture stream.
	audiometa?: AudioMeta; // Metadata when this record is audio.
	model_texture_start?: number; // Start offset of a model-owned packed image payload.
	model_texture_end?: number; // End offset of a model-owned packed image payload.
	collision_bin_start?: number; // Start offset of the image-owned collision binary within the ROM
	collision_bin_end?: number;   // End offset of the image-owned collision binary within the ROM
	source_path?: string; // Relative filesystem path for this record when applicable (e.g., Lua source files).
	normalized_source_path?: string; // Normalized absolute-ish source path for this record.
	update_timestamp?: number; // Last update timestamp for dev hot-resume.
	payload_id?: CartridgeLayerId; // Cartridge layer backing this record's raw bytes.
}

export type RomLuaAsset = RomAsset & {
	src: string; // Lua source code known at pack time.
	normalized_source_path?: string; // Normalized absolute source path used for source mapping and debugging.
	update_timestamp: number; // Timestamp used for caching and development reloads.
}

export type id2res = Record<asset_id, RomAsset>;
export type id2imgres = Record<asset_id, RomAsset>;
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
	entries: RomAsset[];
	projectRootPath: string;
	cart_manifest: CartManifest | null;
	machine: MachineManifest;
	entry_path: string;
};

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
	rotationQ: vec4;
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

export type GpuTextureKey = string;
export type Index2GpuTexture = Record<number, GpuTextureKey>;
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
	width: number; // The width of the image.
	height: number; // The height of the image.
	texture_u: number; // Image X within its packed texture, in source pixels.
	texture_v: number; // Image Y within its packed texture, in source pixels.
	gx_texture_resid?: asset_id; // Cart texture resource; system images use fixed resident coordinates.
	gx_source_x?: number; // Fixed resident source X for firmware-ROM images.
	gx_source_y?: number; // Fixed resident source Y for firmware-ROM images.
	gx_page_tiles?: GxTexturePageTile[]; // Producer-sliced page-local rectangles for an explicitly tiled image.
	boundingbox?: BoundingBoxPrecalc; // The bounding box of the image. Used for collision detection.
	centerpoint?: vec2arr; // The center point of the image, based on the bounding box.
	hitpolygons?: HitPolygonsPrecalc; // The concave hull polygons for collision detection, with flipped variants.
}

export interface TextureMeta {
	mode: number;
	word_width: number;
	height: number;
	texture_word_count: number;
	clut_word_count: number;
}

export interface GxTexturePageTile {
	u: number;
	v: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

export type TextureSource = unknown & { close?(): void; width: number; height: number; data?: Uint8Array; }; // platform-specific source type (e.g. ImageBitmap in browsers)
export type Viewport = { width: number; height: number; };
export type MachineManifest = {
	namespace: string;
	vdp_class: MachineVdpClass;
};

export type CartManifest = {
	title?: string;
	short_name?: string;
	rom_name?: string;
	machine: MachineManifest;
	lua: {
		entry_path: string;
	};
	cartridge?: {
		board: 'rom' | 'ram' | 'mailbox' | 'ram_mailbox';
		ram_bytes?: number;
	};
};

export type RomManifest = CartManifest;

export function resolveCartridgeHeaderWords(manifest: CartManifest | null): {
	cartridgeBoardWord: number;
	cartridgeRamByteCount: number;
} {
	const board = manifest?.cartridge?.board;
	let cartridgeBoardWord: number;
	switch (board) {
		case undefined:
		case 'rom':
			cartridgeBoardWord = 0;
			break;
		case 'ram':
			cartridgeBoardWord = CARTRIDGE_BOARD_RAM;
			break;
		case 'mailbox':
			cartridgeBoardWord = CARTRIDGE_BOARD_MAILBOX;
			break;
		case 'ram_mailbox':
			cartridgeBoardWord = CARTRIDGE_BOARD_RAM | CARTRIDGE_BOARD_MAILBOX;
			break;
		default:
			throw new Error(`Unknown cartridge board "${String(board)}".`);
	}
	const cartridgeRamByteCount = manifest?.cartridge?.ram_bytes ?? 0;
	if (!Number.isInteger(cartridgeRamByteCount)
			|| cartridgeRamByteCount < 0
			|| cartridgeRamByteCount > CART_RAM_SIZE) {
		throw new Error(`Cartridge RAM byte count must be an integer from 0 through ${CART_RAM_SIZE}.`);
	}
	if ((cartridgeBoardWord & CARTRIDGE_BOARD_RAM) === 0 && cartridgeRamByteCount !== 0) {
		throw new Error('Cartridge RAM bytes require a RAM board.');
	}
	return { cartridgeBoardWord, cartridgeRamByteCount };
}
