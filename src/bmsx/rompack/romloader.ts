import type {
	RectBounds,
	AudioMeta,
	GLTFMaterial,
	GLTFModel,
	ImgMeta,
	Polygon,
	RomAsset,
	RomImgAsset,
	CartManifest,
	MachineManifest,
	RuntimeAssets,
	CartridgeIndex,
	CartridgeLayerId,
	color_arr,
	CartRomHeader,
} from './rompack';
import { assertMachineManifestUsesRamOnly } from './rompack';
import { decodeBinary, toF32, typedArrayFromBytes } from '../serializer/binencoder';
import { CART_ROM_BASE_HEADER_SIZE, CART_ROM_HEADER_SIZE, CART_ROM_MAGIC_BYTES } from './rompack';
import { inflate } from 'pako';
import { AssetSourceStack, type RawAssetSource } from './asset_source';
import { decodeRomToc } from './rom_toc';

const utf8Decoder = new TextDecoder();

export type RomLoadOptions = {
	loadAudioFromBuffer?: (buffer: Uint8Array) => Promise<any>;
	loadDataFromBuffer?: (buffer: Uint8Array) => Promise<any>;
	loadModelFromBuffer?: (buffer: Uint8Array, textures?: Uint8Array) => Promise<any>;
};

function hasCartHeader(buffer: Uint8Array): boolean {
	if (buffer.byteLength < CART_ROM_BASE_HEADER_SIZE) {
		return false;
	}
	const headerView = buffer.subarray(0, CART_ROM_MAGIC_BYTES.length);
	for (let index = 0; index < CART_ROM_MAGIC_BYTES.length; index += 1) {
		if (headerView[index] !== CART_ROM_MAGIC_BYTES[index]) {
			return false;
		}
	}
	const dv = new DataView(buffer.buffer, buffer.byteOffset, CART_ROM_BASE_HEADER_SIZE);
	const headerSize = dv.getUint32(4, true);
	return headerSize >= CART_ROM_BASE_HEADER_SIZE && headerSize <= buffer.byteLength;
}

function assertSectionRange(offset: number, length: number, total: number, label: string): void {
	if (offset + length > total) {
		throw new Error(`Invalid ROM ${label} range: offset=${offset} len=${length} total=${total}.`);
	}
}

export function parseCartHeader(payload: Uint8Array): CartRomHeader {
	if (payload.byteLength < CART_ROM_BASE_HEADER_SIZE) {
		throw new Error('ROM payload is too small for cart header.');
	}
	const headerView = payload.subarray(0, CART_ROM_MAGIC_BYTES.length);
	for (let index = 0; index < CART_ROM_MAGIC_BYTES.length; index += 1) {
		if (headerView[index] !== CART_ROM_MAGIC_BYTES[index]) {
			throw new Error('Invalid ROM cart header.');
		}
	}
	const dv = new DataView(payload.buffer, payload.byteOffset, Math.min(payload.byteLength, CART_ROM_HEADER_SIZE));
	const headerSize = dv.getUint32(4, true);
	if (headerSize < CART_ROM_BASE_HEADER_SIZE) {
		throw new Error(`ROM header size is too small: ${headerSize}.`);
	}
	if (headerSize > payload.byteLength) {
		throw new Error(`ROM header size exceeds payload length: ${headerSize}.`);
	}
	const manifestOffset = dv.getUint32(8, true);
	const manifestLength = dv.getUint32(12, true);
	const tocOffset = dv.getUint32(16, true);
	const tocLength = dv.getUint32(20, true);
	const dataOffset = dv.getUint32(24, true);
	const dataLength = dv.getUint32(28, true);
	const hasExtendedHeader = headerSize >= CART_ROM_HEADER_SIZE;
	const programBootVersion = hasExtendedHeader ? dv.getUint32(32, true) : 0;
	const programBootFlags = hasExtendedHeader ? dv.getUint32(36, true) : 0;
	const programEntryProtoIndex = hasExtendedHeader ? dv.getUint32(40, true) : 0;
	const programCodeByteCount = hasExtendedHeader ? dv.getUint32(44, true) : 0;
	const programConstPoolCount = hasExtendedHeader ? dv.getUint32(48, true) : 0;
	const programProtoCount = hasExtendedHeader ? dv.getUint32(52, true) : 0;
	const programModuleAliasCount = hasExtendedHeader ? dv.getUint32(56, true) : 0;
	const programConstRelocCount = hasExtendedHeader ? dv.getUint32(60, true) : 0;

	assertSectionRange(manifestOffset, manifestLength, payload.byteLength, 'manifest');
	assertSectionRange(tocOffset, tocLength, payload.byteLength, 'toc');
	assertSectionRange(dataOffset, dataLength, payload.byteLength, 'data');

	return {
		headerSize,
		manifestOffset,
		manifestLength,
		tocOffset,
		tocLength,
		dataOffset,
		dataLength,
		programBootVersion,
		programBootFlags,
		programEntryProtoIndex,
		programCodeByteCount,
		programConstPoolCount,
		programProtoCount,
		programModuleAliasCount,
		programConstRelocCount,
	};
}

