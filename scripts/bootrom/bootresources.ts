import type { Area, AudioMeta, GLTFMaterial, GLTFModel, ImgMeta, Polygon, RomAsset, RomImgAsset, RomMeta, RomPack, color_arr } from '../../src/bmsx/rompack/rompack';
import { decodeBinary } from '../../src/bmsx/serializer/binencoder';
import { generateAtlasName } from '../rompacker/atlasbuilder';

export async function loadImage(url: string): Promise<ImageBitmap> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(createImageBitmap(img));
		img.onerror = () => reject(`Failed to load image's URL: ${url}`);
		img.src = url;
	});
}

export function parseMetaFromBuffer(to_parse: ArrayBuffer): RomMeta {
	const bytearray = new Uint8Array(to_parse);
	const footerOffset = bytearray.length - 16;
	if (footerOffset < 0) throw new Error('ROM file too small for footer');
	let metaOffset = -1;
	let metaLength = -1;
	if (footerOffset < 16) {
		throw new Error('ROM file too small for metadata footer');
	}
	try {
		const dv = new DataView(to_parse, footerOffset, 16);
		metaOffset = Number(dv.getBigUint64(0, true));
		metaLength = Number(dv.getBigUint64(8, true));
		if (metaOffset < 0 || metaLength <= 0 || metaOffset + metaLength > bytearray.length)
			throw new Error('Invalid ROM metadata footer');
		return { start: metaOffset, end: metaOffset + metaLength };
	} catch (error: any) {
		throw new Error(`Failed to parse ROM metadata: ${error.message}\n${to_parse.byteLength} bytes, footerOffset: ${footerOffset}, metaOffset: ${metaOffset === -1 ? '<unknown>' : metaOffset}, metaLength: ${metaLength === -1 ? '<unknown>' : metaLength}.`);
	}
}

function getSubBufferAsPerMeta(buffer: ArrayBuffer, meta: RomMeta): ArrayBuffer {
	return buffer.slice(meta.start, meta.end);
}

export function getSubBufferFromBufferWithMeta(buffer: ArrayBuffer): ArrayBuffer {
	const buffer_meta: RomMeta = parseMetaFromBuffer(buffer);
	return getSubBufferAsPerMeta(buffer, buffer_meta);
}

function splitPng(blob: ArrayBuffer): { png?: ArrayBuffer; rest: ArrayBuffer } {
	const u8 = new Uint8Array(blob);
	const IEND = 0x49454E44;
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
		if (type === IEND) {
			const png = u8.slice(0, end).buffer;
			const rest = u8.slice(end).buffer;
			return { png, rest };
		}
		p = end;
	}
	throw new Error('PNG IEND chunk not found');
}

export async function getZippedRomAndRomLabelFromBlob(blob_buffer: ArrayBuffer): Promise<{ zipped_rom: ArrayBuffer, romlabel: string }> {
	try {
		const { png, rest } = splitPng(blob_buffer);
		if (png !== undefined) {
			const label = getImageURL(png);
			return { zipped_rom: rest, romlabel: label };
		}
	} catch (e) {
		console.warn('[bootresources] PNG split failed:', e);
	}
	return { zipped_rom: blob_buffer, romlabel: undefined };
}

