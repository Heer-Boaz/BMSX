import type {
	RectBounds,
	AudioMeta,
	GLTFMaterial,
	GLTFModel,
	ImgMeta,
	Polygon,
	RomAsset,
	RomAssetListPayload,
	RomImgAsset,
	RomLuaAsset,
	RomManifest,
	RomMeta,
	RomPack,
	TextureSource,
	BmsxCartridgeBlob,
	CartridgePayloads,
	CartridgeIndex,
	CartridgeLayerId,
	CartOverlay,
	color_arr,
} from './rompack';
import { decodeBinary, decodeuint8arr, toF32, typedArrayFromBytes } from '../serializer/binencoder';
import { generateAtlasName } from './rompack';
import { inflate } from 'pako';

export type RomLoadOptions = {
	loadImageFromBuffer?: (buffer: ArrayBuffer) => Promise<TextureSource>;
	loadAudioFromBuffer?: (buffer: ArrayBuffer) => Promise<any>;
	loadDataFromBuffer?: (buffer: ArrayBuffer) => Promise<any>;
	loadModelFromBuffer?: (buffer: ArrayBuffer, textures?: ArrayBuffer) => Promise<any>;
};

export function parseMetaFromBuffer(to_parse: ArrayBuffer): RomMeta {
	const bytearray = new Uint8Array(to_parse);
	const footerOffset = bytearray.length - 16;
	if (footerOffset < 0) throw new Error('ROM file too small for footer');
	let metaOffset = -1;
	let metaLength = -1;
	if (footerOffset < 16) {
		throw new Error('ROM file too small for metadata footer');
	}
	const dv = new DataView(to_parse, footerOffset, 16);
	metaOffset = Number(dv.getBigUint64(0, true));
	metaLength = Number(dv.getBigUint64(8, true));
	if (metaOffset < 0 || metaLength <= 0 || metaOffset + metaLength > bytearray.length) {
		throw new Error('Invalid ROM metadata footer');
	}
	return { start: metaOffset, end: metaOffset + metaLength };
}

function getSubBufferAsPerMeta(buffer: ArrayBuffer, meta: RomMeta): ArrayBuffer {
	return buffer.slice(meta.start, meta.end);
}

export function getSubBufferFromBufferWithMeta(buffer: ArrayBuffer): ArrayBuffer {
	const buffer_meta: RomMeta = parseMetaFromBuffer(buffer);
	return getSubBufferAsPerMeta(buffer, buffer_meta);
}

function toArrayBuffer(blob: BmsxCartridgeBlob): ArrayBuffer {
	if (blob instanceof ArrayBuffer) {
		return blob;
	}
	const view = blob;
	const buffer = new ArrayBuffer(view.byteLength);
	new Uint8Array(buffer).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
	return buffer;
}

function hasRomMetaFooter(buffer: ArrayBuffer): boolean {
	const length = buffer.byteLength;
	if (length < 16) {
		return false;
	}
	const footerOffset = length - 16;
	const dv = new DataView(buffer, footerOffset, 16);
	const metaOffset = Number(dv.getBigUint64(0, true));
	const metaLength = Number(dv.getBigUint64(8, true));
	if (metaOffset < 0 || metaLength <= 0) {
		return false;
	}
	return metaOffset + metaLength <= length;
}