// TODO: DUPLICATE CODE WITH `bootrom.ts`!!!
function splitPng(blob: Uint8Array): { png?: Uint8Array; rest: Uint8Array } {
	if (
		blob[0] !== 0x89 || blob[1] !== 0x50 || blob[2] !== 0x4E || blob[3] !== 0x47 ||
		blob[4] !== 0x0D || blob[5] !== 0x0A || blob[6] !== 0x1A || blob[7] !== 0x0A
	) {
		return { rest: blob };
	}
	let p = 8;
	while (p + 8 <= blob.length) {
		const len = (blob[p] << 24) | (blob[p + 1] << 16) | (blob[p + 2] << 8) | blob[p + 3];
		p += 4;
		const type = (blob[p] << 24) | (blob[p + 1] << 16) | (blob[p + 2] << 8) | blob[p + 3];
		p += 4;
		const end = p + len + 4;
		if (type === 0x49454E44) {
			const png = blob.slice(0, end);
			const rest = blob.slice(end);
			return { png, rest };
		}
		p = end;
	}
	throw new Error('PNG IEND chunk not found');
}

function looksPakoCompressed(buffer: Uint8Array): boolean {
	const u8 = new Uint8Array(buffer);
	if (u8.length < 2) {
		return false;
	}
	// Gzip header: 1F 8B
	if (u8[0] === 0x1F && u8[1] === 0x8B) {
		return true;
	}
	// Zlib header starts with 0x78 and must have a valid CMF/FLG checksum.
	if (u8[0] === 0x78) {
		const cmf = u8[0];
		const flg = u8[1];
		return ((cmf << 8) + flg) % 31 === 0;
	}
	return false;
}

export function getZippedRomAndRomLabelFromBlob(blob_buffer: Uint8Array): { zipped_rom: Uint8Array, romlabel?: Uint8Array } {
	const { png, rest } = splitPng(blob_buffer);
	if (png) {
		// Only treat the leading PNG as a romlabel if the remaining payload looks like a ROM.
		if (hasCartHeader(rest) || looksPakoCompressed(rest)) {
			return { zipped_rom: rest, romlabel: png };
		}
	}
	return { zipped_rom: blob_buffer, romlabel: undefined };
}

export function normalizeCartridgeBlob(blob: Uint8Array): { payload: Uint8Array; romlabel?: Uint8Array } {
	const input = blob;
	const { zipped_rom, romlabel } = getZippedRomAndRomLabelFromBlob(input);
	let payload: Uint8Array;
	if (hasCartHeader(zipped_rom)) {
		payload = zipped_rom;
	} else if (looksPakoCompressed(zipped_rom)) {
		payload = inflate(new Uint8Array(zipped_rom));
	} else {
		throw new Error('ROM payload is missing cart header.');
	}
	parseCartHeader(payload);
	return { payload, romlabel };
}

type RomAssetList = {
	assets: RomAsset[];
	projectRootPath: string;
};

type CartridgeMetadata = {
	cart_manifest: CartManifest;
	machine: MachineManifest;
	entry_path: string;
	input?: CartManifest['input'];
};

function decodeCartridgeMetadata(rom: Uint8Array, header: CartRomHeader): CartridgeMetadata {
	if (header.manifestLength === 0) {
		throw new Error('ROM header is missing manifest payload.');
	}
	const manifestSlice = rom.subarray(header.manifestOffset, header.manifestOffset + header.manifestLength);
	const cart_manifest = decodeBinary(manifestSlice) as CartManifest;
	assertMachineManifestUsesRamOnly(cart_manifest.machine);
	return {
		cart_manifest,
		machine: cart_manifest.machine,
		entry_path: cart_manifest.lua.entry_path,
		input: cart_manifest.input,
	};
}