export async function loadAssetList(rom: ArrayBuffer): Promise<RomAsset[]> {
	const sliced = new Uint8Array(getSubBufferFromBufferWithMeta(rom));
	let assetList: RomAsset[];
	try {
		assetList = decodeBinary(sliced) as RomAsset[];
	} catch (e: any) {
		console.error('[loadAssetList] decodeBinary error:', e);
		throw e;
	}

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

	function flipBoundingBoxHorizontally(box: Area, width: number): Area {
		return {
			start: { x: width - box.end.x, y: box.start.y },
			end: { x: width - box.start.x, y: box.end.y }
		};
	}

	function flipBoundingBoxVertically(box: Area, height: number): Area {
		return {
			start: { x: box.start.x, y: height - box.end.y },
			end: { x: box.end.x, y: height - box.start.y }
		};
	}

	function generateFlippedBoundingBox(extractedBoundingBox: Area, imgW: number, imgH: number) {
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

		// Texcoords are stored in the same order as the quad vertices generated
		// by bvec.set: top-left, bottom-left, top-right, top-right, bottom-left,
		// bottom-right.
		const left = texcoords[0];
		const top = texcoords[1];
		const bottom = texcoords[3];
		const right = texcoords[4];

		// Horizontal flip swaps the left and right coordinates
		result.fliph.push(
			right, top,
			right, bottom,
			left, top,
			left, top,
			right, bottom,
			left, bottom
		);
		// Vertical flip swaps the top and bottom coordinates
		result.flipv.push(
			left, bottom,
			left, top,
			right, bottom,
			right, bottom,
			left, top,
			right, top
		);
		// Flip both horizontally and vertically
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
				case 'code':
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
	return Promise.resolve<RomAsset[]>(assetList);
}

export async function loadResources(rom: ArrayBuffer, opts?: { loadImageFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadSourceFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadAudioFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadDataFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadModelFromBuffer?: (buffer: ArrayBuffer, textures?: ArrayBuffer) => Promise<any> }): Promise<RomPack> {
	const result: RomPack = {
		rom: rom,
		img: {},
		audio: {},
		model: {},
		data: {},
		fsm: {},
		code: null,
		audioevents: {}
	};

	const assetList = await loadAssetList(rom);
	await Promise.all(assetList.map(a => load(rom, a, result, opts)));
	return Promise.resolve<RomPack>(result);
}

function getImageURL(buffer: ArrayBuffer): string {
	// When opened via file:// some browsers restrict blob: URLs or handle them
	// differently which can cause image loading to fail (see error about
	// "Failed to load image's URL: blob:file:///..."). Prefer a data: URL
	// fallback when running from the file protocol to avoid that problem.
	try {
		if (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:') {
			const u8 = new Uint8Array(buffer);
			// Convert Uint8Array to base64 in chunks to avoid call-size limits
			const CHUNK = 0x8000;
			let index = 0;
			let binary = '';
			while (index < u8.length) {
				const slice = u8.subarray(index, Math.min(index + CHUNK, u8.length));
				binary += String.fromCharCode.apply(null, Array.from(slice));
				index += CHUNK;
			}
			return 'data:image/png;base64,' + btoa(binary);
		}
	} catch (e) {
		// ignore and fall back to blob URL
		// (we prefer not to throw here because callers expect a URL string)
		// console.warn('getImageURL file:// fallback failed, using blob URL', e);
	}

	return URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'image/png' }));
}

async function getImageFromBuffer(buffer: ArrayBuffer): Promise<ImageBitmap> {
	return loadImage(getImageURL(buffer));
}

async function loadDataFromBuffer(buffer: ArrayBuffer): Promise<any> {
	return decodeBinary(new Uint8Array(buffer));
}

