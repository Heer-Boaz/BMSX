import type { Area, AudioMeta, GLTFMaterial, GLTFModel, ImgMeta, Polygon, RomAsset, RomImgAsset, RomMeta, RomPack } from '../../src/bmsx/rompack/rompack';
import { decodeBinary } from '../../src/bmsx/serializer/binencoder';

export async function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
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

export async function getZippedRomAndRomLabelFromBlob(blob_buffer: ArrayBuffer): Promise<{ zipped_rom: ArrayBuffer, romlabel: string }> {
    const u8 = new Uint8Array(blob_buffer);
    if (
        u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47 &&
        u8[4] === 0x0D && u8[5] === 0x0A && u8[6] === 0x1A && u8[7] === 0x0A
    ) {
        const IEND = [0x49, 0x45, 0x4E, 0x44];
        let idx = 8;
        while (idx < u8.length - 12) {
            if (
                u8[idx + 4] === IEND[0] &&
                u8[idx + 5] === IEND[1] &&
                u8[idx + 6] === IEND[2] &&
                u8[idx + 7] === IEND[3]
            ) {
                const chunkLen = (u8[idx] << 24) | (u8[idx + 1] << 16) | (u8[idx + 2] << 8) | u8[idx + 3];
                idx += 8 + chunkLen + 4;
                return {
                    zipped_rom: blob_buffer.slice(idx),
                    romlabel: getImageURL(blob_buffer.slice(0, idx))
                };
            }
            idx++;
        }
        throw new Error('Could not find end of PNG header!');
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
        code: null
    };

    const assetList = await loadAssetList(rom);
    await Promise.all(assetList.map(a => load(rom, a, result, opts)));
    return Promise.resolve<RomPack>(result);
}

function getImageURL(buffer: ArrayBuffer): string {
    return URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'image/png' }));
}

async function getImageFromBuffer(buffer: ArrayBuffer): Promise<HTMLImageElement> {
    return loadImage(getImageURL(buffer));
}

async function loadDataFromBuffer(buffer: ArrayBuffer): Promise<any> {
    return decodeBinary(new Uint8Array(buffer));
}

export async function loadModelFromBuffer(assetId: string, buffer: ArrayBuffer, textureBuf?: ArrayBuffer): Promise<GLTFModel> {
    const obj = decodeBinary(new Uint8Array(buffer)) as any;
    function toF32(v: any): Float32Array | undefined {
        if (v === undefined || v === null) return undefined;
        if (ArrayBuffer.isView(v)) {
            const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
            return new Float32Array(u8.buffer, u8.byteOffset, Math.floor(u8.byteLength / 4));
        }
        if (Array.isArray(v)) return new Float32Array(v);
        return undefined;
    }
    function toIndices(v: any, componentType?: number): Uint8Array | Uint16Array | Uint32Array | undefined {
        if (v === undefined || v === null) return undefined;
        if (ArrayBuffer.isView(v)) {
            const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
            if (componentType === 5125) return new Uint32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
            if (componentType === 5123) return new Uint16Array(u8.buffer, u8.byteOffset, u8.byteLength / 2);
            if (componentType === 5121) return new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength);  // Add this
            if (u8.byteLength % 4 === 0) return new Uint32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
            return new Uint16Array(u8.buffer, u8.byteOffset, u8.byteLength / 2);
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
        jointIndices: m.jointIndices ? new Uint16Array(m.jointIndices) : undefined,
        jointWeights: m.jointWeights ? toF32(m.jointWeights) : undefined,

    }));
    const textures: number[] | undefined = obj.textures;
    const materials = obj.materials as GLTFMaterial[];
    const texBytes = new Uint8Array(textureBuf);
    let imageBuffers: ArrayBuffer[] | undefined = undefined;
    if (textureBuf && Array.isArray(obj.imageOffsets)) {
        imageBuffers = obj.imageOffsets.map(off => {
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
            // if (m.occlusionTexture !== undefined) m.occlusionTexture = textureIndexToTextureObject(m.occlusionTexture);
            // if (m.emissiveTexture !== undefined) m.emissiveTexture = textureIndexToTextureObject(m.emissiveTexture);
        }
    }
    return { name: assetId, meshes, materials, animations, imageURIs: obj.imageURIs, imageOffsets: obj.imageOffsets, imageBuffers, textures, nodes, scenes, scene, skins };
}

async function load(rom: ArrayBuffer, res: RomAsset, romResult: RomPack, opts?: { loadImageFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadSourceFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadAudioFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadDataFromBuffer?: (buffer: ArrayBuffer) => Promise<any>; loadModelFromBuffer?: (buffer: ArrayBuffer, textures?: ArrayBuffer) => Promise<any> }, loadFSMFromBuffer?: (buffer: ArrayBuffer) => Promise<any>): Promise<void> {
    switch (res.type) {
        case 'image':
        case 'atlas':
            let img: HTMLImageElement = undefined;
            if (!res.imgmeta?.atlassed) {
                if (opts && opts.loadImageFromBuffer) {
                    img = await opts.loadImageFromBuffer(rom.slice(res.start, res.end));
                } else {
                    img = await getImageFromBuffer(rom.slice(res.start, res.end));
                }
            }
            const imgAsset: RomImgAsset = {
                ...res,
                imgbin: img,
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
                    romResult.data[res.resid] = await opts.loadDataFromBuffer(rom.slice(res.start, res.end));
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