function splitPng(blob: ArrayBuffer): { png?: ArrayBuffer; rest: ArrayBuffer } {
	const u8 = new Uint8Array(blob);
	if (
		u8[0] !== 0x89 || u8[1] !== 0x50 || u8[2] !== 0x4E || u8[3] !== 0x47 ||
		u8[4] !== 0x0D || u8[5] !== 0x0A || u8[6] !== 0x1A || u8[7] !== 0x0A
	) {
		return { rest: blob };
	}
	let p = 8;
	while (p + 8 <= u8.length) {
		const len = (u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
		p += 4;
		const type = (u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
		p += 4;
		const end = p + len + 4;
		if (type === 0x49454E44) {
			const png = u8.slice(0, end).buffer;
			const rest = u8.slice(end).buffer;
			return { png, rest };
		}
		p = end;
	}
	throw new Error('PNG IEND chunk not found');
}

export function getZippedRomAndRomLabelFromBlob(blob_buffer: ArrayBuffer): { zipped_rom: ArrayBuffer, romlabel?: ArrayBuffer } {
	const { png, rest } = splitPng(blob_buffer);
	if (png) {
		return { zipped_rom: rest, romlabel: png };
	}
	return { zipped_rom: blob_buffer, romlabel: undefined };
}

export function normalizeCartridgeBlob(blob: BmsxCartridgeBlob): { payload: ArrayBuffer; romlabel?: ArrayBuffer } {
	const input = toArrayBuffer(blob);
	const { zipped_rom, romlabel } = getZippedRomAndRomLabelFromBlob(input);
	if (hasRomMetaFooter(zipped_rom)) {
		return { payload: zipped_rom, romlabel };
	}
	const inflated = inflate(new Uint8Array(zipped_rom));
	const payload = new ArrayBuffer(inflated.byteLength);
	new Uint8Array(payload).set(inflated);
	if (!hasRomMetaFooter(payload)) {
		throw new Error('Invalid ROM payload after decompression.');
	}
	return { payload, romlabel };
}

export async function loadAssetList(rom: ArrayBuffer): Promise<{ assets: RomAsset[]; projectRootPath: string; manifest: RomManifest }> {
	const sliced = new Uint8Array(getSubBufferFromBufferWithMeta(rom));
	const decoded = decodeBinary(sliced) as RomAssetListPayload;
	const assetList = decoded.assets;
	const projectRootPath = decoded.projectRootPath;
	const manifest = decoded.manifest;

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
					if (asset.imgmeta.atlassed) {
						if (asset.imgmeta.width && asset.imgmeta.height) {
							if (asset.imgmeta.hitpolygons?.original) {
								const extracted_hitpolygon = asset.imgmeta.hitpolygons.original;
								asset.imgmeta.hitpolygons = {
									original: extracted_hitpolygon,
									fliph: flipPolygons(extracted_hitpolygon, true, false, asset.imgmeta.width, asset.imgmeta.height),
									flipv: flipPolygons(extracted_hitpolygon, false, true, asset.imgmeta.width, asset.imgmeta.height),
									fliphv: flipPolygons(extracted_hitpolygon, true, true, asset.imgmeta.width, asset.imgmeta.height)
								};
							}
							if (asset.imgmeta.boundingbox) {
								asset.imgmeta.boundingbox = generateFlippedBoundingBox(asset.imgmeta.boundingbox.original, asset.imgmeta.width, asset.imgmeta.height);
							}
							if (asset.imgmeta.texcoords) {
								const { original, fliph, flipv, fliphv } = generateFlippedTexCoords(asset.imgmeta.texcoords);
								asset.imgmeta.texcoords = original;
								asset.imgmeta.texcoords_fliph = fliph;
								asset.imgmeta.texcoords_flipv = flipv;
								asset.imgmeta.texcoords_fliphv = fliphv;
							}
						}
					}
					break;
				case 'audio':
					asset.audiometa = decodedMeta as AudioMeta;
					break;
				case 'data':
					break;
				case 'model':
					break;
				default:
					break;
			}
		}
	}
	return { assets: assetList, projectRootPath, manifest };
}

export async function parseCartridgeIndex(payload: ArrayBuffer): Promise<CartridgeIndex> {
	const { assets, projectRootPath, manifest } = await loadAssetList(payload);
	return { assets, projectRootPath, manifest };
}

async function getImageFromBuffer(buffer: ArrayBuffer): Promise<ImageBitmap> {
	const blob = new Blob([new Uint8Array(buffer)], { type: 'image/png' });
	return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as any);
}

async function loadDataFromBuffer(buffer: ArrayBuffer): Promise<any> {
	return decodeBinary(new Uint8Array(buffer));
}

export async function loadModelFromBuffer(asset_id: string, buffer: ArrayBuffer, textureBuf?: ArrayBuffer): Promise<GLTFModel> {
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
				return new TextDecoder().decode(u8);
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
			if (buf instanceof ArrayBuffer) return buf;
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

async function fromAsset(romImgAsset: RomImgAsset, rompack: RomPack, options?: { flipY?: boolean; }): Promise<ImageBitmap | TextureSource> {
	let source: TextureSource | ImageBitmap | Promise<ImageBitmap>;
	if (options?.flipY) {
		source = romImgAsset._imgbinYFlipped as TextureSource;
	} else {
		source = romImgAsset._imgbin as TextureSource;
	}
	if (source) return source;

	const imgmeta = romImgAsset.imgmeta;
	if (!source && imgmeta.atlassed) {
		const atlasName = generateAtlasName(imgmeta.atlasid ?? 0);
		const atlas = rompack.img[atlasName]._imgbin as TextureSource;
		if (!atlas) throw new Error(`Texture atlas image not found for atlas ID ${imgmeta.atlasid}`);
		const coords = imgmeta.texcoords;
		if (!coords) throw new Error(`No texture coordinates for atlassed image '${romImgAsset.resid}'`);

		const xs = [coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]];
		const ys = [coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]];
		const minU = Math.min(...xs), maxU = Math.max(...xs);
		const minV = Math.min(...ys), maxV = Math.max(...ys);

		const offsetX = Math.floor(minU * atlas.width);
		const offsetY = Math.floor(minV * atlas.height);
		const imgWidth = Math.max(1, Math.min(atlas.width - offsetX, Math.round((maxU - minU) * atlas.width)));
		const imgHeight = Math.max(1, Math.min(atlas.height - offsetY, Math.round((maxV - minV) * atlas.height)));

		const canvas = document.createElement('canvas');
		canvas.width = imgWidth;
		canvas.height = imgHeight;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(atlas as ImageBitmap, offsetX, offsetY, imgWidth, imgHeight, 0, 0, imgWidth, imgHeight);
		source = createImageBitmap(canvas, {
			imageOrientation: options?.flipY ? 'flipY' : 'none',
			premultiplyAlpha: 'none',
			colorSpaceConversion: 'none',
		});
	}

	if (!source) throw new Error(`Image asset '${romImgAsset.resid}' has no image data`);
	return source;
}