async function loadRomAssetListFromHeader(rom: Uint8Array, header: CartRomHeader): Promise<RomAssetList> {
	const sliced = rom.subarray(header.tocOffset, header.tocOffset + header.tocLength);
	const decoded = decodeRomToc(sliced);
	const assetList = decoded.assets;
	const projectRootPath = decoded.projectRootPath ?? '';

	function flipPolygons(polys: Polygon[], flipH: boolean, flipV: boolean, imgW: number, imgH: number): Polygon[] {
		return polys.map(poly => {
			const res: number[] = [];
			for (let i = 0; i < poly.length; i += 2) {
				const x = poly[i];
				const y = poly[i + 1];
				res.push(flipH ? imgW - 1 - x : x, flipV ? imgH - 1 - y : y);
			}
			return res;
		});
	}

	function flipBoundingBoxHorizontally(box: RectBounds, width: number): RectBounds {
		return {
			left: width - box.right,
			right: width - box.left,
			top: box.top,
			bottom: box.bottom,
			z: box.z
		};
	}

	function flipBoundingBoxVertically(box: RectBounds, height: number): RectBounds {
		return {
			left: box.left,
			right: box.right,
			top: height - box.bottom,
			bottom: height - box.top,
			z: box.z
		};
	}

	function generateFlippedBoundingBox(extractedBoundingBox: RectBounds, imgW: number, imgH: number) {
		const originalBoundingBox = extractedBoundingBox;
		const horizontalFlipped = flipBoundingBoxHorizontally(originalBoundingBox, imgW);
		const verticalFlipped = flipBoundingBoxVertically(originalBoundingBox, imgH);
		const bothFlipped = flipBoundingBoxHorizontally(flipBoundingBoxVertically(originalBoundingBox, imgH), imgW);
		return {
			original: originalBoundingBox,
			fliph: horizontalFlipped,
			flipv: verticalFlipped,
			fliphv: bothFlipped
		};
	}

	function generateFlippedTexCoords(texcoords: number[]): { original: number[]; fliph: number[]; flipv: number[]; fliphv: number[] } {
		const result = {
			original: [...texcoords],
			fliph: [],
			flipv: [],
			fliphv: []
		} as { original: number[]; fliph: number[]; flipv: number[]; fliphv: number[] };

		const left = texcoords[0];
		const top = texcoords[1];
		const bottom = texcoords[3];
		const right = texcoords[4];

		result.fliph.push(
			right, top,
			right, bottom,
			left, top,
			left, top,
			right, bottom,
			left, bottom
		);
		result.flipv.push(
			left, bottom,
			left, top,
			right, bottom,
			right, bottom,
			left, top,
			right, top
		);
		result.fliphv.push(
			right, bottom,
			right, top,
			left, bottom,
			left, bottom,
			right, top,
			left, top
		);

		return result;
	}

	for (const asset of assetList) {
		if (asset.metabuffer_start != null && asset.metabuffer_end != null) {
			const metaSlice = rom.slice(asset.metabuffer_start, asset.metabuffer_end);
			const decodedMeta = decodeBinary(new Uint8Array(metaSlice));
			switch (asset.type) {
				case 'image':
				case 'atlas':
					asset.imgmeta = decodedMeta as ImgMeta;
					if (asset.imgmeta.hitpolygons?.original && (!asset.imgmeta.hitpolygons.fliph || !asset.imgmeta.hitpolygons.flipv || !asset.imgmeta.hitpolygons.fliphv)) {
						const extracted_hitpolygon = asset.imgmeta.hitpolygons.original;
						asset.imgmeta.hitpolygons = {
							original: extracted_hitpolygon,
							fliph: flipPolygons(extracted_hitpolygon, true, false, asset.imgmeta.width, asset.imgmeta.height),
							flipv: flipPolygons(extracted_hitpolygon, false, true, asset.imgmeta.width, asset.imgmeta.height),
							fliphv: flipPolygons(extracted_hitpolygon, true, true, asset.imgmeta.width, asset.imgmeta.height)
						};
					}
					if (asset.imgmeta.width && asset.imgmeta.height) {
						if (asset.imgmeta.boundingbox && (!asset.imgmeta.boundingbox.fliph || !asset.imgmeta.boundingbox.flipv || !asset.imgmeta.boundingbox.fliphv)) {
							asset.imgmeta.boundingbox = generateFlippedBoundingBox(asset.imgmeta.boundingbox.original, asset.imgmeta.width, asset.imgmeta.height);
						}
						if (asset.imgmeta.atlassed && asset.imgmeta.texcoords && (!asset.imgmeta.texcoords_fliph || !asset.imgmeta.texcoords_flipv || !asset.imgmeta.texcoords_fliphv)) {
							const { original, fliph, flipv, fliphv } = generateFlippedTexCoords(asset.imgmeta.texcoords);
							asset.imgmeta.texcoords = original;
							asset.imgmeta.texcoords_fliph = fliph;
							asset.imgmeta.texcoords_flipv = flipv;
							asset.imgmeta.texcoords_fliphv = fliphv;
						}
					}
					break;
				case 'audio':
					asset.audiometa = decodedMeta as AudioMeta;
					break;
				case 'data':
				case 'blob':
					break;
				case 'model':
					break;
				default:
					break;
			}
		}
	}
	return {
		assets: assetList,
		projectRootPath,
	};
}

