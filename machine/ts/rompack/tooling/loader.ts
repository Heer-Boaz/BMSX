import type {
	AudioMeta,
	ImgMeta,
	RomAsset,
	RomToolingPackage,
	CartridgeIndex,
	TextureMeta,
} from './assets';
import type { GLTFMaterial, GLTFModel } from './gltf';
import type { CartManifest, MachineManifest } from './manifest';
import type { Polygon, RectBounds } from '../../common/rect';
import type { vec4arr } from '../../common/vector';
import { decodeBinary, decodeBinaryWithPropTable, toF32, typedArrayFromBytes } from '../../common/serializer/binencoder';
import { parseCartHeader, type CartRomHeader } from '../format';
import { parseRomMetadataSection } from './metadata';
import { RomSourceStack, type RawRomSource } from './source';
import { decodeRomToc } from '../toc';
import type { RomImage, RomImageDomain } from '../image';

const utf8Decoder = new TextDecoder();

type RomAssetList = {
	entries: RomAsset[];
	projectRootPath: string;
};

function decodedProjectRootPath(path: string | null): string {
	return path === null ? '' : path;
}


function resolveMachineManifest(machine: MachineManifest, vdpClass: MachineManifest['vdp_class']): MachineManifest {
	return {
		...machine,
		vdp_class: vdpClass,
	};
}

type CartridgeMetadata = {
	cart_manifest: CartManifest;
	machine: MachineManifest;
	entry_path: string;
};

function decodeCartridgeMetadata(rom: Uint8Array, header: CartRomHeader): CartridgeMetadata {
	if (header.manifestLength === 0) {
		throw new Error('ROM header is missing manifest payload.');
	}
	const manifestSlice = rom.subarray(header.manifestOffset, header.manifestOffset + header.manifestLength);
	const cart_manifest = decodeBinary(manifestSlice) as CartManifest;
	const machine = cart_manifest.machine;
	if (machine === undefined) {
		throw new Error('ROM manifest payload is missing machine object.');
	}
	if (machine.vdp_class !== header.vdpClass) {
		throw new Error('ROM header VDP class does not match manifest machine.vdp_class.');
	}
	return {
		cart_manifest,
		machine: resolveMachineManifest(machine, header.vdpClass),
		entry_path: cart_manifest.lua.entry_path,
	};
}

async function loadRomAssetListFromHeader(
	rom: Uint8Array,
	header: CartRomHeader,
	domain: RomImageDomain,
): Promise<RomAssetList> {
	const sliced = rom.subarray(header.tocOffset, header.tocOffset + header.tocLength);
	const decoded = decodeRomToc(sliced);
	const entryList: RomAsset[] = decoded.entries;
	const projectRootPath = decodedProjectRootPath(decoded.projectRootPath);
	const sharedMetadata = header.metadataLength > 0
		? parseRomMetadataSection(rom.subarray(header.metadataOffset, header.metadataOffset + header.metadataLength))
		: null;

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

	for (const asset of entryList) {
		asset.payload_id = domain;
		if (asset.metabuffer_start != null && asset.metabuffer_end != null) {
			const metaStart = asset.metabuffer_start;
			const metaEnd = asset.metabuffer_end;
			const metaSlice = rom.subarray(metaStart, metaEnd);
			const decodedMeta = sharedMetadata && metaStart >= (header.metadataOffset + sharedMetadata.payloadOffset) && metaEnd <= (header.metadataOffset + header.metadataLength)
				? decodeBinaryWithPropTable(metaSlice, sharedMetadata.propNames)
				: decodeBinary(metaSlice);
			switch (asset.type) {
				case 'image':
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
					}
					break;
				case 'texture':
					asset.texturemeta = decodedMeta as TextureMeta;
					break;
				case 'audio':
					asset.audiometa = decodedMeta as AudioMeta;
					break;
				case 'data':
				case 'bin':
					break;
				case 'model':
					break;
				default:
					break;
			}
		}
	}
	return {
		entries: entryList,
		projectRootPath,
	};
}

export async function loadRomAssetList(
	rom: Uint8Array,
	domain: RomImageDomain,
): Promise<RomAssetList> {
	const header = parseCartHeader(rom);
	return loadRomAssetListFromHeader(rom, header, domain);
}

export async function parseCartridgeIndex(payload: Uint8Array): Promise<CartridgeIndex> {
	const header = parseCartHeader(payload);
	return parseCartridgeIndexFromHeader(payload, header);
}