async function load(rom: ArrayBuffer, res: RomAsset, romResult: RomPack, opts?: RomLoadOptions, payloadId?: CartridgeLayerId) {
	if (res.op === 'delete') {
		return;
	}
	const baseAsset = { ...res, payload_id: payloadId };
	switch (res.type) {
		case 'image':
		case 'atlas': {
			let img: TextureSource = undefined;
			if (!baseAsset.imgmeta?.atlassed) {
				if (opts && opts.loadImageFromBuffer) {
					img = await opts.loadImageFromBuffer(rom.slice(baseAsset.start, baseAsset.end));
				} else {
					img = await getImageFromBuffer(rom.slice(baseAsset.start, baseAsset.end));
				}
			}
			const imgAsset: RomImgAsset = {
				...baseAsset,
				_imgbin: img,
				_imgbinYFlipped: undefined,
				get imgbin() {
					return fromAsset(this, romResult);
				},
				get imgbinYFlipped() {
					return fromAsset(this, romResult, { flipY: true });
				},
			};
			romResult.img[res.resid] = imgAsset;
			break;
		}
		case 'audio':
			if (opts && opts.loadAudioFromBuffer) {
				romResult.audio[res.resid] = await opts.loadAudioFromBuffer(rom.slice(baseAsset.start, baseAsset.end));
			} else {
				romResult.audio[res.resid] = baseAsset;
			}
			break;
		case 'lua': {
			const sliced = new Uint8Array(rom, baseAsset.start, baseAsset.end - baseAsset.start);
			const luaAsset: RomLuaAsset = {
				...baseAsset,
				src: decodeuint8arr(sliced),
			} as RomLuaAsset;
			romResult.cart.path2lua[baseAsset.source_path] = luaAsset;
			romResult.cart.path2lua[baseAsset.normalized_source_path] = luaAsset;
			break;
		}
		case 'model': {
			const texBuf = (baseAsset.texture_start != null && baseAsset.texture_end != null) ? rom.slice(baseAsset.texture_start, baseAsset.texture_end) : undefined;
			if (opts && opts.loadModelFromBuffer) {
				romResult.model[res.resid] = await opts.loadModelFromBuffer(rom.slice(baseAsset.start, baseAsset.end), texBuf);
			} else {
				romResult.model[res.resid] = await loadModelFromBuffer(res.resid, rom.slice(baseAsset.start, baseAsset.end), texBuf);
			}
			break;
		}
		case 'data':
			if (opts && opts.loadDataFromBuffer) {
				const data = await opts.loadDataFromBuffer(rom.slice(baseAsset.start, baseAsset.end));
				romResult.data[res.resid] = data;
			} else {
				const data = await loadDataFromBuffer(rom.slice(baseAsset.start, baseAsset.end));
				romResult.data[res.resid] = data;
			}
			break;
		case 'aem': {
			const u8 = new Uint8Array(rom.slice(baseAsset.start, baseAsset.end));
			const audioevents = decodeBinary(u8);
			romResult.audioevents[res.resid] = audioevents;
			break;
		}
		case 'romlabel':
			break;
		default:
			throw new Error(`Unrecognised resource type in rom: ${res.type}, while processing rompack!`);
	}
}

export async function loadRomPackFromIndex(rom: ArrayBuffer, index: CartridgeIndex, opts?: RomLoadOptions, payloadId?: CartridgeLayerId): Promise<RomPack> {
	const cart: RomPack['cart'] = {
		path2lua: {},
		entry_path: index.manifest.lua.entry_path,
		namespace: index.manifest.vm.namespace,
		new_game: null,
		init: null,
		update: null,
		draw: null,
	};
	const result: RomPack = {
		img: {},
		audio: {},
		model: {},
		data: {},
		audioevents: {},
		cart,
		project_root_path: index.projectRootPath,
		manifest: index.manifest,
		canonicalization: index.manifest.vm.canonicalization,
	};

	await Promise.all(index.assets.map(a => load(rom, a, result, opts, payloadId)));

	return result;
}