export async function loadRomAssetList(rom: Uint8Array): Promise<RomAssetList> {
	const header = parseCartHeader(rom);
	return loadRomAssetListFromHeader(rom, header);
}

export async function loadAssetList(rom: Uint8Array): Promise<{ assets: RomAsset[]; projectRootPath: string; manifest: CartManifest }> {
	const { assets, projectRootPath, cart_manifest } = await parseCartridgeIndex(rom);
	return {
		assets,
		projectRootPath,
		manifest: cart_manifest,
	};
}

export async function parseCartridgeIndex(payload: Uint8Array): Promise<CartridgeIndex> {
	const header = parseCartHeader(payload);
	const { assets, projectRootPath } = await loadRomAssetListFromHeader(payload, header);
	const { cart_manifest, machine, entry_path, input } = decodeCartridgeMetadata(payload, header);
	return {
		assets,
		projectRootPath,
		cart_manifest,
		machine,
		entry_path,
		input,
	};
}

async function loadDataFromBuffer(buffer: Uint8Array): Promise<any> {
	return decodeBinary(new Uint8Array(buffer));
}

export async function loadModelFromBuffer(asset_id: string, buffer: Uint8Array, textureBuf?: Uint8Array): Promise<GLTFModel> {
	const obj = decodeBinary(new Uint8Array(buffer), { zeroCopyBin: true });

	function toIndices(v: any, componentType?: number): Uint8Array | Uint16Array | Uint32Array {
		if (v === undefined || v === null) return undefined;
		if (ArrayBuffer.isView(v)) {
			const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
			if (componentType === 5125) return typedArrayFromBytes(u8, Uint32Array);
			if (componentType === 5123) return typedArrayFromBytes(u8, Uint16Array);
			if (componentType === 5121) return new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength);
			if (u8.byteLength % 4 === 0) return typedArrayFromBytes(u8, Uint32Array);
			return typedArrayFromBytes(u8, Uint16Array);
		}
		if (Array.isArray(v)) {
			if (componentType === 5125) return new Uint32Array(v);
			if (componentType === 5123) return new Uint16Array(v);
			if (componentType === 5121) return new Uint8Array(v);
			return (v.length && v.length > 65535) ? new Uint32Array(v) : new Uint16Array(v);
		}
		return undefined;
	}
	const meshes = (obj.meshes || []).map((m: any) => ({
		positions: toF32(m.positions)!,
		texcoords: toF32(m.texcoords),
		texcoords1: toF32(m.texcoords1),
		normals: m.normals ? toF32(m.normals) : null,
		tangents: m.tangents ? toF32(m.tangents) : null,
		indices: toIndices(m.indices, m.indexComponentType),
		indexComponentType: m.indexComponentType,
		materialIndex: m.materialIndex,
		imageURIs: m.imageURIs ? m.imageURIs.map((uri: any) => {
			if (typeof uri === 'string') return uri;
			if (ArrayBuffer.isView(uri)) {
				const u8 = new Uint8Array(uri.buffer, uri.byteOffset, uri.byteLength);
				return utf8Decoder.decode(u8);
			}
			return undefined;
		}) : undefined,
		morphPositions: m.morphPositions ? m.morphPositions.map((mt: any) => toF32(mt)) : undefined,
		morphNormals: m.morphNormals ? m.morphNormals.map((mt: any) => toF32(mt)) : undefined,
		morphTangents: m.morphTangents ? m.morphTangents.map((mt: any) => toF32(mt)) : undefined,
		weights: m.weights ? Array.from(m.weights) : undefined,
		jointIndices: m.jointIndices ? toIndices(m.jointIndices, 5123) as Uint16Array : undefined,
		jointWeights: m.jointWeights ? toF32(m.jointWeights) : undefined,
		colors: toF32(m.colors),

	}));
	const textures: number[] = obj.textures;
	const materials = obj.materials as GLTFMaterial[];
	const texBytes = textureBuf ? new Uint8Array(textureBuf) : undefined;
	let imageBuffers: ArrayBuffer[] = undefined;
	if (Array.isArray(obj.imageBuffers) && obj.imageBuffers.length) {
		imageBuffers = obj.imageBuffers.map((buf: any) => {
			if (buf instanceof Uint8Array) return buf;
			if (ArrayBuffer.isView(buf)) {
				const view = buf as ArrayBufferView;
				return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
			}
			return undefined;
		});
	} else if (texBytes && Array.isArray(obj.imageOffsets)) {
		imageBuffers = obj.imageOffsets.map((off: any) => {
			if (off && typeof off.start === 'number' && typeof off.end === 'number') {
				return texBytes.slice(off.start, off.end).buffer;
			}
			return undefined;
		});
	}

	function textureIndexToTextureObject(index: number): number {
		const remapped = textures?.[index];
		if (remapped === undefined) {
			throw new Error(`Invalid texture index ${index} for model "${asset_id}".`);
		}
		return remapped;
	}

	const animations = (obj.animations || []).map((a: any) => ({
		name: a.name,
		samplers: (a.samplers || []).map((s: any) => ({
			interpolation: s.interpolation,
			input: toF32(s.input)!,
			output: toF32(s.output)!,
		})),
		channels: a.channels || [],
	}));

	const nodes = (obj.nodes || []).map((n: any) => ({
		mesh: n.mesh,
		children: n.children,
		translation: n.translation,
		rotation: n.rotation,
		scale: n.scale,
		matrix: toF32(n.matrix),
		skin: n.skin,
		weights: n.weights ? Array.from(n.weights) : undefined,
	}));
	const scenes = obj.scenes;
	const scene = obj.scene;
	const skins = (obj.skins || []).map((s: any) => ({
		joints: s.joints,
		inverseBindMatrices: s.inverseBindMatrices ? s.inverseBindMatrices.map((m: any) => toF32(m)!) : undefined,
	}));

	if (textures && Array.isArray(materials)) {
		for (const m of materials) {
			if (m.baseColorTexture !== undefined) m.baseColorTexture = textureIndexToTextureObject(m.baseColorTexture);
			if (m.normalTexture !== undefined) m.normalTexture = textureIndexToTextureObject(m.normalTexture);
			if (m.metallicRoughnessTexture !== undefined) m.metallicRoughnessTexture = textureIndexToTextureObject(m.metallicRoughnessTexture);
			if (m.occlusionTexture !== undefined) m.occlusionTexture = textureIndexToTextureObject(m.occlusionTexture);
			if (m.emissiveTexture !== undefined) m.emissiveTexture = textureIndexToTextureObject(m.emissiveTexture);
			if (m.emissiveFactor) {
				const f = m.emissiveFactor;
				const arr = ArrayBuffer.isView(f) ? Array.from(f) : Array.isArray(f) ? f : undefined;
				if (arr) {
					if (arr.length === 3) arr.push(1);
					m.emissiveFactor = arr as color_arr;
				}
			}
		}
	}
	return { name: asset_id, meshes, materials, animations, imageURIs: obj.imageURIs, imageOffsets: obj.imageOffsets, imageBuffers, textures, nodes, scenes, scene, skins };
}