export async function loadModelFromBuffer(assetId: string, buffer: ArrayBuffer, textureBuf?: ArrayBuffer): Promise<GLTFModel> {
	const obj = decodeBinary(new Uint8Array(buffer), { zeroCopyBin: true });

	function ensureAlignedView(u8: Uint8Array, alignment: number): Uint8Array {
		if ((u8.byteLength % alignment) !== 0) {
			throw new Error(`loadModelFromBuffer: byteLength ${u8.byteLength} not divisible by ${alignment}`);
		}
		if ((u8.byteOffset % alignment) === 0) return u8;
		const copy = u8.slice();
		if ((copy.byteOffset % alignment) !== 0) {
			throw new Error('loadModelFromBuffer: unable to align view');
		}
		return copy;
	}

	function typedArrayFromBytes<T extends ArrayBufferView>(u8: Uint8Array, ctor: { new(buffer: ArrayBufferLike, byteOffset: number, length?: number): T; BYTES_PER_ELEMENT: number }): T {
		const alignment = ctor.BYTES_PER_ELEMENT;
		const aligned = ensureAlignedView(u8, alignment);
		return new ctor(aligned.buffer, aligned.byteOffset, aligned.byteLength / alignment);
	}

	function toF32(v: any): Float32Array | undefined {
		if (v === undefined || v === null) return undefined;
		if (ArrayBuffer.isView(v)) {
			const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
			return typedArrayFromBytes(u8, Float32Array);
		}
		if (Array.isArray(v)) return new Float32Array(v);
		return undefined;
	}
	function toIndices(v: any, componentType?: number): Uint8Array | Uint16Array | Uint32Array | undefined {
		if (v === undefined || v === null) return undefined;
		if (ArrayBuffer.isView(v)) {
			const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
			if (componentType === 5125) return typedArrayFromBytes(u8, Uint32Array);
			if (componentType === 5123) return typedArrayFromBytes(u8, Uint16Array);
			if (componentType === 5121) return new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength);  // Add this
			if (u8.byteLength % 4 === 0) return typedArrayFromBytes(u8, Uint32Array);
			return typedArrayFromBytes(u8, Uint16Array);
		}
		if (Array.isArray(v)) {
			if (componentType === 5125) return new Uint32Array(v);
			if (componentType === 5123) return new Uint16Array(v);
			if (componentType === 5121) return new Uint8Array(v);  // Add this
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
		// Images
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
	const textures: number[] | undefined = obj.textures;
	const materials = obj.materials as GLTFMaterial[];
	const texBytes = textureBuf ? new Uint8Array(textureBuf) : undefined;
	let imageBuffers: ArrayBuffer[] | undefined = undefined;
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

	function textureIndexToTextureObject(index: number): number | undefined {
		if (index === undefined || index === null) return undefined;
		if (typeof index !== 'number') {
			console.warn(`Invalid texture index type: ${typeof index}. Expected a number.`);
			return undefined;
		}
		// Remap the texture index to the actual texture object
		const remapped = textures?.[index];
		if (remapped === undefined) {
			console.warn(`Invalid texture index ${index}. Using undefined texture.`);
			console.log(`Available textures: ${textures ? textures.join(', ') : 'none'}`);
			console.log(`Available materials: ${materials ? materials.map((m, i) => `${i}: ${JSON.stringify(m)}`).join(', ') : 'none'}`);
			console.log(`Remapped texture for index ${index}: ${JSON.stringify(remapped)}`);

			return undefined;
		}
		// console.log(`Remapped texture for index ${index} to ${remapped}: ${imageBuffers?.[remapped].byteLength} bytes`);
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
	return { name: assetId, meshes, materials, animations, imageURIs: obj.imageURIs, imageOffsets: obj.imageOffsets, imageBuffers, textures, nodes, scenes, scene, skins };
}

async function getAssetImageBin(romImgAsset: RomImgAsset, rompack: RomPack, options?: { flipY?: boolean }): Promise<ImageBitmap> {
	let source: ImageBitmap | Promise<ImageBitmap> | undefined;
	if (options?.flipY) {
		source = romImgAsset._imgbinYFlipped; // Use the private _imgbinYFlipped property
	} else {
		source = romImgAsset._imgbin; // Use the private _imgbin property
	}
	if (source) return source;

	// If the image was packed into an atlas, extract its region and cache the result in the `_imgbin` property
	const imgmeta = romImgAsset.imgmeta;
	if (!source && imgmeta.atlassed) {
		const atlas = rompack.img[generateAtlasName(imgmeta.atlasid)]?._imgbin; // Atlas should have a populated _imgbin property
		if (!atlas) throw new Error(`Texture atlas image not found for atlas ID ${imgmeta.atlasid}`);
		const coords = imgmeta.texcoords;
		if (!coords) throw new Error(`No texture coordinates for atlassed image '${romImgAsset.resname}'`);

		const xs = [coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]];
		const ys = [coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]];
		const minU = Math.min(...xs), maxU = Math.max(...xs);
		const minV = Math.min(...ys), maxV = Math.max(...ys);

		// const sx = minU * atlas.width;
		// const sy = minV * atlas.height;
		// let imgWidth = (maxU - minU) * atlas.width;
		// let imgHeight = (maxV - minV) * atlas.height;
		// Convert to pixel coordinates and clamp inside atlas bounds
		const offsetX = Math.floor(minU * atlas.width);
		const offsetY = Math.floor(minV * atlas.height);
		const imgWidth = Math.max(1, Math.min(atlas.width - offsetX, Math.round((maxU - minU) * atlas.width)));
		const imgHeight = Math.max(1, Math.min(atlas.height - offsetY, Math.round((maxV - minV) * atlas.height)));

		const canvas = document.createElement('canvas');
		canvas.width = imgWidth;
		canvas.height = imgHeight;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(atlas, offsetX, offsetY, imgWidth, imgHeight, 0, 0, imgWidth, imgHeight);
		// Convert canvas to ImageBitmap asynchronously
		source = createImageBitmap(canvas, {
			imageOrientation: options?.flipY ? 'flipY' : 'none',
			premultiplyAlpha: 'none',
			colorSpaceConversion: 'none',
		});
	}

	if (!source) throw new Error(`Image asset '${romImgAsset.resname}' has no image data`);
	return source;
}