async function parseCartridgeIndexFromHeader(payload: Uint8Array, header: CartRomHeader): Promise<CartridgeIndex> {
	const { entries, projectRootPath } = await loadRomAssetListFromHeader(payload, header, 'cart');
	const { cart_manifest, machine, entry_path } = decodeCartridgeMetadata(payload, header);
	return {
		entries,
		projectRootPath,
		cart_manifest,
		machine,
		entry_path,
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
			imageURIs: m.imageURIs?.map((uri: any) => {
				if (typeof uri === 'string') return uri;
				if (ArrayBuffer.isView(uri)) {
					const u8 = new Uint8Array(uri.buffer, uri.byteOffset, uri.byteLength);
					return utf8Decoder.decode(u8);
				}
				return undefined;
			}),
			morphPositions: m.morphPositions?.map((mt: any) => toF32(mt)),
			morphNormals: m.morphNormals?.map((mt: any) => toF32(mt)),
			morphTangents: m.morphTangents?.map((mt: any) => toF32(mt)),
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
		inverseBindMatrices: s.inverseBindMatrices?.map((m: any) => toF32(m)!),
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
					m.emissiveFactor = arr as vec4arr;
				}
			}
		}
	}
	return { name: asset_id, meshes, materials, animations, imageURIs: obj.imageURIs, imageOffsets: obj.imageOffsets, imageBuffers, textures, nodes, scenes, scene, skins };
}

async function load(source: RawRomSource, res: RomAsset, romPackage: RomToolingPackage) {
	if (res.op === 'delete') {
		return;
	}
	const baseAsset = res;
	const assetKey = baseAsset.resid;
	switch (res.type) {
		case 'image': {
			romPackage.img[assetKey] = baseAsset;
			break;
		}
		case 'texture':
			break;
		case 'audio':
			romPackage.audio[assetKey] = baseAsset;
			break;
		case 'model': {
			const texBuf = baseAsset.model_texture_start
				? source.getBytes({ ...baseAsset, start: baseAsset.model_texture_start, end: baseAsset.model_texture_end! })
				: undefined;
			let model: GLTFModel;
			model = await loadModelFromBuffer(res.resid, source.getBytes(baseAsset), texBuf);
			romPackage.model[assetKey] = model;
			break;
		}
		case 'data':
			romPackage.data[assetKey] = await loadDataFromBuffer(source.getBytes(baseAsset));
			break;
		case 'bin':
			romPackage.bin[assetKey] = baseAsset;
			break;
		case 'aem': {
			const u8 = source.getBytes(baseAsset);
			const audioevents = decodeBinary(u8);
			romPackage.audioevents[assetKey] = audioevents;
			break;
		}
		case 'lua':
		case 'code':
		case 'romlabel':
			break;
		default:
			throw new Error(`Unrecognised resource type in ROM: ${res.type}, while decoding runtime ROM package.`);
	}
}

export type RomToolingLayer = {
	id: RomImageDomain;
	header: CartRomHeader;
	index: CartridgeIndex;
	payload: Uint8Array;
	package: RomToolingPackage;
};

async function loadRomToolingPackageFromSource(source: RawRomSource, index: CartridgeIndex): Promise<RomToolingPackage> {
	const romPackage: RomToolingPackage = {
		img: {},
		audio: {},
		model: {},
		data: {},
		bin: {},
		audioevents: {},
		project_root_path: index.projectRootPath,
		cart_manifest: index.cart_manifest,
		machine: index.machine,
		entry_path: index.entry_path,
	};
	const entries = source.list();
	await Promise.all(entries.map(entry => load(source, entry, romPackage)));
	return romPackage;
}

export async function buildCartridgeToolingLayer(image: RomImage): Promise<RomToolingLayer> {
	const index = await parseCartridgeIndexFromHeader(image.bytes, image.header);
	const source = new RomSourceStack([{ id: 'cart', index, payload: image.bytes }]);
	const toolingPackage = await loadRomToolingPackageFromSource(source, index);
	return { id: 'cart', header: image.header, index, payload: image.bytes, package: toolingPackage };
}

export async function buildSystemToolingLayer(params: {
	image: RomImage;
	machine: MachineManifest;
	entry_path: string;
}): Promise<RomToolingLayer> {
	const { image } = params;
	const { entries } = await loadRomAssetListFromHeader(image.bytes, image.header, 'system');
	const index: CartridgeIndex = {
		entries,
		projectRootPath: '',
		cart_manifest: null,
		machine: params.machine,
		entry_path: params.entry_path,
	};
	const source = new RomSourceStack([{ id: 'system', index, payload: image.bytes }]);
	const toolingPackage = await loadRomToolingPackageFromSource(source, index);
	return { id: 'system', header: image.header, index, payload: image.bytes, package: toolingPackage };
}