export async function loadRomPackFromBuffer(rom: ArrayBuffer, opts?: RomLoadOptions, payloadId?: CartridgeLayerId): Promise<RomPack> {
	const index = await parseCartridgeIndex(rom);
	return loadRomPackFromIndex(rom, index, opts, payloadId);
}

export type RomPackLayer = {
	pack: RomPack;
	index: CartridgeIndex;
};

export type RuntimeAssetBuildResult = {
	rompack: RomPack;
	payloads: CartridgePayloads;
	cartOverlay?: CartOverlay;
	cartIndex: CartridgeIndex;
};

function applyAssetLayer(target: RomPack, layer: RomPackLayer): void {
	for (const asset of layer.index.assets) {
		let map: Record<string, any> = null;
		switch (asset.type) {
			case 'image':
			case 'atlas':
				map = target.img;
				break;
			case 'audio':
				map = target.audio;
				break;
			case 'model':
				map = target.model;
				break;
			case 'data':
				map = target.data;
				break;
			case 'aem':
				map = target.audioevents;
				break;
			default:
				break;
		}
		if (!map) {
			continue;
		}
		if (asset.op === 'delete') {
			delete map[asset.resid];
			continue;
		}
		map[asset.resid] = (map === target.img ? layer.pack.img : map === target.audio ? layer.pack.audio : map === target.model ? layer.pack.model : map === target.data ? layer.pack.data : layer.pack.audioevents)[asset.resid];
	}
}

export function mergeRomPackLayers(params: { system: RomPackLayer; cart: RomPackLayer; overlay?: RomPackLayer; }): { pack: RomPack; cartOverlay?: CartOverlay } {
	const { system, cart, overlay } = params;
	const merged: RomPack = {
		img: {},
		audio: {},
		model: {},
		data: {},
		audioevents: {},
		cart: cart.pack.cart,
		project_root_path: cart.pack.project_root_path,
		manifest: cart.pack.manifest,
		canonicalization: cart.pack.canonicalization,
	};
	applyAssetLayer(merged, system);
	applyAssetLayer(merged, cart);
	if (overlay) {
		applyAssetLayer(merged, overlay);
	}

	let cartOverlay: CartOverlay = null;
	if (overlay) {
		const deletes: string[] = [];
		for (const asset of overlay.index.assets) {
			if (asset.type !== 'lua') {
				continue;
			}
			if (asset.op !== 'delete') {
				continue;
			}
			deletes.push(asset.source_path);
			if (asset.normalized_source_path !== asset.source_path) {
				deletes.push(asset.normalized_source_path);
			}
		}
		cartOverlay = { cart: overlay.pack.cart, deletes };
	}

	return { pack: merged, cartOverlay };
}

export async function buildRuntimeAssets(params: { cartridge: BmsxCartridgeBlob; engineAssets: BmsxCartridgeBlob; workspaceOverlay?: BmsxCartridgeBlob; }): Promise<RuntimeAssetBuildResult> {
	const cartNormalized = normalizeCartridgeBlob(params.cartridge);
	const cartIndex = await parseCartridgeIndex(cartNormalized.payload);
	const cartPack = await loadRomPackFromIndex(cartNormalized.payload, cartIndex, undefined, 'cart');

	const engineNormalized = normalizeCartridgeBlob(params.engineAssets);
	const engineIndex = await parseCartridgeIndex(engineNormalized.payload);
	const enginePack = await loadRomPackFromIndex(engineNormalized.payload, engineIndex, undefined, 'system');

	let overlayLayer: RomPackLayer = null;
	let overlayPayload: ArrayBuffer = null;
	if (params.workspaceOverlay) {
		const overlayNormalized = normalizeCartridgeBlob(params.workspaceOverlay);
		const overlayIndex = await parseCartridgeIndex(overlayNormalized.payload);
		const overlayPack = await loadRomPackFromIndex(overlayNormalized.payload, overlayIndex, undefined, 'overlay');
		overlayLayer = { pack: overlayPack, index: overlayIndex };
		overlayPayload = overlayNormalized.payload;
	}

	const { pack: mergedPack, cartOverlay } = mergeRomPackLayers({
		system: { pack: enginePack, index: engineIndex },
		cart: { pack: cartPack, index: cartIndex },
		overlay: overlayLayer,
	});

	const payloads: CartridgePayloads = { system: engineNormalized.payload, cart: cartNormalized.payload };
	if (overlayPayload) {
		payloads.overlay = overlayPayload;
	}

	return { rompack: mergedPack, payloads, cartOverlay, cartIndex };
}