async function load(source: RawAssetSource, res: RomAsset, assets: RuntimeAssets, opts?: RomLoadOptions) {
	if (res.op === 'delete') {
		return;
	}
	const baseAsset = res;
	const assetKey = baseAsset.resid;
	switch (res.type) {
		case 'image':
		case 'atlas': {
			const imgAsset = {
				...baseAsset,
			} as RomImgAsset;
			assets.img[assetKey] = imgAsset;
			break;
		}
		case 'audio':
			if (opts && opts.loadAudioFromBuffer) {
				assets.audio[assetKey] = await opts.loadAudioFromBuffer(source.getBytes(baseAsset));
			} else {
				assets.audio[assetKey] = baseAsset;
			}
			break;
		case 'model': {
			const texBuf = (baseAsset.texture_start != null && baseAsset.texture_end != null)
				? source.getBytes({ ...baseAsset, start: baseAsset.texture_start, end: baseAsset.texture_end })
				: undefined;
			if (opts && opts.loadModelFromBuffer) {
				assets.model[assetKey] = await opts.loadModelFromBuffer(source.getBytes(baseAsset), texBuf);
			} else {
				assets.model[assetKey] = await loadModelFromBuffer(res.resid, source.getBytes(baseAsset), texBuf);
			}
			break;
		}
		case 'data':
			if (opts && opts.loadDataFromBuffer) {
				const data = await opts.loadDataFromBuffer(source.getBytes(baseAsset));
				assets.data[assetKey] = data;
			} else {
				const data = await loadDataFromBuffer(source.getBytes(baseAsset));
				assets.data[assetKey] = data;
			}
			break;
		case 'blob':
			assets.blob[assetKey] = baseAsset;
			break;
		case 'aem': {
			const u8 = source.getBytes(baseAsset);
			const audioevents = decodeBinary(u8);
			assets.audioevents[assetKey] = audioevents;
			break;
		}
		case 'lua':
		case 'code':
		case 'romlabel':
			break;
		default:
			throw new Error(`Unrecognised resource type in rom: ${res.type}, while processing runtime assets!`);
	}
}