async function load(rom: ArrayBuffer, res: RomAsset, romResult: RomPack, opts?: { loadImageFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadSourceFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadAudioFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadDataFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadModelFromBuffer?: (buffer: ArrayBuffer, textures?: ArrayBuffer) => Promise<any> }, _loadFSMFromBuffer?: (buffer: ArrayBuffer) => Promise<any>): Promise<void> {
	switch (res.type) {
		case 'image':
		case 'atlas':
			let img: ImageBitmap | undefined = undefined;
			// Non-atlassed images can be loaded directly from their buffer
			if (!res.imgmeta?.atlassed) {
				if (opts && opts.loadImageFromBuffer) {
					img = await opts.loadImageFromBuffer(rom.slice(res.start, res.end));
				} else {
					img = await getImageFromBuffer(rom.slice(res.start, res.end));
				}
			}
			// Create the RomImgAsset object, with a getter for the imgbin property
			// that will extract the image from the atlas when required.
			// Note that the _imgbin property will be populated with the ImageBitmap
			const imgAsset: RomImgAsset = {
				...res,
				_imgbin: img, // The Image Bitmap of the image asset or undefined if not available. Note that this will be populated with an ImageBitmap when `get imgbin()` is called! In other words, it also acts as a cache when required.
				_imgbinYFlipped: undefined,
				// ** THAT'S WHY YOU SHOULD USE THE `atlassed`-PROPERTY TO DETERMINE WHETHER AN IMAGE ASSET IS ATLASSED OR NOT! **
				// Getter for imgbin property, compatible with RomImgAsset interface
				get imgbin() {
					return getAssetImageBin(this, romResult); // This will populate the _imgbin property if required
				},
				get imgbinYFlipped() {
					return getAssetImageBin(this, romResult, { flipY: true }); // This will populate the _imgbinYFlipped property if required
				},
			};
			romResult.img[res.resid] = imgAsset;
			romResult.img[res.resname] = imgAsset;
			break;
		case 'audio':
			try {
				if (opts && opts.loadAudioFromBuffer) {
					romResult.audio[res.resid] = await opts.loadAudioFromBuffer(rom.slice(res.start, res.end));
				} else {
					romResult.audio[res.resid] = res;
					romResult.audio[res.resname] = res;
				}
			} catch (err: any) {
				throw new Error(`Failed to load 'audio' from rom: ${err.message}.`);
			}
			break;
		case 'code':
			try {
				if (opts && opts.loadSourceFromBuffer) {
					romResult.code = await opts.loadSourceFromBuffer(rom.slice(res.start, res.end));
				} else {
					const sliced = new Uint8Array(rom, res.start, res.end - res.start);
					romResult.code = decodeuint8arr(sliced);
				}
			} catch (err: any) {
				throw new Error(`Failed to load 'source' from rom: ${err.message}.`);
			}
			break;
		case 'model':
			try {
				let model: GLTFModel;
				const texBuf = (res.texture_start != null && res.texture_end != null) ? rom.slice(res.texture_start, res.texture_end) : undefined;
				if (opts && opts.loadModelFromBuffer) {
					model = await opts.loadModelFromBuffer(rom.slice(res.start, res.end));
				} else {
					model = await loadModelFromBuffer(res.resname, rom.slice(res.start, res.end), texBuf);
				}
				romResult.model[res.resid] = model;
				romResult.model[res.resname] = model;
			} catch (err: any) {
				throw new Error(`Failed to load 'model' from rom: ${err.message}.`);
			}
			break;
		case 'data':
			try {
				if (opts && opts.loadDataFromBuffer) {
					const data = await opts.loadDataFromBuffer(rom.slice(res.start, res.end));
					romResult.data[res.resid] = data;
					romResult.data[res.resname] = data;
				} else {
					const data = await loadDataFromBuffer(rom.slice(res.start, res.end));
					romResult.data[res.resid] = data;
					romResult.data[res.resname] = data;
				}
			} catch (err: any) {
				throw new Error(`Failed to load 'data' from rom: ${err.message}.`);
			}
			break;
		case 'fsm': {
			try {
				const u8 = new Uint8Array(rom.slice(res.start, res.end));
				const blueprint = decodeBinary(u8);
				romResult.fsm[res.resid] = blueprint;
				romResult.fsm[res.resname] = blueprint;
			} catch (err: any) {
				throw new Error(`Failed to load 'fsm' from rom: ${err.message}.`);
			}
			break;
		}
		case 'aem': {
			try {
				const u8 = new Uint8Array(rom.slice(res.start, res.end));
				const audioevents = decodeBinary(u8);
				romResult.audioevents[res.resid] = audioevents;
				romResult.audioevents[res.resname] = audioevents;
				console.info(`Loaded audio event map '${res.resname}' with ${Object.keys(audioevents).length} entries.`);
			} catch (err: any) {
				throw new Error(`Failed to load 'aem' from rom: ${err.message}.`);
			}
			break;
		}

		default:
			throw new Error(`Unrecognised resource type in rom: ${res.type}, while processing rompack!`);
	}
}

export function decodeuint8arr(to_decode: Uint8Array): string {
	const decoder = new TextDecoder('utf-8', { fatal: true });
	try {
		return decoder.decode(to_decode);
	} catch (err) {
		throw err;
	}
}