export type RuntimeAssetLayer = {
	id: CartridgeLayerId;
	index: CartridgeIndex;
	payload: Uint8Array;
	assets: RuntimeAssets;
};

async function loadRuntimeAssetsFromSource(source: RawAssetSource, index: CartridgeIndex, opts?: RomLoadOptions): Promise<RuntimeAssets> {
	const assets: RuntimeAssets = {
		img: {},
		audio: {},
		model: {},
		data: {},
		blob: {},
		audioevents: {},
		project_root_path: index.projectRootPath,
		cart_manifest: index.cart_manifest,
		machine: index.machine,
		entry_path: index.entry_path,
	};
	const entries = source.list();
	await Promise.all(entries.map(entry => load(source, entry, assets, opts)));
	return assets;
}

export async function loadRuntimeAssetsFromBuffer(rom: Uint8Array, opts?: RomLoadOptions, payloadId: CartridgeLayerId = 'cart'): Promise<RuntimeAssets> {
	const index = await parseCartridgeIndex(rom);
	const source = new AssetSourceStack([{ id: payloadId, index, payload: rom }]);
	return loadRuntimeAssetsFromSource(source, index, opts);
}

export async function buildRuntimeAssetLayer(params: { blob: Uint8Array; id: CartridgeLayerId; opts?: RomLoadOptions }): Promise<RuntimeAssetLayer> {
	const normalized = normalizeCartridgeBlob(params.blob);
	const index = await parseCartridgeIndex(normalized.payload);
	const source = new AssetSourceStack([{ id: params.id, index, payload: normalized.payload }]);
	const assets = await loadRuntimeAssetsFromSource(source, index, params.opts);
	return { id: params.id, index, payload: normalized.payload, assets };
}

export async function buildSystemRuntimeAssetLayer(params: {
	blob: Uint8Array;
	machine: MachineManifest;
	entry_path: string;
	opts?: RomLoadOptions;
}): Promise<RuntimeAssetLayer> {
	const normalized = normalizeCartridgeBlob(params.blob);
	const { assets } = await loadRomAssetList(normalized.payload);
	const index: CartridgeIndex = {
		assets,
		projectRootPath: '',
		cart_manifest: null,
		machine: params.machine,
		entry_path: params.entry_path,
	};
	const source = new AssetSourceStack([{ id: 'system', index, payload: normalized.payload }]);
	const runtimeAssets = await loadRuntimeAssetsFromSource(source, index, params.opts);
	return { id: 'system', index, payload: normalized.payload, assets: runtimeAssets };
}
